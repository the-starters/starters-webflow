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
remain separate shared-component work. On step 6, the page controller disables and
un-requires the legacy Free Call toggle and description plus the Paid Call toggle,
description, and rate. It omits all five fields from the profile payload and adds a
link to `/starter-dashboard#calendar`. The dashboard Free and Paid Call settings
controllers and their canonical Xano endpoints are the only member-facing writers
for those services; see the [Free Call settings contract](../../docs/wiring/FREE-CALL-SETTINGS-WIRING.md)
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
- `unified-companies.js` before `company-experience-crud.js`.
- `unified-highlights.js` before `portfolio-crud.js`.

### Authored markers

These must exist in Webflow:

| Attribute | Where | Notes |
| --- | --- | --- |
| `profile-unified-items="services\|companies\|highlights"` | Section | Opts the section in |
| `profile-items-add` | Section | Add-entry control |
| `profile-items-discard` | Section | Discard-changes control |
| `profile-items-presence` | Section | Optional; gates Save only when it carries `required` |
| `profile-items-media="images\|videos"` | Row | Highlights only |
| `profile-items-summary` | Row | Authored for companies and highlights; created by the script for services |

The scripts create `profile-items-status`, `profile-items-check-save`,
`profile-items-undo`, `profile-items-removed`, and `profile-items-dirty`.

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
section — a Free or Paid Call control the dashboard writers own, a picker's own search box —
belongs to the script that writes that field and never pauses this section's Save.

`data-non-required="<profile type>"` is the authored way to say a field is not asked of that
profile type, and `starter-edit-profile.js` clears `required` on those fields for the active
`window.activeProfile.type`.

**The report does not depend on the active profile type.** The only fields whose `required`
`starter-edit-profile.js` rewrites at runtime are the ones carrying `data-non-required`, and
those are reported whatever `required` currently says (below). Every other field keeps the
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

### Limits

Services allows three entries. Work Experience allows three entries. Highlights
allows nine entries, each with five photos at 4 MB each and three videos at 40 MB
each, which is the endpoint limit; the UI allowed 50 MB before 2026-09-17.

### Test page state

The Designer page "Starter Edit Profile Test" (`/starter-edit-profile-test`,
unpublished) has Required set on `company-name`, `company-position`,
`edit-company-name`, `edit-company-position`, `service-name`, `service-price`, and
`rate-retainer`, and `form-xano-required` on the same seven fields. The markers
and the script loaders are not installed on it yet.

Focused tests:

```sh
node --test v3/starter-edit-profile/profile-section-validation.test.js \
  v3/starter-edit-profile/unified-*.test.js \
  v3/starter-edit-profile/unified-section-switching.test.js \
  starter-edit-profile.test.js
```

### Open items

- The status node and the "Check saved state" button are created by the scripts
  with no class hooks, so both are unstyled until they are authored or classed in
  Webflow.
- `v3/build-profile/portfolio-crud.js` still states a 50 MB video limit. That is a
  separate page and was not changed here.
- `renderMedia` in `unified-highlights.js` has no fallback for a stored media row
  that arrives without a URL.

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
   tuples, the disabled legacy Free and Paid Call controls and settings link,
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

The `[name="rate"]` and `nativeGroup` rules remain unchanged. The controller
continues to disable legacy call fields. The existing single-select widget owns
the maximum; this controller change adds no new maximum check.

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
