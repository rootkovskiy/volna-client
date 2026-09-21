# Catalog city continuity

Selecting Moscow in Events previously lasted only until the next main-tab
navigation: that transition remounted `ScreenContinuityProvider`, restoring the
profile/GPS fallback (for example, Yekaterinburg).

`CatalogLocationProvider` now lives above that navigation reset, keyed by the
authenticated account. Events and Locations share an explicit city, country-only
or cleared selection. The Communities subcatalog keeps its independent choice.
Automatic nearby-city detection skips an explicit choice and discards late
results. The profile city and Connect location are unchanged. Other filters,
inner navigation and scroll positions retain their existing reset behavior.

Choices are bounded account-session memory. Logout/account changes and a full
application reload clear them; no browser storage or location coordinates are
added. The `location` UI Kit composition uses the real provider, remounts its
fictional selector between tabs, and makes no network or permission requests.

Regression checks: `node --test release/test/catalog-location.test.mjs`.
The release also runs boundary verification, client type checks and the existing
public test suites. This change does not modify messaging, encryption, SDKs,
dependencies, permissions or account/profile APIs.
