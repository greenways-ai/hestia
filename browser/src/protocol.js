import { base64UrlToBytes, bytesToBase64Url, concatBytes, textEncoder } from "./encoding.js";

export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map(
    (key) => JSON.stringify(key) + ":" + canonical(value[key])
  ).join(",") + "}";
}

export async function sha256(value) {
  const bytes = typeof value === "string" ? textEncoder.encode(value) : value;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export async function fingerprint(publicKey) {
  return bytesToBase64Url(await sha256(canonical(publicKey)));
}

export async function importSigningPublicKey(jwk) {
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
}

export async function createPeerIdentity() {
  const temporary = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]
  );
  const publicKey = await crypto.subtle.exportKey("jwk", temporary.publicKey);
  const encodedPrivate = new Uint8Array(await crypto.subtle.exportKey("pkcs8", temporary.privateKey));
  const privateKey = await crypto.subtle.importKey(
    "pkcs8", encodedPrivate, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
  );
  encodedPrivate.fill(0);
  return { privateKey, publicKey, fingerprint: await fingerprint(publicKey) };
}

export async function importCapabilityKey(capabilityBytes) {
  return crypto.subtle.importKey(
    "raw", capabilityBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

function unsignedEnvelope(fields) {
  return {
    // The stateless signaling relay remains on its transport ABI v1. Hestia's
    // ceremony data, invite, recovery envelope, and package are v2.
    version: fields.protocol === "hestia-signal/0-alpha" ? 1 : 2,
    protocol: fields.protocol,
    type: fields.type,
    ceremony_id: fields.ceremony_id,
    from: fields.from,
    to: fields.to ?? null,
    sequence: fields.sequence,
    nonce: fields.nonce,
    payload: fields.payload ?? null
  };
}

export async function signEnvelope(fields, signingKey, capabilityKey) {
  const envelope = unsignedEnvelope(fields);
  const bytes = textEncoder.encode(canonical(envelope));
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, signingKey, bytes
  ));
  const encodedSignature = bytesToBase64Url(signature);
  const mac = new Uint8Array(await crypto.subtle.sign(
    "HMAC", capabilityKey, concatBytes(bytes, textEncoder.encode(encodedSignature))
  ));
  return { ...envelope, signature: encodedSignature, mac: bytesToBase64Url(mac) };
}

export async function verifyEnvelope(envelope, signingPublicKey, capabilityKey) {
  const unsigned = unsignedEnvelope(envelope);
  const bytes = textEncoder.encode(canonical(unsigned));
  const encodedSignature = envelope.signature ?? "";
  const validMac = await crypto.subtle.verify(
    "HMAC", capabilityKey, base64UrlToBytes(envelope.mac ?? ""),
    concatBytes(bytes, textEncoder.encode(encodedSignature))
  );
  if (!validMac) throw new Error("invalid capability MAC");
  const validSignature = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, signingPublicKey,
    base64UrlToBytes(encodedSignature), bytes
  );
  if (!validSignature) throw new Error("invalid peer signature");
  return unsigned;
}

export function randomId(bytes = 16) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}
