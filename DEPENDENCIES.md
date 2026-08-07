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

For each release candidate:

```sh
pnpm install --frozen-lockfile
pnpm audit --prod
pnpm verify
```

An audit result is time-scoped evidence, not a permanent guarantee. New advisories
must be evaluated against the locked graph before publishing another artifact.
