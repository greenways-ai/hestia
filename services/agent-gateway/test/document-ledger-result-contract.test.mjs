import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const service = () => readFile(new URL("../src/document-ledger-service.mjs", import.meta.url), "utf8");

test("public result binds transformation, canonical receipt and signed receipt roots", async () => {
  const source = await service();
  assert.match(source, /transformation_root: transformation\.record\.root/);
  assert.match(source, /receipt_root: `sha256:\$\{prepared\.receiptRootHex\}`/);
  assert.match(source, /signed_receipt_root: `sha256:\$\{committed\.signedReceiptRootHex\}`/);
  assert.match(source, /environment_signature/);
});
