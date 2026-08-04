import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_HTTP_PROTOCOL,
  HestiaDocumentGatewayError,
  admitDocumentBatch
} from "../src/document-gateway.js";

const bundle = Object.freeze({
  documentId: "document:test",
  record: {
    type: "document/batch",
    root: `sha256:${"a".repeat(64)}`,
    hcp1_pack: "HCP1:1:C:fixture"
  },
  operations: [],
  baseAst: {},
  expectedResultAst: {}
});

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("submits a signed batch bundle to the document ledger endpoint", async () => {
  const calls = [];
  const result = await admitDocumentBatch({
    batch: bundle,
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return response({
        ok: true,
        protocol: DOCUMENT_HTTP_PROTOCOL,
        document_id: bundle.documentId,
        outcome: "accepted"
      });
    }
  });
  assert.equal(result.outcome, "accepted");
  assert.equal(calls[0].url, "/agent/v1/documents/imports");
  assert.equal(calls[0].body.batch.record.root, bundle.record.root);
});

test("rejects a document receipt bound to another document", async () => {
  await assert.rejects(
    () => admitDocumentBatch({
      batch: bundle,
      fetchImpl: async () => response({
        ok: true,
        protocol: DOCUMENT_HTTP_PROTOCOL,
        document_id: "document:other",
        outcome: "accepted"
      })
    }),
    (error) => error instanceof HestiaDocumentGatewayError
      && /binding mismatch/.test(error.message)
  );
});
