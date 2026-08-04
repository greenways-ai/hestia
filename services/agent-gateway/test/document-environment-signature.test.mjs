import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const service = () => readFile(
  new URL("../src/document-ledger-service.mjs", import.meta.url),
  "utf8"
);

test("environment signer receives only database-prepared receipt bytes", async () => {
  const value = await service();
  assert.match(value, /prepared\.receiptSigningPayload/);
  assert.match(value, /signer\.sign\(prepared\.receiptSigningPayload\)/);
  assert.match(value, /signer\.verify\(prepared\.receiptSigningPayload, signature\)/);
  assert.doesNotMatch(value, /signer\.sign\(JSON\.stringify/);
  assert.doesNotMatch(value, /signer\.sign\(input/);
});
