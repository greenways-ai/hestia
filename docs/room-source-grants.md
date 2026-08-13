# Hestia room sources and application grants

Status: canonical browser record and projection profile for Hestia issue #33.

Hestia rooms are private authority scopes. A reachable Greenways node or an
installed application does not become usable in a room merely because it can be
discovered. The room must first authorise a reviewed source, then grant an exact
member an operation subset through that source.

## Authority chain

```text
signed Hestia room and governance root
  -> active membership at the exact epoch
  -> signed room/source-mandate
  -> signed room/application-grant for that member and source
  -> exact operation, limits and validity
  -> portable Hestia allow/deny decision
  -> Greenways OS local app/capability checks and execution
```

Greenways OS separately decides whether exact code may run on the local
installation. A Hestia room grant cannot install software, expose provider
credentials or grant browser authority.

## Canonical records

All records use the existing HCV1/HCP1 codec and `GWAR0` signing domain.

### `room/source-mandate`

The mandate binds the exact room record and governance roots, issuing profile,
authority/delegation root, source and node identities, reviewed implementation,
exact application identity, operation set, membership epoch, policy revision,
interaction requirement and validity interval.

`requires_user_interaction` is source policy. For a ChatGPT web source it means
that visible prompt placement, Send and response return remain host-mediated. It
does not provide generic DOM, tab or account access.

### `room/application-grant`

The grant binds the exact member profile and optional node, the exact source
mandate root, the same exact application identity, an operation subset, bounded
request/input/output/timeout limits, the same epoch and policy revision, and a
validity interval contained by the source and membership authority.

### Revocation records

`room/source-mandate-revocation` and
`room/application-grant-revocation` target one exact canonical record root.
They also bind the room/governance roots, revoking profile, authority root,
bounded reason and canonical revocation time. A revocation for another room,
mandate or grant is not applicable.

## Portable projections

The package exposes:

```text
@greenways/hestia-browser/room-authority-records
@greenways/hestia-browser/room-authority-source-projections
```

Projection constructors verify signatures and canonical roots before producing
`hestia-room-source-mandate-projection/0-alpha` or
`hestia-room-application-grant-projection/0-alpha`. They preserve the exact
mandate and grant roots consumed by the existing room invocation decision.

The projections are bounded cache/routing inputs. Canonical Hestia records and
receipts remain the source of authority.

## Security laws

- Source advertisements and route availability are inert.
- Grant operations cannot broaden the source mandate.
- Room, governance, member, node, source, application, epoch and policy
  substitutions fail closed.
- Revocation is exact-root-bound.
- Unknown fields, duplicate or unsorted operations, invalid application
  identity, malformed limits and impossible validity intervals fail closed.
- Cookies, provider credentials, private keys, key-store handles, bearer tokens,
  arbitrary signing and generic DOM authority are absent from every record and
  projection.

PostgreSQL/Ignatius admission and governance-head transitions follow after
these canonical bytes and cross-runtime fixtures are stable.
