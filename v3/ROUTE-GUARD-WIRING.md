# V3 Route Guard Wiring

Status: Installed sitewide on staging (2026-08-03). The staging site
`the-starters-3-0.webflow.io` loads it from project Custom Code head at jsDelivr
`@latest`, so a new git tag deploys it without an embed change. The production
custom-domain publish is still deferred.

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
| Logged out | Replace with `/login?next=<current path+query>`, or with the page's `LOGGED_OUT_DESTINATIONS` override where one is configured |
| Mapped member on `/dashboard` | Replace with the role-specific authored page (or Free Brand quiz home) |
| Role allowed on this page | Stay immediately; set `html[data-route-guard="allowed"]` |
| Role not allowed on this page | Replace with that role's own default (never the other role's page) |
| Authenticated, no mapped active plan | Stay with `html[data-route-guard-error="unmapped-plan"]` |
| Active Talent plus Brand roles | Stay with `html[data-route-guard-error="conflicting-plan-roles"]` |
| Page not in any of the three tables | Do nothing (no Memberstack lookup) |

Role defaults (identical to `auth-route.js`): Talent → `/starter-dashboard`,
Brand paid → `/brand-dashboard`, Brand free → `/quiz` (or `/quiz-results` once
the quiz is completed — see brand-free routing below).

`/dashboard` is deliberately a thin router page. It must contain only a neutral
loading/error surface, never copies of the Starter or Brand dashboard bodies.
The role-specific pages remain the implementation and compatibility URLs.

## Three page tables

The guard keeps three separate tables, in descending strength. They must stay
disjoint — a path in two of them would be served by whichever boot branch runs
first — and `v3/route-guard.test.js` parses all three out of the source and
asserts no path appears in two.

| Table | Logged-out visitor | Wrong-role member | Section |
| --- | --- | --- | --- |
| `PAGE_ROLES` | Sent to `/login?next=` or the page's override | Sent to their role home | [Guarded pages](#guarded-pages) |
| `MEMBER_BOUNCE_PAGES` | Untouched | n/a — every mapped member is bounced | [Member-home bounce pages](#member-home-bounce-pages) |
| `ROLE_BOUNCE_PAGES` | Untouched | Sent to their role home | [Member-only role bounce pages](#member-only-role-bounce-pages) |

At boot the member-bounce test runs first (those paths are absent from
`PAGE_ROLES`, so the guarded-path test would bail on them), then the guarded-page
test, then the role-bounce test — so `PAGE_ROLES` outranks only `ROLE_BOUNCE_PAGES`,
and the strength ordering in the table above is not the boot ordering. Because the
tables are disjoint that order decides nothing today; if a path were ever
duplicated by mistake the earlier branch would win, which is why the two tables
that can force a login or a redirect for the widest set of visitors are tested
before the weakest one.

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
| `/generate-invoice` and `/generate-invoice/` | Talent |

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

`/generate-invoice` was added on 2026-08-03 with its trailing-slash twin for the
same reason as `/favorites/`, and appears in `auth-route.js` `ROLE_DESTINATIONS`
too. The guard/router parity test in `v3/auth-route.test.js` enforces that pair —
a new `PAGE_ROLES` row without the matching router entry fails the suite rather
than silently dropping a `next`.

`/complete-profile` briefly lived in this table on 2026-08-03 and was removed the
same day. Memberstack is now its sole gate: the `restrict-pages` gated content
group carries a URL rule STARTS `complete-profile` with redirect `login`. Two
owners would mean two logged-out destinations for one URL, and the guard's would
lose anyway — Memberstack's `protectPages()` calls
`window.location.replace('/login')` from cached group data before the guard has
resolved a member. That redirect carries no `?next=`, so the page is out of
`ROLE_DESTINATIONS` as well; the member-home bounce pages forward whoever lands
on `/login` to their role home, which is what completes the routing. Do not
re-add the page here without revisiting that decision — `v3/route-guard.test.js`
asserts `pageRolesFor('/complete-profile')` is `null` so the re-add cannot be
accidental.

What the page did gain on 2026-08-03 is a page-scoped module rather than a table
entry: `v3/complete-profile-redirect.js` sends a paid Brand whose
`completed-brand-profile` member field is set on to `/brand-dashboard`, and does
nothing for anyone else. It reads the guard's role contract and adds no access
rule, so the division above is unchanged — see
[COMPLETE-PROFILE-REDIRECT-WIRING.md](COMPLETE-PROFILE-REDIRECT-WIRING.md).

## Member-home bounce pages

`MEMBER_BOUNCE_PAGES` — `/`, `/login`, `/starter-login`, `/sign-up` — is a
separate mechanism from the guarded-pages table above, added 2026-08-03 by
Jerico's decision. These four paths are deliberately absent from `PAGE_ROLES`,
because a guarded page forces a login and these are the pre-signup funnel itself.

| Visitor state on a bounce page | Action |
| --- | --- |
| Logged out, or Memberstack unavailable | Nothing at all: no redirect, no attribute, no event |
| Mapped member with a valid, permitted `?next=` | Replace with that `next` |
| Mapped member otherwise | Replace with the role home (Free Brand: quiz home) |
| Authenticated but unmapped or cross-role conflicted | Stay, with a `console.error` only — no `data-route-guard-error` |

A `?next=` is honoured only when it is same-origin, free of embedded
credentials, and either allowed for the member's role or on a page the guard does
not police at all — the second case is what returns a member to the public page
they were reading before signing in. Three refusals are deliberate: a `next`
pointing back at a bounce page (it would bounce again), `/dashboard` (an empty
allowlist, so it resolves to the role home exactly as `auth-route.js` resolves
it), and any page the member's role may not view.

Unlike a guarded page, a bounce page never gets the `data-route-guard="checking"`
stamp. These pages are authored for signed-out visitors and must not depend on
this script to become visible; the only attribute the bounce ever sets is
`data-route-guard="redirecting"` on the way out. No role home is itself a bounce
page, so the bounce cannot loop — `v3/route-guard.test.js` asserts that directly.

Note that `/login` and `/starter-login` are also configured by
`v3/auth-route.js`, which stores a `?next=` in session storage for the
`/auth-route` hop. When a signed-in member is bounced off a login page, that
stored value is left behind unconsumed; it is harmless, since it is re-validated
against the role allowlist at `/auth-route` on the next real login.

## Member-only role bounce pages

`ROLE_BOUNCE_PAGES` — added 2026-08-03 by Jerico's decision — is the third table
and the weakest. It combines the member-home bounce's silence with the guarded
pages' role test: only a positively identified, role-mapped member is ever moved,
and only ever to their own role home.

| Page | Roles that stay | Quiz-state rule |
| --- | --- | --- |
| `/quiz-results` and `/quiz-results/` | Brand free | Yes — see below |
| `/all-starters` and `/all-starters/` | Brand paid, Brand free | No |

| Visitor state on a role-bounce page | Action |
| --- | --- |
| Logged out, or Memberstack unavailable | Nothing at all: no redirect, no attribute, no event |
| Role on the page's allowlist | Stay, with no attribute either |
| Role not on the allowlist | Replace with the role home (never the other role's page) |
| Authenticated but unmapped or cross-role conflicted | Stay, with a `console.error` only |

Neither page may become a guarded page. `/quiz-results` legitimately serves
pre-signup anonymous visitors whose answers are still in `sessionStorage`, and
`quiz-results.js` owns that case; `/all-starters` is a public browse page whose
content is gated by Memberstack `data-ms-content` rather than by route. A guarded
page sends a logged-out visitor to a login form, which would break both.

The quiz-state rule is `/quiz-results`-specific. An allowed free Brand belongs on
that page only once the quiz is done, because until then `brandFreeHome()` is
`/quiz` and the results page has nothing to show them — so a mid-funnel free
Brand is sent to `/quiz` even though its role is on the allowlist.
`/all-starters` deliberately has no such rule: both Brand tiers stay regardless
of quiz state.

`/quiz-results` is itself the done free Brand's role home, and it is on its own
allowlist, so that case resolves to "stay" rather than to a redirect at itself.
More generally, no role home is bounced by its own role's rule, so the role
bounce cannot loop — `v3/route-guard.test.js` asserts both the general rule and
that specific case, plus that every bounce target is a one-hop terminus under
both tables.

One known two-hop path is deliberate: the member-home bounce still honours a
`?next=` to any page outside `PAGE_ROLES`, and `/quiz-results` is outside it, so
a Talent member arriving at `/login?next=/quiz-results` is handed to
`/quiz-results` and then bounced again to `/starter-dashboard`. That terminates
and is asserted as such. Teaching `bounceTargetFor` about the role-bounce table
would change member-bounce behaviour, which this release deliberately does not
touch.

## Per-page logged-out destinations

`LOGGED_OUT_DESTINATIONS` overrides the default `/login?next=<here>` for
specific guarded paths (decision by Jerico, 2026-08-03):

| Guarded page | Logged-out destination |
| --- | --- |
| `/build-profile/select-profile` | `/` |
| `/build-profile/full-profile` | `/` |
| `/build-profile/consult` | `/` |

Everything else keeps `/login?next=`, which is what makes a deep link survive a
login. These three are reached from marketing flows rather than from a member's
bookmark, so a login form would ask a stranger to authenticate into a funnel step
they have no account for yet; the homepage restarts the funnel properly. The
override replaces the whole destination, so no `?next=` is preserved for them.

The guard's Brand paid allowance is role-level only. On both
`/opportunities/<slug>` and the legacy
`/opportunities-details---brand-view?opp=<id>` entry point,
`opportunities-3.0.js` probes the owner-scoped applicant list. A `403` or `404`
redirects a foreign brand to `/opportunities-brands-view`; transient, server, and
network errors do not redirect. Xano remains responsible for ownership enforcement.

**Intentionally not guarded:** `/quiz`, `/quiz-results`, and `/all-starters`.
None of them may force a login, because all three serve pre-signup visitors.
`/quiz-results` and `/all-starters` carry their logged-in role rules in
`ROLE_BOUNCE_PAGES` instead (see that section above); `/quiz` is in no table at
all. Its `quiz-main/quiz-redirect.js` page controller sends an active live or
Test paid Brand to `/brand-dashboard`, an active Talent member to
`/starter-dashboard`, and a completed active production free Brand to
`/quiz-results`. `?retake=true` is the intentional escape hatch for the two Brand
redirects but not for the Talent one, which has no quiz to retake; unknown and
inactive plans are unaffected. On entry, `quiz-main.js` combines the logged-in
member's saved quiz answers with any homepage-bucket selections.
Logged-out handling on `/quiz-results` stays entirely with `quiz-results.js`:
when no test, pending, or saved quiz data exists, it redirects to
`/quiz` only after Memberstack positively reports that the visitor is logged
out. It stays put if Memberstack is unavailable or errors, and pending
pre-signup quizzes and test-mode previews never reach this branch. `/all-starters`
is excluded from `PAGE_ROLES` permanently (decision 2026-08-03): its content
gating is Memberstack `data-ms-content` on the page plus list/render-level
limiting for free Brands, and the Talent role bounce is the only route-level rule
it gets.

## Webflow install

1. Load `v3/route-guard.js` once sitewide in Site Settings Head Code, before
   `v3/auth-route.js` and `opportunities-3.0.js`. This includes opportunity
   pages: opp30 detects the guard through `html[data-route-guard]` and defers
   its access decisions to it.
2. Do not install it on V2.
3. Give guarded pages an error block keyed by `html[data-route-guard-error]`
   (same visible pattern as `/auth-route`). Optionally pre-hide protected
   content until `html[data-route-guard="allowed"]` to avoid a cross-role flash.
   The pre-hide CSS remains recommended but was deliberately deferred on
   2026-08-03; the staging install runs without it.
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
- `/generate-invoice` (including its trailing-slash URL)
- `/opportunities` merged-feed page (including its trailing-slash URL)
- `/opportunities/<slug>` collection-template pages
- `/`, `/login`, `/starter-login`, `/sign-up` — not guarded, but the sitewide
  install is what lets the member-home bounce run there
- `/quiz-results`, `/all-starters` (both including their trailing-slash URLs) —
  not guarded either, but the sitewide install is what lets the role bounce run
  there

With the guard sitewide, opp30 does not double-guard opportunity pages: it uses
the guard's presence to defer access redirects and validates the same plan-ID
role only before starting role-specific rendering or requests.

`/quiz`, `/quiz-results`, and `/all-starters` are deliberately outside
`PAGE_ROLES` (see the note above the guarded-pages table). `/all-starters` stays
out for good and is content-gated on the page instead; both quiz pages keep their
page-controller redirects, and `/quiz-results` and `/all-starters` additionally
get the role bounce, which is why the sitewide install matters on them.

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

## Release markers

Standing convention (Jerico, 2026-08-03), applied to every browser-facing script
touched by a release:

- The file header comment carries a ` * @release vX.Y.Z` line naming the tag that
  shipped the change.
- Where the script exports a window API object, the same value appears as a
  `release` property on it.
- The two must stay in sync. Each touched script's test file parses the header
  marker out of the source and compares it against the exported property, so an
  edit that updates one and forgets the other fails the suite.

Verify what is actually deployed either way:

```sh
curl -fsS "https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/route-guard.js" \
  | grep '@release'
```

```js
window.StartersV3RouteGuard.release // -> 'v1.59.77'
window.StartersV3AuthRouter.release
window.StartersBuildProfileRedirect.release
window.StartersCompleteProfileRedirect.release
```

The marker states the tag that shipped the file's current contents, not the tag
the browser happened to load it from — a `@latest` URL resolves to the newest
tag, so the two agree unless a cached copy is being served. A mismatch between
the console property and the tag you expect is the fastest signal that a stale
CDN copy is still in play; purge it with `purge.jsdelivr.net`.

## Diagnostics

- `window.StartersV3RouteGuard` exposes `release`, `activePlanIds`, `memberRole`,
  `memberRoleError`, `roleResolution`, `roleHome`, `hasCompletedQuiz`,
  `brandFreeHome`, `pageRolesFor`, `isGuardedPath`, and `redirectTargetFor` for
  console checks, plus `waitForSharedOpportunitiesAccess` for the merged-feed
  hydration decision, `isMemberBouncePage`, `bounceTargetFor`, `localPath`,
  and `loggedOutDestinationFor` for the bounce and logged-out-override
  decisions, and `isRoleBouncePage`, `roleBounceRolesFor`, and
  `roleBounceTargetFor` for the role-bounce decision.
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

- Run `node --test v3/route-guard.test.js`, and `v3/auth-route.test.js` with it:
  the guard/router parity sweep lives there and is what catches a new
  `PAGE_ROLES` row whose `ROLE_DESTINATIONS` twin was forgotten. Add
  `quiz-main/quiz-redirect.test.js` when the `/quiz` controller moves with the
  guard, since the two split the quiz funnel's rules between them.
- Confirm `/dashboard` has no role page body and hides its neutral content while
  `data-route-guard="checking"`.
- Verify the bounce on all four pages (`/`, `/login`, `/starter-login`,
  `/sign-up`) signed in as Talent, paid Brand, and both Free Brand quiz states,
  and confirm each one still renders untouched when signed out.
- Verify `/login?next=/messages` bounces a signed-in Talent member to
  `/messages`, and that `/starter-login?next=/brand-dashboard` sends that same
  member to `/starter-dashboard` instead.
- Verify a signed-out visit to each build-profile page lands on `/` rather than
  on a login form.
- Verify the role bounce on `/quiz-results` and `/all-starters`: signed out, both
  pages must render exactly as before with no `<html>` attribute at all — this is
  what keeps a pre-signup quiz working. Signed in, Talent must leave both pages
  for `/starter-dashboard`; a paid Brand must stay on `/all-starters` and leave
  `/quiz-results`; a free Brand must stay on `/all-starters` in either quiz state,
  and on `/quiz-results` only once the quiz is done (before that it goes to
  `/quiz`).
- Verify `/quiz` signed in as Talent, with and without `?retake=true`: both must
  land on `/starter-dashboard`, unlike the Brand redirects which `?retake=`
  suppresses.
- Verify a signed-out visit to `/complete-profile` lands on `/login` from
  Memberstack alone, with no guard attribute on `<html>`, and that a signed-in
  paid Brand is left on the page.
- Confirm each guarded page has a visible error state.
- Back up page-level code before installing.
- Verify `/dashboard`, `/starter-dashboard`, and `/brand-dashboard` for Talent,
  paid Brand, Test Brand, both Free Brand quiz states, logged-out, unmapped, and
  deliberately conflicted fixtures.
- Run the full cross-role staging matrix behind the Webflow password.
- Do not publish custom domains until the separate production go signal.
