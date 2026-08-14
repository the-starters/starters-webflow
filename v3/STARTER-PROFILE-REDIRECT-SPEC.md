# Starter Profile Redirect — Spec

Status: **Built** in git (tickets 01–05). Ticket 06 (staging paste) is
ready-for-human and is not this round.

Grill: 2026-08-14. Product decisions below are Jerico's. Mechanical defaults
are called out at the end so they can still be vetoed.

## Goal

A signed-in **Talent** member who reaches a platform page without going through
login must still be put in the right funnel step:

| Funnel position | Destination |
| --- | --- |
| Build-profile not done | `/build-profile/select-profile` |
| Build-profile done, onboarding not done | `/starter-onboarding` |
| Both done, anything ambiguous, any failure | Stay (page renders as authored) |

This closes the gap that `/brand-dashboard` already has (`brand-profile-redirect.js`)
and `/starter-dashboard` does not: login funnels Talent, but a bookmark, back
button, typed URL, or in-site link does not.

## Why this identification already exists

One live Xano read answers both questions. Same endpoint `auth-route.js` already
uses at login (tokenless probe returns 401 — auth is enforced):

```
GET api:KZf7nFnk/starters_onboarding/get_build_profile_status
→ {has_record, build_profile_done, onboarding_done, profile_type, platform_status}
```

No inputs. The member is derived from the bearer token traded from the
Memberstack JWT (`api:g1vmSLWh/auth/trade-token/v3`).

`build_profile_done` is stricter than "a `freelancers_v3` row exists": the row
must also have a non-empty `profile_type_30`, which Build-profile submit stamps.
That is why 282 of 955 legacy rows currently read as not-done. They are already
bounced to Build-profile at every login (since v1.59.46). This module does the
same on page entry.

`has_record` is **unread**. A row can exist for someone who never finished the
form; treating that as done is the bug the endpoint replaced.

## Decision table

Walked top to bottom. First match wins. `location.replace()` for every bounce
(Back must not loop).

| Situation | Action | Xano? |
| --- | --- | --- |
| Unapproved host, or path not in the net | Do nothing | No |
| Not Talent (Brand, unmapped, conflicted, missing role contract) | Stay | **No** |
| Logged out / Memberstack absent or slow | Stay | **No** |
| `build_profile_done === false` (literal) | `/build-profile/select-profile` | Yes |
| `build_profile_done === true` and `onboarding_done !== true` | `/starter-onboarding` | Yes |
| Both done | Stay | Yes |
| Trade failed, HTTP error, malformed / unknown body, timeout | Stay | attempted |

Exactly two shapes redirect. A string `"false"`, a `0`, a `null`, or a missing
key is not a redirect — it is unknown, and unknown stays.

This table is an exact replay of `auth-route.js`'s Talent branch, on page entry
instead of at login.

## Page net

Identical six pages as `brand-profile-redirect.js` (exact path + trailing-slash
twin; `/opportunities/<slug>` too):

| Path | Why |
| --- | --- |
| `/starter-dashboard` | Talent home — the page this exists to close |
| `/opportunities` (+ single-segment detail) | Shared feed Talent uses |
| `/all-starters` | Browse |
| `/messages` | Shared inbox |
| `/brand-dashboard` | Symmetric with the Brand twin (route-guard usually bounces Talent off first) |
| `/dashboard` | Thin router |

Out of scope: `/starter-onboarding` and `/build-profile/*` (outbound halves
already own those), `/opportunities-freelancer-view`, `/favorites`,
`/complete-profile`. Nested paths like `/opportunities/<slug>/apply` are out.

**Not in this round:** backfilling the Brand twin's missing embeds on
`/starter-dashboard` and `/dashboard`. Known gap, left documented, Brand-scoped.

## Role gate — load-bearing

Classify the member **before any Xano call**. Run the funnel read only for
`talent`.

A Brand has no `freelancers_v3` row. This endpoint answers
`build_profile_done: false` for that shape — the same envelope that earns the
Build-profile bounce. Without the role gate, a paid Brand on `/brand-dashboard`
is shipped to a Talent form.

Logged-out, unmapped, conflicted, and Brand: zero Xano, stay. Route-guard still
owns role routing and runs first / sitewide.

## Fail-open

This is funnel UX, never a security boundary. Memberstack gated content,
`route-guard.js`, and Xano endpoint authorization remain the enforced layers.

Every uncertain answer leaves the page as authored. Bias: a Talent left on a
thin dashboard can navigate to the funnel themselves; a finished Starter shoved
back onto a form they already completed has no way out.

## No sessionStorage marker

Unlike the Brand twin, onboarding completion is written to Xano **directly** by
`patch-onboarding-status.js` before that module redirects. There is no webhook
gap to bridge.

Failed-PATCH edge (decided): `patch-onboarding-status.js` still redirects to
`/starter-dashboard` (anti-stranding). This module then bounces them back to
`/starter-onboarding` to resubmit. Self-healing. If Xano is down, this read
fails open too — no loop.

Do not add a "just finished" marker. Do not retouch the shipped onboarding pair.

## Spinner / flash

Staging `/starter-dashboard` currently has **no** `[data-page-spinner]`
(verified 2026-08-14). An unfinished Talent will see a brief flash of the
dashboard before the redirect. **Accepted.**

The script must honor `[data-page-spinner]` whenever one exists: up before the
read, down on stay, left up on go (navigation is in flight).

**Revert path, no code change:** add that element in Designer, hidden by
default, covering the page, outside any `.w-form` wrapper. Same reveal as the
Brand twin: `display: block` plus the `hidden` attribute cleared on show,
`display: none` on hide. How much it covers is a styling question.

Accepted cost: a visitor whose Memberstack never loads sits under the spinner
for the full Memberstack wait (8s, matching the Brand twin) before it lowers.

## Pairing — how the loop stays closed

| Half | Page | Module | Direction |
| --- | --- | --- | --- |
| Login hop | `/auth-route` | `auth-route.js` Talent branch | unfinished → funnel |
| Inbound (this spec) | the six lock pages | `starter-profile-redirect.js` | unfinished → funnel |
| Outbound, Build-profile | `/build-profile/*` | `build-profile-redirect.js` (live @v1.59.84) | past that step → onboarding or dashboard |
| Outbound, onboarding | `/starter-onboarding` | `onboarding-done-redirect.js` + `patch-onboarding-status.js` (@v1.59.47) | finished → dashboard |

Every half reads the **same** signal (`get_build_profile_status`). Opposite
flag directions, both fail-open → no loop.

Do not install this module on `/starter-onboarding` or `/build-profile/*`.

## Non-goals

- Not a security boundary.
- No Xano writes. No Memberstack writes.
- No Brand-embed backfill.
- No new Xano endpoint.
- Route-guard stays untouched (zero-Xano preserved).
- Does not replace `auth-route.js`'s login hop; it covers the arrivals login
  never sees.

## Install (ticket 06 — Jerico pastes)

One deferred page-level tag per in-scope page, **after** sitewide
`route-guard.js`. `@latest` on staging, matching the Brand twin; pin at the
deferred prod publish. Wiring owns the checklist.

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/starter-profile-redirect.js"></script>
```

Pages: `/starter-dashboard`, `/opportunities` (CMS template covers detail
slugs), `/all-starters`, `/messages`, `/brand-dashboard`, `/dashboard`.

## Settled (grill 2026-08-14)

1. Wide net — identical six pages as the Brand twin, including `/brand-dashboard`.
2. Flash accepted; spinner is the revert path, no code change.
3. No marker — failed PATCH bounces back to onboarding.
4. Decision table mirrors auth-route exactly, including the 282 legacy rows.
5. `@latest` embeds, Jerico pastes in Designer.
6. No Brand-embed backfill this round.

## Role contract (locked)

Role comes from `window.StartersV3RouteGuard.memberRole`, not a twin `PLAN_ROLES`
table — the same borrow `auth-route.js`, `build-profile-redirect.js`, and
`complete-profile-redirect.js` make. Missing guard fails open. Install AFTER
route-guard.js.

Everything else (8s Memberstack wait, 8s request timeout, `location.replace`,
staging-only diagnostics, fail-open on DOM errors, duplicated plumbing rather
than a shared module) follows the Brand twin / auth-route patterns.
