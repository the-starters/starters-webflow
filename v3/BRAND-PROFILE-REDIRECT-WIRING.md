# Brand Profile Redirect Wiring

Status: Built, not yet released — no tag, no Webflow embed on any host. The
header's `@release` line and the exported `release` property both carry the
`vX.Y.Z` placeholder until the release tag stamps them. Its Xano endpoint,
`get_brand_profile_status`, was created in the same round and must be live before
QA; without it the module simply fails open on every load, which is invisible
rather than broken.

`v3/brand-profile-redirect.js` is a **page-scoped** module for the paid-Brand
lock pages below. It does one thing: it sends a signed-in paid Brand who has not
finished their profile to `/complete-profile`. It is the **inbound half** of a
pair — it reads status, decides, and redirects, and it never writes anything to
Xano or to Memberstack. The only markup it touches is the spinner it raises while
deciding.

**In-scope paths** (exact + trailing-slash twin; `/opportunities/<slug>` too):

| Path | Why |
| --- | --- |
| `/brand-dashboard` | Brand home |
| `/opportunities` (+ single-segment detail) | Shared feed Brands use |
| `/all-starters` | Browse |
| `/messages` | Shared inbox |
| `/starter-dashboard` | Future-proof (guard normally bounces Brands off first) |
| `/dashboard` | Future-proof thin router |

Out of scope on purpose for now: `/opportunities-brands-view`,
`/opportunities---create`, `/favorites`, `/complete-profile` (outbound half owns
it). Install one deferred tag per page (or sitewide — the path gate no-ops
elsewhere). Paid-Brand only in effect: Talent / free-Brand get `has_record: false`
and stay.

Its counterpart is
[complete-profile-redirect.js](COMPLETE-PROFILE-REDIRECT-WIRING.md), the
**outbound half**, which sits on `/complete-profile` and bounces a Brand who is
already finished forward to `/brand-dashboard` (plus the two wrong-role cases).
Between them the two pages form a closed loop.

The loop only stays closed because **both halves answer from the same signal**
(decided 2026-08-06 — a split source ping-pongs a fresh completer):

| Half | Page | Source of truth | Cost |
| --- | --- | --- | --- |
| Outbound — [complete-profile-redirect.js](COMPLETE-PROFILE-REDIRECT-WIRING.md) | `/complete-profile` | Xano `get_brand_profile_status` (marker short-circuits) | one trade + one read, or zero with marker |
| Inbound — this file | `/brand-dashboard` | Xano `get_brand_profile_status` (marker short-circuits) | one trade + one read, or zero with marker |

Xano is the right source because `/brand-dashboard`'s own data comes from Xano: if
the Brand record is not there or is not marked complete, the dashboard has nothing
to render. The Memberstack field `completed-brand-profile` is still written by the
controller (it feeds endpoint #1513) but nothing routes on it. The gap is the
webhook's catch-up window, and the `sessionStorage` marker below is the bridge.

It is not a sibling of [route-guard.js](ROUTE-GUARD-WIRING.md) and does not
replace it. The route guard answers "may this role open this page" from
Memberstack plans — `/brand-dashboard` is `brand-paid` in its matrix; this module
answers "has this Brand finished their profile" from the Xano record. Both run on
the page; the guard runs sitewide and first.

## What it does

Walked in this order, top to bottom, first match wins:

| Situation | Action |
| --- | --- |
| The page loads and the check starts | Show `[data-page-spinner]`, covering the page for the length of the read |
| `thestarters:v3-brand-profile-completed` holds a non-empty value | Hide the spinner and render the dashboard — **no Xano call at all** |
| `has_record: true`, `brand_profile_done: false` | `location.replace('/complete-profile')`, leaving the spinner up through the navigation |
| `has_record: true`, `brand_profile_done: true` | Hide the spinner and render the dashboard |
| `has_record: false` (any `brand_profile_done`) | Hide the spinner and render the dashboard |
| Logged out, Memberstack absent, trade failed, HTTP error, malformed body, timeout | Hide the spinner and render the dashboard |
| No `[data-page-spinner]` element on the page | Nothing; the check and the decision are unchanged |
| Any other path, or an unapproved host | Do nothing at all (no storage read, no Memberstack lookup, no spinner, no redirect) |

The one endpoint it touches, on `api:KZf7nFnk` and bearer-authorized:

- Read: `GET /starters_onboarding/get_brand_profile_status` — no params, answers
  `{"has_record": bool, "brand_profile_done": bool}`. The member is derived from
  the bearer token, so there is no id to pass and nothing to get wrong.

Auth is the same trade-token flow the sibling v3 modules use: the Memberstack JWT
from `getMemberCookie()` is traded at `api:g1vmSLWh/auth/trade-token/v3` for a
Xano token, and the response is parsed tolerantly (raw string, `{authToken}`, or
`{token}`) because `create_auth_token` has answered all three. The traded token is
memoized for the page, and it is dropped after any failure so a retry re-trades
instead of replaying a token Xano just rejected.

## The decided behaviours

### Fail-open, everywhere

Every failure mode leaves the page exactly as authored, spinner back down: logged
out, Memberstack never loading, `getMemberCookie()` rejecting, a failed or empty
token trade, a non-2xx read, a body that will not parse, a body that parses to the
wrong shape, a request that hangs past the 8-second budget, `sessionStorage`
throwing. Only one envelope shape ever redirects — a literal `true` for
`has_record` alongside a literal `false` for `brand_profile_done`. A string
`"false"`, a `0`, a `null`, or a missing key does not. No DOM or storage failure
around the check can delay or prevent that decision: every access is wrapped, a
page with no spinner element decides identically, and a `querySelector` that
throws is swallowed.

The direction of the bias is deliberate and is the whole risk posture. A paid
Brand left on a thin dashboard can navigate to the form themselves, which is a
mild annoyance; a Brand shoved back onto a form they already completed because a
transient Xano blip read as "not done" has no way out — the outbound half would
send them forward, this one would send them back, and the two would loop. So the
module moves nobody it is not certain about.

The redirect is a **UX courtesy, not a security boundary**. Access control stays
where it already is: Memberstack gated content, `v3/route-guard.js` for role
routing, and Xano endpoint authorization for the records themselves.

### No role logic, on purpose

A Talent or free-Brand member who reaches `/brand-dashboard` is the route guard's
problem, and the guard runs first and sitewide. This module deliberately carries
no plan-ID table and does not borrow the guard's role contract, because it does
not need to: for those members the endpoint answers `has_record: false` — they
have no Brand row — which lands in the stay branch and leaves the page alone. The
two modules therefore cannot fight over the same visitor, and the wrong-role case
costs one harmless read.

### The completion marker, and why it has to exist

Completion is written to **Memberstack** by
[brand-account-controller.js](BRAND-ACCOUNT-WIRING.md) as its last durable member
write, and only reaches **Xano** afterwards, through the Memberstack webhook that
feeds endpoint #1513. For a few seconds after a successful submit, Xano still
answers `brand_profile_done: false` for a Brand who is in fact done — and in
exactly those few seconds the outbound half is forwarding them to
`/brand-dashboard`, where this module would read "not done" and bounce them
straight back onto the form they just finished.

The bridge is one `sessionStorage` entry:

```
thestarters:v3-brand-profile-completed
```

The account controller writes it right after the submit succeeds. This module
reads it **before anything else, and before any network call** — a non-empty value
is read as DONE, the check short-circuits, and the dashboard renders.

- **Read-only here.** This file never writes and never clears the marker. There
  is no `setItem` or `removeItem` anywhere in it, and the test suite asserts that
  in the source.
- **`sessionStorage`, not `localStorage`, and never cleared.** It dies with the
  tab, by which time the webhook has long since landed and Xano answers for
  itself. A one-shot consume-and-delete was considered and rejected: a member who
  reloads the dashboard twice inside the latency window would burn the marker on
  the first reload and be bounced on the second.
- **Semantics match the outbound half's field read.** A string counts once
  trimmed non-empty; a non-string truthy value counts as set. A whitespace-only
  value is not a marker.
- **Every access is wrapped.** Safari private mode throws on the property itself,
  not just on the call, so both are guarded and a storage failure reads as "no
  marker" — that costs one network call, which fails open on its own, rather than
  costing the member their dashboard.

### The page spinner

The status read costs a round trip, and the dashboard is fully visible while it
runs — so a member on their way to the form would watch the dashboard paint and
then disappear under the redirect. The fix is to cover the page for the length of
the check with `[data-page-spinner]`: raised before the read starts, lowered the
moment the answer is "stay".

Same selector convention and same reveal as
[onboarding-done-redirect.js](ONBOARDING-DONE-REDIRECT-WIRING.md) —
`display: block` plus the `hidden` attribute cleared, looked up freshly rather
than held between the raise and the lower. Different page, so unlike that pair
there is no second owner to coordinate with here.

**When the answer is "go", the spinner stays up.** The navigation is already in
flight, and lowering it first would flash the dashboard one last time on the way
out. The page is about to be replaced, so nothing is left behind.

**Only the boot path touches it.** `redirectIfIncomplete()` is exposed for console
work and deliberately does not raise or lower anything, so calling it by hand on
staging exercises the read and the decision without the page moving underneath
you.

**The accepted cost:** a visitor whose Memberstack is slow or never arrives sits
under the spinner for the full 8-second Memberstack budget before it comes back
down. That is the logged-out-on-a-bad-connection case, and it is the price of not
flashing the dashboard for the member who *is* being redirected. It is a
deliberate trade, not an oversight — if it ever needs revisiting, the lever is
`MEMBERSTACK_TIMEOUT_MS`, and lowering it shortens this wait and the fail-open
wait together.

## Webflow install

One deferred tag per in-scope page, in **Page Settings → Custom Code → Before
`</body>`** (or one sitewide embed — out-of-scope paths exit immediately):

- `/brand-dashboard`
- `/opportunities` (covers the feed; detail slugs match in JS)
- `/all-starters`
- `/messages`
- `/starter-dashboard` (optional today; guard usually bounces Brands first)
- `/dashboard` (optional today; thin router)

```html
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@main/v3/brand-profile-redirect.js" defer></script>
```

Pin `@v1.59.116` (or newer) instead of `@main` / `@latest` once the release tag
exists. Until then `@latest` 404s this file (tag still on `v1.59.115`).

**It must load after `v3/route-guard.js`**, which is sitewide and already earlier
in the document, so role routing has run before this module starts a network call.
It does not read the guard's globals, so this is an ordering courtesy rather than a
hard dependency — but a wrong-role member should be gone before a pointless Xano
read goes out on their behalf.

**Its counterpart lives on `/complete-profile`**, not these pages:
`v3/complete-profile-redirect.js` stays embedded there only. Do not add either
file to the other's page — two redirect modules on one page is how loops get
built.

### Designer prerequisites

1. Memberstack must be loaded on the page (it is loaded site-wide today). The
   module waits up to 8 seconds for `window.$memberstackDom` and then fails open.
2. `/brand-dashboard` is `brand-paid` in the route-guard matrix. Leave that entry
   alone; this module assumes the guard has already done role routing and
   deliberately contains no role logic of its own.
3. **Optional: a `[data-page-spinner]` element**, hidden by default, positioned and
   z-indexed to actually cover the page. The module only toggles `display`; how
   much it hides is a styling question. Keep it **outside** any `.w-form` wrapper,
   the same rule the `/starter-onboarding` pair follows. A page without one behaves
   identically, minus the cover.
4. Nothing else. This module never looks at the dashboard's own markup, forms, or
   lists.

### Xano prerequisite

`GET /starters_onboarding/get_brand_profile_status` on `api:KZf7nFnk` must exist
and be bearer-authorized, answering `{"has_record": bool, "brand_profile_done":
bool}`. Until it does, every load 404s on the read and fails open — the dashboard
renders and nobody is ever sent to the form, silently. Confirm the endpoint before
QA, or step 3 of the walk below will look like a module bug.

## Staging QA order

Run it behind the Webflow password on `the-starters-3-0.webflow.io`, or through
`./dev-tunnel.sh` (the module's
[staging gate](../README.md#staging-only-console-diagnostics) covers the quick-tunnel
hostname, so the tunnel loop works). Open the
console — staging is chatty, production is silent. The prefix is
`[starters brand-profile-redirect]`.

1. **Logged out.** Open `/brand-dashboard`. Memberstack's own gating will
   normally take you first; if you reach the page, it renders, no redirect, no
   Xano call in the Network tab. The spinner appears and then comes down —
   possibly after a pause of up to 8 seconds while Memberstack is waited for.
   That wait is the documented trade-off, not a bug.
2. **A paid Brand whose record is complete.** Log in, open the page. The spinner
   appears over the page, comes down when the read answers, and the dashboard
   renders. The console notes "brand profile does not need completing".
3. **A paid Brand whose record is NOT complete.** Open the page: the spinner
   appears and **stays up** while the redirect fires to `/complete-profile`, via
   `replace()`, so Back does not bounce you into a loop. You should never see the
   dashboard paint.
4. **The round trip, which is the real test.** From step 3's form, submit it. The
   outbound half forwards you to `/brand-dashboard` — and you must **stay there**.
   Check the console for "completion marker is set" and confirm in the Network tab
   that **no** Xano call went out on that load. This is the marker doing its job;
   if it is missing, you will be bounced straight back to the form and the two
   modules will ping-pong. Then open a **new tab** to `/brand-dashboard`: the
   marker is gone with the old session, so the read runs for real and must answer
   done — if it bounces you, the webhook has not landed yet, so wait and retry
   before filing it as a bug.
5. **A Talent session on the page.** The route guard should move you first. If you
   defeat the guard, the endpoint answers `has_record: false`, the console notes
   it, and the page is left alone — no redirect to `/complete-profile`.
6. **Offline / blocked-Xano check.** With the Network tab throttled to offline (or
   the Xano origin blocked), reload the page: it must render normally within a
   couple of seconds, spinner down, never a blank or stuck state.
7. **Production silence.** After publishing, confirm the console prints nothing
   from `[starters brand-profile-redirect]` on `thestarters.com`.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Never redirects, console silent | The tag is not on the page, or the hostname is not approved. Check `window.StartersBrandProfileRedirect` exists in the console. |
| Pasted a copy of the file (console or a second embed) and nothing happens | The boot guard, working as designed: a copy already loaded by the page's CDN tag set `window.__startersBrandProfileRedirectBooted`, so every later copy exits immediately. To hand-exercise the module, call `window.StartersBrandProfileRedirect.redirectIfIncomplete()` on staging instead of re-running the file. |
| Never redirects, console says "could not read brand profile status" | The trade-token or read call failed. The message carries the status; check the member has a `user_v3` row (trade-token 404s without one) and that `get_brand_profile_status` is deployed. |
| Never redirects, console says "has_record = false" | The read succeeded and Xano has no Brand row for this member. Correct for a Talent or free-Brand session; for a paid Brand it means the signup webhook never mirrored them. |
| Never redirects, console says "completion marker is set" | The marker is in this tab's `sessionStorage`. Expected right after a submit. If it is stale, open a new tab — this file never clears it. Check the value with `sessionStorage.getItem(window.StartersBrandProfileRedirect.markerKey)`. |
| **Ping-pong between `/brand-dashboard` and `/complete-profile`** | The two halves disagree, or the marker was not written on submit. Both now read Xano, so a true ping-pong usually means a stale embed of one half still on the old Memberstack-field code, or a marker key mismatch with [brand-account-controller.js](BRAND-ACCOUNT-WIRING.md). Confirm both CDN files carry the Xano path and that `sessionStorage.getItem('thestarters:v3-brand-profile-completed')` is set right after submit. |
| Redirected to `/complete-profile` and immediately sent back | Same root cause from the other side: outbound half thinks done, inbound thinks not. Check marker + both embeds on the Xano signal. |
| Spinner stays up and the page never renders | The check never settled. Expected for up to 8 seconds when Memberstack is missing or slow; past that, look for a `[starters brand-profile-redirect]` warning. A spinner still up with "brand profile is unfinished" in the console is correct — the redirect is navigating. |
| Spinner never appears on load | No element matching `[data-page-spinner]` on the page (the staging console notes it by name), or it sits inside a `.w-form` wrapper. Everything else behaves identically without it. |
| The dashboard flashes before the redirect | The spinner is missing, or it is not covering the page — check its z-index and positioning in the Designer. The module only toggles `display`; how much it hides is a styling question. |

## Diagnostics

`window.StartersBrandProfileRedirect` exposes `release`, `allowedHost`,
`stagingHost`, `isBrandDashboardPath`, `diagnosticsEnabled`,
`completionMarkerSet`, `needsBrandProfile`, `redirectIfIncomplete`,
`brandDashboardPaths`, `completeProfilePath`, `markerKey`, and `loaderSelector`
for console checks.

- `redirectIfIncomplete()` is callable by hand on staging to exercise the marker,
  the read, and the decision without waiting for a page load, and it deliberately
  leaves the spinner alone — only the boot path raises and lowers it. It will
  navigate if the answer is "go".
- `needsBrandProfile(payload)` decides on a payload you hand it, with no network
  involved, which is the fastest way to confirm the one-shape rule.
- `completionMarkerSet()` answers whether this tab is inside the post-submit
  window, and `markerKey` is the exact key to check by hand. If it ever disagrees
  with the key [brand-account-controller.js](BRAND-ACCOUNT-WIRING.md) writes, one
  file is stale — that mismatch is the ping-pong bug.
- `release` reads the shipping tag and must match the `@release` line in the
  file's header. Grep the served CDN file for it to prove which version a page
  actually loaded.

## Release gate

- `node --test v3/brand-profile-redirect.test.js`
- `node --check v3/brand-profile-redirect.js`
- Confirm `get_brand_profile_status` is live on `api:KZf7nFnk` before QA — the
  module fails open silently without it, so a missing endpoint looks like "the
  redirect does nothing".
- Stamp the real tag into **both** the header `@release` line and the exported
  `release` property; the test's drift guard asserts they match.
- Walk the QA order above, and do not skip step 4 — the marker round trip is the
  only step that can catch the ping-pong failure, and it is the one failure mode
  that traps a member.
- Do not publish to the custom domain until the separate production go signal.
