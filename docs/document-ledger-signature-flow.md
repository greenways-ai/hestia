# Document signature flow

```text
Contributor key
  signs document/batch
        ↓
Hara OT + current gw_ledger head
        ↓
Hestia environment key
  signs document/transformation
        ↓
PostgreSQL prepare
  constructs document/revision + document/import-receipt
        ↓
Hestia environment key
  signs exact database-returned receipt bytes
        ↓
PostgreSQL commit
  rechecks head and authority, appends atomically
```

All three signatures use the document-specific GWDP1 domain. Agent-room records
remain in GWAR1.
