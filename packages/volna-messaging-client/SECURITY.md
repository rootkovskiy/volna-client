# Security policy

Do not report a suspected vulnerability through public product chats or include
real message plaintext, credentials, recovery secrets, device keys, or production
ciphertexts in an issue. Until a dedicated public security address is configured,
use the private security-contact process operated by the VOLNA maintainers.

The following are security invariants for this package:

- no implementation may add a plaintext transport or downgrade fallback;
- no message plaintext, content key, recovery secret, or unencrypted protocol state
  may be logged, sent to analytics/crash telemetry, or stored in AsyncStorage;
  AsyncStorage may contain only authenticated encrypted state envelopes, the
  encrypted message manifest/records, and opaque keyed record names;
- cryptographic primitives and MLS state transitions come from pinned external
  implementations, never from a locally invented protocol; production use still
  requires published compatibility evidence and a documented public-review window
  for the dependency and this integration;
- unexpected device/key changes are blocking and visible;
- a key directory is usable only after exact snapshot pagination/hash-chain
  verification and a fresh threshold of at least two directly queried, distinct,
  pinned Ed25519 witnesses; VOLNA authentication data must never be sent to a
  witness origin, and absent witness configuration disables client enrollment;
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
  until independently operated witness monitoring/gossip, physical-platform and
  device-scale large-history/leakage evidence, reproducible signed native releases,
  independent source-to-binary verification/co-signing, and a documented public
  review window with no unresolved known high-severity findings are complete.

Open source makes review possible. It does not mean this code has been independently
audited. Published release notes must state the exact review scope and unresolved
risks.
