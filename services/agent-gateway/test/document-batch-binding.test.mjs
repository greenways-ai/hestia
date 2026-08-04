import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const service = () => readFile(
  new URL("../src/document-ledger-service.mjs", import.meta.url),
  "utf8"
);

test("gateway reconstructs base, operation and result roots before OT", async () => {
  const source = await service();
  assert.match(source, /documentValuePlan\(bundle\.baseAst\)/);
  assert.match(source, /documentValuePlan\(bundle\.expectedResultAst\)/);
  assert.match(source, /createDocumentOperationPlan/);
  assert.match(source, /documentReferenceVectorPlan/);
  assert.match(source, /does not match its signed HCV1 record/);
});
