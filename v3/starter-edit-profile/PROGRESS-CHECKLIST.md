# 🧭 Starter Profile Reliability Progress Checklist

Last updated: 2026-09-03

This checklist tracks release-safe implementation evidence for the
`/starter-edit-profile` reliability workflow. The workspace operator checklist
tracks live Webflow and browser evidence. The behavior contracts themselves live
in [README.md](README.md) and in the root
[Current Scripts](../../README.md#current-scripts) entry for
`starter-edit-profile.js`; this file only records what has been proven.

## ✅ Completed implementation

- [x] Send canonical integer `0` for a blank Retainer Rate while retainers are off.
- [x] Send canonical integer `0` for a blank Hourly Rate only while the authored
      `[name="rate"]` control is not required.
- [x] Leave a blank rate whose owning control is still live unchanged, so an empty
      required rate keeps failing instead of persisting a zero rate.
- [x] Pass every non-blank rate value through to Xano unrewritten.
- [x] Keep the authored Services and Rates markup intact while the controller disables
      the legacy Free and Paid Call controls and adds a link to Call Settings.
- [x] Omit the legacy Free Call toggle and description plus the Paid Call toggle,
      description, and rate from every step 6 profile payload.
- [x] Require `saved: true` and a Boolean `projection_pending`, show success after the
      canonical save even when public projection is pending or reports a later non-2xx
      failure, and fail closed when a 2xx response omits either confirmation.
- [x] Hydrate a stored work-experience date onto its correct calendar day instead of
      letting jQuery UI read it as a relative day offset, and keep the `Present`
      sentinel out of the picker. Contract:
      [Company experience date hydration](../profile-form/README.md#company-experience-date-hydration).
- [x] Re-serialize an untouched work-experience date as its original canonical string,
      so editing another field cannot rewrite a stored date.
- [x] Preserve the instant-live Work Highlight update and shared-modal restoration
      contract owned by [README.md](README.md#in-place-loader-replacements).
- [x] Preserve the [Work Highlight modal lifecycle](README.md#work-highlight-modal-lifecycle).
- [x] Preserve an untouched canonical phone byte-for-byte, treating both `input` and
      `countrychange` as a member edit. Contract: the root
      [Current Scripts](../../README.md#current-scripts) entry for `starter-edit-profile.js`.
- [x] Resolve Personal Details email and phone by their step-scoped `#email` and
      `#phone` IDs so hidden duplicate-name controls cannot override the authored
      values. Contract: [Validation and submit ownership](README.md#validation-and-submit-ownership).
- [x] Clear a declined Retainer's description and rate only when the member switches
      that toggle off, so hydration preserves stored retainer copy.
- [x] Open the profile-photo chooser by mouse or keyboard when Webflow rendered the
      upload surface as something other than a native `<label>`. Contract:
      [Profile-photo upload contract](../build-profile/README.md#profile-photo-upload-contract).
- [x] Require an explicit taxonomy selection instead of auto-adding a typed exact
      match on fill, on a comma, or on blur, and keep the Custom Service hidden
      capture JSON synchronized when a field is cleared. Contracts:
      [Inline extraction candidate](../profile-form/README.md#inline-extraction-candidate).
- [x] Give the Also Worked With search race-safe, non-stranding feedback. Contract:
      [In-place loader replacements](README.md#in-place-loader-replacements).
- [x] Make exactly one Work Highlight image authoritative as the cover and send it as
      `cover_image_id`. Contract: [Work Highlight cover image](README.md#work-highlight-cover-image).

## 🧪 Automated evidence

- [x] Legacy Free and Paid Call controls are disabled and un-required, link to Call
      Settings, and never contribute fields to the step 6 payload.
- [x] Disabled Retainer rates submit `0`, and configured Retainer rates on the same
      step submit unchanged.
- [x] A blank Retainer rate whose toggle is still on submits its authored blank value
      untouched.
- [x] Explicit complete and pending projection responses show success after a
      canonical save, including a pending response with non-2xx status; missing save
      or projection confirmation shows the error state.
- [x] An optional blank Hourly Rate submits `0`, a populated Hourly Rate submits
      unchanged, and a required blank Hourly Rate issues no request at all.
- [x] Both route copies of the company controller hydrate every shape the contract
      accepts onto the right calendar day, refuse a value neither the canonical shapes
      nor the widget's own `dateFormat` can parse, keep `Present` out of the picker and
      the baseline, and preserve untouched canonical date strings while a changed field
      still submits its new value.
- [x] Portfolio update submissions use the instant-live copy until close, while
      create-only and delete-only submissions keep the shared generic copy.
- [x] An untouched canonical phone submits unchanged while an `input` or a
      `countrychange` submits the `intl-tel-input` value, and the authored contact
      controls win over hidden duplicate-name controls in the submit payload.
- [x] Hydration keeps a declined Retainer's stored description across repeated passes,
      still hides and un-requires its controls, and only a member toggle clears it.
- [x] A non-`<label>` upload surface opens the chooser on a mouse click and on `Enter`.
- [x] Typing an exact taxonomy option name never selects it, and clearing a Custom
      Service field writes the cleared value into its hidden capture JSON.
- [x] A slow Also Worked With search reports progress, a superseded request is
      cancelled, an abandoned or superseded response never writes over the dropdown,
      and a progress or error message is never cached as a result for its query.
- [x] The Work Highlight editor normalizes to exactly one cover from either source and
      sends that stored image's ID as `cover_image_id`.

Run this coverage with:

```sh
node --test starter-edit-profile.test.js
node --test starter-edit-profile-service-toggles.test.js
node --test v3/profile-form/company-experience-date-hydration.test.js
node --test v3/profile-form/company-search-race.test.js
node --test v3/profile-form/taxonomy-explicit-selection.test.js
node --test v3/profile-form/incremental-dropdowns-capture-sync.test.js
node --test v3/build-profile/profile-photo-upload-intent.test.js
node --test v3/starter-edit-profile/portfolio-pending-success.test.js
node --test v3/starter-edit-profile/portfolio-modal-state.test.js
```

## 🚀 Release and live verification

- [ ] No-mistakes review, tests, documentation, lint, PR, and CI pass with no findings.
- [ ] Release the asset through the [release verification](README.md#release-verification)
      sequence, including the tag, jsDelivr purge, and served-byte comparison.
- [ ] Confirm on the published page that legacy Free and Paid Call controls are
      disabled, the settings link routes to `/starter-dashboard#calendar`, no Free or
      Paid Call profile fields are sent, and turning retainers off saves canonical `0`
      without changing stored Call Settings.
- [ ] Confirm endpoint #1499 returns `saved: true` with a Boolean
      `projection_pending`; verify pending and complete projection states show profile
      success, including the documented canonical-save response with non-2xx status,
      and verify a 2xx response without the full contract fails closed.
- [ ] Retest the published Work Experience flow: an existing record reopens on its
      stored date, including a day-precision record on its exact day, a current role
      still reads `Present`, and saving an unrelated field leaves both stored dates
      unchanged in Xano.
- [ ] Retest an existing Work Highlight update in production against the
      [authoritative success-copy contract](README.md#in-place-loader-replacements),
      confirm the edit is live immediately, and confirm the shared generic copy
      returns after close.
- [ ] Retest the published Edit Profile flow against each contract above: an
      untouched phone and a declined service's description survive a save and a
      reload, the photo chooser opens by mouse and by keyboard, a typed taxonomy
      name is not added without an explicit selection, a cleared Custom Service
      field persists as cleared, a slow Also Worked With search reports progress, a
      newer query cancels its predecessor without showing an error, no search strands
      a message, and the chosen Work Highlight cover is the one the live hire page
      shows. Restore any canary data afterwards.

## 🛑 Stop conditions

- Stop if a rate the member can still see and edit is rewritten by the controller.
- Stop if the published Webflow form has to change to enforce the runtime Paid Call
  ownership boundary.
- Stop if the workflow needs provider apply, provider record deletion, repair,
  storage deletion, or external messaging; all of those stay disabled.
