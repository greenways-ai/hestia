import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("conflict path updates admission only, never the document head", async () => {
  const sql = await readFile(
    new URL("../../../migrations/20260804050000_document_ot_ledger.sql", import.meta.url),
    "utf8"
  );
  const commit = sql.slice(sql.indexOf("CREATE FUNCTION hestia.document_batch_commit"));
  assert.match(commit, /IF v_row\.outcome = 'accepted' THEN[\s\S]*UPDATE hestia\.document_head/);
  assert.match(commit, /UPDATE hestia\.document_batch_admission/);
});
