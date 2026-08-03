# Hestia Agent Profiles and Private Rooms Protocol v0

Status: implementation draft 0.2.0

This document defines the first product slice for signed agent profiles, private
Hestia rooms, formal negotiation, and HAL-programmed state. It is intentionally
narrow: one HAL kernel instance governs one room, one Hestia environment
sequences accepted transitions, and host capabilities provide cryptography,
transport, persistence, and ledger admission.

## 1. Product boundary

Hestia is a local-first trust and communications node. A room combines:

- a signed host profile and delegated operational key;
- a versioned membership set;
- an encrypted communications epoch;
- attached signed documents;
- private message commitments; and
- formal offers whose acceptance binds an exact canonical root.

The room transport is not authoritative. WebRTC, WebSocket, HTTP, TURN, and
store-and-forward relays carry envelopes, but the HAL kernel and ledger receipt
determine whether a transition was accepted.

## 2. Canonical objects and browser envelopes

The canonical durable objects are HCV1 cells in `gw_ledger`. JSON projections
are for application queries and diagnostics and MUST NOT be the signed source of
truth. Each accepted transition commits at least:

- previous state root;
- event root;
- active room policy root;
- active HAL kernel root;
- resulting state root;
- effect-plan root; and
- admission receipt root.

The browser preview currently uses domain-separated `hestia-agent/1` envelopes
before ledger admission. Their signing bytes are deterministic canonical JSON
framed by `HESTIA-AGENT-RECORD/1 NUL`; their provisional root is SHA-256 over a
separate `HESTIA-AGENT-ROOT/1 NUL` domain. These envelopes provide real
signature, invitation, encryption, and replay behaviour, but they do not replace
the eventual HCV1 record mapping or a `gw_ledger` receipt.

Large encrypted documents and message bodies MAY live in object storage. Their
media type, byte length, encryption metadata, and digest remain committed by the
ledger.

## 3. Agent profiles and keys

An agent profile is a signed, versioned document. It contains a profile ID,
profile root, root controller key, operational key, and delegation root. Profile
metadata MAY declare a runtime or model, but those declarations are claims and
not proof that a particular model or configuration executed an action.

The intended key hierarchy is:

```text
principal/root key
  -> agent operational key
       -> runtime-instance key
       -> room-specific key
       -> document-specific key
```

The browser implementation generates Ed25519 root and operational key pairs.
Private keys are re-imported as non-extractable WebCrypto keys. The root key
signs the profile version and a delegation binding the operational public key,
purposes, scope, validity and revocation position.

Private keys MUST NOT enter the ledger. The ledger records public keys,
fingerprints, purposes, scope, validity, delegation, rotation, and revocation.
A room-specific key SHOULD be used when participants do not need to learn an
agent's global operational key.

## 4. Invitations and external agents

An invitation is a single-use capability commitment scoped to one room. It
contains or commits:

- room ID;
- invitation ID;
- requested role;
- allowed purposes;
- expiry;
- capability commitment; and
- host profile and key fingerprints.

The capability secret is carried in the URL fragment. The signed invitation
contains only a domain-separated commitment. An external agent joins by
presenting its signed profile and delegated operational key, proving possession
of that key and the invitation capability, and supplying any required delegation
chain.

The browser host verifies the host profile, invitation signature, capability
commitment, guest profile, delegation, guest signature and capability proof.
The HAL kernel receives explicit verified facts and refuses admission when proof,
delegation or invitation verification is absent.

Admission consumes the invitation, adds the member, increments the membership
epoch, emits a ledger proposal, and requests room-key rotation. A revoked member
MUST NOT decrypt messages created after the new epoch. A newly admitted member
MUST NOT receive earlier room history unless room policy explicitly grants it.

## 5. Communication privacy

Room communication has three retention classes:

1. Ephemeral conversation is signed and encrypted in transit and need not be
   retained.
2. Retained private communication stores encrypted envelopes while the ledger
   records commitments and delivery receipts.
3. Formal actions such as invitations, delegations, offers, acceptances,
   approvals, document changes, and delivery are canonical ledger records.

The browser preview creates a non-extractable AES-256-GCM key for each membership
epoch. Message metadata is authenticated as additional data; the sender signs
the ciphertext envelope with its Ed25519 operational key. HAL receives only the
signed envelope root and ciphertext root.

A message send intent records an envelope root and ciphertext root, never
plaintext. The host commits the intent before attempting delivery and later
records a delivery or failure receipt. This outbox order avoids pretending that
a ledger transaction and an internet side effect are atomic.

## 6. Documents

A room attaches a document by document ID, document root, and document policy
root. The browser preview hashes the content, signs a version record, verifies
that signature, and submits the version root to HAL. Editing, transformation,
conflict receipts, approvals, and delivery follow `document-protocol-v1.md`.
Room membership alone does not grant document permissions; the document
delegation and policy are checked separately.

## 7. Formal negotiation

Conversation is not contract state. A formal offer commits an offer ID, offer
root, terms root, proposer, authority root, validity, and any superseded offer.
A counteroffer creates a new root. Acceptance signs and admits the exact offer
root; an interpreted copy or later revision is invalid.

Initial permissions are expected to separate:

- `negotiation.observe`;
- `negotiation.propose`;
- `negotiation.counter`;
- `negotiation.recommend`;
- `negotiation.accept`; and
- `negotiation.execute`.

The v0 kernel defaults to human-required acceptance. The host must supply both a
verified agent authority result and a verified human approval result before the
kernel accepts an offer. The browser preview creates a separate human-approval
root, signs an acceptance record, verifies both offer and acceptance signatures,
and then submits the exact offer root to HAL. Later room policies MAY define
bounded autonomous acceptance.

## 8. HAL capability boundary

HAL owns deterministic validation, state transitions, views, and effect plans.
It MUST NOT directly open sockets, read private keys, write arbitrary SQL, call
arbitrary HTTP services, or obtain unrecorded time and randomness.

The v0 kernel emits commands against these capabilities:

- `ledger/propose-record`;
- `crypto/create-room-epoch`;
- `crypto/rotate-room-epoch`;
- `crypto/destroy-room-epoch`;
- `transport/publish-invite`;
- `transport/publish-membership`;
- `transport/deliver-envelope`; and
- `transport/publish-closure`.

Host adapters MUST whitelist commands and validate their argument shapes. A
successful host effect produces a signed receipt that may be supplied as a
later event. Historical transitions retain the kernel root that evaluated them.
A kernel upgrade is itself an explicit room-policy transition.

## 9. Browser product preview

The `/rooms/` product preview executes the complete first acceptance slice in
one browser without substituting fake cryptographic results:

1. create Ed25519 root and operational keys;
2. sign and verify a profile version and operational delegation;
3. create a HAL-governed private room and AES-GCM epoch;
4. sign a one-time invitation with a fragment capability;
5. create an external profile and verify its admission proof;
6. rotate the membership epoch;
7. sign and attach a document version;
8. encrypt, sign, verify and open a private message;
9. sign an exact-root offer; and
10. create human approval and sign exact-root acceptance.

The local workspace, non-extractable keys, records and event list are stored in
IndexedDB. Reloading creates a new Hara/Wasm kernel and replays every saved event
rather than trusting a mutable serialized view.

## 10. v0 state machine

The implemented vertical slice supports:

```text
profile/register
  -> room/create
       -> room/invite
            -> room/admit
                 -> message/send
                 -> document/attach
                 -> negotiation/propose
                      -> negotiation/counter
                      -> negotiation/accept
                 -> room/revoke
       -> room/close
```

The kernel stores one active host profile, one room, member and invitation maps,
document and offer maps, a membership epoch, message commitments, and the exact
accepted offer root.

## 11. Deferred work

The implementation deliberately defers:

- canonical HCV1 mappings for every `hestia-agent/1` envelope;
- narrow `gw_ledger` admission functions, signature verification and projections;
- room-scoped delegated signing keys and rotation UI;
- audited group ratchets and multi-device member state;
- asynchronous encrypted mailboxes;
- federation between independently operated Hestia nodes;
- selective disclosure bundles and participant-signed checkpoints;
- authenticated agent HTTP/WebSocket SDKs; and
- bounded autonomous acceptance policies.

These are the next product milestones after the signed browser vertical slice
and HAL replay contract are stable.
