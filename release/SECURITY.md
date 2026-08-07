# Security policy

## Current status

The source and release-evidence tooling are public-review candidates. Production
E2EE remains disabled until independent witnesses, artifact signing and
reproducible binary verification, cross-implementation tests, all-platform
device tests, and a documented public-review window with no unresolved known
high-severity findings are complete. VOLNA does not require a commissioned
independent audit as a release gate; this repository instead keeps the complete
client source, frozen dependency graph, tests, and deterministic evidence open
for continuous public inspection.

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
  wrapping keys. Legacy chats remain server-readable while they exist.
- An `MLS_V1` thread never falls back or dual-writes to plaintext routes.
- Missing or invalid witnesses, directory consistency, membership, AAD, media,
  or local-state checks fail closed.
- Release evidence must state signing, review, and reproducibility facts
  literally; absent evidence is never inferred.

The messaging-specific disclosure and support policy is in
`packages/volna-messaging-client/SECURITY.md`.
