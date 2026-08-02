import { DurableObject } from "cloudflare:workers";
import { iceConfiguration, parseList, validateConnection, validateEnvelope } from "./protocol.js";

const encoder = new TextEncoder();

function response(body, status, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      ...headers
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json(
        { ok: true, protocol: "hestia-signal/1" },
        { headers: { "cache-control": "no-store" } }
      );
    }
    if (request.method !== "GET" || url.pathname !== "/signal") return response("not found", 404);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return response("expected websocket upgrade", 426, { upgrade: "websocket" });
    }

    let connection;
    try {
      connection = validateConnection(
        url,
        request.headers.get("Origin") ?? "",
        parseList(env.ALLOWED_ORIGINS)
      );
    } catch (error) {
      return response(error.message, 403);
    }

    const headers = new Headers(request.headers);
    headers.set("X-Hestia-Ceremony", connection.ceremony);
    headers.set("X-Hestia-Peer", connection.peer);
    const room = env.CEREMONY_ROOMS.getByName(connection.ceremony);
    return room.fetch(new Request(request, { headers }));
  }
};

export class CeremonyRoom extends DurableObject {
  async fetch(request) {
    const ceremony = request.headers.get("X-Hestia-Ceremony") ?? "";
    const peer = request.headers.get("X-Hestia-Peer") ?? "";
    const sockets = this.ctx.getWebSockets();
    const duplicate = sockets.some((socket) => socket.deserializeAttachment()?.peer === peer);
    if (duplicate) return this.rejectUpgrade("duplicate-peer");
    if (sockets.length >= 2) return this.rejectUpgrade("room-full");

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ ceremony, peer });
    server.send(JSON.stringify({
      version: 1,
      type: "server/ice-config",
      ice_servers: iceConfiguration(this.env.STUN_URLS)
    }));
    return new Response(null, { status: 101, webSocket: client });
  }

  rejectUpgrade(reason) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.close(1008, reason);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, message) {
    const maxBytes = Math.max(1024, Math.min(Number(this.env.MAX_MESSAGE_BYTES) || 65536, 1_048_576));
    if (typeof message !== "string" || encoder.encode(message).byteLength > maxBytes) {
      socket.close(1009, "message-too-large");
      return;
    }

    try {
      const state = socket.deserializeAttachment();
      const envelope = validateEnvelope(JSON.parse(message), state.ceremony, state.peer);
      for (const target of this.ctx.getWebSockets()) {
        const targetState = target.deserializeAttachment();
        const addressed = envelope.to === null || envelope.to === undefined || envelope.to === targetState.peer;
        if (target !== socket && addressed) target.send(message);
      }
    } catch {
      socket.close(1008, "invalid-envelope");
    }
  }

  webSocketError(socket) {
    socket.close(1011, "signalling-error");
  }
}
