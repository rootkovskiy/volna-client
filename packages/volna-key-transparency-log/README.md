# VOLNA key-transparency log

This Apache-2.0 service is the separately deployable, reviewable C2SP tile log
for VOLNA device-directory map roots. It uses Tessera `v1.0.4`, one-second
checkpoint publication, POSIX durable storage, and fail-closed external
witnessing. It is never bundled into Expo and it never receives chat content,
account ids, usernames, or device-directory leaves.

The build pins Go `1.26.5` plus patched OpenTelemetry `1.41.0` and
`golang.org/x/crypto` `0.52.0`; release CI must fail on any fixable
HIGH/CRITICAL container finding.

Public endpoints are `GET /about`, `GET /checkpoint`, `GET /tile/...`, and `GET /entries/...`.
`POST /v1/map-roots` is private and requires a high-entropy bearer token; it
accepts only the strict canonical VOLNA root-entry schema and returns the
published checkpoint and RFC 6962 inclusion proof.

Production requires `VOLNA_ENV=production`, `KT_STORAGE_DIR`, `KT_LISTEN`,
`KT_APPEND_TOKEN`, a C2SP note private key supplied through
`KT_LOG_PRIVATE_KEY_FILE`, its matching public vkey in `KT_LOG_PUBLIC_VKEY`, and a 2-of-3 Tessera witness policy supplied through
`KT_WITNESS_POLICY_FILE`. The service refuses production startup without a
policy and never enables Tessera's fail-open witness mode.

`witness-policy.production.example` pins the current public keys and live
submission endpoints for Mullvad, Glasklar, and Tillitis. It is a configuration
template, not evidence that those operators already recognize the VOLNA log:
each operator must first add the generated VOLNA log vkey to its registry.

`KT_TEST_ONLY_ALLOW_UNWITNESSED=true` is limited to non-production integration
tests. Such a log is not independent evidence and cannot activate production
E2EE.

Back up the complete storage directory atomically, retain old signing keys and
policy history, and monitor failures, publication latency, tree growth, and
checkpoint age. Restoring an older copy in place is prohibited: recover by
verifying against the last externally retained checkpoint and append-only
consistency evidence.

For a disposable test identity only:

```sh
go run ./cmd/keygen kt.example.test/log
```

Generate the production identity directly inside its secret-management boundary;
never paste the printed private line into documentation, Git, tickets, or chat.
