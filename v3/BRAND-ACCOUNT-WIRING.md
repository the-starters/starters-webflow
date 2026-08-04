# Brand Account Build And Edit Wiring

## Authority

- Memberstack owns member identity, login email, custom fields, plan state, and
  profile image.
- Xano `brands_v3` is the canonical operational Brand profile.
- Memberstack member ID is the only normal sync key. Never match an update by
  mutable email or name.
- Xano endpoint #1513 is the single normal Memberstack-to-Xano writer. Browser
  code must not create a competing `brands_v3` writer.

## Published markup contract

The Build Account form remains native Webflow HTML:

```html
<form id="wf-form-Complete-Profile-Form" redirect="/brand-dashboard">
  <input name="First-Name" type="text" required>
  <input name="Last-Name" type="text" required>
  <input name="Email-Address" type="email" required>
  <input name="Company-Name" type="text" required>
  <input data-ms-member="completed-brand-profile" class="hide">
</form>
```

Do not add `data-ms-form="profile"` to this form while
`brand-account-controller.js` owns submit. Two Memberstack submit owners would
race. The hidden completion field remains authored for visibility and backward
compatibility, but the controller writes its value explicitly and last.

The upload link stays outside any Memberstack profile-form contract and is
bound by `complete-profile-photo.js` to:

```html
data-ms-action="profile-image"
```

If a native preview image is added, give it:

```html
data-complete-profile-image
```

The photo binder adds `data-ms-member="profile-image"` to that authored image.
It does not create an image element.

## Install order

On `/complete-profile`, after the sitewide Memberstack and route-guard installs:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/brand-account-controller.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/complete-profile-photo.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/complete-profile-redirect.js"></script>
```

Do not publish this frontend install before the matching endpoint #1513 draft is
published and its Test Mode replay matrix passes. Otherwise Memberstack changes
would still leave `brands_v3` stale.

## Configuration switches

Email verification is on by default. Account Security ownership remains off:

```html
<script>
  window.StartersBrandAccountConfig = {
    verifyChangedEmail: true,
    guardSecurityForm: false
  }
</script>
```

- `verifyChangedEmail`: after a changed login email succeeds, call
  `sendMemberVerificationEmail()`. This is the approved default. Set it to
  `false` only as a bounded rollback if verification delivery is degraded.
- `guardSecurityForm`: take capture-phase ownership of
  `#wf-form-Account-Security`. Enable only when removing the competing
  `data-ms-form="profile"` ownership from that form.

The ordinary Account Profile form remains Memberstack-native. Endpoint #1513
must mirror its `member.updated` payload into `brands_v3`.

## Failure semantics

- Invalid authored fields do not call Memberstack.
- Duplicate submits while one save is running are ignored.
- Custom-field and email assignments retry once only on timeout, 429, or 5xx.
- Verification email is never automatically retried because an ambiguous send
  response could otherwise emit a duplicate email.
- If an earlier attempt changed the address but failed before verification was
  confirmed, a replay sees Memberstack's `verified: false` state and requests
  verification again before allowing the completion marker.
- `completed-brand-profile` is written last. Any earlier failure leaves the
  member on onboarding for a safe idempotent replay.
- Error telemetry carries only operation path and HTTP status, never member ID,
  email, name, or company.

## Canary matrix

Run in Memberstack Test Mode first with an approved sandbox Brand identity:

1. Existing incomplete Brand submits unchanged email plus ordinary fields.
2. Read Memberstack, `user_v3`, and `brands_v3` back by Memberstack member ID.
3. Replay the identical submission; prove one Brand row and unchanged final
   values.
4. Change ordinary fields in Account Settings; prove both Xano rows converge.
5. Attempt an invalid email and an already-used email; prove no completion mark
   and no partial Xano email drift.
6. Change to the approved canary email; prove one verification message and
   matching Xano values.
7. Replay duplicate and out-of-order webhook fixtures; prove no stale overwrite.
8. Run the read-only reconciliation and require zero unexplained differences.

Production canaries require separate approval for the exact member, email,
expected message, rollback, and any marketing projection.
