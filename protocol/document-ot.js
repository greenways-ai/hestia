export class DocumentConflictError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DocumentConflictError";
    this.code = code;
    this.details = details;
  }
}

export function cloneValue(value) {
  return globalThis.structuredClone
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function scalarLength(value) {
  return [...String(value)].length;
}

function compareIds(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function walkDocument(document, visitor) {
  function visit(node, parent = null, index = -1) {
    visitor(node, parent, index);
    for (const [childIndex, child] of (node.children || []).entries()) visit(child, node, childIndex);
  }
  visit(document, null, -1);
}

export function findNode(document, id) {
  let found = null;
  walkDocument(document, (node, parent, index) => {
    if (!found && node.id === id) found = { node, parent, index };
  });
  return found;
}

export function findArtefact(document, artefactId) {
  let found = null;
  walkDocument(document, (node, parent, index) => {
    if (!found && node.type === "hara-artefact" && node.attrs?.artefactId === artefactId) {
      found = { node, parent, index };
    }
  });
  return found;
}

function normalizeOperation(operation) {
  return {
    protocol: "gwdp/1",
    ...operation,
    transformedFrom: operation.transformedFrom || operation.id || null
  };
}

function noOp(operation, reason) {
  return { ...normalizeOperation(operation), type: "operation.noop", noopReason: reason };
}

function mapPosition(position, accepted, association = 1) {
  const start = accepted.offset;
  const deleted = accepted.deleteCount || 0;
  const inserted = scalarLength(accepted.insert || "");
  const end = start + deleted;

  if (deleted === 0) {
    return position > start || (position === start && association > 0)
      ? position + inserted
      : position;
  }
  if (position < start || (position === start && association < 0)) return position;
  if (position > end || (position === end && association > 0)) return position + inserted - deleted;
  return start + (association > 0 ? inserted : 0);
}

export function transformTextSplice(incoming, accepted) {
  if (incoming.targetId !== accepted.targetId) return normalizeOperation(incoming);

  const acceptedStart = accepted.offset;
  const acceptedEnd = accepted.offset + (accepted.deleteCount || 0);
  const incomingStart = incoming.offset;
  const incomingEnd = incoming.offset + (incoming.deleteCount || 0);
  const incomingInsert = scalarLength(incoming.insert || "");

  if ((accepted.deleteCount || 0) > 0 && incomingInsert > 0 && incoming.deleteCount === 0 && incomingStart > acceptedStart && incomingStart < acceptedEnd) {
    throw new DocumentConflictError(
      "text.insert-inside-deleted-range",
      "Insertion falls inside text removed by an accepted operation",
      { incoming, accepted }
    );
  }

  if ((accepted.deleteCount || 0) === 0 && incoming.deleteCount === 0 && incomingStart === acceptedStart) {
    const acceptedFirst = accepted.environmentSequence != null
      ? true
      : compareIds(accepted.id, incoming.id) <= 0;
    return {
      ...normalizeOperation(incoming),
      offset: incomingStart + (acceptedFirst ? scalarLength(accepted.insert || "") : 0)
    };
  }

  const start = mapPosition(incomingStart, accepted, 1);
  const end = mapPosition(incomingEnd, accepted, 1);
  const transformed = {
    ...normalizeOperation(incoming),
    offset: Math.min(start, end),
    deleteCount: Math.max(0, end - start)
  };
  if (transformed.deleteCount === 0 && !transformed.insert) return noOp(transformed, "overlapping deletion already accepted");
  return transformed;
}

function targetsDeletedNode(operation, deletedId) {
  return operation.targetId === deletedId
    || operation.parentId === deletedId
    || operation.artefactNodeId === deletedId;
}

function transformNodeInsert(incoming, accepted) {
  if (accepted.type === "node.delete" && incoming.parentId === accepted.targetId) {
    throw new DocumentConflictError("node.parent-deleted", "Insert parent was deleted", { incoming, accepted });
  }
  if (accepted.type !== "node.insert" || incoming.parentId !== accepted.parentId) return normalizeOperation(incoming);
  const sameGap = incoming.beforeId === accepted.beforeId && incoming.afterId === accepted.afterId;
  if (!sameGap) return normalizeOperation(incoming);
  return {
    ...normalizeOperation(incoming),
    beforeId: accepted.beforeId || null,
    afterId: accepted.node?.id || accepted.targetId || incoming.afterId || null
  };
}

function transformNodeDelete(incoming, accepted) {
  if (accepted.type === "node.delete" && incoming.targetId === accepted.targetId) {
    return noOp(incoming, "target already deleted");
  }
  if (accepted.type === "node.delete" && targetsDeletedNode(incoming, accepted.targetId)) {
    throw new DocumentConflictError("node.target-deleted", "Operation targets a deleted node", { incoming, accepted });
  }
  return normalizeOperation(incoming);
}

function transformNodeAttrs(incoming, accepted) {
  if (accepted.type === "node.delete" && incoming.targetId === accepted.targetId) {
    throw new DocumentConflictError("node.target-deleted", "Attribute target was deleted", { incoming, accepted });
  }
  if (accepted.type !== "node.set-attrs" || incoming.targetId !== accepted.targetId) return normalizeOperation(incoming);
  if (sameValue(incoming.attrs, accepted.attrs)) return noOp(incoming, "identical attributes already accepted");
  throw new DocumentConflictError("node.attrs-conflict", "Concurrent attribute replacements are incompatible", { incoming, accepted });
}

function transformArtefactCommit(incoming, accepted) {
  if (accepted.type === "node.delete" && (incoming.artefactNodeId === accepted.targetId || incoming.targetId === accepted.targetId)) {
    throw new DocumentConflictError("artefact.deleted", "Artefact was deleted before its result could be committed", { incoming, accepted });
  }
  if (accepted.type === "text.splice" && incoming.sourceTextId && accepted.targetId === incoming.sourceTextId) {
    throw new DocumentConflictError("artefact.source-changed", "Artefact source changed after the commit base revision", { incoming, accepted });
  }
  if (accepted.type !== "artefact.commit" || incoming.artefactId !== accepted.artefactId) return normalizeOperation(incoming);
  if (incoming.sourceRoot === accepted.sourceRoot && incoming.resultRoot === accepted.resultRoot) {
    return noOp(incoming, "identical artefact result already committed");
  }
  throw new DocumentConflictError("artefact.result-conflict", "The same artefact source produced competing committed results", { incoming, accepted });
}

export function transformOperation(incoming, accepted) {
  if (!accepted || accepted.type === "operation.noop") return normalizeOperation(incoming);
  if (incoming.type === "operation.noop") return incoming;
  if (incoming.type === "text.splice" && accepted.type === "text.splice") return transformTextSplice(incoming, accepted);
  if (incoming.type === "node.insert") return transformNodeInsert(incoming, accepted);
  if (incoming.type === "node.delete") return transformNodeDelete(incoming, accepted);
  if (incoming.type === "node.set-attrs") return transformNodeAttrs(incoming, accepted);
  if (incoming.type === "artefact.commit") return transformArtefactCommit(incoming, accepted);
  if (accepted.type === "node.delete" && targetsDeletedNode(incoming, accepted.targetId)) {
    throw new DocumentConflictError("node.target-deleted", "Operation targets a deleted node", { incoming, accepted });
  }
  return normalizeOperation(incoming);
}

export function transformBatch(batch, acceptedOperations = []) {
  const transformed = [];
  for (const original of batch.operations || []) {
    let operation = normalizeOperation(original);
    for (const accepted of acceptedOperations) operation = transformOperation(operation, accepted);
    for (const earlier of transformed) operation = transformOperation(operation, earlier);
    transformed.push(operation);
  }
  return { ...cloneValue(batch), operations: transformed };
}

function resolveInsertIndex(parent, operation) {
  const children = parent.children || (parent.children = []);
  if (operation.beforeId) {
    const index = children.findIndex((child) => child.id === operation.beforeId);
    if (index >= 0) return index;
  }
  if (operation.afterId) {
    const index = children.findIndex((child) => child.id === operation.afterId);
    if (index >= 0) return index + 1;
  }
  if (operation.beforeId || operation.afterId) {
    throw new DocumentConflictError("node.anchor-missing", "Insert anchors no longer identify an unambiguous gap", { operation });
  }
  return children.length;
}

export function applyOperation(document, operation, options = {}) {
  if (operation.type === "operation.noop") return cloneValue(document);
  const next = cloneValue(document);

  if (operation.type === "text.splice") {
    const target = findNode(next, operation.targetId)?.node;
    if (!target || target.type !== "text") throw new DocumentConflictError("text.target-missing", "Text target is missing", { operation });
    const characters = [...target.text];
    if (operation.offset < 0 || operation.offset > characters.length || operation.deleteCount < 0 || operation.offset + operation.deleteCount > characters.length) {
      throw new DocumentConflictError("text.range-invalid", "Text splice is outside the current scalar range", { operation, length: characters.length });
    }
    characters.splice(operation.offset, operation.deleteCount, ...[...String(operation.insert || "")]);
    target.text = characters.join("");
  } else if (operation.type === "node.insert") {
    const parent = operation.parentId === next.id ? next : findNode(next, operation.parentId)?.node;
    if (!parent) throw new DocumentConflictError("node.parent-missing", "Insert parent is missing", { operation });
    if (findNode(next, operation.node?.id)) throw new DocumentConflictError("node.id-collision", "Inserted node id already exists", { operation });
    const index = resolveInsertIndex(parent, operation);
    parent.children.splice(index, 0, cloneValue(operation.node));
  } else if (operation.type === "node.delete") {
    const found = findNode(next, operation.targetId);
    if (!found?.parent?.children) throw new DocumentConflictError("node.target-missing", "Delete target is missing", { operation });
    found.parent.children.splice(found.index, 1);
  } else if (operation.type === "node.set-attrs") {
    const target = findNode(next, operation.targetId)?.node;
    if (!target) throw new DocumentConflictError("node.target-missing", "Attribute target is missing", { operation });
    if (operation.expectedAttrs && !sameValue(target.attrs || {}, operation.expectedAttrs)) {
      throw new DocumentConflictError("node.attrs-precondition", "Node attributes do not match the operation precondition", { operation, actual: target.attrs || {} });
    }
    target.attrs = cloneValue(operation.attrs || {});
  } else if (operation.type === "artefact.commit") {
    const artefact = findArtefact(next, operation.artefactId)?.node;
    if (!artefact) throw new DocumentConflictError("artefact.missing", "Hara artefact is missing", { operation });
    const sourceText = (artefact.children || []).find((child) => child.type === "text");
    if (operation.sourceTextId && sourceText?.id !== operation.sourceTextId) {
      throw new DocumentConflictError("artefact.source-mismatch", "Artefact source text id does not match", { operation, actual: sourceText?.id });
    }
    if (options.sourceRoot) {
      const actualRoot = options.sourceRoot(artefact, sourceText?.text || "");
      if (actualRoot !== operation.sourceRoot) {
        throw new DocumentConflictError("artefact.source-root", "Artefact source root changed", { operation, actualRoot });
      }
    }
    artefact.attrs = {
      ...(artefact.attrs || {}),
      mode: "snapshot",
      snapshotSourceRoot: operation.sourceRoot,
      snapshotRoot: operation.resultRoot,
      snapshotDisplay: operation.display || null,
      snapshotMediaType: operation.mediaType || "application/vnd.hara.value+json"
    };
  } else {
    throw new DocumentConflictError("operation.unsupported", `Unsupported document operation: ${operation.type}`, { operation });
  }

  next.revision = Math.max(next.revision || 0, operation.environmentSequence || operation.baseRevision || 0) + 1;
  return next;
}

export function applyBatch(document, batch, options = {}) {
  let current = cloneValue(document);
  for (const operation of batch.operations || []) current = applyOperation(current, operation, options);
  return current;
}

export function admitBatch(document, batch, acceptedOperations = [], options = {}) {
  try {
    const transformedBatch = transformBatch(batch, acceptedOperations);
    const result = applyBatch(document, transformedBatch, options);
    return {
      accepted: true,
      batch: transformedBatch,
      result,
      receipt: {
        type: "document.import-receipt",
        outcome: "accepted",
        documentId: document.id,
        baseRevision: batch.baseRevision,
        resultRevision: result.revision,
        operations: transformedBatch.operations.map((operation) => ({
          originalRoot: operation.originalRoot || null,
          transformedOperation: operation,
          disposition: operation.type === "operation.noop" ? "noop" : "applied"
        }))
      }
    };
  } catch (error) {
    if (!(error instanceof DocumentConflictError)) throw error;
    return {
      accepted: false,
      batch: null,
      result: document,
      receipt: {
        type: "document.import-receipt",
        outcome: "conflict",
        documentId: document.id,
        baseRevision: batch.baseRevision,
        conflict: { code: error.code, message: error.message, details: error.details }
      }
    };
  }
}
