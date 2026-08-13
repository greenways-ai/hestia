import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentProfile,
  generateAgentKey
} from "../src/agent-protocol.js";
import { createRoomVersion } from "../src/agent-room-records.js";
import {
  RoomAuthorityRecordError,
  createRoomSourceMandate,
  verifyRoomSourceMandate
} from "../src/room-authority-records.js";

const APPLICATION = Object.freeze({
  appId: "greenways.chat",
  version: "0.1.0",
  publisherId: "greenways-ai",
  manifestDigest: `sha256:${"1".repeat(64)}`,
  lockDigest: `sha256:${"2".repeat(64)}`,
  approvalDigest: `sha256:${"3".repeat(64)}`
});

async function signedSourceMandate() {
  const rootKey = await generateAgentKey();
  const operationalKey = await generateAgentKey();
  const host = await createAgentProfile({
    profileId: "profile:closed-record-host",
    name: "Closed record host",
    rootKey,
    operationalKey,
    validUntil: "2099-01-01T00:00:00.000Z"
  });
  const room = await createRoomVersion({
    roomId: "room:closed-record",
    hostProfileRecord: host.record,
    signingKey: operationalKey
  });
  const record = await createRoomSourceMandate({
    mandateId: "source-mandate/closed-record",
    roomRecord: room.record,
    governanceRoot: `sha256:${"4".repeat(64)}`,
    issuedByProfileRoot: host.record.root,
    authorityRoot: host.delegation.root,
    sourceId: "source/closed-record",
    sourceNodeId: "node/closed-record",
    implementation: "greenways.chatgpt-web",
    application: APPLICATION,
    operations: ["message.submit"],
    membershipEpoch: 1,
    policyRevision: 1,
    requiresUserInteraction: true,
    validFrom: "2026-08-01T00:00:00.000Z",
    validUntil: "2026-09-01T00:00:00.000Z",
    signingKey: operationalKey
  });
  return { record, operationalKey };
}

test("source mandate verification rejects unsigned body fields", async () => {
  const { record, operationalKey } = await signedSourceMandate();
  const changed = structuredClone(record);
  changed.body.browser_cookie = "must-not-cross-the-boundary";

  await assert.rejects(
    () => verifyRoomSourceMandate(changed, operationalKey.publicKey),
    (error) => error instanceof RoomAuthorityRecordError
      && error.code === "invalid-record"
  );
});

test("source mandate verification rejects unsigned envelope fields", async () => {
  const { record, operationalKey } = await signedSourceMandate();
  const changed = structuredClone(record);
  changed.provider_credential = "must-not-cross-the-boundary";

  await assert.rejects(
    () => verifyRoomSourceMandate(changed, operationalKey.publicKey),
    (error) => error instanceof RoomAuthorityRecordError
      && error.code === "invalid-record"
  );
});
