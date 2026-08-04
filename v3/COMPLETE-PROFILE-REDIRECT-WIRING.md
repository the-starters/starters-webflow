# V3 Complete-Profile Redirect Wiring

Status: Implemented locally 2026-08-03, not yet installed. Needs one page-level
Webflow embed; it does not arrive with a jsDelivr tag on its own.

`v3/complete-profile-redirect.js` puts every **mapped** member who lands on
`/complete-profile` where they actually belong. The page is a paid-Brand form, so
the only visitor with a reason to be there is a paid Brand who has not finished it
yet. Everyone else mapped goes straight to their own home, with **no hop through
`/login`**.

Every input is already on the member object Memberstack hands back — the custom
field `completed-brand-profile` for completion, the plan connections for the role —
so unlike its `/build-profile/*` sibling this module makes **no network request at
all** beyond the one `getCurrentMember()` call.

## What it does

On `/complete-profile` and `/complete-profile/` only, on the approved hosts only:

| Member | Action |
| --- | --- |
| Paid Brand, `completed-brand-profile` any trimmed non-empty string or any non-string truthy value | Replace with `/brand-dashboard` |
| Paid Brand, empty string, whitespace-only, `false`, `0`, `null`, field absent, or `customFields` absent | **Stay** — this page is exactly where the member belongs |
| Free Brand, `starter-quiz` not set | Replace with `/quiz` |
| Free Brand, `starter-quiz` set | Replace with `/quiz-results` |
| Talent | Replace with `/starter-dashboard` |
| Unmapped plan set, or a cross-role conflicted one (Talent + Brand) | Stay, untouched |
| Logged out, Memberstack missing or slow, no role contract, a role the guard cannot name a home for, lookup throws, malformed member | Stay, untouched |

The free-Brand and Talent rows are new as of the **2026-08-03 evening decision**
and replace the earlier paid-Brand-only design, in which those two roles were left
sitting on a form they can neither fill in nor submit. The bias for the paid Brand
is still deliberately toward staying: re-showing a completed form is a harmless
annoyance, sending a member away from a form they still have to fill in is not.

### Why there is no `/login` hop

Before this release the only way a free Brand or a Talent member got off this page
was a manual trip to `/login`, where the guard's member-home bounce would forward
them. That hop is pointless — this module already holds the member object *and* the
guard's own `roleHome()` answer, so it produces exactly the destination the bounce
would have produced, in one navigation instead of two, with no login form flashing
at an already-authenticated member.

The destinations are therefore identical to the `/login` bounce by construction,
not by coincidence: every navigation assertion in
`v3/complete-profile-redirect.test.js` keys on
`window.StartersV3RouteGuard.roleHome(member)` rather than on a path literal. The
literals appear in exactly one test, which pins the contract's answers to the
paths documented here — so if the guard ever moves a role home, that single test
is what fails and names the change, instead of a dozen navigation tests going red
against a module that did the right thing.

## The Memberstack group contract this assumes

Access to `/complete-profile` is **not** this module's job and never becomes it.
The page is gated by the Memberstack `restrict-pages` gated content group, which
must be configured as:

| Setting | Value as typed in the Memberstack dashboard |
| --- | --- |
| URL rule | STARTS WITH `complete-profile` |
| Access | **All Members** |
| Access Denied URL | `login` |

Both URL fields in this table are the dashboard's own slug form, **without a
leading slash** — that is what you type into Memberstack. The resulting
destination a denied visitor's browser lands on is the path `/login`, and
Memberstack gets there by calling `window.location.replace('/login')`. Wherever
the prose below names `/login`, it means that destination, not the field value.

**Access must be "All Members", not the paid-Brand plan.** That is the part the
2026-08-03 evening decision changed. An earlier design had the group kick every
non-paid member itself; this module now routes them, and it can only do that if
Memberstack lets them load the page in the first place. If the group is narrowed to
the paid plan later, the free-Brand and Talent branches become dead code and those
members go back to bouncing through `/login` — which still works, just worse.

The division of labour that stays fixed:

- **Logged out is Memberstack's.** The gated group calls
  `window.location.replace('/login')` from cached group data before this module (or
  the route guard) has resolved a member, so it wins that race regardless. This
  module never touches a visitor it cannot positively identify.
- **`route-guard.js` deliberately does not list the page** in `PAGE_ROLES` or
  `LOGGED_OUT_DESTINATIONS`. Two owners would mean two logged-out destinations for
  one URL. Because the Memberstack kick carries no `?next=`, the page is absent
  from `auth-route.js`'s `ROLE_DESTINATIONS` too — there is no round trip to close.
- `v3/route-guard.test.js` asserts `pageRolesFor('/complete-profile')` is `null`,
  and `v3/complete-profile-redirect.test.js` asserts the same thing from this side
  plus that a live guard booting on this path stamps nothing and redirects nobody,
  so the layering cannot drift silently.

## The role contract

The role **and** the free-Brand and Talent destinations both come from the sitewide
`v3/route-guard.js` export (`window.StartersV3RouteGuard.memberRole` and
`.roleHome`), never from a second copy of the plan table or of `ROLE_DEFAULTS` —
the same borrow `v3/auth-route.js` and `v3/build-profile-redirect.js` make. That is
what keeps the free-Brand quiz-funnel rule (`/quiz-results` once `starter-quiz` is
set, else `/quiz`) in exactly one place.

Both halves are required together. A contract that can name a role but not its home
counts as **no contract at all**: identifying a Talent member and then having
nowhere to send them would be worse than doing nothing, so the module leaves the
page alone and warns on staging. This is also why install order matters — if the
guard is missing or loaded after this module, nothing happens.

## The `completed-brand-profile` field contract

Read straight off `member.customFields['completed-brand-profile']`, and consulted
**for the paid-Brand branch only** — a stray value on a Talent or free-Brand member
is meaningless, because it is a paid-Brand form marker, and must not divert them to
the Brand dashboard. Its truthiness rule is a deliberate copy of the `starter-quiz`
rule `route-guard.js` uses in `hasCompletedQuiz`: a string counts only once trimmed
non-empty, and a non-string truthy value counts as set (Memberstack has been seen
to return a boolean for checkbox-backed fields, and a form that wrote *something*
should not be re-run because the something was not a string).

**Who writes it:** a hidden input inside the Complete-profile form, added in the
Webflow Designer, carrying `data-ms-member="completed-brand-profile"`. Memberstack
writes the field to the member on form submit — there is no Xano hop and no script
in this repo that writes it. If that input is missing or misspelled, nothing writes
the field and the paid-Brand branch is permanently inert; it will never redirect a
paid Brand and it will never break the page.

**Two properties worth stating plainly:**

- **The paid-Brand branch is inert until the field is written.** The field existed
  on the member object before 2026-08-03 but nothing ever wrote to it, so *every*
  paid Brand reads as not-done until they submit the form once with the hidden input
  in place. That branch switches itself on member by member as the field starts
  landing. The free-Brand and Talent branches depend on no new field and are live
  as soon as the embed is.
- **Members who completed before the field existed read as not-done.** There is no
  backfill. A paid Brand who finished this form weeks ago still has an empty field,
  so they will be shown the form again and will only stop seeing it after they
  resubmit once. If that is unacceptable for a particular member, the fix is a
  one-off value on their Memberstack member record, not a code change.

## Webflow install

1. Confirm the `restrict-pages` group for this page is set to access **All
   Members** with Access Denied URL `login` (table above). The role branches
   cannot run for a member Memberstack refuses to let onto the page.
2. Add the hidden `data-ms-member="completed-brand-profile"` input to the
   Complete-profile form. Without it the paid-Brand branch is a no-op; the other
   two branches work regardless.
3. Add one deferred page-level tag on `/complete-profile`, and nowhere else:

   ```html
   <script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.82/v3/complete-profile-redirect.js" defer></script>
   ```

4. Load it AFTER the sitewide `v3/route-guard.js`, which owns the role contract
   this module reads. The guard is already in project head code, so a page-level
   body or head embed on this page satisfies the order.
5. Do not install it on any destination page — `/brand-dashboard`,
   `/starter-dashboard`, `/quiz`, `/quiz-results`. The path scope refuses them
   anyway, and the test suite asserts no destination is itself a scoped page.
6. Pin the embed to the same tag as the route-guard release it shipped with
   (`v1.59.82`), the way the sibling redirect embeds are pinned.

No page markup is required beyond the hidden input. The module has no spinner and
no error state: it either navigates away or leaves the page alone, so there is
nothing to author.

## Diagnostics

`window.StartersCompleteProfileRedirect` exposes `release`, `allowedHost`,
`stagingHost`, `isCompleteProfilePath`, `diagnosticsEnabled`,
`hasCompletedBrandProfile`, `memberRole`, `roleHome`,
`completeProfileDestination`, `redirectPastCompleteProfile`,
`completeProfilePaths`, `dashboardPath`, and `doneField`.

- `completeProfileDestination()` is the read-and-decide half and is safe to call by
  hand on staging: it returns `/brand-dashboard`, `/quiz`, `/quiz-results`,
  `/starter-dashboard`, or `null` (stay) **without navigating**.
- `memberRole(member)` and `roleHome(member)` are the two guard-contract borrows,
  exported so a staging session can ask "what role does the guard think I am, and
  where does it think I live?" without reproducing the decision by hand.
- `hasCompletedBrandProfile(member)` answers the field question for any member
  object you already have, which is the fastest way to confirm the hidden input
  actually wrote something.

Diagnostics narrate every decision on staging only — `*.webflow.io`, `localhost`,
`127.0.0.1`, `*.trycloudflare.com`, or `window.STARTERS_DEBUG === true`. Production
is completely silent, on the role redirects and on every fail-open path alike.

## Release gate

- Run `node --test v3/complete-profile-redirect.test.js`, and the whole `v3/` suite
  with it.
- Confirm the sitewide route guard loads before this embed on the page.
- Confirm the `restrict-pages` group access is **All Members** before testing the
  role branches; with the paid plan selected they are unreachable by construction.
- On staging with the console open, verify all four mapped outcomes: a paid Brand
  with an empty `completed-brand-profile` stays and the form works; a paid Brand
  with the field set lands on `/brand-dashboard`; a Talent session lands on
  `/starter-dashboard`; a free Brand lands on `/quiz` before taking the quiz and on
  `/quiz-results` after.
- Verify the free-Brand and Talent trips are a **single** navigation — `/login`
  should never appear in the history for them.
- Submit the form once as a paid Brand with an empty field, then revisit the page:
  the second visit should redirect. That single round trip is the only real proof
  the hidden input is wired.
- Confirm a signed-out visit is still handled by Memberstack's gated group
  (`/login`, no `?next=`) rather than by this module.
- Confirm the page issues no new network request because of this module — it makes
  none.
- Verify `window.StartersCompleteProfileRedirect.release` matches the tag the embed
  is pinned to.
- Do not publish custom domains until the separate production go signal.
