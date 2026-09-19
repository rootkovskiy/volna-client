# Threat model

## Protected assets

- message plaintext and endpoint-only search terms;
- MLS group state, device identity keys, recovery authorization, and local
  projection keys;
- account sessions and private user data handled outside messaging;
- the integrity of the public-source-to-shipped-artifact claim.

## Adversaries

- a curious or compromised proprietary backend/operator;
- a network attacker without endpoint control;
- another account or revoked device;
- malicious media and protocol input;
- a supply-chain dependency or compromised build pipeline;
- the Web origin owner replacing JavaScript after review.

## Trust boundaries

The endpoint and its OS secure storage are trusted for plaintext processing.
The server, object storage, realtime service, and witnesses are untrusted for
message confidentiality. The endpoint verifies account-master directory semantics
and a compressed sparse-map proof to a global root. Independent C2SP witnesses
reduce unilateral log/directory equivocation by cosigning only append-only
checkpoints; the public client retains exact checkpoint evidence and detects
rollback or same-size split views through an atomic gossip store. Witnesses see no
account directory, and their signature is not treated as a semantic device
authorization. Compromise or collusion of the log operator and the required
witness quorum remains a trust failure. Running multiple instances
under one operator is not independence. This does not protect a compromised endpoint. Public source removes
hidden first-party client code only when the installed artifact is independently
matched to that source.

## Explicit non-guarantees

Backup authenticity relies on the endpoint-held recovery secret and sealed SDK
sender provenance. The custom Web/Android SDK applies the pinned MSC4048 v1 MAC
proposal with an encrypted account/room/session context; a server-held public
backup key cannot forge that MAC. Missing/invalid MACs and imported legacy keys
cannot gain authenticated provenance. This does not prove backup completeness or
freshness: a server can withhold or replay valid entries, and an attacker holding
the recovery secret is inside this trust boundary. The extension remains subject
to source publication, maintainer checks and publicly repeatable artifact comparison;
runtime tests alone do not
provide that assurance.

- No endpoint security after malware, debugger, rooted-device, or malicious
  keyboard/screen-capture compromise.
- No Web/PWA resistance to same-origin JavaScript replacement.
- No binary reproducibility or co-signature claim until native build evidence is
  independently produced and verified.
- No independent-witness claim until the configured quorum is operated outside
  VOLNA's legal, administrative, cloud, database, monitoring, and key-control
  boundaries.
- Metadata such as accounts, devices, group membership, timing, ciphertext
  sizes, and delivery state remains visible to the service where the protocol
  requires it.
- Personal messaging is encrypted-only. Legacy plaintext chat storage and routes
  are retired; unavailable encrypted engines do not fall back to plaintext.
- Development `MATRIX_V1` relies on Matrix device identity/cross-signing rather
  than the MLS witness map. Web/PWA applies signed-device isolation, reports
  cross-signing identity replacement, and verifies devices through Matrix
  to-device QR/SAS. Exact session and account revocation plus direct-room removal
  are implemented with durable retry. The remaining Matrix release risk is the
  retained browser/Android lifecycle and history acceptance, authenticated backup
  recovery, recipient-enforcement evidence and checkable release artifacts with
  applicable signatures. External review/reproduction is voluntary, not a launch
  prerequisite; absent evidence is still disclosed. Physical devices and native iOS/macOS/Xcode are excluded from the
  September 18 release scope; an external witness is not a Matrix requirement.

The protocol-level model is expanded in
`packages/volna-messaging-client/THREAT_MODEL.md`.
