import assert from "node:assert/strict";
import test from "node:test";
import { CeremonyPeer } from "../src/peer.js";

const invite = Object.freeze({
  ceremony: "AAAAAAAAAAAAAAAAAAAAAA",
  capabilityBytes: new Uint8Array(32)
});

test("recovery transport keeps its historical protocol defaults", () => {
  const peer = new CeremonyPeer({
    invite,
    record: {},
    endpoint: new URL("wss://hestia.example/signal")
  });
  assert.equal(peer.signalProtocol, "hestia-signal/1");
  assert.equal(peer.dataProtocol, "hestia-ceremony/1");
  assert.equal(peer.channelLabel, "hestia-ceremony-v1");
  assert.equal(peer.awarenessProtocol, null);
});

test("document rooms select canonical and awareness channels without changing signalling", () => {
  const peer = new CeremonyPeer({
    invite,
    record: {},
    endpoint: new URL("wss://hestia.example/signal"),
    dataProtocol: "hestia-document-room/1",
    channelLabel: "hestia-document-v1",
    awarenessProtocol: "hestia-document-awareness/1",
    awarenessChannelLabel: "hestia-document-awareness-v1"
  });
  assert.equal(peer.signalProtocol, "hestia-signal/1");
  assert.equal(peer.dataProtocol, "hestia-document-room/1");
  assert.equal(peer.channelLabel, "hestia-document-v1");
  assert.equal(peer.awarenessProtocol, "hestia-document-awareness/1");
  assert.equal(peer.awarenessChannelLabel, "hestia-document-awareness-v1");
});
