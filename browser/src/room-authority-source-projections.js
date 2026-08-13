import {
  ROOM_APPLICATION_GRANT_PROJECTION_PROTOCOL,
  ROOM_SOURCE_MANDATE_PROJECTION_PROTOCOL,
  validateMembershipProjection,
  validateRoomApplicationGrantProjection,
  validateRoomProjection,
  validateSourceMandateProjection
} from "./room-authority.js";
import {
  canonicalOperationsAreSubset,
  projectCanonicalApplication,
  projectCanonicalLimits,
  sameCanonicalApplication,
  verifyRoomApplicationGrant,
  verifyRoomApplicationGrantRevocation,
  verifyRoomSourceMandate,
  verifyRoomSourceMandateRevocation
} from "./room-authority-records.js";

const ROOT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SIGNER_KEY_PATTERN = /^ed25519:[0-9a-f]{64}$/;
const SOURCE_OPTION_FIELDS = [
  "mandateRecord",
  "signerPublicKey",
  "roomProjection",
  "expectedSignerKeyId",
  "revocationRecord",
  "revocationSignerPublicKey",
  "expectedRevocationSignerKeyId"
];
const GRANT_OPTION_FIELDS = [
  "grantRecord",
  "signerPublicKey",
  "roomProjection",
  "membershipProjection",
  "sourceMandateProjection",
  "expectedSignerKeyId",
  "revocationRecord",
  "revocationSignerPublicKey",
  "expectedRevocationSignerKeyId"
];

export class RoomAuthoritySourceProjectionError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = "RoomAuthoritySourceProjectionError";
    this.code = code;
    if (cause !== null) this.cause = cause;
  }
}

function fail(code, message, cause = null) {
  throw new RoomAuthoritySourceProjectionError(code, message, cause);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNoUnknownFields(value, name, allowedFields) {
  if (!isPlainObject(value)) {
    fail("invalid-options", `${name} options must be one object`);
  }
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    fail("invalid-options", `${name} options contain unknown fields: ${unknown.join(", ")}`);
  }
}

function assertRoot(value, name) {
  if (typeof value !== "string" || !ROOT_PATTERN.test(value)) {
    fail("invalid-record", `${name} must be one lowercase SHA-256 root`);
  }
  return value;
}

function assertSignerKey(value, name) {
  if (typeof value !== "string" || !SIGNER_KEY_PATTERN.test(value)) {
    fail("invalid-record", `${name} must be one lowercase Ed25519 key identifier`);
  }
  return value;
}

function assertSigner(record, expectedSignerKeyId, name) {
  assertSignerKey(record?.signer_key, `${name}.signer_key`);
  if (expectedSignerKeyId !== null) {
    assertSignerKey(expectedSignerKeyId, `${name}.expectedSignerKeyId`);
    if (record.signer_key !== expectedSignerKeyId) {
      fail("signer-mismatch", `${name} signer does not match the expected key`);
    }
  }
}

function instant(value, name) {
  if (typeof value !== "string" || value.length === 0 || value.length > 40) {
    fail("invalid-record", `${name} must be a canonical UTC instant`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)
      || new Date(milliseconds).toISOString() !== value) {
    fail("invalid-record", `${name} must be a canonical UTC instant`);
  }
  return milliseconds;
}

function sameApplicationProjection(left, right) {
  return left.appId === right.appId
    && left.version === right.version
    && left.publisherId === right.publisherId
    && left.manifestDigest === right.manifestDigest
    && left.lockDigest === right.lockDigest
    && left.approvalDigest === right.approvalDigest;
}

function canonicalApplicationFromProjection(value) {
  return {
    app_id: value.appId,
    version: value.version,
    publisher_id: value.publisherId,
    manifest_digest: value.manifestDigest,
    lock_digest: value.lockDigest,
    approval_digest: value.approvalDigest
  };
}

function operationsSubset(candidate, allowed) {
  const allowedSet = new Set(allowed);
  return candidate.every((operation) => allowedSet.has(operation));
}

async function sourceRevokedAt({
  revocationRecord,
  revocationSignerPublicKey,
  expectedRevocationSignerKeyId,
  room,
  mandateRecord,
  validFrom
}) {
  if (revocationRecord === null) {
    if (revocationSignerPublicKey !== null || expectedRevocationSignerKeyId !== null) {
      fail("invalid-options", "revocation signer data requires a revocation record");
    }
    return null;
  }
  if (revocationSignerPublicKey === null) {
    fail("invalid-options", "a source revocation signer public key is required");
  }
  assertSigner(
    revocationRecord,
    expectedRevocationSignerKeyId,
    "sourceRevocationRecord"
  );
  let body;
  try {
    body = await verifyRoomSourceMandateRevocation(
      revocationRecord,
      revocationSignerPublicKey
    );
  } catch (error) {
    fail("source-revocation-verification-failed", "source revocation verification failed", error);
  }
  if (body.room_root !== room.roomRecordRoot
      || body.governance_root !== room.governanceRoot
      || body.mandate_root !== mandateRecord.root) {
    fail("source-revocation-mismatch", "source revocation targets different authority");
  }
  if (instant(body.revoked_at, "sourceRevocation.revoked_at")
      < instant(validFrom, "sourceMandate.validFrom")) {
    fail("source-revocation-mismatch", "source revocation predates the mandate");
  }
  return body.revoked_at;
}

async function grantRevokedAt({
  revocationRecord,
  revocationSignerPublicKey,
  expectedRevocationSignerKeyId,
  room,
  grantRecord,
  validFrom
}) {
  if (revocationRecord === null) {
    if (revocationSignerPublicKey !== null || expectedRevocationSignerKeyId !== null) {
      fail("invalid-options", "revocation signer data requires a revocation record");
    }
    return null;
  }
  if (revocationSignerPublicKey === null) {
    fail("invalid-options", "a grant revocation signer public key is required");
  }
  assertSigner(
    revocationRecord,
    expectedRevocationSignerKeyId,
    "grantRevocationRecord"
  );
  let body;
  try {
    body = await verifyRoomApplicationGrantRevocation(
      revocationRecord,
      revocationSignerPublicKey
    );
  } catch (error) {
    fail("grant-revocation-verification-failed", "grant revocation verification failed", error);
  }
  if (body.room_root !== room.roomRecordRoot
      || body.governance_root !== room.governanceRoot
      || body.grant_root !== grantRecord.root) {
    fail("grant-revocation-mismatch", "grant revocation targets different authority");
  }
  if (instant(body.revoked_at, "grantRevocation.revoked_at")
      < instant(validFrom, "roomGrant.validFrom")) {
    fail("grant-revocation-mismatch", "grant revocation predates the grant");
  }
  return body.revoked_at;
}

export async function projectVerifiedSourceMandate(options) {
  assertNoUnknownFields(options, "source mandate projection", SOURCE_OPTION_FIELDS);
  const {
    mandateRecord,
    signerPublicKey,
    roomProjection,
    expectedSignerKeyId = null,
    revocationRecord = null,
    revocationSignerPublicKey = null,
    expectedRevocationSignerKeyId = null
  } = options;

  const room = validateRoomProjection(roomProjection);
  assertRoot(mandateRecord?.root, "mandateRecord.root");
  assertSigner(mandateRecord, expectedSignerKeyId, "mandateRecord");

  let body;
  try {
    body = await verifyRoomSourceMandate(mandateRecord, signerPublicKey);
  } catch (error) {
    fail("source-mandate-verification-failed", "source mandate verification failed", error);
  }

  if (body.room_root !== room.roomRecordRoot) {
    fail("room-source-mismatch", "source mandate belongs to another room record");
  }
  if (body.governance_root !== room.governanceRoot) {
    fail("source-governance-mismatch", "source mandate governance root changed");
  }
  if (body.membership_epoch !== room.membershipEpoch) {
    fail("source-epoch-mismatch", "source mandate membership epoch changed");
  }
  if (body.policy_revision !== room.policyRevision) {
    fail("source-policy-mismatch", "source mandate policy revision changed");
  }

  const revokedAt = await sourceRevokedAt({
    revocationRecord,
    revocationSignerPublicKey,
    expectedRevocationSignerKeyId,
    room,
    mandateRecord,
    validFrom: body.valid_from
  });

  return validateSourceMandateProjection({
    protocol: ROOM_SOURCE_MANDATE_PROJECTION_PROTOCOL,
    roomId: room.roomId,
    governanceRoot: room.governanceRoot,
    mandateRoot: mandateRecord.root,
    sourceId: body.source_id,
    sourceNodeId: body.source_node_id,
    implementation: body.implementation,
    application: projectCanonicalApplication(body.application),
    operations: [...body.operations],
    membershipEpoch: body.membership_epoch,
    policyRevision: body.policy_revision,
    requiresUserInteraction: body.requires_user_interaction,
    validFrom: body.valid_from,
    validUntil: body.valid_until,
    revokedAt
  });
}

export async function projectVerifiedRoomApplicationGrant(options) {
  assertNoUnknownFields(options, "room application grant projection", GRANT_OPTION_FIELDS);
  const {
    grantRecord,
    signerPublicKey,
    roomProjection,
    membershipProjection,
    sourceMandateProjection,
    expectedSignerKeyId = null,
    revocationRecord = null,
    revocationSignerPublicKey = null,
    expectedRevocationSignerKeyId = null
  } = options;

  const room = validateRoomProjection(roomProjection);
  const membership = validateMembershipProjection(membershipProjection);
  const source = validateSourceMandateProjection(sourceMandateProjection);
  assertRoot(grantRecord?.root, "grantRecord.root");
  assertSigner(grantRecord, expectedSignerKeyId, "grantRecord");

  let body;
  try {
    body = await verifyRoomApplicationGrant(grantRecord, signerPublicKey);
  } catch (error) {
    fail("room-grant-verification-failed", "room application grant verification failed", error);
  }

  if (membership.roomId !== room.roomId
      || membership.governanceRoot !== room.governanceRoot
      || membership.membershipEpoch !== room.membershipEpoch) {
    fail("membership-room-mismatch", "membership projection differs from the room");
  }
  if (source.roomId !== room.roomId
      || source.governanceRoot !== room.governanceRoot
      || source.membershipEpoch !== room.membershipEpoch
      || source.policyRevision !== room.policyRevision) {
    fail("source-room-mismatch", "source projection differs from the room");
  }
  if (body.room_root !== room.roomRecordRoot
      || body.governance_root !== room.governanceRoot) {
    fail("room-grant-mismatch", "grant belongs to different room governance");
  }
  if (body.member_profile_root !== membership.memberProfileRoot
      || body.member_node_id !== membership.memberNodeId) {
    fail("grant-member-mismatch", "grant targets a different member or node");
  }
  if (body.source_mandate_root !== source.mandateRoot) {
    fail("grant-source-mismatch", "grant targets a different source mandate");
  }
  if (body.membership_epoch !== room.membershipEpoch
      || body.policy_revision !== room.policyRevision) {
    fail("grant-policy-mismatch", "grant epoch or policy revision changed");
  }

  const application = projectCanonicalApplication(body.application);
  if (!sameApplicationProjection(application, source.application)
      || !sameCanonicalApplication(
        body.application,
        canonicalApplicationFromProjection(source.application)
      )) {
    fail("grant-application-mismatch", "grant application differs from its source");
  }
  if (!operationsSubset(body.operations, source.operations)
      || !canonicalOperationsAreSubset(body.operations, source.operations)) {
    fail("grant-operation-denied", "grant operations broaden the source mandate");
  }

  const grantFrom = instant(body.valid_from, "roomGrant.valid_from");
  const grantUntil = instant(body.valid_until, "roomGrant.valid_until");
  if (grantFrom < instant(source.validFrom, "source.validFrom")
      || grantUntil > instant(source.validUntil, "source.validUntil")
      || grantFrom < instant(membership.validFrom, "membership.validFrom")
      || grantUntil > instant(membership.validUntil, "membership.validUntil")) {
    fail("grant-validity-mismatch", "grant validity exceeds member or source authority");
  }

  const revokedAt = await grantRevokedAt({
    revocationRecord,
    revocationSignerPublicKey,
    expectedRevocationSignerKeyId,
    room,
    grantRecord,
    validFrom: body.valid_from
  });

  return validateRoomApplicationGrantProjection({
    protocol: ROOM_APPLICATION_GRANT_PROJECTION_PROTOCOL,
    roomId: room.roomId,
    governanceRoot: room.governanceRoot,
    grantRoot: grantRecord.root,
    memberProfileRoot: body.member_profile_root,
    memberNodeId: body.member_node_id,
    sourceMandateRoot: body.source_mandate_root,
    application,
    operations: [...body.operations],
    limits: projectCanonicalLimits(body.limits),
    membershipEpoch: body.membership_epoch,
    policyRevision: body.policy_revision,
    validFrom: body.valid_from,
    validUntil: body.valid_until,
    revokedAt
  });
}
