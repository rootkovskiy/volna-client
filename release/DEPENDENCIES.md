# Dependency policy

The release root pins every direct dependency to an exact version and ships one
client-only pnpm lockfile. Workspace packages are included as source; proprietary
server packages and their dependency graph are absent. `release-evidence.json` and
the CycloneDX 1.6 SBOM describe the resolved graph used for review.

`pnpm-workspace.yaml` additionally overrides `postcss` to `8.5.26`. Expo's
transitive ranges otherwise permitted `8.4.49`, which is affected by arbitrary
file-read/source-map advisories
[GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) and
[GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849).
The boundary verifier rejects a lockfile that reintroduces a PostCSS version below
the reviewed patched floor.

The workspace also overrides `uuid` to `11.1.1`. Expo's Xcode project helper
otherwise resolves `uuid` 7.x, which is affected by the buffer-bounds advisory
[GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
The override keeps the CommonJS `uuid.v4()` API used by that helper and is exercised
by the isolated client verification/build flow.

The release workspace also carries range-scoped patched floors for the transitive
`brace-expansion`, `js-yaml`, `nanoid`, `socket.io-parser`, `tar`, and `undici`
families. These close the reviewed 2026 denial-of-service, parser, archive, and
HTTP advisories without collapsing packages across incompatible major versions.
The nanoid 3.x floor is `3.3.18`, which closes
[GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8)
without forcing consumers onto a different major.
The boundary verifier pins both each selector and every allowed resolution, so a
future install cannot silently return to a vulnerable version or select an
unreviewed major. `socket.io-parser` is repeated in the standalone messaging
workspace because its content-free realtime client is part of that package too.

The relevant overrides and exact resolutions are enforced inside the standalone
`packages/volna-messaging-client` workspace and both of its byte-identical lockfile
copies. Installing or reviewing only that package therefore cannot silently
reintroduce the older PostCSS, UUID, or Socket.IO parser graph.

Expo and Metro currently resolve transitive `image-size` `1.2.1`, whose ICNS,
JXL, and HEIF parsing family is covered by two high-severity infinite-loop
advisories
[GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) and
[GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq).
No non-vulnerable npm release exists as of 2026-08-08. The workspace therefore
applies the reviewable `patches/image-size@1.2.1.patch`: malformed ICNS entry
lengths and undersized ISO BMFF boxes are rejected before any parser loop can
retain its offset. The patch SHA-256 is pinned by both the lockfile and boundary
verifier, and a subprocess regression test fails on a parser hang. The two GHSA
records are excluded from `pnpm audit` only while that exact patch remains active;
all other advisories still fail the release. Replace this temporary patch with a
reviewed upstream release as soon as one is published.

For each release candidate:

```sh
pnpm install --frozen-lockfile
pnpm audit --prod
pnpm verify
pnpm verify:openmls
```

`rust-toolchain.toml` pins the separately compiled OpenMLS evaluation to Rust
1.88.0. The public CI runs its locked test on every PR and weekly scheduled check.
The test performs bidirectional wire interoperability: OpenMLS creates a key
package, `ts-mls` creates the group and Welcome, OpenMLS joins and sends an
authenticated message, and `ts-mls` replies with the exact VOLNA AAD contract.
Cargo records an unused optional libcrux provider in the lockfile; CI separately
fails if its vulnerable ChaCha20-Poly1305 package ever enters the selected feature
graph. A dismissed `not_used` alert is therefore scoped to the current graph and
must be reopened if provider features change.

The independently deployable witness pins `pg` `8.22.0`. Its production container
pins the Node 24.19.0 Bookworm Slim multi-platform image by manifest digest, removes
package managers from the runtime stage, runs as the unprivileged `node` user, and
contains only the deployed production dependency graph. Public CI exercises its
PostgreSQL compare-and-swap race against an isolated PostgreSQL 17 service, builds
the image, and fails on fixed high or critical container findings reported by the
pinned Trivy action.

The independently deployable key-transparency log pins Tessera `v1.0.4` and its
complete Go module graph in `packages/volna-key-transparency-log/go.sum`. The
release SBOM includes those Go modules in addition to the client npm lock. Its
multi-stage container uses digest-pinned Go `1.26.5` and distroless non-root
images, while explicitly selecting OpenTelemetry `1.41.0` and
`golang.org/x/crypto` `0.52.0` over older vulnerable transitive resolutions. CI
builds and scans the final static image and must report zero fixable HIGH/CRITICAL
findings.

An audit result is time-scoped evidence, not a permanent guarantee. New advisories
must be evaluated against the locked graph before publishing another artifact.
