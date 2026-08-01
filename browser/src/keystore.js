import { base64UrlToBytes, bytesToBase64Url, textDecoder, textEncoder } from "./encoding.js";

export async function generateSigningKey({ extractable = true } = {}) {
  return crypto.subtle.generateKey({
    name: "ECDSA",
    namedCurve: "P-256"
  }, extractable, ["sign", "verify"]);
}

export async function createRecoveryPackage({
  identity,
  keyVersion,
  signingKeyPair,
  policyHash
}) {
  const recoverySecret = crypto.getRandomValues(new Uint8Array(32));
  const encryptionKey = await crypto.subtle.importKey(
    "raw", recoverySecret, { name: "AES-GCM" }, false, ["encrypt"]
  );
  const privateKey = new Uint8Array(await crypto.subtle.exportKey("pkcs8", signingKeyPair.privateKey));
  const publicKey = await crypto.subtle.exportKey("jwk", signingKeyPair.publicKey);
  const payload = textEncoder.encode(JSON.stringify({
    identity,
    key_type: "p256",
    private_key: bytesToBase64Url(privateKey),
    public_key: publicKey,
    created_at: new Date().toISOString(),
    recovery_policy_hash: policyHash,
    key_version: keyVersion
  }));
  privateKey.fill(0);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = textEncoder.encode(JSON.stringify({ identity, keyVersion, policyHash }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
    name: "AES-GCM", iv, additionalData: aad, tagLength: 128
  }, encryptionKey, payload));
  return {
    recoverySecret,
    encryptedPackage: {
      version: 1,
      identity,
      key_version: keyVersion,
      policy_hash: policyHash,
      iv: bytesToBase64Url(iv),
      ciphertext: bytesToBase64Url(ciphertext)
    }
  };
}

export async function restoreRecoveryPackage(encryptedPackage, recoverySecret) {
  const key = await crypto.subtle.importKey(
    "raw", recoverySecret, { name: "AES-GCM" }, false, ["decrypt"]
  );
  const aad = textEncoder.encode(JSON.stringify({
    identity: encryptedPackage.identity,
    keyVersion: encryptedPackage.key_version,
    policyHash: encryptedPackage.policy_hash
  }));
  const plaintext = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: base64UrlToBytes(encryptedPackage.iv),
    additionalData: aad,
    tagLength: 128
  }, key, base64UrlToBytes(encryptedPackage.ciphertext));
  const payload = JSON.parse(textDecoder.decode(plaintext));
  const privateKey = await crypto.subtle.importKey(
    "pkcs8", base64UrlToBytes(payload.private_key),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
  );
  const publicKey = await crypto.subtle.importKey(
    "jwk", payload.public_key,
    { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]
  );
  return { payload, signingKeyPair: { privateKey, publicKey } };
}

export async function createRotationCertificate({
  identity,
  previousKey,
  newPublicKey,
  ceremonyId,
  keepers,
  policyHash,
  signingKey
}) {
  const certificate = {
    type: "identity/key-recovery",
    identity,
    previous_key: previousKey,
    new_key: await crypto.subtle.exportKey("jwk", newPublicKey),
    ceremony: ceremonyId,
    keepers: [...keepers].sort(),
    policy_hash: policyHash,
    effective_at: new Date().toISOString()
  };
  const bytes = textEncoder.encode(JSON.stringify(certificate));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, bytes);
  return { ...certificate, signature: bytesToBase64Url(new Uint8Array(signature)) };
}
