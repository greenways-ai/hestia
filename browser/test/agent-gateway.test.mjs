import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_HTTP_PROTOCOL,
  HestiaAgentGatewayError,
  admitAgentRecord,
  agentGatewayHealth
} from "../src/agent-gateway.js";

const record = Object.freeze({
  root: `sha256:${"a".repeat(64)}`,
  type: "room/admission-proof",
  hcp1_pack: "HCP1:1:C:fixture",
  hcv1_cells: [{ ignored: true }],
  body: { ignored: true }
});

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("submits only the canonical signed record and private capability", async () => {
  const calls = [];
  const capability = new Uint8Array(32).fill(23);
  const result = await admitAgentRecord({
    record,
    capability,
    requestId: "request:browser",
    endpoint: "/agent/v1/records/admit",
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return response({
        ok: true,
        protocol: AGENT_HTTP_PROTOCOL,
        request_id: "request:browser",
        record_root: record.root,
        record_kind: record.type
      });
    }
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "/agent/v1/records/admit");
  assert.deepEqual(calls[0].body.record, {
    root: record.root,
    kind: record.type,
    hcp1_pack: record.hcp1_pack
  });
  assert.equal(calls[0].body.capability, Buffer.from(capability).toString("base64url"));
  assert.equal("body" in calls[0].body.record, false);
  assert.equal("hcv1_cells" in calls[0].body.record, false);
});

test("rejects a response that is not bound to the submitted record", async () => {
  await assert.rejects(
    () => admitAgentRecord({
      record,
      capability: new Uint8Array(32),
      requestId: "request:binding",
      fetchImpl: async () => response({
        ok: true,
        protocol: AGENT_HTTP_PROTOCOL,
        request_id: "request:other",
        record_root: record.root,
        record_kind: record.type
      })
    }),
    (error) => error instanceof HestiaAgentGatewayError
      && /binding mismatch/.test(error.message)
  );
});

test("surfaces a structured gateway rejection", async () => {
  await assert.rejects(
    () => admitAgentRecord({
      record,
      capability: new Uint8Array(32),
      fetchImpl: async () => response({
        ok: false,
        protocol: AGENT_HTTP_PROTOCOL,
        error: {
          code: "admission-rejected",
          message: "room invitation is no longer admissible"
        }
      }, 409)
    }),
    (error) => error instanceof HestiaAgentGatewayError
      && error.status === 409
      && error.code === "admission-rejected"
  );
});

test("reads gateway health using the same protocol", async () => {
  const health = await agentGatewayHealth({
    fetchImpl: async () => response({
      ok: true,
      protocol: AGENT_HTTP_PROTOCOL,
      environment: { environment_id: "hestia-test" }
    })
  });
  assert.equal(health.environment.environment_id, "hestia-test");
});
