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
resolution, selector reads, event binding, network reads, uploads, or writes.
This route gate prevents a nested or stale Build loader from claiming the native
Edit Profile Work Highlights controls. Do not replace it with a DOM marker or a
first-loader-wins flag because Build and Edit intentionally share the same
Designer selectors.

`bio-editor.js`, `field-counters.js`, and `company-experience-crud.js` have
deliberately diverged from the inline bodies they were captured from. The bio limit is
now 1500 **characters** rather than 300 words, the editor owns its counter group, and
the generic counter stands down for any `.form_input-wr` holding a `[data-editor-id]`
element. The company controller carries the work-experience date fix, whose contract is
shared with Edit Profile and owned by
[Company experience date hydration](../profile-form/README.md#company-experience-date-hydration).
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
the active draft. Existing draft keys always win, including intentional empty
or false values. It does not persist Memberstack JSON, localStorage, or Xano
data; the native wizard keeps ownership of capture and persistence after human
input.

## Profile-photo upload contract

The controller accepts only JPG/JPEG, PNG, and WebP files. Each file may be no
larger than 4 MB (4 × 1024 × 1024 bytes). It rejects unsupported formats and
larger files before it creates an upload intent or starts an upload.

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

After Xano returns both canonical image URLs, the photo commit is complete. The
controller restores the authored draft-capture attribute and updates the hidden
photo URL before it attempts the cosmetic Memberstack avatar sync. An avatar-sync
failure is logged but does not fail the saved profile, show retry UI, or repeat the
canonical upload.

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

The extracted final submit writer is now a declared behavior-change candidate. It
keeps the existing normalized profile payload, availability fields, and paid-call
fields, and adds only the profile-save and pending-photo commit gate described in
[Profile-photo upload contract](#profile-photo-upload-contract). The separate
outcome observer still does not change its request or payload.

This exclusion is a release boundary, not proof that the remaining inline code is acceptable long term.

## Release verification

1. Verify every file passes `node --check` and the exposure scan.
2. Confirm the Xano writer's server-side idempotency gates have passed; until
   then, stop after GitHub candidate validation with no semver release,
   jsDelivr purge, or Webflow publish.
3. After those gates pass and the cutover has separate approval, release
   through no-mistakes, semver, and jsDelivr purge.
4. Back up every exact Webflow Code Embed block before replacement.
5. Recapture both pages and replace only a block whose script position, character count, and SHA-256 match `live-body-provenance.json`.
6. Publish staging first, then use human-like clicks for photo, portfolio, work history, counters, bio, and grouped selects without submitting the full profile.
7. Confirm each loaded response is a non-cached current release, then publish production and repeat the safe checks.
8. With an approved Talent canary on each Build Profile route, use a human-like click to submit the native form. Confirm one writer request and clean authored success copy that stays put with no automatic navigation, then click the authored "Start onboarding" CTA and confirm it lands on `/starter-onboarding`; verify the canonical Xano record and its projection after each submit.
9. Scan both published domains for Airtable, Make, and PAT exposure patterns.
