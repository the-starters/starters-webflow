# Account Settings

Browser scripts for the logged-in member's own account and billing pages — plan
state, billing dates, pause and cancel flows. Everything here reads the Memberstack
member in the browser, or the page's own markup, and renders into Designer-authored
elements through a custom attribute contract. None of it holds a secret or performs a
billing mutation; that stays behind Xano.

Scripts in this folder share the `ms-form-*` attribute dialect so the page reads as
one vocabulary.

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

Diagnostics warn on staging, localhost, and Cloudflare tunnel hosts, or with
`window.STARTERS_DEBUG === true`; production stays silent. They fire once per element,
on the mistakes that are otherwise invisible: a key with no item, a root with no items,
a half-tagged or swapped trigger, a button outside every root.

`window.StartersMsFormCancelState` exposes `get`, `set`, and `refresh`, plus
`stagingHost` and `diagnosticsEnabled`, for console checks on staging.

Run its focused test with:

```sh
node --test account-settings/ms-form-cancel-state.test.js
```
