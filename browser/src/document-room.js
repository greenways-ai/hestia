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
  return {
    code: error?.data?.code?.name
      || error?.data?.code
      || error?.code
      || "document.transform-failed",
    message: error?.message || String(error),
    details: error?.data || error?.details || null
  };
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
    throw new Error("signed document batch projection does not match its HCV1 roots");
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
    localMember
  }) {
    super();
    if (role !== "sequencer" && role !== "participant") {
      throw new Error("document room role must be sequencer or participant");
    }
    if (!roomId || !document?.id || !kernel?.transform || !documentKey || !localMember) {
      throw new Error("document room is missing its kernel, document, key or member");
    }
    this.role = role;
    this.roomId = roomId;
    this.documentKey = documentKey;
    this.kernel = kernel;
    this.document = cloneValue(document);
    this.revision = 0;
    this.headRoot = null;
    this.sequence = 0;
    this.genesis = null;
    this.members = new Map([[localMember.memberId, { ...localMember }]]);
    this.localMemberId = localMember.memberId;
    this.history = [];
    this.snapshots = new Map([[0, cloneValue(document)]]);
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  localMember() {
    return this.members.get(this.localMemberId);
  }

  addMember(member) {
    if (!member?.memberId || !member?.publicKeyJwk
        || !member?.profileRecord?.root || !member?.delegationRecord?.root) {
      throw new Error("document room member is incomplete");
    }
    if (this.genesis) {
      const admitted = this.genesis.record.body.members.find((value) => value.member_id === member.memberId);
      if (!admitted || !sameJwk(admitted.public_key_jwk, member.publicKeyJwk)) {
        throw new Error("document room membership is fixed for the current epoch");
      }
    }
    this.members.set(member.memberId, { ...member });
    this.emit("member", { member: memberProjection(member) });
    return this.members.get(member.memberId);
  }

  member(memberId) {
    const member = this.members.get(memberId);
    if (!member) throw new Error(`unknown document room member: ${memberId}`);
    return member;
  }

  async issueGenesis() {
    if (this.role !== "sequencer") throw new Error("only the sequencer may issue room genesis");
    if (this.members.size < 2) throw new Error("document room genesis waits for the invited peer");
    const genesis = await createDocumentRoomGenesis({
      roomId: this.roomId,
      documentId: this.document.id,
      initialAst: this.snapshots.get(0),
      sequencerKey: this.documentKey,
      members: [...this.members.values()].map(memberProjection),
      epoch: 1
    });
    this.genesis = genesis;
    this.emit("genesis", { genesis });
    return genesis;
  }

  async acceptGenesis(genesis) {
    const verified = await verifyDocumentRoomGenesis(genesis.record, {
      roomId: this.roomId,
      documentId: this.document.id
    });
    const localProjection = verified.body.members.find((value) => value.member_id === this.localMemberId);
    if (!localProjection || !sameJwk(localProjection.public_key_jwk, this.localMember().publicKeyJwk)) {
      throw new Error("local document key is not a member of this signed room epoch");
    }
    this.genesis = genesis;
    this.document = cloneValue(verified.body.initial_ast);
    this.revision = 0;
    this.headRoot = null;
    this.sequence = 0;
    this.history = [];
    this.snapshots = new Map([[0, cloneValue(this.document)]]);
    for (const projection of verified.body.members) {
      const existing = this.members.get(projection.member_id);
      this.members.set(projection.member_id, {
        memberId: projection.member_id,
        label: projection.label,
        role: projection.role,
        publicKeyJwk: projection.public_key_jwk,
        profileRecord: existing?.profileRecord || { root: projection.profile_root },
        delegationRecord: existing?.delegationRecord || { root: projection.delegation_root }
      });
    }
    this.emit("genesis", { genesis, verified });
    return verified;
  }

  async createBatch(operations, {
    baseRevision = this.revision,
    baseDocument = this.snapshots.get(baseRevision)
  } = {}) {
    if (!this.genesis) throw new Error("document room is not active yet");
    if (!baseDocument) throw new Error(`document room has no snapshot for revision ${baseRevision}`);
    const member = this.localMember();
    const signedOperations = operations.map((operation) => ({ ...operation, baseRevision }));
    const projected = {
      id: `batch:${crypto.randomUUID()}`,
      documentId: this.document.id,
      baseRevision,
      operations: signedOperations.map(canonicalOperation)
    };
    const expectedResultAst = applyBatch(
      baseDocument,
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
      outcome = "conflict";
      conflict = conflictFrom(error);
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
      throw new Error("document room commit epoch mismatch");
    }
    if (Number(commit.sequence) !== this.sequence + 1) {
      throw new Error("document room commit sequence is not contiguous");
    }
    const member = this.member(commit.authorMemberId);
    const verified = await verifyRoomCommitBundle(commit, {
      contributorPublicKey: member.publicKeyJwk,
      contributorProfileRecord: member.profileRecord,
      contributorDelegationRecord: member.delegationRecord,
      sequencerPublicKey: this.genesis.record.body.sequencer_key,
      expectedDocument: this.document,
      expectedRevision: this.revision,
      expectedRevisionRoot: this.headRoot
    });
    const replayed = commit.outcome === "accepted"
      ? applyBatch(this.document, {
        id: commit.batch.batchId,
        documentId: this.document.id,
        baseRevision: commit.batch.baseRevision,
        operations: commit.transformedOperations
      }, sourceRootOptions(await sourceRootIndex(this.document)))
      : cloneValue(this.document);
    const replayedPlan = await documentValuePlan(replayed);
    if (!sameRoot(replayedPlan, verified.resultAstPlan)) {
      throw new Error("document room replay result does not match the signed transformation");
    }

    if (commit.outcome === "accepted") {
      const sequencerPublicKey = await crypto.subtle.importKey(
        "jwk",
        this.genesis.record.body.sequencer_key,
        { name: "Ed25519" },
        true,
        ["verify"]
      );
      const recreatedRevision = await createRoomRevisionBundle({
        documentId: this.document.id,
        revision: this.revision + 1,
        previousRevisionRoot: this.headRoot,
        previousAst: this.document,
        batchRecord: commit.batch.record,
        transformationRecord: commit.transformation.record,
        transformedOperations: commit.transformedOperations,
        resultAst: replayed,
        authorProfileRecord: member.profileRecord,
        environmentKeyRoot: await keyRootPlan({ publicKey: sequencerPublicKey })
      });
      if (!commit.revision || !sameRoot(commit.revision, recreatedRevision)) {
        throw new Error("document room revision root mismatch");
      }
      this.document = replayed;
      this.revision += 1;
      this.headRoot = commit.revision.root;
      this.snapshots.set(this.revision, cloneValue(this.document));
    } else if (commit.outcome === "conflict") {
      if (commit.revision) throw new Error("conflicted document room commit must not contain a revision");
    } else {
      throw new Error("document room commit outcome is invalid");
    }

    const receiptBody = commit.receipt.record.body;
    if (commit.outcome === "accepted" && !sameRoot(receiptBody.result_revision_root, commit.revision)) {
      throw new Error("document room receipt revision mismatch");
    }
    if (commit.outcome === "conflict" && receiptBody.result_revision_root != null) {
      throw new Error("conflict receipt must not reference a revision");
    }

    const historyEntry = {
      sequence: commit.sequence,
      revision: this.revision,
      revisionRoot: this.headRoot,
      outcome: commit.outcome,
      authorMemberId: commit.authorMemberId,
      batchRoot: commit.batch.record.root,
      transformationRoot: commit.transformation.record.root,
      receiptRoot: commit.receipt.record.root,
      transformedOperations: cloneValue(commit.transformedOperations),
      conflict: commit.conflict || null,
      commit
    };
    this.sequence = Number(commit.sequence);
    this.history.push(historyEntry);
    this.emit("commit", { commit, historyEntry, document: cloneValue(this.document) });
    return historyEntry;
  }

  snapshot() {
    return Object.freeze({
      roomId: this.roomId,
      document: cloneValue(this.document),
      revision: this.revision,
      headRoot: this.headRoot,
      sequence: this.sequence,
      genesis: this.genesis,
      history: cloneValue(this.history)
    });
  }

  async evaluateArtefact(source) {
    return this.kernel.evaluate(source);
  }
}
