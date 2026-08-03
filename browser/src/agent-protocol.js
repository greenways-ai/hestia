import {
  base64UrlToBytes,
  bytesToBase64Url,
  concatBytes,
  textDecoder,
  textEncoder
} from "./encoding.js";
import { canonical, randomId, sha256 } from "./protocol.js";

export const AGENT_PROTOCOL = "hestia-agent/1";
const RECORD_DOMAIN = textEncoder.encode("HESTIA-AGENT-RECORD/1\0");
const ROOT_DOMAIN = textEncoder.encode("HESTIA-AGENT-ROOT/1\0");
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

function recordUnsigned(type, signerKey, body) {
  return {
    protocol: AGENT_PROTOCOL,
    version: 1,
    type: requireValue(type, "record type"),
    signer_key: requireValue(signerKey, "signer key"),
    body: body ?? null
  };
}

function recordBytes(type, signerKey, body) {
  return concatBytes(
    RECORD_DOMAIN,
    textEncoder.encode(canonical(recordUnsigned(type, signerKey, body)))
  );
}

async function prefixedRoot(domain, bytes) {
  return "sha256:" + bytesToBase64Url(await sha256(concatBytes(domain, bytes)));
}

export async function valueRoot(type, value) {
  return prefixedRoot(
    ROOT_DOMAIN,
    textEncoder.encode(`${type}\0${canonical(value)}`)
  );
}

export async function keyFingerprint(publicJwk) {
  return "ed25519:" + bytesToBase64Url(await sha256(
    textEncoder.encode(`HESTIA-ED25519-KEY/1\0${canonical(publicJwk)}`)
  ));
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
  const bytes = recordBytes(type, key.id, body);
  const root = await prefixedRoot(ROOT_DOMAIN, bytes);
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "Ed25519" },
    key.privateKey,
    bytes
  ));
  return {
    ...recordUnsigned(type, key.id, body),
    root,
    signature: bytesToBase64Url(signature)
  };
}

export async function verifyAgentRecord(record, publicKeyOrJwk, expectedType = record?.type) {
  if (!record || record.protocol !== AGENT_PROTOCOL || record.version !== 1) {
    throw new Error("invalid Hestia agent record protocol");
  }
  if (record.type !== expectedType) throw new Error(`expected ${expectedType} record`);
  const bytes = recordBytes(record.type, record.signer_key, record.body);
  const expectedRoot = await prefixedRoot(ROOT_DOMAIN, bytes);
  if (record.root !== expectedRoot) throw new Error("agent record root mismatch");
  const publicKey = await importAgentPublicKey(publicKeyOrJwk);
  const valid = await crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    base64UrlToBytes(record.signature ?? ""),
    bytes
  );
  if (!valid) throw new Error("invalid agent record signature");
  return record.body;
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
    profile_kind: kind,
    name: requireValue(name, "profile name"),
    sequence: previousProfileRoot ? 2 : 1,
    previous_profile_root: previousProfileRoot,
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
      || canonical(delegationBody.subject_public_jwk) !== canonical(body.operational_key.public_jwk)) {
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
  return prefixedRoot(
    CAPABILITY_DOMAIN,
    concatBytes(textEncoder.encode(`${inviteId}\0`), capability)
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
    one_time: true,
    capability_commitment: await capabilityCommitment(capability, inviteId)
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
  const record = bytesToBase64Url(textEncoder.encode(JSON.stringify(inviteRecord)));
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
  return prefixedRoot(
    PROOF_DOMAIN,
    concatBytes(
      capability,
      textEncoder.encode(`${inviteRoot}\0${guestProfileRoot}`)
    )
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
  const additionalData = textEncoder.encode(canonical(metadata));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv,
    additionalData,
    tagLength: 128
  }, epochKey, textEncoder.encode(plaintext)));
  const body = {
    ...metadata,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(ciphertext),
    ciphertext_root: await valueRoot("room/ciphertext", bytesToBase64Url(ciphertext))
  };
  return signAgentRecord("room/message", body, signingKey);
}

export async function openRoomMessage({ messageRecord, epochKey, senderPublicKey }) {
  const body = await verifyAgentRecord(messageRecord, senderPublicKey, "room/message");
  const ciphertext = base64UrlToBytes(body.ciphertext);
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
    additionalData: textEncoder.encode(canonical(metadata)),
    tagLength: 128
  }, epochKey, ciphertext);
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
  validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
}) {
  const termsRoot = await valueRoot("negotiation/terms", terms);
  const body = {
    offer_id: offerId,
    room_id: roomId,
    terms_root: termsRoot,
    terms,
    offered_by: offeredBy,
    supersedes,
    valid_until: validUntil
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
  acceptedAt = new Date().toISOString()
}) {
  const body = {
    offer_id: offerRecord.body.offer_id,
    offer_root: offerRecord.root,
    accepted_by: acceptedBy,
    human_approval_root: requireValue(humanApprovalRoot, "human approval root"),
    accepted_at: acceptedAt
  };
  return signAgentRecord("negotiation/acceptance", body, signingKey);
}

export async function verifyAcceptance({
  offerRecord,
  offerPublicKey,
  acceptanceRecord,
  acceptancePublicKey
}) {
  await verifyAgentRecord(offerRecord, offerPublicKey, "negotiation/offer");
  const acceptance = await verifyAgentRecord(
    acceptanceRecord,
    acceptancePublicKey,
    "negotiation/acceptance"
  );
  if (acceptance.offer_root !== offerRecord.root
      || acceptance.offer_id !== offerRecord.body.offer_id) {
    throw new Error("acceptance does not bind the exact offer root");
  }
  return acceptance;
}
