import assert from "node:assert/strict";
import test from "node:test";
import { createAgentGatewayHttpServer } from "../src/http-server.mjs";
import { AGENT_HTTP_PROTOCOL } from "../src/protocol.mjs";
import { DOCUMENT_HTTP_PROTOCOL } from "../src/document-ledger-service.mjs";

function agentService() {
  return {
    async health() { return { ok: true, protocol: AGENT_HTTP_PROTOCOL }; },
    async environment() { return { environment_id: "hestia-test" }; },
    async admit() { throw new Error("not used"); }
  };
}

test("routes document imports to the signed OT service", async () => {
  const calls = [];
  const server = createAgentGatewayHttpServer({
    service: agentService(),
    documentService: {
      async admit(value) {
        calls.push(value);
        return {
          ok: true,
          protocol: DOCUMENT_HTTP_PROTOCOL,
          document_id: value.batch.documentId,
          outcome: "accepted",
          receipt_root: `sha256:${"a".repeat(64)}`
        };
      }
    },
    host: "127.0.0.1",
    port: 0
  });
  await server.listen();
  try {
    const address = server.address();
    const payload = {
      batch: {
        documentId: "document:http",
        record: {
          type: "document/batch",
          root: `sha256:${"b".repeat(64)}`,
          hcp1_pack: "HCP1:1:C:fixture"
        }
      }
    };
    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/documents/imports`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      }
    );
    const value = await response.json();
    assert.equal(response.status, 200);
    assert.equal(value.protocol, DOCUMENT_HTTP_PROTOCOL);
    assert.equal(value.document_id, "document:http");
    assert.deepEqual(calls, [payload]);
  } finally {
    await server.close();
  }
});

test("returns a document-domain service error when OT is unavailable", async () => {
  const server = createAgentGatewayHttpServer({
    service: agentService(),
    host: "127.0.0.1",
    port: 0
  });
  await server.listen();
  try {
    const address = server.address();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/documents/imports`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batch: {} })
      }
    );
    const value = await response.json();
    assert.equal(response.status, 503);
    assert.equal(value.protocol, DOCUMENT_HTTP_PROTOCOL);
    assert.equal(value.error.code, "document-service-unavailable");
  } finally {
    await server.close();
  }
});
