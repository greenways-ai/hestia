import { strict as assert } from "node:assert";
import {
  createAgentProfile,
  generateAgentKey
} from "../../../browser/src/agent-protocol.js";
import { createDocumentBatchBundle } from "../../../browser/src/document-records.js";
import { applyBatch } from "../../../protocol/document-ot.js";
import { AGENT_HTTP_PROTOCOL } from "../src/protocol.mjs";
import { DOCUMENT_HTTP_PROTOCOL } from "../src/document-ledger-service.mjs";

const origin = process.argv[2] || "http://127.0.0.1:58787";

async function post(path, body, expectedStatus = 200) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const value = await response.json();
  if (response.status !== expectedStatus) {
    throw new Error(`${path} returned ${response.status}: ${JSON.stringify(value)}`);
  }
  return value;
}

function documentAst(documentId, text = "Hello world", revision = 0) {
  return {
    profile: "greenways.rich-text/2",
    id: documentId,
    revision,
    children: [{
      id: `${documentId}:paragraph`,
      type: "paragraph",
      attrs: {},
      children: [{
        id: `${documentId}:text`,
        type: "text",
        text,
        marks: []
      }]
    }]
  };
}

function requestFor(record) {
  return {
    protocol: AGENT_HTTP_PROTOCOL,
    record: {
      root: record.root,
      kind: record.type,
      hcp1_pack: record.hcp1_pack
    }
  };
}

function trimmedBatch(bundle) {
  return {
    record: bundle.record,
    documentId: bundle.documentId,
    batchId: bundle.batchId,
    baseRevision: bundle.baseRevision,
    baseAst: bundle.baseAst,
    expectedResultAst: bundle.expectedResultAst,
    operations: bundle.operations
  };
}

const rootKey = await generateAgentKey();
const operationalKey = await generateAgentKey();
const profile = await createAgentProfile({
  profileId: "profile:document-ledger-http",
  name: "Document Ledger HTTP Fixture",
  rootKey,
  operationalKey,
  purposes: ["profile.update", "document.edit"],
  validUntil: "2099-01-01T00:00:00.000Z"
});
const profileAdmission = await post("/v1/records/admit", requestFor(profile.record));
assert.equal(profileAdmission.ok, true);

const documentId = "document:ledger-http";
const baseAst = documentAst(documentId);
const firstOperations = [{
  id: "operation:http-insert",
  type: "text.splice",
  targetId: `${documentId}:text`,
  offset: 0,
  deleteCount: 0,
  insert: "Bright "
}];
const firstResult = applyBatch(baseAst, {
  id: "batch:http-one",
  documentId,
  baseRevision: 0,
  operations: firstOperations
});
const firstBundle = await createDocumentBatchBundle({
  documentId,
  batchId: "batch:http-one",
  baseRevision: 0,
  baseAst,
  operations: firstOperations,
  expectedResultAst: firstResult,
  authorProfileRecord: profile.record,
  delegationRecord: profile.delegation,
  signingKey: operationalKey
});
const first = await post("/v1/documents/imports", {
  batch: trimmedBatch(firstBundle)
});
assert.equal(first.protocol, DOCUMENT_HTTP_PROTOCOL);
assert.equal(first.outcome, "accepted");
assert.equal(first.revision, "1");

const secondOperations = [{
  id: "operation:http-replace",
  type: "text.splice",
  targetId: `${documentId}:text`,
  offset: 6,
  deleteCount: 5,
  insert: "Hara"
}];
const secondLocalResult = applyBatch(baseAst, {
  id: "batch:http-two",
  documentId,
  baseRevision: 0,
  operations: secondOperations
});
const secondBundle = await createDocumentBatchBundle({
  documentId,
  batchId: "batch:http-two",
  baseRevision: 0,
  baseAst,
  operations: secondOperations,
  expectedResultAst: secondLocalResult,
  authorProfileRecord: profile.record,
  delegationRecord: profile.delegation,
  signingKey: operationalKey
});
const second = await post("/v1/documents/imports", {
  batch: trimmedBatch(secondBundle)
});
assert.equal(second.protocol, DOCUMENT_HTTP_PROTOCOL);
assert.equal(second.outcome, "accepted");
assert.equal(second.revision, "2");
assert.match(second.revision_root, /^sha256:[0-9a-f]{64}$/);
assert.match(second.signed_receipt_root, /^sha256:[0-9a-f]{64}$/);

process.stdout.write(JSON.stringify({
  document_id: documentId,
  profile_id: profile.record.body.profile_id,
  expected_text: "Bright Hello Hara",
  first_receipt: first.signed_receipt_root,
  second_receipt: second.signed_receipt_root
}));
