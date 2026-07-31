# Onboarding Done Redirect Wiring

Status: Shipped — live on staging `/starter-onboarding` as a pinned tag;
splitting into a pair with `patch-onboarding-status.js` as of v1.59.47

`v3/onboarding-done-redirect.js` is a **page-scoped** module for
`/starter-onboarding`. It does one thing: it keeps a member who has already
finished onboarding out of the onboarding flow. It is the **read half** of a
pair — it reads status, decides, and redirects, and it never writes anything to
Xano.

Its required pair is
[patch-onboarding-status.js](ONBOARDING-PATCH-STATUS-WIRING.md), the write half,
which is what records the completion in the first place. Both jobs shipped as
one file through v1.59.45 and were split at v1.59.47. They are deliberately
self-contained twins — host allowlist, path gate, trade-token auth, the 8-second
request budget, and the staging-only diagnostics are duplicated in both files
rather than shared — so either can be edited or pulled without disturbing the
other. They still install together and version together.

It is not a sibling of [route-guard.js](route-guard.js) and does not replace it.
The route guard answers "may this role open this page" from Memberstack plans;
this module answers "has this Talent already finished" from the Xano record.
Both can run on the page; the guard runs sitewide and first.

## What it does

| Situation | Action |
| --- | --- |
| `onboarding_done === true` on the member's Xano freelancer record | `location.replace('/starter-dashboard')` |
| `onboarding_done` false, absent, or the envelope is empty | Render the page as authored |
| Fresh-submit marker present in `sessionStorage` (written by `patch-onboarding-status.js` on form success) | Consume the marker, skip the redirect check for this load only |
| Logged out, Memberstack absent, trade failed, HTTP error, timeout | Render the page as authored |
| Any other path, or an unapproved host | Do nothing at all (no Memberstack lookup, no redirect) |

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

The read and the write would otherwise fight. A member submits, Xano flips
`onboarding_done` to true, and the very next load of the page — the completion /
preview state the page is authored to show — would redirect them away before
they could read it.

So the write half sets `sessionStorage['starter-onboarding-just-submitted'] = '1'`
on a successful submit, and this file *consumes* it: on every load it reads the
key, removes it, and skips the redirect check once. Consumed unconditionally, so
a marker left behind by an abandoned submit can never suppress more than one
load, and never needs clearing by hand. The key is written **before** the
`PATCH` is issued, on purpose — see the write side in
[patch-onboarding-status.js](ONBOARDING-PATCH-STATUS-WIRING.md) — so the
completion view survives even if the write fails. `sessionStorage`, not
`localStorage`: the skip is for this tab's immediate post-submit view, not
forever. Every access is wrapped in `try`/`catch` — Safari private mode throws
on storage, and the worst consequence of a failed marker is that the next load
redirects one beat early.

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
3. This half needs nothing else from the Designer — it never looks at the forms.
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
   no Xano call in the Network tab.
2. **Fresh Talent, not yet done.** Log in, open the page. It renders. The
   console notes "onboarding not marked done".
3. **A member whose record is already done.** Open the page: the redirect fires
   to `/starter-dashboard`, via `replace()`, so Back does not bounce you into a
   loop.
4. **Offline / blocked-Xano check.** With the Network tab throttled to offline
   (or the Xano origin blocked), reload the page: it must render normally within
   a couple of seconds, never a blank or stuck state.
5. **Production silence.** After publishing, confirm the console prints nothing
   from `[starters onboarding-done]` on `thestarters.com`.

The full pair walk — submit a form, watch the `PATCH` land, then step through
the fresh-submit beat into the redirect — lives in
[patch-onboarding-status.js](ONBOARDING-PATCH-STATUS-WIRING.md). Run that one
before shipping either file.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Never redirects, console silent | The tag is not on the page, or the hostname is not approved. Check `window.StartersOnboardingDoneRedirect` exists in the console. |
| Pasted a copy of the file (console or a second embed) and nothing happens | The boot guard, working as designed: a copy already loaded by the page's CDN tag set `window.__startersOnboardingDoneRedirectBooted`, so every later copy exits immediately. To hand-exercise the module, call `window.StartersOnboardingDoneRedirect.redirectIfDone()` on staging instead of re-running the file. |
| Never redirects, console says "could not read onboarding status" | The trade-token or read call failed. The message carries the status; check the member has a `user_v3` row (trade-token 404s without one). |
| Never redirects, console says "onboarding not marked done" | The read succeeded and Xano says false. The write half never landed, or it wrote a different row — see [patch-onboarding-status.js](ONBOARDING-PATCH-STATUS-WIRING.md). |
| Redirect loops between the two pages | Not this module — check `v3/route-guard.js` and the `/starter-dashboard` page controllers. This one only ever replaces *away* from the onboarding page. |

## Diagnostics

`window.StartersOnboardingDoneRedirect` exposes `allowedHost`, `stagingHost`,
`isOnboardingPath`, `diagnosticsEnabled`, `onboardingDone`, `redirectIfDone`,
`justSubmittedKey`, and `dashboardPath` for console checks. `redirectIfDone()`
is callable by hand on staging to exercise the read and the decision without
waiting for a page load. The write-side helpers moved out with the split and now
live on `window.StartersPatchOnboardingStatus`.

## Release gate

- `node --test v3/onboarding-done-redirect.test.js`
- `node --check v3/onboarding-done-redirect.js`
- Walk the slim QA order above, then the full pair walk in
  [patch-onboarding-status.js](ONBOARDING-PATCH-STATUS-WIRING.md) — this file
  cannot be validated alone, because nothing marks a record done without its
  pair.
- Do not publish to the custom domain until the separate production go signal.
