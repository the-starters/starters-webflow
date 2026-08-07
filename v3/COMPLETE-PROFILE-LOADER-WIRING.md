# V3 Complete-Profile Submit Loader Wiring

Status: Code complete 2026-08-07. **Ships with a scoped change to
`v3/brand-account-controller.js`** (the redirect busy latch below) — the two land
together or the loader drops during every successful redirect. Still needs the
five-step Designer checklist below **and** one page-level Webflow embed; it does
not arrive with a jsDelivr tag on its own. The attributes published on
2026-08-07 are in place but **two are misplaced** — see "Published state" for
what to re-edit. Sits alongside
[complete-profile-back.js](COMPLETE-PROFILE-BACK-WIRING.md) and
[complete-profile-redirect.js](COMPLETE-PROFILE-REDIRECT-WIRING.md) on the same
page and shares nothing with either.

`v3/complete-profile-loader.js` shows the authored loader while the
Complete-profile form is submitting and fades back what is behind it. It never
submits anything, never touches the network, never reads Memberstack, and never
enables or disables a control. It watches one attribute and writes `display`,
`opacity`, `pointer-events` and `transition` — nothing else.

## Why a spinner at all

[brand-account-controller.js](BRAND-ACCOUNT-WIRING.md) runs this form, and a
durable submit is several round trips long. Today the page gives the member no
sign that anything is happening: the button greys out and then the page sits
there until it redirects. On a slow connection that reads as a dead form, and a
member who believes a form is dead starts clicking things.

## Where the signal comes from

`aria-busy` on the form, which the controller already maintains. Its
`setBusy(form, busy)` writes `aria-busy="true"` when a submit starts and
`aria-busy="false"` when it ends.

### The controller guarantee this depends on (changed in this PR)

**On a successful submit that initiates a redirect, the controller no longer
clears busy.** The form stays `aria-busy="true"` until the page unloads, and the
submit button keeps its spinner.

That is a change to `bindForm()` in
[brand-account-controller.js](BRAND-ACCOUNT-WIRING.md), made as part of this PR
and load-bearing for this module. `window.location.assign()` only **queues** a
navigation: the controller's promise chain settles while the browser is still
fetching `/brand-dashboard`, and the old `.finally` cleared busy right there. The
result was that the loader came down — and the button re-enabled — for the entire
redirect window, which is precisely the window this feature exists to mask. The
latch is scoped strictly to the path that called `assign`; a success with no
redirect URL, and every error, still release the form as before.

So `aria-busy="false"` is now, in practice, the **error** path: the path where
the member is staying on the page and needs the form back.

If that latch is ever reverted, this module does not break — it just stops
covering the redirect, which is the most valuable second it covers. A controller
test pins it: *"a successful submit that initiated a redirect stays busy until
the page unloads"*.

This module is a pure observer of that attribute:

- it does **not** bind `submit`, so it cannot interfere with the controller or
  with Webflow's own form handling;
- it does **not** touch the submit button. Double-submit is already guarded by
  the controller, and two owners of one button is how a form ends up permanently
  disabled.

## What it does

| Situation | Action |
| --- | --- |
| `aria-busy` becomes `"true"` | Loader gets an inline `display: flex`; each dim target present gets `opacity: 0.2`, `pointer-events: none`, and a `0.2s ease` opacity transition |
| The form is already busy when the script runs | Same, immediately, without waiting for the next attribute write |
| The submit succeeds and redirects | `aria-busy` stays `"true"`, so the loader stays up through the navigation (see the controller guarantee above) |
| `aria-busy` becomes `"false"` or is removed | Hide the loader and restore the dim targets, **after** the minimum display window |
| `aria-busy` flips false inside the minimum window | Hold the loader for the remainder, then hide |
| A second submit starts before a pending hide lands | Cancel that hide, restart both the minimum window and the 5s cap |
| Still showing 5000ms after a show | Hide and restore regardless of `aria-busy` (see fail-open) |
| A dim target is missing | Skip that one silently; the loader still shows |
| No `[data-complete-profile-loader]` on the page | Bail with zero side effects, silently |
| No form to watch, or no `MutationObserver` | Bail with the loader force-hidden, one staging warning |

### Minimum display

A spinner that appears and vanishes inside 80ms is a flash of noise, so once
shown the loader stays for at least the number of milliseconds in the loader's
own `data-loader` attribute — **1000** as authored on this page. A missing or
non-numeric value falls back to **200ms**, the same default the sibling
[explore-search list loader](../explore-search/explore-search-list-loader.js)
uses. `data-loader="0"` is honored as zero, not treated as missing.

### Fail-open, and why it is not optional

Every show arms a **5000ms** hard cap. If it fires while the loader is still up,
the loader hides and the dim is restored no matter what `aria-busy` says, with
one staging warning.

A spinner is a full-page visual block. A controller that throws before clearing
`aria-busy`, an attribute write this module never sees, or a bug in this file
must not be able to trap a member behind a permanent overlay. The submit button
staying disabled in that situation is the controller's business; leaving the
member able to see and use the page is this module's.

**The redirect latch changes what a cap hit means.** Because a successful submit
never clears `aria-busy`, the cap is now the *normal* end of a successful session
whenever the redirect takes longer than five seconds. A member on a slow
connection briefly sees the form again before the new page paints. That is the
intended trade: strictly better than a member on a stalled navigation staring at
a spinner with no way out. If that flash becomes a complaint, raise the cap —
do not remove it.

### Coalescing

Rapid busy/idle toggles resolve to one visible session. The dim bookkeeping
deliberately outlives the hide by one transition length (200ms), so a re-show
inside that window reuses the **originally captured** inline values instead of
recording this module's own `opacity: 0.2` as if the page had authored it. The
practical guarantee: never a hidden loader over a still-dimmed form, and never a
stray timer from the previous submit un-dimming a submit that is still running.

## Designer contract

One required hook, one dim target. **The script contract is final as coded — the
remaining work is all in the Designer.**

| Hook | Element | Notes |
| --- | --- | --- |
| `data-complete-profile-loader` | the loader div | **Required.** Authored hidden. Holds the spinner. |
| `data-loader` | the same loader div | Minimum display in ms. `1000` as authored; missing or non-numeric falls back to 200. |
| `data-complete-profile-element="form"` | `complete-profile_form-layout` | The single dim target. |
| `data-complete-profile-element="profile-photo"` | — | Supported by the script, **deliberately unused**. See below. |

### Published state as of 2026-08-07, and what is wrong with it

Verified against the live published DOM on production:

| Fact | Verdict |
| --- | --- |
| `.experts-list_loader.is-complete-profile` compiles `display: none` | **Done** |
| The loader div is still **empty** | Spinner child still owed |
| The photo div published `data-complete-profile-element="profile"` | **Wrong value** — the script looks for `profile-photo`, so this dims nothing |
| `data-complete-profile-element="form"` sits on the `display-contents w-form` div | **Wrong element** — see the `display: contents` trap |
| The loader div sits **inside** `complete-profile_form-layout` | Must move — that element is about to become the dim target, and it would fade its own spinner |

### Why one dim target, not two

Any box that contains the form fields also contains the photo, so a single
attribute on `complete-profile_form-layout` dims photo, fields and buttons in one
gesture. Two nested dim targets would be actively wrong: opacity **multiplies**
down the tree, so a photo inside a dimmed layout would land at `0.2 × 0.2 =
0.04` — effectively invisible, and visibly inconsistent with everything around
it. That is why step 3 below **deletes** the photo attribute rather than
correcting its value. The script keeps supporting a `profile-photo` target and
skips it silently when absent, which is exactly what we want here: no code change
needed to leave it unused, and none needed if a future layout ever wants it back.

**The loader needs a spinner child.** The element is empty as published, so
showing it today shows nothing. Whatever goes inside — a Lottie, an animated SVG,
a CSS ring — is the Designer's, and this module never looks at it.

**Show and hide are INLINE writes.** `display: flex` to show, `display: none` to
hide, both written to the element's `style` property. That is deliberate:
Webflow's Display:None usually compiles to a **class rule**, and a class rule
would beat anything written to the stylesheet. Inline always wins. It also means
the loader's own layout must work as a flex container — if the spinner needs
`display: block` or `grid`, say so and the constant gets changed here, not
worked around in the Designer.

**A missing dim target is a silent skip.** Absent is a supported state, not an
error: the loader shows on its own and nothing fades. That is what makes the
Designer work below safe to land incrementally — and also what makes a
mistyped attribute so easy to miss.

### Traps

**Author the loader hidden.** Set Display:None on the loader in the Designer. If
it ships visible and this script fails to load — a bad tag, a jsDelivr blip, a
purge in flight — the member gets a spinner sitting on the page with nothing able
to dismiss it. The module force-hides the loader once at init as a self-heal, so
an authored-visible loader is corrected the moment the script *does* run, but the
self-heal cannot help on the load that never happened.

**The attribute-name paste trap.** In Webflow's attribute panel the **Name**
field is easy to paste into with the leading `d` swallowed, leaving a name that
starts at `a`. Nothing complains: the attribute saves, the page publishes, and
the module simply never finds the element — a missing dim target is a silent skip
by design, so this one hides especially well. **Type the names rather than
pasting them**, and confirm in the published DOM that every one of them reads
`data-complete-profile-loader`, `data-loader`, and
`data-complete-profile-element` with the `d` intact. The same trap has already
cost a debugging session on the Turnstile opt-in marker on this very page.

**`display: contents` elements cannot be dimmed — this one already bit us.** A
`display: contents` element generates **no box**, so it has nothing to paint:
`opacity` on it does literally nothing, no matter how correct the attribute
looks in the inspector. `pointer-events`, which *inherits*, still reaches the
children — so the result is the worst possible failure mode, a form that goes
click-proof without any visual sign that it did. The member sees a live-looking
form that silently ignores them.

This is exactly what the published page does today: the attribute sits on the
`display-contents w-form` div. **Never put a dim attribute on the `w-form`
wrapper or on the `<form>` itself** — put it on a real box. It is the same
element family that broke Turnstile on this page, and it will keep costing
debugging sessions until people learn to check the computed `display` before
blaming the script.

**Do not put a dim attribute on an ancestor of the loader.** The loader is not
excluded from the dim targets by selector. If a dim target ever *contains* the
loader, the spinner fades to 20% along with everything else — which is precisely
why step 1 below moves the loader out of `complete-profile_form-layout` before
step 2 puts the attribute on it. **Do those two in order.**

## Webflow install

### Designer checklist — do steps 1 and 2 in this order

1. **Move the loader div out of `complete-profile_form-layout`.** Make it the
   **last child of `complete-profile_form-block`**, and set
   `complete-profile_form-block` to **`position: relative`**. The loader is
   `position: absolute`, so without a positioned parent it centres itself against
   whatever faraway ancestor happens to be positioned. Today its containing block
   is `complete-profile_form-layout`; moving it up a level without moving the
   `position: relative` with it is how the spinner ends up in the wrong place.
2. **Put `data-complete-profile-element="form"` on `complete-profile_form-layout`**
   — a real box, which dims the photo, the fields and the buttons in one go, and
   which after step 1 no longer contains the loader. **Remove the attribute from
   the `display-contents w-form` div**, where it currently sits and does nothing
   visible.
3. **Delete `data-complete-profile-element="profile"` from the photo div.** The
   value was wrong (`profile`, not `profile-photo`), and the correct target is
   deliberately unused — step 2 already dims the photo, and nesting the two would
   multiply the opacities to `0.04`. The script skips a missing `profile-photo`
   target silently by design, so deleting it needs no code change.
4. **Add the spinner child inside the loader div**, and confirm the loader is
   still **Display: None**. (`.experts-list_loader.is-complete-profile` already
   compiles `display: none` as published — just don't lose it in the move.)
5. **Publish, then visually confirm the loader still centres over the card.** The
   `left: 47%` positioning now resolves against `complete-profile_form-block`
   rather than `complete-profile_form-layout`, so this is the one step of the
   five that cannot be verified from the markup alone.
6. Add one deferred page-level tag on `/complete-profile`, and nowhere else:

   ```html
   <script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@vX.Y.Z/v3/complete-profile-loader.js" defer></script>
   ```

   Pin the embed to the tag this module ships with, the way the sibling embeds on
   this page are pinned. The tag number is set at release time.
7. Load order against the controller and the other two scripts does not matter.
   This module reads an attribute whenever it changes and reads it once at init,
   so it cannot miss a submit by being late.
8. Installing it elsewhere is harmless — no loader element means an immediate,
   silent bail — but there is no reason to.

**Moving the loader does not break form resolution.** The module resolves the
form from the loader's parent (`parentElement.querySelector('form')`) and falls
back to `#wf-form-Complete-Profile-Form`. After step 1 the parent is
`complete-profile_form-block`, which still *contains* the form further down, so
the primary lookup keeps working — and the id fallback covers it regardless.

No CSS is required beyond whatever styles the spinner itself. There is no error
state: the loader is either up or down.

## Diagnostics

`window.StartersCompleteProfileLoader` exposes `release`, `state`, `show`,
`hide`, `observer`, `stagingHost`, `diagnosticsEnabled`, `loaderSelector`,
`formSelector`, `dimSelectors`, `defaultMinMs`, and `maxMs`.

- `state` is the live picture. `state.showing` is the one-word answer, and
  `state.reason` names the branch that produced it: `watching`, `shown`,
  `reshown`, `min-display`, `idle`, `cap`, `no-loader`, `no-form`,
  `no-mutation-observer`, `observe-failed`, `show-failed`, or `hide-failed`.
- `state.minMs` is the resolved minimum display, which is the fastest way to
  catch a `data-loader` value that did not parse.
- `state.shows`, `state.hides`, `state.capHits` and `state.dimCount` are
  counters. `capHits` above zero is **not** automatically a fault: since the
  redirect latch, a successful submit whose navigation takes more than five
  seconds reaches the cap by design. Read it as "the loader freed the page
  itself", then ask *why* it had to — a slow redirect target is a performance
  problem, whereas a cap hit on the **error** path means the controller failed to
  clear `aria-busy`, and that one is a controller bug.
- `show()` and `hide()` are callable by hand on staging to look at the visual
  state without submitting the form. `hide()` still honors the minimum window.

Diagnostics narrate every decision on staging only — `*.webflow.io`, `localhost`,
`127.0.0.1`, `*.trycloudflare.com`, or `window.STARTERS_DEBUG === true`.
Production is completely silent, on the applied path and on every fail-open path
alike.

## Release gate

- Run `node --test v3/complete-profile-loader.test.js` and
  `node --test v3/brand-account-controller.test.js` — this feature spans both —
  plus the whole `v3/` suite. Use the glob form (`node --test v3/*.test.js`); the
  bare-directory form no longer works on Node 25.
- Walk **all five Designer steps** above and confirm the published DOM before
  touching QA: loader outside `complete-profile_form-layout`, form-block
  positioned, the dim attribute on the layout and **not** on the `w-form` div, the
  `profile` attribute gone, spinner child present, loader still hidden. Without
  them the module is a correct no-op and every check below passes vacuously.
- Confirm the loader still **centres over the card** after the move — the one
  thing the markup cannot tell you.
- On staging with the console open, submit the form and confirm the spinner
  appears and the whole card (photo, fields, buttons) fades as **one** layer, at
  one opacity — not a photo at `0.04`.
- **Confirm the spinner stays up through a successful redirect** and is still on
  screen as `/brand-dashboard` starts painting. This is the behaviour the
  controller latch was added for, and the whole point of the feature.
- Confirm the form comes back on the **error** path.
- Confirm the spinner survives a **fast** failure for the full second — that is
  the minimum-display window, and the one behaviour a manual walkthrough is most
  likely to skip.
- Force a hang (throttle to offline mid-submit) and confirm the spinner clears
  itself after five seconds with the page usable, even though the submit button
  stays disabled.
- Throttle to Slow 3G and submit successfully: expect the cap to fire and the
  form to reappear briefly before the new page paints. That is by design, not a
  regression — see the fail-open section.
- Double-click Submit and confirm exactly one visible spinner session, with no
  dimmed form left behind afterwards.
- Confirm the published DOM carries the full `data-` prefixes on every attribute
  name.
- Verify `window.StartersCompleteProfileLoader.release` matches the tag the embed
  is pinned to.
- Confirm the page issues no new network request because of this module — it
  makes none.
