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
default. `route-guard.js` enforces direct access through three separate page
tables, and every route below belongs to exactly one of them:

- **`PAGE_ROLES`** — guarded pages. A logged-out visitor is sent to a login form
  (or to the page's `LOGGED_OUT_DESTINATIONS` override), and a wrong-role member
  to their own default.
- **`MEMBER_BOUNCE_PAGES`** — `/`, `/login`, `/starter-login`, `/sign-up`. An
  identified member is redirected away, but a signed-out visitor cannot tell the
  guard is installed. See the member-home bounce note below.
- **`ROLE_BOUNCE_PAGES`** — `/quiz-results`, `/all-starters`. Added 2026-08-03.
  A logged-in member whose role does not belong there goes to their role home;
  every other visitor, logged-out included, is left completely alone. See the
  role-bounce note below.

`/quiz` is in none of them: its page controller `quiz-main/quiz-redirect.js`
owns it outright, for the same reason `/quiz-results` and `/all-starters` are
role-bounce rather than guarded pages — all three serve pre-signup visitors, and
a guarded page forces a login. `/all-starters` in particular will never be a
guarded page (decision by Jerico 2026-08-03): its content gating is not
route-level but Memberstack gated content (`data-ms-content`) on the page plus
list/render-level limiting for free Brands, and the role bounce adds only the
one route-level rule that page needs.

| Route | Brand free | Brand paid | Talent | Router behavior |
| --- | --- | --- | --- | --- |
| `/` (homepage) | Default quiz home | `/brand-dashboard` | `/starter-dashboard` | Member-home bounce; logged-out visitors untouched |
| `/login` | Default quiz home | `/brand-dashboard` | `/starter-dashboard` | Member-home bounce, honouring a valid `?next=`; logged-out visitors untouched |
| `/starter-login` | Default quiz home | `/brand-dashboard` | `/starter-dashboard` | Member-home bounce, honouring a valid `?next=`; logged-out visitors untouched |
| `/sign-up` | Default quiz home | `/brand-dashboard` | `/starter-dashboard` | Member-home bounce; logged-out visitors untouched |
| `/dashboard` | Default quiz home | `/brand-dashboard` | `/starter-dashboard` | Canonical authenticated entry only; no dashboard page body lives here |
| `/quiz` | Allow | Default `/brand-dashboard` | Default `/starter-dashboard`, enforced | Free Brand default until quiz completion; page controller enforces all three columns, and the Talent bounce ignores `?retake=` |
| `/quiz-results` and `/quiz-results/` | Allow once the quiz is done, else `/quiz` | Default `/brand-dashboard` | Default `/starter-dashboard` | Free Brand default after quiz completion; `ROLE_BOUNCE_PAGES` enforces the logged-in columns, `quiz-results.js` still owns every logged-out case |
| `/all-starters` and `/all-starters/` | Allow, limited/blurred content | Allow, full content | Default `/starter-dashboard` | Both Brand tiers may return regardless of quiz state; `ROLE_BOUNCE_PAGES` enforces only the Talent bounce |
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
| `/complete-profile` and `/complete-profile/` | Untouched | Untouched | Untouched | Outside `route-guard.js` since 2026-08-03; the Memberstack `restrict-pages` gated group owns the page, see the note below |
| `/build-profile/select-profile` | Default quiz home | Default `/brand-dashboard` | Allow, subject to the funnel check below | Talent onboarding; logged out → `/` |
| `/build-profile/full-profile` | Default quiz home | Default `/brand-dashboard` | Allow, subject to the funnel check below | Talent onboarding; logged out → `/` |
| `/build-profile/consult` | Default quiz home | Default `/brand-dashboard` | Allow, subject to the funnel check below | Talent onboarding; logged out → `/` |
| `/starter-onboarding` | Default quiz home | Default `/brand-dashboard` | Allow | Talent onboarding form; onboarding-done redirect handled by `v3/onboarding-done-redirect.js` (page-scoped), not this guard |

> **Logged-out Quiz Results (updated 2026-08-03):** `/quiz-results` is a
> role-bounce page, never a guarded one, so the guard leaves every logged-out
> visitor there untouched and `quiz-results.js` keeps sole ownership of them.
> `quiz-results.js` redirects a positively
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

> **Quiz entry controller (updated 2026-08-03):** `/quiz` remains outside all
> three `route-guard.js` tables, but `quiz-main/quiz-redirect.js` redirects an
> active paid Brand—including the Test Brand plan—to `/brand-dashboard`, an
> active Talent member to `/starter-dashboard`, and a completed active
> production free Brand to `/quiz-results`. `?retake=true` (also `1` or `yes`)
> bypasses the two Brand redirects but deliberately **not** the Talent one
> (decision by Jerico 2026-08-03): the retake hatch exists so a Brand can re-run
> their own quiz, and Talent has no quiz to retake. Once on `/quiz`, a logged-in
> member's saved `starterQuiz` answers are combined with any homepage-bucket
> selections. Unknown, inactive, and incomplete free-plan members are
> deliberately unaffected. A member holding both Talent and paid Brand plans
> keeps the paid `/brand-dashboard` outcome, including its retake hatch; that
> state is the `conflicting-plan-roles` configuration error and this page does
> not try to resolve it.

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

> **Member-only role bounce (added 2026-08-03):** `/quiz-results` and
> `/all-starters` (both slash forms) are `ROLE_BOUNCE_PAGES`. They borrow the
> member-home bounce's silence contract exactly — a logged-out visitor, a missing
> or slow Memberstack, an unmapped plan, and a cross-role conflict all leave the
> page untouched, with no redirect, no error attribute, and no `checking` stamp —
> and apply the guarded pages' role test to whoever is left: a role-mapped member
> not on the page's allowlist goes to their own role home. Allowed roles are
> `brand-free` on `/quiz-results` and both Brand tiers on `/all-starters`, so
> Talent is the role bounced off both, and a free Brand is the role kept on both.
> `/quiz-results` carries one extra rule the other page does not: an allowed free
> Brand belongs there only once the quiz is done, because before that their role
> home is `/quiz` and there are no results to show. `/all-starters` has no
> quiz-state rule at all — both Brand tiers stay either way, which is what the
> `data-ms-content` gating on that page is for. `/quiz-results` is itself the
> done free Brand's role home and is on its own allowlist, so that resolves to
> "stay" rather than to a redirect at itself; `route-guard.test.js` asserts that
> case plus the general rule that no role home is bounced by its own role.

> **Logged-out destination overrides (added 2026-08-03):** Guarded pages normally
> send a logged-out visitor to `/login?next=<here>` so a deep link survives the
> login. The build-profile funnel overrides that to `/` (Jerico's decision,
> 2026-08-03): those pages are reached from marketing flows rather than from a
> member's bookmark, so a stranger on a login form is being asked to
> authenticate into a funnel step they have no account for yet. The homepage
> restarts the funnel properly instead. Every other guarded page keeps the login
> round trip.

> **`/complete-profile` is Memberstack's, not the guard's (decision 2026-08-03):**
> The `restrict-pages` gated content group carries a URL rule STARTS `complete-profile`
> that redirects to `login`, so Memberstack is the sole owner of this page's
> gating and `route-guard.js` deliberately does not list it in `PAGE_ROLES` or
> `LOGGED_OUT_DESTINATIONS`. Two owners would mean two logged-out destinations
> for the same URL, and the guard's would lose: Memberstack's `protectPages()`
> calls `window.location.replace('/login')` from cached group data before the
> guard has resolved a member. Because that redirect carries no `?next=`, the
> page is also absent from `auth-route.js`'s `ROLE_DESTINATIONS` — there is no
> round trip left to close. A member dumped on `/login` this way is picked up by
> the member-home bounce pages, which forward them to their role home; that is
> what makes the pattern acceptable here.

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
| Logged-in role bounce off `/quiz-results` and `/all-starters` | `v3/route-guard.js` `ROLE_BOUNCE_PAGES` | Implemented 2026-08-03; sitewide install already covers it, staging pass pending. Logged-out visitors stay with their page controllers |
| `/quiz` logged-in role redirects | `quiz-main/quiz-redirect.js` (page-scoped) | Talent bounce added 2026-08-03, not `?retake=`-escapable; `/quiz` is outside all three guard tables |
| Per-page logged-out destinations for the build-profile funnel | `v3/route-guard.js` `LOGGED_OUT_DESTINATIONS` | Implemented 2026-08-03; staging pass pending |
| `/complete-profile` access | Memberstack `restrict-pages` gated group (URL rule STARTS `complete-profile`, redirect `login`) | Settled 2026-08-03: sole owner, permanently outside `route-guard.js` and `auth-route.js`; the member-home bounce pages complete the routing for a member dumped at `/login` |
| Talent funnel position on `/build-profile/*` | `v3/build-profile-redirect.js` (page-scoped, Xano `get_freelancers`) | Implemented 2026-08-03; needs three page-level Webflow embeds, see [BUILD-PROFILE-REDIRECT-WIRING.md](BUILD-PROFILE-REDIRECT-WIRING.md) |
| Page visibility and navigation variants | Webflow + Memberstack gated groups | Verify against the product sheet |
| `/all-starters` content visibility and free-Brand result limits | Memberstack `data-ms-content` gated content on the page plus list/render-level limiting | Settled 2026-08-03: permanently outside `PAGE_ROLES`. The only route-level rule the page has is the Talent role bounce in the row above; logged-out and both Brand tiers stay |
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
- (Settled 2026-08-03, recorded in the route-level and enforcement-layer sections
  above: `/quiz` stays outside all three guard tables with its page controller as
  the sole owner of its member redirects, and `/quiz-results` and `/all-starters`
  became role-bounce pages, keeping their page controllers in charge of every
  logged-out visitor.)
- Verify Webflow Memberstack gated groups and Xano authorization independently;
  a `Backlog` row in the product sheet is desired behavior, not proof that it is
  live.
