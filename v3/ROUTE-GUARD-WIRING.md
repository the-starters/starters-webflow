# V3 Route Guard Wiring

Status: Local implementation only; not published

`v3/route-guard.js` is the sitewide companion to [auth-route.js](auth-route.js).
`auth-route.js` only routes at `/login` and `/auth-route`, so a logged-in member
can still open another role's page by navigating directly. This guard closes
that direct-access gap using the same stable plan-ID role matrix documented in
[ACCESS-MATRIX.md](ACCESS-MATRIX.md).

## What it does

On an approved V3 host, for a page it recognises:

| Member state | Action |
| --- | --- |
| Logged out | Replace with `/login?next=<current path+query>` |
| Role allowed on this page | Stay; set `html[data-route-guard="allowed"]` |
| Role not allowed on this page | Replace with that role's own default (never the other role's page) |
| Authenticated, no mapped active plan | Stay with `html[data-route-guard-error="unmapped-plan"]` |
| Page not in the matrix | Do nothing (no Memberstack lookup) |

Role defaults (identical to `auth-route.js`): Talent → `/starter-dashboard`,
Brand paid → `/brand-dashboard`, Brand free → `/quiz-results`.

## Guarded pages

Derived from the ACCESS-MATRIX route-level table. A role listed for a page may
view it; any other authenticated role is redirected to its default.

| Page | Allowed roles |
| --- | --- |
| `/brand-dashboard` | Brand paid |
| `/opportunities-brands-view` | Brand paid |
| `/opportunities---create` | Brand paid |
| `/starter-dashboard` | Talent |
| `/starter-edit-profile` | Talent |
| `/build-profile/select-profile` | Talent |
| `/build-profile/full-profile` | Talent |
| `/build-profile/consult` | Talent |
| `/opportunities-freelancer-view` | Talent |
| `/messages` | Talent, Brand paid |
| `/opportunities/<slug>` | Talent, Brand paid |

`/opportunities/<slug>` matches a single non-empty path segment only, so nested
paths such as `/opportunities/<slug>/apply` are not treated as detail pages.

**Intentionally not guarded (decision 2026-07-23):** `/quiz-results` and
`/all-starters`. Their ACCESS-MATRIX rows describe logged-in redirect defaults,
not that logged-out access must be blocked, and either may be a pre-signup funnel
page. They are excluded from the guard's page table so a site-wide install cannot
force an unexpected login. Add them back only after confirming both are
authenticated-only in V3 beta.

## Webflow install

1. Load `v3/route-guard.js` once, in Head Code, on each page in the
   **recommended install scope** below (not blanket sitewide — see that section).
   If a page also runs a controller with its own guard, load route-guard first so
   its redirect wins the race; the recommended scope avoids that overlap anyway.
2. Do not install it on V2.
3. Give guarded pages an error block keyed by `html[data-route-guard-error]`
   (same visible pattern as `/auth-route`). Optionally pre-hide protected
   content until `html[data-route-guard="allowed"]` to avoid a cross-role flash.

### Recommended install scope — avoid double-guarding

The guard's page table lists every page the matrix protects, but several of those
pages **already redirect** via `opportunities-3.0.js` / `messages.js`. Installing
the guard there too would double-direct (two scripts firing redirects with
different logic). Install the guard **only where nothing else guards the page**:

Install here (no existing guard — these are the real gaps, incl. the reproduced
`/brand-dashboard` failure):

- `/brand-dashboard` — reproduced P1 hole; nothing guards it today
- `/starter-edit-profile`
- `/build-profile/select-profile`, `/build-profile/full-profile`, `/build-profile/consult`
  (confirm no dedicated build-profile guard first)
- `/messages` — optional; `messages.js` already redirects logged-out, so add the
  guard here only to enforce the Free-Brand block `messages.js` does not do

Do **not** install here — `opportunities-3.0.js` already redirects by role:

- `/opportunities-brands-view`, `/opportunities-freelancer-view`,
  `/opportunities/<slug>`, `/opportunities---create` (opp30 gates each)
- `/starter-dashboard` (opp30 `gateOrRedirect('freelancer')`)

Note: opp30's guards on those pages use legacy dashboard custom-fields (the
anti-pattern the P1 audit flagged). The clean end-state is this guard as the
single plan-ID front-guard with opp30 dropping its own redirects — a separate
refactor, not required to close the P0 direct-access hole.

`/quiz-results` and `/all-starters` are deliberately outside the guard's page
table (see the note above the guarded-pages table); revisit only after confirming
they are authenticated-only.

## Relationship to other layers

The guard is a routing/UX boundary only. It does not replace:

- **Memberstack gated content** — page visibility and navigation variants.
- **Xano endpoint authorization** — mutations and private records, enforced
  server-side against the authenticated member and role.
- **List/render gating** — e.g. Free Brand blurred results on `/all-starters`.

`opportunities-3.0.js` keeps its own per-flow checks; the guard runs first and
denies cross-role access before that controller matters. Both derive roles from
the same stable plan IDs, so they agree.

## Diagnostics

- `window.StartersV3RouteGuard` exposes `activePlanIds`, `memberRole`,
  `pageRolesFor`, `isGuardedPath`, and `redirectTargetFor` for console checks.
- Errors dispatch `starters:v3-route-guard-error` on `window` with `detail.code`
  (`unmapped-plan`, `memberstack-unavailable`, `unexpected-error`).
- A resolved allow dispatches `starters:v3-route-guard-allowed`.

## Release gate

- Run `node --test v3/route-guard.test.js`.
- Confirm each guarded page has a visible error state.
- Back up page-level code before installing.
- Run the full cross-role staging matrix behind the Webflow password.
- Do not publish custom domains until the separate production go signal.
