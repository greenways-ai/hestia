import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../migrations/20260804041000_agent_room_activity_constraints.sql",
  import.meta.url
);

test("activity staging identity is global by record and sequential per room", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /ADD PRIMARY KEY \(signed_record_root\)/);
  assert.match(sql, /UNIQUE \(room_id, activity_sequence\)/);
  assert.match(sql, /FOREIGN KEY \(room_id\) REFERENCES hestia\.agent_room\(room_id\)/);
  assert.doesNotMatch(sql, /ADD PRIMARY KEY \(activity_sequence\)/);
});

test("pinned room activity policy cannot mutate beneath prepared receipts", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /environment_room_activity_policy_no_update/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON hestia\.environment_room_activity_policy/);
  assert.match(sql, /EXECUTE FUNCTION hestia\.reject_event_mutation\(\)/);
});
