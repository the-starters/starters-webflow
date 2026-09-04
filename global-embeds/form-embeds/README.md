# Form embeds

Browser scripts and styles for Webflow forms, published for reuse across pages.
Most of this folder is small attribute-driven behaviour whose authoritative page
lives on the [embeds documentation site](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds),
and each of those files carries its own `// Docs:` URL on the first line.

[`turnstile-contents-fix.js`](turnstile-contents-fix.js) is the exception. It has
no docs-site page because it is not a component anyone authors against: it
repairs a Webflow bot-protection bug on a specific shape of form, reaching into
Webflow's own private form state to do it. That contract is documented here.

The header block in [`turnstile-contents-fix.js`](turnstile-contents-fix.js) is
**authoritative**. This document explains the model behind it; where the two ever
disagree, the header wins.

[`memberstack-loader/memberstack-loader.js`](memberstack-loader/memberstack-loader.js)
is the second exception. It has no docs-site page yet, so its contract lives in
its own header block and in the inventory entry in the [root README](../../README.md).
That header block is **authoritative**; where the root README entry and the
header ever disagree, the header wins.

## Turnstile arming for `display: contents` forms

Webflow "bot protection" (Cloudflare Turnstile) is on site-wide, so the published
forms runtime does this to every `form[data-turnstile-sitekey]`:

1. disables every `input`/`button[type="submit"]` in the form, and adds
   `w-form-loading` to those buttons and to the closest `.w-form` wrapper;
2. injects `https://challenges.cloudflare.com/turnstile/v0/api.js` on
   `requestIdleCallback`;
3. creates an `IntersectionObserver` (`rootMargin: 200px`) **observing the form
   element**, and renders an invisible widget into a div appended inside the form
   only once `isIntersecting` is true;
4. in the widget callback, stores the token on Webflow's own state object
   (`jQuery.data(form, '.w-form').turnstileToken`), re-enables the buttons
   (`disabled = !!(sitekey && !turnstileToken)`) and clears `w-form-loading`.

Memberstack forms (`form[data-ms-form]`) are armed like every other form, but
they submit through Memberstack instead of Webflow, so the token is never used.
The global stylesheet embed [`global-embeds/global.css`](../global.css) hides the
appended Turnstile wrapper on those forms (search that file for
`cf-turnstile-response`), because it otherwise counts as an extra flex item under
the signup modal and account settings forms. That stylesheet is a body embed
pasted into Webflow rather than a CDN script, so the live copy is edited by hand.

## CTA disabled-state ownership marks

More than one script can disable the same `[ms-code-submit-button]` CTA, so
[`password-validation/password-validation.js`](password-validation/password-validation.js)
marks its own writes: `data-password-validation-aria` wherever it sets
`aria-disabled="true"`, and `data-password-validation-native` wherever it sets a
native control's `disabled`. Both land on the marker root, the theme element and
every control under the marker, at runtime only. Never author either attribute in
Webflow, and never write them from another script: the CTA gate clears only the
state carrying its own mark, so a mark written by anyone else lets it erase a
refusal it does not own. Scripts that hold the same CTA should keep announcing
themselves with `data-form-flow-disabled` / `data-validate-disabled`, which the
gate reads as a refusal it must leave alone.

[`memberstack-loader/memberstack-loader.js`](memberstack-loader/memberstack-loader.js)
marks its own writes the same way, with `data-memberstack-loader-theme`,
`data-memberstack-loader-busy` and `data-memberstack-loader-aria`. They are
written at runtime only, so never author them in Webflow either. The loader
lifts only what carries one of its own marks, which is what lets
password-validation's hold and the loader's Pending state share one CTA
without either script undoing the other. The theme is the exception: it is
always overwritten while Pending, and an authored value is parked on the wrap
and put back on hide, so a wrap that had no theme ends up with none.

A form carrying Webflow's `display-contents` class **generates no box**, so its
`getBoundingClientRect()` is `0 × 0` and the observer never reports it as
intersecting — not on load, not on scroll, not when the modal holding it opens.
Step 3 never happens, so step 4 never happens, and Webflow's runtime is not
waiting for anything it will ever get.

**It is worse than a dead button.** The site's `wf-validate` re-enables the final
step's submit once the fields validate, so the member *can* click it. The token
travels to `https://webflow.com/api/v1/form/<siteId>` **only** as the hidden
`cf-turnstile-response` input the widget injects inside the form — Webflow never
copies `turnstileToken` into the payload — so the POST arrives tokenless, the API
rejects it, and what the member sees is Webflow's generic *"Oops! Something went
wrong while submitting the form."*

This script performs Webflow's step 3 for exactly the forms where it cannot, then
performs step 4 itself against Webflow's live state object. It adds two things
Webflow does not do: a [submit guard](#the-submit-guard) that holds a tokenless
submit until the token lands, and a reset after every submit so a retry can never
send a spent token.

### Why the widget goes inside the form, in a hidden div

| Decision | Reason |
| --- | --- |
| **Inside** the form | The payload carries the token only as that injected `cf-turnstile-response` field, and Webflow collects fields with `form.find(':input…')`. A widget rendered anywhere else is invisible to the POST no matter how good the token is. |
| **Hidden** (`display: none`) | Turnstile renders and delivers a token perfectly well inside a `display: none` container (measured: token in ~2 s). That is what lets a form sitting in a closed modal panel be armed at page load rather than at open time. |
| The form's own `display` is **never touched** | Setting these forms to `block` visually destroys the modal — leaked fields, misplaced buttons — and it would be a styling fix for a measurement bug. |

The token is written to `jQuery.data(form, '.w-form').turnstileToken`. That is the
**single jQuery call in the file**: the value has to land where Webflow's own
closures read it, and that store is jQuery's data cache keyed `.w-form`, which is
not reachable from the element any other way. A test pins that jQuery is used for
nothing else. Arming also clears `w-form-loading` from the submit buttons and the
`.w-form` wrapper, exactly as Webflow's own step 4 would.

If the state object is missing (no usable jQuery), the form is armed anyway and
the token is read from the widget's own field instead, with a staging warning.
Where the state object exists it is the **only** source that counts, *including
when it is empty*: a reset clears it deliberately, and falling back to the DOM
input at that moment would read the spent token still sitting there and wave a
doomed submit through.

### Opt-in only

A form is a candidate solely because its owning component marked the `<form>`
with `data-starters-turnstile-fix`, either in the Designer or in its controller
before this script scans the page. **Presence is the whole contract** — any value,
including empty, means the same thing, so there is nothing to spell wrong in a
value. There is no detection and no heuristic: an unmarked form is invisible to
this script even when it is a textbook case of the bug.

That is the point. This script reaches into another library's private state and
appends a node inside a form it does not own; the blast radius of getting that
wrong on an unrelated form is a broken submit on a page nobody was testing. An
explicit marker makes every armed form a decision someone made on purpose, and it
means dropping the script site-wide can never change the behaviour of a form that
was already working. An earlier revision armed every `display: contents` form it
found; the marker replaced that.

### The safety rails sit on top of the marker

The marker says "you may", not "you must". A marked form is still skipped unless
every rail below passes, and **each rail failure on a marked form warns by form
name on staging** — someone deliberately asked for arming and did not get it, so
silence would leave an author staring at a disabled button with nothing to go on.
An unmarked form is never mentioned at all. Warnings are once per form for the
life of the page, so a re-scan cannot fill the console with the same complaint.

| Rail | Skipped when | Why |
| --- | --- | --- |
| `data-wf-no-turnstile` absent | The form also carries the opt-out | The two attributes contradict each other; the opt-out turns Webflow bot protection off for that form, so there is nothing to arm. |
| `data-turnstile-sitekey` non-empty | No sitekey value | Bot protection is not on for this form at all. |
| Computed display is `contents` | The form has a real box (`flex`, `block`, …) | **The no-double-arm invariant.** |
| Not already armed | `data-starters-turnstile-armed="true"` | A re-scan must not arm the same form twice. |

**The no-double-arm invariant** is the load-bearing one. A form with a real
layout box is armed by Webflow itself as soon as it scrolls or is revealed within
200px of the viewport — including inside a closed modal — so arming it too would
put two widgets and two `cf-turnstile-response` inputs in one payload and race
their tokens. A marked form with a real display is therefore skipped *and warned
about*, with the warning naming the computed display and telling the author to
remove the marker: the marker on it is a mistake worth seeing rather than
something to obey.

Immediately before rendering, each surviving form is re-checked once more. One
that already contains a widget — our own host div, a `cf-chl-widget-*` element, a
`cf-turnstile-response` field, or a Cloudflare challenge iframe — or whose
`.w-form` wrapper no longer carries `w-form-loading`, is left alone and marked
`data-starters-turnstile-armed="skipped"`. Three independent widget signals are
checked because they appear at different moments; checking the response field
alone would call a rendered-but-unsolved widget "absent" and render a second one
on top of it.

**Ordering note.** The wait for `window.turnstile` (polled, 20s budget) is what
makes that re-check trustworthy. Webflow's forms module is what injects `api.js`
in the first place, so by the time `turnstile.render` exists that module has
certainly finished initialising every form on the page. Polling rather than
listening covers booting either before or after `api.js` loads, without depending
on Webflow's private `TURNSTILE_LOADED` jQuery event.

### The submit guard

A capture-phase `submit` listener on the form, so it runs before Webflow's
delegated handler on `document` and `stopImmediatePropagation()` can actually
stop it.

| Token state at submit | Behaviour |
| --- | --- |
| Present | Let the submit through untouched, then `turnstile.reset()` on the next task. Webflow builds its whole payload synchronously inside its handler, so by then the token is already in the POST body and the widget is free to fetch the next one. |
| Absent | Hold the event (`preventDefault` + `stopImmediatePropagation`), show the buttons as working, and re-submit as soon as the token lands. If it never does, give the buttons back — submitting tokenless would only reproduce the "Oops" this script exists to remove. |

The waiting state is written in the two vocabularies this site already has:
Webflow's `data-wait` label swap, applied **only to `input[type="submit"]`** where
the attribute value really is the visible label, and the site's
`[data-opp-element="loading-button"]` / `data-opp-loading="true"` spinner
contract, which is what the account-settings buttons actually use — their
`<button type="submit">` is an empty overlay whose label is a sibling div, so
there is no text to swap.

Three details in that hold exist because the obvious version was wrong:

- **The hold budget is wall clock (10s), not a tick count.** A background or
  throttled tab clamps `setInterval` to roughly 1/s, which would silently stretch
  10s into ~100s and leave a member staring at a spinner on a form they never
  left.
- **Ending a hold restores a per-button snapshot, never a blanket enable.** These
  forms carry one submit button per branch tail, and the tails the member did not
  click are disabled on purpose by `wf-validate` and the flow logic. A second
  click during a hold does not re-snapshot, or the borrowed disabled state would
  become the state handed back.
- **The replay uses `requestSubmit()`** because that is the call that runs native
  constraint validation and fires a real, cancelable submit event. The synthetic
  `dispatchEvent` fallback is for a browser without it, and for an original event
  that was itself synthetic — a script-dispatched submit bypasses validation, so
  re-running validation could refuse a submit the page had already accepted.

### Resets, because tokens are single-use

Turnstile tokens are single-use: a second submit carrying the first token is
rejected exactly like a submit carrying none. Webflow's completion handler leaves
the spent token in place and re-enables the button, so the "it failed, let me try
again" path members actually take would send the same token twice and read as
"Oops" all over again. Hence a `turnstile.reset()` after every submit.

A reset clears the token **first**, which is what makes the guard hold anything
clicked before the replacement lands instead of spending it. The widget callback
always overwrites rather than filling in only the first time, because it also
fires on Turnstile's own refresh of an expiring token.

**The outcome belt.** Webflow's completion handler flips its `.w-form-done` /
`.w-form-fail` siblings with jQuery `.toggle()`, i.e. an inline `display` write.
A `MutationObserver` on those two elements' `style` and `class` is therefore the
one signal that a submit attempt has come back — including an attempt this script
never saw as an event. It resets only when nothing is already pending, so the
normal post-submit path costs no second challenge.

**On a widget error** the token is cleared and the buttons are disabled,
mirroring Webflow's own error posture: no token means the form must not be
submittable, and a disabled button is the honest version of the answer the guard
would give anyway. A widget error is usually transient, so the challenge is
retried up to twice at 2s intervals before the form is left in that posture.

### Attribute grammar

Set by the owning component in the Designer or at runtime, on the `<form>` element:

| Attribute | Meaning |
| --- | --- |
| `data-starters-turnstile-fix` | Arm this form. Presence is the whole contract — any value, including empty, means the same thing. |

Written at runtime, **never by hand**:

| Attribute | On | Meaning |
| --- | --- | --- |
| `data-starters-turnstile-armed="true"` | the `<form>` | This script armed it |
| `data-starters-turnstile-armed="skipped"` | the `<form>` | Marked, but deliberately left to Webflow |
| `data-starters-turnstile-host` | the hidden widget div | The container the widget was rendered into |

Read but not written: `data-turnstile-sitekey` and `data-wf-no-turnstile`, both
Webflow's own.

### Install and diagnostics

Page or Project Settings → Custom Code → Footer Code (or Head with `defer`), one
tag. **Safe to install site-wide** — the account-settings modal ships on ~374 of
the published pages, and on a page with no marked form the script does nothing at
all. It has no dependencies of its own and is safe to load twice (an init guard
on `window.__startersTurnstileContentsFixBooted`); it needs Webflow's own jQuery
only to read `jQuery.data(form, '.w-form')`.

Diagnostics are console-only and use the repo-wide
[staging-only console diagnostics](../../README.md#staging-only-console-diagnostics)
gate, which owns the host predicate and the anchoring rules.
**Production is silent**, including about a mismarked form.

`window.StartersTurnstileContentsFix` exposes three calls for console checks on
staging:

| Call | Does |
| --- | --- |
| `status()` | Per-armed-form state: form label, widget id, token count, token and field fingerprints, whether a reset is pending, whether a submit is being held, whether the Webflow state object was found |
| `refresh()` | Re-scan and arm any newly eligible form; returns how many were armed. Warns and arms nothing if `window.turnstile` does not exist yet |
| `reset(name)` | Force a fresh challenge on the named form, or on all armed forms when called with no name; returns how many were reset |

It also carries `release`, `stagingHost` and `diagnosticsEnabled`, which exist for
the test harness rather than for console use.

### Tests

[`turnstile-contents-fix.test.js`](turnstile-contents-fix.test.js) evaluates the
source in a `vm` sandbox against a hand-built minimal DOM — only the surface the
module actually touches. The browser half is verified against the real Webflow
page, which is the only place `jQuery.data(form, '.w-form')` and
`turnstile.render` exist at all.

Two harness rules are deliberate:

- **The mini DOM throws on any unexpected document selector.** The selection
  selector is the whole opt-in contract, so a targeting regression must fail
  loudly rather than quietly match no forms and pass.
- **The fake clock advances with the fake ticks**, because the module measures
  its budgets against the wall clock and nothing would ever time out otherwise.
  One test models a throttled tab at 1 tick/second to prove it.

The test also pins the `@release` marker in the file header against the exposed
`release` property, so the two cannot drift apart.

## The rest of the folder

Attribute-driven form components, each with its own `// Docs:` URL and an
authoritative page on the docs site. These summarize the behaviour only; the
full inventory is in the root [`README.md`](../../README.md).

| Script | Behaviour |
| --- | --- |
| [`form-validation/form-validation.js`](form-validation/form-validation.js) | The form-embeds validation component ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/form-validation)). Distinct from `utils/wf-validate.js`, which owns the `wf-validate-*` dialect used by the Opportunities forms |
| [`form-validation/email-validation.js`](form-validation/email-validation.js) | Email-specific validation rules ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/form-validation/email-validation)) |
| [`disabler.js`](disabler.js) | Soft-disables submit controls until a form is complete ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/disabler)) |
| [`datepicker/datepicker.js`](datepicker/datepicker.js) | Date-input picker ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/datepicker)) |
| [`timepicker/timepicker.js`](timepicker/timepicker.js) | Time-input picker ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/timepicker)) |
| [`checkbox-toggle/checkbox-toggle.js`](checkbox-toggle/checkbox-toggle.js) | Checkbox-driven visibility toggling ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/checkbox-toggle)) |
| [`password-toggle/password-toggle.js`](password-toggle/password-toggle.js) | Show/hide password control ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/password-toggle)) |
| [`password-validation/password-validation.js`](password-validation/password-validation.js) | Password-requirements checklist and whole-form CTA gating (password rules + terms + plausible email when present); disables the full `[ms-code-submit-button]` control set including Memberstack's `.clickable_btn` overlay, bridges an enabled non-submitting overlay click into a cancelable synthetic submit (never a native submission); that bridge runs on every `form[data-ms-form]` carrying the marker whether or not a checklist is present, so the script must stay loaded site-wide wherever Memberstack forms use the Button component, and on signup forms and on checklist-gated forms of any kind, paints post-submit Memberstack/Turnstile rejections onto the form's `.w-form-fail` block; on a Memberstack auth form (login, signup, forgot-password, reset-password) carrying the marker the CTA is gated even with no checklist present, on the fields that form actually has (a non-empty password, a plausible email, a checked terms box), while profile and security forms never get that gate, though a checklist wrapper on one still gates it on its rules; rule set configured per instance via `starters-password-validation-*` wrapper attributes, and a misconfigured checklist fails open, enforcing no rules, while an auth form's required-fields gate still applies ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/password-validation)) |
| [`memberstack-loader/memberstack-loader.js`](memberstack-loader/memberstack-loader.js) | Gives a Memberstack auth form's Button the Pending look (grey theme, `aria-busy`, `aria-disabled`) for as long as Memberstack shows its `data-ms-loader` spinner, then puts the button back on hide. Spinner routing covers every Memberstack form, auth and profile alike, so the submitting form's own Button Spinner is the one that turns: a page that authors the attribute keeps it in place and has its show and hide mirrored onto that Spinner, and a page that authors none gets the attribute placed on that Spinner at submit time. A double-submit guard stops repeat submits while the button is pending, and on staging the script reports an auth form with no Button Spinner once per such form, and a duplicated or stray `data-ms-loader` once per page |
| [`form-input-filter/form-input-filter.js`](form-input-filter/form-input-filter.js) | Input filtering and normalization ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/form-input-filter)) |
| [`input-preview.js`](input-preview.js) | Echoes an input's value into a preview element ([docs](https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/input-preview)) |

Companion stylesheets sit beside their scripts, plus a folder-level
[`form.css`](form.css). Unlike the other embeds in [`global-embeds/`](../README.md),
nothing here is documented per-file in this folder except the Turnstile fix above.
The Memberstack loader is documented in its own header block and in the root
README rather than here.
