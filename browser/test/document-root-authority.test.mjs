import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("protocol names HCV1 roots rather than JSON as canonical", async () => {
  const source = await readFile(
    new URL("../../docs/document-protocol-v1.md", import.meta.url),
    "utf8"
  );
  assert.match(source, /HCV1 cells and SHA-256 roots are canonical/);
  assert.match(source, /JSON is a replay and interface projection/);
  assert.match(source, /MUST NOT be signed as the source of truth/);
});
