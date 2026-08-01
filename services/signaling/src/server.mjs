import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const ceremonyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const peerPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const messageTypes = new Set(["offer", "answer", "ice", "keeper-envelope", "status", "cancel"]);

export function validateEnvelope(value, ceremony, peer) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid-envelope");
  if (value.ceremony_id !== ceremony) throw new Error("ceremony-mismatch");
  if (value.from !== peer || !peerPattern.test(value.from)) throw new Error("sender-mismatch");
  if (!messageTypes.has(value.type)) throw new Error("invalid-message-type");
  if (typeof value.nonce !== "string" || value.nonce.length < 16 || value.nonce.length > 256) {
    throw new Error("invalid-nonce");
  }
  if (typeof value.signature !== "string" || value.signature.length < 16) {
    throw new Error("missing-signature");
  }
  return value;
}

export function createSignalingServer({
  port = Number(process.env.HESTIA_SIGNAL_PORT ?? 8443),
  maxBytes = Number(process.env.HESTIA_SIGNAL_MAX_BYTES ?? 65536)
} = {}) {
  const rooms = new Map();
  const http = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ ok: true, protocol: "hestia-signal/1" }));
      return;
    }
    response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ server: http, maxPayload: maxBytes });

  sockets.on("connection", (socket, request) => {
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
    const member = { socket, peer };
    room.add(member);
    rooms.set(ceremony, room);

    socket.on("message", (bytes, binary) => {
      if (binary || bytes.byteLength > maxBytes) {
        socket.close(1009, "message-too-large");
        return;
      }
      try {
        const envelope = validateEnvelope(JSON.parse(bytes.toString("utf8")), ceremony, peer);
        const encoded = JSON.stringify(envelope);
        for (const target of room) {
          if (target !== member && target.socket.readyState === WebSocket.OPEN) target.socket.send(encoded);
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
      return new Promise((resolve, reject) => sockets.close(() => http.close((error) => error ? reject(error) : resolve())));
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
