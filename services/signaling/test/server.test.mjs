import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { createSignalingServer, iceConfiguration, validateEnvelope } from "../src/server.mjs";

function envelope(overrides = {}) {
  return {
    version: 1,
    protocol: "hestia-signal/1",
    type: "offer",
    ceremony_id: "0123456789abcdefABCDEF",
    from: "0123456789abcdef",
    to: "fedcba9876543210",
    sequence: 1,
    nonce: "0123456789abcdef",
    signature: "a".repeat(86),
    mac: "b".repeat(43),
    payload: { sdp: "opaque" },
    ...overrides
  };
}

test("accepts a ceremony-bound authenticated signalling envelope", () => {
  const value = envelope();
  assert.equal(validateEnvelope(value, value.ceremony_id, value.from), value);
});

test("rejects cross-ceremony, unsigned, and un-MACed messages", () => {
  const value = envelope();
  assert.throws(
    () => validateEnvelope({ ...value, ceremony_id: "abcdefghijklmnopqrstuv" }, value.ceremony_id, value.from),
    /ceremony-mismatch/
  );
  assert.throws(() => validateEnvelope({ ...value, signature: "" }, value.ceremony_id, value.from), /signature/);
  assert.throws(() => validateEnvelope({ ...value, mac: "" }, value.ceremony_id, value.from), /mac/);
  assert.throws(
    () => validateEnvelope({ ...value, type: "keeper-envelope" }, value.ceremony_id, value.from),
    /message-type/
  );
});

test("limits every ceremony room to two live browsers", async () => {
  const server = createSignalingServer({ port: 0 });
  await server.listen();
  const base = "ws://127.0.0.1:" + server.address().port
    + "/signal?ceremony=0123456789abcdefABCDEF&peer=";
  const first = new WebSocket(base + "0123456789abcdef");
  const second = new WebSocket(base + "fedcba9876543210");
  await Promise.all([
    new Promise((resolve) => first.once("open", resolve)),
    new Promise((resolve) => second.once("open", resolve))
  ]);
  const third = new WebSocket(base + "AAAABBBBCCCCDDDD");
  const closed = await new Promise((resolve) => third.once(
    "close", (code, reason) => resolve({ code, reason: reason.toString() })
  ));
  assert.deepEqual(closed, { code: 1008, reason: "room-full" });
  first.close();
  second.close();
  await server.close();
});

test("creates short-lived TURN REST credentials without exposing the shared secret", () => {
  const servers = iceConfiguration("0123456789abcdef", {
    stunUrls: ["stun:stun.example:3478"],
    turnUrls: ["turn:turn.example:3478?transport=udp"],
    turnSecret: "keeper-secret",
    turnTtlSeconds: 600,
    now: () => 1_700_000_000_000
  });
  assert.deepEqual(servers[0], { urls: ["stun:stun.example:3478"] });
  assert.equal(servers[1].username, "1700000600:0123456789abcdef");
  assert.equal(servers[1].urls[0], "turn:turn.example:3478?transport=udp");
  assert.ok(servers[1].credential.length > 20);
  assert.equal(JSON.stringify(servers).includes("keeper-secret"), false);
});
