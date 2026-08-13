import { verifyRoomVersion } from "./agent-room-records.js";
import { verifyAgentRecord } from "./agent-protocol.js";
import {
  ROOM_MEMBERSHIP_PROJECTION_PROTOCOL,
  ROOM_PROJECTION_PROTOCOL,
  validateMembershipProjection,
  validateRoomProjection
} from "./room-authority.js";

const ROOT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ROOM_OPTION_FIELDS = [
  "roomRecord",
  "signerPublicKey",
  "governanceRoot",
  "membershipEpoch",
  "policyRevision",
  "activityHeadRoot",
  "status",
  "expectedSignerKeyId"
];
const MEMBERSHIP_OPTION_FIELDS = [
  "membershipRecord",
  "signerPublicKey",
  "roomProjection",
  "memberNodeId",
  "validFrom",
  "validUntil",
  "revokedAt",
  "expectedSignerKeyId"
];

export class RoomAuthorityProjectionError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = "RoomAuthorityProjectionError";
    this.code = code;
    if (cause !== null) this.cause = cause;
  }
}

function fail(code, message, cause = null) {
  throw new RoomAuthorityProjectionError(code, message, cause);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertClosedOptions(value, name, fields) {
  if (!isPlainObject(value)) {
    fail("invalid-options", `${name} options must be one closed object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  const unknown = actual.filter((field) => !expected.includes(field));
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

function assertOptionalRoot(value, name) {
  if (value !== null) assertRoot(value, name);
  return value;
}

function assertPositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail("invalid-record", `${name} must be a positive safe integer`);
  }
  return value;
}

function assertCanonicalInstant(value, name) {
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

function assertSigner(record, expectedSignerKeyId, name) {
  assertRoot(record?.signer_key, `${name}.signer_key`);
  if (expectedSignerKeyId !== null) {
    assertRoot(expectedSignerKeyId, `${name}.expectedSignerKeyId`);
    if (record.signer_key !== expectedSignerKeyId) {
      fail("signer-mismatch", `${name} signer does not match the expected key`);
    }
  }
}

async function verifiedRoomBody(roomRecord, signerPublicKey) {
  if (!isPlainObject(roomRecord) || signerPublicKey === undefined || signerPublicKey === null) {
    fail("invalid-options", "a signed room record and signer public key are required");
  }
  try {
    return await verifyRoomVersion({ roomRecord, signerPublicKey });
  } catch (error) {
    fail("room-verification-failed", "signed Hestia room verification failed", error);
  }
}

async function verifiedMembershipBody(membershipRecord, signerPublicKey) {
  if (!isPlainObject(membershipRecord)
      || signerPublicKey === undefined
      || signerPublicKey === null) {
    fail("invalid-options", "a signed membership record and signer public key are required");
  }
  try {
    return await verifyAgentRecord(
      membershipRecord,
      signerPublicKey,
      "room/membership"
    );
  } catch (error) {
    fail(
      "membership-verification-failed",
      "signed Hestia membership verification failed",
      error
    );
  }
}

export async function projectVerifiedRoom(options) {
  assertClosedOptions(options, "room projection", ROOM_OPTION_FIELDS);
  const {
    roomRecord,
    signerPublicKey,
    governanceRoot,
    membershipEpoch,
    policyRevision,
    activityHeadRoot = null,
    status = "open",
    expectedSignerKeyId = null
  } = options;

  assertRoot(roomRecord?.root, "roomRecord.root");
  assertSigner(roomRecord, expectedSignerKeyId, "roomRecord");
  const body = await verifiedRoomBody(roomRecord, signerPublicKey);

  assertPositiveInteger(body.sequence, "roomRecord.body.sequence");
  assertRoot(body.host_profile_root, "roomRecord.body.host_profile_root");
  assertRoot(body.policy_root, "roomRecord.body.policy_root");
  assertRoot(body.kernel_root, "roomRecord.body.kernel_root");
  assertOptionalRoot(body.previous_room_root, "roomRecord.body.previous_room_root");

  return validateRoomProjection({
    protocol: ROOM_PROJECTION_PROTOCOL,
    roomId: body.room_id,
    roomRecordRoot: roomRecord.root,
    governanceRoot,
    hostProfileRoot: body.host_profile_root,
    membershipEpoch,
    policyRevision,
    activityHeadRoot,
    status
  });
}

export async function projectVerifiedMembership(options) {
  assertClosedOptions(options, "membership projection", MEMBERSHIP_OPTION_FIELDS);
  const {
    membershipRecord,
    signerPublicKey,
    roomProjection,
    memberNodeId = null,
    validFrom,
    validUntil,
    revokedAt = null,
    expectedSignerKeyId = null
  } = options;

  const room = validateRoomProjection(roomProjection);
  assertRoot(membershipRecord?.root, "membershipRecord.root");
  assertSigner(membershipRecord, expectedSignerKeyId, "membershipRecord");
  const body = await verifiedMembershipBody(membershipRecord, signerPublicKey);

  assertRoot(body.room_root, "membershipRecord.body.room_root");
  assertRoot(body.member_profile_root, "membershipRecord.body.member_profile_root");
  assertRoot(body.delegation_root, "membershipRecord.body.delegation_root");
  assertPositiveInteger(body.joined_epoch, "membershipRecord.body.joined_epoch");

  if (body.room_root !== room.roomRecordRoot) {
    fail(
      "room-membership-mismatch",
      "membership record does not belong to the verified room record"
    );
  }
  if (body.joined_epoch > room.membershipEpoch) {
    fail(
      "membership-epoch-mismatch",
      "membership begins after the verified room membership epoch"
    );
  }
  if (body.status !== "active" && body.status !== "revoked") {
    fail("invalid-membership-state", "membership status must be active or revoked");
  }

  if (body.status === "active") {
    if (body.revoked_epoch !== null || revokedAt !== null) {
      fail(
        "invalid-membership-state",
        "active membership cannot carry revocation evidence"
      );
    }
  } else {
    assertPositiveInteger(body.revoked_epoch, "membershipRecord.body.revoked_epoch");
    if (body.revoked_epoch <= body.joined_epoch
        || body.revoked_epoch > room.membershipEpoch) {
      fail(
        "membership-epoch-mismatch",
        "membership revocation epoch is inconsistent with the verified room"
      );
    }
    if (revokedAt === null) {
      fail("invalid-membership-state", "revoked membership requires a revocation time");
    }
  }

  const validFromMilliseconds = assertCanonicalInstant(validFrom, "membership.validFrom");
  const validUntilMilliseconds = assertCanonicalInstant(validUntil, "membership.validUntil");
  if (validFromMilliseconds >= validUntilMilliseconds) {
    fail("invalid-record", "membership validity interval is empty");
  }
  if (revokedAt !== null) {
    const revokedMilliseconds = assertCanonicalInstant(revokedAt, "membership.revokedAt");
    if (revokedMilliseconds < validFromMilliseconds
        || revokedMilliseconds > validUntilMilliseconds) {
      fail(
        "invalid-membership-state",
        "membership revocation time is outside its validity interval"
      );
    }
  }

  return validateMembershipProjection({
    protocol: ROOM_MEMBERSHIP_PROJECTION_PROTOCOL,
    roomId: room.roomId,
    governanceRoot: room.governanceRoot,
    membershipRoot: membershipRecord.root,
    memberProfileRoot: body.member_profile_root,
    memberNodeId,
    role: body.role,
    purposes: body.purposes,
    membershipEpoch: room.membershipEpoch,
    validFrom,
    validUntil,
    revokedAt
  });
}
