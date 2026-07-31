# V3 Route Guard Wiring

Status: Local implementation only; not published

Tracking: Jira `INITIATIVE-132`. This router release remains independent from
the `INITIATIVE-131` points reconciliation and dashboard tile rollout.

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
| Mapped member on `/dashboard` | Replace with the role-specific authored page (or Free Brand quiz home) |
| Role allowed on this page | Stay immediately; set `html[data-route-guard="allowed"]` |
| Role not allowed on this page | Replace with that role's own default (never the other role's page) |
| Authenticated, no mapped active plan | Stay with `html[data-route-guard-error="unmapped-plan"]` |
| Active Talent plus Brand roles | Stay with `html[data-route-guard-error="conflicting-plan-roles"]` |
| Page not in the matrix | Do nothing (no Memberstack lookup) |

Role defaults (identical to `auth-route.js`): Talent → `/starter-dashboard`,
Brand paid → `/brand-dashboard`, Brand free → `/quiz` (or `/quiz-results` once
the quiz is completed — see brand-free routing below).

`/dashboard` is deliberately a thin router page. It must contain only a neutral
loading/error surface, never copies of the Starter or Brand dashboard bodies.
The role-specific pages remain the implementation and compatibility URLs.

## Guarded pages

Derived from the ACCESS-MATRIX route-level table. A role listed for a page may
view it; any other authenticated role is redirected to its default.

| Page | Allowed roles |
| --- | --- |
| `/dashboard` and `/dashboard/` | None stay; all mapped roles redirect to their role home |
| `/brand-dashboard` | Brand paid |
| `/opportunities` and `/opportunities/` | Talent, Brand paid |
| `/opportunities-brands-view` | Brand paid |
| `/opportunities---create` | Brand paid |
| `/starter-dashboard` | Talent |
| `/starter-edit-profile` | Talent |
| `/build-profile/select-profile` | Talent |
| `/build-profile/full-profile` | Talent |
| `/build-profile/consult` | Talent |
| `/starter-onboarding` | Talent |
| `/opportunities-freelancer-view` | Talent |
| `/messages` | Talent, Brand paid |
| `/opportunities/<slug>` | Talent, Brand paid |
| `/favorites` and `/favorites/` | Brand paid |

The merged feed lists both `/opportunities` forms explicitly: the exact page
map would otherwise miss the trailing slash, while the detail prefix requires a
non-empty slug. `/opportunities/<slug>` matches a single non-empty path segment
only, so nested paths such as `/opportunities/<slug>/apply` are not treated as
detail pages. `/dashboard` and `/favorites` list both slash forms for the same
reason: no prefix rule catches their trailing-slash twin, so each must appear
explicitly for both canonical URL forms to route identically.

Memberstack can initially expose only a lower Brand Free connection for a
multi-plan member. On the two exact merged-feed paths, an allowed Talent or
paid-Brand snapshot proceeds without delay. Before redirecting a denied role or
showing `unmapped-plan`, the guard polls for an allowed snapshot for up to two
seconds. A rejected polling lookup is retried within the same deadline, and a
lookup that never settles is capped by the remaining time. At the deadline, the
latest valid snapshot follows the normal fail-closed redirect or error. Other
guarded routes and opportunity detail pages do not use this hydration delay.

The guard's Brand paid allowance is role-level only. On both
`/opportunities/<slug>` and the legacy
`/opportunities-details---brand-view?opp=<id>` entry point,
`opportunities-3.0.js` probes the owner-scoped applicant list. A `403` or `404`
redirects a foreign brand to `/opportunities-brands-view`; transient, server, and
network errors do not redirect. Xano remains responsible for ownership enforcement.

**Intentionally not guarded:** `/quiz`, `/quiz-results`, and `/all-starters`.
`/quiz` is the funnel entry. Its `quiz-main/quiz-redirect.js` page controller
sends an active live or Test paid Brand to `/brand-dashboard` and a completed
active production free Brand to `/quiz-results`, with `?retake=true` as the
intentional escape hatch; unknown/Talent plans are unaffected. On entry,
`quiz-main.js` combines the logged-in member's saved quiz answers with any
homepage-bucket selections.
`/quiz-results` has page-specific handling instead:
when no test, pending, or saved quiz data exists, `quiz-results.js` redirects to
`/quiz` only after Memberstack positively reports that the visitor is logged
out. It stays put if Memberstack is unavailable or errors, and pending
pre-signup quizzes and test-mode previews never reach this branch. `/all-starters`
remains excluded until its authenticated-only status is confirmed.

## Webflow install

1. Load `v3/route-guard.js` once sitewide in Site Settings Head Code, before
   `v3/auth-route.js` and `opportunities-3.0.js`. This includes opportunity
   pages: opp30 detects the guard through `html[data-route-guard]` and defers
   its access decisions to it.
2. Do not install it on V2.
3. Give guarded pages an error block keyed by `html[data-route-guard-error]`
   (same visible pattern as `/auth-route`). Optionally pre-hide protected
   content until `html[data-route-guard="allowed"]` to avoid a cross-role flash.
4. Create `/dashboard` as a utility page with a neutral loading/error surface.
   Keep `/starter-dashboard` and `/brand-dashboard` unchanged as the actual
   authored dashboards.

Regression rule: published source must contain one `opportunities-3.0.js` tag
and place the route-guard tag first. The controller has a bounded handoff for an
authored guard that executes later, waits for its terminal `allowed`, error, or
redirect outcome, and falls back after two seconds only if the guard never
boots. The guard itself owns the merged route's bounded denial-side plan
hydration described above. If the configured guard never boots, opp30
separately polls for up to two seconds when an authenticated Memberstack
snapshot has empty `planConnections`; it does not retry a non-empty, unmapped
snapshot. If no mapped role hydrates, opp30 leaves protected content hidden and
stamps `html[data-route-guard-error="member-role-unavailable"]` instead of
redirecting to `/`. It also has an existing duplicate-load run-once guard, but those
protections are incident containment—not a replacement for clean Webflow script
placement.

### Recommended install scope

Install the guard sitewide so it boots before page controllers and is present on
every route in its page table:

- `/brand-dashboard`, `/opportunities-brands-view`, `/opportunities---create`
- `/starter-dashboard`, `/starter-edit-profile`, `/opportunities-freelancer-view`
- `/dashboard` canonical role-router utility page
- `/build-profile/select-profile`, `/build-profile/full-profile`, `/build-profile/consult`
- `/starter-onboarding`
- `/favorites` (including its trailing-slash URL)
- `/messages`
- `/opportunities` merged-feed page (including its trailing-slash URL)
- `/opportunities/<slug>` collection-template pages

With the guard sitewide, opp30 does not double-guard opportunity pages: it uses
the guard's presence to defer access redirects and validates the same plan-ID
role only before starting role-specific rendering or requests.

`/quiz`, `/quiz-results`, and `/all-starters` are deliberately outside the
guard's page table (see the note above the guarded-pages table). Revisit
`/all-starters` after confirming whether it is authenticated-only;
both quiz pages keep their page-controller redirects separate from the sitewide
guard.

## Integration checklist

- Point new generic dashboard links, post-auth Memberstack destinations, and
  shared navbar Dashboard links to `/dashboard`.
- Keep existing role-specific links and bookmarks working; do not redirect
  `/starter-dashboard` or `/brand-dashboard` into `/dashboard`.
- Keep V3 login/signup forms on `/auth-route`; a stored `next=/dashboard` is
  consumed there and translated directly to the member's role home.
- Verify Talent, paid Brand, Test Brand, Free Brand before quiz, and Free Brand
  after quiz.
- Verify both direct legacy dashboard URLs with the allowed role and the wrong
  role.
- Treat the dashboard-router release independently from INITIATIVE-131 points
  reconciliation. Neither release is a prerequisite or implicit approval for
  the other.

## Relationship to other layers

The guard is a routing/UX boundary only. It does not replace:

- **Memberstack gated content** — page visibility and navigation variants.
- **Xano endpoint authorization** — mutations and private records, enforced
  server-side against the authenticated member and role.
- **List/render gating** — e.g. Free Brand blurred results on `/all-starters`.

`opportunities-3.0.js` defers access redirects to the sitewide guard. Before
starting role-specific work, it verifies the member against the same stable plan
IDs. On the exact merged-feed paths, the guard performs the bounded
denial-side hydration retry, including partial lower-role and unmapped
snapshots. The opportunity controller's fallback retries only an authenticated
snapshot with no plan connections; a complete unmapped snapshot does not.
After the guard allows the route, an unresolved role bails without revealing or
initializing either role's UI.

## Diagnostics

- `window.StartersV3RouteGuard` exposes `activePlanIds`, `memberRole`,
  `memberRoleError`, `roleResolution`, `roleHome`, `hasCompletedQuiz`,
  `brandFreeHome`, `pageRolesFor`, `isGuardedPath`, and `redirectTargetFor` for
  console checks, plus
  `waitForSharedOpportunitiesAccess` for the merged-feed hydration decision.
- `window.Opp30` exposes `routeGuardActive`, `routeGuardConfigured`,
  `waitForRouteGuardHandoff`, `gateOrRedirect`, `gateByPlan`, `memberPlanRole`,
  `waitForMappedMemberRole`, `hasCompletedQuiz`, `brandFreeHome`, `initMergedOppFeed`,
  `syncMergedNavbarRole`, `activateDeferredFeed`, and
  `redirectForeignBrandToFeed` for verifying the opportunity controller's
  handoff, plan hydration, merged-feed activation, legacy fallback, and
  ownership-denied redirect policy.
- Errors dispatch `starters:v3-route-guard-error` on `window` with `detail.code`
  (`unmapped-plan`, `conflicting-plan-roles`, `memberstack-unavailable`,
  `unexpected-error`).
- If an authored guard never boots and opp30 cannot hydrate a mapped role,
  opp30 stamps `html[data-route-guard-error="member-role-unavailable"]`; this
  controller fallback does not dispatch the guard's error event.
- A resolved allow dispatches `starters:v3-route-guard-allowed`.
- Navigation stamps `html[data-route-guard="redirecting"]` and dispatches
  `starters:v3-route-guard-redirecting` before replacing the location.

## Release gate

- Run `node --test v3/route-guard.test.js`.
- Confirm `/dashboard` has no role page body and hides its neutral content while
  `data-route-guard="checking"`.
- Confirm each guarded page has a visible error state.
- Back up page-level code before installing.
- Verify `/dashboard`, `/starter-dashboard`, and `/brand-dashboard` for Talent,
  paid Brand, Test Brand, both Free Brand quiz states, logged-out, unmapped, and
  deliberately conflicted fixtures.
- Run the full cross-role staging matrix behind the Webflow password.
- Do not publish custom domains until the separate production go signal.
