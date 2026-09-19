# Email Change Status Rendering — Spec

Status: **Draft.** One open question blocks `to-tickets`/`implement` — see below.

Ticket: Jai's 09/18 feedback, item 18. Diagnosis: [thread](https://claude.ai/code/project/chan_018eSmiYQ8k4XE2TAGEMCBC1?thread=cmsg_018eSmiYQ8k4XE2TAGEMCBC1AAco29SPFefEfKDphY8BeF).

## Problem Statement

When a member changes their login email through either guarded email-change
form (Brand/Talent Account Security, and the Talent Starter Edit Profile
email field), two things are wrong from the member's perspective:

1. On success, the confirmation shown does not say anything specific about
   the email change (it's generic authored "thank you" copy), so a member
   can't tell from the confirmation itself that their email was the thing
   that changed.
2. A Memberstack status element the member added to one of these forms in
   the Webflow Designer never appears at all, on success or failure — it
   just silently does nothing, which reads as a broken form.

## Solution

Both guarded email-change forms render a specific "Your email has been
updated" confirmation on success (and their existing friendly error message
on failure), and whatever status element was added to a form's markup is
reliably driven — shown/hidden and given the right text — for both outcomes,
using the same rendering path both forms already share. A future form that
reuses that same shared path inherits this behavior automatically, so the
same silent-status-element bug can't quietly reappear on a new page.

## User Stories

1. As a Brand or Talent member changing my login email through Account
   Security, I want the success confirmation to say "Your email has been
   updated", so that I know specifically what changed rather than reading
   generic form-submitted copy.
2. As a Talent member changing my login email through Starter Edit Profile,
   I want the same specific "Your email has been updated" confirmation on
   success, so the two email-change surfaces behave consistently.
3. As a member who added a Memberstack status element to one of these forms
   in the Designer, I want that element to actually appear when I submit,
   so the status I configured isn't silently ignored.
4. As that same member, I want the status element to reflect a failed
   submission too (not just success), so I can tell the change didn't go
   through and try again.
5. As a member whose submission fails (invalid input, a conflict, a network
   error), I want to keep seeing the existing friendly error message I get
   today, unchanged by this fix.
6. As the developer maintaining this controller, I want the success/failure
   rendering logic to live in one place both forms call, so adding this kind
   of status element to a third form later doesn't require re-deriving the
   fix.
7. As the developer, I want a regression test that fails if a future guarded
   form's status element goes undriven the same way, without that test
   needing to know about a specific new form in advance.

## Implementation Decisions

- The single message-rendering function both guarded forms already call
  after a submit resolves is the one seam this fix touches. Today it only
  toggles the built-in Webflow success/failure blocks by visibility, and
  only sets text on the failure block. It is extended to also set text on
  success, and to drive an additional status element within the same form
  wrapper, on both outcomes.
- Success text becomes "Your email has been updated" for both guarded
  email-change forms. This is new behavior — today the success block keeps
  whatever generic copy was authored in Webflow, untouched by JS. The
  failure path's existing behavior (a friendly, error-specific message) does
  not change.
- Driving the added status element must not special-case either form by
  name or ID. It resolves within the same form wrapper the built-in
  success/failure blocks are already found in, using one selector/attribute
  convention, so any current or future form that calls this shared function
  gets the same behavior without further code changes per form.
- **Open question (blocks implementation):** what did the member actually
  tag the status element with in the Webflow Designer? This decides which
  of two shapes the fix takes, and they are different enough in scope that
  `to-tickets` should not split tickets until this is answered:
  - **Shape A — a distinct, custom-tagged element.** The member added a new
    node (not Memberstack's/Webflow's native success block) and gave it some
    attribute or class to identify it. The fix resolves that element by its
    attribute/class within the form wrapper and toggles its visibility and
    text exactly like the existing failure block does today.
  - **Shape B — a relocated native success block.** What the member added is
    actually Webflow's own native success element, just moved somewhere else
    in the form's markup. In that case the existing visibility toggle already
    reaches it wherever it lives (it's matched by its class, not its
    position) — nothing in this shape was ever silently broken except the
    missing text. The only code change needed is the new success-text
    behavior above; the "moved" placement and its copy are a Webflow Designer
    edit, not a code change, and stay out of this ticket's implementation
    (see Out of Scope).
  Get the selector/attribute (or confirmation that it's Shape B) before
  `to-tickets` turns this into implementation tickets.

## Testing Decisions

- Good tests here exercise the shared rendering function directly with a
  form wrapper built for the test, asserting on what it shows and what text
  it sets — not on which of the two forms called it. That's what makes the
  regression coverage generalize: any current or future call site (a third
  form, a page nobody's written yet) that goes through the same function
  inherits the same test guarantee, without the test needing to know that
  call site exists.
- Cases to cover on the shared function: success shows the success block
  with "Your email has been updated" and hides the failure block; failure
  shows the failure block with the given error message and hides the success
  block; a status element present under either selector shape is shown with
  matching text on success and on failure, and hidden on the other outcome;
  a form with no status element present behaves exactly as it does today
  (no error, nothing extra rendered).
- On top of that, keep one thin end-to-end assertion per real call site
  (Account Security email change, Starter Edit Profile email change) that a
  successful submit renders the new copy, so a future refactor that
  stops calling the shared function on one of these forms is still caught.
- Prior art: the existing test file for this controller already builds a
  mocked form-wrapper/DOM harness (`node:test` + `node:vm`, loading the
  source directly) and drives both binders through submit today. Extend that
  same harness and file rather than introducing a new one.
- No real Webflow or Memberstack calls in any of this — everything is
  exercised through the existing mocked submit/DOM harness, consistent with
  the rest of the file.

## Out of Scope

- Actually moving or re-tagging the status element in the Webflow Designer
  (Shape B's placement, or giving a Shape-A element its attribute in the
  first place) — that's a Designer edit for the member to make, not code.
- Changing the capture-phase submit interception itself, or any of the
  broader Memberstack/Xano wiring around these forms. That architecture is
  documented and intentional (two Memberstack submit owners would race).
- Any other item from Jai's 09/18 feedback list.
- Translating or localizing the new "Your email has been updated" copy.

## Further Notes

- Root cause and the two affected call sites are already confirmed in the
  linked diagnosis thread; this spec doesn't re-derive them.
- Whichever shape the open question resolves to, `to-tickets` can size the
  work now: Shape A is a same-sized change to the shared function plus its
  selector; Shape B is smaller (text-only) with a documented Designer-side
  follow-up that isn't part of the implementation ticket.
