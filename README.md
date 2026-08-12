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
- `quiz-main/quiz-main.js` — `/quiz` controller: combines homepage bucket selections with saved Memberstack answers, persists draft/ready payloads for results, and owns the signup redirect contract; authoritative restore-order, markup, and redirect contracts live in [`quiz-main/README.md`](quiz-main/README.md#main-controller)
- `quiz-main/quiz-redirect.js` — `/quiz` member entry redirect by role and quiz state, including the ready-payload safety net for new members; authoritative rules live in [`quiz-main/README.md`](quiz-main/README.md#entry-redirect)
- `quiz-results.js` — quiz-results controller; normalizes saved quiz taxonomy before every results consumer, projects renamed V3 categories to both canonical and legacy `LearnContent` tags during the Learn taxonomy migration, requires a retake when no current category survives retirement, returns logged-out visitors with no pending, test, or saved quiz data to `/quiz`, clears a member-cached pending payload (one carrying `memberstackSavedAt`) as soon as Memberstack positively reports the visitor as logged out so a signed-out browser stops previewing the previous member's results, sends authenticated members whose completion marker has outlived missing or malformed answer JSON to `/quiz?retake=true&quizDataMissing=1`, registers the authenticated [V3 quiz-completion lead email](#v3-quiz-completion-lead-email) only after a finished result is saved, keeps diagnostics opt-in through `starterQuizDebug`, uses the `Freelancers3.0-dev` Algolia index for freelancer recommendations by default, and rides the ad-attribution cookies written by `v3/signup-attribution.js` into the same `updateMember` call as `starter-quiz` (Memberstack field IDs `utm-source`, `utm-campaign`, `utm-adset`, `utm-content`, `fbclid`, `fbc`, `fbp`, `event-id`, `signup-source`, `signup-referrer`, all verified in the app config; empty cookies are omitted, a failed cookie read degrades to saving `starter-quiz` alone, and `signup-source`/`signup-referrer` are write-once so a returning member who merely logged in on `/quiz` keeps the page and referrer their original signup recorded)
- `quiz-results-email-tester.js` and `.css` — query-gated production tester for the V3 `/quiz-results` email; binds a native Webflow panel, hydrates the signed-in canary Brand's current saved quiz plus current Starter and Learn records, and sends only through the authenticated Xano endpoint described under [Quiz-results email tester](#quiz-results-email-tester)
- `quiz-results.min.js`
- `quiz-loader/quiz-loader.js` — head-time script for the `/quiz-results` loading component: a synchronous skip-on-refresh paint gate (hides the DevLink `<code-island>` loader host before hydration when the run was already played) plus the "results ready" producer signal `window.StartersQuizLoader.signalReady()` (sets `window.__starterQuizResultsReady` then dispatches `starterQuizResults:ready`)
- `opportunities-3.0.js` — Opportunities 3.0 page and dashboard binder (including the role-gated merged `/opportunities` feed plus category-matched and applied starter feeds); binds the paid-Brand create/edit forms, validates their custom category selector, keeps the authored 15-word opportunity-title rule while adding a native 120-character backstop, maps ongoing Part Time estimated weekly hours through the existing Xano contract, paints the authored create/edit success screen with the saved opportunity title and opportunity-specific copy, defers access decisions to the sitewide `v3/route-guard.js` when present, redirects a foreign brand off an opportunity it does not own to `/opportunities-brands-view`, drives authenticated canonical project actions on both role dashboards, keeps Generate Invoice Starter-only, and uses the shared diagnostic receipt contract below
- `utils/workflow-diagnostics.js` — authoritative shared receipt contract for the Talent Application, native login/signup/password and Account Profile forms, Build Profile, Quiz Results save and lead-drip enrollment, pause/cancel request intake, opportunity create/edit/close/reopen, application apply/edit/withdraw/archive/restore, Generate Invoice, project lifecycle, project review, Starter Edit Profile, Brand Build Account, Brand/Talent login-email updates, and Starter Onboarding completion workflows. The controllers preserve the native Webflow surfaces and add the diagnostic ID and copy action to an existing success, error, or status message when one is available. The helper stores and copies only allowlisted metadata: diagnostic ID, UTC time, controller/environment, workflow result/stage, safe error code, HTTP status, duration, request-attempted state, canonical record type/ID, and replay state. Receipts exclude names, emails, phone numbers, form answers, prices, tokens, authorization headers, request/response bodies, and idempotency keys. Before a covered mutation starts, its controller attempts to load the helper from the same jsDelivr repository ref; a load failure degrades to the existing workflow behavior without blocking the mutation. Use `copyWorkflowDiagnostic('<workflow>')` as the console fallback for the latest receipt in the current tab.
- `v3/native-form-diagnostics.js` — sitewide observer for Memberstack-native login, signup, password recovery, and Account Profile forms plus the Webflow-native pause/cancel request forms. Its exact mutation-call-site wrapper covers the allowlisted profile-photo, portfolio, and company-experience operations, recording only request outcome and HTTP status while passing each request function through unchanged. It reads no fields and prevents no submit. Existing success/error text receives a visible diagnostic ID and click-to-copy action. Pause/cancel success is classified only as `request_accepted`; it is not proof that a membership changed. Load this asset with `defer` sitewide, before any deferred Build Profile or Starter Edit Profile mutation asset; it loads the shared receipt helper itself.
- `v3/auth-route.js` — V3 login/signup router on `/login`, `/starter-login`, and `/auth-route`; consumes the sitewide role contract, applies role-scoped `next` destinations, and checks Talent and paid-Brand funnel position through Xano; the authoritative routing table, failure semantics, and install map live in [`v3/README.md`](v3/README.md#login-router) and [`v3/AUTH-ROUTE-WIRING.md`](v3/AUTH-ROUTE-WIRING.md)

- `v3/talent-application.js` — `/freelancer-application/step-1` intake controller; suppresses the native Webflow/Zapier submission, posts `form[application-form]` to Xano, continues successful applicants to step 2, and uses the shared diagnostic receipt contract above
- `v3/talent-application-ui.js` — GitHub-owned replacement for the 23 KB Webflow Code Embed on `/freelancer-application/step-1`; it owns the page UI but never submission transport. The authoritative ownership, cutover, markup, and install-order contract lives in [`v3/README.md`](v3/README.md#talent-application-intake).
- `v3/route-guard.js` — sitewide V3 stable role resolver, canonical `/dashboard` router, and direct-access guard for protected role-scoped pages, plus public-entry and funnel-page bounce rules; the authoritative page rules, redirect semantics, and install order live in [`v3/README.md`](v3/README.md#protected-route-guard) and [`v3/ROUTE-GUARD-WIRING.md`](v3/ROUTE-GUARD-WIRING.md)
- `v3/password-recovery.js` — shared Brand/Talent recovery on `/forgot-password -> /reset-password -> /password-success`, preserving reset-token parameters across legacy-path redirects; see [`v3/README.md`](v3/README.md#shared-password-recovery)
- `v3/onboarding-tour.js` — attribute-driven V3 product tours with highlight and disclosure overrides, role targeting, per-member seen-state, and replay/reset controls
- `v3/starters-ms-redirect.js` — per-page Memberstack signup redirect: copies a hidden CMS-bindable destination marker onto each signup form before Memberstack reads it; the authoritative markup contract and path-safety rules live in [`v3/README.md`](v3/README.md#signup-redirect-marker)
- `v3/signup-attribution.js` — sitewide UTM/Meta attribution capture and signup persistence, including CAPI event deduplication and the `/quiz` single-writer boundary; the authoritative cookie, field, arming, and retry contracts live in [`v3/README.md`](v3/README.md#signup-attribution)
- `v3/all-starters-favorites.js` — paid-Brand favourites controls and Designer-built All/Favourites filtering for `/all-starters`, backed by sitewide `wf-xano` and `wf-algolia`
- `v3/ai-recruiter.js` — lower-right, role-gated V3 AI Recruiter controller;
  binds native Webflow markup and sends authenticated requests only through
  Xano. The authoritative access, markup, monitoring, release, and rollback
  contract lives in
  [`v3/AI-RECRUITER-WIRING.md`](v3/AI-RECRUITER-WIRING.md)
- `v3/saved-starters-roles.js` — `/favorites` saved-list roles chips: one cloned paragraph per delimited role, so the wf-xano list matches the Algolia browse cards; authoritative behavior and constraints live in [`v3/README.md`](v3/README.md#saved-starters-roles-chips)
- `v3/reviews.js` — V3 public-profile reviews adapter; see [`v3/README.md`](v3/README.md#v3-reviews-frontend) for the authoritative ownership, wiring, and release contract
- `v3/starter-dashboard-messages.js` — shared Brand/Starter dashboard Messages tile; see [`v3/README.md`](v3/README.md#brand-and-starter-dashboard-messages-tile) for the authoritative data, rendering, and deep-link contract
- `v3/starter-dashboard-points.js` — authenticated, attribute-driven `/starter-dashboard` points and rank tile; see [`v3/README.md`](v3/README.md#starter-dashboard-points-and-rank-tile) for the authoritative rendering, wiring, and ownership contract
- `v3/starter-dashboard-stripe-connect.js` — Memberstack-scoped V3 Stripe Connect dashboard and OAuth-callback controller; selects exactly one authored earnings tile, opens the provider-verified connected account, and owns guarded onboarding and confirmed disconnect flows (see [`v3/README.md`](v3/README.md#starter-dashboard-stripe-connect))
- `v3/paid-call-brand-payment.js` — authenticated Brand payment-method client for paid-call booking surfaces; see [`v3/README.md`](v3/README.md#brand-paid-call-payment-method-client) for its idempotency, identity, and native-Webflow ownership contract
- `v3/dashboard-action-items.js` — Action Items panel chrome for the Starter and Brand dashboards; feature scripts still own their own rows, while this controller owns only the `data-action-element` loading card, "all caught up" empty card, live `total` badge, `data-action-items-count` attribute, and `actionItemsChanged` event, kept live by a coalesced `MutationObserver`. Rows are matched by `[data-action-element="item"]` or the legacy `.dash-hero_action-item` class — an accepted, temporary exception to the attributes-only rule above (see [`v3/README.md`](v3/README.md#dashboard-action-items-panel))
- `v3/onboarding-profile-preview.js` — onboarding self-preview `beforeRender` transform for the wf-xano list, including computed roles, category, location, bio, and endpoint-based arming; authoritative page wiring and instance rules live in [`v3/README.md`](v3/README.md#onboarding-profile-preview) and [`v3/ONBOARDING-PROFILE-PREVIEW-WIRING.md`](v3/ONBOARDING-PROFILE-PREVIEW-WIRING.md)
- `v3/onboarding-done-redirect.js` — read half of the `/starter-onboarding` completion pair: redirects an already-complete member to `/starter-dashboard` and fails open; it installs only with `v3/patch-onboarding-status.js`; authoritative wiring and QA live in [`v3/README.md`](v3/README.md#onboarding-done-redirect) and [`v3/ONBOARDING-DONE-REDIRECT-WIRING.md`](v3/ONBOARDING-DONE-REDIRECT-WIRING.md)
- `v3/patch-onboarding-status.js` — write half of the same pair: detects Webflow form success, records `onboarding_done` in Xano with retries, emits the shared privacy-safe success/failure receipt, and routes to `/starter-dashboard`; authoritative wiring lives in [`v3/README.md`](v3/README.md#onboarding-patch-status) and [`v3/ONBOARDING-PATCH-STATUS-WIRING.md`](v3/ONBOARDING-PATCH-STATUS-WIRING.md)
- `v3/build-profile/` — source-controlled Build Profile browser controllers; the authoritative migration scope, exact live-body provenance, loader order, exclusions, and release checks live in [`v3/build-profile/README.md`](v3/build-profile/README.md)
- `v3/build-profile/profile-photo.js` — provenance-locked Build Profile photo controller
- `v3/build-profile/portfolio-crud.js` — provenance-locked Build Profile portfolio mutation controller
- `v3/build-profile/portfolio-list.js` — provenance-locked Build Profile portfolio list controller
- `v3/build-profile/company-autocomplete.js` — provenance-locked Build Profile company autocomplete
- `v3/build-profile/work-dates.js` — provenance-locked Build Profile work-date controller
- `v3/build-profile/company-experience-crud.js` — provenance-locked Build Profile company-experience controller
- `v3/build-profile/field-counters.js` — provenance-locked Build Profile field counters
- `v3/build-profile/bio-editor.js` — provenance-locked Build Profile bio editor
- `v3/build-profile/grouped-selects.js` — provenance-locked Build Profile grouped-select controller
- `v3/build-profile/submit-diagnostics.js` — observer-only Build Profile submit outcome diagnostics; it does not read or change the coupled writer
- `v3/starter-edit-profile/` — source-controlled Starter Edit Profile browser controllers; the authoritative extraction scope, exact live-body provenance, loader order, exclusions, and release checks live in [`v3/starter-edit-profile/README.md`](v3/starter-edit-profile/README.md)
- `v3/starter-edit-profile/portfolio-crud.js` — provenance-locked Edit Profile portfolio mutation controller
- `v3/starter-edit-profile/portfolio-list.js` — provenance-locked Edit Profile portfolio list controller
- `v3/starter-edit-profile/company-autocomplete.js` — provenance-locked Edit Profile company autocomplete
- `v3/starter-edit-profile/company-experience-crud.js` — provenance-locked Edit Profile company-experience controller
- `v3/build-profile-redirect.js` — fail-open `/build-profile/*` funnel-position redirect for signed-in Talent arriving through bookmarks, back navigation, or stale links; authoritative rules and page embeds live in [`v3/README.md`](v3/README.md#build-profile-funnel-redirect) and [`v3/BUILD-PROFILE-REDIRECT-WIRING.md`](v3/BUILD-PROFILE-REDIRECT-WIRING.md)
- `v3/complete-profile-redirect.js` — outbound half of the Brand profile-completion loop: wrong-role bounce plus the complete paid-Brand exit to `/brand-dashboard`; authoritative routing and signals live in [`v3/README.md`](v3/README.md#complete-profile-role-routing) and [`v3/COMPLETE-PROFILE-REDIRECT-WIRING.md`](v3/COMPLETE-PROFILE-REDIRECT-WIRING.md)
- `v3/brand-profile-redirect.js` — inbound half of the same loop: sends an unfinished paid Brand from protected Brand pages to `/complete-profile`; authoritative page scope and Xano signal live in [`v3/BRAND-PROFILE-REDIRECT-WIRING.md`](v3/BRAND-PROFILE-REDIRECT-WIRING.md)
- `v3/complete-profile-back.js` — `/complete-profile` "Go back to `<page>`" escape hatch: referrer-based, no network, and hidden for off-site or guarded-page referrers; authoritative behavior and path lists live in [`v3/README.md`](v3/README.md#complete-profile-back-button) and [`v3/COMPLETE-PROFILE-BACK-WIRING.md`](v3/COMPLETE-PROFILE-BACK-WIRING.md)
- `v3/complete-profile-loader.js` — `/complete-profile` **submit spinner and backdrop dim**: shows the authored `[data-complete-profile-loader]` element while the Complete-profile form is submitting, and fades back the form layout behind it. Pure observer of `aria-busy` on the form, which `v3/brand-account-controller.js`'s `setBusy()` maintains. It binds no `submit` handler and never touches the submit button, because double-submit is already the controller's guard and two owners of one button is how a form ends up permanently disabled. **Ships with a scoped controller change:** `bindForm()` now latches busy on the success path that calls `location.assign()`, so the form stays `aria-busy="true"` (and the button keeps spinning) until the page unloads; the reasoning and the accepted cancelled-navigation consequence are recorded under Failure semantics in [`v3/BRAND-ACCOUNT-WIRING.md`](v3/BRAND-ACCOUNT-WIRING.md). A success with no redirect URL, and every error, still release the form. Show and hide are **inline** `display: flex` / `display: none` writes, since the Designer's Display:None compiles to a class rule that a stylesheet write would lose to. Minimum display comes from the loader's own `data-loader` attribute, which must be wholly numeric (1000 as authored; `1s` and `1000px` fall back to 200 rather than parsing as 1 and 1000), so a fast failure cannot flash the spinner. Every show arms a **5000ms fail-open cap** that hides the loader and restores the dim no matter what `aria-busy` says, because a full-page overlay must never be able to trap a member. Rapid toggles coalesce into one session, with the dim bookkeeping outliving the hide by one 200ms transition so a re-show reuses the page's original inline values instead of recording its own dim as authored. A dim target that **contains** the loader is skipped with a staging warning rather than dimmed, since opacity on an ancestor creates a rendering group the spinner cannot escape; missing targets are skipped individually and silently. The page uses a single dim target on the form layout, because opacity multiplies down the tree and nesting two would land the photo at 0.04. A missing loader is an immediate zero-side-effect bail that makes the file safe to load site-wide, and the loader is force-hidden once at init as a self-heal. No network, no Memberstack, no role contract. Wiring: [`v3/COMPLETE-PROFILE-LOADER-WIRING.md`](v3/COMPLETE-PROFILE-LOADER-WIRING.md)

- `v3/brand-account-controller.js` — Memberstack-first Brand signup and Build Account controller plus configuration-gated login-email ownership for Brand Account Security and the visible Talent edit-profile form. Its owned mutations emit the shared privacy-safe success, validation, timeout, HTTP, and password-email receipts without recording identity fields. The authoritative signup mapping, identity scope, propagation contract, failure semantics, and reversible canaries live in [`v3/BRAND-ACCOUNT-WIRING.md`](v3/BRAND-ACCOUNT-WIRING.md)
- `account-settings/plan-dates.js` — read-only, fail-quiet Memberstack plan and billing dates through `ms-form-pause-*` attributes; authoritative field, pause-anchor, reveal, and CSS contracts live in [`account-settings/README.md`](account-settings/README.md#memberstack-plan-dates)
- `v3/xano-grabber/xano-grabber.js` — no-network DOM mirror for wf-xano-rendered single values and lists, with real-content gating and never-revert behavior; authoritative attributes, gating rules, and pinned embed live in [`v3/README.md`](v3/README.md#xano-grabber-live-value-mirror) and [`v3/xano-grabber/XANO-GRABBER-WIRING.md`](v3/xano-grabber/XANO-GRABBER-WIRING.md)
- `profile-image-auth-shim.js` — interim V3 profile auth/image bridge; adds
  Memberstack-derived `user_v3` Bearer auth to profile, Companies, and Portfolio
  mutations, enables `/starter-edit-profile` writes only on the exact Live hosts,
  and blocks known edit mutations on non-Live hosts
- `starter-edit-profile.js` — page-specific `/starter-edit-profile` form behavior
  migrated from the legacy Webflow footer. It keeps the existing Designer form
  contract, shows success only after a confirmed 2xx Xano response, and shows the
  error state for rejected or failed profile updates. The script owns its DOM,
  readiness, validation, rate-input, and loader fallbacks. The site-wide Webflow
  Head Code still initializes `MEMBER`, `memberReady`, and the matching helper
  aliases before deferred page scripts. Load `intl-tel-input`, Quill, then this
  deferred `@latest` asset. `v3/brand-account-controller.js` must load first with
  `guardSecurityForm: 'identity'`; it alone writes a changed Memberstack login
  email, then replays this controller's Xano profile save.
  It uses the shared diagnostic receipt contract above and decorates the existing
  success/error modal copy when available.
- `v3/scheduling-auth.js` — availability and scheduling authentication bridge;
  see `v3/README.md` for its authoritative host and path boundary
- `v3/dashboard-calls.js` — authenticated canonical call-section and Brand hero
  binder for the V3 dashboards; see `v3/README.md` for its Designer markup,
  identity, state, and endpoint contracts
- `v3/scheduling-availability-init.js` — scheduling availability and Calendar
  connection-state initializer. Saved hours remain independent from canonical
  grant/calendar/configuration proof, and the Designer-authored Dashboard
  Calendar CTA follows `loading`/`disconnected`/`connected`/`reconnect`/`error`;
  see `v3/README.md` for its host, markup, and safety boundary
- `v3/scheduling-availability-writer.js` — availability form, manager, Nylas scheduler, timezone, and calendar OAuth writer through `window.xanoAuthFetch`; the authoritative host, path, identity, and safety boundary lives in [`v3/README.md`](v3/README.md#booking-stage-availability-writer)
- `v3/scheduling-availability-section.js` — non-modal counterpart to the writer above for the Designer "Dashboard / Calendar" section on the canonical Starter dashboard: per-item CRUD with an inline edit form per item, connect/disconnect, timezone, and a live bookable-slots preview, reusing the writer's connection/config logic without its modal steps; see [`v3/README.md`](v3/README.md#booking-stage-availability-section) for its markup contract and the OAuth-callback handoff with the writer
- `v3/scheduling-v3-stage.js` — hostname/path-gated scheduling compatibility adapter that rewrites reviewed legacy calls to V3, blocks unclassified routes, and retains only approved legacy Stripe calls; see [V3 Scheduling Authentication](#v3-scheduling-authentication)
- `opportunities-3.0-debug.js` — query-gated opportunity matching QA implementation
- `v3/messages.js` — self-contained Memberstack + TalkJS inbox bootstrap for `/messages`; see [`v3/README.md`](v3/README.md#brand-and-starter-dashboard-messages-tile) for its existing-conversation and member deep-link contracts
- `v3/messages-profile.js` — "Message this starter" modal on the `/hire/<slug>` profile template; mounts a TalkJS chatbox into the page's existing modal, lazy-loading the SDK on first open, and redirects logged-out and free-Brand viewers instead
- `v3/project-form.js` — authenticated V3 direct-hire adapter for the Designer-owned Contract Generation form on `/hire/<slug>`; also owns the Memberstack hiring-manager prefill, CMS `data-sp-fill` attribute presets, and `data-set-current-date` initialization that the page's Code Embeds used to provide; see [`v3/PROJECT-FORM-WIRING.md`](v3/PROJECT-FORM-WIRING.md) for the field, prefill, state, and release contract
- `v3/starter-project-form.js` — V3 Starter Dashboard adapter for the existing Start a Project modal; loads authorized Brands and submits an idempotent proposal without creating a project or downstream work; see [`v3/STARTER-PROJECT-FORM-WIRING.md`](v3/STARTER-PROJECT-FORM-WIRING.md) for the authoritative scope, endpoint, Designer, and release contract
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
- `explore-search/explore-search-tab-no-results.js` — shows the shared `[wf-algolia-element="no-results"]` message when the ACTIVE tab of the tabbed federated search is empty (the engine only reveals it when every index is empty). Add-only: it toggles one `!important` class and never writes `display`, so it can never suppress a reveal the engine or `tabs.js` performed. Resolves its own results container past the look-alike browse-widget containers (4 on the homepage, 8 on `/all-starters`) and rejects the no-results element that `tabs.js` mis-counts as a panel
- `utils/section-custom-toc/section-custom-toc-main.js` — attribute-driven auto-scrolling section TOC: scroll-spy links (`data-toc-id` ↔ `data-toc-section`), skip-when-visible bar auto-scroll, automatic per-breakpoint navbar offset (`data-toc-navbar` on every stacked sticky bar, heights sum; `.w-nav` fallback when none tagged; opt-out `data-toc-ignore-navbar`), spy-zone activation (`data-toc-spy-zone`, default 0.3), hidden sections never take the highlight, offset-corrected deep links
- `utils/section-custom-toc/hide-empty-sections.js` — keyed empty-section cleanup for profile pages: sections opt in with `data-hide-when-empty-section="<key>"` (+ recommended `data-empty-watch="<item selector>"`) and self-hide when empty; nav buttons tagged `data-hide-when-empty-element` + `data-hide-when-empty-id="<key>"` hide/reappear with their section as async content lands; fail-safe (unknown key or ambiguity → stays visible), handles Webflow `display: contents` wrappers
- `utils/section-custom-toc/section-custom-toc-main.css` — structural companion (hidden-scrollbar overflow bar, left-aligned list, `data-toc-align="center"` opt-in centering)
- `explore-search/explore-search-list-loader.js` — shows a loader and masks list jank during result transitions (arms on first user interaction; force-hides the loader at init)
- `global-embeds/expert-card/expert-card-browse-loader.js` — masks wf-algolia browse-list jank on `/all-starters` behind the designer loader; hooks the engine's loader show/hide and `results`/`error` events, waits for `expert-cards:relayout:done`, force-hides the loader at init. Resolves its browse block by scanning **all** `[wf-algolia-element="browse"]` blocks for one carrying both a `[data-loader]` and a results list, after `window.memberReady` settles the Memberstack gate variants — `/all-starters` ships 5 browse blocks and the first has neither
- `global-embeds/replica-list/replica-list-relayout.js` — dispatches `expert-cards:relayout` once per wf-algolia static list (`wf-algolia-disable-filters="true"` browse block) the first time it becomes visible, closing the closed-modal `scrollHeight = 0` measurement gap in `expert-card.js`; IntersectionObserver plus a capture-phase click belt, once-per-block gate, self-teardown, staging-gated diagnostics, no-op on pages without a static list. Designer recipe + replica governance rules in [`global-embeds/replica-list/REPLICA-LIST-WIRING.md`](global-embeds/replica-list/REPLICA-LIST-WIRING.md)
- `explore-search/explore-search.css` — search-brilliance page styles (filter checkboxes/radios, result grids, selected-filter reveal, loader)
- Local demo/harness pages (e.g. the explore-search and generate-contract demos) live in the gitignored `local-demos/` folder — not committed; serve via `./dev-tunnel.sh` to view.
- `global-embeds/learn-cta-gate/learn-cta-gate.js` — opens the sign-up gate on a Learn article once the reader has read enough, or after 10s on articles too short to scroll. Two mutually exclusive modes chosen once at init: an article of at least `data-learn-gate-chars` (default 2500) gets a 1px out-of-flow sentinel planted after the text node that crosses the threshold and opens on IntersectionObserver; a shorter article skips the sentinel entirely and opens on a `data-learn-gate-delay` timer (default 10s). Character count rather than scroll percentage because CMS rich text is not proportional — one embedded video moves "34% scrolled" hundreds of characters. **Memberstack decides who is gated, not this script**: the wrapper carries `data-ms-content="!learn-access"`, and the embed reads the wrapper's *computed* display and exits without writing a single style when it resolves to `none` — computed-style rather than element-presence because this site both removes some gate variants and merely hides others, and an inline `opacity`/`visibility` from GSAP on an element Memberstack meant to hide is exactly how a paywall leaks to a paying member. **That guard is timing-critical**: Memberstack resolves after defer-time scripts run (the same window `expert-card-browse-loader.js` documents), so a check at `DOMContentLoaded` sees `display: flex` for every reader including one with learn-access — it would arm, then lock the scroll of a member who can see no gate and has no way out — the close control below does not rescue them, because their whole wrapper is hidden and the close inside it is hidden with it. So boot waits on `window.memberReady` and the guard runs a second time at reveal, *before* the scroll lock; a missing or rejected promise still boots, because a gate that fails to appear beats one that traps someone. Designer markup is `[data-learn-gate-element="wrapper" | "backdrop" | "content"]`, plus an optional standalone `[data-learn-gate-close-button]` — deliberately its own attribute rather than a fourth role value, because an element can carry only one `data-learn-gate-element` and the close control is quite likely to sit on a node that already has a role; the closed state lives in the companion CSS because Webflow exposes neither `visibility` nor `pointer-events`, and a `position: fixed; inset: 0` wrapper at `opacity: 0` without `pointer-events: none` swallows every click on the article beneath it. Scroll lock is the `modal.js` idiom verbatim (`lenis.stop()`, else `body { overflow: hidden }`). **Who may CLOSE it is also Memberstack's call, not this script's.** The gate is a hard paywall unless the Designer authors `[data-learn-gate-close-button]` inside the wrapper carrying its own `data-ms-content` — a logged-in non-paying member sees one and may dismiss; a logged-out reader gets no such element and the gate stays exactly as hard as it shipped. **It must go on something Memberstack can hide.** The hook is looked up with `querySelectorAll` and the **backdrop is skipped**, never taken: the backdrop shows for every reader, so accepting it would resolve `dismissible` true for a logged-out one and hand them the article, and hiding the backdrop from non-members to compensate would take the dimming with it. Putting the hook on the backdrop *as well as* on a real button is harmless and common — it reads as "clicking outside should close it too" — so it is skipped with an informational note rather than refused, and the real button still wins. It must be `querySelectorAll`: the backdrop is authored before the sheet, so first-match returns the one element that can never gate anything and the real control never gets looked at, which shipped as a bug in `v1.59.182`. The script reduces that to one boolean, `state.dismissible`, and gates every dismissal path on it. It is resolved **at reveal, never at boot** (Memberstack has not decided yet at boot, so a boot-time read would hand every logged-out reader a dismissible paywall) and **from computed display, not presence** — same reasoning as the wrapper guard, because a close control Memberstack merely hid is still in the DOM and `querySelector` still finds it, and binding it would be an invisible escape hatch out of a hard gate. Backdrop-click dismisses and **Escape deliberately does not**; no keydown listener is registered at all, so adding one is a spec change rather than a fix. The backdrop handler checks `event.target`, so a click landing on the sheet or the sign-up form inside it cannot close the gate by bubbling. Closing reverses the timeline, unlocks the scroll **on click rather than when the exit finishes** (a page frozen for a third of a second after a button press reads as broken), and needs no cookie: `state.revealed` latches and every trigger is torn down at reveal, so a dismissed gate cannot return on that page and a fresh load starts clean. **The motion is Designer-tunable so the feel can be changed without a release**: `data-learn-gate-ease` (default `power2.out`), `-duration` (0.35s sheet travel), `-fade` (0.2s backdrop), `-lag` (0.3s, measured from the *start* of the fade). Those defaults were chosen on staging with a visual tuner rather than picked off a chart, and note `lag` deliberately **exceeds** `fade` — the dimming completes, the page holds still for a beat, then the sheet arrives; a lag below the fade overlaps them instead. A test pins that relationship so a later "cleanup" cannot quietly clamp it. An ease is validated against the page's own GSAP via `parseEase` (which returns `undefined`, never throws, for one it does not know) and falls back with a staging warning rather than silently flattening the animation. `prefers-reduced-motion` ignores all four: no slide, both parts cross-fade in 0.2s. Fires one `learn_gate_shown` PostHog event (slug, trigger, chars, threshold) and a `learn-gate-shown` window event, and on dismissal a matching `learn_gate_dismissed` / `learn-gate-dismissed` pair carrying the same identifying fields plus `via` (`close` | `backdrop` | `manual`) — shown-count alone cannot say what making the paywall escapable cost; degrades to an instant open without GSAP, cross-fades under `prefers-reduced-motion`, and falls back to the timer when the article body cannot be found rather than giving the article away. `window.StartersLearnCtaGate` exposes `status()` (which reports `dismissible`, `dismissed` and `dismissedVia`), `reveal()` and `dismiss()` — the last gated on `dismissible` like every other path, so it is a deliberate no-op on a hard gate rather than a console bypass. Supersedes a dead inline `toggleScroll` embed on the Learn template that watched `section.gated` — a class that does not exist on the page
- `global-embeds/learn-cta-gate/learn-cta-gate.css` — the closed state of the Learn CTA gate: wrapper `visibility: hidden` + `pointer-events: none` (both needed, and neither is exposed in the Webflow style panel — a `position: fixed; inset: 0` wrapper at `opacity: 0` without the click-through swallows every click on the article beneath it), backdrop transparent. **It deliberately declares no `transform`** — the sheet's off-screen start belongs to GSAP alone, because GSAP parses the computed transform as a pixel matrix, so a CSS `translateY(100%)` lands in its `y` component and the tween's `yPercent` then stacks on top, starting the sheet at 200% and landing it a full sheet-height below its resting place. A test asserts this file never declares `transform`; do not add one. Load in the Learn article template's **head**, before the script. Fail-open by construction: if this loads and the script does not, the gate simply never opens and the article stays readable
- `global-embeds/session-video/session-video.js` — the Learn Sessions hero player (`/learn/sessions/<slug>`), with a free preview for logged-out visitors and the signup wall after it. **It REPLACES the template's inline hero-video script**; do not run both. Three phases: the video autoplays muted and loops inside the first `data-session-video-bg` seconds (default 20) as an ambient hero with the gate **deliberately not armed**; clicking `[data-element-trigger="show-video"]` hides the overlay, reveals the controls, unmutes, stops looping, **continues from the ambient position rather than restarting**, and arms the gate; a logged-out viewer then freezes at `data-session-video-cut` seconds (default 180) and the signup trigger is clicked. The ambient phase must never arm the gate — a loop left running would cross the cut point on its own and throw the wall at somebody who never asked to watch anything — and the loop is capped inside the teaser window, or a page left open rolls past the cut while muted and the watch click freezes instantly. **Membership comes from `$memberstackDom.getCurrentMember().data`, never from `window.memberReady`'s resolved value**: that promise resolves an empty object `{}` for every visitor on this site, so reading it made `!!{}` true and v1.59.170 classified *everyone* as a member, leaving the gate inert for its entire life (verified live while logged out: `memberReady` gave `{}` while `getCurrentMember()` gave `{ data: null }`). `memberReady` is only a readiness signal, awaited before asking, and resolution runs **in parallel** with the library load rather than chained behind it. **It mounts GATED first and upgrades**: `fullscreen` is not a Vimeo embed option but an iframe `allowfullscreen`/`allow` attribute, and permissions policy is evaluated at iframe load and never re-evaluated, so the frame must be rebuilt rather than amended — and since the ambient phase is identical for everyone, delaying it to find out who is watching only cost every visitor an empty hero. So it mounts in the gated shape immediately (safe default, correct for a logged-out viewer) and `upgrade()` rebuilds the frame for a member, preserving the position and the poster state. Unconfirmed answers (no SDK, a rejection, budget expiry) keep watching for a late one. **Members get Vimeo's native player** (`controls`/`keyboard`/`pip` on, fullscreen allowed); a gated viewer gets none of it, so there is no scrubber to drag past the cut point and no picture-in-picture window carrying its own. Elements are found by **attribute or id only, never by class**: `[data-session-video="root" | "stage" | "signup-trigger"]` plus `data-session-video-id` bound to the CMS `id-video-for-waching` field, and the template's pre-existing `[data-element="hero-element"]`, `[data-element-trigger="show-video"]`, `#video-controls`, `#playPauseBtn`, `#muteBtn`, `#fullscreenBtn` and `#videoClickOverlay`, all absorbed rather than replaced. State is **written as attributes** for the template's CSS: `data-sv-player` (native/custom — the cue to lift `pointer-events` onto the iframe, hide `#videoClickOverlay` and hide the template's own bar), `data-sv-video` (loading/ready, retiring an optional `[data-sv-poster]` cover image authored inside the stage, and deliberately never retiring it if the video never loads), `data-sv-overlay`, `data-sv-controls`, `data-sv-play`, `data-sv-mute`, `data-sv-fullscreen`; a test asserts the file never touches `classList`. A pause re-shows the overlay and hides the controls (the template's existing behaviour), and ANY resume clears them again, so the watch control doubles as resume. Fullscreen is hidden for a gated viewer rather than left as a dead button. **No modal id appears in the file**: the trigger carries `modal.js`'s own `data-modal-trigger`, authored in the Designer, so `modal.js` needs no public API; a test pins that. Emits `session-video-preview-start`, `-wall` and `-complete` as window events; no destination is wired. `window.StartersSessionVideo` exposes `status()` and `reveal()`. Diagnostics on staging hosts and `STARTERS_DEBUG` only. Spec and tickets in `.scratch/sessions-video-gate/`
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
- `account-settings/ms-form-cancel-state.js` — reason-keyed success-state selector for the `/account-settings` cancel flow, scoped to the nearest form root; authoritative attributes and ownership rules live in [`account-settings/README.md`](account-settings/README.md#cancel-flow-success-state)
- `global-embeds/form-embeds/turnstile-contents-fix.js` — arms Cloudflare Turnstile on the forms Webflow's own bot protection can never reach: a form carrying the `display-contents` class generates no box, so its rect is `0 × 0`, the `IntersectionObserver` Webflow observes the **form element** with never reports it intersecting, and the widget it would have rendered inside the form never appears. Those forms' submit buttons stay disabled forever, and because `wf-validate` re-enables the final step anyway, a member can click submit and get a tokenless POST back as "Oops! Something went wrong while submitting the form." This script does Webflow's missing step for exactly those forms — appends a `display: none` div **inside** the form (the token only reaches `https://webflow.com/api/v1/form/<siteId>` as the `cf-turnstile-response` input the widget injects there; Webflow never copies `turnstileToken` into the payload) and renders an invisible widget with the form's own sitekey and Webflow's own render options, then writes the token to `jQuery.data(form, '.w-form').turnstileToken` — the single jQuery call in the file, because that cache is where Webflow's own closures read it — and clears `w-form-loading` off the buttons and the `.w-form` wrapper. **Targeting is opt-in only**: a form is a candidate solely because someone marked it `data-starters-turnstile-fix` on the `<form>` in the Designer (presence is the whole contract, any value), so an unmarked form is invisible to this script even when it is a textbook case of the bug — the script reaches into Webflow's private `.w-form` state and appends a node inside a form it does not own, so every armed form should be a decision someone made on purpose, and installing the script can never change a form that was already working. The marker says "you may", not "you must": a marked form is still skipped unless it also carries `data-turnstile-sitekey` and its computed display really is `contents`, and each of those rail failures warns by form name on staging because someone asked for arming and did not get it. That display check is the no-double-arm invariant — a form with a real layout box is armed by Webflow itself once it comes within 200px of the viewport, including inside a closed modal, so arming it too would put two widgets and two token fields in one payload; a marked form with a real display is skipped with a warning telling the author to remove the marker. Each form is re-checked immediately before rendering (existing widget, or a wrapper that has left the loading state) and `[data-wf-no-turnstile]` is honoured, and the wait for `window.turnstile` is what makes that re-check trustworthy — Webflow's forms module is what injects `api.js`, so by then it has finished initialising every form. Two things Webflow does not do: a capture-phase submit guard that **holds** a tokenless submit (button disabled, `data-wait` label where the value is the label, `data-opp-loading="true"` on the site's `[data-opp-element="loading-button"]` wrap, since these `<button type="submit">` are empty overlays whose label is a sibling div), waits up to 10s and re-submits via `requestSubmit()` rather than letting the POST fail; and a `turnstile.reset()` after every submit — Webflow's completion handler leaves the spent token in place and re-enables the button, so a retry would send a single-use token twice and read as "Oops" all over again. Tokens are cleared on reset so the guard holds anything clicked before the replacement lands, the callback always overwrites (it also fires on Turnstile's own refresh), and the `.w-form-done`/`.w-form-fail` inline-display flip is watched as a belt for an outcome no submit event was seen for. Install site-wide (the account-settings modal ships on ~374 of the published pages): with no marked form on the page the script does nothing at all, it is silent in production, and it reports on staging hosts or under `window.STARTERS_DEBUG`. Runtime-written attributes, never authored: `data-starters-turnstile-armed="true"` on an armed form, `"skipped"` on a marked one left to Webflow, and `data-starters-turnstile-host` on the hidden widget div. `window.StartersTurnstileContentsFix` exposes `status()`, `refresh()`, and `reset()`

### Shared Webflow component embeds (`global-embeds/`)

Attribute-driven components published for reuse across pages. Most carry a
`// Docs:` URL on the first line pointing at an authoritative page on the
[embeds documentation site](https://wf-starter-embeds-docs.vercel.app/docs); the entries below summarize the behavior only.

- `global-embeds/step-flow/step-flow.js` — multi-step form-flow engine for `[data-form-flow]` roots: linear sequences, radio-gated sub-branching, footer button groups, action inference, opt-in per-step required-field validation that soft-disables Continue, and opt-in scroll-to-top that clears sticky `[data-toc-navbar]` chrome; needs its CSS embed for the invalid-field outline ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/step-flow))
- `global-embeds/step-flow/panel-nav-flow.js` — panel navigation beside the step engine: swaps sibling panels inside `[data-panel-parent]` with a per-parent history stack for `[data-panel-nav-back-button]`, toggling `display` instantly ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/step-flow/panel-nav-flow))
- `global-embeds/tabs/tabs.js` — attribute-driven tabs for multi-step forms and layouts (`[data-tab-component="wrapper"]`): global or per-panel prev/next, optional link locking until reached via Next, and optional per-panel validation ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/tabs))
- `global-embeds/modal/modal.js` — the `lumos.modal` dialog system: inits every `.modal_dialog`, adds GSAP open/close timelines per `data-wf--modal--variant` (side-panel, full-screen), and manages focus restore ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/modal))
- `global-embeds/modal/reset-on-close.js` — opt-in `data-modal-reload-on-submit` reload once a modal's form really succeeded, detected from Webflow hiding the `<form>` **and** showing `.w-form-done` so a Designer-visible done block cannot false-positive ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/modal/reset-on-close))
- `global-embeds/accordions/accordions.js` — `[data-accordion="wrapper"]` accordions with open-by-default (index or `all`), close-previous, close-on-second-click, and open-on-hover options ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/accordions))
- `global-embeds/custom-scrollbar/custom-scrollbar.js` — custom scrollbar chrome for overflow regions ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/custom-scrollbar))
- `global-embeds/expert-card/expert-card.js` — the shared Starter card: hover height measurement and layout, driven by the `expert-cards:relayout` event its companion scripts dispatch ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/expert-card))
- `global-embeds/featured-expert-card/featured-expert-card.js` — featured-variant Starter card behavior ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/featured-expert-card))
- `global-embeds/featured-expert-card/featured-expert-card-price.js` — price rendering for the featured Starter card ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/featured-expert-card/featured-expert-card-price))
- `global-embeds/application-card/application-card.js` — the shared application card used by opportunity and applicant lists ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/application-card))
- `global-embeds/list-sort-dropdown/list-sort-dropdown.js` — sort-dropdown binding for lists ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/list-sort-dropdown))
- `global-embeds/start-proj-gen-contract/contract-preview.js` — live contract preview for the Start-project / Generate-contract forms ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/start-proj-gen-contract))
- `global-embeds/remove-cms-wrapper.js` — unwraps Webflow CMS wrapper elements that break intended layout ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/remove-cms-wrapper))
- `global-embeds/loader/loader.js` — the shared `setLoader(state, wrapper)` helper: shows or hides a scoped `[data-loader]` via inline visibility/opacity, then collapses `display` after the 300ms fade. No Docs URL and no owner doc; consumers call it directly
- `global-embeds/text-methods/text-methods.js` — the shared `truncateText(text, limit)` helper: word-boundary truncation with an ellipsis, non-string input returning empty. No Docs URL and no owner doc
- `global-embeds/millify.js` — formats long numbers as `1.2K` / `3.4M` through `data-millify` attributes; formatting adapted from millify v6.1.0 (MIT), diagnostics staging-gated. No Docs URL and no owner doc

### Form embeds (`global-embeds/form-embeds/`)

- `global-embeds/form-embeds/form-validation/form-validation.js` — the form-embeds validation component ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/form-validation)). Distinct from `utils/wf-validate.js`, which owns the `wf-validate-*` dialect used by the Opportunities forms
- `global-embeds/form-embeds/form-validation/email-validation.js` — email-specific validation rules ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/form-validation/email-validation))
- `global-embeds/form-embeds/disabler.js` — soft-disables submit controls until a form is complete ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/disabler))
- `global-embeds/form-embeds/datepicker/datepicker.js` — date-input picker ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/datepicker))
- `global-embeds/form-embeds/timepicker/timepicker.js` — time-input picker ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/timepicker))
- `global-embeds/form-embeds/checkbox-toggle/checkbox-toggle.js` — checkbox-driven visibility toggling ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/checkbox-toggle))
- `global-embeds/form-embeds/password-toggle/password-toggle.js` — show/hide password control ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/password-toggle))
- `global-embeds/form-embeds/form-input-filter/form-input-filter.js` — input filtering and normalization ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/form-input-filter))
- `global-embeds/form-embeds/input-preview.js` — echoes an input's value into a preview element ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/input-preview))

### Starters-list filters (`starters-list-filter/`)

Algolia filter chrome for the Starters browse list; each carries its `// Docs:` URL.

- `starters-list-filter/filters-mobile.js` — mobile filter panel behavior ([docs](https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/filters-mobile))
- `starters-list-filter/modal-mobile.js` — mobile filter modal wiring ([docs](https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/modal-mobile))
- `starters-list-filter/total-filters.js` — active-filter count badge ([docs](https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/total-filters))
- `starters-list-filter/custom-algolia-scripts/disable-apply.js` — keeps Apply disabled until the selection changes ([docs](https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/custom-algolia-scripts/disable-apply))
- `starters-list-filter/custom-algolia-scripts/filters-text.js` — renders the selected-filter summary text ([docs](https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/custom-algolia-scripts/filters-text))
- `starters-list-filter/custom-algolia-scripts/clear-filter-visibility/clear-filter-visibility.js` — shows Clear only when something is selected ([docs](https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/custom-algolia-scripts/clear-filter-visibility))
- `starters-list-filter/custom-algolia-scripts/filter-visibility-empty.js` — hides filter groups with no facet values ([docs](https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/custom-algolia-scripts/filter-visibility-empty))
- `starters-list-filter/custom-algolia-scripts/range-backfill-rate.js` — backfills the rate range control's bounds ([docs](https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/custom-algolia-scripts/range-backfill-rate))
- `starters-list-filter/custom-algolia-scripts/scroll-filter.js` — scroll handling for the filter column ([docs](https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/custom-algolia-scripts/scroll-filter))

### Algolia result modifiers (`algolia-result-modifiers/`)

Post-render transforms applied to Algolia hit markup; each carries its `// Docs:` URL.

- `algolia-result-modifiers/roles.js` — splits and labels a hit's roles values ([docs](https://wf-starter-embeds-docs.vercel.app/docs/algolia-result-modifiers/roles))
- `algolia-result-modifiers/companies.js` — renders a hit's work-history companies ([docs](https://wf-starter-embeds-docs.vercel.app/docs/algolia-result-modifiers/companies))
- `algolia-result-modifiers/learn-categories.js` — maps Learn category values to display labels ([docs](https://wf-starter-embeds-docs.vercel.app/docs/algolia-result-modifiers/learn-categories))
- `algolia-result-modifiers/price-label.js` — formats the price label on a hit ([docs](https://wf-starter-embeds-docs.vercel.app/docs/algolia-result-modifiers/price-label))

### Quiz page chrome (`quiz-main/`)

The quiz funnel's presentation layer, beside the controllers listed above. Not
covered by [`quiz-main/README.md`](quiz-main/README.md), which owns the data and
redirect contracts; these own tab UI only.

- `quiz-main/quiz-tabs.js` — the multi-step quiz tab controller: buttons, panels, Previous/Next, keyboard support, optional GSAP slide/fade, and navigation gating when no category or subcategory is selected. Exposes `tabWrap._quizTabController`
- `quiz-main/quiz-tabs-toggler.js` — shows or hides category sub-tab buttons and panels from the Categories form checkboxes, keeping Previous/Next disabled until at least one category is selected
- `quiz-main/quiz-page-theme.js` — repaints page background, section classes, and nav button themes when the active quiz tab or subcategory visibility changes
- `quiz-main/quiz-tooltip/quiz-tooltip.js` — Tippy tooltip on the Continue button while `data-nav-disabled` or `data-subcategory-nav-disabled` is set, on hover and keyboard focus; loads Tippy and Popper from CDN

### Freelancer CMS prefill (`freelancer-cms/`)

- `freelancer-cms/pre-fill-attr-val.js` — prefills form inputs from CMS-bound attribute values ([docs](https://wf-starter-embeds-docs.vercel.app/docs/freelancer-cms/pre-fill-attr-val))
- `freelancer-cms/prefill-ms-name.js` — prefills the member's name from Memberstack ([docs](https://wf-starter-embeds-docs.vercel.app/docs/freelancer-cms/prefill-ms-name))
- `freelancer-cms/datepicker-current.js` — seeds a datepicker with the current date ([docs](https://wf-starter-embeds-docs.vercel.app/docs/freelancer-cms/datepicker-current))

### Analytics helpers (`utils/`)

These two scripts have no Docs URL and no owner doc. The event plan named below
owns the shared event vocabulary, not the browser-script wiring.

- `utils/posthog-identity.js` — Memberstack to PostHog identity bridge: `posthog.identify(<memberstack id>)` with persona labels derived from the same customFields `opportunities-3.0.js` gates on, and `posthog.reset()` on logout when the previous identity was a member id so a shared browser cannot chain new anonymous events to the old member. Account ids and capability labels only, never email or name. Load sitewide with `defer`; the head snippet's stub queues calls, so it may run before array.js arrives
- `utils/posthog-track.js` — the shared `StartersTrack.track(name, props)` funnel-event helper: stamps a consistent `platform` (`v2` / `v3`) property and makes a missing or blocked PostHog unable to break page logic. Event names and properties are defined in `platform-ops/architecture/posthog-funnel-events-plan.md`; renames need a migration note there

### Other page scripts

- `complete-profile-photo.js` — `/complete-profile` Brand profile-image upload, host-scoped: binds Memberstack's supported `data-ms-action="profile-image"` uploader early (before `DOMContentLoaded`) on the native Webflow element rather than generating markup. The authoritative native markup and install contract lives in [`v3/BRAND-ACCOUNT-WIRING.md`](v3/BRAND-ACCOUNT-WIRING.md#native-markup-contract)
- `build-profile-draft-identity-guard.js` — synchronous build-profile draft guard that blocks the legacy localStorage key until Memberstack identity resolves, then routes it to member-scoped storage; see the [draft identity guard contract](#draft-identity-guard-waitformember-contract)
- `utils/multi-step-failover.js` — legacy build-profile availability probe that loads the mirrored Videsigns engine only when the upstream engine is missing or unavailable; see the [Build-profile Videsigns wiring audit](#build-profile-videsigns-wiring-audit)
- `swiper-scroll/swiper-scroll.js` — Swiper-backed horizontal scroll sections ([docs](https://wf-starter-embeds-docs.vercel.app/docs/swiper-scroll))
- `vendor/videsigns-multi-step.js` — vendored third-party multi-step form engine (upstream `videsigns/webflow-tools`), pinned and served from this repo so a release is reproducible rather than tracking the vendor's `@latest`. Do not edit; the build-profile funnel's pinning is asserted by build-profile-wiring-audit.js

### Legacy V2 (`v2/`)

Containment-era V2 code. Kept for the live V2 pages; not a pattern to copy.

- `v2/contract.js` — stale, partial earlier migration of legacy contract-form logic; it is not the live authority. The current mirrors and ownership boundary live in [`slater/README.md`](slater/README.md)
- `v2/footers/freelancer-start-project.js`, `v2/footers/freelancer-edit-form.js`, `v2/footers/quiz-results.js`, `v2/footers/opportunities-apply.js`, `v2/footers/opportunities-applicants.js`, `v2/footers/opportunities-freelancer-view.js` — secure V2 page footer logic, extracted from the sibling `-footer.html` files and CDN-loadable so each page can replace its inline block. Per-page CDN tags and the full contract live in [`v2/footers/README.md`](v2/footers/README.md)
- `v2/footers/freelancer-start-project-contract.js` — readable GitHub mirror of the Slater contract logic, kept for review but not loaded live; see the migration boundary in [`v2/footers/README.md`](v2/footers/README.md#freelancer-start-project--extra-slater-tag)

## Not browser code (deliberately outside this inventory)

- `build-profile-wiring-audit.js` — a Node audit tool (`require('node:fs')`) that checks the build-profile pages' saved Webflow code for the pinned vendored engine and the draft-identity guard. Never served to a browser
- `step-flow-test-dom.js` — the `global-embeds/step-flow/step-flow.js` test harness and its minimal DOM shim (`require('node:test')`). Named without the `.test.js` suffix, so run it explicitly
- `slater/4885.readable.js`, `slater/4885.prod.min.js`, `slater/4960.readable.js`, `slater/4960.prod.min.js` — read-only captures of the Slater.app builds that remain live on the legacy contract pages. Generated mirror artifacts: never edit or load them from this repo; the inventory and refresh contract lives in [`slater/README.md`](slater/README.md)

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

The controller only accepts a finished quiz payload. `quiz-main.js` saves
`sessionStorage.starterQuizPending` as a `draft` on every answer change and once
on `/quiz` load, so browsing the quiz alone leaves a payload behind; the results
page ignores a `draft` — without deleting it, because `quiz-loader.js` reads the
same key's `updatedAt`, the one exception being a marked member cache for a
logged-out visitor, covered next — and falls through to the saved-quiz lookup and
the `/quiz` redirect. The results page also caches a logged-in member's saved answers
under that same key, stamped with `memberstackSavedAt`; because `sessionStorage`
outlives logout, such a cached payload is deleted as soon as Memberstack
positively reports the visitor as logged out, so nobody inherits the previous
member's results, while an unmarked pre-signup payload is always kept and still
previews. Run the focused Algolia-config, taxonomy, saved-answer fallback,
draft-payload, and V3 lead-enrollment regressions with:

```sh
node --test quiz-results-config.test.js quiz-taxonomy-compatibility.test.js quiz-member-json-fallback.test.js quiz-results-pending-draft.test.js quiz-results-lead-drip.test.js
```

## V3 quiz-completion lead email

The normal V3 results flow registers a lead email event only after a finished
quiz has current Starter recommendations and the authenticated member's result
has saved successfully. A draft, URL test payload, failed save, or result with
no valid Starter never registers an event. The browser sends no recipient. It
posts the current result revision, up to three Starter records with first names
only, and one current category-matched Learn record to the authenticated
`quiz_email/enroll/v3` Xano endpoint. Each Starter's canonical Xano
`review_count` and `review_average` values, projected through Algolia, become
one-decimal email copy such as `4.8 (12 Reviews)` or `5.0 (1 Review)`; a zero,
missing, or invalid count or average produces no review text, with no fallback
to legacy review strings. For each Starter, the browser also sends
`reviews_display` as the allowlisted value `table-cell` when that review text
exists, or `none` otherwise, so Mailchimp removes the entire empty review cell.
Each Starter image comes from Algolia's canonical `profile-photo` field and
maps to the matching `starter_1_image_url`, `starter_2_image_url`, or
`starter_3_image_url` property; legacy photo-field aliases remain compatibility
fallbacks. Recommendations cached before these review fields were added refresh
before enrollment without changing the quiz revision. When no Learn record is
available, it sends the safe `/learn` fallback instead of leaving the email
empty.
The Memberstack session exchange accepts every response shape used by the
shared V3 trade-token endpoint: a raw string, `{authToken}`, or `{token}`.

The browser retries a failed registration twice, then leaves the saved result
available for a later page refresh. Xano owns recipient identity, suppression,
and event idempotency. A retake may refresh only a pending or failed event; it
must not restart a Mailchimp journey that Xano has already accepted. Mailchimp
owns the Kaeser HTML sends at H+1, D+2, and D+4, checks that the member still has
Brand Free before each send, and makes the active core drip skip only Email 2
for the `V3 Quiz Completed` tag. This V3 path does not change V2.

## Quiz-results email tester

The production tester is inert during the normal V3 results journey. It is
available only on `thestarters.com` or `www.thestarters.com` at
`/quiz-results?quizEmailTest=1`, for a signed-in member whose email is
`jp+brand10@thestarters.com`, and only when the page contains its native Webflow
markup. The sitewide V3 route guard recognizes that exact host, path, query, and
member combination so the paid-Brand canary can stay on the results page; every
other paid Brand visit keeps the normal `/brand-dashboard` redirect.
`quiz-results.js` hides that markup by default and loads
`quiz-results-email-tester.js` only when the query and markup gates pass; the
tester verifies the signed-in email before enabling Send and loads its scoped
stylesheet itself.

Author the panel in Webflow rather than generating it in JavaScript. Add these
custom attributes to the corresponding native elements:

| Attribute | Purpose |
| --- | --- |
| `data-quiz-email-test-panel` | Tester panel root |
| `data-quiz-email-test-recipient` | Fixed-recipient label |
| `data-quiz-email-test-summary` | Hydrated payload summary |
| `data-quiz-email-test-status` | Loading, error, and sent state |
| `data-quiz-email-test-send` | Send button |

Optional native controls may use `data-quiz-email-test-launcher` and
`data-quiz-email-test-close`. The controller never creates panel markup.

The browser waits for `quiz-results.js` to publish the compact quiz state that
was read from or saved to the current Memberstack member. It then refreshes the
three saved Starter IDs from `Freelancers3.0-dev`, selects current category
matches from `LearnContent`, and posts the rendered email through the
authenticated `quiz_email_test/send/v3` Xano endpoint. Xano is the security
boundary: it must authorize the dedicated production canary, replace any client
recipient with `jp+brand10@thestarters.com`, audit the attempt, enforce
idempotency and rate limits, and keep the Mandrill credential server-side.

Run the focused regression checks with:

```sh
node --test quiz-results-email-tester.test.js
```

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
The controller also synchronizes the three authored budget inputs
(`One-Time-Budget`, `Part-Time-Budget`, and `Full-Time-Budget`) so only the
budget for the selected Project Type is required. This prevents hidden budget
inputs from disabling the form's Submit control.
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

## V3 Scheduling Authentication

`v3/scheduling-auth.js` authenticates the explicit reviewed V3 endpoint
allowlist. Its authoritative host and path boundary is documented in the
[`v3/README.md` scheduling section](v3/README.md#scheduling-auth). It temporarily
retains the previous legacy availability/configuration/starter paths as exact
compatibility entries for staging pages that do not yet load the stage adapter.
It maintains a member-scoped token cache, adds `Authorization: Bearer <token>` without
changing the effective request method, body, or other options, and supports string,
`URL`, and `Request` inputs. Requests that already provide `Authorization`, other Xano
API groups, other origins, and calls outside the documented page boundary pass
through unchanged, except that scheduling-group requests on the protected production
`/hire/jp-dionisio` profile are contained with HTTP `410` as documented in the
authoritative boundary.

A scoped `401` clears the cached token, trades the current Memberstack JWT once,
and retries the same request once. A failed refresh preserves the original `401`.
Legacy plain-`fetch()` callers fall back to one unauthenticated request if initial token
acquisition fails; direct `window.xanoAuthFetch()` callers receive that error instead.
Network failures remain fetch rejections. A Memberstack account change invalidates both
token acquisition and in-flight scoped responses with `MEMBER_SCOPE_CHANGED`.

Load `v3/scheduling-auth.js` with `defer` on the pages approved in that boundary.
It installs before Memberstack is ready and supersedes the legacy
compatibility bridge in `opportunities-3.0.js` in either script order.

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/scheduling-auth.js"></script>
```

`v3/scheduling-v3-stage.js` installs an exact hostname/path-gated compatibility
adapter on the pages listed in the authoritative V3 scheduling boundary. It
rewrites reviewed legacy calls to V3 and sends them through `window.xanoAuthFetch`, blocks #1553,
transcription, `calendars/get_availabilities`, and every other unclassified
scheduling route, and retains only the approved legacy Stripe provider calls.
Use `v3/scheduling-v3-stage-component.html` as the first Code Embed in a clone
of the existing scheduling component. The shared component used by `detail_hire`
remains unchanged.

### Booking-stage availability controls

The authoritative host/path boundary, loader order, staging QA override,
authenticated read/write rules, and runtime contracts for the scheduling
availability controls live in [`v3/README.md`](v3/README.md#booking-stage-availability-initializer).

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

The Close modal's shared nav header may remain outside the form-flow steps. Author
its confirmation title with `data-opp-status="active"` and its success title with
`data-opp-status="closed"` inside the modal's `.modal_nav` bar; at runtime the
script upgrades those legacy status twins to a modal-local
`data-close-opp-title="confirm|success"` contract. Opening the modal always
restores the confirmation title, and only a successful Close mutation reveals the
success title. This avoids treating the shared brand-list modal as if it had one
document-level opportunity status.

Run the focused Close-modal title regressions with:

```sh
node --test opportunities-close-modal-title.test.js
```

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

## Opportunities 3.0 Project Dashboard Actions

`opportunities-3.0.js` binds project actions only on the exact
`/brand-dashboard` and `/starter-dashboard` routes, after Memberstack resolves a
paid Brand or Talent member respectively. On current dashboards it consumes the
rendered 12-item page range from the existing `dash-brand-projects` or
`dash-projects` wf-xano instance, so wf-xano remains the sole list owner and no
duplicate full-collection request is made. Refreshes replay only the loaded page
range so appended rows remain visible. Older surfaces without a wf-xano wrapper
retain a direct paged fallback through Xano `brand/projects/mine` or
`starter/projects/mine`. Each action must be inside an existing
`.project_item[data-wf-xano-id]`; that row id is the canonical `project_id`. The
controller decorates Webflow-authored controls and never creates project-card,
modal, form, or button markup. At dashboard bootstrap, the controller marks every
authored `[wf-xano-element="details-target"]` inside that instance's template
with `wf-xano-lazy-details`, so wf-xano can defer the project disclosure's nested
hydration until the member opens it instead of hydrating every disclosure on the
12-item page during first render. Within that lazy details target, the
`project_scope_details` nest target's `[wf-xano-bind="value"]` preserves
authored newline characters as visible line breaks and wraps unbroken long words
instead of widening the project card. The legacy direct
`[wf-xano-bind="project_scope"]` selector remains supported during rollout.

The shared Project timeline value is repainted from each canonical project's
`start_date` and `end_date` (falling back to `estimated_end_date`) as a readable
calendar range. The current Webflow component renders it as the
`wf-xano-bind="value"` inside the `contract_details` nested row whose bound label
is `Project timeline`; a direct `wf-xano-bind="timeline_display"` remains a
forward-compatible fallback. Same-month ranges collapse
to `August 6–31, 2026`; cross-month ranges use
`August 28 – September 12, 2026`; cross-year ranges keep both years; and a
missing end date reads `Starting August 6, 2026 · Ongoing`. A valid end date
without a start date reads `Ends August 4, 2026` instead of exposing an
ambiguous ISO fragment. Date-only values
are parsed as calendar parts so the label cannot shift a day across timezones.
Malformed values leave the Xano-authored timeline value unchanged, whether it
comes from the nested contract-detail row or the direct `timeline_display`
fallback.

The contract signing panel is Webflow-authored native markup. Put
`data-project-contract-panel`, the native `hidden` attribute, and
`aria-hidden="true"` on its root so placeholder copy cannot flash or remain
visible when the controller does not boot. The controller removes `hidden`
only after canonical project state authorizes the panel. Put `data-project-contract-title` and
`data-project-contract-body` on its status copy, and
`data-project-contract-actions` around its actions. Author four badge variants,
one each with `data-project-contract-badge="brand-pending"`, `"brand-signed"`,
`"starter-pending"`, or `"starter-signed"`, and separate
`data-project-contract-action="sign"` and `"view"` controls. The
controller changes text and visibility only; it does not generate panel, badge,
or action markup. The compact project-row control may remain
`a[href="#contract"]` or `[data-project-action="contract"]`; the controller
keeps its label and action synchronized with the panel.

The panel is limited to canonical V3 Standard Contracts: `sync_origin` must be
`v3` and `contract_source` must be `standard`. Own-contract rows and active,
request, completed, terminated, or canceled lifecycle states hide it. Each
visible panel shows exactly one Brand badge and one Starter badge from the
canonical `brand_signed_at` and `starter_signed_at` values. Brand signs first.
Before the Brand signs, only the Brand receives Review & Sign Contract; the
Starter sees a waiting state without an action. After the Brand signs, the Brand
receives View Contract and only the Starter receives Review & Sign Contract.
Inconsistent partial or out-of-order signature state shows an attention state
without an action. Draft or queued state shows preparation status, and provider
failure states show the help message without an action. After both signatures,
the panel shows activation processing without another signing action.

Both sign and view request a fresh recipient-scoped URL from authenticated Xano
`contracts/link/v3`. The URL opens in a new tab when the browser permits it and
falls back to the current tab. No PandaDoc credential or stored contract URL is
exposed in the page. Xano rechecks project ownership, environment, canonical
contract state, and the live PandaDoc document status before minting the one-hour
session. A completed document offers no recipient-session action; protected-PDF
delivery still requires a separate authenticated endpoint.
Immediately before a click, the controller must refresh canonical project state;
a failed or inconsistent refresh does not fall back to cached authorization. A
missing or rejected session closes the pre-opened blank tab and shows only the
generic `Contract is unavailable. Please try again.` message. Returning from
PandaDoc refreshes the loaded project page range on `pageshow`, window `focus`,
or when the page becomes visible. The `focus` path covers a separate PandaDoc
window that never hides the dashboard. The panel repaints from canonical
signature state without discarding pagination.

The Webflow-authored panel and compact action fail closed from dashboard boot:
they stay hidden while Memberstack resolves, while the project list is pending or
unavailable, and when a project card renders before its canonical row. The
separate Starter invoice control is unchanged.

The existing `[wf-xano-link="project-end"]` control is upgraded to
`data-project-action="end"`. Its label and mutation follow canonical lifecycle
state, except that canonical `status=pending` takes precedence over a more specific
`lifecycle_state` and always exposes the authorized cancel action. Active projects
can request completion or an early termination with a required reason, and a
counterparty can confirm a pending completion or termination request. Terminal
projects expose no lifecycle action. Immediately before every mutation the
controller refreshes the canonical project, requires a nonnegative
`lifecycle_version`, and posts `project_id`, `expected_version`, `action`, `reason`,
and a retry-stable idempotency key to `projects/action/v3`. A stale-version response
refreshes the project list and asks the member to retry instead of replaying an
obsolete intent.

Brand-only Review Starter controls accept `[wf-xano-link="review_starter"]` or
`[data-project-action="review"]` and appear only when Xano reports
`review_eligible` without an existing review. The existing
`data-modal-target="rate-starter-call"` form submits a 1–5 rating and 10–4,000
character public review to authenticated `brand/reviews/submit`, reusing its
idempotency key across retries. Private Feedback stays hidden because this flow
does not send private Starter feedback. Starter sessions never receive review
submission wiring.

The modal is resolved from `window.lumos.modal.list['rate-starter-call'].el`,
not the first matching dialog in document order. This matters while the Brand
dashboard contains both the legacy rate-call dialog and the live End Project &
Review dialog with the same target. The live dialog's `[Starter Name]` text is
filled only from that card's canonical `starter_name` in the `#1600` project
projection. A missing project, missing Starter name, or modal without an
authored name placeholder blocks the open. If card clicks overlap, only the
latest click may open the modal; an older canonical lookup that resolves later
is discarded. Closing the dialog clears the painted name and pending project
context. The submit adapter accepts the live `Feedback` field and the legacy
`Public-Feedback` field during the authored surface transition.

All project-action listeners, cached rows, and pending review context are
discarded when the signed-in Memberstack account changes. The new account must
pass the exact route and stable plan-role gate before the workflow can bind
again. These browser actions use only the Memberstack-to-Xano authentication
bridge; they do not expose Airtable, Make, PandaDoc, or other service credentials.

Run the focused project-action regressions with:

```sh
node --test opportunities-3.0-auth.test.js
```

## Opportunities 3.0 Invoice Generation

`opportunities-3.0.js` drives the Webflow-authored Generate Invoice modal used by
the Starter dashboard project list. The delegation is armed only after the
Starter dashboard resolves an authenticated Talent member (and on the internal
`/all-modals` component-preview page); Brand dashboard sessions never receive
the invoice click or submit behavior. It binds
only existing elements and generates no markup, and it does not touch the V2
Airtable/Make invoice chain; the browser holds no Airtable or Make credentials.

Author the invoice control on each project card as
`data-project-action="invoice"` (a plain `a[href="#generate-invoice"]` is also
accepted), inside the card element that already carries the wf-xano row id
`data-wf-xano-id`. That id is the `project_id` the invoice bills, so a control
outside a card cannot start the flow: the click is left to `modal.js`'s own
trigger delegation and the mismatch is logged. The dialog itself stays the
native `dialog[data-modal-target="generate-invoice"]` component, opened through
`window.lumos.modal`'s registry so its paused GSAP entrance timeline, scroll
lock, and focus restore all still run; direct `showModal()` remains only as a
fallback for pages without `modal.js`.

The modal keeps its authored Webflow form. The shared button component currently
renders the visible Send Invoice control as `type="button"` even with its Button
Type prop enabled, so a click would never reach the form. A narrow fallback
converts that one click into the form's native `requestSubmit()`, which keeps
Webflow's own constraint validation and every gate below. It only fires for the
control inside `form#wf-form-Generate-Invoice` when that form sits inside the
`generate-invoice` dialog, and it resolves that control in one place: an
authored `[data-wf-invoice="submit"]` wins, then a real `[type="submit"]` (which
needs no fallback and is left alone), and only then the single
`[data-button-style="primary"]` wrapper in the form. `data-button-style` is a
theming attribute rather than a behaviour hook, so a second primary-styled
button in that form makes the inference ambiguous and the fallback fails closed
with a console warning instead of turning another button into an invoice submit
— author `[data-wf-invoice="submit"]` on the Send Invoice `.button_main-wrap` to
settle it. A wrapper marked disabled by attribute (`data-validate-disabled`,
`data-button-theme="disabled"`, `aria-disabled="true"`) is never converted.

`Amount` and `Description` are resolved by id or input name. The amount is
rounded to cents and must land between $0.01 and $1,000,000, otherwise the
inline message `Enter an amount between $0.01 and $1,000,000.` is shown and
nothing is sent. A submit from a modal that was opened without a project card
fails closed with `Open Generate Invoice from the project you want to bill, so
we know which project to invoice.`.

A valid submit posts `project_id`, `amount`, `description`, and
`idempotency_key` to Xano `POST invoices/create/v3` through the same
authenticated Memberstack-to-Xano bridge as the rest of the file. The
idempotency key (`invoice-v3-<project_id>-<uuid>`) is stored on the form, so a
retry after a failure reuses it and is cleared once an invoice is created. The
resolved submit control is disabled while the request is in flight, by the same
design-system convention `form-validation.js` uses: the wrapper takes
`aria-disabled="true"`; when it already has a `data-button-theme`, that theme is
temporarily replaced with `disabled` and restored afterwards. The actionable
element inside the wrapper takes the native `disabled` property, so a second
click is visibly refused. After a success the
wf-xano project list is refreshed best-effort; a failed refresh never reports a
created invoice as failed.

Keep these markup contracts in the modal:

- `[data-wf-invoice-bind="brand|project|amount|status"]` receive the billed
  brand, project title, formatted amount, and returned status (`unpaid` when the
  response omits one). Brand and project come from the card's usual field binds
  (`wf-xano-bind`, `wf-algolia-text`, or `data-opp-bind`): `title`, plus the
  first present of `brand`, `company`, and `company_name`, with the last segment
  of a pipe-separated `heading_display` heading as the only fallback.
- The pay CTA is the anchor whose authored placeholder href is
  `#invoice-payment-link`; the script stamps it with
  `data-wf-invoice="payment-link"` on first use and rewrites the href to the
  Stripe payment link, opened in a new tab. Its `.button_main-wrap` wrapper is
  hidden when the response carries no link, and reopening the modal restores the
  placeholder href, so a stale Stripe link is never left behind the button for a
  later invoice.
- Errors need `[data-wf-invoice="error"]` (the Webflow `.w-form-fail` block is
  accepted) and optionally `[data-wf-invoice="error-message"]` inside it. With
  neither present the failure is only a console warning, invisible to the member.

A Xano refusal for a Talent member with no connected Stripe account is
translated into the actionable message `Connect your Stripe account from the
dashboard before generating invoices.`; the connect flow itself is owned by the
[`v3/README.md` Stripe Connect section](v3/README.md#starter-dashboard-stripe-connect).

Run the focused invoice regressions with:

```sh
node --test opportunities-3.0-auth.test.js
```

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

## Build-profile Videsigns wiring audit

`/build-profile/full-profile` and `/build-profile/consult` must each load exactly one
Videsigns multistep engine. The approved source is the repository mirror at a pinned
semver tag:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@vX.Y.Z/vendor/videsigns-multi-step.js"></script>
```

Do not also load `videsigns/webflow-tools`. The legacy
`utils/multi-step-failover.js` probe may remain while it is a no-op in the presence
of the pinned mirror; it is not an engine. The Videsigns engine completes through a synthetic
click on `[form-submit]`; each page's authoritative Xano writer must therefore keep
its direct `[form-submit]` click handler instead of relying only on a native form
`submit` event.

After an authenticated fetch of both published pages, run:

```sh
node build-profile-wiring-audit.js \
  /build-profile/full-profile /path/to/full-profile.html \
  /build-profile/consult /path/to/consult.html
```

The audit fails for duplicate/unpinned engines, a missing Xano endpoint or
`[form-submit]` control, a native-submit-only
authoritative handler, or a draft identity guard that is missing, duplicated,
unpinned, `async`/`defer`, or placed after the first legacy `build_profile`
storage access (it must load synchronously ahead of any authored draft code —
see below).

Run its focused test with:

```sh
node --test build-profile-wiring-audit.test.js
```

### Draft identity guard `waitForMember` contract

`build-profile-draft-identity-guard.js` loads synchronously in the page head and
routes the legacy `build_profile` localStorage key to a member-scoped physical key.
Reads of the legacy key return `null` until the stable Memberstack member ID
resolves, so a load-time draft restore that reads synchronously would race that
window and never repopulate the member's own draft. Any authored draft restore
must therefore run inside the guard's `waitForMember` gate — exposed both as
`window.waitForMember` and as `window.__TS_BUILD_PROFILE_DRAFT_GUARD__.waitForMember`:

```js
waitForMember(function (member) {
  // identity has resolved; the legacy read now returns the member-scoped draft
  const draft = localStorage.getItem('build_profile')
  // …repopulate the form
})
```

The gate resolves in every terminal state (`ready`, `anonymous`, `blocked`),
passing the resolved member (or `null`) and returning a promise for the callback's
return value, so anonymous and blocked sessions still initialize with an empty
form. Run its focused test with:

```sh
node --test build-profile-draft-identity-guard.test.js
```
