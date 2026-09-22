# Build Profile browser controllers

The native Webflow forms and their authored success/error elements stay in Webflow. Browser logic lives in this directory and is loaded from GitHub through jsDelivr.

The remaining inline Build Profile bodies now also have GitHub-owned extraction candidates. The
authoritative ownership, provenance, atomic page-Head-Code cutover, loader-order, and verification contract
lives in [`../profile-form/README.md`](../profile-form/README.md). This repository change does not
install or publish those candidates.

## Scoped migration

The files below are source-controlled candidates for self-contained controller blocks that are currently inline on both `/build-profile/consult` and `/build-profile/full-profile`. [`live-body-provenance.json`](./live-body-provenance.json) keeps the authenticated live-body capture separate from the instrumented Git candidate hashes. Its `pages` records are immutable readback evidence; its `candidateAssets` records identify the reviewed files that replace those blocks. Both pages produced the same nine captured body hashes.

| Original order | GitHub asset | Live inline body SHA-256 | Responsibility |
| --- | --- | --- | --- |
| 2 | `profile-photo.js` | `213646b19cc04f2b87375afeb303cc7ebe1f598cd5ffa4ce471b7c4ca895cf5c` | Authenticated profile-photo upload |
| 3 | `portfolio-crud.js` | `7ab803c9890b802f154c6f5c3f0a6d5906624f71b9683153b2f5798617e1070d` | Portfolio create, edit, delete, media, and previews |
| 4 | `portfolio-list.js` | `ddbc94bf09e237e7fc016b73c3ab0a4f361e38ba5105840c4c568886841b3255` | Portfolio list read and render |
| 5 | `company-autocomplete.js` | `eb426e9899ccfc9976c5eb061930f122d54542fa33f4453a0602aae48f842f4c` | Company and logo autocomplete |
| 6 | `work-dates.js` | `4d8aa2dbd4c7668f37430a73c92049a7a5fa566d99915f5e45a61be5dac0c321` | Work-date validation and current-role state |
| 7 | `company-experience-crud.js` | `6dc7fa7306d9558fb493cb6a6cfd6196659e0b7005c6d49831ffcc5f3261b5d3` | Company-experience CRUD |
| 12 | `field-counters.js` | `decbf5b49d1006f8a857602a33e2d89a6270fa8b9355d6311d16188f6a4bfe83` | Authored field counters, excluding editor-owned groups |
| 13 | `bio-editor.js` | `91671c4ed05806b2ed306f50c265954ef0c36714f59c77f721e2510370c9273f` | Bio editor, 1500-character limit, and counter ownership |
| 14 | `grouped-selects.js` | `e80bb01f28a43ebcb5b28e8ea733bac273985ddfa3235179cdfc6a9a5168ae84` | Grouped multi-select options |

`portfolio-crud.js` and `portfolio-list.js` own only the exact
`/build-profile/consult` and `/build-profile/full-profile` routes. They accept an
optional trailing slash and fail closed on every other path before member
resolution, selector reads, controller event binding, network reads, uploads, or
writes. The scripts still register their initial `DOMContentLoaded` listener.
This route gate prevents a nested or stale Build loader from claiming the native
Edit Profile Work Highlights controls. Do not replace it with a DOM marker or a
first-loader-wins flag because Build and Edit intentionally share the same
Designer selectors.

`bio-editor.js`, `field-counters.js`, `company-autocomplete.js`, `work-dates.js`, and
`company-experience-crud.js` have
deliberately diverged from the inline bodies they were captured from. The bio limit is
now 1500 **characters** rather than 300 words, the editor owns its counter group, and
the generic counter stands down for any `.form_input-wr` holding a `[data-editor-id]`
element. The company controllers carry the shared
[Company selection logo persistence](../profile-form/README.md#company-selection-logo-persistence)
and [Company experience date hydration](../profile-form/README.md#company-experience-date-hydration)
contracts owned by the profile-form documentation.
The `pages` records still hash the live blocks and must not be edited to match; `candidateAssets` tracks the
reviewed repo files, so the byte length and SHA-256 there move with each change and
`build-profile-ownership.test.js` fails until they do. The character contract itself is
pinned by [`bio-char-limit.test.js`](../../bio-char-limit.test.js), which also holds
the two surfaces to a character-for-character identical bio block.

The bio editor logs two staging-only `console.warn` messages when the authored counter
markup drifts: one when the field wrapper has no `.count-input` element, and one when
the text node after that element is not an authored `/<number>` denominator. Same
[staging-only gate](../../README.md#staging-only-console-diagnostics) as every other
console diagnostic here, and each is a warning only — a drifted counter never blocks
the editor or the save.

`canonical-profile-hydrator.js` is a supplemental fallback loaded by the
existing `profile-photo.js` asset. It does not replace an inline block. After
the legacy Memberstack/local draft initializes, it reads the canonical
`starter/get` profile through the authenticated browser fetch, verifies the
stable Memberstack ID before and after that read, maps the canonical
fields to the seven-step draft shape, and fills only keys that are absent from
the active draft. It also replaces a legacy array-shaped `also-worked-with`
draft with the canonical `Also_Worked_With_Picker` object. For an object-shaped
company-picker draft, it preserves the selected set and enriches only matching
entries with canonical company identity, source, and logo fields. Matching uses
the entity ID first, then the domain, then a normalized name with a compatible
source (the same source when the draft provides one); unmatched entries stay
unchanged, and omitted canonical companies are not restored. Outside those
company enrichment fields, existing draft keys win, including intentional empty
or false values. Canonical reviewer fields are adapted to the native draft
aliases (`fname`, `lname`, and `job`). At submit, the writer accepts those draft
aliases, the canonical aliases (`first-name`, `last-name`, and `position`), or a
mix of both, then emits the canonical reviewer shape without dropping the last
name or position. It does not persist Memberstack JSON, localStorage, or Xano
data; the native wizard keeps ownership of capture and persistence after human
input.

## Profile-photo upload contract

The controller accepts only JPG/JPEG, PNG, and WebP files. Each file may be no
larger than 4 MB (4 × 1024 × 1024 bytes). It rejects unsupported formats and
larger files before it creates an upload intent or starts an upload.

The authored upload surface opens the file chooser whether or not Webflow rendered
it as a native `<label>`. When it is any other element, the controller marks it
`role="button"`, gives it a `tabindex` when the markup supplies none, and forwards a
mouse click or an `Enter`/`Space` keypress to the hidden file input. A native
`<label>` keeps the browser's own behavior and gets no forwarding, so the chooser can
never be opened twice by one activation.

`profile-photo.js` creates a secure opaque `source_mutation_id` for each file
selection or drop. On Full Profile and Consult, selection prepares the upload but
does not send it. The submit writer first saves the authored profile payload and
then commits the pending photo with only the mutation ID and image in the upload
body. Starter Edit Profile keeps its immediate upload behavior.

A user retry of the same pending file keeps the same upload intent. The writer
reuses the completed profile save only while the authored payload is unchanged;
an edit after a failed photo commit requires a new profile save before the photo
is retried. Every explicit selection or drop creates a new intent, even when the
file metadata matches a prior choice. A returning Starter's stored photo URL stays
in draft capture until its replacement commits. If the browser cannot create a
valid ID, the controller fails closed before it starts the upload.

`profile-image-auth-shim.js` owns authentication and resizing for this upload
request. It rejects a missing or malformed
`source_mutation_id` before token trade or upload, removes any legacy
`member_id`, and resizes the image once. It caches that exact resized Blob for
the upload intent across visible user retries and clears it only after a `2xx`
JSON body contains non-empty `starter_image` and `starter_image_small` values.
On the one allowed `401` retrade, it reuses the same Blob and
`source_mutation_id`; it does not create a second upload intent. The existing
exact-host gate remains authoritative for `/starter-edit-profile`: non-Live
hosts block known mutations and preserve reads, as recorded in the
[V3 access matrix](../ACCESS-MATRIX.md#enforcement-layers).

After Xano returns both canonical image URLs, the photo commit is complete. Xano
endpoint #1390 owns the Memberstack `profileImage` write and stores the durable
Xano vault URL. The controller restores the authored draft-capture attribute,
updates the hidden photo URL, and refreshes the on-page navbar avatar from the
canonical `starter_image` URL. It does not write the Memberstack profile image.
This shared controller is loaded by `/build-profile/full-profile`,
`/build-profile/consult`, and `/starter-edit-profile`; the second provenance
manifest in `v3/starter-edit-profile/` pins the same file.

The GitHub assets and executable selection, drop, user-retry, auth-retrade, and
provenance checks may be prepared before the server change. Do not create a
semver release, publish either Webflow page, or activate the Xano writer until
the server-side idempotency gates pass and the cutover receives separate
approval.

`submit-diagnostics.js` is an additional outcome loader, not a replacement for
an inline block. It watches the existing human click on `[form-submit]` and the
authored `[build-profile-success]` / `[build-profile-error]` states. It does not
read fields, intercept the click, or change the coupled writer. It also does not
navigate. Once the authored success state appears it stays there, and the member
moves on by clicking the authored success-state CTA ("Start onboarding", which
links to `/starter-onboarding`). That CTA already exists on both pages and owns
the navigation, so the observer only records the outcome.

Because nothing navigates away any more, the module owns its own teardown. The
authored success state is terminal: once observed, the MutationObserver
disconnects and later submit clicks are ignored, so a second click cannot re-arm
a receipt and inherit the still-visible success state. An authored error is not
terminal, since the member may fix the form and retry; outcomes are edge-triggered
on a state change, so a stale visible error is never charged to the retry that
follows it. Errors stay on the form.

Because the CTA is now the only way out of a successful submit, a success state
with no link to `/starter-onboarding` is a dead end. The module logs a
[staging-only](../../README.md#staging-only-console-diagnostics) `console.warn` in
that case. It is a warning only and never blocks init. The same invariant is
enforced at release time by
`build-profile-wiring-audit.js`, which also owns the exact rule the CTA's `href`
has to satisfy — see [Build-profile Videsigns wiring audit](../../README.md#build-profile-videsigns-wiring-audit).

Replace each exact inline block in place with its matching deferred loader. Do not consolidate or reorder these loaders: the untouched blocks between them still supply shared globals and form state.

The sitewide `v3/native-form-diagnostics.js` loader must run before these
deferred mutation assets so their photo, portfolio, and company-experience
requests can emit receipts. The root [Current Scripts](../../README.md#current-scripts)
section owns that shared loader contract.

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/profile-photo.js"></script>
```

Use the same URL pattern for the other eight files.

Add the observer loader after the final writer on both pages:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/submit-diagnostics.js"></script>
```

## Deliberately excluded

These live blocks stay unchanged while Elvin owns availability, booking, and paid-call work:

- the shared profile/session foundation;
- draft restore and incremental dropdown state;
- page validation and rate formatting that is coupled to those fields;
- Consult and Full Profile call/retainer visibility controllers.

The extracted final submit writer keeps the existing normalized profile payload
and availability fields. It never sends `free_call`, `free_call_desc`,
`paid_call`, `paid_call_desc`, or `paid_call_rate` to the profile endpoint.
Instead, Build Profile validates its visible Call Settings controls and stores a
private, member-bound Call Settings receipt that Dashboard and Edit Profile
materialize. [Call Settings receipt lifecycle](#call-settings-receipt-lifecycle)
owns that contract, including where this writer's receipt write sits relative to
the canonical profile save and the pending-photo commit. The writer
also treats the monthly-retainer section as profile-type-inapplicable on
Consult: hidden hydrated radio/rate values always submit `retainer: false` and
`retainer_rate: 0`. The hidden hourly rate is inapplicable on Consult in the same
way: an in-contract value is persisted, and a malformed, unsafe, or out-of-range
one submits `hourly_rate: 0` rather than blocking. Full Profile continues to
validate an enabled retainer and its required hourly rate. It enforces the
[whole-dollar price contract](../profile-form/README.md#whole-dollar-price-contract)
on the hourly, retainer, and service prices before it builds the
request, instead of rounding a parsed number, and reveals the authored error
block when a submit does not complete. Every failure — a rejected price, a
rejected request, a non-ok response, a malformed success body, a rejected or
unstorable Call Settings receipt, or a failed photo
commit — clears the step loader as it reveals that block, so the error state is
never left behind a spinner.
Its other behavior changes are the reviewer-alias compatibility described above,
the profile-save and pending-photo commit gate described in
[Profile-photo upload contract](#profile-photo-upload-contract), and a single
retry of the canonical write. Only a transport rejection - one that names a
browser fetch failure, so no response was received - is retried, once, after a
short wait and with the identical payload; every other rejection, including one
raised during the retry, keeps its own cause and the authored error copy. When
both attempts fail on transport the panel says the save could not be confirmed,
because a transport rejection does not prove the request never reached Xano. That
same ambiguity is why the retry depends on the server-side idempotency gate in
[Release verification](#release-verification).
The candidate also stops rewriting the authored success-state CTA. The live inline
body overrode that link with `freelancer-dashboard-url`, `freelancer-profile-url`,
or `/starter-dashboard`; the candidate leaves the authored `/starter-onboarding`
link the audit already requires in place, so the success state navigates where the
page author wired it and an already-onboarded member is forwarded on by
`v3/onboarding-done-redirect.js` instead of by the writer.
The separate outcome observer still does not change its request or payload.

The extracted shared foundation and incremental-dropdown candidates are declared
behavior-change candidates too, so the first two bullets above describe the *live*
inline blocks only. What each candidate changes is recorded once, in
[Inline extraction candidate](../profile-form/README.md#inline-extraction-candidate).

This exclusion is a release boundary, not proof that the remaining inline code is acceptable long term.

## Call Settings receipt lifecycle

This section is the single owner of the branch-agnostic Build Profile Call
Settings handoff. The
[Free Call settings contract](../../docs/wiring/FREE-CALL-SETTINGS-WIRING.md#build-profile-handoff)
and the
[Paid Call settings contract](../../docs/wiring/PAID-CALL-SETTINGS-WIRING.md#build-profile-handoff)
own only what differs per branch: which prerequisites gate an enable, and which
authored controls that branch's receipt part prefills.

Build Profile validates its visible Call Settings controls and stores a
versioned, member-bound `starter_call_settings_intent_v3` receipt in private
Memberstack JSON, with a separate `free` part and `paid` part. A receipt is not
an active service and is not a `freelancers_v3` projection. The active
environment-matched `nylas_configurations_v3` row and provider readback remain
the sole call authority. The visible Free description, Paid title, and Paid
whole-dollar rate report validation on their exact authored controls. The Paid
rate reuses the same `$1` through `$1,000` whole-dollar validator as the other
direct Build Profile price controls.

Dashboard and Edit Profile hydrate the receipt as a pending create, update, or
disable. A pending enable prefills that branch's controls without becoming
canonical state, and stays pending until the branch's prerequisites are ready
and the member selects Update. A pending receipt stays declinable before those
prerequisites are ready: selecting Off makes Update live so the member can
change their mind and submit it. A pending Yes leaves Update gated on the
existing scheduling and Stripe prerequisite checks.

Each consumer removes only its own part of the receipt; the other branch's
pending part is preserved. It consumes its part once canonical state matches the
member's choice, in one of three ways:

- after the canonical Call Settings endpoint returns exact readback;
- with no canonical write, on load, when canonical already satisfies the
  receipt's own choice exactly: an off choice with no active service, or an
  enable whose values the active service already holds — Free's public
  description, or Paid's title and whole-dollar USD rate. This is what repairs a
  receipt whose best-effort cleanup failed after a verified save, so it cannot
  re-assert Build Profile values over newer canonical ones;
- with no canonical write, on a submitted off choice while that branch has no
  active service, even when the receipt itself is still an unconsumed enable, so
  a declined Build Profile Yes cannot re-assert itself on the next load.

Cleanup after a verified canonical readback is best-effort: a failed cleanup
write never turns a successful canonical save into a profile-step failure, and
the unchanged receipt retries on reload. The no-service submitted-Off path is
different because no canonical write backs up the choice: its cleanup is strict.
If Memberstack cleanup fails, the controller keeps the receipt pending, reports
that the selection was not saved, and returns failure to Edit Profile. If the
latest canonical state is unavailable, it does not consume the receipt. That
strict cleanup holds the same write lock a canonical save holds, so a
prerequisite refresh raised while it is in flight is queued and reads the
post-cleanup state instead of re-asserting the receipt the member just declined;
a failed cleanup drops that queued refresh so it cannot erase the error.

The submit writer, the draft-state writer, and both receipt consumers share one
serialized `window.__tsMemberJsonWrite` read-modify-write boundary, so one
branch cannot overwrite another. A final-step draft save therefore cannot
overwrite the Call Settings receipt from the same click. A draft write also
abandons itself when its own Memberstack read fails, rather than persisting a
blob rebuilt from an empty read, so a transient read error cannot drop the
receipt or any other member JSON key.

Build Profile writes the receipt after the canonical profile save and before the
pending-photo commit, so a Call Settings storage failure keeps the accepted
profile save cached for the resubmit the panel asks for and leaves the pending
photo uncommitted until an attempt gets past that write.

Consuming a receipt must not invent unsaved work on Edit Profile. When an
already-satisfied receipt is consumed with no canonical write, the delayed
re-render runs inside `__tsProfileDirtyState.runHydrationSync`, so the synthetic radio
change cannot create an unsaved step-6 state. Each controller also records a
monotonic member-edit revision: if the member changes that branch's choice or
fields while receipt cleanup is in flight, the delayed re-render is skipped and
the unsaved member input stays visible and dirty.

The whole handoff — Build Profile storing the receipt, then Dashboard and Edit
Profile hydrating, consuming, and declining it — is exercised in Chrome against
the authored DOM by `node v3/browser-tests/call-settings-receipt.browser.cjs`;
set `CALL_RECEIPT_BROWSER_EVIDENCE=<dir>` to write screenshots and observations.
That fixture fakes only the Memberstack session and the Xano responses, so it
cannot establish production behavior.

## Release verification

1. Verify every file passes `node --check` and the exposure scan.
2. Confirm the Xano writer's server-side idempotency gates have passed; until
   then, stop after GitHub candidate validation with no semver release,
   jsDelivr purge, or Webflow publish. These gates are what makes the client's
   single transport retry safe: the retried attempt may be a replay of a POST
   that already landed, so the writer must collapse the duplicate reviewer and
   projection side effects rather than repeat them.
3. After those gates pass and the cutover has separate approval, release
   through no-mistakes, semver, and jsDelivr purge.
4. Back up every exact Webflow Code Embed block before replacement.
5. Recapture both pages and replace only a block whose script position, character count, and SHA-256 match `live-body-provenance.json`.
6. Publish staging first, then use human-like clicks for photo, portfolio, work history, counters, bio, and grouped selects without submitting the full profile.
7. Confirm each loaded response is a non-cached current release, then publish production and repeat the safe checks.
8. With an approved Talent canary on each Build Profile route, use a human-like click to submit the native form. Confirm one writer request and clean authored success copy that stays put with no automatic navigation, then click the authored "Start onboarding" CTA and confirm it lands on `/starter-onboarding`; verify the canonical Xano record and its projection after each submit.
9. Scan both published domains for Airtable, Make, and PAT exposure patterns.

### Photo upload during profile sync

On Build Profile and Starter Edit Profile, HTTP 500 with the exact message
`PROFILE_IMAGE_CAS_RETRY_EXHAUSTED` triggers automatic retries. A background
projection can hold the image commit lease longer than the backend's short retry
loop. The controller preserves the same encoded file and `source_mutation_id`,
shows a syncing message, and applies only a complete successful response.

Retries use exponential delays capped at 20 seconds, at most 12 retries, and a
three-minute scheduling budget. A request already in flight may finish after the
budget. Removing or replacing the photo cancels further retries for the old
intent. Other errors keep the existing manual retry path; the auth shim retains
its own single token-refresh retry. Backend lease, transaction, and idempotency
guards remain unchanged. This extends the existing shared photo controller and
its authored upload contract; no new page script or Webflow markup is required.

On either Build Profile route, removing or replacing a photo while
`commitPending()` is waiting causes that commit to reject when it resumes, so
the submit writer cannot show success for the obsolete selection. Submit the
profile again to commit a replacement; it remains prepared until then. An
already-sent request is not aborted, but its obsolete response is not applied
to the page.

Run `node v3/build-profile/profile-photo-upload-intent.test.js` to exercise busy
responses followed by success, stable mutation/file identity, all three page
paths, bounded exhaustion, terminal errors, and cancellation/replacement.

### Counted-field paste ownership

The profile counter and shared `wf-validate` limiter both handle paste. Each must
return when `event.defaultPrevented` is already set, so the first handler owns the
insertion and sends a bubbling input notification when it inserts text. This
applies to keyboard and context-menu paste. The second handler must not insert
again. The counter lives in `v3/build-profile/field-counters.js` for Build Profile
and in `starter-edit-profile.js` (Inline block 2) for Edit Profile.
`wf-validate.test.js` executes each actual counter with the shared validator in
both registration orders, covering character/word limits, production word-limit
attributes, full replacement, counters, caret, and one input notification. Run
`node --test wf-validate.test.js` after changing any of these handlers.

See the [shared validator reference](../../README.md#utilswf-validatejs) for
profile word caps, defaults, and their interaction with validator and native limits.
