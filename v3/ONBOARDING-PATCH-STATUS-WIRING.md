# Onboarding Patch Status Wiring

Status: Shipping in the v1.59.47 split of `onboarding-done-redirect.js` (job 2
of the former single file), reworked since to carry the post-submit journey —
loader, hidden form, then a redirect to `/starter-dashboard` — in place of the
`sessionStorage` marker the two halves used to hand between them. Unreleased;
the next tag carries it.

`v3/patch-onboarding-status.js` is a **page-scoped** module for
`/starter-onboarding`. It owns everything that happens after a member finishes
onboarding on that page: it records the completion in Xano and then takes the
member to the dashboard. It is the **write half** of a pair, and it never reads
status and never routes anyone anywhere except off this page after their own
submit.

The read half is
[onboarding-done-redirect.js](ONBOARDING-DONE-REDIRECT-WIRING.md), which acts on
the record on later visits by keeping a finished member out of the onboarding
flow. Both jobs shipped as one file through v1.59.45 and were split at
v1.59.47. Their host allowlist, path gate, trade-token auth, and staging-only
console diagnostics remain self-contained. The write
half now also attempts to load the repository's shared privacy-safe workflow
receipt helper from the same jsDelivr repository ref. The pair still installs
and versions together.

It is not a sibling of [route-guard.js](route-guard.js) and does not replace it.
The route guard answers "may this role open this page" from Memberstack plans;
this module makes no access decision at all. It writes a completion flag for the
Xano record it is authorized for and then moves the member on from a page they
have just finished with, which is navigation, not authorization.

## What it does

| Situation | Action |
| --- | --- |
| Either page form reaches its Webflow success state | Show `[data-page-spinner]`, hide that form's `.w-form` wrapper, then `PATCH` `set_onboarding_status` |
| The `PATCH` succeeds | `location.replace('/starter-dashboard')` |
| That wrapper's success block mutates again | Nothing — the observer disconnected on the first hit |
| A `PATCH` attempt fails | Retry at roughly 1s and 3s, re-trading the token between attempts |
| The onboarding `PATCH` exceeds 35 seconds | Abort and redirect without retry; the Xano request may still finish server-side |
| All attempts fail | Warn on staging, then redirect anyway — a member behind a hidden form must never be stranded |
| The completion attempt settles | Record a privacy-safe receipt that distinguishes whether any auth or status request started; keep diagnostic data and copy behavior out of authored messages |
| No `[data-page-spinner]` element on the page | Nothing; the rest of the sequence runs unchanged |
| A success block is already visible when the module boots | Leave it alone — only a transition *into* the done state is a submit |
| Logged out (no Memberstack session) | Write nothing and redirect nowhere: put the loader back down, restore the form, hide the success block, and show a clean session failure |
| Memberstack absent, trade failed, HTTP error, timeout | Give up on the write, then redirect to the dashboard |
| Any other path, or an unapproved host | Do nothing at all (no Memberstack lookup, no observers) |

The one endpoint it touches, on `api:KZf7nFnk` and bearer-authorized:

- Write: `PATCH /starters_onboarding/set_onboarding_status` — no body. It answers
  `onboarding_done` plus privacy-safe first-publish eligibility, outcome, event,
  and Webflow status fields.

Xano owns first-publish eligibility. Only a fresh Full or Consult activation can
run the bounded synchronous Webflow publish. Existing-profile edits stay on the
normal queue. The fast path uses the normal projection event, receipts, fencing,
and idempotency controls, and it falls back to that queue when the synchronous
publish cannot finish safely.

Auth is the same trade-token flow the sibling v3 modules use: the Memberstack
JWT from `getMemberCookie()` is traded at
`api:g1vmSLWh/auth/trade-token/v3` for a Xano token, and the response is parsed
tolerantly (raw string, `{authToken}`, or `{token}`) because
`create_auth_token` has answered all three. The traded token is memoized for the
page, and it is dropped after any failure so the next retry re-trades instead of
replaying a token Xano just rejected.

## The decided behaviours

### Fail-open, everywhere

No failure mode is allowed to strand the member: logged out, Memberstack never
loading, `getMemberCookie()` rejecting, a failed or empty token trade, a non-2xx
write, a request that hangs past the 35-second onboarding budget, a loader
element that was never built. Nothing is blocked, nothing is reloaded, and no
error state is painted over the moment the member just finished.

This is deliberate and is the whole risk posture of the module. Marking
completion is **bookkeeping, not a security boundary**. A member whose mark is
lost sees the onboarding page again on a later visit, which is a minor
annoyance; a member trapped on a failed write, or shown a hard error at the
exact moment they finished, is worse. Access control stays where it already is:
Memberstack gated content, `v3/route-guard.js` for role routing, and Xano
endpoint authorization for the records themselves.

### Submit → loader → hidden form → PATCH → dashboard

A successful submit runs one sequence, in this order:

1. **Show the loader.** `document.querySelector('[data-page-spinner]')`, and
   if it exists, `display: block` plus the `hidden` attribute removed. The
   element is optional; its absence is a staging note, not a warning, and the
   rest of the sequence is unaffected. It is **shared with the read half**,
   which raises the same element during its load-time status check — see
   [onboarding-done-redirect.js](ONBOARDING-DONE-REDIRECT-WIRING.md). The two
   windows cannot overlap (a load-time check is long finished before anyone can
   fill in a form), so neither file coordinates with the other.
2. **Hide the submitted form.** That form's `.w-form` wrapper gets
   `display: none`, which takes Webflow's own success message down with it. The
   member is on their way out; a completion panel they are about to lose is
   noise. Guarded, so a DOM that refuses to be styled cannot stand between the
   submit and the write.
3. **`PATCH` `set_onboarding_status`**, with the retry behaviour below.
4. **`location.replace('/starter-dashboard')`** once the `PATCH` settles.

The redirect fires **whether or not the write landed** — success, a give-up
after every retry, or an unexpected rejection all end at the dashboard. That is
the fail-open doctrine applied to the new shape of the page: the form is already
hidden by the time the write is in flight, so a member left behind it has
nowhere to go and nothing to read, while an unmarked record costs only that the
onboarding page renders again on a later visit and is marked then. Stranding is
unrecoverable for the member; a missed mark is not.

The one exception is a member with **no Memberstack session**, who is left
exactly where they are — there is nothing to write and no dashboard to send them
to, and it matches how every other logged-out case in the module behaves.
"Left where they are" is literal: that branch takes the loader back down and
puts the form back up, because a spinner over a hidden form with no redirect
behind it would be the very stranding this doctrine forbids. In practice a
member who just submitted a form is logged in, so this branch is a
belt-and-braces guard rather than a live path.

There is no `sessionStorage` handshake between the two halves any more. The old
`starter-onboarding-just-submitted` marker existed to stop the read half from
bouncing a member off their own completion view; now the write half takes them
off the page itself, so the beat it was protecting no longer exists. Neither
file touches storage, and the tests assert it stays that way.

### Submit success, not submit click

Both native Webflow forms on the page count as completing onboarding — the full
profile one and the consult one. Detection watches for **success**, not for a
click: the page's step controller owns the buttons, and a click only means
"tried".

Webflow's AJAX success path hides the `form` and reveals its sibling
`.w-form-done`, which ships with an inline `display:none`, by writing a new
inline `display`. So the module puts a `MutationObserver` on each `.w-form`
wrapper's `.w-form-done` (`attributeFilter: ['style', 'class']`) and treats an
inline display that is neither empty nor `none` as the signal, with
`offsetParent` as a fallback for a done state driven by a class. On the first
positive mutation it disconnects that wrapper's observer and marks the wrapper,
so a re-render or a second mutation cannot double-fire. Each wrapper fires at
most once per page load; a done block that is *already* visible when the module
boots is left alone, because a page served in its done state is not a submit
anyone witnessed.

### The PATCH

Failures that settle before the request timeout get up to two retries, at
roughly 1s and 3s, with a fresh token trade between attempts. The member waits
behind the loader for the active request and any backoff. An authenticated
onboarding `PATCH` may stay open for 35 seconds so Xano can finish the bounded
synchronous publish. If that `PATCH` times out, the browser redirects without a
retry because the server may still be running it. A missed mark is recoverable:
the record is set on a later visit, and until then the only cost is that the
onboarding page renders again.

## Webflow install

Two deferred tags, in **Page Settings → Custom Code → Before `</body>`** on
`/starter-onboarding` only. Do not install them sitewide.

```html
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/onboarding-done-redirect.js" defer></script>
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/patch-onboarding-status.js" defer></script>
```

Pin `@vX.Y.Z` instead of `@latest` for production stability once the tag exists.
Staging `/starter-onboarding` carried a single pinned `@v1.59.45` line for
`v3/onboarding-done-redirect.js` before the split, and carries both pinned
`@v1.59.47` lines after it. `thestarters.com` has no embed on the page yet and
inherits the pair at the next production publish.

**These two install and version together — never ship one without the other.**
Load order between them does not matter: each file is self-contained and neither
reads the other's globals, so they can sit in either order in the embed. The
write half alone marks records that nothing acts on; the read half alone never
learns that anyone finished.

### Designer prerequisites

1. Memberstack must be loaded on the page (it is loaded site-wide today). The
   module waits up to 8 seconds for `window.$memberstackDom` and then fails
   open.
2. The two forms are **standard Webflow forms**. No custom attributes, no
   markers, no class renames are required — the module keys off the native
   `.w-form` wrapper and `.w-form-done` success block that Webflow already
   emits. Keep each form inside its own Form Block; keep the success block as
   the form's sibling inside that block.
3. **Neither form may have a Redirect URL configured.** Leave Form Settings →
   Redirect URL empty on both. A form with a redirect navigates away on AJAX
   success and never reveals `.w-form-done` at all, so completion can never be
   detected. The module logs a staging warning naming the form when it finds
   one.
4. Do not delete or restyle the success state out of the DOM. If a form's
   success block is removed, that form's completion can never be detected (the
   module logs a staging warning and skips it).
5. Nothing else on the page should show `.w-form-done` for a non-submit reason —
   that is read as a successful submit.
6. **The loader element carrying `data-page-spinner`.** Keep it **outside both
   `.w-form` wrappers** — a full-screen overlay near the end of the body is the
   intended shape — and **hidden by default** in the Designer. Outside matters:
   the submitted wrapper is hidden in the same beat, so a loader nested inside
   one would be revealed and then hidden along with its parent. The first
   element matching the attribute wins, so build exactly one.

   **Both modules share it.** This one reveals it (`display: block`, `hidden`
   attribute cleared) for the length of the patch window and never hides it
   again, because the page is replaced a moment later. The read half raises the
   same element during its load-time status check and *does* lower it again when
   the member is staying — see
   [onboarding-done-redirect.js](ONBOARDING-DONE-REDIRECT-WIRING.md). The two
   windows cannot overlap, so nothing coordinates between them. Technically
   optional in both files: without the element, each still behaves identically,
   the member just sees an uncovered page.
7. `/starter-onboarding` is Talent-only in the route-guard matrix. Leave that
   entry alone; this module assumes the guard has already done role routing.

## Staging QA order

This is the canonical walk for the pair — it exercises both files, so run it
here rather than in the read half's doc. Run it behind the Webflow password on
`the-starters-3-0.webflow.io`, or through `./dev-tunnel.sh` (both modules'
[staging gate](../README.md#staging-only-console-diagnostics) covers the
quick-tunnel hostname, so the tunnel loop works). Open the console — staging is
chatty, production is silent.

1. **Logged out.** Open `/starter-onboarding`. The page renders, no redirect,
   no Xano call in the Network tab from either file. The spinner may sit over
   the page for up to 8 seconds first, while the read half waits for
   Memberstack; that pause is the documented trade-off, not a bug.
2. **Fresh Talent, not yet done.** Log in, open the page. The spinner appears
   briefly over the page while the read half checks Xano, then comes down and
   the page renders. The console notes "onboarding not marked done". If the
   spinner never comes down, stop here — that is the read half, not the submit
   flow, and it is diagnosed in
   [onboarding-done-redirect.js](ONBOARDING-DONE-REDIRECT-WIRING.md).
3. **Submit the full-profile form.** Watch the page and the **Network tab**
   together, with "Preserve log" on so the redirect does not wipe the evidence.
   The form should disappear, the loader (if it has been built) should appear,
   and you should land on `/starter-dashboard` via `replace()` — so Back does
   not bounce you into a loop. In the network log, find the
   `PATCH .../set_onboarding_status` request, confirm it actually fired, and read
   its response body for `onboarding_done: true` and the `profile_publishing`
   outcome. A success visual is not
   evidence on its own: a redirect-configured form can look like it submitted
   while no `PATCH` was ever issued.
4. **Check nothing was left in storage.** In the console on the dashboard,
   `sessionStorage` should carry no `starter-onboarding-*` key. The old
   fresh-submit marker is gone; if you see one, a stale copy of either file is
   still installed.
5. **Go back to `/starter-onboarding`.** Now the read half does its job: the
   spinner covers the page, stays up, and the redirect fires again on load, from
   [onboarding-done-redirect.js](ONBOARDING-DONE-REDIRECT-WIRING.md) this time
   (its `[starters onboarding-done]` prefix in the console tells them apart).
   You should not see the onboarding page paint at all.
6. **Repeat 2–5 with the consult form** on a second Talent account. Both forms
   count.
7. **Offline / blocked-Xano check.** With the Network tab throttled to offline
   (or the Xano origin blocked), reload the page and submit: the page must
   render normally within a couple of seconds, and the submit must still end at
   `/starter-dashboard` once the retries are exhausted — roughly four seconds of
   backoff for immediate failures. A hung onboarding request aborts once at
   35 seconds and is not retried because it may still finish server-side. The
   member may never be left sitting on a hidden form. The record stays unmarked,
   which is expected: this member gets marked on a later submit.
8. **Production silence.** After publishing, confirm the console prints nothing
   from `[starters patch-onboarding-status]` *or* `[starters onboarding-done]`
   on `thestarters.com`.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Nothing happens on success, console silent | The tag is not on the page, or the hostname is not approved. Check `window.StartersPatchOnboardingStatus` exists in the console. |
| Pasted a copy of the file (console or a second embed) and nothing happens | The boot guard, working as designed: a copy already loaded by the page's CDN tag set `window.__startersPatchOnboardingStatusBooted`, so every later copy exits immediately. To hand-exercise the module, call `window.StartersPatchOnboardingStatus.markOnboardingDone()` on staging instead of re-running the file. |
| Module is silently dead on `www.thestarters.com` but fine on staging | Hand-copied code. Code that travels through chat or a markdown renderer can have its bare-URL string literals auto-linkified — the `APPROVED_HOSTS` entry `'www.thestarters.com'` has been seen arrive as a markdown link, which fails `allowedHost`, and production logging is off so nothing is printed. Never install hand-copied code; always the tagged jsDelivr URL. The staging-host regex masks this whole class of corruption on `*.webflow.io`, so a staging pass does not clear it. |
| Submitting lands you on `/dashboard` immediately and no PATCH appears in the Network tab | The form has a Redirect URL set. Webflow navigates on success instead of showing the done block, so the observer never fires. Clear it in the Designer (the staging console names the form). |
| PATCH never fires on success | The success block is missing, was already visible at boot, or is not inside the `.w-form` wrapper. The staging console names the case. |
| PATCH fires twice | Two `.w-form` wrappers reached their success state, which is the intended per-form behaviour. A single wrapper cannot fire twice. |
| PATCH fires and 401s or 404s | The trade-token call failed or the member has no `user_v3` row (trade-token 404s without one). The staging message carries the status. |
| PATCH returns 2xx but a later visit to the page does not redirect | Not this file — the record is right, so check the read half in [onboarding-done-redirect.js](ONBOARDING-DONE-REDIRECT-WIRING.md). |
| Submitted, the form vanished, but the member was never redirected | The `PATCH` is still in flight, or a failed attempt is waiting on backoff. An authenticated `PATCH` can remain open for 35 seconds. Immediate failures retry after roughly 1s and 3s; a timed-out `PATCH` does not retry. If the redirect still never arrives, the member has no Memberstack session (the one case that deliberately does not redirect; the console says so), or the browser refused the navigation ("could not redirect to /starter-dashboard" on staging). |
| Loader never appears, but the flow otherwise works | No element matching `[data-page-spinner]` on the page — the staging console notes it by name. Add one in the Designer, hidden by default; the module only ever reveals it. |
| Loader appears and stays forever after a submit | The redirect did not fire; see the "never redirected" row. This module never lowers the loader, because the page is normally replaced out from under it. |
| Loader is up on a page nobody submitted on | That is the read half's window, not this one. Expected while its status check runs (and permanently once its redirect is navigating) — see [onboarding-done-redirect.js](ONBOARDING-DONE-REDIRECT-WIRING.md). |

## Diagnostics

The completion attempt uses the shared receipt contract owned by
[`../README.md`](../README.md#current-scripts). It records only allowlisted
workflow metadata and never records the member, form values, token, headers, or
request/response bodies. Because the normal success/fail-open path hides the
form and redirects, retrieve the retained receipt on the dashboard with:

```js
copyWorkflowDiagnostic('starter_onboarding_completion')
```

The logged-out path described above adds no diagnostic data or copy behavior to
its failure message. A receipt with
`request_started: false` means no authenticated workflow request attempt began;
it must not be read as a failed attempted PATCH.

`window.StartersPatchOnboardingStatus` exposes `allowedHost`, `stagingHost`,
`isOnboardingPath`, `diagnosticsEnabled`, `isShown`, `watchForms`,
`markOnboardingDone`, `dashboardPath`, and `loaderSelector` for console checks.
`markOnboardingDone()` is callable by hand on staging to exercise the write on
its own: it resolves `true` or `false` and does **not** touch the loader, the
form, or the location, so it can be run without being navigated away from the
page. To see the whole sequence, submit a form. `loaderSelector` reads the same
`[data-page-spinner]` value the read half exposes as its own `loaderSelector`;
if the two ever disagree, one file is stale.

## Release gate

- `node --test v3/patch-onboarding-status.test.js v3/onboarding-done-redirect.test.js`
- `node --check v3/patch-onboarding-status.js`
- `node --check v3/onboarding-done-redirect.js`
- Confirm `set_onboarding_status` is deployed and bearer-authorized before
  publishing; until then step 3 of the QA order will fail and the redirect will
  never arm for new completions.
- Walk the full staging QA order above on a Talent account for both forms, with
  both files installed. Never QA one half alone.
- Do not publish to the custom domain until the separate production go signal.
