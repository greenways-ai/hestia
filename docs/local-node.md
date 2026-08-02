# Local Hestia node

Hestia requires Docker with the Compose plugin, OpenSSL and PostgreSQL client
tools. `scripts/hestia init` creates `.hestia/env` with local secrets at mode
0600. It never prints those secrets.

The server binds its development interfaces to loopback:

| Interface | Address |
| --- | --- |
| Hoplite origin | http://127.0.0.1:58080 |
| Recovery demo | http://127.0.0.1:58080/recovery/ |
| Supabase Auth | http://127.0.0.1:59999 |
| WebRTC signalling | ws://127.0.0.1:58443 |
| PostgreSQL | postgresql://127.0.0.1:55432/hestia |

The recovery demo and WebRTC signalling are exposed through the same Hoplite
origin at `/recovery/` and `/signal`. A Cloudflare Tunnel may publish that
origin without opening an inbound HTTP port. WebCrypto requires HTTPS on
non-loopback devices. The
tunnel token belongs in the operator's secret store, not this repository.

Backups contain private identity, authority and work records. The backup command
writes a PostgreSQL custom-format dump and SHA-256 checksum. Restore requires an
explicit `--confirm` and replaces local database state. Content-addressed
Studio assets and browser OPFS data require a separate export.

GoTrue is the only retained Supabase service. GitHub OAuth stays disabled until
the operator supplies a client ID and secret in `.hestia/env`.
