import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("browser and server agree on the document import route and protocol", async () => {
  const [browser, server, docs] = await Promise.all([
    read("../../../browser/src/document-gateway.js"),
    read("../src/http-server.mjs"),
    read("../../../docs/document-ledger-api.md")
  ]);
  for (const source of [browser, server, docs]) {
    assert.match(source, /hestia-document-http\/1/);
    assert.match(source, /documents\/imports/);
  }
});
