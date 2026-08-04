import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = () => readFile(
  new URL("../../migrations/20260804050000_document_ot_ledger.sql", import.meta.url),
  "utf8"
);

test("verification and admission return existing canonical receipts on retry", async () => {
  const sql = await migration();
  assert.match(sql, /FROM hestia\.document_record_verification[\s\S]*IF FOUND THEN/);
  assert.match(sql, /FROM hestia\.document_batch_admission[\s\S]*IF FOUND THEN/);
  assert.match(sql, /IF v_row\.status = 'verified' THEN/);
  assert.match(sql, /IF v_row\.status IN \('accepted', 'conflict'\) THEN/);
});
