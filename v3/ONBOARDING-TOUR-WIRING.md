# V3 Onboarding Tour Wiring

`v3/onboarding-tour.js` renders attribute-driven product tours with
[driver.js](https://driverjs.com/) (MIT, ~5kb, pinned to `1.8.0` on jsDelivr).
Tour steps are authored entirely in the Webflow Designer; copy or step changes
never need a code release. Jira: INITIATIVE-125.

## What it does

- Scans the page for `data-tour-step` elements and groups them into tours.
- Auto-starts at most one tour per page load: the first tour (DOM order) whose
  role restriction matches the member and that the member has not seen.
- Waits until `window.load` plus a one-second layout-settle delay before an
  automatic or query-string start. It then confirms the first step still
  exists, so pages whose hydration removes the tour markup skip the tour
  without an error.
- Passes step selectors to driver.js instead of captured element nodes, letting
  each step resolve against the live DOM after Webflow or `wf-xano` hydration.
  An optional highlight target can redirect a page-scoped step to another
  element, including an element inside a shared Webflow component.
- Can open a visible disclosure control before highlighting a target inside it,
  then closes that disclosure when the step is left or the tour ends. A
  disclosure step is omitted when its opener is hidden at the current
  responsive breakpoint.
- Persists seen-state per member in Memberstack member JSON
  (`json.tours[tourId]`), so a successful write suppresses that tour for the
  member across devices.
  Logged-out visitors on public pages fall back to `localStorage`.
- Loads driver.js JS + CSS from jsDelivr on demand — only when the page has an
  eligible tour, nothing loads otherwise.
- Applies the site's typography to driver.js popovers on the first tour start:
  the title uses the first `h1`, `h2`, or `.heading-style-h1` computed font at
  weight 500, and the description uses the body's computed font. If computed
  styles are unavailable, the title falls back to
  `Baskervville, Georgia, serif` and the description to
  `"Inter Variable", Tahoma, sans-serif`.
- On pages guarded by `v3/route-guard.js`, waits for the
  `starters:v3-route-guard-allowed` signal so a redirecting page never flashes
  a tour.
- Presentation-only. It never gates access; the role check reuses the stable
  Memberstack plan-ID map from `v3/route-guard.js` purely to pick an audience.

## Designer attributes

Set on the element that defines each step. By default that element is also
highlighted; `data-tour-target` can override the highlight:

| Attribute | Required | Example | Meaning |
| --- | --- | --- | --- |
| `data-tour-step` | yes | `starter-dashboard:1` | A page-unique `<tourId>:<order>` value. Order is any integer; ties with distinct values (for example, `1` and `01`) keep Designer order. Duplicate values are ignored. |
| `data-tour-title` | no | `Your dashboard` | Popover title. |
| `data-tour-text` | no | `Track applications here.` | Popover body. |
| `data-tour-side` | no | `bottom` | driver.js popover side (`top`/`right`/`bottom`/`left`). |
| `data-tour-align` | no | `start` | driver.js popover align (`start`/`center`/`end`). |
| `data-tour-target` | no | `.post-opportunity` or `text:Post Opportunity` | Highlight a different element. A CSS selector uses its first match. `text:<label>` prefers the smallest visible `a`, `button`, or `[role="button"]` whose trimmed text exactly matches, then the smallest visible `span`, `div`, or `p`. If the selector is invalid, has no match, or no visible exact-text match exists, the step's tagged element is highlighted instead. |
| `data-tour-open` | no | `.account-menu-toggle` | CSS selector for a disclosure control to open before highlighting `data-tour-target`. The opener must be visible; otherwise the step is omitted (for example, when a desktop avatar is collapsed into a mobile menu). The module dispatches the Webflow-compatible mouse sequence, refreshes the popover while the disclosure settles, and restores the disclosure when leaving the step or ending the tour. |
| `data-tour-roles` | no | `talent` | Comma list; the tour auto-starts only for these roles (`talent`, `brand-paid`, `brand-free`). Put it on any one step; lists on multiple steps are merged. |
| `data-tour-once` | no | `false` | On any step: replay the tour every visit (default is show-once). |

Optional replay trigger (e.g. a "Show me around" navbar/help link):

| Attribute | Example | Meaning |
| --- | --- | --- |
| `data-tour-start` | `starter-dashboard` | Click starts that tour immediately, without the automatic-start settle delay, regardless of role or seen-state. Manual starts do not change seen-state. |

## Replay and reset controls

These presentation-only controls work on staging and production:

- `?tour=<tourId>` starts that page's named tour after the normal layout-settle
  delay, bypassing role restrictions and seen-state. It never marks the tour
  seen. An unknown ID logs a warning and does nothing.
- `?tour=reset` deletes the member JSON `tours` key while preserving all other
  member JSON, clears the guest tours `localStorage` key, and then continues
  through normal auto-start behavior. A show-once tour that starts successfully
  is marked seen again.
- `Alt+Shift+T` replays the first tour in page DOM order. The shortcut uses the
  physical `T` key and is ignored for repeats and while focus is in an input,
  textarea, or contenteditable element.

Only one tour can start at a time. Query-string, keyboard, and click replays do
not grant access or change route protection. An open `.driver-popover` is the
running-tour signal; after dismissal removes it, any replay control can start
the tour again without relying on a driver.js destruction callback.

⚠ Webflow's Designer strips valueless custom attributes — every attribute above
takes a value, matching the `wf-xano-element` grammar convention.

## Webflow install

Page Settings → Custom Code → Head Code on each page that has a tour
(current scope: `/starter-dashboard` — 5-step Talent tour; `/brand-dashboard`
— 6-step brand-paid tour whose finale highlights the navbar Post Opportunity
button via `data-tour-target=".navbar_button:has(a[href='/opportunities-brands-view'])"`
on a page-scoped carrier, since that button lives in the shared `Navbar v2`
component and cannot carry a custom attribute headlessly; both installed
headlessly 2026-07-24 via `data_scripts_tool set_page_freeform_code`):

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/onboarding-tour.js"></script>
```

Prefer the env-switch loader (`utils/loader.js`) where the page already uses
it: `@main` on `the-starters-3-0.webflow.io`, pinned tag on prod. Do not
install sitewide; the script is cheap but tours are page-scoped.

driver.js itself needs no separate embed — the module injects the pinned
JS/CSS from jsDelivr only when a tour is about to run. The module injects its
typography theme once, on the first start, and sets
`--starters-tour-title-font` and `--starters-tour-text-font` on the document
root from the live page. Site-level CSS can override those properties or
target `.driver-popover` for other theme changes such as colors.

## Replay / reset controls (since v1.47, staging and prod)

Tours are presentation-only, so these are safe to expose everywhere:

| Control | Effect |
| --- | --- |
| `?tour=<tourId>` | Starts that tour on demand. Bypasses roles and seen-state, never marks it seen. Unknown ids warn in the console and do nothing. |
| `?tour=reset` | Clears the visitor's seen-state (member JSON `tours` key or guest localStorage), then the normal auto-start runs and re-marks. |
| `Alt+Shift+T` | Replays the page's first tour. Layout-independent (`e.code`), ignored while typing in inputs. |
| `data-tour-start="<tourId>"` | Click trigger on any element (e.g. a "Show me around" help link). Never marks seen. |

Only one tour can run at a time; replay requests while a tour is on screen
are ignored.

## Memberstack notes

- Seen-state lives in member JSON, not a custom field — no dashboard field
  setup needed. Key: `json.tours["<tourId>"] = <ISO timestamp>`.
- The module writes seen-state after driver.js starts. If that write fails, the
  running tour is unaffected and may auto-start again on a later visit.
- If the member JSON read fails, the tour fails closed (does not show) rather
  than nagging members on every hiccup.
- To reset tours for testing, load the page with `?tour=reset`. To replay
  without changing seen-state, use `?tour=<tourId>`, `Alt+Shift+T`, or a
  `data-tour-start` trigger.

## Diagnostics

- `window.StartersV3OnboardingTour` exposes `activePlanIds`, `memberRole`,
  `parseTours`, `resolveStepElement`, `buildDriverSteps`, `autoStartTarget`,
  `loadDriver`, and `startTour` for console debugging, plus
  `replayRequestFromQuery` for parsing the query-string replay contract.
  `resolveStepElement` returns the configured CSS selector or matched element,
  falling back to the step selector. `buildDriverSteps` omits disclosure steps
  whose opener is not visible. `startTour` returns `null` when another start is
  in flight, a driver popover is already open, or responsive filtering removes
  every step.
- `starters:v3-tour-started` fires on `window` with `{ tourId }` when a tour
  starts (hook for PostHog capture).
- Malformed or duplicate `data-tour-step` values log a
  `[v3-onboarding-tour]` warning and are skipped.

## Release gate

- Run `node --test v3/onboarding-tour.test.js`.
- Release via the `webflow-cdn-release` skill (merge to `main`, semver tag,
  jsDelivr purge, verify served asset).
- Browser-verify on staging with the V3 Test Mode Talent account
  (authenticate the site password gate via `.wf_auth` first); confirm the tour
  shows once, and not again after reload. Verify `?tour=<tourId>` replays
  without changing seen-state, `?tour=reset` restores normal auto-start, and
  `Alt+Shift+T` replays the first tour. While the tour is open, confirm another
  replay is ignored; dismiss it with the close button, then confirm
  `Alt+Shift+T` starts it again. Confirm the popover title matches the page
  heading font at weight 500 and the description matches the body font. For a
  step with `data-tour-target`, confirm the override highlights its target and
  an unmatched target falls back to the tagged step element. For a step with
  `data-tour-open`, confirm the disclosure opens before its target is
  highlighted, closes on next/previous/dismissal, and is omitted when its
  opener is hidden at the current breakpoint.
- Standard exposure scan: no Airtable/Make URLs or PAT patterns (this module
  calls only jsDelivr and Memberstack).
