import assert from "node:assert/strict";
import { DOCUMENT_RECORD_SCHEMAS } from "../src/document-hcv1.js";
import test from "node:test";

test("import receipt binds both OT and revision results", () => {
  assert.deepEqual(
    DOCUMENT_RECORD_SCHEMAS["document/import-receipt"].map(([role]) => role),
    [
      "document-id",
      "batch",
      "transformation",
      "base-revision",
      "previous-revision",
      "transformed-operations",
      "result-revision",
      "result-ast",
      "outcome",
      "sequence"
    ]
  );
});
