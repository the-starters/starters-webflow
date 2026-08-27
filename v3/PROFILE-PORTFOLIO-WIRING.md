# Profile portfolio / case-study renderer — wiring

`v3/profile-portfolio.js` renders the **Highlights** section on `/hire/<slug>`.
"Highlights", "Case Studies" and "Portfolio" are three names for one feature
(Kaeser, 2026-08-14); the data lives in Xano `Portfolios` (#28).

## Who owns what

The Highlights modal is a native `<dialog data-modal-target="highlights">` driven
by the site-wide lumos modal system (`global-embeds/modal/modal.js`, docs:
<https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/modal>).

| Concern | Owner |
| --- | --- |
| Opening the modal | lumos, through the card's authored `data-modal-trigger="highlights"` |
| Closing it (close control, backdrop, Escape) | lumos, through `data-modal-close` and the dialog `cancel` event |
| Open/close animation, focus restore, page-scroll locking | lumos |
| Card list, and the modal's title / description / images / videos | `v3/profile-portfolio.js` |

The renderer is a **data filler only**. It never writes to the dialog's `style`
and holds no open, close, Escape, backdrop or focus logic — inline display
writes stomp the lumos GSAP timeline and the modal loses its animation. On card
click it populates the dialog and nothing else; the same click reaches lumos,
which opens it.

Because an older hidden copy of the modal may still sit in the published DOM,
every modal lookup is scoped inside the modal root rather than searched
document-wide.

## Origin

Ported from an on-canvas Code Embed inside the "Embed Code" component on the hire
template, so the logic lives in GitHub rather than in Webflow. Full search record:
`platform-ops/migrations/2026-08-14-legacy-case-studies/renderer-location-findings.md`.

## Install

Hire template → Page Settings → Custom Code → **Head Code**:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/profile-portfolio.js"></script>
```

## Requirements on the page

| Needed | Attribute (preferred) | Legacy fallback |
| --- | --- | --- |
| Card list wrapper | `data-highlights` ✅ already present | `.case-studies-wrapper` |
| Card template | `wf-portfolio-element="card"` | `.portfolio_card` |
| Card open control | `wf-portfolio-element="open"` | `[show-portfolio]` or `[aria-label="open-modal"]` |
| View all control | `data-btn-view-all` | None |
| Section | `portfolio-section` ✅ already present | `.profile-hightlights_wr` |
| Modal root | `wf-portfolio-element="modal"` ✅ already present | `.portfolio_modal-component` |
| Modal title (optional) | `portfolio-title` | None |
| Modal description | `portfolio-description` | None |
| Modal images | `wf-portfolio-element="images"` | `.portfolio_modal-images` |
| Modal videos | `wf-portfolio-element="videos"` | `.portfolio_modal-videos` |
| Loading text (optional) | `data-highlights-loader` | None |

The five modal rows below the root are looked up **inside** the modal root, so a
duplicate elsewhere on the page is never filled. The Images and Videos containers
must each sit in their **own** `.portfolio_modal-content-wrapper`: the renderer
shows and hides a section through that wrapper, so a shared one would make both
sections' visibility depend on whichever media response happened to land last.
The live markup already complies (verified on staging 2026-08-27); re-verify if
the modal's markup is restructured. The root itself is resolved as
`dialog[wf-portfolio-element="modal"]` first, so a stale non-dialog copy earlier
in the page cannot win the match and swallow every fill.

`portfolio-title` is fill-if-present: when the element exists the renderer writes
the case-study title into it (truncated at 150 characters); when it does not, the
renderer skips it silently. The static "About the project" heading must not carry
the attribute.

`portfolio-description` renders the case study in full, with `white-space:
pre-line` so the writer's line breaks survive. Nothing truncates it and there is
no "See more" control inside the modal — the modal is already the expanded view.
The see-more clamp in `v3/hire-profile.js` now covers card titles only (65
characters). The modal title's own 150-character truncation, above, is
unaffected and still lives in this script.

`data-highlights-loader` is an optional element authored inside the modal — its
copy and styling are the designer's. Author it **outside** the Images and Videos
containers: the first fill empties those containers, which would destroy a loader
authored inside one. The renderer hides the authored original at load and only
ever clones it, dropping a clone into the Images and Videos containers while
their reads are in flight and removing each clone when its read settles.
Text-only case studies therefore show both loaders briefly before their sections
hide. Without the element there is no loading text at all: each section stays
hidden while its read runs, then appears if the case study has that media.

The modal's close control, backdrop and content wrapper are **not** part of this
script's contract — dismissal belongs to the lumos modal system (see "Who owns
what" above).

### What lumos needs

These are Designer-side requirements this script does not own, but the modal
depends on them. If any is missing the data still fills; the modal just stops
behaving like a modal.

- The dialog carries class `.modal_dialog` and `data-modal-target="highlights"`.
  Without both, lumos never registers it and nothing opens it.
- The card's open control and `data-modal-trigger="highlights"` should sit on the
  **same element**. The renderer now fills from any click inside the card, so it
  tolerates the two drifting apart, but the modal only OPENS from the trigger.
- Close controls and the backdrop carry `data-modal-close`. Escape works on its
  own through the dialog's `cancel` event.
- `data-modal-scroll` on the modal's scroller is optional; lumos resets those
  elements' scroll position on open. Not authored today.

The renderer listens to two lumos events for data-side housekeeping only:
`modal-open` fills the first case study when the dialog is opened without a card
click **and no case study has been viewed yet**, and `modal-close` pauses any
playing video, which `dialog.close()` does not do on its own. Once a visitor has
opened a case study, a later stray open leaves what they were last looking at.

A `?modal-id=highlights` deep link cannot be caught that way: lumos dispatches
`modal-open` synchronously inside its own `DOMContentLoaded` handler, which runs
before this script's, so the event is gone before the listener exists. The
renderer therefore also checks the dialog's `open` state once the approved rows
arrive, and fills the first case study if it is still showing. Do not replace
that check with the event — script order on the page is not a guarantee.

If the resolved modal root has no `data-modal-target`, the renderer logs one
warning at init. That means it matched an element lumos does not manage — almost
always the stale copy of the old modal — which would fill silently and never
open. The warning is staging-only (`*.webflow.io`, localhost, `*.trycloudflare.com`)
unless `window.STARTERS_DEBUG === true`; production stays quiet.

Also required: the page's existing `starter_memberstack_id` global (or a
`data-starter-memberstack-id` attribute on any element). The renderer calls
Xano `Get_approved_portfolios` (endpoint #305); it must never call the
owner-only `Get_my_portfolios` route (endpoint #304).

Endpoint #305 returns approved public rows only. The renderer orders rows by
numeric `ordinal`, puts rows without an ordinal after ordered rows, and uses
numeric `id` as the tie-breaker. A valid empty array hides the Highlights
section. An HTTP or response-shape failure does not apply that empty state; it
stops rendering and writes only a generic error to the console.

The legacy fallbacks exist so this can ship BEFORE the Designer attributes are
added. Delete them once every row above has its attribute.

## Cutover

The CDN file is the one renderer owner. Before publishing the cutover, back up
the complete Hire template component and resolve the hidden Code Embed. Remove
only the embed whose code contains `Get_my_portfolios`, then read the complete
component back before publishing. Do not leave both renderers installed.

## Changes from the embed

1. `memberstackId` comes from the page global instead of a hardcoded CMS-bound value.
2. Selectors are attribute-first (AGENTS.md: never bind behaviour to styling classes).
3. The modal's Images block hides when a portfolio has no images, matching the
   Videos behaviour. Needed because the 1,439 imported legacy case studies are
   text-only and would otherwise show an empty "Images" heading.
4. The renderer shows the first three case studies initially. It shows the
   `data-btn-view-all` control only when more case studies exist. Selecting the
   control reveals all remaining case studies and hides the control.
5. The renderer fills the modal and nothing more. The lumos modal system opens
   it, closes it, animates it, restores focus and locks page scrolling.
6. The images and videos reads run in parallel, each guarded by a per-click
   token: if a visitor opens a second case study before the first one answers,
   the late response is discarded rather than mixed into the open modal. An
   empty result and a failed read behave the same way — the section hides — and
   a failure also writes to the console.
7. Media rows whose file URL is blank are skipped rather than rendered as a
   broken element, and the large-rendition request appends `tpl=large` with `&`
   when the asset URL already carries a query string.
