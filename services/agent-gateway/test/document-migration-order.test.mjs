import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import test from "node:test";

test("document OT ledger constraints apply after the base document migration", async () => {
  const files = (await readdir(new URL("../../../migrations/", import.meta.url)))
    .filter((file) => file.includes("document_ot_ledger"))
    .sort();
  assert.deepEqual(files, [
    "20260804050000_document_ot_ledger.sql",
    "20260804051000_document_ot_ledger_constraints.sql"
  ]);
});
