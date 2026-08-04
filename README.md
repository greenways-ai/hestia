# Hestia

Hestia is a private office for the agents who work on your behalf. It gives each
agent a lasting identity, a bounded daily key and a signed mandate; keeps their
work, proposals and approvals in one owner-controlled history; and prepares a
selective receipt when a client, partner or adviser asks what happened.

The everyday experience is deliberately calm:

1. **Appoint an agent.** Give a personal or specialist agent a named profile and
   only the authority needed for its role.
2. **Issue a mandate.** Define the brief, permitted workflow, limits and the
   decisions that must return to a person.
3. **Follow the work.** Keep signed briefs, encrypted updates, workflow entries
   and proposed terms together in the private office.
4. **Approve precisely.** Bind a human decision to the exact recommendation,
   contract or terms that were reviewed.
5. **Present a receipt when needed.** Share a bounded proof of the relevant work
   without exposing the rest of the office.

The keys, signatures and append-only Hara state history support this experience;
they are the quiet infrastructure beneath it, not the product story a person has
to learn before using Hestia.

## Live experiences

The published Hestia site includes four browser experiences:

- **Private Agent Office** at `/rooms/` runs the full
  `hestia.agent-room` HAL program. It appoints a principal agent, opens a private
  office, admits a bounded specialist, issues a mandate, records work, negotiates
  revised terms, binds human approval, creates a private receipt, prepares a
  selective presentation, rotates keys, revokes access and closes the office.
- **Kernel Document Room** at `/documents/room/` connects two browser Hara
  kernels over authenticated WebRTC. One kernel sequences signed document
  batches while both independently replay the transformed operations and verify
  the same revision and receipt roots. The experience includes deliberate
  stale-base edits, an embedded Hara artefact, ephemeral awareness and explicit
  reviewed snapshot commits.
- **Continuity** at `/recovery-demo/` arranges three independent stewards and an
  owner-held factor, then runs the real threshold recovery ceremony locally. A
  coordination service may help the ceremony happen, but it never receives
  enough material to restore the office by itself.
- **Recovery laboratory** at `/recovery-demo/lab/` exposes the lower-level
  two-browser protocol for operators and protocol developers.

The primary experiences expose the actual `.hal` source and run it through the
Hara/WASM browser kernel rather than simulating workflow policy in presentation
code.

## Under the surface

Hestia separates four responsibilities:

1. **Keys establish authority.** Human identities, agent profiles and delegated
   operational keys remain anchored to owner-controlled roots.
2. **Hara/HAL describes state and policy.** Mandates, transitions and approval
   rules are portable values and deterministic AST programs rather than hidden
   inside one database implementation.
3. **HCV1 records durable evidence.** Canonical cells produce exact content
   roots for signed records, event receipts and selective presentations.
4. **Adapters provide capabilities.** Browser storage, PostgreSQL, cryptography,
   transport and hosted coordination remain explicit and replaceable edges.

The resulting state history is append-only and cryptographically linked, but it
does not require a token, public activity feed or public consensus network.
IndexedDB can hold a local browser office. PostgreSQL provides the durable,
multi-writer adapter used by a personal node. Neither storage engine becomes the
definition of the workflow state.

## Office capabilities

Hestia Core provides:

- root and operational agent profiles;
- scoped delegation, rotation and revocation;
- signed mandates and deterministic workflow transitions;
- exact-root human approvals;
- encrypted room epochs and private update commitments;
- signed document versions and provenance;
- signed, peer-to-peer document OT between independently verifying Hara kernels;
- private work receipts and bounded receipt presentations; and
- replayable Hara state with ledger, cryptography and transport capabilities
  kept at visible boundaries.

Continuity, private collaboration and document provenance are ways the private
office uses this core. They are not separate sources of authority.

## Greenways-operated services

Greenways may provide concierge coordination around the open Hestia protocols,
including steward availability, ceremony notifications, invitation delivery,
rendezvous, blind relay and an optional encrypted mailbox.

Those services are replaceable. They do not own a participant's root key, agent
mandate, office membership, human approval or private work history. Final
authority remains anchored to participant-controlled keys and signed Hestia
state.

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
protected backups because it is part of the local office identity.

## Signed-agent admission

Canonical profiles, office genesis, invitations and external-member proofs can
be submitted to the local [`hestia-agent-http/1` admission gateway](docs/agent-gateway.md).
The gateway imports the bounded HCP1 pack, verifies exact `GWAR1` signatures in
PostgreSQL through pgsodium, applies the current policy transition, and returns
signed verification and admission receipts. Agent private keys never enter the
gateway; the invitation capability is accepted only as transient input to guest
admission.

After `scripts/hestia up`, the local endpoints include:

- `http://127.0.0.1:58080/agent/v1/health` — signed-agent gateway health;
- `http://127.0.0.1:58080/rooms/` — the Private Agent Office;
- `http://127.0.0.1:58080/documents/room/` — the two-kernel WebRTC document room;
- `http://127.0.0.1:58080/recovery/` — the Continuity experience; and
- `http://127.0.0.1:58080/recovery/lab/` — the low-level recovery laboratory.

## Protocols and guides

- [Local node operator guide](docs/local-node.md)
- [Signed-agent gateway](docs/agent-gateway.md)
- [Document Operations and Provenance Protocol v1](docs/document-protocol-v1.md)
- [WebRTC kernel document room](docs/webrtc-document-room.md)
- [Recovery protocol](docs/recovery-protocol.md)
- [Agent Profiles and Private Rooms Protocol v0](docs/agent-rooms-protocol-v0.md)
- [Two-browser recovery demo](docs/two-browser-demo.md)
- [Demo publication guide](docs/publishing-demo.md)

After `scripts/hestia up`, open <http://127.0.0.1:58080/rooms/> for the complete
private-office workflow, <http://127.0.0.1:58080/documents/room/> for direct
signed document collaboration between two browser kernels, or
<http://127.0.0.1:58080/recovery/> to arrange and test continuity.
