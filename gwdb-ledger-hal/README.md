# Portable Ledger HAL

This module owns deterministic, host-independent ledger semantics intended to
run in the browser, CLI, and server runtimes. PostgreSQL remains the durable
multi-writer adapter.

The module specifies document and transaction framing, operation payloads,
offline outbox transitions, and a bounded deterministic local evaluator.
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

Extracted from `greenways-ai/v2` at
`045660a34b46556fe10e7cab783e4a34756f83bd`.
