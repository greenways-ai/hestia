# Greenways Document Operations and Provenance Protocol v1

Status: draft 0.1.0

This document is normative. MUST, MUST NOT, SHOULD, SHOULD NOT and MAY describe
conformance requirements.

## 1. Authority and privacy

HCV1 cells and SHA-256 roots are canonical. HCP1 is the canonical pack
transport. JSON is diagnostic and MUST NOT be signed as the source of truth.
`gw_ledger` owns profiles, operations, batches, replay and revisions. Hestia
owns signed personal/environment logs, authorization, receipts, approvals and
deliveries. One environment Hestia sequences a document in v1.

Only disclosed document logs are covered. A private log MAY attach to a wider
personal stream, but that attachment and undisclosed history are never required
or imported.

## 2. Identity and signatures

Document, node, operation, batch, log, receipt and delivery IDs MUST be
lowercase UUIDv7. Integer sequences are authoritative; wall-clock time is
descriptive. Signed HCV1 records contain `protocol`, `type`, `id`,
`document-id`, `body-root`, `signer-key`, and `delegation-root`.

Signing bytes are `GWDP1 NUL <record-type UTF-8> NUL <32-byte body root>`.
Protocol keys MUST use Ed25519. A delegation binds issuer identity, subject key,
purposes, document/environment scope, validity and revocation. Purposes are
`document.edit`, `document.approve`, `document.deliver`,
`hestia.personal.append`, and `hestia.environment.import`. Delegation is
checked at admission; later rotation does not invalidate accepted receipts.

## 3. Policy

Genesis commits profile, environment, role membership, ordered stages, quorum
and veto rules, delivery stage, amendment rules and allowed disclosure modes.
Amendments are append-only and authorized under the previous policy. Stage
names are not hardcoded.

## 4. Personal logs and disclosure branches

A personal document log is a signed chain scoped to one document. Each entry
commits `log-id`, `sequence`, `previous-entry-root`, and genesis or a batch.
The author signs a batch; personal Hestia signs an append receipt committing
that signature and chain position.

A private working log MUST NOT be remotely pulled. A contributor:

1. fetches an environment checkpoint and authorized changes;
2. selects work and rebases it locally;
3. reviews the result and signs a complete disclosure branch containing only
   selected work; and
4. submits that branch for verbatim environment import.

Personal Hestia SHOULD privately retain the derivation. Imported records MUST
NOT require the private link.

## 5. Replayable batches

A batch commits one to 64 independently content-addressed operation roots,
personal log position, base environment revision and AST, expected local result
AST, profile root and delegation. One signature covers the batch, but every
operation remains replayable. Replay MUST derive an intermediate AST root after
each operation. Receipts retain each original root, transformed root or
conflict, disposition and result.

Initial HCP1 bounds remain 128 new cells and 1,000,000 hexadecimal characters.
Larger edits MUST split. Transport compression is outside canonical hashing.

## 6. Operations and transformation

Offsets count Unicode scalar values, not UTF-16 units, bytes or graphemes.

- `text.splice`: target text ID, offset, delete count and inserted text.
- `node.insert`: parent, optional before/after anchors and subtree.
- `node.delete`: target and expected subtree root.
- `node.move`: target, destination parent and optional anchors.
- `node.replace`: target, expected root and replacement subtree.
- `node.set-attrs`: target, expected attrs and replacement attrs.
- `mark.add` and `mark.remove`: stable text range and mark.

Inserted IDs MUST be globally unique. Preconditions prevent silent application
to unexpected content.

Map an operation through all accepted operations after its base, then through
earlier transformed operations in its batch:

- non-overlapping splices shift offsets;
- same-position inserts order by environment acceptance then batch index;
- duplicate deletes are explicit no-ops and compatible overlap collapses;
- insertion inside concurrently deleted text conflicts;
- editing a deleted target or ancestor conflicts, except identical deletion;
- a missing anchor MAY use the surviving opposite anchor, while an ambiguous
  gap conflicts and MUST NOT append;
- competing moves, cycles, incompatible attrs and invalid profile results
  conflict; and
- a mark whose whole range disappeared is a no-op, while partial ambiguity
  conflicts.

A batch is atomic. Any conflict creates a signed receipt and MUST NOT advance
the head. Resolution is a new signed batch referencing and reusing, replacing
or abandoning the conflicting operation roots.

## 7. Rich text profile

`greenways.rich-text/1` nodes are `doc`, `paragraph`, `heading`,
`blockquote`, `bullet-list`, `ordered-list`, `list-item`, `code-block`,
`horizontal-rule`, `hard-break`, and `text`. Marks are `strong`,
`emphasis`, `underline`, `strike`, `code`, and `link`.

Every node has a UUIDv7 ID. Heading level is 1-6; ordered-list start is positive;
link has `href` and optional `title`. Marks are sorted and unique. Text is
valid Unicode and is not implicitly normalized. Unknown types/attrs are
invalid. Tables, media, captions, footnotes and embeds are deferred.

Adapters return canonical AST/bytes plus a loss report. Delivery commits the
adapter package, runtime, options, assets and fonts.

## 8. Receipts, approvals and delivery

Every admissible import receives an environment signature. Invalid signatures
or chains receive rejection receipts over blinded commitments; untrusted
contents need not be retained.

Public receipt metadata exposes environment, document and contributor
identities, counts, times, outcome, environment sequence and blinded
submission/result commitments. It MUST NOT expose private roots, operations,
text or salts. Authorized details expose roots, salts and diagnostics.

Approval binds decision, stage, policy, revision and AST roots. Later edits
preserve historical approval but leave the new head unapproved. Quorum applies
to an exact root without an effective veto.

Delivery commits exact approved roots, cutoff sequence, complete disposition
coverage, exporter/runtime/options/assets roots, artifact media types, lengths
and SHA-256 digests, and a policy-permitted mode. Pending/conflicted batches
before cutoff block delivery. Modes are `public-full`, `authorized-full`, and
`commitment-only`; the last is environment-attested, not independently
replayed.

## 9. HTTP projection

- `GET /v1/documents/{id}/sync?from={revision}`
- `POST /v1/documents/{id}/imports/prepare`
- `POST /v1/documents/{id}/imports`
- `GET /v1/receipts/{id}` and `GET /v1/receipts/{id}/details`
- `POST /v1/documents/{id}/approvals`
- `POST /v1/documents/{id}/deliveries`
- `GET /v1/deliveries/{id}/bundle`

Realtime transports MAY announce receipt IDs but are not authoritative.
Existing owner-signed create/edit calls are single-operation compatibility
batches. Existing signed music releases remain valid delivery artifacts.
Historical roots and signatures MUST NOT be rewritten.
