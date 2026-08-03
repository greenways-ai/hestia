import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentProfile,
  generateAgentKey
} from "../src/agent-protocol.js";
import {
  createAdmissionProofBundle,
  createRoomInviteBundle,
  createRoomVersion,
  roomAdmissionProofPlan,
  roomCapabilityPlan,
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

test("room capability plans reject malformed secrets", async () => {
  await assert.rejects(
    () => roomCapabilityPlan(new Uint8Array(31), "invite:bad"),
    /32 bytes/
  );
});
