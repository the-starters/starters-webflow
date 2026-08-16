# `v3/hire-profile.js` — wiring and ownership

Last updated: 2026-08-16
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

Webflow → hire template → Page Settings → Custom Code → **Footer**:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/hire-profile.js"></script>
```

Nothing else belongs in that footer. The page **head** keeps its existing
deferred loads (`scheduling-auth.js`, `scheduling-v3-stage.js`,
`paid-call-brand-payment.js`, `freelancer-cms/stripe-connect.js`, `reviews.js`,
`project-form.js`, `starters-ms-redirect.js`, `profile-portfolio.js`).

## Page ownership

| Area | Audience | Owner / source |
| --- | --- | --- |
| Notable Experience | everyone, incl. logged out | native Webflow CMS / Work Histories |
| Clients ("also worked with") | everyone, incl. logged out | native Webflow CMS / also-worked-with multi-reference |
| Services call cards (Free / Paid Consulting) | owner: live connection state · anonymous + brand: public search record | this file / Nylas, Stripe, or Algolia |
| Freelance / Retainer rate cards | everyone | this file / Algolia record, cloned from the section's Default card |
| Booking popups, next-available slot | signed-in members only | this file / Nylas via page embeds |
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
  nothing else
- `window.WfAlgolia` — the search client, awaited with a 30s deadline

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

1. Anonymous: 4 cards on ashna, 3 on jake. Native CMS Experiences and Clients
   remain present, and no profile-data Xano request runs.
2. Anonymous click on **any** service card opens the signup modal in place.
   That is driven by `v3/signup-attribution.js` off `data-signup-trigger-*`, so
   the cloned rate cards must keep those attributes (values `Freelance` /
   `Retainer`) and must **not** carry `data-modal-trigger`, `booking-popup-open`,
   or `data-type` — otherwise a logged-in click opens an unconfigured booking
   popup for a card that cannot be booked.
3. Signed-in brand: same cards visible, no console errors, booking still gated.
4. `document.documentElement` carries `data-v3-algolia-status="ready"`.
5. The Algolia object ID matches the positive integer in
   `[data-starter-xano-id]`.

Note: the staging test index does not contain production records, so a
`404 ObjectID does not exist` on `webflow.io` is a data condition, not a code
fault. Card rendering is verified on production.
