# Starters Webflow CDN Scripts

This folder is the local checkout for:

```txt
https://github.com/the-starters/starters-webflow
```

Treat the GitHub repo under the `the-starters` org as the source of truth for these browser-facing Webflow CDN scripts.

## Before Editing

Always check GitHub first so local work does not overwrite code updated by someone else:

```sh
git fetch origin
git status --short --branch
git log --oneline --decorate -5
```

If `main` is behind `origin/main`, pull or rebase before editing. If local files are modified, inspect them before pulling:

```sh
git diff
git diff --stat
```

Do not discard local changes unless the user explicitly asks.

## Sync Safety

- Assume GitHub may have newer code than this local folder.
- Do not force-push.
- Do not overwrite remote changes with stale local files.
- If a push is rejected, fetch and review the remote changes before trying again.
- For Webflow browser code, put the implementation in this GitHub repo and keep Webflow thin. Load the jsDelivr asset once from Page/Site Settings -> Custom Code -> Head Code using `@latest` with `defer`, so future tagged releases do not require another Webflow edit.
- `@latest` resolves the highest semver tag. The production release sequence is merge to `main` -> semver tag/release -> purge `@latest` -> verify the served bytes; merge + purge without a newer tag will continue serving the previous release.
- Before adding a script here, check whether native Webflow, `wf-xano`, `wf-algolia`, or another established shared library already owns the behavior. Prefer extending the appropriate library when the capability will be reused. One-off page scripts belong here only when the behavior is genuinely page-specific or cannot fit a shared attribute contract without distorting it.
- Browser behavior must connect to Webflow elements through custom attributes, not styling classes or generated IDs. Reuse the owning library's vocabulary; do not invent a parallel attribute dialect.

## Current Scripts

- `code-components/` — parked, preparation-only Webflow React package containing
  the staging-pinned V3 Talent Applications Admin dashboard; it is not imported
  into Webflow, published, tagged, or deployed through jsDelivr; see
  [`code-components/README.md`](code-components/README.md) for local commands,
  Webflow properties, Xano endpoints, security boundaries, and workflow states
- `quiz-main/quiz-home.js` — homepage hero controller; saves selected category bucket IDs to `sessionStorage.quizSelectedCategories` and redirects to `/quiz` (see `quiz-main/README.md`)
- `quiz-main/quiz-main.js` — `/quiz` controller; combines homepage bucket selections with saved Memberstack answers, translates pre-rollout taxonomy IDs before retake prefill, persists draft/ready answers for results, and skips signup for logged-in retakers (see `quiz-main/README.md`)
- `quiz-main/quiz-redirect.js` — `/quiz` member redirect; sends live or Test paid Brands to `/brand-dashboard` and completed free Brands to `/quiz-results`, unless the URL opts into a retake
- `quiz-results.js` — quiz-results controller; normalizes saved quiz taxonomy before every results consumer, projects renamed V3 categories to both canonical and legacy `LearnContent` tags during the Learn taxonomy migration, requires a retake when no current category survives retirement, returns logged-out visitors with no pending, test, or saved quiz data to `/quiz`, sends authenticated members whose completion marker has outlived missing or malformed answer JSON to `/quiz?retake=true&quizDataMissing=1`, keeps diagnostics opt-in through `starterQuizDebug`, and uses the `Freelancers3.0-dev` Algolia index for freelancer recommendations by default
- `quiz-results.min.js`
- `quiz-loader/quiz-loader.js` — head-time script for the `/quiz-results` loading component: a synchronous skip-on-refresh paint gate (hides the DevLink `<code-island>` loader host before hydration when the run was already played) plus the "results ready" producer signal `window.StartersQuizLoader.signalReady()` (sets `window.__starterQuizResultsReady` then dispatches `starterQuizResults:ready`)
- `opportunities-3.0.js` — Opportunities 3.0 page and starter-dashboard binder (including the role-gated merged `/opportunities` feed plus category-matched and applied starter feeds); binds the paid-Brand create/edit forms, validates their custom category selector, keeps the authored 15-word opportunity-title rule while adding a native 120-character backstop, maps ongoing Part Time estimated weekly hours through the existing Xano contract, paints the authored create/edit success screen with the saved opportunity title and opportunity-specific copy, defers access decisions to the sitewide `v3/route-guard.js` when present, and redirects a foreign brand off an opportunity it does not own to `/opportunities-brands-view`
- `v3/auth-route.js` — V3-only login/signup router with plan-based defaults and role-scoped `next` destinations; brand-free lands on `/quiz` until the Memberstack `starter-quiz` field is set (quiz completed), then `/quiz-results`
- `v3/talent-application.js` — `/freelancer-application/step-1` intake controller; suppresses the native Webflow/Zapier submission, posts `form[application-form]` to Xano, and continues successful applicants to step 2
- `v3/route-guard.js` — V3-only direct-access guard for protected, role-scoped pages
- `v3/password-recovery.js` — V3-only shared Brand/Talent password recovery; consolidates the routes onto the canonical `/forgot-password -> /reset-password -> /password-success` flow, redirects the legacy Talent and misspelled success paths while preserving the reset-token query string, encoding, and hash, and carries only non-sensitive `from=brand`/`from=talent` origin context
- `v3/onboarding-tour.js` — attribute-driven V3 product tours with highlight and disclosure overrides, role targeting, per-member seen-state, and replay/reset controls
- `v3/all-starters-favorites.js` — paid-Brand favourites controls and Designer-built All/Favourites filtering for `/all-starters`, backed by sitewide `wf-xano` and `wf-algolia`
- `v3/saved-starters-roles.js` — `/favorites` saved-list roles chips: splits the card's delimited roles value (`data-ts-roles`, on both `;` and `,`) into one cloned paragraph per role, so the wf-xano saved list matches the Algolia browse cards. Hides the bound element instead of replacing it, so `wf-xano-reconcile="keyed"` card reuse can still re-bind; de-hyphenation is scoped to the roles element so sibling values like `availability: "11-20"` are untouched; dispatches `expert-cards:relayout` so the hover height recomputes for the added lines; arms via `WfXano.push()` because `window.WfXano` is the API object before any instance exists
- `v3/starter-dashboard-points.js` — authenticated, attribute-driven `/starter-dashboard` points and rank tile; renders the Xano-canonical ledger total plus overall and primary-role competition ranks, with safe refreshing, ineligible, missing-role, and error states
- `profile-image-auth-shim.js` — interim V3 profile auth/image bridge; adds
  Memberstack-derived `user_v3` Bearer auth to profile, Companies, and Portfolio
  mutations, enables `/starter-edit-profile` writes only on the exact Live hosts,
  and blocks known edit mutations on non-Live hosts
- `v3/scheduling-auth.js` — staging-only availability and scheduling authentication bridge
- `v3/scheduling-availability-init.js` — staging-only booking-stage availability control initializer
- `opportunities-3.0-debug.js` — query-gated opportunity matching QA implementation
- `v3/messages.js` — self-contained Memberstack + TalkJS inbox bootstrap for `/messages`, including `?with=<memberstack id>` deep links that open (creating if needed) the one-on-one conversation with that member
- `v3/messages-profile.js` — "Message this starter" modal on the `/hire/<slug>` profile template; mounts a TalkJS chatbox into the page's existing modal, lazy-loading the SDK on first open, and redirects logged-out and free-Brand viewers instead
- `opportunities---create.js` — dedicated `/opportunities---create` controller; binds the same `[data-opp-form="create"]` contract through the shared Opportunities 3.0 core
- `starters-list/apply-button-disable.js`
- `starters-list/range-backfill.js`
- `utils/loader.js` — env-switch script loader (`loadEnvScript`)
- `utils/wf-validate.js` — declarative form validation: styled errors and success slots, live counters, soft-disabled submitters while a form is incomplete, and refresh support for late-injected fields (see below)
- `explore-search/explore-search-chip-fill.js` — chip click copies its text into the search input, fires the engine's `input` event, announces `explore-search:commit`
- `explore-search/explore-search-tab-counts.js` — live per-index hit counts for the tab bar (intercepts the engine's own Algolia responses; zero extra operations)
- `explore-search/explore-search-most-searched.js` — dynamic "Most Searched" chips from an Algolia Query Suggestions index, via a designer-owned template
- `explore-search/explore-search-recent-searches.js` — the user's recent searches as chips, persisted in localStorage, recorded via `explore-search:commit`
- `explore-search/explore-search-default-results.js` — keeps results visible on an empty query and fills each federated section with its index's default ranking
- `explore-search/explore-search-hide-empty.js` — hides `[starters-algolia-hide]` wrappers while all their Algolia sections are empty
- `utils/section-custom-toc/section-custom-toc-main.js` — attribute-driven auto-scrolling section TOC: scroll-spy links (`data-toc-id` ↔ `data-toc-section`), skip-when-visible bar auto-scroll, automatic per-breakpoint navbar offset (`data-toc-navbar` on every stacked sticky bar, heights sum; `.w-nav` fallback when none tagged; opt-out `data-toc-ignore-navbar`), spy-zone activation (`data-toc-spy-zone`, default 0.3), hidden sections never take the highlight, offset-corrected deep links
- `utils/section-custom-toc/hide-empty-sections.js` — keyed empty-section cleanup for profile pages: sections opt in with `data-hide-when-empty-section="<key>"` (+ recommended `data-empty-watch="<item selector>"`) and self-hide when empty; nav buttons tagged `data-hide-when-empty-element` + `data-hide-when-empty-id="<key>"` hide/reappear with their section as async content lands; fail-safe (unknown key or ambiguity → stays visible), handles Webflow `display: contents` wrappers
- `utils/section-custom-toc/section-custom-toc-main.css` — structural companion (hidden-scrollbar overflow bar, left-aligned list, `data-toc-align="center"` opt-in centering)
- `explore-search/explore-search-list-loader.js` — shows a loader and masks list jank during result transitions (arms on first user interaction; force-hides the loader at init)
- `global-embeds/expert-card/expert-card-browse-loader.js` — masks wf-algolia browse-list jank on `/all-starters` behind the designer loader; hooks the engine's loader show/hide and `results`/`error` events, waits for `expert-cards:relayout:done`, force-hides the loader at init. Resolves its browse block by scanning **all** `[wf-algolia-element="browse"]` blocks for one carrying both a `[data-loader]` and a results list, after `window.memberReady` settles the Memberstack gate variants — `/all-starters` ships 5 browse blocks and the first has neither
- `explore-search/explore-search.css` — search-brilliance page styles (filter checkboxes/radios, result grids, selected-filter reveal, loader)
- Local demo/harness pages (e.g. the explore-search and generate-contract demos) live in the gitignored `local-demos/` folder — not committed; serve via `./dev-tunnel.sh` to view.
- `explore-search-transitions/explore-search-transitions.js` — search overlay open/close transitions (GSAP timelines, inert-locked closed state)
- `explore-search-transitions/explore-search-transitions.css` — companion styles for the search overlay transitions
- `navbar-embeds/navbar-dropdown.css` — mobile (<=767px) navbar dropdown open/close height transition via `grid-template-rows`
- `navbar-embeds/navlinks.css` — hides gated nav link groups until Memberstack gating adds `.ms-nav-ready`; owns Designer previews and the merged `/opportunities` navbar's resolved-role visibility
- `navbar-embeds/account-dropdown.css` — mobile profile dropdown open/close transitions with independent open/close durations
- `navbar-embeds/transparent-nav-bg.css` — fills the transparent navbar background while the mobile menu is open (`[data-nav-menu-open]`)
- `navbar-embeds/transparent-nav-bg.js` — fades in the `.nav_bg` layer on scroll for transparent navbar variants
- `navbar-embeds/nav-menu.js` — mobile menu button (`#menu-btn`) toggles body scroll lock
- `navbar-embeds/memberstack/free-paid-anon.js` — Memberstack navbar gating for free/paid/anonymous states (`data-gate`, `data-hide-if-both`), reveals via `.ms-nav-ready`
- `navbar-embeds/memberstack/ms-code-field-link.js` — turns `[ms-code-field-link]` elements into external links from a Memberstack member custom field
- `navbar-embeds/navbar-explore/explore-menu.css` — explore mega-menu base styles (hidden by default, chevron rotation, Designer preview)
- `navbar-embeds/navbar-explore/explore-menu-mobile.css` — explore menu mobile full-screen stacked columns; fixed `--explore-mtop` navbar offset
- `navbar-embeds/navbar-explore/navbar-explore.js` — desktop explore mega-menu flyout column positioning (bails <=991px)
- `navbar-embeds/navbar-explore/navbar-explore-mobile.js` — mobile explore menu stacked-column navigation with a fixed back button
- `navbar-embeds/navbar-explore/view-all.js` — "view all" button routes to `/subcategories/<slug>` derived from the item's `wf-algolia-value`

## Quiz-results freelancer recommendations

`quiz-results.js` resolves the freelancer-recommendation Algolia settings per
value, in this priority order: `window.starterQuizAlgoliaConfig`, dedicated
`data-starter-quiz-algolia-*` (or legacy `data-algolia-*`) attributes, then the
existing `script[data-app-id][data-search-key]`. The app ID and search key may
be on a different element from the index name. When no index is configured, it
uses `Freelancers3.0-dev`.

Do not use a general `[wf-algolia-index]` wrapper to configure these searches.
The page's LearnContent carousel owns its own wrapper and index; using that
wrapper for freelancer recommendations can return no Starter cards.

The Learn carousel filters on the canonical V3 category ID and, for renamed
categories, the corresponding legacy `LearnContent` slug. This keeps existing
`creative-brand` and `marketing-strategy-leadership` records discoverable while
new content can use `creative` and `marketing-strategy-brand`. Categories with
no Learn records, such as `retention-crm`, stay empty rather than borrowing
unrelated content.

## Opportunities 3.0 URL Identity

Opportunity detail URLs use the Webflow CMS slug as their label, while the immutable
numeric Xano opportunity ID remains the API identity. Bind that ID to
`data-opp-page-id` on the `/opportunities/<slug>` CMS detail page; a nonnumeric or
missing bound value is not inferred from a text slug.

List and Algolia projections should provide either a same-origin `url_path` matching
`/opportunities/<slug>` or a `webflow_slug`. Custom-rendered cards can expose these as
`data-opp-url-path` and `data-opp-webflow-slug`. Existing valid detail links are
preserved; generated links prefer `url_path`, then `webflow_slug`, and finally the
Xano ID. Existing `/opportunities/<id>` URLs remain supported as the
backwards-compatible fallback, including detail pages that have not yet added
`data-opp-page-id`. V2 opportunity scripts and query-parameter URLs are unchanged.

For a paid brand, opportunity detail remains owner-scoped after the role-level route
guard succeeds. Both `/opportunities/<slug>` and the legacy
`/opportunities-details---brand-view?opp=<id>` entry point probe the authenticated
brand's applicant list. A `403` or `404` redirects a non-owner to
`/opportunities-brands-view`; server, transient, and network failures do not redirect
and therefore cannot bounce the actual owner during an outage. Xano remains the
authorization boundary.

For console checks, `window.Opp30.redirectForeignBrandToFeed(error)` applies that
status policy and returns whether it redirected.

## Opportunities 3.0 Create and Edit Forms

Before releasing either opportunity controller, publish
`data-opp-form="create"` on the one full Webflow create form rendered on each
supported page, including `/opportunities---create` and the Brand feed's
post-opportunity modal. Both `opportunities-3.0.js` and
`opportunities---create.js` resolve that form only through this stable role;
generated form IDs and styling classes are not supported selector fallbacks.

The dedicated page controller shares a run-once guard with the core controller,
so loading both scripts does not submit twice. Keep the existing load order:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/opportunities-3.0.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/opportunities---create.js"></script>
```

The form may keep its native submit control; an optional
`data-opp-submit="create"` control inside the form is still owned by the form's
submit handler. The Webflow form display name, generated ID, and styling classes
can be cleaned up independently after the stable attribute is published because
browser behavior no longer reads them.

Create and edit forms keep the existing category selector input named
`Category-option`. The controller makes it required from the selected tags rather
than the visible search text, so a missing category produces the inline message
`Please select at least one category.` instead of silently blocking submission.

Both forms keep the authored 15-word rule on the `Opportunity-title` input
(`wf-validate-maxwords="15"`) and gain a native 120-character backstop: the
controller sets `maxlength="120"` and the inline message attribute
`wf-validate-message-maxlength` to `Please keep the title to 120 characters or
fewer.`. The same limit is enforced against the submitted payload, so a title
longer than 120 characters — including a scripted or prefilled value that
bypasses the input's `maxlength` — is rejected with that message. It does not
generate the title input.

The Ongoing Part Time variant must contain Webflow-authored inputs named
`Estimated-Hours` and `Part-Time-Budget`. In both the Create and Edit
components, author the hours label, plain-text input, helper text, and field
group in Webflow; give that group `data-project-type="part-time"` and place it
before the existing part-time budget group. Label the field `Estimated hrs/week`
and use `Example: 25 hrs/week` as its placeholder. The controller binds to the
native input, supplies its required-message attribute, requires and reveals it
only while `Project-Type` resolves to `Ongoing Part Time`, and hides the authored
group for the other project types. It does not generate the label, input, helper,
or grouping markup. Both components must publish this markup before the
controller is released.

Create and update requests send the input's trimmed value as the existing Xano
`est_hours` field, and edit prefill restores that value. One Time and Full Time
requests send an empty `est_hours` value and do not require the field.
The edit modal refreshes its saved values after each form-flow reset so Webflow's
authored default radio cannot replace the opportunity's current Project Type
when the modal reopens. Project Type prefill also emits the native change event
used by the authored tab controller, keeping its active pill and conditional
panel aligned with the checked radio.

After a successful create or edit, the controller paints the Webflow-authored
review success screen in place; it binds only existing elements and generates no
markup. It writes the saved opportunity title into the success block's
`data-opp-bind="title"` element, falling back to an authored `[Job Name]`
placeholder span or an empty span inside `.heading-style-h1` when that attribute
is absent. It also rewrites the `.text-size-medium` confirmation message to
opportunity-specific copy when the authored text still reads as application copy,
so both flows read "Our team is carefully reviewing your opportunity."

Keep `utils/wf-validate.js` on these forms. The controller registers the authored
field through `window.WfValidate.refresh(form)`, so category and estimated-hours
failures use the form's normal inline error treatment. Client-side checks remain
UX only; Xano retains authority over accepted payloads.

Run the focused form-selector, feedback, validation, and create-page authentication
regressions with:

```sh
node --test opportunities-form-contract.test.js opportunities-create-auth.test.js opportunities-create-feedback.test.js wf-validate.test.js
```

## V3 Staging Scheduling Authentication

On `the-starters-3-0.webflow.io` only, `v3/scheduling-auth.js` authenticates plain
`fetch()` requests whose Xano path starts with
`/api:tCpV3oqd/scheduler/configurations/` or
`/api:tCpV3oqd/calendars/get_availabilities`, plus the exact
`/api:tCpV3oqd/starter/get_by_memberstack` path. It maintains a member-scoped token
cache, adds `Authorization: Bearer <token>` without
changing the effective request method, body, or other options, and supports string,
`URL`, and `Request` inputs. Requests that already provide `Authorization`, other Xano
API groups, other origins, `thestarters.com`, and `www.thestarters.com` pass through
unchanged.

A scheduling `401` clears the cached token, trades the current Memberstack JWT once,
and retries the same request once. A failed refresh preserves the original `401`.
Legacy plain-`fetch()` callers fall back to one unauthenticated request if initial token
acquisition fails; direct `window.xanoAuthFetch()` callers receive that error instead.
Network failures remain fetch rejections. A Memberstack account change invalidates both
token acquisition and in-flight scheduling responses with `MEMBER_SCOPE_CHANGED`.

Load `v3/scheduling-auth.js` with `defer` on the staging pages that own availability
or scheduling calls. It installs before Memberstack is ready and supersedes the legacy
compatibility bridge in `opportunities-3.0.js` in either script order.

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/scheduling-auth.js"></script>
```

### Booking-stage availability controls

On the same staging hostname, `v3/scheduling-availability-init.js` reads the legacy
starter endpoint through `window.xanoAuthFetch`, preserving the authenticated request
and retry protections. A successful JSON `null` confirms first-time setup; a saved
legacy schedule reveals `[update-availability]`, while failed or malformed responses
leave both controls hidden. The page's `getStarterByMemberId(memberId)` helper is used
only when the auth helper is unavailable. The initializer selects the corresponding
`[availability-step]` and retains its five-minute member-scoped saved-availability
cache and member revalidation. Load it after the auth bridge on the renamed
`Starter Dashboard - Booking stage` page; it does not write scheduling data or run on
the custom domains.

For staging QA, an allowlisted Memberstack Test-Data member can be selected with
`?test_member_id=<memberstack_member_id>`. This changes only the member whose saved
availability is read and rendered; the logged-in tester still supplies the Bearer
authentication, and the override is never used for writes. Remove this temporary
override before enabling the initializer on either custom production domain. See
`v3/README.md` for its validation, cache, status-marker, and removal contracts.

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@main/v3/scheduling-auth.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@main/v3/scheduling-availability-init.js"></script>
```

See `v3/README.md` for the full markup, status, event, cache, and public-helper
contracts.

## Opportunities 3.0 Merged Feed

The exact `/opportunities` and `/opportunities/` paths use one page for Talent
and paid Brand feeds. Keep each role's section inside
`[data-opp-role="talent"]` or `[data-opp-role="brand"]`, and add this page-head
anti-flash rule:

```html
<style>
  html:not([data-opp-role-resolved]) [data-opp-role] {
    display: none;
  }
</style>
```

Both role sections must contain their own
`[wf-xano-element="wrapper"][wf-xano-defer="true"]` feed root and load
`wf-xano` v0.28.0 or newer. Neither root fetches during automatic `wf-xano`
boot. After the stable Memberstack plan resolves, `opportunities-3.0.js`
reveals the allowed wrapper, stamps `html[data-opp-role-resolved]`, and
activates only that wrapper's root through the race-safe `window.WfXano`
pre-load queue. The hidden, wrong-role feed is never initialized.

The merged page keeps exactly one native Webflow `Navbar v2` component.
Its root carries the component's existing `data-preview-nav` attribute and its
authored descendant groups retain their `#freelancer` / `#brands` and
`data-ms-content` contracts. When the opportunity role resolves, the controller
changes only the root attribute (`freelancer` for Talent, `brand` for paid
Brand); `navbar-embeds/navlinks.css` owns descendant visibility. The controller
does not clone a navbar, generate navbar HTML, or paint descendant visibility
with inline styles.

Because Webflow can restore a component property's authored value after the
controller first resolves the member, the controller keeps the attribute in
sync: a `MutationObserver` watches `data-preview-nav` changes and component DOM
replacements and re-applies the resolved role. It still only mutates the
existing attribute and never creates navbar markup.

Keep `navbar-embeds/navlinks.css` published with that native component. Its
merged-feed selectors use the deferred role-wrapper signature above, so they do
not affect `/opportunities/<slug>` detail pages. Before
`html[data-opp-role-resolved]` is stamped, the CSS hides the authored Talent and
paid-Brand groups; afterward it hides every role list and reveals only the
resolved role's authored descendants.

Load `v3/route-guard.js` sitewide before `opportunities-3.0.js`. The merged
route allows Talent and paid Brand members, rejects free Brands, and guards both
the bare and trailing-slash forms. An allowed initial plan snapshot proceeds
immediately. Before redirecting or surfacing an unmapped-plan error, the guard
polls for up to two seconds so a partially hydrated lower Brand Free connection
can be replaced by an allowed Talent or paid-Brand role. Polling lookup failures
are retried within the same deadline, and a lookup that never settles cannot
extend it. If no allowed role resolves, the original fail-closed redirect or
error applies using the latest valid member snapshot. The legacy
`/opportunities-freelancer-view` and `/opportunities-brands-view` boot branches
remain supported separately.

The controller also waits for an authored route guard to report `allowed`
before it evaluates Memberstack role state. Guard errors and redirects leave
both feeds hidden; after two seconds, the legacy fallback applies only when an
authored guard never boots. This handoff protects against accidental reversed
`defer` order while the Webflow script order is being corrected. If the first
authenticated member snapshot has no `planConnections`, the controller polls
Memberstack for up to two seconds for the plan-ID role to hydrate. It does not
retry a non-empty, unmapped plan snapshot. If a configured guard never boots
and no mapped role becomes available, the page stays hidden with
`html[data-route-guard-error="member-role-unavailable"]` instead of redirecting
to `/`; installs with no authored guard retain the legacy redirect. A page must
still load the guard first. Duplicate
`opportunities-3.0.js` tags are ignored after the first boot, but should be
removed from Webflow rather than relied on.

The controller exposes `window.Opp30.routeGuardActive`,
`window.Opp30.routeGuardConfigured`, and
`window.Opp30.waitForRouteGuardHandoff` for guard diagnostics, plus
`window.Opp30.waitForMappedMemberRole` for Memberstack plan-hydration checks,
and
`window.Opp30.initMergedOppFeed`,
`window.Opp30.syncMergedNavbarRole`, and
`window.Opp30.activateDeferredFeed` for merged-feed diagnostics.
Run the merged-feed, router, and guard regressions with:

```sh
node --test navbar-role-contract.test.js opportunities-3.0-auth.test.js v3/auth-route.test.js v3/route-guard.test.js
```

## Opportunities 3.0 Starter Matching

Load `opportunities-3.0.js` on `/opportunities-freelancer-view` and
`/starter-dashboard` from the existing `@latest` jsDelivr path:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/opportunities-3.0.js"></script>
```

On V3, load `v3/route-guard.js` sitewide before this script. Opportunities 3.0
waits for the guard's terminal `html[data-route-guard]` state, then uses stable
plan IDs to scope role-specific work but leaves all access redirects to the
guard. If an authored guard never boots, its legacy Memberstack custom-field
redirects remain as a backward-compatible fallback. See
[`v3/ROUTE-GUARD-WIRING.md`](v3/ROUTE-GUARD-WIRING.md) for installation details.

The starter feed's All tab reads the authenticated
`starter/profile/match-context` response and applies its positive `category_refs`
values to Algolia. Results stay hidden while filter changes are in flight, and
responses are shown only when their facet filters match the requested tab, preventing
an unfiltered or stale feed from flashing.

The Applied tab is historical member state, not another category match. It filters
Algolia by the opportunity IDs returned from the starter's Applied list and removes
the `category_refs` filter, so an application remains discoverable after the starter
changes or removes profile categories. Returning to All restores the current
category filter.

Memberstack account changes clear the cached Xano token, match context, applied IDs,
and Algolia results. Requests that were already in flight reject with
`MEMBER_SCOPE_CHANGED` instead of returning or tracking data for the previous member.

If the match context has no valid positive category refs, All stays collapsed and
the existing `[wf-algolia-element="no-results"]` state becomes a Complete profile
prompt linking to `/starter-edit-profile`; the script never exposes the unfiltered
feed. On `/starter-dashboard`, the same prompt is painted only into
`[wf-xano-instance="dash-applied-opps"] [wf-xano-element="empty"]`, so existing
applied cards are unaffected.

Keep these Webflow markup contracts in place:

- The feed needs `[wf-algolia-element="browse"]`,
  `[wf-algolia-element="results"]`, `[wf-algolia-element="template"]`, and
  `[wf-algolia-element="no-results"]`; rendered cards expose
  `data-wf-algolia-hit-objectid`.
- All and Applied controls use `data-opp-talent-tab="all|applied"`. Do not also make
  them wf-algolia filter controls; the binder removes conflicting filter attributes.
- The dashboard applied list keeps `wf-xano-instance="dash-applied-opps"` and its
  `wf-xano-element="empty"` descendant.
- The binder marks an incomplete target with `data-opp-profile-incomplete="true"`,
  rewrites its first two paragraphs when present, and appends one idempotent
  `data-opp-complete-profile` link.

For rollout diagnostics, inspect `window.Opp30.diagnoseFreelancerFeed()` and the root
attributes `data-opp30-talent-tab`, `data-opp30-talent-algolia`,
`data-opp30-talent-category-count`, and `data-opp30-talent-category-refs`. An
incomplete profile sets `data-opp30-profile-categories="missing"`; dashboard setup
sets `data-opp30-dashboard-match` to `ready`, `profile-incomplete`, or `error`.

### Opportunity matching QA mode

Append `?opp_debug=1` to `/starter-dashboard`, `/opportunities`, or
`/opportunities-freelancer-view` to load the shared, authenticated matching QA panel.
The values `1`, `true`, `yes`, and `on` are accepted case-insensitively; other values
leave QA mode disabled. While enabled, `data-opp30-match-debug` on the document root
reports `loading`, `pass`, `check`, or `error`.

The production binder lazy-loads `opportunities-3.0-debug.js`, which then loads
`lil-gui@0.21.0`; neither debug script, the library, nor the extra Xano reads run for
normal visitors. Same-origin dashboard links to either `/opportunities` or
`/opportunities-freelancer-view`, including View all, keep the query parameter
so a tester can inspect both surfaces in one session.

The panel stays fixed below the navbar at desktop, tablet, and mobile breakpoints and
scrolls within the remaining viewport. The starter's complete category list is shown
as wrapping name/ref chips. The panel pages through the Active opportunity set to
reconcile total active, category matching, matching-not-applied, active applied,
matching/applied overlap, applied non-matches, and the unique visible union. Its
equation is `matching + applied - overlap = unique visible`. Loading is capped at 100
pages of 100; an incomplete Active set changes the status to `CHECK`. Xano's
`available_matching_total` and the `itemsTotal` returned with `match_categories: true`
are checked against the independently reconciled QA counts; a difference also changes
the panel/root status from `PASS` to `CHECK` (and the root attribute from `pass` to
`check`).

Floating labels are scoped to the dashboard opportunity list and the live freelancer
`[wf-xano-instance="talent-opps"]` feed. If that feed is absent, the narrow future
Algolia fallback accepts only `[wf-algolia-element="results"]` roots containing an
`.opportunity-card`, so it ignores the site-wide search overlay. The **Floating card
labels** control toggles labels that show the opportunity categories, current overlap,
applied state, and why the card is visible. Panel filters only hide/show cards already
rendered in those containers; they never change the production query. Dashboard cards
prefer an explicit `data-opportunity-id`, `data-opp-id`, or
`data-wf-algolia-hit-objectid`.
Otherwise, their `data-wf-xano-id` is mapped as an application ID, with a unique
same-origin `/opportunities/<id-or-slug>` detail link as the fallback; ambiguous links
are not labeled.

Use **Refresh Xano data** to refetch the match context and QA data, **Copy diagnostic
JSON** to copy the report when the Clipboard API is available (or log it otherwise),
**Log tables to console** for readable console output, and **Exit QA mode** to remove
the query parameter. The current structured result is also available at
`window.Opp30MatchDebug.data`, or can be regenerated without using the panel via:

```js
await window.Opp30.diagnoseOpportunityMatching()
```

## Opportunities 3.0 Lifecycle Loading States

Close and Reopen controls can keep their loading appearance in Webflow by using
valued attributes (Webflow does not reliably preserve empty custom attributes):

```html
<div data-opp-element="loading-button" data-opp-loading="false">
  <span data-opp-element="loading-label">Reopen opportunity</span>
  <span data-opp-element="loading-hide">Optional helper or icon</span>
  <span data-opp-element="loading-spinner">...</span>
</div>
```

Style the label and spinner from the loading-button wrapper's
`data-opp-loading="false|true"` value. This stable-layout CSS keeps the spinner
centered without changing the button's dimensions:

```css
[data-opp-element='loading-button'] {
  position: relative;
}

[data-opp-element='loading-button'] [data-opp-element='loading-spinner'] {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  visibility: hidden;
  opacity: 0;
}

[data-opp-element='loading-button'][data-opp-loading='true'] {
  cursor: wait;
}

[data-opp-element='loading-button'][data-opp-loading='true']
  [data-opp-element='loading-spinner'] {
  visibility: visible;
  opacity: 1;
}

[data-opp-element='loading-button'][data-opp-loading='true']
  [data-opp-element='loading-label'],
[data-opp-element='loading-button'][data-opp-loading='true']
  [data-opp-element='loading-hide'] {
  visibility: hidden;
}
```

While the lifecycle request is pending, `opportunities-3.0.js` sets the value to
`true`, adds `is-wf-xano-mutating`, marks the control busy and disabled for
assistive technology, disables any nested native control, and suppresses
duplicate writes. The original state is restored after an error or a successful
no-reload Close/Reopen repaint.

Hiding authored content is opt-in. Use
`data-opp-element="loading-label"` for the button label or
`data-opp-element="loading-hide"` for any other child that should become
invisible while loading. Both use `visibility: hidden` to preserve the button's
dimensions. Untagged button content remains visible while the spinner runs; the
script does not add either attribute automatically.

The Close form-flow confirmation remains identified by
`data-close-opp="confirm-button"`. The script upgrades it to a loading button and,
when necessary, clones the spinner authored inside the page-level
`data-modal-trigger="close-opportunity"` control. The form-flow advances only after
the Close request succeeds; an error leaves the confirmation step open and usable.

The Withdraw Application modal remains identified by
`data-modal-target="cancel-application"`. Its shared nav header sits outside the
form-flow steps, so author the confirmation title with
`data-opp-state="applied edited"` and the success title with
`data-opp-state="not-applied"`. A successful withdrawal shows the success title;
opening the modal again resets its titles to the confirmation state.

Brand-side application archiving is private bookkeeping and does not add an
`archived` talent UI state. An archived application still paints as `applied` or
`edited`, so Withdraw and Edit Application remain available; if its opportunity is
closed, `closed` takes precedence and hides those actions as usual.

## utils/wf-validate.js

Attribute-driven form validation, same grammar family as wf-xano / Finsweet Attributes.
Wraps the native Constraint Validation API: rules come from the attributes Webflow's
Designer already sets (`required`, `type`, `pattern`, `min/max`, `minlength/maxlength`);
the script renders styled error elements instead of the native browser bubbles and
blocks invalid submits before Webflow's handler or page controllers see them.

```html
<form wf-validate-element="form">
  <input name="Email" type="email" required
         wf-validate-message-required="Please enter your email."
         wf-validate-message-type="That doesn't look like an email." />
  <div wf-validate-element="error">Replaced with the message at runtime</div>
</form>
```

- Roles: `wf-validate-element="form | error | message | success | count | submit"`.
  Error/success/count slots bind to the nearest field, or explicitly via
  `wf-validate-for="<input name>"`.
- `success` is the positive twin of `error`: a Designer-authored slot (checkmark,
  "Looks good!") shown only once its field has been touched AND is valid, so it can
  never appear next to a visible error. The script only toggles its visibility.
- `wf-validate-submit-disable` on the same element as `wf-validate-element="form"`
  soft-disables every submitter while the form is incomplete: class
  `is-wf-validate-disabled` (the styling hook), `aria-disabled="true"`, and a theme
  attribute set to `"disabled"` (bonus wiring for button components that theme off
  an attribute; a pre-existing value is cached and restored on re-enable, and an
  attribute that wasn't there is removed). Never the native `disabled` property, so
  a click still hits the gate and reveals every error at once. Completeness is
  checked silently — nothing is painted before it has been earned.
- The theme attribute is configurable through the opt-in's value: a value starting
  with `data-` names it (`wf-validate-submit-disable="data-button-theme"` writes
  `data-button-theme="disabled"`), and every other value — none, `true`, a typo —
  keeps the default `data-theme`, so installs predating this behave identically.
  The cache records which attribute it read, so two forms naming two different
  attributes never restore the wrong one.
- Resetting a form clears its validation state; counters and the submit-disable
  state are recomputed on the next tick, since `reset` fires before values revert.
- A form inside a closed `<dialog>` is `display:none` at bind time, so every field
  measures as unrendered and gets skipped — the form would count as complete and
  its submitter would open looking enabled. The script listens for the `toggle`
  event at document capture (it does not bubble) and recomputes the submit-disable
  state plus the counters the moment a dialog, popover or `<details>` containing a
  bound form opens, so a gated modal opens correctly disabled with no interaction
  (a form inside a collapsed `<details>` was mismeasured the same way). Browsers
  too old to fire a dialog `ToggleEvent` fall back to the previous behavior: the
  gate still blocks, and the look self-heals on the first focusin, input or click
  (a `focusin` listener on every bound form is the backstop for reveal patterns
  that fire no event at all, such as tabs or wizard steps swapped by a class).
  Only a programmatic show/hide that is neither of those still looks stale.
- Call `window.WfValidate.refresh(form)` after injecting controls into an
  already-bound form. It adds only new controls, preserves existing groups and
  touched/error state, and recomputes submit-disable state without duplicating
  listeners. Use `init(scope)` instead when injecting a new opted-in form.
- Invalid forms are gated on BOTH the submit event and clicks on submit buttons —
  page controllers that bind click and call the API directly (the opp30 modal
  pattern) never fire while the form is invalid. Put `wf-validate-element="submit"`
  on clickables outside the form or on wrapper divs that carry the click handler
  (e.g. the `data-opp-submit` button wrappers).
- `count` is a live character counter ("1,234 / 2,500") — max from the field's
  `maxlength` or `wf-validate-count-max`. (Finsweet's "inputcounter" is a number
  stepper, not a char counter — this fills that gap.)
- An invalid field with no error slot gets a plain one auto-injected (class
  `wf-validate_error-auto`), so a gated form never blocks submission invisibly.
- `minlength`/`maxlength` are enforced by the script itself (native tooShort/tooLong
  only fire for user-typed values, so JS-set/autofilled values would bypass them).
- Messages: `wf-validate-message-<rule>` on the input (`required`, `type`, `pattern`,
  `minlength`, `maxlength`, `min`, `max`, `step`, `match`), `wf-validate-message` as
  catch-all, browser default text as fallback.
- Extras: `wf-validate-match="<name>"` (confirm-field rule); hidden (`display:none`)
  fields are skipped, so per-variant required inputs don't block submit.
- Styling is 100% Webflow-side: style the error element itself (inline text or
  absolutely-positioned bubble) and the `is-wf-validate-invalid` class on fields.
- Full grammar and behavior notes in the header of `utils/wf-validate.js`.

Client-side validation is UX only — Xano bridge endpoints must keep validating
server-side.

After browser-facing changes, scan for accidental private exposure before publishing or tagging:

```txt
api.airtable.com
hook.us1.make.com
Airtable PAT-style values such as pat...
```
