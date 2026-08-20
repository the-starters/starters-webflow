# `v3/hire-profile.js` — wiring and ownership

Last updated: 2026-08-19
Status: Phase 2 native-CMS source cutover ready for release

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
```

Use [`scheduling-v3-hire-template-head.html`](scheduling-v3-hire-template-head.html)
as the owned embed source. Both tags are intentionally synchronous. The adapter
must own scheduling requests before the shared **Call Scheduling - Global Code**
component can execute its legacy helpers.

Webflow → hire template → Page Settings → Custom Code → **Footer**:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/hire-profile.js"></script>
```

Nothing else belongs in that footer. The page **head** keeps the two synchronous
scheduling loads above before the shared component. Its other page scripts can
remain deferred (`paid-call-brand-payment.js`,
`freelancer-cms/stripe-connect.js`, `reviews.js`, `project-form.js`,
`starters-ms-redirect.js`, `profile-portfolio.js`).

## Page ownership

| Area | Audience | Owner / source |
| --- | --- | --- |
| Notable Experience | everyone, incl. logged out | native Webflow CMS / Work Histories |
| Clients ("also worked with") | everyone, incl. logged out | native Webflow CMS / also-worked-with multi-reference |
| Services call cards (Free / Paid Consulting) | owner: live connection state · anonymous + brand: public search record | this file / Nylas, Stripe, or Algolia |
| Freelance / Retainer rate cards | everyone | this file / Algolia record, cloned from the section's Default card |
| Free booking popup | signed-in Brand members | this file + shared Free initializer / Nylas |
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
The booking globals are guaranteed by the verified page install order below.

- Site head: `qs`, `qsa`, `MEMBER`, `memberReady`, `waitForMember`
- Page embeds: `starter_memberstack_id`, `stripe_charges`, and the CMS-bound
  `[data-starter-xano-id]` carrier inside `.data-native-binding`
- Booking embeds: `getStarterByMemberId`, `getConfigs`, `getNearestSlot`,
  `initBookingComponents`, `formatWithTimezone`
- jQuery `$` — used by the dropdown and anchor-scroll blocks only; each is
  individually guarded, so a missing jQuery costs those two behaviours and
  nothing else. The anchor utilities also ignore a bare `#` or an invalid hash
  selector so a placeholder link cannot abort the remaining page utilities
- `window.WfAlgolia` — the search client, awaited with a 30s deadline
- `window.__startersEmptyNavRefresh` — optional, debounced refresh hook from
  `utils/section-custom-toc/hide-empty-sections.js`. After an asynchronous
  call-card reveal or rate-card render, this file asks the empty-section owner
  to re-evaluate the Services section and its TOC link. The call is guarded:
  a missing or failing cosmetic hook must not stop card rendering.

### Dependency contract, verified on production

Checked on `www.thestarters.com/hire/ashna-rana` at `document.readyState:
"complete"` — i.e. exactly the moment a deferred script runs — on 2026-08-16:

| Global | At defer time |
| --- | --- |
| `qs`, `qsa`, `waitForMember`, `getStarterByMemberId`, `getConfigs`, `getNearestSlot`, `initBookingComponents`, `formatWithTimezone`, `$` | `function` |
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
HTML parse rather than mid-parse. Every global it consumes is set by then. This
is the only intentional timing change in the port.

The empty-section observer watches child-list mutations, not attribute changes.
Changing a call card's inline `display` therefore does not trigger that observer.
Every asynchronous path that reveals call cards, plus the rate-card render path,
calls `window.__startersEmptyNavRefresh()` so `#services` and its TOC link match
the final visible-card state even when no rate card adds a DOM child.

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

Canaries: `/hire/ashna-rana` (free + paid calls, 5000 / 4500) and
`/hire/jake-mcintyre` (free call only, 135 / 5500).

1. Anonymous: 4 cards on ashna, 3 on jake. The Services section and its TOC
   link remain visible after the asynchronous cards render. Native CMS
   Experiences and Clients remain present, and no profile-data Xano request
   runs.
2. Anonymous click on **any** service card opens the signup modal in place.
   That is driven by `v3/signup-attribution.js` off `data-signup-trigger-*`, so
   the cloned rate cards must keep those attributes (values `Freelance` /
   `Retainer`) and must **not** carry `data-modal-trigger`, `booking-popup-open`,
   or `data-type` — otherwise a logged-in click opens an unconfigured booking
   popup for a card that cannot be booked.
3. Eligible signed-in Brand: call cards keep the Book Call modal flow, and each
   non-call card opens Start a Project with its exact native Services preset.
4. `document.documentElement` carries `data-v3-algolia-status="ready"`.
5. The Algolia object ID matches the positive integer in
   `[data-starter-xano-id]`.

## Call modal and project-service routing

The beside-services calendar markup remains authored for possible future use,
but runtime keeps `[data-availability-element="wrapper"]` hidden. The live flow
uses the existing modal sequence: Book Call opens `popup-booking-main`, and an
eligible Free or Paid option opens `popup-booking`. Free uses the Nylas public
component. Paid uses the authenticated calendar and booking flow owned by
[`README.md`](README.md#brand-paid-call-payment-method-client) inside the same
authored modal. Valid `/hire/<slug>` paths use the host-classified TEST or
production route map. The authored Book Call wrapper stays hidden and
`aria-hidden="true"` until canonical discovery produces a Free option that the
shared initializer can own or a Paid option that the V3 controller accepts.
Production `/hire/jp-dionisio` remains blocked before grant or configuration
discovery, so the TEST fixture cannot activate on a production host.

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
that set to the shared modal. Each record must have a `config_id`, `active ===
true`, and the host's exact `data_environment` (`test` on the Webflow test host,
`production` on the production hosts). Free records must have `is_paid ===
false`. Paid records must have `is_paid === true` and the matching
`payment_environment` (`test` or `live`), USD currency, and an integer
`price_cents` of at least 500, plus a positive integer `duration`. Unknown hosts
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
After discovery accepts the canonical set, the controller assigns each accepted
Free or Paid `config_id` and removes both unavailable markers for that option.
The shared initializer receives only the accepted Free configuration and keeps
the existing Free modal flow. `paid-call-brand-payment.js` receives the exact
accepted Paid configuration and owns that authored CTA, Stripe Card Element,
and paid booking command. A call type without one exact accepted configuration
keeps no `data-config` and retains the structural hide. This keeps an authored
Paid option closed during startup, when its controller is missing, and whenever
Paid has no accepted configuration; it does not hide the separate Services call
cards. A Paid-only set also keeps the Book Call trigger closed when the Paid
controller cannot install.

On the Free Call details screen, the controller hides the booking-form rows for
`brand_memberstack_id` and `starter_memberstack_id` after Nylas confirms the
timeslot. It does not remove or change either field, so both stable IDs remain
in the Nylas booking payload for Xano environment routing and ownership checks.
Name, Email, Add guest, and Call Context remain visible. This presentation-only
change does not apply to Paid Consulting Call. The Paid flow is described in
[`README.md`](README.md#brand-paid-call-payment-method-client).

The Paid guest-field markup, validation, payload, and retry contract is owned by
the [Brand paid-call payment method client](README.md#brand-paid-call-payment-method-client).
Its five native Designer-authored guest rows sit outside `[nylas-container]`.
The Paid controller fails closed when that complete structure is absent and
owns its Paid/Free/close/success visibility and reset lifecycle.

Note: the staging test index does not contain production records, so a
`404 ObjectID does not exist` on `webflow.io` is a data condition, not a code
fault. Card rendering is verified on production.
