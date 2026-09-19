# 01 — Confirm the live-page selector for the member's Memberstack status element

**What to build:** Not a code change — confirm what the member actually added to the
guarded forms in the Webflow Designer, so ticket 02 implements against a real
selector instead of a guess.

Spec: `v3/BRAND-STARTER-EMAIL-STATUS-SPEC.md` (ticket 18 of Jai's 09/18 feedback).
The member said in the project chat they used "whatever Memberstack told me to
use" for the status element. Memberstack's documented convention for a custom
form message element ([Custom Error & Success Messages](https://docs.memberstack.com/hc/en-us/articles/9951195874587-Custom-Error-Success-Messages))
is:

- `data-ms-message="success"` / `data-ms-message="error"` on the message
  container Memberstack shows/hides
- `data-ms-message-text="true"` on the (often nested) element Memberstack
  writes the message text into
- `data-ms-message-close="true"` optionally on a dismiss control

That's the working assumption ticket 02 is written against. This ticket exists
because "the member followed Memberstack's docs" is what we were told, not
what's been seen on the live page — a typo'd attribute, a missing
`data-ms-message-text` child, or an element outside the form's `.w-form`
wrapper would all silently break ticket 02's fix the same way the original bug
did.

**Blocked by:** None — can start immediately.

- [ ] Inspect the live Account Security form and the Starter Edit Profile
      form (Designer or rendered-page devtools) for the element(s) the member
      added.
- [ ] Confirm each element carries `data-ms-message="success"` /
      `data-ms-message="error"`, and note whether a `data-ms-message-text="true"`
      child exists (vs. text going directly on the `data-ms-message` element).
- [ ] Confirm the element sits inside the same `.w-form` wrapper the
      built-in `.w-form-done` / `.w-form-fail` blocks are found in (that's
      the resolution scope `setMessage` already uses).
- [ ] Record the confirmed selector(s) — or the actual attribute found, if it
      differs from the assumption above — as the value ticket 02 implements
      against.
