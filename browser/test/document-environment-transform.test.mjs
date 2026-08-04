import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const records = () => readFile(new URL("../src/document-records.js", import.meta.url), "utf8");

test("transformation record binds current head, transformed operations, result and conflict", async () => {
  const source = await records();
  assert.match(source, /previous_revision_root/);
  assert.match(source, /previous_ast_root/);
  assert.match(source, /transformed_operations_root/);
  assert.match(source, /result_ast_root/);
  assert.match(source, /conflict_root/);
  assert.match(source, /signDocumentRecordWithSigner/);
});
