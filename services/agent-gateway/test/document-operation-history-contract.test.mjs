import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("stale batches transform through root-verified accepted operations after their base", async () => {
  const [service, database] = await Promise.all([
    read("../src/document-ledger-service.mjs"),
    read("../src/postgres-document.mjs")
  ]);
  assert.match(service, /documentOperationsAfter/);
  assert.match(service, /verifiedAcceptedOperations/);
  assert.match(service, /does not match its Hara ledger root/);
  assert.match(service, /admitBatch\(currentDocument, batch, acceptedOperations/);
  assert.match(database, /encode\(operation_root, 'hex'\)/);
  assert.match(database, /revision > \$\{revision\}::bigint/);
});
