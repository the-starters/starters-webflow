# V3 browser scripts

## Scheduling auth

`scheduling-auth.js` owns the Bearer-token adapter for the V3 availability and
scheduling configuration calls. Webflow should load it with a small `defer`
script tag instead of carrying a duplicate copy in page head/footer code.

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/scheduling-auth.js"></script>
```

Current safety boundary:

- Runs only on `the-starters-3-0.webflow.io`.
- Does not change V2 or either V3 custom domain.
- Authenticates only paths beginning with `/api:tCpV3oqd/scheduler/configurations/`
  or `/api:tCpV3oqd/calendars/get_availabilities` on the configured Xano origin.
- Caches the Xano token and retries once after a `401`; a failed refresh returns
  the original `401`.
- Invalidates cached and in-flight authentication when the Memberstack session changes.
- Exposes `window.getXanoAuthToken` and `window.xanoAuthFetch` for page-owned
  code.
- Transparently wraps the two scheduling path families while legacy inline
  Webflow callers are migrated.
- Installs synchronously and takes ownership from the legacy bridge in
  `opportunities-3.0.js` regardless of script order.

Maintenance rule: new `api:tCpV3oqd` scheduling calls should use
`window.xanoAuthFetch`. Keep endpoint scope explicit; do not turn this into a
blanket credential injector.

Public helpers:

- `window.xanoAuthFetch(input, init)` accepts the same inputs as `fetch`, adds
  Bearer authentication for the two scoped path families, and rejects if initial
  token acquisition fails. Calls outside that scope and calls with an existing
  `Authorization` header pass through unchanged.
- `window.getXanoAuthToken({ forceRefresh: true })` returns the cached,
  member-scoped token or explicitly replaces it. The options argument is
  optional.

The transparent `window.fetch` wrapper exists only for legacy inline callers. If
initial token acquisition fails, it logs a warning and makes one unauthenticated
request; direct `xanoAuthFetch` callers receive the error. Both interfaces preserve
network rejections and reject with code `MEMBER_SCOPE_CHANGED` if the Memberstack
session changes while authentication or a scheduling request is in flight.

Run the focused test with:

```sh
node v3/scheduling-auth.test.js
```

## Booking-stage availability initializer

`scheduling-availability-init.js` restores the V2 visibility contract used by
the renamed `Starter Dashboard - Booking stage` page. Published CSS hides both
Calendar Settings controls; this initializer resolves the logged-in member's
saved scheduling availability and reveals exactly one:

- `[init-availability]` for first-time setup;
- `[update-availability]` for an existing saved schedule.

It is staging-hostname-only, uses a five-minute member-scoped local cache for saved
availability, accepts the legacy scheduling availability shape
(`{ items, manager? }`), and treats a V3 starter without a legacy scheduling row
as a first-time setup instead of leaving both controls hidden. It also selects
the correct initial modal step.
The initializer requires the page-provided
`window.getStarterByMemberId(memberId)` scheduling reader. The canonical profile
reader is not a fallback because its `Availability` field is the workload range,
not the legacy scheduling object. Failed or malformed reads, or a Memberstack
member change during the read, keep both actions hidden, set the document status
to `error`, and can be retried with
`window.StarterSchedulingAvailability.initialize()`.

Webflow markup contract:

- The first-time and saved-schedule controls use `[init-availability]` and
  `[update-availability]`, respectively.
- Modal panels use `availability-step="setup-form"` for first-time setup and
  `availability-step="default"` for an existing schedule.
- Published CSS should keep both controls hidden until initialization completes.

Runtime contract:

- `data-scheduling-availability-init` on the document root reports `loading`,
  `init`, `update`, `error`, `not-applicable`, or `missing-controls`.
- `window.STARTER_AVAILABILITY` contains the normalized availability after a
  successful read and is `null` after an error.
- `starterSchedulingAvailabilityReady` carries `{ memberId, source, state }`;
  `source` is `cache`, `starter`, or `default`, and `state` is `init`, `update`,
  or `null` when neither control exists.
- `starterSchedulingAvailabilityError` carries `{ message }` after a failed read.
- `window.StarterSchedulingAvailability` exposes `initialize()` for retries,
  `normalizeAvailability(value)` for the legacy object or JSON-string shape,
  and `renderState(availability)` for repainting the controls and initial step.

This module intentionally owns initialization and visibility only. The legacy
V2 form/configuration writer is not copied wholesale: it contains unrelated
dashboard behavior and unsafe historical browser integrations. Port the
remaining modal actions separately against an approved durable V3 scheduling
state endpoint.

Webflow staging loader:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@main/v3/scheduling-auth.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@main/v3/scheduling-availability-init.js"></script>
```

Run its focused test with:

```sh
node v3/scheduling-availability-init.test.js
```
