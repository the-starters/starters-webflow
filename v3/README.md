# V3 browser scripts

## Login router

`auth-route.js` owns post-login and post-signup routing for V3 without changing
the shared Memberstack plan redirects used by V2. Install it only on the V3
`/login` and `/auth-route` pages. It runs on the V3 Webflow staging hostname and
both custom domains; see [AUTH-ROUTE-WIRING.md](AUTH-ROUTE-WIRING.md) for the
installation, error contract, and release gate. The versioned
[V3 Member Access Matrix](ACCESS-MATRIX.md) maps stable plan IDs to roles and
documents route access plus the separate Webflow, content, and Xano enforcement
layers.

The V3 opportunity and Messages guards send logged-out visitors to
`/login?next=<encoded current path and query>` so the router can restore an
allowed destination after login.

## Talent applications admin

`../code-components/` contains the parked, preparation-only React **Talent
Applications Admin** Code Component. It reviews the Xano-canonical V3 application
queue, loads application details and audit events, and submits notes, interview
links, and guarded status transitions with optimistic concurrency. It has no
Airtable, Make, or Zapier integration and does not replace or modify existing
Admin Ops, Marketing Ops, or V2 application workflows.

The Webflow registration exposes only the dashboard title and login URL, leaving
the component on its `Staging` API default. This foundation is not production-ready:
it has not been imported into Webflow or published on a page, and it must not be
tagged or deployed through jsDelivr before a separate cutover review. Memberstack
supplies the browser session, the shared trade-token endpoint returns a Xano token,
and the Xano
`admin/session` plus application endpoints remain the staff authorization and
data boundary. The browser's transition map is not an authorization control.

See [`../code-components/README.md`](../code-components/README.md) for package
commands, Designer properties, endpoint payloads, pagination behavior, status
transitions, security requirements, and the production-cutover constraint.

## Talent application intake

`talent-application.js` owns the apply-form submission on
`/freelancer-application/step-1`. It listens in capture phase so it runs before
Webflow's delegated submit handler and the multistep library's final-submit
behavior. It deliberately suppresses the native Webflow submission because
Zapier is no longer the application intake path, then posts JSON to Xano's
`talent/application/create` endpoint. Xano owns the authoritative application
row and mirrors it to the Airtable review table server-side.

Install the script on step 1 only:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/talent-application.js"></script>
```

Webflow contract:

- Keep `application-form` on the form itself:
  `<form application-form>`. Generated IDs and styling classes are not selector
  fallbacks.
- Keep the form inside its `.w-form` wrapper with a `.w-form-fail` block. A
  failed request reveals that block and re-enables the submit control for retry.
- Set the form's `data-redirect` to `/freelancer-application/step-2`. The
  script also accepts `redirect` and otherwise defaults to that path.
- Remove any other custom submit interceptor from this form. The native
  Webflow/Zapier submission is intentionally not allowed to run.

The request maps the form's `email`, `first-name`, `last-name`, `phone`,
`linkedin`, `profile-type`, `function`, `referral-source`, `country`, and
`city` fields to the Xano intake contract. It selects `consult-option` and
`rate-consult` for a `Consult Only` profile; otherwise it selects
`role-option` and `rate`, with the other pair retained as a fallback. All
string form fields are also sent in `answers`; repeated field names are joined
in submission order, and non-string values such as file objects are ignored.
Because the runtime-built `country` and `state` selects store numeric option
indexes, the request resolves the selected `country`, `state`, and `city`
options to their visible text. The top-level `country` and `city` fields and
their entries in `answers` use that text; `state` is recorded in `answers`.
Empty placeholder options do not override the raw empty form values.

Any successful HTTP response containing an application `id` continues to the
redirect, including Xano's successful response for a duplicate open
application with the same email. A non-success HTTP status, malformed response,
or response without an `id` stays on step 1 and exposes the retry state.

Run the focused test with:

```sh
node --test v3/talent-application.test.js
```

## Protected-route guard

`route-guard.js` enforces the access matrix when a member opens a guarded V3
page directly. Logged-out visitors go to `/login` with the current path and
query preserved in `next`; a member with the wrong role goes to that member's
own default page. An authenticated member with no mapped active plan remains on
the page with an explicit error state. A free Brand's default is `/quiz` until
the Memberstack `starter-quiz` custom field records completion, then
`/quiz-results`.

Install the guard once sitewide in Site Settings Head Code, before page
controllers such as `opportunities-3.0.js`. The controller detects the guard's
terminal `html[data-route-guard]` state, leaves access redirects to the guard,
and retains its legacy per-page redirects only as a fallback when no guard is
authored. On `/opportunities` and `/opportunities/`, the guard allows a valid
Talent or paid-Brand snapshot immediately. Before denying access, it polls for
up to two seconds so an allowed role can hydrate after a partial lower Brand
Free snapshot; transient polling failures are retried and an unsettled lookup
cannot extend the deadline. The opportunity controller separately retries an
authenticated snapshot with empty `planConnections` when it is operating
without a resolved guard. A configured guard that never boots and still has no
mapped role fails closed with
`data-route-guard-error="member-role-unavailable"` rather than redirecting to
`/`.
[ROUTE-GUARD-WIRING.md](ROUTE-GUARD-WIRING.md) documents the DOM states, events,
diagnostics, exclusions, and release gate. The guard is a routing/UX layer and
does not replace Memberstack visibility rules or Xano authorization.
`/quiz`, `/quiz-results`, and `/all-starters` are intentionally unguarded by
the route table. `/quiz` is the funnel entry, where
`quiz-main/quiz-redirect.js` sends a live or Test paid Brand to
`/brand-dashboard` and a completed free Brand to `/quiz-results`; a recognised
member can stay by using the `?retake=true` escape hatch. The main quiz
controller then combines saved Memberstack answers with any homepage-bucket
selections. See `quiz-main/README.md` for plan scope and page-controller
wiring. When `/quiz-results` has no test,
pending, or saved quiz data, its page controller returns a positively identified
logged-out visitor to `/quiz`; pending pre-signup quizzes and Memberstack
failures do not redirect. `/all-starters` still awaits product confirmation that
it is not a pre-signup funnel page.

## Signup redirect marker

`starters-ms-redirect.js` lets a signup modal redirect back to the page it was
opened from, which Webflow's native form Redirect URL cannot do because that
field is one static value per form and cannot bind to a CMS item or a component
prop. The page carries the target on a hidden marker element, and the module
copies it onto every `form[data-ms-form="signup"]` as both `redirect` and
`data-redirect` before Memberstack's `initSignupForms()` reads the attribute.
`redirect` is the attribute Memberstack reads at submit time, so it also covers
keyboard-only submits that the click-armed `data-ms-redirect` override misses.

Install it in the footer of any page that hosts the signup modal (or sitewide):

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/starters-ms-redirect.js"></script>
```

Webflow markup contract — one hidden marker per page, CMS-bindable on a
collection template so every item redirects to itself:

```html
<div hidden starters-ms-redirect="/hire/some-slug?modal-id=signup-modal"></div>
```

The value is used verbatim, so `?modal-id=signup-modal` survives the redirect and
the site's `modal.js` reopens the modal on the reloaded page. A
`starters-ms-redirect` attribute on the form itself overrides the page marker and
belongs to that form alone — it is never used as the page default for a second
signup form. A form that already has a non-empty `redirect` value is left
untouched, so Designer-set Redirect URLs still win.

Accepted values are root-relative same-origin paths. A value must start with `/`,
must not start with `//` or `/\` (both protocol-relative, so both leave the
site), and must contain no ASCII control characters — the URL parser strips tab,
LF and CR before parsing, so `/<tab>/evil.example` would otherwise resolve to
`https://evil.example/`. Anything else is ignored, with a warning on staging
hosts only (`*.webflow.io`, localhost, `127.0.0.1`, `*.trycloudflare.com`, or
`window.STARTERS_DEBUG === true`). Signup forms injected after
`DOMContentLoaded` are out of scope — call `window.StartersMsRedirect.apply()`
after injecting one. The behaviour is demonstrated end to end, including the
attribute-versus-Memberstack race timing, in
`local-demos/signup-modal-memberstack/redirect-script.html`.

Run its focused test with:

```sh
node --test v3/starters-ms-redirect.test.js
```

## All Starters favorites

`all-starters-favorites.js` decorates Starter favourite controls and binds the
Designer-built Show all/Favourites radio filter on `/all-starters` for members
with an active paid-Brand Memberstack plan. The route itself remains outside
`route-guard.js`; this module only enables favourites for the paid-Brand plan
IDs in [ACCESS-MATRIX.md](ACCESS-MATRIX.md), while Xano independently enforces
its server-side plan gates.

Install it once in `/all-starters` Page Settings -> Custom Code -> Footer:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/all-starters-favorites.js"></script>
```

The site Head Code must load Memberstack, the shared `window.memberReady`
helper (or `$memberstackDom`), `wf-xano` v0.18 or newer, and `wf-algolia`. It
must also own the Xano base/auth configuration. The module preserves an existing
`window.WfXanoConfig.favoritesSource` and otherwise defaults it to
`opp30:brand/favorites`; it waits up to about ten seconds for
`window.WfXano.favorites` and `window.WfAlgolia.setFilter` instead of injecting
either library.

Webflow markup contract:

- The page has separate `.section_all-starters-body` variants gated with
  `data-ms-content="premium-brands"` and
  `data-ms-content="!premium-brands"`. All favourite controls and view radios
  belong inside the premium variant. The module only decorates that variant and
  hard-hides `.expert-card_favorite-wrapper` in the non-premium variant.
- Each premium Algolia card exposes `data-wf-algolia-hit-objectid` and contains
  an `.expert-card_favorite-wrapper`; the module adds the canonical `wf-xano`
  favourite attributes as cards render.
- One Designer-owned radio group provides Show all and Favourites inputs. Mark
  the inputs themselves or their Webflow radio-field wrappers with
  `data-ts-favorites-view="all"` and
  `data-ts-favorites-view="favorites"` respectively, and check Show all by
  default. The module filters the existing Algolia grid by favourite
  `objectID`; no second results grid is created. The grid's Designer-owned empty
  state handles a member with no favourites.
- The page keeps its small inline `ms-loaded` reveal snippet. Page reveal is
  deliberately independent of this CDN asset so a CDN failure cannot leave
  the page hidden.

The module is production-enabled and has no hostname or reveal-class kill
switch. It only injects favourite-control positioning/state styles and supplies
a heart glyph when a Designer favourite wrapper is empty; it does not create
tabs, radios, grids, or empty-state markup. Un-hearting a card in Favourites
view reapplies the cached `objectID` filter immediately. The module does not
expose a public JavaScript API.

Run its focused test with:

```sh
node --test v3/all-starters-favorites.test.js
```

## Saved Starters roles chips

`saved-starters-roles.js` splits the Saved Starters card's roles value into one
styled paragraph per role, so the saved list matches the Algolia browse cards.
Xano returns a Starter's roles as a single delimited string, and wf-xano has no
nested-repeat feature, so without this module the card renders the raw
`growth-marketer; paid-social-marketer` text.

Install it in `/favorites` Page Settings -> Custom Code -> Footer. That is where
the saved list lives; `/all-starters` hosts the hearts and the Favourites filter
but no saved-list wrapper.

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.11/v3/saved-starters-roles.js"></script>
```

The embed is pinned to a tag rather than `@latest`, matching the other
`/all-starters` embeds. Bumping it is a deliberate Webflow edit, so a future
release cannot change this page's behaviour on its own. Update the version here
whenever this module ships a fix.

`/favorites` also needs two things this module does not provide, because
`all-starters-favorites.js` supplies them only on `/all-starters` and returns
early elsewhere. Without the first, wf-xano logs "favorite controls found but
WfXanoConfig.favoritesSource is missing", hides every heart and wires no clicks.
Without the second, a saved heart stays `fill: none`.

```html
<script>
  window.WfXanoConfig = window.WfXanoConfig || {}
  window.WfXanoConfig.favoritesSource = 'opp30:brand/favorites'
</script>
<style>
  [wf-xano-element="favorite"].is-wf-xano-favorited path { fill: currentColor; }
  .expert_favorite-button[hidden], .expert-card_favorite-wrapper[hidden] { display: none !important; }
</style>
```

Set the property on the existing `WfXanoConfig` object rather than replacing it.
wf-xano captures that reference at module scope, so assigning a fresh object
after it loads has no effect.

Webflow markup contract:

- The saved-list wrapper carries `wf-xano-instance="saved-starters"`. The module
  looks the instance up by that key and subscribes to its `results` event, so a
  different key leaves the list unsplit.
- The roles paragraph inside the card template carries both
  `wf-xano-bind="<roles column>"` and `data-ts-roles`. The bind supplies the
  value; `data-ts-roles` is what this module keys off.
- Nothing else on the page uses `data-ts-roles`. The module only rewrites
  elements carrying it, which is what keeps the neighbouring
  `availability` value safe.
- For visual parity with the browse cards, the roles paragraph should use
  `.expert-card_service-text` (or any class setting
  `text-transform: capitalize`) inside a flex wrapper like
  `.expert-card_jobs-wrapper`. The browse cards store lowercase text such as
  `paid social marketer` and let CSS do the title-casing, and this module
  matches that. Without the capitalize rule the chips render lowercase.

Chips are cloned from the roles paragraph, so they inherit its Webflow classes.
Each one is marked `data-ts-roles-chip`. Values split on both `;` and `,`,
hyphens become spaces, blank segments are dropped, and repeats are removed
case-insensitively.

Both delimiters are supported on purpose. Algolia stores `roles` as an array of
slugs, and wf-xano has no array formatter, so an array value reaches the DOM
through `String(value)` as `growth-marketer,paid-social-marketer` with no
spaces. A Xano string column following the `subcategories` convention would
instead arrive semicolon-delimited.

The bound paragraph is hidden rather than replaced, which is the one design
point worth preserving. A wrapper marked `wf-xano-reconcile="keyed"` reuses the
existing card node and re-binds its fields in place, so a card whose bound
element had been replaced by chips could never receive a new Starter's roles.
Keeping the source in the DOM and rebuilding the chips on every `results` event
is correct under both keyed and replace reconciliation, and needs no mode
detection. Chips are stripped of every `wf-xano-bind*` attribute so a re-bind
can never write into one. This is the opposite of
`algolia-result-modifiers/roles.js`, which replaces its bound node outright and
is safe doing so only because wf-algolia always re-renders cards from scratch.

De-hyphenation is deliberately scoped to the roles element. The saved card also
renders `availability` values such as `11-20`, and the sibling Algolia
modifier's cleaner would turn that into `11 20`. Do not widen the selector.

After chips change, the module dispatches `expert-cards:relayout` on a 60ms
debounce, and only when a card's rendered roles actually changed.
`global-embeds/expert-card/expert-card.js` caches the hover-expanded height in
`--expert-card-jobs-open-height`, measured on window load, fonts ready, resize,
and that event. wf-xano renders after load, so on a saved list the per-card value
is otherwise never computed and `:root`'s `1lh` fallback wins: hover opens by
exactly one line no matter how many roles a Starter has. If roles hover ever
starts opening a sliver again, this dispatch is the thing that broke.

The module arms through `WfXano.push()` and must keep doing so. wf-xano assigns
`window.WfXano` to its API object at module scope, before its own `boot()`
creates any instance, so a deferred script can observe a non-array `WfXano` whose
instance list is still empty. Branching on `Array.isArray` and calling the arm
path directly was a real bug: it looked the instance up too early, warned, and
gave up permanently, leaving the list unsplit. `push()` is correct for both
shapes, queueing until after `init(document)` either way.

If the instance is genuinely absent after boot, the module splits whatever is
already rendered and warns once on staging, local, and Cloudflare tunnel hosts
(or with `window.STARTERS_DEBUG`). Production stays silent.

Requires Xano endpoint #1506 to return a `roles` field, which it does as of
2026-07-29. With no value bound the module emits zero chips and leaves the card
untouched.

Run its focused test with:

```sh
node --test v3/saved-starters-roles.test.js
```

## Starter profile editing

`../profile-image-auth-shim.js` is the interim auth and image-upload bridge for
the V3 build-profile and edit-profile pages. On `/starter-edit-profile` (including
nested paths), it derives the write mode from an exact, case-insensitive hostname
allowlist:

| Host | Mode | `localStorage.editSubmit` |
| --- | --- | --- |
| `thestarters.com`, `www.thestarters.com` | `live-write` | Set to `true` |
| Webflow staging and every other hostname | `read-only` | Removed |

The mode is also exposed as `window.__TS_EDIT_PROFILE_MODE__`. Failure to access
local storage is logged but does not weaken the network gate.

In read-only mode, the shim preserves `GET` and `HEAD` requests but rejects known
non-read requests for the profile update, also-worked-with, profile-image,
Companies, and Portfolio mutation families before they leave the browser. The
synthetic response is HTTP `403` JSON with
`code: "EDIT_PROFILE_READ_ONLY"`. This protects the production Xano, Webflow CMS,
and Algolia projections shared by the staging site. The exact Live hosts pass
those requests to the authentication bridge.

For unauthenticated string-URL, genuine `URL`-object, and genuine
`Request`-object mutations in the profile-update, also-worked-with, Companies,
and Portfolio families, the bridge trades the current Memberstack JWT for a Xano
`user_v3` token and adds only the `Authorization: Bearer <token>` header. The
child-record scope includes the Companies collection and path-based record URLs
plus the create, update, delete, image upload/add/delete, and video
upload/add/delete Portfolio endpoints used by the page. The bridge preserves the
effective request method, body, headers, and other options, shares one in-flight
token trade across concurrent requests, caches the token for the page, and on a
`401` invalidates that token and retries the mutation once after a fresh trade
without consuming the caller's request body.

The profile-image endpoint retains its separate image resize and request cleanup
behavior described by the shim. A missing Memberstack session or failed initial
trade leaves a header-only request unchanged so Xano owns the unauthenticated
response. Requests that already carry authorization, `GET`/`HEAD` calls,
non-Xano origins, unmatched paths, and request-like objects that are not genuine
`Request` instances pass through untouched. Other pages, including the V2 site,
retain their existing behavior.

Keep the existing inline `editSubmit` contract while this shim is installed; the
shim owns its value. This browser gate is an environment safety control, not a
replacement for authenticated, owner-scoped Xano authorization.

Run its focused test with:

```sh
node profile-image-auth-shim.test.js
```

## Onboarding tours

`onboarding-tour.js` renders page-scoped product tours whose steps, copy,
placement, audience, and replay behavior are configured with Webflow custom
attributes. A step can optionally highlight a different element by CSS selector
or exact visible text, which supports controls inside shared Webflow components.
It can also open a visible disclosure control before highlighting a hidden
target, restore that disclosure on leaving the step, and omit the step when its
opener is hidden at the current responsive breakpoint.
It lazy-loads driver.js only for an eligible tour, stores
show-once state in Memberstack member JSON (with `localStorage` for guests),
waits for an in-progress route guard before auto-starting, and themes popover
titles and descriptions from the live page's heading and body fonts with
brand-font fallbacks. Query-string start/reset controls and `Alt+Shift+T` allow
support and QA to replay tours on staging or production without editing member
JSON. It is presentation-only and does not grant or restrict access. See
[ONBOARDING-TOUR-WIRING.md](ONBOARDING-TOUR-WIRING.md) for the Designer
attributes, install snippet, persistence behavior, diagnostics, and release
checks.

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

Grant state (`nylas_grant_id`/`email`/`calendar_id`) is sourced from the
scheduling row via an authenticated `get_by_memberstack` read at bootstrap,
with the Memberstack custom-field mirror as fallback only. The admin PATCH
that maintains that mirror uses the live Memberstack key, so it cannot write
Test-Data members — sourcing from the row keeps sandbox QA (and any member
whose mirror drifts) working. A grant-less save now returns to the `default`
step instead of legacy's silent dead-end on the form.

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
