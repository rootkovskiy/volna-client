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
message confidentiality. Independent witnesses reduce unilateral directory
equivocation; the public client retains their signed statements and detects
rollback or same-size split views through an atomic gossip store. A short-lived
VOLNA receipt authenticates the first canonical directory observation so an
unrelated attacker cannot pre-claim another account label. Because the witness
retains the full hash prefix under its own atomic storage, that receipt does not
let VOLNA erase or replace already observed history. Compromise or collusion of
the required witness quorum remains a trust failure. Running multiple instances
under one operator is not independence. This does not protect a compromised endpoint. Public source removes
hidden first-party client code only when the installed artifact is independently
matched to that source.

## Explicit non-guarantees

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
- Legacy chats remain server-readable. The server-blind confidentiality model
  applies only to a conversation explicitly activated as `MLS_V1`.

The protocol-level model is expanded in
`packages/volna-messaging-client/THREAT_MODEL.md`.
