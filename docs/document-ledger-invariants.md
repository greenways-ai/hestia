# Document ledger invariants

- Contributor intent is an Ed25519-signed `document/batch` HCV1 root.
- Every operation has an independent canonical root.
- OT is defined by `gw.ledger.document-ot` and projected by the gateway adapter.
- Embedded Hara artefact results cannot be committed after their source changed.
- The environment signs the exact current-head transformation.
- PostgreSQL constructs revision and receipt roots before requesting a signature.
- Commit is atomic and compare-and-swap against head and delegated authority.
- Conflicts are signed but never advance the document head.
- JSON AST and operation values are caches; HCV1 roots are authoritative.
