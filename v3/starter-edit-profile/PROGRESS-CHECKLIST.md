# 🧭 Starter Profile Reliability Progress Checklist

Last updated: 2026-08-23

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

## 🧪 Automated evidence

- [x] Disabled Paid Call and Retainer rates submit `0`, and configured rates on the
      same step submit unchanged.
- [x] Blank Paid Call and Retainer rates whose toggles are still on submit their
      authored blank value untouched.
- [x] An optional blank Hourly Rate submits `0`, a populated Hourly Rate submits
      unchanged, and a required blank Hourly Rate issues no request at all.

Run this coverage with:

```sh
node --test starter-edit-profile.test.js
```

## 🚀 Release and live verification

- [ ] No-mistakes review, tests, documentation, lint, PR, and CI pass with no findings.
- [ ] Release the asset through the [release verification](README.md#release-verification)
      sequence, including the tag, jsDelivr purge, and served-byte comparison.
- [ ] Confirm on the published page that turning paid calls or retainers off saves the
      canonical `0` and that stored non-zero rates survive an unrelated save.

## 🛑 Stop conditions

- Stop if a rate the member can still see and edit is rewritten by the controller.
- Stop if any Webflow form, field, or control has to stop being Designer-native.
- Stop if the workflow needs provider apply, provider record deletion, repair,
  storage deletion, or external messaging; all of those stay disabled.
