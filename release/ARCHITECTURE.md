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

For an `MLS_V1` conversation, the API receives ciphertext and public protocol
metadata, not message plaintext or local search queries. A new device receives
authorization and an encrypted history snapshot through the QR/SAS-bound
transfer channel, then joins current chats with a fresh MLS device key. Old MLS
group state is not copied.

This describes the gated MLS path, not every chat in the current product.
Production E2EE enrollment and rollout are hard-disabled while the release
gates in `SECURITY.md` remain incomplete. Legacy chats remain server-readable;
the client must label them accordingly and must never present them as E2EE.

## Review map

Start a message-security review at:

1. `packages/volna-messaging-client/THREAT_MODEL.md`;
2. `src/secure-messaging-client.mjs` for lifecycle orchestration;
3. `src/mls-runtime.mjs` for MLS transitions;
4. `src/opaque-transport.mjs` for the server boundary;
5. `src/encrypted-message-store.mjs` for local projections;
6. `apps/mobile/src/messaging/secureMessaging.ts` for host integration.

Some feature and StyleSheet modules are large because the current product
groups closely related screens and shared tokens by domain. This is tracked as
maintainability debt; it is not hidden behind a claim that source publication
alone makes the implementation independently verified.
