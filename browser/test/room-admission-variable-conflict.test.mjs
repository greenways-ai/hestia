import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../migrations/20260804035000_agent_room_admission_variable_conflict.sql",
  import.meta.url
);

test("room admission resolves only its RETURNS TABLE column conflicts", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const signature of [
    "agent_room_genesis_prepare\\(text, bytea\\)",
    "agent_room_invitation_prepare\\(text, bytea\\)",
    "agent_room_member_prepare\\(text, bytea, bytea\\)"
  ]) {
    assert.match(sql, new RegExp(`ALTER FUNCTION hestia\\.${signature}`));
  }
  assert.equal(
    [...sql.matchAll(/SET plpgsql\.variable_conflict TO 'use_column'/g)].length,
    3
  );
  assert.doesNotMatch(sql, /ALTER (DATABASE|SYSTEM|ROLE)/);
  assert.doesNotMatch(sql, /SET plpgsql\.variable_conflict TO 'use_variable'/);
});
