# Hestia

Hestia is a personal, local-first security and open-communications server. It
runs a real PostgreSQL ledger at home, links external identities to user-owned
keys, coordinates independent recovery authorities, relays authenticated
WebRTC ceremonies, and records signed work without becoming the owner of a
person's identity.

Greenways defines protocols and accredits independently operated authorities.
Hestia remains independently run and Greenways cannot recover a key alone.

## Distribution

One operator command manages a deliberately small internal stack:

- PostgreSQL with the canonical Greenways ledger and append-only Hestia events;
- Hoplite as the private application origin;
- Supabase Auth (GoTrue only) for GitHub OAuth and sessions;
- a blind WebRTC signalling relay;
- an optional TURN service selected by an operator.

Supabase Studio, PostgREST, Realtime, Storage, Edge Runtime and its gateway are
not included.

```sh
scripts/hestia init
scripts/hestia doctor
scripts/hestia up
scripts/hestia status
scripts/hestia backup
scripts/hestia down
```

See [docs/local-node.md](docs/local-node.md) and
[docs/recovery-protocol.md](docs/recovery-protocol.md).
