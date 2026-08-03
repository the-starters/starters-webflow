# V3 Complete-Profile Redirect Wiring

Status: Implemented locally 2026-08-03, not yet installed. Needs one page-level
Webflow embed; it does not arrive with a jsDelivr tag on its own.

`v3/complete-profile-redirect.js` keeps a paid Brand who has already finished the
Complete-profile form from re-entering it. Completion is a durable signal on the
member object — the Memberstack custom field `completed-brand-profile` — so unlike
its `/build-profile/*` sibling this module makes **no network request at all**:
the answer is already in the member Memberstack hands back.

## What this module is not

It is not the page's access gate, and it never sends anyone **to** this page.
Access to `/complete-profile` belongs entirely to the Memberstack `restrict-pages`
gated content group (URL rule STARTS `complete-profile`, redirect `login`), and
`v3/route-guard.js` deliberately does not list the page in `PAGE_ROLES` — two
owners would mean two logged-out destinations for one URL, and Memberstack's
`protectPages()` wins that race from cached group data before the guard resolves a
member. A member without group access is dropped on `/login` with no `?next=`, and
the guard's member-home bounce pages forward them to their role home from there.

That division is why this module's scope is a single positive answer: an already
completed paid Brand. Every other visitor is somebody else's, and it does nothing
for them rather than race another layer to a different destination.
`v3/route-guard.test.js` asserts `pageRolesFor('/complete-profile')` is `null`, and
`v3/complete-profile-redirect.test.js` asserts the same thing from this side, so
the layering cannot drift silently.

## What it does

Paid Brand members only, on `/complete-profile` and `/complete-profile/` only:

| `completed-brand-profile` | Action |
| --- | --- |
| Any trimmed non-empty string, or any non-string truthy value | Replace with `/brand-dashboard` |
| Empty string, whitespace-only, `false`, `0`, `null` | Stay — this page is exactly where the member belongs |
| Field absent, or `customFields` absent entirely | Stay |
| Talent, free Brand, unmapped, or cross-role conflicted member | Stay, untouched |
| Logged out, Memberstack missing or slow, no role contract, lookup throws | Stay, untouched |

The bias is deliberately toward staying. Re-showing a completed form is a harmless
annoyance; sending a member away from a form they still have to fill in is not.

The role comes from the sitewide `v3/route-guard.js` contract
(`window.StartersV3RouteGuard.memberRole`), never from a second copy of the plan
table — the same borrow `v3/auth-route.js` and `v3/build-profile-redirect.js` make.
If the guard is missing or loaded after this module, the role reads as null and the
page renders untouched, which is why install order matters.

## The `completed-brand-profile` field contract

The field is a Memberstack member custom field, read straight off
`member.customFields['completed-brand-profile']`. Its truthiness rule is a
deliberate copy of the `starter-quiz` rule `route-guard.js` uses in
`hasCompletedQuiz`: a string counts only once trimmed non-empty, and a non-string
truthy value counts as set (Memberstack has been seen to return a boolean for
checkbox-backed fields, and a form that wrote *something* should not be re-run
because the something was not a string).

**Who writes it:** a hidden input inside the Complete-profile form, added in the
Webflow Designer, carrying `data-ms-member="completed-brand-profile"`. Memberstack
writes the field to the member on form submit — there is no Xano hop and no script
in this repo that writes it. If that input is missing or misspelled, nothing writes
the field and this module is permanently inert (see below); it will never redirect
and it will never break the page.

**Two properties worth stating plainly:**

- **Inert until the field is written.** The field existed on the member object
  before 2026-08-03 but nothing ever wrote to it, so *every* member reads as
  not-done until they submit the form once with the hidden input in place. The
  redirect switches itself on member by member as the field starts landing, and
  until then the page behaves exactly as it does today.
- **Members who completed before the field existed read as not-done.** There is no
  backfill. A paid Brand who finished this form weeks ago still has an empty field,
  so they will be shown the form again and will only stop seeing it after they
  resubmit once. If that is unacceptable for a particular member, the fix is a
  one-off value on their Memberstack member record, not a code change.

## Webflow install

1. Add the hidden `data-ms-member="completed-brand-profile"` input to the
   Complete-profile form first. Without it the embed below is a no-op.
2. Add one deferred page-level tag on `/complete-profile`, and nowhere else:

   ```html
   <script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.78/v3/complete-profile-redirect.js" defer></script>
   ```

3. Load it AFTER the sitewide `v3/route-guard.js`, which owns the role contract
   this module reads. The guard is already in project head code, so a page-level
   body or head embed on this page satisfies the order.
4. Do not install it on `/brand-dashboard` — that is this module's destination, and
   the path scope refuses it anyway.
5. Pin the embed to the same tag as the route-guard release it shipped with
   (`v1.59.78`), the way the sibling redirect embeds are pinned.

No page markup is required beyond the hidden input. The module has no spinner and
no error state: it either navigates away or leaves the page alone, so there is
nothing to author.

## Diagnostics

`window.StartersCompleteProfileRedirect` exposes `release`, `allowedHost`,
`stagingHost`, `isCompleteProfilePath`, `diagnosticsEnabled`,
`hasCompletedBrandProfile`, `completeProfileDestination`,
`redirectPastCompleteProfile`, `completeProfilePaths`, `dashboardPath`, and
`doneField`.

`completeProfileDestination()` is the read-and-decide half and is safe to call by
hand on staging: it returns `/brand-dashboard` or `null` without navigating.
`hasCompletedBrandProfile(member)` answers the field question for any member object
you already have, which is the fastest way to confirm the hidden input actually
wrote something.

Diagnostics narrate every decision on staging only — `*.webflow.io`, `localhost`,
`127.0.0.1`, `*.trycloudflare.com`, or `window.STARTERS_DEBUG === true`. Production
is completely silent, including on every fail-open path.

## Release gate

- Run `node --test v3/complete-profile-redirect.test.js`, and the whole `v3/` suite
  with it.
- Confirm the sitewide route guard loads before this embed on the page.
- On staging with the console open, verify both paid-Brand states: a member with an
  empty `completed-brand-profile` stays on the page and the form works, and a member
  with the field set lands on `/brand-dashboard`.
- Submit the form once as a paid Brand with an empty field, then revisit the page:
  the second visit should redirect. That single round trip is the only real proof
  the hidden input is wired.
- Confirm a Talent session and a free-Brand session are untouched and log nothing,
  and that a signed-out visit is still handled by Memberstack's gated group
  (`/login`, no `?next=`) rather than by this module.
- Confirm the page issues no new network request because of this module — it makes
  none.
- Verify `window.StartersCompleteProfileRedirect.release` matches the tag the embed
  is pinned to.
- Do not publish custom domains until the separate production go signal.
