# V3 Complete-Profile Submit Loader Wiring

Status: Code complete 2026-08-07. Needs a spinner child inside the loader, the
two Designer attributes below **and** one page-level Webflow embed; it does not
arrive with a jsDelivr tag on its own. Sits alongside
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
`aria-busy="false"` when it ends. On the **success** path the page redirects
instead, so `"false"` is in practice the error path — which is exactly the path
where a member is still on the page and needs the form back.

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

### Coalescing

Rapid busy/idle toggles resolve to one visible session. The dim bookkeeping
deliberately outlives the hide by one transition length (200ms), so a re-show
inside that window reuses the **originally captured** inline values instead of
recording this module's own `opacity: 0.2` as if the page had authored it. The
practical guarantee: never a hidden loader over a still-dimmed form, and never a
stray timer from the previous submit un-dimming a submit that is still running.

## Designer contract

One required hook, two optional. The loader today is a
`div.experts-list_loader.is-complete-profile[data-complete-profile-loader][data-loader="1000"]`,
a **sibling placed after the `</form>`** inside the same parent container, and it
is currently **empty**.

| Hook | Element | Notes |
| --- | --- | --- |
| `data-complete-profile-loader` | the loader wrapper | **Required.** Authored **hidden**. Holds the spinner. |
| `data-loader` | the same loader wrapper | Minimum display in ms. `1000` as authored; missing or non-numeric falls back to 200. |
| `data-complete-profile-element="form"` | the form block | Optional dim target. |
| `data-complete-profile-element="profile-photo"` | the profile-photo block | Optional dim target. |

**The loader needs a spinner child.** The element is empty as authored, so
showing it today shows nothing. Whatever goes inside — a Lottie, an animated SVG,
a CSS ring — is the Designer's, and this module never looks at it.

**Show and hide are INLINE writes.** `display: flex` to show, `display: none` to
hide, both written to the element's `style` property. That is deliberate:
Webflow's Display:None usually compiles to a **class rule**, and a class rule
would beat anything written to the stylesheet. Inline always wins. It also means
the loader's own layout must work as a flex container — if the spinner needs
`display: block` or `grid`, say so and the constant gets changed here, not
worked around in the Designer.

**Both dim attributes are pending Designer work.** Absent is the expected first
state in production, not an error: the loader shows on its own and nothing is
faded. Add them and the dim starts working with no code change.

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

**Do not put the dim attributes on an ancestor of the loader.** The loader is not
excluded from the dim targets by selector; it is simply a sibling of the form
today. If a dim target is ever authored as a wrapper that *contains* the loader,
the spinner will fade to 20% along with everything else.

## Webflow install

1. In the Designer, add the spinner child inside the loader element and confirm
   the loader is set to **Display: None**.
2. Add `data-complete-profile-element="form"` to the form block and
   `data-complete-profile-element="profile-photo"` to the profile-photo block.
   Both are optional; add them together so the dim reads as one gesture.
3. Add one deferred page-level tag on `/complete-profile`, and nowhere else:

   ```html
   <script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@vX.Y.Z/v3/complete-profile-loader.js" defer></script>
   ```

   Pin the embed to the tag this module ships with, the way the sibling embeds on
   this page are pinned. The tag number is set at release time.
4. Load order against the controller and the other two scripts does not matter.
   This module reads an attribute whenever it changes and reads it once at init,
   so it cannot miss a submit by being late.
5. Installing it elsewhere is harmless — no loader element means an immediate,
   silent bail — but there is no reason to.

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
  counters — `capHits` above zero on a normal submit means the controller is
  leaving `aria-busy` set, which is a controller bug, not a loader bug.
- `show()` and `hide()` are callable by hand on staging to look at the visual
  state without submitting the form. `hide()` still honors the minimum window.

Diagnostics narrate every decision on staging only — `*.webflow.io`, `localhost`,
`127.0.0.1`, `*.trycloudflare.com`, or `window.STARTERS_DEBUG === true`.
Production is completely silent, on the applied path and on every fail-open path
alike.

## Release gate

- Run `node --test v3/complete-profile-loader.test.js`, and the whole `v3/` suite
  with it.
- Confirm the spinner child exists and the loader is authored hidden **before**
  QA — without a child the module is a correct no-op that shows an empty box, and
  every test passes vacuously.
- On staging with the console open, submit the form and confirm the spinner
  appears, the form and profile photo fade, and both come back on the error path.
- Confirm the spinner survives a **fast** failure for the full second — that is
  the minimum-display window, and the one behaviour a manual walkthrough is most
  likely to skip.
- Force a hang (throttle the network to offline mid-submit) and confirm the
  spinner clears itself after five seconds with the page usable, even though the
  submit button stays disabled.
- Double-click Submit and confirm exactly one visible spinner session, with no
  dimmed form left behind afterwards.
- Confirm the published DOM carries the full `data-` prefixes on all four
  attribute names.
- Verify `window.StartersCompleteProfileLoader.release` matches the tag the embed
  is pinned to.
- Confirm the page issues no new network request because of this module — it
  makes none.
