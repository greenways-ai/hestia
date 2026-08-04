import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = () => readFile(
  new URL("../../../migrations/20260804050000_document_ot_ledger.sql", import.meta.url),
  "utf8"
);

test("one security-definer commit appends revision, operations, head and receipt", async () => {
  const sql = await source();
  const start = sql.indexOf("CREATE FUNCTION hestia.document_batch_commit");
  const tail = sql.slice(start);
  assert.match(tail, /INSERT INTO hestia\.document_revision/);
  assert.match(tail, /INSERT INTO hestia\.document_operation_projection/);
  assert.match(tail, /UPDATE hestia\.document_head/);
  assert.match(tail, /UPDATE hestia\.document_batch_admission/);
});
