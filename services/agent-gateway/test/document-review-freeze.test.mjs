import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("integration freeze names the complete signed OT boundary", async () => {
  const source = await readFile(
    new URL("../../../docs/document-ledger-freeze.md", import.meta.url),
    "utf8"
  );
  assert.match(source, /signed batch/);
  assert.match(source, /Hara OT/);
  assert.match(source, /PostgreSQL prepare\/sign\/commit/);
  assert.match(source, /conflict receipt/);
});
