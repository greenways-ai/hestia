import { concatBytes, textEncoder } from "./encoding.js";
import {
  hcp1Pack,
  hcv1ValueRoot,
  verifyHcv1AgentRecord
} from "./agent-hcv1.js";
import {
  createAdmissionProof,
  createRoomInvite,
  signAgentRecord
} from "./agent-protocol.js";
import { randomId } from "./protocol.js";

export const DEFAULT_PROFILE_POLICY = "hestia.agent-profile/policy-v1";
export const DEFAULT_PROFILE_KERNEL = "hestia.agent-profile/kernel-v1";
export const DEFAULT_ROOM_POLICY = "hestia.agent-room/policy-v1";
export const DEFAULT_ROOM_KERNEL = "hestia.agent-room/kernel-v1";

const CAPABILITY_DOMAIN = textEncoder.encode("HESTIA-ROOM-CAPABILITY/1\0");
const ADMISSION_DOMAIN = textEncoder.encode("HESTIA-ROOM-ADMISSION/1\0");

function requireRoot(record, name) {
  if (!record?.root) throw new Error(`${name} is required`);
  return record.root;
}

function companionCells(value) {
  if (Array.isArray(value)) return value;
  return value?.hcv1_cells ?? [];
}

export function mergeHcv1Cells(...values) {
  const cells = new Map();
  for (const value of values) {
    for (const cell of companionCells(value)) {
      const previous = cells.get(cell.root);
      if (previous && JSON.stringify(previous) !== JSON.stringify(cell)) {
        throw new Error(`conflicting HCV1 cell for root ${cell.root}`);
      }
      cells.set(cell.root, cell);
    }
  }
  return [...cells.values()];
}

export function agentAdmissionBundle(record, ...companions) {
  if (!record?.root || !record?.hcp1_pack || !record?.hcv1_cells) {
    throw new Error("a signed HCV1 agent record is required");
  }
  const hcv1Cells = mergeHcv1Cells(record, ...companions);
  return Object.freeze({
    record,
    root: record.root,
    kind: record.type,
    cellCount: hcv1Cells.length,
    hcv1Cells,
    hcp1Pack: hcp1Pack(hcv1Cells)
  });
}

async function digestPlan(domain, ...parts) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    concatBytes(domain, ...parts)
  ));
  return hcv1ValueRoot(digest);
}

export function profilePolicyRoots({
  policy = DEFAULT_PROFILE_POLICY,
  kernel = DEFAULT_PROFILE_KERNEL
} = {}) {
  return policyRoots(policy, kernel);
}

export function roomPolicyRoots({
  policy = DEFAULT_ROOM_POLICY,
  kernel = DEFAULT_ROOM_KERNEL
} = {}) {
  return policyRoots(policy, kernel);
}

async function policyRoots(policy, kernel) {
  const [policyPlan, kernelPlan] = await Promise.all([
    hcv1ValueRoot(policy),
    hcv1ValueRoot(kernel)
  ]);
  const hcv1Cells = mergeHcv1Cells(policyPlan, kernelPlan);
  return Object.freeze({
    policy,
    kernel,
    policyRoot: policyPlan.root,
    kernelRoot: kernelPlan.root,
    policyPlan,
    kernelPlan,
    bootstrap: Object.freeze({
      hcv1Cells,
      hcp1Pack: hcp1Pack(hcv1Cells)
    })
  });
}

export async function roomCapabilityPlan(capability, inviteId) {
  if (!(capability instanceof Uint8Array) || capability.length !== 32) {
    throw new Error("room invitation capability must be 32 bytes");
  }
  if (!inviteId) throw new Error("room invitation id is required");
  return digestPlan(
    CAPABILITY_DOMAIN,
    textEncoder.encode(`${inviteId}\0`),
    capability
  );
}

export async function roomAdmissionProofPlan({
  capability,
  inviteRoot,
  guestProfileRoot
}) {
  if (!(capability instanceof Uint8Array) || capability.length !== 32) {
    throw new Error("room admission capability must be 32 bytes");
  }
  if (!inviteRoot || !guestProfileRoot) {
    throw new Error("invitation and guest profile roots are required");
  }
  return digestPlan(
    ADMISSION_DOMAIN,
    capability,
    textEncoder.encode(`${inviteRoot}\0${guestProfileRoot}`)
  );
}

export async function createRoomVersion({
  roomId = `room:${randomId()}`,
  hostProfileRecord,
  signingKey,
  previousRoomRecord = null,
  sequence = previousRoomRecord ? previousRoomRecord.body.sequence + 1 : 1,
  acceptanceMode = "human-required",
  policy = DEFAULT_ROOM_POLICY,
  kernel = DEFAULT_ROOM_KERNEL
}) {
  requireRoot(hostProfileRecord, "a signed host profile");
  if (!signingKey?.privateKey || !signingKey?.id) {
    throw new Error("a room operational signing key is required");
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("room sequence must be a positive safe integer");
  }
  const roots = await roomPolicyRoots({ policy, kernel });
  const body = {
    room_id: roomId,
    sequence,
    previous_room_root: previousRoomRecord?.root ?? null,
    host_profile_root: hostProfileRecord.root,
    policy_root: roots.policyRoot,
    kernel_root: roots.kernelRoot,
    acceptance_mode: acceptanceMode
  };
  const record = await signAgentRecord("room/version", body, signingKey);
  return Object.freeze({
    record,
    admission: agentAdmissionBundle(
      record,
      roots.policyPlan,
      roots.kernelPlan
    ),
    ...roots
  });
}

export async function verifyRoomVersion({ roomRecord, signerPublicKey }) {
  const body = await verifyHcv1AgentRecord(roomRecord, signerPublicKey);
  if (roomRecord.type !== "room/version") {
    throw new Error("expected an HCV1 room version");
  }
  if (body.sequence === 1 && body.previous_room_root !== null) {
    throw new Error("room genesis cannot have a predecessor");
  }
  if (body.sequence > 1 && !body.previous_room_root) {
    throw new Error("room update must bind its predecessor");
  }
  return body;
}

export async function createRoomInviteBundle(options) {
  const created = await createRoomInvite(options);
  const capabilityPlan = await roomCapabilityPlan(
    created.capability,
    created.record.body.invite_id
  );
  if (created.record.body.capability_commitment !== capabilityPlan.root) {
    throw new Error("room invitation commitment does not match its capability");
  }
  return Object.freeze({
    ...created,
    capabilityPlan,
    admission: agentAdmissionBundle(created.record, capabilityPlan)
  });
}

export async function createAdmissionProofBundle(options) {
  const record = await createAdmissionProof(options);
  const proofPlan = await roomAdmissionProofPlan({
    capability: options.capability,
    inviteRoot: options.inviteRecord.root,
    guestProfileRoot: options.guestProfileRecord.root
  });
  if (record.body.capability_proof !== proofPlan.root) {
    throw new Error("room admission proof does not match its capability");
  }
  return Object.freeze({
    record,
    proofPlan,
    admission: agentAdmissionBundle(record, proofPlan)
  });
}
