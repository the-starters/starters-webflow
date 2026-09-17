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
profile-validation owner for its main section-submit buttons. It owns steps 1,
2, 5, 6, and 7 through an explicit published-markup contract. The Companies
controller owns step 3 and the Portfolio controller owns step 4. The configured
`v3/brand-account-controller.js` identity guard may capture a real changed-email
click on Personal Details, but it calls this controller's step 1 validator and
can only authorize one replay after Memberstack confirms the same member ID and
normalized login email. It does not add a second profile validator or Xano
writer. No other controller may disable, intercept, or validate the same submit
path.

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
clean. Inputs outside the profile steps cannot arm the warning.

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
with Add, Remove, Undo, Discard, and a single Save. The behavior contract lives in
`/Users/standarduser/Documents/starters-git/.scratch/starter-edit-profile-unified-items/spec.md`
in this workspace. Review Requests deliberately stays out of this pattern
(spec decision 18); it keeps the step 7 rules above.

### Globals and ownership

`profile-section-validation.js` publishes
`window.StarterProfileValidation = { bind, misconfigured }`. It was derived
independently from `utils/wf-validate.js` at v1.59.549 and keeps that validator's
native-constraint messages, blur and correction timing, and inline alerts. Unlike
the sitewide validator, a field belongs to a section and to its own DOM identity
rather than to a page-wide name group, and this module installs no submit gate.
The global `utils/wf-validate.js` is unchanged.

`unified-services.js` publishes
`window.StarterProfileSections = { bindServices, get }` and binds itself. It
prefers `window.waitProfileData` when that page embed has run; otherwise it polls
`window.activeProfile` for 10 seconds and, if the profile never arrives, stays
unbound rather than binding against missing data. It is keyed to
`[profile-unified-items="services"]`.

`unified-companies.js` and `unified-highlights.js` publish
`window.StarterProfileCompanies` and `window.StarterProfileHighlights`. They do
not self-bind: `company-experience-crud.js` and `portfolio-crud.js` bind them and
stay the writers. Each of those two controllers disables its own Save and returns
if the global (or the validator) is missing, so a half-loaded page cannot present
a live Save that writes nothing.

### Load order

- `profile-section-validation.js` before all three section scripts.
- `unified-services.js` before or alongside `starter-edit-profile.js`. If the
  `[profile-unified-items="services"]` marker exists but no controller registered
  for the step, the main controller fails closed with a "This section could not
  load" message rather than submitting.
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
Companies also reads the authored `[profile-company-search-results]` container for
its autocomplete results.

### The `form-xano-required` contract

Webflow authors put `form-xano-required` (empty value) on a field whose blank
value the Xano backend rejects. It never makes a field required. Requiredness
comes only from the Webflow Required checkbox.

`misconfigured(section)` returns the fields that carry `form-xano-required`
without `required`. Each section script runs that check at bind and load time and
again on Save. On a mismatch it pauses Save with
`This form is misconfigured. Saving is paused until it is fixed.` and logs one
`console.warn` naming the field attribute — never a field value. Discard stays
available, so a member is never trapped with edits they cannot clear.

### Save-state semantics

A received non-2xx response is a **known refusal**: the server message is shown,
the draft is kept, and Save and Discard stay enabled. A thrown or lost response is
**unknown**: the write may or may not have landed, so Save is paused until the
"Check saved state" control reconciles the section against a canonical read.

A failed initial load leaves the section readable rather than inert. Save and
Discard are refused until the page is reloaded.

### Limits

Services allows three entries. Work Experience allows three entries. Highlights
allows five photos at 4 MB each and three videos at 40 MB each, which is the
endpoint limit; the UI allowed 50 MB before 2026-09-17.

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
