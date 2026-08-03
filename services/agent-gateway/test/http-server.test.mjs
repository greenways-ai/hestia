import assert from "node:assert/strict";
import test from "node:test";
import { createAgentGatewayHttpServer } from "../src/http-server.mjs";
import { AGENT_HTTP_PROTOCOL } from "../src/protocol.mjs";

function service() {
  const calls = [];
  return {
    calls,
    async health() {
      calls.push(["health"]);
      return { ok: true, protocol: AGENT_HTTP_PROTOCOL };
    },
    async environment() {
      calls.push(["environment"]);
      return { environment_id: "hestia-test", key_root: `sha256:${"a".repeat(64)}` };
    },
    async admit(value) {
      calls.push(["admit", value]);
      return {
        ok: true,
        protocol: AGENT_HTTP_PROTOCOL,
        request_id: value.request_id,
        record_root: value.record.root,
        record_kind: value.record.kind
      };
    }
  };
}

async function running(options = {}) {
  const target = options.service ?? service();
  const server = createAgentGatewayHttpServer({
    service: target,
    host: "127.0.0.1",
    port: 0,
    ...options
  });
  await server.listen();
  const address = server.address();
  return {
    service: target,
    server,
    origin: `http://127.0.0.1:${address.port}`
  };
}

async function responseJson(response) {
  return { status: response.status, body: await response.json() };
}

test("serves health, environment, and signed-record admission", async () => {
  const state = await running();
  try {
    const health = await responseJson(await fetch(`${state.origin}/v1/health`));
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);

    const environment = await responseJson(await fetch(`${state.origin}/v1/environment`));
    assert.equal(environment.status, 200);
    assert.equal(environment.body.environment.environment_id, "hestia-test");

    const request = {
      protocol: AGENT_HTTP_PROTOCOL,
      request_id: "request:http",
      record: {
        root: `sha256:${"b".repeat(64)}`,
        kind: "profile/version",
        hcp1_pack: "HCP1:1:C:fixture"
      }
    };
    const admitted = await responseJson(await fetch(`${state.origin}/v1/records/admit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request)
    }));
    assert.equal(admitted.status, 200);
    assert.equal(admitted.body.request_id, "request:http");
    assert.deepEqual(state.service.calls.at(-1), ["admit", request]);
  } finally {
    await state.server.close();
  }
});

test("rejects an unapproved browser origin and oversized request", async () => {
  const state = await running({
    allowedOrigins: ["https://allowed.example"],
    maxBodyBytes: 64
  });
  try {
    const origin = await responseJson(await fetch(`${state.origin}/v1/health`, {
      headers: { origin: "https://attacker.example" }
    }));
    assert.equal(origin.status, 403);
    assert.equal(origin.body.error.code, "origin-not-allowed");

    const large = await responseJson(await fetch(`${state.origin}/v1/records/admit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: "x".repeat(100) })
    }));
    assert.equal(large.status, 413);
    assert.equal(large.body.error.code, "request-too-large");
  } finally {
    await state.server.close();
  }
});

test("maps PostgreSQL policy rejection without exposing an internal stack", async () => {
  const target = service();
  target.admit = async () => {
    const error = new Error("room admission capability proof mismatch");
    error.code = "P0001";
    throw error;
  };
  const state = await running({ service: target });
  try {
    const rejected = await responseJson(await fetch(`${state.origin}/v1/records/admit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    }));
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.error.code, "admission-rejected");
    assert.match(rejected.body.error.message, /capability proof mismatch/);
  } finally {
    await state.server.close();
  }
});
