import {
  base64UrlToBytes,
  bytesToBase64Url,
  concatBytes,
  textDecoder,
  textEncoder
} from "./encoding.js";
import { randomId } from "./protocol.js";
import {
  AGENT_RECORD_SCHEMAS,
  HCV1_AGENT_PROTOCOL,
  hcv1KeyFingerprint,
  hcv1ValueRoot,
  signHcv1AgentRecord,
  verifyExactHcv1Acceptance,
  verifyHcv1AgentRecord
} from "./agent-hcv1.js";

export const AGENT_PROTOCOL = HCV1_AGENT_PROTOCOL;
const CAPABILITY_DOMAIN = textEncoder.encode("HESTIA-ROOM-CAPABILITY/1\0");
const PROOF_DOMAIN = textEncoder.encode("HESTIA-ROOM-ADMISSION/1\0");

function requireValue(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function uniqueSorted(values) {
  return [...new Set(values ?? [])].sort();
}

function assertRecordBody(type, body) {
  const schema = AGENT_RECORD_SCHEMAS[type];
  if (!schema) throw new Error(`unsupported Hestia agent record type: ${type}`);
  const allowed = new Set(schema.map(([, property]) => property));
  const extra = Object.keys(body ?? {}).filter((property) => !allowed.has(property));
  if (extra.length) {
    throw new Error(`${type} contains non-canonical fields: ${extra.join(", ")}`);
  }
}

async function domainCommitment(domain, ...parts) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    concatBytes(domain, ...parts)
  ));
  return (await hcv1ValueRoot(digest)).root;
}

export async function valueRoot(type, value) {
  return (await hcv1ValueRoot({ type, value })).root;
}

export function keyFingerprint(publicJwk) {
  return hcv1KeyFingerprint(publicJwk);
}

export async function importAgentPublicKey(publicJwk) {
  if (publicJwk?.type === "public" && publicJwk?.algorithm?.name === "Ed25519") {
    return publicJwk;
  }
  return crypto.subtle.importKey(
    "jwk",
    publicJwk,
    { name: "Ed25519" },
    true,
    ["verify"]
  );
}

export async function generateAgentKey() {
  const generated = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", generated.publicKey);
  const privateBytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", generated.privateKey));
  try {
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      privateBytes,
      { name: "Ed25519" },
      false,
      ["sign"]
    );
    return {
      id: await keyFingerprint(publicJwk),
      publicJwk,
      publicKey: await importAgentPublicKey(publicJwk),
      privateKey
    };
  } finally {
    privateBytes.fill(0);
  }
}

export async function signAgentRecord(type, body, key) {
  requireValue(key?.id, "key id");
  requireValue(key?.privateKey, "private key");
  assertRecordBody(type, body);
  return signHcv1AgentRecord(type, body, key);
}

export async function verifyAgentRecord(record, publicKeyOrJwk, expectedType = record?.type) {
  if (record?.type !== expectedType) throw new Error(`expected ${expectedType} record`);
  return verifyHcv1AgentRecord(record, await importAgentPublicKey(publicKeyOrJwk));
}

export async function createDelegation({
  delegationId = `delegation:${randomId()}`,
  issuerProfileId,
  issuerKey,
  subjectKey,
  purposes,
  scope = {},
  validFrom = new Date().toISOString(),
  validUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
}) {
  const body = {
    delegation_id: delegationId,
    issuer_profile_id: requireValue(issuerProfileId, "issuer profile id"),
    issuer_key: requireValue(issuerKey?.id, "issuer key id"),
    subject_key: requireValue(subjectKey?.id, "subject key id"),
    subject_public_jwk: requireValue(subjectKey?.publicJwk, "subject public key"),
    purposes: uniqueSorted(purposes),
    scope,
    valid_from: validFrom,
    valid_until: validUntil,
    revocation_root: null
  };
  if (!body.purposes.length) throw new Error("delegation purposes are required");
  return signAgentRecord("profile/key-delegation", body, issuerKey);
}

export async function verifyDelegation(record, issuerPublicKey, {
  purpose,
  scope,
  at = new Date()
} = {}) {
  const body = await verifyAgentRecord(record, issuerPublicKey, "profile/key-delegation");
  const moment = at instanceof Date ? at.getTime() : new Date(at).getTime();
  if (!Number.isFinite(moment)) throw new Error("invalid delegation verification time");
  if (moment < Date.parse(body.valid_from) || moment > Date.parse(body.valid_until)) {
    throw new Error("delegation is not currently valid");
  }
  if (body.revocation_root) throw new Error("delegation is revoked");
  if (purpose && !body.purposes.includes(purpose)) {
    throw new Error(`delegation does not permit ${purpose}`);
  }
  if (scope) {
    for (const [key, value] of Object.entries(scope)) {
      if (body.scope?.[key] !== value) throw new Error(`delegation scope mismatch: ${key}`);
    }
  }
  return body;
}

export async function createAgentProfile({
  profileId = `profile:${randomId()}`,
  name,
  kind = "agent",
  rootKey,
  operationalKey,
  purposes = [
    "profile.update",
    "room.create",
    "room.invite",
    "room.join",
    "room.message",
    "document.attach",
    "negotiation.propose",
    "negotiation.accept"
  ],
  previousProfileRoot = null,
  validUntil
}) {
  const delegation = await createDelegation({
    issuerProfileId: profileId,
    issuerKey: rootKey,
    subjectKey: operationalKey,
    purposes,
    scope: { profile_id: profileId },
    validUntil
  });
  const body = {
    profile_id: profileId,
    sequence: previousProfileRoot ? 2 : 1,
    previous_profile_root: previousProfileRoot,
    name: requireValue(name, "profile name"),
    profile_kind: kind,
    root_key: { id: rootKey.id, public_jwk: rootKey.publicJwk },
    operational_key: { id: operationalKey.id, public_jwk: operationalKey.publicJwk },
    delegation
  };
  return {
    record: await signAgentRecord("profile/version", body, rootKey),
    delegation
  };
}

export async function verifyAgentProfile(profileRecord, { at = new Date() } = {}) {
  const body = profileRecord?.body;
  requireValue(body?.root_key?.public_jwk, "profile root public key");
  requireValue(body?.operational_key?.public_jwk, "profile operational public key");
  if (profileRecord.signer_key !== body.root_key.id) {
    throw new Error("profile must be signed by its root key");
  }
  const rootPublicKey = await importAgentPublicKey(body.root_key.public_jwk);
  await verifyAgentRecord(profileRecord, rootPublicKey, "profile/version");
  const delegationBody = await verifyDelegation(body.delegation, rootPublicKey, { at });
  if (delegationBody.issuer_profile_id !== body.profile_id) {
    throw new Error("profile delegation issuer mismatch");
  }
  if (delegationBody.subject_key !== body.operational_key.id
      || await keyFingerprint(delegationBody.subject_public_jwk)
         !== await keyFingerprint(body.operational_key.public_jwk)) {
    throw new Error("profile delegation subject mismatch");
  }
  return {
    body,
    rootPublicKey,
    operationalPublicKey: await importAgentPublicKey(body.operational_key.public_jwk),
    delegationBody
  };
}

export async function capabilityCommitment(capability, inviteId) {
  return domainCommitment(
    CAPABILITY_DOMAIN,
    textEncoder.encode(`${inviteId}\0`),
    capability
  );
}

export async function createRoomInvite({
  roomId,
  hostProfileRecord,
  hostOperationalKey,
  role = "participant",
  purposes = ["room.message", "document.comment", "negotiation.propose"],
  expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  inviteId = `invite:${randomId()}`,
  capability = crypto.getRandomValues(new Uint8Array(32))
}) {
  const host = await verifyAgentProfile(hostProfileRecord);
  await verifyDelegation(hostProfileRecord.body.delegation, host.rootPublicKey, {
    purpose: "room.invite"
  });
  if (hostOperationalKey.id !== hostProfileRecord.body.operational_key.id) {
    throw new Error("invite key is not the active operational key");
  }
  const body = {
    invite_id: inviteId,
    room_id: requireValue(roomId, "room id"),
    host_profile_id: host.body.profile_id,
    host_profile_root: hostProfileRecord.root,
    role,
    purposes: uniqueSorted(purposes),
    expires_at: expiresAt,
    capability_commitment: await capabilityCommitment(capability, inviteId),
    one_time: true
  };
  return {
    record: await signAgentRecord("room/invitation", body, hostOperationalKey),
    capability
  };
}

export async function verifyRoomInvite({
  inviteRecord,
  capability,
  hostProfileRecord,
  at = new Date()
}) {
  const host = await verifyAgentProfile(hostProfileRecord, { at });
  await verifyDelegation(hostProfileRecord.body.delegation, host.rootPublicKey, {
    purpose: "room.invite",
    at
  });
  if (inviteRecord.signer_key !== host.body.operational_key.id) {
    throw new Error("invite signer is not the host operational key");
  }
  const body = await verifyAgentRecord(
    inviteRecord,
    host.operationalPublicKey,
    "room/invitation"
  );
  if (body.host_profile_root !== hostProfileRecord.root
      || body.host_profile_id !== host.body.profile_id) {
    throw new Error("invite host profile mismatch");
  }
  if (new Date(at).getTime() > Date.parse(body.expires_at)) throw new Error("room invite expired");
  const expected = await capabilityCommitment(capability, body.invite_id);
  if (expected !== body.capability_commitment) throw new Error("invalid room invite capability");
  return { body, host };
}

export function encodeRoomInvite(inviteRecord, capability) {
  const { hcp1_pack: ignoredPack, hcv1_cells: ignoredCells, ...projection } = inviteRecord;
  void ignoredPack;
  void ignoredCells;
  const record = bytesToBase64Url(textEncoder.encode(JSON.stringify(projection)));
  return `#v=1&invite=${encodeURIComponent(record)}&cap=${encodeURIComponent(bytesToBase64Url(capability))}`;
}

export function decodeRoomInvite(fragment) {
  const parameters = new URLSearchParams(String(fragment).replace(/^#/, ""));
  if (parameters.get("v") !== "1") throw new Error("unsupported room invite version");
  const record = parameters.get("invite");
  const capability = parameters.get("cap");
  if (!record || !capability) throw new Error("incomplete room invite");
  return {
    inviteRecord: JSON.parse(textDecoder.decode(base64UrlToBytes(record))),
    capability: base64UrlToBytes(capability)
  };
}

async function admissionCapabilityProof(capability, inviteRoot, guestProfileRoot) {
  return domainCommitment(
    PROOF_DOMAIN,
    capability,
    textEncoder.encode(`${inviteRoot}\0${guestProfileRoot}`)
  );
}

export async function createAdmissionProof({
  inviteRecord,
  capability,
  guestProfileRecord,
  guestOperationalKey,
  proofId = `proof:${randomId()}`
}) {
  const guest = await verifyAgentProfile(guestProfileRecord);
  await verifyDelegation(guestProfileRecord.body.delegation, guest.rootPublicKey, {
    purpose: "room.join"
  });
  if (guestOperationalKey.id !== guest.body.operational_key.id) {
    throw new Error("admission proof key is not the guest operational key");
  }
  const body = {
    proof_id: proofId,
    invite_root: inviteRecord.root,
    invite_id: inviteRecord.body.invite_id,
    room_id: inviteRecord.body.room_id,
    guest_profile_id: guest.body.profile_id,
    guest_profile_root: guestProfileRecord.root,
    guest_operational_key: guest.body.operational_key.id,
    capability_proof: await admissionCapabilityProof(
      capability,
      inviteRecord.root,
      guestProfileRecord.root
    )
  };
  return signAgentRecord("room/admission-proof", body, guestOperationalKey);
}

export async function verifyAdmissionProof({
  proofRecord,
  inviteRecord,
  capability,
  hostProfileRecord,
  guestProfileRecord,
  at = new Date()
}) {
  const invite = await verifyRoomInvite({
    inviteRecord,
    capability,
    hostProfileRecord,
    at
  });
  const guest = await verifyAgentProfile(guestProfileRecord, { at });
  await verifyDelegation(guestProfileRecord.body.delegation, guest.rootPublicKey, {
    purpose: "room.join",
    at
  });
  if (proofRecord.signer_key !== guest.body.operational_key.id) {
    throw new Error("admission proof signer is not the guest operational key");
  }
  const body = await verifyAgentRecord(
    proofRecord,
    guest.operationalPublicKey,
    "room/admission-proof"
  );
  if (body.invite_root !== inviteRecord.root
      || body.invite_id !== invite.body.invite_id
      || body.room_id !== invite.body.room_id
      || body.guest_profile_root !== guestProfileRecord.root
      || body.guest_profile_id !== guest.body.profile_id) {
    throw new Error("admission proof scope mismatch");
  }
  const expectedProof = await admissionCapabilityProof(
    capability,
    inviteRecord.root,
    guestProfileRecord.root
  );
  if (body.capability_proof !== expectedProof) throw new Error("invalid admission capability proof");
  return { invite, guest, proof: body };
}

export function createRoomEpochKey() {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function sealRoomMessage({
  roomId,
  epoch,
  senderProfileId,
  plaintext,
  epochKey,
  signingKey,
  messageId = `message:${randomId()}`,
  sentAt = new Date().toISOString()
}) {
  const metadata = {
    message_id: messageId,
    room_id: roomId,
    membership_epoch: epoch,
    sender_profile_id: senderProfileId,
    sent_at: sentAt
  };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = textEncoder.encode(JSON.stringify(metadata));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv,
    additionalData,
    tagLength: 128
  }, epochKey, textEncoder.encode(plaintext)));
  const encodedCiphertext = bytesToBase64Url(ciphertext);
  const body = {
    ...metadata,
    iv: bytesToBase64Url(iv),
    ciphertext: encodedCiphertext,
    ciphertext_root: await valueRoot("room/ciphertext", encodedCiphertext)
  };
  return signAgentRecord("room/message", body, signingKey);
}

export async function openRoomMessage({ messageRecord, epochKey, senderPublicKey }) {
  const body = await verifyAgentRecord(messageRecord, senderPublicKey, "room/message");
  const expectedRoot = await valueRoot("room/ciphertext", body.ciphertext);
  if (body.ciphertext_root !== expectedRoot) throw new Error("room ciphertext root mismatch");
  const metadata = {
    message_id: body.message_id,
    room_id: body.room_id,
    membership_epoch: body.membership_epoch,
    sender_profile_id: body.sender_profile_id,
    sent_at: body.sent_at
  };
  const plaintext = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: base64UrlToBytes(body.iv),
    additionalData: textEncoder.encode(JSON.stringify(metadata)),
    tagLength: 128
  }, epochKey, base64UrlToBytes(body.ciphertext));
  return textDecoder.decode(plaintext);
}

export async function createDocumentVersion({
  documentId = `document:${randomId()}`,
  content,
  authorProfileId,
  signingKey,
  previousVersionRoot = null,
  mediaType = "text/plain; charset=utf-8",
  createdAt = new Date().toISOString()
}) {
  const contentRoot = await valueRoot("document/content", content);
  const body = {
    document_id: documentId,
    version: previousVersionRoot ? 2 : 1,
    previous_version_root: previousVersionRoot,
    content_root: contentRoot,
    media_type: mediaType,
    author_profile_id: authorProfileId,
    created_at: createdAt
  };
  return {
    record: await signAgentRecord("document/version", body, signingKey),
    content,
    contentRoot
  };
}

export async function createOffer({
  roomId,
  terms,
  offeredBy,
  signingKey,
  offerId = `offer:${randomId()}`,
  supersedes = null,
  validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  authorityRoot = null
}) {
  const termsRoot = await valueRoot("negotiation/terms", terms);
  const body = {
    offer_id: offerId,
    room_id: roomId,
    terms,
    offered_by: offeredBy,
    supersedes,
    valid_until: validUntil,
    authority_root: authorityRoot
  };
  return {
    record: await signAgentRecord("negotiation/offer", body, signingKey),
    termsRoot
  };
}

export async function createAcceptance({
  offerRecord,
  acceptedBy,
  signingKey,
  humanApprovalRoot,
  acceptedAt = new Date().toISOString(),
  authorityRoot = null
}) {
  const body = {
    offer_root: offerRecord.root,
    accepted_by: acceptedBy,
    human_approval_root: requireValue(humanApprovalRoot, "human approval root"),
    accepted_at: acceptedAt,
    authority_root: authorityRoot
  };
  return signAgentRecord("negotiation/acceptance", body, signingKey);
}

export async function verifyAcceptance({
  offerRecord,
  offerPublicKey,
  acceptanceRecord,
  acceptancePublicKey
}) {
  if (offerRecord?.type !== "negotiation/offer") throw new Error("expected a negotiation offer");
  return verifyExactHcv1Acceptance({
    offerRecord,
    offerPublicKey: await importAgentPublicKey(offerPublicKey),
    acceptanceRecord,
    acceptancePublicKey: await importAgentPublicKey(acceptancePublicKey)
  });
}
