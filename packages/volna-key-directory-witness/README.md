# VOLNA key-directory witness

This Apache-2.0 service is intended to be run by an operator independent from
VOLNA. It verifies the complete account-master-authorized device directory,
permanently rejects rollback or a changed prefix, and signs only the latest exact
checkpoint. It never receives message plaintext, message ciphertext, VOLNA session
cookies, access tokens, recovery secrets, or device private keys.

Before the first observation, apply `schema.sql` as a database owner, create a
runtime role with `SELECT`, `INSERT`, and `UPDATE` only on
`key_directory_witness_state`, and configure:

- `WITNESS_DATABASE_URL`: TLS PostgreSQL URL owned by the operator;
- `WITNESS_ID`: stable public identifier matching `[A-Za-z0-9_-]{8,80}`;
- `WITNESS_SIGNING_KEY`: 32 random bytes encoded as unpadded base64url;
- `VOLNA_DIRECTORY_RECEIPT_PUBLIC_KEY`: pinned VOLNA directory-receipt public key;
- `WITNESS_ALLOWED_ORIGINS`: comma-separated browser origins;
- optional `WITNESS_PORT`, `WITNESS_DATABASE_POOL_SIZE`, and
  `WITNESS_MAX_CONCURRENT_OBSERVATIONS`.

Generate the witness signing key directly in the operator's secret-management
environment, for example with Node's cryptographically secure RNG:

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Obtain `VOLNA_DIRECTORY_RECEIPT_PUBLIC_KEY` from a pinned release record through an
out-of-band channel. Do not discover or silently rotate it from a live VOLNA API
response. A receipt-key change requires an explicit operator and client policy
update. Likewise, a witness signing-key change creates a new witness identity and
requires a reviewed client-policy release; there is no automatic trust migration.

For local verification against an isolated PostgreSQL database:

```sh
pnpm --filter @volna/key-directory-witness test
WITNESS_TEST_DATABASE_URL=postgresql://witness:witness@localhost:5432/witness \
  pnpm --filter @volna/key-directory-witness test:postgres
docker build -f packages/volna-key-directory-witness/Dockerfile \
  -t volna-key-directory-witness .
```

Keep the signing key in an operator-controlled secret manager. Back up the
PostgreSQL state independently and alert on `volna_witness_conflicts_total`,
readiness failure, or stalled observations. TLS, IP rate limiting, request-body
limits at the edge, and multi-region availability belong to the operator's reverse
proxy/platform. Never log observation bodies: they contain public device keys and
opaque account/device identifiers.

Backups are security state, not merely availability state: test restoration and
never restore an older snapshot over a newer live database. Losing the latest
append-only prefix can remove the witness's ability to detect a later rollback.
Restrict `/metrics` and health diagnostics at the edge if operational policy
requires it, even though they expose no account labels. Keep database ownership,
runtime credentials, TLS termination, logging, alerts, signing keys, and backups
outside VOLNA's administrative control; otherwise the deployment is not an
independent witness.

Endpoints:

- `POST /v1/key-directory/observations` verifies a short-lived VOLNA receipt and
  the complete directory, atomically advances state, and returns a signed statement;
- `GET /v1/key-directory/checkpoints/:directoryLabel` returns only an exact match;
- `GET /health/live`, `GET /health/ready`, and `GET /metrics` expose no account data.

Running two copies under one operator, cloud account, database, or signing-key
custodian does not create two independent witnesses.
