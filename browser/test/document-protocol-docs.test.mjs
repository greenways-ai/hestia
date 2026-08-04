import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("normative document protocol describes the implemented signing and admission path", async () => {
  const [protocol, architecture] = await Promise.all([
    read("../../docs/document-protocol-v1.md"),
    read("../../docs/document-ledger-architecture.md")
  ]);
  assert.match(protocol, /Status: draft 0\.3\.0/);
  assert.match(protocol, /GWDP1 NUL/);
  assert.match(protocol, /raw 32-byte body root/);
  assert.match(protocol, /document\/transformation/);
  assert.match(protocol, /POST \/agent\/v1\/documents\/imports/);
  assert.match(architecture, /PostgreSQL constructs `document\/revision`/);
  assert.match(architecture, /conflict.*does not advance the head/s);
});
