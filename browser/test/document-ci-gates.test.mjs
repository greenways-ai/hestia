import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("document CI gate includes migrations and full verification", async () => {
  const source = await readFile(new URL("../../docs/document-ledger-ci.md", import.meta.url), "utf8");
  assert.match(source, /application of all PostgreSQL migrations/);
  assert.match(source, /existing full Hestia verification workflow/);
});
