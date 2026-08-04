import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("document room delegates transformation to gw.ledger.document-ot", async () => {
  const source = await read("../hara/document_room.hal");
  assert.match(source, /\[gw\.ledger\.document-ot :as document-ot\]/);
  assert.match(source, /document-ot\/transform-batch/);
  assert.match(source, /canonical-operation/);
  assert.match(source, /project-operation/);
  assert.doesNotMatch(source, /\(defn transform-text-splice/);
  assert.doesNotMatch(source, /\(defn transform-artefact-commit/);
});

test("Pages publishes the canonical ledger and replay sources consumed by the room", async () => {
  const [kernel, build] = await Promise.all([
    read("../src/document-room-kernel.js"),
    read("../scripts/build-pages.mjs")
  ]);
  assert.match(kernel, /gw\.ledger\.document-protocol/);
  assert.match(kernel, /gw\.ledger\.document-ot/);
  assert.match(kernel, /hara-ledger\/document_protocol\.hal/);
  assert.match(kernel, /hara-ledger\/document_ot\.hal/);
  assert.match(build, /gwdb-ledger-hal\/src\/gw\/ledger\/document_protocol\.hal/);
  assert.match(build, /gwdb-ledger-hal\/src\/gw\/ledger\/document_ot\.hal/);
  assert.match(build, /resolve\(repository, "protocol"\)/);
  assert.match(build, /resolve\(output, "protocol"\)/);
});
