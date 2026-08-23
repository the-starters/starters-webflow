# 🧭 Starter Profile Reliability Progress Checklist

Last updated: 2026-08-24

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
- [x] Show the pending-review confirmation after a Work Highlight update, keep the
      approved version described as live, and restore the shared generic modal copy
      after the modal closes.

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
- [x] Portfolio update submissions use the pending-review copy until close, while
      create-only and delete-only submissions keep the shared generic copy.

Run this coverage with:

```sh
node --test starter-edit-profile.test.js
node --test v3/profile-form/company-experience-date-hydration.test.js
node --test v3/starter-edit-profile/portfolio-pending-success.test.js
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
- [ ] Retest an existing Work Highlight update in production: the modal says the
      update is pending review, the approved highlight stays live, and the shared
      generic copy returns after close.

## 🛑 Stop conditions

- Stop if a rate the member can still see and edit is rewritten by the controller.
- Stop if any Webflow form, field, or control has to stop being Designer-native.
- Stop if the workflow needs provider apply, provider record deletion, repair,
  storage deletion, or external messaging; all of those stay disabled.
