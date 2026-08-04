import { applyBatch, cloneValue, walkDocument } from "../../protocol/document-ot.js";
import {
  documentReferenceVectorPlan,
  documentRootHex,
  documentValuePlan,
  verifyDocumentRecord
} from "./document-hcv1.js";
import {
  createDocumentBatchBundle,
  createDocumentOperationPlan,
  createDocumentTransformationBundle
} from "./document-records.js";
import {
  createDocumentRoomGenesis,
  createRoomImportReceipt,
  createRoomRevisionBundle,
  verifyDocumentRoomGenesis,
  verifyRoomCommitBundle
} from "./document-room-records.js";

const DOCUMENT_CONFLICT_PREFIXES = Object.freeze([
  "text.",
  "node.",
  "artefact.",
  "mark.",
  "document."
]);

function root(value, name = "document root") {
  return documentRootHex(value, name);
}

function sameRoot(left, right) {
  return root(left) === root(right);
}

function sameJwk(left, right) {
  const keys = (value) => Object.keys(value || {}).sort().map((key) => [key, value[key]]);
  return JSON.stringify(keys(left)) === JSON.stringify(keys(right));
}

function plainValue(value) {
  if (value === undefined || value === null || typeof value !== "object") {
    return value ?? null;
  }
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return value.map(plainValue);
  if (value instanceof Map) {
    return Object.fromEntries([...value].map(([key, item]) => [
      typeof key === "object" && key?.name ? key.name : String(key),
      plainValue(item)
    ]));
  }
  if (Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plainValue(item)]));
  }
  if (value?.name && Object.keys(value).length <= 2) return value.name;
  return String(value);
}

function canonicalOperation(operation) {
  const next = { ...operation };
  for (const field of ["sourceRoot", "resultRoot", "expectedRoot"]) {
    if (next[field] && typeof next[field] === "object") next[field] = next[field].root;
  }
  return next;
}

async function sourceRootIndex(document) {
  const sources = [];
  walkDocument(document, (node) => {
    if (node.type !== "hara-artefact") return;
    const source = (node.children || []).find((child) => child.type === "text");
    if (source) sources.push([node.attrs?.artefactId, source.id, source.text]);
  });
  const index = new Map();
  for (const [artefactId, sourceId, source] of sources) {
    index.set(`${artefactId}:${sourceId}`, (await documentValuePlan(source)).root);
  }
  return index;
}

function sourceRootOptions(index) {
  return {
    sourceRoot(artefact, _source) {
      const sourceNode = (artefact.children || []).find((child) => child.type === "text");
      return index.get(`${artefact.attrs?.artefactId}:${sourceNode?.id}`) || null;
    }
  };
}

function conflictFrom(error) {
  const data = plainValue(error?.data || error?.details || null);
  const rawCode = data?.code?.name
    || data?.code
    || error?.code
    || null;
  const code = rawCode == null ? null : String(rawCode).replace(/^:/, "");
  return {
    code,
    message: error?.message || String(error),
    details: data
  };
}

function recognisedConflict(conflict, error) {
  if (error?.name === "DocumentConflictError") return true;
  return Boolean(conflict.code && DOCUMENT_CONFLICT_PREFIXES.some(
    (prefix) => conflict.code.startsWith(prefix)
  ));
}

async function keyRootPlan(key) {
  const bytes = new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey));
  return documentValuePlan(bytes);
}

function signingAdapter(key) {
  return crypto.subtle.exportKey("raw", key.publicKey).then((bytes) => ({
    publicKeyBytes: new Uint8Array(bytes),
    sign(payload) {
      return crypto.subtle.sign({ name: "Ed25519" }, key.privateKey, payload);
    }
  }));
}

function memberProjection(member) {
  return {
    member_id: member.memberId,
    label: member.label || member.memberId,
    role: member.role || "editor",
    public_key_jwk: member.publicKeyJwk,
    profile_root: member.profileRecord.root,
    delegation_root: member.delegationRecord.root
  };
}

async function verifyBatchProjection(bundle, member, baseDocument) {
  await verifyDocumentRecord(bundle.record, member.publicKeyJwk);
  if (bundle.documentId !== baseDocument.id
      || bundle.record.body.document_id !== baseDocument.id
      || Number(bundle.record.body.base_revision) !== Number(bundle.baseRevision)) {
    throw new Error("signed document batch identity mismatch");
  }
  const [basePlan, expectedPlan, operationPlans] = await Promise.all([
    documentValuePlan(baseDocument),
    documentValuePlan(bundle.expectedResultAst),
    Promise.all(bundle.operations.map((operation) =>
      createDocumentOperationPlan(bundle.documentId, operation, bundle.baseRevision)))
  ]);
  const operationVector = await documentReferenceVectorPlan(operationPlans);
  const body = bundle.record.body;
  if (!sameRoot(body.base_ast_root, basePlan)
      || !sameRoot(body.operations_root, operationVector)
      || !sameRoot(body.expected_result_root, expectedPlan)
      || !sameRoot(body.author_profile_root, member.profileRecord)
      || !sameRoot(body.delegation_root, member.delegationRecord)) {
    throw new Error("signed document batch projection mismatch");
  }
  return { basePlan, expectedPlan, operationPlans, operationVector };
}

export class DocumentRoom extends EventTarget {
  constructor({
    role,
    roomId,
    document,
    kernel,
    documentKey,
    localMember,
    epoch = 1
  }) {
    super();
    if (role !== "sequencer" && role !== "participant") throw new Error("invalid document room role");
    if (!roomId || !document?.id || !kernel || !documentKey?.id || !localMember?.memberId) {
      throw new Error("document room requires room, document, kernel, key and local member");
    }
    this.role = role;
    this.roomId = roomId;
    this.document = cloneValue(document);
    this.kernel = kernel;
    this.documentKey = documentKey;
    this.localMemberId = localMember.memberId;
    this.epoch = Number(epoch);
    this.genesis = null;
    this.revision = Number(document.revision || 0);
    this.sequence = 0;
    this.headRoot = null;
    this.history = [];
    this.snapshots = new Map([[this.revision, cloneValue(document)]]);
    this.members = new Map([[localMember.memberId, cloneValue(localMember)]]);
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  addMember(member) {
    if (!member?.memberId || !member?.publicKeyJwk || !member?.profileRecord?.root || !member?.delegationRecord?.root) {
      throw new Error("document room member is incomplete");
    }
    this.members.set(member.memberId, cloneValue(member));
    this.emit("member", { member: cloneValue(member) });
    return member;
  }

  member(memberId) {
    const member = this.members.get(memberId);
    if (!member) throw new Error(`document room member is unknown: ${memberId}`);
    return member;
  }

  localMember() {
    return this.member(this.localMemberId);
  }

  snapshot() {
    return Object.freeze({
      protocol: "hestia-document-room-snapshot/1",
      roomId: this.roomId,
      epoch: this.genesis?.record?.body?.epoch || this.epoch,
      sequence: this.sequence,
      revision: this.revision,
      headRoot: this.headRoot,
      document: cloneValue(this.document),
      members: [...this.members.values()].map(cloneValue)
    });
  }

  async issueGenesis() {
    if (this.role !== "sequencer") throw new Error("only the room sequencer may issue genesis");
    if (this.genesis) return this.genesis;
    const members = [...this.members.values()].sort((left, right) => left.memberId.localeCompare(right.memberId));
    const initialAstPlan = await documentValuePlan(this.document);
    const genesis = await createDocumentRoomGenesis({
      roomId: this.roomId,
      documentId: this.document.id,
      epoch: this.epoch,
      initialAst: this.document,
      members: members.map(memberProjection),
      sequencerKey: this.documentKey
    });
    this.genesis = genesis;
    this.headRoot = genesis.record.root;
    this.snapshots.set(0, cloneValue(this.document));
    this.emit("genesis", { genesis, initialAstPlan });
    return genesis;
  }

  async acceptGenesis(genesis) {
    const verified = await verifyDocumentRoomGenesis(genesis, {
      roomId: this.roomId,
      documentId: this.document.id,
      expectedInitialAst: this.document
    });
    const localProjection = verified.body.members.find((member) => member.member_id === this.localMemberId);
    if (!localProjection) throw new Error("local member is absent from document room genesis");
    const local = this.localMember();
    if (!sameJwk(localProjection.public_key_jwk, local.publicKeyJwk)
        || !sameRoot(localProjection.profile_root, local.profileRecord)
        || !sameRoot(localProjection.delegation_root, local.delegationRecord)) {
      throw new Error("document room genesis local membership mismatch");
    }
    for (const projection of verified.body.members) {
      const member = this.members.get(projection.member_id);
      if (member) continue;
      this.members.set(projection.member_id, {
        memberId: projection.member_id,
        label: projection.label,
        role: projection.role,
        publicKeyJwk: projection.public_key_jwk,
        profileRecord: { root: projection.profile_root },
        delegationRecord: { root: projection.delegation_root }
      });
    }
    this.genesis = genesis;
    this.epoch = Number(verified.body.epoch);
    this.headRoot = genesis.record.root;
    this.snapshots.set(0, cloneValue(this.document));
    this.emit("genesis", { genesis });
    return genesis;
  }

  async createBatch(operations, {
    baseRevision = this.revision,
    baseDocument = this.snapshots.get(baseRevision)
  } = {}) {
    if (!this.genesis) throw new Error("document room has no signed genesis");
    if (!Array.isArray(operations) || !operations.length || operations.length > 64) {
      throw new Error("document room batches require one to 64 operations");
    }
    if (!baseDocument) throw new Error(`document base revision is unavailable: ${baseRevision}`);
    const member = this.localMember();
    const batchId = crypto.randomUUID();
    const projected = {
      id: batchId,
      documentId: this.document.id,
      baseRevision,
      operations: operations.map((operation) => ({
        ...canonicalOperation(operation),
        id: operation.id || crypto.randomUUID(),
        baseRevision
      }))
    };
    const signedOperations = projected.operations.map((operation) => ({ ...operation }));
    const expectedResultAst = applyBatch(
      cloneValue(baseDocument),
      projected,
      sourceRootOptions(await sourceRootIndex(baseDocument))
    );
    return createDocumentBatchBundle({
      documentId: this.document.id,
      batchId: projected.id,
      baseRevision,
      baseAst: cloneValue(baseDocument),
      operations: signedOperations,
      expectedResultAst,
      authorProfileRecord: member.profileRecord,
      delegationRecord: member.delegationRecord,
      signingKey: this.documentKey
    });
  }

  acceptedOperationsAfter(revision) {
    return this.history
      .filter((entry) => entry.outcome === "accepted" && entry.revision > revision)
      .flatMap((entry) => entry.transformedOperations.map((operation) => ({
        ...operation,
        environmentSequence: entry.sequence
      })));
  }

  async sequence(bundle, authorMemberId) {
    if (this.role !== "sequencer") throw new Error("only the room sequencer may sequence a batch");
    if (!this.genesis) throw new Error("document room has no signed genesis");
    const member = this.member(authorMemberId);
    const baseDocument = this.snapshots.get(Number(bundle.baseRevision));
    if (!baseDocument) throw new Error(`batch base revision is not in this room: ${bundle.baseRevision}`);
    await verifyBatchProjection(bundle, member, baseDocument);

    const previousDocument = cloneValue(this.document);
    const previousRevision = this.revision;
    const previousRevisionRoot = this.headRoot;
    let transformedOperations = [];
    let resultAst = previousDocument;
    let outcome = "accepted";
    let conflict = null;

    try {
      const transformed = await this.kernel.transform({
        id: bundle.batchId,
        documentId: bundle.documentId,
        baseRevision: bundle.baseRevision,
        operations: bundle.operations.map(canonicalOperation)
      }, this.acceptedOperationsAfter(bundle.baseRevision));
      transformedOperations = transformed.operations.map(canonicalOperation);
      resultAst = applyBatch(previousDocument, {
        id: bundle.batchId,
        documentId: bundle.documentId,
        baseRevision: bundle.baseRevision,
        operations: transformedOperations
      }, sourceRootOptions(await sourceRootIndex(previousDocument)));
    } catch (error) {
      const proposed = conflictFrom(error);
      if (!recognisedConflict(proposed, error)) throw error;
      outcome = "conflict";
      conflict = proposed;
      transformedOperations = [];
      resultAst = previousDocument;
    }

    const transformation = await createDocumentTransformationBundle({
      documentId: this.document.id,
      batchRecord: bundle.record,
      baseRevision: bundle.baseRevision,
      previousRevisionRoot,
      previousAst: previousDocument,
      transformedOperations,
      resultAst,
      outcome,
      conflict,
      environmentSigner: await signingAdapter(this.documentKey),
      environmentKeyId: this.documentKey.id
    });
    const environmentKeyRoot = await keyRootPlan(this.documentKey);
    const nextRevision = outcome === "accepted" ? previousRevision + 1 : previousRevision;
    const revisionBundle = outcome === "accepted"
      ? await createRoomRevisionBundle({
        documentId: this.document.id,
        revision: nextRevision,
        previousRevisionRoot,
        previousAst: previousDocument,
        batchRecord: bundle.record,
        transformationRecord: transformation.record,
        transformedOperations,
        resultAst,
        authorProfileRecord: member.profileRecord,
        environmentKeyRoot
      })
      : null;
    const nextSequence = this.sequence + 1;
    const receipt = await createRoomImportReceipt({
      documentId: this.document.id,
      batchRecord: bundle.record,
      transformationRecord: transformation.record,
      baseRevision: bundle.baseRevision,
      previousRevisionRoot,
      transformedOperationsPlan: transformation.operationVector,
      revisionBundle,
      resultAstPlan: transformation.resultAstPlan,
      outcome,
      sequence: nextSequence,
      sequencerKey: this.documentKey
    });
    const commit = {
      protocol: "hestia-document-room-commit/1",
      roomId: this.roomId,
      epoch: this.genesis.record.body.epoch,
      sequence: nextSequence,
      authorMemberId,
      previousRevision,
      previousRevisionRoot,
      outcome,
      conflict,
      batch: bundle,
      transformation,
      revision: revisionBundle,
      receipt,
      transformedOperations,
      resultAst
    };
    await this.applyCommit(commit);
    return commit;
  }

  async applyCommit(commit) {
    if (!this.genesis) throw new Error("document room cannot verify commits before genesis");
    if (commit?.protocol !== "hestia-document-room-commit/1"
        || commit.roomId !== this.roomId
        || Number(commit.epoch) !== Number(this.genesis.record.body.epoch)) {
      throw new Error("document room commit identity mismatch");
    }
    if (Number(commit.sequence) !== this.sequence + 1
        || Number(commit.previousRevision) !== this.revision
        || commit.previousRevisionRoot !== this.headRoot) {
      throw new Error("document room commit does not extend the current head");
    }
    const sequencer = this.members.get(this.genesis.record.body.sequencer_member_id);
    const author = this.member(commit.authorMemberId);
    if (!sequencer) throw new Error("document room sequencer membership is missing");
    await verifyBatchProjection(
      commit.batch,
      author,
      this.snapshots.get(Number(commit.batch.baseRevision))
    );
    const verified = await verifyRoomCommitBundle(commit, {
      sequencerPublicJwk: sequencer.publicKeyJwk,
      expectedPreviousAst: this.document
    });
    let replayed = cloneValue(this.document);
    if (commit.outcome === "accepted") {
      replayed = applyBatch(replayed, {
        id: commit.batch.batchId,
        documentId: this.document.id,
        baseRevision: commit.batch.baseRevision,
        operations: commit.transformedOperations
      }, sourceRootOptions(await sourceRootIndex(this.document)));
      const replayPlan = await documentValuePlan(replayed);
      if (!sameRoot(replayPlan, commit.transformation.resultAstPlan)
          || !sameRoot(replayPlan, commit.revision.resultAstPlan)) {
        throw new Error("document room replay result root mismatch");
      }
      this.document = replayed;
      this.revision = Number(commit.revision.body.revision);
      this.headRoot = commit.revision.record.root;
      this.snapshots.set(this.revision, cloneValue(this.document));
    } else if (commit.outcome === "conflict") {
      if (commit.revision) throw new Error("conflicted document room commit cannot contain a revision");
      const currentPlan = await documentValuePlan(this.document);
      if (!sameRoot(currentPlan, commit.transformation.resultAstPlan)) {
        throw new Error("conflicted document room result must preserve the current AST");
      }
    } else {
      throw new Error("unknown document room commit outcome");
    }
    this.sequence = Number(commit.sequence);
    this.history.push({
      sequence: this.sequence,
      revision: this.revision,
      outcome: commit.outcome,
      batchRoot: commit.batch.record.root,
      transformationRoot: commit.transformation.record.root,
      revisionRoot: commit.revision?.record?.root || null,
      receiptRoot: commit.receipt.record.root,
      transformedOperations: cloneValue(commit.transformedOperations),
      conflict: cloneValue(commit.conflict),
      authorMemberId: commit.authorMemberId
    });
    this.emit("commit", { commit, document: cloneValue(this.document) });
    return verified;
  }

  evaluateArtefact(source) {
    return this.kernel.evaluate(source);
  }
}
