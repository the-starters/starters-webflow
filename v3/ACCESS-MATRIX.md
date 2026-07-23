# V3 Member Access Matrix

Status: Planned behavior, implementation tracked per enforcement layer

Product source: Google Sheet `Site Gating` and `Redirects based on user level`
tabs, reviewed 2026-07-23.

This file is the versioned implementation map for V3. The product sheet describes
the intended experience; this document translates its account labels into stable
application roles and identifies which layer must enforce each rule.

## Memberstack role mapping

| Stable Memberstack plan ID | Application role | Product-sheet label |
| --- | --- | --- |
| `pln_free-plan-f6kn0dxz` | `brand-free` | Logged In - Free / Free Brand |
| `pln_new-paid-plan-463h04ph` | `brand-paid` | Logged In - Paid / Premium Brand |
| `pln_dorxata-test-brand-plan-777r02pa` | `brand-paid` | Test Brand / Premium Brand test equivalent |
| `pln_dorxata-test-free-plan-dvcg0k8o` | `talent` | Freelancer / Starter |

Use stable plan IDs for access decisions. Display names are descriptive only.
Unknown active plan IDs fail closed as unmapped configuration.

## Route-level access

`auth-route.js` uses this table only when restoring a same-origin `next`
destination after login. A disallowed destination falls back to the role default.

| Route | Brand free | Brand paid | Talent | Router behavior |
| --- | --- | --- | --- | --- |
| `/quiz-results` | Allow | Default `/brand-dashboard` | Default `/starter-dashboard` | Free Brand default |
| `/all-starters` | Allow, limited/blurred content | Allow, full content | Default `/starter-dashboard` | Both Brand tiers may return |
| `/brand-dashboard` | Default `/quiz-results` | Allow | Default `/starter-dashboard` | Paid Brand only |
| `/messages` | Default `/quiz-results` | Allow | Allow | Free Brand is not allowed |
| `/opportunities-brands-view` | Default `/quiz-results` | Allow | Default `/starter-dashboard` | Paid Brand only |
| `/opportunities-freelancer-view` | Default `/quiz-results` | Default `/brand-dashboard` | Allow | Talent only |
| `/opportunities/<slug>` | Default `/quiz-results` | Allow | Allow | Free Brand is not allowed |
| `/opportunities---create` | Default `/quiz-results` | Allow | Default `/starter-dashboard` | Paid Brand only |
| `/starter-dashboard` | Default `/quiz-results` | Default `/brand-dashboard` | Allow | Talent only |
| `/starter-edit-profile` | Default `/quiz-results` | Default `/brand-dashboard` | Allow | Talent only |
| `/build-profile/select-profile` | Default `/quiz-results` | Default `/brand-dashboard` | Allow | Talent onboarding |
| `/build-profile/full-profile` | Default `/quiz-results` | Default `/brand-dashboard` | Allow | Talent onboarding |
| `/build-profile/consult` | Default `/quiz-results` | Default `/brand-dashboard` | Allow | Talent onboarding |

## Enforcement layers

The route allowlist is not the security boundary by itself. Each concern has a
separate owner:

| Concern | Enforcement owner | Status |
| --- | --- | --- |
| Post-login destination and cross-role redirects | `v3/auth-route.js` | Implemented for the routes above |
| Direct protected-page access (deep links, typed URLs) | `v3/route-guard.js` | Implemented; install per [ROUTE-GUARD-WIRING.md](ROUTE-GUARD-WIRING.md); staging matrix pending |
| Page visibility and navigation variants | Webflow + Memberstack gated groups | Verify against the product sheet |
| Free Brand blurred/limited All Starters results | Page/list rendering and data response | Not enforced by the router |
| Learn previews, trailers, and membership prompts | Learn page/content gating | Planned separately |
| Mutations and private records | Xano authorization using authenticated member and role | Must be enforced server-side |
| Paid-then-cancelled behavior | Memberstack subscription lifecycle + application role resolution | Decision required |

## Open decisions

- Define the exact role/state for a paid Brand whose subscription is cancelled;
  do not infer it from a display name.
- Confirm whether the sheet's logged-out redirects to `/` should become
  `/login?next=...` on every protected page or remain page-specific.
- Verify Webflow Memberstack gated groups and Xano authorization independently;
  a `Backlog` row in the product sheet is desired behavior, not proof that it is
  live.
