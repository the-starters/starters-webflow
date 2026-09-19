# 02 — Drive the Memberstack status element and specific success copy through the shared message renderer

**What to build:** A member changing their login email on Account Security or
Starter Edit Profile sees "Your email has been updated" on success (today they
see generic authored copy) and the existing friendly error message on failure
(unchanged). If they added a Memberstack-style status element to that form in
the Designer, it now actually shows/hides and gets the right text on both
outcomes, instead of silently doing nothing. Any future form that calls the
same shared renderer inherits this behavior automatically.

Spec: `v3/BRAND-STARTER-EMAIL-STATUS-SPEC.md`. The one seam this touches is
`setMessage()` in `v3/brand-account-controller.js`, already called by both
guarded forms' submit handlers (`bindIdentitySecurityForm`,
`bindStarterProfileEmail`) after a submit resolves.

**Blocked by:** 01 — Confirm the live-page selector for the member's
Memberstack status element (implements against whatever selector that ticket
confirms; assume `data-ms-message="success"` / `data-ms-message="error"` with
a `data-ms-message-text="true"` text child unless 01 found otherwise).

- [ ] `setMessage`'s success path sets "Your email has been updated" as the
      success block's text (today it only toggles visibility and never
      touches success-block text).
- [ ] `setMessage` additionally resolves, within the same form wrapper the
      built-in `.w-form-done` / `.w-form-fail` blocks are found in, an element
      matching the confirmed status-element selector — without special-casing
      either form by ID or name — and toggles its visibility to match the
      outcome (shown on success, hidden on error, and vice versa) and sets its
      text on both outcomes.
- [ ] A form with no such status element present behaves exactly as it does
      today: no error thrown, nothing extra rendered.
- [ ] Account Security and Starter Edit Profile email-change submissions both
      render the new success copy end-to-end.
- [ ] Unit tests added to the existing mocked form-wrapper/DOM harness
      (`node:test` + `node:vm`, same test file as today) covering, against
      `setMessage` directly:
  - success shows the success block with "Your email has been updated" and
    hides the failure block
  - failure shows the failure block with the given error message and hides
    the success block
  - a status element present under the confirmed selector is shown with
    matching text on success and on failure, and hidden on the other outcome
  - a form with no status element present is unaffected (no error, nothing
    extra rendered)
- [ ] One thin end-to-end assertion per real call site (Account Security
      email change, Starter Edit Profile email change) that a successful
      submit renders "Your email has been updated", so a future refactor that
      stops calling the shared function on one of these forms is still caught.

Out of scope (per spec): moving/re-tagging the status element in the Webflow
Designer, changing the capture-phase submit interception, and any other item
from Jai's 09/18 feedback list.
