import {
  chmod,
  readFile,
  writeFile
} from "node:fs/promises";
import {
  createPrivateKey,
  generateKeyPairSync,
  sign,
  webcrypto
} from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
  createAgentProfile,
  importAgentPublicKey,
  keyFingerprint,
  signAgentRecord
} from "../src/agent-protocol.js";
import {
  agentAdmissionBundle,
  createAdmissionProofBundle,
  createRoomInviteBundle,
  createRoomVersion,
  profilePolicyRoots,
  roomPolicyRoots
} from "../src/agent-room-records.js";
import { hcv1ValueRoot } from "../src/agent-hcv1.js";
import {
  createRoomApplicationGrant,
  createRoomApplicationGrantRevocation,
  createRoomSourceMandate,
  createRoomSourceMandateRevocation
} from "../src/room-authority-records.js";

const APPLICATION = Object.freeze({
  appId: "greenways.chat",
  version: "0.1.0",
  publisherId: "greenways-ai",
  manifestDigest: `sha256:${"1".repeat(64)}`,
  lockDigest: `sha256:${"2".repeat(64)}`,
  approvalDigest: `sha256:${"3".repeat(64)}`
});
const LIMITS = Object.freeze({
  requestsPerDay: 20,
  maxInputBytes: 20_000,
  maxOutputBytes: 100_000,
  maxTimeoutMs: 86_400_000
});
const MEMBERSHIP_EPOCH = 2;
const POLICY_REVISION = 1;
const VALID_FROM = "2026-01-01T00:00:00.000Z";
const VALID_UNTIL = "2099-01-01T00:00:00.000Z";
const REVOKED_AT = "2026-08-13T00:00:00.000Z";

function publicKeyRaw(publicKey) {
  const der = publicKey.export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32);
}

function environmentFixture() {
  const pair = generateKeyPairSync("ed25519");
  const publicKeyBytes = publicKeyRaw(pair.publicKey);
  return {
    privateKeyPem: pair.privateKey.export({ format: "pem", type: "pkcs8" }),
    publicKeyHex: publicKeyBytes.toString("hex"),
    publicKeyBytes
  };
}

async function exportableAgentKey() {
  const generated = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );
  const [publicJwk, privatePkcs8] = await Promise.all([
    crypto.subtle.exportKey("jwk", generated.publicKey),
    crypto.subtle.exportKey("pkcs8", generated.privateKey)
  ]);
  return {
    id: await keyFingerprint(publicJwk),
    publicJwk,
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    privatePkcs8: Buffer.from(privatePkcs8).toString("base64url")
  };
}

async function importStoredKey(value) {
  return {
    id: value.id,
    publicJwk: value.publicJwk,
    publicKey: await importAgentPublicKey(value.publicJwk),
    privateKey: await crypto.subtle.importKey(
      "pkcs8",
      Buffer.from(value.privatePkcs8, "base64url"),
      { name: "Ed25519" },
      false,
      ["sign"]
    )
  };
}

async function profile(profileId, name, purposes) {
  const rootKey = await exportableAgentKey();
  const operationalKey = await exportableAgentKey();
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

function recordFields(bundle) {
  const admission = bundle.admission ?? bundle;
  return {
    root: admission.record.root,
    kind: admission.record.type,
    hcp1Pack: admission.hcp1Pack
  };
}

function plainRecordBundle(record) {
  return {
    record,
    admission: agentAdmissionBundle(record)
  };
}

async function createFixture(path) {
  const environment = environmentFixture();
  const host = await profile(
    "profile:authority-host",
    "Authority Host",
    [
      "profile.update",
      "room.app.grant",
      "room.create",
      "room.invite",
      "room.join",
      "room.message",
      "room.source.manage"
    ]
  );
  const guest = await profile(
    "profile:authority-guest",
    "Authority Guest",
    ["profile.update", "room.app.invoke", "room.join", "room.message"]
  );
  const profilePolicy = await profilePolicyRoots();
  const roomPolicy = await roomPolicyRoots();
  const room = await createRoomVersion({
    roomId: "room:authority-admission",
    hostProfileRecord: host.record,
    signingKey: host.operationalKey
  });
  const capability = new Uint8Array(32).fill(23);
  const invitation = await createRoomInviteBundle({
    roomId: room.record.body.room_id,
    hostProfileRecord: host.record,
    hostOperationalKey: host.operationalKey,
    role: "member",
    purposes: ["room.app.invoke", "room.message"],
    capability,
    expiresAt: "2099-01-01T00:00:00.000Z"
  });
  const proof = await createAdmissionProofBundle({
    inviteRecord: invitation.record,
    capability,
    guestProfileRecord: guest.record,
    guestOperationalKey: guest.operationalKey
  });
  const environmentKeyPlan = await hcv1ValueRoot(environment.publicKeyBytes);
  const fixture = {
    environment: {
      privateKeyPem: environment.privateKeyPem,
      publicKeyHex: environment.publicKeyHex,
      keyRoot: environmentKeyPlan.root
    },
    policy: {
      profilePolicyRoot: profilePolicy.policyRoot,
      profileKernelRoot: profilePolicy.kernelRoot,
      roomPolicyRoot: roomPolicy.policyRoot,
      roomKernelRoot: roomPolicy.kernelRoot,
      bootstrapHcp1Pack: profilePolicy.bootstrap.hcp1Pack,
      roomBootstrapHcp1Pack: roomPolicy.bootstrap.hcp1Pack
    },
    capability: Buffer.from(capability).toString("base64url"),
    recordFields: {
      host_profile: recordFields(plainRecordBundle(host.record)),
      guest_profile: recordFields(plainRecordBundle(guest.record)),
      room: recordFields(room),
      invitation: recordFields(invitation),
      proof: recordFields(proof)
    },
    private: {
      hostOperationalKey: {
        id: host.operationalKey.id,
        publicJwk: host.operationalKey.publicJwk,
        privatePkcs8: host.operationalKey.privatePkcs8
      },
      hostProfileRecord: host.record,
      hostDelegationRecord: host.delegation,
      guestProfileRecord: guest.record,
      roomRecord: room.record
    }
  };
  await writeFile(path, JSON.stringify(fixture), { mode: 0o600 });
  await chmod(path, 0o600);
}

async function addAuthorityRecords(path, governanceRoot) {
  const fixture = JSON.parse(await readFile(path, "utf8"));
  const signingKey = await importStoredKey(fixture.private.hostOperationalKey);
  const {
    hostProfileRecord,
    hostDelegationRecord,
    guestProfileRecord,
    roomRecord
  } = fixture.private;
  const canonicalGovernanceRoot = /^sha256:/.test(governanceRoot)
    ? governanceRoot
    : `sha256:${governanceRoot}`;
  if (!/^sha256:[0-9a-f]{64}$/.test(canonicalGovernanceRoot)) {
    throw new Error("governance root must be one lowercase SHA-256 root");
  }

  const staleSource = await createRoomSourceMandate({
    mandateId: "source-mandate/stale-governance",
    roomRecord,
    governanceRoot: `sha256:${"9".repeat(64)}`,
    issuedByProfileRoot: hostProfileRecord.root,
    authorityRoot: hostDelegationRecord.root,
    sourceId: "source/stale-governance",
    sourceNodeId: "node/authority-host",
    implementation: "greenways.chatgpt-web",
    application: APPLICATION,
    operations: ["message.submit"],
    membershipEpoch: MEMBERSHIP_EPOCH,
    policyRevision: POLICY_REVISION,
    requiresUserInteraction: true,
    validFrom: VALID_FROM,
    validUntil: VALID_UNTIL,
    signingKey
  });
  const source = await createRoomSourceMandate({
    mandateId: "source-mandate/host-chatgpt",
    roomRecord,
    governanceRoot: canonicalGovernanceRoot,
    issuedByProfileRoot: hostProfileRecord.root,
    authorityRoot: hostDelegationRecord.root,
    sourceId: "source/host-chatgpt-browser",
    sourceNodeId: "node/authority-host",
    implementation: "greenways.chatgpt-web",
    application: APPLICATION,
    operations: ["conversation.create", "message.submit", "response.read"],
    membershipEpoch: MEMBERSHIP_EPOCH,
    policyRevision: POLICY_REVISION,
    requiresUserInteraction: true,
    validFrom: VALID_FROM,
    validUntil: VALID_UNTIL,
    signingKey
  });
  const grant = await createRoomApplicationGrant({
    grantId: "room-application-grant/guest-chat",
    roomRecord,
    governanceRoot: canonicalGovernanceRoot,
    issuedByProfileRoot: hostProfileRecord.root,
    authorityRoot: hostDelegationRecord.root,
    memberProfileRoot: guestProfileRecord.root,
    memberNodeId: "node/authority-guest",
    sourceMandateRecord: source,
    application: APPLICATION,
    operations: ["message.submit", "response.read"],
    limits: LIMITS,
    membershipEpoch: MEMBERSHIP_EPOCH,
    policyRevision: POLICY_REVISION,
    validFrom: VALID_FROM,
    validUntil: VALID_UNTIL,
    signingKey
  });
  const broadenedGrant = await signAgentRecord(
    "room/application-grant",
    {
      ...grant.body,
      grant_id: "room-application-grant/broadened",
      operations: ["conversation.delete", "message.submit"]
    },
    signingKey
  );
  const sourceRevocation = await createRoomSourceMandateRevocation({
    revocationId: "source-mandate-revocation/host-chatgpt",
    roomRecord,
    governanceRoot: canonicalGovernanceRoot,
    mandateRecord: source,
    revokedByProfileRoot: hostProfileRecord.root,
    authorityRoot: hostDelegationRecord.root,
    reason: "host-disabled-source",
    revokedAt: REVOKED_AT,
    signingKey
  });
  const grantRevocation = await createRoomApplicationGrantRevocation({
    revocationId: "room-application-grant-revocation/guest-chat",
    roomRecord,
    governanceRoot: canonicalGovernanceRoot,
    grantRecord: grant,
    revokedByProfileRoot: hostProfileRecord.root,
    authorityRoot: hostDelegationRecord.root,
    reason: "member-access-revoked",
    revokedAt: REVOKED_AT,
    signingKey
  });

  fixture.recordFields = {
    ...fixture.recordFields,
    stale_source: recordFields(plainRecordBundle(staleSource)),
    source_mandate: recordFields(plainRecordBundle(source)),
    broadened_grant: recordFields(plainRecordBundle(broadenedGrant)),
    application_grant: recordFields(plainRecordBundle(grant)),
    source_revocation: recordFields(plainRecordBundle(sourceRevocation)),
    grant_revocation: recordFields(plainRecordBundle(grantRevocation))
  };
  await writeFile(path, JSON.stringify(fixture), { mode: 0o600 });
  await chmod(path, 0o600);
}

function signReceipt(path, payloadHex) {
  const fixture = JSON.parse(require("node:fs").readFileSync(path, "utf8"));
  const privateKey = createPrivateKey(fixture.environment.privateKeyPem);
  const signature = sign(null, Buffer.from(payloadHex, "hex"), privateKey);
  process.stdout.write(signature.toString("hex"));
}

const [command, path, value] = process.argv.slice(2);
if (command === "create" && path) {
  await createFixture(path);
} else if (command === "authority" && path && value) {
  await addAuthorityRecords(path, value);
} else if (command === "sign" && path && value) {
  signReceipt(path, value);
} else {
  throw new Error(
    "usage: room-authority-admission-fixture.mjs "
      + "create FILE | authority FILE GOVERNANCE_ROOT | sign FILE PAYLOAD_HEX"
  );
}
