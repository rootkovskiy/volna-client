# Cryptographic dependency record

The production decision is pinned to exact versions; floating ranges are forbidden.
All direct JavaScript cryptographic dependencies currently declare the MIT license.
`pnpm-lock.yaml` is part of the public checkout boundary and records integrity hashes
for a standalone `--frozen-lockfile` install. Published tarballs include the exact
byte copy `pnpm-lock.public.yaml` because the npm pack format excludes the standard
lockfile name; the boundary verifier enforces equality. The exact development
toolchain is pinned in the package manifest as well.

| Component | Version | Role | Upstream |
| --- | ---: | --- | --- |
| `ts-mls` | `1.6.2` | RFC 9420 MLS state machine and wire format | `github.com/LukaJCB/ts-mls` |
| `@hpke/chacha20poly1305` | `1.7.1` | HPKE AEAD | `github.com/dajiaji/hpke-js` |
| `@hpke/common` | `1.9.0` | HPKE shared contracts | `github.com/dajiaji/hpke-js` |
| `@hpke/core` | `1.8.0` | HPKE core | `github.com/dajiaji/hpke-js` |
| `@hpke/dhkem-x25519` | `1.7.0` | HPKE X25519 KEM | `github.com/dajiaji/hpke-js` |
| `@noble/ciphers` | `2.1.1` | ChaCha20-Poly1305 and XChaCha local-state AEAD | `github.com/paulmillr/noble-ciphers` |
| `@noble/curves` | `2.0.1` | Ed25519 and X25519 | `github.com/paulmillr/noble-curves` |
| `@noble/hashes` | `2.0.1` | SHA-256 and HKDF | `github.com/paulmillr/noble-hashes` |
| `openmls` | `0.8.1` | Native/cross-implementation evaluation only | `github.com/openmls/openmls` |

The public React Native/Web transfer surface additionally pins Expo 54-compatible
`expo-camera` `17.0.10`, `expo-clipboard` `8.0.8`, `react-native-qrcode-svg`
`6.3.21`, `react-native-svg` `15.12.1`, and `lucide-react-native` `0.562.0`.
The public message surface additionally pins `socket.io-client` `4.8.3`,
`expo-audio` `1.1.1`, `expo-image` `3.0.11`, and `expo-location` `19.0.8` for
content-free realtime signals, explicit local playback, allowlisted public media,
and user-confirmed location attachment capture. These are UI/platform dependencies
rather than cryptographic primitives; their
exact development resolutions and integrity hashes are still retained in the
standalone lockfile because camera, clipboard, and QR behavior are part of the
reviewable transfer path.

Version pinning and permissive licenses do not establish security. The deterministic
release-evidence builder now emits a CycloneDX inventory for the complete pnpm/Cargo
verification locks plus a public source archive digest, but its manifest intentionally
records that the result is unsigned and not independently reviewed. Before rollout,
publish those artifacts, run cross-implementation vectors, open all transitive
dependencies and build features to public review, independently sign/co-sign the
native release, and publish the actual review scope and unresolved findings.
