# Onboarding Patch Status Wiring

Status: Shipping in the v1.59.47 split of `onboarding-done-redirect.js` (job 2
of the former single file)

`v3/patch-onboarding-status.js` is a **page-scoped** module for
`/starter-onboarding`. It does one thing: when a member finishes onboarding on
that page, it records the completion in Xano. It is the **write half** of a
pair, and it never reads status, never routes, and never touches the page's
markup.

The read half is
[onboarding-done-redirect.js](ONBOARDING-DONE-REDIRECT-WIRING.md), which is what
later acts on the record by keeping a finished member out of the onboarding
flow. Both jobs shipped as one file through v1.59.45 and were split at
v1.59.47. They are deliberately self-contained twins — host allowlist, path
gate, trade-token auth, the 8-second request budget, and the staging-only
diagnostics are duplicated in both files rather than shared — so either can be
edited or pulled without disturbing the other. They still install together and
version together.

It is not a sibling of [route-guard.js](route-guard.js) and does not replace it.
The route guard answers "may this role open this page" from Memberstack plans;
this module answers nothing, makes no access decision, and only writes a
completion flag for the Xano record it is authorized for.

## What it does

| Situation | Action |
| --- | --- |
| Either page form reaches its Webflow success state | Set the fresh-submit marker, then `PATCH` `set_onboarding_status` |
| That wrapper's success block mutates again | Nothing — the observer disconnected on the first hit |
| A `PATCH` attempt fails or times out | Retry at roughly 1s and 3s, re-trading the token between attempts |
| All attempts fail | Give up silently, with a staging-only warning; never block or reload the completion view |
| A success block is already visible when the module boots | Leave it alone — only a transition *into* the done state is a submit |
| Logged out, Memberstack absent, trade failed, HTTP error, timeout | Render the page as authored and write nothing |
| Any other path, or an unapproved host | Do nothing at all (no Memberstack lookup, no observers) |

The one endpoint it touches, on `api:KZf7nFnk` and bearer-authorized:

- Write: `PATCH /starters_onboarding/set_onboarding_status` — no body, answers
  `{"onboarding_done": true}`.

Auth is the same trade-token flow the sibling v3 modules use: the Memberstack
JWT from `getMemberCookie()` is traded at
`api:g1vmSLWh/auth/trade-token/v3` for a Xano token, and the response is parsed
tolerantly (raw string, `{authToken}`, or `{token}`) because
`create_auth_token` has answered all three. The traded token is memoized for the
page, and it is dropped after any failure so the next retry re-trades instead of
replaying a token Xano just rejected.

## The decided behaviours

### Fail-open, everywhere

Every failure mode leaves the page exactly as authored: logged out, Memberstack
never loading, `getMemberCookie()` rejecting, a failed or empty token trade, a
non-2xx write, a request that hangs past the 8-second budget. Nothing is
blocked, nothing is reloaded, and no error state is painted over the completion
view the member just earned.

This is deliberate and is the whole risk posture of the module. Marking
completion is **bookkeeping, not a security boundary**. A member whose mark is
lost sees the onboarding page again on a later visit, which is a minor
annoyance; a member trapped on a failed write, or shown a hard error at the
exact moment they finished, is worse. Access control stays where it already is:
Memberstack gated content, `v3/route-guard.js` for role routing, and Xano
endpoint authorization for the records themselves.

### The fresh-submit beat

The write and the read would otherwise fight. A member submits, Xano flips
`onboarding_done` to true, and the very next load of the page — the completion /
preview state the page is authored to show — would redirect them away before
they could read it.

So a successful submit writes `sessionStorage['starter-onboarding-just-submitted'] = '1'`
**before** the `PATCH` is issued, and the next load *consumes* it: the read half
reads it, removes it, and skips the redirect check once. Written before the
`PATCH` on purpose, so the completion view survives even if the write fails or
the member navigates while it is in flight. This file only ever writes the key;
[onboarding-done-redirect.js](ONBOARDING-DONE-REDIRECT-WIRING.md) owns consuming
it, unconditionally on every load, so a marker left behind by an abandoned
submit can never suppress more than one load. `sessionStorage`, not
`localStorage`: the skip is for this tab's immediate post-submit view, not
forever. Every access is wrapped in `try`/`catch` — Safari private mode throws
on storage, and the worst consequence of a failed marker is that the next load
redirects one beat early.

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
boots is left alone and handed to the marker instead.

### The PATCH

Initial attempt plus two retries, at roughly 1s and 3s, re-trading the token
between failed attempts, then it gives up silently with a staging-only warning.
A missed mark is recoverable — the member simply gets redirected on a later
visit once the record is right — so this never blocks or reloads the completion
view.

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
6. `/starter-onboarding` is Talent-only in the route-guard matrix. Leave that
   entry alone; this module assumes the guard has already done role routing.

## Staging QA order

This is the canonical walk for the pair — it exercises both files, so run it
here rather than in the read half's doc. Run it behind the Webflow password on
`the-starters-3-0.webflow.io`, or through `./dev-tunnel.sh` (both modules
deliberately allow `localhost`, `127.0.0.1`, `*.webflow.io`, and
`*.trycloudflare.com` so the tunnel loop works). Open the console — staging is
chatty, production is silent.

1. **Logged out.** Open `/starter-onboarding`. The page renders, no redirect,
   no Xano call in the Network tab from either file.
2. **Fresh Talent, not yet done.** Log in, open the page. It renders. The
   console notes "onboarding not marked done".
3. **Submit the full-profile form.** Watch the **Network tab**, not the page:
   find the `PATCH .../set_onboarding_status` request, confirm it actually fired,
   and read its response body for `{"onboarding_done": true}`. Then confirm
   `sessionStorage['starter-onboarding-just-submitted']` was set, and that you
   are **not** redirected — the completion state must stay visible. A success
   visual is not evidence on its own: a redirect-configured form can look like
   it submitted while no `PATCH` was ever issued.
4. **Reload immediately.** This is the fresh-submit beat: the page renders once
   more, no Xano read at all, and the sessionStorage key is now gone.
5. **Reload again.** Now the redirect fires: `/starter-dashboard`, via
   `replace()`, so Back does not bounce you into a loop.
6. **Repeat 2–5 with the consult form** on a second Talent account. Both forms
   count.
7. **Offline / blocked-Xano check.** With the Network tab throttled to offline
   (or the Xano origin blocked), reload the page and submit: it must render
   normally within a couple of seconds, the submit must not stall or error out,
   and no state may be left blank or stuck.
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
| PATCH returns 2xx but the member is never redirected later | Not this file — the record is right, so check the read half in [onboarding-done-redirect.js](ONBOARDING-DONE-REDIRECT-WIRING.md). |
| Redirects immediately after submitting | The marker was not written. Check `sessionStorage` is available (private mode, or a cookie/storage blocker) and look for the "could not write the fresh-submit marker" warning. |

## Diagnostics

`window.StartersPatchOnboardingStatus` exposes `allowedHost`, `stagingHost`,
`isOnboardingPath`, `diagnosticsEnabled`, `isShown`, `watchForms`,
`markOnboardingDone`, and `justSubmittedKey` for console checks.
`markOnboardingDone()` is callable by hand on staging to exercise the write —
marker and all — without submitting a form.

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
