# VOLNA Messaging Client

This directory is the separately publishable foundation for VOLNA private
messages. Its purpose is to make the message protocol, endpoint cryptography,
local encrypted state, and opaque transport independently inspectable without
publishing the VOLNA backend.

This is a disabled engineering foundation, not a production E2EE claim. It
contains strict public wire/content contracts, the complete private-message
composer/renderer/dialog-list/direct-share surface, an RFC 9420 MLS client runtime
based on pinned `ts-mls` `1.6.2`, account-master-authorized devices, one-time key
packages, local encrypted state, an Expo storage adapter and client manager, an
opaque transport, endpoint message projection, a React Native/Web device-security
screen, a fail-closed legacy/MLS controller, and adversarial tests. A separate
pinned OpenMLS `0.8.1` crate is retained
for native/cross-implementation evaluation. Verified device-directory chains are
pinned in encrypted endpoint state, so a rollback or changed chain prefix already
seen by that device fails closed. Directory retrieval is immutable-snapshot
paginated: the endpoint verifies the exact entry count and chain head before use.
It then queries distinct pinned witness origins directly, without VOLNA cookies or
tokens, and requires at least two fresh Ed25519 statements over that exact
checkpoint. Each direct witness request has an eight-second default deadline and a
64 KiB streaming response bound; collection stops at the first valid quorum and
ignores failed, oversized, stale, or forked minority responses. If no witness policy
is compiled into the client, enrollment, transfer, rekey, and rollout capabilities
remain locally disabled.

Device changes now use a QR-bound X25519/HKDF/XChaCha20-Poly1305 transfer channel,
a human-compared six-digit code, resumable chained history chunks, a new independent
device signing key, and MLS Add/Remove Commit plus Welcome processing for every
affected conversation. The recovery secret can authorize a replacement device but
does not restore old message history by itself.

Initial MLS activation is also crash- and stall-recoverable. A stale local
pre-activation is discarded and recreated from fresh one-time key packages. After
the server-owned activation window expires, an epoch-1 group may be replaced only
when it has never carried a ciphertext envelope and has no prepared membership
change. Replacement Welcomes name the exact old group they supersede, and endpoints
delete old projections and queued ciphertext before accepting the replacement.
Recovery never reopens or dual-writes the legacy plaintext route.

The complete first-party client source now has a verified Apache-2.0 release
contour under `client-public/`, but native release artifacts are not yet reproducible
or independently signed,
the required witness protocol has no independently operated production witnesses,
the complete physical-platform test matrix is unfinished, and the integration
has not received an independent security review. Consequently
`CHAT_E2EE_ENROLLMENT_ENABLED` and `CHAT_E2EE_ROLLOUT_ENABLED` must remain false
and the product must not advertise these chats as end-to-end encrypted.

## Public foundation

- composer-to-ciphertext and ciphertext-to-render message code;
- the versioned plaintext event codec and opaque delivery contract;
- MLS runtime adapters and pinned dependency/build metadata;
- local encrypted-state and platform key-storage adapters;
- a journaled encrypted message-projection store and endpoint-only local search;
- a signature-verifying checkpoint-gossip monitor with durable evidence records;
- deterministic public source-archive, SHA-256, and CycloneDX release-evidence tooling;
- device verification, QR transfer, recovery authorization, MLS membership rekey,
  initial-activation replacement, transparency, downgrade, and migration logic;
- the shipped device-security/transfer UI and Expo client manager;
- the shipped dialog list, composer, renderer, local previews/playback, reactions,
  edits, attachment search, and direct-share recipient UI;
- a fail-closed surface controller that owns legacy adaptation, MLS encryption,
  local projection, downgrade detection, and content-aware realtime handling;
- an automatic-media policy that permits background message media fetches only
  from the public VOLNA CDN and requires explicit user action for external audio;
- tests, threat model, supported security claim, and release hashes.

## Proprietary scope

The production backend, recommendation/discovery logic, moderation/admin logic,
catalogs, payments, and operations remain outside this directory and outside this
license. The chat relay may implement the public opaque-envelope API without
receiving a content key or message plaintext.

VOLNA selected publication of the complete first-party client source. The
`client-public/` contour includes the Expo host, routes, UI, storage/network
adapters, PWA worker, shared client packages, and this messaging package under
Apache-2.0 while excluding the proprietary API. Its verifier rejects missing client
roots and imports that escape into backend code.

This source boundary makes the complete same-process client reviewable. It does not
by itself prove that App Store, Play Store, or Web bytes match the reviewed source.
The literal malicious-release-owner goal still requires reproducible signed native
artifacts plus independent source-to-binary verification; Web retains the origin
replacement limitation described below.

## Security claim

When all release gates are complete, the target property is that new E2EE message
plaintext and content keys exist only on authorized endpoint devices. VOLNA
servers will still see documented metadata such as participants, devices, message
timing, ciphertext size, delivery state, IP/network information, and abuse-control
events.

An open PWA client protects against passive storage/server access when the published
code is what runs. It cannot cryptographically stop the origin owner from serving a
different JavaScript bundle later. Signed native clients with published hashes and
separated release review provide the stronger assurance tier.

## Independent witness integration

`@volna/messaging-client/key-directory-witness` exposes the public reference
witness state machine. `observe(snapshot)` verifies the complete account-master-
authorized directory and advances only when every previously witnessed entry hash
is an unchanged prefix. Advancement is committed through the supplied store's
atomic `compareAndSwap`; concurrent forks therefore cannot both win. The returned
statement contains only an opaque account label, identity fingerprint, entry count,
head hash, observation time, witness id, and Ed25519 signature.

The test-only `createMemoryKeyDirectoryWitnessStore()` is not a production store.
Each real witness needs independently controlled durable multi-instance CAS
storage, protected signing-key custody, monitoring, backups, availability targets,
and an HTTPS endpoint matching
`GET /v1/key-directory/checkpoints/:directoryLabel`. That endpoint returns a
statement only when `entryCount`, `headHash`, and `identityFingerprint` exactly
match the witness's latest state. VOLNA clients query it with `credentials: omit`,
`referrerPolicy: no-referrer`, and no application token. At least two distinct
origins and signing keys are mandatory in the shipped client policy.

`@volna/messaging-client/key-directory-gossip` verifies those signed statements
again before committing them to a supplied durable compare-and-swap store. It
preserves the exact signed evidence for every observed checkpoint and rejects a
per-witness rollback, same-size equivocation, cross-witness split view, identity
change, signature failure, or observation-time rollback. The bundled memory store
is test-only. A production deployment still needs independently controlled
operators and durable storage outside VOLNA. Statements for different entry counts
do not by themselves prove prefix consistency; the reference witness performs that
full-chain check before signing, and endpoint directory verification independently
pins the chain it has already accepted.

## Encrypted local history and search

`@volna/messaging-client/encrypted-message-store` keeps message projections outside
the monolithic MLS runtime envelope. It HKDF-derives a separate key from the
device-only wrapping key, encrypts bounded chunks, per-thread indexes and an opaque
manifest with XChaCha20-Poly1305, and derives storage names through keyed HMAC so raw
account and thread ids do not appear in that database. Writes commit new chunks and
their thread index before the manifest, making a crash preserve the previous
committed snapshot; later loads remove unreferenced orphan records. Append-only
updates reuse complete chunks and rewrite only the final/new chunks. Authentication
failure is fatal rather than a plaintext or empty-history fallback.

The secure client hydrates and searches only decrypted in-memory projections. Search
terms never enter the opaque API or witness requests. Dialog metadata may be fetched
without a query to resolve a local match, with bounded pagination and stale-result
cancellation. This protects message content at rest but does not replace device lock,
OS storage protection, physical-device performance evidence, or the release-distribution
and independent-review gates above.

The public suite also exercises 32,768 encrypted projection records across eight
threads, confirms plaintext identifiers/content do not occur in the backing store,
and verifies an append rewrites only one tail chunk, one index, and the manifest.
Its timing ceiling is a desktop Node smoke guard, not evidence for real iOS/Android
hardware.

## Reproducible public release evidence

The source tree contains a deterministic USTAR+gzip builder and a CycloneDX `1.6`
inventory generator covering the pinned pnpm verification lock and OpenMLS evaluation
Cargo lock. Run it outside this package directory:

```sh
pnpm release:evidence -- --output ../../.logs/verification/messaging-release
```

The output contains a source archive, a per-file source-tree hash manifest,
SHA-256 files, the SBOM, and `release-evidence.json`. The manifest intentionally
says `signed=false` and
`independentlyReviewed=false`; a real release still needs independently controlled
native signing/co-signing and a published review. The public tests build twice and
require byte-identical archive/SBOM evidence.

## Local verification

From the public package checkout:

```sh
pnpm install --frozen-lockfile
pnpm verify
```

The npm/pnpm tarball format excludes the specially named `pnpm-lock.yaml` even
when it appears in a package `files` allowlist. Published tarballs therefore carry
the byte-identical `pnpm-lock.public.yaml`; before a standalone frozen install from
an unpacked tarball, copy it to the standard name:

```sh
cp pnpm-lock.public.yaml pnpm-lock.yaml
pnpm install --frozen-lockfile --ignore-scripts
pnpm verify
```

From the VOLNA monorepo:

```sh
pnpm --filter @volna/messaging-client verify
```

The OpenMLS evaluation is built separately in a Rust environment:

```sh
cargo test --locked --manifest-path rust/openmls-evaluation/Cargo.toml
```

Read `THREAT_MODEL.md`, `PUBLIC_BOUNDARY.md`, `DEPENDENCIES.md`, and `SECURITY.md`
before integrating or making a public confidentiality claim.
