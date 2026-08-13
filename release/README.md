# VOLNA client

[![Verify public client](https://github.com/rootkovskiy/volna-client/actions/workflows/verify.yml/badge.svg)](https://github.com/rootkovskiy/volna-client/actions/workflows/verify.yml)

This is the complete public first-party source boundary for the VOLNA Expo
client release candidate: iOS, Android, Web, and installed PWA. It includes the
application host, routes, UI, networking and storage adapters, service worker,
shared client packages, and the gated end-to-end encrypted messaging
implementation. It also contains the separately deployable reference
key-directory witness service under `packages/volna-key-directory-witness` and the
standard C2SP/Tessera map-root log under `packages/volna-key-transparency-log` so an
independent reviewer can inspect the exact endpoint verifier and append-only log
personality. The semantic witness is retained reference code; the selected fast
production path is the globally batched C2SP log cosigned by external operators.

The VOLNA API, Prisma schema, databases, moderation and recommendation
services, deployment configuration, and secrets are intentionally excluded
and remain proprietary. The client communicates with that backend only through
documented network boundaries visible in this source.

## Verify

Use Node 20, 22, or 24 and pnpm 11.7.0:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm test:witness:postgres
pnpm verify:openmls
pnpm export:web
pnpm export:android
pnpm export:ios
```

`pnpm verify:boundary` fails if a first-party client source root is omitted,
if client code imports a proprietary server module, if a secret-bearing file
enters the release, or if an undeclared environment variable is read.
The PostgreSQL test requires an isolated database in
`WITNESS_TEST_DATABASE_URL`. The suite also verifies retained signed
key-directory gossip evidence and a
32,768-message encrypted local-history smoke scenario. The latter is desktop
evidence only; physical iOS and Android testing remains a release gate.

## Assurance status

Publishing source makes the client reviewable; it does not by itself prove that
an App Store, Play Store, or Web bundle was built from these exact bytes. The
release evidence is deterministic and contains hashes plus a CycloneDX SBOM,
but it is deliberately marked unsigned and not independently reviewed until
those facts change. Web/PWA users must additionally trust the origin owner not
to replace JavaScript after publication.

Production E2EE is currently hard-disabled. Legacy chats remain server-readable;
only a future conversation explicitly activated as `MLS_V1` receives the
server-blind message-content guarantee described in the security documents.
Public implementations and owner-run copies do not count as independent operation:
production still requires the real VOLNA log to be live-cosigned by at least two
pinned operators outside VOLNA's cloud accounts, key custody, database control,
and administration. The checked-in policy remains pending until that happens.

Read [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md),
[THREAT_MODEL.md](THREAT_MODEL.md), and [DEPENDENCIES.md](DEPENDENCIES.md) before
reviewing security claims or the resolved supply chain. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the reproducible public-review workflow.
