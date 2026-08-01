# Hestia local node

Hestia is a local-first service distribution. It reuses the open-source
Docker services composed by Supabase, but Supabase is not the product API or the
source of truth for Greenways.

The first distribution includes PostgreSQL 17, GoTrue auth, PostgREST,
Realtime/Phoenix, Storage, the API gateway, Edge Runtime and local mail capture.
Supabase Studio and vector storage are disabled: operators use the smaller
`scripts/hestia` interface and Greenways owns the public schema.

## Boundary

| Concern | Owner |
| --- | --- |
| User sessions, passkeys and OAuth | GoTrue/Supabase Auth |
| PostgreSQL, REST transport, realtime transport and object storage | pinned upstream containers |
| Provenance, authorisation, contracts and work receipts | Greenways ledger |
| Browser execution, SSS ceremonies and portable semantics | Hara kernel |
| Browser-facing database surface | `greenways_api` only |

`gw_ledger`, `auth`, `storage`, `realtime` and upstream administrative schemas
are not exposed through PostgREST. The initial public functions are
`node_info()` and the authenticated, read-only `ledger_head(network)`.
Application writes will be added as signed substrate actions, not generic table
CRUD.

## Operator interface

Requirements are Docker, PostgreSQL client tools and Supabase CLI `2.106.0`.
The version is pinned in `SUPABASE_CLI_VERSION` because that CLI resolves the
upstream container set and generated configuration.

```bash
scripts/hestia doctor
scripts/hestia up
scripts/hestia status
scripts/hestia client-env
scripts/hestia backup
scripts/hestia down
```

`status` prints only public service URLs. `client-env` additionally prints the
browser-safe publishable key; neither command emits the database password,
JWT secret, secret API key or service-role token.

The Supabase local-development launcher publishes its ports on all host
interfaces. This package is therefore a development node unless the host
firewall limits the 5632x ports. The production distribution must use an
explicitly bound Compose/Podman configuration and rotated secrets. Container
volumes survive `down`.

Backups are written beneath `backups/` as schema SQL plus
restorable `auth` and `gw_ledger` data SQL, with SHA-256 checksums. They contain
private identity and project information; copy them only to storage controlled
by the user. Storage objects and browser OPFS audio are content-addressed files,
not PostgreSQL data, and require a separate file backup/export workflow.

Restore is intentionally explicit:

```bash
scripts/hestia restore backups/<timestamp> --confirm
```

## Updating upstream services

Updating the CLI pin is an infrastructure migration. Review the Supabase
changelog, run a backup, update the pin and generated `config.toml`, then reset
and test a disposable node before touching user data. In particular, database
major versions and API-gateway swaps are not ordinary image bumps.

The initial ledger migration was generated from `gwdb-ledger/sql/full.sql` in
`greenways-ai/web-infra`. Once released, add migrations instead of rewriting
that imported history.
