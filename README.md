# Hestia

Hestia is the personal, local-first provenance, rights, contract and
self-publishing service for work made with Greenways Studio. It is the
"blockchain at home": an independently owned PostgreSQL ledger with signed,
content-addressed history rather than a public cryptocurrency network.

Hestia and Greenways Studio are separate products. Greenways provides the trust,
audit, and resolution network used by both.

## Product separation

```text
Greenways Studio
  open music tools + HAL music specification
  editors, synths, samplers, effects, AI connectors, Wasm libraries
  operational transformation + signed creative history
                         |
                         | project, work, recording and master roots
                         v
Hestia
  credits + rights + agreements + release approval + self-publication
                         |
                         | audit or resolution request
                         v
Greenways Network
  certified keystore authorities + PostgreSQL chain
  verification + audit reports + contract resolution
```

### Greenways Studio owns creation

Studio is an open, browser-based digital audio workstation. Its ambition is an
open Ableton-class environment, not a proprietary imitation:

- arrangement and session/clip editors;
- multitrack recording and destructive/non-destructive audio editors;
- piano roll, MIDI sequencing, automation and modulation;
- samplers, drum machines, digital synthesis and effects;
- hardware editors through Web MIDI;
- AI connectors with declared models, inputs, outputs and permissions;
- packaging of suitable open-source audio libraries as WebAssembly providers;
- local-first project storage, collaboration and offline rendering;
- operational transformation and a signed digital audit history.

Studio does not own contracts, release disputes, royalty policy, or
institutional resolution.

### Hestia owns contracts and self-publication

Hestia receives immutable roots from Studio rather than embedding a DAW. It
owns:

- contributor identities, roles and credits;
- composition, master, performer and producer rights assertions;
- split sheets, contributor releases, licences and amendments;
- negotiation, signatures, execution, termination and disputes;
- release readiness, public manifests and open-web publication;
- requests for Greenways audit and contract resolution.

Hestia does not edit audio, execute synthesis graphs, implement SSS, operate
keystore authorities, or present the PostgreSQL chain as its own blockchain.

Hestia also hosts collaborative professional services. A musician can invite a
law firm, label, publisher, accountant, mastering engineer, or their delegated
AI agent into a bounded piece of work without granting access to the complete
project or identity.

### Greenways owns trust and resolution

Greenways defines the open protocols and accredits independently operated
keystore authorities. It provides:

- authority accreditation and public status;
- key attestations, revocations and recovery policy;
- ledger verification and signed checkpoints;
- evidence assembly and independent audit reports;
- contract-resolution workflows and accredited resolvers;
- conformance suites for Studio, Hestia and institutional nodes.

Greenways cannot recover a user key or resolve a contract unilaterally.

## The HAL music specification

The canonical musical work is a HAL document. A graphical editor is one view of
that document; playback and rendering are executions of it.

```clojure
(music/project
 {:project/id "project/night-train"
  :tempo [{:at 0 :bpm 124}]
  :meter [{:at 0 :beats 4 :unit 4}]
  :tracks
  [{:id "track/drums"
    :type :instrument
    :device {:type :gw/sampler :kit "sha256:..."}
    :clips [{:id "clip/beat-a"
             :at 0
             :length 16
             :events [{:at 0 :note 36 :velocity 0.9}]}]}
   {:id "track/bass"
    :type :instrument
    :device {:type :faust/provider
             :package "sha256:..."
             :preset {:cutoff 740 :resonance 0.3}}}]
  :arrangement
  [{:clip "clip/beat-a" :track "track/drums" :at 0}]
  :automation
  [{:target ["track/bass" :cutoff]
    :points [{:at 0 :value 740} {:at 16 :value 1600}]}]})
```

The exact syntax will be defined by the Greenways music metaspec; this example
only demonstrates the shape.

### Required semantic layers

```text
gw.music.project       project identity, versions and dependencies
gw.music.timeline      tempo, meter, positions, loops and arrangement
gw.music.track         audio, instrument, return, group and master tracks
gw.music.clip          audio clips, note clips and clip launch behaviour
gw.music.event         notes, controls, markers and expressive MIDI data
gw.music.device        instruments, effects, routing and parameters
gw.music.automation    typed automation and modulation
gw.music.asset         samples, recordings, stems, presets and content roots
gw.music.render        deterministic render requests and result manifests
gw.music.ai            model declaration, consent, input and generated output
gw.music.operation     canonical edits and operational transforms
gw.music.audit         signatures, authority proofs and checkpoints
```

Every public namespace, metaspec, conformance corpus, editor, built-in device,
provider manifest and wire format is open. A conforming third-party editor can
open, modify, render and verify the same project without using Greenways-hosted
services.

### Determinism boundary

The spec distinguishes three outputs:

- **Reproducible:** the same pinned providers and assets must produce the same
  canonical result within declared numerical tolerances.
- **Recorded:** microphone, MIDI, hardware and live-network input is captured as
  a content-addressed asset plus device/session metadata.
- **Generated:** AI or nondeterministic processors commit their provider,
  model/version, parameters, input roots, permissions and output root.

The chain proves which inputs and authorisations were recorded. It cannot prove
that a person invented a melody or that an AI provider truthfully described an
undisclosed model.

## Building the open workstation

Greenways Studio should extend the existing Hara browser Studio and Supersonic
audio graph rather than adopt another DAW's project model.

### Core runtime

- Hara Wasm kernels own the music document, validation, operations and tool
  orchestration.
- `std.lib.substrate` carries requests, streams and transport-independent
  collaboration frames.
- Greenways Supersonic is the live audio-graph vocabulary and provider boundary.
- Web Audio supplies browser audio I/O and graph integration.
- AudioWorklet runs real-time processing outside the main UI thread.
- Rust/Wasm and carefully reviewed C/C++ Wasm providers handle DSP hot paths.
- IndexedDB stores structured workspace state and the signed outbox.
- OPFS stores recordings, sample libraries, peaks and render intermediates.
- Web MIDI connects controllers and hardware instruments.
- WebCodecs is optional and feature-detected; canonical export has a Wasm or
  sandboxed FFmpeg fallback.

### Open-source component policy

Use components, not a wholesale fork, unless their project representation and
licence match Greenways' goals.

| Need | Recommended source | Role |
| --- | --- | --- |
| Browser DSP standard | Web Audio + AudioWorklet | stable host boundary |
| Plugin interoperability | Web Audio Modules 2 | open browser plugin adapter |
| DSP and synthesis compiler | Faust | compile declared DSP to Wasm providers |
| Sequencing prototype/reference | Tone.js | scheduling reference and early devices, not canonical state |
| DAW implementation reference | openDAW | study/test interoperability; AGPL review required before reuse |
| Native/server codec pipeline | FFmpeg | import, export, probe and canonical release renders |
| Native audio file I/O | libsndfile | worker-side lossless file handling where licence-compatible |
| Rust audio I/O | CPAL | future desktop shell and device abstraction |

Every imported component must have:

- a recorded upstream repository and immutable revision;
- SPDX licence identification and compatibility review;
- reproducible build instructions;
- source and patch publication where its licence requires them;
- a signed Hara extension manifest with capabilities and integrity hashes;
- conformance tests for realtime safety, parameter semantics and state restore;
- no undeclared network, filesystem, microphone or model access.

The default Greenways distribution should prefer permissive components. GPL or
AGPL components belong in clearly separated distributions or processes unless
Greenways intentionally adopts their reciprocal terms. “Visible source” is not
enough; the licence must grant redistribution and modification rights.

### Ableton-class delivery sequence

Do not attempt feature parity in one release.

1. **Instrument workstation:** transport, note clips, step sequencer, mixer,
   Supersonic synth/effect graphs, automation and offline project files.
2. **Audio workstation:** recording, waveform editor, warping contract, sampler,
   non-destructive clips, bounce/freeze and lossless export.
3. **Performance workflow:** session view, clip launch, scenes, controller maps,
   quantised transitions and low-latency parameter control.
4. **Open device ecosystem:** WAM and Faust adapters, signed Wasm packages,
   presets, capability consent and deterministic state restoration.
5. **Collaborative Studio:** canonical operations, OT transforms, signed outbox,
   peer review, branches, merges and attributable project checkpoints.
6. **AI tools:** opt-in local and remote connectors, model manifests,
   provenance, cost/permission boundaries and generated-output attribution.

The first milestone is a complete piece of music that can be authored as HAL,
edited graphically, rendered locally, reopened from its manifest and verified
without a Greenways account.

## Operational transformation and audit

Each creative edit is a canonical operation against an explicit base project
root:

```clojure
{:operation/id "op/..."
 :project/id "project/night-train"
 :base/root "sha256:..."
 :actor/key "key:..."
 :authority/attestation "sha256:..."
 :kind :clip/move
 :path ["track/drums" "clip/beat-a"]
 :value {:at 32}
 :created-at "..."
 :signature "..."}
```

The Studio OT layer transforms concurrent operations, rejects invalid bases or
permissions, and produces a new project root. It must retain both the submitted
operation and the deterministic transformed result. Destructive audio edits
create new assets; they do not mutate bytes under an existing root.

The browser signs offline. Synchronisation submits the operation, referenced
cells and authority proof to PostgreSQL. The chain records:

- base and result project roots;
- operation and affected path;
- actor controller key and signature;
- keystore-authority attestation and revocation status used at admission;
- required project role or authorisation;
- execution receipt, cost and block root.

This supplies an audit trail of work and authorisation. It is evidence of which
key approved an operation, not automatic legal proof of authorship.

## Certified keystore authorities and SSS

Greenways certifies independent keystore authorities. Users choose their
authorities and threshold, for example two of three.

The recovery ceremony runs in the Hara kernel in the user's browser:

1. load and verify the signed recovery policy and authority registry;
2. generate a ceremony-specific browser key;
3. mutually authenticate each authority over substrate/WebRTC;
4. verify identity evidence, delay and approval policy;
5. receive authority-signed, ceremony-bound encrypted shares;
6. reconstruct the recovery secret with Shamir Secret Sharing locally;
7. unwrap the recovery package or authorise a replacement controller key;
8. erase shares and reconstructed secret from reachable browser state;
9. submit the signed recovery transcript and revocation/rotation event.

HAL owns the ceremony state machine, transcript, threshold rules and share
combination contract. An audited constant-time Wasm provider owns finite-field
arithmetic, secure randomness, key derivation, authenticated encryption and
zeroisation. The archived JVM Shamir wrapper is not a browser implementation
and should not be revived.

Authorities never send a reusable plaintext share. Greenways never receives a
quorum of shares. Key rotation remains the normal recovery outcome; restoring
an old key is an explicitly higher-risk mode.

## PostgreSQL chain

The chain is the durable record of work and authorisations shared by Studio,
Hestia and Greenways audit services. Audio, private contract evidence, private
keys and SSS shares stay outside it.

The existing implementation already has content-addressed cells, canonical
transaction signing, deterministic receipts, state/block roots, atomic head
advancement and HCP1 snapshots. Before relying on it as externally verifiable
provenance, it must additionally:

1. make authoritative references immutable or rebuild them solely from cells;
2. enforce exact parent, height and previous-state continuity;
3. verify transaction, receipt, proposer and signature relationships as part of
   complete block validation;
4. restrict direct table writes to narrow admission functions;
5. publish signed checkpoints to independent authority/witness nodes;
6. provide public inclusion and consistency proofs;
7. test export and replay in a separately provisioned verifier.

It is best described as a single-operator verifiable chain until independent
witnessing and non-equivocation are implemented.

### What else the chain can do

The useful abstraction is an application-specific state machine with a
verifiable event history. In addition to creative edits, it can track:

- project roles, permissions and delegated authority;
- human and agent tasks, inputs, outputs, reviews and approvals;
- work, recording, master, release and edition lineage;
- licences, assignments, options, encumbrances and territorial rights;
- offers, sales, transfers, payment references and delivery receipts;
- contract execution, amendments, notices, disputes and remedies;
- authority accreditation, key recovery, rotation and revocation;
- public checkpoints and selectively disclosed audit bundles.

It should not execute card or bank payments, store media, infer ownership, or
expose confidential worklogs. Those systems submit signed receipts or
commitments to the chain.

## Human-agent collaborative services

People, institutions and software agents use the same substrate action model,
but their authority is different:

```clojure
{:actor/id "agent/harbour-law/review-7"
 :actor/type :agent
 :principal "institution/harbour-law"
 :operator "person/solicitor-42"
 :implementation {:package "sha256:..."
                  :model "provider/model-version"
                  :policy "sha256:..."}
 :delegation {:id "delegation/..."
              :actions [:contract/review :document/attest]
              :matter "matter/..."
              :expires-at "..."
              :spend-limit nil}
 :key "key:institution-agent-7"}
```

A service engagement follows a common lifecycle:

```text
offered -> engaged -> access-granted -> working -> result-submitted
                                      -> needs-human-review
                                      -> rejected
result-submitted -> accepted -> invoiced -> settled
```

Every agent result records the principal, delegation, implementation and model
identity, input roots, tool calls, output roots, policy checks and any human
review. Private prompts and evidence may remain encrypted while their hashes
and authorisations are committed.

A law firm's agent may draft, compare, classify risk, request evidence, or
issue a machine attestation within its delegation. It must not be presented as
a solicitor's approval merely because it used the firm's software. Professional
sign-off is a separate signature by an authorised person or institution under a
declared policy. The chain makes that distinction machine-verifiable.

This model also supports mastering services, artwork review, sample-clearance
checks, distribution preparation, accounting, accessibility review, and AI
music tools without designing a new trust protocol for each service.

## Private worklogs and selective provenance

The worklog is private by default. Creators choose what to disclose:

- **private:** encrypted operation and evidence available only to collaborators;
- **committed:** hash, actor class, time window and authorisation recorded, with
  content withheld;
- **shared:** selected operations and assets disclosed to a buyer, auditor or
  resolver with inclusion proofs;
- **public:** release provenance published with the work.

A disclosure bundle names its purpose, recipient, scope, expiry and checkpoint.
It contains only the cells and proofs required to answer that question. Sharing
a worklog does not grant copyright, reveal unrelated collaborators, or make
private drafts public.

This allows an artist to demonstrate how a work evolved, which keys authorised
changes, which tools or AI models participated, and which rights were cleared.
The evidence remains rebuttable: provenance strengthens a claim but does not
replace authorship and ownership law.

## Transferable works, editions and upgrades

Hestia can sell a work in an NFT-like way without requiring a public chain. The
native object is a transferable, signed edition certificate:

```clojure
{:edition/id "edition/night-train/17"
 :release/root "sha256:..."
 :work/root "sha256:..."
 :version/root "sha256:master-v1"
 :edition {:number 17 :supply 100}
 :holder "party/buyer"
 :instrument {:type :collectible-licence
              :agreement/root "sha256:..."}
 :upgrade-policy {:mode :follows-release
                  :major-upgrades :holder-consent}
 :transfer-policy {:transferable true
                   :creator-royalty-bps 750}
 :previous-transfer nil}
```

The sale must say what is transferred:

- a collectible certificate;
- access to files or future versions;
- a personal or commercial usage licence;
- ownership of one digital edition;
- a royalty participation or payment entitlement;
- an assignment of specified copyright or master rights.

These are not interchangeable. Holding a certificate or ERC-721 token does not
by itself transfer copyright, master ownership, publishing rights, or royalty
entitlement.

### Upgrade model

Works and editions are never mutated in place:

```text
work
  v1 master root
    -> v1.1 metadata/remaster root
    -> v2 derivative or major-upgrade root
```

An edition is either:

- **pinned**, retaining the exact purchased version;
- **follows-release**, receiving compatible upgrades automatically;
- **consent-gated**, requiring the holder to accept a material upgrade;
- **forkable**, permitting derivatives under an attached licence.

Every upgrade records its parent, authorisations, changed assets, contract
effect and compatibility class. The old version remains independently
verifiable. New contributors or changed splits require new agreement events
before release approval.

### Sales and external NFT bridges

The PostgreSQL chain can operate the native edition registry, including offers,
transfers and settlement receipts. Payment remains in an external regulated
payment or blockchain system and is accepted only after a verifiable receipt.

An optional bridge may mint an ERC-721 whose metadata points to the immutable
Hestia edition and checkpoint. ERC-4906 can signal metadata changes for editions
that follow upgrades. ERC-2981 can advertise royalty information, but it does
not force every marketplace to pay; enforceable obligations come from the sale
agreement, participating marketplace, and applicable law.

The bridge is an adapter. Burning, transferring or compromising the external
token must not silently rewrite Hestia's rights registry. Bridge custody,
reconciliation, finality and dispute rules need an explicit signed policy.

## Hestia contract and publishing flow

```text
Studio project/master root
          |
          v
credits and rights assertions
          |
          v
agreement proposal -> negotiation -> signatures -> execution
                                              |
                                              v
                                  release readiness check
                                              |
                           +------------------+------------------+
                           v                                     v
                    open-web release                    delivery adapters
                    signed manifest                     DDEX RIN / ERN
```

Hestia stores immutable agreement revisions. Every signature binds the exact
canonical terms, rendered document bytes, participant key and authority
attestation. Composition, master, performer, producer, neighbouring-right and
payment shares are separate dimensions.

For self-publication, Hestia emits a public release page and downloadable signed
manifest referring to the exact master, artwork, credits, licences and contract
clearance roots. It maps external standards such as DDEX RIN/ERN and ISRC but
does not invent official identifiers without delegated authority.

## Greenways audit and contract resolution

An audit request identifies a chain checkpoint and a bounded question. The
audit bundle contains independently verifiable cells, operations, signatures,
authority status, agreement revisions, release manifests and inclusion proofs.
Confidential evidence is encrypted for the appointed auditor or resolver.

Resolution is a signed workflow, not deletion or rewriting:

```text
requested -> jurisdiction-review -> evidence-open -> response
          -> mediation -> settled
                       -> determination -> accepted / appealed
```

Greenways supplies rules, evidence tooling and accredited resolvers. A decision
records its authority, scope, evidence roots and remedy. Remedies create new
rights, contract or release events; disputed history remains visible.

## Open guarantees

- All HAL music and contract specifications are public.
- All canonical encodings and signing payloads are public.
- Conformance tests and reference tools are open.
- Built-in Studio instruments and effects are open.
- Repacked Wasm providers publish upstream source, revisions, licences and
  build recipes.
- A user can export projects, media, contracts, signatures and verification
  proofs without a Greenways account.
- Third parties can implement compatible editors, renderers, authorities,
  witnesses, publishers and auditors.

## Standards and component references

- [Web Audio API](https://www.w3.org/TR/webaudio-1.0/)
- [Web MIDI API](https://www.w3.org/TR/webmidi/)
- [WebCodecs](https://www.w3.org/TR/webcodecs/)
- [Web Audio Modules 2](https://www.webaudiomodules.com/docs/intro/)
- [Faust](https://github.com/grame-cncm/faust)
- [Tone.js](https://github.com/Tonejs/Tone.js/)
- [openDAW](https://opendaw.org/)
- [FFmpeg licence and legal considerations](https://ffmpeg.org/legal.html)
- [ERC-721 non-fungible token standard](https://eips.ethereum.org/EIPS/eip-721)
- [ERC-2981 royalty information](https://eips.ethereum.org/EIPS/eip-2981)
- [ERC-4906 metadata update extension](https://eips.ethereum.org/EIPS/eip-4906)
- [DDEX Recording Information Notification](https://kb.ddex.net/implementing-each-standard/recording-information-notification-%28rin%29/rin-faq/)
- [International Standard Recording Code handbook](https://isrc.ifpi.org/isrc-standard/isrc-handbook)
