import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("artefact commits bind source and result roots across browser, Hara and SQL", async () => {
  const [records, hal, sql] = await Promise.all([
    read("../src/document-hcv1.js"),
    read("../../gwdb-ledger-hal/src/gw/ledger/document_ot.hal"),
    read("../../migrations/20260804050000_document_ot_ledger.sql")
  ]);
  for (const source of [records, hal, sql]) {
    assert.match(source, /artefact-commit/);
    assert.match(source, /source/);
    assert.match(source, /result/);
  }
  assert.match(hal, /artefact source changed after the batch base/);
  assert.match(hal, /competing artefact results/);
});
