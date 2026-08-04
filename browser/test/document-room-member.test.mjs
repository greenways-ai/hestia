import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentProfile,
  generateAgentKey
} from "../src/agent-protocol.js";
import {
  assertGenesisMemberBinding,
  verifyDocumentRoomMember
} from "../src/document-room-member.js";

async function member({ purposes = ["profile.update", "document.edit"] } = {}) {
  const [rootKey, operationalKey] = await Promise.all([
    generateAgentKey(),
    generateAgentKey()
  ]);
  const profile = await createAgentProfile({
    profileId: "profile:document-room-member",
    name: "Document room member",
    rootKey,
    operationalKey,
    purposes,
    validUntil: "2099-01-01T00:00:00.000Z"
  });
  return {
    rootKey,
    operationalKey,
    descriptor: {
      memberId: profile.record.body.profile_id,
      label: "Member",
      role: "editor",
      publicKeyJwk: operationalKey.publicJwk,
      profileRecord: profile.record,
      delegationRecord: profile.delegation
    }
  };
}

test("accepts a member whose signed profile delegates document editing to its advertised key", async () => {
  const value = await member();
  const verified = await verifyDocumentRoomMember(value.descriptor, {
    documentId: "document:test"
  });
  assert.equal(verified.profile.body.profile_id, value.descriptor.memberId);
  assert.ok(verified.delegation.purposes.includes("document.edit"));
  assert.equal(verified.operationalKeyId, value.operationalKey.id);
});

test("rejects an advertised key that is not the profile operational key", async () => {
  const value = await member();
  const replacement = await generateAgentKey();
  await assert.rejects(
    () => verifyDocumentRoomMember({
      ...value.descriptor,
      publicKeyJwk: replacement.publicJwk
    }, { documentId: "document:test" }),
    /active profile operational key/
  );
});

test("rejects a profile without document edit authority", async () => {
  const value = await member({ purposes: ["profile.update"] });
  await assert.rejects(
    () => verifyDocumentRoomMember(value.descriptor, {
      documentId: "document:test"
    }),
    /does not permit document\.edit/
  );
});

test("binds signed genesis membership to the verified profile and delegation roots", async () => {
  const value = await member();
  assert.equal(assertGenesisMemberBinding({
    member_id: value.descriptor.memberId,
    public_key_jwk: value.descriptor.publicKeyJwk,
    profile_root: value.descriptor.profileRecord.root,
    delegation_root: value.descriptor.delegationRecord.root
  }, value.descriptor), true);

  assert.throws(() => assertGenesisMemberBinding({
    member_id: value.descriptor.memberId,
    public_key_jwk: value.descriptor.publicKeyJwk,
    profile_root: `sha256:${"0".repeat(64)}`,
    delegation_root: value.descriptor.delegationRecord.root
  }, value.descriptor), /genesis member roots/);
});
