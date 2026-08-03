import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../migrations/20260804025000_agent_profile_admission_variable_conflict.sql",
  import.meta.url
);

test("legacy profile admission resolves only its RETURNS TABLE column conflict", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(
    sql,
    /ALTER FUNCTION hestia\.agent_profile_admit_prepare\(text, bytea\)/
  );
  assert.match(sql, /SET plpgsql\.variable_conflict TO 'use_column'/);
  assert.doesNotMatch(sql, /ALTER (DATABASE|SYSTEM|ROLE)/);
  assert.doesNotMatch(sql, /SET plpgsql\.variable_conflict TO 'use_variable'/);
});
