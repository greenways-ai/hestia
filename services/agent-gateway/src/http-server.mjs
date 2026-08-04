import { createServer } from "node:http";
import { AgentGatewayInputError, AGENT_HTTP_PROTOCOL } from "./protocol.mjs";
import { DOCUMENT_HTTP_PROTOCOL } from "./document-ledger-service.mjs";

const securityHeaders = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff"
});

class BodyTooLargeError extends Error {
  constructor() {
    super("request body exceeds the Hestia agent gateway bound");
    this.status = 413;
    this.code = "request-too-large";
  }
}

function json(response, status, value) {
  response.writeHead(status, securityHeaders);
  response.end(`${JSON.stringify(value)}\n`);
}

function methodNotAllowed(response, allowed, protocol = AGENT_HTTP_PROTOCOL) {
  response.writeHead(405, { ...securityHeaders, allow: allowed });
  response.end(`${JSON.stringify({
    ok: false,
    protocol,
    error: { code: "method-not-allowed", message: `use ${allowed}` }
  })}\n`);
}

async function readJson(request, maxBodyBytes) {
  if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new AgentGatewayInputError("content-type must be application/json");
  }
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > maxBodyBytes) throw new BodyTooLargeError();
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new BodyTooLargeError();
    chunks.push(chunk);
  }
  if (size === 0) throw new AgentGatewayInputError("request body is required");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AgentGatewayInputError("request body is not valid JSON");
  }
}

function safeDatabaseMessage(error) {
  const value = String(error?.message ?? "admission rejected");
  return value.replace(/^PostgresError:\s*/i, "").slice(0, 300);
}

function errorResponse(error, debug, protocol = AGENT_HTTP_PROTOCOL) {
  if (error instanceof AgentGatewayInputError || error instanceof BodyTooLargeError) {
    return {
      status: error.status ?? 400,
      body: {
        ok: false,
        protocol,
        error: { code: error.code ?? "invalid-request", message: error.message }
      }
    };
  }
  if (error?.code === "P0001" || String(error?.code ?? "").startsWith("23")) {
    return {
      status: 409,
      body: {
        ok: false,
        protocol,
        error: {
          code: "admission-rejected",
          message: safeDatabaseMessage(error)
        }
      }
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      protocol,
      error: {
        code: "gateway-error",
        message: debug ? safeDatabaseMessage(error) : "Hestia could not complete the request"
      }
    }
  };
}

function originAllowed(request, allowedOrigins) {
  const origin = request.headers.origin;
  return !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin);
}

export function createAgentGatewayHttpServer({
  service,
  documentService = null,
  host = process.env.HESTIA_AGENT_GATEWAY_HOST ?? "0.0.0.0",
  port = Number(process.env.HESTIA_AGENT_GATEWAY_PORT ?? 8787),
  maxBodyBytes = Number(process.env.HESTIA_AGENT_GATEWAY_MAX_BODY_BYTES ?? 1_100_000),
  allowedOrigins = String(process.env.HESTIA_AGENT_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
  debug = process.env.HESTIA_AGENT_DEBUG === "true"
}) {
  if (!service?.health || !service?.environment || !service?.admit) {
    throw new Error("agent gateway HTTP server requires an admission service");
  }
  const http = createServer(async (request, response) => {
    let responseProtocol = AGENT_HTTP_PROTOCOL;
    try {
      if (!originAllowed(request, allowedOrigins)) {
        json(response, 403, {
          ok: false,
          protocol: responseProtocol,
          error: { code: "origin-not-allowed", message: "request origin is not allowed" }
        });
        return;
      }
      const url = new URL(request.url ?? "/", "http://hestia.local");
      if (url.pathname === "/health" || url.pathname === "/v1/health") {
        if (request.method !== "GET") return methodNotAllowed(response, "GET");
        json(response, 200, await service.health());
        return;
      }
      if (url.pathname === "/v1/environment") {
        if (request.method !== "GET") return methodNotAllowed(response, "GET");
        json(response, 200, {
          ok: true,
          protocol: AGENT_HTTP_PROTOCOL,
          environment: await service.environment()
        });
        return;
      }
      if (url.pathname === "/v1/records/admit") {
        if (request.method !== "POST") return methodNotAllowed(response, "POST");
        json(response, 200, await service.admit(await readJson(request, maxBodyBytes)));
        return;
      }
      if (url.pathname === "/v1/documents/imports") {
        responseProtocol = DOCUMENT_HTTP_PROTOCOL;
        if (request.method !== "POST") {
          return methodNotAllowed(response, "POST", DOCUMENT_HTTP_PROTOCOL);
        }
        if (!documentService?.admit) {
          json(response, 503, {
            ok: false,
            protocol: DOCUMENT_HTTP_PROTOCOL,
            error: { code: "document-service-unavailable", message: "document ledger service is unavailable" }
          });
          return;
        }
        json(response, 200, await documentService.admit(await readJson(request, maxBodyBytes)));
        return;
      }
      json(response, 404, {
        ok: false,
        protocol: responseProtocol,
        error: { code: "not-found", message: "unknown Hestia gateway route" }
      });
    } catch (error) {
      if (debug) console.error(error);
      const result = errorResponse(error, debug, responseProtocol);
      json(response, result.status, result.body);
    }
  });

  return Object.freeze({
    async listen() {
      await new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(port, host, () => {
          http.off("error", reject);
          resolve();
        });
      });
    },
    async close() {
      await new Promise((resolve, reject) => http.close(
        (error) => error ? reject(error) : resolve()
      ));
    },
    address() {
      return http.address();
    }
  });
}
