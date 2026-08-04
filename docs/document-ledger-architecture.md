# Signed document OT through the Hara ledger

Hestia treats collaborative document editing as a signed state transition, not
as an unsigned websocket stream.

## Admission path

1. A contributor creates individually rooted HCV1 operations and signs one
   bounded `document/batch` with a delegated `document.edit` key.
2. Hestia imports the HCP1 pack into `gw_ledger` and verifies the `GWDP1`
   Ed25519 signature in PostgreSQL.
3. The environment reads the authoritative document head and all accepted
   operations after the contributor's base revision.
4. `gw.ledger.document-ot` defines the normative transformation. The JavaScript
   adapter executes the same rules for the gateway and is covered by conformance
   tests.
5. Hestia signs `document/transformation`, binding the exact current head,
   transformed operation vector, result AST and accepted/conflict outcome.
6. PostgreSQL verifies both records, delegated authority and the current head,
   then constructs `document/revision` and `document/import-receipt` HCV1 roots.
7. The database returns only the exact receipt signing bytes. The environment
   key signs those bytes outside PostgreSQL.
8. The commit function rechecks the head, profile, delegation and signatures,
   then atomically appends the revision and operation projections. A conflict
   receives a signed receipt but does not advance the head.

## Canonical and projected data

Canonical:

- HCV1 operation records;
- contributor batch record and signature;
- environment transformation record and signature;
- revision root and result AST root;
- import receipt and environment signature; and
- document head revision/root pointer.

Projected, non-canonical:

- JSON AST used by the browser renderer;
- JSON operations used by the gateway OT adapter; and
- concise conflict diagnostics.

A projected value is trusted only when its independently reconstructed HCV1 root
matches the signed record that references it.

## Signing domains

Document records use:

```text
GWDP1 NUL <record kind UTF-8> NUL <raw 32-byte body root>
```

Agent profiles, rooms and mandates continue using `GWAR1`. The domains are not
interchangeable.

## Hara artefacts

An embedded Hara artefact is ordinary document structure plus a source text
node. Source edits use `text.splice`. A result becomes durable only through
`artefact.commit`, which binds source and result roots. OT rejects a commit when
accepted work changed the source or deleted the artefact after the contributor's
base revision.

## HTTP surface

The first write endpoint is:

```text
POST /agent/v1/documents/imports
```

It accepts a signed batch bundle and returns an environment-signed accepted or
conflict receipt. Realtime channels may announce the receipt but are not the
source of truth.
