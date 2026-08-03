import assert from "node:assert/strict";
import test from "node:test";
import {
  createAcceptance,
  createAdmissionProof,
  createAgentProfile,
  createDocumentVersion,
  createOffer,
  createRoomEpochKey,
  createRoomInvite,
  decodeRoomInvite,
  encodeRoomInvite,
  generateAgentKey,
  openRoomMessage,
  sealRoomMessage,
  valueRoot,
  verifyAcceptance,
  verifyAdmissionProof,
  verifyAgentProfile,
  verifyAgentRecord,
  verifyRoomInvite
} from "../src/agent-protocol.js";

async function profile(name) {
  const rootKey = await generateAgentKey();
  const operationalKey = await generateAgentKey();
  const created = await createAgentProfile({
    name,
    rootKey,
    operationalKey,
    validUntil: "2099-01-01T00:00:00.000Z"
  });
  return { ...created, rootKey, operationalKey };
}

test("creates a root-signed profile with a delegated Ed25519 operational key", async () => {
  const created = await profile("Host agent");
  const verified = await verifyAgentProfile(created.record);
  assert.equal(verified.body.name, "Host agent");
  assert.equal(verified.body.operational_key.id, created.operationalKey.id);
  assert.ok(verified.delegationBody.purposes.includes("room.invite"));

  const tampered = structuredClone(created.record);
  tampered.body.name = "Substituted agent";
  await assert.rejects(() => verifyAgentProfile(tampered), /root mismatch/);
});

test("admits an external agent only with a signed invite and capability proof", async () => {
  const host = await profile("Host agent");
  const guest = await profile("External agent");
  const invite = await createRoomInvite({
    roomId: "room:test",
    hostProfileRecord: host.record,
    hostOperationalKey: host.operationalKey,
    expiresAt: "2099-01-01T00:00:00.000Z"
  });
  const encoded = encodeRoomInvite(invite.record, invite.capability);
  const decoded = decodeRoomInvite(encoded);
  assert.equal(decoded.inviteRecord.root, invite.record.root);
  assert.deepEqual([...decoded.capability], [...invite.capability]);

  const proof = await createAdmissionProof({
    inviteRecord: invite.record,
    capability: invite.capability,
    guestProfileRecord: guest.record,
    guestOperationalKey: guest.operationalKey
  });
  const verified = await verifyAdmissionProof({
    proofRecord: proof,
    inviteRecord: invite.record,
    capability: invite.capability,
    hostProfileRecord: host.record,
    guestProfileRecord: guest.record,
    at: new Date("2026-08-04T00:00:00.000Z")
  });
  assert.equal(verified.invite.body.room_id, "room:test");
  assert.equal(verified.guest.body.profile_id, guest.record.body.profile_id);

  const wrongCapability = crypto.getRandomValues(new Uint8Array(32));
  await assert.rejects(() => verifyRoomInvite({
    inviteRecord: invite.record,
    capability: wrongCapability,
    hostProfileRecord: host.record,
    at: new Date("2026-08-04T00:00:00.000Z")
  }), /capability/);
});

test("encrypts a signed room message for one membership epoch", async () => {
  const guest = await profile("External agent");
  const epochKey = await createRoomEpochKey();
  const message = await sealRoomMessage({
    roomId: "room:test",
    epoch: 2,
    senderProfileId: guest.record.body.profile_id,
    plaintext: "The private terms are ready for review.",
    epochKey,
    signingKey: guest.operationalKey
  });
  const plaintext = await openRoomMessage({
    messageRecord: message,
    epochKey,
    senderPublicKey: guest.operationalKey.publicKey
  });
  assert.equal(plaintext, "The private terms are ready for review.");

  const tampered = structuredClone(message);
  const replacement = tampered.body.ciphertext.startsWith("A") ? "B" : "A";
  tampered.body.ciphertext = replacement + tampered.body.ciphertext.slice(1);
  await assert.rejects(() => openRoomMessage({
    messageRecord: tampered,
    epochKey,
    senderPublicKey: guest.operationalKey.publicKey
  }), /root mismatch/);
});

test("signs document versions and binds acceptance to the exact offer root", async () => {
  const host = await profile("Host agent");
  const guest = await profile("External agent");
  const document = await createDocumentVersion({
    documentId: "document:agreement",
    content: "Draft services agreement, version one.",
    authorProfileId: host.record.body.profile_id,
    signingKey: host.operationalKey
  });
  await verifyAgentRecord(
    document.record,
    host.operationalKey.publicKey,
    "document/version"
  );

  const offer = await createOffer({
    roomId: "room:test",
    terms: "Deliver the document review for AUD 300 by Friday.",
    offeredBy: guest.record.body.profile_id,
    signingKey: guest.operationalKey,
    validUntil: "2099-01-01T00:00:00.000Z"
  });
  const approvalRoot = await valueRoot("human/approval", {
    decision: "approve",
    offer_root: offer.record.root
  });
  const acceptance = await createAcceptance({
    offerRecord: offer.record,
    acceptedBy: host.record.body.profile_id,
    signingKey: host.operationalKey,
    humanApprovalRoot: approvalRoot
  });
  const verified = await verifyAcceptance({
    offerRecord: offer.record,
    offerPublicKey: guest.operationalKey.publicKey,
    acceptanceRecord: acceptance,
    acceptancePublicKey: host.operationalKey.publicKey
  });
  assert.equal(verified.offer_root, offer.record.root);

  const substituted = await createOffer({
    roomId: "room:test",
    terms: "Deliver a different service for AUD 3,000.",
    offeredBy: guest.record.body.profile_id,
    signingKey: guest.operationalKey,
    validUntil: "2099-01-01T00:00:00.000Z"
  });
  await assert.rejects(() => verifyAcceptance({
    offerRecord: substituted.record,
    offerPublicKey: guest.operationalKey.publicKey,
    acceptanceRecord: acceptance,
    acceptancePublicKey: host.operationalKey.publicKey
  }), /exact offer root/);
});
