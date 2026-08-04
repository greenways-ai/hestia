import assert from "node:assert/strict";
import { DOCUMENT_RECORD_SCHEMAS } from "../src/document-hcv1.js";
import test from "node:test";

test("revision binds both contributor and environment evidence", () => {
  assert.deepEqual(
    DOCUMENT_RECORD_SCHEMAS["document/revision"].map(([role]) => role),
    [
      "document-id",
      "revision",
      "previous-revision",
      "previous-ast",
      "batch",
      "transformation",
      "transformed-operations",
      "result-ast",
      "author-profile",
      "environment-key"
    ]
  );
});
