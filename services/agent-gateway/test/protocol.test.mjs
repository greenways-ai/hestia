import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_HTTP_PROTOCOL,
  decodeCapability,
  normalizeAdmissionRequest,
  parseHcp1Pack
} from "../src/protocol.mjs";

const root = `sha256:${"a".repeat(64)}`;
const pack = "HCP1:1:C:fixture";

function request(kind = "profile/version", extra = {}) {
  return {
    protocol: AGENT_HTTP_PROTOCOL,
    request_id: "request:test-1",
    record: { root, kind, hcp1_pack: pack },
    ...extra
  };
}

test("normalizes one bounded signed-record admission request", () => {
  const normalized = normalizeAdmissionRequest(request());
  assert.equal(normalized.requestId, "request:test-1");
  assert.equal(normalized.recordRootHex, "a".repeat(64));
  assert.equal(normalized.recordKind, "profile/version");
  assert.equal(normalized.pack.cellCount, 1);
  assert.equal(normalized.pack.bytes.toString("utf8"), pack);
  assert.equal(normalized.capability, null);
});

test("accepts canonical document and message activity records without capabilities", () => {
  for (const kind of ["room/document-attachment", "room/message-intent"]) {
    const normalized = normalizeAdmissionRequest(request(kind));
    assert.equal(normalized.recordKind, kind);
    assert.equal(normalized.capability, null);
  }
});

test("requires a canonical 32-byte capability only for guest admission", () => {
  const capability = Buffer.alloc(32, 19).toString("base64url");
  const normalized = normalizeAdmissionRequest(
    request("room/admission-proof", { capability })
  );
  assert.deepEqual(normalized.capability, Buffer.alloc(32, 19));
  assert.throws(
    () => normalizeAdmissionRequest(request("room/admission-proof")),
    /requires its private capability/
  );
  for (const kind of [
    "room/version",
    "room/document-attachment",
    "room/message-intent"
  ]) {
    assert.throws(
      () => normalizeAdmissionRequest(request(kind, { capability })),
      /valid only for room admission proof/
    );
  }
  assert.throws(() => decodeCapability("AA"), /exactly 32 bytes/);
});

test("rejects non-canonical roots, packs, fields, and kinds", () => {
  assert.throws(
    () => normalizeAdmissionRequest({ ...request(), unexpected: true }),
    /unsupported fields/
  );
  assert.throws(
    () => normalizeAdmissionRequest({
      ...request(),
      record: { root: `sha256:${"A".repeat(64)}`, kind: "profile/version", hcp1_pack: pack }
    }),
    /lowercase SHA-256 root/
  );
  assert.throws(
    () => normalizeAdmissionRequest(request("negotiation/offer")),
    /unsupported admitted record kind/
  );
  assert.throws(() => parseHcp1Pack("HCP1:0:"), /cell count/);
  assert.throws(() => parseHcp1Pack("not-a-pack"), /invalid header/);
  assert.throws(
    () => parseHcp1Pack(`HCP1:129:${"x".repeat(20)}`),
    /cell count/
  );
});
