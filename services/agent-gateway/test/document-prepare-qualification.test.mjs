import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = () => readFile(
  new URL("../../../migrations/20260804054000_document_prepare_qualification.sql", import.meta.url),
  "utf8"
);

test("document prepare qualifies columns that collide with table output parameters", async () => {
  const sql = await source();
  assert.match(sql, /FROM hestia\.document_head AS head/);
  assert.match(sql, /WHERE head\.document_id = v_document_id/);
  assert.match(sql, /FROM hestia\.document_revision AS base_revision_row/);
  assert.match(sql, /WHERE base_revision_row\.document_id = v_document_id/);
  assert.match(sql, /AND base_revision_row\.revision = v_base_revision/);
  assert.match(sql, /FROM hestia\.document_batch_admission AS admission/);
  assert.match(sql, /WHERE admission\.batch_record_root = p_batch_record_root/);
});

test("document prepare no longer uses unqualified document head or revision identifiers", async () => {
  const sql = await source();
  assert.doesNotMatch(sql, /FROM hestia\.document_head\s+WHERE document_id\s*=/);
  assert.doesNotMatch(sql, /FROM hestia\.document_revision\s+WHERE document_id\s*=/);
  assert.doesNotMatch(sql, /FROM hestia\.document_batch_admission\s+WHERE batch_record_root\s*=/);
});
