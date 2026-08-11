# Portable Ledger HAL

This module owns deterministic, host-independent ledger semantics intended to
run in the browser, CLI, and server runtimes. PostgreSQL remains the durable
multi-writer adapter.

The module specifies document and transaction framing, operation payloads,
offline outbox transitions, bounded deterministic evaluation, and native HCV0
records for Hestia agent profiles, key delegations, rooms, invitations,
membership, private message intents, document attachments, negotiation, and
admission receipts.

Agent-room records use the stable HCV0 record tag (`14`). Each record kind has a
normative field order and every field is another HCV0 root. Optional values use
the canonical nil root, so authoritative payloads never depend on JSON
serialization or ambiguous host formatting. `GWAR0` signing payloads bind a
record kind to its body root; host capabilities own SHA-256 and Ed25519.

SHA-256, Ed25519, IndexedDB, and HTTP are explicit host capabilities; the
browser adapter uses WebCrypto and IndexedDB.

With a sibling Hara checkout, validate, test, and package this project from the
repository root:

```bash
make ledger-hal-check
make ledger-hal-test
make ledger-hal-package
```

The package is written beneath `target/packages/`. HAL packaging produces a
portable `.harp` archive; it does not compile to a native executable.

Extracted from `greenways-ai/0-alpha` at
`045660a34b46556fe10e7cab783e4a34756f83bd`.
