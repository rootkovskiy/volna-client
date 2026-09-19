# VOLNA strict-recipient Matrix builds

Apache-2.0 source patches and integrity-pinned custom Matrix artifacts live here.
These are VOLNA-modified builds, not upstream-official distributions. The SDK
must enforce an immutable endpoint-selected own/peer room binding at key sharing;
the JavaScript/native facade is not itself the security boundary.

Web base: `matrix-sdk-crypto-wasm` 18.5.0, commit
`93abc64b195b24a1335a3e796a16f4e3ccf0e3e1`, with its locked Rust SDK
`955837c4677cd7e92e79447169b69666c0debae6`.
Android base: Rust SDK `1e6a409be052f35e0021538212e116b3a86edaa8`.
iOS base: Rust SDK `15a3ce2369a1e96fcad02cb2b1da3198ef23348a`.

`manifest.json` pins archives, source patches and the installed custom artifacts.
Production remains disabled. Compiler or emulator success is not signed-binary
or independent-reproduction evidence. The current September 18 release scope is
desktop browser plus Android emulator; native iOS and physical-device checks are
excluded requirements, not successful checks.

## Android

Web/WASM and Android additionally require authenticated-backup capability version
1. The backwards-compatible v1 MAC follows the MSC4048 proposal pinned at
`20b767f5f4ac616b10237c2fb23a1b4bfc8baa3f`: HKDF-SHA256 over the backup secret with
info `MATRIX_BACKUP_MAC_KEY`, then HMAC-SHA256 over canonical encrypted session
data excluding `unsigned`/`signatures`. The unpadded tag is stored in
`unsigned.org.matrix.msc4048.backup_mac`. Existing Vodozemac v1 encryption remains.
This is a VOLNA-modified proposal implementation, not an accepted upstream
standard or an independent cryptographic audit.

The encrypted `social.volna.backup_context` version 1 binds the account, room,
intrinsic Megolm session ID and SDK-established sender data. Only the Rust
ciphertext importer can restore its sealed provenance after checking the locally
held backup secret, MAC and context. Plaintext key imports, server metadata and
facade booleans cannot grant it. Missing MACs stay untrusted; invalid present MACs
are rejected before decryption; backing up legacy keys never authenticates them.
Exact sender/identity, recipient and history-deletion checks still apply.

Legacy migration creates a new signed backup version with the same recovery
secret, preserving old server versions and cross-signing/SSSS keys. Signed
auth-data fields are `social.volna.authenticated_backup: 1` and optional
`social.volna.backup_parent_version`. Recovery imports at most one same-public-key
predecessor before the current version, without following a recursive chain.
The outer `is_verified` flag is only a server replacement preference for proven
SDK origin; it is not peer SAS and is never trusted by the importer. Identity
provenance improvements requeue backup upload. Encrypted store reopening retains
the authenticated provenance without marking it as a live Olm receipt.

Each encrypted session is bounded to 64 KiB; native download import chunks at 200
entries, the core importer accepts at most 1024, and WASM input is bounded to 8
MiB. These bounds and real lost-device recovery checks are separate evidence
from throughput or complete-history testing of arbitrarily large backups.

The Android FFI patch also exposes SDK-owned verification QR. The application
must install the pinned Expo Camera patch and include `expo-camera` in
`expo.autolinking.android.buildFromSource`; a precompiled camera AAR omits its
binary-barcode extension. QR confirmation never substitutes for historical
sender-authenticity or strict-recipient checks.

Use `prepareSdkSource('android')` from `scripts/prepare-sdk-source.mjs` to download,
hash-check and patch an isolated source tree. On Linux/WSL with Rust 1.95.0,
Clang/CMake/Ninja/pkg-config/OpenSSL/protobuf tools and NDK r27d installed, run:

```sh
bash scripts/build-android-rust.sh PATCHED_SOURCE NDK_R27D OUTPUT
gradle -p sdk/android-build -PmatrixGeneratedDir=OUTPUT assembleRelease
gradle -p sdk/android-build -PmatrixGeneratedDir=OUTPUT connectedDebugAndroidTest
```

Use Gradle 8.13, JDK 17 or 21 and Android SDK 35 for the AAR. Gradle can run on
Windows against the generated WSL output copied into a Windows directory. The
Rust script builds all four ABIs and generates Kotlin from that exact binary.
It links and checks every ELF load segment with 16 KiB alignment for Android's
larger-page devices; a 4 KiB-only output fails the build script.
The emulator instrumentation calls the real FFI and checks immutable
encrypted-store binding across reopening. The separate test-only Expo harness
in `scripts/native-chat-acceptance.tsx` at the application root exercises the
actual manager/bridge/session/history paths; its runtime result must be recorded
separately from compilation. The patched SDK timeline retains the exact
`social.volna.message.v1` envelope rather than filtering it as an unknown type.
Updating an artifact requires updating its manifest digest and rerunning checks;
never silently substitute Maven's upstream AAR.

`scripts/stage-android-artifact.mjs` validates that a built AAR contains all four
ABIs and splits it into deterministic 48 MiB parts for Git's blob-size limit.
Update the manifest with its printed checksums. Gradle verifies every part and
the combined digest before reconstructing the AAR in the ignored build directory.
On Windows, build the full exported client from a short path with an isolated
`pnpm install --frozen-lockfile --ignore-scripts --config.node-linker=hoisted`;
long monorepo pnpm paths can make CMake/Ninja fail before application compilation.

## Web

Extract the pinned WASM source and pinned web Rust source side-by-side as
`matrix-sdk-crypto-wasm-93abc64` and `matrix-rust-sdk-955837c`. Apply their respective
hash-checked patches. In the WASM directory, use Rust 1.95.0:

```sh
cargo build --locked --release --target wasm32-unknown-unknown
wasm-bindgen --target bundler --out-dir pkg --weak-refs target/wasm32-unknown-unknown/release/matrix_sdk_crypto_wasm.wasm
node PATH_TO_MODULE/scripts/finalize-wasm-package.mjs .
node PATH_TO_MODULE/scripts/test-built-wasm.mjs .
npm pack --ignore-scripts
```

Pin `wasm-bindgen-cli` to 0.2.126 and Node to 24.19.0. The custom package contains
the versioned same-origin Metro loader. Its embedded git string is not provenance:
the source archives were built without a Git HEAD, so use manifest revisions and
patch hashes. The full client workspace also requires the pinned JS facade patch.

## iOS

`node scripts/prepare-ios-framework.mjs` builds the patched pinned source with
Xcode on macOS for device ARM64 and both simulator architectures. It does not
download an old upstream binary as a fallback. Windows cannot execute this build.
Generated Swift inputs must contain both recipient methods. The resulting local
artifact remains unsigned and untested until a separately scoped native iOS
acceptance run. It is not a requirement of the current Android/browser release.
