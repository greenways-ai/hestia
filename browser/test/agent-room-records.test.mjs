import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentProfile,
  createRoomEpochKey,
  generateAgentKey
} from "../src/agent-protocol.js";
import {
  createAdmissionProofBundle,
  createDocumentAttachmentBundle,
  createDocumentVersionBundle,
  createMessageIntentBundle,
  createRoomInviteBundle,
  createRoomVersion,
  roomActivityPolicyRoots,
  roomAdmissionProofPlan,
  roomCapabilityPlan,
  sealRoomMessageBundle,
  verifyRoomVersion
} from "../src/agent-room-records.js";

async function profile(profileId, name) {
  const rootKey = await generateAgentKey();
  const operationalKey = await generateAgentKey();
  const created = await createAgentProfile({
    profileId,
    name,
    rootKey,
    operationalKey,
    validUntil: "2099-01-01T00:00:00.000Z"
  });
  return { ...created, rootKey, operationalKey };
}

function roots(bundle) {
  return new Set(bundle.hcv1Cells.map(({ root }) => `sha256:${root}`));
}

test("room genesis bundles its pinned policy and kernel cells", async () => {
  const host = await profile("profile:room-host", "Room host");
  const room = await createRoomVersion({
    roomId: "room:canonical",
    hostProfileRecord: host.record,
    signingKey: host.operationalKey
  });

  const body = await verifyRoomVersion({
    roomRecord: room.record,
    signerPublicKey: host.operationalKey.publicKey
  });
  assert.equal(body.sequence, 1);
  assert.equal(body.previous_room_root, null);
  assert.equal(body.acceptance_mode, "human-required");
  assert.ok(roots(room.admission).has(room.policyRoot));
  assert.ok(roots(room.admission).has(room.kernelRoot));
  assert.match(room.admission.hcp1Pack, /^HCP1:\d+:/);
});

test("invitation and member proof bundles carry transient commitment cells", async () => {
  const host = await profile("profile:invite-host", "Invite host");
  const guest = await profile("profile:invite-guest", "Invite guest");
  const room = await createRoomVersion({
    roomId: "room:invite",
    hostProfileRecord: host.record,
    signingKey: host.operationalKey
  });
  const capability = new Uint8Array(32).fill(17);
  const invitation = await createRoomInviteBundle({
    roomId: room.record.body.room_id,
    hostProfileRecord: host.record,
    hostOperationalKey: host.operationalKey,
    capability,
    expiresAt: "2099-01-01T00:00:00.000Z"
  });
  const proof = await createAdmissionProofBundle({
    inviteRecord: invitation.record,
    capability,
    guestProfileRecord: guest.record,
    guestOperationalKey: guest.operationalKey
  });

  assert.equal(
    invitation.record.body.capability_commitment,
    invitation.capabilityPlan.root
  );
  assert.ok(roots(invitation.admission).has(invitation.capabilityPlan.root));
  assert.equal(proof.record.body.capability_proof, proof.proofPlan.root);
  assert.ok(roots(proof.admission).has(proof.proofPlan.root));

  assert.equal(
    (await roomCapabilityPlan(capability, invitation.record.body.invite_id)).root,
    invitation.capabilityPlan.root
  );
  assert.equal(
    (await roomAdmissionProofPlan({
      capability,
      inviteRoot: invitation.record.root,
      guestProfileRoot: guest.record.root
    })).root,
    proof.proofPlan.root
  );
});

test("document attachment bundles the nested signed version and content graph", async () => {
  const host = await profile("profile:document-host", "Document host");
  const room = await createRoomVersion({
    roomId: "room:documents",
    hostProfileRecord: host.record,
    signingKey: host.operationalKey
  });
  const document = await createDocumentVersionBundle({
    documentId: "document:brief",
    content: "Review this signed brief.",
    authorProfileId: host.record.body.profile_id,
    signingKey: host.operationalKey,
    createdAt: "2026-08-04T00:00:00.000Z"
  });
  const attachment = await createDocumentAttachmentBundle({
    roomRecord: room.record,
    documentVersion: document,
    attachedByProfileRecord: host.record,
    signingKey: host.operationalKey
  });
  const activityPolicies = await roomActivityPolicyRoots();
  const packed = roots(attachment.admission);

  assert.equal(attachment.record.body.room_root, room.record.root);
  assert.equal(attachment.record.body.document_root, document.record.root);
  assert.equal(attachment.record.body.document_policy_root, activityPolicies.documentPolicyRoot);
  assert.equal(attachment.record.body.attached_by_profile_root, host.record.root);
  assert.ok(packed.has(document.record.root));
  assert.ok(packed.has(document.contentRoot));
  assert.ok(packed.has(activityPolicies.documentPolicyRoot));
});

test("message intent bundles a signed ciphertext envelope and delivery policy", async () => {
  const host = await profile("profile:message-host", "Message host");
  const room = await createRoomVersion({
    roomId: "room:messages",
    hostProfileRecord: host.record,
    signingKey: host.operationalKey
  });
  const epochKey = await createRoomEpochKey();
  const message = await sealRoomMessageBundle({
    roomId: room.record.body.room_id,
    epoch: 1,
    senderProfileId: host.record.body.profile_id,
    plaintext: "The signed room message is ready.",
    epochKey,
    signingKey: host.operationalKey,
    sentAt: "2026-08-04T00:01:00.000Z",
    messageId: "message:one"
  });
  const intent = await createMessageIntentBundle({
    roomRecord: room.record,
    message,
    senderProfileRecord: host.record,
    signingKey: host.operationalKey
  });
  const activityPolicies = await roomActivityPolicyRoots();
  const packed = roots(intent.admission);

  assert.equal(intent.record.body.room_root, room.record.root);
  assert.equal(intent.record.body.membership_epoch, 1);
  assert.equal(intent.record.body.sender_profile_root, host.record.root);
  assert.equal(intent.record.body.envelope_root, message.record.root);
  assert.equal(intent.record.body.ciphertext_root, message.ciphertextPlan.root);
  assert.equal(
    intent.record.body.delivery_policy_root,
    activityPolicies.messageDeliveryPolicyRoot
  );
  assert.ok(packed.has(message.record.root));
  assert.ok(packed.has(message.ciphertextPlan.root));
  assert.ok(packed.has(activityPolicies.messageDeliveryPolicyRoot));
});

test("room capability plans reject malformed secrets", async () => {
  await assert.rejects(
    () => roomCapabilityPlan(new Uint8Array(31), "invite:bad"),
    /32 bytes/
  );
});
