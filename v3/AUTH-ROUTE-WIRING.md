# V3 Auth Route Wiring

Status: Live. Verified on 2026-07-31 loading on `/login` from jsDelivr
`@latest`. The Talent onboarding funnel described below is the newest change and
still needs its own staging pass.

## Webflow

1. Create a V3 utility page with slug `/auth-route`.
2. Give the page a visible loading state and an error block keyed by
   `html[data-auth-route-error]`.
3. Load sitewide `v3/route-guard.js` before `v3/auth-route.js`. The auth router
   consumes the guard's exported stable plan-role contract and fails closed if
   that contract is unavailable.
4. Load `v3/auth-route.js` on `/login`, `/starter-login`, and `/auth-route`.
5. **New install required (2026-08-03):** `/starter-login` is a real V3 login page
   with its own `[data-ms-form="login"]` and had no `auth-route.js` embed, so
   logins from it skipped `/auth-route` entirely and fell through to the shared
   Memberstack plan redirect. Add the same page-level head embed `/login`
   already has, pinned to the same tag. This is a page-level embed and does not
   arrive with a new jsDelivr tag on its own.
6. Do not add the script to `/sign-up`. `v3/starters-ms-redirect.js` owns signup
   form redirects through its `starters-ms-redirect` markers and skips any form
   that already carries a non-empty `redirect` attribute; configuring `/sign-up`
   here would set that attribute first and silently disable the marker system.
7. Do not install either script on V2.
8. The auth script changes V3 login/signup forms to
   `data-ms-redirect="/auth-route"`. It also sets a plain
   `redirect="/auth-route"` attribute on the same forms, because Memberstack only
   picks up `data-ms-redirect` from a click listener, so an Enter-key submit
   would otherwise skip `/auth-route` entirely and use the server-side plan
   redirect.

The router runs only on `the-starters-3-0.webflow.io`, `thestarters.com`, and
`www.thestarters.com`, and only at those three exact paths — the two login pages,
where it rewrites form redirects and stores a `?next=`, and `/auth-route`, where
it actually routes. Keep the shared Memberstack plan redirects unchanged so V2
retains its existing behavior.

Both login pages are also member-home bounce pages in `v3/route-guard.js`: a
member who is *already* signed in is redirected away before they see the form.
The two mechanisms do not conflict — the guard acts on an existing session, this
router configures the form for a session about to be created — but note that a
bounce leaves the `next` this router just stored in session storage unconsumed.
That is harmless; it is re-validated against the role allowlist at `/auth-route`
on the next real login.

## Routing

| Active Memberstack plan | Role | Default |
| --- | --- | --- |
| `pln_dorxata-test-free-plan-dvcg0k8o` | Talent | `/starter-dashboard` |
| `pln_new-paid-plan-463h04ph` | Brand paid | `/brand-dashboard` |
| `pln_dorxata-test-brand-plan-777r02pa` | Test Brand / Brand paid | `/brand-dashboard` |
| `pln_free-plan-f6kn0dxz` | Brand free | `/quiz` (→ `/quiz-results` once the Memberstack `starter-quiz` custom field is non-empty) |
| Unmapped or inactive | Unmapped | Remain on `/auth-route` with `data-auth-route-error="unmapped-plan"` |

Brand Free plus paid Brand is a valid same-family upgrade state and resolves to
paid Brand. Talent plus either Brand role is a cross-family conflict and remains
on the utility page with `conflicting-plan-roles`.

## Talent onboarding funnel

The product flow is Apply, then Build profile (which creates the Xano
`freelancers_v3` row before the member has an account session), then Login, then
Onboarding, then Dashboard. `/auth-route` is the one page every Talent login
passes through, so the router asks Xano where in that flow the member actually
is and routes accordingly.

The check runs for the Talent role only. Brand paid, Brand free, unmapped, and
conflicted members never trigger a Xano request.

| Freelancer record state | Destination |
| --- | --- |
| No `freelancers_v3` row (empty or missing `freelancer` array) | `/build-profile/select-profile` |
| Row exists, `onboarding_done` is not `true` | `/starter-onboarding`, which wins over any `?next=` or stored destination |
| Row exists, `onboarding_done === true` | Normal routing: the validated `next`, else the role home |
| Any Xano failure, or the check exceeds its 4 second budget | Normal routing (fail open) |

The requested destination is consumed before the check runs, so a `next` that
loses to `/starter-onboarding` is dropped rather than replayed on the next
login. Only a literal `true` reads as done; a missing field or an unreadable
record counts as not done, which sends the member into onboarding rather than
past it.

Reads use the same trade-token flow as the sibling V3 modules: the Memberstack
JWT from `getMemberCookie()` is traded at `api:g1vmSLWh/auth/trade-token/v3` for
a Xano token, which authorizes
`api:KZf7nFnk/starters_onboarding/get_freelancers` as a bearer. The response
envelope is `{"freelancer": [ <record> ]}`.

The 4 second budget is one overall deadline for the trade plus the read, not a
per-request timeout, because the member is looking at a blank hop page while it
runs. On expiry the shared `AbortController` cancels the in-flight request and
routing continues as if the check had never happened. Every other failure path
behaves the same way: logged out of Memberstack, a rejected trade, an HTTP
error, a malformed envelope, or a browser without `fetch`.

This is funnel UX, not a security boundary. `/starter-onboarding` itself remains
guarded by `v3/route-guard.js`, and `v3/onboarding-done-redirect.js` still
bounces a finished member off that page.

An optional `?next=` destination survives login only when it is same-origin and
allowlisted for the authenticated role. This prevents an open redirect and prevents
Talent/Brand cross-role routing. Query strings are preserved and fragments are
removed. Invalid or disallowed destinations fall back to the role default.
`/dashboard` is a special canonical destination: every mapped role may request
it, but the auth router resolves it directly to that role's home instead of
returning to `/dashboard`, preventing a redirect loop.

| Role | Allowed `next` pathnames |
| --- | --- |
| Talent | `/dashboard` (resolved to home), `/starter-dashboard`, `/starter-onboarding`, `/build-profile/select-profile`, `/build-profile/full-profile`, `/build-profile/consult`, `/starter-edit-profile`, `/messages`, `/opportunities`, `/opportunities/`, `/opportunities-freelancer-view`, `/opportunities/<slug>`, `/generate-invoice`, `/generate-invoice/` |
| Brand paid | `/dashboard` (resolved to home), `/all-starters`, `/brand-dashboard`, `/opportunities`, `/opportunities/`, `/opportunities-brands-view`, `/messages`, `/opportunities/<slug>`, `/opportunities---create`, `/complete-profile`, `/complete-profile/` |
| Brand free | `/dashboard` (resolved to quiz home), `/all-starters`, `/quiz`, `/quiz-results` |

`/starter-onboarding` is allowlisted for Talent because `v3/route-guard.js`
sends a logged-out visitor there through `/login?next=/starter-onboarding`.
Without the entry that round trip silently dropped the destination and landed on
`/starter-dashboard`.

The allowlist is derived from [ACCESS-MATRIX.md](ACCESS-MATRIX.md). It governs
post-authentication routing only. Memberstack gated content and Xano endpoint
authorization remain separate enforcement layers.

An unauthenticated visitor to `/auth-route` returns to `/login`, preserving a
valid `next` value. The value is held in session storage only until the routing
attempt is consumed.

V3 logged-out guards construct the login URL from the current path and query:

```js
const next = window.location.pathname + window.location.search
const loginPath = '/login?next=' + encodeURIComponent(next)
```

The shared opportunity controller, opportunity-create page, and Messages
controller navigate to that URL. V2 guards keep their existing login and
onboarding behavior.

## Error and diagnostic contract

The utility page remains visible and receives `html[data-auth-route-error]` when
routing cannot continue:

| Value | Meaning |
| --- | --- |
| `unmapped-plan` | The member has no active mapped plan |
| `conflicting-plan-roles` | The member has active Talent and Brand roles |
| `role-contract-unavailable` | The sitewide route guard role contract is missing or loaded after the auth router |
| `memberstack-unavailable` | Memberstack did not become available within 10 seconds |
| `unexpected-error` | Member lookup or routing failed unexpectedly |

Each error also dispatches `starters:v3-auth-route-error` on `window` with
`detail.code`. For browser-console diagnostics, the script exposes
`window.StartersV3AuthRouter` with `activePlanIds`, `memberRole`,
`memberRoleError`, `roleHome`, `localPath`, `destinationFor`, `hasCompletedQuiz`,
and `brandFreeHome`, plus the funnel helpers `stagingHost`,
`diagnosticsEnabled`, `onboardingStateFrom`, `onboardingFunnelState`,
`onboardingPath`, `buildProfilePath`, and `checkBudgetMs`, the login-page scope
helpers `isLoginPath` and `loginPaths`, and `release` (the shipping tag; see the
release-marker convention in [ROUTE-GUARD-WIRING.md](ROUTE-GUARD-WIRING.md)).

The funnel never produces a `data-auth-route-error`; it fails open instead. It
narrates each decision to the console (which state was found, where routing
goes) only on staging: `*.webflow.io`, `localhost`, `127.0.0.1`,
`*.trycloudflare.com`, or with `window.STARTERS_DEBUG === true`. Production
stays silent apart from the configuration errors in the table above.

## Release Gate

- Confirm `/auth-route` and its visible error state exist in Webflow.
- Confirm sitewide `route-guard.js` loads before page-level `auth-route.js`.
- Confirm the new `/starter-login` embed is installed and pinned to the same tag
  as the `/login` embed, and that a login from `/starter-login` passes through
  `/auth-route` rather than the shared plan redirect.
- Confirm `/sign-up` still has NO `auth-route.js` embed, and that its signup
  modals still return to their `starters-ms-redirect` marker destinations.
- Back up page-level code before installing the script.
- Run `node --test v3/auth-route.test.js`.
- Verify login with `next=/dashboard` for Talent, paid Brand, Test Brand, and
  Brand Free in both incomplete-quiz and completed-quiz states.
- Verify the three Talent funnel states on staging with the console open:
  a member with no `freelancers_v3` row lands on `/build-profile/select-profile`,
  a member with `onboarding_done` false lands on `/starter-onboarding` even with
  `?next=/messages`, and a finished member still honors `?next=`.
- Confirm a Brand login logs no funnel lines and issues no request to
  `api:KZf7nFnk` in the network panel.
- Run the full staging matrix behind the Webflow password.
- Do not publish custom domains until the separate production go signal.
