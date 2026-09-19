# Build and compare the client

Use an exact published commit or release tag in a fresh checkout. The source
archive manifest, CycloneDX inventory and their SHA-256 digests identify the
candidate. A source-only candidate does not enable production messaging.

## Web/PWA

Use Node 24.19.0 and pnpm 11.7.0. Install the frozen graph, then run the checks
from CONTRIBUTING.md. Build with the recorded public API origin and no private
environment file. For the VOLNA origin, on Linux/macOS:

```sh
EXPO_NO_DOTENV=1 EXPO_PUBLIC_API_URL=https://volna.social pnpm release:web
cd dist/web
sha256sum -c web-artifacts.sha256
```

On PowerShell, set `$env:EXPO_NO_DOTENV='1'` and
`$env:EXPO_PUBLIC_API_URL='https://volna.social'`, then run `pnpm release:web`.
No Sentry DSN is set in this recipe; any different public build setting must be
recorded with the artifact. Start from a fresh checkout/output directory for
each comparison.

`release:web` runs the ordinary Expo export, then the same public
`release/scripts/finalize-web-export.mjs` used by production. That script binds
all JavaScript chunks to a hash-derived release namespace and rewrites their
references. It intentionally rejects diagnostic source maps. Finally,
`web-artifact-evidence.mjs` copies the installed, integrity-pinned Matrix WASM
to the versioned URL used by the public gateway adapter and hashes every output
file, including HTML, service worker, media and WASM.

Compare `web-artifacts.sha256` from your rebuild with the manifest attached to
the exact release. To compare against downloaded published bytes, preserve the
manifest's relative paths and run `sha256sum -c` in that directory. A match must
cover all listed files; a JavaScript entry hash alone is insufficient. Investigate
any mismatch and record the operating system, architecture, Node/pnpm versions
and public build settings. Do not call a build reproducible before making this
comparison. Production may retain one previous JavaScript generation for open
tabs; those old files are not part of the current candidate manifest.

The origin can replace Web code after publication. A matching snapshot does not
remove that trust limitation or establish a security audit.

## Android and modified SDKs

The exact SDK archives, revisions, patches, AAR chunks and checksums are in
`packages/volna-matrix-native/sdk/manifest.json`. Follow the adjacent README for
the Rust/WASM and four-ABI Android SDK recipes and their tests. All first-party
application sources and the patched Expo Camera are included in this checkout.

`pnpm export:android` checks the JavaScript bundle; it does not build or sign an
APK. A distributed Android release must additionally publish its exact native
build recipe, artifact hash and signing certificate fingerprint. An unsigned
rebuild must be compared with that signed artifact using a documented payload
comparison. No signed Android application is distributed by this source-only
candidate, and no native binary reproduction or independent review is claimed.

## Acceptance scope and known limits

Maintainer acceptance on September 18 used desktop Chrome and an Android
emulator. It covered long browser sessions, token refresh, historical pagination,
offline retry, SAS/QR verification, process restart and authenticated recovery
of 21 messages after both original devices were removed. Web and Android legacy
backup upgrades retained the recovery secret, identity and earlier backup versions;
a fresh Web SDK authenticated the Android-written backup. These are reported
live-service results, distinct from locally runnable tests in this repository.

The backup MAC is a VOLNA implementation of the pinned MSC4048 proposal, with
additional encrypted account/room/session/sender context; it is not an accepted
upstream standard. Missing or invalid provenance, plain imports and legacy
re-backups do not gain trust. A hostile server can still withhold or replay valid
backup entries. Possession of the recovery secret is inside the trust boundary.

Six Android crypto backup tests and eight strict-recipient tests passed separately
from the manager/Expo acceptance. The upstream non-strict crypto suite recorded
472 passes and one ignored test, plus 32 passing doctests and one ignored. The
strict feature suite recorded 440 passes and 40 failed upstream fixtures that
lack endpoint bindings; the full strict suite is not claimed green. Public Node
tests, the real FFI store test and four bridge unit tests are separate evidence.

Native iOS, physical devices and optical camera scanning are not accepted by this
release scope. Source publication, emulator compilation and bundle exports do
not imply those results. Matrix/MLS production gates remain closed in this
candidate; the separate MLS path retains its external witness-quorum requirement.
