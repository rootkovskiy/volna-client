# Public source boundary

This package is licensed independently under Apache-2.0. No repository-level
license is implied for parent directories or sibling VOLNA packages.

The publishable archive is exactly the files admitted by `public-boundary.json` and
the package `files` list. `scripts/verify-public-boundary.mjs` fails if a source file
imports a parent/sibling application path, references local workspace paths, declares
the package private, omits the expected license, or contains obvious secret-bearing
filenames.
The standalone `pnpm-lock.yaml` prevents the public verification build from
silently inheriting dependency resolution from the proprietary monorepo. Because
npm tarballs hard-exclude that special filename, the publish archive carries a
byte-identical `pnpm-lock.public.yaml`; the boundary verifier rejects any mismatch.
The standard `packageManager` field is also duplicated in the retained
`volnaVerification.packageManager` field because npm tarball normalization removes
the standard field during packing.

The boundary includes the cryptographic runtime, opaque transport, Expo client
manager, device-security/transfer screen, dialog list, composer, renderer, local
previews and playback, edits/reactions, attachments, direct-share targets, and the
controller that selects explicit legacy or MLS transport. It also includes the
reference key-directory witness state machine: durable operators can reuse its
strict snapshot verifier and atomic compare-and-swap fork prevention without
receiving any message key or plaintext. The proprietary mobile
shell stores only route identifiers and provides content-free navigation/activity
callbacks. `scripts/verify-messaging-trust-boundary.mjs` in the integration
repository rejects reintroduction of plaintext message routes, duplicate closed
chat contracts, or a proprietary chat screen.

It also includes the dedicated encrypted message-projection store. The store derives
an independent key from the device-only wrapping key, uses opaque keyed record names,
authenticates bounded chunks, encrypted thread indexes and a journaled manifest,
migrates old monolithic projections, limits append-only persistence to tail chunks,
and fails closed on tampering. Local search scans decrypted projections inside this
public boundary; query text is not passed to the proprietary API.

The boundary also carries deterministic source-archive and CycloneDX evidence tooling.
Its manifest distinguishes byte reproducibility from signing and independent review;
the local generator never creates a false signer or auditor claim.

Message-supplied image URLs are attacker-controlled. Automatic rendering loads
only HTTPS objects from `media.volna.social`; arbitrary external artwork is not
fetched as a tracking pixel. External audio URLs require an explicit user action
and an HTTPS URL without embedded credentials.

Initial-activation recovery is part of this public boundary as well: the strict
replacement contract, fresh key-package claim, exact old-group binding, local
state/outbox purge, replacement Welcome handling, and no-downgrade controller are
inspectable and covered by public tests. The proprietary relay decides only whether
its content-blind timeout/no-envelope preconditions permit the operation.

Key-directory clients reconstruct an exact immutable cursor snapshot, then query
each pinned witness directly without VOLNA authentication data. The reference
witness signs only a fully verified continuation of the chain and refuses rollback
or a changed prefix after an atomic persistent checkpoint. The in-memory store is
test-only; an independent deployment must provide durable multi-instance
compare-and-swap storage and protect its signing key outside VOLNA control.

A closed host may provide narrow capabilities such as navigation or generic toasts
only when an enforceable process/origin boundary prevents it from observing or
modifying plaintext execution. Merely passing opaque callbacks is insufficient in
the same JavaScript realm or native process: closed code there can monkey-patch
network/storage primitives, wrap module exports, inspect UI state, or replace the
public code at build time.

VOLNA selected the complete-client option for source publication. The monorepo's
`client-public/` release contour (archived as `release/`) enumerates and verifies
the complete first-party Expo client source while excluding the proprietary API.
That closes the unpublished same-JavaScript-realm source gap, but it does not yet
prove that an installed native binary was built from those bytes. Resistance to a
malicious release owner still requires reproducible signed artifacts and independent
source-to-binary verification. Until that evidence exists, this package supports
the narrower claim that servers and operators cannot decrypt when the published
endpoint code is the code actually running.

The production backend is deliberately not required for confidentiality review. It
must be treated as hostile with respect to content and is constrained by the public
opaque-envelope/AAD contract. Existing server authorization remains necessary for
delivery, block enforcement, rate limiting, metadata isolation, and abuse control.
