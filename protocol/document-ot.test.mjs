import test from "node:test";
import assert from "node:assert/strict";
import {
  admitBatch,
  applyBatch,
  applyOperation,
  findArtefact,
  transformOperation,
  transformTextSplice
} from "./document-ot.js";

function fixture() {
  return {
    profile: "greenways.rich-text/0-alpha",
    id: "document-1",
    revision: 0,
    children: [
      {
        id: "paragraph-1",
        type: "paragraph",
        attrs: {},
        children: [{ id: "text-1", type: "text", text: "Hello world", marks: [] }]
      },
      {
        id: "artefact-node-1",
        type: "hara-artefact",
        attrs: { artefactId: "artefact-1", kind: "value", mode: "live" },
        children: [{ id: "artefact-source-1", type: "text", text: "(* 6 7)", marks: [] }]
      }
    ]
  };
}

const splice = (overrides = {}) => ({
  id: "operation-a",
  type: "text.splice",
  targetId: "text-1",
  offset: 0,
  deleteCount: 0,
  insert: "",
  ...overrides
});

test("maps a later text splice through an accepted insertion", () => {
  const incoming = splice({ id: "operation-b", offset: 6, insert: "Hara " });
  const accepted = splice({ id: "operation-a", offset: 0, insert: "Bright " });
  assert.equal(transformTextSplice(incoming, accepted).offset, 13);
});

test("orders same-position inserts after the accepted environment operation", () => {
  const accepted = splice({ id: "accepted", environmentSequence: 4, offset: 5, insert: "A" });
  const incoming = splice({ id: "incoming", offset: 5, insert: "B" });
  assert.equal(transformTextSplice(incoming, accepted).offset, 6);
});

test("collapses compatible overlapping deletes", () => {
  const accepted = splice({ offset: 3, deleteCount: 4 });
  const incoming = splice({ id: "operation-b", offset: 4, deleteCount: 2 });
  const transformed = transformTextSplice(incoming, accepted);
  assert.equal(transformed.type, "operation.noop");
});

test("rejects an insertion inside concurrently deleted text", () => {
  const accepted = splice({ offset: 3, deleteCount: 4 });
  const incoming = splice({ id: "operation-b", offset: 5, insert: "new" });
  assert.throws(() => transformTextSplice(incoming, accepted), /inside text removed/);
});

test("applies scalar-safe text changes and artefact snapshots", () => {
  let document = fixture();
  document.children[0].children[0].text = "A😀B";
  document = applyOperation(document, splice({ targetId: "text-1", offset: 2, insert: " bright " }));
  assert.equal(document.children[0].children[0].text, "A😀 bright B");

  document = applyOperation(document, {
    id: "commit-1",
    type: "artefact.commit",
    artefactId: "artefact-1",
    artefactNodeId: "artefact-node-1",
    sourceTextId: "artefact-source-1",
    sourceRoot: "source-root",
    resultRoot: "result-root",
    display: "42",
    mediaType: "application/vnd.hara.value+json"
  }, { sourceRoot: () => "source-root" });
  const artefact = findArtefact(document, "artefact-1").node;
  assert.equal(artefact.attrs.snapshotRoot, "result-root");
  assert.equal(artefact.attrs.snapshotDisplay, "42");
});

test("invalidates an artefact commit when accepted operations changed its source", () => {
  const incoming = {
    id: "commit-1",
    type: "artefact.commit",
    artefactId: "artefact-1",
    artefactNodeId: "artefact-node-1",
    sourceTextId: "artefact-source-1",
    sourceRoot: "old-source",
    resultRoot: "result-root"
  };
  const accepted = splice({ targetId: "artefact-source-1", insert: "; changed\n" });
  assert.throws(() => transformOperation(incoming, accepted), /source changed/);
});

test("admission is atomic and returns a signed-receipt-shaped conflict", () => {
  const document = fixture();
  const batch = {
    id: "batch-1",
    documentId: document.id,
    baseRevision: 0,
    operations: [
      splice({ targetId: "text-1", offset: 5, insert: "!" }),
      { id: "delete-missing", type: "node.delete", targetId: "missing-node" }
    ]
  };
  const admission = admitBatch(document, batch);
  assert.equal(admission.accepted, false);
  assert.equal(admission.result.children[0].children[0].text, "Hello world");
  assert.equal(admission.receipt.outcome, "conflict");
  assert.equal(admission.receipt.conflict.code, "node.target-missing");
});

test("rebases a batch through accepted operations and applies it", () => {
  const base = fixture();
  const acceptedOperation = splice({ id: "accepted", environmentSequence: 1, offset: 0, insert: "Bright " });
  const environment = applyOperation(base, acceptedOperation);
  const batch = {
    id: "batch-1",
    documentId: base.id,
    baseRevision: 0,
    operations: [splice({ id: "incoming", offset: 6, deleteCount: 5, insert: "Hara" })]
  };
  const admission = admitBatch(environment, batch, [acceptedOperation]);
  assert.equal(admission.accepted, true);
  assert.equal(admission.result.children[0].children[0].text, "Bright Hello Hara");
  assert.equal(admission.receipt.operations[0].disposition, "applied");
});

test("node insertions sharing an anchor are deterministically chained", () => {
  const incoming = {
    id: "insert-b",
    type: "node.insert",
    parentId: "document-1",
    beforeId: null,
    afterId: "paragraph-1",
    node: { id: "node-b", type: "paragraph", attrs: {}, children: [] }
  };
  const accepted = {
    id: "insert-a",
    type: "node.insert",
    parentId: "document-1",
    beforeId: null,
    afterId: "paragraph-1",
    node: { id: "node-a", type: "paragraph", attrs: {}, children: [] }
  };
  const transformed = transformOperation(incoming, accepted);
  assert.equal(transformed.afterId, "node-a");
});

test("can apply a complete transformed batch", () => {
  const document = fixture();
  const result = applyBatch(document, {
    operations: [
      splice({ offset: 5, insert: ", Hara" }),
      {
        id: "insert-1",
        type: "node.insert",
        parentId: "document-1",
        afterId: "paragraph-1",
        node: { id: "paragraph-2", type: "paragraph", attrs: {}, children: [{ id: "text-2", type: "text", text: "Second", marks: [] }] }
      }
    ]
  });
  assert.equal(result.children[0].children[0].text, "Hello, Hara world");
  assert.equal(result.children[1].id, "paragraph-2");
});
