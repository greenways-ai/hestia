import { chmod, readFile, writeFile } from "node:fs/promises";
import { hcp1Pack } from "../src/agent-hcv1.js";
import {
  createAgentProfile,
  generateAgentKey,
  signAgentRecord
} from "../src/agent-protocol.js";
import {
  agentAdmissionBundle,
  createAdmissionProofBundle,
  createRoomInviteBundle,
  createRoomVersion,
  mergeHcv1Cells,
  profilePolicyRoots,
  roomPolicyRoots
} from "../src/agent-room-records.js";

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2) throw new Error("invalid hex input");
  return Uint8Array.from(hex.match(/.{2}/g), (pair) => Number.parseInt(pair, 16));
}

function recordFields(prefix, bundle) {
  return {
    [`${prefix}_record_root_hex`]: bundle.record.root.replace(/^sha256:/, ""),
    [`${prefix}_record_kind`]: bundle.record.type,
    [`${prefix}_cell_count`]: bundle.admission.cellCount,
    [`${prefix}_pack_hex`]: bytesToHex(new TextEncoder().encode(bundle.admission.hcp1Pack))
  };
}

function plainRecordBundle(record) {
  return { record, admission: agentAdmissionBundle(record) };
}

async function profile(profileId, name) {
  const rootKey = await generateAgentKey();
  const operationalKey = await generateAgentKey();
  const created = await createAgentProfile({
    profileId,
    name,
    rootKey,
    operationalKey,
    validUntil: "2099-01-01T00:00:00.000Z"
  });
  return {
    ...created,
    rootKey,
    operationalKey,
    admission: agentAdmissionBundle(created.record)
  };
}

async function createFixture(path) {
  const host = await profile("profile:postgres-room-host", "PostgreSQL Room Host");
  const guest = await profile("profile:postgres-room-guest", "PostgreSQL Room Guest");
  const profilePolicy = await profilePolicyRoots();
  const roomPolicy = await roomPolicyRoots();

  const room = await createRoomVersion({
    roomId: "room:postgres-membership",
    hostProfileRecord: host.record,
    signingKey: host.operationalKey
  });
  const capability = new Uint8Array(32).fill(37);
  const invitation = await createRoomInviteBundle({
    roomId: room.record.body.room_id,
    hostProfileRecord: host.record,
    hostOperationalKey: host.operationalKey,
    capability,
    role: "participant",
    purposes: ["room.message", "document.comment", "negotiation.propose"],
    expiresAt: "2099-01-01T00:00:00.000Z",
    inviteId: "invite:postgres-membership"
  });
  const proof = await createAdmissionProofBundle({
    inviteRecord: invitation.record,
    capability,
    guestProfileRecord: guest.record,
    guestOperationalKey: guest.operationalKey,
    proofId: "proof:postgres-membership"
  });
  const invalidProofRecord = await signAgentRecord(
    "room/admission-proof",
    proof.record.body,
    guest.rootKey
  );
  const invalidProof = {
    record: invalidProofRecord,
    admission: agentAdmissionBundle(invalidProofRecord, proof.proofPlan)
  };
  const replayProof = await createAdmissionProofBundle({
    inviteRecord: invitation.record,
    capability,
    guestProfileRecord: guest.record,
    guestOperationalKey: guest.operationalKey,
    proofId: "proof:postgres-membership-replay"
  });

  const bootstrapCells = mergeHcv1Cells(
    profilePolicy.bootstrap.hcv1Cells,
    roomPolicy.bootstrap.hcv1Cells
  );
  const bootstrapPack = hcp1Pack(bootstrapCells);

  const environment = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );
  const environmentPublicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", environment.publicKey)
  );
  const environmentPrivateKey = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", environment.privateKey)
  );

  const fixture = {
    environment_id: "hestia-room-ci",
    environment_public_key_hex: bytesToHex(environmentPublicKey),
    environment_private_key_base64: Buffer.from(environmentPrivateKey).toString("base64"),
    bootstrap_cell_count: bootstrapCells.length,
    bootstrap_pack_hex: bytesToHex(new TextEncoder().encode(bootstrapPack)),
    profile_policy_root_hex: profilePolicy.policyRoot.replace(/^sha256:/, ""),
    profile_kernel_root_hex: profilePolicy.kernelRoot.replace(/^sha256:/, ""),
    room_policy_root_hex: roomPolicy.policyRoot.replace(/^sha256:/, ""),
    room_kernel_root_hex: roomPolicy.kernelRoot.replace(/^sha256:/, ""),
    room_id: room.record.body.room_id,
    host_profile_id: host.record.body.profile_id,
    guest_profile_id: guest.record.body.profile_id,
    invite_id: invitation.record.body.invite_id,
    capability_hex: bytesToHex(capability),
    ...recordFields("host_profile", plainRecordBundle(host.record)),
    ...recordFields("guest_profile", plainRecordBundle(guest.record)),
    ...recordFields("room", room),
    ...recordFields("invitation", invitation),
    ...recordFields("proof", proof),
    ...recordFields("invalid_proof", invalidProof),
    ...recordFields("replay_proof", replayProof)
  };

  environmentPrivateKey.fill(0);
  await writeFile(path, JSON.stringify(fixture), { mode: 0o600 });
  await chmod(path, 0o600);
}

async function readFixture(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function signFixture(path, payloadHex) {
  const fixture = await readFixture(path);
  const privateBytes = new Uint8Array(
    Buffer.from(fixture.environment_private_key_base64, "base64")
  );
  try {
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      privateBytes,
      { name: "Ed25519" },
      false,
      ["sign"]
    );
    const signature = new Uint8Array(await crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      hexToBytes(payloadHex)
    ));
    process.stdout.write(bytesToHex(signature));
  } finally {
    privateBytes.fill(0);
  }
}

const [command, path, argument] = process.argv.slice(2);
if (command === "create" && path) {
  await createFixture(path);
} else if (command === "get" && path && argument) {
  const fixture = await readFixture(path);
  if (!(argument in fixture)) throw new Error(`unknown fixture field: ${argument}`);
  process.stdout.write(String(fixture[argument]));
} else if (command === "sign" && path && argument) {
  await signFixture(path, argument);
} else {
  throw new Error(
    "usage: agent-room-membership-fixture.mjs create FILE | get FILE FIELD | sign FILE PAYLOAD_HEX"
  );
}
