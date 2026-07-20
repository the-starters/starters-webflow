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
- Authenticates paths beginning with `/api:tCpV3oqd/scheduler/configurations/` or
  `/api:tCpV3oqd/calendars/get_availabilities`, plus the exact
  `/api:tCpV3oqd/starter/get_by_memberstack` path, on the configured Xano origin.
- Caches the Xano token and retries once after a `401`; a failed refresh returns
  the original `401`.
- Invalidates cached and in-flight authentication when the Memberstack session changes.
- Exposes `window.getXanoAuthToken` and `window.xanoAuthFetch` for page-owned
  code.
- Transparently wraps the two scheduling path families and exact legacy starter
  endpoint while legacy inline Webflow callers are migrated.
- Installs synchronously and takes ownership from the legacy bridge in
  `opportunities-3.0.js` regardless of script order.

Maintenance rule: new `api:tCpV3oqd` scheduling calls should use
`window.xanoAuthFetch`. Keep endpoint scope explicit; do not turn this into a
blanket credential injector. The availability-writer endpoints
(`starter/update_availability/v3`, `starter/set_timezone`,
`starter/clear_calendar_data`, `grants/oauth`, `grants/create_virtual_account`,
`grants/create_virtual_calendar`, `grants/add_virtual`, `grants/delete`,
`nylas_configurations/get_all`) are listed as exact paths for
`scheduling-availability-writer.js`.

Public helpers:

- `window.xanoAuthFetch(input, init)` accepts the same inputs as `fetch`, adds
  Bearer authentication for the scoped scheduling paths and exact legacy starter
  endpoint, and rejects if initial token acquisition fails. Calls outside that scope
  and calls with an existing `Authorization` header pass through unchanged.
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
The initializer reads `/api:tCpV3oqd/starter/get_by_memberstack` through
`window.xanoAuthFetch`, safely treating a JSON `null` response as a first-time
V3 starter. It falls back to the page-provided
`window.getStarterByMemberId(memberId)` only when the auth helper is unavailable.
The canonical profile reader is not used because its `Availability` field is the
workload range, not the legacy scheduling object. Failed or malformed reads, or a
Memberstack member change or logout during the read, keep both actions hidden and
set the document status to `error`; when the live Memberstack client is available,
its logged-out result is authoritative over stale `memberReady` data. Initialization
can be retried with
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
  `source` is `cache`, `starter`, `default`, or `query-test`, and `state` is
  `init`, `update`, or `null` when neither control exists. For `query-test`,
  `memberId` is the selected test member rather than the authenticated member.
- `starterSchedulingAvailabilityError` carries `{ message }` after a failed read.
- `window.StarterSchedulingAvailability` exposes `initialize()` for retries,
  `normalizeAvailability(value)` for the legacy object or JSON-string shape,
  and `renderState(availability)` for repainting the controls and initial step.

This module intentionally owns initialization and visibility only. The writer
flow lives in `scheduling-availability-writer.js` (below).

Webflow staging loader:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@main/v3/scheduling-auth.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@main/v3/scheduling-availability-init.js"></script>
```

Temporary staging QA override (`?test_member_id=`):

- On `the-starters-3-0.webflow.io` only, an allowlisted Memberstack Test-Data
  sandbox member ID may be supplied via the `test_member_id` query parameter,
  e.g. `https://the-starters-3-0.webflow.io/starter-dashboard---availability-stage?test_member_id=mem_TEST_ID`
  (placeholder — the real allowlist lives in `TEST_MEMBER_ALLOWLIST` in
  `scheduling-availability-init.js`; never allowlist a live member ID).
- The override is read/UI-state only: it changes which member's legacy
  availability is read and which control (`Connect Calendar` vs
  `Manage availability`) renders. It never bypasses Bearer authentication or
  server ownership checks — `xanoAuthFetch` still authenticates as the
  logged-in tester — and it is never used for profile or scheduling writes.
  A tester who needs to submit changes must log in as that member.
- The override requires `window.xanoAuthFetch`; if the authenticated reader is
  unavailable, initialization fails closed instead of using the page-provided
  unauthenticated fallback.
- Malformed values and values not in `TEST_MEMBER_ALLOWLIST` are ignored with a
  concise console warning (the supplied value is not echoed), and the
  authenticated member is used as before. A missing parameter silently keeps
  the default authenticated-member behavior.
- Once an override is accepted, the document root carries
  `data-scheduling-test-member="true"` (including after a subsequent read
  error), and a successful ready event reports `source: "query-test"` with the
  override ID as `memberId`.
- Cached availability stays member-scoped: the override ID gets its own
  five-minute cache entry and never reuses the authenticated member's cache.
- ⛔ **LAUNCH BLOCKER**: remove the override (`TEST_MEMBER_*` constants,
  `resolveTestMemberOverride`, and this section) before enabling this script
  on `thestarters.com` / `www.thestarters.com`. It is independently
  hostname-gated as defense in depth, but must not ship to the custom
  production domains.

Run its focused test with:

```sh
node v3/scheduling-availability-init.test.js
```

## Booking-stage availability writer

`scheduling-availability-writer.js` is the versioned port of the legacy V2
availability writer for the same page: availability form submit, manager
selection (platform-managed virtual calendar vs the member's own calendar),
Nylas scheduler configuration create/update, timezone set, and the calendar
OAuth grant redirect — with the loader (`[data-custom-loader]`) and the
success/error modal steps restored. It loads after `scheduling-auth.js` and
`scheduling-availability-init.js`:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/scheduling-auth.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/scheduling-availability-init.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/scheduling-availability-writer.js"></script>
```

(`@latest` resolves the highest semver tag — releases go through the
`webflow-cdn-release` tag + purge pipeline.)

Safety boundary:

- Staging-hostname-only, same as the other two modules.
- Hard-requires `window.xanoAuthFetch`; without it the writer disables itself
  (`data-scheduling-availability-writer="missing-auth"`) instead of falling
  back to unauthenticated writes.
- Write payload `member_id` always comes from the live authenticated
  Memberstack session, re-verified per write; a member change after bootstrap
  aborts the write. The `?test_member_id` read override disables the writer
  entirely (`blocked-test-member`) so a QA view can never submit another
  member's schedule.
- Consumes the availability state seeded by the init module
  (`window.STARTER_AVAILABILITY` / `starterSchedulingAvailabilityReady`) and
  refreshes the init module's member-scoped cache after successful writes. The
  legacy unscoped `starter-availability` localStorage key is gone; the
  timezone cache is member-scoped (`starter-timezone:<memberId>`).

Legacy UI-step semantics kept. Published-markup audit (2026-07-21) of the
`dialog[data-modal-target="set-availability"]` shell — the lumos modal engine
owns open/close via the hero `data-modal-trigger` buttons (which are also the
`[init-availability]`/`[update-availability]` controls); the writer only
switches steps inside it. All **11** step wrappers exist:

| `availability-step` | contents the writer drives |
| --- | --- |
| `default` | card list + template (template sits **outside** `[availability-list]`), `availability-create/edit/remove`, `how-to-manage`, `[config-manager-element]` with `change-manager-link` buttons (platform → `how-to-manage`; calendar → `disconnect-confirm` with `data-to="disconnect-calendar"`), `config-initial-element="general"` |
| `setup-form` | `[availability-form]` (3 `set-availability-group` wrappers: days/start/end), back → default, `submit` + `[btn-text]`, `config-initial-element="setup-form"`, loader |
| `how-to-manage` | two `[config-manager]` tiles (platform pre-`is-active`), `manager-submit`, back, loader |
| `disconnect-calendar` | confirm screen: `disconnect-calendar` action, back, loader |
| `virtual-connect`, `pre-redirect` | passive status screens |
| `success`, `success-disconnect`, `config-request-error` | back → default |
| `success-calendar` | `pre-redirect` action |
| `reload-page` | `[availability-popup-close]` |

Only `setup-form`, `how-to-manage`, and `disconnect-calendar` carry a
step-scoped `[data-custom-loader]`; `setLoader` is a safe no-op on the rest
(one extra modal-level loader sits outside the steps).

Markup gaps found by the audit (writer degrades gracefully, flagged for
Designer follow-up):

- no `#price` input exists in the form, so the paid-call rate falls back to
  the `paid_call_rate` localStorage value or `0` — decide where the 3.0 rate
  comes from before enabling paid configs;
- no `[starter-timezone]` label element exists, so the timezone text renders
  nowhere (resolution/persistence still runs);
- no `availability-popup-close="pre-redirect"` variant exists (both close
  controls are plain), so the legacy manager-restore close branch is
  currently dead but harmless.

Deliberately NOT ported from the legacy inline writer:

- the hardcoded test member id and dashboard/onboarding redirects;
- the `dev-speed-test` localStorage payload override;
- the `availability-popup-shown` auto-open behavior (the init module owns
  initial visibility);
- the bookings list machinery — the writer delegates to the page embed's
  `window.generateBookingsList` / bookings-aware `window.clearGrantData` when
  present, and otherwise falls back to a minimal authenticated grant clear
  (`starter/clear_calendar_data` + configuration deletes + `grants/delete`).
- One deliberate behavior fix: a failed configuration update no longer falls
  through to the `success` step (legacy phantom-success bug).

V3 endpoint contract (no Airtable row keys anywhere): the writer calls
`grants/oauth/v3` with `in_state: <authenticated member id>` and
`grants/add_virtual/v3` with `{ grant_id, member_id }`. Both are new
memberstack_id-keyed endpoints; the legacy airtable_id-keyed
`grants/oauth`/`grants/add`/`grants/add_virtual` remain untouched for V2. The
OAuth return is handled by `v3/connect-success.js` via `grants/add/v3`
(server-side code exchange + persist in one call).

Paid-call rate: resolved from the form's `#price` input
(`data-rate`/value, Designer-bound like V2) with the shared `paid_call_rate`
localStorage key as fallback. When no positive rate resolves, the paid
configuration is **not created** (no bookable $0 paid calls); existing paid
configs still get availability updates. The scheduling `freelancers` table
(#12) has no rate column — wiring a durable v3 rate source is a follow-up.

Runtime contract:

- `data-scheduling-availability-writer` on the document root reports
  `loading`, `ready`, `not-applicable` (no `[availability-form]`),
  `missing-auth`, `blocked-test-member`, or `error`.
- Events: `starterSchedulingWriterReady` `{ memberId }`,
  `starterSchedulingWriteSuccess` `{ action }`, and
  `starterSchedulingWriteError` `{ action, message }`.
- `window.StarterSchedulingAvailabilityWriter` exposes `initialize()` for
  retries plus `switchStep`, `daysAlias`, and `getAvailArray`.

Run its focused test with:

```sh
node v3/scheduling-availability-writer.test.js
```

## Calendar OAuth return (no separate page)

There is no `/connect-success` page in V3. `grants/oauth/v3` redirects the
OAuth tab straight back to the Booking-stage page with `?code&state`, and the
availability writer handles the return during bootstrap: it strips the params
from the URL, verifies `state` (set server-side from the caller's Bearer
token) against the logged-in member, exchanges + persists the grant through
`grants/add/v3` (one authenticated call; the code exchange happens in Xano),
and then continues the normal `?calendar` connect flow. The original tab shows
the modal's `reload-page` step, matching the legacy UX. Booking
confirmation/reschedule/cancel links baked into scheduler configurations also
point at this page, where the bookings embed owns `booking_ref` handling.

Xano endpoints (created 2026-07-21, group `api:tCpV3oqd`, all Bearer-required
via `auth = "user_v3"` with token-member == `member_id` preconditions,
memberstack_id-keyed, Memberstack key from `$env.memberstack_api_key`):
`grants/oauth/v3` (id 1456), `grants/add/v3` (id 1457),
`grants/add_virtual/v3` (id 1455). Sources backed up in
`platform-ops/architecture/xano-scheduling-v3-endpoints-20260721/`. The legacy
airtable_id-keyed endpoints are untouched for V2.

Availability writes go to `starter/update_availability/v3` (id 1463), an
UPSERT: new V3 starters have no legacy scheduling `freelancers` row
(`new_member/v3` only writes `user_v3`), so the first save creates it, seeded
server-side with the auth user's name/email and the writer's `in_timezone`.
Edits update `availability` only.

⚠ XanoScript trap found while building it: `db.edit` auto-binds request
inputs whose names match table columns — an optional `timezone` input, when
absent, silently wiped the stored timezone on every edit. Endpoint inputs must
avoid column names (hence `in_timezone`).

⚠ The OAuth `redirect_uri` in endpoints 1456/1457 is pinned to the published
slug `/starter-dashboard---availability-stage`. If the page rename ships with
a new slug, update both endpoints in the same change.
