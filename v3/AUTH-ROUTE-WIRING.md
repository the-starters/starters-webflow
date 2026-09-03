# V3 Auth Route Wiring

Status: Live router. The minimal `auth-page-loader.js` site-head wiring is a
release candidate and is not live yet. The Talent funnel check described below
moved to `get_build_profile_status` on 2026-08-04.

## Webflow

1. Create a V3 utility page with slug `/auth-route`.
2. Give the page a visible loading state and an error block keyed by
   `html[data-auth-route-error]`.
3. Keep the synchronous Memberstack V2 tag and the shared `window.memberReady`
   initializer in the site Head Code. They must execute before the loader.
4. **Leave the sitewide `route-guard.js` tag exactly as it is** — a static,
   parser-blocking, unconditional head tag on every page, ahead of the loader,
   per step 1 of [ROUTE-GUARD-WIRING.md](ROUTE-GUARD-WIRING.md#webflow-install).
   It must never move behind `StartersV3AuthPageLoader` or any other
   CDN-dependent conditional. Same for `v3/signup-attribution.js` (see step 7).

   This tag is the **sole owner** of route-guard delivery and of
   guard-before-router ordering, on all three auth paths as well as everywhere
   else. The loader never inserts a second copy: the static tag sits ahead of it
   in the head, so the guard has already executed before the loader's script
   body runs. A duplicate insertion would download 43 KB — uncached whenever the
   two tags sit on different release refs — only to hit the guard's own boot
   guard and return.

   `route-guard.js` owns the sitewide stable plan-ID role contract, and every
   page-level controller that reads `window.StartersV3RouteGuard` —
   `build-profile-redirect.js`, `complete-profile-redirect.js`,
   `starter-profile-redirect.js`, `messages-profile.js`,
   `opportunities-3.0.js` — fails open to a `null` role and silently stays put
   if the guard has not executed by the time its own tag runs. Its
   `/memberstack/search-freelancers` compatibility redirect must not sit behind
   a CDN round trip either. Gating it would put every page of the site behind
   the loader's availability.
5. Install `v3/auth-page-loader.js` once in the site Head Code with a normal
   blocking script tag, after `route-guard.js` and `memberReady` and before the
   conditional application block. Do not add `defer`; the condition must be
   available to the following inline block. Use the same release ref as its
   child asset. The loader inserts `auth-route.js`, and only on `/login`,
   `/starter-login`, and `/auth-route`. On every other path it inserts nothing.
   It never inserts `route-guard.js` (step 4). If the loader cannot read its own
   `src` it installs nothing rather than falling back to a different release
   ref.

   ```html
   <script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@RELEASE/v3/auth-page-loader.js"></script>
   ```
6. **Overlap-safe cutover for the page-level `auth-route.js` tags.** The
   page-level tag is the only tag the loader replaces, and it is the only
   unconditional way `auth-route.js` reaches a login page. Do not remove it in
   the same edit that installs the loader — a loader that 404s before the
   jsDelivr purge lands, or that is CSP- or extension-blocked, would leave the
   form with no `redirect="/auth-route"` at all and drop the login onto the
   shared Memberstack plan redirect, skipping the Talent funnel check and the
   `next` allowlist. Run it in this order instead:

   1. **Save an exact readback first.** Copy the current saved head/page blocks
      for `/login`, `/starter-login`, and `/auth-route` verbatim, byte for
      byte. These are the rollback targets; nothing below is reversible without
      them, and a hand-reconstructed block is not a rollback.
   2. **Install the loader with the page-level tags still in place.** Both are
      safe simultaneously: `auth-route.js` boot-guards on
      `window.__startersV3AuthRouterBooted` (`v3/auth-route.js:75`), so exactly
      one of the two copies executes and the other returns at its first
      statement. **One auth-router execution is the expected result of this
      step, not evidence that the loader failed.** This overlap window is the
      intended state.
   3. **Prove loader DELIVERY on all three auth paths.** During overlap the
      boot guard hides which copy ran, so this step deliberately proves
      delivery only. On each of `/login`, `/starter-login`, and `/auth-route`:

      - Find the loader's own element, not any page-level tag:
        `document.querySelector('script[data-starters-auth-runtime="auth-route"]').src`
        must be exactly
        `https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.506/v3/auth-route.js`.
      - That request must have a successful (2xx, non-`from disk cache`-only)
        network response in the Network panel.
      - The served bytes must match the release: compare
        `shasum -a 256` of `curl -fsS <that exact URL>` against the same hash
        taken from the tagged file in this repo.

      Do **not** read `window.StartersV3AuthRouter.release`, the form's
      `data-ms-redirect`/`redirect` attributes, or an end-to-end login as proof
      of the loader here. A parser-inserted page-level tag is reached before
      the loader's `appendChild`ed script can finish fetching, so it wins the
      boot guard and every one of those observations describes the page-level
      copy — the very fallback this cutover is removing.
   4. **Prove loader BEHAVIOR with the fallback disabled, one path at a time.**
      This is the actual gate, and it is the first step that observes the
      loader's copy executing. For one path: remove its page-level
      `auth-route.js` tag, then confirm `window.StartersV3AuthRouter.release`
      reports `v1.59.506`, the form carries both `data-ms-redirect` and
      `redirect` set to `/auth-route`, and one real login completes end to end
      through `/auth-route`. Repeat per path; do not batch.
   5. **Scope.** Steps 2–4 all edit and save Webflow custom code. They are out
      of scope for this repository change and must not be performed until a
      later, explicitly authorized Webflow save/publish window. Nothing in this
      release touches Webflow.
   6. **Rollback** is restoring the step-1 readback for the affected path
      verbatim. Do not hand-reconstruct a block.
7. Put the application controllers that are unrelated to authentication and
   attribution behind this exact test, which **must fail open** when the loader
   asset never arrived:

   ```js
   var loader = window.StartersV3AuthPageLoader
   if (
     !loader ||
     loader.shouldLoadApplicationControllers(window.location.pathname)
   ) {
     // emit the controller tags here
   }
   ```

   A missing `window.StartersV3AuthPageLoader` — a 404 before the jsDelivr
   purge lands, a CSP block, an extension — must emit the full block rather
   than throw a TypeError and emit nothing. The loader answers true itself
   whenever it will not or cannot install its own runtime (unapproved host, or
   an underivable base), so a degraded loader never leaves a page with no
   runtime at all.

   **Ordering invariant.** The block must emit its tags while the parser is
   still blocked on it (`document.write` from the inline head script, not
   `appendChild`), so page-level controllers still execute after them.

   A false answer must emit none of `wf-xano`, the Xano SDK, PostHog helpers,
   validation, `opportunities-3.0.js`, project controllers, dashboard action
   items, Brand account, Algolia environment, or `wf-algolia`. **Keep
   `v3/signup-attribution.js` out of this block and unconditional sitewide.**
   Its `captureUrlParams()` writes `utm_*`, `fbclid`, and the `_fbc`/`_fbp`
   copies on every page load, and a paid click can land directly on
   `/login?utm_source=…`; omitting it there would drop attribution for any
   signup later in that session. Its signup-transition watch already excludes
   both login paths by name, so nothing else about it runs there. Keep the
   remaining controllers' existing order and inline configuration unchanged
   when the answer is true. Build the complete candidate from a fresh
   full-block readback and preserve every non-controller sentinel.
8. `/starter-login` is a real V3 login page. The loader includes it in the same
   minimal path as `/login`, so both forms pass through `/auth-route`.
9. Do not add the router to `/sign-up`. `v3/starters-ms-redirect.js` owns signup
   form redirects through its `starters-ms-redirect` markers and skips any form
   that already carries a non-empty `redirect` attribute; configuring `/sign-up`
   here would set that attribute first and silently disable the marker system.
10. Do not install either script on V2.
11. The auth script changes V3 login/signup forms to
   `data-ms-redirect="/auth-route"`. It also sets a plain
   `redirect="/auth-route"` attribute on the same forms, because Memberstack only
   picks up `data-ms-redirect` from a click listener, so an Enter-key submit
   would otherwise skip `/auth-route` entirely and use the server-side plan
   redirect.

The router runs only on `the-starters-3-0.webflow.io`, `thestarters.com`, and
`www.thestarters.com`, and only at those three exact paths — the two login pages,
where it rewrites form redirects and stores a `?next=`, and `/auth-route`, where
it actually routes. Keep the shared Memberstack plan redirects unchanged so V2
retains its existing behavior.

Both login pages are also member-home bounce pages in `v3/route-guard.js`: a
member who is *already* signed in is redirected away before they see the form.
The two mechanisms do not conflict — the guard acts on an existing session, this
router configures the form for a session about to be created — but note that a
bounce leaves the `next` this router just stored in session storage unconsumed.
That is harmless; it is re-validated against the role allowlist at `/auth-route`
on the next real login.

## Timing evidence

The login form starts a timestamp-only receipt in session storage. The router
emits fixed `performance.mark()` names for router boot, Memberstack ready,
member snapshot, token trade, status read, and redirect request. The sitewide
loader emits `destination-load` on the final non-auth page and consumes the
receipt. The receipt contains only `startedAt` and, once confirmed,
`redirectedAt`. Events and marks never contain a member ID, email, cookie, Xano
token, or requested destination.

Only a completed login-to-destination flow can be measured. `/auth-route` stamps
`redirectedAt` on the receipt at the moment it hands off, and the loader refuses
to emit `destination-load` for a receipt without it. A login page boot clears
any receipt it finds, and the logged-out bounce back to `/login` clears it too,
so a rejected password or an abandoned login page can never be read later as a
login-to-destination duration.

The loader validates and **consumes** the receipt at its own boot on the
destination page, keeping only `startedAt`, and emits on `load`. `elapsedMs` is
measured in the `load` handler, so it spans login submit through the destination
page's own load — the interval the label names — while a destination the member
abandons before `load` yields no event at all rather than leaving an inflated
receipt for the next navigation.

Listen for `starters:v3-auth-route-timing`. Its detail contains `stage` and,
when the cross-page receipt is present, `elapsedMs`. Receipts older than two
minutes are discarded.

The initial member read is one direct `$memberstackDom.getCurrentMember()` call.
It deliberately does **not** reuse `window.memberReady`'s resolved value: on
this site that promise resolves an empty object for every visitor, logged in or
not, so it carries no identity to reuse and awaiting it would only add latency
and an unbounded wait to the one page this change exists to speed up. See
[`global-embeds/session-video/README.md`](../global-embeds/session-video/README.md#membership-resolution).

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

## Talent funnel position

The product flow is Apply, then Build profile, then Login, then Onboarding, then
Dashboard. `/auth-route` is the one page every Talent login passes through, so the
router asks Xano where in that flow the member actually is and routes accordingly.

The Talent check runs for the Talent role only. Brand free, unmapped, and
conflicted members never trigger a Xano request. **Paid Brands** take the separate
Brand profile funnel below (added 2026-08-06) — they are no longer zero-network.

### The funnel-status endpoint

```
GET api:KZf7nFnk/starters_onboarding/get_build_profile_status
Authorization: Bearer <token from the trade-token flow>
```

No inputs. The member is derived from the bearer token, and the endpoint answers
401 without a valid one. Same API group and auth table (`user_v3`) as
`get_freelancers`.

```json
{
  "has_record": true,
  "build_profile_done": true,
  "onboarding_done": false,
  "profile_type": "Full",
  "platform_status": "…"
}
```

`build_profile_done` is true only when a `freelancers_v3` row exists **and** its
`profile_type_30` column is non-empty. That column is stamped by
`build_profile/starter/update` when the form is submitted, so it is the first
signal that means "the member actually finished this step".

**Why it replaced the old read (2026-08-04).** The router used to read
`get_freelancers` and treat "a row came back" as "past Build profile". The row is
created before the member finishes the form, so that test was wrong for anyone
who started and abandoned it: **282 of 955 `freelancers_v3` rows carry an empty
`profile_type_30`**, and all 282 of those members were being routed on to
`/starter-onboarding` instead of back to the step they had not completed.

Two more facts from the same full-table pass, both worth knowing before QA:
`onboarding_done` is true on **zero** rows today, so the third row of the table
below is currently unexercised in production data, and `profile_type` has only
ever been `"Full"` so far. `has_record` is returned but deliberately unread — it
is precisely the signal that caused the bug.

### Routing table

| Funnel status | Destination |
| --- | --- |
| `build_profile_done` false (whether or not `has_record`) | `/build-profile/select-profile` |
| `build_profile_done` true, `onboarding_done` not `true` | `/starter-onboarding`, which wins over any `?next=` or stored destination |
| `build_profile_done` true, `onboarding_done === true` | Normal routing: the validated `next`, else the role home |
| Any Xano failure, an unreadable body, or the check exceeding its 8 second budget | Normal routing (fail open) |

The requested destination is consumed before the check runs, so a `next` that
loses to the funnel is dropped rather than replayed on the next login.

The body is read strictly in both directions, and here the strictness matters
because the three answers route three different ways while only "inconclusive"
fails open. Only a literal `false` on `build_profile_done` earns the
`/build-profile/select-profile` redirect; anything else non-`true` (missing,
null, a string) is a body the router does not understand, so the standard
destination wins. Only a literal `true` on `onboarding_done` reads as onboarded,
so a missing or odd value biases toward sending the member into onboarding rather
than past it.

Reads use the same trade-token flow as the sibling V3 modules: the Memberstack
JWT from `getMemberCookie()` is traded at `api:g1vmSLWh/auth/trade-token/v3` for
a Xano token, which authorizes the status endpoint as a bearer.

The 8 second budget is one overall deadline for the trade plus the read, not a
per-request timeout, because the member is looking at a blank hop page while it
runs. On expiry the shared `AbortController` cancels the in-flight request and
routing continues as if the check had never happened. Fail-open is unchanged by
the endpoint migration, and every other failure path behaves the same way: logged
out of Memberstack, a rejected trade, a 401, a 500, an unparseable body, a body
without a boolean `build_profile_done`, or a browser without `fetch`.

This is funnel UX, not a security boundary. `/starter-onboarding` itself remains
guarded by `v3/route-guard.js`, and `v3/onboarding-done-redirect.js` still
bounces a finished member off that page.

## Brand profile funnel (paid Brand only, 2026-08-06)

Paid Brands get the same "where is this member" question at login, from the mirror
endpoint:

```
GET api:KZf7nFnk/starters_onboarding/get_brand_profile_status
→ {"has_record": bool, "brand_profile_done": bool}
```

Same no-input bearer shape, same single 8s budget, same fail-open rule.

| Brand profile status | Destination |
| --- | --- |
| `sessionStorage` marker `thestarters:v3-brand-profile-completed` set | Normal routing (no Xano call) |
| `has_record` true AND `brand_profile_done` false | `/complete-profile`, wins over any stored or query `next` |
| anything else (done, no record, error, timeout, malformed) | Normal routing |

Scope is `brand-paid` only. `brand-free` has no `/complete-profile` form.
Existing brands are grandfathered `brand_profile_done: true` in `brands_v3`, so
in practice only new signups are diverted. The marker is written by
`v3/brand-account-controller.js` after a successful submit and read here (and by
both redirect halves) so the Memberstack → Xano webhook catch-up window cannot
bounce a fresh completer. `/complete-profile` is deliberately **not** an allowed
`next` — the router constructs that destination, never accepts it from the client.

An optional `?next=` destination survives login only when it is same-origin and
allowlisted for the authenticated role. This prevents an open redirect and prevents
Talent/Brand cross-role routing. Query strings are preserved and fragments are
removed. Invalid or disallowed destinations fall back to the role default.
`/dashboard` is a special canonical destination: every mapped role may request
it, but the auth router resolves it directly to that role's home instead of
returning to `/dashboard`, preventing a redirect loop.

| Role | Allowed `next` pathnames |
| --- | --- |
| Talent | `/dashboard` (resolved to home), `/starter-dashboard`, `/starter-onboarding`, `/build-profile/select-profile`, `/build-profile/full-profile`, `/build-profile/consult`, `/starter-edit-profile`, `/messages`, `/opportunities`, `/opportunities/`, `/opportunities-freelancer-view`, `/opportunities/<slug>`, `/generate-invoice`, `/generate-invoice/` |
| Brand paid | `/dashboard` (resolved to home), `/all-starters`, `/brand-dashboard`, `/opportunities`, `/opportunities/`, `/opportunities-brands-view`, `/messages`, `/opportunities/<slug>`, `/opportunities---create` |
| Brand free | `/dashboard` (resolved to quiz home), `/all-starters`, `/quiz`, `/quiz-results` |

`/starter-onboarding` is allowlisted for Talent because `v3/route-guard.js`
sends a logged-out visitor there through `/login?next=/starter-onboarding`.
Without the entry that round trip silently dropped the destination and landed on
`/starter-dashboard`.

`/complete-profile` is deliberately not allowlisted (decision 2026-08-03).
Memberstack's `restrict-pages` gated group is the page's sole gate and redirects
to `/login` with no `?next=`, so there is no round trip for this router to close;
`v3/route-guard.js` does not list the page either. A paid Brand asking for it as a
`next` lands on `/brand-dashboard`.

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
and `brandFreeHome`, plus the funnel helpers `stagingHost`,
`diagnosticsEnabled`, `funnelStateFrom`, `onboardingFunnelState`,
`onboardingPath`, `buildProfilePath`, and `checkBudgetMs`, the login-page scope
helpers `isLoginPath` and `loginPaths`, and `release` (the shipping tag; see the
release-marker convention in [ROUTE-GUARD-WIRING.md](ROUTE-GUARD-WIRING.md)).
The loader exposes `window.StartersV3AuthPageLoader` with `isAuthPath`,
`isApprovedHost`, `shouldLoadApplicationControllers`, `authPaths`, and
`release`. The timing receipt has no public entry point: reading it consumes
it, so it is driven only from the loader's own boot path.

`funnelStateFrom` replaced `onboardingStateFrom` in v1.59.82: it takes a status
body rather than a freelancer envelope and answers `'build-profile'`,
`'onboarding'`, `'done'`, or `'unknown'`.

The funnel never produces a `data-auth-route-error`; it fails open instead. It
narrates each decision to the console (which state was found, where routing
goes) only on [staging](../README.md#staging-only-console-diagnostics).
Production stays silent apart from the configuration errors in the table above.

## Release Gate

- Confirm `/auth-route` and its visible error state exist in Webflow.
- Confirm the site head loads Memberstack, `memberReady`, the unconditional
  static `route-guard.js` tag and `signup-attribution.js`, then
  `auth-page-loader.js`, then the conditional controller block.
- Confirm the `route-guard.js` tag is still static, parser-blocking, and outside
  every conditional, on every page.
- Confirm the static `route-guard.js` tag executes before `auth-route.js` on
  all three auth paths, and that the loader requests `auth-route.js` only —
  exactly one `route-guard.js` request per auth page load, from the static tag.
- Confirm `/auth-route` requests no unrelated application controller, and that
  `signup-attribution.js` IS still requested on `/login` and `/starter-login`.
  Land on `/login?utm_source=gate-check&fbclid=gate-check` and confirm the
  attribution cookies are written.
- Confirm the loader requests nothing on a non-auth page, and that
  `route-guard.js` there executes before every page-level controller.
  Spot-check `/build-profile/select-profile`: `html[data-route-guard]` must be
  set before `build-profile-redirect.js` runs.
- With the loader URL blocked in devtools, confirm every page still emits
  `route-guard.js`, `signup-attribution.js`, and the full controller block. On
  the three auth paths, whether `/login` still gets `redirect="/auth-route"`
  depends on where step 6's cutover stands: during the overlap window the
  page-level tag still supplies it, and once the page-level tags are removed a
  blocked loader means no router at all. Record which state was tested.
- Walk step 6 in order. Step 6.3 records delivery evidence only (the loader's
  own `script[data-starters-auth-runtime="auth-route"]` element, its exact
  `@v1.59.506` src, a successful response, and a matching served-byte hash);
  step 6.4 is the behavioral gate and is the first step that can observe the
  loader's copy executing, one path at a time. Keep the step-6.1 readback until
  the release is signed off. All of step 6 is deferred to a separately
  authorized Webflow save/publish window; this release does not touch Webflow.
- Confirm `/starter-login` passes through `/auth-route` rather than the shared
  plan redirect.
- Confirm `/sign-up` still has NO `auth-route.js` embed, and that its signup
  modals still return to their `starters-ms-redirect` marker destinations.
- Back up page-level code before installing the script.
- Run `node --test v3/auth-route.test.js v3/auth-page-loader.test.js`.
- Verify login with `next=/dashboard` for Talent, paid Brand, Test Brand, and
  Brand Free in both incomplete-quiz and completed-quiz states.
- Verify the four Talent funnel states on staging with the console open: a member
  with no row lands on `/build-profile/select-profile`, a member **with** a row
  whose `profile_type_30` is empty also lands there (the 282-member case, and the
  reason for the 2026-08-04 migration), a member with `build_profile_done` true
  and `onboarding_done` false lands on `/starter-onboarding` even with
  `?next=/messages`, and a fully finished member still honors `?next=`.
- The fully-finished row cannot be reached with today's data —
  `onboarding_done` is true on zero rows — so exercise it by calling
  `window.StartersV3AuthRouter.funnelStateFrom({build_profile_done: true,
  onboarding_done: true})` and confirming it answers `'done'`, or by flipping the
  column on a test row.
- Confirm the network panel shows `get_build_profile_status` and no
  `get_freelancers` request from `/auth-route`.
- Confirm a paid Brand login reads `get_brand_profile_status`, while a Brand
  Free login logs no funnel lines and issues no request to `api:KZf7nFnk`.
- Run the full staging matrix behind the Webflow password.
- Do not publish custom domains until the separate production go signal.
