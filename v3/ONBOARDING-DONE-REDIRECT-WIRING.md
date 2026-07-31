# Onboarding Done Redirect Wiring

Status: Local implementation only; not published

`v3/onboarding-done-redirect.js` is a **page-scoped** module for
`/starters-onboarding`. It does two things that belong together, and nothing
else: it keeps a member who has already finished onboarding out of the
onboarding flow, and it records the completion when a member finishes it.

It is not a sibling of [route-guard.js](route-guard.js) and does not replace it.
The route guard answers "may this role open this page" from Memberstack plans;
this module answers "has this Talent already finished" from the Xano record.
Both can run on the page; the guard runs sitewide and first.

## What it does

| Situation | Action |
| --- | --- |
| `onboarding_done === true` on the member's Xano freelancer record | `location.replace('/starter-dashboard')` |
| `onboarding_done` false, absent, or the envelope is empty | Render the page as authored |
| Fresh-submit marker present in `sessionStorage` | Consume the marker, skip the redirect check for this load only |
| Either page form reaches its Webflow success state | Set the marker, then `PATCH` `set_onboarding_status` |
| Logged out, Memberstack absent, trade failed, HTTP error, timeout | Render the page as authored |
| Any other path, or an unapproved host | Do nothing at all (no Memberstack lookup, no observers) |

Endpoints, both on `api:KZf7nFnk` and both bearer-authorized:

- Read: `GET /starters_onboarding/get_freelancers` — no params, answers
  `{"freelancer": [ <one record> ]}`, and an empty envelope for a member with no
  row yet.
- Write: `PATCH /starters_onboarding/set_onboarding_status` — no body, answers
  `{"onboarding_done": true}`.

Auth is the same trade-token flow the sibling v3 modules use: the Memberstack
JWT from `getMemberCookie()` is traded at
`api:g1vmSLWh/auth/trade-token/v3` for a Xano token, and the response is parsed
tolerantly (raw string, `{authToken}`, or `{token}`) because
`create_auth_token` has answered all three. The traded token is memoized for the
page, so the redirect check and a later submit share one trade, and it is
dropped after any failure so a retry re-trades instead of replaying a token
Xano just rejected.

## The decided behaviours

### Fail-open, everywhere

Every failure mode leaves the page exactly as authored: logged out, Memberstack
never loading, `getMemberCookie()` rejecting, a failed or empty token trade, a
non-2xx read, a malformed envelope, a request that hangs past the 8-second
budget. Only a literal `onboarding_done === true` redirects — a string
`"true"`, a `1`, or a missing field does not.

This is deliberate and is the whole risk posture of the module. The redirect is
a **UX courtesy, not a security boundary**. A completed member who reaches the
page anyway sees the onboarding form, which is harmless; a member wrongly
bounced to the dashboard because a transient Xano blip was read as "done" is
not. Access control stays where it already is: Memberstack gated content,
`v3/route-guard.js` for role routing, and Xano endpoint authorization for the
records themselves.

### The fresh-submit beat

The two jobs would otherwise fight. A member submits, Xano flips
`onboarding_done` to true, and the very next load of the page — the completion /
preview state the page is authored to show — would redirect them away before
they could read it.

So a successful submit writes `sessionStorage['starters-onboarding-just-submitted'] = '1'`
**before** the PATCH is issued, and the next load *consumes* it: reads it,
removes it, and skips the redirect check once. Written before the PATCH on
purpose, so the completion view survives even if the write fails or the member
navigates while it is in flight. Consumed unconditionally on every load, so a
marker left behind by an abandoned submit can never suppress more than one load.
`sessionStorage`, not `localStorage`: the skip is for this tab's immediate
post-submit view, not forever. Every access is wrapped in `try`/`catch` —
Safari private mode throws on storage, and the worst consequence of a failed
marker is that the next load redirects one beat early.

### Submit success, not submit click

Both native Webflow forms on the page count as completing onboarding — the full
profile one and the consult one. Detection watches for **success**, not for a
click: the page's vendor multi-step script owns the buttons, and a click only
means "tried".

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

Initial attempt plus two retries, at roughly 1s and 3s, then it gives up
silently with a staging-only warning. A missed mark is recoverable — the member
simply gets redirected on a later visit once the record is right — so this never
blocks or reloads the completion view.

## Webflow install

One deferred tag, in **Page Settings → Custom Code → Before `</body>`** on
`/starters-onboarding` only. Do not install it sitewide.

```html
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/onboarding-done-redirect.js" defer></script>
```

Pin `@vX.Y.Z` instead of `@latest` for production stability once the tag exists.

### Designer prerequisites

1. Memberstack must be loaded on the page (it is loaded site-wide today). The
   module waits up to 8 seconds for `window.$memberstackDom` and then fails
   open.
2. The two forms are **standard Webflow forms**. No custom attributes, no
   markers, no class renames are required — the module keys off the native
   `.w-form` wrapper and `.w-form-done` success block that Webflow already
   emits. Keep each form inside its own Form Block; keep the success block as
   the form's sibling inside that block.
3. Do not delete or restyle the success state out of the DOM. If a form's
   success block is removed, that form's completion can never be detected (the
   module logs a staging warning and skips it).
4. Nothing else on the page should show `.w-form-done` for a non-submit reason —
   that is read as a successful submit.
5. `/starters-onboarding` is Talent-only in the route-guard matrix. Leave that
   entry alone; this module assumes the guard has already done role routing.

## Staging QA order

Run behind the Webflow password on `the-starters-3-0.webflow.io`, or through
`./dev-tunnel.sh` (the module deliberately allows `localhost`, `127.0.0.1`,
`*.webflow.io`, and `*.trycloudflare.com` so the tunnel loop works). Open the
console — staging is chatty, production is silent.

1. **Logged out.** Open `/starters-onboarding`. The page renders, no redirect,
   no Xano call in the Network tab.
2. **Fresh Talent, not yet done.** Log in, open the page. It renders. The
   console notes "onboarding not marked done".
3. **Submit the full-profile form.** On the success state: confirm the
   `PATCH .../set_onboarding_status` fired and returned `{"onboarding_done": true}`,
   and that `sessionStorage['starters-onboarding-just-submitted']` was set.
   Confirm you are **not** redirected — the completion state must stay visible.
4. **Reload immediately.** This is the fresh-submit beat: the page renders once
   more, no Xano read at all, and the sessionStorage key is now gone.
5. **Reload again.** Now the redirect fires: `/starter-dashboard`, via
   `replace()`, so Back does not bounce you into a loop.
6. **Repeat 2–5 with the consult form** on a second Talent account. Both forms
   count.
7. **Offline / blocked-Xano check.** With the Network tab throttled to offline
   (or the Xano origin blocked), reload the page: it must render normally within
   a couple of seconds, never a blank or stuck state.
8. **Production silence.** After publishing, confirm the console prints nothing
   from `[starters onboarding-done]` on `thestarters.com`.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Never redirects, console silent | The tag is not on the page, or the hostname is not approved. Check `window.StartersOnboardingDoneRedirect` exists in the console. |
| Never redirects, console says "could not read onboarding status" | The trade-token or read call failed. The message carries the status; check the member has a `user_v3` row (trade-token 404s without one). |
| Never redirects, console says "onboarding not marked done" | The read succeeded and Xano says false. The PATCH never landed, or it wrote a different row. |
| Redirects immediately after submitting | The marker was not written. Check `sessionStorage` is available (private mode, or a cookie/storage blocker) and look for the "could not write the fresh-submit marker" warning. |
| PATCH never fires on success | The success block is missing, was already visible at boot, or is not inside the `.w-form` wrapper. The staging console names the case. |
| PATCH fires twice | Two `.w-form` wrappers reached their success state, which is the intended per-form behaviour. A single wrapper cannot fire twice. |
| Redirect loops between the two pages | Not this module — check `v3/route-guard.js` and the `/starter-dashboard` page controllers. This one only ever replaces *away* from the onboarding page. |

## Diagnostics

`window.StartersOnboardingDoneRedirect` exposes `allowedHost`, `stagingHost`,
`isOnboardingPath`, `diagnosticsEnabled`, `onboardingDone`, `isShown`,
`watchForms`, `markOnboardingDone`, `redirectIfDone`, `justSubmittedKey`, and
`dashboardPath` for console checks. `markOnboardingDone()` and
`redirectIfDone()` are callable by hand on staging to exercise either job
without submitting a form.

## Release gate

- `node --test v3/onboarding-done-redirect.test.js`
- `node --check v3/onboarding-done-redirect.js`
- Confirm `set_onboarding_status` is deployed and bearer-authorized before
  publishing; until then step 3 of the QA order will fail and the redirect will
  never arm for new completions.
- Walk the full staging QA order above on a Talent account for both forms.
- Do not publish to the custom domain until the separate production go signal.
