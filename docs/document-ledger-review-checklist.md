# Document ledger review checklist

- [ ] Contributor batches verify under `GWDP1`, never `GWAR1`.
- [ ] Every operation has an HCV1 root before it enters a batch vector.
- [ ] The signed batch binds base revision, base AST, expected result, profile and delegation.
- [ ] OT maps the batch through all accepted operations after its base.
- [ ] Embedded Hara artefact commits conflict after source edits or deletion.
- [ ] The environment transformation binds the exact current head and transformed operations.
- [ ] PostgreSQL constructs revision and receipt roots from ledger cells.
- [ ] The environment signer signs only bytes returned by the prepare function.
- [ ] Commit rechecks document head, profile, operational key and delegation.
- [ ] Accepted revisions and operation identities are append-only.
- [ ] Conflicts receive signed receipts and do not advance the head.
- [ ] JSON projections can be discarded and rebuilt from canonical roots.
