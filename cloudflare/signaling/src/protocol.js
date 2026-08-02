const ceremonyPattern = /^[A-Za-z0-9_-]{22}$/;
const peerPattern = /^[A-Za-z0-9_-]{16}$/;
const messageTypes = new Set(["hello", "offer", "answer", "ice", "cancel"]);

export function parseList(value) {
  return String(value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function validateConnection(url, origin, allowedOrigins) {
  if (!allowedOrigins.includes(origin)) throw new Error("origin-not-allowed");
  const ceremony = url.searchParams.get("ceremony") ?? "";
  const peer = url.searchParams.get("peer") ?? "";
  if (!ceremonyPattern.test(ceremony) || !peerPattern.test(peer)) {
    throw new Error("invalid-room");
  }
  return { ceremony, peer };
}

export function validateEnvelope(value, ceremony, peer) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid-envelope");
  if (value.version !== 1 || value.protocol !== "hestia-signal/1") throw new Error("invalid-protocol");
  if (value.ceremony_id !== ceremony) throw new Error("ceremony-mismatch");
  if (value.from !== peer || !peerPattern.test(value.from)) throw new Error("sender-mismatch");
  if (value.to !== null && value.to !== undefined && !peerPattern.test(value.to)) {
    throw new Error("recipient-mismatch");
  }
  if (!messageTypes.has(value.type)) throw new Error("invalid-message-type");
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) throw new Error("invalid-sequence");
  if (typeof value.nonce !== "string" || value.nonce.length < 16 || value.nonce.length > 256) {
    throw new Error("invalid-nonce");
  }
  if (typeof value.signature !== "string" || value.signature.length < 64) {
    throw new Error("missing-signature");
  }
  if (typeof value.mac !== "string" || value.mac.length < 40) throw new Error("missing-mac");
  return value;
}

export function iceConfiguration(stunUrls) {
  const urls = parseList(stunUrls);
  return urls.length ? [{ urls }] : [];
}
