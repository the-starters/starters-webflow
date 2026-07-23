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
- For Webflow footer work, prefer loading scripts from the GitHub/jsDelivr CDN at `@latest` with `defer`, so new tagged releases do not require a Webflow URL edit.

## Current Scripts

- `quiz-results.js` — quiz-results controller; logged-out visitors with no pending, test, or saved quiz data return to `/quiz`
- `quiz-results.min.js`
- `opportunities-3.0.js` — Opportunities 3.0 page and starter-dashboard binder, including category-matched and applied starter feeds
- `v3/auth-route.js` — V3-only login/signup router with plan-based defaults and role-scoped `next` destinations
- `v3/route-guard.js` — V3-only direct-access guard for protected, role-scoped pages
- `v3/scheduling-auth.js` — staging-only availability and scheduling authentication bridge
- `v3/scheduling-availability-init.js` — staging-only booking-stage availability control initializer
- `opportunities-3.0-debug.js` — query-gated opportunity matching QA implementation
- `v3/messages.js` — self-contained Memberstack + TalkJS inbox bootstrap for `/messages`
- `opportunities---create.js`
- `starters-list/apply-button-disable.js`
- `starters-list/range-backfill.js`
- `utils/loader.js` — env-switch script loader (`loadEnvScript`)
- `utils/wf-validate.js` — declarative form validation (see below)
- `explore-search/explore-search-chip-fill.js` — chip click copies its text into the search input, fires the engine's `input` event, announces `explore-search:commit`
- `explore-search/explore-search-tab-counts.js` — live per-index hit counts for the tab bar (intercepts the engine's own Algolia responses; zero extra operations)
- `explore-search/explore-search-most-searched.js` — dynamic "Most Searched" chips from an Algolia Query Suggestions index, via a designer-owned template
- `explore-search/explore-search-recent-searches.js` — the user's recent searches as chips, persisted in localStorage, recorded via `explore-search:commit`
- `explore-search/explore-search-default-results.js` — keeps results visible on an empty query and fills each federated section with its index's default ranking
- `explore-search/explore-search-hide-empty.js` — hides `[starters-algolia-hide]` wrappers while all their Algolia sections are empty
- `explore-search/explore-search-list-loader.js` — shows a loader and masks list jank during result transitions (arms on first user interaction; force-hides the loader at init)
- `explore-search/explore-search.css` — search-brilliance page styles (filter checkboxes/radios, result grids, selected-filter reveal, loader)
- Local demo/harness pages (e.g. the explore-search and generate-contract demos) live in the gitignored `local-demos/` folder — not committed; serve via `./dev-tunnel.sh` to view.
- `explore-search-transitions/explore-search-transitions.js` — search overlay open/close transitions (GSAP timelines, inert-locked closed state)
- `explore-search-transitions/explore-search-transitions.css` — companion styles for the search overlay transitions
- `navbar-embeds/navbar-dropdown.css` — mobile (<=767px) navbar dropdown open/close height transition via `grid-template-rows`
- `navbar-embeds/navlinks.css` — hides gated nav link groups until Memberstack gating adds `.ms-nav-ready`; Designer per-variant preview
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

## Opportunities 3.0 Starter Matching

Load `opportunities-3.0.js` on `/opportunities-freelancer-view` and
`/starter-dashboard` from the existing `@latest` jsDelivr path:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/opportunities-3.0.js"></script>
```

On V3, load `v3/route-guard.js` sitewide before this script. When the guard's
`html[data-route-guard]` stamp is present, Opportunities 3.0 uses stable plan
IDs to scope role-specific work but leaves all access redirects to the guard.
Until the guard is installed, its legacy Memberstack custom-field redirects
remain as a backward-compatible fallback. See
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

Append `?opp_debug=1` to either `/starter-dashboard` or
`/opportunities-freelancer-view` to load the shared, authenticated matching QA panel.
The values `1`, `true`, `yes`, and `on` are accepted case-insensitively; other values
leave QA mode disabled. While enabled, `data-opp30-match-debug` on the document root
reports `loading`, `pass`, `check`, or `error`.

The production binder lazy-loads `opportunities-3.0-debug.js`, which then loads
`lil-gui@0.21.0`; neither debug script, the library, nor the extra Xano reads run for
normal visitors. Same-origin dashboard links to `/opportunities-freelancer-view`,
including View all, keep the query parameter so a tester can inspect both surfaces in
one session.

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

- Roles: `wf-validate-element="form | error | message | count | submit"`. Error/count
  slots bind to the nearest field, or explicitly via `wf-validate-for="<input name>"`.
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
