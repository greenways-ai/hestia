export const DOCUMENT_HTTP_PROTOCOL = "hestia-document-http/1";

export class HestiaDocumentGatewayError extends Error {
  constructor(message, { status, code, response } = {}) {
    super(message);
    this.name = "HestiaDocumentGatewayError";
    this.status = status;
    this.code = code;
    this.response = response;
  }
}

async function jsonResponse(response) {
  let value;
  try {
    value = await response.json();
  } catch {
    throw new HestiaDocumentGatewayError("Hestia document gateway returned invalid JSON", {
      status: response.status
    });
  }
  if (!response.ok || value?.ok !== true) {
    throw new HestiaDocumentGatewayError(
      value?.error?.message ?? `Hestia document gateway returned HTTP ${response.status}`,
      {
        status: response.status,
        code: value?.error?.code,
        response: value
      }
    );
  }
  if (value.protocol !== DOCUMENT_HTTP_PROTOCOL) {
    throw new HestiaDocumentGatewayError("Hestia document gateway protocol mismatch", {
      status: response.status,
      response: value
    });
  }
  return value;
}

export async function admitDocumentBatch({
  batch,
  endpoint = "/agent/v1/documents/imports",
  fetchImpl = fetch
}) {
  if (!batch?.record?.root || batch.record.type !== "document/batch") {
    throw new Error("a signed document batch bundle is required");
  }
  const response = await jsonResponse(await fetchImpl(endpoint, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ batch })
  }));
  if (response.document_id !== batch.documentId) {
    throw new HestiaDocumentGatewayError("document admission response binding mismatch", {
      status: 200,
      response
    });
  }
  return response;
}
