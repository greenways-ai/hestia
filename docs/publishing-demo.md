# Publishing `hestia-demo.greenways.ai`

The published application is static HTML, CSS, and JavaScript on GitHub Pages.
WebRTC recovery traffic remains browser-to-browser. A small Cloudflare Worker
provides ephemeral signalling because two browsers cannot discover each other
from a static page alone.

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

The `greenways-ai/hestia` repository is currently private. Publishing Pages
from it requires GitHub Team, Enterprise Cloud, or another plan that supports
Pages for private repositories. If the organization does not have that
capability, publish the generated `.pages` artifact from a separate public
demo repository instead of changing Hestia's visibility without review.

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
or firewalls. Add short-lived TURN credentials before describing the demo as
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
certificate. The repository's `publish-demo` workflow builds the static
artifact and deploys it after changes reach `main`.

Enable Pages with **Settings → Pages → Source → GitHub Actions**, then set the
custom domain to `hestia-demo.greenways.ai`. The equivalent API calls are:

```bash
gh api --method POST repos/greenways-ai/hestia/pages -f build_type=workflow
gh api --method PUT repos/greenways-ai/hestia/pages \
  -f cname=hestia-demo.greenways.ai \
  -F https_enforced=true \
  -f build_type=workflow
```

If Pages already exists, the first command returns a conflict and can be
skipped. GitHub recommends verifying the `greenways.ai` domain for the
`greenways-ai` organization to prevent domain takeover.

After DNS and certificate status are healthy, run the workflow manually or
merge a change affecting the browser demo:

```bash
gh workflow run pages.yml --repo greenways-ai/hestia
gh run watch --repo greenways-ai/hestia
```

Open `https://hestia-demo.greenways.ai/`. It redirects to `/recovery/`.

## 3. Test on two devices

1. On the first device, create a reusable ceremony.
2. Send the full invite URL to the second device over a trusted channel. The
   capability is after `#` and is not sent to GitHub Pages or Cloudflare.
3. Open the exact URL on the second device and wait for both peer fingerprints.
4. Request recovery on either device.
5. Approve release on the other device.
6. Confirm the requester reports a locally verified recovered identity.

Use separate networks as a final NAT test. If those peers cannot connect while
same-network peers can, TURN fallback is the next deployment step.
