import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("browser and PostgreSQL both append raw body-root bytes", async () => {
  const [browser, sql] = await Promise.all([
    readFile(new URL("../src/document-hcv1.js", import.meta.url), "utf8"),
    readFile(new URL("../../migrations/20260804050000_document_ot_ledger.sql", import.meta.url), "utf8")
  ]);
  assert.match(browser, /hexToBytes\(documentRootHex/);
  assert.match(browser, /concatBytes\(textEncoder\.encode/);
  assert.match(sql, /\|\| p_body_root/);
  assert.doesNotMatch(sql, /encode\(p_body_root, 'hex'\).*document_signing_payload/s);
});
