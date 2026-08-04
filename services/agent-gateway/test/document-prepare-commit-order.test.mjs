import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("service signs only after database preparation and before commit", async () => {
  const source = await readFile(new URL("../src/document-ledger-service.mjs", import.meta.url), "utf8");
  const prepare = source.indexOf("prepareDocumentRevision");
  const sign = source.indexOf("signPrepared(signer, prepared)");
  const commit = source.indexOf("commitDocumentRevision");
  assert.ok(prepare >= 0 && sign > prepare && commit > sign);
});
