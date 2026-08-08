# VOLNA client

[![Verify public client](https://github.com/rootkovskiy/volna-client/actions/workflows/verify.yml/badge.svg)](https://github.com/rootkovskiy/volna-client/actions/workflows/verify.yml)

This is the complete public first-party source boundary for the VOLNA Expo
client release candidate: iOS, Android, Web, and installed PWA. It includes the
application host, routes, UI, networking and storage adapters, service worker,
shared client packages, and the gated end-to-end encrypted messaging
implementation.

The VOLNA API, Prisma schema, databases, moderation and recommendation
services, deployment configuration, and secrets are intentionally excluded
and remain proprietary. The client communicates with that backend only through
documented network boundaries visible in this source.

## Verify

Use Node 20, 22, or 24 and pnpm 11.7.0:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm export:web
pnpm export:android
pnpm export:ios
```

`pnpm verify:boundary` fails if a first-party client source root is omitted,
if client code imports a proprietary server module, if a secret-bearing file
enters the release, or if an undeclared environment variable is read.
The suite also verifies retained signed key-directory gossip evidence and a
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

Read [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md),
[THREAT_MODEL.md](THREAT_MODEL.md), and [DEPENDENCIES.md](DEPENDENCIES.md) before
reviewing security claims or the resolved supply chain. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the reproducible public-review workflow.
