import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("JSON projections remain explicitly subordinate to HCV1 roots", async () => {
  const [migration, architecture] = await Promise.all([
    read("../../../migrations/20260804050000_document_ot_ledger.sql"),
    read("../../../docs/document-ledger-architecture.md")
  ]);
  assert.match(migration, /operation_projection jsonb NOT NULL/);
  assert.match(migration, /operation_root bytea NOT NULL UNIQUE REFERENCES gw_ledger\."Cell"/);
  assert.match(migration, /Non-canonical JSON projection/);
  assert.match(architecture, /Projected, non-canonical/);
  assert.match(architecture, /HCV1 root.*authoritative/s);
});
