# V3 Onboarding Profile Preview Wiring

Status: Implementation on branch `feat/onboarding-profile-preview`; not merged, not
tagged, not installed in Webflow yet.

`v3/onboarding-profile-preview.js` renders the freelancer's **own** profile as a
profile-preview card on the onboarding completion page of
`the-starters-3-0.webflow.io` ("Your 30-day visibility boost is already
running"). It is the reassurance beat at the end of onboarding: this is exactly
how clients browsing Starters see you right now.

Built on [wf-xano](https://github.com/the-starters/wf-xano) v0.28.0, loaded
pinned from jsDelivr. The card's CSS and markup live in the structure embed
below; the script owns only the response transform. The page's two form blocks
are switched by wf-xano's own state projection — no JavaScript here — see
[Form-block switching](#form-block-switching).

Start with [Page architecture](#page-architecture): the wf-xano wrapper is a
**Designer div** that contains the embed, not the embed itself. Getting that
wrong is the difference between a working card and a permanent skeleton loader.

## What it does

- Fetches `GET api:KZf7nFnk/starters_onboarding/get_freelancers?memberstack_id=…`
  through wf-xano, with `wf-xano-auth="none"` and a **hardcoded demo member id**
  for the demo phase (`mem_cms4ovj4t0dp60tmoe1rn0swl`). See
  [Xano auth flip](#xano-auth-flip-required-before-real-users) — this is not
  shippable to real members as-is.
- Unwraps the response envelope. The endpoint answers
  `{"freelancer": [ <one record> ]}`; wf-xano's `normalize()` sees an object, not
  an array, and takes its single-object branch, so `items[0]` is the whole body
  and every plain `wf-xano-bind` would resolve against the envelope instead of
  the record. A `beforeRender` hook pulls the record out and adds the three
  computed fields the template binds and Xano does not send:

  | Field | Derived from | Rule |
  | --- | --- | --- |
  | `Role_1` / `Role_2` / `Role_3` | `Roles` | Comma string split and trimmed, first three only. Each chip hides on an empty value, so a one-role Starter shows one chip. |
  | `Location` | `City`, `State_Province`, `Country` | Joined with `, ` in that order, empty parts skipped, so no orphan commas. |
  | `Bio` | `Bio` | Quill rich-text HTML flattened to one line of plain text (tags stripped, `<br>`/block ends become spaces, entities decoded, whitespace collapsed). |

- Static, unconditional: the green **Available** pill.
- Static placeholder: `0 (0 Reviews)`, with a `TODO` in the markup to bind a real
  average rating once the reviews collection exists.
- Loader skeleton, empty state, and error state all ship in the markup, so the
  card never flashes empty or broken.

The `Bio` flattening is text-only by construction: the result goes back to
wf-xano, whose binds assign `textContent`. Nothing is ever inserted as HTML, so
a stray `<img onerror>` in a bio cannot execute — it is stripped, and whatever
survives is printed as characters. Entity decoding is deliberately **single
pass**: a loop-until-stable decode would turn the literal `&amp;lt;` the author
typed into `<`, which is how escaped markup gets smuggled back in.

## Page architecture

Three parts, and the split matters:

| Part | Where it lives | What it carries |
| --- | --- | --- |
| **Designer wrapper** | A Designer div that **contains** the structure embed (on the current page: `hero-app_inner`) | Every `wf-xano-*` wrapper attribute — see [Designer wrapper](#designer-wrapper) |
| **Part 1 — structure** | One HTML Embed, inside that div | The scoped `<style>` and the card markup. **No wrapper attributes.** |
| **Part 2 — scripts** | A second HTML Embed, or the page's custom code before `</body>` | The two `<script defer src>` tags |

The wrapper lives on a **Designer div rather than the embed** because the form
blocks have to sit inside the wrapper to be switched (wf-xano only projects state
onto elements within the instance root — see
[Form-block switching](#form-block-switching)), and an HTML Embed cannot contain
Designer-built form blocks. Hoisting the wrapper one level up puts the card and
the forms in the same instance.

Part 1 and Part 2 can be pasted in either order, and Part 2 can equally go in
page custom code: the script only pushes onto wf-xano's queue, which works
pre- and post-boot alike.

### Designer wrapper

Put these on the Designer div that contains the structure embed. Without them
nothing loads; the embed alone is inert markup.

| Attribute | Value |
| --- | --- |
| `wf-xano-element` | `wrapper` |
| `wf-xano-instance` | `onboarding-self-preview` |
| `wf-xano-source` | `https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starters_onboarding/get_freelancers` |
| `wf-xano-method` | `GET` |
| `wf-xano-auth` | `none` (until the [auth flip](#xano-auth-flip-required-before-real-users)) |
| `wf-xano-per-page` | `1` |
| `wf-xano-param-memberstack_id` | `mem_cms4ovj4t0dp60tmoe1rn0swl` (demo phase) |

⚠ **Exactly one element on the page may carry `wf-xano-element="wrapper"` for
this instance.** If the old single-embed version is still on the page, its
wrapper attributes must come off (or the embed must be deleted) — two wrappers
claiming `onboarding-self-preview` means `WfXano.get()` returns whichever
initialised first, and the other one silently never renders.

⚠ **`wf-xano-instance="onboarding-self-preview"` is load-bearing, not decoration.**
It is how the script finds this list — both its page gate and
`WfXano.get('onboarding-self-preview')`. Rename or drop it and the card renders
the raw envelope, the template's `wf-xano-if` guard hides it, and the page shows
its empty state to a member with a complete profile. The only clue is the staging
console warning.

## Part 1 — structure embed

One Webflow **HTML Embed**, inside the Designer wrapper div. This block is the
source of truth for the card's CSS and markup;
`local-demos/onboarding-profile-preview-harness.html` copies it for local QA.

```html
<!-- ==========================================================================
     Onboarding profile preview — PART 1 of 2: HTML STRUCTURE (style + markup)
     SOURCE OF TRUTH: v3/ONBOARDING-PROFILE-PREVIEW-WIRING.md (this file)
     Paste into an HTML Embed INSIDE the Designer div that carries the
     wf-xano wrapper attributes. Requires PART 2 on the same page, or the
     skeleton loader shows forever.
     Do not edit it only inside Webflow — edit this doc, then re-paste.
     ========================================================================== -->

<style>
/* Scoped to .stp-profile-preview so nothing here can leak into the page. */
.stp-profile-preview{
  --stp-pp-ink:#161613;
  --stp-pp-ink-soft:#55554e;
  --stp-pp-ink-mute:#7c7c73;
  --stp-pp-line:#e6e5e0;
  --stp-pp-surface:#ffffff;
  --stp-pp-meta-bg:#f4f4f1;
  --stp-pp-green:#2f6b3a;
  --stp-pp-green-bg:#e7f2e9;
  --stp-pp-green-line:#cbe3d1;
  --stp-pp-radius:22px;
  --stp-pp-font:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;
  --stp-pp-serif:"Playfair Display","Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;
  font-family:var(--stp-pp-font);
  color:var(--stp-pp-ink);
  -webkit-font-smoothing:antialiased;
  display:block;
  width:100%;
  max-width:820px;
  margin:0 auto;
  text-align:left;
  box-sizing:border-box;
}
.stp-profile-preview *,
.stp-profile-preview *::before,
.stp-profile-preview *::after{box-sizing:border-box;}

/* Local FOUC guard: the library injects its own, but it only lands once the
   deferred script parses. This keeps the raw template hidden before that.
   Rendered clones drop the marker attribute, so they are unaffected. */
.stp-profile-preview [wf-xano-element="template"]{display:none;}

/* ---------- card ---------- */
.stp-pp__card{
  display:flex;
  gap:26px;
  align-items:flex-start;
  position:relative;
  background:var(--stp-pp-surface);
  border:1px solid var(--stp-pp-line);
  border-radius:var(--stp-pp-radius);
  padding:22px;
  box-shadow:0 1px 2px rgba(22,22,19,.04),0 8px 24px -18px rgba(22,22,19,.18);
}
.stp-pp__photo-wrap{
  flex:0 0 208px;
  width:208px;
  aspect-ratio:1/1;
  border-radius:16px;
  overflow:hidden;
  background:#ecebe6;
}
.stp-pp__photo{
  display:block;
  width:100%;
  height:100%;
  object-fit:cover;
  border-radius:16px;
}
.stp-pp__body{
  flex:1 1 auto;
  min-width:0;
}

/* ---------- available pill (static) ---------- */
.stp-pp__pill{
  position:absolute;
  top:22px;
  right:22px;
  display:inline-flex;
  align-items:center;
  gap:7px;
  padding:6px 13px 6px 11px;
  border-radius:999px;
  background:var(--stp-pp-green-bg);
  border:1px solid var(--stp-pp-green-line);
  color:var(--stp-pp-green);
  font-size:12.5px;
  font-weight:600;
  letter-spacing:.005em;
  white-space:nowrap;
}
.stp-pp__pill::before{
  content:"";
  width:7px;
  height:7px;
  border-radius:50%;
  background:var(--stp-pp-green);
}

/* ---------- text ---------- */
.stp-pp__name{
  font-family:var(--stp-pp-serif);
  font-weight:500;
  font-size:34px;
  line-height:1.12;
  letter-spacing:-.01em;
  margin:0 0 6px;
  padding-right:112px; /* room for the Available pill, which sits on this row */
  color:var(--stp-pp-ink);
  overflow-wrap:anywhere;
}
.stp-pp__name span{display:inline;}
.stp-pp__headline{
  margin:0 0 12px;
  font-size:14.5px;
  line-height:1.45;
  color:var(--stp-pp-ink-soft);
  overflow-wrap:anywhere;
}
.stp-pp__roles{
  display:flex;
  flex-wrap:wrap;
  gap:7px;
  margin:0 0 14px;
  padding:0;
  list-style:none;
}
.stp-pp__role{
  display:inline-flex;
  align-items:center;
  padding:4px 11px;
  border-radius:999px;
  background:var(--stp-pp-green-bg);
  border:1px solid var(--stp-pp-green-line);
  color:var(--stp-pp-green);
  font-size:12px;
  font-weight:600;
  line-height:1.5;
  white-space:nowrap;
  max-width:100%;
  overflow:hidden;
  text-overflow:ellipsis;
}
.stp-pp__bio{
  margin:0 0 16px;
  font-size:14px;
  line-height:1.6;
  color:var(--stp-pp-ink-soft);
  overflow-wrap:anywhere;
  display:-webkit-box;
  -webkit-line-clamp:4;
  -webkit-box-orient:vertical;
  overflow:hidden;
}

/* ---------- meta bar ---------- */
.stp-pp__meta{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:8px 22px;
  background:var(--stp-pp-meta-bg);
  border-radius:13px;
  padding:11px 15px;
}
.stp-pp__meta-item{
  display:inline-flex;
  align-items:center;
  gap:7px;
  font-size:12.5px;
  line-height:1.4;
  color:var(--stp-pp-ink-soft);
  min-width:0;
}
.stp-pp__meta-item svg{
  flex:0 0 auto;
  width:14px;
  height:14px;
  color:var(--stp-pp-ink-mute);
}
.stp-pp__meta-item span{
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

/* ---------- loader skeleton ---------- */
.stp-pp__loader{
  display:flex;
  gap:26px;
  align-items:flex-start;
  background:var(--stp-pp-surface);
  border:1px solid var(--stp-pp-line);
  border-radius:var(--stp-pp-radius);
  padding:22px;
}
.stp-pp__sk{
  background:linear-gradient(90deg,#eeede8 0%,#f7f7f4 50%,#eeede8 100%);
  background-size:200% 100%;
  animation:stp-pp-shimmer 1.25s ease-in-out infinite;
  border-radius:8px;
}
.stp-pp__sk--photo{flex:0 0 208px;width:208px;aspect-ratio:1/1;border-radius:16px;}
.stp-pp__sk-body{flex:1 1 auto;min-width:0;}
.stp-pp__sk--name{height:30px;width:62%;margin-bottom:12px;}
.stp-pp__sk--line{height:13px;width:85%;margin-bottom:9px;}
.stp-pp__sk--line.is-short{width:48%;}
.stp-pp__sk--bar{height:44px;width:100%;border-radius:13px;margin-top:18px;}
@keyframes stp-pp-shimmer{
  0%{background-position:200% 0;}
  100%{background-position:-200% 0;}
}
@media (prefers-reduced-motion:reduce){
  .stp-pp__sk{animation:none;}
}

/* ---------- empty / error states ---------- */
.stp-pp__state{
  display:none; /* wf-xano-display="block" supplies the shown value */
  background:var(--stp-pp-surface);
  border:1px solid var(--stp-pp-line);
  border-radius:var(--stp-pp-radius);
  padding:26px;
  font-size:14px;
  line-height:1.55;
  color:var(--stp-pp-ink-soft);
}
/* On a failed request the library renders 0 items, so it shows the empty
   element too. Suppress it so only the error message is visible.
   `is-wf-xano-error` is toggled on the WRAPPER — now the Designer div, an
   ANCESTOR of this embed — so it is matched as an ancestor, not on
   .stp-profile-preview itself. Reverting this to a compound selector
   (.stp-profile-preview.is-wf-xano-error) silently stops matching. */
.is-wf-xano-error .stp-profile-preview [wf-xano-element="empty"]{display:none !important;}
.stp-pp__state strong{
  display:block;
  margin-bottom:5px;
  font-size:15px;
  color:var(--stp-pp-ink);
}

/* ---------- responsive: photo stacks above the content ---------- */
@media (max-width:640px){
  .stp-pp__card,
  .stp-pp__loader{
    flex-direction:column;
    gap:18px;
    padding:18px;
    border-radius:18px;
  }
  .stp-pp__photo-wrap,
  .stp-pp__sk--photo{
    flex:0 0 auto;
    width:100%;
    max-width:320px;
    aspect-ratio:1/1;
  }
  .stp-pp__name{padding-right:0;}
  .stp-pp__pill{
    position:static;
    top:auto;
    right:auto;
    margin-bottom:12px;
  }
  .stp-pp__name{font-size:28px;}
  .stp-pp__meta{gap:8px 16px;}
}
</style>

<!-- NOTE: this div is NOT the wf-xano wrapper. The wrapper attributes
     (wf-xano-element="wrapper", -instance, -source, -method, -auth,
     -per-page, -param-memberstack_id) live on the Designer div that CONTAINS
     this embed. Adding them here too would create a second wrapper for the
     same instance — see "Designer wrapper" above. -->
<div class="stp-profile-preview">

  <!-- Loading skeleton. Visible in raw HTML so nothing ever flashes empty. -->
  <div class="stp-pp__loader" wf-xano-element="loader" wf-xano-display="flex" aria-hidden="true">
    <div class="stp-pp__sk stp-pp__sk--photo"></div>
    <div class="stp-pp__sk-body">
      <div class="stp-pp__sk stp-pp__sk--name"></div>
      <div class="stp-pp__sk stp-pp__sk--line"></div>
      <div class="stp-pp__sk stp-pp__sk--line is-short"></div>
      <div class="stp-pp__sk stp-pp__sk--bar"></div>
    </div>
  </div>

  <!-- Card template. `wf-xano-if` is a safety net: if the envelope transform
       ever fails, the item has no name fields and no empty card renders. -->
  <article class="stp-pp__card"
           wf-xano-element="template"
           wf-xano-if="First_Name|Last_Name|Professional_Headline"
           wf-xano-display="flex">

    <div class="stp-pp__photo-wrap">
      <img class="stp-pp__photo"
           alt="Your profile photo"
           wf-xano-src="Profile_Photo|Profile_Photo_Demo"
           src="data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23ecebe6'/%3E%3Ccircle cx='50' cy='39' r='16' fill='%23d3d2cb'/%3E%3Cpath d='M18 100c0-19 14-32 32-32s32 13 32 32z' fill='%23d3d2cb'/%3E%3C/svg%3E">
    </div>

    <div class="stp-pp__body">
      <!-- Static, always shown. -->
      <span class="stp-pp__pill">Available</span>

      <h3 class="stp-pp__name"><span wf-xano-bind="First_Name"></span> <span wf-xano-bind="Last_Name"></span></h3>

      <p class="stp-pp__headline" wf-xano-bind="Professional_Headline"></p>

      <ul class="stp-pp__roles" wf-xano-if="Role_1|Role_2|Role_3" wf-xano-display="flex">
        <li class="stp-pp__role" wf-xano-bind="Role_1" wf-xano-if="Role_1" wf-xano-display="inline-flex"></li>
        <li class="stp-pp__role" wf-xano-bind="Role_2" wf-xano-if="Role_2" wf-xano-display="inline-flex"></li>
        <li class="stp-pp__role" wf-xano-bind="Role_3" wf-xano-if="Role_3" wf-xano-display="inline-flex"></li>
      </ul>

      <p class="stp-pp__bio" wf-xano-bind="Bio"></p>

      <div class="stp-pp__meta">
        <span class="stp-pp__meta-item" wf-xano-if="Category" wf-xano-display="inline-flex">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.6 14.4 8 8 14.4 1.6 8 8 1.6Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
          <span wf-xano-bind="Category"></span>
        </span>

        <span class="stp-pp__meta-item" wf-xano-if="Location" wf-xano-display="inline-flex">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 14.5s5-4.2 5-8a5 5 0 1 0-10 0c0 3.8 5 8 5 8Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="8" cy="6.4" r="1.8" stroke="currentColor" stroke-width="1.4"/></svg>
          <span wf-xano-bind="Location"></span>
        </span>

        <!-- TODO: bind average review rating once the Webflow CMS reviews collection exists -->
        <span class="stp-pp__meta-item" style="display:inline-flex">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m8 1.9 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.7l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.9Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
          <span>0 (0 Reviews)</span>
        </span>
      </div>
    </div>
  </article>

  <div class="stp-pp__state" wf-xano-element="empty" wf-xano-display="block">
    <strong>Your profile preview isn't ready yet.</strong>
    Finish your profile and it will appear here exactly as Starters clients see it.
  </div>

  <div class="stp-pp__state" wf-xano-element="error" wf-xano-display="block">
    <strong>We couldn't load your profile preview.</strong>
    Refresh the page in a moment — your profile itself is safe.
  </div>
</div>
```

The card is centred with `max-width:820px`. Put the Designer wrapper div inside
whatever container gives the page its normal content width; the card fills that
container up to 820px and stacks the photo above the text below 640px.

Delete the static mock card, or — to keep it in the Designer as a visual
reference — give the mock's wrapper `wf-xano-element="delete"`. wf-xano removes
every element carrying that marker at boot, and its FOUC stylesheet hides them
with `display:none!important` before then, so the mock never flashes on the live
page.

## Part 2 — scripts embed

A second HTML Embed, or the page's custom code before `</body>`. Order relative
to Part 1 does not matter. Replace `<SCRIPT-URL>` with one of the two variants in
[Script URLs](#script-urls) below.

```html
<!-- ==========================================================================
     Onboarding profile preview — PART 2 of 2: SCRIPTS
     Requires PART 1 (the structure embed) inside a Designer div carrying the
     wf-xano wrapper attributes, on the same page.
     ========================================================================== -->

<script defer src="https://cdn.jsdelivr.net/gh/the-starters/wf-xano@v0.28.0/wf-xano.min.js"></script>
<script defer src="<SCRIPT-URL>/v3/onboarding-profile-preview.js"></script>
```

The wf-xano tag is pinned to **`@v0.28.0`**, and should stay pinned. If the page
currently loads `wf-xano@latest`, swap it for the pinned URL: `@latest` follows
that repo's newest tag, so a library release could change this card's rendering
without anyone touching this page. The card's contract with the library is narrow
but real — the `beforeRender` hook, `normalize()`'s single-object branch,
`setParam()`, and the `wf-xano-if-state` projection the form blocks rely on — and
v0.28.0 is the version it was verified against.

After publishing, check the console. On production the only expected log is
`[wf-xano] initialized 1 list(s)`.

## Form-block switching

The page ships **two Webflow form blocks** — one for consult-type freelancers, one
for full-type — and only the one matching the loaded record may be visible.

**This needs no JavaScript.** wf-xano projects its own reactive state onto any
element carrying `wf-xano-if-state`, and the record's type is in that state by the
time the card paints. So the switch is two Designer attributes per block and
nothing in this repo's script.

### Designer steps

On **each** form block's outermost wrapper:

| Block | `wf-xano-if-state` | `wf-xano-display` |
| --- | --- | --- |
| Consult form | `data.items.0.profile_type_30 === consult` | `block` (or `flex`/`grid` — the block's real display) |
| Full form | `data.items.0.profile_type_30 !== consult` | `block` (or `flex`/`grid`) |

Then, in the Designer, set **both blocks to `display: none`** on their own class.
That is the pre-data state: nothing flashes before the record lands, and wf-xano
reveals the winner on its first projection. Accepted tradeoff (Jerico's call): if
wf-xano fails to load, no form shows.

Three requirements that are easy to miss, each verified against `wf-xano.js`:

1. **Both blocks must live INSIDE the Designer wrapper div.** State projection
   runs `self.qa(selector)` — scoped to the instance root — so a form block that
   is a sibling of the wrapper is never found and never revealed.
2. **`wf-xano-display` is mandatory here, not optional.** `showStateEl()` does
   `el.style.display = visible ? el.getAttribute('wf-xano-display') || '' : 'none'`.
   With no `wf-xano-display`, "show" writes `display:''`, which *clears* the inline
   style and hands the decision back to CSS — where the class's `display: none`
   still applies. The block would then never appear, with no error anywhere. The
   attribute has to name the shown value because "not hidden" is not a single CSS
   value.
3. ⚠ **The comparison is case- and whitespace-exact.** `evalIf` does
   `String(left) === right` after trimming only the expression, so `consult`
   matches `"consult"` and **not** `"Consult"` or `" consult"`. The live record's
   `profile_type_30` is lowercase `full` (verified 2026-07-30). If Xano ever
   starts storing a capitalised or padded value, both blocks break silently —
   normalise it in Xano rather than adding cases here.

Quotes on the right-hand side are optional: `evalIf` strips one leading and
trailing `'` or `"`, so `=== consult` and `=== 'consult'` behave identically. The
unquoted form is used above because Webflow's attribute editor makes quotes easy
to mistype.

### Why `!== consult` for the full block

It encodes Jerico's "unknown type → full" rule in the grammar itself, with no
enumeration of types. On an empty result — a member with no freelancer row, a
bogus `?ms=`, or a first-load fetch error — `data.items` is `[]`, so
`data.items.0.profile_type_30` is `undefined`, and:

- consult block: `String(undefined) === 'consult'` → `"undefined" === "consult"` → **false**, stays hidden.
- full block: `String(undefined) !== 'consult'` → **true**, shows.

So the full form is the fallback for every unknown case, and any future type
added in Xano also lands on the full form until someone tags a block for it.
`=== full` would look more symmetrical and would be **wrong**: it shows nothing at
all when the field is blank or the fetch fails.

If a third type ever needs its own form, tag it
`wf-xano-if-state="data.items.0.profile_type_30 === hybrid"` and tighten the full
block to `!== consult & !== hybrid` (`&` is AND in this grammar, and binds tighter
than `|`).

### Checking it

`data.items` holds the **post-transform** record — the script's `beforeRender`
hook runs before the state transition — so `profile_type_30` is present there
alongside the computed `Role_1..3`, `Location`, and flattened `Bio`. In the
console:

```js
WfXano.get('onboarding-self-preview').getState().data.items[0].profile_type_30
```

`?ms=<memberstack_id>` with a member of the other type is the end-to-end check on
staging: the reload re-projects, so the blocks switch with the card.

## Script URLs

`<SCRIPT-URL>` in the Part 2 embed takes one of two forms.

**Staging QA (dev tunnel).** Run `./dev-tunnel.sh` from `starters-git/` (the
parent folder, not this repo) and use the hostname it prints:

```html
<script defer src="https://<auto-generated>.trycloudflare.com/v3/onboarding-profile-preview.js"></script>
```

The tunnel serves this repo at its root, so the path is exactly the file's path
in the repo — no prefix. The quick-tunnel hostname is auto-generated and
**changes every run**, so re-paste this line once per session, and it only works
while `dev-tunnel.sh` is running on that machine. Staging/test pages only.

**Production (jsDelivr).** Valid only after the change is merged to `main` and a
semver tag is pushed — jsDelivr's `gh` endpoint resolves `@latest` to the latest
git **tag**, not the latest commit, so a merged PR alone changes nothing:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@vX.Y.Z/v3/onboarding-profile-preview.js"></script>
```

Prefer the immutable `@vX.Y.Z` tag here over `@latest`. This embed is a one-page
install, so there is no benefit to a moving URL.

### Script tag order does not matter

The paste block lists the wf-xano tag first and this script second, which is the
clearer reading order, but strict ordering is **not** required. Verified against
`wf-xano.js` (v0.27.0 source, unchanged in the v0.28.0 bundle):

- Its run-once guard is `if (window.WfXano && !Array.isArray(window.WfXano)) return`
  — a pre-existing **array** is understood as the pre-load callback queue, not as
  a previous init, and is snapshotted and re-pushed. So this script loading
  first (it sets `window.WfXano = window.WfXano || []`) does not block the
  library.
- Loading second is equally fine: `window.WfXano` is then the API object, whose
  `push()` runs the callback immediately if booted and queues it otherwise.
- `boot()` calls `init(document)` (which starts the first fetch) and then drains
  the queued callbacks synchronously, while the `beforeRender` listener list is
  read only after `await fetch` / `await res.json()`. The hook is therefore
  always registered before the first response can render.

This script only ever pushes into that queue — it never calls the API directly —
so both orders and both `window.WfXano` shapes work. As a belt for the one case
ordering cannot cover (another script boots wf-xano early enough that a response
already rendered untransformed), `arm()` reads `getState()` and calls
`refresh()` when the status is already `success` or `error`.

## Staging tester: `?ms=<memberstack_id>`

Append `?ms=<memberstack_id>` to the page URL to render **that** member's card
instead of the one in `wf-xano-param-memberstack_id`. It exists so QA can check a
real profile — or the empty state — without that member's login:

```txt
https://the-starters-3-0.webflow.io/<onboarding-page>?ms=mem_cms4ovj4t0dp60tmoe1rn0swl
https://the-starters-3-0.webflow.io/<onboarding-page>?ms=mem_definitely_bogus   # empty state
```

Rules, all enforced in `v3/onboarding-profile-preview.js`:

- **Staging only.** Honored on `*.webflow.io`, `localhost`, `127.0.0.1`, and
  `*.trycloudflare.com`. On `thestarters.com` the parameter is ignored outright,
  so a link with `?ms=` in it is inert in production.
- **`STARTERS_DEBUG` does not unlock it.** That flag turns console logging on,
  including in production; it deliberately has no effect on this override.
- **Blank means absent.** `?ms=`, `?ms`, and a whitespace-only value all fall back
  to the page's own parameter. A pasted id is trimmed.
- Applied with `instance.setParam('memberstack_id', <id>)`, which sets the param,
  resets to page 1, and reloads. The `beforeRender` hook is registered before that
  reload is triggered, and the settled-state `refresh()` belt is skipped when an
  override is in play — otherwise one paint would cost two GETs.
- It announces itself in the console on staging:
  `[starters onboarding-preview] previewing member "<id>" from ?ms= (staging only).`

**This goes inert after the Xano auth flip, by design.** It works today only
because the endpoint still trusts a client-supplied `memberstack_id`. Once the
server derives the member from the auth token (below), the parameter is ignored
server-side and `?ms=` silently stops changing anything — the override is not a
hole that survives the fix, and the code needs no follow-up edit. At that point
QA previews another member by logging in as them.

## Xano auth flip (required before real users)

Until the flip, the endpoint is public and returns private fields (email, phone,
rates, reviewer emails) to anyone who knows or guesses a `memberstack_id` — and
the demo id is visible in the page source and the Network panel. Treat this as
required before the page reaches real members, not as a nice-to-have.

### Part 1 — Xano changes (apply by hand in the Xano UI)

- **Workspace / API group:** `api:KZf7nFnk` (`starters_onboarding`)
- **Endpoint:** `GET /starters_onboarding/get_freelancers`
- **Current behaviour (verified 2026-07-30):** no authentication. A tokenless
  `GET` with any `memberstack_id` returns that member's full freelancer record,
  including `Email`, `Phone`, `Hourly_Rate`, rate fields, and the `Reviewers`
  object with reviewer email addresses. A bogus id returns `{"freelancer":[]}`
  with HTTP 200.

1. **Turn on authentication** for the endpoint (*Settings* → **Requires
   Authentication**), against the same auth table the rest of the platform's
   authenticated endpoints use — the one the trade-token endpoint issues tokens
   for. `$auth` is then populated in the function stack.
2. **Delete the `memberstack_id` input** entirely. Not optional-with-fallback: an
   optional input that is still honoured leaves the whole vulnerability in
   place. Once the input is gone, any `memberstack_id` in the query string is
   ignored automatically.
3. **Derive the member server-side.** Confirm which of these is true before
   editing rather than assuming: if the auth table row stores `memberstack_id`,
   `Get Record` where `id = $auth.id` then filter freelancers on
   `memberstack_id = $user.memberstack_id`; if the auth table *is* the
   freelancers table, filter on `id = $auth.id` and drop the comparison; if the
   token's extras already carry it, use `$auth.extras.memberstack_id`.
4. **Keep the response shape identical** — still `{"freelancer": [ <one record> ]}`.
   An unchanged shape means the flip needs no JavaScript change at all.
5. **Return an empty envelope, not an error,** when there is no record.
   `{"freelancer": []}` keeps the empty state working for a member with no
   freelancer row; a 404 would show the error state instead.
6. **Optional but recommended — trim the payload.** The card needs only `id`,
   `First_Name`, `Last_Name`, `Professional_Headline`, `Roles`, `Bio`,
   `Category`, `City`, `State_Province`, `Country`, `Profile_Photo`,
   `Profile_Photo_Demo`. Rates, `Reviewers`, `Email`, `Phone`, Algolia sync
   fields, and Webflow ids are sent to the browser today for no reason.

Verification after the change:

```sh
# Must now fail (401/403), with and without the old param:
curl -i "https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starters_onboarding/get_freelancers"
curl -i "https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starters_onboarding/get_freelancers?memberstack_id=mem_cms4ovj4t0dp60tmoe1rn0swl"

# Must succeed and return only the token owner's record, even though the query
# string names a different member (proves the client input is ignored):
curl -i -H "Authorization: Bearer <XANO_TOKEN>" \
  "https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starters_onboarding/get_freelancers?memberstack_id=mem_SOMEONE_ELSE"
```

The third call is the important one. If it returns someone else's record, step 2
or 3 is incomplete.

### Part 2 — the wrapper flip

Two attributes on the Designer wrapper div (the element carrying
`wf-xano-element="wrapper"` — not the embed). Markup, CSS, the form-block
attributes, and the script are all untouched:

```diff
   wf-xano-source="https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starters_onboarding/get_freelancers"
   wf-xano-method="GET"
-  wf-xano-auth="none"
+  wf-xano-auth="memberstack"
   wf-xano-per-page="1"
-  wf-xano-param-memberstack_id="mem_cms4ovj4t0dp60tmoe1rn0swl"
```

### Page prerequisites for the authenticated version

Both must already be true on the onboarding page (see wf-xano `docs/usage.md` §4
"Authenticated Memberstack list"):

1. **memberstack-x loads before wf-xano.** wf-xano reads the Memberstack JWT via
   `window.$memberstackDom.getMemberCookie()`. On a Webflow site Memberstack is
   normally in the site-wide head, which satisfies this — confirm on the actual
   page rather than assuming.
2. **`WfXanoConfig.authBase` is set** site-wide to the trade-token API group URL.
   wf-xano `POST`s `{ "token": "<memberstack JWT>" }` to
   `authBase` + `/auth/trade-token/v3` and uses the returned Xano token as
   `Authorization: Bearer …`.

   **Neither embed sets any `WfXanoConfig`,** so this page cannot clobber a
   site-wide config — and so `authBase` has to come from that site-wide block. If
   the onboarding page has none, add one there, not in Part 2. Without
   `authBase`, wf-xano logs `authBase is required` and the list never loads.
3. **`wf-xano-source` stays a full HTTPS URL,** so `xanoBase` is not required
   here. Authenticated requests over plain `http://` are refused by the library.

Behaviour changes to expect after the flip: logged out, the trade-token handshake
fails and the card's error state shows (decide whether that copy is right if the
page can be reached logged out); the demo id disappears from the page source;
account switching clears and reloads the card automatically. Test in this order —
logged in with a completed profile, logged in with no freelancer row (empty
state), logged out, and an endpoint failure.

## Tune-ables

In the structure embed's `<style>`:

| What | Where | Note |
| --- | --- | --- |
| Serif face for the name | `--stp-pp-serif` | Currently starts with `"Playfair Display"` and falls back through system serifs. Swap the first entry for whatever serif the site actually loads, otherwise the name renders in a fallback. |
| Greens | `--stp-pp-green`, `--stp-pp-green-bg`, `--stp-pp-green-line` | Drive both the Available pill and the role chips. |
| Bio length | `-webkit-line-clamp:4` on `.stp-pp__bio` | No text is discarded, so raising the clamp is a one-number change. |

## Footgun: scope your querySelector

The wrapper contains **two** copies of the card markup once a render lands: the
hidden `wf-xano-element="template"` (which stays in the DOM) and the rendered
clone that follows it. In DOM order the template comes **first**, so a bare
`document.querySelector('.stp-pp__card')` — in the console, in a future page
script, or in a browser probe — returns the hidden template with empty binds, and
looks exactly like "the card did not render".

Query rendered items through `[wf-xano-item]`, the marker wf-xano puts on clones
and never on the template:

```js
document.querySelector('[wf-xano-item] .stp-pp__name').textContent   // rendered
document.querySelectorAll('.stp-pp__card')[1]                        // fragile — do not
```

The same applies to the loader, empty, error, and form-block elements: they are
all present in the DOM at all times and switched with inline `display`, so
presence proves nothing. Check computed visibility, not existence.

A second scoping trap now that the wrapper is a Designer div: the state classes
(`is-wf-xano-loading`, `is-wf-xano-error`, `is-wf-xano-empty`) land on **that
div**, not on `.stp-profile-preview`. Read them from the wrapper —
`document.querySelector('[wf-xano-instance="onboarding-self-preview"]').className` —
and write CSS that matches them as an **ancestor**, as the empty-state suppression
rule in the structure embed does.

## Diagnostics

- `window.StartersV3OnboardingProfilePreview` exposes `htmlToText`,
  `splitRoles`, `joinLocation`, and `unwrap` for console debugging. The transform
  is pure, so each piece can be checked against a real `Bio` or `Roles` string
  without reloading.
- The same object exposes `stagingHost()` and `memberOverride()`, which answer
  "why is `?ms=` doing nothing here" in one call: `stagingHost()` is `false` on
  production, and `memberOverride()` returns the id actually being honored (or
  `null`).
- A missing wf-xano instance logs
  `[starters onboarding-preview] no wf-xano instance "onboarding-self-preview" — …`,
  gated to staging hosts (`*.webflow.io`, `localhost`, `127.0.0.1`,
  `*.trycloudflare.com`) or `window.STARTERS_DEBUG = true`. Silent in production.
  This warning matters
  because the failure is otherwise invisible: with no transform the binds resolve
  against the envelope, the template's `wf-xano-if` guard hides the card, and the
  page shows the empty state to a member who has a complete profile.

## Local QA

`local-demos/onboarding-profile-preview-harness.html` is a neutral page shell
around the same CSS and markup, loading `/v3/onboarding-profile-preview.js` by
relative path against the live endpoint. `local-demos/` is gitignored, so the
harness is local-only and never published.

It mirrors the page architecture rather than shortcutting it: an outer div stands
in for the Designer wrapper and carries the `wf-xano-*` attributes, the card
markup sits inside it with none, and two stand-in form blocks inside the same
wrapper carry the real `wf-xano-if-state` / `wf-xano-display` pairs and are hidden
by their own class. So the switching it exercises is the same wf-xano projection
the live page uses, not a simulation.

```sh
# from the repo root
python3 -m http.server 8747     # then open http://localhost:8747/local-demos/onboarding-profile-preview-harness.html
```

Or serve it through the tunnel (`./dev-tunnel.sh` from `starters-git/`) at
`https://<tunnel>/local-demos/onboarding-profile-preview-harness.html`, which
exercises the exact script URL a Webflow staging page would load.

`?ms=<memberstack_id>` works here too — `localhost`, `127.0.0.1`, and the tunnel
host all count as staging. The harness has no override logic of its own, so the
code path it exercises is the same one a Webflow staging page runs. A `file://`
open is **not** a staging host, so serve the page rather than double-clicking it.

## Release gate

- Run `node --test v3/onboarding-profile-preview.test.js`.
- QA through the dev tunnel first (card renders the test record with name, photo,
  role chips, plain-text bio, joined location, static reviews and pill; zero
  console errors; `?ms=mem_definitely_bogus` shows the empty state; `?ms=` with
  the real test id renders that card), then land it: branch → PR → merge on
  GitHub → semver tag → verify the jsDelivr URL returns 200.
- Confirm the page's wf-xano tag is the pinned `@v0.28.0` URL, not `@latest`.
- Confirm exactly one element on the page carries
  `wf-xano-element="wrapper"` + `wf-xano-instance="onboarding-self-preview"`, and
  that both form blocks are inside it.
- Form-block check: the full block shows for the test record
  (`profile_type_30 = "full"`), the consult block stays hidden, and on
  `?ms=mem_definitely_bogus` the full block still shows (the `!== consult`
  fallback) while the card shows its empty state.
- Standard exposure scan before tagging: no `api.airtable.com`, no
  `hook.us1.make.com`, no `pat…` PAT patterns. This module calls nothing itself —
  the only URLs in the deliverable are the jsDelivr wf-xano tag and the Xano
  endpoint in the markup.
