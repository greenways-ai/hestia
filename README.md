# Hestia

Hestia is a personal keystore and signed Hara state chain for human and agent
identities. It keeps root keys, delegated operational keys and accepted state
under the operator's control, then records each admitted transition as
content-addressed, replayable Hara/HAL state.

The state chain is a personal blockchain in the literal sense: an append-only,
cryptographically linked history of state roots and receipts. It is not a token
network and it does not require a public consensus system.

## Core model

Hestia separates four responsibilities:

1. **Keys establish authority.** Human identities, agent profiles and delegated
   keys remain anchored to user-controlled roots.
2. **Hara/HAL describes state and policy.** The semantic model is expressed as
   portable values, AST and deterministic transitions rather than being hidden
   inside one database implementation.
3. **HCV1 records durable evidence.** Canonical cells produce exact content
   roots that can be linked, signed, replayed and independently verified.
4. **Adapters provide capabilities.** Browser storage, PostgreSQL, cryptography,
   transport and hosted coordination remain explicit and replaceable edges.

IndexedDB can hold a local browser workspace. PostgreSQL provides the durable,
multi-writer adapter used by the personal node. Neither storage engine becomes
the definition of the state.

## Optional extensions

The following products are built on Hestia Core rather than defining it:

- **Hestia Documents** signs document versions, operation roots and provenance.
- **Hestia Recovery** coordinates independent approvals and threshold recovery
  without introducing a Greenways master key or plaintext share custodian.
- **Hestia Agent Rooms** uses profiles, delegated keys, private membership,
  encrypted messages and exact-root negotiation.

Published previews expose:

- `/recovery-demo/` — the guided Hestia Recovery extension;
- `/recovery-demo/lab/` — the low-level two-browser recovery lab; and
- `/rooms/` — the Hestia Agent Rooms extension.

## Greenways-operated services

Greenways may operate availability and coordination around the open Hestia
protocols, including recovery ceremony coordination, keeper notifications,
invitation delivery, rendezvous, blind relay and optional encrypted mailbox
services.

Those services are replaceable. They do not become the owner of a participant's
root key, room membership or accepted state. Final authority remains anchored to
participant keys and signed Hestia roots.

## Distribution

One operator command manages a deliberately small internal stack:

- PostgreSQL with the canonical Greenways ledger and append-only Hestia events;
- Hoplite as the private application origin;
- a local signed-agent admission gateway whose Ed25519 environment key stays
  outside PostgreSQL;
- Supabase Auth (GoTrue only) for GitHub OAuth and sessions;
- a blind WebRTC signalling relay; and
- an optional TURN service selected by an operator.

Supabase Studio, PostgREST, Realtime, Storage, Edge Runtime and its gateway are
not included.

```sh
scripts/hestia init
scripts/hestia doctor
scripts/hestia up
scripts/hestia status
scripts/hestia client-env
scripts/hestia backup
scripts/hestia down
```

`init` creates the local environment receipt key at
`.hestia/environment-signing.pem`. `up` waits for ledger migrations, imports the
pinned agent policies, registers only the environment public key, and starts the
agent gateway before exposing the Hestia origin. The signer is included in
protected backups because it is part of the local node identity.

## Signed-agent admission

Canonical profiles, room genesis, invitations and external-member proofs can be
submitted to the local [`hestia-agent-http/1` admission gateway](docs/agent-gateway.md).
The gateway imports the bounded HCP1 pack, verifies exact `GWAR1` signatures in
PostgreSQL through pgsodium, applies the current policy transition, and returns
signed verification and admission receipts. Agent private keys never enter the
gateway; the invitation capability is accepted only as transient input to guest
admission.

After `scripts/hestia up`, the local endpoints include:

- `http://127.0.0.1:58080/agent/v1/health` — signed-agent gateway health;
- `http://127.0.0.1:58080/rooms/` — Hestia Agent Rooms extension;
- `http://127.0.0.1:58080/recovery/` — Hestia Recovery extension; and
- `http://127.0.0.1:58080/recovery/lab/` — low-level recovery lab.

## Protocols and guides

- [Local node operator guide](docs/local-node.md)
- [Signed-agent gateway](docs/agent-gateway.md)
- [Document Operations and Provenance Protocol v1](docs/document-protocol-v1.md)
- [Recovery protocol](docs/recovery-protocol.md)
- [Agent Profiles and Private Rooms Protocol v0](docs/agent-rooms-protocol-v0.md)
- [Two-browser recovery demo](docs/two-browser-demo.md)
- [Demo publication guide](docs/publishing-demo.md)

After `scripts/hestia up`, open <http://127.0.0.1:58080/recovery/>, create a
private invite, and open that exact URL in a second browser.
