import { hcv1ValueRoot, signHcv1AgentRecord, verifyHcv1AgentRecord } from "./agent-hcv1.js";
import { randomId } from "./protocol.js";

export const DEFAULT_ROOM_POLICY = "hestia.agent-room/policy-v1";
export const DEFAULT_ROOM_KERNEL = "hestia.agent-room/kernel-v1";

export async function roomPolicyRoots({
  policy = DEFAULT_ROOM_POLICY,
  kernel = DEFAULT_ROOM_KERNEL
} = {}) {
  const [policyPlan, kernelPlan] = await Promise.all([
    hcv1ValueRoot(policy),
    hcv1ValueRoot(kernel)
  ]);
  return {
    policy,
    kernel,
    policyRoot: policyPlan.root,
    kernelRoot: kernelPlan.root,
    policyPlan,
    kernelPlan
  };
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
  if (!hostProfileRecord?.root) throw new Error("a signed host profile is required");
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
  return {
    record: await signHcv1AgentRecord("room/version", body, signingKey),
    ...roots
  };
}

export async function verifyRoomVersion({ roomRecord, signerPublicKey }) {
  const body = await verifyHcv1AgentRecord(roomRecord, signerPublicKey);
  if (roomRecord.type !== "room/version") throw new Error("expected an HCV1 room version");
  if (body.sequence === 1 && body.previous_room_root !== null) {
    throw new Error("room genesis cannot have a predecessor");
  }
  if (body.sequence > 1 && !body.previous_room_root) {
    throw new Error("room update must bind its predecessor");
  }
  return body;
}
