import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("signature flow documents contributor, transformation and receipt signatures", async () => {
  const source = await readFile(
    new URL("../../docs/document-ledger-signature-flow.md", import.meta.url),
    "utf8"
  );
  assert.match(source, /signs document\/batch/);
  assert.match(source, /signs document\/transformation/);
  assert.match(source, /signs exact database-returned receipt bytes/);
  assert.match(source, /GWDP1/);
  assert.match(source, /GWAR1/);
});
