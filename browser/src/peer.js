import {
  createPeerIdentity,
  fingerprint,
  importCapabilityKey,
  importSigningPublicKey,
  randomId,
  signEnvelope,
  verifyEnvelope
} from "./protocol.js";
import { createSerialQueue } from "./kernel-queue.js";

function signalUrl() {
  if (globalThis.HESTIA_SIGNAL_URL) return new URL(globalThis.HESTIA_SIGNAL_URL);
  const url = new URL("/signal", location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}

/**
 * Signed, capability-bound WebRTC transport.
 *
 * CeremonyPeer keeps its historical name and defaults so recovery callers do
 * not change. Document rooms opt into a different data protocol and channel
 * label, plus an optional lossy awareness channel. Signalling stays on the
 * blind relay's hestia-signal/0-alpha ABI.
 */
export class CeremonyPeer extends EventTarget {
  constructor({
    invite,
    record,
    endpoint = signalUrl(),
    signalProtocol = "hestia-signal/0-alpha",
    dataProtocol = "hestia-ceremony/0-alpha",
    channelLabel = "hestia-ceremony-v1",
    awarenessProtocol = null,
    awarenessChannelLabel = null
  }) {
    super();
    this.invite = invite;
    this.record = record;
    this.endpoint = endpoint;
    this.signalProtocol = signalProtocol;
    this.dataProtocol = dataProtocol;
    this.channelLabel = channelLabel;
    this.awarenessProtocol = awarenessProtocol;
    this.awarenessChannelLabel = awarenessChannelLabel;
    this.signalSequence = 0;
    this.dataSequence = 0;
    this.awarenessSequence = 0;
    this.receivedSignalSequence = 0;
    this.receivedDataSequence = 0;
    this.receivedAwarenessSequence = 0;
    this.pendingIce = [];
    this.iceServers = null;
    this.serializeSignalSend = createSerialQueue();
    this.serializeSignalReceive = createSerialQueue();
    this.serializeDataSend = createSerialQueue();
    this.serializeDataReceive = createSerialQueue();
    this.serializeAwarenessSend = createSerialQueue();
    this.serializeAwarenessReceive = createSerialQueue();
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  async connect() {
    if (!this.record.peer_id) this.record.peer_id = randomId(12);
    if (!this.record.signing_private) {
      const identity = await createPeerIdentity();
      this.record.signing_private = identity.privateKey;
      this.record.signing_public = identity.publicKey;
      this.record.peer_fingerprint = identity.fingerprint;
    }
    this.capabilityKey = await importCapabilityKey(this.invite.capabilityBytes);
    const endpoint = new URL(this.endpoint);
    endpoint.searchParams.set("ceremony", this.invite.ceremony);
    endpoint.searchParams.set("peer", this.record.peer_id);
    this.socket = new WebSocket(endpoint);
    this.socket.addEventListener("open", () => this.sendSignal("hello", {
      signing_public_key: this.record.signing_public,
      fingerprint: this.record.peer_fingerprint
    }).catch((error) => this.emit("error", { error })));
    this.socket.addEventListener("message", (event) => {
      this.receiveSignal(event.data).catch((error) => this.emit("error", { error }));
    });
    this.socket.addEventListener("close", (event) => this.emit("disconnected", {
      reason: event.reason || "signalling closed"
    }));
    this.socket.addEventListener("error", () => this.emit("error", {
      error: new Error("signalling connection failed")
    }));
  }

  sendSignal(type, payload, to = this.peerId ?? null) {
    return this.serializeSignalSend(async () => {
      const envelope = await signEnvelope({
        protocol: this.signalProtocol,
        type,
        ceremony_id: this.invite.ceremony,
        from: this.record.peer_id,
        to,
        sequence: ++this.signalSequence,
        nonce: randomId(),
        payload
      }, this.record.signing_private, this.capabilityKey);
      if (this.socket?.readyState !== WebSocket.OPEN) {
        throw new Error("signalling connection is not open");
      }
      this.socket.send(JSON.stringify(envelope));
    });
  }

  receiveSignal(encoded) {
    return this.serializeSignalReceive(() => this.receiveSignalNow(encoded));
  }

  async receiveSignalNow(encoded) {
    const envelope = JSON.parse(encoded);
    if (envelope.type === "server/ice-config") {
      this.iceServers = envelope.ice_servers ?? [];
      await this.maybeStartRtc();
      return;
    }
    if (envelope.ceremony_id !== this.invite.ceremony || envelope.from === this.record.peer_id) return;
    let publicKey = this.peerSigningKey;
    if (!publicKey) {
      if (envelope.type !== "hello" || !envelope.payload?.signing_public_key) {
        throw new Error("peer must authenticate with hello");
      }
      publicKey = await importSigningPublicKey(envelope.payload.signing_public_key);
    }
    const verified = await verifyEnvelope(envelope, publicKey, this.capabilityKey);
    if (verified.protocol !== this.signalProtocol) throw new Error("invalid signalling protocol");
    if (verified.to && verified.to !== this.record.peer_id) return;
    if (verified.sequence <= this.receivedSignalSequence) throw new Error("replayed signalling message");
    this.receivedSignalSequence = verified.sequence;

    if (!this.peerSigningKey) {
      const computedFingerprint = await fingerprint(verified.payload.signing_public_key);
      if (verified.payload.fingerprint !== computedFingerprint) {
        throw new Error("peer fingerprint does not match its signing key");
      }
      this.peerId = verified.from;
      this.peerSigningKey = publicKey;
      this.peerPublicKey = verified.payload.signing_public_key;
      this.peerFingerprint = computedFingerprint;
      if (this.record.trusted_peer_fingerprint
          && this.record.trusted_peer_fingerprint !== this.peerFingerprint) {
        throw new Error("session is already paired with another browser");
      }
      this.record.trusted_peer_id = this.peerId;
      this.record.trusted_peer_fingerprint = this.peerFingerprint;
      this.record.trusted_peer_public = this.peerPublicKey;
      this.emit("peer", { id: this.peerId, fingerprint: this.peerFingerprint });
      await this.sendSignal("hello", {
        signing_public_key: this.record.signing_public,
        fingerprint: this.record.peer_fingerprint
      }, this.peerId);
      await this.maybeStartRtc();
    }

    if (verified.type === "offer") await this.acceptOffer(verified.payload);
    if (verified.type === "answer") {
      await this.peerConnection.setRemoteDescription(verified.payload);
      await this.flushIce();
    }
    if (verified.type === "ice") await this.acceptIce(verified.payload);
    if (verified.type === "cancel") this.close();
  }

  async maybeStartRtc() {
    if (!this.peerId || !this.iceServers || this.peerConnection) return;
    this.peerConnection = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peerConnection.addEventListener("icecandidate", ({ candidate }) => {
      if (candidate) this.sendSignal("ice", candidate.toJSON()).catch(
        (error) => this.emit("error", { error })
      );
    });
    this.peerConnection.addEventListener("connectionstatechange", () => {
      const state = this.peerConnection.connectionState;
      this.emit("connection-state", { state });
      if (state === "failed") this.emit("error", { error: new Error("WebRTC connection failed") });
    });
    this.peerConnection.addEventListener("datachannel", ({ channel }) => this.attachChannel(channel));
    if (this.record.peer_id < this.peerId) {
      this.attachChannel(this.peerConnection.createDataChannel(this.channelLabel, { ordered: true }));
      if (this.awarenessProtocol && this.awarenessChannelLabel) {
        this.attachChannel(this.peerConnection.createDataChannel(
          this.awarenessChannelLabel,
          { ordered: false, maxRetransmits: 0 }
        ));
      }
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      await this.sendSignal("offer", this.peerConnection.localDescription.toJSON());
    }
  }

  async acceptOffer(description) {
    await this.maybeStartRtc();
    await this.peerConnection.setRemoteDescription(description);
    await this.flushIce();
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    await this.sendSignal("answer", this.peerConnection.localDescription.toJSON());
  }

  async acceptIce(candidate) {
    if (!this.peerConnection || !this.peerConnection.remoteDescription) {
      this.pendingIce.push(candidate);
      return;
    }
    await this.peerConnection.addIceCandidate(candidate);
  }

  async flushIce() {
    for (const candidate of this.pendingIce.splice(0)) {
      await this.peerConnection.addIceCandidate(candidate);
    }
  }

  attachChannel(channel) {
    if (this.awarenessChannelLabel && channel.label === this.awarenessChannelLabel) {
      this.attachAwarenessChannel(channel);
      return;
    }
    if (channel.label !== this.channelLabel || this.channel) {
      channel.close();
      return;
    }
    this.channel = channel;
    channel.addEventListener("open", () => this.emit("connected", {
      peerId: this.peerId,
      peerFingerprint: this.peerFingerprint
    }));
    channel.addEventListener("message", (event) => {
      this.receiveData(event.data).catch((error) => this.emit("error", { error }));
    });
    channel.addEventListener("close", () => this.emit("disconnected", { reason: "data channel closed" }));
  }

  attachAwarenessChannel(channel) {
    if (this.awarenessChannel) {
      channel.close();
      return;
    }
    this.awarenessChannel = channel;
    channel.addEventListener("open", () => this.emit("awareness-connected", {
      peerId: this.peerId
    }));
    channel.addEventListener("message", (event) => {
      this.receiveAwareness(event.data).catch((error) => this.emit("error", { error }));
    });
  }

  send(type, payload) {
    return this.serializeDataSend(async () => {
      if (this.channel?.readyState !== "open") throw new Error("signed data channel is not open");
      const envelope = await signEnvelope({
        protocol: this.dataProtocol,
        type,
        ceremony_id: this.invite.ceremony,
        from: this.record.peer_id,
        to: this.peerId,
        sequence: ++this.dataSequence,
        nonce: randomId(),
        payload
      }, this.record.signing_private, this.capabilityKey);
      this.channel.send(JSON.stringify(envelope));
    });
  }

  receiveData(encoded) {
    return this.serializeDataReceive(() => this.receiveDataNow(encoded));
  }

  async receiveDataNow(encoded) {
    const envelope = JSON.parse(encoded);
    const verified = await verifyEnvelope(envelope, this.peerSigningKey, this.capabilityKey);
    if (verified.protocol !== this.dataProtocol
        || verified.ceremony_id !== this.invite.ceremony
        || verified.from !== this.peerId
        || verified.to !== this.record.peer_id) {
      throw new Error("signed data channel session mismatch");
    }
    if (verified.sequence <= this.receivedDataSequence) throw new Error("replayed data-channel message");
    this.receivedDataSequence = verified.sequence;
    this.emit("message", { type: verified.type, payload: verified.payload });
  }

  sendAwareness(type, payload) {
    return this.serializeAwarenessSend(async () => {
      if (!this.awarenessProtocol || this.awarenessChannel?.readyState !== "open") return false;
      const envelope = await signEnvelope({
        protocol: this.awarenessProtocol,
        type,
        ceremony_id: this.invite.ceremony,
        from: this.record.peer_id,
        to: this.peerId,
        sequence: ++this.awarenessSequence,
        nonce: randomId(),
        payload
      }, this.record.signing_private, this.capabilityKey);
      this.awarenessChannel.send(JSON.stringify(envelope));
      return true;
    });
  }

  receiveAwareness(encoded) {
    return this.serializeAwarenessReceive(() => this.receiveAwarenessNow(encoded));
  }

  async receiveAwarenessNow(encoded) {
    const envelope = JSON.parse(encoded);
    const verified = await verifyEnvelope(envelope, this.peerSigningKey, this.capabilityKey);
    if (verified.protocol !== this.awarenessProtocol
        || verified.ceremony_id !== this.invite.ceremony
        || verified.from !== this.peerId
        || verified.to !== this.record.peer_id) {
      throw new Error("awareness channel session mismatch");
    }
    // The channel is deliberately unordered and unreliable. Older messages are
    // stale awareness, not a protocol failure.
    if (verified.sequence <= this.receivedAwarenessSequence) return;
    this.receivedAwarenessSequence = verified.sequence;
    this.emit("awareness", { type: verified.type, payload: verified.payload });
  }

  close() {
    if (this.channel?.readyState === "open") {
      this.sendSignal("cancel", {}).catch(() => {});
    }
    this.awarenessChannel?.close();
    this.channel?.close();
    this.peerConnection?.close();
    this.socket?.close();
  }
}
