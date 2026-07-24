# V3 Onboarding Tour Wiring

`v3/onboarding-tour.js` renders attribute-driven product tours with
[driver.js](https://driverjs.com/) (MIT, ~5kb, pinned to `1.8.0` on jsDelivr).
Tour steps are authored entirely in the Webflow Designer; copy or step changes
never need a code release. Jira: INITIATIVE-125.

## What it does

- Scans the page for `data-tour-step` elements and groups them into tours.
- Auto-starts at most one tour per page load: the first tour (DOM order) whose
  role restriction matches the member and that the member has not seen.
- Persists seen-state per member in Memberstack member JSON
  (`json.tours[tourId]`), so a tour shows once per member across devices.
  Logged-out visitors on public pages fall back to `localStorage`.
- Loads driver.js JS + CSS from jsDelivr on demand — only when the page has an
  eligible tour, nothing loads otherwise.
- On pages guarded by `v3/route-guard.js`, waits for the
  `starters:v3-route-guard-allowed` signal so a redirecting page never flashes
  a tour.
- Presentation-only. It never gates access; the role check reuses the stable
  Memberstack plan-ID map from `v3/route-guard.js` purely to pick an audience.

## Designer attributes

Set on the element each step should highlight:

| Attribute | Required | Example | Meaning |
| --- | --- | --- | --- |
| `data-tour-step` | yes | `starter-dashboard:1` | `<tourId>:<order>`. Order is any integer; ties keep Designer order. |
| `data-tour-title` | no | `Your dashboard` | Popover title. |
| `data-tour-text` | no | `Track applications here.` | Popover body. |
| `data-tour-side` | no | `bottom` | driver.js popover side (`top`/`right`/`bottom`/`left`). |
| `data-tour-align` | no | `start` | driver.js popover align (`start`/`center`/`end`). |
| `data-tour-roles` | no | `talent` | Comma list; the tour auto-starts only for these roles (`talent`, `brand-paid`, `brand-free`). Put it on any one step; lists on multiple steps are merged. |
| `data-tour-once` | no | `false` | On any step: replay the tour every visit (default is show-once). |

Optional replay trigger (e.g. a "Show me around" navbar/help link):

| Attribute | Example | Meaning |
| --- | --- | --- |
| `data-tour-start` | `starter-dashboard` | Click starts that tour regardless of role or seen-state. |

⚠ Webflow's Designer strips valueless custom attributes — every attribute above
takes a value, matching the `wf-xano-element` grammar convention.

## Webflow install

Page Settings → Custom Code → Head Code on each page that has a tour
(current scope: `/starter-dashboard`):

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/onboarding-tour.js"></script>
```

Prefer the env-switch loader (`utils/loader.js`) where the page already uses
it: `@main` on `the-starters-3-0.webflow.io`, pinned tag on prod. Do not
install sitewide; the script is cheap but tours are page-scoped.

driver.js itself needs no separate embed — the module injects the pinned
JS/CSS from jsDelivr only when a tour is about to run. Theme overrides for the
popover (fonts/colors) can go in a small site-level CSS embed targeting
`.driver-popover`.

## Memberstack notes

- Seen-state lives in member JSON, not a custom field — no dashboard field
  setup needed. Key: `json.tours["<tourId>"] = <ISO timestamp>`.
- If the member JSON read fails, the tour fails closed (does not show) rather
  than nagging members on every hiccup.
- To reset a member's tours for testing: clear `tours` from the member's JSON
  in the Memberstack dashboard, or use a `data-tour-start` trigger which
  ignores seen-state.

## Diagnostics

- `window.StartersV3OnboardingTour` exposes `parseTours`, `autoStartTarget`,
  `startTour`, `memberRole` for console debugging.
- `starters:v3-tour-started` fires on `window` with `{ tourId }` when a tour
  starts (hook for PostHog capture).
- Malformed `data-tour-step` values log a `[v3-onboarding-tour]` warning and
  are skipped.

## Release gate

- Run `node --test v3/onboarding-tour.test.js`.
- Release via the `webflow-cdn-release` skill (merge to `main`, semver tag,
  jsDelivr purge, verify served asset).
- Browser-verify on staging with the V3 Test Mode Talent account
  (authenticate the site password gate via `.wf_auth` first); confirm the tour
  shows once, and not again after reload.
- Standard exposure scan: no Airtable/Make URLs or PAT patterns (this module
  calls only jsDelivr and Memberstack).
