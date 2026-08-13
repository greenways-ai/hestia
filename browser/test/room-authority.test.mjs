import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ROOM_AUTHORITY_CONFORMANCE_PROTOCOL,
  ROOM_AUTHORITY_DECISION_PROTOCOL,
  RoomAuthorityError,
  authorizeRoomInvocation,
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
  for (const entry of fixture.cases) {
    const decision = authorizeRoomInvocation(caseInput(entry.overrides));
    assert.equal(decision.protocol, ROOM_AUTHORITY_DECISION_PROTOCOL, entry.name);
    assert.equal(decision.allowed, entry.expected.allowed, entry.name);
    assert.equal(decision.reason, entry.expected.reason, entry.name);
    assert.equal(
      decision.requiresUserInteraction,
      entry.expected.requiresUserInteraction,
      entry.name
    );
  }
});

test("allowed decisions retain the exact Hestia authority roots", () => {
  const decision = authorizeRoomInvocation(caseInput({}));
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

test("denials do not project authority roots as successful evidence", () => {
  const decision = authorizeRoomInvocation(caseInput({
    invocation: { operation: "conversation.delete" }
  }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.membershipRoot, null);
  assert.equal(decision.sourceMandateRoot, null);
  assert.equal(decision.grantRoot, null);
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
