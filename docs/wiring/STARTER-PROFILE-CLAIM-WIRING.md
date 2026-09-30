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
Memberstack ID. It must reject a later or conflicting claim without creating a
second profile.

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

Before endpoint `#1513 new_member/v3` uses its existing email fallback or creates
a profile:

1. Read the submitted `starter-claim-profile-slug` Memberstack custom field. If
   it is absent, continue through the existing ordinary signup path unchanged.
2. If a slug is present, resolve it to exactly one canonical `freelancers_v3
   #82` row. Verify the canonical slug field name against the live schema before
   implementation. A missing or ambiguous match is a claim rejection and must
   not fall through to the ordinary profile-creation path.
3. Require `profile_provisioning_source=admin_prebuilt`.
4. If `memberstack_id` already equals the incoming Memberstack ID, return that
   profile idempotently before checking whether the profile is unclaimed.
5. If `memberstack_id` is non-empty and belongs to another member, reject the
   claim without creating a profile.
6. If `memberstack_id` is empty, atomically bind the incoming Memberstack ID and
   signup email to that exact profile. A concurrent loser must re-read the row
   and apply the same same-member or conflict result without falling through to
   profile creation.

The profile slug selects the target; it does not prove who scanned the QR. A
signup with no claim slug continues through the existing normal signup path.

## Acceptance checks

- An allowlisted slug shows the form on the normal profile URL and fills the
  hidden signup field with that slug.
- A slug not on the list, a non-profile URL, or missing form markup stays
  hidden; the no-JavaScript initial state also stays hidden.
- The browser sends no claim-validation request and does not modify the URL.
- A prebuilt profile without an email is claimed by exact profile ID after
  signup; the Memberstack ID and submitted email are saved once.
- Replaying the same webhook is idempotent. A different member cannot claim an
  already-bound profile and cannot create a duplicate.
- Ordinary signup without the profile-slug field keeps its existing behavior.
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
