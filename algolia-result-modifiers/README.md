# algolia-result-modifiers

**This folder is the source of truth.** The code that lives in Webflow (page/site
custom code and embed elements) is a mirror of what's in here — not the other way
around.

These files **are** served over jsDelivr, at a **pinned tag** rather than
`@latest`. As of 2026-07-28 the "Algolia Result Modifiers" Webflow component
loads all four at `@v1.56.4`:

```html
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.56.4/algolia-result-modifiers/roles.js" defer></script>
```

That pin has a consequence worth spelling out: **merging a fix does not ship it,
and neither does tagging a new release.** Because the embed names an exact tag,
the page keeps loading the old file until someone edits the `src` in Webflow.

## Workflow

1. Make changes **here first** (or, if a change was made directly in Webflow,
   copy it back here immediately so this folder stays authoritative).
2. Test locally before landing anything, via `./dev-tunnel.sh` in the parent
   folder. Point the embed `src` at the tunnel URL, path
   `/algolia-result-modifiers/<file>.js`.
3. Commit via the normal PR flow so the history stays clean.
4. After the PR merges, tag a release (see CLAUDE.md §5).
5. **Bump the pinned tag in the Webflow component `src` to the new version and
   republish.** Skipping this step is the difference between a merged fix and a
   live one.

If this folder and Webflow ever disagree, treat **this folder** as correct and
re-sync Webflow from it.
