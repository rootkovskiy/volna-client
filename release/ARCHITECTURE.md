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

## Review map

Start a message-security review at:

1. `packages/volna-messaging-client/THREAT_MODEL.md`;
2. `src/secure-messaging-client.mjs` for lifecycle orchestration;
3. `src/mls-runtime.mjs` for MLS transitions;
4. `src/opaque-transport.mjs` for the server boundary;
5. `src/encrypted-message-store.mjs` for local projections;
6. `apps/mobile/src/messaging/secureMessaging.ts` for host integration.
7. `src/key-transparency.mjs` for sparse-map, RFC 6962, signed-note, and 2-of-3
   C2SP verification;
8. `packages/volna-key-transparency-log/` for the public Tessera personality and
   operator boundary;
9. `packages/volna-key-directory-witness/src/` only when reviewing the retained
   earlier semantic-witness reference path.

Some feature and StyleSheet modules are large because the current product
groups closely related screens and shared tokens by domain. This is tracked as
maintainability debt; it is not hidden behind a claim that source publication
alone makes the implementation independently verified.
