import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentOperationPlan } from "../src/document-records.js";

test("different edits have different independently addressable operation roots", async () => {
  const left = await createDocumentOperationPlan("document:one", {
    id: "operation:left",
    type: "text.splice",
    targetId: "text:one",
    offset: 0,
    deleteCount: 0,
    insert: "A"
  });
  const right = await createDocumentOperationPlan("document:one", {
    id: "operation:right",
    type: "text.splice",
    targetId: "text:one",
    offset: 0,
    deleteCount: 0,
    insert: "B"
  });
  assert.notEqual(left.root, right.root);
});
