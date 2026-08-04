import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("admission rows cannot outlive batch or transformation verification records", async () => {
  const sql = await readFile(
    new URL("../../../migrations/20260804051000_document_ot_ledger_constraints.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /FOREIGN KEY \(batch_record_root\)/);
  assert.match(sql, /FOREIGN KEY \(transformation_record_root\)/);
  assert.match(sql, /verified document records are immutable/);
});
