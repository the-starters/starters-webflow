# Profile portfolio / case-study renderer — wiring

`v3/profile-portfolio.js` renders the **Highlights** section on `/hire/<slug>`.
"Highlights", "Case Studies" and "Portfolio" are three names for one feature
(Kaeser, 2026-08-14); the data lives in Xano `Portfolios` (#28).

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

| Needed | Attribute (preferred) | Class fallback (legacy) |
| --- | --- | --- |
| Card list wrapper | `data-highlights` ✅ already present | `.case-studies-wrapper` |
| Card template | `wf-portfolio-element="card"` | `.portfolio_card` |
| Section | `portfolio-section` ✅ already present | `.profile-hightlights_wr` |
| Modal | `wf-portfolio-element="modal"` | `.portfolio_modal-component` |
| Modal images | `wf-portfolio-element="images"` | `.portfolio_modal-images` |
| Modal videos | `wf-portfolio-element="videos"` | `.portfolio_modal-videos` |

Also required: the page's existing `starter_memberstack_id` global (or a
`data-starter-memberstack-id` attribute on any element). The renderer calls
Xano `Get_approved_portfolios` (endpoint #305); it must never call the
owner-only `Get_my_portfolios` route (endpoint #304).

Endpoint #305 returns approved public rows only. The renderer orders rows by
numeric `ordinal`, puts rows without an ordinal after ordered rows, and uses
numeric `id` as the tie-breaker. A valid empty array hides the Highlights
section. An HTTP or response-shape failure does not apply that empty state; it
stops rendering and writes only a generic error to the console.

The class fallbacks exist so this can ship BEFORE the Designer attributes are
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
