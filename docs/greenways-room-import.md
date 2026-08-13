# Importing Hestia room authority into Greenways OS

Status: first portable projection and decision boundary for
[`greenways-ai/hestia#29`](https://github.com/greenways-ai/hestia/issues/29)

## Ownership

Hestia is the room authority. Greenways OS is an installation, custody, routing,
and execution host.

```text
Hestia
  canonical HCV1/HCP1 room records
  governance and activity heads
  invitations and admission proofs
  memberships and membership epochs
  source mandates
  room application grants
  invocation policy and exact authority roots

Greenways OS
  local daemon and node lifecycle
  local application approval and local capabilities
  OS key and provider credential custody
  Hestia package import and verification
  route selection and availability
  browser effects and provider execution
```

A Greenways daemon role does not become room membership. A reachable source does
not become an authorised source. A locally installed application does not gain a
room operation until both local Greenways authority and imported Hestia room
authority allow the exact invocation.

## Canonical versus projection data

The portable values in `browser/src/room-authority.js` are **verified
projections**, not a replacement canonical format. Each projection carries the
exact Hestia HCV1 record root or canonical receipt root from which it was
derived.

Canonical room records continue to use the existing Hestia room protocol:

- signed `room/version` governance records;
- signed invitations and admission proofs;
- membership epoch transitions and rotation receipts;
- append-only room activity roots;
- HCP1 packs and canonical receipts.

A consumer must verify those records before constructing a projection. It may
cache the bounded projection for routing, but it must preserve and report the
canonical roots.

## Portable authority chain

The first module evaluates:

```text
open room at governance root G
  + member M active at room epoch E
  + source mandate S active at policy revision P and epoch E
  + room application grant A for M through S
  + exact application identity and local approval digest
  + requested operation and per-call limits
  + trusted observation time
  -> allowed or one closed denial reason
```

Every decision includes one detached, immutable copy of the complete validated
`hestia-room-invocation/0-alpha` projection. This binds the result to the exact
member, node, source, application, operation, arguments digest, limits and
validity interval evaluated by Hestia without requiring a consumer to reproduce
HCV1 hashing.

An allowed decision additionally includes the exact membership, source-mandate,
and grant roots. A denied decision retains the exact evaluated invocation for
correlation, but does not project those roots as successful authority evidence.

The module rejects unknown fields. Its closed values cannot contain provider
credentials, browser cookies, private keys, key-store handles, reusable bearer
tokens, arbitrary DOM authority, or arbitrary signing requests.

## ChatGPT web source

A host may mandate a reviewed source such as:

```text
source/alice-chatgpt-browser
implementation: greenways.chatgpt-web
operations:
  conversation.create
  message.submit
  response.read
requires-user-interaction: true
```

The source mandate and room application grant share semantic operations. They do
not transfer the host's ChatGPT account, session, cookies, credentials, tab
authority, or unrelated conversation history.

Greenways OS must still enforce its local application approval and local
capability grant before calling this module. After an allowed Hestia decision,
the host's reviewed browser adapter retains the visible prompt-placement, Send,
and response-return gestures.

## Import surface

The browser package publishes:

```text
@greenways/hestia-browser/room-authority
@greenways/hestia-browser/room-authority-import
@greenways/hestia-browser/room-authority-conformance
```

`room-authority-import.json` declares the owner, export, protocols, fixture, and
`exact-invocation-projection` decision-correlation contract.
`fixtures/room-authority-conformance.json` is cross-runtime input for Greenways
OS adapters. Fixture `overrides` use recursive object replacement: objects merge
by field, while arrays and scalar values replace the base value.

Greenways OS should pin an exact Hestia revision or released package digest and
run the conformance fixture in its extension, Hara, and daemon adapters. It must
not copy the decision implementation into a Greenways-owned room protocol.

## Execution ordering

For a consequential room call, Greenways OS should enforce:

```text
closed local request
  -> authenticated local actor
  -> exact local application approval
  -> active local capability grant
  -> verified Hestia import version
  -> Hestia room authority decision carrying the exact invocation projection
  -> exact decision/invocation equality check
  -> durable invocation ownership
  -> route/source lookup
  -> browser or provider execution
  -> result and receipt binding
```

Hestia denial occurs before provider claims, vault access, browser delivery, or
network effects. Route loss, pending host interaction, replicated state,
completion, and authority denial remain distinct outcomes.

## Next slices

1. Construct these projections directly from verified existing HCV1 room state.
2. Add canonical Hestia source-mandate and room-application-grant records.
3. Admit those records through Hestia and Ignatius while preserving room roots.
4. Pin the Hestia package in Greenways OS and run the conformance fixture.
5. Prove invitation, join, shared app invocation, result receipt, revocation, and
   membership-epoch rotation between two installed Greenways nodes.
