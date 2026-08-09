# Ignatius and Hestia boundaries

Status: proposed 0.2.0

This document replaces the earlier attempt to divide Hestia into several peer
technologies. The simpler and more useful boundary is:

> **Ignatius is the authoritative PostgreSQL blockchain and its HAL client.**
> **Hestia is an application suite built on Ignatius plus ordinary application
> database projections.**

Documents, private rooms, agent authority, continuity, negotiation and receipt
presentation are Hestia application modules. They use a blockchain, but they do
not define the blockchain.

## 1. The two layers

Hestia should deliberately use two kinds of state.

### 1.1 Ignatius chain state

Ignatius stores canonical, signed and replayable facts:

- HCV1 values and roots;
- HCP1 packs;
- accounts, controller keys and delegations understood by the chain;
- operations, transactions, receipts, blocks, states and snapshots;
- deterministic Hara execution and cost accounting;
- append-only canonical records; and
- the exact roots required to replay or verify a result.

Chain state is the source of truth for anything that must be independently
verified, signed, replayed or presented as evidence.

### 1.2 Hestia application database

Hestia stores application-facing projections and operational state:

- searchable agent and profile views;
- room indexes, membership views and inbox state;
- document heads, search indexes and collaboration cursors;
- notification, delivery and retry state;
- encrypted object references;
- product accounts, preferences and UI state; and
- query models optimized for the Hestia applications.

Application tables are not a second source of canonical truth. A projection may
be repaired or rebuilt from Ignatius records and receipts. Hestia must not sign
a JSON projection as though it were the canonical record.

This gives Hestia the practical behavior of a normal PostgreSQL application
without losing the verifiable chain beneath formal actions.

## 2. Ignatius ownership

Ignatius owns the generic technology needed to construct, run and consume the
chain.

### 2.1 Canonical model

Ignatius owns:

- canonical value encoding and content addressing;
- pack framing and import;
- cell and reference schemas;
- Hara operation and transaction models;
- deterministic execution;
- blocks, state roots, transaction links and receipts;
- snapshots, replay and integrity checking; and
- generic signing payloads and controller admission.

No Ignatius namespace may import a Hestia agent, room, document, recovery,
negotiation or product namespace.

### 2.2 PostgreSQL chain

Ignatius owns the PostgreSQL implementation of the chain:

- generated chain schema;
- canonical cell storage;
- transaction and block commit functions;
- signature verification required by generic chain admission;
- projections intrinsic to the chain itself;
- snapshot import and export; and
- chain repair and verification functions.

PostgreSQL is the authoritative Ignatius chain. The same canonical fixtures
must be executable by the portable Hara implementation, but portable execution
is a client-side evaluator and conformance oracle rather than a replacement for
transaction ordering and block commitment in `gw_ledger`.

### 2.3 Portable HAL client and workflow manager

Ignatius owns generic HAL code for transaction preparation, local evaluation,
signing, submission, synchronization, receipt verification and workflow
management. Its local evaluation side owns:

- canonical transaction validation;
- deterministic execution and result planning;
- generic admission envelopes;
- receipt construction plans;
- synchronization and replay semantics; and
- explicit host capability calls for hashing, signatures and persistence.

The client side owns:

- canonical record and transaction construction;
- signing-payload construction;
- offline outbox state;
- submission and idempotency state;
- receipt validation;
- synchronization cursors; and
- replay of accepted chain records.

The client must be usable from a browser, CLI, Hoplite application or another
Hara runtime without importing Hestia.

### 2.4 Client contracts and adapters

Ignatius also owns:

- generated TypeScript or other host contracts for the chain API;
- browser and CLI chain clients;
- IndexedDB or filesystem outbox adapters;
- the direct `postgres.core` host contract; and
- cryptographic extensions that exist to implement chain primitives.

Host clients are projections of the HAL contract. Their conformance fixtures
must agree with the portable implementation.

### 2.5 Proposed Ignatius public namespaces

The first stable surface should remain small:

```clojure
ignatius.core/network
ignatius.core/protocol
ignatius.core/conform

ignatius.transaction/build
ignatius.transaction/signing-payload
ignatius.transaction/verify

ignatius.client/postgres
ignatius.client/open
ignatius.client/queue
ignatius.client/submit
ignatius.client/sync
ignatius.client/receipt

postgres.core/ignatius-submit
postgres.core/ignatius-head
postgres.core/ignatius-receipt
```

Host integrations should live below explicit implementation namespaces such as:

```text
ignatius.postgres.*
ignatius.adapter.browser.*
ignatius.internal.*
```

## 3. Hestia ownership

Hestia owns the applications and their domain protocols.

### 3.1 Agent authority

Hestia owns:

- human and agent profiles;
- root, operational, room, document and runtime-instance keys;
- agent mandates;
- purpose- and scope-bounded delegation;
- rotation and revocation policy;
- exact-root human approvals; and
- Hestia-specific authority facts supplied to application kernels.

Ignatius verifies generic chain signatures and transaction authority. Hestia
interprets those accepted facts as application authority for agents and people.

### 3.2 Private rooms

Hestia owns:

- room versions and policies;
- invitations and single-use capabilities;
- membership epochs;
- encrypted message intents and delivery receipts;
- formal offers, counters and acceptances;
- room closure and revocation; and
- the room HAL state machine.

Room transitions are submitted as Ignatius transactions and indexed into
Hestia room projections.

### 3.3 Documents

Hestia owns:

- document and rich-text schemas;
- document operations and OT rules;
- personal logs and disclosure branches;
- transformations and conflicts;
- revisions and document heads;
- document approvals, provenance and deliveries; and
- document-specific signing domains such as `GWDP1`.

The portable document policy remains HAL, but it is a Hestia package depending
on Ignatius. It is not part of the generic chain client.

### 3.4 Continuity

Hestia owns:

- recovery policies;
- steward and keeper ceremonies;
- threshold reconstruction workflows;
- recovery receipts; and
- recovery application experiences.

Continuity uses Ignatius to record formal ceremony facts. It is not intrinsic to
every Ignatius network.

### 3.5 Hestia application composition

Hestia should expose an application constructor rather than another blockchain
constructor:

```clojure
(ns example.office
  (:require [hestia.core :as h]
            [hestia.authority :as authority]
            [hestia.rooms :as rooms]
            [hestia.documents :as documents]
            [ignatius.core :as ignatius]))

(def app
  (h/app
    {:id "example-office"
     :chain (ignatius/network {:protocol "ignatius/1"})
     :modules
     [(authority/module)
      (rooms/module)
      (documents/module)]}))
```

`hestia.core/app` describes the application, installed domain modules,
Ignatius network requirement and projection plan. It does not own database
credentials, private keys, sockets or runtime handles.

## 4. Dependency direction

Dependencies point in one direction:

```text
Hara runtime and host capabilities
                |
                v
        Ignatius chain + client
                |
                v
       Hestia domain modules
  authority / rooms / documents / continuity
                |
                v
 Hestia PostgreSQL projections and services
                |
                v
     Hestia product applications
```

The corresponding rules are:

1. Ignatius imports no Hestia namespace.
2. Hestia canonical records and policies may import Ignatius public HAL APIs.
3. Hestia application services submit through Ignatius; they do not write
   directly to canonical chain tables.
4. Hestia projections may refer to Ignatius roots and receipt identities.
5. Ignatius never depends on Hestia projections.
6. Browser and CLI applications consume public packages rather than copied
   source files.
7. Application transport, UI and hosted services may change without changing
   Ignatius canonical bytes.

## 5. Current source movement

### 5.1 Move to Ignatius as complete components

The following components are generic chain technology and should leave Hestia:

| Current Hestia path | Initial Ignatius destination | Reason |
|---|---|---|
| `gwdb-ledger/` | `db/` | PostgreSQL chain DSL, generated SQL and chain contracts |
| `web-components/gw-ledger-sha/` | `extensions/sha/` | Chain hashing extension |
| `web-components/gw-ledger-noir/` | `extensions/noir/` | Chain proof extension |
| `migrations/20260801112956_ledger_schema.sql` | generated Ignatius SQL artefact | Generic chain migration |

Hestia must consume a pinned Ignatius SQL/package artefact rather than retaining
another generated copy of the chain schema.

### 5.2 Split `gwdb-ledger-hal`

The current package mixes generic chain code with Hestia applications.

Move and rename these generic modules:

| Current module | Ignatius module |
|---|---|
| `gw.ledger.codec` | `ignatius.codec` |
| `gw.ledger.runtime` | `ignatius.runtime` |
| `gw.ledger.transaction` | `ignatius.transaction` |
| `gw.ledger.offline` | `ignatius.client.outbox` |

Keep and rename these Hestia modules:

| Current module | Hestia module |
|---|---|
| `gw.ledger.agent-room` | split into `hestia.authority` and `hestia.rooms` |
| `gw.ledger.document-ot` | `hestia.documents.ot` |
| `gw.ledger.document-protocol` | `hestia.documents.protocol` |

The old `gw.ledger.*` names may remain as one-release compatibility aliases,
but new code must use the owning repository's namespace.

### 5.3 Split the browser package

The current `@greenways/hestia-browser` package exports generic chain support
beside Hestia application modules. Split it into:

```text
@greenways/ignatius-client
  canonical encoding
  transaction construction
  chain signing payloads
  outbox and receipt state
  postgres.core call descriptors and receipt verification

@greenways/hestia-client
  agent authority records
  rooms and invitations
  documents and collaboration
  continuity
  Hestia application storage
```

Hestia client packages depend on `@greenways/ignatius-client`. They must not
copy its canonical encoding or transaction code.

### 5.4 Reduce the gateway to Hestia application concerns

The current gateway must not become an Ignatius HTTP node. Generic chain calls
move behind the Ignatius HAL client and the direct `postgres.core` capability:

- bounded canonical pack import;
- generic signed transaction submission;
- chain receipt lookup and verification;
- head, state and snapshot synchronization; and
- chain schema/protocol compatibility checks.

Hestia application layer:

- supported Hestia record kinds;
- agent and room proof validation;
- document transformation orchestration;
- Hestia environment policy;
- application receipt presentation; and
- Hestia-specific HTTP resources.

The Hestia controller calls the stable Ignatius-generated `postgres.core`
surface. It does not import internal `gwdb.ledger.*` functions, carry database
credentials in HAL values, or communicate through an intermediate HTTP node.

### 5.5 Keep in Hestia

These are application or product code and remain in this repository:

- Hestia-specific migrations after the generic ledger migration;
- agent profile, room and activity admission;
- document OT and document import migrations;
- recovery migrations and ceremonies;
- `protocol/document-ot.js` until replaced by a conforming Hestia adapter;
- room, document and recovery browser experiences;
- Hestia site and product assets;
- Hestia signalling and optional mailbox services; and
- `scripts/hestia`, after it is changed to install or start a pinned Ignatius
  node rather than build a vendored chain.

`gw-fabric` is neither Hestia application code nor the Ignatius chain. It should
remain independently versioned and move to its own repository separately.

## 6. API boundary

### 6.1 Ignatius PostgreSQL capability

Ignatius exposes generic chain operations, not Hestia resource names, through
the `postgres.core` capability:

| Operation | Purpose |
|---|---|
| `ignatius/network-bootstrap` | Network identity, versions and limits |
| `ignatius/head` | Current canonical head |
| `ignatius/account-register` | Register an account/controller |
| `ignatius/account-sequence` | Read the next accepted sequence |
| `ignatius/pack-import` | Import a bounded HCP1 pack |
| `ignatius/submit` | Atomically verify, execute and commit one signed transaction |
| `ignatius/transaction-receipt` | Read a transaction receipt |
| `ignatius/block-receipt` | Read block commitment evidence |
| `ignatius/state-sync` | Synchronize canonical state or snapshots |
| `ignatius/integrity-check` | Verify roots and rebuildable projections |

Database handles and credentials remain inside the host capability. HAL values
contain only explicit generic calls and results.

### 6.2 Hestia application API

Hestia exposes application resources:

```text
/v1/agents/...
/v1/rooms/...
/v1/documents/...
/v1/continuity/...
/v1/receipts/presentations
```

Every formal write constructs a Hestia canonical record, submits it through
Ignatius and returns an Ignatius transaction receipt plus any Hestia application
receipt. Query routes normally read Hestia projections.

### 6.3 Write flow

```text
Hestia command
  -> construct Hestia canonical record
  -> construct, locally evaluate and sign Ignatius transaction
  -> call postgres.core ignatius/submit
  -> gw_ledger validates, executes and commits one block
  -> verify transaction, result, state, block and receipt roots
  -> Hestia projections update
  -> application response is rendered
```

Hestia reducers are published as ordinary operation packs. The general
submission call atomically imports the pack, validates manifests, verifies the
signature and sequence, executes the operation, advances the block and returns
the canonical receipt. External effects such as message delivery remain outbox
operations acknowledged by later transactions.

## 7. Database installation model

Hestia should install Ignatius as a versioned dependency.

A Hestia database build becomes:

```text
1. install pinned Ignatius PostgreSQL artefact
2. verify Ignatius schema and protocol version
3. install Hestia authority projections
4. install Hestia rooms projections
5. install Hestia documents projections
6. install optional continuity projections
7. register Hestia policy and module roots
```

Hestia migrations must not contain a copied `gw_ledger` schema once the
Ignatius package is available. CI should fail if Hestia modifies an
`ignatius_*` or retained compatibility `gw_ledger` object directly.

Application projections should retain enough canonical roots to prove what they
represent and to rebuild them from Ignatius history.

## 8. Repository extraction sequence

### Stage 0 — create the repository

Create `greenways-ai/ignatius` with Apache-2.0 licensing and protected `main`.
Do not initialize it with unrelated generated files if history-preserving
extraction will be used.

### Stage 1 — freeze conformance fixtures

Before moving code, freeze fixtures for:

- HCV1 bytes and roots;
- HCP1 packs;
- signing payloads;
- accepted and rejected transactions;
- receipts and block roots;
- snapshot round trips;
- offline outbox transitions; and
- PostgreSQL versus portable HAL execution parity.

These fixtures are the migration contract.

### Stage 2 — extract complete generic components

Move `gwdb-ledger/` and the chain extensions with history. Publish the first
Ignatius PostgreSQL artefact without changing canonical behavior.

### Stage 3 — split portable HAL

Move generic HAL modules to Ignatius. Keep compatibility aliases in Hestia long
enough to migrate application namespaces. Run the same fixtures in both
repositories.

### Stage 4 — publish Ignatius client packages

Publish the HAL package, generated host contracts and browser/CLI chain client.
Hestia pins exact versions or immutable commit/package roots.

### Stage 5 — switch Hestia to the dependency

Change Hestia to:

- install Ignatius rather than build `gwdb-ledger/`;
- import Ignatius HAL packages;
- depend on the Ignatius browser client;
- call the Ignatius `postgres.core` interface directly; and
- retain only Hestia migrations and policies.

### Stage 6 — remove compatibility copies

After parity tests pass, remove vendored ledger sources, generic HAL aliases and
the copied generic migration from Hestia.

## 9. Release and compatibility rules

Ignatius versions canonical behavior. A major Ignatius version is required for
changes to:

- HCV1 or HCP1 bytes;
- signing domains or payload bytes;
- transaction interpretation;
- state, block or receipt commitments;
- deterministic execution results; or
- previously published rejection/acceptance behavior.

Hestia versions application behavior. A major Hestia module version is required
for changes to:

- agent, room, document or recovery canonical schemas;
- Hestia signing domains;
- policy transition semantics;
- application receipt commitments; or
- authority interpretation.

A new Hestia release may use a newer compatible Ignatius implementation without
changing Hestia canonical records. The exact Ignatius protocol and package root
used for an accepted transition must remain discoverable from receipts or
network metadata.

## 10. Acceptance criteria

The extraction is complete when:

1. Ignatius builds, tests and publishes without Hestia source code.
2. A browser or CLI can construct, sign, queue, submit and verify a generic
   Ignatius transaction without importing Hestia.
3. Hestia contains no generic chain schema generator or copied chain SQL.
4. Hestia HAL modules import Ignatius public packages.
5. Hestia application services do not call Ignatius internal PostgreSQL
   functions directly.
6. PostgreSQL and portable HAL agree on frozen canonical fixtures.
7. Hestia projections can be rebuilt from Ignatius records and receipts.
8. Documents, rooms and continuity can be released independently of Ignatius.
9. No Ignatius package imports a Hestia namespace.
10. The Hestia operator flow installs a pinned Ignatius release and then starts
    the Hestia application stack.

## 11. Immediate implementation slice

The first implementation PRs after this decision should be:

1. create `greenways-ai/ignatius`;
2. extract `gwdb-ledger/` with history;
3. move the SHA and Noir chain extensions;
4. freeze and copy canonical conformance fixtures;
5. split `gwdb-ledger-hal` into generic Ignatius and application Hestia
   packages; and
6. make Hestia install a pinned Ignatius SQL artefact while temporarily keeping
   the existing route compatibility layer.

This locks the useful product boundary: Ignatius can evolve as a chain and
client platform, while Hestia can evolve as a private agent, rooms, document and
continuity application without redefining the chain each time.
