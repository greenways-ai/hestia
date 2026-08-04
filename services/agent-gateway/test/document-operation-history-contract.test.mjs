import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("stale batches transform through accepted operations after their base", async () => {
  const [service, database] = await Promise.all([
    read("../src/document-ledger-service.mjs"),
    read("../src/postgres-document.mjs")
  ]);
  assert.match(service, /documentOperationsAfter/);
  assert.match(service, /acceptedOperations/);
  assert.match(service, /admitBatch\(currentDocument, batch, acceptedOperations/);
  assert.match(database, /revision > \$\{revision\}::bigint/);
});
