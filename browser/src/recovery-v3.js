import { base64UrlToBytes, bytesToBase64Url, textEncoder } from "./encoding.js";

const INFO_PREFIX = "hestia.identity-package/v3:";

function webCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error("Web Crypto is unavailable");
  }
  return globalThis.crypto;
}

export function generateRecoveryCode() {
  const bytes = webCrypto().getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").match(/.{1,4}/g).join("-");
}

export function generateUserFactor() {
  return webCrypto().getRandomValues(new Uint8Array(32));
}

export function parseRecoveryCode(value) {
  const normalized = String(value ?? "").trim().replaceAll("-", "").replaceAll(" ", "");
  if (!/^[0-9a-f]{64}$/i.test(normalized)) throw new Error("Recovery code is not valid");
  return Uint8Array.from(normalized.match(/../g), (pair) => Number.parseInt(pair, 16));
}

async function packageKey(authoritySecret, userFactor, identityId, usages) {
  const material = await webCrypto().subtle.importKey(
    "raw", authoritySecret, "HKDF", false, ["deriveKey"]
  );
  const factor = userFactor instanceof Uint8Array ? userFactor : parseRecoveryCode(userFactor);
  if (factor.length !== 32) throw new Error("Credential vault factor is not valid");
  const salt = new Uint8Array(await webCrypto().subtle.digest("SHA-256", factor));
  return webCrypto().subtle.deriveKey({
    name: "HKDF",
    hash: "SHA-256",
    salt,
    info: textEncoder.encode(`${INFO_PREFIX}${identityId}`)
  }, material, { name: "AES-GCM", length: 256 }, false, usages);
}

export async function createIdentityPackage({ name, scenario, userFactor = generateUserFactor() }) {
  const cryptoApi = webCrypto();
  const identityId = bytesToBase64Url(cryptoApi.getRandomValues(new Uint8Array(16)));
  const authoritySecret = cryptoApi.getRandomValues(new Uint8Array(32));
  const signingKey = await cryptoApi.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]
  );
  const publicJwk = await cryptoApi.subtle.exportKey("jwk", signingKey.publicKey);
  const privateJwk = await cryptoApi.subtle.exportKey("jwk", signingKey.privateKey);
  const publicDigest = new Uint8Array(await cryptoApi.subtle.digest(
    "SHA-256", textEncoder.encode(JSON.stringify(publicJwk))
  ));
  const fingerprint = bytesToBase64Url(publicDigest);
  const plaintext = textEncoder.encode(JSON.stringify({
    version: 3, identity_id: identityId, name, scenario, public_jwk: publicJwk, private_jwk: privateJwk
  }));
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const key = await packageKey(authoritySecret, userFactor, identityId, ["encrypt"]);
  const ciphertext = new Uint8Array(await cryptoApi.subtle.encrypt({
    name: "AES-GCM", iv, additionalData: textEncoder.encode(identityId)
  }, key, plaintext));
  return {
    userFactor,
    authoritySecret,
    privateKey: signingKey.privateKey,
    identity: { identity_id: identityId, name, scenario, public_jwk: publicJwk, fingerprint },
    encryptedPackage: { version: 3, identity_id: identityId, iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(ciphertext) }
  };
}

export async function restoreIdentityPackage({ encryptedPackage, authoritySecret, userFactor, recoveryCode }) {
  if (encryptedPackage?.version !== 3) throw new Error("Unsupported identity package");
  try {
    const key = await packageKey(authoritySecret, userFactor ?? recoveryCode, encryptedPackage.identity_id, ["decrypt"]);
    const plaintext = await webCrypto().subtle.decrypt({
      name: "AES-GCM",
      iv: base64UrlToBytes(encryptedPackage.iv),
      additionalData: textEncoder.encode(encryptedPackage.identity_id)
    }, key, base64UrlToBytes(encryptedPackage.ciphertext));
    const data = JSON.parse(new TextDecoder().decode(plaintext));
    const privateKey = await webCrypto().subtle.importKey(
      "jwk", data.private_jwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]
    );
    return { data, privateKey };
  } catch (error) {
    if (error?.message === "Recovery code is not valid") throw error;
    throw new Error("Recovery failed: the credential vault factor or authority shares are incorrect");
  }
}

export async function signIdentityMessage(privateKey, message) {
  const signature = await webCrypto().subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, privateKey, textEncoder.encode(message)
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export function identityCard(identity) {
  return {
    type: "HestiaPublicIdentityCard",
    version: 1,
    identity_id: identity.identity_id,
    name: identity.name,
    scenario: identity.scenario,
    algorithm: "ECDSA P-256 / SHA-256",
    fingerprint: identity.fingerprint,
    public_jwk: identity.public_jwk
  };
}
