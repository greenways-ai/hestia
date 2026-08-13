import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ROOM_AUTHORITY_CONFORMANCE_PROTOCOL,
  ROOM_AUTHORITY_DECISION_PROTOCOL,
  RoomAuthorityError,
  authorizeRoomInvocation,
  validateRoomAuthorityDecision,
  validateRoomInvocation
} from "../src/room-authority.js";

const fixture = JSON.parse(await readFile(
  new URL("../fixtures/room-authority-conformance.json", import.meta.url),
  "utf8"
));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(base, override) {
  if (override === undefined) return clone(base);
  if (Array.isArray(base) || Array.isArray(override)
      || base === null || override === null
      || typeof base !== "object" || typeof override !== "object") {
    return clone(override);
  }
  const result = clone(base);
  for (const [key, value] of Object.entries(override)) {
    result[key] = key in result ? deepMerge(result[key], value) : clone(value);
  }
  return result;
}

function caseInput(overrides) {
  return {
    room: deepMerge(fixture.base.room, overrides.room ?? {}),
    membership: deepMerge(fixture.base.membership, overrides.membership ?? {}),
    sourceMandate: deepMerge(
      fixture.base.sourceMandate,
      overrides.sourceMandate ?? {}
    ),
    grant: deepMerge(fixture.base.grant, overrides.grant ?? {}),
    invocation: deepMerge(fixture.base.invocation, overrides.invocation ?? {}),
    observedAt: overrides.observedAt ?? fixture.observedAt
  };
}

test("published room authority conformance cases are deterministic", () => {
  assert.equal(fixture.protocol, ROOM_AUTHORITY_CONFORMANCE_PROTOCOL);
  assert.equal(fixture.decisionCorrelation, "exact-invocation-projection");
  for (const entry of fixture.cases) {
    const input = caseInput(entry.overrides);
    const decision = authorizeRoomInvocation(input);
    assert.equal(decision.protocol, ROOM_AUTHORITY_DECISION_PROTOCOL, entry.name);
    assert.equal(decision.allowed, entry.expected.allowed, entry.name);
    assert.equal(decision.reason, entry.expected.reason, entry.name);
    assert.deepEqual(decision.invocation, input.invocation, entry.name);
    assert.notEqual(decision.invocation, input.invocation, entry.name);
    assert.equal(
      decision.requiresUserInteraction,
      entry.expected.requiresUserInteraction,
      entry.name
    );
  }
});

test("allowed decisions retain the exact invocation and Hestia authority roots", () => {
  const decision = authorizeRoomInvocation(caseInput({}));
  assert.deepEqual(decision.invocation, fixture.base.invocation);
  assert.equal(Object.isFrozen(decision.invocation), true);
  assert.equal(Object.isFrozen(decision.invocation.application), true);
  assert.deepEqual(
    {
      membershipRoot: decision.membershipRoot,
      sourceMandateRoot: decision.sourceMandateRoot,
      grantRoot: decision.grantRoot
    },
    {
      membershipRoot: fixture.base.membership.membershipRoot,
      sourceMandateRoot: fixture.base.sourceMandate.mandateRoot,
      grantRoot: fixture.base.grant.grantRoot
    }
  );
});

test("denials retain the exact invocation without successful authority evidence", () => {
  const input = caseInput({
    invocation: { operation: "conversation.delete" }
  });
  const decision = authorizeRoomInvocation(input);
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.invocation, input.invocation);
  assert.equal(decision.membershipRoot, null);
  assert.equal(decision.sourceMandateRoot, null);
  assert.equal(decision.grantRoot, null);
  assert.equal(decision.requiresUserInteraction, false);
});

test("decisions detach the exact invocation from caller mutation", () => {
  const input = caseInput({});
  const decision = authorizeRoomInvocation(input);
  input.invocation.argumentsDigest = `sha256:${"7".repeat(64)}`;
  input.invocation.application.approvalDigest = `sha256:${"8".repeat(64)}`;
  input.invocation.timeoutMs = 1;
  assert.deepEqual(decision.invocation, fixture.base.invocation);
});

test("decision validation rejects partial correlation and secret-shaped fields", () => {
  const decision = authorizeRoomInvocation(caseInput({}));
  const { invocation: _invocation, ...partial } = decision;
  assert.throws(
    () => validateRoomAuthorityDecision(partial),
    (error) => error instanceof RoomAuthorityError
      && error.code === "invalid-projection"
  );
  assert.throws(
    () => validateRoomAuthorityDecision({
      ...decision,
      browserCookie: "must-not-cross-the-boundary"
    }),
    (error) => error instanceof RoomAuthorityError
      && error.code === "invalid-projection"
  );
});

test("projections reject unknown and secret-shaped fields", () => {
  assert.throws(
    () => validateRoomInvocation({
      ...fixture.base.invocation,
      browserCookie: "must-not-cross-the-boundary"
    }),
    (error) => error instanceof RoomAuthorityError
      && error.code === "invalid-projection"
  );
});

test("projection validation returns a detached immutable value", () => {
  const invocation = clone(fixture.base.invocation);
  const checked = validateRoomInvocation(invocation);
  invocation.application.appId = "changed.after.validation";
  assert.equal(checked.application.appId, "greenways.chat");
  assert.equal(Object.isFrozen(checked), true);
  assert.equal(Object.isFrozen(checked.application), true);
});
