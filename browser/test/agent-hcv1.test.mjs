import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeHcv1Value,
  hcv1KeyFingerprint,
  hcv1ValueRoot,
  signHcv1AgentRecord,
  verifyExactHcv1Acceptance,
  verifyHcv1AgentRecord
} from "../src/agent-hcv1.js";
import { generateAgentKey } from "../src/agent-protocol.js";

async function signedProfile(name) {
  const rootKey = await generateAgentKey();
  const operationalKey = await generateAgentKey();
  const profileId = `profile:${name.toLowerCase().replaceAll(" ", "-")}`;
  const delegation = await signHcv1AgentRecord("profile/key-delegation", {
    delegation_id: `delegation:${profileId}`,
    issuer_profile_id: profileId,
    issuer_key: rootKey.id,
    subject_key: operationalKey.id,
    subject_public_jwk: operationalKey.publicJwk,
    purposes: ["room.join", "room.message", "negotiation.propose"],
    scope: { profile_id: profileId },
    valid_from: "2026-08-04T00:00:00.000Z",
    valid_until: "2099-01-01T00:00:00.000Z",
    revocation_root: null
  }, rootKey);
  const record = await signHcv1AgentRecord("profile/version", {
    profile_id: profileId,
    sequence: 1,
    previous_profile_root: null,
    name,
    profile_kind: "agent",
    root_key: { id: rootKey.id, public_jwk: rootKey.publicJwk },
    operational_key: { id: operationalKey.id, public_jwk: operationalKey.publicJwk },
    delegation
  }, rootKey);
  return { record, delegation, rootKey, operationalKey };
}

test("canonical maps are ordered by complete HCV0 key bytes", async () => {
  const left = await encodeHcv1Value({ beta: 2, alpha: 1 });
  const right = await encodeHcv1Value({ alpha: 1, beta: 2 });
  assert.equal(left.root, right.root);
  assert.equal(left.cell.payload_hex, right.cell.payload_hex);
});

test("signs and verifies a native HCV0 profile with an HCP0 pack", async () => {
  const profile = await signedProfile("Host Agent");
  const body = await verifyHcv1AgentRecord(profile.record, profile.rootKey.publicKey);
  assert.equal(body.name, "Host Agent");
  assert.match(profile.record.body_root, /^sha256:[0-9a-f]{64}$/);
  assert.match(profile.record.root, /^sha256:[0-9a-f]{64}$/);
  assert.match(profile.record.hcp1_pack, /^HCP0:[1-9][0-9]*:/);
  assert.ok(profile.record.hcv1_cells.some(({ type_tag }) => type_tag === 14));
  assert.ok(profile.record.hcv1_cells.some(({ type_tag }) => type_tag === 6));

  const tampered = structuredClone(profile.record);
  tampered.body.name = "Substituted Agent";
  await assert.rejects(
    () => verifyHcv1AgentRecord(tampered, profile.rootKey.publicKey),
    /body root mismatch/
  );
});

test("derives portable HCV0 key fingerprints and value roots", async () => {
  const key = await generateAgentKey();
  const fingerprint = await hcv1KeyFingerprint(key.publicJwk);
  const approval = await hcv1ValueRoot({
    decision: "approve",
    subject: "offer:example"
  });
  assert.match(fingerprint, /^ed25519:[0-9a-f]{64}$/);
  assert.match(approval.root, /^sha256:[0-9a-f]{64}$/);
  assert.match(approval.hcp1_pack, /^HCP0:/);
});

test("HCV0 acceptance binds the exact signed offer root", async () => {
  const host = await signedProfile("Host Agent");
  const guest = await signedProfile("External Agent");
  const offer = await signHcv1AgentRecord("negotiation/offer", {
    offer_id: "offer:review",
    room_id: "room:review",
    terms: "Review the document for AUD 300 by Friday.",
    offered_by: guest.record.body.profile_id,
    supersedes: null,
    valid_until: "2099-01-01T00:00:00.000Z",
    authority_root: guest.delegation.root
  }, guest.operationalKey);
  const approval = await hcv1ValueRoot({
    decision: "approve",
    offer_root: offer.root,
    approver_profile_id: host.record.body.profile_id
  });
  const acceptance = await signHcv1AgentRecord("negotiation/acceptance", {
    offer_root: offer.root,
    accepted_by: host.record.body.profile_id,
    human_approval_root: approval.root,
    accepted_at: "2026-08-04T00:10:00.000Z",
    authority_root: host.delegation.root
  }, host.operationalKey);

  const verified = await verifyExactHcv1Acceptance({
    offerRecord: offer,
    offerPublicKey: guest.operationalKey.publicKey,
    acceptanceRecord: acceptance,
    acceptancePublicKey: host.operationalKey.publicKey
  });
  assert.equal(verified.offer_root, offer.root);

  const substituted = await signHcv1AgentRecord("negotiation/offer", {
    offer_id: "offer:substituted",
    room_id: "room:review",
    terms: "Review a different document for AUD 3,000.",
    offered_by: guest.record.body.profile_id,
    supersedes: offer.root,
    valid_until: "2099-01-01T00:00:00.000Z",
    authority_root: guest.delegation.root
  }, guest.operationalKey);
  await assert.rejects(() => verifyExactHcv1Acceptance({
    offerRecord: substituted,
    offerPublicKey: guest.operationalKey.publicKey,
    acceptanceRecord: acceptance,
    acceptancePublicKey: host.operationalKey.publicKey
  }), /exact offer root/);
});
