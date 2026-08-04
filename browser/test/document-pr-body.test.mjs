import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PR body covers signing, OT, ledger authority and artefacts", async () => {
  const source = await readFile(new URL("../../docs/document-ledger-pr-body.md", import.meta.url), "utf8");
  assert.match(source, /gw\.ledger\.document-ot/);
  assert.match(source, /GWDP1/);
  assert.match(source, /PostgreSQL construct revision and receipt roots/);
  assert.match(source, /Hara artefact commits/);
});
