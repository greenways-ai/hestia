import assert from "node:assert/strict";
import test from "node:test";
import { createInvite, parseInvite } from "../src/invite.js";
import {
  createPeerIdentity,
  importCapabilityKey,
  importSigningPublicKey,
  signEnvelope,
  verifyEnvelope
} from "../src/protocol.js";
import { appendTranscript } from "../src/storage.js";

test("creates a capability only in the recovery URL fragment", () => {
  const invite = createInvite("https://hestia.example/anything", { mode: "single" });
  assert.equal(invite.url.pathname, "/recovery/");
  assert.equal(invite.url.search, "");
  const parsed = parseInvite(invite.url);
  assert.equal(parsed.ceremony, invite.ceremony);
  assert.equal(parsed.capability, invite.capability);
  assert.equal(parsed.mode, "single");
  const leaked = new URL(invite.url);
  leaked.searchParams.set("cap", invite.capability);
  assert.throws(() => parseInvite(leaked), /fragment/);
});

test("rejects legacy v1 invites with a recoverable error", () => {
  const legacy = "https://example.test/recovery/#v=1&ceremony=EkrNjvfMxQ1d47GsvePTDA&cap=3DGUDZ7eZdaCR8mS55Wt0nY71-3drcM6EZtyQVUhckg&mode=reusable";
  assert.throws(() => parseInvite(legacy), (error) => {
    assert.equal(error.code, "HESTIA_INVITE_V1");
    return true;
  });
});

test("authenticates and signs ceremony envelopes", async () => {
  const identity = await createPeerIdentity();
  const publicKey = await importSigningPublicKey(identity.publicKey);
  const capability = crypto.getRandomValues(new Uint8Array(32));
  const capabilityKey = await importCapabilityKey(capability);
  const envelope = await signEnvelope({
    protocol: "hestia-ceremony/1",
    type: "peer/state",
    ceremony_id: "ceremony",
    from: "peer-a",
    to: "peer-b",
    sequence: 1,
    nonce: "0123456789abcdef",
    payload: { ready: true }
  }, identity.privateKey, capabilityKey);
  assert.equal((await verifyEnvelope(envelope, publicKey, capabilityKey)).type, "peer/state");
  await assert.rejects(
    verifyEnvelope({ ...envelope, payload: { ready: false } }, publicKey, capabilityKey),
    /capability MAC/
  );
});

test("chains local transcript hashes", async () => {
  const record = { transcript: [] };
  await appendTranscript(record, "ceremony/joined", { mode: "reusable" });
  const first = record.transcript_head;
  await appendTranscript(record, "peer/authenticated", { peer: "peer-b" });
  assert.equal(record.transcript.length, 2);
  assert.notEqual(record.transcript_head, first);
  assert.equal(record.transcript[1].sequence, 2);
});
