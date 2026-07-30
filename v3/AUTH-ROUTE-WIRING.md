# V3 Auth Route Wiring

Status: Local implementation only; not published

## Webflow

1. Create a V3 utility page with slug `/auth-route`.
2. Give the page a visible loading state and an error block keyed by
   `html[data-auth-route-error]`.
3. Load sitewide `v3/route-guard.js` before `v3/auth-route.js`. The auth router
   consumes the guard's exported stable plan-role contract and fails closed if
   that contract is unavailable.
4. Load `v3/auth-route.js` on both `/login` and `/auth-route`.
5. Do not install either script on V2.
6. The auth script changes V3 login/signup forms to
   `data-ms-redirect="/auth-route"`.

The router runs only on `the-starters-3-0.webflow.io`, `thestarters.com`, and
`www.thestarters.com`, and only at those two exact paths. Keep the shared
Memberstack plan redirects unchanged so V2 retains its existing behavior.

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

An optional `?next=` destination survives login only when it is same-origin and
allowlisted for the authenticated role. This prevents an open redirect and prevents
Talent/Brand cross-role routing. Query strings are preserved and fragments are
removed. Invalid or disallowed destinations fall back to the role default.
`/dashboard` is a special canonical destination: every mapped role may request
it, but the auth router resolves it directly to that role's home instead of
returning to `/dashboard`, preventing a redirect loop.

| Role | Allowed `next` pathnames |
| --- | --- |
| Talent | `/dashboard` (resolved to home), `/starter-dashboard`, `/build-profile/select-profile`, `/build-profile/full-profile`, `/build-profile/consult`, `/starter-edit-profile`, `/messages`, `/opportunities`, `/opportunities/`, `/opportunities-freelancer-view`, `/opportunities/<slug>` |
| Brand paid | `/dashboard` (resolved to home), `/all-starters`, `/brand-dashboard`, `/opportunities`, `/opportunities/`, `/opportunities-brands-view`, `/messages`, `/opportunities/<slug>`, `/opportunities---create` |
| Brand free | `/dashboard` (resolved to quiz home), `/all-starters`, `/quiz`, `/quiz-results` |

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
and `brandFreeHome`.

## Release Gate

- Confirm `/auth-route` and its visible error state exist in Webflow.
- Confirm sitewide `route-guard.js` loads before page-level `auth-route.js`.
- Back up page-level code before installing the script.
- Run `node --test v3/auth-route.test.js`.
- Verify login with `next=/dashboard` for Talent, paid Brand, Test Brand, and
  Brand Free in both incomplete-quiz and completed-quiz states.
- Run the full staging matrix behind the Webflow password.
- Do not publish custom domains until the separate production go signal.
