import { base64UrlToBytes, bytesToBase64Url } from "./encoding.js";

const ceremonyPattern = /^[A-Za-z0-9_-]{22}$/;
const capabilityPattern = /^[A-Za-z0-9_-]{43}$/;
const modes = new Set(["reusable", "single"]);

export function createInvite(baseUrl, { mode = "reusable", random = crypto } = {}) {
  if (!modes.has(mode)) throw new Error("invalid ceremony mode");
  const url = new URL("/recovery/", baseUrl);
  const ceremony = bytesToBase64Url(random.getRandomValues(new Uint8Array(16)));
  const capability = bytesToBase64Url(random.getRandomValues(new Uint8Array(32)));
  url.hash = new URLSearchParams({ v: "2", ceremony, cap: capability, mode }).toString();
  return { url, ceremony, capability, mode };
}

export function parseInvite(location) {
  const url = location instanceof URL ? location : new URL(location);
  if (url.searchParams.has("cap")) throw new Error("capability must be in URL fragment");
  const fields = new URLSearchParams(url.hash.slice(1));
  const ceremony = fields.get("ceremony") ?? "";
  const capability = fields.get("cap") ?? "";
  const mode = fields.get("mode") ?? "";
  if (fields.get("v") === "1") {
    const error = new Error("This v1 recovery invite has expired. Create a new v2 ceremony.");
    error.code = "HESTIA_INVITE_V1";
    throw error;
  }
  if (fields.get("v") !== "2" || !ceremonyPattern.test(ceremony)
      || !capabilityPattern.test(capability) || !modes.has(mode)) {
    throw new Error("invalid recovery invite");
  }
  return { ceremony, capability, capabilityBytes: base64UrlToBytes(capability), mode };
}
