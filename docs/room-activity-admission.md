# Hestia room activity admission

Status: implementation draft 0.1.0

Room activity admission makes consequential room work authoritative without
turning transport into the source of truth. The first activity records are:

- signed document-version attachments; and
- ciphertext-only message send intents.

Both use the existing `hestia-agent-http/1` gateway, bounded HCP1 import,
`GWAR1` Ed25519 verification, current profile delegation, room membership
policy, and environment-signed admission receipts.

## 1. Separate governance and activity heads

A room has two canonical heads:

```text
current_state_root   membership, invitations, policy, kernel and epoch
activity_head_root   documents, message intents and later formal actions
```

Membership changes advance `current_state_root`. Accepted room work advances
`activity_head_root`. An activity does not rewrite the governance root, and a
later membership transition does not discard prior work.

Every canonical `room/activity-state` commits:

1. the exact room governance state under which the event was accepted;
2. the previous activity root, or canonical nil for the first event;
3. the signed event record;
4. the activity kind;
5. the current actor profile record;
6. the membership epoch; and
7. the per-room activity sequence.

The append-only projection stores `(room_id, sequence)` and requires every next
activity to bind the current head. A prepared event cannot race another event
for the same room sequence.

## 2. Document attachment

A submitted `room/document-attachment` is an outer signed record that references:

- the current signed room version;
- a nested signed `document/version`;
- the pinned document-policy root; and
- the current attaching profile record.

The HCP1 pack carries the complete nested document graph, including a typed
`document/content` commitment. PostgreSQL independently verifies:

- the outer attachment signature;
- the nested document signature;
- that both signatures use the actor's admitted operational key;
- active `document.attach` delegation;
- active room membership with `document.attach` purpose;
- current room and actor profile heads;
- the environment's pinned document policy;
- document ID, media type and bounded version metadata;
- the typed content commitment; and
- exact predecessor binding to the latest version of that document already
  attached to this room.

The first attached version must be version one with a canonical nil predecessor.
A later version must increment by one and reference the exact prior signed
document record root.

The projection stores roots and metadata, not a mutable document row. The
original content remains committed by the nested HCV1 graph.

## 3. Ciphertext message intent

A submitted `room/message-intent` references:

- the current signed room version;
- the exact current membership epoch;
- the current sender profile record;
- a nested signed `room/message` envelope;
- a typed ciphertext commitment; and
- the pinned message-delivery policy.

PostgreSQL independently verifies:

- the outer intent signature;
- the nested message signature;
- that both use the sender's admitted operational key;
- active `room.message` delegation;
- active membership with `room.message` purpose;
- exact room ID, sender ID and current membership epoch in both records;
- a 12-byte AES-GCM IV transport value;
- bounded non-empty ciphertext containing at least an authentication tag;
- equality between the nested and outer ciphertext roots; and
- equality between the typed `room/ciphertext` value and the signed ciphertext
  carried by the nested envelope.

The message-intent projection contains no plaintext, IV or ciphertext column. It
stores the signed envelope and ciphertext roots, actor, epoch, delivery-policy
root and immutable activity receipt.

Its status remains `pending-delivery`. Delivery or failure will be a later
signed receipt event rather than an update to the original intent.

## 4. Admission transaction

The gateway performs verification and policy admission in one PostgreSQL
transaction:

```text
import complete HCP1 graph
  -> verify outer signed record
  -> commit signed verification receipt
  -> lock current room governance and activity heads
  -> verify actor profile, delegation and member purpose
  -> verify nested signed document or message
  -> validate predecessor or ciphertext commitment
  -> construct next room/activity-state
  -> prepare exact admission-receipt signing bytes
  -> sign with local Hestia environment key
  -> recheck all mutable heads and authority
  -> commit signed receipt, activity row and specific projection
  -> advance only room.activity_head_root
```

If any policy check fails, the transaction rolls back the HCP1 import and the
outer verification projection. A cryptographically valid but stale or
unauthorized activity leaves no committed verification receipt.

Repeating an already accepted signed record is idempotent and returns the same
signed admission receipt.

## 5. Implemented rejection cases

The integration flow proves rejection of:

- a document attachment signed by the host root key rather than the admitted
  operational key;
- a message intent signed for membership epoch one after the room has advanced
  to epoch two;
- an attachment whose document predecessor is not the latest attached version;
- a message whose nested ciphertext commitment differs from its signed
  ciphertext; and
- a concurrent or stale activity prepared against an earlier activity head.

The first two cases are executed through the real HTTP gateway and pgsodium
stack. Rejected transactions do not increase the verification count or create
activity projections.

## 6. Current boundary

This slice admits intent and provenance, not transport completion. It does not
yet provide:

- message delivery or failure receipts;
- WebSocket room presence;
- asynchronous encrypted mailboxes;
- document-operation batches and conflict receipts inside the room gateway;
- formal offer, counteroffer, human approval and acceptance admission; or
- selective disclosure bundles and participant-signed checkpoints.

Those later records will advance the same append-only activity head and bind the
room governance snapshot under which each action was accepted.
