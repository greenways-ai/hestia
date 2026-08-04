import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = () => readFile(new URL("../src/document-ledger-service.mjs", import.meta.url), "utf8");

test("contributor batch and environment transformation have distinct verification passes", async () => {
  const value = await source();
  const matches = value.match(/verifyThroughLedger\(/g) || [];
  assert.ok(matches.length >= 3);
  assert.match(value, /bundle\.record/);
  assert.match(value, /transformation\.record/);
});
