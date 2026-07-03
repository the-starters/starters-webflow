---
name: webflow-attr-migration-debug
description: Visual debug workflow for Webflow custom-attribute migrations (e.g. wf-algolia → wf-xano, legacy → canonical wf-xano-element). Generates a scoped debug-CSS embed that outlines unmigrated elements red, migrated green, both-grammars amber, then verifies the live page via the browser. Use when swapping attribute grammars on a Webflow page, migrating a feed between list libraries, or auditing leftover attributes after a Designer change.
---

# Webflow attribute-migration debug flow

> 🚦 **Team self-serve generator (no agent needed):**
> https://claude.ai/code/artifact/33ef8133-79c6-4ccc-91f5-e280a56ed054
> Interactive page that generates the debug-CSS embed + inventory snippet from presets
> (wf-algolia → wf-xano, legacy → canonical) or custom attribute lists. Source lives in
> `generator-artifact.html` next to this file.

Migrating a page section from one attribute grammar to another (wf-algolia → wf-xano,
legacy `wf-xano-list` markers → canonical `wf-xano-element="…"`, Finsweet swaps) is
error-prone in the Designer: attributes are invisible on the canvas and easy to miss.
This flow makes migration state visible, then verifies programmatically.

## Workflow

1. **Inventory the live markup first** (don't trust docs/memory — fetch reality).
   In a browser console on the live page, dump every element in the target section that
   carries old-grammar attributes:

   ```js
   const sec = document.querySelector('<SECTION-SELECTOR>')
   Array.from(sec.querySelectorAll('*'))
     .filter(e => Array.from(e.attributes).some(a => a.name.startsWith('<OLD-PREFIX>')))
     .map(el => el.className + ' :: ' + Array.from(el.attributes)
       .filter(a => a.name.startsWith('<OLD-PREFIX>'))
       .map(a => a.name + '="' + a.value + '"').join(' '))
   ```

   Produce the per-element Remove → Add table from this dump (real classes, real values).

2. **Give the user the debug-CSS embed** (template below, or use the generator artifact),
   scoped to the section being migrated so unrelated same-grammar elements elsewhere
   (navbar search, other feeds) are not flagged. User pastes it into an Embed element or
   the page footer.

3. User works through the Designer until **zero red / zero amber, all green**.

4. **Verify from the browser** (published site): re-run the step-1 dump — must return
   `[]` — and confirm the new grammar renders (items present, states/pagination work).

5. **Remove the debug embed**, republish, do a final functional check.

## Debug CSS template

Replace `<SECTION>` (scope selector), `old-` (old attribute prefix), `new-` (new prefix),
and the attribute lists with the migration's real names. Color language:
🔴 red solid = still old · 🟢 green solid = migrated · 🟠 amber dashed = both grammars
on one element (forgot to remove the old) · 🚨 banner = section root not converted.

```html
<!-- 🔧 attr-migration debug — DELETE AFTER MIGRATION -->
<style>
  /* 🔴 still has old-grammar attributes */
  <SECTION> [old-element], <SECTION>[old-element],
  <SECTION> [old-text], <SECTION> [old-if], <SECTION> [old-link] {
    outline: 3px solid #e11d48 !important; outline-offset: -1px;
  }
  /* 🟢 migrated */
  <SECTION> [new-element], <SECTION>[new-element],
  <SECTION> [new-bind], <SECTION> [new-if], <SECTION> [new-link] {
    outline: 3px solid #16a34a !important; outline-offset: -1px;
  }
  /* 🟠 both grammars on one element */
  <SECTION> [new-bind][old-text], <SECTION> [new-if][old-if],
  <SECTION> [new-link][old-link], <SECTION> [new-element][old-element] {
    outline: 3px dashed #f59e0b !important;
  }
  /* 🚨 section root not converted */
  <SECTION>:not([new-element="wrapper"])::before {
    content: "⚠ section missing new-element=\"wrapper\"";
    display: block; background: #e11d48; color: #fff;
    font: 700 13px/1.6 sans-serif; padding: 4px 10px;
  }
  /* ⛔ label offenders with the exact leftover attribute */
  <SECTION> [old-text]::after {
    content: " ⛔ old-text=" attr(old-text);
    color: #e11d48; font: 700 11px/1 sans-serif;
  }
  <SECTION> [old-element]::before {
    content: "⛔ old-element=" attr(old-element) " ";
    color: #e11d48; font: 700 11px/1 sans-serif;
  }
  /* force-show hidden state elements (empty/loader) so they're checkable */
  <SECTION> [old-element="no-results"], <SECTION> [old-element="loader"] {
    display: flex !important; min-height: 24px;
  }
</style>
```

## Gotchas

- **Scope everything to the section** — other widgets on the page may legitimately keep
  the old grammar (e.g. the navbar Explore mega-menu is wf-algolia and must stay).
- Attributes that exist in BOTH grammars with the same name (e.g. `wf-xano-display`
  stays on migrated empty/loader elements) must not be in the red list.
- Rendered clones can carry attributes copied from the template — inventory in a fresh
  load, and prefer checking the template element itself.
- The Designer canvas renders embed outlines but is inconsistent with `::before/::after`
  labels; the published site shows everything.
- Webflow strips **valueless** custom attributes — canonical wf-xano markup is
  `wf-xano-element="wrapper|list|template|empty|loader|error|page-prev|page-number|page-next|total|count-from|count-to"`
  (v0.4.0+, Finsweet role vocabulary: `wrapper` = scope root, `list` = items container);
  bare markers are legacy aliases.
- A worked example with real classes (wf-algolia → wf-xano on `/opportunities-brands-view`)
  lives in JP's workspace:
  `product-workflows/opportunities/webflow/3.0-build/BRAND-FEED-XANO-MIGRATION-CHECKLIST-2026-07-02.md`.
