# Starter Edit Profile browser controllers

The native `/starter-edit-profile` form, fields, and success/error elements stay authored in Webflow. This directory owns the published-form contract and the page-specific portfolio and company controllers. It reuses the reviewed profile-photo and work-date assets from `v3/build-profile/`.

The remaining inline Starter Edit Profile bodies now also have GitHub-owned extraction candidates.
The authoritative ownership, provenance, atomic page-Head-Code cutover, loader-order, and verification
contract lives in [`../profile-form/README.md`](../profile-form/README.md). This repository change
does not install or publish those candidates.

## In-place loader replacements

Replace only an exact live inline body whose index and SHA-256 match the captured `page.scripts` records in `live-body-provenance.json`. The separate `candidateAssets` records identify the instrumented GitHub files. Keep each replacement in its existing Code Embed position.

| Live index | GitHub asset | Responsibility |
| --- | --- | --- |
| 84 | `v3/build-profile/profile-photo.js` | Authenticated profile-photo upload |
| 87 | `v3/starter-edit-profile/portfolio-crud.js` | Edit-profile portfolio create, edit, delete, media, and previews |
| 88 | `v3/starter-edit-profile/portfolio-list.js` | Edit-profile portfolio list read and render |
| 89 | `v3/starter-edit-profile/company-autocomplete.js` | Edit-profile company and logo autocomplete |
| 90 | `v3/starter-edit-profile/company-experience-crud.js` | Edit-profile company-experience CRUD |
| 91 | `v3/build-profile/work-dates.js` | Work-date validation and current-role state |

Work Highlight updates are approved and live immediately. After an update
succeeds, the portfolio controller replaces the shared generic message with
`Your changes were saved and are now live.`, then restores the shared modal copy
when it closes. Keep the pending and rejected status-badge rendering until the
legacy rows with those statuses have been backfilled.

### Work Highlight cover image

A Work Highlight has exactly one cover. Whenever the editor loads its images —
from the stored record or from a pending local draft — the controller normalizes
the set so a single image carries `is_cover`: the first stored cover wins, and
when the record carries none the first image becomes the cover. Removing the
cover promotes the first remaining image. An empty set is left alone.

The update payload therefore names one authoritative cover. `cover_image_id` is
the ID of the cover among the images Xano already stores, or `null` when the
chosen cover is a not-yet-uploaded local image, and `thumbnail_url` is that
cover's URL. Xano stays canonical for which image is the cover, and the live
hire-page projection reads it from there.

### Work Highlight modal lifecycle

While the edit modal is visible, it retains the selected Work Highlight and its
existing image and video previews. A document-level `Escape` closes only the
remove and notification modals; it must not close or reset the editor because an
image picker can send the same key event. A `pageshow` closes the edit modal only
when the browser restored it without an active Work Highlight. Opening or filling
an editor cancels any delayed reset from an earlier close.

The Edit portfolio controllers are the only Work Highlights owners on
`/starter-edit-profile`. The Build portfolio controllers fail closed outside the
two exact Build routes, even if an obsolete nested Webflow component still loads
their files. This prevents duplicate immediate Build writes from bypassing the
Edit controller and racing its write. Structural Webflow cleanup must still
remove the obsolete nested Build component; the code gate is the runtime safety
boundary until that component repair is published.

`company-autocomplete.js`, `company-experience-crud.js`, and the shared
`../build-profile/work-dates.js` deliberately diverge from the live bodies they were
captured from. Their shared Build Profile contracts are owned
by [Company selection logo persistence](../profile-form/README.md#company-selection-logo-persistence)
and [Company experience date hydration](../profile-form/README.md#company-experience-date-hydration).

The shared search request and stale-response contract is owned by
[Company selection logo persistence](../profile-form/README.md#company-selection-logo-persistence).
On Starter Edit Profile only, a search shows `Searching...` immediately and
`Still searching company sources...` after four seconds, so a slow company
source never looks frozen. That progress message follows the same active-query
sequence gate as results and errors.

Loader pattern:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/starter-edit-profile/portfolio-crud.js"></script>
```

Use the matching asset path for the other five replacements. Do not combine or reorder the loaders.

The sitewide `v3/native-form-diagnostics.js` loader must run before these
deferred mutation assets so their photo, portfolio, and company-experience
requests can emit receipts. The root [Current Scripts](../../README.md#current-scripts)
section owns that shared loader contract.

## Validation and submit ownership

After the approved whole-block cutover, `starter-edit-profile.js` is the only
profile-validation owner for its legacy main section-submit buttons. It owns steps 1,
2, 5, 6, and 7 through an explicit published-markup contract. The Companies
controller owns step 3 and the Portfolio controller owns step 4. The configured
`v3/brand-account-controller.js` identity guard may capture a real changed-email
click on Personal Details, but it calls this controller's step 1 validator and
can only authorize one replay after Memberstack confirms the same member ID and
normalized login email. It does not add a second profile validator or Xano
writer. No other controller may disable, intercept, or validate the same submit
path.

Opted-in [unified rows](#unified-rows-services-work-experience-highlights) delegate
validation to their section coordinator and `StarterProfileValidation`; the
existing controllers retain persistence ownership.

The main form must not opt into sitewide `utils/wf-validate.js`. Its capture-phase
submit gate can run before the page controller. The live inline validator must be
removed only after the replacement CDN controller and published-form contract
tests pass. Until that whole-block cutover is approved and published, the inline
block remains a known second owner and the reliability fix is not live.

The native Webflow form, field names, success/error elements, hidden mirror
elements, and component markup stay authored in Webflow. The remaining `mirror`
rules map failure focus to an authored visible control; picker validation is owned
by the [step 1 and step 5](#step-1-and-step-5-validation-pickers-since-2026-09-07)
and [step 6](#proposed-step-6-availability-group-pr-only) contracts below.
Hidden mirrors must not prevent the controller click handler from recording
a console-only validation receipt. Only the page controller's request-loading
state may apply `pointer-events: none`, and only after validation succeeds.

The published form also carries hidden compatibility controls that reuse the
`email` and `phone` field names. The authored Personal Details controls own both
values, so the controller resolves them by their unique `#email` and `#phone` IDs
scoped to the step 1 element — for validation, for the change-email replay proof,
and when collecting the submit payload, where the authored value is written over
whatever a duplicate name contributed. Never widen those two lookups back to a
`[name=…]` or document-wide query: a hidden duplicate would win by document order
and submit a stale contact value the member cannot see.

### Request Reviews validation

Step 7 validates all three optional reviewer slots in `starter-edit-profile.js`.
Blank slots remain valid; a started tuple requires both first name and email.
Non-empty emails are trimmed before validation and serialization, preserving
case and plus tags without changing other reviewer fields. The accepted syntax
is an unquoted ASCII dot-atom local part and a dotted DNS domain whose labels
contain 1–63 ASCII letters, digits, or hyphens, with no edge hyphens. Commas,
angle brackets, internal whitespace, missing or repeated `@`, and doubled or
edge dots are rejected. The normalized address is limited to 320 characters.
Email-check failures use
`REVIEWER_EMAIL_INVALID`.

The submit handler checks before asynchronous preparation, then validates the
exact reviewer snapshot used to build `Reviewers` before sending the profile
request. An invalid edit during preparation therefore also blocks the PATCH.
The submit-handler regressions in
[`../../starter-edit-profile.test.js`](../../starter-edit-profile.test.js) cover
each slot, plus addressing, trimmed serialized emails, and edits during
deferred preparation.

### Canonical required-mirror hydration

`canonical-profile-loader.js` hydrates the authored required validation mirrors
alongside the ordinary `[data-input-capture]` controls. Personal Details owns
`function-required`, `roles-required`, and `subcategories-required`; Skills and
Tools owns `skills-required` and `tools-required`; Availability owns
`availability-required`. Each mirror prefers its canonical Xano ID or ID list,
joining an array as a comma-separated value. If the ID value is absent or empty,
the corresponding canonical display value remains the compatibility fallback.
This preserves compatibility mirror values without replacing a stored ID
with its label; picker validity follows the group contracts below. The loader
writes only matching named fields inside their owning step and dispatches the
same native hydration events as other restored controls.

### Unsaved-change warning

`canonical-profile-loader.js` owns one page-level dirty-state controller. Canonical
hydration does not make the form dirty. `input` and `change` events, including
synthetic events emitted by user-driven custom controls, mark only their containing
`[data-form="step"][data-index]` section. Controller initialization and hydration
dispatches must run through `runHydrationSync()` so those synthetic events stay
clean. Inputs outside the profile steps cannot arm the warning. The controller also
answers `isHydrating()`, so a section script that keeps its own draft flag reads the
same hydration window rather than inventing a second one: `unified-services.js` asks
it before marking the section dirty, because the pickers and legacy toggles inside
that section replay `input` and `change` while the profile hydrates.

After validation, the main writer calls `beginSave(stepIndex)` before its first async
save stage and passes the returned revision token to
`finishSave(stepIndex, saved, token)` after the operation settles. Once the request
payload is complete, `sealSave(token)` moves the accepted revision boundary to that
snapshot. Only an explicit canonical `saved: true` response clears edits included in
the snapshot. A failed request or an edit made after the snapshot stays dirty, and an
active request remains protected.

The Companies and Work Highlights controllers use the same step-scoped contract for
steps 3 and 4 and mark their draft-queue mutations directly. They accept their own
revision after all canonical mutations for that submission succeed, before the
follow-up list refresh. Work Highlights permit only one in-flight submit and remove
only the exact snapshotted drafts, leaving later drafts queued. Discarding a local
Company or Work Highlight draft removes only the revision that draft owns; it returns
the step to clean only when no other pending change remains. Saving one section never
clears unsaved work in another section.

The `beforeunload` handler requests the browser-native leave-page prompt only while at
least one step is dirty or saving. Requesting it takes both halves: `preventDefault()`
and a non-empty legacy `event.returnValue` (`true`), because an empty `returnValue`
leaves browsers that still key the prompt off that property silent. A clean page returns
before either half, so an unchanged page, hydration, a fully accepted save, and a
discarded draft navigate with `returnValue` unset and no false browser warning.

The sanitized structural contract lives in `published-form-contract.json`.
`published-form-contract.js` normalizes official Webflow element-tree evidence
plus the authenticated published-page control inventory without retaining field
values, member data, text, component props, styles, URLs, tokens, or Webflow
element IDs. Contract drift must fail tests; do not silently refresh the fixture.

Account-settings tabs, membership panels, pause/cancel UI, and scheduling persistence
remain separate shared-component work. On step 6, Free Call and Paid Call controls stay
visible and editable. Their dedicated settings controllers hydrate the authored fields
from canonical Xano GET responses and save only changed settings through the guarded
upsert or disable endpoints before the profile PATCH begins. The profile PATCH omits all
five call fields, so it never becomes a second writer. Both controllers claim the same step 6
root, so each stamps its own radio hook (`data-free-call-settings-input` and
`data-paid-call-settings-input`) rather than the shared dashboard name. A canonical render
announces its radio answer with a `change` event so the page re-derives the dependent field's
enabled and visible state, and a controller that reports no changes never gates the step: a
failed call-settings read must not block Hourly Rate, Availability, Retainer, or Services. Both
controllers read the same `isHydrating()` window before marking themselves changed, because the
profile loader replays `input` and `change` on every control it restores and a hydration write is
never a member change. The loader restores none of the five call controls: the legacy profile row
no longer writes them, so replaying it over a controller's render could silently turn a pending
Build Profile create into a decline the member never made. An unconsumed Build Profile Call Settings
receipt prefills the Free or Paid controls and waits there: prefilling is not a member change, so it
never marks step 6 changed on its own and a Save for an unrelated field never commits it. Answering
either call control is the member gesture that marks the step changed, and that Save then
materializes the choice through the same guarded upsert or disable. Accepting the prefilled Yes
counts even though the overlay already checked it and a browser therefore emits only a click:
the controllers arm on that click once the branch's prerequisites allow the write, so a member
who agrees with their Build Profile answer needs one gesture, not a decline and a re-answer. Each contract's Build Profile
handoff section owns that receipt. Retainer controls remain owned by
the profile form even when Webflow markup places them in a wrapper shared with a call
field. This contract holds only where `scheduling-auth.js` authenticates this page; its host
scope is owned by [Load order](#load-order). See the
[Free Call settings contract](../../docs/wiring/FREE-CALL-SETTINGS-WIRING.md)
and [Paid Call settings contract](../../docs/wiring/PAID-CALL-SETTINGS-WIRING.md). The root
[Current Scripts](../../README.md#current-scripts) entry owns the profile endpoint's
canonical-save and asynchronous-projection response contract.

## Unified rows (Services, Work Experience, Highlights)

Three Edit Profile sections share one row pattern: an expandable list of entries
with Add, Remove, Undo, Discard, and a single Save. This section owns their wiring
and behavior contract. Review Requests deliberately stays out of this pattern;
it keeps the step 7 rules above.

### Globals and ownership

`profile-section-validation.js` publishes
`window.StarterProfileValidation = { bind, misconfigured, answeredRow, notLanded }`. It was derived
independently from `utils/wf-validate.js` at v1.59.549 and keeps that validator's
native-constraint messages, blur and correction timing, and inline alerts. Unlike
the sitewide validator, a field belongs to a section and to its own DOM identity
rather than to a page-wide name group, and this module installs no submit gate.
The global `utils/wf-validate.js` is unchanged.

`unified-services.js` publishes
`window.StarterProfileSections = { bindServices, get }` and binds itself. It
prefers `window.waitProfileData` when that page embed has run; otherwise it polls
`window.activeProfile` for 10 seconds until `last_update` is neither null nor
undefined and, if the saved profile never arrives, stays
unbound rather than binding against missing data. It is keyed to
`[profile-unified-items="services"]`.

Inside a unified section the retainer toggle *disables* the controls it hides rather than
un-requiring them, and `prepare()` skips disabled controls. The retainer description is a value
this section owns, so switching retainers off sends `Retainer_Description: ''` alongside
`Retainer_Rate: 0`; otherwise the stored description would survive a save that says retainers
are off.

`unified-companies.js` and `unified-highlights.js` publish
`window.StarterProfileCompanies` and `window.StarterProfileHighlights`. They do
not self-bind: `company-experience-crud.js` and `portfolio-crud.js` bind them and
stay the writers. Each of those two controllers disables its own Save and returns
if the global (or the validator) is missing, so a half-loaded page cannot present
a live Save that writes nothing.

`company-autocomplete.js` publishes `window.StarterEditLogoSearchInit`. Both this file
and `v3/build-profile/company-autocomplete.js` declare a top-level `logoSearchInit`, so on a
page that loads both, whichever runs last owns the bare `window.logoSearchInit`. Work
Experience rows need the Edit picker specifically - it publishes `_starterCompanySearch` and
creates a `[profile-company-search-results]` container - so `unified-companies.js`
calls `window.StarterEditLogoSearchInit` only, never the bare global, and never falls back to
the Build Profile copy, which publishes no `_starterCompanySearch` handle to destroy and no
results container to strip from a cloned row. `logoSearchInit` stays declared for the legacy
callers on the page.

The picker is a **hard prerequisite**, not an enhancement: a company row only acquires the
identity Save requires by picking, so without it every Save would stop on "Choose a company
from the list" with nothing a Starter could do. If `window.StarterEditLogoSearchInit` is not a
function when `unified-companies.js` binds, the section registers the same halted state as
missing row markup — `This section could not load. Reload the page before editing.`, Save
disabled, one `console.warn` naming the missing script — and reads and writes nothing.

The Work Experience and Highlights writers publish a `dispatches()` counter to track
requests handed to `fetch`. A section compares it across a write, so a call that threw
before sending anything is reported as not submitted rather than left in doubt.
It is a required part of the writer
contract, not an optional one.

The Work Experience writer also publishes `monthRangeMessage`, the sentence shown when an end
month is earlier than its start month. It is published so the unified rows and the legacy
company form say the same thing, and it is a required part of the writer contract.

The "Also worked with" association is part of the Work Experience draft, so the whole set that
reads and writes it - `hasOtherChanges()`, `saveOther()`, `otherValue()`, `matchOther(value)`,
`acceptOther(value)` and `restoreOther()` - is required too, not optional. A writer missing one
would let Discard leave the picker on a discarded value, or let a confirmed association be
resent on the next Save.

Both writers mark the answers they receive. A mutation refused with a non-2xx answer throws an
error carrying `known`; a mutation the server answered 2xx whose body could not be read throws
one carrying `received`. A section treats `received` as an answer that arrived — the write
landed — so it is never mistaken for a lost response. The thrown error keeps the message and
status the legacy callers on the same page already handle.

### Load order

**Rollout order: publish the profile-form inline cutover first.** The atomic cutover that
replaces the inline `shared-foundation.js` and `incremental-dropdowns.js` bodies with the
GitHub-owned assets (see `v3/profile-form/inline-extraction-cutover-candidate.json`) must be
published *before* any `[profile-unified-items]` marker is installed in Webflow. Installing a
marker first breaks the page two ways:

- **Double-owned rows.** `incremental-dropdowns.js` skips any wrapper inside
  `[profile-unified-items]`. The still-inline copy on the published page has no such check, so
  it and `unified-services.js` would both clone, renumber and open the same
  `[increment-dropdown]` rows.
- **No `starter:profile-restore` listener.** Discard in `unified-services.js` dispatches
  `starter:profile-restore` on every `[ms-code-select-wrapper]` so the pickers re-render their
  restored values. Only `shared-foundation.js` listens for it, so until that body is the
  published asset a Discard leaves the picker showing the discarded selection.

- `profile-section-validation.js` before all three section scripts.
- `unified-services.js` before or alongside `starter-edit-profile.js`. The section registers
  its controller only once the saved profile lands, which is after the submit handlers are
  installed, so `starter-edit-profile.js` marks that Save `aria-disabled` from page load and
  clears it when the section binds. A Save clicked in that window is answered as "This section
  is still loading", never silently ignored. Only a missing section script, or a wait that has
  run out, gives the unrecoverable "This section could not load … Reload the page" message.
- All three sections make the same check at bind time: a section missing its row
  template or its Save control registers a halted state, shows the same "This
  section could not load. Reload the page before editing." message, and disables
  the Save control if one is present.
- `company-autocomplete.js` before `unified-companies.js` and `company-experience-crud.js`. It
  publishes `window.StarterEditLogoSearchInit`, which Work Experience treats as a hard
  prerequisite: a section that binds without it registers the halted state above.
- [`global-embeds/accordions/accordions.js`](../../global-embeds/accordions/accordions.js)
  before `unified-companies.js`. It publishes `window.StarterAccordions`, which Work
  Experience opens and collapses its rows through; a section that binds without it registers
  the same halted state rather than running a private copy of that behavior. This page must
  load the shared accordion file even though its own markup carries no `data-accordion`
  wrapper: Work Experience registers each row with the script directly.
- `unified-companies.js` before `company-experience-crud.js`.
- `unified-highlights.js` before `portfolio-crud.js`.
- `scheduling-bridge.js` before `free-call-settings.js` and `paid-call-settings.js`, all three
  of which this page must serve for step 6: each call controller claims the step 6 root on
  its own and reads canonical settings only through the bridge-owned fetch. Their tags and
  Xano authority live in the [Free Call settings contract](../../docs/wiring/FREE-CALL-SETTINGS-WIRING.md#loader-order)
  and the [Paid Call settings contract](../../docs/wiring/PAID-CALL-SETTINGS-WIRING.md#script).
  That prerequisite scopes where step 6 call settings work today. The bridge runs host-wide on
  `the-starters-3-0.webflow.io`, and on the V3 custom domains it runs only on the paths listed in
  its [current safety boundary](../README.md#scheduling-auth), which now includes
  `/starter-edit-profile`. Without the bridge both controllers throw `xanoAuthFetch is unavailable`,
  so the step 6 call controls render unhydrated and every call save fails closed. The boundary list
  owns that decision, so widen it there rather than restating a host rule here.
  `scheduling-bridge.js` is the neutral-path release alias of `scheduling-auth.js` for this page.
  It exists because production browser client filtering can reject the filename containing
  `auth` before JavaScript runs. The alias executes the same bridge contract and still reports
  `window.__tsSchedulingAuthBridgeOwner = 'scheduling-auth'`; do not fork its behavior.
  Loader order alone does not decide the race on this page: both controllers wait for the bridge
  before their canonical read, so a bridge that installs after them still hydrates step 6 instead
  of flashing the unavailable state. The two contracts linked above own that wait and its bounds.
  Both bridge arrival orders are exercised in Chrome against the authored step 6 DOM by
  `node v3/browser-tests/edit-profile-call-settings.browser.cjs`; set
  `EDIT_PROFILE_BROWSER_EVIDENCE=<dir>` to write screenshots and observations. The fixture fakes
  only the Memberstack session and the Xano responses, so it cannot establish production behavior.

### Authored markers

These must exist in Webflow:

| Attribute | Where | Notes |
| --- | --- | --- |
| `profile-unified-items="services\|companies\|highlights"` | Section | Opts the section in |
| `profile-items-add` | Section | Add-entry control |
| `profile-items-discard` | Section | Discard-changes control |
| `profile-items-presence` | Section | Optional; gates Save only when it carries `required`. For companies it never weakens the Remove floor below - a section without it still keeps one filled entry |
| `profile-items-media="images\|videos"` | Row | Highlights only |
| `profile-items-summary` | Row | Authored for companies and highlights; created by the script for services |
| `profile-items-undo` | Row | Required for companies, so Designer owns the Button component; created by the script for services and highlights |
| `profile-item-toggle` | Row | The control that opens the row |
| `profile-item-content` | Row | The panel the control opens |
| `profile-item-remove` | Row | Required for companies; a plain wrapper around the themed Button, authored with a `data-button-theme` (`danger` on this page) and containing the actionable control |

Companies treats a row missing `profile-item-toggle`, `profile-item-content`,
`profile-items-undo`, or a themed `profile-item-remove` button as the same markup gap as a
missing row: it reports the halted state and disables Save rather than rendering every entry
permanently expanded and inert, leaving a removed row with no way back, or having no theme to
restore. Companies never creates its own Remove or Undo control and never invents a theme:
Webflow owns those Button components, so the authored ones are the only ones.

The disabled look is derived at runtime - the script swaps `data-button-theme` to `disabled`
while only one entry remains and swaps the authored value back when a second entry makes
Remove usable. Whatever Designer authored is the value restored, so only a *missing* theme is
a markup gap. The Designer Remove on this page is authored `danger`, which is the intended
setup; another authored value still loads and is still what Remove returns to.

The scripts create `profile-items-removed`, `profile-items-dirty`, and the
per-row `profile-items-unsaved` status. None of those three is authored in
Webflow; style `profile-items-unsaved` from a class-free attribute selector.

`profile-items-status` and `profile-items-check-save` may be authored in Webflow
inside the section but outside the repeating row, so Designer owns their styling.
Because each section clones and rebuilds its rows, a marker authored inside a
row is stripped from that node before the row template is cloned, so no cloned
row carries it; the script then adopts the first marked element outside the rows
or creates its own. On adoption it sets `role="status"` on the status element,
and it hides the check element on bind, keeping the label the author wrote. The
check element may be a plain Link or Button element carrying
`profile-items-check-save`; leave it visible in Designer, because the script hides
and shows it with an inline `display` style that beats the Webflow class rule.
A class rule that hides the control is handled too: on reveal the script checks
whether the browser still reports `display: none` and, if it does, sets
`display: revert`, so the control shows either way — at the cost of the
`display` value that class was contributing. Never use an instance of the site's Button
component: its native `.clickable_btn`
is an empty overlay whose label lives outside it, so marking the overlay would
hide the clickable node while the caption kept rendering. A Link or Button
element is what the scripts expect: the script prevents a link's default action,
sets `type="button"` only on a real button, and applies the default label only
when the element is empty. A `div` is made keyboard-operable by the script,
which gives it `role="button"`, `tabindex="0"` and Enter/Space activation, but it
is still not the recommended choice. When
neither is authored the script creates them as before. It never creates a second
one.

Row grammars differ by section. Services reuses the existing
`[increment-dropdown]` row with `[increment-dropdown-toggle]`,
`[increment-dropdown-content]`, and `[increment-dropdown-remove]`, and reads its
fields by `data-name`. Companies and highlights use `[profile-item-row]` with
`[profile-item-toggle]`, `[profile-item-content]`, and `[profile-item-remove]`,
read their fields by `[profile-company-field="…"]` and
`[profile-highlight-field="…"]`, and save through the authored
`[data-edit-submit="companies"]` and `[data-edit-submit="portfolio"]` buttons.
The company picker creates its `[profile-company-search-results]` container;
cloned company rows discard copied containers before initializing their picker.

### The `form-xano-required` contract

Webflow authors put `form-xano-required` (empty value) on a field whose blank
value the Xano backend rejects. It never makes a field required. Requiredness
comes only from the Webflow Required checkbox.

`misconfigured(section, { applies })` returns the fields that carry `form-xano-required`
without authored requiredness. Each section script runs that check at bind and load time and
again on Save. On a mismatch it pauses Save with
`This form is misconfigured. Saving is paused until it is fixed.` and logs one
`console.warn` naming the field attribute — never a field value. Discard stays
available, so a member is never trapped with edits they cannot clear, and a later
draft edit does not overwrite the diagnostic with `Unsaved changes.`

**A section reports only the fields it submits.** `applies(field)` is the calling section's
ownership filter: Services passes the scalar controls `prepare()` reads plus its row fields,
Work Experience passes `[profile-company-field]`, and Highlights passes
`[profile-highlight-field]`. A `form-xano-required` marker on anything else authored inside the
section — a Free or Paid Call control the canonical settings controllers own, a picker's own search box —
belongs to the script that writes that field and never pauses this section's Save.

`data-non-required="<profile type>"` is the authored way to say a field is not asked of that
profile type, and `starter-edit-profile.js` clears `required` on those fields for the active
`window.activeProfile.type`.

**The report does not depend on the active profile type.** The fields whose `required`
`starter-edit-profile.js` rewrites at runtime are the ones carrying `data-non-required` — which
are reported whatever `required` currently says (below) — and the five canonically owned call
controls, whose `required` it always clears because the profile PATCH never sends them and the
call-settings controllers are their only validator. Every other field keeps the
attribute Webflow authored, so the same page reports the same fields for every Starter and
whenever the check runs. Inside `[profile-unified-items]`, `starter-edit-profile.js` records the
authored value once per page load before it rewrites `required` for the active type.

**The two markers must not disagree:** a field is never both `form-xano-required` and
`data-non-required`, because that would ask a Starter to leave blank a value the writer
refuses. `misconfigured()` reports that pairing for **every** profile type, whatever `required`
currently says, so QA meets the authoring error on the first profile it opens rather than on
the one type that happens to expose it. That rule applies within the fields the section
submits, like every other part of this report.

### Save-state semantics

A received non-2xx response is a **known refusal**: the server message is shown,
the draft is kept, and Save and Discard stay enabled. A refusal is never sent
through reconciliation — an unchanged submission would read back as a match and
report a save that never happened. A thrown or lost response is
**unknown**: the write may or may not have landed, so Save is paused until the
"Check saved state" control reconciles the section against a canonical read.
This covers every write the section owns: row creates, updates and removals, the
Work Experience "Also worked with" association, and Highlight media uploads (a lost
upload is matched against the canonical media list by file name and size). Discard
in Work Experience also restores the "Also worked with" picker to its last saved
state.

A write is only in doubt once it has been sent. The writers count the mutation requests they
hand to `fetch`, so a call that threw before sending anything — a changed signed-in member, a
broken wrapper — reports `That change was not submitted. Your draft is kept; you can save
again.` with the draft kept and Save still usable, rather than pausing the section over a
request nobody made.

**A response the section received is the write's own answer.** Where the server replies with
the row it wrote — a Work Experience create or update, a Highlight create, update or media
attachment — that answer confirms the save on the spot, and no canonical read can contradict
it. A removal is confirmed by any answer at all, since a 2xx delete is its own proof. The
canonical read is the fallback: for a lost response, and for a write whose answer carries no
row. A Highlight update answers with the record's own columns and no media — the media lists
live behind their own endpoints — so the confirmed record keeps the media this save already
confirmed, and each image's cover flag is taken from the `cover_image_id` the update just
confirmed rather than from the flag the old cover still carried.

A 2xx the section could not parse is still an answer it received: the write landed, so the
outcome is unknown at worst — Save pauses and "Check saved state" settles it — and never
"not saved".

A canonical read can also settle a **lost** write the other way. In Work Experience, a create
with no new row, a removal whose id the server still holds, and an update whose row still holds
exactly what it held before the write are each **proof that the write never landed**.
Highlights applies the same rule to the writes it owns: a create with no new record, a removal
the server still answers with, a media removal whose id is still attached, and an update whose
record still holds its pre-write details. A lost media attachment is never settled this way: an
attachment a read cannot find stays unknown until a read finds it, because a second Save would
otherwise attach the same upload twice. Proof ends the save where a refusal would — `That
change was not saved. Your draft is kept; you can save again.` — instead of pausing Save over
an outcome the read has already settled, and the same answer from "Check saved state" releases
Save and Discard.

**Only a lost response can be proved not to have landed.** After a received 2xx the write is
already the server's, so a canonical read that disagrees is read lag, never proof: the outcome
stays unknown, Save stays paused, and "Check saved state" settles it once the read catches up.
A reconciler only reports; nothing it reads reaches the baseline unless the write is confirmed.
Only a read that proves neither keeps the pause.

Two sentences, two different outcomes, and all three sections use them the same way:

- `That change was not submitted. Your draft is kept; you can save again.` — the write never
  left the browser. Nothing reached the server, including a Services save the page abandoned
  before sending it.
- `That change was not saved. Your draft is kept; you can save again.` — the write was sent,
  its response was lost, and a canonical read then proved it never landed. Only the lost path
  can end this way.

Saved state that cannot be *read* is never a write in doubt. A malformed stored Services slot
fails the section closed the way a missing row template does: `Saved services could not be
read. Reload the page before editing.`, Save disabled, no "Check saved state" control, and
Discard still usable. Save is never left live over entries nobody could read.

Proving a *lost* update never landed is stricter than matching an answer: the stored row must
still hold exactly what it held before the write, field for field, with the current-role flag
and the end date each compared as they are. A server that applied part of the update has
already changed the row, so the outcome stays unknown instead of reading as nothing saved.

Matching a canonical read against what was sent tolerates fields the server leaves
out of its answer, but never a field it returns with a different value. An
unchanged `company_entity_id` or `company_domain` is proof that a switch to a
same-name custom company was lost, not proof that it landed. The tolerance covers every
compared field, not only those two, and a current role reads the same whether the answer
carries `current_work` or the `'Present'` end-date sentinel. `start_date` and `end_date` are
compared by month rather than by text, because a row sends the `YYYY-MM` its month input holds
while Xano stores a full date: the same month written two ways is the same month, and a lost
write that landed is confirmed by it instead of locking the section on Save.

Deciding what to *resend* is strict in both directions — clearing a saved company's entity id
or domain is a real change — with two exceptions: the current-role pair, which is one state
written two ways, and the months, which use that same month equivalence. Once a confirmed row
reaches the baseline as the full date Xano stored, the draft's `YYYY-MM` is not a change the
Starter made, so the next Save sends nothing for it rather than re-sending the row forever.

The "Also worked with" reader answers with the saved set or with nothing at all;
a failed request never reads as "this member has none". So a failed canonical read
cannot confirm a cleared association, and a failed hydration does not let the
picker publish an empty baseline.

A failed initial load leaves the section readable rather than inert. Save and
Discard are refused until the page is reloaded.

### Work Experience accordion actions

The visible row controls carry `profile-company-field`; obsolete hidden copies must
not carry those markers. The visible date fields use the native month ownership
below, without the legacy `data-input-datepicker` markers. Author the Add action
after the row template. Page-local plain wrappers carry `profile-items-add`,
`profile-items-discard`, `data-edit-submit="companies"`, and `profile-item-remove`;
each wrapper contains its existing themed Button component, and the
theme and the actionable control are both read from inside that wrapper - the marker itself is
the element Remove hides. The whole footer
must not carry the Save marker: Discard shares that footer but remains outside
the Save owner. Author a separate `profile-items-undo` wrapper in the same header
action slot, containing a small secondary Button labelled `Undo removal`. Give
that wrapper the native `hidden` attribute initially; the controller explicitly
sets its display state. The component's visible label and overlay button remain
authored together.

Row open and close is the shared accordion's, not this section's: each row is registered
with `window.StarterAccordions` as a card whose control is `profile-item-toggle` and whose
panel is `profile-item-content`, so one Work Experience entry is open at a time and any GSAP
the page loads animates it. The rows keep their own click and keyboard handling, because
opening depends on save and removal state the accordion cannot see, and the group is asked
not to bind a second handler on the same control. Hydration, Add, Discard, and Undo all go
through that group, and a removed row is released from it. The shared contract is documented
in the [accordions README](../../global-embeds/accordions/README.md#rows-a-script-renders).
Owned header clicks, including nested Remove and Undo, stop bubbling so Webflow's delegated
legacy accordion interaction cannot overwrite the shared owner's panel height.

Runtime rows stay before Add. Saved headings read `Work Experience (Company · Title)`;
the confirmed identity stays visible while edits are pending, so a saved row's heading does
not follow a draft the server has not taken. A row that has never been saved has no confirmed
identity, so its heading follows the Company and Title being typed into it and two new rows
stay distinguishable while collapsed. An `Unsaved` status
beside each heading reflects that row's draft, including removals and partial saves. It is
read from the same confirmed baseline the next Save compares against, so the status and Save
never disagree about what is left to write - including after a lost response that a canonical
read confirms from a row Xano stores without every column it was sent.
Discard restores the confirmed headings and clears row statuses. Remove uses the
existing disabled button theme while only one entry remains, counting filled entries rather
than rows: adding a blank row never unlocks removing the last saved entry, and the section
never ends up with no row at all. That floor is unconditional and deliberate. It does not
consult `profile-items-presence`, so a section whose presence marker is absent or not
`required` still cannot be emptied through Remove: presence decides whether Save refuses an
empty section, not whether Remove may take the last filled entry away. A pending removal keeps its heading and replaces Remove
with Undo removal in the same action position.

Remove means two different things depending on what the row holds. A row that has never been
saved and holds nothing is dropped outright: there is no confirmed state to restore and
nothing for Save to delete, so offering Undo would leave a collapsed empty entry that no Save
ever resolves. A saved row, or an unsaved row carrying any typed value, is marked removed
instead and keeps its Undo until Save.

Validation opens the first failing row only. The shared validator reveals every failure and
then focuses the first, and only one Work Experience entry can be open, so revealing each
failure in turn would collapse the row whose field is about to take focus.

Any row the section opens and then immediately focuses or scrolls to is opened instantly, not
animated. When GSAP is on the page the shared accordion renders an animated open on the next
frame, so the panel is still `display: none` when the call returns and a focus into it would
be a no-op. Add, Undo, the presence message, and validation reveal all take the instant path;
a Starter's own toggle still animates.

[`unified-companies.fixture.html`](unified-companies.fixture.html) exercises these
states with themed Button wrappers and a local, in-memory writer. It does not prove
published-page wiring or authenticated persistence. Run its desktop/mobile Chrome checks
with `GSAP_SOURCE=<path to a GSAP UMD build> node v3/browser-tests/work-experience-annotations.browser.cjs`.
Append `--undo-only` for the focused desktop animated pass, including delayed legacy
click/second-click interference with Remove and Undo.
`GSAP_SOURCE` is required and is read before Chrome or the local server starts, so an
unreadable path fails with a clear message instead of a mid-run crash. This repository has no
manifest and does not vendor GSAP, so the path has to come from the operator - point it at a
GSAP install of your own (for example `node_modules/gsap/dist/gsap.js`). A third pass reloads
the fixture with that build and asserts that Add, Add on a collapsed unfinished row, Undo, and
validation reveal all land focus on a field with real layout inside an open panel, and that the
panel is still open once the animation budget has passed. A reversed timeline leaves a panel at
`display: block` with `height: 0` while its children still paint outside the box, so the pass
measures the panel box against its own content rather than trusting `display` or a non-zero
rectangle.

#### Work Experience annotation rollout state — 2026-09-22

The test page's saved Designer tree now has the visible start/end inputs marked
`profile-company-field` and authored as native month inputs. The old datepicker
attributes/group were removed, legacy hidden field markers and custom IDs were
removed, and the obsolete decorative calendar icons were hidden. Existing Add,
Discard, Save, and Remove Button components were moved into the plain action
wrappers above; obsolete action markers, including the whole-footer Save marker,
were removed. The separate Undo component is authored with its wrapper initially
hidden. Save is labelled `Save Changes`.

The rollout also needs the shared accordion file loaded on this page ahead of
`unified-companies.js`, as the loader-order list above records. That script tag is **not yet
authored** in the test page's Head Code; without it Work Experience halts with the
"could not load" message rather than rendering rows. No script pin was changed here.

These Designer edits remain **unpublished**. Script pins were not changed, the
script retains its existing `v1.59.607` marker pending release, and this work does
not release or publish the change. Deployment requires the reviewed controller
release and the corresponding authored markup together. Actual-page desktop
verification with local overrides and authorized persistence is recorded below;
it does not establish that the unpublished Designer tree is deployed. The original
missing Save button's computed-style cause remains unproved.

#### Actual-page desktop acceptance — 2026-09-23

The later user authorization for a signed-in disposable test account, local script
and markup overrides, temporary saves, and cleanup superseded the earlier
authentication restriction. The earlier zero-live-scenarios/authentication-blocked
assessment is obsolete. The following historical evidence review is superseded
for current acceptance by the direct desktop run below.

The local preview used commit `034b371043fa5b88ea021049766fcb993af08fb2` on the
actual test page with the real writer. Its record is
`/private/tmp/work-experience-annotations/local-preview-results.md`; the named
captures remain outside the repository because they contain account information.

| Desktop behavior | Actual-page evidence in that directory |
| --- | --- |
| Add below rows, visible Save, section/row unsaved status | Preview observations and `preview-save-position.png` |
| Month dates and current-role state save and survive reload | Authorized Save test record and `current-reloaded.png` |
| Saved/draft removal floor, disabled theme and authored danger restoration | `saved-plus-blank.png` and preview floor/theme observations |
| Remove/Undo position, Discard, settled Add/Undo/validation focus | `saved-remove.png`, `preview-undo-settled.png`, and authorized Save test observations |
| Invalid row opens while the other panel hides without footer overlap | `two-invalid-after.png` and measured panel observations |
| Partial create failure retains drafts; retry writes only the remaining row | `partial-requests.json`, `partial-retry-requests.json`, and documented two-record server readback |
| Successful create with lost response reconciles without another write | `lost-response-evidence.json`, `lost-result.png`, and documented independent readback/no-write second Save |
| Desktop section exit/reentry retains the saved row and panel geometry | `reentry-away.png`, `reentry-back.png`, `reentry-open.png` |

The partial-save reload used the deployed reader after overrides failed to attach;
that readback establishes persistence, not execution of local code after reload.
Cleanup is recorded for all temporary records; the supplied acceptance decision
confirms the final server count was zero. No raw captures or service hostnames are
copied here.

Mobile resize is a **known failure explicitly deferred by the user**, not a pass:
`local-preview-breakpoints.json` records an expanded panel with zero height across
768/767/768px transitions. Mobile footer visibility and all shared-group teardown
paths are not established by actual-page evidence. Fixture coverage remains
separate. This is not an eight-of-eight acceptance claim or pipeline approval.
Unpublished markup and the shared-script loader remain rollout dependencies;
publishing, pin changes, tags, and production release remain unauthorized.

##### Direct desktop run at `e8862c39` — acceptance blocked

The authorized disposable account was exercised directly through Chrome with
both exact CDN requests overridden before initialization and cache disabled.
The preview marker confirmed `e8862c39b30a8127717cbf2a87daecc3ec99fb1a`.
Independent server reads confirmed an empty baseline and zero records after
cleanup. An initial loading refusal cleared on reload; its cause is unconfirmed.

Live checks established Add below the rows, visible Save, section/row unsaved
status, native month input, current-role disabling of End Date, the last-filled
draft removal floor with a blank row present, authored danger restoration,
Remove/Undo placement, and Discard. Add and Undo kept Company focused with a
280px panel after 600ms. Validation focused the invalid second row with a 314px
panel after 600ms; the first panel was hidden with zero height and no footer
overlap.

However, a valid create returned `WORK_HISTORY_CREATE_PROFILE_EVENT_INVALID`.
The draft remained available and server readback remained empty. This is a new
live save blocker, not the obsolete authentication restriction. The backend
contract responsible for that rejection has not been established; no speculative
writer change was made. Saved-entry persistence/reload, partial-create retry,
and successful-write lost-response reconciliation remain unverified in this run.
Historical successes above do not override this current failure.

All drafts were discarded, empty fields/current-role false were verified, and
focus/cache emulation was reset. No records required deletion. Sensitive captures
and the detailed report remain outside Git under the test run's evidence directory
(`live-desktop/`). Mobile was neither tested nor changed and remains deferred.
Shared-group component fixture results are not live product acceptance. The
desktop acceptance verdict remains **blocked**, with no pipeline approval.

##### Focused live create recheck at `d1d0c3f` — failure not reproduced

On 2026-09-23, the authorized disposable account started with an independently
verified empty server baseline. A selected company, temporary job title, and
January 2024–February 2025 dates were saved through the actual desktop UI.
The create returned HTTP 200, the UI reported Changes saved, and an independent
read confirmed exactly one matching record. Reloading with both exact local
script overrides and the target commit marker verified preserved the confirmed
heading and both native month values. Deleting only that newly created record
returned HTTP 200; a subsequent independent read confirmed zero records.

The earlier `WORK_HISTORY_CREATE_PROFILE_EVENT_INVALID` rejection did not
reproduce; its cause remains unknown. No runtime or test change was justified.
This focused persistence check passes, but partial-create retry and lost-response
reconciliation were not rerun, so this is not full desktop acceptance or pipeline
approval. Mobile remains deferred. Redacted results and private screenshots are
in the current run's external evidence directory as `create-reproduction.json`,
`create-reproduction-result.json`, and `repro-persisted-dates.png`.

Focused re-verification during the earlier evidence assessment:
`node --test --test-name-pattern='a partial company save|a lost create is confirmed|validation opens and focuses|visible marked month controls' v3/starter-edit-profile/unified-companies.test.js`
passed all four selected behavioral tests. No executable failure was reproduced;
the correction is to the stale acceptance assessment, with no runtime changes.

Completed local checks:

- `node --test v3/starter-edit-profile/profile-section-validation.test.js v3/starter-edit-profile/unified-companies.test.js v3/starter-edit-profile/unified-section-switching.test.js global-embeds/accordions/accordions.test.js global-embeds/accordions/mobile-accordions.test.js`: 110 tests passed.
- `node --check v3/starter-edit-profile/unified-companies.js` and
  `node --check global-embeds/accordions/accordions.js`: passed.
- `node --test readme-doc-links.test.js`: 81 tests passed.
- `GSAP_SOURCE=<path> node v3/browser-tests/work-experience-annotations.browser.cjs`: desktop (1200px)
  and mobile (390px) Chrome checks passed, including computed action visibility,
  disabled theme with a blank added row, one-entry-open accordion behavior against the
  actual shared script, Add ordering, native month/current-role values sent to the
  in-memory writer, saved and typed headings, row status, authored Remove/Undo, and
  Discard without saving, plus an animated pass asserting that Add, Add on a collapsed
  unfinished row, Undo, and validation reveal each focus a field inside a panel whose box
  covers its content, both immediately and after the animation budget has passed. That pass was run against a GSAP 3.14.2 build supplied through `GSAP_SOURCE`; the
  repository declares no GSAP dependency, so reproducing it needs an operator-supplied path. Set `WORK_EXPERIENCE_BROWSER_EVIDENCE=<dir>` to write screenshots and
  observations. This uses fixture colors and simulated
  persistence, not published-page styling or an authenticated account.

### Work Experience section readiness

Unified Work Experience saves row creates, updates, and removals before the
"Also worked with" association. A failure stops the sequence and keeps the
remaining draft. A create paired with a removed row uses `replace_companies_id`
to replace it atomically at the three-entry cap.

Unified rows use native month inputs instead of the legacy modal month picker.
Valid saved dates display as `YYYY-MM`; untouched dates retain their original
stored string on save. Unparseable saved dates remain visible in a text input
for correction. A current role disables the end input and saves `Present`;
otherwise the end month must be the same as or after the start month.

The "Also worked with" picker in `company-autocomplete.js` hydrates from Xano on
its own schedule, and its field belongs to the Work Experience draft. Readiness is a single
latched claim on the field itself, not a timer:

- The picker **claims** `#also-worked-with` as it initializes, before the member lookup. The
  claim sets `data-starter-also-worked-with-state="pending"` and dispatches
  `starter:also-worked-with-claimed`, so a section that starts waiting either before or after
  the claim reads the same signal.
- The claim **settles exactly once**, as `hydrated` or `failed`, writing the state attribute
  and dispatching `starter:also-worked-with-hydrated` or
  `starter:also-worked-with-hydration-failed`. A later report cannot re-baseline a draft.
- Hydration normalizes an empty saved set to the same serialized form Discard restores, so a
  discarded draft leaves nothing pending.
- Every path that leaves the field unhydrated settles the claim as failed: an unreadable saved
  set, a missing `[company-search-group]`, a missing tag template or wrapper, a throw while
  rendering the saved set, a signed-out member, and a picker that could not initialize at all.
  The section then fails closed exactly like a failed company read: the rows stay readable and
  Save and Discard are refused until the page is reloaded.
- **No picker claims the field** — a page with no "Also worked with" picker — is ready with
  the value already in the field as its baseline. A blind wait there would fail the whole
  section closed over a picker that does not exist.
- The ten-second timeout is the last resort only, for a picker that claimed the field and then
  never answered.

Without this gate a tag added before hydration was skipped by Save, reported as
saved, and then adopted into the baseline as if the server already held it.

### Confirmed media and local files

A Highlight photo or video a Starter selects is held as a `File` with an object URL for its
preview. Once a write is confirmed — an attachment that landed, or a deletion the canonical
read no longer shows — the entry switches to the stored media: the object URL is revoked, the
`File` is dropped, and the list re-renders from the stored URL. A save that ends on a refusal
or an unknown outcome keeps its rows, so this matters: without it those rows would go on
rendering from a revoked object URL and holding the file in memory for the page session.

A retained photo or video without a nonblank URL shows a readable preview-unavailable
message instead of creating a broken media request. It remains retained, with its
cover, Remove, and Undo controls available.

### Limits

Services allows three entries. Work Experience allows three entries. Highlights
allows nine entries, each with five photos at 4 MB each and three videos at 40 MB
each, which is the endpoint limit; the UI allowed 50 MB before 2026-09-17.

### Test page state

On 2026-09-22, the published `/starter-edit-profile-test` and
`/starter-edit-profile` routes both returned HTTP 200. The test page's published
inventory loaded the three unified sections at `v1.59.579`; the original had no
unified section markers. Native Required was present on company name, service
name, and service price; `rate-retainer.required` was true at runtime. That last
observation does not establish the Retainer's authored setting.

After the author delegated the cleanup, the test page's saved Designer tree was
updated and read back. The six specified legacy targets were removed: the
Highlights card wrapper, old add dropdown, unmarked Add and Discard component
instances, Work Experience list, and company-edit dialog. Highlights Add,
Discard, and row toggle are visible. Each section has one visible Add and Discard
using `button big with-border`, with Discard beside Submit inside the existing
save-owner wrapper. Each also has one empty status block using
`text-size-14 opacity-75 text-color-secondary` with `role="status"`, and one
visible native Link labelled `Check saved state`, outside the repeating rows.
The readback confirmed each section carries exactly one `profile-items-status`
and one `profile-items-check-save` custom attribute outside its rows, so the
scripts adopt the authored nodes instead of appending unstyled fallbacks.
Readback found no unexpected missing elements or changes to retained attributes;
all 44 retained native inputs kept their settings.

These Designer changes have not been published. The test page's script pins
still need the reviewed release before the authored status and check elements
can be used. Desktop/mobile screenshot approval, staging-qa save-flow checks,
and manual acceptance remain pending. No live save was verified or profile data
written during this cleanup. Publication remains a separate step; Review
Requests remains outside this cutover.

Focused tests:

```sh
node --test v3/starter-edit-profile/profile-section-validation.test.js \
  v3/starter-edit-profile/unified-*.test.js \
  v3/starter-edit-profile/unified-section-switching.test.js \
  starter-edit-profile.test.js
```

### Open items

- The status node and the "Check saved state" button are unstyled when the
  scripts fall back to creating them. The test page's saved Designer tree now
  authors both with `profile-items-status` and `profile-items-check-save`; the
  live `/starter-edit-profile` page still needs the same authoring before
  cutover.
- `v3/build-profile/portfolio-crud.js` still states a 50 MB video limit. That is a
  separate page and was not changed here.

### Test helpers

`v3/test-helpers/edit-profile-controller.cjs` and `v3/test-helpers/form-dom.cjs`
are Node-only harnesses shared by these tests. Like
`v3/test-helpers/authored-booking-receipt.cjs`, they are never served to a
browser and are not part of the repository script inventory.

## Release verification

Implementation, automated, and live evidence for the in-flight reliability
workflow is tracked in [PROGRESS-CHECKLIST.md](PROGRESS-CHECKLIST.md).

1. Recapture the official element tree and authenticated published structural
   inventory, compare both with `published-form-contract.json`, and stop on
   unexplained drift.
2. Run the published-form contract, controller behavior, ownership, syntax, and
   browser-secret tests.
3. For the shared profile-photo asset, follow the server-idempotency and cutover
   gate in the [authoritative upload contract](../build-profile/README.md#profile-photo-upload-contract).
   Release the other approved assets through no-mistakes, semver, and jsDelivr
   purge.
4. Save exact complete-location backups and compare the validation block with the
   whole-block sentinel inventory.
5. Remove only the exact inline validation owner after the CDN candidate is served;
   read the complete saved location back before publish.
6. Publish staging only with approval. Test empty visible fields, empty mirrors,
   hydrated unchanged saves, full/consult branches, location transitions, reviewer
   tuples, the editable canonical Free and Paid Call controls,
   explicit save responses with pending and complete projection states, and
   computed pointer behavior.
7. For the shared-foundation extraction, use only the atomic route page-Head-Code cutover in
   [`../profile-form/README.md`](../profile-form/README.md). Do not install one extracted loader at
   each former inline node. The six earlier provenance-locked controller replacements keep their
   existing positions and remain a separate scope.
8. Verify current network responses, console-only diagnostics, and no unexpected
   Xano writes. Obtain separate approval before production publish and repeat QA.
9. Scan every authorized published domain for Airtable, Make, and PAT exposure patterns.

## Step 1 and step 5 validation (pickers) since 2026-09-07

Step 1 no longer reads `#function-required` / `#roles-required` / `#subcategories-required`, and step 5 no
longer reads `#skills-required` / `#tools-required`. Those rules are `kind: 'group'` (step 1: functions min 1 for
both types, roles min 1 Full only, subcategories min 1 Consult only; `#profile-photo-url` stays a mirror): the controller counts selected chips (`[ms-code-select="tag"]`) inside
`[select-wrap-entity="skills"]` (minimum 3) and `[select-wrap-entity="tools"]` (minimum 2), for Full
profiles only. `syncSelectionGroupBounds(type)` mirrors that minimum onto each wrapper as
`wf-validate-min` (and removes it for Consult), so `utils/wf-validate.js`, which the wrappers opt
into with `wf-validate-element="group"`, gates the tab 5 save with the same rule. The mirror inputs
stay authored in Webflow because the shared picker widget and the Build pages still write them;
this controller's step 1 and step 5 picker rules stopped depending on them. Failure code: `GROUP_MIN_NOT_MET`.


## Proposed step 6 availability group (PR only)

Step 6 counts `[ms-code-select="tag"]` chips inside
`[select-wrap-entity="availability"]`. Full profiles require at least one chip.
Consult profiles have no availability minimum. The controller no longer reads
`#availability-required`; that mirror stays authored for existing picker writers.
A stale nonempty mirror cannot pass an empty picker, and an empty mirror cannot
block a selected picker. `syncSelectionGroupBounds` sets `wf-validate-min="1"`
for Full and removes it for Consult. Failure code: `GROUP_MIN_NOT_MET`.

The `[name="rate"]` and `nativeGroup` rules remain unchanged. The call fields stay
editable and un-required, owned by the canonical settings controllers described above.
The existing single-select widget owns the maximum; this controller change adds no new
maximum check.

This PR does not change Webflow attributes or enable the pane 6 library Save gate.
A later approved Webflow change would set `wf-validate-element="group"`,
`wf-validate-name="availability"`, and `wf-validate-max="1"` on wrapper
`5734d97a-4a61-f0bf-9cfe-da0731689859` on page `6a44b2477e93b2d11b905de0`.
Do not author a minimum; the controller sets it by profile type. Whether pane 6
gets a submit marker remains a separate decision.

JP must explicitly approve merge, tag, each Webflow write, and each whole-site
production publish in this session. Check the latest tag's target before tagging.
Compare jsDelivr `@latest` body hashes with the release files before changing
any `?v=` cache key. A PR and local tests are not deployed-runtime proof.
