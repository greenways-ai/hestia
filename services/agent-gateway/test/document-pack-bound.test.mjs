import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createAgentProfile,
  generateAgentKey
} from "../../../browser/src/agent-protocol.js";
import {
  createDocumentBatchBundle,
  createDocumentTransformationBundle
} from "../../../browser/src/document-records.js";
import { DOCUMENT_HCP0_MAX_CELLS } from "../src/document-ledger-service.mjs";

function packCellCount(pack) {
  return Number(/^HCP0:([0-9]+):/.exec(pack)?.[1]);
}

async function signerAdapter(key) {
  const publicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey("raw", key.publicKey)
  );
  return {
    publicKeyBytes,
    sign(payload) {
      return crypto.subtle.sign({ name: "Ed25519" }, key.privateKey, payload);
    }
  };
}

test("production-shaped batch and transformation packs remain bounded", async () => {
  const rootKey = await generateAgentKey();
  const operationalKey = await generateAgentKey();
  const environmentKey = await generateAgentKey();
  const profile = await createAgentProfile({
    profileId: "profile:pack-bound",
    name: "Document Pack Bound Fixture",
    rootKey,
    operationalKey,
    purposes: ["profile.update", "document.edit"],
    validUntil: "2099-01-01T00:00:00.000Z"
  });
  const baseAst = {
    profile: "greenways.rich-text/0-alpha",
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
  const operations = [{
    id: "operation:pack-bound",
    type: "text.splice",
    targetId: "text:one",
    offset: 6,
    deleteCount: 5,
    insert: "Hara"
  }];
  const batch = await createDocumentBatchBundle({
    documentId: baseAst.id,
    batchId: "batch:pack-bound",
    baseRevision: 0,
    baseAst,
    operations,
    expectedResultAst,
    authorProfileRecord: profile.record,
    delegationRecord: profile.delegation,
    signingKey: operationalKey
  });
  const transformation = await createDocumentTransformationBundle({
    transformationId: "transformation:pack-bound",
    documentId: baseAst.id,
    batchRecord: batch.record,
    baseRevision: 0,
    previousRevisionRoot: null,
    previousAst: baseAst,
    transformedOperations: operations,
    resultAst: expectedResultAst,
    outcome: "accepted",
    environmentSigner: await signerAdapter(environmentKey),
    environmentKeyId: environmentKey.id
  });

  const packs = [batch.record.hcp1_pack, transformation.record.hcp1_pack];
  const counts = packs.map(packCellCount);
  assert.ok(counts.every((count) => Number.isSafeInteger(count) && count > 0));
  assert.ok(counts.every((count) => count <= DOCUMENT_HCP0_MAX_CELLS));
  assert.ok(packs.every((pack) => Buffer.byteLength(pack, "utf8") <= 1_000_000));
  assert.ok(counts[1] >= counts[0], "transformation should retain the batch reference graph");
});

test("browser and PostgreSQL use the same 512-cell, 1 MB document bound", async () => {
  const migration = await readFile(
    new URL("../../../migrations/20260804053000_document_pack_bound.sql", import.meta.url),
    "utf8"
  );
  assert.equal(DOCUMENT_HCP0_MAX_CELLS, 512);
  assert.match(migration, /p_cell_count > 512/);
  assert.match(migration, /octet_length\(p_pack\) > 1000000/);
  assert.match(migration, /batches remain limited to 64 operations/i);
});
