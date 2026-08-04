import { base64UrlToBytes, bytesToBase64Url } from "./encoding.js";

export const DOCUMENT_ROOM_INVITE_VERSION = "1";
const roomPattern = /^[A-Za-z0-9_-]{22}$/;
const capabilityPattern = /^[A-Za-z0-9_-]{43}$/;

export function createDocumentRoomInvite(baseUrl, { random = crypto } = {}) {
  const base = baseUrl instanceof URL ? new URL(baseUrl) : new URL(baseUrl);
  const url = new URL("/documents/room/", base);
  const room = bytesToBase64Url(random.getRandomValues(new Uint8Array(16)));
  const capability = bytesToBase64Url(random.getRandomValues(new Uint8Array(32)));
  url.hash = new URLSearchParams({
    v: DOCUMENT_ROOM_INVITE_VERSION,
    room,
    cap: capability
  }).toString();
  return Object.freeze({
    url,
    ceremony: room,
    room,
    capability,
    capabilityBytes: base64UrlToBytes(capability),
    mode: "document-room"
  });
}

export function parseDocumentRoomInvite(location) {
  const url = location instanceof URL ? location : new URL(location);
  if (url.searchParams.has("cap")) throw new Error("document room capability must remain in the URL fragment");
  const fields = new URLSearchParams(url.hash.slice(1));
  const room = fields.get("room") ?? "";
  const capability = fields.get("cap") ?? "";
  if (fields.get("v") !== DOCUMENT_ROOM_INVITE_VERSION
      || !roomPattern.test(room)
      || !capabilityPattern.test(capability)) {
    throw new Error("invalid Hestia document room invite");
  }
  return Object.freeze({
    ceremony: room,
    room,
    capability,
    capabilityBytes: base64UrlToBytes(capability),
    mode: "document-room"
  });
}

export function documentRoomOwnerSessionKey(room) {
  if (!roomPattern.test(String(room || ""))) throw new Error("invalid document room id");
  return `hestia-document-room-owner:${room}`;
}
