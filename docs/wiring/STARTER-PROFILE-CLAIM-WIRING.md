# Starter profile claim wiring

## Product flow

QR codes point to the normal public Hire profile URL, for example:

```text
https://www.thestarters.com/hire/jane-doe
```

The Hire frontend has an allowlist of profile slugs supplied by Kaeser. It shows
the claim signup form only when the current `/hire/<slug>` is in that list. The
QR has no token or special query parameter, and signup does not need a
pre-existing email address or admin confirmation.

This is intentionally first-claim-wins. The public URL and frontend allowlist
control visibility, not identity. Anyone who reaches an eligible unclaimed
profile can attempt to claim it. On successful signup, Xano must verify that the
exact profile is admin-prebuilt and still unclaimed, then bind its first
Memberstack ID only from a fresh `member.created` event. An existing account
cannot establish or switch a claim through a later update. Xano must reject a
later or conflicting claim without creating a second profile.

## Frontend contract

The Hire template supplies the approved slugs as data before loading the shared
controller. The list is currently empty so the controller fails closed until
Kaeser supplies it. Use canonical Webflow slugs exactly as they appear in
`/hire/<slug>`.

```html
<script>window.STARTER_PROFILE_CLAIM_SLUGS = [];</script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/starter-profile-claim.js"></script>
```

Keep the Claim Profile wrapper authored with class `hide`, `hidden="hidden"`,
and `aria-hidden="true"`. Add these attributes to the outer wrapper:

| Attribute | Value |
| --- | --- |
| `data-starter-claim` | `wrapper` |
| `hidden` | `hidden` |
| `aria-hidden` | `true` |

Put these attributes on the existing Memberstack signup form:

| Attribute | Value |
| --- | --- |
| `data-starter-claim` | `form` |
| `data-ms-form` | `signup` |

Add one hidden input inside that form:

| Property or attribute | Value |
| --- | --- |
| input type | `hidden` |
| `data-ms-member` | `starter-claim-profile-slug` |
| autocomplete | `off` |

The controller sets this field to the current slug only for an allowlisted
profile, then reveals the form. It does not make a network request or change the
URL. A visitor can edit any browser field, so the backend must independently
validate the slug against the canonical Xano profile.

Keep the Google signup control hidden until its Memberstack webhook behavior
has been verified. The normal email signup path is the launch path.

Load the released controller through the Hire template's thin custom-code
loader. Keep the `hide` class as the no-JavaScript and pre-initialization state.

## Backend contract

The existing private marker `freelancers_v3.profile_provisioning_source` uses
`admin_prebuilt` for profiles created for this flow. `memberstack_id` is the
existing unique account binding. Do not add a claim table or duplicate claim
boolean for this design.

Preserve endpoint `#1513`'s existing atomic event-timestamp watermark gate as
the first durable side-effect boundary for committed canonical writes. When a
prior delivery committed its user, profile, or event watermark, an exact
duplicate or older event must return `skipped_stale_or_replay` before claim
resolution, user or profile writes, projections, or outbox work. A competing
first claim that loses the conditional bind rolls back without a claim ledger or
receipt, so its exact retry may re-evaluate the claim and reject again without
profile, projection, or outbox side effects.

Keep the existing event plan resolution unchanged. Resolve a fresh
`member.created` from its `planConnections`, as observed on recent Live Talent
Free signups. Preserve the current fallback for a fresh `member.updated` payload
that omits `planConnections`; that fallback may resolve an established role but
must never make an existing account eligible for a first binding.

For each fresh event that passes the watermark gate:

1. Read the submitted `starter-claim-profile-slug` Memberstack custom field. If
   it is absent, continue through the existing ordinary signup path unchanged.
2. If a slug is present, resolve it to exactly one canonical `freelancers_v3
   #82` row and require `profile_provisioning_source=admin_prebuilt`. Verify the
   canonical slug field name against the live schema before implementation. A
   missing, ambiguous, or non-prebuilt match is a claim rejection and must not
   fall through to the ordinary profile-creation path.
3. Read the current `user_v3`, `brands_v3`, and `freelancers_v3` rows for the
   incoming immutable Memberstack ID before choosing a claim branch.
4. A fresh `member.updated` event may reuse the target only when that exact
   profile is already bound to the incoming Memberstack ID and there is no
   conflicting Brand or different Freelancer row. Skip only the email fallback
   and profile-creation branch, then continue the endpoint's normal `user_v3`,
   `freelancers_v3`, projection, and outbox processing. An update must reject an
   unclaimed target, a different target, or conflicting role ownership.
5. A first binding requires a fresh `member.created` event whose incoming ID had
   no `user_v3`, `brands_v3`, or `freelancers_v3` row before the event. The event
   `planConnections` must resolve as Talent, and the event must create a new
   `user_v3` mirror rather than finding one through an upsert.
6. In one transaction, create that user mirror and conditionally bind the
   incoming Memberstack ID and signup email to the exact target only while its
   `memberstack_id` is still empty. If the identity precondition or target bind
   loses a race, roll back and reject without creating a fallback profile.
7. After a successful first bind, continue endpoint `#1513`'s normal event,
   projection, and outbox processing once.

The profile slug selects the target; it does not prove who scanned the QR. A
signup with no claim slug continues through the existing normal signup path.

## Acceptance checks

- An allowlisted slug shows the form on the normal profile URL and fills the
  hidden signup field with that slug.
- A slug not on the list, a non-profile URL, or missing form markup stays
  hidden; the no-JavaScript initial state also stays hidden.
- The browser sends no claim-validation request and does not modify the URL.
- A fresh Talent `member.created` event with a newly created `user_v3` mirror,
  no preexisting role row, and an unclaimed admin-prebuilt target claims that
  exact profile; the Memberstack ID and submitted email are saved once.
- An exact or older webhook delivery with committed canonical writes returns
  `skipped_stale_or_replay` before claim, profile, projection, or outbox side
  effects.
- A later fresh `member.updated` event reuses only the same bound profile and
  continues normal propagation with stable row IDs. It cannot first-bind an
  unclaimed profile, switch targets, or create dual-role ownership.
- A competing first claim or conflicting member is rejected without a fallback
  profile or duplicate; an exact retry of a rolled-back competing first claim
  may re-evaluate and reject again without profile, projection, or outbox side
  effects.
- Ordinary signup without the profile-slug field keeps its existing behavior,
  and a fresh `member.updated` without `planConnections` keeps the existing plan
  fallback.
- Google remains hidden unless a separate observed test proves the same slug
  field reaches the webhook.
- A role-correct production canary confirms the authenticated profile and
  canonical Xano row after signup, with zero duplicate profiles.

Run the local frontend checks with:

```sh
node --test v3/starter-profile-claim.test.js
node v3/browser-tests/starter-profile-claim.browser.cjs
```

The current production controller, Webflow attributes, and Xano `#1513` do not
yet implement this slug-claim design. Do not release this frontend until the
matching form field and backend slug-claim path have been implemented and
verified together.
