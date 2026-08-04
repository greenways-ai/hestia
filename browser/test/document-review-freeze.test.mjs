import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("review scope waits for CI before expanding features", async () => {
  const source = await readFile(
    new URL("../../docs/document-ledger-freeze.md", import.meta.url),
    "utf8"
  );
  assert.match(source, /frozen for integration review/);
  assert.match(source, /passes repository CI/);
});
