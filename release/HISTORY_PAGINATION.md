# Automatic chat history

Short conversations fill their viewport automatically. Long conversations open at
the latest messages and request earlier pages when the reader approaches the top.
The shared Web/native scheduler rechecks layout after each completed page,
including service-only pages that do not change the rendered height. A measured
message anchor preserves the reading position when older messages are prepended.

The ordinary load-history button is removed. A request shows the existing loading
indicator without changing row layout. Transport failure or five successive pages
without older visible messages offers the existing retry action. Retry resets the
bounded burst; visible message count never establishes SDK end-of-history.

Each page still enters the existing explicit `loadEarlier` controller path with
`markRead: false`, retaining audience, room, recipient, authenticity and deletion
checks. Existing foreground/bottom-of-chat read acknowledgement remains separate.
Requests coalesce, paused/background screens cannot initiate automatic pages, and
retired screen results cannot replace the current projection. A failed page keeps
the loaded messages and the composer draft.

Validation:

- `packages/volna-messaging-client/test/chat-history-pagination.test.js` executes
  the actual scheduler and page operation: short/service-only/end, long and
  slightly overflowing viewports, resize, busy/background/error fences,
  coalescing, bounded no-growth retry and stale completions.
- Existing runtime history regression tests retain their measured-anchor and
  departed-screen assertions with the current operation-generation fence.
- Local desktop-browser checks mount the actual `VolnaChatScreen` with fictional
  controllers: short history reaches its start automatically; long history opens
  at the bottom, prepends 30 rows while retaining the old first message at the
  reading position, then reaches the start on a second upward scroll. Drafts
  survive pagination and a failed request followed by retry. A stuck cursor stops
  after five requests. No real account, keys or messages are used by this fixture.
- The public `/ui-kit` `chat-history` specimen uses the real shared scheduler with
  local pages and the actual loading/retry presentation. It remains a composition,
  not a full conversation or a cryptographic acceptance fixture.

This change does not modify SDK pagination or encryption. Native source is shared
and typechecked; physical-device behavior and a new native binary are not claimed.
