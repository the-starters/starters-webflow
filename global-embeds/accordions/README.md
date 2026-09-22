# Accordions

This document owns the setup and behavior of the accordion files in this folder,
superseding the accordion page on the external embeds documentation site.

## Generic accordion

Load `accordions.js` once in the page or site Head Code:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/global-embeds/accordions/accordions.js"></script>
```

Follow the repository's [release rules](../../README.md#sync-safety) when shipping
CDN changes. Initialization runs on `DOMContentLoaded`; the markup must be present
then. Each initialized wrapper is marked with `data-script-initialized` to avoid
binding it again.

### Markup and options

Each `[data-accordion="wrapper"]` requires a `[data-accordion="list"]` containing
`[data-accordion="component"]` cards. Every card needs a
`[data-accordion="toggle-button"]` control and a
`[data-accordion="content-wrap"]` panel. Use a native button for the control.
The script flattens leading `u-display-contents` wrappers in the list and unwraps
Webflow CMS items, taking the first child not marked `w-condition-invisible` from
each item.

Set these options on the wrapper:

| Attribute | Behavior |
| --- | --- |
| `data-open-by-default="2"` | Opens the second card immediately at initialization; numeric indices start at 1. Without a matching index, cards start collapsed. |
| `data-open-by-default="all"` | Opens every card immediately and disables close-previous behavior. |
| `data-close-previous="true"` | Opening another card closes the previously opened card within the same wrapper. Defaults to disabled. |
| `data-close-on-second-click="true"` | Clicking an active card closes it. Defaults to disabled. |
| `data-open-on-hover="true"` | Mouse entry on a control opens its card; repeated entry does not close it. Defaults to disabled. |

Open cards receive `is-active`. Controls receive `aria-expanded`, generated IDs,
and `aria-controls`; panels receive generated IDs and `aria-labelledby`.

### Optional animation

GSAP is optional. When available at initialization, it animates panel height
between zero and auto over 0.3 seconds with `power1.inOut` easing. Default-open
cards skip to the completed state. Animation completion and reverse completion
invalidate the timeline and also refresh ScrollTrigger when it is available.

Without GSAP, panels toggle instantly between `display: none` and `display: block`.
All wrapper options, active classes, and ARIA state updates still apply. This path
does not call ScrollTrigger. Load GSAP before the accordion initializes if
animation is wanted; loading it afterward does not upgrade existing cards.

The generic script has no viewport breakpoint and uses the `data-accordion`
markup above. It does not bind the separate `data-accordion-item-*` mobile markup.

### Rows a script renders

The `DOMContentLoaded` scan only sees the cards that exist when it runs, so a page
that renders its own cards builds a group directly instead. The script publishes
`window.StarterAccordions` as soon as it loads, and a second copy of the file on
the same page keeps the first one's groups rather than replacing them.

```js
const group = window.StarterAccordions.group({ closePrevious: true, bindControl: false })
const entry = group.register(card, control, panel)
```

`group(settings)` takes `closePrevious`, `closeOnSecondClick`, and `openOnHover`
with the same meaning as the wrapper attributes, plus `bindControl`. Leave
`bindControl` unset to get the click (and hover) handler the scanned cards get;
set it to `false` when the page already owns that control's click, so the two do
not both act on one activation.

`register(card, control, panel)` applies the same ARIA wiring, generated ids, and
optional GSAP timeline the scan applies, starts the card collapsed, and returns
`{ card, button, content, open(instant), close(), isOpen(), release() }`. It
returns `null` when any of the three elements is missing. Registering later joins
the same group, so a card added after initialization obeys `closePrevious` too.
Call `release()` when the page discards a card, so `closePrevious` never reaches
back into a detached one.

`v3/starter-edit-profile/unified-companies.js` is the first consumer: its Work
Experience rows are cloned at runtime, it registers each row with
`bindControl: false` because opening a row depends on save and removal state the
accordion cannot see, and it uses `closePrevious: true` to keep one entry open.

### Designer styles and regression coverage

`accordion.css` exposes accordion content in Webflow Designer and applies the
existing Designer-only filter-card colors. Its selectors are scoped to
`.wf-design-mode`.

Executable coverage for initialization, clicks, defaults, grouping, hover,
reinitialization, cards registered after initialization, and optional animation
hooks lives in
[`accordions.test.js`](accordions.test.js). Run it from the repository root with
`node --test global-embeds/accordions/accordions.test.js`.

## Mobile membership accordions

Join CTA and Signup Modal use `mobile-accordions.js`. Replace their inline
accordion JavaScript embeds with the same include in each shared component:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/global-embeds/accordions/mobile-accordions.js"></script>
```

Keep the existing component CSS and tab scripts. A page-level installation guard
allows both components to include this file without duplicating click or media
listeners. Release the file before publishing these includes.

Each `[data-accordion-item-wrapper]` contains `[data-accordion-component]` cards
with `[data-accordion-button-toggle]` controls and `[data-accordion-content-wrap]`
panels. This contract is separate from the generic accordion above; do not swap
the two scripts. Use native buttons for controls.

At widths up to 767px, the first valid card opens immediately. Opening another
card closes the previous one within that wrapper; a second click closes it.
Open cards receive `is-active` and `is-open`, and controls/panels get linked ARIA
attributes. Optional GSAP provides the existing 0.3-second height animation;
without GSAP, all the same interactions toggle display instantly.

At 768px and above, initialization is skipped or existing listeners, open states,
and animation styles are removed so component CSS controls the layout. Returning
to mobile initializes once and opens the first card again. This script does not
flatten CMS markup or read the generic accordion's configuration attributes.

Run both suites with `node --test global-embeds/accordions/*.test.js`.
