# Kernel-sequenced document OT over WebRTC

Hestia document rooms can collaborate without placing PostgreSQL or a hosted
editor in the live edit path. Two browser Hara kernels exchange signed batches,
transformations, revisions and receipts over WebRTC. One kernel is the room
sequencer; every kernel independently verifies and replays the result.

## Trust model

The sequencer is trusted to assign one room order. It is not trusted to rewrite
contributor intent or invent a result:

- each contributor signs an exact `document/batch` in the `GWDP0` domain;
- each operation is independently content-addressed;
- the sequencer signs the exact `document/transformation`;
- the revision binds the previous head, operation vector and result AST;
- the sequencer signs `document/import-receipt`; and
- every receiving kernel reconstructs all referenced roots and replays the
  transformed operations before accepting the head.

The room genesis uses a separate `GWRM0` domain. It fixes the room ID, document
ID, epoch, sequencer key, initial AST and member document keys. Before accepting
genesis, each kernel verifies the member profile root signature, active
operational key, `document.edit` delegation and the profile/delegation roots
committed by genesis. A commit from a different room, epoch or non-contiguous
sequence is rejected.

## One OT policy

The room does not maintain an independent browser-only transformation
implementation. `hestia.document-room` adapts browser string/camel-case operation
maps to `gw.ledger.document-ot`, invokes the same portable Hara function used by
the durable ledger path, and projects the result back to the browser protocol
shape.

The Pages build publishes the canonical `document_protocol.hal` and
`document_ot.hal` files directly from `gwdb-ledger-hal`. The browser kernel loads
them as Hara resources before creating a room session. PostgreSQL-backed
admission and peer-to-peer rooms therefore share one transformation policy
source.

## Channels

The existing blind signalling relay remains on `hestia-signal/0-alpha`. It sees only
signed signalling envelopes and ICE data.

The peer connection uses two data channels:

```text
hestia-document-v1
  ordered: true
  reliable: true
  protocol: hestia-document-room/0-alpha

hestia-document-awareness-v1
  ordered: false
  maxRetransmits: 0
  protocol: hestia-document-awareness/0-alpha
```

Canonical document messages use the first channel. Cursor, focus and presence
updates use the second and never enter the revision graph.

## Room flow

1. The owner creates a private URL. The 256-bit room capability remains in the
   fragment and is not sent to the web origin.
2. Each browser creates an Ed25519 root key, delegated document key and signed
   profile granting `document.edit`.
3. The peers authenticate the WebRTC transport using the existing signed/HMAC
   envelope protocol.
4. The sequencer signs room genesis after verifying the invited profile,
   operational key and delegation.
5. A participant edits optimistically and asks its Hara kernel to create a
   signed batch from a known revision.
6. The sequencer kernel maps the batch through `gw.ledger.document-ot`, including
   all accepted operations after the base and earlier operations in the same
   atomic batch.
7. The sequencer signs the transformation, revision and receipt, then broadcasts
   one commit bundle.
8. The participant verifies the contributor signature, sequencer signature,
   epoch, sequence, previous head, operation roots, replay result, revision root
   and receipt root before moving its local head.

A conflict produces a signed transformation and receipt but no revision. Local
work can be retained as a private pending branch for later resolution.

## Embedded Hara artefacts

A `hara-artefact` source remains an ordinary text node, so its HAL source uses
normal `text.splice` OT. Live evaluation runs in the local document-room kernel.
A durable `artefact.commit` binds exact HCV0 source and result roots. Both the
sequencer and receiving kernel recompute the current source root; a stale or
competing result conflicts rather than silently replacing the artefact.

## Demo

The Pages build publishes `/documents/room/` and a `/documents/` landing page.

1. Open the room page in the owner browser.
2. Copy the private invite into a second browser or profile.
3. Wait for both pages to show **Document room active**.
4. Commit `Bright ` at offset zero in one page.
5. In the other page, select **Build this batch from revision 0**, change
   `world` to `Hara`, and submit.
6. Both pages converge on `Bright Hello Hara`; the ledger shows the stale offset
   transformed from 6 to 13.

The current demo is intentionally one sequencer and one participant. Multi-peer
rooms will use one authenticated WebRTC connection per participant while
retaining one epoch sequencer and the same signed commit bundle.

## Durable import

The peer room is not a separate document format. Its batches, transformations,
revisions and receipts use the same HCV0/GWDP0 records as the PostgreSQL-backed
Hestia document ledger. A personal or environment Hestia can later import the
verified room history for backup, approval, selective presentation and
delivery.
