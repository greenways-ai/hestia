export const ROOM_PROJECTION_PROTOCOL = "hestia-room-projection/0-alpha";
export const ROOM_MEMBERSHIP_PROJECTION_PROTOCOL =
  "hestia-room-membership-projection/0-alpha";
export const ROOM_SOURCE_MANDATE_PROJECTION_PROTOCOL =
  "hestia-room-source-mandate-projection/0-alpha";
export const ROOM_APPLICATION_GRANT_PROJECTION_PROTOCOL =
  "hestia-room-application-grant-projection/0-alpha";
export const ROOM_INVOCATION_PROTOCOL = "hestia-room-invocation/0-alpha";
export const ROOM_AUTHORITY_DECISION_PROTOCOL =
  "hestia-room-authority-decision/0-alpha";
export const ROOM_AUTHORITY_CONFORMANCE_PROTOCOL =
  "hestia-room-authority-conformance/0-alpha";
export const ROOM_AUTHORITY_IMPORT_PROTOCOL =
  "hestia-room-authority-import/0-alpha";

const ROOT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_IDENTIFIER_BYTES = 240;
const MAX_OPERATION_BYTES = 160;
const MAX_LIST_ENTRIES = 64;
const MAX_REQUESTS_PER_DAY = 1_000_000;
const MAX_CONTENT_BYTES = 16 * 1024 * 1024;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const APPLICATION_FIELDS = [
  "appId",
  "version",
  "publisherId",
  "manifestDigest",
  "lockDigest",
  "approvalDigest"
];

const ROOM_FIELDS = [
  "protocol",
  "roomId",
  "roomRecordRoot",
  "governanceRoot",
  "hostProfileRoot",
  "membershipEpoch",
  "policyRevision",
  "activityHeadRoot",
  "status"
];

const MEMBERSHIP_FIELDS = [
  "protocol",
  "roomId",
  "governanceRoot",
  "membershipRoot",
  "memberProfileRoot",
  "memberNodeId",
  "role",
  "purposes",
  "membershipEpoch",
  "validFrom",
  "validUntil",
  "revokedAt"
];

const SOURCE_FIELDS = [
  "protocol",
  "roomId",
  "governanceRoot",
  "mandateRoot",
  "sourceId",
  "sourceNodeId",
  "implementation",
  "application",
  "operations",
  "membershipEpoch",
  "policyRevision",
  "requiresUserInteraction",
  "validFrom",
  "validUntil",
  "revokedAt"
];

const LIMIT_FIELDS = [
  "requestsPerDay",
  "maxInputBytes",
  "maxOutputBytes",
  "maxTimeoutMs"
];

const GRANT_FIELDS = [
  "protocol",
  "roomId",
  "governanceRoot",
  "grantRoot",
  "memberProfileRoot",
  "memberNodeId",
  "sourceMandateRoot",
  "application",
  "operations",
  "limits",
  "membershipEpoch",
  "policyRevision",
  "validFrom",
  "validUntil",
  "revokedAt"
];

const INVOCATION_FIELDS = [
  "protocol",
  "requestId",
  "roomId",
  "governanceRoot",
  "membershipRoot",
  "memberProfileRoot",
  "memberNodeId",
  "sourceId",
  "sourceMandateRoot",
  "grantRoot",
  "application",
  "operation",
  "argumentsDigest",
  "inputBytes",
  "maxOutputBytes",
  "timeoutMs",
  "createdAt",
  "expiresAt"
];

const DECISION_FIELDS = [
  "protocol",
  "allowed",
  "reason",
  "invocation",
  "membershipRoot",
  "sourceMandateRoot",
  "grantRoot",
  "requiresUserInteraction"
];

export class RoomAuthorityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RoomAuthorityError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new RoomAuthorityError(code, message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertClosedObject(value, name, expectedFields) {
  if (!isPlainObject(value)) {
    fail("invalid-projection", `${name} must be one closed object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  if (actual.length !== expected.length
      || actual.some((field, index) => field !== expected[index])) {
    fail(
      "invalid-projection",
      `${name} fields must be exactly: ${expected.join(", ")}`
    );
  }
}

function assertString(value, name, maximum = MAX_IDENTIFIER_BYTES) {
  if (typeof value !== "string"
      || value.length === 0
      || value.length > maximum
      || value.trim() !== value
      || CONTROL_CHARACTER_PATTERN.test(value)) {
    fail("invalid-projection", `${name} is invalid`);
  }
  return value;
}

function assertIdentifier(value, name) {
  return assertString(value, name, MAX_IDENTIFIER_BYTES);
}

function assertOperation(value, name) {
  return assertString(value, name, MAX_OPERATION_BYTES);
}

function assertRoot(value, name) {
  if (typeof value !== "string" || !ROOT_PATTERN.test(value)) {
    fail("invalid-projection", `${name} must be one lowercase SHA-256 root`);
  }
  return value;
}

function assertOptionalRoot(value, name) {
  if (value !== null) assertRoot(value, name);
  return value;
}

function assertOptionalIdentifier(value, name) {
  if (value !== null) assertIdentifier(value, name);
  return value;
}

function assertPositiveInteger(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail("invalid-projection", `${name} must be a bounded positive integer`);
  }
  return value;
}

function assertNonNegativeInteger(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    fail("invalid-projection", `${name} must be a bounded non-negative integer`);
  }
  return value;
}

function assertCanonicalInstant(value, name) {
  assertString(value, name, 40);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)
      || new Date(milliseconds).toISOString() !== value) {
    fail("invalid-projection", `${name} must be a canonical UTC instant`);
  }
  return value;
}

function assertOptionalInstant(value, name) {
  if (value !== null) assertCanonicalInstant(value, name);
  return value;
}

function assertInterval(validFrom, validUntil, name) {
  assertCanonicalInstant(validFrom, `${name}.validFrom`);
  assertCanonicalInstant(validUntil, `${name}.validUntil`);
  if (Date.parse(validFrom) >= Date.parse(validUntil)) {
    fail("invalid-projection", `${name} validity interval is empty`);
  }
}

function assertCanonicalList(value, name, itemValidator) {
  if (!Array.isArray(value)
      || value.length === 0
      || value.length > MAX_LIST_ENTRIES) {
    fail("invalid-projection", `${name} must be a bounded non-empty list`);
  }
  value.forEach((item, index) => itemValidator(item, `${name}[${index}]`));
  for (let index = 1; index < value.length; index += 1) {
    if (value[index - 1].localeCompare(value[index]) >= 0) {
      fail("invalid-projection", `${name} must be sorted and duplicate-free`);
    }
  }
  return value;
}

function validateApplication(value, name = "application") {
  assertClosedObject(value, name, APPLICATION_FIELDS);
  assertIdentifier(value.appId, `${name}.appId`);
  assertString(value.version, `${name}.version`, 100);
  if (!SEMVER_PATTERN.test(value.version)) {
    fail("invalid-projection", `${name}.version must be SemVer`);
  }
  assertIdentifier(value.publisherId, `${name}.publisherId`);
  assertRoot(value.manifestDigest, `${name}.manifestDigest`);
  assertOptionalRoot(value.lockDigest, `${name}.lockDigest`);
  assertRoot(value.approvalDigest, `${name}.approvalDigest`);
  return value;
}

function validateLimits(value, name = "limits") {
  assertClosedObject(value, name, LIMIT_FIELDS);
  assertPositiveInteger(
    value.requestsPerDay,
    `${name}.requestsPerDay`,
    MAX_REQUESTS_PER_DAY
  );
  assertPositiveInteger(value.maxInputBytes, `${name}.maxInputBytes`, MAX_CONTENT_BYTES);
  assertPositiveInteger(value.maxOutputBytes, `${name}.maxOutputBytes`, MAX_CONTENT_BYTES);
  assertPositiveInteger(value.maxTimeoutMs, `${name}.maxTimeoutMs`, MAX_TIMEOUT_MS);
  return value;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneValue(child)])
    );
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function validatedCopy(value, validator) {
  validator(value);
  return deepFreeze(cloneValue(value));
}

export function validateRoomProjection(value) {
  return validatedCopy(value, (room) => {
    assertClosedObject(room, "room", ROOM_FIELDS);
    if (room.protocol !== ROOM_PROJECTION_PROTOCOL) {
      fail("unsupported-protocol", "room projection protocol is unsupported");
    }
    assertIdentifier(room.roomId, "room.roomId");
    assertRoot(room.roomRecordRoot, "room.roomRecordRoot");
    assertRoot(room.governanceRoot, "room.governanceRoot");
    assertRoot(room.hostProfileRoot, "room.hostProfileRoot");
    assertPositiveInteger(room.membershipEpoch, "room.membershipEpoch");
    assertPositiveInteger(room.policyRevision, "room.policyRevision");
    assertOptionalRoot(room.activityHeadRoot, "room.activityHeadRoot");
    if (!new Set(["open", "closed"]).has(room.status)) {
      fail("invalid-projection", "room.status is invalid");
    }
  });
}

export function validateMembershipProjection(value) {
  return validatedCopy(value, (membership) => {
    assertClosedObject(membership, "membership", MEMBERSHIP_FIELDS);
    if (membership.protocol !== ROOM_MEMBERSHIP_PROJECTION_PROTOCOL) {
      fail("unsupported-protocol", "room membership protocol is unsupported");
    }
    assertIdentifier(membership.roomId, "membership.roomId");
    assertRoot(membership.governanceRoot, "membership.governanceRoot");
    assertRoot(membership.membershipRoot, "membership.membershipRoot");
    assertRoot(membership.memberProfileRoot, "membership.memberProfileRoot");
    assertOptionalIdentifier(membership.memberNodeId, "membership.memberNodeId");
    assertIdentifier(membership.role, "membership.role");
    assertCanonicalList(membership.purposes, "membership.purposes", assertOperation);
    assertPositiveInteger(membership.membershipEpoch, "membership.membershipEpoch");
    assertInterval(membership.validFrom, membership.validUntil, "membership");
    assertOptionalInstant(membership.revokedAt, "membership.revokedAt");
  });
}

export function validateSourceMandateProjection(value) {
  return validatedCopy(value, (source) => {
    assertClosedObject(source, "sourceMandate", SOURCE_FIELDS);
    if (source.protocol !== ROOM_SOURCE_MANDATE_PROJECTION_PROTOCOL) {
      fail("unsupported-protocol", "room source mandate protocol is unsupported");
    }
    assertIdentifier(source.roomId, "sourceMandate.roomId");
    assertRoot(source.governanceRoot, "sourceMandate.governanceRoot");
    assertRoot(source.mandateRoot, "sourceMandate.mandateRoot");
    assertIdentifier(source.sourceId, "sourceMandate.sourceId");
    assertIdentifier(source.sourceNodeId, "sourceMandate.sourceNodeId");
    assertIdentifier(source.implementation, "sourceMandate.implementation");
    validateApplication(source.application, "sourceMandate.application");
    assertCanonicalList(source.operations, "sourceMandate.operations", assertOperation);
    assertPositiveInteger(source.membershipEpoch, "sourceMandate.membershipEpoch");
    assertPositiveInteger(source.policyRevision, "sourceMandate.policyRevision");
    if (typeof source.requiresUserInteraction !== "boolean") {
      fail("invalid-projection", "sourceMandate.requiresUserInteraction must be boolean");
    }
    assertInterval(source.validFrom, source.validUntil, "sourceMandate");
    assertOptionalInstant(source.revokedAt, "sourceMandate.revokedAt");
  });
}

export function validateRoomApplicationGrantProjection(value) {
  return validatedCopy(value, (grant) => {
    assertClosedObject(grant, "grant", GRANT_FIELDS);
    if (grant.protocol !== ROOM_APPLICATION_GRANT_PROJECTION_PROTOCOL) {
      fail("unsupported-protocol", "room application grant protocol is unsupported");
    }
    assertIdentifier(grant.roomId, "grant.roomId");
    assertRoot(grant.governanceRoot, "grant.governanceRoot");
    assertRoot(grant.grantRoot, "grant.grantRoot");
    assertRoot(grant.memberProfileRoot, "grant.memberProfileRoot");
    assertOptionalIdentifier(grant.memberNodeId, "grant.memberNodeId");
    assertRoot(grant.sourceMandateRoot, "grant.sourceMandateRoot");
    validateApplication(grant.application, "grant.application");
    assertCanonicalList(grant.operations, "grant.operations", assertOperation);
    validateLimits(grant.limits, "grant.limits");
    assertPositiveInteger(grant.membershipEpoch, "grant.membershipEpoch");
    assertPositiveInteger(grant.policyRevision, "grant.policyRevision");
    assertInterval(grant.validFrom, grant.validUntil, "grant");
    assertOptionalInstant(grant.revokedAt, "grant.revokedAt");
  });
}

export function validateRoomInvocation(value) {
  return validatedCopy(value, (invocation) => {
    assertClosedObject(invocation, "invocation", INVOCATION_FIELDS);
    if (invocation.protocol !== ROOM_INVOCATION_PROTOCOL) {
      fail("unsupported-protocol", "room invocation protocol is unsupported");
    }
    assertIdentifier(invocation.requestId, "invocation.requestId");
    assertIdentifier(invocation.roomId, "invocation.roomId");
    assertRoot(invocation.governanceRoot, "invocation.governanceRoot");
    assertRoot(invocation.membershipRoot, "invocation.membershipRoot");
    assertRoot(invocation.memberProfileRoot, "invocation.memberProfileRoot");
    assertOptionalIdentifier(invocation.memberNodeId, "invocation.memberNodeId");
    assertIdentifier(invocation.sourceId, "invocation.sourceId");
    assertRoot(invocation.sourceMandateRoot, "invocation.sourceMandateRoot");
    assertRoot(invocation.grantRoot, "invocation.grantRoot");
    validateApplication(invocation.application, "invocation.application");
    assertOperation(invocation.operation, "invocation.operation");
    assertRoot(invocation.argumentsDigest, "invocation.argumentsDigest");
    assertNonNegativeInteger(invocation.inputBytes, "invocation.inputBytes", MAX_CONTENT_BYTES);
    assertPositiveInteger(
      invocation.maxOutputBytes,
      "invocation.maxOutputBytes",
      MAX_CONTENT_BYTES
    );
    assertPositiveInteger(invocation.timeoutMs, "invocation.timeoutMs", MAX_TIMEOUT_MS);
    assertCanonicalInstant(invocation.createdAt, "invocation.createdAt");
    assertCanonicalInstant(invocation.expiresAt, "invocation.expiresAt");
    if (Date.parse(invocation.createdAt) >= Date.parse(invocation.expiresAt)) {
      fail("invalid-projection", "invocation validity interval is empty");
    }
  });
}

export function validateRoomAuthorityDecision(value) {
  return validatedCopy(value, (authorityDecision) => {
    assertClosedObject(authorityDecision, "decision", DECISION_FIELDS);
    if (authorityDecision.protocol !== ROOM_AUTHORITY_DECISION_PROTOCOL) {
      fail("unsupported-protocol", "room authority decision protocol is unsupported");
    }
    if (typeof authorityDecision.allowed !== "boolean") {
      fail("invalid-projection", "decision.allowed must be boolean");
    }
    assertString(authorityDecision.reason, "decision.reason", MAX_OPERATION_BYTES);
    validateRoomInvocation(authorityDecision.invocation);
    if (typeof authorityDecision.requiresUserInteraction !== "boolean") {
      fail(
        "invalid-projection",
        "decision.requiresUserInteraction must be boolean"
      );
    }
    if (authorityDecision.allowed) {
      if (authorityDecision.reason !== "allowed") {
        fail("invalid-projection", "allowed decision reason must be allowed");
      }
      assertRoot(authorityDecision.membershipRoot, "decision.membershipRoot");
      assertRoot(
        authorityDecision.sourceMandateRoot,
        "decision.sourceMandateRoot"
      );
      assertRoot(authorityDecision.grantRoot, "decision.grantRoot");
    } else if (authorityDecision.membershipRoot !== null
        || authorityDecision.sourceMandateRoot !== null
        || authorityDecision.grantRoot !== null
        || authorityDecision.requiresUserInteraction) {
      fail(
        "invalid-projection",
        "denied decision cannot project successful authority evidence"
      );
    }
  });
}

function exactApplication(left, right) {
  return APPLICATION_FIELDS.every((field) => left[field] === right[field]);
}

function contains(values, value) {
  return values.includes(value);
}

function activeAt(record, observedAt) {
  const observed = Date.parse(observedAt);
  if (observed < Date.parse(record.validFrom)
      || observed > Date.parse(record.validUntil)) {
    return false;
  }
  return record.revokedAt === null || observed < Date.parse(record.revokedAt);
}

function nodeMatches(boundNodeId, invocationNodeId) {
  return boundNodeId === null || boundNodeId === invocationNodeId;
}

function decision(invocation, allowed, reason, sourceMandate = null) {
  const exactRoots = allowed
    ? {
        membershipRoot: invocation.membershipRoot,
        sourceMandateRoot: invocation.sourceMandateRoot,
        grantRoot: invocation.grantRoot
      }
    : {
        membershipRoot: null,
        sourceMandateRoot: null,
        grantRoot: null
      };
  return validateRoomAuthorityDecision({
    protocol: ROOM_AUTHORITY_DECISION_PROTOCOL,
    allowed,
    reason,
    invocation,
    ...exactRoots,
    requiresUserInteraction:
      allowed && sourceMandate !== null
        ? sourceMandate.requiresUserInteraction
        : false
  });
}

function deny(invocation, reason) {
  return decision(invocation, false, reason);
}

export function authorizeRoomInvocation({
  room,
  membership,
  sourceMandate,
  grant,
  invocation,
  observedAt
}) {
  const checkedRoom = validateRoomProjection(room);
  const checkedMembership = validateMembershipProjection(membership);
  const checkedSource = validateSourceMandateProjection(sourceMandate);
  const checkedGrant = validateRoomApplicationGrantProjection(grant);
  const checkedInvocation = validateRoomInvocation(invocation);
  assertCanonicalInstant(observedAt, "observedAt");

  const observed = Date.parse(observedAt);
  if (checkedRoom.status !== "open") {
    return deny(checkedInvocation, "room-closed");
  }
  if (observed < Date.parse(checkedInvocation.createdAt)) {
    return deny(checkedInvocation, "request-not-yet-effective");
  }
  if (observed > Date.parse(checkedInvocation.expiresAt)) {
    return deny(checkedInvocation, "request-expired");
  }
  if (checkedInvocation.roomId !== checkedRoom.roomId
      || checkedInvocation.governanceRoot !== checkedRoom.governanceRoot) {
    return deny(checkedInvocation, "room-mismatch");
  }

  if (checkedMembership.roomId !== checkedRoom.roomId
      || checkedMembership.governanceRoot !== checkedRoom.governanceRoot
      || checkedMembership.membershipRoot !== checkedInvocation.membershipRoot
      || checkedMembership.memberProfileRoot !== checkedInvocation.memberProfileRoot
      || !nodeMatches(checkedMembership.memberNodeId, checkedInvocation.memberNodeId)) {
    return deny(checkedInvocation, "membership-mismatch");
  }
  if (!activeAt(checkedMembership, observedAt)) {
    return deny(checkedInvocation, "membership-inactive");
  }
  if (checkedMembership.membershipEpoch !== checkedRoom.membershipEpoch) {
    return deny(checkedInvocation, "membership-epoch-mismatch");
  }
  if (!contains(checkedMembership.purposes, "room.app.invoke")) {
    return deny(checkedInvocation, "membership-purpose-denied");
  }

  if (checkedSource.roomId !== checkedRoom.roomId
      || checkedSource.governanceRoot !== checkedRoom.governanceRoot
      || checkedSource.mandateRoot !== checkedInvocation.sourceMandateRoot
      || checkedSource.sourceId !== checkedInvocation.sourceId) {
    return deny(checkedInvocation, "source-mismatch");
  }
  if (!activeAt(checkedSource, observedAt)) {
    return deny(checkedInvocation, "source-inactive");
  }
  if (checkedSource.membershipEpoch !== checkedRoom.membershipEpoch) {
    return deny(checkedInvocation, "source-epoch-mismatch");
  }
  if (checkedSource.policyRevision !== checkedRoom.policyRevision) {
    return deny(checkedInvocation, "source-policy-mismatch");
  }
  if (!exactApplication(checkedSource.application, checkedInvocation.application)) {
    return deny(checkedInvocation, "source-application-mismatch");
  }
  if (!contains(checkedSource.operations, checkedInvocation.operation)) {
    return deny(checkedInvocation, "source-operation-denied");
  }

  if (checkedGrant.roomId !== checkedRoom.roomId
      || checkedGrant.governanceRoot !== checkedRoom.governanceRoot
      || checkedGrant.grantRoot !== checkedInvocation.grantRoot
      || checkedGrant.memberProfileRoot !== checkedInvocation.memberProfileRoot
      || !nodeMatches(checkedGrant.memberNodeId, checkedInvocation.memberNodeId)
      || checkedGrant.sourceMandateRoot !== checkedSource.mandateRoot) {
    return deny(checkedInvocation, "grant-mismatch");
  }
  if (!activeAt(checkedGrant, observedAt)) {
    return deny(checkedInvocation, "grant-inactive");
  }
  if (checkedGrant.membershipEpoch !== checkedRoom.membershipEpoch) {
    return deny(checkedInvocation, "grant-epoch-mismatch");
  }
  if (checkedGrant.policyRevision !== checkedRoom.policyRevision) {
    return deny(checkedInvocation, "grant-policy-mismatch");
  }
  if (!exactApplication(checkedGrant.application, checkedInvocation.application)) {
    return deny(checkedInvocation, "grant-application-mismatch");
  }
  if (!contains(checkedGrant.operations, checkedInvocation.operation)) {
    return deny(checkedInvocation, "grant-operation-denied");
  }
  if (checkedInvocation.inputBytes > checkedGrant.limits.maxInputBytes
      || checkedInvocation.maxOutputBytes > checkedGrant.limits.maxOutputBytes
      || checkedInvocation.timeoutMs > checkedGrant.limits.maxTimeoutMs) {
    return deny(checkedInvocation, "grant-limit-exceeded");
  }

  return decision(checkedInvocation, true, "allowed", checkedSource);
}
