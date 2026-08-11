# Publishing Hestia browser products

The published Hestia site is static HTML, CSS, JavaScript, Hara source, and a
pinned Hara/Wasm runtime on GitHub Pages. The build currently exposes:

- `/` — the Hestia product site;
- `/rooms/` — the signed private agent-room preview;
- `/recovery-demo/` — the guided recovery product demo;
- `/recovery/` — a compatibility alias used by the low-level browser package;
- `/recovery-demo/lab/` and `/recovery/lab/` — the two-browser recovery lab;
- `/hestia-browser/` — browser capability adapters;
- `/hara/` — product HAL kernels; and
- `/hara-runtime/` — the pinned Hara/Wasm browser runtime.

The agent-room preview is local-only in this release. It uses WebCrypto,
IndexedDB, signed records, encrypted messages, and HAL replay without requiring
a relay. WebRTC recovery traffic remains browser-to-browser. A small Cloudflare
Worker provides ephemeral signalling because two browsers cannot discover each
other from a static page alone.

The signalling relay:

- keeps no recovery database;
- limits each ceremony room to two live browsers;
- accepts only the published demo origin;
- admits only WebRTC negotiation message types with signature and MAC fields;
- leaves cryptographic verification to the browsers, which possess the
  fragment capability.

The Hestia client never sends recovery shares over the signalling channel.

## 1. Deploy signalling

You need a Cloudflare account containing the `greenways.ai` zone and permission
to deploy Workers and Durable Objects.

```bash
cd cloudflare/signaling
npm ci
npm test
npm run check
npx wrangler login
npm run deploy
```

The `routes` entry in `wrangler.jsonc` creates
`signal.hestia-demo.greenways.ai` as a Worker custom domain, including its DNS
record and certificate. Do not manually create a DNS record for that hostname.

The relay currently returns Cloudflare's public STUN server. STUN is enough for
many networks, but it cannot guarantee connectivity through restrictive NATs
or firewalls. Add short-lived TURN credentials before describing recovery as
universally reachable; never put a TURN key or API token in browser code.

Verify the relay:

```bash
curl https://signal.hestia-demo.greenways.ai/health
```

## 2. Configure GitHub Pages

In Cloudflare DNS, add this DNS-only record:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `hestia-demo` | `greenways-ai.github.io` | DNS only |

Keep the record DNS-only while GitHub verifies the domain and provisions its
certificate. The repository's `pages` workflow builds the Astro site, builds the
browser products, combines both artifacts, and deploys after changes reach
`main`.

Enable Pages with **Settings → Pages → Source → GitHub Actions**, then set the
custom domain to `hestia-demo.greenways.ai`. The equivalent API calls are:

```bash
gh api --method POST repos/greenways-ai/hestia/pages -f build_type=workflow
gh api --method PUT repos/greenways-ai/hestia/pages \
  -f cname=hestia-demo.greenways.ai \
  -f build_type=workflow
```

If Pages already exists, the first command returns a conflict and can be
skipped. Wait until GitHub reports the certificate as approved, then enforce
HTTPS:

```bash
gh api --method PUT repos/greenways-ai/hestia/pages -F https_enforced=true
```

GitHub recommends verifying the `greenways.ai` domain for the
`greenways-ai` organization to prevent domain takeover.

After DNS and certificate status are healthy, run the workflow manually or
merge a browser-product change:

```bash
gh workflow run pages.yml --repo greenways-ai/hestia
gh run watch --repo greenways-ai/hestia
```

Open the root site, `/rooms/`, and `/recovery-demo/`. The verification workflow
builds the Astro site and browser artifact and runs the complete room flow and
recovery flow in Chromium and Firefox before deployment.

## 3. Test the private agent-room preview

1. Create the host profile and confirm an Ed25519 operational fingerprint is
   shown.
2. Open a private room and confirm membership epoch one.
3. Issue an invitation and verify its secret appears only after `#`.
4. Admit the demonstration external agent and confirm the room rotates to epoch
   two.
5. Sign and attach a document version.
6. Encrypt and send a private message from the external agent.
7. Propose an offer, then use the explicit human approval control to accept it.
8. Reload the page and confirm the workspace is reconstructed by HAL replay.
9. Erase the local workspace when finished.

The product preview stores non-extractable keys and records in browser IndexedDB.
It is not yet a `gw_ledger` admission endpoint; roots become authoritative only
after the next milestone adds canonical HCV0 mapping and signed receipts.

## 4. Test recovery on two devices

1. On the first device, create a reusable ceremony.
2. Send the full invite URL to the second device over a trusted channel. The
   capability is after `#` and is not sent to GitHub Pages or Cloudflare.
3. Open the exact URL on the second device and wait for both peer fingerprints.
4. Request recovery on either device.
5. Approve release on the other device.
6. Confirm the requester reports a locally verified recovered identity.

Use separate networks as a final NAT test. If those peers cannot connect while
same-network peers can, TURN fallback is the next deployment step.
