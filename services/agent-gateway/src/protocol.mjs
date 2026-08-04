import { randomUUID } from "node:crypto";

export const AGENT_HTTP_PROTOCOL = "hestia-agent-http/1";
export const MAX_PACK_BYTES = 1_000_000;
export const MAX_PACK_CELLS = 128;

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const rootPattern = /^(?:sha256:)?([0-9a-f]{64})$/;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

export const ADMISSIBLE_RECORD_KINDS = Object.freeze(new Set([
  "profile/version",
  "room/version",
  "room/invitation",
  "room/admission-proof",
  "room/document-attachment",
  "room/message-intent"
]));

export class AgentGatewayInputError extends Error {
  constructor(message, code = "invalid-request") {
    super(message);
    this.name = "AgentGatewayInputError";
    this.code = code;
    this.status = 400;
  }
}

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentGatewayInputError(`${name} must be an object`);
  }
  return value;
}

function exactKeys(value, allowed, name) {
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (extra.length) {
    throw new AgentGatewayInputError(`${name} contains unsupported fields: ${extra.join(", ")}`);
  }
}

export function rootHex(value, name = "record root") {
  const match = rootPattern.exec(String(value ?? ""));
  if (!match) throw new AgentGatewayInputError(`${name} must be a lowercase SHA-256 root`);
  return match[1];
}

export function prefixedRoot(value, name) {
  return `sha256:${rootHex(value, name)}`;
}

export function parseHcp1Pack(value) {
  if (typeof value !== "string") {
    throw new AgentGatewayInputError("record HCP1 pack must be text");
  }
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength > MAX_PACK_BYTES) {
    throw new AgentGatewayInputError("record HCP1 pack is outside the admission bound");
  }
  const match = /^HCP1:(0|[1-9][0-9]*):/.exec(value);
  if (!match) throw new AgentGatewayInputError("record HCP1 pack has an invalid header");
  const cellCount = Number(match[1]);
  if (!Number.isSafeInteger(cellCount) || cellCount < 1 || cellCount > MAX_PACK_CELLS) {
    throw new AgentGatewayInputError("record HCP1 cell count is outside the admission bound");
  }
  return Object.freeze({
    value,
    bytes: Buffer.from(value, "utf8"),
    byteLength,
    cellCount
  });
}

export function decodeCapability(value) {
  if (typeof value !== "string" || !base64UrlPattern.test(value)) {
    throw new AgentGatewayInputError("room admission capability must be base64url text");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== value) {
    throw new AgentGatewayInputError("room admission capability must encode exactly 32 bytes");
  }
  return bytes;
}

export function normalizeAdmissionRequest(input) {
  const request = object(input, "request");
  exactKeys(
    request,
    new Set(["protocol", "request_id", "record", "capability"]),
    "request"
  );
  if (request.protocol !== AGENT_HTTP_PROTOCOL) {
    throw new AgentGatewayInputError("unsupported Hestia agent HTTP protocol");
  }
  const requestId = request.request_id ?? randomUUID();
  if (!requestIdPattern.test(requestId)) {
    throw new AgentGatewayInputError("request_id is outside the transport bound");
  }

  const record = object(request.record, "record");
  exactKeys(record, new Set(["root", "kind", "hcp1_pack"]), "record");
  const kind = String(record.kind ?? "");
  if (!ADMISSIBLE_RECORD_KINDS.has(kind)) {
    throw new AgentGatewayInputError(`unsupported admitted record kind: ${kind}`);
  }
  const pack = parseHcp1Pack(record.hcp1_pack);
  const capability = request.capability === undefined
    ? null
    : decodeCapability(request.capability);
  if (kind === "room/admission-proof" && !capability) {
    throw new AgentGatewayInputError("room admission proof requires its private capability");
  }
  if (kind !== "room/admission-proof" && capability) {
    throw new AgentGatewayInputError("capability is valid only for room admission proof");
  }

  return Object.freeze({
    protocol: AGENT_HTTP_PROTOCOL,
    requestId,
    recordRootHex: rootHex(record.root),
    recordKind: kind,
    pack,
    capability
  });
}

export function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}
