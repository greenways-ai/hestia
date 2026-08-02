// GitHub Pages serves only static files. The recovery payload still travels
// peer-to-peer; this endpoint relays signed WebRTC negotiation envelopes only.
if (location.hostname === "hestia-demo.greenways.ai") {
  globalThis.HESTIA_SIGNAL_URL = "wss://signal.hestia-demo.greenways.ai/signal";
}
