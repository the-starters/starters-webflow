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

1. Load `v3/route-guard.js` once, in Head Code, on each **authenticated** page
   above. Load it before `opportunities-3.0.js` so the guard's redirect wins the
   race before the page controller binds.
2. Do not install it on V2.
3. Give guarded pages an error block keyed by `html[data-route-guard-error]`
   (same visible pattern as `/auth-route`). Optionally pre-hide protected
   content until `html[data-route-guard="allowed"]` to avoid a cross-role flash.

### Recommended first install scope

Start with the pages whose direct-access failure was reproduced in the P1 audit,
plus their symmetric role pages, then extend:

- `/brand-dashboard`, `/opportunities-brands-view`, `/opportunities---create`
- `/starter-dashboard`, `/starter-edit-profile`, `/opportunities-freelancer-view`
- `/build-profile/select-profile`, `/build-profile/full-profile`, `/build-profile/consult`
- `/messages`

This is the full set the guard's page table covers. `/quiz-results` and
`/all-starters` are deliberately outside that table (see the note above the
guarded-pages table); revisit only after confirming they are authenticated-only.

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
