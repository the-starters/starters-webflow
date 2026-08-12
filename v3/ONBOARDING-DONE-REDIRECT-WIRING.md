# Onboarding Done Redirect Wiring

Status: Shipped — live on staging `/starter-onboarding` as a pinned tag; split
into a pair with `patch-onboarding-status.js` as of v1.59.47, and changed twice
since, both unreleased: the write half now redirects its own member (so the
`sessionStorage` handshake this file used to perform is gone), and this file now
raises the shared `[data-page-spinner]` over the page for the length of its
status read. The next tag carries both.

`v3/onboarding-done-redirect.js` is a **page-scoped** module for
`/starter-onboarding`. It does one thing: it keeps a member who has already
finished onboarding out of the onboarding flow. It is the **read half** of a
pair — it reads status, decides, and redirects, and it never writes anything to
Xano. The only markup it touches is the shared spinner it raises while deciding.

Its required pair is
[patch-onboarding-status.js](ONBOARDING-PATCH-STATUS-WIRING.md), the write half,
which records the completion in the first place and owns everything that happens
in the moments after a submit. Both jobs shipped as one file through v1.59.45
and were split at v1.59.47. Their host allowlist, path gate, trade-token auth,
8-second request budget, and staging-only console diagnostics remain
self-contained. The write half separately uses the shared privacy-safe workflow
receipt helper documented in
[`../README.md`](../README.md#current-scripts). The pair still installs and
versions together.

It is not a sibling of [route-guard.js](route-guard.js) and does not replace it.
The route guard answers "may this role open this page" from Memberstack plans;
this module answers "has this Talent already finished" from the Xano record.
Both can run on the page; the guard runs sitewide and first.

## What it does

| Situation | Action |
| --- | --- |
| The page loads and the status check starts | Show `[data-page-spinner]`, covering the page for the length of the read |
| `onboarding_done === true` on the member's Xano freelancer record | `location.replace('/starter-dashboard')`, leaving the spinner up through the navigation |
| `onboarding_done` false, absent, or the envelope is empty | Hide the spinner and render the page as authored |
| Logged out, Memberstack absent, trade failed, HTTP error, timeout | Hide the spinner and render the page as authored |
| No `[data-page-spinner]` element on the page | Nothing; the check and the decision are unchanged |
| Any other path, or an unapproved host | Do nothing at all (no Memberstack lookup, no spinner, no redirect) |

The one endpoint it touches, on `api:KZf7nFnk` and bearer-authorized:

- Read: `GET /starters_onboarding/get_freelancers` — no params, answers
  `{"freelancer": [ <one record> ]}`, and an empty envelope for a member with no
  row yet.

Auth is the same trade-token flow the sibling v3 modules use: the Memberstack
JWT from `getMemberCookie()` is traded at
`api:g1vmSLWh/auth/trade-token/v3` for a Xano token, and the response is parsed
tolerantly (raw string, `{authToken}`, or `{token}`) because
`create_auth_token` has answered all three. The traded token is memoized for the
page, and it is dropped after any failure so a retry re-trades instead of
replaying a token Xano just rejected.

## The decided behaviours

### Fail-open, everywhere

Every failure mode leaves the page exactly as authored, spinner back down:
logged out, Memberstack never loading, `getMemberCookie()` rejecting, a failed
or empty token trade, a non-2xx read, a malformed envelope, a request that hangs
past the 8-second budget. Only a literal `onboarding_done === true` redirects —
a string `"true"`, a `1`, or a missing field does not. No DOM failure around the
spinner can delay or prevent that decision: the lookup is wrapped, a page with
no spinner element decides identically, and a `querySelector` that throws is
swallowed.

This is deliberate and is the whole risk posture of the module. The redirect is
a **UX courtesy, not a security boundary**. A completed member who reaches the
page anyway sees the onboarding form, which is harmless; a member wrongly
bounced to the dashboard because a transient Xano blip was read as "done" is
not. Access control stays where it already is: Memberstack gated content,
`v3/route-guard.js` for role routing, and Xano endpoint authorization for the
records themselves.

### One job, on later visits only

The read and the write used to fight over the moment right after a submit, and a
`sessionStorage` marker refereed it: the write half set
`starter-onboarding-just-submitted` and this file consumed it to skip its check
exactly once, so the member could read the completion view before being sent on.

That contest is over. The write half now shows a loader, hides the form, waits
for its `PATCH`, and redirects the member to `/starter-dashboard` itself — see
[patch-onboarding-status.js](ONBOARDING-PATCH-STATUS-WIRING.md) — so there is no
post-submit beat left for this module to sit out. The marker is gone from both
files, and this one no longer touches storage at all.

What remains is the plain case, and the only one this file was ever really for:
a member who finished onboarding earlier and comes back to the page from a
bookmark, the back button, or a stale link. Every load runs the check, and a
record carrying `onboarding_done === true` is replaced away to the dashboard.

### The shared page spinner

The status read costs a round trip, and the onboarding page is fully visible
while it runs — so an already-done member used to watch the page paint and then
disappear under the redirect. The fix is to cover the page for the length of the
check with `[data-page-spinner]`: raised before the read starts, lowered the
moment the answer is "stay".

**One element, two owners, two windows that cannot overlap.** This half raises it
at page load for the status read;
[patch-onboarding-status.js](ONBOARDING-PATCH-STATUS-WIRING.md) raises the same
element at form submit for its `PATCH`. A load-time check has always finished
long before anyone can fill in a form, so neither file coordinates with the other
and neither needs to know the other exists. Both reveal it the same way —
`display: block` plus the `hidden` attribute cleared — and both look it up
freshly rather than holding a reference.

**When the answer is "go", the spinner stays up.** The navigation is already in
flight, and lowering it first would flash the onboarding page one last time on
the way out. The page is about to be replaced, so nothing is left behind.

**Only the boot path touches it.** `redirectIfDone()` is exposed for console
work and deliberately does not raise or lower anything, so calling it by hand on
staging exercises the read and the decision without the page moving underneath
you.

**The accepted cost:** a visitor whose Memberstack is slow or never arrives sits
under the spinner for the full 8-second Memberstack budget before it comes back
down. That is the logged-out-on-a-bad-connection case, and it is the price of
not flashing the page for the member who *is* being redirected. It is a deliberate
trade, not an oversight — if it ever needs revisiting, the lever is
`MEMBERSTACK_TIMEOUT_MS`, and lowering it shortens this wait and the fail-open
wait together.

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
2. `/starter-onboarding` is Talent-only in the route-guard matrix. Leave that
   entry alone; this module assumes the guard has already done role routing.
3. **Optional: the shared `[data-page-spinner]` element**, hidden by default. It
   is the same element the write half uses, built once and listed in full under
   [patch-onboarding-status.js](ONBOARDING-PATCH-STATUS-WIRING.md) — including
   the rule that it must sit **outside both `.w-form` wrappers**. This half only
   raises and lowers it; a page without one behaves identically, minus the
   cover.
4. This half needs nothing else from the Designer — it never looks at the forms.
   The form and success-block prerequisites (standard Webflow forms, **no
   Redirect URL on either form**, the `.w-form-done` sibling kept in the DOM,
   nothing else showing that block) belong to the write half and are listed in
   [patch-onboarding-status.js](ONBOARDING-PATCH-STATUS-WIRING.md).

## Staging QA order

This is the slim solo walk for the redirect alone. Run it behind the Webflow
password on `the-starters-3-0.webflow.io`, or through `./dev-tunnel.sh` (the
module deliberately allows `localhost`, `127.0.0.1`, `*.webflow.io`, and
`*.trycloudflare.com` so the tunnel loop works). Open the console — staging is
chatty, production is silent.

1. **Logged out.** Open `/starter-onboarding`. The page renders, no redirect,
   no Xano call in the Network tab. The spinner appears and then comes down —
   possibly after a pause of up to 8 seconds while Memberstack is waited for.
   That wait is the documented trade-off, not a bug.
2. **Fresh Talent, not yet done.** Log in, open the page. The spinner appears
   over the page, comes down when the read answers, and the page renders. The
   console notes "onboarding not marked done".
3. **A member whose record is already done.** Open the page: the spinner appears
   and **stays up** while the redirect fires to `/starter-dashboard`, via
   `replace()`, so Back does not bounce you into a loop. You should never see the
   onboarding page paint. The console prefix `[starters onboarding-done]` is what
   tells this redirect apart from the write half's post-submit one.
4. **Offline / blocked-Xano check.** With the Network tab throttled to offline
   (or the Xano origin blocked), reload the page: it must render normally within
   a couple of seconds, spinner down, never a blank or stuck state.
5. **Production silence.** After publishing, confirm the console prints nothing
   from `[starters onboarding-done]` on `thestarters.com`.

The full pair walk — submit a form, watch the loader come up and the form go
away, watch the `PATCH` land, then follow the redirect to the dashboard and back
— lives in [patch-onboarding-status.js](ONBOARDING-PATCH-STATUS-WIRING.md). Run
that one before shipping either file.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Never redirects, console silent | The tag is not on the page, or the hostname is not approved. Check `window.StartersOnboardingDoneRedirect` exists in the console. |
| Pasted a copy of the file (console or a second embed) and nothing happens | The boot guard, working as designed: a copy already loaded by the page's CDN tag set `window.__startersOnboardingDoneRedirectBooted`, so every later copy exits immediately. To hand-exercise the module, call `window.StartersOnboardingDoneRedirect.redirectIfDone()` on staging instead of re-running the file. |
| Never redirects, console says "could not read onboarding status" | The trade-token or read call failed. The message carries the status; check the member has a `user_v3` row (trade-token 404s without one). |
| Never redirects, console says "onboarding not marked done" | The read succeeded and Xano says false. The write half never landed, or it wrote a different row — see [patch-onboarding-status.js](ONBOARDING-PATCH-STATUS-WIRING.md). |
| A member submitted a form and was never sent to the dashboard | Not this module — the post-submit redirect belongs to the write half now. See the "never redirected" and "loader" rows in [patch-onboarding-status.js](ONBOARDING-PATCH-STATUS-WIRING.md). |
| Redirect loops between the two pages | Not this module — check `v3/route-guard.js` and the `/starter-dashboard` page controllers. This one only ever replaces *away* from the onboarding page. |
| Spinner stays up and the page never renders | The check never settled. Expected for up to 8 seconds when Memberstack is missing or slow; past that, look for a `[starters onboarding-done]` warning. A spinner still up with `onboarding already done` in the console is correct — the redirect is navigating. |
| Spinner never appears on load | No element matching `[data-page-spinner]` on the page (the staging console notes it by name), or it sits inside a `.w-form` wrapper. Everything else behaves identically without it. |
| The onboarding page flashes before the redirect | The spinner is missing, or it is not covering the page — check its z-index and positioning in the Designer. The module only toggles `display`; how much it hides is a styling question. |

## Diagnostics

`window.StartersOnboardingDoneRedirect` exposes `allowedHost`, `stagingHost`,
`isOnboardingPath`, `diagnosticsEnabled`, `onboardingDone`, `redirectIfDone`,
`dashboardPath`, and `loaderSelector` for console checks. `redirectIfDone()` is
callable by hand on staging to exercise the read and the decision without
waiting for a page load, and it deliberately leaves the spinner alone — only the
boot path raises and lowers it. `loaderSelector` reads the same
`[data-page-spinner]` value the write half exposes; if the two ever disagree,
one file is stale. The write-side helpers moved out with the split and live on
`window.StartersPatchOnboardingStatus`.

## Release gate

- `node --test v3/onboarding-done-redirect.test.js`
- `node --check v3/onboarding-done-redirect.js`
- Walk the slim QA order above, then the full pair walk in
  [patch-onboarding-status.js](ONBOARDING-PATCH-STATUS-WIRING.md) — this file
  cannot be validated alone, because nothing marks a record done without its
  pair.
- Do not publish to the custom domain until the separate production go signal.
