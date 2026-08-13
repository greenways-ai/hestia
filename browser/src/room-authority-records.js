import { signAgentRecord, verifyAgentRecord } from "./agent-protocol.js";
import { randomId } from "./protocol.js";

export const ROOM_SOURCE_MANDATE_KIND = "room/source-mandate";
export const ROOM_SOURCE_MANDATE_REVOCATION_KIND =
  "room/source-mandate-revocation";
export const ROOM_APPLICATION_GRANT_KIND = "room/application-grant";
export const ROOM_APPLICATION_GRANT_REVOCATION_KIND =
  "room/application-grant-revocation";

const ROOT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_IDENTIFIER_BYTES = 240;
const MAX_OPERATION_BYTES = 160;
const MAX_REASON_BYTES = 160;
const MAX_LIST_ENTRIES = 64;
const MAX_REQUESTS_PER_DAY = 1_000_000;
const MAX_CONTENT_BYTES = 16 * 1024 * 1024;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const SIGNED_RECORD_FIELDS = [
  "protocol",
  "version",
  "type",
  "signer_key",
  "signer_key_root",
  "body",
  "body_root",
  "root",
  "signature",
  "hcp1_pack",
  "hcv1_cells"
];
const APPLICATION_FIELDS = [
  "appId",
  "version",
  "publisherId",
  "manifestDigest",
  "lockDigest",
  "approvalDigest"
];
const CANONICAL_APPLICATION_FIELDS = [
  "app_id",
  "version",
  "publisher_id",
  "manifest_digest",
  "lock_digest",
  "approval_digest"
];
const LIMIT_FIELDS = [
  "requestsPerDay",
  "maxInputBytes",
  "maxOutputBytes",
  "maxTimeoutMs"
];
const CANONICAL_LIMIT_FIELDS = [
  "requests_per_day",
  "max_input_bytes",
  "max_output_bytes",
  "max_timeout_ms"
];
const SOURCE_BODY_FIELDS = [
  "mandate_id",
  "room_root",
  "governance_root",
  "issued_by_profile_root",
  "authority_root",
  "source_id",
  "source_node_id",
  "implementation",
  "application",
  "operations",
  "membership_epoch",
  "policy_revision",
  "requires_user_interaction",
  "valid_from",
  "valid_until"
];
const SOURCE_REVOCATION_BODY_FIELDS = [
  "revocation_id",
  "room_root",
  "governance_root",
  "mandate_root",
  "revoked_by_profile_root",
  "authority_root",
  "reason",
  "revoked_at"
];
const GRANT_BODY_FIELDS = [
  "grant_id",
  "room_root",
  "governance_root",
  "issued_by_profile_root",
  "authority_root",
  "member_profile_root",
  "member_node_id",
  "source_mandate_root",
  "application",
  "operations",
  "limits",
  "membership_epoch",
  "policy_revision",
  "valid_from",
  "valid_until"
];
const GRANT_REVOCATION_BODY_FIELDS = [
  "revocation_id",
  "room_root",
  "governance_root",
  "grant_root",
  "revoked_by_profile_root",
  "authority_root",
  "reason",
  "revoked_at"
];

const SOURCE_CREATE_FIELDS = [
  "mandateId",
  "roomRecord",
  "governanceRoot",
  "issuedByProfileRoot",
  "authorityRoot",
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
  "signingKey"
];
const SOURCE_REVOCATION_FIELDS = [
  "revocationId",
  "roomRecord",
  "governanceRoot",
  "mandateRecord",
  "revokedByProfileRoot",
  "authorityRoot",
  "reason",
  "revokedAt",
  "signingKey"
];
const GRANT_CREATE_FIELDS = [
  "grantId",
  "roomRecord",
  "governanceRoot",
  "issuedByProfileRoot",
  "authorityRoot",
  "memberProfileRoot",
  "memberNodeId",
  "sourceMandateRecord",
  "application",
  "operations",
  "limits",
  "membershipEpoch",
  "policyRevision",
  "validFrom",
  "validUntil",
  "signingKey"
];
const GRANT_REVOCATION_FIELDS = [
  "revocationId",
  "roomRecord",
  "governanceRoot",
  "grantRecord",
  "revokedByProfileRoot",
  "authorityRoot",
  "reason",
  "revokedAt",
  "signingKey"
];

export class RoomAuthorityRecordError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = "RoomAuthorityRecordError";
    this.code = code;
    if (cause !== null) this.cause = cause;
  }
}

function fail(code, message, cause = null) {
  throw new RoomAuthorityRecordError(code, message, cause);
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
    fail("invalid-options", `${name} must be one object`);
  }
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    fail("invalid-options", `${name} contains unknown fields: ${unknown.join(", ")}`);
  }
}

function assertClosedObject(value, name, fields) {
  if (!isPlainObject(value)) {
    fail("invalid-record", `${name} must be one closed object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length
      || actual.some((field, index) => field !== expected[index])) {
    fail("invalid-record", `${name} fields must be exactly: ${expected.join(", ")}`);
  }
}

function assertSignedRecord(record, name, kind) {
  assertClosedObject(record, name, SIGNED_RECORD_FIELDS);
  if (record.type !== kind) {
    fail("invalid-record", `${name} must be a ${kind} record`);
  }
  return record;
}

function assertString(value, name, maximum = MAX_IDENTIFIER_BYTES) {
  if (typeof value !== "string"
      || value.length === 0
      || value.length > maximum
      || value.trim() !== value
      || CONTROL_CHARACTER_PATTERN.test(value)) {
    fail("invalid-record", `${name} is invalid`);
  }
  return value;
}

function assertIdentifier(value, name) {
  return assertString(value, name, MAX_IDENTIFIER_BYTES);
}

function assertOptionalIdentifier(value, name) {
  if (value !== null) assertIdentifier(value, name);
  return value;
}

function assertOperation(value, name) {
  return assertString(value, name, MAX_OPERATION_BYTES);
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

function assertPositiveInteger(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail("invalid-record", `${name} must be a bounded positive integer`);
  }
  return value;
}

function assertCanonicalInstant(value, name) {
  assertString(value, name, 40);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)
      || new Date(milliseconds).toISOString() !== value) {
    fail("invalid-record", `${name} must be a canonical UTC instant`);
  }
  return milliseconds;
}

function assertInterval(validFrom, validUntil, name) {
  const from = assertCanonicalInstant(validFrom, `${name}.validFrom`);
  const until = assertCanonicalInstant(validUntil, `${name}.validUntil`);
  if (from >= until) fail("invalid-record", `${name} validity interval is empty`);
  return { from, until };
}

function assertCanonicalList(value, name, itemValidator = assertOperation) {
  if (!Array.isArray(value)
      || value.length === 0
      || value.length > MAX_LIST_ENTRIES) {
    fail("invalid-record", `${name} must be a bounded non-empty list`);
  }
  value.forEach((item, index) => itemValidator(item, `${name}[${index}]`));
  for (let index = 1; index < value.length; index += 1) {
    if (value[index - 1].localeCompare(value[index]) >= 0) {
      fail("invalid-record", `${name} must be sorted and duplicate-free`);
    }
  }
  return value;
}

function assertBoolean(value, name) {
  if (typeof value !== "boolean") fail("invalid-record", `${name} must be boolean`);
  return value;
}

function validateApplication(value, name = "application") {
  assertClosedObject(value, name, APPLICATION_FIELDS);
  assertIdentifier(value.appId, `${name}.appId`);
  assertString(value.version, `${name}.version`, 100);
  if (!SEMVER_PATTERN.test(value.version)) {
    fail("invalid-record", `${name}.version must be SemVer`);
  }
  assertIdentifier(value.publisherId, `${name}.publisherId`);
  assertRoot(value.manifestDigest, `${name}.manifestDigest`);
  assertOptionalRoot(value.lockDigest, `${name}.lockDigest`);
  assertRoot(value.approvalDigest, `${name}.approvalDigest`);
  return value;
}

function validateCanonicalApplication(value, name = "application") {
  assertClosedObject(value, name, CANONICAL_APPLICATION_FIELDS);
  return validateApplication({
    appId: value.app_id,
    version: value.version,
    publisherId: value.publisher_id,
    manifestDigest: value.manifest_digest,
    lockDigest: value.lock_digest,
    approvalDigest: value.approval_digest
  }, name);
}

function canonicalApplication(value) {
  validateApplication(value);
  return {
    app_id: value.appId,
    version: value.version,
    publisher_id: value.publisherId,
    manifest_digest: value.manifestDigest,
    lock_digest: value.lockDigest,
    approval_digest: value.approvalDigest
  };
}

export function projectCanonicalApplication(value) {
  validateCanonicalApplication(value);
  return Object.freeze({
    appId: value.app_id,
    version: value.version,
    publisherId: value.publisher_id,
    manifestDigest: value.manifest_digest,
    lockDigest: value.lock_digest,
    approvalDigest: value.approval_digest
  });
}

function validateLimits(value, name = "limits") {
  assertClosedObject(value, name, LIMIT_FIELDS);
  assertPositiveInteger(value.requestsPerDay, `${name}.requestsPerDay`, MAX_REQUESTS_PER_DAY);
  assertPositiveInteger(value.maxInputBytes, `${name}.maxInputBytes`, MAX_CONTENT_BYTES);
  assertPositiveInteger(value.maxOutputBytes, `${name}.maxOutputBytes`, MAX_CONTENT_BYTES);
  assertPositiveInteger(value.maxTimeoutMs, `${name}.maxTimeoutMs`, MAX_TIMEOUT_MS);
  return value;
}

function validateCanonicalLimits(value, name = "limits") {
  assertClosedObject(value, name, CANONICAL_LIMIT_FIELDS);
  return validateLimits({
    requestsPerDay: value.requests_per_day,
    maxInputBytes: value.max_input_bytes,
    maxOutputBytes: value.max_output_bytes,
    maxTimeoutMs: value.max_timeout_ms
  }, name);
}

function canonicalLimits(value) {
  validateLimits(value);
  return {
    requests_per_day: value.requestsPerDay,
    max_input_bytes: value.maxInputBytes,
    max_output_bytes: value.maxOutputBytes,
    max_timeout_ms: value.maxTimeoutMs
  };
}

export function projectCanonicalLimits(value) {
  validateCanonicalLimits(value);
  return Object.freeze({
    requestsPerDay: value.requests_per_day,
    maxInputBytes: value.max_input_bytes,
    maxOutputBytes: value.max_output_bytes,
    maxTimeoutMs: value.max_timeout_ms
  });
}

export function sameCanonicalApplication(left, right) {
  validateCanonicalApplication(left, "leftApplication");
  validateCanonicalApplication(right, "rightApplication");
  return CANONICAL_APPLICATION_FIELDS.every((field) => left[field] === right[field]);
}

export function canonicalOperationsAreSubset(candidate, allowed) {
  assertCanonicalList(candidate, "candidateOperations");
  assertCanonicalList(allowed, "allowedOperations");
  const allowedSet = new Set(allowed);
  return candidate.every((operation) => allowedSet.has(operation));
}

function validateSourceBody(body) {
  assertClosedObject(body, "sourceMandate", SOURCE_BODY_FIELDS);
  assertIdentifier(body.mandate_id, "sourceMandate.mandate_id");
  assertRoot(body.room_root, "sourceMandate.room_root");
  assertRoot(body.governance_root, "sourceMandate.governance_root");
  assertRoot(body.issued_by_profile_root, "sourceMandate.issued_by_profile_root");
  assertRoot(body.authority_root, "sourceMandate.authority_root");
  assertIdentifier(body.source_id, "sourceMandate.source_id");
  assertIdentifier(body.source_node_id, "sourceMandate.source_node_id");
  assertIdentifier(body.implementation, "sourceMandate.implementation");
  validateCanonicalApplication(body.application, "sourceMandate.application");
  assertCanonicalList(body.operations, "sourceMandate.operations");
  assertPositiveInteger(body.membership_epoch, "sourceMandate.membership_epoch");
  assertPositiveInteger(body.policy_revision, "sourceMandate.policy_revision");
  assertBoolean(body.requires_user_interaction, "sourceMandate.requires_user_interaction");
  assertInterval(body.valid_from, body.valid_until, "sourceMandate");
  return body;
}

function validateSourceRevocationBody(body) {
  assertClosedObject(body, "sourceRevocation", SOURCE_REVOCATION_BODY_FIELDS);
  assertIdentifier(body.revocation_id, "sourceRevocation.revocation_id");
  assertRoot(body.room_root, "sourceRevocation.room_root");
  assertRoot(body.governance_root, "sourceRevocation.governance_root");
  assertRoot(body.mandate_root, "sourceRevocation.mandate_root");
  assertRoot(body.revoked_by_profile_root, "sourceRevocation.revoked_by_profile_root");
  assertRoot(body.authority_root, "sourceRevocation.authority_root");
  assertString(body.reason, "sourceRevocation.reason", MAX_REASON_BYTES);
  assertCanonicalInstant(body.revoked_at, "sourceRevocation.revoked_at");
  return body;
}

function validateGrantBody(body) {
  assertClosedObject(body, "roomGrant", GRANT_BODY_FIELDS);
  assertIdentifier(body.grant_id, "roomGrant.grant_id");
  assertRoot(body.room_root, "roomGrant.room_root");
  assertRoot(body.governance_root, "roomGrant.governance_root");
  assertRoot(body.issued_by_profile_root, "roomGrant.issued_by_profile_root");
  assertRoot(body.authority_root, "roomGrant.authority_root");
  assertRoot(body.member_profile_root, "roomGrant.member_profile_root");
  assertOptionalIdentifier(body.member_node_id, "roomGrant.member_node_id");
  assertRoot(body.source_mandate_root, "roomGrant.source_mandate_root");
  validateCanonicalApplication(body.application, "roomGrant.application");
  assertCanonicalList(body.operations, "roomGrant.operations");
  validateCanonicalLimits(body.limits, "roomGrant.limits");
  assertPositiveInteger(body.membership_epoch, "roomGrant.membership_epoch");
  assertPositiveInteger(body.policy_revision, "roomGrant.policy_revision");
  assertInterval(body.valid_from, body.valid_until, "roomGrant");
  return body;
}

function validateGrantRevocationBody(body) {
  assertClosedObject(body, "grantRevocation", GRANT_REVOCATION_BODY_FIELDS);
  assertIdentifier(body.revocation_id, "grantRevocation.revocation_id");
  assertRoot(body.room_root, "grantRevocation.room_root");
  assertRoot(body.governance_root, "grantRevocation.governance_root");
  assertRoot(body.grant_root, "grantRevocation.grant_root");
  assertRoot(body.revoked_by_profile_root, "grantRevocation.revoked_by_profile_root");
  assertRoot(body.authority_root, "grantRevocation.authority_root");
  assertString(body.reason, "grantRevocation.reason", MAX_REASON_BYTES);
  assertCanonicalInstant(body.revoked_at, "grantRevocation.revoked_at");
  return body;
}

export async function createRoomSourceMandate(options) {
  assertNoUnknownFields(options, "source mandate options", SOURCE_CREATE_FIELDS);
  const {
    mandateId = `source-mandate:${randomId()}`,
    roomRecord,
    governanceRoot,
    issuedByProfileRoot,
    authorityRoot,
    sourceId,
    sourceNodeId,
    implementation,
    application,
    operations,
    membershipEpoch,
    policyRevision,
    requiresUserInteraction,
    validFrom,
    validUntil,
    signingKey
  } = options;

  const body = {
    mandate_id: assertIdentifier(mandateId, "mandateId"),
    room_root: assertRoot(roomRecord?.root, "roomRecord.root"),
    governance_root: assertRoot(governanceRoot, "governanceRoot"),
    issued_by_profile_root: assertRoot(issuedByProfileRoot, "issuedByProfileRoot"),
    authority_root: assertRoot(authorityRoot, "authorityRoot"),
    source_id: assertIdentifier(sourceId, "sourceId"),
    source_node_id: assertIdentifier(sourceNodeId, "sourceNodeId"),
    implementation: assertIdentifier(implementation, "implementation"),
    application: canonicalApplication(application),
    operations: [...assertCanonicalList(operations, "operations")],
    membership_epoch: assertPositiveInteger(membershipEpoch, "membershipEpoch"),
    policy_revision: assertPositiveInteger(policyRevision, "policyRevision"),
    requires_user_interaction: assertBoolean(
      requiresUserInteraction,
      "requiresUserInteraction"
    ),
    valid_from: validFrom,
    valid_until: validUntil
  };
  assertInterval(validFrom, validUntil, "sourceMandate");
  return signAgentRecord(ROOM_SOURCE_MANDATE_KIND, body, signingKey);
}

export async function verifyRoomSourceMandate(record, signerPublicKey) {
  try {
    assertSignedRecord(record, "sourceMandateRecord", ROOM_SOURCE_MANDATE_KIND);
    return validateSourceBody(await verifyAgentRecord(
      record,
      signerPublicKey,
      ROOM_SOURCE_MANDATE_KIND
    ));
  } catch (error) {
    if (error instanceof RoomAuthorityRecordError) throw error;
    fail("source-mandate-verification-failed", "source mandate verification failed", error);
  }
}

export async function createRoomSourceMandateRevocation(options) {
  assertNoUnknownFields(options, "source mandate revocation options", SOURCE_REVOCATION_FIELDS);
  const {
    revocationId = `source-mandate-revocation:${randomId()}`,
    roomRecord,
    governanceRoot,
    mandateRecord,
    revokedByProfileRoot,
    authorityRoot,
    reason,
    revokedAt,
    signingKey
  } = options;
  assertSignedRecord(mandateRecord, "mandateRecord", ROOM_SOURCE_MANDATE_KIND);
  validateSourceBody(mandateRecord.body);
  const body = {
    revocation_id: assertIdentifier(revocationId, "revocationId"),
    room_root: assertRoot(roomRecord?.root, "roomRecord.root"),
    governance_root: assertRoot(governanceRoot, "governanceRoot"),
    mandate_root: assertRoot(mandateRecord.root, "mandateRecord.root"),
    revoked_by_profile_root: assertRoot(revokedByProfileRoot, "revokedByProfileRoot"),
    authority_root: assertRoot(authorityRoot, "authorityRoot"),
    reason: assertString(reason, "reason", MAX_REASON_BYTES),
    revoked_at: revokedAt
  };
  assertCanonicalInstant(revokedAt, "revokedAt");
  return signAgentRecord(ROOM_SOURCE_MANDATE_REVOCATION_KIND, body, signingKey);
}

export async function verifyRoomSourceMandateRevocation(record, signerPublicKey) {
  try {
    assertSignedRecord(
      record,
      "sourceMandateRevocationRecord",
      ROOM_SOURCE_MANDATE_REVOCATION_KIND
    );
    return validateSourceRevocationBody(await verifyAgentRecord(
      record,
      signerPublicKey,
      ROOM_SOURCE_MANDATE_REVOCATION_KIND
    ));
  } catch (error) {
    if (error instanceof RoomAuthorityRecordError) throw error;
    fail("source-revocation-verification-failed", "source revocation verification failed", error);
  }
}

export async function createRoomApplicationGrant(options) {
  assertNoUnknownFields(options, "room application grant options", GRANT_CREATE_FIELDS);
  const {
    grantId = `room-application-grant:${randomId()}`,
    roomRecord,
    governanceRoot,
    issuedByProfileRoot,
    authorityRoot,
    memberProfileRoot,
    memberNodeId = null,
    sourceMandateRecord,
    application,
    operations,
    limits,
    membershipEpoch,
    policyRevision,
    validFrom,
    validUntil,
    signingKey
  } = options;

  assertSignedRecord(sourceMandateRecord, "sourceMandateRecord", ROOM_SOURCE_MANDATE_KIND);
  const sourceBody = validateSourceBody(sourceMandateRecord.body);
  const canonicalApp = canonicalApplication(application);
  const canonicalOps = [...assertCanonicalList(operations, "operations")];
  const canonicalGrantLimits = canonicalLimits(limits);

  if (sourceBody.room_root !== roomRecord?.root
      || sourceBody.governance_root !== governanceRoot) {
    fail("source-scope-mismatch", "source mandate is not bound to this room governance");
  }
  if (!sameCanonicalApplication(canonicalApp, sourceBody.application)) {
    fail("source-application-mismatch", "grant application differs from its source mandate");
  }
  if (!canonicalOperationsAreSubset(canonicalOps, sourceBody.operations)) {
    fail("source-operation-denied", "grant operations broaden the source mandate");
  }
  if (sourceBody.membership_epoch !== membershipEpoch
      || sourceBody.policy_revision !== policyRevision) {
    fail("source-policy-mismatch", "grant epoch or policy differs from its source mandate");
  }
  const grantInterval = assertInterval(validFrom, validUntil, "roomGrant");
  const sourceInterval = assertInterval(
    sourceBody.valid_from,
    sourceBody.valid_until,
    "sourceMandate"
  );
  if (grantInterval.from < sourceInterval.from || grantInterval.until > sourceInterval.until) {
    fail("source-validity-mismatch", "grant validity exceeds the source mandate");
  }

  const body = {
    grant_id: assertIdentifier(grantId, "grantId"),
    room_root: assertRoot(roomRecord?.root, "roomRecord.root"),
    governance_root: assertRoot(governanceRoot, "governanceRoot"),
    issued_by_profile_root: assertRoot(issuedByProfileRoot, "issuedByProfileRoot"),
    authority_root: assertRoot(authorityRoot, "authorityRoot"),
    member_profile_root: assertRoot(memberProfileRoot, "memberProfileRoot"),
    member_node_id: assertOptionalIdentifier(memberNodeId, "memberNodeId"),
    source_mandate_root: assertRoot(sourceMandateRecord.root, "sourceMandateRecord.root"),
    application: canonicalApp,
    operations: canonicalOps,
    limits: canonicalGrantLimits,
    membership_epoch: assertPositiveInteger(membershipEpoch, "membershipEpoch"),
    policy_revision: assertPositiveInteger(policyRevision, "policyRevision"),
    valid_from: validFrom,
    valid_until: validUntil
  };
  return signAgentRecord(ROOM_APPLICATION_GRANT_KIND, body, signingKey);
}

export async function verifyRoomApplicationGrant(record, signerPublicKey) {
  try {
    assertSignedRecord(record, "roomApplicationGrantRecord", ROOM_APPLICATION_GRANT_KIND);
    return validateGrantBody(await verifyAgentRecord(
      record,
      signerPublicKey,
      ROOM_APPLICATION_GRANT_KIND
    ));
  } catch (error) {
    if (error instanceof RoomAuthorityRecordError) throw error;
    fail("room-grant-verification-failed", "room application grant verification failed", error);
  }
}

export async function createRoomApplicationGrantRevocation(options) {
  assertNoUnknownFields(options, "room application grant revocation options", GRANT_REVOCATION_FIELDS);
  const {
    revocationId = `room-application-grant-revocation:${randomId()}`,
    roomRecord,
    governanceRoot,
    grantRecord,
    revokedByProfileRoot,
    authorityRoot,
    reason,
    revokedAt,
    signingKey
  } = options;
  assertSignedRecord(grantRecord, "grantRecord", ROOM_APPLICATION_GRANT_KIND);
  validateGrantBody(grantRecord.body);
  const body = {
    revocation_id: assertIdentifier(revocationId, "revocationId"),
    room_root: assertRoot(roomRecord?.root, "roomRecord.root"),
    governance_root: assertRoot(governanceRoot, "governanceRoot"),
    grant_root: assertRoot(grantRecord.root, "grantRecord.root"),
    revoked_by_profile_root: assertRoot(revokedByProfileRoot, "revokedByProfileRoot"),
    authority_root: assertRoot(authorityRoot, "authorityRoot"),
    reason: assertString(reason, "reason", MAX_REASON_BYTES),
    revoked_at: revokedAt
  };
  assertCanonicalInstant(revokedAt, "revokedAt");
  return signAgentRecord(ROOM_APPLICATION_GRANT_REVOCATION_KIND, body, signingKey);
}

export async function verifyRoomApplicationGrantRevocation(record, signerPublicKey) {
  try {
    assertSignedRecord(
      record,
      "roomApplicationGrantRevocationRecord",
      ROOM_APPLICATION_GRANT_REVOCATION_KIND
    );
    return validateGrantRevocationBody(await verifyAgentRecord(
      record,
      signerPublicKey,
      ROOM_APPLICATION_GRANT_REVOCATION_KIND
    ));
  } catch (error) {
    if (error instanceof RoomAuthorityRecordError) throw error;
    fail("grant-revocation-verification-failed", "grant revocation verification failed", error);
  }
}
