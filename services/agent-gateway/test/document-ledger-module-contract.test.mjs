import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("gateway wires Hara OT, PostgreSQL ledger and environment signer", async () => {
  const [server, service] = await Promise.all([
    read("../src/server.mjs"),
    read("../src/document-ledger-service.mjs")
  ]);
  assert.match(server, /createPostgresDocumentDatabase/);
  assert.match(server, /createDocumentLedgerService/);
  assert.match(service, /admitBatch/);
  assert.match(service, /verifyThroughLedger/);
  assert.match(service, /createDocumentTransformationBundle/);
  assert.match(service, /prepareDocumentRevision/);
  assert.match(service, /commitDocumentRevision/);
});
