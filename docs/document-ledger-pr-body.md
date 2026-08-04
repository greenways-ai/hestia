## Summary

- Route document OT through the portable `gw.ledger.document-ot` Hara policy.
- Give every edit an HCV1 root and sign contributor batches in the independent `GWDP1` domain.
- Sign an environment transformation over the exact current head, transformed operations, result AST and conflict outcome.
- Let PostgreSQL construct revision and receipt roots, return exact signing bytes, then recheck and commit atomically.
- Treat JSON AST/operation values as replay projections; `gw_ledger` roots remain authoritative.
- Invalidate embedded Hara artefact commits after source edits, deletion or competing results.
- Add the document gateway endpoint, browser client, architecture/security docs and focused tests.

## Validation

The PR runs browser document tests, gateway document tests, all existing Hestia checks and a PostgreSQL migration-application gate.
