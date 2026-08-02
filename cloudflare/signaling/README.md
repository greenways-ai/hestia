# Hestia Cloudflare signalling

This Worker provides ephemeral, two-browser WebRTC negotiation rooms. Each
ceremony ID maps to one Durable Object, limited to two live WebSockets. It does
not persist messages and rejects every application message type other than
`hello`, `offer`, `answer`, `ice`, and `cancel`.

The browser signs and capability-MACs every envelope. Secret shares and the
encrypted identity recovery package travel over the negotiated WebRTC
DataChannel, not through this Worker.

```bash
npm ci
npm test
npm run check
npx wrangler login
npm run deploy
```

Deployment creates the Worker custom domain
`signal.hestia-demo.greenways.ai`. The `greenways.ai` zone must already be
in the same Cloudflare account.
