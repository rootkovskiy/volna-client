# Client architecture

## Executable boundary

- `app/` is the Expo Router entry surface.
- `apps/mobile/App.tsx` coordinates session restoration, navigation, realtime
  lifecycle, and feature screens. Feature behavior remains in `src/` modules.
- `apps/mobile/src/api/client.ts` is the sole authenticated HTTP/session
  adapter. Native bearer tokens are memory-backed and persisted only through
  SecureStore; Web uses first-party cookies.
- `packages/volna-messaging-client/` owns all private-message plaintext,
  cryptographic state, MLS processing, endpoint projections, and transfer UI.
- `packages/volna-key-directory-witness/` is a separate Node/PostgreSQL service
  containing the earlier semantic-witness reference implementation. It remains
  published for review and compatibility evidence but is not the selected
  production activation path and is never bundled into Expo.
- `packages/volna-key-transparency-log/` is the separately deployed
  C2SP/Tessera tile log for globally batched key-transparency map roots. It is
  VOLNA-operated, externally cosigned, and never bundled into Expo.
- `matrix/` contains the inspectable Synapse login/policy module and hardened
  configuration templates. Synapse itself is a separately deployed AGPL-3.0
  service and is never bundled into Expo.
- `packages/content-policy/` and `packages/music-taxonomy/` are shared pure
  domain packages.
- `public/` contains the PWA boot document, manifest, icons, and service worker.

No proprietary backend module is linked into this graph. The release boundary
checker scans every selected text source for relative imports that escape the
published tree and for server-only package imports.

## MLS/E2EE messaging trust path

```text
public UI/composer
  -> public messaging controller
  -> MLS + encrypted local projection
  -> opaque transport
  -> proprietary server storing ciphertext and public protocol metadata
```

Directory verification follows a separate path. The proprietary API maintains the
account-master-authorized semantic directory chain and commits each current
directory to a 32-level radix-256 sparse Merkle map. At most once per second, the
latest global map root is appended to the public C2SP/Tessera log. The client
verifies the complete directory chain, compressed map inclusion proof, RFC 6962
log inclusion proof, VOLNA log signature, and fresh signatures from any two of
three pinned independent C2SP witnesses. Witnesses receive only the global public
checkpoint and enforce log append-only consistency; they do not receive account
ids, usernames, device lists, VOLNA cookies, or message data. A newly registered
device stays `PENDING_TRANSPARENCY` until this proof exists, while already active
devices remain usable during a witness outage.

For an `MLS_V1` conversation, the API receives ciphertext and public protocol
metadata, not message plaintext or local search queries. A new device receives
authorization and an encrypted history snapshot through the QR/SAS-bound
transfer channel, then joins current chats with a fresh MLS device key. Old MLS
group state is not copied.

This describes the gated MLS path, not every chat in the current product.
Production E2EE enrollment and rollout are hard-disabled while the release
gates in `SECURITY.md` remain incomplete. Legacy chats remain server-readable;
the client must label them accordingly and must never present them as E2EE.

## Matrix messaging path

```text
public VOLNA UI/codec
  -> Web/PWA matrix-js-sdk Rust/WASM crypto
  -> encrypted Matrix room event
  -> Synapse storing ciphertext and Matrix metadata
```

`MATRIX_V1` is a development-only headless-engine path. VOLNA issues a one-time
login grant, maps existing `ChatThread` participants to pseudonymous Matrix ids,
and retains room membership/state control. Synapse checks the current VOLNA
block/privacy policy before accepting every encrypted send and rejects every
user-authored plaintext event. Ten-minute access tokens refresh only after an
authenticated VOLNA-session check. Each exact Matrix device is registered to its
VOLNA session: logout/session expiry removes it, account deletion/suspension
removes all devices and memberships, and blocks remove both direct-room members.
Failed Synapse lifecycle commands retry from critical Redis. Text, reactions,
music, locations and entity cards use the same bounded public VOLNA event codec
inside ciphertext; old legacy history remains visibly server-readable.

Web/PWA dynamically loads `matrix-js-sdk` 42.1.0 only from the messaging surface.
Its public security sheet owns Matrix cross-signing, signed-device isolation,
identity-change warnings, SAS emoji/decimal and QR verification, secret-storage
setup, one-time recovery-key display/import and room-key backup recovery. An
encrypted local message outbox and a separate encrypted content-free notification
queue survive endpoint restart; the API validates the exact encrypted Matrix event
before committing generic push/realtime delivery. `packages/volna-matrix-native`
pins official Android/iOS Rust FFI artifacts, but native clients fail closed until
the complete manager adapter and physical tests exist. The old MLS witness policy
does not authenticate Matrix device keys and independent witnesses are not a
Matrix release dependency. Production configuration rejects Matrix enablement
until the remaining native/artifact gates are complete.

## Review map

Start a message-security review at:

1. `packages/volna-messaging-client/THREAT_MODEL.md`;
2. `src/secure-messaging-client.mjs` for lifecycle orchestration;
3. `src/mls-runtime.mjs` for MLS transitions;
4. `src/opaque-transport.mjs` for the server boundary;
5. `src/encrypted-message-store.mjs` for local projections;
6. `src/matrix-engine-web.ts` and `src/matrix-message-codec.mjs` for Matrix;
7. `matrix/synapse/volna_matrix_module.py` for one-time login and send policy;
8. `apps/mobile/src/messaging/secureMessaging.ts` for host integration;
9. `src/key-transparency.mjs` for sparse-map, RFC 6962, signed-note, and 2-of-3
   C2SP verification;
10. `packages/volna-key-transparency-log/` for the public Tessera personality and
   operator boundary;
11. `packages/volna-key-directory-witness/src/` only when reviewing the retained
   earlier semantic-witness reference path.

Some feature and StyleSheet modules are large because the current product
groups closely related screens and shared tokens by domain. This is tracked as
maintainability debt; it is not hidden behind a claim that source publication
alone makes the implementation independently verified.
