import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("document workflow runs browser, gateway and real ledger admission checks", async () => {
  const source = await readFile(
    new URL("../../../.github/workflows/document-ledger.yml", import.meta.url),
    "utf8"
  );
  assert.match(source, /node --test test\/document-\*\.test\.mjs/);
  assert.match(source, /working-directory: browser/);
  assert.match(source, /working-directory: services\/agent-gateway/);
  assert.match(source, /scripts\/test-document-ledger-gateway/);
  assert.match(source, /Admit two signed document revisions through HTTP and PostgreSQL/);
});
