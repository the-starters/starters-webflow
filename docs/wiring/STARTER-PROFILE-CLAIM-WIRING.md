# Starter profile claim wiring

## Release state

This is a frontend candidate. Do not install or publish it before the Xano
validation endpoint, claim ledger, Memberstack custom field, and claim-aware
`new_member/v3` path are deployed and tested together.

The current production `new_member/v3` endpoint adopts a premade
`freelancers_v3` row by `memberstack_id` and then by normalized email. When the
premade row has no email, a normal Talent signup can create a second profile.
The claim token must therefore be consumed inside the signup owner before its
existing email fallback and create path.

## URL contract

Each printed QR code uses one opaque, random capability:

```text
https://www.thestarters.com/hire/jane-doe?claim=<32-to-128-character-base64url-token>
```

The token must not contain a profile ID, email, slug, or other readable value.
Generate at least 32 random bytes, encode as unpadded base64url, store only its
SHA-256 digest in Xano, and show the raw token only while creating the QR code.

The browser accepts exactly one `claim` query value. It removes that value from
the address bar after a terminal validation response and preserves all other
query values and the fragment.

## Webflow attribute contract

Keep the existing `hide` class on the Claim Profile component instance. Also
keep `hidden="hidden"` and `aria-hidden="true"`. The controller treats these as
the fail-closed authored state and only removes them after validation succeeds.

Put these attributes on the outer wrapper:

| Attribute | Value |
| --- | --- |
| `data-starter-claim` | `wrapper` |
| `data-starter-claim-validate-url` | `https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starter_profile_claim/validate` |
| `hidden` | `hidden` |
| `aria-hidden` | `true` |

Do not add a second `class` custom attribute. The Webflow class property already
owns `hide`.

Put both attributes on the actual form element:

| Attribute | Value |
| --- | --- |
| `data-starter-claim` | `form` |
| `data-ms-form` | `signup` |

Add one hidden input inside that form:

| Property or attribute | Value |
| --- | --- |
| input type | `hidden` |
| `data-ms-member` | `starter-claim-token` |
| autocomplete | `off` |

Create the matching `starter-claim-token` custom field in Memberstack before
testing. The controller writes the validated raw capability to the input value;
it does not accept a value authored in Webflow.

Load the controller with `defer` on the Hire CMS template:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/starter-profile-claim.js"></script>
```

Pin an immutable release tag in production. Do not publish this script reference
while the backend route does not exist.

## Browser state machine

| Input or result | Wrapper result | `data-starter-claim-state` |
| --- | --- | --- |
| no `claim` query | stays hidden; no request | `closed` |
| malformed or repeated query | stays hidden; no request | `closed` |
| missing form, token input, or endpoint attribute | stays hidden | `misconfigured` |
| request in flight | stays hidden | `validating` |
| active token for this exact profile path | remove `hide` and `hidden`; set `aria-hidden="false"` | `ready` |
| expired, claimed, revoked, wrong path, HTTP error, timeout, or malformed response | stays hidden | `unavailable` |

Production is silent. Staging and debug mode emit redacted diagnostics that do
not include the capability.

## Xano authority contract

Create a dedicated claim table. Do not add claim-lifecycle columns to
`freelancers_v3`; that table already has several projection writers and is the
public profile authority, not the invitation authority.

Suggested table: `core_starter_profile_claims_v3`.

| Field | Contract |
| --- | --- |
| `id` | Xano row ID |
| `freelancers_v3_id` | required reference to the premade profile |
| `token_digest` | required SHA-256 digest; unique; raw token is never stored |
| `status` | `active`, `claimed`, `expired`, or `revoked` |
| `expires_at` | required timestamp |
| `claimed_at` | nullable timestamp |
| `claimed_memberstack_id` | nullable Memberstack ID; unique when present |
| `created_by_user_v3_id` | required admin actor |
| `created_at` | required timestamp |
| `revoked_at` | nullable timestamp |

Only the Starters admin mint path can create, rotate, or revoke a token. Minting
a replacement revokes the prior active row in the same transaction. The raw
token is returned once for QR generation and must not appear in logs, analytics,
emails, or any projection.

### Public validation endpoint

`POST /starter_profile_claim/validate`

Request:

```json
{
  "token": "opaque-base64url-capability",
  "profile_path": "/hire/jane-doe"
}
```

The endpoint hashes the token, locks the claim row for the read, checks active
status and expiry, reads the exact `freelancers_v3` row, and compares the current
canonical profile path. It never returns an email, Memberstack ID, Starter ID,
or profile record.

Success:

```json
{
  "valid": true,
  "status": "active",
  "profile_path": "/hire/jane-doe"
}
```

Every unusable capability returns the same non-enumerating shape and a 200:

```json
{
  "valid": false,
  "status": "unavailable"
}
```

Rate-limit by an opaque HMAC bucket. Do not store a raw IP.

### Signup consumption in endpoint `1513`

Read `customFields.starter-claim-token` from the Memberstack webhook. Inside the
existing transaction and before the Talent email fallback or create path:

1. Hash the raw value and lock the matching claim row.
2. Require `status=active`, `expires_at > now`, and an unclaimed member ID.
3. Lock the referenced `freelancers_v3` row.
4. Require its `memberstack_id` to be empty or already equal to this webhook
   member. Never move a profile from a different member.
5. Set that exact profile's `memberstack_id` and normalized webhook email.
6. Mark the claim `claimed` with the same Memberstack ID and timestamp.
7. Continue the current user and profile update logic using the adopted row.

The transaction must be replay-safe. A webhook retry from the same Memberstack
member returns the already-claimed profile. Any different member, target, or
claim state fails closed and must not fall through to create another profile.

## Required proof before release

1. A direct email signup submits `starter-claim-token` in the Memberstack
   `member.created` webhook.
2. A Google signup submits the same custom field. Memberstack documents the
   social-auth button, but its public documentation does not establish this
   hidden custom-field behavior, so it needs an observed sandbox webhook.
3. One premade profile with no email is adopted by exact ID with no second
   `freelancers_v3` row.
4. Replaying the same webhook is idempotent.
5. A second member cannot use the claimed token.
6. Expired, revoked, random, repeated, and wrong-profile tokens stay hidden and
   cause no profile write.
7. Published Hire pages without `claim` issue no validation request and keep the
   component hidden.
8. Browser readback confirms the valid QR path reveals the intended component
   and removes only the `claim` query value.

Run the local frontend checks with:

```sh
node --test v3/starter-profile-claim.test.js
node v3/browser-tests/starter-profile-claim.browser.cjs
```
