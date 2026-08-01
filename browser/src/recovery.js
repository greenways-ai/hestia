import { base64UrlToBytes, bytesToBase64Url, concatBytes, textDecoder, textEncoder } from "./encoding.js";

const shareInfo = textEncoder.encode("hestia-recovery-share/v1");

async function deriveShareKey(privateKey, publicKey, ceremonyId) {
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const material = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({
    name: "HKDF",
    hash: "SHA-256",
    salt: textEncoder.encode(ceremonyId),
    info: shareInfo
  }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function associatedData(fields) {
  return textEncoder.encode(JSON.stringify(fields));
}

export async function generateCeremonyKey() {
  return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
}

export async function sealShareForCeremony({
  share,
  ceremonyId,
  browserPublicKey,
  keeperSigningKey,
  keeperId,
  policyHash,
  expiresAt
}) {
  const ephemeral = await generateCeremonyKey();
  const key = await deriveShareKey(ephemeral.privateKey, browserPublicKey, ceremonyId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const fields = {
    version: 1,
    ceremony_id: ceremonyId,
    keeper: keeperId,
    share_index: share[0],
    policy_hash: policyHash,
    expires_at: expiresAt
  };
  const aad = associatedData(fields);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
    name: "AES-GCM", iv, additionalData: aad, tagLength: 128
  }, key, share));
  const keeperEphemeralKey = await crypto.subtle.exportKey("jwk", ephemeral.publicKey);
  const signed = concatBytes(aad, iv, ciphertext, textEncoder.encode(JSON.stringify(keeperEphemeralKey)));
  const signature = new Uint8Array(await crypto.subtle.sign({
    name: "ECDSA", hash: "SHA-256"
  }, keeperSigningKey, signed));
  return {
    ...fields,
    keeper_ephemeral_key: keeperEphemeralKey,
    iv: bytesToBase64Url(iv),
    encrypted_share: bytesToBase64Url(ciphertext),
    signature: bytesToBase64Url(signature)
  };
}

export async function openCeremonyShare({
  envelope,
  browserPrivateKey,
  keeperSigningPublicKey,
  now = new Date()
}) {
  if (new Date(envelope.expires_at).getTime() <= now.getTime()) throw new Error("recovery envelope expired");
  const fields = {
    version: envelope.version,
    ceremony_id: envelope.ceremony_id,
    keeper: envelope.keeper,
    share_index: envelope.share_index,
    policy_hash: envelope.policy_hash,
    expires_at: envelope.expires_at
  };
  const aad = associatedData(fields);
  const iv = base64UrlToBytes(envelope.iv);
  const ciphertext = base64UrlToBytes(envelope.encrypted_share);
  const signed = concatBytes(
    aad, iv, ciphertext, textEncoder.encode(JSON.stringify(envelope.keeper_ephemeral_key))
  );
  const valid = await crypto.subtle.verify({
    name: "ECDSA", hash: "SHA-256"
  }, keeperSigningPublicKey, base64UrlToBytes(envelope.signature), signed);
  if (!valid) throw new Error("invalid keeper signature");

  const keeperEphemeralKey = await crypto.subtle.importKey(
    "jwk", envelope.keeper_ephemeral_key,
    { name: "ECDH", namedCurve: "P-256" }, false, []
  );
  const key = await deriveShareKey(browserPrivateKey, keeperEphemeralKey, envelope.ceremony_id);
  const share = new Uint8Array(await crypto.subtle.decrypt({
    name: "AES-GCM", iv, additionalData: aad, tagLength: 128
  }, key, ciphertext));
  if (share[0] !== envelope.share_index) throw new Error("share index mismatch");
  return share;
}
