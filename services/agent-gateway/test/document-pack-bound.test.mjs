import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createAgentProfile,
  generateAgentKey
} from "../../../browser/src/agent-protocol.js";
import { createDocumentBatchBundle } from "../../../browser/src/document-records.js";
import { DOCUMENT_HCP1_MAX_CELLS } from "../src/document-ledger-service.mjs";

function packCellCount(pack) {
  return Number(/^HCP1:([0-9]+):/.exec(pack)?.[1]);
}

test("a production-shaped signed rich-text batch fits the document-specific cell bound", async () => {
  const rootKey = await generateAgentKey();
  const operationalKey = await generateAgentKey();
  const profile = await createAgentProfile({
    profileId: "profile:pack-bound",
    name: "Document Pack Bound Fixture",
    rootKey,
    operationalKey,
    purposes: ["profile.update", "document.edit"],
    validUntil: "2099-01-01T00:00:00.000Z"
  });
  const baseAst = {
    profile: "greenways.rich-text/2",
    id: "document:pack-bound",
    revision: 0,
    children: [{
      id: "paragraph:one",
      type: "paragraph",
      attrs: {},
      children: [{ id: "text:one", type: "text", text: "Hello world", marks: [] }]
    }]
  };
  const expectedResultAst = structuredClone(baseAst);
  expectedResultAst.revision = 1;
  expectedResultAst.children[0].children[0].text = "Hello Hara";
  const bundle = await createDocumentBatchBundle({
    documentId: baseAst.id,
    batchId: "batch:pack-bound",
    baseRevision: 0,
    baseAst,
    operations: [{
      id: "operation:pack-bound",
      type: "text.splice",
      targetId: "text:one",
      offset: 6,
      deleteCount: 5,
      insert: "Hara"
    }],
    expectedResultAst,
    authorProfileRecord: profile.record,
    delegationRecord: profile.delegation,
    signingKey: operationalKey
  });
  const cells = packCellCount(bundle.record.hcp1_pack);
  assert.ok(cells > 128, `fixture no longer exercises the old bound: ${cells}`);
  assert.ok(cells <= DOCUMENT_HCP1_MAX_CELLS, `${cells} exceeds ${DOCUMENT_HCP1_MAX_CELLS}`);
  assert.ok(Buffer.byteLength(bundle.record.hcp1_pack, "utf8") <= 1_000_000);
});

test("browser and PostgreSQL use the same 512-cell, 1 MB document bound", async () => {
  const migration = await readFile(
    new URL("../../../migrations/20260804053000_document_pack_bound.sql", import.meta.url),
    "utf8"
  );
  assert.equal(DOCUMENT_HCP1_MAX_CELLS, 512);
  assert.match(migration, /p_cell_count > 512/);
  assert.match(migration, /octet_length\(p_pack\) > 1000000/);
  assert.match(migration, /batches remain limited to 64 operations/i);
});
