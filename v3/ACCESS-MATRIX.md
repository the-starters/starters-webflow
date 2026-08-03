# V3 Member Access Matrix

Status: Planned behavior, implementation tracked per enforcement layer

Product source: Google Sheet `Site Gating` and `Redirects based on user level`
tabs, reviewed 2026-07-24.

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
is authorized under that known role even when other active plan IDs are
unmapped. Brand Free plus paid Brand is a valid same-family upgrade state and
resolves to paid Brand. Talent plus either Brand role is a cross-family conflict
and fails closed with `conflicting-plan-roles`. `route-guard.js` owns this
resolution contract; `auth-route.js` consumes its exported API so login routing,
the canonical dashboard router, and direct-page guarding cannot drift.

## Route-level access

`auth-route.js` uses this table only when restoring a same-origin `next`
destination after login. A disallowed destination falls back to the role
default. `route-guard.js` enforces direct access for every route below except
`/quiz`, `/quiz-results`, `/all-starters`, and the four member-home bounce pages
(`/`, `/login`, `/starter-login`, `/sign-up`), which remain outside the sitewide
guard's page table. The bounce pages are a separate, weaker mechanism — they
redirect an identified member away but never force a login, so a signed-out
visitor cannot tell the guard is installed (see the member-home bounce note
below). The quiz entry is a funnel page; the results-page controller handles its
logged-out, no-results case without disrupting pre-signup quiz data; and
`/all-starters` stays outside the guard permanently (decision by Jerico
2026-08-03) because its gating is not route-level: Memberstack gated content
(`data-ms-content`) on the page plus list/render-level limiting for free Brands.

| Route | Brand free | Brand paid | Talent | Router behavior |
| --- | --- | --- | --- | --- |
| `/` (homepage) | Default quiz home | `/brand-dashboard` | `/starter-dashboard` | Member-home bounce; logged-out visitors untouched |
| `/login` | Default quiz home | `/brand-dashboard` | `/starter-dashboard` | Member-home bounce, honouring a valid `?next=`; logged-out visitors untouched |
| `/starter-login` | Default quiz home | `/brand-dashboard` | `/starter-dashboard` | Member-home bounce, honouring a valid `?next=`; logged-out visitors untouched |
| `/sign-up` | Default quiz home | `/brand-dashboard` | `/starter-dashboard` | Member-home bounce; logged-out visitors untouched |
| `/dashboard` | Default quiz home | `/brand-dashboard` | `/starter-dashboard` | Canonical authenticated entry only; no dashboard page body lives here |
| `/quiz` | Allow | Default `/brand-dashboard` | Default `/starter-dashboard` | Free Brand default until quiz completion |
| `/quiz-results` | Allow | Default `/brand-dashboard` | Default `/starter-dashboard` | Free Brand default after quiz completion |
| `/all-starters` | Allow, limited/blurred content | Allow, full content | Default `/starter-dashboard` | Both Brand tiers may return |
| `/favorites` and `/favorites/` | Default quiz home | Allow | Default `/starter-dashboard` | Saved Starters list; paid Brand only, matching Xano #1506's plan 4/5 precondition; both slash forms are allowed paid-Brand `next` destinations so a deep link survives login |
| `/brand-dashboard` | Default quiz home | Allow | Default `/starter-dashboard` | Paid Brand only |
| `/messages` | Default quiz home | Allow | Allow | Free Brand is not allowed |
| `/opportunities` and `/opportunities/` | Default quiz home | Allow | Allow | Merged feed; both URL forms are guarded |
| `/opportunities-brands-view` | Default quiz home | Allow | Default `/starter-dashboard` | Paid Brand only |
| `/opportunities-freelancer-view` | Default quiz home | Default `/brand-dashboard` | Allow | Talent only |
| `/opportunities/<slug>` | Default quiz home | Allow | Allow | Free Brand is not allowed |
| `/opportunities---create` | Default quiz home | Allow | Default `/starter-dashboard` | Paid Brand only |
| `/starter-dashboard` | Default quiz home | Default `/brand-dashboard` | Allow | Talent only |
| `/starter-edit-profile` | Default quiz home | Default `/brand-dashboard` | Allow | Talent only |
| `/generate-invoice` and `/generate-invoice/` | Default quiz home | Default `/brand-dashboard` | Allow | Talent only; both slash forms are guarded and are allowed Talent `next` destinations |
| `/complete-profile` and `/complete-profile/` | Default quiz home | Allow | Default `/starter-dashboard` | Paid Brand only; a logged-out visitor goes to `/`, not to `/login?next=` |
| `/build-profile/select-profile` | Default quiz home | Default `/brand-dashboard` | Allow, subject to the funnel check below | Talent onboarding; logged out → `/` |
| `/build-profile/full-profile` | Default quiz home | Default `/brand-dashboard` | Allow, subject to the funnel check below | Talent onboarding; logged out → `/` |
| `/build-profile/consult` | Default quiz home | Default `/brand-dashboard` | Allow, subject to the funnel check below | Talent onboarding; logged out → `/` |
| `/starter-onboarding` | Default quiz home | Default `/brand-dashboard` | Allow | Talent onboarding form; onboarding-done redirect handled by `v3/onboarding-done-redirect.js` (page-scoped), not this guard |

> **Logged-out Quiz Results (updated 2026-07-24):** `/quiz-results` remains
> outside `route-guard.js`, but `quiz-results.js` redirects a positively
> resolved visitor to the quiz when there is no test payload, pending quiz in
> `sessionStorage`, or saved Memberstack quiz to display. A logged-out visitor
> goes to `/quiz`; an authenticated member whose `starter-quiz` completion
> marker outlived missing or malformed member JSON is sent to
> `/quiz?retake=true&quizDataMissing=1` so they retake instead of landing on an
> empty page, while an authenticated member with no completion marker starts
> `/quiz` normally. It redirects only after Memberstack positively reports
> member state; if Memberstack is unavailable or errors, the visitor stays on
> the page. Pre-signup visitors with a pending quiz and test-mode previews are
> unaffected.

> **Quiz entry controller (updated 2026-07-25):** `/quiz` remains outside
> `route-guard.js`, but `quiz-main/quiz-redirect.js` redirects an active
> paid Brand—including the Test Brand plan—to `/brand-dashboard` and a
> completed active production free Brand to `/quiz-results`. `?retake=true`
> (also `1` or `yes`) bypasses this page-level redirect. Once on `/quiz`, a
> logged-in member's saved `starterQuiz` answers are combined with any
> homepage-bucket selections. Unknown, Talent, inactive, and incomplete
> free-plan members are deliberately unaffected.

> **Free Brand default (updated 2026-07-23):** "Default quiz home" in the
> Brand-free column is conditional — a Brand-free member goes to `/quiz`
> until they complete the quiz, then `/quiz-results`. Completion is the Memberstack
> `starter-quiz` custom field (the same signal the `/quiz-results` page reads);
> a missing, empty, or whitespace-only value is not complete.
> `route-guard.js` owns this via the exported `brandFreeHome(member)` /
> `hasCompletedQuiz(member)` contract. `auth-route.js` reuses that contract.

> **Member-home bounce (added 2026-08-03):** The homepage, both login pages, and
> `/sign-up` are NOT guarded pages — they stay exactly as authored for anyone who
> is not signed in, because they are the pre-signup funnel itself. What
> `route-guard.js` adds there is a one-way bounce for a member it can positively
> identify and map to a role: that member is sent to a validated `?next=` if one
> is present, else to the role home. A `?next=` survives only when it is
> same-origin and either allowed for the member's role or on a page the guard does
> not police at all; a `next` pointing back at one of these four pages is refused,
> and `/dashboard` resolves to the role home rather than being handed back. Every
> inconclusive case leaves the page untouched with no error attribute and no
> redirect: logged out, Memberstack missing or slow, unmapped plan, or a
> cross-role conflict (that last one is a console message only, because a public
> page is the wrong place to surface a plan-configuration problem). No role home
> is itself one of these four pages, so the bounce cannot loop.

> **Logged-out destination overrides (added 2026-08-03):** Guarded pages normally
> send a logged-out visitor to `/login?next=<here>` so a deep link survives the
> login. The build-profile funnel and `/complete-profile` override that to `/`
> (Jerico's decision, 2026-08-03): they are reached from marketing flows rather
> than from a member's bookmark, so a stranger on a login form is being asked to
> authenticate into a funnel step they have no account for yet. The homepage
> restarts the funnel properly instead. Every other guarded page keeps the login
> round trip.

> **Talent build-profile funnel check (added 2026-08-03):** On the three
> `/build-profile/*` pages, `v3/build-profile-redirect.js` asks Xano where the
> signed-in Talent member actually is in the funnel, using the same
> `get_freelancers` read `auth-route.js` performs at login. No freelancer record
> means the member stays — that is who the page is for. A record with
> `onboarding_done` not `true` goes to `/starter-onboarding`; a finished record
> goes to `/starter-dashboard`. It is Talent-only and fails open on every other
> outcome, so it never contradicts the route guard's own decision, and it runs
> after the guard has already handled Brand, unmapped, and logged-out visitors.

> **Merged-feed plan hydration (updated 2026-07-28):** On `/opportunities` and
> `/opportunities/`, `route-guard.js` immediately allows a mapped Talent or
> paid-Brand snapshot. Before applying a denial, it gives Memberstack up to two
> seconds to replace a partial lower Brand Free or unmapped snapshot with an
> allowed role. Transient polling failures stay within that deadline; if no
> allowed snapshot resolves, the latest valid snapshot follows the normal
> fail-closed redirect or unmapped-plan error.

## Enforcement layers

The route allowlist is not the security boundary by itself. Each concern has a
separate owner:

| Concern | Enforcement owner | Status |
| --- | --- | --- |
| Stable plan-role resolution | `v3/route-guard.js` exported contract | Implemented; cross-family conflicts fail closed |
| Post-login destination and cross-role redirects | `v3/auth-route.js` consuming the shared contract | Implemented for the routes above |
| Canonical `/dashboard` role routing and direct protected-page access | `v3/route-guard.js` | Implemented locally; install per [ROUTE-GUARD-WIRING.md](ROUTE-GUARD-WIRING.md); staging matrix pending |
| Member-home bounce off the homepage, both login pages, and `/sign-up` | `v3/route-guard.js` `MEMBER_BOUNCE_PAGES` | Implemented 2026-08-03; sitewide install already covers it, staging pass pending |
| Per-page logged-out destinations for the build-profile funnel and `/complete-profile` | `v3/route-guard.js` `LOGGED_OUT_DESTINATIONS` | Implemented 2026-08-03; staging pass pending |
| Talent funnel position on `/build-profile/*` | `v3/build-profile-redirect.js` (page-scoped, Xano `get_freelancers`) | Implemented 2026-08-03; needs three page-level Webflow embeds, see [BUILD-PROFILE-REDIRECT-WIRING.md](BUILD-PROFILE-REDIRECT-WIRING.md) |
| Page visibility and navigation variants | Webflow + Memberstack gated groups | Verify against the product sheet |
| `/all-starters` access and free-Brand result limits | Memberstack `data-ms-content` gated content on the page plus list/render-level limiting | Settled 2026-08-03: permanently outside `route-guard.js`, never a route-level rule |
| Learn previews, trailers, and membership prompts | Learn page/content gating | Planned separately |
| `/starter-edit-profile` environment write mode | `profile-image-auth-shim.js` exact Live-host allowlist | Implemented; non-Live hosts block known mutations and preserve reads |
| `/admin/talent-applications` staff access and private application records | Xano `admin/session` and talent-admin endpoint authorization | Parked, preparation-only staging Code Component; outside the member-plan route matrix; not production-ready and has not been imported into Webflow, published, tagged, or deployed |
| Mutations and private records | Xano authorization using authenticated member and role | Profile, Companies, and Portfolio mutations receive `user_v3` Bearer auth from `profile-image-auth-shim.js`; ownership must be enforced server-side |
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
- `/quiz` remains unlisted because it is the quiz funnel entry, and its member
  redirects are owned by the page controller documented above; `/quiz-results`
  likewise uses its page-controller behavior. (`/all-starters` was settled on
  2026-08-03 and is recorded in the route-level and enforcement-layer sections
  above.)
- Verify Webflow Memberstack gated groups and Xano authorization independently;
  a `Backlog` row in the product sheet is desired behavior, not proof that it is
  live.
