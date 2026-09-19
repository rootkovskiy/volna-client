# Contributing and review

VOLNA publishes this complete first-party client boundary so anyone can inspect,
test, and reproduce the source without access to the proprietary backend.

## Review setup

Use Node.js 22 or 24 and pnpm 11.7.0:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm verify:openmls
pnpm audit --prod
pnpm export:web
pnpm export:android
pnpm export:ios
```

The same commands run in GitHub Actions. Dependency versions are exact or frozen
in `pnpm-lock.yaml`; do not update the lockfile without explaining the resolved
graph change and rerunning every command above.

The root `.gitattributes` disables automatic line-ending conversion so Git blobs
remain byte-identical to the deterministic source archive on every platform.

## Check a published release yourself

See [RELEASE.md](RELEASE.md) for the complete Web post-processing, WASM packaging,
artifact comparison commands and the exact distinction between bundle exports,
native application builds and reported live-service acceptance.

Use the exact published tag/commit, not a moving branch. Release notes must name
the source archive/tree hashes, dependency inventory, toolchain versions, public
build settings and the hashes of the distributed artifacts. Publish every build
or post-processing step needed to reproduce those artifacts, including the custom
Matrix SDK patches and their recipes in `packages/volna-matrix-native/sdk/README.md`.
No proprietary backend source, production account or private signing key may be
needed to inspect, compile or test the client. Live-service acceptance evidence
must be distinguished from tests that anyone can run locally.

After the frozen installation and checks above, generate source evidence with:

```sh
pnpm release:evidence --output artifacts/evidence
```

Compare the resulting source-tree manifest and dependency inventory with the
published release evidence. Rebuild the relevant Web/Android artifact using the
recorded recipe; a JavaScript export alone is not a rebuilt Android APK. Inspect
any difference rather than declaring a match. Android verification must account
for the published signing certificate and the documented signed/unsigned payload
comparison procedure; readers do not receive the private signing key. A matching
source archive alone does not establish a matching executable or a security audit.

Review is voluntary and continuous. No assigned outside reviewer, external
co-signature, commissioned audit or waiting period is required before release.
Maintainers still publish actual checks, failures/limitations and artifact-to-source
evidence. Do not set `signed`, `reproducibleNativeBinary` or
`independentlyReviewed` to true merely because source is public. Web users still
trust the origin to serve the code they inspected.

## Changes

Keep pull requests small and state the security invariant or user behaviour they
preserve. Add a regression test for fixes. Never commit credentials, production
message content, recovery secrets, device keys, private environment files, or
proprietary backend source.

Changes to messaging cryptography, device lifecycle, local encrypted storage,
key-directory verification, opaque transport, media policy, or the public source
boundary require security-focused review and fresh deterministic release evidence.

## Security reports

Do not publish an exploitable vulnerability or real user data in an issue. Follow
the private-reporting instructions in [SECURITY.md](SECURITY.md). Ordinary design,
documentation, testing, and non-sensitive correctness discussions may use public
issues and pull requests.
