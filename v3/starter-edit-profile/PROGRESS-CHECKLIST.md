# 🧭 Starter Profile Reliability Progress Checklist

Last updated: 2026-08-31

This checklist tracks release-safe implementation evidence for the
`/starter-edit-profile` reliability workflow. The workspace operator checklist
tracks live Webflow and browser evidence. The behavior contracts themselves live
in [README.md](README.md) and in the root
[Current Scripts](../../README.md#current-scripts) entry for
`starter-edit-profile.js`; this file only records what has been proven.

## ✅ Completed implementation

- [x] Send canonical integer `0` for a blank Paid Call Rate while paid calls are off.
- [x] Send canonical integer `0` for a blank Retainer Rate while retainers are off.
- [x] Send canonical integer `0` for a blank Hourly Rate only while the authored
      `[name="rate"]` control is not required.
- [x] Leave a blank rate whose owning control is still live unchanged, so an empty
      required rate keeps failing instead of persisting a zero rate.
- [x] Pass every non-blank rate value through to Xano unrewritten.
- [x] Keep the Services and Rates step Designer-native; the fix adds no form markup.
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
- [x] Clear a declined service's description and rate only when the member switches
      that toggle off, so hydration preserves stored Free Call and retainer copy.
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

- [x] Disabled Paid Call and Retainer rates submit `0`, and configured rates on the
      same step submit unchanged.
- [x] Blank Paid Call and Retainer rates whose toggles are still on submit their
      authored blank value untouched.
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
- [x] Hydration keeps a declined service's stored description across repeated passes,
      still hides and un-requires its controls, and only a member toggle clears it.
- [x] A non-`<label>` upload surface opens the chooser on a mouse click and on `Enter`.
- [x] Typing an exact taxonomy option name never selects it, and clearing a Custom
      Service field writes the cleared value into its hidden capture JSON.
- [x] A slow Also Worked With search reports progress, an abandoned or superseded
      response never writes over the dropdown, and a progress or error message is
      never cached as a result for its query.
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
- [ ] Confirm on the published page that turning paid calls or retainers off saves the
      canonical `0` and that stored non-zero rates survive an unrelated save.
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
      field persists as cleared, a slow Also Worked With search reports progress and
      never strands a message, and the chosen Work Highlight cover is the one the
      live hire page shows. Restore any canary data afterwards.

## 🛑 Stop conditions

- Stop if a rate the member can still see and edit is rewritten by the controller.
- Stop if any Webflow form, field, or control has to stop being Designer-native.
- Stop if the workflow needs provider apply, provider record deletion, repair,
  storage deletion, or external messaging; all of those stay disabled.
