# `v3/hire-profile.js` — wiring and ownership

Last updated: 2026-08-16
Status: ported out of Webflow page code; behaviour unchanged

## What this is

The `/hire/<slug>` profile renderer. It previously lived as ~37KB of inline
custom code in the **footer** of the Webflow hire template (page
`69f241ed147b71addb6f153d`, "Hire | Freelancers 3.0s – Pages Template"). It now
lives here, and the page footer loads it from jsDelivr instead.

This is the same move already made for `v3/profile-portfolio.js`: GitHub is the
source of truth for browser code, and page/site custom code stays thin.

The port is **behaviour-for-behaviour**. The exact pre-migration block is kept at
`webflow-sites/starters-3/custom-code-backups/hire-template-footer-pre-cdn-migration-2026-08-16.html`
in the ops workspace.

## Install

Webflow → hire template → Page Settings → Custom Code → **Footer**:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/hire-profile.js"></script>
```

Nothing else belongs in that footer. The page **head** keeps its existing
deferred loads (`scheduling-auth.js`, `scheduling-v3-stage.js`,
`paid-call-brand-payment.js`, `freelancer-cms/stripe-connect.js`, `reviews.js`,
`project-form.js`, `starters-ms-redirect.js`, `profile-portfolio.js`).

## What it renders

| Area | Audience | Source |
| --- | --- | --- |
| Notable Experience | everyone, incl. logged out | `api:SYL06lUR/companies` |
| Clients ("also worked with") | everyone, incl. logged out | `api:KZf7nFnk/.../get_also_worked_with` + `/profile/get_companies` |
| Services call cards (Free / Paid Consulting) | owner: live connection state · anonymous + brand: public search record | Nylas/Stripe state, or Algolia |
| Freelance / Retainer rate cards | everyone | Algolia record, cloned from the section's Default card |
| Booking popups, next-available slot | signed-in members only | Nylas via page embeds |
| Utilities | everyone | rate formatting, rating average, dropdowns, anchor scroll, mobile TOC, view-all, see-more |

## Dependencies this file does NOT own

All of these are defined by **other** page or site embeds that run before it.
The file reads them defensively and stands down with a `[hire-profile]` warning
rather than throwing, because an uncaught `ReferenceError` would abort the
whole file and take every section with it.

- Site head: `qs`, `qsa`, `MEMBER`, `memberReady`, `waitForMember`
- Page embeds: `starter_memberstack_id`, `stripe_charges`
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
other index**.

A hardcoded `Freelancers3.0-dev` is exactly what silently broke the entire
Services section on 2026-08-16, for every viewer, after the index migration.

## Verification

Canaries: `/hire/ashna-rana` (free + paid calls, 5000 / 4500) and
`/hire/jake-mcintyre` (free call only, 135 / 5500).

1. Anonymous: 4 cards on ashna, 3 on jake. Experiences and Clients both render.
2. Anonymous click on **any** service card opens the signup modal in place.
   That is driven by `v3/signup-attribution.js` off `data-signup-trigger-*`, so
   the cloned rate cards must keep those attributes (values `Freelance` /
   `Retainer`) and must **not** carry `data-modal-trigger`, `booking-popup-open`,
   or `data-type` — otherwise a logged-in click opens an unconfigured booking
   popup for a card that cannot be booked.
3. Signed-in brand: same cards visible, no console errors, booking still gated.
4. `document.documentElement` carries `data-v3-algolia-status="ready"`.

Note: the staging test index does not contain production records, so a
`404 ObjectID does not exist` on `webflow.io` is a data condition, not a code
fault. Card rendering is verified on production.
