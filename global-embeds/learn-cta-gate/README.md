# Learn CTA gate

`learn-cta-gate.js` opens the sign-up gate on a Learn article once the reader has
read enough of it, or after a short wait on an article too short to scroll.
`learn-cta-gate.css` owns the gate's **closed** state. The two ship together and
carry the same `@release` marker; a test pins that.

Both are loaded in the Learn article template, and **the order matters**: the
stylesheet in the head code, the script with `defer` in the before-`</body>`
code, after it.

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/global-embeds/learn-cta-gate/learn-cta-gate.js"></script>
```

Like [`session-video/`](../session-video/README.md) and unlike most of
[`global-embeds/`](../README.md), the script is **CDN-served rather than pasted
into a Webflow embed**, so a change to it only reaches the site once a release
tag is pushed and jsDelivr resolves `@latest` to it. The stylesheet ships with
it under the same tag.

The header blocks in [`learn-cta-gate.js`](learn-cta-gate.js) and
[`learn-cta-gate.css`](learn-cta-gate.css) are the **authoritative contract**.
This document explains the model behind them and what the Designer has to
provide; where the two ever disagree, the headers win.

The embed is **inert until the gate markup exists**. With no
`[data-learn-gate-element="wrapper"]` on the page it returns silently — that is
the normal case on every page that is not a Learn article — and leaves the page
exactly as authored.

**What it replaces.** The gate markup already existed and painted fully visible
on load, so every Learn article was blocked from first paint with no reveal at
all. An older inline embed on the template watched `section.gated` and froze the
`<html>` and `.page-wrapper` overflow, but the section's class is
`section_learn-cta-gate`, so that embed returned on its null check and never ran.
This pair supersedes it, and the inline embed is being removed.

## The two trigger modes

Chosen **once at init**, and mutually exclusive:

| Mode | Condition | Behaviour |
| --- | --- | --- |
| Scroll | Article of at least `data-learn-gate-chars` characters (default 2500) | A 1px out-of-flow sentinel is planted after the text node that crosses the threshold, and an IntersectionObserver opens the gate when it comes on screen. **No timer runs.** |
| Timer | Article below that threshold | The sentinel is skipped entirely and the gate opens `data-learn-gate-delay` seconds after init (default 10). |

**Why a character count and not a scroll percentage.** Character count and pixel
height are not proportional in CMS rich text: one embedded video or hero image
moves "34% scrolled" by hundreds of characters in either direction. A node
planted at the actual 2500th character is correct on every article regardless of
what else is in it.

The count is whitespace-collapsed, so it matches what a reader sees rather than
counting the newlines and indentation Webflow puts between blocks, and
`<script>`, `<style>` and `<noscript>` subtrees are skipped — their text would
otherwise inflate the count enormously on a rich-text block containing an embed.

The sentinel is planted **after a whole text node** rather than inside a split
one. Paragraph granularity is plenty for a paywall, and not splitting text nodes
keeps links, spans and Webflow's rich-text markup untouched. It is `position:
absolute` and 1px rather than zero-area, because some engines will not report a
zero-area target to an IntersectionObserver at all.

**If the article body cannot be found** (`data-learn-gate-article`, default
`.content_rte.w-richtext`), the embed falls back to the timer rather than never
gating. Failing toward "the gate still appears" is the right direction here; the
alternative silently gives the whole article away.

**Once only.** `state.revealed` latches on the first reveal and every trigger is
torn down in the same tick, so a timer and an observer can never both fire it and
a dismissed gate cannot come back on that page. A fresh load starts clean. That
is the whole of the "stays closed" behaviour — there is deliberately no cookie
and no `localStorage`.

## Who is gated is Memberstack's decision, not this script's

The wrapper carries Memberstack's `data-ms-content="!learn-access"`. The embed
reads the wrapper's **computed display** and exits without writing a single style
when it resolves to `none`.

- **Computed style, not element presence.** This site does both: Memberstack
  removes some gate variants and merely hides others, so presence proves nothing
  while computed display covers both cases.
- **Why it must write nothing at all on that path.** GSAP writes inline styles,
  and an inline `opacity` or `visibility` from us on an element Memberstack meant
  to hide is exactly how a paywall leaks to a paying member.

**That guard is worthless if it runs too early, which is the real trap.**
Memberstack resolves the member asynchronously and paints the gates *after*
defer-time scripts run — the same window
[`expert-card-browse-loader.js`](../expert-card/expert-card-browse-loader.js)
documents. A guard that reads the wrapper at `DOMContentLoaded` therefore sees
`display: flex` for **every** reader including one with learn-access, arms
itself, and later locks the scroll of a member who can see no gate and has no way
to unlock it. The close control below does not rescue them: their whole wrapper
is hidden, so the close inside it is hidden too and `dismissible` resolves false.

So the embed guards that window twice:

1. Boot waits on `window.memberReady`, the site's own readiness promise, used the
   same way by `route-guard.js`, `expert-card-browse-loader.js` and
   `posthog-identity.js`.
2. Reveal re-checks computed display **before** the scroll lock, covering a gate
   that Memberstack hides later still. On that path it stands down, tears the
   triggers down and records `skipped: 'memberstack-hidden-late'` without locking
   anything.

**It fails open**, unlike [`session-video.js`](../session-video/session-video.js),
which fails closed. A missing or rejected `memberReady` still boots, because a
gate that fails to appear is a much smaller problem than one that traps a paying
member on a page they cannot scroll.

Scroll lock is byte-for-byte the [`modal.js`](../modal/modal.js) line — prefer
`lenis.stop()`, else `document.body.style.overflow = 'hidden'` — so the site has
one lock idiom. There is no Lenis instance on the Learn template today, so it
takes the body-overflow branch. The unlock mirrors it exactly and restores
overflow to `''` rather than forcing `visible`, so whatever Webflow had there
survives.

## Who may close it is also Memberstack's decision

The gate is a **hard paywall** unless the Designer authors a close control:
`[data-learn-gate-close-button]`, inside the wrapper, carrying its own
`data-ms-content`. A logged-in non-paying member sees one and may dismiss; a
logged-out reader gets no such element and the gate stays exactly as hard as it
was before this existed.

The script reduces all of that to **one boolean**, `state.dismissible`, and every
dismissal path is gated on it. One value to reason about, one value to test.

| Rule | Why |
| --- | --- |
| It is a **standalone attribute**, not a fourth `data-learn-gate-element` role value | An element can carry only one `data-learn-gate-element`, and in Designer the close control is quite likely to sit on a node that already has a role. |
| **Put it on something Memberstack can hide** | The whole gate rests on asking whether the close control is displayed. |
| Resolved **at reveal, never at boot** | Memberstack resolves after defer-time scripts, so a boot-time read predates the decision and would hand every logged-out reader a dismissible paywall. |
| Resolved from **computed display, not presence** | A close control Memberstack merely hid is still in the DOM and `querySelector` still finds it; binding a live click handler to it would be an invisible escape hatch inside a gate meant to be hard. |
| The check **walks every ancestor up to the wrapper** | `getComputedStyle` on a descendant of a `display: none` subtree reports that descendant's *own* display — `block`, not `none` — because ancestor display does not propagate into the computed value. Without the walk, a control reads as visible whenever Memberstack's attribute sits on a div *wrapping* it, which is an entirely normal way to author it. |
| The walk tests `display` only, **never `visibility`** | Visibility inherits, and the gate is still `visibility: hidden` when this runs, so every descendant would report `hidden` and no gate could ever be dismissible. |
| The hook is looked up with **`querySelectorAll`**, and the **backdrop is skipped** | Two separate reasons, below. |

**Why the backdrop can never be the close control.** The backdrop is part of the
gate and shows for every reader, so accepting it would resolve `dismissible` true
for a logged-out one and hand them the article. Hiding the backdrop from
non-members to work around that would take the dimming with it. Putting the hook
on the backdrop *as well as* on a real button is harmless and common — it reads
as "clicking outside should close it too" — so it is skipped with an
informational note rather than refused, and the real button still wins. On a
backdrop-only hook the embed warns and the gate stays hard.

**Why `querySelectorAll` and not `querySelector`.** The backdrop is authored
before the sheet, so it wins first-match. A `querySelector` here returns the one
element that can never gate anything, discards it, and never looks at the real
control — the gate silently refuses to close for a member looking at a perfectly
good close button. That shipped as a bug in `v1.59.182`.

Dismissal behaviour:

- Backdrop-click dismisses. The handler checks `event.target`, so a click that
  lands on the sheet — or on the sign-up form inside it — can never close the
  gate by bubbling.
- **Escape deliberately does not.** No keydown listener is registered at all; the
  absence is the feature, so adding one is a spec change rather than a fix.
- The scroll unlocks **on click, not when the exit finishes**. The click already
  committed to closing, and a page that stays frozen for a third of a second
  after a button press reads as broken.
- `pointer-events: none` goes on the wrapper immediately, so the full-screen
  wrapper cannot swallow clicks while the sheet slides away.

## Markup

Designer-authored, found by attribute only:

| Attribute | On | Purpose |
| --- | --- | --- |
| `data-learn-gate-element="wrapper"` | `section_learn-cta-gate` — `position: fixed`, inset 0, `z-index: 10`, `display: flex`, column, justify-end | Scopes everything below it. Carries Memberstack's `data-ms-content="!learn-access"` and all of the optional attributes. |
| `data-learn-gate-element="backdrop"` | `learn-cta-gate_backdrop`, absolute inset 0 | The dimming layer. Click-to-dismiss target. |
| `data-learn-gate-element="content"` | `learn-cta-gate_contents` | The sheet that slides up. |
| `data-learn-gate-close-button` | optional, inside the wrapper, **never the backdrop** | The close control. Carries its own `data-ms-content`. |

A wrapper without a backdrop or without content stops the embed with a warning
rather than opening a half-built gate. The embed also writes
`data-script-initialized="true"` on the wrapper so a second load cannot
double-arm it, and there is a window-level init guard
(`window.__startersLearnCtaGateBooted`) so a duplicate script tag cannot
overwrite the live API with a dud instance.

`data-learn-gate-element="sentinel"` is written by the script, not authored.

All optional, all on the wrapper:

| Attribute | Default | Meaning |
| --- | --- | --- |
| `data-learn-gate-chars` | 2500 | Threshold in characters that picks the mode. |
| `data-learn-gate-delay` | 10 | Short-article wait, in seconds. |
| `data-learn-gate-article` | `.content_rte.w-richtext` | CSS selector for the article body. |
| `data-learn-gate-ease` | `power2.out` | GSAP ease for the sheet. |
| `data-learn-gate-duration` | 0.35 | Sheet travel time, in seconds. |
| `data-learn-gate-fade` | 0.2 | Backdrop fade time, in seconds. |
| `data-learn-gate-lag` | 0.3 | When the sheet starts, measured from the **start** of the backdrop fade. |

A garbage, negative or unparseable value falls back to the default with a staging
warning rather than throwing — an authoring typo in Designer must not take the
gate down.

## Motion

The four motion attributes exist so the feel can be retuned in Designer **without
a release**. The defaults were chosen on staging with a visual tuner, not picked
off a page of easing curves, so treat them as intentional.

**`lag` (0.3) deliberately exceeds `fade` (0.2).** The dimming completes, the
page holds still for a beat, and only then does the sheet arrive. A lag at or
below the fade overlaps the two instead; both are valid, but the sequential read
is the shipped one, and a test pins the relationship so a later tidy-up cannot
quietly clamp it.

An ease is validated against **this page's own GSAP** via `gsap.parseEase`, which
returns a non-function rather than throwing for an ease the build does not know.
An unknown one falls back to the default with a staging warning rather than
silently flattening the animation. Asking GSAP beats keeping a hardcoded list
here that would drift out of date.

`prefers-reduced-motion: reduce` ignores all four: the sheet never slides, and
both parts cross-fade in 0.2s. The sheet is not parked off-screen at all on that
path.

**Without GSAP** the gate still opens and closes, just instantly: `applyStyles()`
writes the same open and closed states as inline styles. Both directions go
through that one function on purpose — two hand-written mirrors is how a property
gets added to the open state and quietly forgotten in the closed one.

`will-change: transform` is set by the stylesheet and cleared by the script when
the timeline completes, so the promoted layer does not outlive the one animation
that needs it.

## Events and diagnostics

| PostHog event | Window event | When |
| --- | --- | --- |
| `learn_gate_shown` | `learn-gate-shown` | The gate opens. |
| `learn_gate_dismissed` | `learn-gate-dismissed` | The gate is closed, carrying `via`: `close` \| `backdrop` \| `manual`. |

Shown and dismissed carry the same identifying fields, so the two can be joined
without a lookup: the PostHog pair sends `slug`, `trigger`, `chars`, `threshold`
and `release`; the window events send `trigger`, `chars` and `threshold` on
`event.detail`. The dismissal is measured because a shown-count alone cannot say
what making the paywall escapable for a whole segment cost. A missing PostHog or
one that throws never stops the gate opening.

`window.StartersLearnCtaGate` exposes:

- `status()` — `mode`, `revealed`, `trigger`, `chars`, `threshold`,
  `delaySeconds`, `skipped`, `hasSentinel`, the resolved `motion`,
  `reducedMotion`, and `dismissible` / `dismissed` / `dismissedVia`.
- `reveal()` — forces it open.
- `dismiss()` — closes it, **gated on `dismissible` like every other path**. On a
  hard gate it is a deliberate no-op rather than a console bypass, so QA an exit
  animation by authoring a close control, never by reaching past the guard.

`console` diagnostics are emitted on staging hosts (`*.webflow.io`, `localhost`,
`127.0.0.1`, `*.trycloudflare.com`) and when `window.STARTERS_DEBUG === true`;
production is silent. The host patterns are anchored, so a lookalike
(`notwebflow.io`, `evil-trycloudflare.com`) cannot read as staging, and
`STARTERS_DEBUG` may turn logging on in production but must never widen what
counts as a staging host.

## The stylesheet: the closed state

[`learn-cta-gate.css`](learn-cta-gate.css) owns the closed state and nothing
else — the script only opens the gate.

| Selector | Declares | Why |
| --- | --- | --- |
| `html [data-learn-gate-element="wrapper"]` | `opacity: 0`, `visibility: hidden`, `pointer-events: none` | All three are needed, and neither `visibility` nor `pointer-events` is exposed in the Webflow style panel. The wrapper is `position: fixed; inset: 0`, so an `opacity: 0` wrapper without the click-through swallows every click on the article underneath it while still being invisible. |
| `html [data-learn-gate-element="backdrop"]` | `opacity: 0` | Fades 0 → 1 on reveal. |
| `html [data-learn-gate-element="content"]` | `will-change: transform` only | The one transform-adjacent hint that is safe here. See below. |

**Why this is a stylesheet and not Designer work.** The closed state needs
`visibility` and `pointer-events`, neither of which Webflow exposes, so the whole
closed state lives here next to the script that opens it instead of being split
across Designer and code. The wrapper deliberately stays `display: flex` so
Memberstack's `data-ms-content="!learn-access"` keeps sole ownership of
`display` — the script reads computed display to decide whether it is allowed to
run at all.

The `html` prefix costs one specificity point (0,1,1) so these rules beat a
same-specificity Webflow class rule (0,1,0) regardless of stylesheet order. There
is no conflicting Webflow rule today; it is insurance against a future Designer
interaction touching opacity or transform on these classes.

**Fail-open by construction.** If the stylesheet loads and the script does not
(CDN blip, JS error), the gate simply never opens and the article stays readable.
That is the intended failure direction: a broken paywall that leaks is far better
than a broken paywall that traps the reader behind a gate with no CTA. The
reverse — the script without the stylesheet — is covered by `ensureClosed()`,
which writes the closed state itself and warns, degrading a permanently open gate
to a brief flash.

### It deliberately declares no `transform`

The sheet's off-screen start is owned by **GSAP alone**, and the two cannot share
the property:

> GSAP reads the element's **computed** transform, which is a matrix in pixels —
> and a matrix cannot carry "100%". So a CSS `translateY(100%)` is parsed into
> GSAP's `y` component as ~450px, and the tween's `yPercent: 100` is then applied
> as a **separate additional offset on top of it**. The sheet starts at 200% down
> and the tween lands it at `y: 450px` — still a full sheet-height below its
> resting place, so it animates where nobody can see it.

Nothing is needed here anyway: the wrapper is `visibility: hidden`, so the
sheet's resting position is invisible until the timeline starts, and the timeline
parks it at `yPercent: 100` in the same tick that it reveals the wrapper.
`ensureClosed()` also parks it through `gsap.set()` at init as a belt — through
GSAP, never through CSS, for exactly the reason above.

**A test asserts this file never declares `transform`. Do not add one.** It was
caught on staging, and the regression it guards is invisible in review: the gate
still animates, it just animates off-screen.

The one place the script *does* write `transform` is `applyStyles()`, which is
only reached when GSAP is absent. The invariant is about sharing the property
with GSAP, and on that path GSAP does not exist.

## Tests

[`learn-cta-gate.test.js`](learn-cta-gate.test.js) reads both files as text and
evaluates the script in a sandbox against a hand-built minimal DOM (there is no
jsdom in this repo), with controllable stubs for `getComputedStyle`,
`IntersectionObserver`, `setTimeout` and `gsap`. It is the harness style
[`session-video.test.js`](../session-video/session-video.test.js) follows in
turn.

Beyond the behaviour above it pins several things a later tidy-up could
plausibly undo: that the stylesheet never declares `transform`, that the shipped
lag exceeds the shipped fade, that Escape is not wired on any gate, that the
backdrop is refused as a close control and does not hide a real one behind it,
that a close control hidden by an *ancestor* does not make the gate dismissible,
and that the CSS and JS `@release` markers match — the two ship together, so
they share a tag.
