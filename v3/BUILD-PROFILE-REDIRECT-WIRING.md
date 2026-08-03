# V3 Build-Profile Redirect Wiring

Status: Implemented locally 2026-08-03, not yet installed. Needs three
page-level Webflow embeds; it does not arrive with a jsDelivr tag on its own.

`v3/build-profile-redirect.js` keeps a Talent member who is past the
Build-profile step from re-entering it. The product flow is Apply → Build profile
(creates the Xano `freelancers_v3` row) → Login → Onboarding → Dashboard, and this
module asks Xano where in that flow the member actually is — the same
`get_freelancers` read `v3/auth-route.js` performs at login, but on page entry
rather than once per session.

That distinction is the whole reason it exists. The login-time check cannot help
a member who arrives here later from a bookmark, the back button, a stale email
link, or a marketing CTA.

## What it does

Talent members only, on the three build-profile pages only:

| Freelancer record state | Action |
| --- | --- |
| No `freelancers_v3` row (empty or missing `freelancer` array) | Stay — this page is exactly where the member belongs |
| Row exists, `onboarding_done` is not `true` | Replace with `/starter-onboarding` |
| Row exists, `onboarding_done === true` | Replace with `/starter-dashboard` |
| Any failure, timeout, non-Talent role, or logged-out session | Stay |

Only a literal `true` counts as done; a missing field or an unreadable record
reads as not done, which sends the member into onboarding rather than past it.
Same bias as `auth-route.js`.

The role comes from the sitewide `v3/route-guard.js` contract
(`window.StartersV3RouteGuard.memberRole`), never from a second copy of the plan
table. A Brand, unmapped, or conflicted member costs no Xano round trip at all,
because the guard is already redirecting them off these pages, and a logged-out
visitor is left to the guard's own `LOGGED_OUT_DESTINATIONS` rule (which sends
them to `/`, not to a login form). If the guard is missing or loaded after this
module, the role reads as null and the page renders untouched.

Reads use the trade-token flow the sibling V3 modules use: the Memberstack JWT
from `getMemberCookie()` is traded at `api:g1vmSLWh/auth/trade-token/v3` for a
Xano token, which authorizes `api:KZf7nFnk/starters_onboarding/get_freelancers`
as a bearer. The envelope is `{"freelancer": [ <record> ]}`.

The 4 second budget is one overall deadline for the trade plus the read, not a
per-request timeout, and a shared `AbortController` releases the sockets on
expiry. Fail-open is the rule everywhere: logged out, Memberstack missing or slow,
no role contract, a rejected trade, an HTTP error, a malformed envelope, a browser
without `fetch`, or the budget expiring all leave the page exactly as authored.
Only two positive, unambiguous answers ever redirect.

This is funnel UX, never a security boundary. `v3/route-guard.js` still guards
these three pages as Talent-only, and Xano endpoint authorization remains the
enforced layer.

## Webflow install

1. Add a deferred page-level tag on each of the three pages, and nowhere else:
   - `/build-profile/select-profile`
   - `/build-profile/full-profile`
   - `/build-profile/consult`
2. Load it AFTER the sitewide `v3/route-guard.js`, which owns the role contract
   this module reads. The guard is already in project head code, so a page-level
   body or head embed on these three pages satisfies the order.
3. Pin each embed to the same tag, and to the same tag as the route-guard release
   it was shipped with.
4. Do not install it on `/starter-onboarding` or `/starter-dashboard` — they are
   this module's destinations, and the path scope refuses them anyway.

No page markup is required. The module has no spinner and no error state: it
either navigates away or leaves the page alone, so there is nothing to author.

## Diagnostics

`window.StartersBuildProfileRedirect` exposes `release`, `allowedHost`,
`stagingHost`, `isBuildProfilePath`, `diagnosticsEnabled`, `onboardingStateFrom`,
`funnelState`, `funnelDestination`, `redirectPastBuildProfile`,
`buildProfilePaths`, `onboardingPath`, `dashboardPath`, and `checkBudgetMs`.

`funnelDestination()` is the read-and-decide half and is safe to call by hand on
staging: it returns the destination (or `null` to stay) without navigating.

Diagnostics narrate every decision on staging only — `*.webflow.io`, `localhost`,
`127.0.0.1`, `*.trycloudflare.com`, or `window.STARTERS_DEBUG === true`.
Production is completely silent, including on failure paths.

## Release gate

- Run `node --test v3/build-profile-redirect.test.js`, and the whole `v3/` suite
  with it.
- Confirm the sitewide route guard loads first on all three pages.
- On staging with the console open, verify all three Talent states: a member with
  no `freelancers_v3` row stays on the page, a member with `onboarding_done`
  false lands on `/starter-onboarding`, and a finished member lands on
  `/starter-dashboard`.
- Confirm a paid-Brand session logs no funnel lines and issues no request to
  `api:KZf7nFnk` from these pages — the route guard should redirect it first.
- Confirm a signed-out visit still lands on `/` (the guard's override), with no
  Xano request.
- Verify `window.StartersBuildProfileRedirect.release` matches the tag the embed
  is pinned to.
- Do not publish custom domains until the separate production go signal.
