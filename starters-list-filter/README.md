# starters-list-filter

**This folder is the source of truth.** The code that lives in Webflow (page/site
custom code and embed elements) is a mirror of what's in here — not the other way
around.

These files **are** served over jsDelivr, at a **pinned tag** rather than
`@latest`. As of 2026-08-08 all nine of them load on `/all-starters` at
`@v1.59.28`, for example:

```html
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.28/starters-list-filter/custom-algolia-scripts/filters-text.js" defer></script>
```

That pin has a consequence worth spelling out: **merging a fix does not ship it,
and neither does tagging a new release.** Because the embed names an exact tag,
the page keeps loading the old file until someone edits the `src` in Webflow.

## Workflow

1. Make changes **here first** (or, if a change was made directly in Webflow,
   copy it back here immediately so this folder stays authoritative).
2. Test locally before landing anything, via `./dev-tunnel.sh` in the parent
   folder. Point the embed `src` at the tunnel URL, path
   `/starters-list-filter/<file>.js`.
3. Commit via the normal PR flow so the history stays clean.
4. After the PR merges, tag a release (see CLAUDE.md §5).
5. **Bump the pinned tag in the Webflow embed `src` to the new version and
   republish.** Skipping this step is the difference between a merged fix and a
   live one.

If this folder and Webflow ever disagree, treat **this folder** as correct and
re-sync Webflow from it.

## Known dirty data: the `skills` facet

`custom-algolia-scripts/filters-text.js` carries a `SKILL_NAMES` override map
because skills are stored as slugs (`ab-testing`), and plain de-hyphenate +
title-case mangles every acronym ("Ab Testing").

While building that map, an audit of all 172 `skills` facet values in
`Freelancers3.0-dev` turned up **12 values that are not skills at all** — they
are entire comma-joined skill *lists* indexed as a single facet value, affecting
14 records. For example:

```txt
"AI Agents, Campaign Management, Unit Economics, TikTok (Organic), …"   (1 record)
```

Somewhere upstream the skills array is not being split before indexing. These
render as one absurd chip in the Skills filter and cannot be filtered on. This
is a **Xano/indexing bug, not a display bug** — no override map fixes it, and
`filters-text.js` deliberately does not paper over it.

Two related smells in the same audit, both unconfirmed:

- `creative-briefing-b` (137 records) — the trailing `-b` looks like an
  artifact; the canonical name elsewhere in the index is "Creative Briefing".
- `pixelingtagging` (24 records) — renders "Pixelingtagging"; the intended name
  is probably "Pixeling & Tagging" or similar.

Those two are left unmapped on purpose: guessing a display name would hide a
data problem rather than surface it.
