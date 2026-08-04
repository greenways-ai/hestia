import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = () => readFile(
  new URL("../../../migrations/20260804050000_document_ot_ledger.sql", import.meta.url),
  "utf8"
);

test("database constructs revision and import receipt roots", async () => {
  const sql = await migration();
  assert.match(sql, /v_revision_root := hestia\.document_record_put\(/);
  assert.match(sql, /'document\/revision'/);
  assert.match(sql, /v_receipt_root := hestia\.document_record_put\(/);
  assert.match(sql, /'document\/import-receipt'/);
  assert.match(sql, /receipt_signing_payload := hestia\.document_signing_payload/);
});
