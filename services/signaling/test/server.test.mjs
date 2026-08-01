import assert from "node:assert/strict";
import test from "node:test";
import { validateEnvelope } from "../src/server.mjs";

test("accepts a ceremony-bound signed signalling envelope", () => {
  const envelope = {
    type: "offer",
    ceremony_id: "ceremony-812",
    from: "keeper-a",
    nonce: "0123456789abcdef",
    signature: "base64-signature-value",
    payload: { sdp: "opaque" }
  };
  assert.equal(validateEnvelope(envelope, "ceremony-812", "keeper-a"), envelope);
});

test("rejects cross-ceremony and unsigned messages", () => {
  assert.throws(() => validateEnvelope({
    type: "ice",
    ceremony_id: "ceremony-other",
    from: "keeper-a",
    nonce: "0123456789abcdef",
    signature: "base64-signature-value"
  }, "ceremony-812", "keeper-a"), /ceremony-mismatch/);
  assert.throws(() => validateEnvelope({
    type: "ice",
    ceremony_id: "ceremony-812",
    from: "keeper-a",
    nonce: "0123456789abcdef"
  }, "ceremony-812", "keeper-a"), /missing-signature/);
});
