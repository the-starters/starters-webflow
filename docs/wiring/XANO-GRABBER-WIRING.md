# V3 xano-grabber Wiring

Status: Built and locally verified (unit tests + `local-demos/xano-grabber-demo/`).
Not merged, not tagged, not installed in Webflow yet.

`v3/xano-grabber/xano-grabber.js` mirrors a value that is already rendered in one
place into any number of other places on the same page. The Designer owns all
markup, classes and layout; the script writes exactly two things:

- `textContent` on a non-IMG landing,
- `src` on an IMG landing, after `removeAttribute('srcset')`.

It makes no requests, reads no storage, and needs no wf-xano instance — it works
on a page rendered by wf-xano, Webflow CMS, Memberstack, wf-algolia, or plain
HTML. When wf-xano *is* present it also subscribes to `results`/`error` as a
timing belt.

Start with [Attribute table](#attribute-table), then
[Onboarding photo checklist](#onboarding-photo-checklist) for the first real
install.

## What it does

- **Pairs by id.** Every element with `wf-xano-grab-element="landing"` and
  `wf-xano-grab-id="<name>"` mirrors the value of the element with
  `wf-xano-grab-element="source"` and the same id. All matching landings mirror.
- **Infers the type from the landing tag.** IMG landing → image src. Anything
  else → the source's trimmed `textContent`. There is no
  `wf-xano-grab-type` override in v1.
- **Gates on real content.** An image src that is empty or a `data:`/`blob:` URI
  never mirrors; neither does empty text. Until a real value exists, the landing
  keeps the content authored in the Designer.
- **Never reverts.** wf-xano's default render removes every card *before* the
  fetch, so "no source on the page" is the normal state during any refresh. Once
  a landing holds a real value, only another real value replaces it. A member
  with no photo simply never mirrors.
- **Excludes the wf-xano template.** Source attributes are authored on the hidden
  `[wf-xano-element="template"]` so every clone inherits them, but the template
  itself keeps its authored placeholder forever and comes first in DOM order.
  Template descendants are never sources.
- **Mirrors lists** container-to-container, cloning a Designer-owned item
  template once per rendered item.
- **Follows re-renders** through one body-level `MutationObserver`, re-resolving
  sources by attribute every pass.

## Attribute table

| Attribute | Goes on | Value | Meaning |
| --- | --- | --- | --- |
| `wf-xano-grab-element="source"` | any element | fixed | Marks the element to read from. On a wf-xano page this belongs on the **template's** inner element, so every rendered clone inherits it. |
| `wf-xano-grab-element="landing"` | any element | fixed | Marks an element to write into. |
| `wf-xano-grab-id` | source **and** landing | a name you choose (`photo`, `headline`, `team`) | The pairing key. Required on both sides. Every landing with a matching id mirrors. |
| `wf-xano-grab-list` | a source | present, no value | List mode: this source is a **container**, and each rendered child is one item. |
| `wf-xano-grab-list-container` | a landing | present, no value | Marks the landing as the list destination. Required opposite a `wf-xano-grab-list` source. |
| `wf-xano-grab-element="list-item"` | a child of a list landing | fixed | The item template. The original is hidden and one clone is appended per source item. |
| `wf-xano-grab-item` | a landing (optional) | `#2`, or a record id | Which rendered source this landing wants. See below. |

Attributes the script **reads but never writes** (wf-xano's own):
`wf-xano-element="template"`, `wf-xano-element="empty"`, `wf-xano-item`,
`data-wf-xano-id`.

One attribute the script **writes**: `data-wf-xano-grab-clone` on the list clones
it owns. Do not author it, and do not style off it as if it were yours.

### `wf-xano-grab-item` — choosing one record out of a rendered list

Because the source attributes live on the wf-xano template, a list of 10 items
renders **10 sources with the same id**. Without this attribute the first
*visible* one wins, which is right for a one-item list (the onboarding preview)
and useless for "mirror Alex Rivera's card into the hero".

| Value | Resolves to |
| --- | --- |
| `#1`, `#2`, … | 1-based index into the rendered sources, in DOM order. Re-evaluated on every pass, so it shifts with sort/filter — this is the "featured = first card" pattern. |
| anything else | The rendered source whose closest `[data-wf-xano-id]` (self or ancestor) equals the value **exactly**. That is wf-xano's own per-card record id. |

- It lives on the **landing**, so two landings can mirror two different records
  from the same list. Pair it with per-field `wf-xano-grab-id`s authored on the
  template's inner elements.
- When present it **overrides** the visible-preferred rule, so it can deliberately
  pull from a hidden wrapper.
- No match is not an error on the page: the landing keeps its last real value and
  the overlay reports `ITEM NOT FOUND: <value>`.
- Read the available record ids straight off the `data-wf-xano-id` column of the
  [debug overlay](#debug-overlay).

### List semantics

- **Items** are the source container's children carrying `wf-xano-item` when any
  child has it; otherwise children that carry no `wf-xano-element` attribute and
  are not inline-hidden. wf-xano's `loader` / `empty` / `error` state blocks live
  *inside* the container and are never items — without this rule "Loading team…"
  mirrors as a card.
- **Text slots pair by index.** The clone's leaf text elements pair with the
  item's leaf text elements in DOM order. **Slots the item does not fill are
  blanked**, so Designer lorem ("Lorem location TBD") cannot leak to production.
  If the item template has exactly **one** text slot, it receives the item's
  whole trimmed text instead.
- **Images per item** follow the same gate: an item with no img, or an img still
  holding a `data:` placeholder, leaves the clone's authored placeholder in place.
  The clone's img is never hidden — layout is Designer-owned.
- **Rebuilt wholesale** whenever the items change. Never keep state inside a
  clone.
- **Clearing:** a transient clear keeps the existing clones (never-revert), but a
  **visible `wf-xano-element="empty"` block on the source container** is
  authoritative and clears them.

### Unsupported shapes (reported, never silently wrong)

| Shape | Result |
| --- | --- |
| IMG source → non-IMG landing (wanting the URL as text) | `MISMATCH`. Unsupported in v1; there is no `wf-xano-grab-type`. |
| `wf-xano-grab-list` source → landing without `wf-xano-grab-list-container` | `ERROR`. No whole-container text fallback. |
| `wf-xano-grab-list-container` landing → non-list source | `ERROR`. Writing text there would destroy the item template. |
| List landing with no `wf-xano-grab-element="list-item"` child | `ERROR`. |

All four also print a staging-gated console warning, once per distinct problem.

## Onboarding photo checklist

The first real install: the freelancer's profile photo, rendered by
`v3/onboarding-profile-preview.js` inside the preview card, mirrored into a second
image elsewhere on the onboarding completion page.

**Source — the preview card template's photo img.** It already carries the
wf-xano bind; add two attributes next to it. Nothing else changes, and the
grabber requires no change to `onboarding-profile-preview.js`.

```html
<img class="stp-pp__photo"
     wf-xano-src="Profile_Photo|Profile_Photo_Demo"
     wf-xano-grab-element="source"
     wf-xano-grab-id="profile-photo"
     src="data:image/svg+xml;charset=utf-8,…">
```

- Put them on the img **inside `wf-xano-element="template"`**, not on a rendered
  card — the rendered cards are clones of it, and the clones are what the grabber
  actually reads. The template's own copy is skipped by design.
- The page has **one wrapper per form block**, so both templates should carry the
  same pair of attributes. That produces two candidate sources; the grabber
  prefers the one in the *visible* form block, which is the behaviour you want
  (form-block switching is inline `display`, so both stay in the DOM).
- The inline `data:` SVG placeholder is what a member with no photo keeps. It
  never mirrors — that is the gate, not a bug.

**Landing — the destination image.** Two attributes, and authored content that is
good enough to ship as-is (it is what shows until a real photo arrives):

```html
<img class="hero_avatar"
     wf-xano-grab-element="landing"
     wf-xano-grab-id="profile-photo"
     src="<your authored placeholder>">
```

Checklist:

- [ ] The landing is an `<img>`. A `<div>` with a background image cannot be a
      landing in v1 (it would be a `MISMATCH`).
- [ ] Landing and source use the **same** `wf-xano-grab-id`, spelled identically.
- [ ] Any `srcset` on the landing is expected — the script strips it before
      writing `src`, because a surviving `srcset` wins in the browser.
- [ ] The landing is **not** inside a `wf-xano-element="delete"` block (wf-xano
      removes those at boot) and not inside the card template.
- [ ] The authored placeholder src is a real design decision: it is visible for
      the whole first paint, and permanently for a member with no photo.
- [ ] Mirroring text as well (name, headline)? Add a second `wf-xano-grab-id` pair
      on the template's text element and the destination element. Do not reuse the
      photo's id.
- [ ] QA with `?xano-grab` on staging: the row for `profile-photo` must read
      `src 2 · land 1 · REAL`. `GATED` means the member has no photo (or the
      source is still the placeholder); `MISMATCH` means the landing is not an
      IMG; `WAITING` means no source was found at all.

## Webflow install

One deferred tag, in the page's Custom Code (Footer or Head — the script waits
for `DOMContentLoaded` either way). It is inert on any page with no
`wf-xano-grab-element` attribute, so a site-wide install is also safe.

**Production (jsDelivr).** Valid only after the change is merged to `main` and a
semver tag is pushed — jsDelivr's `gh` endpoint resolves `@latest` to the latest
git **tag**, not the latest commit, so a merged PR alone changes nothing:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/wf-xano@v0.28.0/wf-xano.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@vX.Y.Z/v3/xano-grabber/xano-grabber.js"></script>
```

Replace `vX.Y.Z` with the tag that actually ships this file. Prefer the immutable
tag over `@latest`: bumping it is then a deliberate Webflow edit, and a future
release cannot change this page's behaviour on its own.

**Pin wf-xano too**, exactly as the onboarding preview does. The contract with
the library is narrow but real: the hidden `template` role, the `wf-xano-item`
marker on clones, `data-wf-xano-id` on cards, the `empty` state block, and
`WfXano.push()`. A library change to any of those changes what this script reads.

**Script tag order does not matter.** This file only ever pushes into
`window.WfXano` (`window.WfXano = window.WfXano || []; WfXano.push(arm)`), which
both shapes of that global handle: the pre-load array is drained after the
library boots, and the post-load API object runs the callback immediately if
already booted. Do **not** "optimise" this into an `Array.isArray` branch that
calls `arm()` directly — that was a real shipped bug in a sibling script,
because wf-xano assigns `window.WfXano = {api}` at module scope before `boot()`
creates any instance.

**Staging QA (dev tunnel).** Run `./dev-tunnel.sh` from `starters-git/` (the
parent folder, not this repo) and use the hostname it prints:

```html
<script defer src="https://<auto-generated>.trycloudflare.com/v3/xano-grabber/xano-grabber.js"></script>
```

The tunnel serves this repo at its root, so the path is exactly the file's path
in the repo — no prefix. The hostname is auto-generated and changes every run.

## Debug overlay

Add **`?xano-grab`** to the URL on a staging host and a fixed panel appears in
the bottom-right corner with one row per grab-id:

| Column | Reads |
| --- | --- |
| `grab-id` | the pairing key |
| `src` | how many rendered sources were found (`NO` if none), and `(list)` when the source is a list container |
| `land` | how many landings carry this id |
| `state` | `REAL` / `GATED` / `WAITING` / `MISMATCH` / `ITEM NOT FOUND` / `ERROR`, joined with `+` when the id's landings disagree |
| `items in/out` | list mode only: source items in, mirrored clones out |
| `data-wf-xano-id` | each candidate's record id, in DOM order — this is where you read the value for `wf-xano-grab-item` |
| `notes` | `ORPHAN SOURCE`, `ORPHAN LANDING(S)`, `DUP SOURCES: N candidates`, `ITEM NOT FOUND: <value>`, `confirmed empty — cleared`, `never-revert: kept N clone(s)`, `ALL SOURCES HIDDEN` |

The header line carries the pass counters: `flush #`, `writes`, `echoes ignored`
(our own mutations, proving the loop guard), `source re-resolves` (how often a
source's identity changed — i.e. how many re-renders were survived) and
`template candidates skipped`.

Gating, both required: the URL param **and** a
[staging host](../../README.md#staging-only-console-diagnostics). The overlay
prints the page's record ids, so `window.STARTERS_DEBUG` deliberately does **not**
unlock it — it only re-enables the console warnings.

### Console

Staging-gated, silent in production unless `window.STARTERS_DEBUG = true`, and
printed once per distinct problem (a pass runs on every mutation batch):

- `grab-id "x": no source element on the page — N landing(s) keep their authored content.`
- `grab-id "x": a source is marked but no landing carries this id — nothing is mirrored.`
- `grab-id "x": N connected sources — using the first VISIBLE one …`
- `grab-id "x": wf-xano-grab-item="…" matched none of the N rendered source(s) …`
- `grab-id "x": an IMG source cannot fill a non-IMG landing in v1 …`
- the three list wiring errors from the table above.

The first, second and fourth wait out a **3 s grace window** and re-check before
printing: nothing has rendered at `DOMContentLoaded`, so warning immediately
would flag every healthy page.

`window.StartersV3XanoGrabber` answers the rest from the console:

```js
const G = StartersV3XanoGrabber
G.report().ids                 // the same table the overlay renders
G.flush()                      // force a pass and return the report
G.counters                     // flushes / echoes / reresolves / templateSkips / writes
G.overlayActive()              // why the overlay is not showing
G.listItems(sourceContainer)   // which children counted as items
G.confirmedEmpty(sourceContainer)
G.itemTexts(item)              // the values, in slot order
G.isRealValue('data:image/…')  // false — this is the gate
```

## Local QA

`local-demos/xano-grabber-demo/index.html` loads this exact file by relative path
behind a fake wf-xano faithful to the verified library: a hidden template holding
a decoy `data:` img, clones marked `wf-xano-item` with `data-wf-xano-id`,
`loader`/`empty` state blocks inside the source container, the replace-not-fill
refresh that removes every clone *before* the 600 ms "fetch", two wrappers sharing
grab-ids and switched by inline `display`, and the two-shape `window.WfXano`
global drained in the library's own order. `local-demos/` is gitignored.

```sh
# from the repo root — serve the ROOT, not the demo folder
python3 -m http.server 8932
# then open http://localhost:8932/local-demos/xano-grabber-demo/?xano-grab
```

Every scenario has a button: refresh (replace cycle), add/remove item, reverse
order (moves `#1`), empty result, set/clear photo, swap draft/publish text,
two-instance display switch, and `Dump report()`.

## Release gate

- `node --test v3/xano-grabber/xano-grabber.test.js` — from the repo root.
- Demo pass: mirrors survive the replace cycle, list slots pair by index with
  unfilled slots blank, a confirmed empty clears, `wf-xano-grab-item` resolves by
  record id and by `#index`, and the overlay shows every state. Zero console
  errors.
- Staging QA through the dev tunnel on the real page before the PR.
- Confirm the page's wf-xano tag is a pinned `@v0.28.0`-style URL, not `@latest`.
- Standard exposure scan before tagging: no `api.airtable.com`, no
  `hook.us1.make.com`, no `pat…` PAT patterns. This module contains no URL at all
  and makes no request.
