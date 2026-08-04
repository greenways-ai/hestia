import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = () => readFile(
  new URL("../../../migrations/20260804050000_document_ot_ledger.sql", import.meta.url),
  "utf8"
);

test("prepare and commit both compare revision and AST roots", async () => {
  const sql = await migration();
  assert.match(sql, /p_expected_current_revision <> v_current_revision/);
  assert.match(sql, /p_expected_current_revision_root IS DISTINCT FROM v_current_revision_root/);
  assert.match(sql, /p_expected_current_ast_root <> v_current_ast_root/);
  assert.match(sql, /v_head\.current_revision <> v_row\.expected_current_revision/);
  assert.match(sql, /v_head\.current_revision_root <> v_row\.expected_current_revision_root/);
  assert.match(sql, /v_head\.current_ast_root <> v_row\.expected_current_ast_root/);
});
