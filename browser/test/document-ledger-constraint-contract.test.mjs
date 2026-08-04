import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = () => readFile(
  new URL("../../migrations/20260804051000_document_ot_ledger_constraints.sql", import.meta.url),
  "utf8"
);

test("admissions retain immutable foreign-key bindings to verified records", async () => {
  const sql = await source();
  assert.match(sql, /document_batch_admission_batch_verification_fk/);
  assert.match(sql, /document_batch_admission_transformation_verification_fk/);
  assert.match(sql, /REFERENCES hestia\.document_record_verification\(signed_record_root\)/);
  assert.match(sql, /verified document records are immutable/);
  assert.match(sql, /invalid document verification state transition/);
});
