# VOLNA Matrix native contour

This Expo module pins the official Apache-2.0 Matrix Rust SDK FFI distributions:

- Android `org.matrix.rustcomponents:sdk-android:26.08.13` from Maven Central (downloaded AAR SHA-256: `52c689158138124d0e8d0a6d295a5bd5e1c7d38bc35dff90f0ec7eb2759163a8`).
- iOS `MatrixSDKFFI.xcframework` `26.08.11` from `matrix-org/matrix-rust-components-swift` (upstream SwiftPM checksum: `6d6ca99429491c50b6ba5138e640cf51087bb2a48c8a10213efed7709219ef72`).

Run `pnpm --filter @volna/matrix-native prepare:ios` on macOS before an iOS prebuild. The 280 MB binary is verified and remains an ignored build input, not a committed source artifact.

The current bridge deliberately exposes runtime attestation only. `matrix-engine-native.ts` remains fail-closed until the complete session, room, backup, verification, and encrypted-outbox adapter is implemented and physically tested on Android and iOS. Presence of the FFI binary alone is not a production E2EE claim.
