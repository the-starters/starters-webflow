# `v3/hire-profile.js` — wiring and ownership

Last updated: 2026-08-24
Status: Call projections and Free Call behavior are GitHub-owned; direct Webflow head cleanup remains pending

## What this is

The `/hire/<slug>` profile renderer. It previously lived as ~37KB of inline
custom code in the **footer** of the Webflow hire template (page
`69f241ed147b71addb6f153d`, "Hire | Freelancers 3.0s – Pages Template"). It now
lives here, and the page footer loads it from jsDelivr instead.

This is the same move already made for `v3/profile-portfolio.js`: GitHub is the
source of truth for browser code, and page/site custom code stays thin.

The initial port was **behaviour-for-behaviour**. The exact pre-migration block
is kept at
`webflow-sites/starters-3/custom-code-backups/hire-template-footer-pre-cdn-migration-2026-08-16.html`
in the ops workspace.

Phase 2 removed Experiences and Clients from this runtime. Webflow now renders
Notable Experience from the **Work Histories** collection list filtered to the
current freelancer, and Clients from the freelancer's **also-worked-with**
multi-reference. The 2026-08-16 Xano-to-CMS projection finished with zero drift
for 515 of 517 profiles. The 74 collision-blocked profiles continue to use their
stale-but-present CMS rows, so both sections still render natively.

## Install

Webflow → hire template → Page Settings → Custom Code → **Head**:

```html
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/scheduling-auth.js"></script>
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/scheduling-v3-stage.js"></script>
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/free-call-booking.js"></script>
```

Use [`scheduling-v3-hire-template-head.html`](scheduling-v3-hire-template-head.html)
as the owned embed source. All three tags are intentionally synchronous. The
adapter must own scheduling requests, and the Free controller must define its
namespace, before the shared **Call Scheduling - Global Code** component can
execute its legacy helpers.

`hire-profile.js` also verifies this dependency at runtime. If an older saved
page head does not contain `free-call-booking.js`, it adds that exact jsDelivr
asset once and waits up to five seconds for that loader before booking
discovery. A load error or timeout leaves every Book Call trigger and both call
options hidden. An existing controller or matching loader that can still settle
— an `async` or `defer` tag, or a loader this recovery already injected — is
reused, so this recovery does not create a second chooser owner. Each watched
loader gets its own five-second wait, so the reuse path can wait once for the
existing tag and once more for the canonical loader before giving up. A stale
blocking tag cannot settle again, because this file is deferred and that tag has
already executed; it is therefore superseded by the canonical loader instead of
waited on. Every give-up path re-reads `window.StartersFreeCallBooking` first,
so a controller that installs without notifying this file still counts. Keep the
direct synchronous head tag as the final Webflow install; the runtime loader
prevents the current missing-tag state from disabling Free and Paid discovery
while the shared component cleanup is still pending.

Webflow → hire template → Page Settings → Custom Code → **Footer**:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/hire-profile.js"></script>
```

Nothing else belongs in that footer. The page **head** keeps the three synchronous
scheduling loads above before the shared component. Its other page scripts can
remain deferred (`paid-call-brand-payment.js`,
`freelancer-cms/stripe-connect.js`, `reviews.js`, `project-form.js`,
`starters-ms-redirect.js`, `profile-portfolio.js`).

## Page ownership

| Area | Audience | Owner / source |
| --- | --- | --- |
| Notable Experience | everyone, incl. logged out | native Webflow CMS / Work Histories |
| Clients ("also worked with") | everyone, incl. logged out | native Webflow CMS / also-worked-with multi-reference |
| Call projections (hero, sticky header, Services, and chooser) | owner: live connection state · anonymous: closed · brand: accepted canonical configuration plus successful controller install | this file / authenticated Xano, Nylas, and Stripe |
| Freelance / Retainer rate cards | everyone | this file / Algolia record, cloned from the section's Default card |
| Free booking popup | signed-in Brand members | this file + `free-call-booking.js` / authenticated Xano + Nylas |
| Paid booking popup | signed-in Brand members | this file + `paid-call-brand-payment.js` / authenticated Xano + Stripe Elements + Nylas calendar |
| Utilities | everyone | this file / rate formatting, rating average, dropdowns, anchor scroll, mobile TOC, view-all, see-more |

The runtime no longer calls `api:SYL06lUR/companies`,
`edit_profile/starter/get_also_worked_with`, or `profile/get_companies`.
`FREELANCER_ID` remains the Memberstack ID used by booking. The public Algolia
lookup instead reads the starter's positive integer Xano ID at parse time from
`[data-starter-xano-id]` inside the hidden `.data-native-binding` wrapper. If
the carrier is absent or invalid, the lookup warns and stands down.

## Dependencies this file does NOT own

All of these are defined by **other** page or site embeds that run before it.
The file reads the page-owned identity and shared helper globals from `window`.
It stands down with a `[hire-profile]` warning when `qs`, `qsa`,
`waitForMember`, or `starter_memberstack_id` is missing, because an uncaught
`ReferenceError` would abort the whole file and take every section with it.
The Free booking namespace normally comes from the page install order above.
`hire-profile.js` supplies the bounded GitHub/jsDelivr recovery when that tag is
missing and stands down if the namespace still cannot load.

- Site head: `qs`, `qsa`, `MEMBER`, `memberReady`, `waitForMember`
- Page embeds: `starter_memberstack_id`, `stripe_charges`, and the CMS-bound
  `[data-starter-xano-id]` carrier inside `.data-native-binding`
- GitHub module: `window.StartersFreeCallBooking`. It owns
  `getStarterByMemberId`, `getConfigs`, `getNearestSlot`, the Free chooser,
  and the Nylas Free scheduler. `hire-profile.js` does not use the old bare
  booking globals.
- jQuery `$` — used by the dropdown and anchor-scroll blocks only; each is
  individually guarded, so a missing jQuery costs those two behaviours and
  nothing else. The anchor utilities also ignore a bare `#` or an invalid hash
  selector so a placeholder link cannot abort the remaining page utilities
- `window.WfAlgolia` — the search client, awaited with a 30s deadline
- `window.__startersEmptyNavRefresh` — optional, debounced refresh hook from
  `utils/section-custom-toc/hide-empty-sections.js`. After canonical discovery
  changes a call projection or the rate-card path renders, this file asks the
  empty-section owner to re-evaluate the Services section and its TOC link. The
  call is guarded: a missing or failing cosmetic hook must not stop card
  rendering.

### Dependency contract

Checked on `www.thestarters.com/hire/ashna-rana` at `document.readyState:
"complete"` — i.e. exactly the moment a deferred script runs — on 2026-08-16:

| Global | At defer time |
| --- | --- |
| `qs`, `qsa`, `waitForMember`, `$` | `function` |
| `StartersFreeCallBooking` | existing frozen object, or loaded once by the bounded runtime recovery |
| `MEMBER`, `memberReady`, `WfAlgolia` | `object` |
| `starter_memberstack_id` | `string` |
| `stripe_charges` | property present, value `undefined` |
| `[data-starter-xano-id]` inside `.data-native-binding` | positive integer text |
| `[wf-algolia-index]` resolved by the environment script | `Freelancers3.0-production` |

`stripe_charges` is only ever written as `window.stripe_charges` (three
assignments, no `var`/`let`/`const` declaration anywhere on the page). The
property exists, so the footer's original bare `stripe_charges` reference
resolved to `undefined` rather than throwing; reading it as
`window.stripe_charges` here is therefore equivalent today, and stays safe if
that assignment ever fails to run.

## Scoping

Each original `<script>` block keeps **its own IIFE**. They were separate
scripts, so a single shared scope would collide — two of them declare `el`.
No page code outside the footer referenced any of these symbols (verified
against published source, 2026-08-16), so nothing depends on them being global.

## Timing

Deferred, therefore strictly **later** than the inline footer was: it runs after
HTML parse rather than mid-parse. Every global it consumes is set by then,
except `StartersFreeCallBooking` on an older saved head, which the bounded
recovery described under **Install** loads before booking discovery. This
is the only intentional timing change in the port.

The empty-section observer watches child-list mutations, not attribute changes.
Changing a call projection's inline `display` therefore does not trigger that
observer. Canonical Brand discovery refreshes the empty-section owner when it
changes a call projection, and the rate-card render path refreshes it after
adding cards. This keeps `#services` and its TOC link aligned with the final
visible-card state even when no rate card adds a DOM child.

## ⛔ The Algolia index must never be hardcoded

`resolveStartersIndex()` reads `[wf-algolia-index]` from the page.
`v3/algolia-environment.js` rewrites that attribute per environment
(`Freelancers3.0-production` on prod, `Freelancers3.0-staging-test` on
`webflow.io`) before wf-algolia boots, and the rotated search key **403s any
other index**. If the page does not declare an index, the public-record lookup
warns and stands down without making an Algolia request.

A hardcoded `Freelancers3.0-dev` is exactly what silently broke the entire
Services section on 2026-08-16, for every viewer, after the index migration.

## Verification

Use profiles whose current production Xano readback proves one valid Free-only
configuration and one valid Free-plus-Paid configuration. Do not select a
canary from legacy Webflow or Algolia call flags.

1. Anonymous: every hero, sticky-header, Services, and chooser call projection
   stays hidden, even when the public search record carries legacy Free or Paid
   call flags. Native CMS Experiences and Clients remain present, and no
   profile-data Xano request runs.
2. Anonymous click on any visible non-call service card opens the signup modal
   in place.
   That is driven by `v3/signup-attribution.js` off `data-signup-trigger-*`, so
   the cloned rate cards must keep those attributes (values `Freelance` /
   `Retainer`) and must **not** carry `data-modal-trigger`, `booking-popup-open`,
   or `data-type` — otherwise a logged-in click opens an unconfigured booking
   popup for a card that cannot be booked.
3. Eligible signed-in Brand: canonical discovery keeps every call projection
   closed until its exact controller installs. A successful Free install reveals
   every Free projection; a successful Paid install reveals every Paid
   projection. Each revealed call card opens the authored chooser, including on
   a migrated profile whose legacy Book Call button is absent. A failed Paid
   install leaves Paid hidden without closing an installed Free option. Each
   non-call card opens Start a Project with its exact native Services preset.
4. `document.documentElement` carries `data-v3-algolia-status="ready"`.
5. The Algolia object ID matches the positive integer in
   `[data-starter-xano-id]`.

## Call modal and project-service routing

The beside-services calendar markup remains authored for possible future use,
but runtime keeps `[data-availability-element="wrapper"]` hidden. The live flow
uses the existing modal sequence: Book Call opens `popup-booking-main`, and an
eligible Free or Paid option opens `popup-booking`. Free uses the Nylas public
component through `StartersFreeCallBooking`. Paid uses the authenticated calendar and booking flow owned by
[`README.md`](README.md#brand-paid-call-payment-method-client) inside the same
authored modal. Valid `/hire/<slug>` paths use the host-classified TEST or
production route map. Every authored
`[data-modal-trigger="popup-booking-main"]` stays hidden with
`data-booking-trigger-unavailable` and `aria-disabled="true"`, and the Book Call
wrapper stays hidden with `aria-hidden="true"`, until canonical discovery
produces a Free option that the GitHub Free controller can own or a Paid option
that the V3 controller accepts. This includes triggers outside the wrapper, so
no entry point can open an empty chooser while discovery is closed.
The authored `[data-modal-target="popup-booking-main"]` dialog also stays marked
`data-booking-surface-unavailable` until that same discovery succeeds.
Production `/hire/jp-dionisio` remains blocked before grant or configuration
discovery, so the TEST fixture cannot activate on a production host.

Every authored Free and Paid projection starts hidden. Anonymous viewers cannot
reveal one from the public search record. For a signed-in Brand,
`hire-profile.js` reveals all matching `[has-connection="free"]` or
`[has-connection="paid"]` surfaces only after the exact canonical option passes
the client filter and its controller installs successfully. Hidden runtime call
templates remain hidden. A missing configuration or failed controller install
removes legacy visibility from the matching hero, sticky-header, Services, and
chooser projection so stale Webflow or Algolia intent cannot advertise an
unbookable call.

The native Free and Paid service cards are shortcuts to that same authored
chooser. `hire-profile.js` removes their retired direct-scheduler attributes and
opens `popup-booking-main` only after canonical discovery enables the booking
surface. It clicks an enabled authored chooser trigger when one exists. On a
migrated profile without the legacy Book Call button, it opens the existing
native Webflow dialog through `window.lumos.modal`, with the dialog's native
`showModal()` method as a fallback. The card click does not perform booking,
payment, or Stripe-readiness work. The selected chooser option remains the only
path into the Free or Paid scheduler.

Non-call service cards open `generate-contract` for eligible signed-in Brands.
They use the existing project-form smart-fill attributes to select an exact
native `Services` option. Freelance and Retainer rate cards map to the authored
`Freelance work` option. A missing or unmatched option fails closed. Logged-out
cards keep the signup-attribution modal, and Talent or unknown roles do not get
the Brand project trigger.

Free-call access keeps the V2 product rule: any signed-in Brand, including
Brand Free, can select a free call without an upgrade. The controller resolves
the role from the active, stable Memberstack plan IDs defined in
[`ACCESS-MATRIX.md`](ACCESS-MATRIX.md), using the same map as `route-guard.js`.
An explicit empty, inactive, unknown-only, or cross-role plan state fails
closed. The legacy `brands-dashboard-url` field is only a compatibility
fallback when the SDK payload omits `planConnections`; it cannot override
supplied plan state. Regression coverage in
[`hire-profile.test.js`](hire-profile.test.js) includes Test Brand and Brand
Free plan-only members, plus empty, inactive, and cross-role plan states.
Paid-call selection remains gated by the existing canonical configuration and
Stripe-readiness checks. This routing change does not trigger Stripe, reminders,
transactional email, or a booking submission by itself.

`nylas_configurations/get_bookable/v3` owns the authoritative bookable-set
filter. `hire-profile.js` applies a second, fail-closed check before it gives
that set to the two GitHub modal controllers. Each record must have a `config_id`, `active ===
true`, and the host's exact `data_environment` (`test` on the Webflow test host,
`production` on the production hosts). Free records must have `is_paid ===
false`. Paid records must have `is_paid === true` and the matching
`payment_environment` (`test` or `live`), USD currency, and an integer
`price_cents` of at least 100, plus a positive integer `duration`. Unknown hosts
return no bookable set. The client excludes records from another data or payment
environment and rejects invalid Paid prices or durations. It rejects the
complete remaining set if a `config_id` repeats or if more than one active Free
or Paid record remains. A valid pair is ordered Free then Paid so the
nearest-slot preview is deterministic. An empty or rejected set does not reveal
the Book Call trigger, initialize booking components, or request a nearest slot.

Before it checks page helpers or member identity, `hire-profile.js` hides every
Designer-authored `[call-type-item]` and removes `data-config` from its booking
CTA. It also marks unavailable options with `data-booking-unavailable` and
`aria-hidden="true"`; an injected `!important` guard keeps those options hidden
even if a delayed shared-initializer callback changes their inline display.
After discovery accepts the canonical set, the controller offers each accepted
Free or Paid configuration only to its matching controller.
`free-call-booking.js` receives only the accepted Free configuration and keeps
the existing Free modal flow. It replaces handlers instead of adding duplicate
listeners. Its install does not require a legacy main Book Call button. Each
Book Call click makes one availability request, and each Free option click
mounts one scheduler in the existing `[nylas-container]`.
`paid-call-brand-payment.js` receives the exact accepted Paid configuration and
owns that authored CTA, Stripe Card Element, and paid booking command. Only
successfully installed configurations are reconciled into the chooser and the
matching page projections. A call type without one exact accepted and installed
configuration keeps no `data-config` and retains the structural hide. This
keeps Paid closed during startup, when its controller is missing, and whenever
Paid has no accepted configuration. A failed Paid install does not remove an
installed Free chooser row or add a duplicate call row. A Paid-only set also
keeps the Book Call trigger closed when the Paid controller cannot install.

On the Free Call details screen, the controller hides the booking-form rows for
`brand_memberstack_id` and `starter_memberstack_id` after Nylas confirms the
timeslot. It does not remove or change either field, so both stable IDs remain
in the Nylas booking payload for Xano environment routing and ownership checks.
Name, Email, Add guest, and Call Context remain visible. This presentation-only
change does not apply to Paid Consulting Call. The Paid flow is described in
[`README.md`](README.md#brand-paid-call-payment-method-client).

The Paid guest-field markup, validation, payload, and retry contract is owned by
the [Brand paid-call payment method client](README.md#brand-paid-call-payment-method-client).
Zero guest hooks keep Paid bookable without `guest_emails`. When guest entry is
installed, its complete five-row native Designer-authored tree sits outside
`[nylas-container]` and enables Paid guests. Any partial guest tree or stray
guest hook fails closed. The Paid controller owns the complete tree's
Paid/Free/close/success visibility and reset lifecycle.

## Inline Global Code cutover boundary

The released Webflow component still contains legacy JavaScript across its
Global Code embeds. The scoped cutover removes only the Free behavior now owned
by `free-call-booking.js`: Starter booking-profile reads, bookable configuration
reads, nearest-slot reads, Free chooser handlers, and Free Nylas scheduler
mounting. Keep the native chooser, modal shell, Nylas container, and success
step in Designer.

Do not port or remove the legacy Paid/Stripe branches, dashboard call lists,
call details, confirmation, decline, cancel, reschedule, payment actions, or
unrelated component code as part of this change. Those areas have separate V3
owners or require a separate cutover. Remove the old Free handlers only in the
same authorized Webflow publish that installs the new script. This prevents two
owners from binding the same click.

Note: the staging test index does not contain production records, so a
`404 ObjectID does not exist` on `webflow.io` is a data condition, not a code
fault. Card rendering is verified on production.
