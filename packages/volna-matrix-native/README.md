# VOLNA Matrix native contour

Android now attests `authenticated-backup-v1` only when the actual FFI capability
is version 1. Recovery verifies encrypted backup provenance inside Rust and
preserves it through SQLite reopen; it never trusts imported JSON or server
verification flags. Existing backups are upgraded without replacing recovery or
cross-signing keys or deleting prior versions. See `sdk/README.md` for the pinned
MSC4048 proposal and VOLNA encrypted-context extension. iOS has no such attestation
and remains outside this release scope. Production acceptance remains false.

This Expo module uses VOLNA-modified Apache-2.0 Matrix Rust SDK FFI builds with
an immutable endpoint-owned direct-room recipient policy. These are not official
upstream binary distributions. Source revisions, patches and artifact hashes are
in [`sdk/manifest.json`](sdk/manifest.json); build instructions are in
[`sdk/README.md`](sdk/README.md).

Historical upstream bases (never use these binaries as a policy fallback):

- Android `org.matrix.rustcomponents:sdk-android:26.08.13` from Maven Central (downloaded AAR SHA-256: `52c689158138124d0e8d0a6d295a5bd5e1c7d38bc35dff90f0ec7eb2759163a8`).
- iOS `MatrixSDKFFI.xcframework` `26.08.11` from `matrix-org/matrix-rust-components-swift` (upstream SwiftPM checksum: `6d6ca99429491c50b6ba5138e640cf51087bb2a48c8a10213efed7709219ef72`) plus its generated Swift UniFFI source archive (SHA-256: `e702d2243e5c50c3ea86c599676ad42ca68be032e010308b00231ca86f5b8340`).

Run `pnpm --filter @volna/matrix-native prepare:ios` on macOS before an iOS prebuild.
The script verifies the source archive and recipient patch, builds a custom
XCFramework and matching Swift API, and preserves previous vendor files in its
temporary workspace. It cannot run on Windows and never downloads an unguarded
upstream fallback. This is not signed or independently reproduced iOS evidence.

The package defines session, room/timeline, recovery, identity and SAS-verification interfaces. The current acceptance target is the Android implementation; iOS runtime parity is not claimed. An account-scoped session is restored into a 32-byte-key-encrypted Matrix SQLite store; Sliding Sync starts and stops with the session; deterministic encrypted rooms can be joined, paginated and observed; strict `social.volna.message.v1` events are queued through the Rust timeline; and explicit logout removes the native store. Recovery setup returns the one-time Matrix recovery key and recovery import restores cross-signing and room-key backup material through the SDK. Native clients select the official SDK's identity-based room-key recipient strategy, which excludes devices that are not signed by their owner. The public native manager binds those operations to VOLNA capability, one-time-login, device-registration and authenticated token-refresh checks, validates the exact room membership/state/power contract, verifies the displayed master/self-signing/device Ed25519 chain against the SDK-retained identity, keeps credentials and both retry queues encrypted with the device-only wrapping key, and projects plaintext only inside the endpoint process. Automatic Rust-SDK token refresh is disabled so it cannot bypass the VOLNA-session check. Runtime attestation advertises `session-lifecycle`, `room-timeline-v1`, `recovery-v1`, `identity-security-v1` and `sas-verification-v1`.

Native SAS emoji/decimal verification, cancellation and mismatch are implemented. The modified Android FFI also exposes SDK-owned verification QR through `qr-verification-v1`: generation, scanning and explicit display-side confirmation use the same selected device and session/flow fences. The iOS bridge does not attest this feature and keeps QR hidden; Web/PWA retains the Rust/WASM QR path. Android scanning requires the bounded binary `rawBytesBase64Url` extension in the pinned Expo Camera patch, because Unicode `rawValue` cannot preserve arbitrary Matrix key bytes. The September 18 release scope accepts Android-emulator and desktop-browser checks; physical devices and native iOS/macOS/Xcode are excluded requirements, not tested platforms. Matrix media uploads stay disabled; attachment cards use the existing credential-free VOLNA CDN policy outside Matrix. This bridge is not a production E2EE claim.

`history-pagination-v1` additionally requires every room snapshot to expose
`timelineId`, monotonic `revision` and SDK-derived `hasMoreHistory` (the SDK's
`paginateBackwards` returns true when history is exhausted). The bridge preserves
the SDK's full indexed vector, refreshes its listener's complete Reset before
resolving a page and fences retired listener generations. Never truncate that
vector independently of the SDK. The public manager coalesces pages, validates
each timeline and restores the loaded depth after token-driven SDK restart.
Android reducer JUnit tests and compilation pass; these checks do not establish
Swift compilation, native hardware performance or cross-device acceptance.

Android startup discovers and restores native Sliding Sync and waits for the
SDK's first-use identity initialization without replacing an existing identity.
It creates the async timeline before enabling its send queue and serializes the
full set of opened-room subscriptions. The pinned native timeline filter retains
exactly `social.volna.message.v1`; endpoint authenticity and envelope validation
remain separate mandatory checks. Expo values use signed JVM integers within
JavaScript's exact timestamp range and explicit `Unit` for void actions.

Android verification uses the pinned FFI's selected-user/device to-device SAS
request, avoiding identity-level DM creation or broad own-device requests.
Observers snapshot their flow delegate, current-SAS assignment checks the active
request, and Kotlin fences session/record callbacks and competing requests.
The test-only `scripts/native-chat-acceptance.tsx` runner in the application
repository exercises the actual manager/FFI/SQLite implementation. Refer to the
recorded run, not a successful compilation, for runtime acceptance.
