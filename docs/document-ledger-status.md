# Document ledger implementation status

Implemented in this change:

- canonical HCV1 document operation, batch, transformation, revision and receipt
  schemas;
- independent GWDP1 Ed25519 signing and PostgreSQL verification;
- signed contributor batches and environment transformation records;
- Hara-ledger OT rules for text, structural operations and embedded artefacts;
- two-stage PostgreSQL prepare/sign/commit admission;
- compare-and-swap document heads and append-only revisions;
- accepted operation projections for later stale-batch transformation;
- signed conflict receipts that do not advance the head;
- browser and HTTP clients; and
- unit, contract and migration-application checks.

Still subsequent:

- sync/read endpoints and pagination;
- personal disclosure branch import;
- comments, suggestions and approvals UI;
- attachment storage and delivery bundles;
- cross-runtime conformance fixtures beyond the current JavaScript/Hara
  contract checks; and
- multi-environment document handoff.
