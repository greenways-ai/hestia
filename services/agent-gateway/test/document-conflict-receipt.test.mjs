import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = () => readFile(
  new URL("../../../migrations/20260804050000_document_ot_ledger.sql", import.meta.url),
  "utf8"
);

test("conflicts are signed without creating or advancing a revision", async () => {
  const sql = await migration();
  assert.match(sql, /outcome text NOT NULL CHECK \(outcome IN \('accepted', 'conflict'\)\)/);
  assert.match(sql, /v_result_ast_root <> v_current_ast_root/);
  assert.match(sql, /conflicted transformation must preserve the current AST root/);
  assert.match(sql, /IF v_row\.outcome = 'accepted' THEN/);
  assert.match(sql, /status = v_row\.outcome/);
});
