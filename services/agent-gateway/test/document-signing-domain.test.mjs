import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = () => readFile(
  new URL("../../../migrations/20260804050000_document_ot_ledger.sql", import.meta.url),
  "utf8"
);

test("document records cannot be substituted into the agent-room signing domain", async () => {
  const sql = await migration();
  assert.match(sql, /R:greenways-document\/1:document\/signed-record/);
  assert.match(sql, /hestia\.document_signing_payload\(p_kind, body_root\)/);
  assert.match(sql, /invalid GWDP1 document signature/);
  assert.doesNotMatch(sql, /convert_to\('GWAR1:' \|\| p_kind/);
});
