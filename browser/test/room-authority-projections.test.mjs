import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentProfile,
  generateAgentKey,
  signAgentRecord
} from "../src/agent-protocol.js";
import { createRoomVersion } from "../src/agent-room-records.js";
import {
  RoomAuthorityProjectionError,
  projectVerifiedMembership,
  projectVerifiedRoom
} from "../src/room-authority-projections.js";

const VALID_FROM = "2026-08-01T00:00:00.000Z";
const VALID_UNTIL = "2026-09-01T00:00:00.000Z";

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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function signedMembership({
  roomRoot,
  memberProfileRoot,
  delegationRoot,
  signingKey,
  purposes = ["room.app.invoke", "room.message"],
  status = "active",
  joinedEpoch = 2,
  revokedEpoch = null
}) {
  return signAgentRecord("room/membership", {
    room_root: roomRoot,
    member_profile_root: memberProfileRoot,
    role: "member",
    purposes,
    status,
    joined_epoch: joinedEpoch,
    revoked_epoch: revokedEpoch,
    delegation_root: delegationRoot
  }, signingKey);
}

async function fixture() {
  const host = await profile("profile:projection-host", "Projection host");
  const guest = await profile("profile:projection-guest", "Projection guest");
  const room = await createRoomVersion({
    roomId: "room:projection",
    hostProfileRecord: host.record,
    signingKey: host.operationalKey
  });
  const roomProjection = await projectVerifiedRoom({
    roomRecord: room.record,
    signerPublicKey: host.operationalKey.publicKey,
    governanceRoot: room.record.root,
    membershipEpoch: 2,
    policyRevision: 1,
    activityHeadRoot: null,
    status: "open",
    expectedSignerKeyId: host.operationalKey.id
  });
  const membershipRecord = await signedMembership({
    roomRoot: room.record.root,
    memberProfileRoot: guest.record.root,
    delegationRoot: guest.record.body.delegation.root,
    signingKey: host.operationalKey
  });
  const membershipProjection = await projectVerifiedMembership({
    membershipRecord,
    signerPublicKey: host.operationalKey.publicKey,
    roomProjection,
    memberNodeId: "node/guest-macbook",
    validFrom: VALID_FROM,
    validUntil: VALID_UNTIL,
    revokedAt: null,
    expectedSignerKeyId: host.operationalKey.id
  });
  return {
    host,
    guest,
    room,
    roomProjection,
    membershipRecord,
    membershipProjection
  };
}

const fixturePromise = fixture();

test("verified HCV1 room and membership records preserve exact roots", async () => {
  const {
    guest,
    room,
    roomProjection,
    membershipRecord,
    membershipProjection
  } = await fixturePromise;

  assert.equal(roomProjection.roomId, room.record.body.room_id);
  assert.equal(roomProjection.roomRecordRoot, room.record.root);
  assert.equal(roomProjection.governanceRoot, room.record.root);
  assert.equal(roomProjection.hostProfileRoot, room.record.body.host_profile_root);
  assert.equal(membershipProjection.roomId, roomProjection.roomId);
  assert.equal(membershipProjection.membershipRoot, membershipRecord.root);
  assert.equal(membershipProjection.memberProfileRoot, guest.record.root);
  assert.deepEqual(
    membershipProjection.purposes,
    ["room.app.invoke", "room.message"]
  );
  assert.equal(Object.isFrozen(roomProjection), true);
  assert.equal(Object.isFrozen(membershipProjection), true);
  assert.equal(Object.isFrozen(membershipProjection.purposes), true);
});

test("changed signed room or membership bytes fail verification", async () => {
  const {
    host,
    room,
    roomProjection,
    membershipRecord
  } = await fixturePromise;

  const changedRoom = clone(room.record);
  changedRoom.body.acceptance_mode = "automatic";
  await assert.rejects(
    () => projectVerifiedRoom({
      roomRecord: changedRoom,
      signerPublicKey: host.operationalKey.publicKey,
      governanceRoot: room.record.root,
      membershipEpoch: 2,
      policyRevision: 1,
      activityHeadRoot: null,
      status: "open",
      expectedSignerKeyId: host.operationalKey.id
    }),
    (error) => error instanceof RoomAuthorityProjectionError
      && error.code === "room-verification-failed"
  );

  const changedMembership = clone(membershipRecord);
  changedMembership.body.role = "owner";
  await assert.rejects(
    () => projectVerifiedMembership({
      membershipRecord: changedMembership,
      signerPublicKey: host.operationalKey.publicKey,
      roomProjection,
      memberNodeId: null,
      validFrom: VALID_FROM,
      validUntil: VALID_UNTIL,
      revokedAt: null,
      expectedSignerKeyId: host.operationalKey.id
    }),
    (error) => error instanceof RoomAuthorityProjectionError
      && error.code === "membership-verification-failed"
  );
});

test("membership projections reject cross-room and stale-epoch substitution", async () => {
  const { host, roomProjection, membershipRecord } = await fixturePromise;
  const otherRoot = `sha256:${"0".repeat(64)}`;

  await assert.rejects(
    () => projectVerifiedMembership({
      membershipRecord,
      signerPublicKey: host.operationalKey.publicKey,
      roomProjection: { ...roomProjection, roomRecordRoot: otherRoot },
      memberNodeId: null,
      validFrom: VALID_FROM,
      validUntil: VALID_UNTIL,
      revokedAt: null,
      expectedSignerKeyId: host.operationalKey.id
    }),
    (error) => error instanceof RoomAuthorityProjectionError
      && error.code === "room-membership-mismatch"
  );

  await assert.rejects(
    () => projectVerifiedMembership({
      membershipRecord,
      signerPublicKey: host.operationalKey.publicKey,
      roomProjection: { ...roomProjection, membershipEpoch: 1 },
      memberNodeId: null,
      validFrom: VALID_FROM,
      validUntil: VALID_UNTIL,
      revokedAt: null,
      expectedSignerKeyId: host.operationalKey.id
    }),
    (error) => error instanceof RoomAuthorityProjectionError
      && error.code === "membership-epoch-mismatch"
  );
});

test("canonical purposes are preserved and unsorted purposes are rejected", async () => {
  const { host, guest, room, roomProjection } = await fixturePromise;
  const membershipRecord = await signedMembership({
    roomRoot: room.record.root,
    memberProfileRoot: guest.record.root,
    delegationRoot: guest.record.body.delegation.root,
    signingKey: host.operationalKey,
    purposes: ["room.message", "room.app.invoke"]
  });

  await assert.rejects(
    () => projectVerifiedMembership({
      membershipRecord,
      signerPublicKey: host.operationalKey.publicKey,
      roomProjection,
      memberNodeId: null,
      validFrom: VALID_FROM,
      validUntil: VALID_UNTIL,
      revokedAt: null,
      expectedSignerKeyId: host.operationalKey.id
    }),
    /sorted and duplicate-free/
  );
});

test("revoked membership projections bind epoch and revocation time", async () => {
  const { host, guest, room, roomProjection } = await fixturePromise;
  const membershipRecord = await signedMembership({
    roomRoot: room.record.root,
    memberProfileRoot: guest.record.root,
    delegationRoot: guest.record.body.delegation.root,
    signingKey: host.operationalKey,
    status: "revoked",
    joinedEpoch: 1,
    revokedEpoch: 2
  });
  const projection = await projectVerifiedMembership({
    membershipRecord,
    signerPublicKey: host.operationalKey.publicKey,
    roomProjection,
    memberNodeId: null,
    validFrom: VALID_FROM,
    validUntil: VALID_UNTIL,
    revokedAt: "2026-08-12T00:00:00.000Z",
    expectedSignerKeyId: host.operationalKey.id
  });

  assert.equal(projection.membershipEpoch, 2);
  assert.equal(projection.revokedAt, "2026-08-12T00:00:00.000Z");

  await assert.rejects(
    () => projectVerifiedMembership({
      membershipRecord,
      signerPublicKey: host.operationalKey.publicKey,
      roomProjection,
      memberNodeId: null,
      validFrom: VALID_FROM,
      validUntil: VALID_UNTIL,
      revokedAt: null,
      expectedSignerKeyId: host.operationalKey.id
    }),
    (error) => error instanceof RoomAuthorityProjectionError
      && error.code === "invalid-membership-state"
  );
});

test("constructor options are closed and signer identity is exact", async () => {
  const { host, guest, room } = await fixturePromise;

  await assert.rejects(
    () => projectVerifiedRoom({
      roomRecord: room.record,
      signerPublicKey: host.operationalKey.publicKey,
      governanceRoot: room.record.root,
      membershipEpoch: 2,
      policyRevision: 1,
      activityHeadRoot: null,
      status: "open",
      expectedSignerKeyId: host.operationalKey.id,
      browserCookie: "must-not-cross-the-boundary"
    }),
    (error) => error instanceof RoomAuthorityProjectionError
      && error.code === "invalid-options"
  );

  await assert.rejects(
    () => projectVerifiedRoom({
      roomRecord: room.record,
      signerPublicKey: host.operationalKey.publicKey,
      governanceRoot: room.record.root,
      membershipEpoch: 2,
      policyRevision: 1,
      activityHeadRoot: null,
      status: "open",
      expectedSignerKeyId: guest.operationalKey.id
    }),
    (error) => error instanceof RoomAuthorityProjectionError
      && error.code === "signer-mismatch"
  );
});
