# Document ledger security properties

The document collaboration path is designed around five invariants.

1. **Contributor intent is signed.** A contributor signs an exact HCV1 batch
   root with a currently delegated `document.edit` operational key.
2. **Transformation is accountable.** The active Hestia environment signs the
   exact current head, transformed operation vector, result AST and outcome.
3. **Receipts are database-planned.** The environment signer receives only the
   `GWDP1` bytes returned by `document_batch_prepare`; it never signs a receipt
   supplied by a browser or reconstructed from JSON.
4. **Commit is compare-and-swap.** The commit function locks and rechecks the
   document head, profile state, operational key, delegation and both verified
   records before changing any projection.
5. **History is append-only.** Revisions and operation identities cannot be
   updated or deleted by the application role. Only the head pointer is mutable,
   and only through the security-definer admission functions.

JSON AST and operation documents are caches for rendering and OT execution.
Their HCV1 roots and signed records are authoritative. A backup or replica may
rebuild the caches by replaying the canonical operation roots.

Conflict receipts are durable evidence of attempted work but do not create a
revision. Rejected or conflicted text need not be disclosed in a public receipt;
a private authorized view may retain the diagnostic projection.
