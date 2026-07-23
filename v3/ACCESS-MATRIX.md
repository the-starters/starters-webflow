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
Unknown active plan IDs fail closed as unmapped configuration only when a
member has no active mapped plan. A member with at least one known active plan
is authorized under the highest known role even when other active plan IDs are
unmapped. This matches `auth-route.js`, keeping login routing and page guarding
consistent.

## Route-level access

`auth-route.js` uses this table only when restoring a same-origin `next`
destination after login. A disallowed destination falls back to the role
default. `route-guard.js` enforces direct access for every route below except
`/quiz`, `/quiz-results`, and `/all-starters`, which remain unguarded because
the quiz entry is a funnel page and the other two await confirmation that they
are authenticated-only rather than pre-signup funnel pages.

| Route | Brand free | Brand paid | Talent | Router behavior |
| --- | --- | --- | --- | --- |
| `/quiz` | Allow | Default `/brand-dashboard` | Default `/starter-dashboard` | Free Brand default until quiz completion |
| `/quiz-results` | Allow | Default `/brand-dashboard` | Default `/starter-dashboard` | Free Brand default after quiz completion |
| `/all-starters` | Allow, limited/blurred content | Allow, full content | Default `/starter-dashboard` | Both Brand tiers may return |
| `/brand-dashboard` | Default quiz home | Allow | Default `/starter-dashboard` | Paid Brand only |
| `/messages` | Default quiz home | Allow | Allow | Free Brand is not allowed |
| `/opportunities-brands-view` | Default quiz home | Allow | Default `/starter-dashboard` | Paid Brand only |
| `/opportunities-freelancer-view` | Default quiz home | Default `/brand-dashboard` | Allow | Talent only |
| `/opportunities/<slug>` | Default quiz home | Allow | Allow | Free Brand is not allowed |
| `/opportunities---create` | Default quiz home | Allow | Default `/starter-dashboard` | Paid Brand only |
| `/starter-dashboard` | Default quiz home | Default `/brand-dashboard` | Allow | Talent only |
| `/starter-edit-profile` | Default quiz home | Default `/brand-dashboard` | Allow | Talent only |
| `/build-profile/select-profile` | Default quiz home | Default `/brand-dashboard` | Allow | Talent onboarding |
| `/build-profile/full-profile` | Default quiz home | Default `/brand-dashboard` | Allow | Talent onboarding |
| `/build-profile/consult` | Default quiz home | Default `/brand-dashboard` | Allow | Talent onboarding |

> **Free Brand default (updated 2026-07-23):** "Default quiz home" in the
> Brand-free column is conditional — a Brand-free member goes to `/quiz`
> until they complete the quiz, then `/quiz-results`. Completion is the Memberstack
> `starter-quiz` custom field (the same signal the `/quiz-results` page reads);
> a missing, empty, or whitespace-only value is not complete.
> `auth-route.js`, `route-guard.js`, and `opportunities-3.0.js` all apply this via
> a shared `brandFreeHome(member)` / `hasCompletedQuiz(member)` helper.

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

`Allow` on `/opportunities/<slug>` is the route guard's role-level decision, not
brand ownership authorization. After a paid brand enters either that route or the
legacy `/opportunities-details---brand-view?opp=<id>` route, `opportunities-3.0.js`
uses the owner-scoped applicant-list probe. A `403` or `404` redirects the brand to
`/opportunities-brands-view`. Other failures do not redirect: the slug route leaves
owner-only UI hidden, while the legacy route surfaces the error as before. Xano
enforces the underlying ownership boundary.

## Open decisions

- Define the exact role/state for a paid Brand whose subscription is cancelled;
  do not infer it from a display name.
- Confirm whether `/quiz-results` and `/all-starters` are authenticated-only.
  Until then, the route guard leaves both unlisted and does not force logged-out
  visitors to `/login`. `/quiz` also remains unlisted because it is the quiz
  funnel entry.
- Verify Webflow Memberstack gated groups and Xano authorization independently;
  a `Backlog` row in the product sheet is desired behavior, not proof that it is
  live.
