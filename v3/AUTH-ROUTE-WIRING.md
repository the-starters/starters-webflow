# V3 Auth Route Wiring

Status: Local implementation only; not published

## Webflow

1. Create a V3 utility page with slug `/auth-route`.
2. Give the page a visible loading state and an error block keyed by
   `html[data-auth-route-error]`.
3. Load `v3/auth-route.js` on both `/login` and `/auth-route`.
4. Do not install the script on V2.
5. The script changes V3 login/signup forms to `data-ms-redirect="/auth-route"`.

The router runs only on `the-starters-3-0.webflow.io`, `thestarters.com`, and
`www.thestarters.com`, and only at those two exact paths. Keep the shared
Memberstack plan redirects unchanged so V2 retains its existing behavior.

## Routing

| Active Memberstack plan | Role | Default |
| --- | --- | --- |
| `pln_dorxata-test-free-plan-dvcg0k8o` | Talent | `/starter-dashboard` |
| `pln_new-paid-plan-463h04ph` | Brand paid | `/brand-dashboard` |
| `pln_dorxata-test-brand-plan-777r02pa` | Test Brand / Brand paid | `/brand-dashboard` |
| `pln_free-plan-f6kn0dxz` | Brand free | `/quiz-results` |
| Unmapped or inactive | Unmapped | Remain on `/auth-route` with `data-auth-route-error="unmapped-plan"` |

When multiple active mapped plans exist, the precedence is Brand paid, Brand
free, then Talent.

An optional `?next=` destination survives login only when it is same-origin and
allowlisted for the authenticated role. This prevents an open redirect and prevents
Talent/Brand cross-role routing. Query strings are preserved and fragments are
removed. Invalid or disallowed destinations fall back to the role default.

| Role | Allowed `next` pathnames |
| --- | --- |
| Talent | `/starter-dashboard`, `/build-profile/full-profile`, `/starter-edit-profile`, `/messages` |
| Brand paid | `/brand-dashboard`, `/opportunities-brands-view`, `/messages` |
| Brand free | `/quiz-results`, `/messages` |

An unauthenticated visitor to `/auth-route` returns to `/login`, preserving a
valid `next` value. The value is held in session storage only until the routing
attempt is consumed.

## Error and diagnostic contract

The utility page remains visible and receives `html[data-auth-route-error]` when
routing cannot continue:

| Value | Meaning |
| --- | --- |
| `unmapped-plan` | The member has no active mapped plan |
| `memberstack-unavailable` | Memberstack did not become available within 10 seconds |
| `unexpected-error` | Member lookup or routing failed unexpectedly |

Each error also dispatches `starters:v3-auth-route-error` on `window` with
`detail.code`. For browser-console diagnostics, the script exposes
`window.StartersV3AuthRouter` with `activePlanIds`, `memberRole`, `localPath`,
and `destinationFor`.

## Release Gate

- Confirm `/auth-route` and its visible error state exist in Webflow.
- Back up page-level code before installing the script.
- Run `node --test v3/auth-route.test.js`.
- Run the full staging matrix behind the Webflow password.
- Do not publish custom domains until the separate production go signal.
