import {
  admitBatch,
  applyBatch,
  walkDocument
} from "../../../protocol/document-ot.js";
import {
  documentReferenceVectorPlan,
  documentRootHex,
  documentValuePlan
} from "../../../browser/src/document-hcv1.js";
import {
  createDocumentOperationPlan,
  createDocumentTransformationBundle
} from "../../../browser/src/document-records.js";

export const DOCUMENT_HTTP_PROTOCOL = "hestia-document-http/1";
export const DOCUMENT_HCP1_MAX_CELLS = 512;

function required(value, name) {
  if (value === undefined || value === null || value === "") throw new Error(`${name} is required`);
  return value;
}

function root(value, name) {
  return documentRootHex(value, name);
}

function packCellCount(pack) {
  const match = /^HCP1:(0|[1-9][0-9]*):/.exec(String(pack || ""));
  if (!match) throw new Error("document record has an invalid HCP1 pack");
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count)
      || count < 1
      || count > DOCUMENT_HCP1_MAX_CELLS) {
    throw new Error("document record cell count is outside the Hestia admission bound");
  }
  return count;
}

function canonicalOperation(operation, fallbackBaseRevision = null) {
  const next = { ...operation };
  for (const field of ["sourceRoot", "resultRoot", "expectedRoot"]) {
    if (next[field] && typeof next[field] === "object") next[field] = next[field].root;
  }
  if (next.baseRevision == null && fallbackBaseRevision != null) {
    next.baseRevision = Number(fallbackBaseRevision);
  }
  return next;
}

async function artefactSourceRoots(document) {
  const entries = [];
  walkDocument(document, (node) => {
    if (node.type !== "hara-artefact") return;
    const source = (node.children || []).find((child) => child.type === "text");
    if (source) entries.push([node.attrs?.artefactId, source.id, source.text]);
  });
  const roots = new Map();
  for (const [artefactId, sourceId, text] of entries) {
    const plan = await documentValuePlan(text);
    roots.set(`${artefactId}:${sourceId}`, plan.root);
  }
  return roots;
}

function sourceRootResolver(roots) {
  return (artefact) => {
    const sourceNode = (artefact.children || []).find((child) => child.type === "text");
    return roots.get(`${artefact.attrs?.artefactId}:${sourceNode?.id}`) || null;
  };
}

async function canonicalProjection(bundle) {
  const baseRevision = Number(bundle.baseRevision);
  const operations = (bundle.operations || []).map((operation) =>
    canonicalOperation(operation, baseRevision));
  const [baseAstPlan, expectedResultPlan, operationPlans] = await Promise.all([
    documentValuePlan(bundle.baseAst),
    documentValuePlan(bundle.expectedResultAst),
    Promise.all(operations.map((operation) =>
      createDocumentOperationPlan(bundle.documentId, operation, baseRevision)))
  ]);
  const operationVector = await documentReferenceVectorPlan(operationPlans);
  const body = bundle.record?.body || {};
  const checks = [
    [body.document_id, bundle.documentId, "document id"],
    [Number(body.base_revision), baseRevision, "base revision"],
    [root(body.base_ast_root, "signed base AST"), root(baseAstPlan, "base AST"), "base AST root"],
    [root(body.operations_root, "signed operation vector"), root(operationVector, "operation vector"), "operation vector root"],
    [root(body.expected_result_root, "signed expected result"), root(expectedResultPlan, "expected result"), "expected result root"]
  ];
  for (const [actual, expected, name] of checks) {
    if (actual !== expected) throw new Error(`document batch ${name} does not match its signed HCV1 record`);
  }

  const baseSourceRoots = await artefactSourceRoots(bundle.baseAst);
  const replayed = applyBatch(
    bundle.baseAst,
    { id: bundle.batchId, documentId: bundle.documentId, baseRevision, operations },
    { sourceRoot: sourceRootResolver(baseSourceRoots) }
  );
  const replayedPlan = await documentValuePlan(replayed);
  if (root(replayedPlan, "replayed local result") !== root(expectedResultPlan, "expected local result")) {
    throw new Error("document batch expected result does not match replay of its signed operations");
  }

  return {
    operations,
    baseAstPlan,
    expectedResultPlan,
    replayedPlan,
    operationPlans,
    operationVector
  };
}

async function verifiedAcceptedOperations(entries, documentId) {
  const operations = [];
  for (const entry of entries || []) {
    if (!entry?.root || !entry?.operation) {
      throw new Error("Hara ledger returned an incomplete accepted operation projection");
    }
    const operation = canonicalOperation(entry.operation);
    if (!Number.isSafeInteger(Number(operation.baseRevision)) || Number(operation.baseRevision) < 0) {
      throw new Error("accepted operation projection is missing its signed base revision");
    }
    const plan = await createDocumentOperationPlan(
      documentId,
      operation,
      Number(operation.baseRevision)
    );
    if (root(plan, "accepted operation") !== root(entry.root, "stored accepted operation")) {
      throw new Error("accepted operation projection does not match its Hara ledger root");
    }
    operations.push(operation);
  }
  return operations;
}

function signPrepared(signer, prepared) {
  if (!prepared?.receiptSigningPayload?.length) {
    throw new Error("Hara ledger did not return document receipt signing bytes");
  }
  const signature = Buffer.from(signer.sign(prepared.receiptSigningPayload));
  if (signature.length !== 64 || !signer.verify(prepared.receiptSigningPayload, signature)) {
    throw new Error("Hestia environment document signature failed local verification");
  }
  return signature;
}

async function verifyThroughLedger(transaction, environmentId, record, signer) {
  const prepared = await transaction.prepareDocumentRecordVerification({
    environmentId,
    packBytes: Buffer.from(record.hcp1_pack, "utf8"),
    cellCount: packCellCount(record.hcp1_pack),
    recordRootHex: root(record, "document record"),
    recordKind: record.type
  });
  const signature = signPrepared(signer, prepared);
  const signedReceiptRootHex = await transaction.commitDocumentRecordVerification({
    environmentId,
    recordRootHex: root(record, "document record"),
    signature
  });
  return Object.freeze({ ...prepared, signedReceiptRootHex });
}

function publicResult(prepared, committed, transformation) {
  return Object.freeze({
    ok: true,
    protocol: DOCUMENT_HTTP_PROTOCOL,
    document_id: prepared.documentId,
    outcome: prepared.outcome,
    sequence: String(prepared.sequence),
    revision: prepared.revision == null ? null : String(prepared.revision),
    revision_root: prepared.revisionRootHex ? `sha256:${prepared.revisionRootHex}` : null,
    result_ast_root: prepared.resultAstRootHex ? `sha256:${prepared.resultAstRootHex}` : null,
    receipt_root: `sha256:${prepared.receiptRootHex}`,
    signed_receipt_root: `sha256:${committed.signedReceiptRootHex}`,
    transformation_root: transformation.record.root,
    environment_signature: committed.signature.toString("base64url"),
    conflict: prepared.conflict || null
  });
}

/**
 * Coordinates the document collaboration boundary. The browser may project
 * optimistic edits, but Hestia alone reads the current head, transforms the
 * signed batch, creates the environment transformation record, asks PostgreSQL
 * to construct the canonical receipt, signs only those exact bytes, and commits
 * the revision and receipt atomically.
 */
export function createDocumentLedgerService({
  database,
  signer,
  environmentId = process.env.HESTIA_ENVIRONMENT_ID ?? "hestia-local"
}) {
  if (!database?.documentTransaction) {
    throw new Error("document ledger service requires a Hara ledger database adapter");
  }
  if (!signer?.sign || !signer?.verify || signer.publicKeyBytes?.length !== 32) {
    throw new Error("document ledger service requires the Ed25519 environment signer");
  }

  return Object.freeze({
    async admit(input) {
      const bundle = required(input?.batch, "signed document batch");
      required(bundle.record?.root, "signed document batch record");
      if (bundle.record.type !== "document/batch") throw new Error("expected a signed document/batch record");
      const projection = await canonicalProjection(bundle);

      return database.documentTransaction(async (transaction) => {
        const verifiedBatch = await verifyThroughLedger(
          transaction,
          environmentId,
          bundle.record,
          signer
        );
        const head = await transaction.documentHead(bundle.documentId);
        const currentDocument = head?.ast ?? bundle.baseAst;
        const currentRevision = Number(head?.revision ?? 0);
        const currentRevisionRoot = head?.revisionRoot ?? null;
        const acceptedEntries = await transaction.documentOperationsAfter({
          documentId: bundle.documentId,
          revision: Number(bundle.baseRevision)
        });
        const acceptedOperations = await verifiedAcceptedOperations(
          acceptedEntries,
          bundle.documentId
        );
        const sourceRoots = await artefactSourceRoots(currentDocument);
        const batch = {
          id: bundle.batchId || bundle.record.body.batch_id,
          documentId: bundle.documentId,
          baseRevision: Number(bundle.baseRevision),
          operations: projection.operations
        };
        const admission = admitBatch(currentDocument, batch, acceptedOperations, {
          sourceRoot: sourceRootResolver(sourceRoots)
        });
        const transformedOperations = admission.accepted
          ? admission.batch.operations
            .filter((operation) => operation.type !== "operation.noop")
            .map((operation) => canonicalOperation(operation, bundle.baseRevision))
          : [];
        const transformation = await createDocumentTransformationBundle({
          documentId: bundle.documentId,
          batchRecord: bundle.record,
          baseRevision: Number(bundle.baseRevision),
          previousRevisionRoot: currentRevisionRoot,
          previousAst: currentDocument,
          transformedOperations,
          resultAst: admission.result,
          outcome: admission.accepted ? "accepted" : "conflict",
          conflict: admission.accepted ? null : admission.receipt.conflict,
          environmentSigner: {
            publicKeyBytes: new Uint8Array(signer.publicKeyBytes),
            sign(payload) {
              return signer.sign(payload);
            }
          }
        });
        const verifiedTransformation = await verifyThroughLedger(
          transaction,
          environmentId,
          transformation.record,
          signer
        );
        const prepared = await transaction.prepareDocumentRevision({
          environmentId,
          documentId: bundle.documentId,
          batchRecordRootHex: root(bundle.record, "batch record"),
          transformationRecordRootHex: root(transformation.record, "transformation record"),
          verifiedBatch,
          verifiedTransformation,
          expectedCurrentRevision: currentRevision,
          expectedCurrentRevisionRootHex: currentRevisionRoot ? root(currentRevisionRoot, "current revision") : null,
          expectedCurrentAstRootHex: root(await documentValuePlan(currentDocument), "current AST"),
          transformedOperations,
          resultAst: admission.result,
          outcome: admission.accepted ? "accepted" : "conflict",
          conflict: admission.accepted ? null : admission.receipt.conflict
        });
        const signature = signPrepared(signer, prepared);
        const signedReceiptRootHex = await transaction.commitDocumentRevision({
          environmentId,
          batchRecordRootHex: root(bundle.record, "batch record"),
          transformationRecordRootHex: root(transformation.record, "transformation record"),
          signature
        });
        return publicResult(prepared, {
          signedReceiptRootHex,
          signature
        }, transformation);
      });
    }
  });
}
