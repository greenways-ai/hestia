import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const ceremonyPattern = /^[A-Za-z0-9_-]{22}$/;
const peerPattern = /^[A-Za-z0-9_-]{16}$/;
const messageTypes = new Set(["hello", "offer", "answer", "ice", "cancel"]);

function list(value) {
  return String(value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function validateEnvelope(value, ceremony, peer) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid-envelope");
  if (value.version !== 1 || value.protocol !== "hestia-signal/0-alpha") throw new Error("invalid-protocol");
  if (value.ceremony_id !== ceremony) throw new Error("ceremony-mismatch");
  if (value.from !== peer || !peerPattern.test(value.from)) throw new Error("sender-mismatch");
  if (value.to !== null && value.to !== undefined && !peerPattern.test(value.to)) throw new Error("recipient-mismatch");
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

export function iceConfiguration(peer, {
  stunUrls = list(process.env.HESTIA_STUN_URLS),
  turnUrls = list(process.env.HESTIA_TURN_URLS),
  turnSecret = process.env.HESTIA_TURN_SECRET ?? "",
  turnTtlSeconds = Number(process.env.HESTIA_TURN_TTL_SECONDS ?? 600),
  now = () => Date.now()
} = {}) {
  const iceServers = [];
  if (stunUrls.length) iceServers.push({ urls: stunUrls });
  if (turnUrls.length && turnSecret) {
    const expires = Math.floor(now() / 1000) + Math.max(60, Math.min(turnTtlSeconds, 3600));
    const username = String(expires) + ":" + peer;
    const credential = createHmac("sha1", turnSecret).update(username).digest("base64");
    iceServers.push({ urls: turnUrls, username, credential });
  }
  return iceServers;
}

export function createSignalingServer({
  port = Number(process.env.HESTIA_SIGNAL_PORT ?? 8443),
  maxBytes = Number(process.env.HESTIA_SIGNAL_MAX_BYTES ?? 65536),
  allowedOrigins = list(process.env.HESTIA_ALLOWED_ORIGINS),
  iceOptions
} = {}) {
  const rooms = new Map();
  const http = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ ok: true, protocol: "hestia-signal/0-alpha" }));
      return;
    }
    response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ server: http, maxPayload: maxBytes });

  sockets.on("connection", (socket, request) => {
    if (allowedOrigins.length && !allowedOrigins.includes(request.headers.origin ?? "")) {
      socket.close(1008, "origin-not-allowed");
      return;
    }
    const url = new URL(request.url ?? "/", "http://hestia.local");
    const ceremony = url.searchParams.get("ceremony") ?? "";
    const peer = url.searchParams.get("peer") ?? "";
    if (!ceremonyPattern.test(ceremony) || !peerPattern.test(peer)) {
      socket.close(1008, "invalid-room");
      return;
    }
    const room = rooms.get(ceremony) ?? new Set();
    if ([...room].some((entry) => entry.peer === peer)) {
      socket.close(1008, "duplicate-peer");
      return;
    }
    if (room.size >= 2) {
      socket.close(1008, "room-full");
      return;
    }
    const member = { socket, peer };
    room.add(member);
    rooms.set(ceremony, room);
    socket.send(JSON.stringify({
      version: 1,
      type: "server/ice-config",
      ice_servers: iceConfiguration(peer, iceOptions)
    }));

    socket.on("message", (bytes, binary) => {
      if (binary || bytes.byteLength > maxBytes) {
        socket.close(1009, "message-too-large");
        return;
      }
      try {
        const envelope = validateEnvelope(JSON.parse(bytes.toString("utf8")), ceremony, peer);
        const encoded = JSON.stringify(envelope);
        for (const target of room) {
          const addressed = envelope.to === null || envelope.to === undefined || envelope.to === target.peer;
          if (target !== member && addressed && target.socket.readyState === WebSocket.OPEN) {
            target.socket.send(encoded);
          }
        }
      } catch {
        socket.close(1008, "invalid-envelope");
      }
    });

    socket.on("close", () => {
      room.delete(member);
      if (room.size === 0) rooms.delete(ceremony);
    });
  });

  return {
    listen() {
      return new Promise((resolve) => http.listen(port, "0.0.0.0", resolve));
    },
    close() {
      for (const client of sockets.clients) client.close(1001, "server-shutdown");
      return new Promise((resolve, reject) => sockets.close(
        () => http.close((error) => error ? reject(error) : resolve())
      ));
    },
    address() {
      return http.address();
    }
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createSignalingServer();
  await server.listen();
  console.log(JSON.stringify({ event: "listening", service: "hestia-signaling", address: server.address() }));
}
