import {
  documentReferenceVectorPlan,
  documentValuePlan,
  encodeDocumentRecordBody,
  mergeDocumentCells,
  signDocumentRecord,
  signDocumentRecordWithSigner
} from "./document-hcv1.js";

const OPERATION_KINDS = Object.freeze({
  "text.splice": "document/text-splice",
  "node.insert": "document/node-insert",
  "node.delete": "document/node-delete",
  "node.set-attrs": "document/node-set-attrs",
  "artefact.commit": "document/artefact-commit"
});

function requiredString(value, name) {
  const text = String(value ?? "");
  if (!text || text.length > 512) throw new Error(`${name} is required and must be at most 512 characters`);
  return text;
}

function revision(value, name = "document revision") {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${name} must be a non-negative safe integer`);
  return number;
}

function reference(plan) {
  return plan ? { root: plan.root, hcv1_cells: plan.hcv1_cells } : null;
}

async function operationBody(documentId, operation, baseRevision) {
  const operationId = requiredString(operation.id, "operation id");
  const common = {
    operation_id: operationId,
    document_id: requiredString(documentId, "document id"),
    base_revision: revision(operation.baseRevision ?? baseRevision, "operation base revision")
  };

  if (operation.type === "text.splice") {
    const offset = Number(operation.offset);
    const deleteCount = Number(operation.deleteCount ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0
        || !Number.isSafeInteger(deleteCount) || deleteCount < 0) {
      throw new Error("text splice range must use non-negative safe integers");
    }
    return {
      kind: OPERATION_KINDS[operation.type],
      body: {
        ...common,
        target_id: requiredString(operation.targetId, "text target id"),
        offset,
        delete_count: deleteCount,
        insert: String(operation.insert ?? "")
      }
    };
  }

  if (operation.type === "node.insert") {
    const nodePlan = await documentValuePlan(operation.node);
    return {
      kind: OPERATION_KINDS[operation.type],
      body: {
        ...common,
        parent_id: requiredString(operation.parentId, "insert parent id"),
        before_id: operation.beforeId ?? null,
        after_id: operation.afterId ?? null,
        node_root: reference(nodePlan)
      },
      plans: [nodePlan]
    };
  }

  if (operation.type === "node.delete") {
    return {
      kind: OPERATION_KINDS[operation.type],
      body: {
        ...common,
        target_id: requiredString(operation.targetId, "delete target id"),
        expected_root: operation.expectedRoot ?? null
      }
    };
  }

  if (operation.type === "node.set-attrs") {
    const [expectedPlan, attrsPlan] = await Promise.all([
      documentValuePlan(operation.expectedAttrs ?? {}),
      documentValuePlan(operation.attrs ?? {})
    ]);
    return {
      kind: OPERATION_KINDS[operation.type],
      body: {
        ...common,
        target_id: requiredString(operation.targetId, "attribute target id"),
        expected_attrs_root: reference(expectedPlan),
        attrs_root: reference(attrsPlan)
      },
      plans: [expectedPlan, attrsPlan]
    };
  }

  if (operation.type === "artefact.commit") {
    return {
      kind: OPERATION_KINDS[operation.type],
      body: {
        ...common,
        artefact_id: requiredString(operation.artefactId, "artefact id"),
        artefact_node_id: requiredString(operation.artefactNodeId, "artefact node id"),
        source_text_id: requiredString(operation.sourceTextId, "artefact source text id"),
        source_root: operation.sourceRoot,
        result_root: operation.resultRoot,
        media_type: String(operation.mediaType || "application/vnd.hara.value+json"),
        display: operation.display ?? null
      }
    };
  }

  throw new Error(`unsupported document operation: ${operation.type}`);
}

export async function createDocumentOperationPlan(documentId, operation, baseRevision = 0) {
  const definition = await operationBody(documentId, operation, baseRevision);
  const encoded = await encodeDocumentRecordBody(definition.kind, definition.body);
  const cells = mergeDocumentCells(
    encoded.cells,
    ...(definition.plans || []).map((plan) => plan.hcv1_cells)
  );
  return Object.freeze({
    kind: definition.kind,
    body: definition.body,
    operation: { ...operation },
    root: `sha256:${encoded.root}`,
    hcv1_cells: cells
  });
}

export async function createDocumentBatchBundle({
  documentId,
  batchId = crypto.randomUUID(),
  baseRevision = 0,
  baseAst,
  operations,
  expectedResultAst,
  authorProfileRecord,
  delegationRecord,
  signingKey
}) {
  const document = requiredString(documentId, "document id");
  const revisionNumber = revision(baseRevision, "batch base revision");
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 64) {
    throw new Error("a document batch must contain from one to 64 operations");
  }
  if (!authorProfileRecord?.root || !delegationRecord?.root) {
    throw new Error("document batch requires author profile and delegation roots");
  }

  const [baseAstPlan, expectedResultPlan, operationPlans] = await Promise.all([
    documentValuePlan(baseAst),
    documentValuePlan(expectedResultAst),
    Promise.all(operations.map((operation) =>
      createDocumentOperationPlan(document, operation, revisionNumber)))
  ]);
  const operationVector = await documentReferenceVectorPlan(operationPlans);
  const body = {
    batch_id: requiredString(batchId, "batch id"),
    document_id: document,
    base_revision: revisionNumber,
    base_ast_root: reference(baseAstPlan),
    operations_root: reference(operationVector),
    expected_result_root: reference(expectedResultPlan),
    author_profile_root: authorProfileRecord,
    delegation_root: delegationRecord
  };
  const record = await signDocumentRecord("document/batch", body, signingKey);
  return Object.freeze({
    record,
    documentId: document,
    batchId: body.batch_id,
    baseRevision: revisionNumber,
    baseAst,
    expectedResultAst,
    operations: operations.map((operation) => ({ ...operation })),
    operationPlans,
    baseAstPlan,
    expectedResultPlan,
    operationVector
  });
}

export async function createDocumentTransformationBundle({
  transformationId = crypto.randomUUID(),
  documentId,
  batchRecord,
  baseRevision,
  previousRevisionRoot = null,
  previousAst,
  transformedOperations,
  resultAst,
  outcome = "accepted",
  conflict = null,
  environmentSigner,
  environmentKeyId = null
}) {
  if (!batchRecord?.root) throw new Error("document transformation requires its signed batch root");
  if (!Array.isArray(transformedOperations)) throw new Error("transformed operations must be an array");
  if (outcome !== "accepted" && outcome !== "conflict") {
    throw new Error("document transformation outcome must be accepted or conflict");
  }
  const document = requiredString(documentId, "document id");
  const revisionNumber = revision(baseRevision, "transformation base revision");
  const [previousAstPlan, resultAstPlan, conflictPlan, operationPlans] = await Promise.all([
    documentValuePlan(previousAst),
    documentValuePlan(resultAst),
    documentValuePlan(conflict),
    Promise.all(transformedOperations.map((operation) =>
      createDocumentOperationPlan(document, operation, revisionNumber)))
  ]);
  const operationVector = await documentReferenceVectorPlan(operationPlans);
  const body = {
    transformation_id: requiredString(transformationId, "transformation id"),
    document_id: document,
    batch_root: batchRecord,
    base_revision: revisionNumber,
    previous_revision_root: previousRevisionRoot,
    previous_ast_root: reference(previousAstPlan),
    transformed_operations_root: reference(operationVector),
    result_ast_root: reference(resultAstPlan),
    outcome,
    conflict_root: reference(conflictPlan)
  };
  const record = await signDocumentRecordWithSigner(
    "document/transformation",
    body,
    environmentSigner,
    environmentKeyId
  );
  return Object.freeze({
    record,
    body,
    transformedOperations: transformedOperations.map((operation) => ({ ...operation })),
    resultAst,
    previousAst,
    operationPlans,
    operationVector,
    previousAstPlan,
    resultAstPlan,
    conflictPlan
  });
}

export function documentOperationRecordKind(type) {
  return OPERATION_KINDS[type] || null;
}
