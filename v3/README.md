# V3 browser scripts

## Shared password recovery

`password-recovery.js` consolidates the Brand and Talent password-recovery
routes onto one canonical Memberstack flow:

```text
/forgot-password -> /reset-password -> /password-success
```

Install it once in the V3 site head, before Memberstack form initialization:

```html
<script
  defer
  src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/password-recovery.js"
></script>
```

The module is inert outside the V3 staging hostname and production domains. It
owns these compatibility redirects while preserving the original query string,
reset token, encoding, and hash:

| legacy path                  | canonical path      | origin |
| ---------------------------- | ------------------- | ------ |
| `/starters-forgot-password`  | `/forgot-password`  | Talent |
| `/starters-reset-password`   | `/reset-password`   | Talent |
| `/starters-password-success` | `/password-success` | Talent |
| `/starter-password-success`  | `/password-success` | Talent |
| `/password-sucess`           | `/password-success` | Brand  |

The login pages should link to `/forgot-password?from=brand` and
`/forgot-password?from=talent`. On the canonical recovery pages, author both
login choices as native Webflow links:

```html
<a href="/login" data-password-recovery-login="brand">Brand login</a>
<a href="/starter-login" data-password-recovery-login="talent">Talent login</a>
```

When origin is known, the other choice is hidden. When a reset email is opened
without origin context, both remain visible. Add
`data-password-recovery-retry` to any native “Different email?” link. The
module updates existing forms through their canonical Memberstack attributes;
it never generates form or link markup.

Until both native login choices are present, a direct visit with no origin uses
the neutral homepage fallback instead of silently favoring Brand or Talent. The
fallback points the link at `/` and sets an `aria-label` of `Return to
homepage`. On a Webflow native button (an anchor inside `.button_main-wrap`) it
rewrites the sibling `.button_main-text` label so the visible text changes
without inserting overlapping overlay text; otherwise it updates the link's own
text.

Run its focused tests with:

```sh
node --test v3/password-recovery.test.js
```

## Login router

`auth-route.js` owns post-login and post-signup routing for V3 without changing
the shared Memberstack plan redirects used by V2. Install it only on the V3
`/login` and `/auth-route` pages, after the sitewide `route-guard.js` that owns
the shared stable plan-role contract. It runs on the V3 Webflow staging hostname
and both custom domains; see [AUTH-ROUTE-WIRING.md](AUTH-ROUTE-WIRING.md) for the
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
the page with an explicit error state, and a cross-family Talent + Brand plan
conflict fails closed. The canonical `/dashboard` route is a thin guarded
utility page that sends mapped members to `/starter-dashboard`,
`/brand-dashboard`, `/quiz`, or `/quiz-results`; it does not merge or duplicate
the two dashboard page bodies. A free Brand's default is `/quiz` until
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
logged-out visitor to `/quiz` and sends an authenticated member whose completion
marker outlived missing or malformed member JSON to
`/quiz?retake=true&quizDataMissing=1`; pending pre-signup quizzes and Memberstack
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

## Profile message modal

`messages-profile.js` mounts a TalkJS chatbox with the profiled starter inside
the page's modal, so a brand can start or resume the conversation without
leaving `/hire/<slug>`. The conversation is created on first open when it does
not already exist.

Install it in the footer of the `detail_hire` template. It is inert everywhere
else, so a sitewide embed is safe but pointless:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/messages-profile.js"></script>
```

This module owns the click on a trigger: it always calls `preventDefault` and
`stopPropagation`, then opens the modal through `window.lumos.modal`'s registry.
It deliberately does not rely on modal.js's click delegation, because that cannot
suppress navigation for Webflow's button component. That component renders an
absolutely-positioned `a.clickable_link` inside
`div.button_main-wrap[data-modal-trigger]`, and modal.js only calls
`preventDefault` when the element it *matched* is itself an anchor:

```js
const trigger = e.target.closest(`[data-modal-trigger='${modalId}']`)
if (trigger.tagName === "A") e.preventDefault()
```

There the match is the wrapping DIV, so the inner anchor's href wins and the page
navigates away while the modal is still opening. Because this module takes the
click instead, `data-modal-trigger` is optional and the identity attributes may
sit on either the wrapper or the anchor; put them wherever is convenient in the
Designer. It still listens for modal.js's `modal-open` event, and a
`?modal-id=<id>` URL mounts the chat with no click involved. Load the modal embed as usual,
and load `route-guard.js` too if you want the role rules to apply, since the role
comes from `StartersV3RouteGuard.memberRole`.

Webflow markup contract. The trigger, with three CMS-bound custom attributes:

```html
<a href="/messages"
   data-modal-trigger="message-modal"
   messages-profile-message="mem_clxz24xki027s0sredlom9psj"
   messages-profile-photo="https://x08a-5ko8-jj1r.n7c.xano.io/vault/.../freelancer-558.jpg"
   messages-profile-name="Brian Chung">Message</a>
```

And an empty container inside that modal, which is where the chat renders:

```html
<dialog class="modal_dialog" data-modal-target="message-modal">
  <div class="modal_backdrop" data-modal-close></div>
  <div class="modal_content">
    <div class="modal_slot">
      <div messages-profile-chat messages-profile-upgrade="/pricing"></div>
    </div>
  </div>
</dialog>
```

| attribute | bind to CMS field | field type |
| --- | --- | --- |
| `messages-profile-message` | Memberstack id | PlainText (required) |
| `messages-profile-name` | Name | PlainText (optional) |
| `messages-profile-photo` | Profile Photo Xano | PlainText (optional) |

The three identity attributes must be *field bindings*, not literal values, or
every profile ships the same starter's id. Bind `Profile Photo Xano` rather than
`Profile Photo`: the latter is an Image field and is not reliably offered for
attribute binding, while the former is PlainText holding the durable Xano vault
URL. `messages-profile-upgrade` is a static path, not a binding, and goes on the
chat container or any trigger. Give the container a height in the Designer; a
zero-height box renders a zero-height chat.

Keep `href="/messages"` on an anchor trigger. The module rewrites it to
`/messages?with=<memberstack id>`, which the `/messages` deep link in
`messages.js` understands, so the link still reaches the conversation if this
module never boots. The href is only ever written to an anchor, never injected
into a wrapper div, and it never fires while the module is running because the
click is always suppressed. If TalkJS fails after the modal is already open, that same
link is rendered inside the container rather than leaving an empty box.

TalkJS is loaded lazily on the first open. `/hire/<slug>` is public and
SEO-relevant, so visitors who never press Message never download the SDK.

Who gets through:

| viewer | outcome |
| --- | --- |
| logged out | `/quiz` — the signup funnel; the chat intent is intentionally dropped, there is no login round trip back to the modal |
| free Brand | `messages-profile-upgrade` when set, else route-guard's `brandFreeHome`: `/quiz-results` once the Memberstack `starter-quiz` field records completion, `/quiz` until then |
| talent | trigger hidden; modal closes if opened anyway |
| viewer is this starter | trigger hidden; modal closes if opened anyway |
| paid Brand | the chat |
| role unknown | the chat |

The logged-out and free-Brand redirects also run as a capture-phase click
handler on the trigger, which calls `stopPropagation` so `modal.js` never sees
the click. Without that the modal would flash open a frame before the redirect.
This only works once Memberstack has resolved; a click during that window opens
the modal and is handled there instead.

Every check here is client-side, and unlike the `/messages` route this modal
never passes through route-guard. Treat the rules as product gating, not as an
authorization boundary.

Known data gap: the Webflow mirror of `Memberstack id` stopped being written
around xano-id 1004, so roughly 7 percent of `hire` items have an empty field.
An empty CMS field renders an empty attribute, which is exactly the hidden-trigger
path, so those profiles simply show no button until they are backfilled, with no
code change needed afterwards.

On staging the module also names any element that opens this modal but carries
no `messages-profile-message`, since each of those is a Message button that would
open a chat with nobody. A profile page usually has several (hero, sticky nav,
mobile CTA) and every one of them needs the attributes.

Triggers injected after `DOMContentLoaded` are out of scope; call
`window.StartersMessagesProfile.apply()` after injecting one. Warnings name the
offending slug and appear on staging hosts only (`*.webflow.io`, localhost,
`127.0.0.1`, `*.trycloudflare.com`, or `window.STARTERS_DEBUG === true`).
Conversations opened this way carry `custom.source = "hire-page"` and
`custom.slug`, which cannot be backfilled onto conversations created earlier.

Run its focused tests with:

```sh
node --test v3/messages-profile.test.js v3/messages.test.js
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
  matches that for any role it does not have an override for. Without the
  capitalize rule those chips render lowercase.

Chips are cloned from the roles paragraph, so they inherit its Webflow classes.
Each one is marked `data-ts-roles-chip`. Values split on both `;` and `,`,
hyphens become spaces, blank segments are dropped, and repeats are removed
case-insensitively.

Acronym roles are the exception. A slug listed in the module's `ROLE_NAMES`
override map is emitted in its final display case instead of being
de-hyphenated, so `cro-expert` becomes `CRO Expert` rather than the `Cro Expert`
that `text-transform: capitalize` would otherwise produce. The capitalize rule
leaves those values alone because it only uppercases word-initial letters. The
same map lives in `algolia-result-modifiers/roles.js` and
`starters-list-filter/custom-algolia-scripts/filters-text.js`, so the browse
cards, the saved chips and the filter labels all read the same. Edit all three
copies together. The map is consulted only for the `data-ts-roles` value, which
is what keeps the neighbouring `availability` value such as `11-20` untouched.

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

## Onboarding profile preview

`onboarding-profile-preview.js` is the page glue for the wf-xano list keyed
`onboarding-self-preview` — the freelancer's own profile rendered as a
profile-preview card on the onboarding completion page ("Your 30-day visibility
boost is already running"). The card's CSS and markup live in the structure embed
in [ONBOARDING-PROFILE-PREVIEW-WIRING.md](ONBOARDING-PROFILE-PREVIEW-WIRING.md);
the script owns exactly one thing, the `beforeRender` transform.

The page runs **one wf-xano instance per form block**, and the wiring doc is the
source of truth for the attribute sets. Each form block is itself a wrapper
(`onboarding-preview-full` / `onboarding-preview-consult`) and contains its own
card template; one shared scripts embed serves both. This is forced by the
library, not a preference: `this.template = owned(elSel('template'))` binds
exactly one template per wrapper and silently ignores a second, so two card
layouts require two wrappers. Consequences worth knowing before touching this
page: the state classes (`is-wf-xano-error` and friends) land on each **form
block**, so the card CSS matches them as an ancestor; a plain load makes **two**
GETs of the same endpoint (accepted); and any ancestor that still carries wrapper
attributes becomes a third instance that steals the first form's template.

Because the keys are no longer fixed, the module arms by **endpoint**: at boot it
scans `WfXano.instances` and registers its `beforeRender` hook on every instance
whose source contains `starters_onboarding/get_freelancers` as a segment prefix
(checking `url` and raw `source`), plus anything still keyed
`onboarding-self-preview`, deduped by identity. Segment *prefix*, not `endsWith`,
because the endpoint name is in flux — the page currently reads
`get_freelancers_test`, a temporary secret-gated mirror, and `_secure` may follow.
An `endsWith` matcher was a live blocker: nothing armed on `_test`, so every bind
rendered against the raw envelope while the list still initialised and the request
still succeeded. The tell is `armed 0` plus rendered item keys of
`["freelancer"]`. It reports `armed N instance(s)` on staging, which is the fastest check
that both forms are wired — a count of 1 means one form is missing its attributes.
Arming is a one-shot boot pass; an instance created by a later manual
`WfXano.init(el)` would not be armed, since the library emits no
instance-created event. Nothing on this page does that.

The **form-block switching is not JavaScript** — the consult and full blocks carry
`wf-xano-if-state="data.items.0.profile_type_30 === consult"` and
`… !== consult` respectively, plus a mandatory `wf-xano-display`, on the same
element as their wrapper attributes (state projection includes the instance root,
so each form self-toggles against its own instance). `!== consult` on the full block is what makes
it the fallback for an empty result, a blank field, or a fetch error, since
`String(undefined) !== 'consult'`. `=== full` would show nothing in those cases.
The comparison is case- and whitespace-exact (`String(left) === right`), and the
stored values are inconsistent — `"full"` on one record, `"Full"` on another — so
the transform lowercases `profile_type_30` on the copied record. The published
attributes therefore need no list of accepted casings and no Designer churn. Safe
because the field is only a switching key, never bound or displayed; if it ever
needs showing, bind a separate un-normalized field.

`starters_onboarding/get_freelancers` answers with an envelope,
`{"freelancer": [ <one record> ]}`. wf-xano's `normalize()` sees an object rather
than an array and takes its single-object branch, so `items[0]` is the whole body
and every plain `wf-xano-bind` would resolve against the envelope instead of the
record. The hook unwraps it and adds the three computed fields the template binds
and Xano does not send: `Role_1`/`Role_2`/`Role_3` (first three role display
names, extras dropped, each chip hiding on an empty value), `Location` from
`City, State_Province, Country` with empty parts skipped, and `Bio` flattened
from Quill rich-text HTML to one line of plain text.

Role names come from one of two places. If the record carries a non-empty
`roles_resolved` array (the forward path — Xano resolving `role_refs: [39, 38, 35]`
server-side), it wins outright and is printed verbatim: trimmed, deduped, but never
slug-mapped or de-hyphenated, because a resolved name is authoritative. Entries may
be strings or `{id, name}` objects (`name` → `display_name` → `title`), and junk
entries such as bare ids are skipped, so a raw `role_refs`-shaped array falls
through rather than printing `39` in a chip.

Otherwise the `Roles` string is parsed with `parseRoles()`, **ported verbatim from
the saved-list sibling above** — including its `ROLE_NAMES` map, which this file is
now the 4th copy of (every copy carries the same four-file `KEEP IN SYNC` comment).
The earlier comma-only split here was a live bug: the stored format varies per
record, and a real member's `head-of-growth; paid-social-marketer;
performance-creative-lead` landed entirely in `Role_1` with chips 2 and 3 empty.
Both `;` and `,` are now accepted. As with the sibling, de-hyphenated fallbacks are
lowercase and **the chip's CSS must supply `text-transform: capitalize`**; map
entries carry their own final casing and are unaffected by it, which is the whole
point of the map (`capitalize` on `cro expert` gives "Cro Expert").

Entity decoding in the bio flattener is deliberately single-pass. A
loop-until-stable decode would turn the literal `&amp;lt;` an author typed into
`<`, which is how escaped markup gets smuggled back into a value. Nothing is ever
assigned as HTML either way — wf-xano's binds write `textContent` — so the
flattener is a formatting concern, not the security boundary.

The module arms through `WfXano.push()` for the same reason the saved-list script
does, and is marker-gated on the instance-key selector so it costs nothing on
other pages. `arm()` also reads `getState()` and calls `refresh()` when the status
is already `success` or `error`: that only happens when something booted wf-xano
early enough for a response to render before this file ran, i.e. an untransformed
render is already on screen. Script-tag order relative to the wf-xano tag does not
matter (verified against the library's boot guard and queue drain — see the wiring
doc).

If the instance is genuinely absent after boot, the module warns once on staging,
local, and Cloudflare tunnel hosts (or with `window.STARTERS_DEBUG`) and stays
silent in production. The warning earns its place: with no transform the binds
resolve against the envelope, the template's
`wf-xano-if="First_Name|Last_Name|Professional_Headline"` guard hides the card,
and the page shows its empty state to a member who has a complete profile.

A staging-only `?ms=<memberstack_id>` tester renders any member's card, applied
through `instance.setParam()` on **every** armed instance (which reloads, so the
settled-state belt is skipped when an override is in play — and a `?ms=` load
therefore makes four GETs on a two-form page: two initial, two reloads). It is honored on `*.webflow.io`, `localhost`,
`127.0.0.1`, and `*.trycloudflare.com` only. The host predicate is deliberately
anchored tighter than the loose one the sibling modules share, because here it
gates a data read rather than a `console.warn`, and `STARTERS_DEBUG` — which may
be set in production — must never unlock it.

The endpoint is still public with a hardcoded demo `memberstack_id`. The wiring
doc carries the Xano authentication spec and the two-attribute embed flip; treat
that flip as required before the page reaches real members. The `?ms=` tester goes
inert on its own at that point: the server stops honoring the param, so the
override cannot outlive the fix.

Run its focused test with:

```sh
node --test v3/onboarding-profile-preview.test.js
```

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
## Starter Dashboard points and rank tile

`starter-dashboard-points.js` binds Designer-owned dashboard markup to the
authenticated Xano `POST /starter/points/summary` read model. It is a standalone
tile controller because it does not own a reusable list or form that belongs in
`wf-xano`, and keeping it separate avoids expanding the general Opportunities
controller.

Load it on `/starter-dashboard`:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/starter-dashboard-points.js"></script>
```

Wire one or more tile roots with `data-points-element="root"`. Within each root,
use these values:

| Value | Purpose |
| --- | --- |
| `loading` | Loading card or spinner |
| `content` | Normal points/rank content |
| `error` | Designer-owned safe error state |
| `state-refreshing` | Designer-owned rank-refreshing guidance |
| `state-ineligible` | Designer-owned profile-completion guidance |
| `state-quarantined` | Designer-owned reconciliation guidance |
| `state-missing-role` | Designer-owned primary-role setup guidance |
| `points` | Canonical ledger total |
| `overall-card` | Overall-rank card wrapper; visible only when rank status is ready |
| `overall-rank` | Overall competition rank |
| `overall-cohort-size` | Overall cohort size only; surrounding copy stays in Webflow |
| `role-card` | Primary-role rank card wrapper |
| `role-rank` | Primary-role competition rank |
| `role-label` | Primary-role name only; surrounding copy stays in Webflow |
| `role-cohort-size` | Primary-role cohort size only; surrounding copy stays in Webflow |

The script never calculates points or rank in the browser. It trades the active
Memberstack session for a Xano token and renders only the authenticated summary.
When Xano reports `refreshing`, or a nominally ready payload lacks a rank/cohort,
the position is withheld and both the overall-rank and primary-role cards are
hidden. The `ineligible` and `quarantined` statuses likewise hide both cards and
reveal their matching Designer-authored state blocks. Missing primary roles keep
the overall-rank card and reveal the authored setup state inside the role card.
No state renders raw `N/A`.

All state containers, copy, links, and styling live in Webflow. The controller
does not create markup or inject state sentences. It only binds the dynamic
points/rank/role/cohort values, clears stale dynamic values, and selects the
matching authored state element. Keep surrounding phrases such as “Out of”,
“eligible Starters”, and “Rank” outside the dynamic hooks.

Each root reflects its resolved state onto `data-points-status`
(`loading`, `ready`, `refreshing`, `ineligible`, `quarantined`, or `error`) so
Designer CSS can style per backend state. It also sets `data-points-view`
(`loading`, `ready`, `refreshing`, `ineligible`, `quarantined`, `missing-role`,
or `error`) for the exact visual state. The transient `loading` value is set
while the summary is being fetched, before a terminal state resolves.

Run its focused tests with:

```sh
node --test v3/starter-dashboard-points.test.js
```
