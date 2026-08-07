# Contributing and review

VOLNA publishes this complete first-party client boundary so anyone can inspect,
test, and reproduce the source without access to the proprietary backend.

## Review setup

Use Node.js 20, 22, or 24 and pnpm 11.7.0:

```sh
pnpm install --frozen-lockfile
pnpm verify
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
