# Agency section on the public profile — wiring

`v3/agency-profile.js` renders the **Agency** section on `/hire/<slug>`: agency
name, team size, contract type, and an intro video, read from Xano at page load.

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
| Filling in the three text fields | `wf-xano`, via `wf-xano-bind` |
| Hiding the section for a non-agency, and each empty row | `wf-xano`, via `wf-xano-if` |
| Putting the profile slug into the request | `v3/agency-profile.js` |
| Pointing the video player at the right video | `v3/agency-profile.js` |
| Collapsing the wrapper so it stops taking a flex/grid slot | `v3/agency-profile.js` |
| Layout, classes, placement, copy | Designer |

The script is deliberately small. It never decides which rows appear — that is
`wf-xano-if` in the markup — and it writes exactly three things: the slug param,
the wrapper's `display`, and the iframe's `src`/`loading`.

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
Section wrapper          ← the fetch lives here
└── Card                 ← everything visible lives in here
    ├── Name row
    ├── Team size row
    ├── Contract type row
    └── Video row
        └── Embed → <iframe>
```

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

- `wf-xano-auth="none"` — the endpoint is public on purpose. It serves five
  display fields and nothing else, so a logged-out brand sees the section.
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

### The three text rows

One row per field, each a Div Block inside the Card holding a label and a value
element. The row carries the hide; the value element carries the bind.

| Row | On the row wrapper | On the value element |
| --- | --- | --- |
| Agency name | `wf-xano-if` = `agency_name` | `wf-xano-bind` = `agency_name` |
| Team size | `wf-xano-if` = `agency_team_size` | `wf-xano-bind` = `agency_team_size` |
| Contract type | `wf-xano-if` = `agency_contract_type` | `wf-xano-bind` = `agency_contract_type` |

A bare field name in `wf-xano-if` means "show only if this field has a value".
An empty value hides the row instead of printing a blank line.

The value element can be any text element — Text Block, Paragraph, Heading.

Known and accepted: a team size stored as `0` counts as empty, so that row
hides. No agency currently stores `0`.

### Video row

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
| `wf-xano-bind="<field>"` | wf-xano | Replaces the element's text with that field. |
| `wf-xano-if="<field>"` | wf-xano | Hides the element when that field is empty. |
| `data-agency-v3="section"` | script | Where to write the slug, and whose `display` to control. |
| `data-agency-v3="video"` | script | Where to write the video URL. |
| `wf-xano-param-slug` | — | **Not authored.** The script adds it at runtime. |

## The endpoint

`GET {xanoBase}/api:KZf7nFnk/profile/starter/agency/v1?slug=<slug>` — public, no
auth. Returns exactly these five fields and nothing else:

| Field | Type | Example | Empty looks like |
| --- | --- | --- | --- |
| `is_agency` | boolean | `true` | `false` |
| `agency_name` | text | `The Starters` | `""` |
| `agency_team_size` | number | `5` | `null` |
| `agency_contract_type` | text | `12+ months` | `""` |
| `agency_video_link` | text | `https://player.vimeo.com/video/1123131951?byline=0&portrait=0&title=0` | `""` |

An unknown slug, an empty slug, a missing slug, and a non-agency profile all
return the same safe empty shape with HTTP 200, so the page never special-cases
an error. Contract type prints as stored; live values today are
`Month to Month`, `6-12 months`, and `12+ months`.

wf-xano also appends its own `page` and `per_page` query params to the request.
The endpoint ignores them.

## Failure behavior

Silent and closed, in every direction. No slug, no authored section, a dead
endpoint, or the script never loading all end with no card rendered and nothing
extra on the page. wf-xano injects
`[wf-xano-element="template"]{display:none!important}`, so even the authored
card stays hidden on a page where this script never ran — the only thing lost in
that case is the wrapper's flex-slot collapse described above.

## Diagnostics

Staging-only, per the predicate in [`README.md`](../README.md#staging-only-console-diagnostics)
(`*.webflow.io`, `localhost`, `127.0.0.1`, `*.trycloudflare.com`, or
`window.STARTERS_DEBUG === true`). Production is silent. The script warns when:

- the wrapper is on the page but no `starter-agency` instance was created —
  almost always a missing `wf-xano-element="wrapper"` or a missing template;
- a video link came back but no rendered iframe carries `data-agency-v3="video"`.

## Verification

| Profile | Expected |
| --- | --- |
| `/hire/jai` | Section visible. **The Starters**, team size **5**, **12+ months**, video player showing. |
| `/hire/alex-o` | Section visible. **DecimaLabs**, team size **7**, **Month to Month**, **no video row**. |
| `/hire/maureen` | No section, and no gap where it would be. |
| Any other starter | Same as `maureen`. |

Automated coverage lives outside this repo, in the local QA harness:

- `staging-qa/checks/agency-endpoint-contract.mjs` — the HTTP contract.
- `staging-qa/checks/agency-section-fixture.mjs` — the rendered page, against a
  captured `/hire` page with this section injected, hitting the live endpoint.

If the section never appears on `/hire/jai`, check in this order: the embed line
is present and points at a real tag; `wf-xano-defer="true"` and
`wf-xano-element="wrapper"` are both on the wrapper; `wf-xano-instance` reads
exactly `starter-agency`; the card's `wf-xano-if` reads `is_agency & agency_name`
with a plain `&`. On staging, the console warning names the failure directly.
