import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = () => readFile(
  new URL("../../../migrations/20260804050000_document_ot_ledger.sql", import.meta.url),
  "utf8"
);

test("document authority is checked before preparation and again before commit", async () => {
  const sql = await migration();
  const matches = sql.match(/agent_profile_authorized\([\s\S]*?'document\.edit'[\s\S]*?\)/g) || [];
  assert.ok(matches.length >= 2);
  assert.match(sql, /author_operational_key_root/);
  assert.match(sql, /author_delegation_root/);
  assert.match(sql, /expected_author_profile_state_root/);
});
