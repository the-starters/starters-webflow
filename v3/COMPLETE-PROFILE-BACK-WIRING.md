# V3 Complete-Profile Back Button Wiring

Status: Code complete 2026-08-06. Needs the two Designer attributes below **and**
one page-level Webflow embed; it does not arrive with a jsDelivr tag on its own.
Sits alongside [complete-profile-redirect.js](COMPLETE-PROFILE-REDIRECT-WIRING.md)
on the same page and shares nothing with it.

`v3/complete-profile-back.js` turns the authored, inert "Go back to [Name]" button
on `/complete-profile` into a working escape hatch: it decides whether the button
deserves to exist for this visit, names the place it points at, reveals it, and
wires the click. It never redirects anybody, never reads Memberstack, and never
touches the network.

## Why an in-page button at all

An unfinished paid Brand is pushed onto `/complete-profile` by
[brand-profile-redirect.js](BRAND-PROFILE-REDIRECT-WIRING.md) with
`location.replace()`, which **destroys the history entry it replaced**. The
browser's own back button therefore does not go where the member expects — it
goes one further back, or nowhere. So the page gets its own back control,
pointing at a URL this module captured on entry rather than at a history stack it
cannot trust.

## What it does

On `/complete-profile` and `/complete-profile/` only, on the approved hosts only:

| Effective referrer | Action |
| --- | --- |
| A same-site page that is not on the hide list | Reveal the button, label it, bind the click |
| Nothing at all (no referrer, nothing stored) | Stay hidden |
| An off-site page (Google, a newsletter, a partner site) | Stay hidden, and do not fall back to a stored page |
| A funnel or login page (`/auth-route`, `/login`, `/sign-up`, `/starter-login`) | Stay hidden |
| Any page guarded by `brand-profile-redirect.js` | Stay hidden |
| `/complete-profile` itself | Stay hidden |
| The wrapper or the label element is missing | Stay hidden, one staging warning |
| `sessionStorage` absent or throwing, `window.URL` missing, DOM unqueryable | Stay hidden, page untouched |

"Stay hidden" always means the page renders **exactly as authored** — the button
is already hidden in the Designer, so the failure mode is the status quo.

### The hide list, and why the guarded pages are on it

```
/auth-route  /login  /sign-up  /starter-login
/brand-dashboard  /all-starters  /messages  /starter-dashboard  /dashboard
/opportunities  /opportunities/<slug>
/complete-profile
```

Compared **after normalization** (one trailing slash dropped, except at the root),
so `/login/` and `/login` cannot disagree, and a query string cannot defeat the
match.

The first row is obvious: sending an authenticated member back to a login form is
nonsense. The second row is the load-bearing one. Every page in it is guarded by
`v3/brand-profile-redirect.js` **v1.59.116**, which is exactly the module that
bounces an unfinished Brand *to* this form. A "go back" to any of them is a round
trip that lands the member on the same form a second later, having watched two
navigations to get nowhere. `/opportunities/<slug>` uses the same single-segment
shape the guard does, so `/opportunities/product-designer/apply` is deliberately
**not** hidden — it is not guarded there either.

**Keep the two lists in step.** If a page is ever added to
`brand-profile-redirect.js`'s `GUARDED_PATHS`, add it here too, or the loop opens
back up on that one page.

## The label map

The label element's **full text** is replaced with `Go back to <Name>`:

| Referrer path (after normalization) | Label |
| --- | --- |
| `/` | Go back to Home |
| `/learn` | Go back to Learn |
| `/learn/sessions`, `/learn/sessions/<slug>` | Go back to Sessions |
| `/learn/interview-news/<slug>`, `/learn/interviews` | Go back to Article |
| `/learn/playbooks-frameworks/<slug>`, `/learn/frameworks-playbooks` | Go back to Playbook |
| `/learn/webinar` | Go back to Webinar |
| `/learn/events` | Go back to Events |
| `/case-studies`, `/case-studies/<slug>` | Go back to Case Studies |
| `/why-us` | Go back to Why Us |
| `/functions/<slug>` | Go back to Functions |
| `/industries/<slug>` | Go back to Industries |
| `/hire/<slug>` | Go back to **&lt;first name&gt;** |
| Anything else | **Go back** |

The map is curated, not derived. A slug-to-title-case guess produces "Go back to
Frameworks Playbooks" and "Go back to Interview News", which reads worse than
saying nothing, so every public surface a Brand plausibly arrives from is named by
hand and everything else falls back to a bare `Go back` — a button that still
works and simply stops promising where it goes.

The one derived label is `/hire/<slug>`: the segment before the first hyphen,
title-cased, so `/hire/john-doe` becomes **Go back to John**. That is the only
case where the slug carries the exact word the member is looking for. A slug with
nothing before the hyphen (`/hire/-doe`) yields no name and falls back to
`Go back` rather than to a dangling `Go back to `.

**All Starters, Opportunities, Messages and both dashboards are deliberately
absent from the map** because the hide list already makes them unreachable. An
entry for them would read as an oversight the day someone loosens the hide list;
a test asserts every hidden path is unnamed.

Paths not on the list — including `/learn/interviews/<slug>`, `/hire`, `/functions`
and `/industries` without a slug — get the bare `Go back`. Adding one is a
one-line entry in `LABEL_RULES`.

## Where the destination comes from

`document.referrer`, read on init, mirrored into `sessionStorage` under
**`thestarters:v3-complete-profile-back`**:

1. A non-empty referrer whose **origin** passes the same `allowedHost()` gate as
   the module itself is stored — overwriting any prior value — and used. The
   member's most recent entry into this page is the only one worth going back to.
2. A non-empty referrer from anywhere else is neither stored nor used, and does
   **not** fall back to the stored value. The member's last move was an arrival
   from a site we do not own; quietly offering them a page from an earlier hop
   would be a lie about where "back" goes.
3. An **empty** referrer — a reload, a direct hit, or a stripped referrer policy —
   falls back to the stored value, re-validated against the same host gate on the
   way out so a hand-edited or cross-origin entry cannot become a navigation
   target. This fallback is the entire reason the key exists: a refresh of the
   form is exactly when the member is most likely to want out, and it is also
   precisely when the referrer is gone.
4. Neither → the button stays hidden.

Capture is **origin-only, before the hide rule**. A referrer of `/login` is stored
and *then* hides the button, so a member who went `/case-studies` →
`/complete-profile` → `/login` → `/complete-profile` is not offered the case study
they left two navigations ago.

The click is `window.location.assign(<the stored URL>)` — the **full** URL,
query string and hash included, always same-origin by construction.

### This key is ours alone

`thestarters:v3-brand-profile-completed` lives on the same page and belongs to
[brand-account-controller.js](BRAND-ACCOUNT-WIRING.md),
[complete-profile-redirect.js](COMPLETE-PROFILE-REDIRECT-WIRING.md) and
[brand-profile-redirect.js](BRAND-PROFILE-REDIRECT-WIRING.md). This module never
reads or writes it, and a test asserts the key appears in no string literal here.

`sessionStorage` is deliberate: the value dies with the tab, which is the right
lifetime for "where this visit came from". Every access is wrapped, because Safari
private mode throws on the property itself — a storage failure costs the reload
fallback and nothing else.

## Designer contract

Three hooks, all optional at runtime. The wrapper today is a
`div.button_main-wrap[data-button-theme="disabled"]` holding an empty
`<button type="button" class="clickable_btn">` and the text.

| Hook | Element | Notes |
| --- | --- | --- |
| `data-complete-profile-back` | the button **wrapper** | Authored **hidden**. This module reveals it. |
| `data-complete-profile-back-label` | the **text** element | Its **full** text is replaced, so it holds `Go back to Home`, not just `Home`. |
| `button.clickable_btn` | the real control inside the wrapper | No attribute needed; found by class. |

**Reveal mechanics.** Webflow has two ways of saying "hidden" and a Designer edit
can leave either behind, so both are cleared independently: the project's `hide`
utility class is removed, and an inline `display:none` is cleared to `''`. An
inline `display` that is something *other* than `none` is left alone — that is a
deliberate layout value, not a hiding mechanism.

**Author the button hidden.** If the wrapper ships visible, an unfinished Brand
who arrives from `/brand-dashboard` sees a dead "Go back to [Name]" button, because
this module's answer for that referrer is "stay hidden" and it will not hide
something it did not reveal.

**The label element is required for the button to appear at all.** Without it,
revealing would ship the authored `[Name]` placeholder to a real member, which is
worse than the hidden button they have today — so a missing label keeps the button
hidden and warns on staging. The inner `button.clickable_btn` is *not* required:
the click is bound on the wrapper as well, so the control degrades instead of
dying. Both bindings share a one-shot latch, so a press on the button — which
bubbles to the wrapper — is one navigation, not two. `type="button"` means there
is no submit to `preventDefault`.

## Webflow install

1. In the Designer, add `data-complete-profile-back` to the button **wrapper** and
   `data-complete-profile-back-label` to the **text** element inside it. Confirm
   the wrapper is hidden (the `hide` class, or `display: none`).
2. Add one deferred page-level tag on `/complete-profile`, and nowhere else:

   ```html
   <script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.117/v3/complete-profile-back.js" defer></script>
   ```

3. Load order against the other two scripts on this page does not matter. This
   module shares no state with either, needs no role contract, and if
   `complete-profile-redirect.js` decides to navigate, the button simply never
   gets clicked.
4. Do not install it anywhere else. The path gate refuses every other page, and
   the module would have no markup to act on regardless.
5. Pin the embed to the tag the module shipped with (`v1.59.117`), the way the
   sibling embeds on this page are pinned.

No CSS is required. There is no spinner and no error state: the button is either
revealed or left as authored.

## Diagnostics

`window.StartersCompleteProfileBack` exposes `release`, `state`, `init`,
`allowedHost`, `stagingHost`, `isCompleteProfilePath`, `diagnosticsEnabled`,
`normalizePath`, `destinationNameFor`, `labelFor`, `shouldHide`, `storedReferrer`,
`effectiveReferrer`, `storageKey`, `completeProfilePaths`, `hiddenPaths`,
`wrapperSelector`, `labelSelector`, `buttonSelector`, `hiddenClass`, and
`fallbackLabel`.

- `state` is the live decision. `state.applied` is the one-word answer, and
  `state.reason` names the branch that produced it: `applied`, `no-wrapper`,
  `no-referrer`, `excluded-referrer`, `no-label`, or `label-write-failed`.
- `shouldHide(url)` and `labelFor(pathOrUrl)` are pure and safe to call by hand —
  the fastest way to ask "why is the button not there?" and "what would it say?".
  `labelFor()` accepts a bare path or a full URL.
- `effectiveReferrer()` answers "which URL would the click use?", and captures as
  a side effect exactly the way init does.
- `init()` is idempotent: calling it once the button is applied re-binds nothing.

Diagnostics narrate every decision on
[staging only](../README.md#staging-only-console-diagnostics).
Production is completely silent, on the applied path and on every fail-open path
alike.

## Release gate

- Run `node --test v3/complete-profile-back.test.js`, and the whole `v3/` suite
  with it.
- Confirm both Designer attributes are on the page and the wrapper is authored
  hidden **before** QA — without them the module is a correct no-op and every
  test below passes vacuously.
- On staging with the console open, walk in from `/why-us` and confirm the button
  reads "Go back to Why Us" and returns you there in one navigation.
- Walk in from `/hire/<a real starter slug>` and confirm the label is the
  Starter's first name only.
- Walk in from `/brand-dashboard` (the redirect will do it for you as an
  unfinished Brand) and confirm the button stays **hidden**. Repeat for `/login`.
- Walk in from an unmapped page (`/pricing`) and confirm the label is the bare
  "Go back" and the button still works.
- With the button showing, **refresh** the page and confirm it survives — that is
  the `sessionStorage` fallback, and the one behaviour a manual walkthrough is
  most likely to skip.
- Confirm `sessionStorage` holds `thestarters:v3-complete-profile-back` and that
  `thestarters:v3-brand-profile-completed` is unchanged by this module.
- Confirm one press produces exactly one entry in the console's navigation log —
  the wrapper and the inner button are both bound.
- Confirm the page issues no new network request because of this module — it makes
  none.
- Verify `window.StartersCompleteProfileBack.release` matches the tag the embed is
  pinned to.
- Do not publish custom domains until the separate production go signal.
