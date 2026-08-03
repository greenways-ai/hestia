import {
  base64UrlToBytes,
  bytesToBase64Url,
  concatBytes,
  textEncoder
} from "./encoding.js";

export const HCV1_AGENT_PROTOCOL = "hestia-agent-hcv1/1";
export const HCV1_CODEC_VERSION = 1;
export const HCV1_RECORD_TYPE_TAG = 14;

const TYPE = Object.freeze({
  nil: 0,
  boolean: 1,
  integer: 2,
  string: 5,
  blob: 6,
  vector: 10,
  map: 11,
  record: 14
});

export const AGENT_RECORD_SCHEMAS = Object.freeze({
  "profile/version": [
    ["profile-id", "profile_id"],
    ["sequence", "sequence"],
    ["previous-profile", "previous_profile_root", "reference"],
    ["name", "name"],
    ["profile-kind", "profile_kind"],
    ["root-key", "root_key"],
    ["operational-key", "operational_key"],
    ["delegation", "delegation", "reference"]
  ],
  "profile/key-delegation": [
    ["delegation-id", "delegation_id"],
    ["issuer-profile", "issuer_profile_id"],
    ["issuer-key", "issuer_key"],
    ["subject-key", "subject_key"],
    ["subject-public-key", "subject_public_jwk"],
    ["purposes", "purposes"],
    ["scope", "scope"],
    ["valid-from", "valid_from"],
    ["valid-until", "valid_until"],
    ["revocation", "revocation_root", "reference"]
  ],
  "room/version": [
    ["room-id", "room_id"],
    ["sequence", "sequence"],
    ["previous-room", "previous_room_root", "reference"],
    ["host-profile", "host_profile_root", "reference"],
    ["policy", "policy_root", "reference"],
    ["kernel", "kernel_root", "reference"],
    ["acceptance-mode", "acceptance_mode"]
  ],
  "room/invitation": [
    ["invite-id", "invite_id"],
    ["room", "room_id"],
    ["host-profile-id", "host_profile_id"],
    ["host-profile", "host_profile_root", "reference"],
    ["role", "role"],
    ["purposes", "purposes"],
    ["expires-at", "expires_at"],
    ["capability-commitment", "capability_commitment", "reference"],
    ["one-time", "one_time"]
  ],
  "room/admission-proof": [
    ["proof-id", "proof_id"],
    ["invitation", "invite_root", "reference"],
    ["invite-id", "invite_id"],
    ["room", "room_id"],
    ["guest-profile-id", "guest_profile_id"],
    ["guest-profile", "guest_profile_root", "reference"],
    ["guest-key", "guest_operational_key"],
    ["capability-proof", "capability_proof", "reference"]
  ],
  "room/membership": [
    ["room", "room_root", "reference"],
    ["member-profile", "member_profile_root", "reference"],
    ["role", "role"],
    ["purposes", "purposes"],
    ["status", "status"],
    ["joined-epoch", "joined_epoch"],
    ["revoked-epoch", "revoked_epoch"],
    ["delegation", "delegation_root", "reference"]
  ],
  "room/message": [
    ["message-id", "message_id"],
    ["room", "room_id"],
    ["membership-epoch", "membership_epoch"],
    ["sender-profile", "sender_profile_id"],
    ["sent-at", "sent_at"],
    ["iv", "iv"],
    ["ciphertext", "ciphertext"],
    ["ciphertext-root", "ciphertext_root", "reference"]
  ],
  "room/message-intent": [
    ["room", "room_root", "reference"],
    ["membership-epoch", "membership_epoch"],
    ["sender-profile", "sender_profile_root", "reference"],
    ["envelope", "envelope_root", "reference"],
    ["ciphertext", "ciphertext_root", "reference"],
    ["delivery-policy", "delivery_policy_root", "reference"]
  ],
  "document/version": [
    ["document-id", "document_id"],
    ["version", "version"],
    ["previous-version", "previous_version_root", "reference"],
    ["content", "content_root", "reference"],
    ["media-type", "media_type"],
    ["author-profile", "author_profile_id"],
    ["created-at", "created_at"]
  ],
  "room/document-attachment": [
    ["room", "room_root", "reference"],
    ["document", "document_root", "reference"],
    ["document-policy", "document_policy_root", "reference"],
    ["attached-by", "attached_by_profile_root", "reference"]
  ],
  "negotiation/offer": [
    ["offer-id", "offer_id"],
    ["room", "room_id"],
    ["terms", "terms"],
    ["offered-by", "offered_by"],
    ["supersedes", "supersedes", "reference"],
    ["valid-until", "valid_until"],
    ["authority", "authority_root", "reference"]
  ],
  "negotiation/acceptance": [
    ["offer", "offer_root", "reference"],
    ["accepted-by", "accepted_by"],
    ["human-approval", "human_approval_root", "reference"],
    ["accepted-at", "accepted_at"],
    ["authority", "authority_root", "reference"]
  ],
  "ledger/signed-record": [
    ["body", "body_root", "reference"],
    ["signer-key", "signer_key"],
    ["signature", "signature_root", "reference"]
  ],
  "ledger/admission-receipt": [
    ["previous-state", "previous_state_root", "reference"],
    ["event", "event_root", "reference"],
    ["policy", "policy_root", "reference"],
    ["kernel", "kernel_root", "reference"],
    ["result-state", "result_state_root", "reference"],
    ["effect-plan", "effect_plan_root", "reference"],
    ["record", "record_root", "reference"],
    ["outcome", "outcome_root", "reference"],
    ["sequence", "sequence_root", "reference"]
  ]
});

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 || !/^[0-9a-f]*$/.test(hex)) {
    throw new Error("invalid lowercase hexadecimal transport");
  }
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function compareBytes(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

async function digestHex(bytes) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

function envelopeBytes(typeTag, payload) {
  return textEncoder.encode(`HCV1:${typeTag}:${payload.length}:${bytesToHex(payload)}`);
}

function roleRef(position, role, childRoot) {
  return { position, role, child_root: childRoot };
}

async function createCell(typeTag, payload, refs = []) {
  const envelope = envelopeBytes(typeTag, payload);
  return {
    root: await digestHex(envelope),
    codec_version: HCV1_CODEC_VERSION,
    type_tag: typeTag,
    payload_hex: bytesToHex(payload),
    refs,
    envelope
  };
}

function mergeCells(...groups) {
  const byRoot = new Map();
  for (const group of groups) {
    for (const cell of group ?? []) byRoot.set(cell.root, cell);
  }
  return [...byRoot.values()];
}

function rootHex(value) {
  const root = typeof value === "string"
    ? value
    : value?.hcv1?.root ?? value?.root ?? value?.body_root;
  const match = /^sha256:([0-9a-f]{64})$/.exec(String(root ?? ""));
  if (!match) throw new Error("expected an HCV1 sha256 root reference");
  return match[1];
}

function referencedCells(value) {
  return value?.hcv1_cells ?? value?.hcv1?.cells ?? [];
}

async function encodeReference(value) {
  if (value === undefined || value === null) return encodeHcv1Value(null);
  return { root: rootHex(value), cells: referencedCells(value), envelope: null };
}

async function encodeVector(values) {
  const encoded = [];
  for (const value of values) encoded.push(await encodeHcv1Value(value));
  const payload = textEncoder.encode(`S:${encoded.length}:${encoded.map(({ root }) => root).join("")}`);
  const cell = await createCell(
    TYPE.vector,
    payload,
    encoded.map(({ root }, position) => roleRef(position, "element", root))
  );
  return {
    root: cell.root,
    cell,
    cells: mergeCells(encoded.flatMap(({ cells }) => cells), [cell]),
    envelope: cell.envelope
  };
}

async function encodeMap(value) {
  const pairs = [];
  for (const [key, item] of Object.entries(value)) {
    const encodedKey = await encodeHcv1Value(key);
    const encodedValue = await encodeHcv1Value(item);
    pairs.push({ key: encodedKey, value: encodedValue });
  }
  pairs.sort((left, right) => compareBytes(left.key.envelope, right.key.envelope));
  const roots = pairs.flatMap(({ key, value }) => [key.root, value.root]);
  const refs = pairs.flatMap(({ key, value }, position) => [
    roleRef(position, "key", key.root),
    roleRef(position, "value", value.root)
  ]);
  const cell = await createCell(
    TYPE.map,
    textEncoder.encode(`M:${pairs.length}:${roots.join("")}`),
    refs
  );
  return {
    root: cell.root,
    cell,
    cells: mergeCells(
      pairs.flatMap(({ key, value }) => [...key.cells, ...value.cells]),
      [cell]
    ),
    envelope: cell.envelope
  };
}

export async function encodeHcv1Value(value) {
  let cell;
  if (value === undefined || value === null) {
    cell = await createCell(TYPE.nil, new Uint8Array());
  } else if (typeof value === "boolean") {
    cell = await createCell(TYPE.boolean, new Uint8Array([value ? 1 : 0]));
  } else if (typeof value === "number" || typeof value === "bigint") {
    if (typeof value === "number" && (!Number.isSafeInteger(value) || !Number.isFinite(value))) {
      throw new Error("HCV1 agent records currently require safe integers");
    }
    cell = await createCell(TYPE.integer, textEncoder.encode(String(value)));
  } else if (typeof value === "string") {
    cell = await createCell(TYPE.string, textEncoder.encode(value));
  } else if (value instanceof Uint8Array) {
    cell = await createCell(TYPE.blob, value);
  } else if (Array.isArray(value)) {
    return encodeVector(value);
  } else if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return encodeMap(value);
  } else {
    throw new Error(`unsupported HCV1 value: ${Object.prototype.toString.call(value)}`);
  }
  return { root: cell.root, cell, cells: [cell], envelope: cell.envelope };
}

function recordPayload(kind, roots) {
  return textEncoder.encode(
    `R:hestia-agent/1:${kind}:1:${roots.length}:${roots.join("")}`
  );
}

async function createRecordCell(kind, encodedFields) {
  const schema = AGENT_RECORD_SCHEMAS[kind];
  if (!schema) throw new Error(`unknown HCV1 agent record kind: ${kind}`);
  if (schema.length !== encodedFields.length) throw new Error(`invalid ${kind} field count`);
  const roots = encodedFields.map(({ root }) => root);
  const cell = await createCell(
    TYPE.record,
    recordPayload(kind, roots),
    schema.map(([role], position) => roleRef(position, role, roots[position]))
  );
  return {
    root: cell.root,
    cell,
    cells: mergeCells(encodedFields.flatMap(({ cells }) => cells), [cell]),
    envelope: cell.envelope
  };
}

export async function encodeAgentRecordBody(kind, body) {
  const schema = AGENT_RECORD_SCHEMAS[kind];
  if (!schema) throw new Error(`unknown HCV1 agent record kind: ${kind}`);
  const fields = [];
  for (const [, property, mode] of schema) {
    const value = body?.[property] ?? null;
    fields.push(mode === "reference"
      ? await encodeReference(value)
      : await encodeHcv1Value(value));
  }
  return createRecordCell(kind, fields);
}

export function agentSigningBytes(kind, bodyRoot) {
  const root = /^sha256:/.test(bodyRoot) ? rootHex(bodyRoot) : bodyRoot;
  if (!/^[0-9a-f]{64}$/.test(root)) throw new Error("invalid agent body root");
  return textEncoder.encode(`GWAR1:${kind}:${root}`);
}

function serializableCell(cell) {
  return {
    root: cell.root,
    codec_version: cell.codec_version,
    type_tag: cell.type_tag,
    payload_hex: cell.payload_hex,
    refs: cell.refs
  };
}

export function hcp1Pack(cells) {
  const ordered = mergeCells(cells).sort((left, right) => left.root.localeCompare(right.root));
  return `HCP1:${ordered.length}:` + ordered.map((cell) => {
    const refs = [...cell.refs].sort((left, right) =>
      left.position - right.position || left.role.localeCompare(right.role));
    return `C:${cell.root}:${cell.codec_version}:${cell.type_tag}:${cell.payload_hex}:${refs.length}:`
      + refs.map((ref) =>
        `R:${ref.position}:${bytesToHex(textEncoder.encode(ref.role))}:${ref.child_root}:`
      ).join("");
  }).join("");
}

export async function signHcv1AgentRecord(kind, body, key) {
  if (!key?.id || !key?.privateKey) throw new Error("an agent signing key is required");
  const bodyPlan = await encodeAgentRecordBody(kind, body);
  const signatureBytes = new Uint8Array(await crypto.subtle.sign(
    { name: "Ed25519" },
    key.privateKey,
    agentSigningBytes(kind, bodyPlan.root)
  ));
  const signerKey = await encodeHcv1Value(key.id);
  const signature = await encodeHcv1Value(signatureBytes);
  const signed = await createRecordCell("ledger/signed-record", [
    { root: bodyPlan.root, cells: bodyPlan.cells },
    signerKey,
    signature
  ]);
  const cells = mergeCells(bodyPlan.cells, signerKey.cells, signature.cells, signed.cells);
  return {
    protocol: HCV1_AGENT_PROTOCOL,
    version: 1,
    type: kind,
    signer_key: key.id,
    body,
    body_root: `sha256:${bodyPlan.root}`,
    root: `sha256:${signed.root}`,
    signature: bytesToBase64Url(signatureBytes),
    hcp1_pack: hcp1Pack(cells),
    hcv1_cells: cells.map(serializableCell)
  };
}

export async function verifyHcv1AgentRecord(record, publicKeyOrJwk) {
  if (!record || record.protocol !== HCV1_AGENT_PROTOCOL || record.version !== 1) {
    throw new Error("invalid HCV1 agent record protocol");
  }
  const bodyPlan = await encodeAgentRecordBody(record.type, record.body);
  if (record.body_root !== `sha256:${bodyPlan.root}`) throw new Error("HCV1 agent body root mismatch");
  const signatureBytes = base64UrlToBytes(record.signature ?? "");
  const publicKey = publicKeyOrJwk?.type === "public"
    ? publicKeyOrJwk
    : await crypto.subtle.importKey("jwk", publicKeyOrJwk, { name: "Ed25519" }, true, ["verify"]);
  const valid = await crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    signatureBytes,
    agentSigningBytes(record.type, bodyPlan.root)
  );
  if (!valid) throw new Error("invalid HCV1 agent signature");
  const signerKey = await encodeHcv1Value(record.signer_key);
  const signature = await encodeHcv1Value(signatureBytes);
  const signed = await createRecordCell("ledger/signed-record", [
    { root: bodyPlan.root, cells: bodyPlan.cells },
    signerKey,
    signature
  ]);
  if (record.root !== `sha256:${signed.root}`) throw new Error("HCV1 signed record root mismatch");
  const cells = mergeCells(bodyPlan.cells, signerKey.cells, signature.cells, signed.cells);
  if (record.hcp1_pack && record.hcp1_pack !== hcp1Pack(cells)) {
    throw new Error("HCP1 agent record pack mismatch");
  }
  return record.body;
}

export async function hcv1ValueRoot(value) {
  const encoded = await encodeHcv1Value(value);
  return {
    root: `sha256:${encoded.root}`,
    hcp1_pack: hcp1Pack(encoded.cells),
    hcv1_cells: encoded.cells.map(serializableCell)
  };
}

export async function hcv1KeyFingerprint(publicJwk) {
  const encoded = await encodeHcv1Value(publicJwk);
  return `ed25519:${encoded.root}`;
}

export async function verifyExactHcv1Acceptance({
  offerRecord,
  offerPublicKey,
  acceptanceRecord,
  acceptancePublicKey
}) {
  await verifyHcv1AgentRecord(offerRecord, offerPublicKey);
  const acceptance = await verifyHcv1AgentRecord(acceptanceRecord, acceptancePublicKey);
  if (acceptanceRecord.type !== "negotiation/acceptance") {
    throw new Error("expected an HCV1 negotiation acceptance");
  }
  if (acceptance.offer_root !== offerRecord.root) {
    throw new Error("HCV1 acceptance does not bind the exact offer root");
  }
  return acceptance;
}

export function decodeHcv1Payload(cell) {
  return hexToBytes(cell.payload_hex);
}
