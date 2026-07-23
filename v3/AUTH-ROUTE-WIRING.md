# V3 Auth Route Wiring

Status: Local implementation only; not published

## Webflow

1. Create a V3 utility page with slug `/auth-route`.
2. Give the page a visible loading state and an error block keyed by
   `html[data-auth-route-error]`.
3. Load `v3/auth-route.js` on both `/login` and `/auth-route`.
4. Do not install the script on V2.
5. The script changes V3 login/signup forms to `data-ms-redirect="/auth-route"`.

## Routing

| Role | Default |
| --- | --- |
| Talent | `/starter-dashboard` |
| Brand paid / Test Brand | `/brand-dashboard` |
| Brand free | `/quiz-results` |
| Unmapped | Remain on `/auth-route` and expose `data-auth-route-error="unmapped-plan"` |

An optional `?next=` destination survives login only when it is same-origin and
allowlisted for the authenticated role. This prevents an open redirect and prevents
Talent/Brand cross-role routing.

## Release Gate

- Confirm `/auth-route` and its visible error state exist in Webflow.
- Back up page-level code before installing the script.
- Run `node --test v3/auth-route.test.js`.
- Run the full staging matrix behind the Webflow password.
- Do not publish custom domains until the separate production go signal.
