import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("document review state freezes new scope before CI", async () => {
  const source = await readFile(
    new URL("../../../docs/document-ledger-review-state.md", import.meta.url),
    "utf8"
  );
  assert.match(source, /Implementation is complete for review/);
});
