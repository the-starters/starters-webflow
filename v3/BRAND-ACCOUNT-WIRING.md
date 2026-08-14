# Brand Account And Starter Email Wiring

## Authority

- Memberstack owns member identity, login email, custom fields, plan state, and
  profile image.
- Xano `brands_v3` and `freelancers_v3` are the canonical operational role
  profiles for Brand and Talent members, respectively.
- Memberstack member ID is the only normal sync key. Never match an update by
  mutable email or name.
- Xano endpoint #1513 is the single normal Memberstack-to-Xano writer. Browser
  code must not create a competing role-profile writer.

## Native markup contract

The native standard and quiz Brand signup forms remain Designer-authored
Webflow HTML. Keep their Memberstack signup contracts on the forms themselves:

```html
<form
  id="wf-form-Brand-Signup"
  data-ms-form="signup"
  data-ms-plan:add="pln_free-plan-f6kn0dxz"
>
  <!-- Designer-authored fields and controls -->
</form>
```

```html
<form data-quiz-form="signup" data-ms-form="signup">
  <!-- Designer-authored quiz signup fields and controls -->
</form>
```

Before Memberstack handles signup, `brand-account-controller.js` changes only
the plan attribute on both matching forms for the active Memberstack data mode:

| Host | `data-ms-plan:add` |
| --- | --- |
| `the-starters-3-0.webflow.io` (Test Data) | `pln_dorxata-test-brand-plan-777r02pa` |
| `thestarters.com`, `www.thestarters.com` (Live Data) | `pln_free-plan-f6kn0dxz` |

The standard form's live plan remains the Designer-authored fallback. The
controller does not replace or generate either form, and it leaves an element
without `data-ms-form="signup"` untouched. The quiz form must also keep
`data-quiz-form="signup"`; this limits the broader attribute selector to the
quiz signup surface.

On `/quiz`, the final signup form can enter the DOM after the controller starts.
If that quiz form is not present at startup, the controller watches only for the
quiz signup selector above, applies the hostname-specific plan when the form
appears, and then disconnects the observer. It does not watch for late forms on
other paths, and the standard Brand signup form keeps its startup-only behavior.

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

The visible Talent edit-profile form also remains Designer-authored HTML and
keeps its existing authenticated Xano submission owner:

```html
<form id="wf-form-Build-Form-Full-Profile">
  <!-- Existing Designer-authored profile fields and controls -->
  <input type="email">
</form>
```

On `/starter-edit-profile`, the controller reads the form's first email input.
When the whole form is valid, it updates a changed Talent login email in
Memberstack and then replays the same native submission. When unrelated required
profile fields are incomplete, clicking submit still saves a natively valid,
changed login email through Memberstack without submitting the incomplete
profile to Xano. The guard only owns this click after a trusted user input event
changes the login email. The Xano profile prefill emits untrusted input events;
those events update the email baseline but do not activate identity ownership.
An unchanged email leaves every section click with the existing Xano profile
handler, even when required fields in other hidden tabs make the whole form
invalid. Keep `data-edit-submit` on the Designer-authored submit control and keep
that control directly inside its existing wrapper. The invalid-profile state
can disable pointer events on the control, so the controller recognizes the
click that lands on that direct wrapper; it does not treat higher ancestors as
submit targets. Invalid email input remains under the browser's native
validation. Do not add a second form, remove the existing Xano handler, or move
the login-email input outside this form.

## Install order

Install `brand-account-controller.js` sitewide, before Memberstack form
initialization, so it can align both native signup forms with Test or Live Data:

```html
<script>
  window.StartersBrandAccountConfig = {
    guardSecurityForm: 'identity'
  }
</script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/brand-account-controller.js"></script>
```

The `identity` setting is the production activation for Starter login-email
changes. Keep the configuration block before the controller script.

On `/complete-profile`, after the sitewide Memberstack and route-guard installs,
keep the photo and redirect scripts after that sitewide controller:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/complete-profile-photo.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/complete-profile-redirect.js"></script>
```

The endpoint #1513 backend replay prerequisite below has passed. Keep the
frontend install unpublished until the remaining Build/Edit inbox and token-
redemption canaries pass.

## Support diagnostic receipts

Build Account and guarded Brand/Talent login-email mutations use the shared
privacy-safe receipt contract owned by
[`../README.md`](../README.md#current-scripts). Before the mutation starts, the
controller attempts to load that helper from the same jsDelivr repository ref.
A helper load failure does not block the existing account workflow. Validation
failures remain distinct from attempted requests through the receipt's
`request_started` field.

Authored success and failure messages stay user-facing and do not show receipt
data or become copy actions. The latest receipts remain available from the
browser console through
`copyWorkflowDiagnostic('brand_account_build')`,
`copyWorkflowDiagnostic('brand_account_email')`, or
`copyWorkflowDiagnostic('talent_account_email')`. Do not add identity fields or
form values to these receipts; the shared README owns the exact allowlist and
exclusions.

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

Use identity-scoped ownership in production when the controller is installed
sitewide:

```html
<script>
  window.StartersBrandAccountConfig = {
    guardSecurityForm: 'identity'
  }
</script>
```

- `guardSecurityForm: 'identity'`: resolve the current member through
  `window.StartersV3RouteGuard.memberRole` and take capture-phase ownership of
  `#wf-form-Account-Security` for `brand-free`, `brand-paid`, or `talent`. On
  `/starter-edit-profile`, the same setting also guards the visible
  `#wf-form-Build-Form-Full-Profile` for Talent. A natively valid changed email
  can be written to Memberstack even while unrelated required profile fields
  are incomplete, without running the Xano profile save. On a valid full-profile
  submit, the email is written first and the existing Designer-authored submit
  is replayed so its authenticated Xano save continues unchanged. An unchanged
  email preserves native full-profile validation without an auth mutation or
  reset email.
- `guardSecurityForm: 'brand'`: resolve the current member through
  `window.StartersV3RouteGuard.memberRole` and take capture-phase ownership of
  `#wf-form-Account-Security` only for `brand-free` or `brand-paid`. This is the
  rollback switch if Starter interception must be disabled without changing
  Brand behavior.
- With either setting, unmapped, conflicted, logged-out, or unreadable identity
  states retain the form's existing native handler. Account Security therefore
  stays Memberstack-native, while `/starter-edit-profile` replays its existing
  authenticated Xano submission. With `brand`, Talent also retains that native
  path without login-email interception.

The ordinary Account Profile form outside `/starter-edit-profile` remains
Memberstack-native. Endpoint #1513 must route each `member.updated` event by
stable Memberstack member ID and mirror it into `user_v3` plus exactly one role
row: `brands_v3` for Brand roles or `freelancers_v3` for Talent. Email is
payload data, never a lookup or join key.

## Stable-ID propagation contract

A successful guarded login-email save changes Memberstack first. The resulting
`member.updated` event is the only normal trigger for downstream propagation;
the replayed Talent profile submission continues its existing Xano profile save
but is not a second login-email writer:

1. Endpoint #1513 deduplicates and orders the event by its event watermark,
   resolves the member by immutable Memberstack member ID, and updates `user_v3`
   plus the matching role mirror without creating or switching a role row.
2. The identity-projection worker updates an existing TalkJS user at the stable
   Memberstack user ID. It must not create an email-keyed TalkJS user; the normal
   messaging bootstrap retains creation ownership.
3. The outbox retains the stable Memberstack event context and the previous
   normalized-email hash. The Mailchimp adapter PATCHes only the existing old-
   email contact in the approved audience. It must not create or resubscribe a
   contact, change consent, or trigger a campaign, and it stops on an old/new
   contact collision.
4. Webflow is the presentation layer for this field. Account Security's
   existing `data-ms-member="email"` input rehydrates from Memberstack, while
   the existing Talent profile path rehydrates its authored email input after
   Xano convergence. This workflow does not create a Webflow CMS email writer
   or a second CMS item.

Endpoint acceptance is all-or-observable: a failed downstream projection must
be recorded for retry/reconciliation without rolling Memberstack back or
silently reporting convergence. Readback and reconciliation always start from
the Memberstack member ID and compare the expected email across every applicable
projection.

## Failure semantics

- Invalid Build Account fields do not call Memberstack.
- Duplicate submits while one save is running are ignored.
- A successful submit that actually initiated a redirect never releases the
  form. It stays `aria-busy="true"`, the submit button stays disabled, and the
  button spinner keeps running until the page unloads. `location.assign()` only
  queues a navigation, so the promise chain settles while the browser is still
  fetching the destination, and releasing there would hand the member back a
  live-looking form for the whole of that window. The `/complete-profile` submit
  loader ([`v3/COMPLETE-PROFILE-LOADER-WIRING.md`](COMPLETE-PROFILE-LOADER-WIRING.md))
  watches that attribute and depends on this.
- The latch is scoped to the path that called `location.assign()`. A successful
  submit with no redirect URL resolved, and every error, release the form as
  before. An `assign()` that throws also releases it.
- Accepted consequence: if the navigation is cancelled rather than completed
  (Stop pressed, a declined `beforeunload` prompt, a destination that does not
  navigate), the form stays locked and the submit button stays disabled until
  the member reloads. Before the latch the button always came back. This was a
  deliberate trade for masking the redirect, which is the common case; the
  cancelled-navigation case is rare and self-heals on reload.
- Custom-field and email assignments retry once only on timeout, 429, or 5xx.
- Immediately before each changed login-email write attempt, including a retry,
  the controller re-reads the current Memberstack member and compares its stable
  ID with the member that initiated the workflow. An account change aborts with
  `MEMBER_SCOPE_CHANGED` before `updateMemberAuth` can write into the new session.
- Build Account writes ordinary fields, any changed login email, and the
  completion marker before attempting one reset/set-password email.
- Account Security and the guarded Talent edit-profile form attempt that email
  only after a changed login email has been saved successfully.
- An independent Talent login-email save requires the authored email input to
  pass native constraint validation and the normalized email to differ from the
  current Memberstack login email. It does not bypass or submit unrelated
  invalid profile fields.
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
  flow for an explicit recovery attempt. On `/starter-edit-profile`, the native
  Xano profile submission is still replayed after that email-side-effect failure.
- Successful password-token redemption is the ownership proof. The controller
  does not claim Memberstack `verified=true` without separately observed state.
- `completed-brand-profile` is the final durable Build Account write. Any
  earlier account-write failure leaves the member on onboarding for a safe
  idempotent replay; an email failure occurs only after completion is durable.
- Existing account error telemetry still carries only operation path and HTTP
  status. Shared workflow receipts add only the README-owned allowlisted fields;
  neither channel carries member ID, email, name, company, tokens, headers, or
  request/response bodies.

## Brand canary matrix

Run in Memberstack Test Mode first with an approved sandbox Brand identity:

1. On `the-starters-3-0.webflow.io`, confirm the standard signup form carries
   the Test Brand plan at startup. Then let the `/quiz` signup form enter the DOM
   after page load, confirm it receives the same plan before submission, and
   prove the new Test Data member has that plan connection.
2. On each custom domain, confirm the standard form and the late-added `/quiz`
   form carry the live Brand Free plan. Creating a production member requires
   the separate approval described below.
3. Existing incomplete Brand submits unchanged email plus ordinary fields.
4. Read Memberstack, `user_v3`, and `brands_v3` back by Memberstack member ID.
5. Replay the identical submission; prove one Brand row and unchanged final
   values.
6. Change ordinary fields in Account Settings; prove both Xano rows converge.
7. Attempt an invalid email and an already-used email; prove no completion mark
   and no partial Xano email drift.
8. Change to the approved canary email; prove one reset/set-password message and
   matching Xano values.
9. Simulate an ambiguous Build Account email response after the completion
   write; prove a same-page resubmit performs no second email attempt, preserves
   the completed account, and can continue to the dashboard.
10. Simulate an ambiguous Account Security email response after the auth
   mutation; prove the saved email remains authoritative and a same-page
   resubmit performs no second email attempt. Prove Forgot Password can issue a
   fresh recovery link when the member explicitly requests one.
11. Replay duplicate and out-of-order webhook fixtures; prove no stale overwrite.
12. Run the read-only reconciliation and require zero unexplained differences.

## Reversible production Starter canary

Run this only after separate approval of the exact existing Starter member ID,
old email, canary email, expected reset message, downstream marketing behavior,
and execution owner. Do not create a new member as a substitute.

1. Freeze a canary manifest containing the stable Memberstack member ID, current
   role, old and canary emails, the expected single `user_v3` and
   `freelancers_v3` row IDs, TalkJS user ID, Mailchimp contact identity and
   consent state when present, and the current event watermarks. Stop on any
   missing or mismatched required identity.
2. Read every system by those stable IDs and require the old email, one record
   per system, Talent role, and unchanged consent/status before the write.
3. Confirm the published sitewide configuration reads
   `guardSecurityForm: 'identity'`. As Talent, submit the visible native form on
   `/starter-edit-profile` once with only the email changed while an unrelated
   required profile field is incomplete. Require the Memberstack login email to
   change, exactly one reset/set-password message, and no Xano full-profile
   submission from that click. Brand may continue using the native Account
   Security modal.
4. Read Memberstack, `user_v3`, and `freelancers_v3` by Memberstack member ID.
   Require the canary email, unchanged stable row IDs and role, and a common
   processed event watermark. Replay the captured webhook once and require a
   stale/replay skip with no duplicate rows.
5. Run the approved identity-projection worker and then open `/messages` as the
   canary member. Require the same TalkJS user ID with the canary email and no
   email-keyed user.
6. Require the existing Mailchimp contact to carry the canary email with the
   same provider contact identity and unchanged subscription consent/status,
   with no campaign send or duplicate contact. Reload `/starter-edit-profile`
   and require the visible email input to display the canary email after
   Memberstack and Xano converge; no CMS email write is expected.
7. Run read-only reconciliation from the Memberstack member ID and require zero
   unexplained differences across Memberstack, both Xano rows, TalkJS,
   Mailchimp, and Webflow before ending the canary.
8. Roll back through the same native `/starter-edit-profile` form by submitting
   the old email once. Repeat steps 4 through 7 in reverse, requiring the same
   stable IDs, one rollback reset message, advanced watermarks, restored email,
   and no duplicate or consent/status drift.

If interception itself must be rolled back, change only
`guardSecurityForm: 'identity'` to `'brand'`, publish and read back the complete
sitewide code block, then verify Talent falls through to the Memberstack-native
handler while Brand behavior is unchanged. This switch does not undo a completed
email mutation; use step 8 for data rollback.
