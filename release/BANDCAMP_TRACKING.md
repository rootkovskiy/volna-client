# Daily Bandcamp release tracking

The label profile editor exposes an explicit opt-in checkbox below its Bandcamp
link. It uses the shared profile autosave: an 800 ms debounce, serialized writes,
visible save errors and a navigation guard that waits for the latest draft.
Changing or clearing the link clears the checkbox. Other community types do not
offer this setting. Changing it requires both profile-editing and music-management
permissions; the server checks these independently of client presentation.

The server checks opted-in label catalogs once every 24 hours. The first successful
check establishes a baseline. Later checks add newly discovered releases to the
label's discography. Re-enabling establishes a new baseline, so releases published
while tracking was off are not automatically backfilled. Existing full-discography
imports remain a separate operation. Tracking does not require an AI agent or an
open browser.

Provider item identities and durable import history prevent repeated imports,
including renamed release slugs and releases manually removed from VOLNA. Import
writes include their audit and search event in one database transaction. The
server rechecks current settings and permissions before accepting a fetched result.
Rate limits pause requests, failed items retry later, and manually edited metadata
is preserved. Public Bandcamp markup is an external dependency and can change.

`BandcampTrackingControl` is shared with the local-only `bandcamp-tracking` UI Kit
composition. Gallery toggles use fictional saves and do not enable monitoring.
The proprietary backend implementation and database are outside this public client
source boundary; this document describes the client-facing behavior.
