# Account Settings

Browser scripts for the logged-in member's own account and billing pages —
plan state, billing dates, pause and cancel flows. Everything here reads the
Memberstack member in the browser and renders into Designer-authored elements
through a custom attribute contract; none of it holds a secret or performs a
billing mutation, which stays behind Xano.

## Memberstack plan dates

`plan-dates.js` prints a member's plan and billing dates into the page, formatted
`Jan 10, 2000`. It exists so a pause UI can tell a member the date their
subscription actually resumes — which by default is their paid-through date plus
the pause, not their signup date plus the pause. Signup-anchored is still
available; see [Choosing what `resumes-at` counts from](#choosing-what-resumes-at-counts-from).

Tag any text element with the field you want. That is the only attribute
required:

```html
<span ms-form-pause-date="next-billing">—</span>
```

### Every attribute

| Attribute | Goes on | Required | Default | What it does |
| --- | --- | --- | --- | --- |
| `ms-form-pause-date` | The text element that displays the date | **Yes** | — | Names which date to print. This is what makes the element render at all; an element without it is ignored. Values in the next table |
| `ms-form-pause-input` | The radio-group wrapper, **or** each input | No | — | Marks the control the member uses to choose the pause length. `resumes-at` re-renders on every `change` |
| `ms-form-pause-reveal` | A wrapper around the whole sentence | No | — | Keeps the block hidden until the member picks an option **and** every date inside resolves. Needs the paired CSS rule below |
| `ms-form-pause-months` | The date element or any ancestor | No | `1` | Static pause length in months. Used when no marked control is checked, so the date is never blank before the member picks |
| `ms-form-pause-anchor` | The date element or any ancestor | No | `next-billing` | What `resumes-at` counts from: `next-billing` or `signup` |
| `ms-form-pause-empty` | The date element or any ancestor | No | `—` | Text rendered when the date cannot be resolved — logged out, free plan, failed lookup. Never `Invalid Date`, never a stale value |

Everything except `ms-form-pause-date` and `ms-form-pause-input` is read from the
element **or any ancestor**, so one wrapper can configure a whole block. An
attribute on the element itself beats the same one on a wrapper.

The contract is deliberately this small. A `-format` attribute with four date
presets, a `-tz` zone override, and a `-id` plan pin all shipped in an earlier
revision and were cut: nothing needed them, and `-tz` actively contradicted the
month arithmetic (see the UTC note). Add one back the day a page needs it.

### Values for `ms-form-pause-date`

| Value | Source | Notes |
| --- | --- | --- |
| `signup` | `member.createdAt` | The signup date, **not** the subscription start. A member who joined free in January and upgraded in June still reads January |
| `next-billing` | `payment.nextBillingDate` | End of the current period; the paid-through date |
| `resumes-at` | anchor + pause length | The date billing restarts. Anchor from `ms-form-pause-anchor`, length from `ms-form-pause-input` or `ms-form-pause-months` |

Only `signup` resolves for a free-plan member: Memberstack sends `payment: null`
there, so `next-billing` renders the empty text, and `resumes-at` does too unless
its anchor is `signup`.

Every field name here is confirmed against Memberstack's published response
example, which lists `amount`, `currency`, `status`, `lastBillingDate`, and
`nextBillingDate` on `payment`, plus `createdAt` on the member. Keep it that way.
An earlier revision shipped a `cancel-at` field reading `payment.cancelAtDate` — a
key absent from that example, so it could only ever have rendered the empty text.
A `last-billing` field also shipped unused. Verify a key exists on a real member
before adding a field for it.

### Choosing what `resumes-at` counts from

```html
<!-- default: the paid-through date -->
<span ms-form-pause-date="resumes-at">—</span>

<!-- a month from when they joined -->
<span ms-form-pause-date="resumes-at" ms-form-pause-anchor="signup">—</span>
```

`next-billing` is the default because a member pausing on the 20th of a cycle that
renews on the 1st would otherwise ride unpaid days or be charged mid-pause — the
paid-through date is the end of the period they already bought, which is what
Stripe's `pause_collection.resumes_at` means.

That default is a recommendation, not a restriction. `signup` answers a different
and legitimate question, and it is the **only** anchor that resolves for a member
with no paid connection. An earlier revision hardcoded the next-billing anchor and
left no way to express signup + N at all; the default was right, its shape was not.

A three-month pause block, configured once on the wrapper:

```html
<div ms-form-pause-months="3">
  <p>Paused from <span ms-form-pause-date="next-billing">—</span></p>
  <p>Billing resumes <span ms-form-pause-date="resumes-at">—</span></p>
</div>
```

### Letting the member pick the pause length

Mark the radio group with `ms-form-pause-input` — on the wrapper once, or on
each input — and `resumes-at` re-renders on every change:

```html
<div ms-form-pause-input>
  <label class="w-radio"><input type="radio" name="pause" value="1 month"> 1 month</label>
  <label class="w-radio"><input type="radio" name="pause" value="2 months"> 2 months</label>
  <label class="w-radio"><input type="radio" name="pause" value="3 months"> 3 months</label>
</div>
<p>Billing resumes <span ms-form-pause-date="resumes-at">—</span></p>
```

The value is parsed for its first integer, so `2` and `2 months` both mean two.
Set whichever reads better in the Designer; neither spelling silently strands the
member on the default. Radios, checkboxes, `<select>`, and a plain number input
all work.

An **unchecked** radio expresses nothing and is skipped. Reading its value anyway
is how a three-option group ends up reporting whichever option sits first in the
DOM rather than the one the member picked.

Sources resolve nearest-first: a marked control in the closest ancestor that has
one (the wrapper counts as its own scope), then the document, then the inherited
static `ms-form-pause-months`, then one month. Walking up before reading the
document is what lets two independent pause groups coexist on one page — each
output reads the group it is nested inside. With nothing checked yet the static
attribute or the default still renders, so the page never shows a blank or broken
date before the member touches the form.

The change listener is delegated on `document`, so a group inside a Webflow
component or a tab pane that is not in the DOM at load still works, and a radio
click costs **no** Memberstack round trip — the member has not changed, only the
arithmetic.

An **unanswered** group owns its own answer. If a page has two pause blocks and
only one has been touched, the untouched block falls back to its static attribute
or the default — it does not borrow the other group's checked option. This is the
reason resolution stops at the nearest enclosing group rather than continuing to
a common ancestor.

### Hiding the whole sentence until the member chooses

Wrap the paragraph — copy and inline date together — in `ms-form-pause-reveal`,
and paste the paired CSS once anywhere on the page:

```html
<style>
  [ms-form-pause-reveal]:not(.is-ms-form-pause-shown) { display: none !important; }
</style>

<div ms-form-pause-reveal>
  <p>Your membership pauses and billing resumes
     <span ms-form-pause-date="resumes-at">—</span>.</p>
</div>
```

The wrapper reveals only when **both** hold:

1. a marked control has expressed a pause length (the member chose), and
2. every date element inside the wrapper resolved to a real date.

Condition 2 is the point of wrapping a sentence rather than just the date. A
logged-out visitor, a free-plan member, or a failed lookup renders `—`, and
"Billing resumes —" is exactly the state the wrapper exists to prevent. A wrapper
containing no date element at all rests on condition 1 alone.

Note that "has not chosen yet" and "chose one month" both compute a one-month
pause, so the reveal test reads the **source** of the answer, not its value. A
static `ms-form-pause-months` does **not** count as the member choosing — it is a
fallback so the date is never blank, not a selection.

The block hides again if the member logs out, and each wrapper is governed by the
group it is nested inside.

**Why a class plus a CSS rule and not an inline style.** The rule hides the block
from the very first paint, so nothing flashes before this deferred script runs,
and revealing does not have to guess whether the Designer set the block to
`block`, `flex`, or `grid` the way restoring an inline `display` would. If the
script never loads the block stays hidden, which is the right outcome for a
sentence whose only content is a date it cannot fill.

**Do not swap the rule for the `hidden` attribute.** A Webflow class carrying
`display: flex` beats the user-agent `[hidden]` rule and the block stays visible —
the same trap documented for the favorite hearts in [`../v3/README.md`](../v3/README.md).

Install it in Page Settings -> Custom Code -> Footer, **after** the Memberstack
script:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/account-settings/plan-dates.js"></script>
```

`@latest` is the default the repo README asks for, so a later release reaches the
page without another Webflow edit. Remember `@latest` resolves to the newest
**tag**, not the newest commit — a merge without a tag keeps serving the previous
release.

Pin a specific `@vX.Y.Z` instead only when this page must not move on its own, and
accept the trade: every fix then needs a Webflow edit as well as a tag. This
module ships as `@release v1.59.90` (see the header comment and the exported
`release` property, which a test asserts match). **Do not paste a pinned URL
naming a tag that does not exist yet** — pin after the tag is cut, and verify with:

```sh
curl -fsS -o /dev/null -w '%{http_code}\n' \
  "https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.90/account-settings/plan-dates.js"
```

**This module does not pause anything.** It only reads and prints. Pausing a
subscription needs the Stripe secret key, so it cannot happen in the browser — it
belongs behind a Xano endpoint that calls Stripe `pause_collection` with
`resumes_at`. Installing this script before that endpoint exists is safe; the
dates simply render.

Dates format in UTC, and that is **not** configurable. Memberstack returns billing
dates as instants, and rendering an instant in the viewer's local zone moves the
calendar day for everyone west of UTC — a member in Los Angeles would read a
renewal one day before the one they are billed on.

A per-block `ms-form-pause-tz` override existed and was removed rather than fixed,
because month arithmetic runs on UTC calendar fields and the override made the two
fields disagree: `nextBillingDate` of `2026-03-01T00:00:00Z` in
`America/Los_Angeles` printed `next-billing` as **Feb 28, 2026** beside a one-month
`resumes-at` of **Mar 31, 2026** — 31 days shown for a one-month choice. If a fixed
business zone is ever genuinely needed, the arithmetic has to move into that zone
in the same change. Do not reintroduce the attribute on its own.

Month arithmetic clamps the day: Jan 31 plus one month is Feb 28, Feb 29 in a
leap year, and Aug 31 plus one month is Sep 30. Plain `setMonth` overflows Jan 31
into Mar 3, so do not swap it back in. Note that a clamped month is not a fixed
number of days — Aug 20 to Sep 20 is 31 days, Feb 1 to Mar 1 is 28.

Timestamps are unit-sniffed rather than assumed. `createdAt` arrives as an ISO
string while the `payment.*` dates arrive as numbers, and Memberstack is not
consistent about seconds versus milliseconds, so `toDate()` accepts `Date`, ISO
string, Unix seconds, and Unix milliseconds, splitting at `1e10`. A seconds value
passed straight to `new Date()` renders in January 1970.

The plan connection is auto-picked as the first **active** connection that
carries a `payment` object, then any active connection. A member can hold both a
free and a paid connection (see `navbar-embeds/memberstack/free-paid-anon.js`)
and only the paid one has billing dates, so "first connection" is never safe.

Fail-quiet everywhere. A logged-out visitor, a free-only member, a `payment:
null` connection, a failed `getCurrentMember`, or Memberstack never appearing all
render the `ms-form-pause-empty` text — never a stale date and never
`Invalid Date`. A page with no `[ms-form-pause-date]` element never calls
Memberstack at all.

Diagnostics follow the repo-wide
[staging-only console diagnostics](../README.md#staging-only-console-diagnostics)
gate; production stays silent. What warns: an unknown
`ms-form-pause-date` value, an unknown `ms-form-pause-anchor`, a non-numeric
`ms-form-pause-months`, a **selected** pause control with no month count in its
value or its label, a failed `getCurrentMember`, and Memberstack never appearing.

Deliberately silent: a member with no paid connection, and a group with nothing
checked yet. Both are ordinary states, not authoring mistakes.

### `window.StartersPlanDates`

Every exported key, for staging console checks. An earlier revision exported 27
keys while documenting 8; if you add one, document it in the same commit.

| Key | Use |
| --- | --- |
| `release` | The tag this file ships in; matches the `@release` header |
| `diagnosticsEnabled()` | Whether this host warns |
| `toDate(v)` | Normalize Date / ISO / Unix seconds / Unix ms |
| `formatDate(v)` | `"Jan 10, 2000"`, always UTC |
| `addMonths(v, n)` | Day-clamping month arithmetic |
| `parseMonths(raw)` | First integer in a value, or `null` |
| `pickConnection(member)` | The connection dates are read from |
| `resolveField(member, field, opts)` | One raw date; `opts` takes `pauseMonths` and `anchor` |
| `resolvePause(el)` | `{months, fromControl}` for an element |
| `renderElement(el, member)` | Render one element; returns its text |
| `renderAll(member)` | Render the page |
| `rerender()` | Re-render against the member already resolved |
| `shouldReveal(wrapper, resolved)` | Reveal decision for one wrapper |
| `applyReveal(resolved)` | Toggle every reveal wrapper |
| `fields` | `['signup', 'next-billing', 'resumes-at']` |
| `anchors` | `['next-billing', 'signup']` |

Run its focused test with:

```sh
node --test account-settings/plan-dates.test.js
```

### One attribute prefix for this folder

Every script here speaks the `ms-form-*` dialect — `ms-form-pause-*` for plan dates,
`ms-form-cancel-state-*` for the cancel success state. Match it if a third arrives;
the repo rule is to reuse the owning vocabulary rather than invent a parallel one.

## Cancel-flow success state

`ms-form-cancel-state.js` shows one success message out of several, picked by the
reason button the member clicked. It exists because the cancel flow branches — a
member who pauses, a member whose needs changed, and a member who just cancels should
not all read the same confirmation — while Webflow gives a form exactly one success
div.

Tag the Form Block, the buttons, and the messages:

```html
<div ms-form-cancel-state data-form-flow="cancel-membership" class="w-form">
  <form>
    <div data-form-flow-action="branch" data-form-flow-target="step-4a"
         data-button-theme="black" data-button-style="primary"
         ms-form-cancel-state-element="button"
         ms-form-cancel-state-change="needs"
         class="button_main-wrap">
      <div class="clickable_wrap"><button type="button" class="clickable_btn"></button></div>
      <div class="button_main-element"><div class="button_main-text">My needs changed</div></div>
    </div>
  </form>

  <div class="w-form-done">
    <div ms-form-cancel-state-element="success-wrapper">
      <div ms-form-cancel-state-element="success-item" ms-form-cancel-state-key="default">…</div>
      <div ms-form-cancel-state-element="success-item" ms-form-cancel-state-key="pause">…</div>
      <div ms-form-cancel-state-element="success-item" ms-form-cancel-state-key="needs">…</div>
    </div>
  </div>
</div>
```

### Every attribute

| Attribute | Goes on | Required | What it does |
| --- | --- | --- | --- |
| `ms-form-cancel-state` | The Form Block (`.w-form`) | **Yes** | Marks one instance and scopes everything inside it. Its VALUE is free — `ms-form-cancel-state="cancel-form"` is just a label; the opening state is always `default` |
| `ms-form-cancel-state-element` | Buttons, the success wrapper, the items | **Yes** | The role: `button`, `success-wrapper`, or `success-item` |
| `ms-form-cancel-state-change` | The `.button_main-wrap` wrapper | **Yes** | The state KEY this button switches to. Must match a `ms-form-cancel-state-key`. Never the element role — see the swap note below |
| `ms-form-cancel-state-key` | Each success item | **Yes** | Which state shows this item. `default` is what shows before anyone clicks |

Written back, for CSS and QA: `ms-form-cancel-state-current` on the root (the live
state) and `aria-hidden` on every item. `ms-form-cancel-state-inited` marks a root
that has had its first paint.

### The root goes on the Form Block, not the `<form>`

Webflow emits `.w-form-done` as a **sibling** of the `<form>`, inside the `.w-form`
Form Block, so a root tagged on the form cannot see its own success items. Tag the
block.

Ownership is strict: an element counts only when its **nearest**
`[ms-form-cancel-state]` ancestor is that root. That is what stops two cancel forms on
one page — or a nested pair — from reading or repainting each other. A root that
contains no success items warns on staging rather than widening its search; an earlier
draft fell back to the enclosing `.w-form`, which both coupled behavior to a styling
class and could let a root adopt items belonging to no root in an outer block.

### A trigger needs both attributes

`ms-form-cancel-state-element="button"` **and** `ms-form-cancel-state-change="<key>"`.
Either one alone does nothing and says so on staging, so a half-tagged button is a
loud mistake rather than a silent one.

`-change` holds the state key and never the element role. A value of `button`,
`success-wrapper`, or `success-item` means the two attributes got swapped — the
likeliest way to author this wrong — and such a click is **inert**: it does not become
a state named "button" and it repaints nothing.

### The button is Webflow's `.button_main-wrap` component

Both attributes go on the **wrapper**, the same element `data-form-flow-action` and
`data-validate-element` already sit on. The click actually lands on the overlaid
`.clickable_btn`, or on `.button_main-text`, never on the wrapper — the trigger is
resolved by walking up from whatever was clicked. The inner `type` does not matter:
branch buttons are `type="button"`, the final Confirm is `type="submit"`, and both work
because the click is never intercepted.

A button the flow has **gated** never changes state. step-flow disables that same
wrapper by attribute (`data-button-theme="disabled"`, `data-form-flow-disabled`,
`aria-disabled="true"`) rather than by the native `disabled` property, so a gated
Continue still *receives* the click and is only `preventDefault()`-ed. This script
checks those markers from the trigger up to the root — never past it — and stands
down, so the success message cannot move for a step the member never completed.

Nothing is inferred from labels or button styles the way step-flow does, so a tab
control or lookalike footer button is never hijacked.

### How it behaves

The key is the entire contract: `-change="needs"` shows every item keyed `needs` and
hides the rest, matched by value and never by DOM order or position. Keys are compared
trimmed and case-sensitively. **Every** matching item shows, not the first, so a
heading and a card can share one key. `default` is reachable as a key like any other,
which is how a "Keep my membership" or reset button returns the block to its opening
message.

A key with **no** item shows nothing and warns on staging. The contract is that only
the matching item shows, so a mistyped key is an authoring bug to surface, not
something to paper over with a different message. `-current` still reports the key that
was clicked.

The switch happens at click time, not on submit. The success div is in the DOM from
page load — just hidden — so the right item is revealed before Webflow ever shows the
block: no listener to wire, no race with the AJAX submit, and a member who changes
their mind repaints immediately. The authored `display` is read **before** anything is
hidden and restored on show, so `flex`, `grid`, and `display: contents` all survive; an
item hidden in the Designer computes to `none`, which nothing can be restored to, and
falls back to `block`.

State is **not persisted**. It survives Webflow's AJAX submit, which reveals the
success div without a reload, but not a redirect or a page reload.

### Why this is a page script and not a step-flow capability

The repo's rule is to extend an established library when a capability will be reused,
and to keep a one-off here only when the behavior is genuinely page-specific. This one
is:

- **step-flow never touches the success div.** It manages steps inside the form,
  pre-submit; this manages content inside `.w-form-done`, post-submit.
- **step-flow deliberately resets its state.** `resetFlow()` runs at init, on
  `data-form-flow-action="reset"`, and on every panel-nav reopen, because its model is
  "which step is visible now". This state has to outlive the submit, so living there
  would mean bolting a reset-exempt second state concept onto an engine built on the
  opposite assumption.
- **step-flow also ships to `/generate-contract`**, which has no success messages to
  switch, so the blast radius of adding this there is a page that cannot use it.

The display cache-and-restore below is deliberately the minimum version of
step-flow's — no display-override attribute, no valid-display whitelist.

### Diagnostics and API

Diagnostics follow the repo-wide
[staging-only console diagnostics](../README.md#staging-only-console-diagnostics)
gate; production stays silent. They fire once per element,
on the mistakes that are otherwise invisible: a key with no item, a root with no items,
a half-tagged or swapped trigger, a button outside every root.

`window.StartersMsFormCancelState` exposes `get`, `set`, and `refresh`, plus
`stagingHost` and `diagnosticsEnabled`, for console checks on staging.

Run its focused test with:

```sh
node --test account-settings/ms-form-cancel-state.test.js
```
