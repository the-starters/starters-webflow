# Brand Account Build And Edit Wiring

## Authority

- Memberstack owns member identity, login email, custom fields, plan state, and
  profile image.
- Xano `brands_v3` is the canonical operational Brand profile.
- Memberstack member ID is the only normal sync key. Never match an update by
  mutable email or name.
- Xano endpoint #1513 is the single normal Memberstack-to-Xano writer. Browser
  code must not create a competing `brands_v3` writer.

## Native markup contract

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
compatibility, but the controller writes its value explicitly as the final
durable member write, before the non-retried password-email attempt.

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

The endpoint #1513 backend replay prerequisite below has passed. Keep the
frontend install unpublished until the remaining Build/Edit inbox and token-
redemption canaries pass.

## Executed endpoint #1513 replay results

The prerequisite backend replay gate passed using redacted Memberstack Test Mode
evidence. The normalized published endpoint SHA-256 was
`ed5062608ce2566ad838f64d064c894dd17ca3d4f989f1e06d32a6f70c27e880`. A full
captured current `member.updated` payload was processed in 270 ms; its exact
replay returned `skipped_stale_or_replay` in 40 ms, and a fixture one millisecond
older was also skipped.

Canonical readback found exactly one `user_v3` row and one `brands_v3` row keyed
by the stable Memberstack member ID, with aligned snapshot fields and equal event
watermarks. Bounded live-route current, replay, and older calls all returned HTTP
200; replay and older events were skipped, no duplicate rows were created, and
zero marketing calls occurred. The immediate 15-minute monitor was healthy. In
the post-release 30-minute window, eight organic live `member.updated` events and
three recorded Test Mode canaries all returned HTTP 200 with
`operationally_healthy=true`.

This satisfies the prerequisite backend replay gate. It does not constitute the
still-pending frontend Build/Edit inbox and token-redemption canaries, which
remain required before publishing the frontend install.

## Configuration switch

Memberstack's browser SDK owns the reset/set-password email call. Its Admin API
does not expose a server-side reset-email action, so this controller deliberately
does not depend on or claim a durable email outbox. Do not add an automatic retry
around `sendMemberResetPasswordEmail`; a lost response is ambiguous and retrying
could send a second message.

Use Brand-scoped ownership when the controller is installed sitewide:

```html
<script>
  window.StartersBrandAccountConfig = {
    guardSecurityForm: 'brand'
  }
</script>
```

- `guardSecurityForm: 'brand'`: resolve the current member through
  `window.StartersV3RouteGuard.memberRole` and take capture-phase ownership of
  `#wf-form-Account-Security` only for `brand-free` or `brand-paid`. Talent,
  unmapped, conflicted, logged-out, or unreadable identity states retain the
  existing Memberstack-native handler.

The ordinary Account Profile form remains Memberstack-native. Endpoint #1513
must mirror its `member.updated` payload into `brands_v3`.

## Failure semantics

- Invalid authored fields do not call Memberstack.
- Duplicate submits while one save is running are ignored.
- Custom-field and email assignments retry once only on timeout, 429, or 5xx.
- Build Account writes ordinary fields, any changed login email, and the
  completion marker before attempting one reset/set-password email.
- Account Security attempts that email only after a changed login email has
  been saved successfully.
- No separate verification email is sent. Successful redemption of the one
  reset/set-password link is the email-ownership proof.
- Reset-email delivery is an external, non-idempotent browser side effect. The
  controller records the normalized target in an in-memory per-form marker
  before calling Memberstack and will not attempt that target again during the
  same page lifecycle, including after a timeout or lost response. It never
  automatically retries the email call across a reload or new session and does
  not claim mathematically exactly-once delivery.
- If the reset-email result is failed or ambiguous, the durable account changes
  remain saved and the UI directs the member to the standard Forgot Password
  flow for an explicit recovery attempt.
- Successful password-token redemption is the ownership proof. The controller
  does not claim Memberstack `verified=true` without separately observed state.
- `completed-brand-profile` is the final durable Build Account write. Any
  earlier account-write failure leaves the member on onboarding for a safe
  idempotent replay; an email failure occurs only after completion is durable.
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
6. Change to the approved canary email; prove one reset/set-password message and
   matching Xano values.
7. Simulate an ambiguous Build Account email response after the completion
   write; prove a same-page resubmit performs no second email attempt, preserves
   the completed account, and can continue to the dashboard.
8. Simulate an ambiguous Account Security email response after the auth
   mutation; prove the saved email remains authoritative and a same-page
   resubmit performs no second email attempt. Prove Forgot Password can issue a
   fresh recovery link when the member explicitly requests one.
9. Replay duplicate and out-of-order webhook fixtures; prove no stale overwrite.
10. Run the read-only reconciliation and require zero unexplained differences.

Production canaries require separate approval for the exact member, email,
expected message, rollback, and any marketing projection.
