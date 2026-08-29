# Agency section on the public profile — wiring

`v3/agency-profile.js` renders the **Agency** section on `/hire/<slug>`: agency
name, team size, contract type, average project size, and an intro video, read
from Xano at page load.

This is the authoritative contract. Every **attribute** below is load-bearing —
the section goes dark if one is misspelled, because the script and a live Xano
endpoint both read these exact strings. Every **class, layout, label, and
style** is Designer's; nothing here constrains how the section looks or where it
sits.

Feature spec and grilling record: `.scratch/agency-profile-display/spec.md`.

## Who owns what

| Concern | Owner |
| --- | --- |
| Fetching the agency record | `wf-xano` (already on this template) |
| Filling in the four text fields | `wf-xano`, via `wf-xano-bind` |
| Hiding the section for a non-agency, and each empty row | `wf-xano`, via `wf-xano-if` |
| Putting the profile slug into the request | `v3/agency-profile.js` |
| Pointing the video player at the right video | `v3/agency-profile.js` |
| Collapsing the wrapper so it stops taking a flex/grid slot | `v3/agency-profile.js` |
| Layout, classes, placement, copy | Designer |

The script is deliberately small. It never decides which rows appear — that is
`wf-xano-if` in the markup — and it writes exactly three things: the slug param,
the wrapper's hidden state (`hidden`, inline `display`, and its own
`data-agency-v3-hidden` marker), and the iframe's `src`/`loading`.

## Install

Hire template → Page Settings → Custom Code → **Before `</body>`**:

```html
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/agency-profile.js" defer></script>
```

Position does not matter — the script works whether it runs before or after the
`wf-xano` tag already on this template, because it goes through the library's
pre-load queue.

## The element tree

```
Section wrapper              ← the fetch lives here
├── Loader Div               ← plain Div you own; shown only while loading
│   └── Spinner component    ← data-global-spinner instance, untouched
└── Card                     ← everything visible lives in here
    ├── Name row
    ├── Team size row
    ├── Contract type row
    ├── Average project size row
    └── Video row
        └── Embed → <iframe>
```

The Loader Div is a **sibling** of the card, not a child of it. Inside the card
it would be cloned once per rendered row, and the copy wf-xano toggles would be
the hidden original.

### Section wrapper

The outermost element of the section. A plain Div Block.

| Attribute | Value |
| --- | --- |
| `data-agency-v3` | `section` |
| `wf-xano-element` | `wrapper` |
| `wf-xano-instance` | `starter-agency` |
| `wf-xano-source` | `KZf7nFnk:profile/starter/agency/v1` |
| `wf-xano-method` | `GET` |
| `wf-xano-auth` | `none` |
| `wf-xano-defer` | `true` |

Three of these deserve a note:

- `wf-xano-auth="none"` — the endpoint is public on purpose. It serves only the
  display fields listed in [The endpoint](#the-endpoint) and nothing else, so a
  logged-out brand sees the section. That list is the audit surface: everything
  on it, `retainer_rate` included, is readable by anyone with the URL, so check
  it whenever the endpoint changes.
- `wf-xano-defer="true"` — do not drop this one. It tells wf-xano *not* to start
  the request on its own and hands that job to the script. Verified by probe:
  without it the request can leave before the script has added the slug, and the
  agency's section comes back empty with no second attempt.
- `wf-xano-element="wrapper"` — without it `init()` finds nothing and returns
  silently. There is no console error for this; the section simply never
  renders. (On staging the script warns; production stays quiet.)

**Give this wrapper no box of its own** — no padding, margin, border,
background, or min-height. It renders on every profile, including the ~3,000
starters who are not agencies, so any box on it becomes a visible empty band on
their pages.

**If the wrapper's parent is a flex or grid container with `gap`**, know that a
zero-height child still occupies a slot and still consumes a gap. Measured on
this page: a hidden section left a 96px sibling distance where a single 48px gap
belonged. The script handles this by setting `display: none` on the wrapper for
non-agency profiles, so the layout is correct on any published page — but a page
where the script fails to load falls back to the 0px-tall-but-still-a-flex-item
behavior. Placing the section outside a gapped flex/grid parent removes the
dependency entirely.

### Loading spinner

Build a **plain Div Block** as a direct child of the wrapper and a sibling of
the card, then **nest the `data-global-spinner` component instance inside it,
untouched**. The Div is the loader; the component is only what it contains.

That wrapping Div is not ceremony. A Webflow global component instance's root
carries the shared component class and locks its styling, so a hide class added
there either cannot be applied at all or applies to every place that component
is used across the site. The attributes and the hiding therefore go on a Div you
own.

On the **Div** — not on the component instance:

| Attribute / style | Value | Why |
| --- | --- | --- |
| `wf-xano-element` | `loader` | Marks it as the element wf-xano shows during the request. |
| `wf-xano-display` | `flex` | The inline `display` wf-xano writes while showing it. |
| a dedicated hide class | its only declaration is `display: none` | Authors it hidden, which is what makes it fail-closed. |
| centering + a small `min-height` | on that Div | It is the element being switched to `flex`; see below. |

**Name the hide class something dedicated** — `agency-loader-hide` is the
suggestion. Two rules: it must do nothing but `display: none`, and it must not be
reused anywhere else, or a later edit to a shared utility class silently decides
whether this section's spinner works. The name is yours, but **record it here
when you build it** — it is load-bearing and otherwise ungreppable from the repo.

> **Record the class you build here.** Suggested: `agency-loader-hide`. Replace
> this line with the name actually used, so the class is greppable from the
> repo.

Those pieces together are the whole mechanism, and each is doing a job:

- wf-xano shows the loader for exactly as long as the request is in flight, by
  writing an **inline** `display` onto the Div. An inline style beats a class,
  which is why `wf-xano-display="flex"` is required — without it the library
  writes `display: ""`, which clears the inline style and lets the hide class
  win, so the spinner never appears.
- Authoring it hidden is what makes it **fail-closed**. Only wf-xano's inline
  write can override the class, so if the library or the page script is dead the
  spinner stays hidden instead of spinning forever over a section that is never
  going to load.
- When the request finishes — success *or* failure — wf-xano writes
  `display: none` back onto it.

**Centering.** The Div carrying `wf-xano-element="loader"` is the element whose
`display` wf-xano overwrites with `flex`, so it is the element that must do the
centering: full width, content centered on both axes, and a small `min-height`.
Do not put the centering on the component instance nested inside it — that
element's display is never touched, so it cannot be the flex container being
switched on.

**Optional styling hook, with one real limit.** While the request is in flight
wf-xano puts `is-wf-xano-loading` on the **wrapper** and sets `aria-busy` on it,
so that class can style the loading state beyond the spinner itself.

`wf-xano-auth="none"` means an auth change never reloads this instance, and
there is no focus revalidation or pagination. However, `WfXano.refresh()` is
unguarded: any script can call it without an argument and reload every
registered instance. On an agency profile, each such reload re-adds the loading
class and re-shows the loader in the still-visible wrapper. The script re-arms
its no-response timeout on every transition into `loading`, so a later stalled
reload collapses the wrapper just as the initial stalled request does.

wf-xano also adds `is-wf-xano-error` after a failed load, and that one is **not
usable here**: the script collapses the wrapper on error with an inline
`display: none`, which a class cannot beat. Anything styled by
`is-wf-xano-error`, on the wrapper or anywhere inside it, can never render. If
the section ever needs a visible error or retry state, it has to live in an
element **outside** the wrapper, driven separately — not inside a section whose
whole job is to disappear when there is nothing to show.

### Two things never to do

**Never hide the wrapper with a class.** The script reveals an agency's section
by clearing an *inline* `display`, and clearing an inline style cannot beat a
class. A class-hidden wrapper means the section is dark on every profile,
including real agencies, with no console error and no failed request — the data
arrives and paints into an element nobody can see. Hiding is the script's job;
the wrapper ships visible and unstyled.

**Never author `wf-xano-if-state`, `wf-xano-class-state`, or
`wf-xano-element="error"` on or inside the wrapper.** Those state projections
match against the instance root and write their own inline `display` on a
microtask that lands *after* the script's writes, silently undoing them. The
section's visibility has exactly one owner, and adding a state projection here
takes it away without any sign that it happened.

**How this interacts with the wrapper hide.** The script does not collapse the
wrapper until the response lands, precisely so the spinner has somewhere to
show. On a non-agency profile the sequence a visitor gets is: wrapper visible
with spinner → response arrives → spinner hidden by wf-xano and wrapper
collapsed by the script, in the same tick. A failed request collapses the
wrapper too, as does a section that is misconfigured badly enough that no
wf-xano instance is created.

### The trade-off this buys — read before styling the spinner

The spinner is inside the section wrapper, and the wrapper cannot be collapsed
until the answer arrives. So **the spinner appears briefly on every profile**,
including the roughly 3,000 starters who are not agencies, and then vanishes
along with the section.

For a non-agency visitor that means a short flash of a centered spinner followed
by the content below it jumping up by the spinner's height plus the parent's
gap. This is the agreed behavior, not an oversight — but the size of that jump
is entirely in the spinner's styling, so:

- **Keep the spinner's height small.** Give it a modest `min-height` rather than
  a tall reserved block. The layout shift is exactly the height you reserve.
- Consider whether the section's position on the page makes the shift
  noticeable. Below the fold, it costs nothing; directly under the hero, it is
  visible on every non-agency profile.

The alternative — hiding the wrapper up front — was rejected because it would
hide the spinner too, which is the thing being asked for.

### Card

A Div Block, the only child of the wrapper that carries styling. Heading, rows,
everything.

| Attribute | Value |
| --- | --- |
| `wf-xano-element` | `template` |
| `wf-xano-if` | `is_agency & agency_name` |

`wf-xano-if` on the Card is the **whole-section hide**: the card appears only
for a profile flagged as an agency *and* carrying an agency name. Everything
else is inside the card, so it all disappears together.

Type the value with a plain ampersand: `is_agency & agency_name`. It reads as
"and".

> In the Designer the card is visible with empty text. On the published page
> wf-xano hides the original and shows a filled copy, so a blank one never
> reaches a visitor. Placeholder text typed into the bound elements is replaced
> at runtime.

### The four text rows

One row per field, each a Div Block inside the Card holding a label and a value
element. The row carries the hide; the value element carries the bind.

| Row | On the row wrapper | On the value element |
| --- | --- | --- |
| Agency name | `wf-xano-if` = `agency_name` | `wf-xano-bind` = `agency_name` |
| Team size | `wf-xano-if` = `agency_team_size` | `wf-xano-bind` = `agency_team_size` |
| Contract type | `wf-xano-if` = `agency_contract_type` | `wf-xano-bind` = `agency_contract_type` |
| Average project size | `wf-xano-if` = `retainer_rate` | `wf-xano-bind` = `retainer_rate` |

`retainer_rate` arrives **already formatted as currency** (`$10,000.00`). Do not
add a number format to it — bind it as text. The endpoint returns `""` whenever
the stored rate is disabled or not a number, so that row hides on its own
without the page having to know the rule.

A bare field name in `wf-xano-if` means "show only if this field has a value".
An empty value hides the row instead of printing a blank line.

The value element can be any text element — Text Block, Paragraph, Heading.

Known and accepted: a team size stored as `0` counts as empty, so that row
hides. No agency currently stores `0`.

#### Inline labels

For a row that reads as one sentence in a single text element — `Team size: 10`
rather than a separate label and value — do **not** type the label into the
bound element. `wf-xano-bind` replaces that element's entire text content, so
the label is overwritten the moment the data arrives. Use the prefix attribute
instead:

```html
<div wf-xano-bind="agency_team_size" wf-xano-prefix="Team size: "></div>
```

`wf-xano-prefix` (and `wf-xano-suffix`) wrap the value at formatting time and
are applied only when the value is non-blank, so an empty field still yields an
empty element rather than a stranded `Team size:` with nothing after it. Keep
the row's `wf-xano-if` either way — the prefix does not hide anything on its
own.

### Video row

> **Status: runtime support built; Designer row dormant by choice.** The section
> is live on staging without an authored video row, and that is a product
> decision rather than an outstanding engineering task. The field, endpoint, and
> script handling are all in place, so enabling it later is purely a Designer
> step. Everything below applies whenever that happens.

A Div Block inside the Card, holding an **HTML Embed**.

| Attribute | Value |
| --- | --- |
| `wf-xano-if` | `agency_video_link` |

Paste this into the HTML Embed, exactly as written:

```html
<iframe
  data-agency-v3="video"
  title="Agency intro video"
  loading="lazy"
  width="100%"
  height="100%"
  frameborder="0"
  allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
  allowfullscreen
  referrerpolicy="strict-origin-when-cross-origin"
></iframe>
```

**Leave `src` off.** That is not an omission — the script fills it in from the
fetched link. An authored `src` would load the wrong video for every agency.
`loading="lazy"` is authored here and re-asserted by the script; the section
sits below the fold.

Size the player by styling the row (a 16:9 wrapper is the usual choice); the
iframe fills it.

## Copy-paste reference

Contractual attributes only. Classes go alongside them; nothing here needs
removing to add styling.

```html
<div data-agency-v3="section"
     wf-xano-element="wrapper"
     wf-xano-instance="starter-agency"
     wf-xano-source="KZf7nFnk:profile/starter/agency/v1"
     wf-xano-method="GET"
     wf-xano-auth="none"
     wf-xano-defer="true">

  <!-- Plain Div you own, authored hidden by its own class; wf-xano writes
       display:flex inline for the length of the request. The spinner component
       instance is nested inside and left untouched. -->
  <div class="agency-loader-hide"
       wf-xano-element="loader"
       wf-xano-display="flex">
    <div data-global-spinner><!-- global spinner component instance --></div>
  </div>

  <div wf-xano-element="template" wf-xano-if="is_agency & agency_name">

    <h2>Agency</h2>

    <div wf-xano-if="agency_name">
      <div>Agency</div>
      <div wf-xano-bind="agency_name"></div>
    </div>

    <div wf-xano-if="agency_team_size">
      <div>Team size</div>
      <div wf-xano-bind="agency_team_size"></div>
    </div>

    <div wf-xano-if="agency_contract_type">
      <div>Contract type</div>
      <div wf-xano-bind="agency_contract_type"></div>
    </div>

    <!-- Single-element row, using the prefix rather than a typed-in label. -->
    <div wf-xano-if="retainer_rate">
      <div wf-xano-bind="retainer_rate"
           wf-xano-prefix="Average project size: "></div>
    </div>

    <div wf-xano-if="agency_video_link">
      <iframe
        data-agency-v3="video"
        title="Agency intro video"
        loading="lazy"
        width="100%"
        height="100%"
        frameborder="0"
        allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
    </div>

  </div>
</div>
```

## What each attribute does

| Attribute | Who reads it | What happens |
| --- | --- | --- |
| `wf-xano-source` | wf-xano | Calls `profile/starter/agency/v1` in the V3.0 Starters API group. |
| `wf-xano-method="GET"` | wf-xano | Sends the slug as a query string. |
| `wf-xano-auth="none"` | wf-xano | No login required. |
| `wf-xano-instance="starter-agency"` | wf-xano + script | Names this fetch so the script can find it. Distinct from the Reviews section's `starter-reviews` on the same page. |
| `wf-xano-defer="true"` | wf-xano | Waits for the script instead of firing on page load. |
| `wf-xano-element="wrapper"` | wf-xano | Marks the section as the fetch's root. |
| `wf-xano-element="template"` | wf-xano | Marks the card to fill in with the response. |
| `wf-xano-element="loader"` | wf-xano | Shows this element while the request is in flight, hides it afterwards. |
| `wf-xano-display="flex"` | wf-xano | The inline `display` written while the loader is shown. Required, or the hiding class wins. |
| `wf-xano-bind="<field>"` | wf-xano | Replaces the element's text with that field. |
| `wf-xano-prefix="<text>"` | wf-xano | Literal text prepended to a non-blank bound value. |
| `wf-xano-if="<field>"` | wf-xano | Hides the element when that field is empty. |
| `data-global-spinner` | the global spinner component | Not read by wf-xano or the script; it marks the nested component instance. |
| `data-agency-v3-timeout-ms` | script | Optional override for the no-response cap; see [Failure behavior](#failure-behavior). Not needed in Designer. |
| `data-agency-v3-hidden` | script | Written by the script when it collapses the wrapper. Do not author or style it. |
| `data-agency-v3="section"` | script | Where to write the slug, and whose `display` to control. |
| `data-agency-v3="video"` | script | Where to write the video URL. |
| `wf-xano-param-slug` | — | **Not authored.** The script adds it at runtime. |

## The endpoint

`GET {xanoBase}/api:KZf7nFnk/profile/starter/agency/v1?slug=<slug>` — public, no
auth. Returns exactly these six fields and nothing else:

| Field | Type | Example | Empty looks like |
| --- | --- | --- | --- |
| `is_agency` | boolean | `true` | `false` |
| `agency_name` | text | `The Starters` | `""` |
| `agency_team_size` | number | `5` | `null` |
| `agency_contract_type` | text | `12+ months` | `""` |
| `agency_video_link` | text | `https://player.vimeo.com/video/1123131951?byline=0&portrait=0&title=0` | `""` |
| `retainer_rate` | text | `$10,000.00` | `""` |

An unknown slug, an empty slug, a missing slug, and a non-agency profile all
return the same safe empty shape with HTTP 200, so the page never special-cases
an error. Contract type prints as stored; live values today are
`Month to Month`, `6-12 months`, and `12+ months`.

`retainer_rate` is display-ready currency, formatted by the endpoint rather than
by the page. Deciding when a rate is publishable is endpoint-owned policy too: a
disabled or non-numeric stored rate comes back as `""`, which the row's
`wf-xano-if` hides. Neither Designer nor the script needs to know that rule.

wf-xano also appends its own `page` and `per_page` query params to the request.
The endpoint ignores them.

## Failure behavior

Once wf-xano is present, failures are silent and leave no visible card. No slug,
no authored section, a dead endpoint, or the page script never loading all end
without agency content. wf-xano injects
`[wf-xano-element="template"]{display:none!important}`, so even the authored
card stays hidden on a page where this script never ran — the only thing lost in
that case is the wrapper's flex-slot collapse described above.

| What breaks | Card | Spinner | Wrapper |
| --- | --- | --- | --- |
| Nothing (non-agency) | hidden by `wf-xano-if` | shows, then hides | collapses |
| Request fails | normally re-rendered empty; any surviving keyed card has its video `src` stripped | hides on `error` | collapses |
| Instance is already in `error` at activation | any stale card remains inside the collapsed wrapper, with its video `src` stripped | already hidden | collapses without subscribing |
| Request never settles | hidden (never rendered) | keeps spinning until the cap | collapses at the timeout, and staging logs why |
| wf-xano throws inside init | hidden by wf-xano's injected CSS | never shows | collapses, and staging logs why |
| Section misconfigured (no instance) | hidden by wf-xano's injected CSS | never shows | collapses, and staging logs why |
| `wf-xano-instance` duplicated elsewhere | renders normally | shows, then hides | behaves normally; staging warns about the duplicate |
| Script never loads | hidden by wf-xano's injected CSS | never shows (authored hidden) | stays visible at 0px height |
| wf-xano never loads | **visible with empty text** | never shows (authored hidden) | stays visible at 0px height |

The spinner column splits three ways, and the reason differs each time. Where a
request actually starts, the spinner does its job and then goes — shown by
wf-xano while the request is open, hidden again when it settles, or held up
until the cap fires on a request that never settles. Where no request ever
starts — no instance, a throw inside the library, a missing page script, a
missing library — the spinner never appears at all, because it is authored
hidden with a class and only wf-xano's inline write can reveal it.

The duplicate-key row is the one that is *not* a failure of this section: the
wrapper resolves its own instance through the library's element back-reference
rather than by key, so it fetches and renders normally. The warning is there
because anything else on the page looking up `starter-agency` by key will get
the wrong element.

The already-error row deliberately returns before installing result or status
subscriptions. That instance has no retry path, and wf-xano can replay an older
result to a late listener even after a later failure; subscribing would risk
repainting stale agency data after the wrapper had been collapsed.

The "request never settles" row is why the script carries an 8-second cap.
wf-xano's `load()` sets no fetch timeout, so a stalled request emits neither a
result nor an error and would otherwise leave the spinner turning and the
section holding its slot on *every* profile indefinitely. The cap collapses the
section instead. A response that arrives after the cap is still processed — an
agency's section simply appears late rather than not at all. The cap is
overridable per page via `data-agency-v3-timeout-ms` on the wrapper; that
attribute exists for the test harness and for tuning, and is not needed in
Designer. It accepts a positive integer number of milliseconds. Missing,
malformed, zero, and negative values fall back to 8,000ms rather than disabling
the cap; values above 60,000ms are clamped to 60,000ms.

One naming note, because both markers exist on this site and the similarity is
deliberate rather than accidental: `data-global-spinner` is the reusable spinner
**component** used here, and is a different thing from the site's
`data-page-spinner` full-page loading marker. This section uses
`data-global-spinner` only.

That last row is the one honest gap, and it is not fixable from this side. If
wf-xano itself fails to load, its
`[wf-xano-element="template"]{display:none!important}` rule is never injected
and the authored card shows with blank values. Do **not** try to pre-empt this
by giving the card a hiding class: wf-xano reveals a rendered card by clearing
its *inline* display, which cannot beat a class, so the section would then never
appear at all. Every wf-xano-driven section on this page — Reviews included —
shares this failure mode.

## Diagnostics

Staging-only, per the authoritative predicate in
[`README.md`](../README.md#staging-only-console-diagnostics). Production is
silent.

Every message is prefixed `[agency-profile]`, so console output is attributable
at a glance on a page that runs a few dozen scripts. There are five:

| Warning | What it means |
| --- | --- |
| `no "starter-agency" instance was created for the section …` | Almost always a missing `wf-xano-element="wrapper"`, a missing `wf-xano-source`, or no `wf-xano-element="template"` inside the wrapper. The section is collapsed. |
| `wf-xano threw while initializing the section: …` | The library raised while starting this instance. The section is collapsed. |
| `another element on the page also carries wf-xano-instance="starter-agency" …` | Informational. This section still works — it uses its own instance — but the key is no longer unique. |
| `no response after <n>ms — collapsing the section` | The request never settled and the cap fired. |
| `a video link was returned but no rendered iframe carries data-agency-v3="video"` | The data has a video but the markup has nowhere to put it. |

## Verification

The section is built and QA-verified on staging: structure correct, spinner
behaving, video row deliberately absent (see above).

| Profile | Expected |
| --- | --- |
| `/hire/jai` | Section visible. **The Starters**, team size **5**, **12+ months**, average project size **$10,000.00**. Video player too, once that row is built. |
| `/hire/alex-o` | Section visible. **DecimaLabs**, team size **7**, **Month to Month**, average project size **$4,000.00**, and no video row even once that row exists — this agency has no video. |
| `/hire/maureen` | No section, and no gap where it would be. |
| Any other starter | Same as `maureen`. |

Automated coverage sits in this repository and the local QA harness:

- `v3/agency-profile.test.js` — in this repo, run by CI on every PR. Guards the
  release marker against drift; covers slug parsing, the section's show rule,
  the https-only video policy, and the timeout cap's bounds; and exercises the
  activation failure and reload paths.
- `staging-qa/checks/agency-endpoint-contract.mjs` — the HTTP contract, in the
  local QA harness.
- `staging-qa/checks/agency-section-fixture.mjs` — the rendered page, against a
  captured `/hire` page with this section injected, hitting the live endpoint.

If the section never appears on `/hire/jai`, check in this order: the embed line
is present and points at a real tag; `wf-xano-defer="true"` and
`wf-xano-element="wrapper"` are both on the wrapper; `wf-xano-instance` reads
exactly `starter-agency`; the card's `wf-xano-if` reads `is_agency & agency_name`
with a plain `&`. On staging, the console warning names the failure directly.
