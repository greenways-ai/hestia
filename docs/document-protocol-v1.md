# Greenways Document Operations and Provenance Protocol v1

Status: draft 0.3.0

This document is normative. MUST, MUST NOT, SHOULD, SHOULD NOT and MAY describe
conformance requirements.

## 1. Authority and privacy

HCV1 cells and SHA-256 roots are canonical. HCP1 is the canonical pack
transport. JSON is a replay and interface projection and MUST NOT be signed as
the source of truth.

The portable `gw.ledger.document-ot` Hara module owns operation schemas,
transformation rules, batch replay, artefact invalidation and revision/receipt
plans. `gw_ledger` owns canonical cells, operation identities, transformation
records, revisions and document heads. Hestia owns identity, authorization,
environment sequencing, signatures, receipts, approvals and deliveries. One
environment Hestia sequences a document in v1.

A JavaScript or native adapter MAY execute the same transformation rules for
performance, but it is a projection of the Hara ledger policy. Conformance
fixtures MUST produce the same transformed operation roots, result AST root and
conflict code as the Hara module before the adapter is admitted for production.

Only disclosed document logs are covered. A private log MAY attach to a wider
personal stream, but that attachment and undisclosed history are never required
or imported.

## 2. Identity and signatures

Document, node, artefact, operation, batch, transformation, log, receipt and
delivery IDs MUST be lowercase UUIDv7. Integer sequences are authoritative;
wall-clock time is descriptive.

Signing bytes are exactly:

```text
GWDP1 NUL <record-type UTF-8> NUL <32 raw body-root bytes>
```

The body root is not hexadecimal text in the signing payload. `GWDP1` records
MUST NOT be accepted as `GWAR1` agent-room records, or vice versa. Protocol keys
MUST use Ed25519.

A delegation binds issuer identity, subject key, purposes,
document/environment scope, validity and revocation. Purposes include
`document.edit`, `document.approve`, `document.deliver`,
`hestia.personal.append`, and `hestia.environment.import`. Delegation is checked
at admission and again immediately before commit; later rotation does not
invalidate previously accepted receipts.

Three independent signatures are used at the collaboration boundary:

1. the contributor operational key signs `document/batch`;
2. the active Hestia environment key signs `document/transformation`, binding
   the exact current head, transformed operation vector, result AST and outcome;
3. PostgreSQL constructs `document/import-receipt`, returns its exact GWDP1
   signing bytes, and accepts the environment signature only after rechecking
   the head and delegation in the committing transaction.

The environment MUST NOT sign a client-computed receipt root or arbitrary JSON.

## 3. Policy

Genesis commits profile, environment, role membership, ordered stages, quorum
and veto rules, delivery stage, amendment rules and allowed disclosure modes.
Amendments are append-only and authorized under the previous policy. Stage names
are not hardcoded.

The first accepted batch establishes the document origin AST at revision zero.
Every later batch MUST bind a base revision and exact base AST root already in
the document history. A stale base is valid input to OT, but a base ahead of the
environment head is invalid.

## 4. Personal logs and disclosure branches

A personal document log is a signed chain scoped to one document. Each entry
commits `log-id`, `sequence`, `previous-entry-root`, and genesis or a batch. The
author signs a batch; personal Hestia signs an append receipt committing that
signature and chain position.

A private working log MUST NOT be remotely pulled. A contributor:

1. fetches an environment checkpoint and authorized changes;
2. selects work and rebases it locally;
3. reviews the result and signs a complete disclosure branch containing only
   selected work; and
4. submits that branch for environment transformation and import.

Personal Hestia SHOULD privately retain the derivation. Imported records MUST
NOT require the private link.

## 5. Replayable batches

A `document/batch` commits one to 64 independently content-addressed operation
roots, document ID, base revision and AST, expected local result AST, author
profile root and delegation root. One signature covers the batch, but every
operation remains independently replayable and addressable.

The environment creates a separate `document/transformation` record committing:

- the exact signed batch root;
- the current previous revision and AST roots;
- the transformed operation-vector root;
- the exact result AST root;
- `accepted` or `conflict`; and
- the canonical conflict value or nil root.

Replay MUST derive an intermediate AST root after each operation. Receipts retain
each original root, transformed root or conflict, disposition and result.

Initial HCP1 bounds remain 128 new cells and 1,000,000 bytes. Larger edits MUST
split. Transport compression is outside canonical hashing.

## 6. Operations and transformation

Offsets count Unicode scalar values, not UTF-16 units, bytes or graphemes.

- `text.splice`: target text ID, offset, delete count and inserted text.
- `node.insert`: parent, optional before/after anchors and subtree.
- `node.delete`: target and expected subtree root.
- `node.move`: target, destination parent and optional anchors.
- `node.replace`: target, expected root and replacement subtree.
- `node.set-attrs`: target, expected attrs and replacement attrs.
- `mark.add` and `mark.remove`: stable text range and mark.
- `artefact.commit`: artefact ID and node ID, source text ID, exact source root,
  result root, media type and optional concise display.

Inserted IDs MUST be globally unique. Preconditions prevent silent application
to unexpected content.

Map an operation through all accepted operations after its base, then through
earlier transformed operations in its own atomic batch:

- non-overlapping splices shift offsets;
- same-position inserts order by environment acceptance then batch index;
- duplicate deletes are explicit no-ops and compatible overlap collapses;
- insertion inside concurrently deleted text conflicts;
- editing a deleted target or ancestor conflicts, except identical deletion;
- a missing anchor MAY use the surviving opposite anchor, while an ambiguous gap
  conflicts and MUST NOT append;
- competing moves, cycles, incompatible attrs and invalid profile results
  conflict;
- a mark whose whole range disappeared is a no-op, while partial ambiguity
  conflicts;
- an `artefact.commit` conflicts if an accepted operation after its base changed
  its source text, deleted its node, or changed the source binding; and
- two commits for the same source root and result root collapse to an explicit
  no-op, while competing result roots conflict.

A batch is atomic. Any conflict creates an environment-signed transformation and
import receipt but MUST NOT create a revision or advance the document head.
Resolution is a new signed batch referencing and reusing, replacing or
abandoning the conflicting operation roots.

## 7. Rich text and Hara artefact profile

`greenways.rich-text/2` nodes are `doc`, `paragraph`, `heading`, `blockquote`,
`bullet-list`, `ordered-list`, `list-item`, `code-block`, `horizontal-rule`,
`hard-break`, `text`, and `hara-artefact`. Marks are `strong`, `emphasis`,
`underline`, `strike`, `code`, and `link`.

Every node has a UUIDv7 ID. Heading level is 1-6; ordered-list start is positive;
link has `href` and optional `title`. Marks are sorted and unique. Text is valid
Unicode and is not implicitly normalized. Unknown types/attrs are invalid.

A `hara-artefact` is a document block with:

- a globally unique `artefact-id`;
- `kind`, one of `value`, `view`, `table`, `chart`, `canvas`, `query`, `agent`,
  or `custom`;
- `mode`, either `live` or `snapshot`;
- an optional Hara namespace or entry point;
- a sorted set of requested capabilities;
- exactly one direct `text` child containing HAL source; and
- optional committed `snapshot-source-root`, `snapshot-root`,
  `snapshot-media-type`, and concise `snapshot-display` attrs.

The HAL source child is edited with ordinary `text.splice`, so collaborative
source editing uses the same transformation rules as prose. A live result is a
kernel projection and MUST NOT become canonical merely because a client rendered
it. `artefact.commit` binds a reviewed source root to a result root and changes
the artefact to snapshot mode.

A client MUST treat artefact output as untrusted. HTML or HTA output MUST be
projected through a registered host renderer or sandboxed document. An artefact
MUST NOT obtain DOM, filesystem, network, signing-key, collaboration or room
capabilities merely by being embedded.

`greenways.rich-text/1` remains valid for documents without artefacts. Adapters
return canonical AST/bytes plus a loss report. Delivery commits the adapter
package, runtime, options, assets and fonts.

## 8. Ledger storage and receipts

`hestia.document_head` is only a mutable pointer. Authoritative history is the
append-only set of HCV1 `document/revision`, operation and signed receipt roots
stored through `gw_ledger`.

A JSON AST or operation may be retained beside its root to make replay and UI
projection efficient. That JSON is non-canonical. The corresponding HCV1 root,
transformation signature and import receipt remain authoritative.

The prepare stage MUST:

- import and cryptographically verify the contributor batch and environment
  transformation packs;
- confirm the transformation is signed by the active environment key;
- confirm current `document.edit` delegation;
- lock and compare the exact head revision and AST roots;
- verify the batch base exists in history;
- construct the `document/revision` and `document/import-receipt` roots inside
  PostgreSQL; and
- return only the exact receipt signing bytes.

The commit stage MUST repeat the head, profile, delegation and signature checks.
It then verifies the environment signature, appends the revision and transformed
operation projections, advances the head only for `accepted`, and records the
signed receipt atomically.

Public receipt metadata exposes environment, document and contributor
identities, counts, times, outcome, environment sequence and blinded submission
and result commitments. It MUST NOT expose private text, artefact source, result
bytes or salts. Authorized details expose roots, salts and diagnostics.

Approval binds decision, stage, policy, revision and AST roots. Later edits
preserve historical approval but leave the new head unapproved. Quorum applies
to an exact root without an effective veto.

Delivery commits exact approved roots, cutoff sequence, complete disposition
coverage, exporter/runtime/options/assets roots, artefact media types, lengths
and SHA-256 digests, and a policy-permitted mode. Pending or conflicted batches
before cutoff block delivery. Modes are `public-full`, `authorized-full`, and
`commitment-only`; the last is environment-attested, not independently replayed.

## 9. HTTP projection

The first implemented write projection is:

- `POST /agent/v1/documents/imports` — submit a signed batch bundle for Hestia
  verification, OT, transformation signing and atomic ledger admission.

The wider v1 projection is:

- `GET /v1/documents/{id}/sync?from={revision}`
- `POST /v1/documents/{id}/imports/prepare`
- `POST /v1/documents/{id}/imports`
- `GET /v1/receipts/{id}` and `GET /v1/receipts/{id}/details`
- `POST /v1/documents/{id}/approvals`
- `POST /v1/documents/{id}/deliveries`
- `GET /v1/deliveries/{id}/bundle`

Realtime transports MAY announce receipt IDs and revisions but are not
authoritative. A client reconnects by requesting accepted operations from its
last acknowledged revision, rebasing pending personal batches locally, and
submitting a reviewed disclosure branch.

Existing owner-signed create/edit calls are single-operation compatibility
batches. Existing signed music releases remain valid delivery artefacts.
Historical roots and signatures MUST NOT be rewritten.
