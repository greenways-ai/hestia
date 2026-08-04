import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import test from "node:test";

test("document OT ledger hardening migrations apply after the base schema", async () => {
  const files = (await readdir(new URL("../../../migrations/", import.meta.url)))
    .filter((file) => file.includes("document_ot_ledger")
      || file.includes("document_ot_commit_hardening")
      || file.includes("document_pack_bound"))
    .sort();
  assert.deepEqual(files, [
    "20260804050000_document_ot_ledger.sql",
    "20260804051000_document_ot_ledger_constraints.sql",
    "20260804052000_document_ot_commit_hardening.sql",
    "20260804053000_document_pack_bound.sql"
  ]);
});
