# Threat model

## Protected assets

- plaintext text, locations, shared references, edits, reactions, and deletions;
- MLS epoch secrets, device signing keys, local wrapping keys, and recovery secrets;
- decrypted local previews and search indexes.

## In-scope adversaries

- database, backup, object-storage, Redis, queue, log, metrics, or crash-data readers;
- an ordinary VOLNA administrator or operator with production data access;
- a compromised API/worker/realtime process that does not also compromise an
  authorized endpoint;
- another account attempting IDOR, cross-thread replay, device substitution,
  ciphertext mutation, downgrade, spam, or resource exhaustion;
- a message sender attempting passive IP/open tracking through forged image URLs;
- a malicious key directory attempting an unexplained device addition or rollback,
  which clients must make detectable and blocking.

Directory responses are bound to one immutable head and exact entry count across
all cursor pages. Before using the result, the public client directly queries
distinct pinned witness origins without VOLNA credentials and requires at least two
fresh Ed25519 statements for the exact account-label checkpoint. A missing witness,
truncated page set, changed snapshot, rollback, or changed prefix fails closed.
The public gossip monitor re-verifies and retains the signed checkpoint evidence in
an atomic store. It rejects per-witness rollback/equivocation, cross-witness
same-size split views, identity changes, timestamp rollback, and corrupted stored
evidence. Different-size statements alone are not a cryptographic consistency
proof; each independent witness must verify the complete append-only chain before
signing, while each endpoint pins the directory prefix it has accepted.

Local message projections are not persisted in the MLS runtime envelope. A separate
journaled store HKDF-derives its key from the device-only wrapping key, uses opaque
keyed storage names, and authenticates bounded chunks, encrypted per-thread indexes,
and an encrypted manifest. New chunks and indexes become durable before the manifest
points to them, so a crash keeps the last committed snapshot; append-only writes
reuse complete chunks, tampering fails closed, and orphaned records are removed.
Search scans only decrypted endpoint memory and never
sends its term to the service or a witness. This does not protect plaintext already
visible to a compromised authorized endpoint or hostile code in the same process.

The server/operator adversary above does not control the endpoint release that the
user chose to install. Resistance to an owner who also controls client builds is a
separate, currently unmet release-distribution property.

The public renderer never automatically loads message-supplied media from arbitrary
origins. It displays only HTTPS media from `media.volna.social`; external audio is
opened only after an explicit user action and only through a credential-free HTTPS
URL. This limits passive sender-controlled tracking but does not hide the user's IP
from a media provider the user explicitly chooses to play.

## Explicit limits

- an authorized compromised endpoint can read the content it displays;
- the service sees participants, device ids, timing, approximate size, delivery
  state, network information, and message frequency;
- the service can delete, delay, duplicate, reorder, or deny ciphertext;
- ordinary Web/PWA cannot resist malicious code newly served by the same origin;
- a public messaging module cannot resist proprietary code in the same process or
  JavaScript realm; that host can observe or alter plaintext execution;
- open source alone does not prove that a deployed binary matches the source;
- byte-reproducible public source/SBOM evidence is not a signed native build and does
  not establish who reviewed, built, or distributed the installed application;
- JavaScript runtimes do not guarantee deterministic secret zeroization from the
  garbage-collected heap, even though mutable byte arrays are cleared best-effort;
- the pinned `ts-mls` integration and VOLNA glue have not received an independent
  security audit and must not be described as audited;
- the witness-verification and checkpoint-gossip protocols are implemented, but no
  independently operated production witness or gossip service exists yet. Owner-controlled
  witness infrastructure would not satisfy the non-collusion assumption, so E2EE
  rollout remains blocked even though unconfigured clients already fail closed.

Device lifecycle changes use authenticated MLS Add/Remove Commits. A newly approved
device receives a Welcome for each conversation, and a revoked device remains a
cryptographic member until a verified Remove Commit advances the epoch. Application
sends fail closed while the server directory and MLS roster disagree. A malicious
relay can still stall this process, but it cannot make a removed device derive the
fresh epoch secret without breaking MLS.

## Recovery

An initial epoch-1 activation that never becomes ready can be replaced after the
server-owned transition deadline only if no ciphertext envelope exists and no
membership rekey is active. The replacement uses fresh one-time key packages and
the complete current device directory. Its Welcomes bind the new group to the exact
old group id. Endpoints erase the old local projection, stale activation state, and
queued ciphertext before persisting the replacement, so an old epoch-1 ciphertext
cannot be replayed into the new epoch-1 group. This is an availability recovery;
it never authorizes a plaintext fallback. A malicious relay can still keep denying
or delaying recovery, which is already within the service-denial limit above.

The recovery secret is the user-held account authorization key. VOLNA stores only
its public key and never a server-decryptable copy of the secret. The secret can
authorize a replacement device, but it does not contain MLS group state and cannot
restore old history by itself. Current history transfer requires a still-authorized
old device and a QR-bound encrypted channel; there is no server backup in this
version. Losing every device therefore loses old local history even if the recovery
secret survives, and losing both every device and the secret also prevents trusted
device recovery. Support staff cannot bypass either outcome by design.

The transfer relay sees the account, source/target device ids, timing, chunk count,
and bounded ciphertext sizes. It does not receive the QR secret, derived transfer
key, recovery secret, history plaintext, or MLS secrets. Transfer payloads are
XChaCha20-Poly1305 authenticated, chained by hash, bound to the exact target draft
and both ephemeral keys, and accepted only after the user compares the six-digit
short authentication string. Clipboard/manual-code fallback carries normal
operating-system clipboard exposure and is less preferable than scanning the QR.

## Legacy data

Legacy VOLNA messages were stored as server-readable fields. A later endpoint
re-encryption cannot make previous server access or backups cease to have existed.
The product must display the exact date/protocol boundary from which E2EE applies.
