# gw-fabric

`gw-fabric` is a Redis-like coordination service for Hara runtimes. Spaces
provide routing and authority boundaries; sessions isolate evaluator state;
namespaces expose content-addressed Wasm extensions; reports provide bounded
session-to-session messaging with optional SQLite retention.

The service exposes RESP4 commands for spaces, sessions, evaluation, modules,
reports, metrics, events, and topology. Analytics deliberately contain
metadata and counters rather than report payloads.

```sh
cargo build --manifest-path gw-fabric/Cargo.toml --release
cargo test --manifest-path gw-fabric/Cargo.toml
cargo run --manifest-path gw-fabric/Cargo.toml --bin gw-fabric -- \
  --data target/fabric --shards 4
npm test --prefix gw-fabric/web
```

Extracted from `hara-lang/hara` at `a190f7df995f51a60fad7348ac1feafaf53468e3`.
