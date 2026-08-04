import assert from "node:assert/strict";
import test from "node:test";
import { generateAgentKey } from "../src/agent-protocol.js";
import {
  documentSigningBytes,
  documentValuePlan,
  verifyDocumentRecord
} from "../src/document-hcv1.js";
import {
  createDocumentBatchBundle,
  createDocumentTransformationBundle
} from "../src/document-records.js";

async function signerAdapter(key) {
  const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey));
  return {
    publicKeyBytes,
    sign(payload) {
      return crypto.subtle.sign({ name: "Ed25519" }, key.privateKey, payload);
    }
  };
}

async function fixtureBatch() {
  const signingKey = await generateAgentKey();
  const [profile, delegation, source, result] = await Promise.all([
    documentValuePlan({ profile: "profile:writer", sequence: 1 }),
    documentValuePlan({ purpose: "document.edit", scope: "document:plan" }),
    documentValuePlan("(* 6 7)"),
    documentValuePlan(42)
  ]);
  const baseAst = {
    profile: "greenways.rich-text/2",
    id: "document:plan",
    revision: 0,
    children: [{
      id: "text:one",
      type: "text",
      text: "Hello world",
      marks: []
    }, {
      id: "artefact:node",
      type: "hara-artefact",
      attrs: { artefactId: "artefact:value", kind: "value", mode: "live" },
      children: [{ id: "artefact:source", type: "text", text: "(* 6 7)", marks: [] }]
    }]
  };
  const operations = [{
    id: "operation:splice",
    type: "text.splice",
    targetId: "text:one",
    offset: 6,
    deleteCount: 5,
    insert: "Hara"
  }, {
    id: "operation:artefact",
    type: "artefact.commit",
    artefactId: "artefact:value",
    artefactNodeId: "artefact:node",
    sourceTextId: "artefact:source",
    sourceRoot: source,
    resultRoot: result,
    display: "42"
  }];
  const expectedResultAst = structuredClone(baseAst);
  expectedResultAst.children[0].text = "Hello Hara";
  expectedResultAst.children[1].attrs = {
    ...expectedResultAst.children[1].attrs,
    mode: "snapshot",
    snapshotRoot: result.root
  };
  const bundle = await createDocumentBatchBundle({
    documentId: "document:plan",
    batchId: "batch:one",
    baseRevision: 0,
    baseAst,
    operations,
    expectedResultAst,
    authorProfileRecord: profile,
    delegationRecord: delegation,
    signingKey
  });
  return { bundle, signingKey, baseAst, expectedResultAst, operations };
}

test("GWDP1 signs raw body roots in a document-only domain", async () => {
  const bytes = documentSigningBytes("document/batch", `sha256:${"ab".repeat(32)}`);
  const prefix = new TextDecoder().decode(bytes.slice(0, "GWDP1\0document/batch\0".length));
  assert.equal(prefix, "GWDP1\0document/batch\0");
  assert.equal(bytes.length, "GWDP1\0document/batch\0".length + 32);
});

test("builds and verifies a signed document batch with individually rooted operations", async () => {
  const { bundle, signingKey } = await fixtureBatch();
  const verified = await verifyDocumentRecord(bundle.record, signingKey.publicKey);
  assert.equal(verified.document_id, "document:plan");
  assert.equal(verified.base_revision, 0);
  assert.equal(bundle.operationPlans.length, 2);
  assert.match(bundle.operationPlans[0].root, /^sha256:[0-9a-f]{64}$/);
  assert.match(bundle.operationVector.root, /^sha256:[0-9a-f]{64}$/);
  assert.match(bundle.record.root, /^sha256:[0-9a-f]{64}$/);
  assert.match(bundle.record.hcp1_pack, /^HCP1:[1-9][0-9]*:/);
  assert.ok(bundle.record.hcv1_cells.some((cell) => cell.type_tag === 14));

  const tampered = structuredClone(bundle.record);
  tampered.body.base_revision = 1;
  await assert.rejects(
    () => verifyDocumentRecord(tampered, signingKey.publicKey),
    /body root mismatch/
  );
});

test("environment transformation commits the exact previous head and transformed operation vector", async () => {
  const { bundle, baseAst, expectedResultAst, operations } = await fixtureBatch();
  const environmentKey = await generateAgentKey();
  const transformation = await createDocumentTransformationBundle({
    transformationId: "transformation:one",
    documentId: "document:plan",
    batchRecord: bundle.record,
    baseRevision: 0,
    previousRevisionRoot: null,
    previousAst: baseAst,
    transformedOperations: operations,
    resultAst: expectedResultAst,
    outcome: "accepted",
    environmentSigner: await signerAdapter(environmentKey),
    environmentKeyId: environmentKey.id
  });
  const verified = await verifyDocumentRecord(transformation.record, environmentKey.publicKey);
  assert.equal(verified.batch_root.root, bundle.record.root);
  assert.equal(verified.outcome, "accepted");
  assert.equal(transformation.operationPlans.length, 2);
  assert.equal(transformation.resultAst.children[0].text, "Hello Hara");
});
