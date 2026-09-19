# Security policy

Do not report a suspected vulnerability through public product chats or include
real message plaintext, credentials, recovery secrets, device keys, or production
ciphertexts in an issue. Until a dedicated public security address is configured,
use the private security-contact process operated by the VOLNA maintainers.

The following are security invariants for this package:

- no implementation may add a plaintext transport or downgrade fallback;
- `MATRIX_V1` content must remain inside `m.room.encrypted`; the custom msgtype,
  body, device id, and strict VOLNA event are all encrypted event content, never
  parallel cleartext metadata;
- Matrix access credentials must remain inside the encrypted credential envelope;
  explicit application logout revokes the current Matrix session, access tokens
  stay short-lived, and an automatic refresh first requires a live authenticated
  VOLNA session;
- no message plaintext, content key, recovery secret, or unencrypted protocol state
  may be logged, sent to analytics/crash telemetry, or stored in AsyncStorage;
  AsyncStorage may contain only authenticated encrypted state envelopes, the
  encrypted message manifest/records, and opaque keyed record names;
- cryptographic primitives and MLS state transitions come from pinned external
  implementations, never from a locally invented protocol; production use still
  requires published compatibility evidence and continuously available source,
  tests and build/verification instructions for the dependency and integration;
- released MLS device/key changes are blocking and visible. Development Matrix
  uses cross-signing, signed-device isolation, visible identity replacement and
  Matrix to-device SAS/QR verification; full fingerprints remain inspectable;
- the MLS witness proof is never represented as proof of a Matrix device key;
  Matrix device identity is established by its own cross-signing and SAS/QR flow,
  and independent witnesses are not required for that design;
- Matrix backup recovery requires authenticated-backup capability version 1.
  The pinned MSC4048 v1 MAC proposal uses existing cryptographic primitives;
  the encrypted VOLNA context binds account, room, session and established sender
  provenance. Only the Rust encrypted importer can restore that sealed state.
  Legacy/missing-MAC imports remain untrusted; invalid present MACs are rejected.
  Version migration preserves recovery/cross-signing keys and prior backups.
  See the custom SDK README for the exact extension and its evidence limits;
- a key directory is usable only after exact snapshot pagination/hash-chain
  verification, sparse-map inclusion, C2SP log inclusion/signature verification,
  and a fresh threshold of at least two distinct pinned Ed25519 witness
  cosignatures; witnesses receive only the public global checkpoint, and absent or
  pending policy disables client enrollment;
- local search operates only on decrypted endpoint memory; search text must never be
  sent to VOLNA, a witness, analytics, logs, or crash telemetry;
- parsers are versioned, strict, bounded, and reject malformed/unknown critical data;
- automatic message media fetches are restricted to the public VOLNA CDN; external
  media playback requires an explicit user action and a safe HTTPS URL;
- release builds disable dependency features that print content or key material;
- the public boundary verifier rejects runtime console sinks and obvious
  analytics/crash/telemetry dependencies; generated release evidence must state
  truthfully whether it is signed and independently reviewed;
- changes to `src`, `rust`, storage adapters, recovery, verification, or the export
  boundary require security-focused review and new public test evidence.
- the complete first-party client source now has a verified Apache-2.0 release
  contour under `client-public/`, so no unpublished first-party source is intended
  to share the plaintext JavaScript realm; production rollout remains disabled
  until independently operated witness monitoring/gossip for MLS, the retained
  browser/Android-emulator history/leakage checks, publication of the exact client
  source and pinned SDK patches, repeatable build and artifact-comparison
  instructions, applicable native release signatures, and maintainer verification
  with no unresolved known high-severity findings are complete.
  Native iOS/macOS/Xcode and physical-device checks are excluded from the current
  September 18 release scope, not marked tested.

Under the owner's September 19 decision, third-party review is voluntary and
self-service. A commissioned audit, assigned reviewer, externally reproduced or
co-signed binary, third-party verdict, or public-review waiting period is not a
release prerequisite. Anyone must be able to inspect, build, test and compare
the exact published release without proprietary backend source or private build
credentials. Missing independent review remains a disclosed fact, not a claim
of completed review. The decision does not weaken protocol checks, remove MLS
witness quorum, or turn production gates on automatically.

Open source makes review possible. It does not mean this code has been independently
audited. Published release notes must state the exact review scope and unresolved
risks.
