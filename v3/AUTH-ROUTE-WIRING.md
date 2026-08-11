# V3 Auth Route Wiring

Status: Live. Verified on 2026-07-31 loading on `/login` from jsDelivr
`@latest`. The Talent funnel check described below moved to the
`get_build_profile_status` endpoint on 2026-08-04; that migration and the
`/starter-login` embed both still need a staging pass. The embeds are page-level
and pinned, so a new tag does not reach the site on its own — bump both embeds.

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

## Talent funnel position

The product flow is Apply, then Build profile, then Login, then Onboarding, then
Dashboard. `/auth-route` is the one page every Talent login passes through, so the
router asks Xano where in that flow the member actually is and routes accordingly.

The Talent check runs for the Talent role only. Brand free, unmapped, and
conflicted members never trigger a Xano request. **Paid Brands** take the separate
Brand profile funnel below (added 2026-08-06) — they are no longer zero-network.

### The funnel-status endpoint

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

**Why it replaced the old read (2026-08-04).** The router used to read
`get_freelancers` and treat "a row came back" as "past Build profile". The row is
created before the member finishes the form, so that test was wrong for anyone
who started and abandoned it: **282 of 955 `freelancers_v3` rows carry an empty
`profile_type_30`**, and all 282 of those members were being routed on to
`/starter-onboarding` instead of back to the step they had not completed.

Two more facts from the same full-table pass, both worth knowing before QA:
`onboarding_done` is true on **zero** rows today, so the third row of the table
below is currently unexercised in production data, and `profile_type` has only
ever been `"Full"` so far. `has_record` is returned but deliberately unread — it
is precisely the signal that caused the bug.

### Routing table

| Funnel status | Destination |
| --- | --- |
| `build_profile_done` false (whether or not `has_record`) | `/build-profile/select-profile` |
| `build_profile_done` true, `onboarding_done` not `true` | `/starter-onboarding`, which wins over any `?next=` or stored destination |
| `build_profile_done` true, `onboarding_done === true` | Normal routing: the validated `next`, else the role home |
| Any Xano failure, an unreadable body, or the check exceeding its 8 second budget | Normal routing (fail open) |

The requested destination is consumed before the check runs, so a `next` that
loses to the funnel is dropped rather than replayed on the next login.

The body is read strictly in both directions, and here the strictness matters
because the three answers route three different ways while only "inconclusive"
fails open. Only a literal `false` on `build_profile_done` earns the
`/build-profile/select-profile` redirect; anything else non-`true` (missing,
null, a string) is a body the router does not understand, so the standard
destination wins. Only a literal `true` on `onboarding_done` reads as onboarded,
so a missing or odd value biases toward sending the member into onboarding rather
than past it.

Reads use the same trade-token flow as the sibling V3 modules: the Memberstack
JWT from `getMemberCookie()` is traded at `api:g1vmSLWh/auth/trade-token/v3` for
a Xano token, which authorizes the status endpoint as a bearer.

The 8 second budget is one overall deadline for the trade plus the read, not a
per-request timeout, because the member is looking at a blank hop page while it
runs. On expiry the shared `AbortController` cancels the in-flight request and
routing continues as if the check had never happened. Fail-open is unchanged by
the endpoint migration, and every other failure path behaves the same way: logged
out of Memberstack, a rejected trade, a 401, a 500, an unparseable body, a body
without a boolean `build_profile_done`, or a browser without `fetch`.

This is funnel UX, not a security boundary. `/starter-onboarding` itself remains
guarded by `v3/route-guard.js`, and `v3/onboarding-done-redirect.js` still
bounces a finished member off that page.

## Brand profile funnel (paid Brand only, 2026-08-06)

Paid Brands get the same "where is this member" question at login, from the mirror
endpoint:

```
GET api:KZf7nFnk/starters_onboarding/get_brand_profile_status
→ {"has_record": bool, "brand_profile_done": bool}
```

Same no-input bearer shape, same single 8s budget, same fail-open rule.

| Brand profile status | Destination |
| --- | --- |
| `sessionStorage` marker `thestarters:v3-brand-profile-completed` set | Normal routing (no Xano call) |
| `has_record` true AND `brand_profile_done` false | `/complete-profile`, wins over any stored or query `next` |
| anything else (done, no record, error, timeout, malformed) | Normal routing |

Scope is `brand-paid` only. `brand-free` has no `/complete-profile` form.
Existing brands are grandfathered `brand_profile_done: true` in `brands_v3`, so
in practice only new signups are diverted. The marker is written by
`v3/brand-account-controller.js` after a successful submit and read here (and by
both redirect halves) so the Memberstack → Xano webhook catch-up window cannot
bounce a fresh completer. `/complete-profile` is deliberately **not** an allowed
`next` — the router constructs that destination, never accepts it from the client.

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
| Brand paid | `/dashboard` (resolved to home), `/all-starters`, `/brand-dashboard`, `/opportunities`, `/opportunities/`, `/opportunities-brands-view`, `/messages`, `/opportunities/<slug>`, `/opportunities---create` |
| Brand free | `/dashboard` (resolved to quiz home), `/all-starters`, `/quiz`, `/quiz-results` |

`/starter-onboarding` is allowlisted for Talent because `v3/route-guard.js`
sends a logged-out visitor there through `/login?next=/starter-onboarding`.
Without the entry that round trip silently dropped the destination and landed on
`/starter-dashboard`.

`/complete-profile` is deliberately not allowlisted (decision 2026-08-03).
Memberstack's `restrict-pages` gated group is the page's sole gate and redirects
to `/login` with no `?next=`, so there is no round trip for this router to close;
`v3/route-guard.js` does not list the page either. A paid Brand asking for it as a
`next` lands on `/brand-dashboard`.

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
`diagnosticsEnabled`, `funnelStateFrom`, `onboardingFunnelState`,
`onboardingPath`, `buildProfilePath`, and `checkBudgetMs`, the login-page scope
helpers `isLoginPath` and `loginPaths`, and `release` (the shipping tag; see the
release-marker convention in [ROUTE-GUARD-WIRING.md](ROUTE-GUARD-WIRING.md)).

`funnelStateFrom` replaced `onboardingStateFrom` in v1.59.82: it takes a status
body rather than a freelancer envelope and answers `'build-profile'`,
`'onboarding'`, `'done'`, or `'unknown'`.

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
- Verify the four Talent funnel states on staging with the console open: a member
  with no row lands on `/build-profile/select-profile`, a member **with** a row
  whose `profile_type_30` is empty also lands there (the 282-member case, and the
  reason for the 2026-08-04 migration), a member with `build_profile_done` true
  and `onboarding_done` false lands on `/starter-onboarding` even with
  `?next=/messages`, and a fully finished member still honors `?next=`.
- The fully-finished row cannot be reached with today's data —
  `onboarding_done` is true on zero rows — so exercise it by calling
  `window.StartersV3AuthRouter.funnelStateFrom({build_profile_done: true,
  onboarding_done: true})` and confirming it answers `'done'`, or by flipping the
  column on a test row.
- Confirm the network panel shows `get_build_profile_status` and no
  `get_freelancers` request from `/auth-route`.
- Confirm a paid Brand login reads `get_brand_profile_status`, while a Brand
  Free login logs no funnel lines and issues no request to `api:KZf7nFnk`.
- Run the full staging matrix behind the Webflow password.
- Do not publish custom domains until the separate production go signal.
