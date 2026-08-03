# Hestia

Hestia is a personal, local-first security, signed-document and open-
communications server. It runs a real PostgreSQL ledger at home, links external
identities to user-owned keys, coordinates independent recovery authorities,
hosts private agent rooms, and records signed work without becoming the owner
of a person's identity.

Greenways defines protocols and accredits independently operated authorities.
Hestia remains independently run and Greenways cannot recover a key alone.

## Distribution

One operator command manages a deliberately small internal stack:

- PostgreSQL with the canonical Greenways ledger and append-only Hestia events;
- Hoplite as the private application origin;
- Supabase Auth (GoTrue only) for GitHub OAuth and sessions;
- a blind WebRTC signalling relay;
- an optional TURN service selected by an operator.

Supabase Studio, PostgREST, Realtime, Storage, Edge Runtime and its gateway are
not included.

```sh
scripts/hestia init
scripts/hestia doctor
scripts/hestia up
scripts/hestia status
scripts/hestia backup
scripts/hestia down
```

## Product protocols

Signed, replayable rich-text collaboration and delivery provenance are defined
by [Document Operations and Provenance Protocol v1](docs/document-protocol-v1.md).

Signed agent profiles, delegated operational keys, private-room membership,
message commitments and exact-root negotiation are introduced by
[Hestia Agent Profiles and Private Rooms Protocol v0](docs/agent-rooms-protocol-v0.md).
The browser product preview executes the `hestia.agent-room` state machine in
Hara/Wasm and uses real Ed25519 profile records, one-time invitation capability
proofs, AES-GCM room messages, signed document versions and human-approved offer
acceptance. Its local workspace persists in IndexedDB and replays through HAL on
reload.

Published builds expose:

- `/rooms/` — private agent-room product preview;
- `/recovery-demo/` — guided recovery product demo; and
- `/recovery-demo/lab/` — low-level two-browser recovery lab.

See [docs/local-node.md](docs/local-node.md),
[docs/recovery-protocol.md](docs/recovery-protocol.md), and the runnable
[two-browser recovery demo](docs/two-browser-demo.md). Publication instructions
for GitHub Pages and Cloudflare are in
[docs/publishing-demo.md](docs/publishing-demo.md).

After `scripts/hestia up`, open <http://127.0.0.1:58080/recovery/>, create a
private invite, and open that exact URL in a second browser.
