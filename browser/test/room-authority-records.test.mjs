import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentProfile,
  generateAgentKey,
  signAgentRecord
} from "../src/agent-protocol.js";
import { createRoomVersion } from "../src/agent-room-records.js";
import {
  ROOM_INVOCATION_PROTOCOL,
  authorizeRoomInvocation
} from "../src/room-authority.js";
import {
  projectVerifiedMembership,
  projectVerifiedRoom
} from "../src/room-authority-projections.js";
import {
  RoomAuthorityRecordError,
  createRoomApplicationGrant,
  createRoomApplicationGrantRevocation,
  createRoomSourceMandate,
  createRoomSourceMandateRevocation,
  verifyRoomApplicationGrant,
  verifyRoomSourceMandate
} from "../src/room-authority-records.js";
import {
  RoomAuthoritySourceProjectionError,
  projectVerifiedRoomApplicationGrant,
  projectVerifiedSourceMandate
} from "../src/room-authority-source-projections.js";

const GOVERNANCE_ROOT = `sha256:${"a".repeat(64)}`;
const ACTIVITY_ROOT = `sha256:${"b".repeat(64)}`;
const ARGUMENTS_ROOT = `sha256:${"c".repeat(64)}`;
const MEMBERSHIP_EPOCH = 2;
const POLICY_REVISION = 4;
const VALID_FROM = "2026-08-01T00:00:00.000Z";
const VALID_UNTIL = "2026-09-01T00:00:00.000Z";
const OBSERVED_AT = "2026-08-13T00:00:00.000Z";
const REVOKED_AT = "2026-08-12T00:00:00.000Z";

const APPLICATION = Object.freeze({
  appId: "greenways.chat",
  version: "0.1.0",
  publisherId: "greenways-ai",
  manifestDigest: `sha256:${"d".repeat(64)}`,
  lockDigest: `sha256:${"e".repeat(64)}`,
  approvalDigest: `sha256:${"f".repeat(64)}`
});
const LIMITS = Object.freeze({
  requestsPerDay: 20,
  maxInputBytes: 20_000,
  maxOutputBytes: 100_000,
  maxTimeoutMs: 86_400_000
});

async function profile(profileId, name, purposes) {
  const rootKey = await generateAgentKey();
  const operationalKey = await generateAgentKey();
  const created = await createAgentProfile({
    profileId,
    name,
    rootKey,
    operationalKey,
    purposes,
    validUntil: "2099-01-01T00:00:00.000Z"
  });
  return { ...created, rootKey, operationalKey };
}

async function authorityFixture() {
  const host = await profile("profile:alice", "Alice", [
    "profile.update",
    "room.create",
    "room.invite",
    "room.join",
    "room.message"
  ]);
  const guest = await profile("profile:bob", "Bob", [
    "profile.update",
    "room.join",
    "room.app.invoke"
  ]);
  const room = await createRoomVersion({
    roomId: "room/design-studio",
    hostProfileRecord: host.record,
    signingKey: host.operationalKey
  });
  const membershipRecord = await signAgentRecord("room/membership", {
    room_root: room.record.root,
    member_profile_root: guest.record.root,
    role: "member",
    purposes: ["room.app.invoke"],
    status: "active",
    joined_epoch: MEMBERSHIP_EPOCH,
    revoked_epoch: null,
    delegation_root: guest.delegation.root
  }, host.operationalKey);

  const roomProjection = await projectVerifiedRoom({
    roomRecord: room.record,
    signerPublicKey: host.operationalKey.publicKey,
    expectedSignerKeyId: host.operationalKey.id,
    governanceRoot: GOVERNANCE_ROOT,
    membershipEpoch: MEMBERSHIP_EPOCH,
    policyRevision: POLICY_REVISION,
    activityHeadRoot: ACTIVITY_ROOT,
    status: "open"
  });
  const membershipProjection = await projectVerifiedMembership({
    membershipRecord,
    signerPublicKey: host.operationalKey.publicKey,
    expectedSignerKeyId: host.operationalKey.id,
    roomProjection,
    memberNodeId: "node/bob-macbook",
    validFrom: VALID_FROM,
    validUntil: VALID_UNTIL
  });

  const sourceMandateRecord = await createRoomSourceMandate({
    mandateId: "source-mandate/alice-chatgpt-browser",
    roomRecord: room.record,
    governanceRoot: GOVERNANCE_ROOT,
    issuedByProfileRoot: host.record.root,
    authorityRoot: host.delegation.root,
    sourceId: "source/alice-chatgpt-browser",
    sourceNodeId: "node/alice-macbook",
    implementation: "greenways.chatgpt-web",
    application: APPLICATION,
    operations: ["conversation.create", "message.submit", "response.read"],
    membershipEpoch: MEMBERSHIP_EPOCH,
    policyRevision: POLICY_REVISION,
    requiresUserInteraction: true,
    validFrom: VALID_FROM,
    validUntil: VALID_UNTIL,
    signingKey: host.operationalKey
  });
  const sourceMandateProjection = await projectVerifiedSourceMandate({
    mandateRecord: sourceMandateRecord,
    signerPublicKey: host.operationalKey.publicKey,
    expectedSignerKeyId: host.operationalKey.id,
    roomProjection
  });

  const grantRecord = await createRoomApplicationGrant({
    grantId: "room-application-grant/bob-chat",
    roomRecord: room.record,
    governanceRoot: GOVERNANCE_ROOT,
    issuedByProfileRoot: host.record.root,
    authorityRoot: host.delegation.root,
    memberProfileRoot: guest.record.root,
    memberNodeId: "node/bob-macbook",
    sourceMandateRecord,
    application: APPLICATION,
    operations: ["message.submit", "response.read"],
    limits: LIMITS,
    membershipEpoch: MEMBERSHIP_EPOCH,
    policyRevision: POLICY_REVISION,
    validFrom: VALID_FROM,
    validUntil: VALID_UNTIL,
    signingKey: host.operationalKey
  });
  const grantProjection = await projectVerifiedRoomApplicationGrant({
    grantRecord,
    signerPublicKey: host.operationalKey.publicKey,
    expectedSignerKeyId: host.operationalKey.id,
    roomProjection,
    membershipProjection,
    sourceMandateProjection
  });

  const invocation = {
    protocol: ROOM_INVOCATION_PROTOCOL,
    requestId: "room-request/0001",
    roomId: roomProjection.roomId,
    governanceRoot: roomProjection.governanceRoot,
    membershipRoot: membershipProjection.membershipRoot,
    memberProfileRoot: membershipProjection.memberProfileRoot,
    memberNodeId: membershipProjection.memberNodeId,
    sourceId: sourceMandateProjection.sourceId,
    sourceMandateRoot: sourceMandateProjection.mandateRoot,
    grantRoot: grantProjection.grantRoot,
    application: APPLICATION,
    operation: "message.submit",
    argumentsDigest: ARGUMENTS_ROOT,
    inputBytes: 1200,
    maxOutputBytes: 50_000,
    timeoutMs: 3_600_000,
    createdAt: "2026-08-12T23:59:00.000Z",
    expiresAt: "2026-08-13T01:00:00.000Z"
  };

  return {
    host,
    guest,
    room,
    membershipRecord,
    roomProjection,
    membershipProjection,
    sourceMandateRecord,
    sourceMandateProjection,
    grantRecord,
    grantProjection,
    invocation
  };
}

test("canonical source and grant records authorise one exact room invocation", async () => {
  const fixture = await authorityFixture();
  const decision = authorizeRoomInvocation({
    room: fixture.roomProjection,
    membership: fixture.membershipProjection,
    sourceMandate: fixture.sourceMandateProjection,
    grant: fixture.grantProjection,
    invocation: fixture.invocation,
    observedAt: OBSERVED_AT
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "allowed");
  assert.equal(decision.requiresUserInteraction, true);
  assert.equal(decision.sourceMandateRoot, fixture.sourceMandateRecord.root);
  assert.equal(decision.grantRoot, fixture.grantRecord.root);
  assert.match(fixture.sourceMandateRecord.root, /^sha256:[0-9a-f]{64}$/);
  assert.match(fixture.sourceMandateRecord.hcp1_pack, /^HCP0:/);
  assert.match(fixture.grantRecord.root, /^sha256:[0-9a-f]{64}$/);
  assert.match(fixture.grantRecord.hcp1_pack, /^HCP0:/);

  const sourceBody = await verifyRoomSourceMandate(
    fixture.sourceMandateRecord,
    fixture.host.operationalKey.publicKey
  );
  const grantBody = await verifyRoomApplicationGrant(
    fixture.grantRecord,
    fixture.host.operationalKey.publicKey
  );
  assert.equal(sourceBody.application.approval_digest, APPLICATION.approvalDigest);
  assert.equal(grantBody.source_mandate_root, fixture.sourceMandateRecord.root);
});

test("an exact source mandate revocation denies the next invocation", async () => {
  const fixture = await authorityFixture();
  const revocationRecord = await createRoomSourceMandateRevocation({
    revocationId: "source-mandate-revocation/alice-chatgpt-browser",
    roomRecord: fixture.room.record,
    governanceRoot: GOVERNANCE_ROOT,
    mandateRecord: fixture.sourceMandateRecord,
    revokedByProfileRoot: fixture.host.record.root,
    authorityRoot: fixture.host.delegation.root,
    reason: "host-disabled-source",
    revokedAt: REVOKED_AT,
    signingKey: fixture.host.operationalKey
  });
  const revokedSource = await projectVerifiedSourceMandate({
    mandateRecord: fixture.sourceMandateRecord,
    signerPublicKey: fixture.host.operationalKey.publicKey,
    expectedSignerKeyId: fixture.host.operationalKey.id,
    roomProjection: fixture.roomProjection,
    revocationRecord,
    revocationSignerPublicKey: fixture.host.operationalKey.publicKey,
    expectedRevocationSignerKeyId: fixture.host.operationalKey.id
  });

  const decision = authorizeRoomInvocation({
    room: fixture.roomProjection,
    membership: fixture.membershipProjection,
    sourceMandate: revokedSource,
    grant: fixture.grantProjection,
    invocation: fixture.invocation,
    observedAt: OBSERVED_AT
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "source-inactive");
});

test("an exact room application grant revocation denies the next invocation", async () => {
  const fixture = await authorityFixture();
  const revocationRecord = await createRoomApplicationGrantRevocation({
    revocationId: "room-application-grant-revocation/bob-chat",
    roomRecord: fixture.room.record,
    governanceRoot: GOVERNANCE_ROOT,
    grantRecord: fixture.grantRecord,
    revokedByProfileRoot: fixture.host.record.root,
    authorityRoot: fixture.host.delegation.root,
    reason: "member-access-revoked",
    revokedAt: REVOKED_AT,
    signingKey: fixture.host.operationalKey
  });
  const revokedGrant = await projectVerifiedRoomApplicationGrant({
    grantRecord: fixture.grantRecord,
    signerPublicKey: fixture.host.operationalKey.publicKey,
    expectedSignerKeyId: fixture.host.operationalKey.id,
    roomProjection: fixture.roomProjection,
    membershipProjection: fixture.membershipProjection,
    sourceMandateProjection: fixture.sourceMandateProjection,
    revocationRecord,
    revocationSignerPublicKey: fixture.host.operationalKey.publicKey,
    expectedRevocationSignerKeyId: fixture.host.operationalKey.id
  });

  const decision = authorizeRoomInvocation({
    room: fixture.roomProjection,
    membership: fixture.membershipProjection,
    sourceMandate: fixture.sourceMandateProjection,
    grant: revokedGrant,
    invocation: fixture.invocation,
    observedAt: OBSERVED_AT
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "grant-inactive");
});

test("a room grant cannot broaden its source mandate", async () => {
  const fixture = await authorityFixture();
  await assert.rejects(
    () => createRoomApplicationGrant({
      grantId: "room-application-grant/broadened",
      roomRecord: fixture.room.record,
      governanceRoot: GOVERNANCE_ROOT,
      issuedByProfileRoot: fixture.host.record.root,
      authorityRoot: fixture.host.delegation.root,
      memberProfileRoot: fixture.guest.record.root,
      memberNodeId: "node/bob-macbook",
      sourceMandateRecord: fixture.sourceMandateRecord,
      application: APPLICATION,
      operations: ["conversation.delete", "message.submit"],
      limits: LIMITS,
      membershipEpoch: MEMBERSHIP_EPOCH,
      policyRevision: POLICY_REVISION,
      validFrom: VALID_FROM,
      validUntil: VALID_UNTIL,
      signingKey: fixture.host.operationalKey
    }),
    (error) => error instanceof RoomAuthorityRecordError
      && error.code === "source-operation-denied"
  );
});

test("projection rejects member and source substitution", async () => {
  const fixture = await authorityFixture();
  const otherMember = {
    ...fixture.membershipProjection,
    memberProfileRoot: `sha256:${"1".repeat(64)}`
  };
  await assert.rejects(
    () => projectVerifiedRoomApplicationGrant({
      grantRecord: fixture.grantRecord,
      signerPublicKey: fixture.host.operationalKey.publicKey,
      expectedSignerKeyId: fixture.host.operationalKey.id,
      roomProjection: fixture.roomProjection,
      membershipProjection: otherMember,
      sourceMandateProjection: fixture.sourceMandateProjection
    }),
    (error) => error instanceof RoomAuthoritySourceProjectionError
      && error.code === "grant-member-mismatch"
  );

  const changedSource = {
    ...fixture.sourceMandateProjection,
    mandateRoot: `sha256:${"2".repeat(64)}`
  };
  await assert.rejects(
    () => projectVerifiedRoomApplicationGrant({
      grantRecord: fixture.grantRecord,
      signerPublicKey: fixture.host.operationalKey.publicKey,
      expectedSignerKeyId: fixture.host.operationalKey.id,
      roomProjection: fixture.roomProjection,
      membershipProjection: fixture.membershipProjection,
      sourceMandateProjection: changedSource
    }),
    (error) => error instanceof RoomAuthoritySourceProjectionError
      && error.code === "grant-source-mismatch"
  );
});

test("canonical authority constructors reject unknown secret-shaped input", async () => {
  const fixture = await authorityFixture();
  await assert.rejects(
    () => createRoomSourceMandate({
      mandateId: "source-mandate/secret-shaped",
      roomRecord: fixture.room.record,
      governanceRoot: GOVERNANCE_ROOT,
      issuedByProfileRoot: fixture.host.record.root,
      authorityRoot: fixture.host.delegation.root,
      sourceId: "source/secret-shaped",
      sourceNodeId: "node/alice-macbook",
      implementation: "greenways.chatgpt-web",
      application: APPLICATION,
      operations: ["message.submit"],
      membershipEpoch: MEMBERSHIP_EPOCH,
      policyRevision: POLICY_REVISION,
      requiresUserInteraction: true,
      validFrom: VALID_FROM,
      validUntil: VALID_UNTIL,
      signingKey: fixture.host.operationalKey,
      browserCookie: "must-not-cross-the-boundary"
    }),
    (error) => error instanceof RoomAuthorityRecordError
      && error.code === "invalid-options"
  );
});

test("tampered canonical source records fail signature/root verification", async () => {
  const fixture = await authorityFixture();
  const tampered = structuredClone(fixture.sourceMandateRecord);
  tampered.body.source_id = "source/substituted";
  await assert.rejects(
    () => projectVerifiedSourceMandate({
      mandateRecord: tampered,
      signerPublicKey: fixture.host.operationalKey.publicKey,
      expectedSignerKeyId: fixture.host.operationalKey.id,
      roomProjection: fixture.roomProjection
    }),
    (error) => error instanceof RoomAuthoritySourceProjectionError
      && error.code === "source-mandate-verification-failed"
  );
});
