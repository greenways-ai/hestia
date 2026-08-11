import assert from "node:assert/strict";
import test from "node:test";
import { iceConfiguration, validateConnection, validateEnvelope } from "../src/protocol.js";

function envelope(overrides = {}) {
  return {
    version: 1,
    protocol: "hestia-signal/0-alpha",
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

test("accepts only an explicitly allowed origin and valid room identifiers", () => {
  const url = new URL("https://signal.example/signal?ceremony=0123456789abcdefABCDEF&peer=0123456789abcdef");
  assert.deepEqual(validateConnection(url, "https://demo.example", ["https://demo.example"]), {
    ceremony: "0123456789abcdefABCDEF",
    peer: "0123456789abcdef"
  });
  assert.throws(() => validateConnection(url, "https://evil.example", ["https://demo.example"]), /origin/);
});

test("relays only signed, MACed negotiation envelopes", () => {
  const value = envelope();
  assert.equal(validateEnvelope(value, value.ceremony_id, value.from), value);
  assert.throws(
    () => validateEnvelope({ ...value, type: "recovery/share" }, value.ceremony_id, value.from),
    /message-type/
  );
  assert.throws(() => validateEnvelope({ ...value, signature: "" }, value.ceremony_id, value.from), /signature/);
  assert.throws(() => validateEnvelope({ ...value, mac: "" }, value.ceremony_id, value.from), /mac/);
});

test("builds a public STUN configuration without credentials", () => {
  assert.deepEqual(iceConfiguration("stun:stun.cloudflare.com:3478"), [
    { urls: ["stun:stun.cloudflare.com:3478"] }
  ]);
});
