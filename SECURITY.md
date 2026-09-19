# Security policy

## Current status

The source and release-evidence tooling are public-review candidates. Production
E2EE remains disabled. A deployable PostgreSQL-backed witness implementation is
included as an earlier reference path, and the selected C2SP/Tessera map-root log
is included, but Mullvad, Glasklar, and Tillitis have not yet registered or
cosigned the VOLNA production log. MLS still requires at least two live,
independently administered pinned witness keys. Matrix release requires the
published complete client source for the exact release, pinned dependencies and
SDK patches, repeatable build/verification instructions, artifact hashes,
applicable release signatures, and recorded compatibility/security tests with no
unresolved known high-severity findings. The current
September 18 platform scope is desktop browser plus Android emulator; native
iOS/macOS/Xcode and physical-device checks are excluded, not marked tested.
The owner's September 19 decision makes review self-service and continuous:
anyone must be able to inspect, build, test and compare the released client with
the published source. Commissioned audits, an assigned external reviewer,
external reproduction/co-signing, a third-party verdict and expiration of a
public-review waiting period are not release prerequisites. Publication and
maintainer verification remain required; absence of an outside review must stay
visible in the assurance metadata. Signing an Android artifact applies when that
artifact is distributed; it is not an APK-signing requirement for a Web release.
This decision does not change MLS witness quorum or any cryptographic invariant.

Do not describe this repository as audited merely because its source is open.
The deterministic source archive and automated checks reduce ambiguity; they
do not create an independent opinion about the cryptography.

## Reporting

Report suspected vulnerabilities through GitHub private vulnerability reporting:
<https://github.com/rootkovskiy/volna-client/security/advisories/new>. Include the
affected version, platform, entry point, expected invariant, reproduction, and
impact. Never include real user message content, credentials, recovery secrets,
device keys, or production tokens.

## Security invariants

- No proprietary first-party code may execute in the shipped client boundary.
- For an `MLS_V1` thread, the backend receives ciphertext and protocol metadata,
  never message plaintext, message search queries, or recoverable device
  wrapping keys. Personal messaging is encrypted-only; legacy plaintext message
  storage, send/read/edit/reaction routes and server previews have been retired.
- An `MLS_V1` thread never falls back or dual-writes to plaintext routes.
- A `MATRIX_V1` thread carries the strict VOLNA event only inside the encrypted
  Matrix event and never falls back or dual-writes to plaintext routes. Matrix
  metadata remains visible to the homeserver. The companion Synapse policy rejects
  user-authored plaintext events. The API provides no legacy plaintext fallback.
- Matrix device keys are not covered by the MLS Key Transparency claim. Web/PWA
  uses Matrix cross-signing, signed-device isolation, identity-change warnings and
  to-device QR/SAS verification; independent witnesses are not required for this
  Matrix identity design. Retained release checks cover Android-emulator and
  desktop-browser lifecycle/history/verification, authenticated recovery,
  recipient enforcement and the stated artifact/review requirements.
- Authenticated Matrix backup capability version 1 verifies the
  pinned MSC4048 v1 MAC proposal and encrypted account/room/session provenance
  inside Rust. Legacy key JSON, server verification flags and file imports never
  grant that provenance. Recovery must retain sender/recipient checks and never
  automatically trust a device or replace existing recovery/cross-signing keys.
- Matrix access tokens are short-lived and refresh first checks the authenticated
  VOLNA session. Exact session-device registration, account-wide deletion/
  suspension revocation, direct-room block removal and durable Synapse retry are
  server lifecycle invariants. Pending push notification receipts are encrypted
  locally and contain only thread/event routing ids, never message content.
- Missing/stale witness quorum, invalid directory or sparse-map proof, log
  inclusion/signature failure, membership, AAD, media, or local-state failure is
  blocking and never causes plaintext fallback.
- The client re-verifies and durably gossips exact C2SP checkpoint evidence;
  rollback, equivocation, same-size split views, predecessor mismatch, and stored
  evidence tampering fail closed.
- External witnesses enforce append-only consistency of one global log. Directory
  semantics remain independently verified by the endpoint and committed to the
  witnessed sparse-map root; witnesses are never trusted with or sent an account
  directory.
- Witness credentials and database URLs are server-only environment variables and
  are forbidden from all Expo client roots by the public boundary verifier.
- Release evidence must state signing, review, and reproducibility facts
  literally; absent evidence is never inferred.

The messaging-specific disclosure and support policy is in
`packages/volna-messaging-client/SECURITY.md`.
