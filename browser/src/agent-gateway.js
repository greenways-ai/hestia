import { bytesToBase64Url } from "./encoding.js";

export const AGENT_HTTP_PROTOCOL = "hestia-agent-http/1";

export class HestiaAgentGatewayError extends Error {
  constructor(message, { status, code, response } = {}) {
    super(message);
    this.name = "HestiaAgentGatewayError";
    this.status = status;
    this.code = code;
    this.response = response;
  }
}

function admissionRecord(record) {
  if (!record?.root || !record?.type || !record?.hcp1_pack) {
    throw new Error("a signed HCV1 record with an HCP1 pack is required");
  }
  return {
    root: record.root,
    kind: record.type,
    hcp1_pack: record.hcp1_pack
  };
}

async function jsonResponse(response) {
  let value;
  try {
    value = await response.json();
  } catch {
    throw new HestiaAgentGatewayError("Hestia agent gateway returned invalid JSON", {
      status: response.status
    });
  }
  if (!response.ok || value?.ok !== true) {
    throw new HestiaAgentGatewayError(
      value?.error?.message ?? `Hestia agent gateway returned HTTP ${response.status}`,
      {
        status: response.status,
        code: value?.error?.code,
        response: value
      }
    );
  }
  if (value.protocol !== AGENT_HTTP_PROTOCOL) {
    throw new HestiaAgentGatewayError("Hestia agent gateway protocol mismatch", {
      status: response.status,
      response: value
    });
  }
  return value;
}

export async function admitAgentRecord({
  record,
  capability,
  endpoint = "/agent/v1/records/admit",
  requestId = crypto.randomUUID(),
  fetchImpl = fetch
}) {
  if (capability !== undefined
      && (!(capability instanceof Uint8Array) || capability.length !== 32)) {
    throw new Error("room admission capability must be 32 bytes");
  }
  const body = {
    protocol: AGENT_HTTP_PROTOCOL,
    request_id: requestId,
    record: admissionRecord(record)
  };
  if (capability) body.capability = bytesToBase64Url(capability);
  const response = await jsonResponse(await fetchImpl(endpoint, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }));
  if (response.request_id !== requestId
      || response.record_root !== record.root
      || response.record_kind !== record.type) {
    throw new HestiaAgentGatewayError("Hestia agent gateway response binding mismatch", {
      status: 200,
      response
    });
  }
  return response;
}

export async function agentGatewayHealth({
  endpoint = "/agent/v1/health",
  fetchImpl = fetch
} = {}) {
  return jsonResponse(await fetchImpl(endpoint, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store"
  }));
}
