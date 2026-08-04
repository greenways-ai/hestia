import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = () => readFile(
  new URL("../src/postgres-document.mjs", import.meta.url),
  "utf8"
);

test("PostgreSQL adapter uses only prepare and commit functions for document writes", async () => {
  const value = await source();
  assert.match(value, /hestia\.document_record_verify_prepare/);
  assert.match(value, /hestia\.document_record_verify_commit/);
  assert.match(value, /hestia\.document_batch_prepare/);
  assert.match(value, /hestia\.document_batch_commit/);
  assert.doesNotMatch(value, /INSERT\s+INTO\s+hestia\.document_/i);
  assert.doesNotMatch(value, /UPDATE\s+hestia\.document_/i);
});

test("reads accepted operation projections strictly after the signed base revision", async () => {
  const value = await source();
  assert.match(value, /revision > \$\{revision\}::bigint/);
  assert.match(value, /ORDER BY revision, operation_index/);
});
