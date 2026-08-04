# V3 Build-Profile Redirect Wiring

Status: Implemented locally 2026-08-03, migrated to the
`get_build_profile_status` endpoint 2026-08-04, not yet installed. Needs three
page-level Webflow embeds; it does not arrive with a jsDelivr tag on its own.

`v3/build-profile-redirect.js` keeps a Talent member who is past the
Build-profile step from re-entering it. The product flow is Apply → Build profile
→ Login → Onboarding → Dashboard, and this module asks Xano where in that flow
the member actually is — the same `get_build_profile_status` read
`v3/auth-route.js` performs at login, but on page entry rather than once per
session.

That distinction is the whole reason it exists. The login-time check cannot help
a member who arrives here later from a bookmark, the back button, a stale email
link, or a marketing CTA.

## The funnel-status endpoint

```
GET api:KZf7nFnk/starters_onboarding/get_build_profile_status
Authorization: Bearer <token from the trade-token flow>
```

No inputs. The member is derived from the bearer token, and the endpoint answers
401 without a valid one. Same API group and auth table (`user_v3`) as
`get_freelancers`.

```json
{
  "has_record": true,
  "build_profile_done": true,
  "onboarding_done": false,
  "profile_type": "Full",
  "platform_status": "…"
}
```

`build_profile_done` is true only when a `freelancers_v3` row exists **and** its
`profile_type_30` column is non-empty. That column is stamped by
`build_profile/starter/update` when the form is submitted, so it is the first
signal that means "the member actually finished this step".

**Why it replaced the old read (2026-08-04).** This module used to read
`get_freelancers` and treat "a row came back" as "past Build profile". The row is
created before the member finishes the form, so that test was wrong for anyone
who started and abandoned it: **282 of 955 `freelancers_v3` rows carry an empty
`profile_type_30`**, and all 282 of those members were being pushed out of a
funnel step they had not completed. They now correctly stay here to finish it.

Two more facts from the same full-table pass, both worth knowing before QA:
`onboarding_done` is true on **zero** rows today, so the `/starter-dashboard`
branch below is currently unexercised in production data, and `profile_type` has
only ever been `"Full"` so far. `has_record` is returned but deliberately unread
by this module — it is precisely the signal that caused the bug.

## What it does

Talent members only, on the three build-profile pages only:

| Funnel status | Action |
| --- | --- |
| `build_profile_done` false (whether or not `has_record`) | Stay — this page is exactly where the member belongs |
| `build_profile_done` true, `onboarding_done` not `true` | Replace with `/starter-onboarding` |
| `build_profile_done` true, `onboarding_done === true` | Replace with `/starter-dashboard` |
| Any failure, timeout, non-Talent role, or logged-out session | Stay |

The body is read strictly in both directions. Only a literal `false` on
`build_profile_done` means "still building"; anything else non-`true` (missing,
null, a string) is a body the module does not understand and reads as
inconclusive rather than as a state. Only a literal `true` on `onboarding_done`
counts as onboarded, so a missing or odd value biases toward onboarding rather
than past it. Same bias as `auth-route.js`.

On this page "still building" and "inconclusive" happen to share an outcome, but
they stay distinct internally because the login-time twin routes them apart.

The role comes from the sitewide `v3/route-guard.js` contract
(`window.StartersV3RouteGuard.memberRole`), never from a second copy of the plan
table. A Brand, unmapped, or conflicted member costs no Xano round trip at all,
because the guard is already redirecting them off these pages, and a logged-out
visitor is left to the guard's own `LOGGED_OUT_DESTINATIONS` rule (which sends
them to `/`, not to a login form). If the guard is missing or loaded after this
module, the role reads as null and the page renders untouched.

Reads use the trade-token flow the sibling V3 modules use: the Memberstack JWT
from `getMemberCookie()` is traded at `api:g1vmSLWh/auth/trade-token/v3` for a
Xano token, which authorizes the status endpoint as a bearer.

The 4 second budget is one overall deadline for the trade plus the read, not a
per-request timeout, and a shared `AbortController` releases the sockets on
expiry. Fail-open is unchanged by the endpoint migration and remains the rule
everywhere: logged out, Memberstack missing or slow, no role contract, a rejected
trade, a 401, a 500, an unparseable body, a body without a boolean
`build_profile_done`, a browser without `fetch`, or the budget expiring all leave
the page exactly as authored. Only two positive, unambiguous answers ever
redirect.

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
`stagingHost`, `isBuildProfilePath`, `diagnosticsEnabled`, `funnelStateFrom`,
`funnelState`, `funnelDestination`, `redirectPastBuildProfile`,
`buildProfilePaths`, `onboardingPath`, `dashboardPath`, and `checkBudgetMs`.

`funnelStateFrom` replaced `onboardingStateFrom` in v1.59.82: it takes a status
body rather than a freelancer envelope and answers `'build-profile'`,
`'onboarding'`, `'done'`, or `'unknown'`.

`funnelDestination()` is the read-and-decide half and is safe to call by hand on
staging: it returns the destination (or `null` to stay) without navigating.

Diagnostics narrate every decision on staging only — `*.webflow.io`, `localhost`,
`127.0.0.1`, `*.trycloudflare.com`, or `window.STARTERS_DEBUG === true`.
Production is completely silent, including on failure paths.

## Release gate

- Run `node --test v3/build-profile-redirect.test.js`, and the whole `v3/` suite
  with it.
- Confirm the sitewide route guard loads first on all three pages.
- On staging with the console open, verify all four Talent states: a member with
  no row stays, a member **with** a row whose `profile_type_30` is empty also
  stays (the 282-member case, and the reason for this migration), a member with
  `build_profile_done` true and `onboarding_done` false lands on
  `/starter-onboarding`, and a fully finished member lands on
  `/starter-dashboard`.
- The `/starter-dashboard` branch cannot be reached with today's data —
  `onboarding_done` is true on zero rows — so exercise it by calling
  `window.StartersBuildProfileRedirect.funnelStateFrom({build_profile_done: true,
  onboarding_done: true})` and confirming it answers `'done'`, or by flipping the
  column on a test row.
- Confirm the network panel shows `get_build_profile_status` and no
  `get_freelancers` request from these pages.
- Confirm a paid-Brand session logs no funnel lines and issues no request to
  `api:KZf7nFnk` from these pages — the route guard should redirect it first.
- Confirm a signed-out visit still lands on `/` (the guard's override), with no
  Xano request.
- Verify `window.StartersBuildProfileRedirect.release` matches the tag the embed
  is pinned to.
- Do not publish custom domains until the separate production go signal.
