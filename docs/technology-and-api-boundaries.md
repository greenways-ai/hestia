# Hestia technology and API boundaries

Status: proposed 0.1.0

This document separates the reusable technologies currently collected in the
Hestia repository from the Hestia private-office application. It also defines
the API boundary that should be stabilised before further product work.

The central decision is:

> Hestia is a product assembled from independently versioned protocol,
> authority, policy, evidence, node, and application modules. PostgreSQL,
> browsers, Hoplite, WebRTC, and the Hestia website are implementations or
> compositions of those contracts; none of them defines the contracts.

This is the same direction used by Hoplite: a small public construction API,
immutable data descriptions, explicit host capabilities, and implementation
namespaces kept out of the public contract.

## 1. What is currently in this repository

The present tree contains several distinct systems:

- `gwdb-ledger/` is a standalone Hara-compatible, content-addressed ledger and
  deterministic operation runtime implemented for PostgreSQL.
- `gwdb-ledger-hal/` contains both generic portable ledger semantics and
  Hestia-specific agent-room and document policies.
- `migrations/` contains the generic ledger, Hestia authority admission,
  agent-room admission, document OT, and application projections in one ordered
  database chain.
- `services/agent-gateway/` combines HTTP parsing, environment signing,
  canonical admission, PostgreSQL adapters, agent records, and document imports.
- `browser/` publishes one package containing generic HCV1 support, keys,
  recovery, transport, agent rooms, documents, kernels, storage, and product
  experiences.
- `gw-fabric/` is a Hara runtime coordination service with its own RESP4
  protocol and lifecycle.
- `services/signaling/`, `site/`, `web-components/`, `browser/demo/`,
  `browser/rooms/`, and `browser/documents/` are applications, transports, or
  presentation surfaces.

These components can remain in one repository while the interfaces are being
stabilised. Repository extraction should happen only after package dependency
rules and conformance tests make the boundaries real.

## 2. Technology map

### 2.1 Hara Ledger

**Purpose:** a deterministic, content-addressed Hara state and transaction
ledger with PostgreSQL as a durable multi-writer adapter.

**Owns:**

- HCV1 canonical values and content roots;
- HCP1 canonical packs;
- cells and child references;
- Hara operation, function, module, iterator, transaction, block, state, and
  snapshot models;
- deterministic execution and cost accounting;
- controller-key transaction admission;
- generic verification, replay, integrity, and projection rebuilding; and
- PostgreSQL schema generation for those generic concepts.

**Does not own:** agents, mandates, rooms, invitations, negotiation, document
workflow, recovery ceremonies, environment policy, product accounts, UI, or
HTTP resources.

**Current sources:** the generic portion of `gwdb-ledger/`, plus
`gwdb-ledger-hal/src/gw/ledger/{codec,runtime,transaction,offline}.hal`.

**Target contract name:** `hara-ledger/1`.

This is a technology in its own right. Hestia depends on it, but Hestia should
not redefine it.

### 2.2 Hestia Authority

**Purpose:** owner-controlled identity and authority for humans, agents, and
runtime instances.

**Owns:**

- principal, agent, environment, operational, room, document, and runtime keys;
- agent profiles and profile versions;
- delegation, scope, purpose, validity, rotation, and revocation;
- mandates and bounded authority;
- exact-root human approvals;
- authorization facts supplied to policy kernels; and
- the rule that private keys never enter the ledger or admission service.

**Does not own:** room collaboration flow, document OT, recovery UX, HTTP,
PostgreSQL functions, WebCrypto, IndexedDB, WebRTC, or the product website.

**Current sources:** the profile and key portions of
`gwdb-ledger-hal/src/gw/ledger/agent_room.hal`, the corresponding browser
record builders, and the profile/delegation verification and admission
migrations.

**Target contract name:** `hestia-authority/1`.

Authority should be usable without the Hestia private-office UI. A local CLI,
browser application, Hoplite service, or another Hara application should be
able to create the same canonical profile and delegation records and obtain the
same authorization result.

### 2.3 Hestia Policy

**Purpose:** deterministic HAL state transitions driven by canonical events and
explicitly verified authority facts.

**Owns:**

- the pure transition interface;
- policy and kernel roots;
- deterministic state validation;
- effect-plan construction;
- capability declarations; and
- serial transition ordering.

**Does not own:** sockets, private keys, arbitrary SQL, arbitrary HTTP, clocks,
randomness, transport delivery, or effect execution.

**Current sources:** the generic transition concepts in `gwdb-ledger-hal`, the
agent-room kernel, and policy-specific Hara modules.

**Target contract name:** `hestia-policy/1`.

A policy evaluation has one stable shape:

```clojure
(transition
  {:previous-state-root "..."
   :event-root "..."
   :policy-root "..."
   :kernel-root "..."
   :authority-facts [...]})
;; =>
{:outcome :accepted
 :result-state-root "..."
 :effect-plan-root "..."
 :effects [...]}
```

The map is an inspectable projection. Canonical input and output roots remain
HCV1 values. Every production adapter must agree on the canonical result.

### 2.4 Hestia Evidence

**Purpose:** durable, signed evidence of verification, admission, approval,
execution, delivery, and selective presentation.

**Owns:**

- verification receipts;
- admission receipts;
- effect and delivery receipts;
- approval receipts;
- provenance links;
- disclosure manifests and bounded presentations; and
- receipt verification rules.

**Does not own:** the policy decision being evidenced, the transport used to
return a receipt, the database projection used to find it, or the UI used to
present it.

**Current sources:** `ledger/verification-receipt`,
`ledger/admission-receipt`, document receipts, room activity receipts, and the
receipt-related database functions and browser helpers.

**Target contract name:** `hestia-evidence/1`.

Separating evidence from authority matters because the same authority decision
may be presented differently to an owner, a client, an auditor, or another
agent. The receipt is canonical; a presentation is a deliberately bounded view
of one or more receipts.

### 2.5 Hestia Node

**Purpose:** a deployable implementation that composes ledger, authority,
policy, evidence, storage, and signing capabilities.

**Owns:**

- the environment signer lifecycle;
- PostgreSQL transactions and projections;
- migration assembly;
- bounded pack import;
- prepare/sign/commit orchestration;
- HTTP and local operator adapters;
- health and environment discovery; and
- backup/restore of node-specific key material.

**Does not own:** canonical record schemas, signing domains, policy semantics,
application workflows, or client presentation.

**Current sources:** `services/agent-gateway/`, the Hestia-specific migration
assembly, `scripts/hestia`, and the relevant Compose services.

**Target contract name:** `hestia-node/1` for the service capability contract;
HTTP is versioned separately as `hestia-http/1`.

The current `hestia-agent-http/1` service is therefore an early Hestia Node
adapter, not the definition of Hestia Authority.

## 3. Modules built on the technologies

The following are versioned modules, not Hestia Core itself.

### 3.1 Private rooms

`hestia-rooms/1` owns room versions, invitations, membership epochs, private
message intents, negotiation, room closure, and their HAL state machine. It
uses Hestia Authority for delegation, Hestia Policy for transitions, and Hestia
Evidence for receipts.

### 3.2 Greenways documents

`greenways-document/1` owns document operations, OT, revision history,
transformation records, document approvals, provenance, and delivery. The
existing `GWDP1` signing domain is correctly distinct from `GWAR1` and should
remain a separately versioned protocol.

Document routes must not live under `/agent/v1`. Documents use Hestia authority
and evidence, but they are not agent admission.

### 3.3 Continuity

`hestia-continuity/1` owns threshold recovery policy, steward ceremonies,
recovery envelopes, and recovery receipts. Recovery is a module over root-key
authority, not a table in the generic ledger and not a property of every Hestia
installation.

### 3.4 Hara Fabric

`gw-fabric` is a separate Hara coordination technology. It may be installed as
a Hestia capability adapter, but Hestia must not depend on its RESP4 protocol,
session model, or topology. It should be separately packaged and eventually
moved to its own repository.

### 3.5 Product and hosted services

The Private Agent Office, document room, recovery experience, site, web
components, signaling relay, optional mailbox, and concierge services are
applications or hosted services. They may move quickly without changing the
canonical protocols.

## 4. Dependency rule

Dependencies point inward:

```text
Hara Ledger
    ^
    |
Hestia Authority ----> Hestia Evidence
    ^                      ^
    |                      |
Hestia Policy -------------+
    ^
    |
Hestia modules: rooms, documents, continuity
    ^
    |
Hestia Node adapters: PostgreSQL, HTTP, Hoplite, browser, CLI
    ^
    |
Hestia applications and hosted services
```

More precisely:

- Hara Ledger imports no Hestia namespace.
- Authority may use HCV1/HCP1 but imports no room, document, recovery, HTTP, or
  PostgreSQL implementation namespace.
- Policy imports canonical authority and evidence schemas, not adapters.
- Evidence imports canonical identifiers and roots, not product views.
- A module may depend on core contracts but no core contract depends on a
  module.
- Node adapters depend on contracts; contracts never depend on a node adapter.
- Applications depend on public module APIs; applications do not call database
  prepare/commit functions directly.

These rules should be enforced in tests and package metadata before code is
moved to separate repositories.

## 5. Public Hara construction API

Hestia should expose one small construction surface analogous to
`hoplite.core/app`.

```clojure
(ns example.office
  (:require [hestia.core :as h]
            [hestia.rooms :as rooms]
            [greenways.document :as document]))

(def office
  (h/office
    {:id "example-office"
     :protocol "hestia/1"
     :modules
     [(rooms/module {:policy #'example.room/policy})
      (document/module {:policy #'example.document/policy})]}))
```

The initial public namespace should be deliberately small:

- `hestia.core/office` validates and returns an immutable office description;
- `hestia.core/module` validates a module descriptor;
- `hestia.core/protocol` returns the supported core protocol identity;
- `hestia.core/conform` validates an office or module without starting a node.

Module constructors live in their own public namespaces. Storage, migration,
signing, gateway, and deployment code lives under implementation namespaces
such as `hestia.node.*`, `hestia.adapter.*`, or `hestia.internal.*` and is not a
public application API.

An office description selects protocols and modules. It does not contain
private keys, database credentials, sockets, or mutable runtime handles.

## 6. Canonical admission API

The stable node boundary is canonical record admission, not a collection of
JavaScript service methods or direct PostgreSQL functions.

### 6.1 Core HTTP resources

The first stable `hestia-http/1` surface should contain only:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/health` | Process and dependency health |
| `GET` | `/v1/environment` | Environment identity, public key, protocols, modules, and limits |
| `POST` | `/v1/admissions` | Verify and admit one canonical signed record |
| `GET` | `/v1/receipts/{root}` | Read an authorized canonical receipt projection |
| `POST` | `/v1/receipts/presentations` | Create a bounded receipt presentation |

Module query and convenience APIs are separately versioned:

- `/v1/agents/...` and `/v1/authority/...` for Hestia Authority projections;
- `/v1/rooms/...` for `hestia-rooms/1`;
- `/v1/documents/...` for `greenways-document/1`; and
- `/v1/continuity/...` for `hestia-continuity/1`.

Every module write ultimately admits a canonical signed record and returns a
canonical receipt. A typed route is a convenience projection, not an alternate
source of truth.

### 6.2 Admission request

```json
{
  "protocol": "hestia-http/1",
  "request_id": "request:019...",
  "record": {
    "protocol": "hestia-authority/1",
    "kind": "profile/version",
    "root": "sha256:...",
    "hcp1_pack": "HCP1:..."
  },
  "proofs": []
}
```

The request envelope is transport metadata. The signed source of truth is the
canonical record inside the HCP1 pack.

A module may define a bounded proof type, such as a single-use invitation
capability. Proofs are transient and are never silently copied into canonical
state.

### 6.3 Admission response

```json
{
  "ok": true,
  "protocol": "hestia-http/1",
  "request_id": "request:019...",
  "record": {
    "protocol": "hestia-authority/1",
    "kind": "profile/version",
    "root": "sha256:..."
  },
  "verification_receipt": {
    "root": "sha256:...",
    "signed_root": "sha256:..."
  },
  "admission_receipt": {
    "root": "sha256:...",
    "signed_root": "sha256:...",
    "outcome": "accepted",
    "result_state_root": "sha256:..."
  }
}
```

`request_id` binds the response to one transport request. Idempotency is defined
by canonical record root and applicable state preconditions. Repeating an
already accepted record returns the same canonical receipt.

### 6.4 Error contract

The stable error envelope is:

```json
{
  "ok": false,
  "protocol": "hestia-http/1",
  "request_id": "request:019...",
  "error": {
    "code": "admission-rejected",
    "message": "record is not admissible against the current head",
    "details": null
  }
}
```

The initial status mapping should remain narrow:

- `400` invalid bounded transport;
- `403` authenticated principal lacks access to the requested projection;
- `409` canonical or policy admission conflict;
- `413` request or pack exceeds a published bound; and
- `500` unexpected node failure without implementation details.

Protocol-specific rejection reasons belong in the canonical receipt or an
authorized error detail. JavaScript exception names and PostgreSQL messages are
not API error codes.

### 6.5 Compatibility route

`POST /agent/v1/records/admit` remains a compatibility adapter during the
transition. It should translate to `/v1/admissions` and return the existing
`hestia-agent-http/1` response until the compatibility period ends. New modules
must not add routes beneath `/agent/v1`.

## 7. Versioning rules

The following changes require a new protocol major version:

- changing a signing-domain prefix such as `GWAR1` or `GWDP1`;
- changing the meaning or order of fields in a canonical record kind;
- changing HCV1 or HCP1 canonical bytes;
- changing transition semantics for an existing event and policy root;
- changing receipt commitments; or
- accepting a previously invalid canonical record without an explicit protocol
  or policy upgrade.

The following may be additive within a major version:

- adding a new record kind with a new fixed schema;
- adding a new optional HTTP projection field;
- publishing a new independently versioned module;
- increasing a limit advertised by `/v1/environment`; or
- adding a new query or convenience route that still resolves to canonical
  records and receipts.

Database tables, indexes, JSON projection shapes, WebCrypto helpers, IndexedDB
stores, Hoplite configuration, and JavaScript class names are implementation
details unless a separate public package explicitly exposes them.

## 8. Contract artefacts

Each stable protocol should publish four artefacts:

1. a normative Markdown specification;
2. canonical positive and negative HCV1/HCP1 test vectors;
3. a machine-readable transport schema or OpenAPI document; and
4. cross-runtime conformance tests.

The conformance matrix must include at least:

- Hara/HAL construction and transition;
- browser/Node construction and verification;
- PostgreSQL import, verification, prepare, and commit; and
- receipt verification independent of the issuing node.

A release is not compatible merely because JSON examples still parse. The
canonical roots, signing bytes, outcomes, and receipts must match.

## 9. Proposed repository layout

The first refactor should create package boundaries without immediately moving
repositories:

```text
contracts/
  hara-ledger/
  hestia-authority/
  hestia-policy/
  hestia-evidence/
  hestia-http/

packages/
  hara-ledger-hal/
  hestia-authority-hal/
  hestia-policy-hal/
  hestia-evidence-hal/
  hestia-client-js/

modules/
  rooms/
  documents/
  continuity/

adapters/
  postgres/
  hoplite/
  browser/
  cli/

services/
  node/
  signaling/

apps/
  private-office/
  document-room/
  continuity/

vendor-or-external/
  gw-fabric/
```

The exact directory names may change. The dependency direction and ownership
rules may not.

## 10. Migration sequence

1. **Freeze canonical fixtures.** Capture current HCV1 records, signing bytes,
   accepted/rejected transitions, and receipts before moving code.
2. **Split generic HAL from Hestia modules.** Move `agent_room.hal`,
   `document_ot.hal`, and `document_protocol.hal` out of the generic ledger HAL
   package.
3. **Extract contract code from the gateway.** Move request/response schemas,
   protocol constants, and error codes out of `services/agent-gateway` into a
   dependency-free contract package.
4. **Introduce the core `/v1/admissions` adapter.** Preserve `/agent/v1` as a
   compatibility route.
5. **Split database assembly.** Generate generic ledger migrations separately,
   then apply authority, evidence, and module migrations in declared order.
6. **Split the browser package.** Keep `@greenways/hestia-browser` as a
   compatibility facade while publishing focused packages for authority,
   evidence, rooms, documents, and continuity.
7. **Move product code last.** Repoint the private office and demos at the
   public packages; only then consider separate repositories.

## 11. Immediate acceptance criteria

The boundary is considered locked when:

- a minimal `hestia.core` public Hara API exists;
- `hestia-http/1` has an OpenAPI document and transport fixtures;
- canonical authority, policy, and evidence fixtures pass in HAL, JavaScript,
  and PostgreSQL;
- document writes no longer appear under `/agent/v1`;
- `gwdb-ledger-hal` contains no Hestia room or document module;
- the gateway imports contracts rather than defining them;
- the browser package can be split without changing canonical roots; and
- no application or presentation package imports PostgreSQL admission helpers.

Until those conditions hold, Hestia's product experience may continue to evolve,
but canonical protocol changes should be treated as deliberate versioned design
work rather than incidental application refactors.
