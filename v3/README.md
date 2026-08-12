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
`/login`, `/starter-login`, and `/auth-route` pages, after the sitewide
`route-guard.js` that owns the shared stable plan-role contract. It runs on the
V3 Webflow staging hostname and both custom domains; see
[AUTH-ROUTE-WIRING.md](AUTH-ROUTE-WIRING.md) for the
installation, error contract, and release gate. The versioned
[V3 Member Access Matrix](ACCESS-MATRIX.md) maps stable plan IDs to roles and
documents route access plus the separate Webflow, content, and Xano enforcement
layers.

The V3 opportunity and Messages guards send logged-out visitors to
`/login?next=<encoded current path and query>` so the router can restore an
allowed destination after login.

Talent logins additionally fork on funnel position, read from Xano
`starters_onboarding/get_build_profile_status`: `build_profile_done` false goes to
`/build-profile/select-profile`, true with `onboarding_done` not `true` goes to
`/starter-onboarding` (winning over any stored `next`), and both true routes
normally. Brand and unmapped members never trigger that call, and every
inconclusive answer fails open to the standard destination. The signal became
stricter on 2026-08-04; see [AUTH-ROUTE-WIRING.md](AUTH-ROUTE-WIRING.md) for the
endpoint contract and the 282-row reason.

Paid Brands take a parallel check through
`starters_onboarding/get_brand_profile_status`: `has_record` true with
`brand_profile_done` false goes to `/complete-profile`, winning over a stored
`next`. A non-empty `thestarters:v3-brand-profile-completed` marker short-circuits
as complete without a network call. `brand-free` and unmapped members stay
zero-network. The same eight-second budget and fail-open rule apply.
`/complete-profile` is not an allowed client-supplied `next`; the router constructs
that destination. See [AUTH-ROUTE-WIRING.md](AUTH-ROUTE-WIRING.md) for the endpoint
contract.

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

Two GitHub assets split the page's existing responsibilities without changing
the native Webflow form markup. `talent-application-ui.js` replaces the 23 KB
Webflow Code Embed and owns field validation, the conditional profile and
referral blocks, location loading, and custom-select behavior.
`talent-application.js` remains the only submission owner and canonical Xano
writer. The UI controller does not bind a submit handler, build a submission
payload, or log applicant fields.

Videsigns' multistep library calls jQuery's
synthetic `form.submit()` from its final "Complete" click handler, so a native
`submit` capture listener never sees that event. The script therefore listens
in capture phase two ways: a `click` listener on the multistep submit control
(`[data-form="submit-btn"], [data-form-ms="submit-btn"]`) intercepts the final
click before the library can fall through to Webflow's native form API, and a
`submit` listener still catches real native submits such as pressing Enter. Both
run before Webflow's delegated submit handler. It deliberately suppresses the
native Webflow submission because Zapier is no longer the application intake
path, then posts JSON to Xano's `talent/application/create` endpoint. Xano owns
the authoritative application row and mirrors it to the Airtable review table
server-side.

Native constraint validation is preserved before the script takes ownership of
the submit: it calls `reportValidity` on the first invalid control, but only for
visible controls, so required-but-hidden Webflow fields (the non-selected
consult/full-profile pair, inactive steps) cannot silently block Complete with
an unshowable error. When a visible field is invalid the submission is aborted
and the native validation UI is shown.

After the GitHub release is available, replace the full legacy inline Code
Embed with the UI loader below. Install both scripts on step 1 only, in this
order:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/talent-application-ui.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/talent-application.js"></script>
```

Do not keep the legacy inline controller after this cutover. Both loaders are
deferred and must remain in the order shown.

Webflow contract:

- Keep `application-form` on the form itself:
  `<form application-form>`. Generated IDs and styling classes are not selector
  fallbacks.
- Keep the existing `[form-next]` and `[form-submit]` controls, profile radios,
  field IDs, and `[data-element]` conditional blocks. The UI controller binds
  the authored elements and does not generate the form markup.
- Keep the existing `country`, `state`, and `city` selects. The UI controller
  populates them from the published locations asset and adds the searchable
  custom-select presentation beside each native select.
- Keep the multistep Complete control's `data-form="submit-btn"` (or
  `data-form-ms="submit-btn"`) attribute. The capture-phase click listener keys
  off it to intercept the final step before the multistep library submits.
- Keep the form inside its `.w-form` wrapper with a `.w-form-fail` block. A
  submit stopped by native constraint validation, or a failed request, reveals
  that block with a privacy-safe diagnostic ID; a failed request also re-enables
  the submit control for retry. The shared receipt allowlist and console-copy
  fallback are documented in
  [`../README.md`](../README.md#current-scripts).
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

Run the focused checks with:

```sh
node --test v3/talent-application-ui.test.js v3/talent-application.test.js
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
`/quiz`, `/quiz-results`, and `/all-starters` are intentionally absent from the
guarded route table, because all three serve pre-signup visitors and a guarded
page forces a login. `/quiz` is the funnel entry, where
`quiz-main/quiz-redirect.js` sends a live or Test paid Brand to
`/brand-dashboard`, a Talent member to `/starter-dashboard`, and a completed free
Brand to `/quiz-results`; a recognised Brand can stay by using the
`?retake=true` escape hatch, which the Talent bounce deliberately ignores. The
main quiz controller then combines saved Memberstack answers with any
homepage-bucket selections. See `quiz-main/README.md` for plan scope and
page-controller wiring. When `/quiz-results` has no test,
pending, or saved quiz data, its page controller returns a positively identified
logged-out visitor to `/quiz` and sends an authenticated member whose completion
marker outlived missing or malformed member JSON to
`/quiz?retake=true&quizDataMissing=1`; pending pre-signup quizzes and Memberstack
failures do not redirect.

Three mechanisms were added on 2026-08-03. **Member-home bounce:** the homepage,
both login pages, and `/sign-up` are not in the route table — they must keep
working untouched for signed-out visitors, since they are the pre-signup funnel
itself — but a member the guard can positively identify and map to a role is sent
away from them, to a validated `?next=` when one is present and otherwise to the
role home. Logged out, Memberstack unavailable, and cross-role conflict leave the
page completely alone, with no error attribute and no `checking` stamp, and so
does an unmapped plan on the two login pages and `/sign-up`. The homepage alone
carries two overrides added later the same day. A member who cancelled a paid
Brand plan goes to `/all-starters`, whether their older free plan is still live or
nothing is active at all — that second case is an unmapped plan which would
otherwise have stayed, and an unmapped plan with no cancelled paid Brand behind it
still does stay. And a free Brand who has not finished the quiz stays on `/`
instead of being pushed to `/quiz`, which is where the login pages still send
them. A valid `?next=` outranks both overrides; on `/` it is honoured even for a
member with no mapped role, since deep-link intent does not depend on plan state.
`ROUTE-GUARD-WIRING.md` has the exact precedence and the cancelled-plan
definition. **Per-page logged-out destinations:** the three
build-profile pages send a logged-out visitor to `/` instead of `/login?next=`,
because they are entered from marketing flows where a login form would ask a
stranger to authenticate into a funnel step they have no account for yet.
**Member-only role bounce:** `/quiz-results` and `/all-starters` (both slash
forms) borrow the member-home bounce's silence and add the guarded pages' role
test, so a logged-in member whose role does not belong there normally goes to
their role home while every other visitor is untouched. The sole exception is
the exact production paid-Brand email canary documented in the root
[Quiz-results email tester](../README.md#quiz-results-email-tester) section.
Talent leaves both; a free Brand
stays on both, though on `/quiz-results` only once the quiz is done, since before
that its role home is `/quiz`. "Done" there means either the `starter-quiz`
custom field or a `ready` `sessionStorage.starterQuizPending` payload — the
second signal was added on 2026-08-04 to fix a regression, because the field is
written by `quiz-results.js` *after* that page renders, so a member who had just
signed up was bounced straight back to `/quiz` in a race the field alone could
never win. The guard only reads that key, never clears it, and only an explicit
`ready` counts, so a free Brand who genuinely never took the quiz still goes to
`/quiz`. `/generate-invoice` (Talent) also joined the guarded route table.

`/complete-profile` was in that table for part of 2026-08-03 and is not any more.
Memberstack's `restrict-pages` gated group owns the page on its own, redirecting a
logged-out visitor to `/login` with no `?next=`, so the guard and `auth-route.js`
both leave it alone rather than compete for the same URL with a different
destination. The member-home bounce pages forward whoever arrives at `/login` that
way to their role home. See [ACCESS-MATRIX.md](ACCESS-MATRIX.md).

## Complete-profile role routing

`complete-profile-redirect.js` puts every mapped member who lands on
`/complete-profile` where they belong, with no hop through `/login`. The page is a
paid-Brand form, so a paid Brand stays until the profile reads as complete and then
goes to `/brand-dashboard`; a free Brand goes to its quiz-funnel home
(`/quiz-results` once `starter-quiz` is set, else `/quiz`) and a Talent member to
`/starter-dashboard`. Those two destinations come from the guard's own
`roleHome()`, so both branches cost no network request.

Paid-Brand completion comes from Xano
`starters_onboarding/get_brand_profile_status` (`{has_record, brand_profile_done}`)
through the trade-token flow. This replaced routing on the Memberstack custom field
`completed-brand-profile` on 2026-08-06. The inbound and outbound profile redirects
must use one signal, or a recent completer can bounce until the Memberstack webhook
mirror catches up. `brand-account-controller.js` still writes the field last for
endpoint #1513, but no browser route reads it. After a durable submit, the controller
also writes `thestarters:v3-brand-profile-completed` to `sessionStorage`; a non-empty
marker is a separate fast path that reads as complete without Xano. Otherwise,
only `has_record === true` **and** `brand_profile_done === true` redirects to
`/brand-dashboard`. Unfinished and inconclusive answers stay.

The role branches replaced the paid-only design on the evening of 2026-08-03: the
other two roles used to sit on a form they cannot submit until they manually went to
`/login` for the member-home bounce. Their cost is that the `restrict-pages` gated
group must be set to access **All Members** — access to the page stays
Memberstack's, and the logged-out kick with it, but a logged-in member of any role
has to be allowed to load the page for this module to route them. Unmapped and
conflicted members, logged-out visitors, a missing or half-loaded role contract,
and a lookup that throws are all left untouched. The page needs the native form
contract plus the account controller and redirect embeds installed after the guard;
see
[BRAND-ACCOUNT-WIRING.md](BRAND-ACCOUNT-WIRING.md) and
[COMPLETE-PROFILE-REDIRECT-WIRING.md](COMPLETE-PROFILE-REDIRECT-WIRING.md).

## Complete-profile back button

`complete-profile-back.js` turns the authored, hidden "Go back to [Name]" button on
`/complete-profile` into a working escape hatch. It exists because
`brand-profile-redirect.js` delivers an unfinished Brand to the form with
`location.replace()`, which destroys the history entry the browser's own back
button would have used, so the page needs a destination it captured rather than one
it inherits. The module never redirects anybody, reads no member, holds no role
contract, and makes no network request.

The destination is `document.referrer`, read on init and mirrored into
`sessionStorage` under `thestarters:v3-complete-profile-back` — its own key, never
the `thestarters:v3-brand-profile-completed` marker the three sibling modules share
on the same page. A referrer whose origin passes the module's own host allowlist is
stored, overwriting any prior value, and used; an off-site one is neither stored nor
used, and deliberately does not fall back. An empty referrer — a reload, a direct
hit, a stripped policy — falls back to the stored value, re-validated against the
same allowlist so a hand-edited entry cannot become a navigation target. That
fallback is the whole reason the key exists: a refresh of the form is exactly when
the member most wants out, and exactly when the referrer is gone.

The button stays hidden for the funnel and login pages (`/auth-route`, `/login`,
`/sign-up`, `/starter-login`), for `/complete-profile` itself, and for **every page
`brand-profile-redirect.js` guards** — going "back" to one of those just bounces an
unfinished Brand to this form a second later. The two path lists are therefore
duplicated, and a test reads `GUARDED_PATHS` out of the sibling's source and asserts
this module covers all of it, so a page added to the guard cannot silently reopen
the loop. The label comes from a curated map (Home, Learn, Sessions, Article,
Playbook, Webinar, Events, Case Studies, Why Us, Functions, Industries, and the
Starter's first name for `/hire/<slug>`); anything unmapped gets a bare `Go back`
rather than a title-cased guess at a slug.

Both the label element and the inner `button.clickable_btn` are looked up **strictly
inside the wrapper**, with no document-wide fallback. That is load-bearing rather
than tidy: `clickable_btn` is the project's generic button class and the form's own
Submit control carries it, while the authored wrapper holds no `<button>` at all, so
a fallback would bind "go back" to Submit. The click is bound on the wrapper too,
behind a one-shot latch, so a missing inner button degrades instead of dying and a
bubbling press is still one navigation. A missing wrapper, a missing label, storage
that throws, or a DOM that refuses to be queried all leave the page exactly as
authored — the button is already hidden, so the failure mode is the status quo.
Needs the two Designer attributes plus one page-level embed; see
[COMPLETE-PROFILE-BACK-WIRING.md](COMPLETE-PROFILE-BACK-WIRING.md).

Run its focused test with:

```sh
node --test v3/complete-profile-back.test.js
```

## Complete-profile submit loader

`complete-profile-loader.js` shows the authored `[data-complete-profile-loader]`
element while the Complete-profile form is submitting and fades the form layout
behind it. It exists because a durable submit through
`brand-account-controller.js` is several round trips long, and until now the page
said nothing while they ran: the button greyed out and then the page sat there.
On a slow connection that reads as a dead form, and a member who believes a form
is dead starts clicking things. The module submits nothing, reads no member,
holds no role contract, and makes no network request.

The signal is `aria-busy` on the form, watched with a `MutationObserver` and read
once at init in case a submit somehow beat the script to the page. It binds no
`submit` handler and never touches the submit button, because double-submit is
already the controller's guard and two owners of one button is how a form ends up
permanently disabled.

This ships with a scoped change to `brand-account-controller.js`. On a successful
submit that initiated a redirect, `bindForm()` now latches busy so the form stays
`aria-busy="true"` until the page unloads, which is what keeps the loader up
across the navigation; `location.assign()` only queues a redirect, so the old
code released the form while the browser was still fetching the destination. The
reasoning and the accepted cancelled-navigation consequence live under Failure
semantics in [BRAND-ACCOUNT-WIRING.md](BRAND-ACCOUNT-WIRING.md). Busy therefore
clears on an error, and on a success that resolved no redirect URL.

Show and hide are inline `display` writes, because Webflow's Display:None
compiles to a class rule that a stylesheet write would lose to. Minimum display
comes from the loader's own `data-loader` attribute and must be wholly numeric:
`1s` and `1000px` fall back to the 200ms default rather than parsing as 1 and
1000, which would silently defeat the anti-flash window. Every show also arms a
5000ms fail-open cap that hides the loader and restores the dim whatever
`aria-busy` says, because a full-page overlay must never be able to trap a
member. Since the redirect latch, that cap is the normal end of a successful
session whenever the navigation takes longer than five seconds.

Dim targets are optional and skipped individually. A target that **contains** the
loader is skipped too, with a staging warning, because opacity on an ancestor
creates a rendering group its children cannot escape and `pointer-events: none`
inherits, so dimming it would fade the spinner itself and make it inert. The page
uses a single dim target on the form layout: opacity multiplies down the tree, so
nesting a second one inside it would land the photo at `0.04`. A missing loader
element is an immediate silent bail with the exported `show`/`hide` replaced by
no-ops, which is what makes the file safe to load site-wide, and an
authored-visible loader is force-hidden once at init as a self-heal. Needs the
Designer checklist plus one page-level embed; see
[COMPLETE-PROFILE-LOADER-WIRING.md](COMPLETE-PROFILE-LOADER-WIRING.md).

Run its focused tests with:

```sh
node --test v3/complete-profile-loader.test.js
node --test v3/brand-account-controller.test.js
```

## Brand account and Starter email sync

`brand-account-controller.js` aligns the native Brand signup plan with
Memberstack Test or Live Data and owns the native Build Account submission,
while its login-email interception remains configuration-gated for Brand
Account Security and the visible Talent form on `/starter-edit-profile`. The
authoritative identity scope, stable-ID propagation, failure, release-gate, and
reversible-canary contract is in
[BRAND-ACCOUNT-WIRING.md](BRAND-ACCOUNT-WIRING.md).

## Build-profile funnel redirect

`build-profile-redirect.js` keeps a Talent member who is already past the
Build-profile step from re-entering it. On the three `/build-profile/*` pages it
performs the same Xano `get_build_profile_status` read `auth-route.js` performs at
login, but on page entry, which is what covers an arrival from a bookmark, the
back button, or a stale link rather than a fresh session. `build_profile_done`
false means the member stays, since that is who the page is for; true with
`onboarding_done` not `true` goes to `/starter-onboarding`, and both true goes to
`/starter-dashboard`.

`build_profile_done` requires a `freelancers_v3` row **and** a non-empty
`profile_type_30`, the column Build-profile submit stamps. It replaced a plain
row-exists test on 2026-08-04 because the row is created before the form is
finished: 282 of 955 rows carry an empty `profile_type_30`, so those members were
being pushed out of a step they had never completed. `onboarding_done` is true on
zero rows today, which leaves the `/starter-dashboard` leg unexercised by
production data.

The role comes from the sitewide route guard's exported contract rather than a
second copy of the plan table, so a Brand, unmapped, or logged-out visitor costs
no Xano round trip — the guard has already handled them. Everything else fails
open on a 4-second overall budget with a shared `AbortController`: a missing role
contract, a rejected trade, a 401, a 500, an unparseable body, a body without a
boolean `build_profile_done`, or a browser without `fetch` all leave the page
exactly as authored. It needs three page-level embeds installed after the guard;
see [BUILD-PROFILE-REDIRECT-WIRING.md](BUILD-PROFILE-REDIRECT-WIRING.md).

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

## Signup attribution

`signup-attribution.js` captures paid-click attribution, reports the signup back
to Meta, and saves the captured values onto the new member when no other script
will. It is a sibling of the signup redirect marker above and keys off the same
`form[data-ms-form="signup"]` element, so a page that injects a signup modal
wants both modules re-run.

Load it site-wide with `defer`, on every page rather than only on the quiz
funnel. An ad click can land anywhere on the site, the visitor may sign up
several pages later, and the pending-save retry described below has to run on
the page the signup redirects to:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/signup-attribution.js"></script>
```

The Meta Pixel base snippet is installed separately in the Webflow site-head
custom code, with pixel ID `775648331097942`. This script never installs the
pixel. It calls `fbq` only when the pixel has already defined it, so a missing or
blocked pixel leaves the page working and simply sends no event.

### Cookie contract

Every value is stored in a first-party cookie of the same name, with a 72 hour
TTL on `path=/`:

| Cookie | Source |
| --- | --- |
| `utm_source` | `?utm_source` |
| `utm_campaign` | `?utm_campaign` |
| `utm_adset` | `?utm_adset` |
| `utm_content` | `?utm_content` |
| `fbclid` | `?fbclid` |
| `fbc` | Meta's own `_fbc` cookie, copied when ours is unset |
| `fbp` | Meta's own `_fbp` cookie, copied when ours is unset |
| `event_id` | `evt_<uuid>`, generated once and then reused |
| `signup_source` | Path of the page the signup happened on, normalized (lowercased, one trailing slash removed, no query string), written at the Memberstack auth transition |
| `signup_referrer` | Path of the same-origin page the signup was reached from, normalized the same way, written at the same transition. Nothing is written for an absent or cross-origin referrer |

A parameter only overwrites its cookie when the URL actually carries a non-empty
value. The freshest click therefore wins, and browsing the rest of the site never
clears an earlier click. The `_fbc` and `_fbp` copy is re-checked on every page
load, since the pixel writes those cookies itself and can finish loading after
this script runs. The event id is reused for the life of the cookie so the
browser event and any server-side copy of the same registration share one id.

`signup_source` and `signup_referrer` are the two cookies no URL can supply, and
they answer different questions. The source is which page the form was on. The
referrer is where the visitor was when they decided. Both matter because they are
usually not the same page: someone who clicks Get started on `/` signs up on
`/quiz`, so the source is `/quiz` and only the referrer names the homepage. `/`
carries no signup form at all, so the source can never name it.

Both are written at the auth transition and not during the sitewide capture that
runs on every page load. Capturing on load would make each mean "last page
loaded", and each signup page would be overwritten by its own redirect:
`/sign-up` would end up saying `/brand-dashboard` and `/quiz` would say
`/quiz-results`. The referrer is the sharper case, because `quiz-results.js` reads
these cookies a page later: a load-time capture would have replaced the referrer
with `/quiz-results`'s own referrer, which is `/quiz`, so every quiz signup would
claim it came from `/quiz` and the real answer would be gone. The `/all-starters`
modal works for the same reason: the transition fires on the first page load,
before the modal's `?modal-id=signup-modal` reload, so the referrer is still the
page that linked there rather than `/all-starters` itself.

Leaving both out of the URL parameters is what stops a `?signup_source=` or
`?signup_referrer=` in the address bar dictating a field that is meant to report
what really happened. Homepage values store `/`, and `/Starters/John-Doe/` stores
`/starters/john-doe`.

`signup_source` always overwrites its cookie, because reaching the transition on
an armed page is a signup and so always carries a real path. `signup_referrer`
stays silent in three cases instead of storing something wrong:

1. No referrer at all, from direct navigation, a typed URL, or a referrer policy
   that strips it. There was no previous page, so blank is the honest answer.
2. A cross-origin referrer, such as Google, Meta or LinkedIn. The field means the
   page on our own site where they clicked, and the external origin is already
   carried by `utm_source` and `fbclid`, so storing a hostname would poison a
   field of paths for no new information.
3. A path that reads back empty.

### Attribution Memberstack field IDs

The captured values are written onto the member as custom fields. The field ID is
the cookie name with underscores replaced by hyphens:

`utm_source` -> `utm-source`
`utm_campaign` -> `utm-campaign`
`utm_adset` -> `utm-adset`
`utm_content` -> `utm-content`
`fbclid` -> `fbclid`
`fbc` -> `fbc`
`fbp` -> `fbp`
`event_id` -> `event-id`
`signup_source` -> `signup-source`
`signup_referrer` -> `signup-referrer`

All ten field IDs are verified to exist in the Memberstack app config. Do not
rename any of them, or add an eleventh, without changing the app config first:
Memberstack silently drops a write to a field it does not know, so a wrong ID
costs that one value while the rest of the write still lands, with no error
anywhere. Check any ID against the live config with:

```sh
curl -s https://client.memberstack.com/app -H 'X-APP-ID: app_clc2a0dyo00kf0uldcm11fl0q'
```

The ten do not all behave the same way on the member. Eight of them are
last-touch: a fresh ad click is supposed to update them, and every signup rewrites
them from the current cookies. `signup-source` and `signup-referrer` are
write-once. Once a member holds a non-empty value in either, no write from either
script may replace it, because "where did this member come from" stops being true
the moment something overwrites it. The two are guarded as a set because they are
facts about one signup, fixed at one moment: guarding one and not the other would
read as a deliberate distinction that does not exist. Each is still judged on its
own, so a member who has a source but no referrer keeps the source and gets the
referrer filled in.

The guard exists because neither script can actually see a signup. What they see
is a logged-out to logged-in transition on a page that has a signup form, and a
returning member LOGGING IN on such a page is the same event from the outside. The
login-form veto below only runs at `DOMContentLoaded`, so a login form that
appears later, say a modal swapping in "already have an account?", is never seen
at all. The quiz funnel gets there by an easier-to-miss route: a returning member
logs in on `/quiz`, the sitewide script writes the `signup_source=/quiz` cookie and
a fresh `signup_referrer`, they land on `/quiz-results`, and `quiz-results.js`
writes both over their real values. Both writers hold the guard, not just the
direct-save path.

The guard strips only those two keys from the outgoing payload and leaves the rest
of the write intact, so a login on such a page still refreshes the eight click
fields exactly as it does today. Empty, whitespace-only and absent existing values
all count as unfilled and are written over.

When the member's existing value cannot be read at all, the write goes ahead. That
is the opposite direction from how the `CompleteRegistration` decisions below
resolve their doubt, and deliberately so: there, guessing wrong invents a
conversion that never happened, while here the common case by a wide margin is a
genuine first signup whose field is empty. Skipping on an unreadable read would
throw away real attribution on every signup whenever the read hiccups, to protect
against a rarer overwrite. Which failure is cheaper is not the same question in
the two places.

Reading the existing value costs no extra round trip where the member data is
already in hand: the transition handler uses the auth payload it already
unwrapped, and the pending-save retry uses the member it already read. Only a
transition payload that carries no custom fields at all falls back to an explicit
`getCurrentMember()` call.

Which script writes them depends on the signup route. A `/quiz` signup is followed
by `/quiz-results`, so the repo-root `quiz-results.js` writes the fields there as
part of its single quiz save. Every other signup route has no follow-up writer, so
`signup-attribution.js` writes them itself. The map therefore exists in both files.
Keep the two copies in step: a field ID present in only one of them is a value
Memberstack silently drops on one of the two routes. The
`signup-attribution.test.js` drift guard asserts both maps still match, and it
reads the table above out of this file, so the rows have to stay here.

### Attributed signup pages

A page arms the signup watch when **either** of these is true, in this order:

1. its path is in the script's `SIGNUP_PATH_POLICY` map, or
2. it carries at least one `form[data-ms-form="signup"]` and no
   `[data-ms-form="login"]` anywhere on it.

The path map holds the two hand-audited pages and its policy is used verbatim:

| Page | After signup | Who writes the fields |
| --- | --- | --- |
| `/quiz` | `/quiz-results` | `quiz-results.js` |
| `/sign-up` | `/brand-dashboard` | `signup-attribution.js` |

Path matching ignores case and a single trailing slash. Because the map is checked
first, those two keep behaving exactly as they do today whatever happens to their
markup, and `/quiz` in particular keeps deferring its field write to
`quiz-results.js` rather than racing it.

The `signup_source` and `signup_referrer` cookies are the exception to that split.
Both are written on the transition by every armed page, `/quiz` included, before
the question of who saves the fields is even asked. That is what gives the quiz
funnel a signup source and referrer at all: the cookies are written on `/quiz` and
read by `quiz-results.js` on the next page. A page that direct-saves picks the same
cookies up in its own snapshot a moment later.

Rule 2 is what covers every other signup surface, starting with the signup modal on
`/all-starters`. It reuses the `data-ms-form="signup"` attribute Memberstack already
needs, so a new signup surface needs no Designer work and no edit to the script.
Detection counts forms present in the DOM and never checks whether they are visible,
because that modal's form sits in a `<dialog>` that is `display:none` until it opens.
Presence alone is safe: detection only arms a watch, and the pixel and the field save
both fire on the Memberstack auth transition, so a form nobody can reach fires
nothing. A page armed this way direct-saves the fields.

A login marker on the same page is a veto, and it applies to rule 2 only. A page with
both kinds cannot tell a signup apart from a login, and reading a login as a signup
would fire a false `CompleteRegistration` and stamp that browser's UTM values onto a
member who already has their own. A missed attribution is the cheaper failure, so an
ambiguous page is not watched at all and says why in a staging-only warning. Pure
login pages such as `/login` and `/starter-login` fall out of the same rule: no
signup form, no watch.

The two selectors in rule 2 are deliberately asymmetric. Arming is anchored to a real
`form` element, because arming claims a signup happens here and that claim wants
proof. The veto is not anchored, so it matches `data-ms-form="login"` wherever it
sits, including on a wrapper `div`. Nothing pins that marker to a `<form>`:
`auth-route.js` queries it without the prefix, so a login UI wrapped in a div is
markup nobody would think of as a change. Widening the veto costs at most a missed
attribution, while narrowing it would cost a false `CompleteRegistration` on every
login on such a page, which is the failure the veto exists to prevent.

The scan runs once at `DOMContentLoaded`. `window.StartersAttribution.rearm()` re-runs
it for a caller that injects a signup form later, the same shape as
`window.StartersMsRedirect.apply()` in `starters-ms-redirect.js`. It returns whether
the watch is armed and is a no-op once it is, because a second `onAuthChange` listener
would fire `CompleteRegistration` twice.

The script binds no form or submit listeners of any kind. It reads the DOM to decide
whether to watch, and nothing more.

### CompleteRegistration

On a signup page the script reads whether the visitor arrived logged out and then
listens for the Memberstack auth change. The event fires as
`fbq('track', 'CompleteRegistration', {}, { eventID: <event_id> })` and fires for
every signup, including one with no ad parameters at all. If `fbq` is not a
function at that moment the event is skipped and nothing is marked as fired, so a
pixel that loads later in the session can still report the next transition.

An unreadable starting member state is not treated as logged out. The first
definitive auth event after that only arms the watch: a logged-in replay is
ignored (the visitor was already signed in), and a logged-out reading waits for a
later transition. Treating a failed `getCurrentMember` as logged out would fire
the pixel and start a spurious field save on the next auth replay.

A `sessionStorage.startersCompleteRegistrationFired` flag limits the event to one
fire per browser session, and every signup surface shares that one flag. This is
what covers a refresh: Memberstack replays the authenticated state on the next load,
and without the flag the replay would look like a second registration.

### Direct signup field save

A signup form's own redirect can navigate the browser away while the `updateMember`
request is still in flight. The `/sign-up` form carries
`redirect="/brand-dashboard"`; the `/all-starters` modal redirects to
`/all-starters?modal-id=signup-modal`, which reloads the same page to reopen the
modal and cuts the request off just as effectively. The save is therefore written to
survive being cut off:

1. On the transition, the `signup_source` and `signup_referrer` cookies are written
   for this page and then the non-empty attribution cookies are snapshotted into
   `sessionStorage.startersAttributionPendingFields` (field ID keys), and
   `sessionStorage.startersAttributionPendingSave` is set, both synchronously.
   Absent and empty cookies — including whitespace-only values — are omitted, so
   a later untagged visit never blanks a value an earlier tagged visit captured.
   The snapshot is not run through the write-once guard, because nothing may be
   awaited before it reaches storage. The guard runs at each write attempt
   instead, which also means a save the redirect cut off is re-checked against the
   member on the page it completes on.
2. Then `updateMember` is called with that snapshot, minus any write-once field the
   member already has. A write left with nothing to say counts as settled, so a
   member who only owed `signup-source` and `signup-referrer` does not leave a
   marker retrying on every page load forever.
3. The marker and snapshot are cleared only once the write is confirmed.

Every page load checks that marker, and a page that finds it waits for
Memberstack, confirms a logged-in member, and re-attempts the write from the
snapshot (not from live cookies). That is what completes on the landing page a
save the redirect killed on the signup page, without letting a fresh ad click between
those two pages overwrite the values the signup captured. A marker left over from
before snapshots existed (or when storage was blocked on the signup page) falls
back to live cookies.

A marker found while Memberstack reports the visitor logged out cannot ever be
filled, so it is cleared without a write. Two states are excluded from that
cleanup: an unreadable member state is not the same thing as a logged-out one,
and the narrow race where a stale marker was already present at load, this page's
own signup re-raised it while that retry's member read was still in flight, and
the read then comes back logged out. Both leave the marker alone for the next
load.

A failed or unavailable write leaves the marker set, warns on staging, and never
throws into the page. With cookies blocked there is nothing to persist, so the
marker is cleared without a write rather than retried on every page forever.

`window.StartersAttribution.getParams()` returns the current cookie values for
debugging, `window.StartersAttribution.rearm()` reports (and, where a signup form
has appeared since load, starts) the signup watch, and
`window.StartersAttribution.release` reports the shipped version.
Console warnings are staging-only (`*.webflow.io`, localhost, `127.0.0.1`,
`*.trycloudflare.com`) or with `window.STARTERS_DEBUG === true`, so production
stays silent.

Run its focused tests with:

```sh
node --test v3/signup-attribution.test.js
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
outer wrapper's click instead, the CMS identity attributes may sit on its nested
`clickable_link`, which is where Webflow publishes attributes configured on the
Button component. Responsive copies of the same Message component inherit the
page's one valid CMS identity, because a `/hire/<slug>` page represents exactly
one starter. It still listens for modal.js's `modal-open` event, and a
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

The identity guard accepts both live `mem_<cuid>` ids and Memberstack Test Mode
`mem_sb_<cuid>` ids. It rejects empty suffixes, hyphens, and any other extra
underscore so Designer placeholders or hand-edited deep links cannot create
unintended TalkJS users.

The three identity attributes must be *field bindings*, not literal values, or
every profile ships the same starter's id. Bind `Profile Photo Xano` rather than
`Profile Photo`: the latter is an Image field and is not reliably offered for
attribute binding, while the former is PlainText holding the durable Xano vault
URL. `messages-profile-upgrade` is a static path, not a binding, and goes on the
chat container or the identity carrier — the same nested `clickable_link` that
holds the other `messages-profile-*` attributes — not the outer modal-trigger
wrapper. Give the container a height in the Designer; a zero-height box renders a
zero-height chat.

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

On staging the module warns when the page has no usable
`messages-profile-message` identity at all. A profile page usually has several
Message controls (hero, sticky nav, mobile CTA), but Webflow may publish the CMS
attributes only on one nested `clickable_link`; the controller arms every
wrapper from that page identity. The warning therefore indicates a missing CMS
binding or backfill, not an unbound responsive copy.

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

## Direct-hire project form

`project-form.js` is the authenticated V3 direct-hire adapter for the
Designer-owned Brand **Contract Generation** form on `/hire/<slug>`: it posts
the form to Xano `POST projects/create-direct/v3` through the existing
authenticated `window.Opp30` Memberstack-to-Xano bridge, and also owns the
Memberstack hiring-manager prefill, the CMS `data-sp-fill` attribute presets,
and the `data-set-current-date` initialization that the page's Code Embeds used
to provide. It is deliberately scoped to the
`[data-modal-trigger="generate-contract"]` triggers and the
`dialog[data-modal-target="generate-contract"]` modal, and generates no form
HTML. The authoritative field, prefill, state, and release contract lives in
[PROJECT-FORM-WIRING.md](PROJECT-FORM-WIRING.md).

Run its focused test with:

```sh
node --test v3/project-form.test.js
```

## Starter project proposal form

`starter-project-form.js` binds the existing V3 Starter Dashboard **Start a
Project** modal. The authoritative scope, endpoint, Designer, user-state, and
release contract lives in
[STARTER-PROJECT-FORM-WIRING.md](STARTER-PROJECT-FORM-WIRING.md).

## Brand project-proposal approval

`brand-project-proposals.js` adds pending Starter requests to the existing
Brand Dashboard **Action Items** panel. The backend, Designer markup, action,
feedback, and release contract lives in
[BRAND-PROJECT-PROPOSALS-WIRING.md](BRAND-PROJECT-PROPOSALS-WIRING.md).

Run the focused tests with:

```sh
node --test v3/starter-project-form.test.js v3/brand-project-proposals.test.js
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

- Identify the favourites list section with a dedicated presence-only marker:
  `data-starters-list` (no value required). Put it on the one
  `.section_all-starters-body` (or equivalent wrapper) that owns the paid-Brand
  Algolia browse and card template. The module keys boot, decoration, pre-warm,
  and positioning CSS off `[data-starters-list]` only — **not** off any
  Memberstack `data-ms-content` gate. Renaming the gate (e.g. from
  `premium-brands` to `paid-plans`) must never switch favourites off again; the
  gate on that section is presentation only.
- Any other `.section_all-starters-body` without the marker gets
  `.expert-card_favorite-wrapper` hard-hidden. Favourite wrappers outside those
  list sections (e.g. membership-modal static Expert Cards) are left untouched.
- Each marked-section Algolia card exposes `data-wf-algolia-hit-objectid` and
  contains an `.expert-card_favorite-wrapper`; the module adds the canonical
  `wf-xano` favourite attributes as cards render.
- Optional (not required while `/favorites` owns “view my saved”): one
  Designer-owned radio group for Show all / Favourites. Mark the inputs or
  their Webflow radio-field wrappers with `data-ts-favorites-view="all"`
  (checked by default) and `data-ts-favorites-view="favorites"`. Radios must
  live **inside** the `[data-starters-list]` section. The module filters the
  existing Algolia grid by favourite `objectID`; no second results grid. With no
  radios present, hearts still work and the view-filter path never fires. The
  grid's Designer-owned empty state handles a member with no favourites.
- The page keeps its small inline `ms-loaded` reveal snippet. Page reveal is
  deliberately independent of this CDN asset so a CDN failure cannot leave
  the page hidden.

Designer checklist (restore hearts after a gate rename):

1. On `/all-starters`, select the list section that should own hearts.
2. Add custom attribute **Name** `data-starters-list`, leave **Value** empty
   (presence only).
3. Publish the site.
4. After this module is on jsDelivr `@latest` (or a pinned tag that includes the
   marker change), hard-refresh as a paid Brand and confirm a heart click fills
   and persists across reload.

Optional future radios (same section, whenever you want the inline filter back):

1. Add a radio group with two inputs.
2. On “Show all” (or its radio-field wrapper): `data-ts-favorites-view="all"`,
   checked by default.
3. On “Favourites” (or its wrapper): `data-ts-favorites-view="favorites"`.
4. Publish. No script change required if this module already ships the filter
   binding.

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

`Category` is the single Classification value, resolved from the record's
`primary_category_ref` — **not** `category_refs[0]`, and `category_refs` is not used
for display. The client reads `category_resolved` (singular: one string or one
object) first, accepts a plural `categories_resolved` array as a secondary shape
(picking the entry whose `id` matches `primary_category_ref`), and otherwise falls
back to the legacy `Category` string, de-hyphenating it only when it looks like a
slug — hyphens and no spaces, so Brian's `marketing-strategy-leadership` becomes
`marketing strategy leadership` while Kaeser's `Creative & Brand` passes through.
That fallback relies on a `text-transform: capitalize` rule scoped to the Category
bind alone, since Location must not be capitalized.

⚠ Xano's `in` where-clause returns **table order**, not the order of the ids handed
to it, so resolved arrays are re-sorted client-side into the record's ref order
(`roles_resolved` by `role_refs`, plural categories by `category_refs`) whenever
entries carry `id`; entries without a matching id keep server order and go last.
`primary_role_ref`, `secondary_role_ref` and `tertiary_role_ref` are **legacy and
deliberately ignored** (Jerico 2026-07-30) — `role_refs` is both the authoritative
list and the ordering source.

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

## Onboarding done redirect

`onboarding-done-redirect.js` is the **read half** of the `/starter-onboarding`
completion pair: on load it raises the shared `[data-page-spinner]`, trades the
Memberstack JWT for a Xano token, reads
`starters_onboarding/get_freelancers`, and replaces to `/starter-dashboard`
only on a literal `onboarding_done === true` — keeping an already-finished
member out of the onboarding flow when they arrive via bookmark, back button,
or stale link. Everything inconclusive fails open and renders the page as
authored, because the redirect is a UX courtesy and never a security boundary.
It never writes to Xano; the post-submit journey belongs entirely to its
pinned pair, `patch-onboarding-status.js` (below) — never ship one half
without the other. The authoritative wiring, QA order, and troubleshooting
live in [ONBOARDING-DONE-REDIRECT-WIRING.md](ONBOARDING-DONE-REDIRECT-WIRING.md).

Run its focused test with:

```sh
node --test v3/onboarding-done-redirect.test.js
```

## Onboarding patch status

`patch-onboarding-status.js` is the **write half** of the same
`/starter-onboarding` pair: it detects completion from Webflow's own
`.w-form-done` success state (one `MutationObserver` per `.w-form` wrapper, so
a click that only means "tried" never counts), then raises the shared spinner,
hides the submitted form, `PATCH`es
`starters_onboarding/set_onboarding_status` with retries and fresh token
trades, and takes the member to `/starter-dashboard` once the write settles
either way — a missed mark self-heals on a later visit. It never reads status
and never routes anyone except its own member after their own submit.
`window.StartersPatchOnboardingStatus.markOnboardingDone()` exercises the
write by hand on staging. Installs only as a pinned pair with
`onboarding-done-redirect.js` (above); the authoritative wiring lives in
[ONBOARDING-PATCH-STATUS-WIRING.md](ONBOARDING-PATCH-STATUS-WIRING.md).

Run its focused test with:

```sh
node --test v3/patch-onboarding-status.test.js
```

## Xano grabber (live value mirror)

`xano-grabber/xano-grabber.js` copies a value that is **already rendered** in one
place into every element that shares its `wf-xano-grab-id`. It exists because
wf-xano binds one template per wrapper and a value can only be bound inside the
wrapper that fetched it: a hero band outside that wrapper has no instance of its
own, and giving it one means a second GET of the same endpoint and a second render
to keep in sync. Mirroring the rendered DOM value costs no request and cannot
disagree with what the user is already looking at. The Designer owns all markup;
the script writes exactly two things — `textContent` on a non-IMG landing, and
`src` (after `removeAttribute('srcset')`, wf-xano's own order) on an IMG landing.

The full attribute table, the onboarding photo checklist and the debug overlay
columns live in
[xano-grabber/XANO-GRABBER-WIRING.md](xano-grabber/XANO-GRABBER-WIRING.md). The
short version: `wf-xano-grab-element="source"` / `="landing"` plus a shared
`wf-xano-grab-id`; add `wf-xano-grab-list` on a source container and
`wf-xano-grab-list-container` + a `wf-xano-grab-element="list-item"` child on the
landing for list mode; `wf-xano-grab-item` on a landing picks one record. There is
no `wf-xano-grab-type` override in v1, so an IMG source into a text landing is
reported as a `MISMATCH` rather than sitting silently gated.

Two rules carry the whole design. **Real-content gating**: an empty or
`data:`/`blob:` value never mirrors, so the landing keeps the placeholder the
Designer authored. **Never-revert**: once a landing holds a real value, only
another real value replaces it. Both are forced by how wf-xano re-renders —
`load()` removes every `[wf-xano-item]` clone *before* the fetch starts, so for
the whole width of a refresh there is no source element on the page at all, and a
member with no photo fires no mutation whatsoever. For the same reason a source is
a **descriptor**, re-resolved by attribute on every pass, never a cached node; and
descendants of `[wf-xano-element="template"]` are never sources, because the
template keeps its authored `data:` placeholder for the page's whole life and
precedes its clones in DOM order.

List mode mirrors container-to-container. Items are the source container's
`[wf-xano-item]` children when any child carries the marker — which is what keeps
wf-xano's `loader`/`empty` state blocks, living *inside* the container, from being
mirrored as cards ("Loading team…" as a team member was the finding that shaped
this). Leaf text slots pair by index and **unfilled slots are blanked**, so
Designer lorem cannot leak to production; an item with no image, or one still
holding a `data:` placeholder, leaves the clone's authored avatar in place and the
img is never hidden. Clones are cleared only on a *confirmed* empty — a visible
`wf-xano-element="empty"` block on the source container — never on the transient
clear that precedes every fetch.

When one id has several rendered sources (the normal case, since the source
attribute is authored on the template and every clone inherits it) the first
source whose **computed display chain is visible** wins, with DOM order as the
tie-break: the onboarding page keeps both form blocks in the DOM and switches them
with inline `display`, so plain first-in-DOM would mirror the hidden form's card.
`wf-xano-grab-item` on the landing overrides that — `#2` is a 1-based index into
the rendered sources (it shifts with sort/filter, which is the "featured = first"
pattern), anything else matches a card's `data-wf-xano-id`. Two landings can
therefore mirror two different records of one list.

Re-renders are followed by **one body-level MutationObserver**
(`childList` + `subtree`, plus `attributes` filtered to `src`, `srcset`, `style`,
`class`, `wf-xano-item`, `data-wf-xano-id`, `data-wf-xano-bound-value`), because
wf-xano dispatches no document-level render event and no instance-created event,
and sources and landings may share no wf-xano ancestor. `childList` does double
duty — it catches new clones *and* text writes, since a `textContent` assignment
replaces the text node; `characterData` is pointless against this library.
Re-scans coalesce through `setTimeout(…, 0)`, never `requestAnimationFrame`,
which is throttled to zero in the hidden pane this repo QAs in. The loop guard is
three-part and all three parts are load-bearing: records whose target is inside a
landing or one of our clones are ignored, every write is compared against the last
value written there, and `takeRecords()` drops the echo at the end of each pass.
A `WfXano.push()` belt subscribes to `results`/`error` when wf-xano is present,
but it is strictly optional — the observer alone is sufficient, and the module
works on a page with no wf-xano at all.

`?xano-grab` on a staging host renders a pairing overlay: per grab-id, sources
found, landings found, state (`REAL` / `GATED` / `WAITING` / `MISMATCH` /
`ITEM NOT FOUND` / `ERROR`), list item counts, each candidate's
`data-wf-xano-id` (which is where you read the value for `wf-xano-grab-item`),
duplicate sources, orphans, and the pass counters. It needs the param **and** the
staging host: it prints record ids, so `STARTERS_DEBUG` does not unlock it — that
flag only re-enables the console warnings. Warnings are printed once per distinct
problem, and the orphan ones wait out a 3 s grace window, because at
`DOMContentLoaded` nothing has rendered yet and warning immediately would flag
every healthy page.

Install one deferred tag on the page (it is inert wherever the grammar is absent),
pinned to a tag, next to a pinned wf-xano:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/wf-xano@v0.28.0/wf-xano.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@vX.Y.Z/v3/xano-grabber/xano-grabber.js"></script>
```

Script tag order does not matter: this file only ever pushes into
`window.WfXano`, which both shapes of that global defer correctly. Never branch on
`Array.isArray` and call the arm function directly — wf-xano assigns
`window.WfXano = {api}` at module scope before `boot()` creates any instance, and
that branch was a real shipped bug in a sibling module.

Run its focused test with:

```sh
node --test v3/xano-grabber/xano-grabber.test.js
```

## Scheduling auth

`scheduling-auth.js` owns the Bearer-token adapter for the V3 availability,
scheduling configuration, and Brand paid-call payment-method calls. Webflow
should load it with a small `defer` script tag instead of carrying a duplicate
copy in page head/footer code.

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/scheduling-auth.js"></script>
```

Current safety boundary:

- Runs across `the-starters-3-0.webflow.io`.
- On the V3 custom domains, runs only on `/hire/jp-test`,
  `/starter-dashboard`, and `/brand-dashboard`; all other paths remain inert.
- Authenticates only explicit reviewed `/v3` routes on the configured Xano
  origin, including the two Brand paid-call payment-method paths documented
  below. It does not use a group-wide prefix allowlist.
- Temporarily retains the exact legacy configuration, availability, and Starter
  paths that this shared module authenticated before the stage adapter existed.
  This prevents a release-time regression on non-stage staging consumers; the
  stage adapter intercepts those paths first on its seven approved staging paths
  and three exact production surfaces.
- Caches the Xano token and retries once after a `401`; a failed refresh returns
  the original `401`.
- Invalidates cached and in-flight authentication when the Memberstack session changes.
- Exposes `window.getXanoAuthToken` and `window.xanoAuthFetch` for page-owned
  code.
- Dashboard controllers reuse the site-head `window.memberReady` promise for
  their initial identity snapshot and `window.getXanoAuthToken` for the
  Opportunities, Points, Messages, and Stripe reads. This keeps one shared
  Memberstack bootstrap and one in-flight Xano token trade per member session;
  live identity checks after auth changes and before writes still call
  Memberstack directly and fail closed on a changed member.
- Transparently wraps reviewed direct `/v3` requests while the stage adapter
  migrates legacy component callers.
- Installs synchronously and takes ownership from the legacy bridge in
  `opportunities-3.0.js` regardless of script order.

Maintenance rule: new reviewed `api:tCpV3oqd` scheduling or paid-call browser
calls should use `window.xanoAuthFetch`. Keep endpoint scope explicit; do not
turn this into a blanket credential injector. Every route used by the stage
adapter, availability modules, and paid-call client must be listed as an exact
`/v3` path.

Public helpers:

- `window.xanoAuthFetch(input, init)` accepts the same inputs as `fetch`, adds
  Bearer authentication for scoped V3 paths and rejects if initial
  token acquisition fails. Calls outside that scope and calls with an existing
  `Authorization` header pass through unchanged.
- `window.getXanoAuthToken({ forceRefresh: true })` returns the cached,
  member-scoped token or explicitly replaces it. The options argument is
  optional.

The transparent `window.fetch` wrapper exists only for legacy inline callers. If
initial token acquisition fails, it logs a warning and makes one unauthenticated
request; direct `xanoAuthFetch` callers receive the error. Both interfaces preserve
network rejections and reject with code `MEMBER_SCOPE_CHANGED` if the Memberstack
session changes while authentication or a scoped request is in flight.

Run the focused test with:

```sh
node v3/scheduling-auth.test.js
```

## Scheduling V3 stage adapter

`scheduling-v3-stage.js` is the compatibility layer for the existing Webflow
scheduling component. It installs on these exact staging paths:

- `/starter-dashboard---availability-stage`
- `/brand-dashboard---availability-stage`
- `/starter-dashboard`
- `/brand-dashboard`
- `/messages-stage`
- `/hire-stage`
- `/hire/jp-dionisio`

The seventh path is the existing approved Test Talent CMS item. The exact paths
`/hire/jp-test`, `/starter-dashboard`, and `/brand-dashboard` are enabled on
`thestarters.com` and `www.thestarters.com`; every `*-stage` path remains
staging-host only. The adapter does not install on any other `/hire/*` item or
on `detail_hire`. Production `/hire/jp-dionisio` is explicitly contained by
both synchronous scripts: scheduling-group requests return HTTP `410` without
installing authentication, discovery overrides, or booking identity. The
adapter maps the reviewed legacy scheduling paths to their exact `/v3` routes,
preserves request method, body, headers, and query parameters, and sends the
rewritten request through `window.xanoAuthFetch`.

On the exact production `/hire/jp-test` canary, and on the retained staging-only
`/hire/jp-dionisio` canary, the two public booking-discovery
reads use Brand-safe contracts instead of Talent-owner contracts:
`starter/get_booking_profile/v3` returns only the Starter row ID and calendar
grant, while `nylas_configurations/get_bookable/v3` returns the bookable
configuration metadata. Every other installed surface uses the self-only
`starter/get_by_memberstack/v3` and grant-owner-only
`nylas_configurations/get_all/v3` routes.

Those two approved Hire booking surfaces also contain the post-booking Nylas
DOM race. After a successful `bookedEventInfo` event includes a `booking_id`,
the adapter waits for the Designer-authored `[schedule-step="success"]` inside
the same `[popup-booking]` to be visible, then detaches only that popup's
`nylas-scheduling` element. Failed or incomplete events and a hidden or missing
success step leave the scheduler mounted. A completed handoff stamps
`data-scheduling-booked-success="ready"` on the document root. This listener is
not installed on either dashboard or any other scheduling surface.

The boundary is fail-closed:

- `booking_record/get_with_filters` and its held `/v3` draft are blocked.
- `notetaker/get_transcription` is blocked because it is an arbitrary-URL
  authenticated-header proxy.
- Any other unclassified `api:tCpV3oqd` scheduling route is blocked with HTTP
  `410` before a network request is made.
- `calendars/get_availabilities` remains deliberately unmapped and therefore
  blocked on every installed scheduling surface because its payload has not
  been proven compatible with `scheduler/get_availability/v3`.
- Only the approved legacy Stripe customer, intent, setup-intent, and
  payment-method provider routes pass through temporarily.

`scheduling-v3-stage-component.html` is the loader for the isolated cloned
Webflow component used by the stage surfaces and canonical dashboards. Keep it
as the clone's first Code Embed, before the cloned scheduling logic embeds, and
keep the cloned UI and logic intact. Auth and route ownership load synchronously
so immediate legacy code cannot race the adapter; the dashboard and availability
UI modules remain deferred. Do
not replace the shared `Call Scheduling - Global Code` component while the live
`detail_hire` template still uses it. The isolated clone is installed on the
stage surfaces and both canonical dashboards; releases update its Git-owned
files through the reviewed semver tag and jsDelivr purge flow.

Runtime contract:

- `data-scheduling-v3-stage` on the document root reports `ready` once the
  adapter owns `window.fetch`, or `auth-unavailable` when a mapped route is
  reached before `window.xanoAuthFetch` exists (the request is then blocked).
  On the protected production `/hire/jp-dionisio` profile it reports `disabled`;
  otherwise, the attribute is not set on pages where the adapter does not
  install.
- `window.StarterSchedulingV3Stage` is a frozen object exposing `paths` (the
  seven installed stage paths), `productionPaths` (the exact production Hire
  canary and canonical dashboards), and `routeMap` (the legacy-to-`/v3` route
  map).
- `window.__tsSchedulingV3StageOriginalFetch` retains the pre-adapter
  `window.fetch` for provider and non-scheduling passthrough.

Run the focused test with:

```sh
node v3/scheduling-v3-stage.test.js
```

## Dashboard call sections

`dashboard-calls.js` binds the Designer-authored call sections on the exact
`/starter-dashboard`, `/brand-dashboard`, and their two availability-stage
paths. It is inert everywhere else. Load it through
`scheduling-v3-stage-component.html`, after the synchronous scheduling auth and
stage adapter; that loader is the authoritative script order.

The controller obtains the current Memberstack member, reads
`booking_record/get/v3` through `window.xanoAuthFetch` with that member's ID,
and then independently requires the returned row's role-specific
`starter_data.memberstack_id` or `brand_data.memberstack_id` to match. A missing
session, unavailable auth bridge, malformed response, or absent/mismatched
participant identity fails closed. An auth change immediately clears rendered
identity data and booking rows; a response started under the prior session can
never repaint the page.

Webflow owns all call-section markup. Each section must provide:

- `[bookings-section="calls"]` and, on Starter, optionally
  `[bookings-section="requests"]`;
- a matching `[bookings-list="<name>"]`,
  `[bookings-item-template="<name>"]`, `[bookings-loader="<name>"]`, and
  `[bookings-empty="<name>"]`;
- optional `[bookings-count]`, `[bookings-load-more]`, and
  `[booking-filter="<status>"]` controls, with the section's filter controls
  wrapped by `.tabs-button_component.is-dashboard`; and
- card value slots using the existing `[booking-element]`, `[label-text]`,
  `[payment-status-wrap]`, and `[brand-status]` attributes.

The script clones the authored item template in pages of six, deduplicates by
canonical booking ID, and sorts newest first. Starter pending rows appear under
requests and all other rows under calls; Brand keeps one calls list. Legacy card
action controls are hidden because V3 has no identity-safe mutation handler;
only a confirmed row with a canonical meeting link exposes its join control.
Loading, empty, and error displays reuse the authored elements instead of
generating UI. The filter wrapper stays hidden during identity resolution and
on errors, and is shown only when the member's full canonical booking rows for
that section are non-empty. A selected status that has no matching rows does
not hide the wrapper, so the member can return to All.

The same controller owns filter-wrapper visibility for the existing wf-xano
Projects lists keyed `dash-projects` and `dash-brand-projects`. Both wrappers keep
wf-xano's default remote filtering contract. Each instance's
`.tabs-button_component.is-dashboard` stays hidden until a successful wf-xano
state proves that the unfiltered canonical list contains at least one item, or
until the member selects a status filter that they must be able to switch away
from. Once projects are known to exist, the controls stay visible during every
later loading/error transition and when a selected status returns no matching
rows, so the member can always switch filters. Each status change continues
through wf-xano's normal Xano request path. Missing-instance, unresolved
unfiltered, confirmed-unfiltered-empty, and auth-transition states remain hidden.
Xano remains authoritative for every filter result, and every fetch uses
`cache: 'no-store'`. Nothing is persisted to localStorage or shared across
members, tabs, or page loads.
The existing Designer-owned project `Show more` control follows wf-xano's
authoritative `hasMore` state and appends the next 12-item server page. When a
Projects wrapper has no authored control, the controller clones an existing
Webflow `Show more` button, scopes the clone to that wf-xano instance, and wires
it once; it does not generate new button markup or replace an authored control.
The control hides when the server pages are exhausted. Brand and Starter
Projects endpoints must accept `page`/`per_page`, page `core_projects_v3` before
per-project invoice/profile/review enrichment, and return `itemsTotal`,
`pageTotal`, `curPage`, `nextPage`, and `prevPage`. `opportunities-3.0.js`
consumes the same wf-xano instance state for project-action decoration; it must
not issue a second dashboard list request. Lifecycle and review refreshes replay
the loaded page range through that instance so appended rows remain visible. A
direct endpoint fallback remains only for older surfaces without a wf-xano wrapper.
Call controls reveal the next six
matching canonical rows under the active client-side filter and hide when that
filtered list is exhausted.

On Brand only, the same resolved Memberstack snapshot paints the existing hero
through the Designer custom-attribute contract, never through styling classes:
`free-user` populates `hero-element="brand-first-name"`, `last-name` populates
`hero-element="brand-last-name"`, and `company` populates
`hero-element="brand-company"`. Those values clear before every session refresh
and on any failure, so another member's projection cannot survive an auth
transition. The avatar carries `hero-element="brand-image"` for contract
completeness, but the controller never writes it: its `src` stays owned by
Memberstack's native `data-ms-member="profile-image"` binding, which handles
both the empty-photo placeholder and a populated member photo.

The Brand dashboard's existing `form[data-ms-form="profile"]` remains a native
Memberstack form and keeps sole ownership of its submit. The controller observes
that submit without cancelling it, reads the intended `free-user`, `last-name`,
and `company` values from the authored fields, and retries `getCurrentMember()`
for a bounded period. It repaints the hero only after Memberstack readback
matches all three submitted values. A failed, delayed beyond the retry window,
or superseded save leaves the current hero unchanged.

Runtime contract:

- `data-dashboard-calls-v3` on the document root reports `loading`, `ready`, or
  `error`.
- Each valid section reports `data-bookings-state="loading"`, `ready`, `empty`,
  or `error`.
- Designer-authored duplicate dashboard tiles whose heading is exactly `Calls`
  or `Call Requests` are hidden when they do not carry `[bookings-section]`.

Run its focused test with:

```sh
node --test v3/dashboard-calls.test.js
```

## Booking-stage availability initializer

`scheduling-availability-init.js` restores the V2 availability visibility
contract used by the staging booking page and canonical `/starter-dashboard`,
while keeping it independent from V3 Calendar connection state. Published CSS
hides both Calendar Settings controls; this initializer resolves the logged-in
member's saved scheduling availability and reveals exactly one:

- `[init-availability]` for first-time setup;
- `[update-availability]` for an existing saved schedule.

It installs on the Webflow staging hostname and on the exact
`/starter-dashboard` path at `thestarters.com` and `www.thestarters.com`. It
accepts the legacy scheduling availability shape
(`{ items, manager? }`), and treats a V3 starter without a legacy scheduling row
as a first-time setup instead of leaving both controls hidden. It also selects
the correct initial modal step. Every boot performs the authenticated canonical
reader call even when a member-scoped availability cache exists: a grant,
calendar, or scheduler configuration can change independently of saved hours,
so the cache is write-through compatibility state rather than connection proof.
The initializer reads `/api:tCpV3oqd/starter/get_by_memberstack/v3` through
`window.xanoAuthFetch`, safely treating a JSON `null` response as a first-time
V3 starter. The authenticated helper is required; an unavailable helper fails
closed instead of falling back to the page-provided unauthenticated reader.
The canonical profile reader is not used because its `Availability` field is the
workload range, not the legacy scheduling object. Failed or malformed reads, or a
Memberstack member change or logout during the read, set the document status and
Calendar connection state to `error` without claiming connection or availability
readiness. The Designer-authored hero trigger and Dashboard Calendar action row
remain available and route the shared native modal to `config-request-error`. When
the live Memberstack client is available, its logged-out result is authoritative
over stale `memberReady` data. Initialization can be retried with
`window.StarterSchedulingAvailability.initialize()`.

Webflow markup contract:

- The first-time and saved-schedule controls use `[init-availability]` and
  `[update-availability]`, respectively.
- The Dashboard Calendar action row uses `[calendar-connection-action]` and its
  clickable component carries `data-modal-trigger="set-availability"`. The row
  stays Designer-authored; the initializer only shows/hides it and selects an
  existing native modal step.
- The hero and Dashboard Calendar triggers share the authored
  `dialog[data-modal-target="set-availability"]`. Lumos normally owns its
  open/close lifecycle. After a trigger click has bubbled, the initializer uses
  the registry when available, then falls back to the dialog's native
  `showModal()`/`close()` contract only if the dialog is still closed. This
  fallback is scoped to this dialog and preserves its cancel and
  `[data-modal-close]` controls.
- Modal panels use `availability-step="setup-form"` for first-time setup and
  `availability-step="default"` for an existing schedule.
- Published CSS should keep both controls hidden until initialization completes.

Runtime contract:

- `data-scheduling-availability-init` on the document root reports `loading`,
  `init`, `update`, `error`, `not-applicable`, or `missing-controls`.
- `data-scheduling-calendar-state` reports `loading`, `disconnected`,
  `connected`, `reconnect`, or `error`. `connected` is terminal only after the
  writer proves a grant, a calendar, and at least one scheduler configuration;
  partial or stale provider state is `reconnect`.
- `window.STARTER_AVAILABILITY` contains the normalized availability after a
  successful read and is `null` after an error.
- `window.STARTER_SCHEDULING_CONNECTION` contains only non-secret connection
  state. The initializer always supplies `state`; once the writer runs, it also
  supplies boolean grant/calendar flags, configuration count, and manager.
  Provider identifiers are never exposed through this object.
- `starterSchedulingAvailabilityReady` carries
  `{ memberId, source, state, connectionState }`;
  `source` is `starter`, `default`, or `query-test`, and `state` is
  `init`, `update`, or `null` when neither control exists. For `query-test`,
  `memberId` is the selected test member rather than the authenticated member.
- `starterSchedulingConnectionStateChanged` carries the non-secret connection
  summary and repaints both the hero entry point and Calendar action row. The
  row remains visible and actionable for loading/disconnected/reconnect/error,
  and is hidden only after connected proof.
- `starterSchedulingAvailabilityError` carries `{ message }` after a failed read.
- `window.StarterSchedulingAvailability` exposes `initialize()` for retries,
  `normalizeAvailability(value)` for the legacy object or JSON-string shape,
  `renderState(availability, connectionState)` for repainting the controls and
  initial step, plus `setConnectionState(state, detail)` for writer events.

This module intentionally owns initialization and visibility only. The writer
flow lives in `scheduling-availability-writer.js` (below).

The authoritative loader order and release URLs live in
`scheduling-v3-stage-component.html`.

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
- Cached availability stays member-scoped: the override ID gets its own cache
  entry and never reuses the authenticated member's cache. The canonical reader
  still runs on every boot before any connection state is rendered.
- The override remains independently staging-host gated. On both custom
  production domains, `test_member_id` is inert and the canonical dashboard
  always reads the authenticated Memberstack member.

Run its focused test with:

```sh
node v3/scheduling-availability-init.test.js
```

## Booking-stage availability writer

`scheduling-availability-writer.js` is the versioned port of the legacy V2
availability writer for the staging booking page and canonical Starter
dashboard: availability form submit, manager selection (platform-managed
virtual calendar vs the member's own calendar), Nylas scheduler configuration
create/update, timezone set, and the calendar OAuth grant redirect — with the
loader (`[data-custom-loader]`) and the success/error modal steps restored. It
loads after `scheduling-auth.js` and `scheduling-availability-init.js`; the
authoritative script order and release URLs live in
`scheduling-v3-stage-component.html`. Releases use the reviewed semver tag and
jsDelivr purge pipeline.

Safety boundary:

- Installs on the Webflow staging hostname and only the exact
  `/starter-dashboard` path on both production hosts. It stays inert on the
  production `/brand-dashboard` and all production Hire profiles.
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

Designer UI-step contract retained. Published-markup audit (2026-07-21) of the
shared `dialog[data-modal-target="set-availability"]` shell: the initializer
owns the open/close fallback documented above; the writer only switches steps
inside it. All **11** step wrappers exist:

| `availability-step` | contents the writer drives |
| --- | --- |
| `default` | card list + Designer-authored cloning template (template sits **outside** `[availability-list]` and is hidden when rendered cards appear; clones remain visible), `availability-create/edit/remove`, `how-to-manage`, `[config-manager-element]` with `change-manager-link` buttons (platform → `how-to-manage`; calendar → `disconnect-confirm` with `data-to="disconnect-calendar"`), `config-initial-element="general"` |
| `setup-form` | `[availability-form]` (3 `set-availability-group` wrappers: days/start/end), back → default, `submit` + `[btn-text]`, `config-initial-element="setup-form"`, loader |
| `how-to-manage` | two `[config-manager]` tiles (platform pre-`is-active`), `manager-submit`, back, loader |
| `disconnect-calendar` | confirm screen: `disconnect-calendar` action, back, loader |
| `virtual-connect`, `pre-redirect` | passive status screens; `pre-redirect` remains visible while the same-tab hosted OAuth URL is prepared |
| `success`, `success-disconnect`, `config-request-error` | back → default |
| `success-calendar` | retained legacy fallback; the current manager-selection flow bypasses it |
| `reload-page` | legacy fallback only; the current same-tab OAuth handoff returns directly to the dashboard callback |

The manager-selection tiles and submit action are normalized at runtime to the
supported choices: `Use platform availability` or `Connect Google Calendar`.
Selecting Google clears the previous grant, restores the disconnected state
from the canonical scheduling row, prepares the authenticated hosted OAuth URL,
and navigates the current tab without a second confirmation. The same-tab
handoff intentionally avoids delayed `window.open`, which browsers block after
asynchronous Xano requests, and preserves the sessionStorage intent required by
the callback verifier.

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

Grant state (`nylas_grant_id`/`email`/`calendar_id`) is sourced only from the
canonical scheduling row via an authenticated `get_by_memberstack` read at
bootstrap. Memberstack remains the browser authentication source, but its
legacy grant custom-field mirrors are not connection authority and cannot make
a missing or stale Xano connection appear ready. A grant-less save returns to
the `default` step instead of legacy's silent dead-end on the form.

Connection mutations follow the same authority rule. OAuth persistence,
virtual-calendar setup, manager changes, and disconnect/clear flows treat their
write responses only as acknowledgements. Before publishing a terminal Calendar
state, the writer re-reads the authenticated `availability_v3` projection and
then reads `nylas_configurations_v3` for the grant returned by that projection.
If either canonical read fails, the UI remains in the authored error path rather
than inferring readiness from a mutation response.

Deliberately NOT ported from the legacy inline writer:

- the hardcoded test member id and dashboard/onboarding redirects;
- the `dev-speed-test` localStorage payload override;
- the `availability-popup-shown` auto-open behavior (the init module owns
  initial visibility);
- the bookings list machinery — the writer delegates to the page embed's
  `window.generateBookingsList` / bookings-aware `window.clearGrantData` when
  present, and otherwise falls back to a minimal authenticated grant clear
  (`starter/clear_calendar_data/v3` + configuration deletes through `/v3` +
  `grants/delete/v3`).
- One deliberate behavior fix: a failed configuration update no longer falls
  through to the `success` step (legacy phantom-success bug).

V3 endpoint contract (no Airtable row keys anywhere): the writer calls
`grants/oauth/v3` with `in_state: <authenticated member id>` and an
allowlisted `in_redirect_uri`, and sends that same URI and state to
`grants/add/v3`; it calls `grants/add_virtual/v3` with
`{ grant_id, member_id }`. Both are new memberstack_id-keyed endpoints; the
legacy airtable_id-keyed
`grants/oauth`/`grants/add`/`grants/add_virtual` remain untouched for V2. The
OAuth return is handled by the availability writer via `grants/add/v3`
(server-side code exchange or hosted-grant verification + persist in one
call).

All other writer reads and writes now use their reviewed `/v3` routes:
`starter/get_by_memberstack`, `starter/set_timezone`,
`starter/clear_calendar_data`, `nylas_configurations/get_all`, configuration
create/update/delete, virtual-account/calendar creation, and grant deletion.
On the approved production dashboard, bootstrap remains read-only: a missing
row timezone is persisted through `starter/set_timezone/v3` only when the
member submits an availability or calendar action. A member-scoped cached
timezone can supply that value, but does not count as canonical persistence.

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
- `starterSchedulingConnectionStateChanged` carries `{ state, hasGrant,
  hasCalendar, configurationCount, manager }`. Bootstrap fails closed to
  `error` when the canonical configuration read fails. An invalid or cancelled
  OAuth return opens the existing `config-request-error` panel without a grant
  write.
- `window.StarterSchedulingAvailabilityWriter` exposes `initialize()` for
  retries plus `switchStep`, `daysAlias`, `getAvailArray`, and
  `publishCalendarConnectionState`.

Run its focused test with:

```sh
node v3/scheduling-availability-writer.test.js
```

## Booking-stage availability section

`scheduling-availability-section.js` is the non-modal counterpart to the
writer above, wiring the Designer "Dashboard / Calendar" component on the
canonical `/starter-dashboard` page: availability is always visible instead
of living behind the `set-availability` modal, and each availability item now
carries its own inline edit form instead of sharing one. It installs on the
same host/path boundary as the writer and reuses its connect/disconnect,
per-item CRUD, timezone, and Nylas scheduler-configuration logic without any
step/modal machinery. Real result popups (create/edit/remove/connect/
disconnect) are intentionally deferred for now — every action logs its
outcome to the console instead.

It does not depend on `scheduling-availability-init.js`: that module's job
(show/hide the legacy `[init-availability]`/`[update-availability]` hero
controls, pick the old modal's initial step) has no equivalent in the new
component, so this module reads the canonical starter record itself.

Designer markup contract (`data-availability-element="<name>"` unless noted):
`section` (root), `connect-wrapper`, `connect-info-wrapper`, `connect-btn-wrapper`
(3 buttons, fixed order: platform / Google / disconnect Google),
`main-wrapper` (hidden until any connection exists), `list`, `loading-settings`,
`item-template` (`data-id=""`, cloned per item), `item-title`, `item-timezone`,
`availability-form-wrapper` (closed by default), `availability-form`
(`data-availability-id=""`), `slots-wrapper`, `loading-slots`. Day selection
renders as 7 Labelv2 badges per item; selected/unselected is a Designer
component-variant class swap (`w-variant-89402c65-…` default,
`w-variant-ebea452c-…` selected), not a data attribute.

Action buttons (connect-platform/connect-google/disconnect-google, item
edit/remove, form cancel/submit) are Webflow Component Instances, which the
Designer API cannot attach custom attributes to directly — until thin wrapper
`<div data-availability-action="…">`s are added around them, the script falls
back to the button's ordinal position inside its known wrapper and logs one
console warning per action. Prefer adding the wrapper attributes over relying
on the fallback long-term.

OAuth-callback ownership: on any page carrying this section's root, this
module is the sole consumer of the Nylas `?code&state` / `?success&grant_id`
return. `scheduling-availability-writer.js` carries a matching guard — it
bails out before capturing the callback whenever
`[data-availability-element="section"]` is present — so the two scripts never
race to redeem the same one-time code. The writer stays fully active on
`--availability-stage`, which never carries that markup.

The "Live bookable slots preview" card fetches the starter's own next
upcoming Nylas scheduler slots (`scheduler/get_availability/v3`, GET) and
renders a short list, replacing its loader. The single-slot version of this
query used by the Bookings pages
(`getNextAvailableTimeSlot`/`getNearestSlot` in the **separate**, non-repo
`book-func-lib-2.html` Webflow embed) was refactored alongside this to expose
the full sorted slot list via a new `getUpcomingTimeSlots`, so both stay in
sync; that embed is deployed outside this repository.

Known open items, tracked for a Designer/QA follow-up rather than blocking
this module: the "Main schedule" tag's shown/hidden polarity for override vs.
general items is a best-effort port of the old modal's logic, unverified
against a real multi-item starter record; and the per-item time inputs'
`data-input-timepicker` value format is assumed to be `HH:MM` but has no
controller in this repo to confirm it.

Runtime contract:

- `data-scheduling-availability-section` on the document root reports
  `loading`, `ready`, `not-applicable` (no `[data-availability-element="section"]`),
  `missing-auth`, or `error`.
- Shares `data-scheduling-calendar-state`, `window.STARTER_SCHEDULING_CONNECTION`,
  and the `starterSchedulingConnectionStateChanged` event with the writer, so
  other dashboard widgets (e.g. `dashboard-action-items.js`) work regardless
  of which script is active on the page.
- `window.StarterSchedulingAvailabilitySection` exposes `initialize()`,
  `daysAlias`, `getAvailArray`, `applyDayBadges`, `getUpcomingTimeSlots`, and
  `publishCalendarConnectionState`.

Run its focused test with:

```sh
node --test v3/scheduling-availability-section.test.js
```

## Calendar OAuth return (no separate page)

There is no `/connect-success` page in V3. `grants/oauth/v3` returns the current
tab to the same approved Starter scheduling page. The writer accepts both
the authorization-code return (`?code&state`) and Nylas hosted-auth success
return (`?success=true&grant_id&email&provider&state`). It captures and strips
all OAuth parameters before fallible bootstrap work. The callback fields needed
for validation (`code` or `grant_id`, `state`, and `success`) stay in the current
tab's `sessionStorage` for at most 15 minutes so a reload after Memberstack
login, or a transient grant-save failure, can resume the same handoff. The
writer clears the saved callback and member-scoped intent only after
`grants/add/v3` succeeds,
or clears the callback immediately when validation fails; expired or malformed
state is also discarded. Provider access tokens are never stored in the
browser, and the returned `email` and `provider` are neither retained nor
trusted.

Nylas-standard OAuth failures (`error`, `error_description`, `error_uri`, or
`error_code`) are captured without retaining their provider text, stripped from
the visible URL, and routed to `config-request-error`. They never reach
`grants/add/v3`; the member can reopen the same native modal and try again.

Before persisting anything, the writer verifies `state` (set server-side from
the caller's Bearer token) against the logged-in member and, on production,
requires a recent, member-scoped same-session intent with the exact redirect
URI. For hosted auth, `success` must be exactly `true`, and only the returned
`grant_id` is forwarded as callback identity. `grants/add/v3` performs the
authoritative server-side code exchange or grant verification and persists the
result in one authenticated call. The writer then continues the existing
configuration flow in the same tab. After the verified grant and scheduler
configurations are created, the modal returns to its default dashboard state;
the legacy `reload-page` step is not part of the current handoff.
Booking confirmation/reschedule/cancel links baked into scheduler configurations
also point at this page, where the bookings embed owns `booking_ref` handling.

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

Endpoints 1456/1457 accept the same `in_redirect_uri` for authorization and
code exchange, and reject values outside the exact allowlist:
`https://the-starters-3-0.webflow.io/starter-dashboard---availability-stage`,
`https://thestarters.com/starter-dashboard`, and
`https://www.thestarters.com/starter-dashboard`. The browser derives these
values only from the approved host and path; both endpoints must use the same
value or the OAuth provider rejects the exchange.

## V3 reviews frontend

`reviews.js` is the browser adapter for approved reviews on public
`/hire/{slug}` profiles. The public profile loads the GitHub-owned adapter once
from its existing Webflow page code. Do not add a second loader through
`opportunities-3.0.js` or another global controller:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/reviews.js"></script>
```

Do not enable any points, ranking, rank-projector, or `rank_status` write as
part of this integration.

Webflow Designer owns the Brand review form and the public Reviews section. The
adapter does not generate either surface, and `reviews.js` does not bind or
submit the Brand form. `opportunities-3.0.js` owns that form's per-card context,
validation, submit locking, and retry behavior; its authoritative dashboard
contract is documented in the root
[README](../README.md#opportunities-30-project-dashboard-actions).

Xano remains authoritative for completed-project eligibility, one-review
enforcement, idempotent replay, moderation, points, reversals, aggregates, and
ranking. The current product rule is one review per canonical
project/Brand/Starter tuple. New project reviews are immediately approved and
published, while the canonical moderation state remains explicit so a future
approval workflow can be introduced without changing the browser contract. A
successful submission refreshes the canonical dashboard projection without a
second review write.

On the public profile, author exactly one section with
`data-reviews-v3="profile"` and exactly one descendant list target with
`data-reviews-v3-list="reviews"`. The adapter derives the decoded slug only
from the canonical `/hire/{slug}` path, configures that section as the
`starter-reviews` wf-xano wrapper, and sets `wf-xano-param-starter_slug` before
initializing it. It does not discover the surface through classes, heading
text, or generated IDs. A missing section or list target fails closed before
wf-xano initialization and makes no review request.

When the wrapper has no authored `wf-xano-element="template"`, the adapter adds
a hidden, aria-hidden placeholder so wf-xano can initialize. If site-level
wf-xano has already booted and skipped that formerly incomplete wrapper, the
adapter calls the runtime's idempotent `init()` for only this configured root.
Review cards are rendered only into the attributed list target. Inside the
authored section, use
`data-reviews-v3-average` and `data-reviews-v3-count` for the aggregate values
for the optional aggregate projections. For the profile summary outside the
Reviews section, use `data-reviews-v3-summary-average` and
`data-reviews-v3-summary-count`. The adapter paints both surfaces from the same
Xano result, including zero values. The existing `#rating` plus adjacent count
span remains a temporary compatibility target for the current Hire template;
new markup must use the explicit data attributes. The Xano response is the
authority and must expose only approved reviews. Its canonical envelope is:

```json
{
  "reviews": [],
  "aggregate": {
    "review_count": 0,
    "average_rating": 0
  }
}
```

Webflow continues to own the visible Reviews section, heading, navigation, and
plain list Div. The legacy Reviews CMS Collection List is not a data source and
must not be retained as a second review projection; Xano is the only review
store and public read authority.

The adapter also accepts `items` for the review array, `aggregates` for the
aggregate object, and the wf-xano raw-item fallback. Aggregate values are never
recalculated from a paginated review list. The authored Reviews section is
shown only when the approved review array is non-empty; zero aggregate values
are still painted when it is empty. Approved reviews render as stacked,
bordered cards with five Bootstrap star icons, a `Verified Review` badge, the
review text, and reviewer identity from `brand.full_name` with
`brand.company_name` as its fallback. Cards are constructed with DOM nodes and
`textContent` only, so reviewer identity and review text are never interpreted
as HTML. The adapter contains no Airtable or Make integration and no private
token or direct authenticated fetch path.

Run the focused checks with:

```sh
node --check v3/reviews.js
node --check v3/reviews.test.js
node --test v3/reviews.test.js
python3 -m http.server 8765 --bind 127.0.0.1
# Open /v3/reviews-harness.html and click Reviews.
```

The harness runs the real adapter against an isolated approved-review fixture;
it changes the browser history to `/hire/review-harness` so the adapter uses its
canonical route gate, and never reads or writes production business data.

## Brand and Starter Dashboard messages tile

`starter-dashboard-messages.js` binds the shared Messages tile on
`/brand-dashboard` and `/starter-dashboard` to the member's recent TalkJS
conversations, merging two sources: Xano
`starter/messages/recent` (a TalkJS REST proxy, which is what lets already-read
conversations appear) and the TalkJS JS SDK `session.unreads` (live unread
preview, timestamp, unread state, and the unread-count badge). Card rendering
waits for the shared bulk recent-conversations load, with no per-card API
requests, so SDK timing cannot bypass the participant-identity boundary. A
failed attempt is retried once; each attempt has a 15-second timeout and aborts
if it stalls. When both attempts fail, the tile shows no message cards rather
than rendering identity-incomplete SDK-only entries.

For one-on-one conversations, the bulk recent-conversations response supplies
`participant_name` and `participant_photo_url`. When those properties are
present they are authoritative, including explicit empty values; conversation
metadata and the SDK sender snapshot are only fallbacks for legacy responses
that omit them. Live unread data overlays preview, timestamp, and unread state
without replacing that participant identity. Cards are ordered by last activity
and capped at the three newest conversations. Each rendered card opens
`/messages?conversation=<TalkJS conversation id>` in a new tab;
`messages.js` selects that existing conversation after mounting the inbox
without creating or mutating a conversation. The existing
`/messages?with=<memberstack id>` create-or-open flow remains unchanged.

Wiring is wf-xano-style and multi-instance: each
`data-messages-element="wrapper"` scopes one rendered instance containing
`list`, `template` (the first card), `empty`, `loading`, `total` (unread
count), and `view-all`, with card fields `name` (alias `title`),
`name_initials`, `preview`, `time`, and an optional `avatar` container inside
the template. `data-messages-format="uppercase|lowercase"` transforms a bound
element's text, an optional `data-messages-limit="<n>"` on the wrapper can lower
the default and maximum of 3 rendered cards, and `data-messages-class-unread`
— on the wrapper or on the template card — renames the class toggled on an
unread card (default `is-new`). All instances share one TalkJS session and the
same bulk recent-conversations load, including its single retry; the original
class-based selectors (legacy wrapper `#messages`) remain as fallbacks.

Run its focused test with:

```sh
node --test v3/starter-dashboard-messages.test.js
```

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
| `overall-rank` | Compact overall position, for example `284th/703` |
| `overall-cohort-size` | Overall authored-row hook; its number is folded into `overall-rank` and the complete row becomes `Starters Overall` |
| `overall-tie` | Legacy Designer-authored tie label; kept hidden in the compact presentation |
| `role-card` | Primary-role rank card wrapper |
| `role-rank` | Compact primary-role position, for example `6th/21` |
| `role-label` | Primary-role name; rendered on the authored subline |
| `role-cohort-size` | Primary-role authored-row hook; its number is folded into `role-rank` and the complete row becomes the role name |
| `role-tie` | Legacy Designer-authored tie label; kept hidden in the compact presentation |
| `rank-message` | Legacy Designer-authored rank label; kept hidden in the compact presentation |

The script never calculates points or rank in the browser. It trades the active
Memberstack session for a Xano token and renders only the authenticated summary.
When Xano reports `refreshing`, or a nominally ready payload lacks a rank/cohort,
the position is withheld and both the overall-rank and primary-role cards are
hidden. The `ineligible` and `quarantined` statuses likewise hide both cards and
reveal their matching Designer-authored state blocks. Missing primary roles keep
the overall-rank card and reveal the authored setup state inside the role card.
No state renders raw `N/A`.

All state containers, links, and styling live in Webflow. The controller does
not create markup or inject state sentences. For ready ranks it combines the
canonical rank and cohort into an ordinal position (`6th/21`), uses the existing
cohort hook in each authored small-text row for the role name and `Starters
Overall`, suppresses that row's former surrounding copy such as `Out of` and
`eligible Starters` without replacing its markup, and keeps the legacy tie
labels hidden. Xano tie counts remain part of the read model and rank semantics;
only the compact presentation omits the word “Tied”. The root preserves those
semantics as `data-overall-tied="true|false"` and
`data-role-tied="true|false"` for diagnostics without restoring visible tie
copy.

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

## Starter Dashboard Stripe Connect

`starter-dashboard-stripe-connect.js` replaces the V2 nightly
Airtable/Webflow-CMS display chain with authenticated, provider-aware reads
through the Stripe-authoritative V3 Xano mirror. The same module handles the
`/stripe-connect-callback` OAuth return. Every Xano call is Bearer-authenticated:
the module trades the active Memberstack session for a Xano token through
`api:g1vmSLWh/auth/trade-token/v3` and the `status/v3`, `start/v3`,
`dashboard/v3`, `disconnect/v3`, and `oauth_exchange/v3` endpoints derive the
member identity from that token
(`auth = user_v3`). It never sends a client-supplied `member_id`, so a forged
request cannot read or link another member's Stripe account.

Load it on `/starter-dashboard` and `/stripe-connect-callback`:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/starter-dashboard-stripe-connect.js"></script>
```

Wire a root on each page with `data-stripe-connect-element="root"`. Within the
root, use these values:

| Value | Purpose |
| --- | --- |
| `loading` | Immediate loading state while Memberstack and Xano resolve |
| `disconnected` | No connected Stripe account; contains the authored connect CTA |
| `incomplete` | Connected account whose charges are not enabled; contains the authored “Complete setup” CTA |
| `ready` | Stripe reports `charges_enabled: true` |
| `review` | The user just returned from Stripe, but the authoritative enabled flag has not settled after short polling |
| `error` | Designer-owned safe failure state; on the callback page this remains visible instead of losing a failed one-time code |

Give every Connect or Complete setup control
`data-stripe-connect-action="start"`. An optional retry control can use
`data-stripe-connect-action="refresh"`. Keep an
`.action-item_button-wrapper` in the `ready` state. If its first child is an
authored Webflow button component, the controller reuses that component as the
accessible `Open Stripe` control, so the ready state cannot retain a conflicting
`Connect Stripe` CTA. Otherwise, keep an existing Webflow button component as
the first child of the disconnected state's `.action-item_button-wrapper`; the
controller clones it into the ready wrapper. The controller clones the resolved
Open Stripe component for `Disconnect Stripe`, assigns
`data-stripe-connect-action="dashboard"` and
`data-stripe-connect-action="disconnect"`, respectively, and does not add a
second copy if either action already exists. Open Stripe requests the exact
provider-verified connected account destination. Disconnect Stripe asks for an
explicit browser confirmation before it sends the authenticated disconnect.
The controller also clones that action into the `incomplete` and `review`
wrappers, so a member can disconnect and restart even before charges are
enabled.
The hero can keep its two authored Stripe tiles, both with
`data-stripe-connect-action="earnings"`, but the controller uses only one blue
tile for the full lifecycle. Mark the original Connect Stripe tile with
`data-stripe-connect-earnings-state="disconnected"` and the Payment history and
payouts tile with `data-stripe-connect-earnings-state="ready"`. The ready tile
is the primary tile when both exist, and the other authored tile stays hidden.
The primary tile never disappears after the controller starts. Its copy and
action change with canonical status: `Checking Stripe` while loading, `Get Paid
/ Connect Stripe` while disconnected, `Complete Setup / Finish Stripe
onboarding` while incomplete, a disabled `Under Review / Stripe is reviewing
your account` state while under review, `Earnings / Payment history & payouts`
while ready, and a disabled `Stripe Unavailable / Use Try Again above` state on
an error. The disconnected and incomplete states start the same guarded
OAuth/onboarding flow as the action-list CTA. A status with
`charges_enabled:true` requests a provider-verified account destination from
`dashboard/v3`:
Express accounts receive a single-use login link, while Standard/full accounts
receive an account-scoped `/b/<account>` Dashboard URL. The generic Stripe
Dashboard URL is never used. Loading and error states keep the primary tile
visible but disabled, so stale actions cannot run and the hero never has a blank
Stripe position. For the original live markup, where both tiles predate the
explicit state attribute, the controller preserves the authored two-tile order
and chooses the second Payment history tile as primary. This keeps the V3 link
independent of the legacy Make redirect while preserving Stripe as the earnings
UI for the connected Standard account. Both actions work on either a native
anchor or an authored non-anchor tile (e.g. a `div`); an enabled non-anchor tile is exposed as
`role="button"` with `tabindex="0"` and activates from both click and Enter/Space
so keyboard users can reach its action. Connect Stripe, Complete setup, Open
Stripe, and Payment history and payouts all open in a new tab. The controller
prevents native earnings navigation because Webflow handlers can otherwise
replace the dashboard tab. Both anchors and non-anchor actions reserve
and navigate a detached-opener tab directly from the activating click or key
event; a blocked popup or a tab whose opener cannot be detached stays
fail-closed and never navigates the dashboard.

While a Connect or Complete setup request is in flight, the Connect Stripe tile
and initiating control stay visible but receive `is-disabled`, `aria-disabled="true"`,
`aria-busy="true"`, `tabindex="-1"`, and blocked pointer events. This provides
pending feedback and prevents repeat mouse or keyboard activation. If the start
request fails, the controller clears the pending state from the initiating
controls, shows the authored error card, and keeps the primary hero tile visible
in its disabled `Stripe Unavailable` state. The controller reserves a blank tab
synchronously before the asynchronous Xano request so browser popup protection
does not discard a legitimate human activation. It closes that tab on any
request, session, or URL-validation failure. A successful request navigates the
reserved tab to the validated Stripe URL, keeps the dashboard open, and leaves
the shared action guard latched while a supported return watcher prevents
duplicate onboarding tabs. When the dashboard regains focus, the Stripe tab
closes, or the member-matched callback signals completion, the original
dashboard re-reads canonical status, restores the pending controls, and releases
the guard for recovery. A verified callback that has not settled to
`charges_enabled:true` renders `review`; focus or tab closure without callback
confirmation returns to the canonical disconnected or incomplete state. If the
browser exposes none of the return-watcher APIs, the controller releases the
pending state and guard after the successful tab navigation.

A single in-flight guard is shared across every start, refresh, Earnings, Open
Stripe, and disconnect control in the dashboard, so a second click on any
control is ignored while an authenticated action is resolving. Start
posts the dashboard `return_url` plus an explicit `callback_url` —
`/stripe-connect-callback` on the same origin — so `start/v3` returns an OAuth
URL built against the exact V3 callback instead of falling back to its legacy
V2 default. Production start also sends one bounded idempotency key. A retry
after a network-ambiguous, timeout, conflict, rate-limit, or server outcome
reuses that key; a confirmed redirect or later intentional attempt uses a new
key. The controller accepts only an HTTPS `connect.stripe.com` URL before
navigating the reserved tab. Exact backend replays with `mode="connected"` or
`mode="reconciliation_required"` do not require a second redirect URL. They
close the reserved tab and refresh canonical status instead of displaying a
false invalid-URL error.

Dashboard access and disconnect each send their own bounded idempotency key.
A retry after a network-ambiguous, timeout, conflict, rate-limit, or server
outcome reuses the action's key. A definitive provider result or non-retryable
response clears it, so a later intentional action starts a new attempt.

The dashboard calls provider-aware `status/v3` immediately. It repairs a
readiness mismatch and clears a stale projection only when Stripe returns a
definitive disconnect; ambiguous provider errors show the authored unavailable
state without changing Xano. `connected:false` selects
`disconnected`; `connected:true` with `charges_enabled:false` selects
`incomplete`; and `charges_enabled:true` selects `ready`. After either the
OAuth callback or Stripe-hosted onboarding returns, the controller polls the
status briefly to absorb webhook timing. If the provider account remains
connected but the readiness flag is still false, it selects the authored
`review` state instead of painting a false success. A provider-disconnected
account always returns to `disconnected`, even when a stale return marker is
present.

The production callback reads `code` and the backend-issued opaque `state`,
removes OAuth parameters from the visible URL before network work, resolves the
current Memberstack member, validates the bounded state shape, and posts
`{code, state}` to `oauth_exchange/v3`. Xano binds the state to the authenticated
member and request receipt; the browser does not compare the opaque value to a
Memberstack ID. The callback handles `completed`, `reconciliation_required`,
and `restart_required` without automatically replaying the one-time code. When
`BroadcastChannel` is available, only `completed` signals the original dashboard
through a member-matched channel. The callback tab then redirects to the
matching `/starter-dashboard?stripe_connect=<mode>` URL, where the dashboard
re-reads canonical status. Callback errors stay on the authored error state for
safe recovery.

Each root reflects the selected state in `data-stripe-connect-status` and
`data-stripe-connect-view`. The module also emits
`starterStripeConnectReady`, `starterStripeConnectRedirect`,
`starterStripeConnectDashboard`, `starterStripeConnectDisconnected`, and
`starterStripeConnectError` events. `starterStripeConnectRedirect` is
diagnostics only, but `starterStripeConnectReady` and
`starterStripeConnectError` are load-bearing: the
[Action Items panel](#dashboard-action-items-panel) settles its loading card on
either of them, so keep dispatching both on every terminal outcome.

### Isolated sandbox flow

An opt-in sandbox path lets the staging V3 Test Talent member complete a
Connect OAuth round-trip without creating a live-mode connection or writing a
test account ID into `freelancers_v3`. It activates only when both conditions
hold: the page is served from the Webflow staging host
`the-starters-3-0.webflow.io`, and the request carries `stripe_connect_sandbox=1`
in the query string. Every other host or a missing flag keeps the production
flow unchanged. Like the OAuth parameters, `stripe_connect_sandbox` is stripped
from the visible URL before network work.

In sandbox mode `start` posts the same `return_url` and `callback_url` to
`/stripe_connect/sandbox/start/v3`, and the exchange posts to
`/stripe_connect/sandbox/oauth_exchange/v3`. Both sandbox endpoints stay
Bearer-authenticated the same way as the production ones; the Xano exchange
uses the test secret key and performs no database write. Sandbox mode disables
connected-account Dashboard access and disconnect before any popup,
confirmation, or endpoint request, so those production actions cannot cross the
TEST/LIVE boundary.

The sandbox callback is staging-only and self-identifying: its OAuth `state` is
the member id prefixed with `sandbox:`. The callback rejects a `sandbox:` state
unless it is running on the staging host, requires the state to equal
`sandbox:<member_id>`, and requires the exchange to return `sandbox: true` so a
sandbox request can never resolve through the production, persisted path. A
successful sandbox exchange redirects to
`/starter-dashboard?stripe_connect=connected&stripe_connect_sandbox=verified`,
after which the dashboard re-reads canonical status exactly as in production.

Run its focused tests with:

```sh
node --test v3/starter-dashboard-stripe-connect.test.js
```

## Brand paid-call payment method client

`paid-call-brand-payment.js` supplies the authenticated Xano calls needed by a
native Brand booking UI. It does not create form markup or initialize Stripe
Elements. Load it after `scheduling-auth.js` only on the approved host and path
surfaces in the [scheduling auth](#scheduling-auth) boundary. A production Hire
surface must be added to that boundary before this client can authenticate
there:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/scheduling-auth.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/paid-call-brand-payment.js"></script>
```

The scheduling auth bridge allowlists only these two new paid-call paths:

- `POST /brand/payment-method/setup/v3`
- `POST /brand/payment-method/set-default/v3`

Xano derives the Brand identity and payment environment from the Bearer token.
The browser sends neither field. A booking controller should use this sequence:

1. Call `StartersPaidCallBrandPayment.createSetupAttempt()` once for the current
   card-setup attempt.
2. Retry that attempt through its `.run()` method with the same idempotency key
   until Xano returns the Stripe SetupIntent client secret or a terminal error.
3. Give that client secret to Stripe.js and let Stripe Elements collect and
   confirm the card. Never send raw card data through Webflow or Xano.
4. After Stripe.js returns a `pm_...` PaymentMethod ID, call
   `createDefaultSelectionAttempt(paymentMethodId)` once for that intentional
   selection.
5. Retry the returned selection attempt through `.run()` with its captured key.
   Create a new attempt for every later intentional selection, including an
   A-to-B-to-A sequence.

The client validates bounded keys and PaymentMethod IDs before network work.
It uses `xanoAuthFetch` when the shared bridge is present and otherwise uses the
shared Xano token helper. The backend remains authoritative for customer,
environment, default-card, and readiness state.

Run the focused contract tests with:

```sh
node --test v3/scheduling-auth.test.js v3/paid-call-brand-payment.test.js
```

## Dashboard Action Items panel

`dashboard-action-items.js` owns the chrome of the Action Items panel on the
Starter and Brand dashboards. The panel itself is shared infrastructure: the
feature scripts that contribute rows (Stripe Connect, calls, projects, and
future sections) still own their own rows and show or hide them themselves.
This controller never shows, hides, or edits a feature row. It only renders the
loading card, the "all caught up" empty card, and the live count.

Load it on `/starter-dashboard` and `/brand-dashboard`:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/dashboard-action-items.js"></script>
```

The Designer grammar is the `data-action-element` vocabulary already authored on
the Brand dashboard:

| Value | Purpose |
| --- | --- |
| `wrapper` | Panel scope root. Optional; with no wrapper anywhere on the page the controller falls back to a single document-wide panel whenever any `loading`, `empty`, or `total` chrome is authored, which is what the Starter dashboard still uses. A page with neither a wrapper nor chrome stays untouched |
| `list` | List container; informational only |
| `loading` | Loading card, visible until the panel first settles |
| `empty` | "All caught up" card, visible once settled with zero items |
| `total` | Text node that receives the live count, replacing the static authored `4` |
| `item` | An actionable row |

A row counts as pending when its bounding rect has height, so `display:none`
rows, rows inside a hidden group, and a known zero-height stray row are all
excluded. Only leaf matches count: a group element that also carries the row
marker but contains matching descendants is skipped, so a section never
double-counts.

Rows are matched by `[data-action-element="item"]` **or** the authored
`.dash-hero_action-item` class. The class fallback is a deliberate, accepted
exception to the sitewide attributes-only rule in the top-level
[`README.md`](../README.md#sync-safety): both dashboards ship class-marked rows
today, including component-driven ones that cannot take the attribute yet. It
is also recorded in the module header. Remove the fallback once every row
carries `data-action-element="item"`.

The panel settles — and only then may the empty card appear — at the first of:
an item becoming visible, a Stripe readiness/error event, a terminal Calendar
connection state or availability error event, or a 4-second timeout. A Calendar
`loading` event alone does not settle the panel. Until it settles the loading
card stays up, so a slow feature controller never flashes a false "all caught
up".

Every render also writes the count to `data-action-items-count` on the scope
(on `<body>`, or `<html>` if there is no body, when the scope is the document)
and dispatches an `actionItemsChanged` `CustomEvent` with `{ detail: { count } }`
on `window` — but only when the count actually changes. A `MutationObserver`
watching `childList` plus the `style`, `class`, and `hidden` attributes keeps
all of it live; renders are coalesced to one per animation frame (falling back
to a `setTimeout`) because Webflow IX2 writes inline styles every frame.

Run its focused tests with:

```sh
node --test v3/dashboard-action-items.test.js
```
