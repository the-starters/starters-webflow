# Starter profile claim wiring

## Release state

This is a frontend candidate. Do not install or publish it before the Xano
prepare endpoint, claim ledger, Memberstack custom field, and claim-aware
`new_member/v3` path are deployed and tested together.

The current production `new_member/v3` endpoint adopts a premade
`freelancers_v3` row by `memberstack_id` and then by normalized email. When the
premade row has no email, a normal Talent signup can create a second profile.
The one-use exchange code must therefore be consumed inside the signup owner
before its existing email fallback and create path.

## URL contract

Each printed QR code uses one opaque, random capability:

```text
https://www.thestarters.com/hire/jane-doe?claim=<32-to-128-character-base64url-token>
```

The token must not contain a profile ID, email, slug, or other readable value.
Generate at least 32 random bytes, encode as unpadded base64url, store only its
SHA-256 digest in Xano, and show the raw token only while creating the QR code.

At controller evaluation, the browser accepts exactly one strict `claim` query
value into memory and synchronously removes every `claim` value from the address
bar before any await, request, analytics call, or reveal. It preserves all other
query values and the fragment. A failure to remove the value fails closed.

## Webflow attribute contract

Keep the existing `hide` class on the Claim Profile component instance. Also
keep `hidden="hidden"` and `aria-hidden="true"`. The controller treats these as
the fail-closed authored state and only removes them after prepare succeeds.

Put these attributes on the outer wrapper:

| Attribute | Value |
| --- | --- |
| `data-starter-claim` | `wrapper` |
| `data-starter-claim-prepare-url` | `https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starter_profile_claim/prepare` |
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
| `data-ms-member` | `starter-claim-exchange` |
| autocomplete | `off` |

Create the matching `starter-claim-exchange` custom field in Memberstack before
testing. The controller writes only the short-lived one-use exchange code to the
input. It never puts the raw QR capability in DOM, Memberstack, storage, logs,
or analytics, and it does not accept a value authored in Webflow.

Keep the existing Google element's Memberstack attribute, and author it hidden:

| Attribute | Value |
| --- | --- |
| `data-ms-auth-provider` | `google` |
| `hidden` | `hidden` |
| `aria-hidden` | `true` |

The controller also forces this element hidden and removes it from keyboard
navigation. Do not reveal it until an observed Memberstack Test webhook proves
that Google signup carries `starter-claim-exchange`; then update this controller
and its tests in a separately reviewed release.

Load the controller synchronously in the Hire CMS template page head, before the
existing sitewide PostHog initialization:

```html
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/starter-profile-claim.js"></script>
<!-- Existing sitewide PostHog initialization follows this script. -->
```

Do not add `async`, `defer`, or place the controller after PostHog. At evaluation
time it captures one strict token into closure memory and scrubs `claim` before
querying body markup. After parsing, `DOMContentLoaded` binds and evaluates the
authored wrapper. Pin an immutable release tag in production. Do not publish
this script reference while the backend route does not exist.

## Browser state machine

| Input or result | Wrapper result | `data-starter-claim-state` |
| --- | --- | --- |
| no `claim` query | stays hidden; no request | `closed` |
| malformed or repeated query | stays hidden; no request | `closed` |
| trailing-slash or other non-canonical profile path | stays hidden; no request | `misconfigured` |
| missing form, exchange input, or endpoint attribute | stays hidden | `misconfigured` |
| request in flight | stays hidden | `validating` |
| active invitation and strict exchange for this exact profile path | remove `hide` and `hidden`; set `aria-hidden="false"` | `ready` |
| expired, claimed, revoked, wrong path, HTTP error, timeout, or malformed response | stays hidden | `unavailable` |

Production is silent. Staging and debug mode emit redacted diagnostics that do
not include the capability.

## Xano authority contract

Create a dedicated claim table. Do not add claim-lifecycle columns to
`freelancers_v3`; that table already has several projection writers and is the
public profile authority, not the invitation authority.

Premade profiles keep `profile_origin=v3_native`. Add the separate private,
immutable `profile_provisioning_source=admin_prebuilt` marker for provenance.
Neither field stores invitation or consumption state; all claim state remains
authoritative only in the claim ledger described here.

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

Suggested child table: `core_starter_profile_claim_exchanges_v3`.

| Field | Contract |
| --- | --- |
| `id` | Xano row ID |
| `claim_id` | required reference to the invitation ledger row |
| `exchange_digest` | required SHA-256 digest; unique; raw code is never stored |
| `expires_at` | required short expiry |
| `consumed_at` | nullable timestamp |
| `consumed_memberstack_id` | nullable Memberstack ID |
| `created_at` | required timestamp |

Only the Starters admin mint path can create, rotate, or revoke a token. Minting
a replacement revokes the prior active row in the same transaction. The raw
token is returned once for QR generation and must not appear in logs, analytics,
emails, or any projection.

### Public prepare endpoint

`POST /starter_profile_claim/prepare`

Request:

```json
{
  "token": "opaque-base64url-capability",
  "profile_path": "/hire/jane-doe"
}
```

The endpoint hashes the token, locks the invitation row for the read, checks
active status and expiry, reads the exact `freelancers_v3` row, and compares the
current canonical no-trailing-slash `/hire/<slug>` profile path. It then mints a
cryptographically random, short-lived one-use exchange code, stores only its
digest in the child ledger, and returns the raw code once. It never returns an
email, Memberstack ID, Starter ID, or profile record.

Success:

```json
{
  "valid": true,
  "status": "active",
  "profile_path": "/hire/jane-doe",
  "exchange_code": "zyxwvutsrqponmlkjihgfedcba9876543210_-ZYXWV"
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

Repeated scans of the same QR may mint fresh exchange codes while its invitation
remains active. The first successful signup consumption wins. Once the
invitation is claimed, expired, or revoked, every outstanding or new exchange is
unavailable.

### Signup consumption in endpoint `1513`

Read `customFields.starter-claim-exchange` from the Memberstack webhook. Inside
the existing transaction and before the Talent email fallback or create path:

1. Hash the exchange code and lock its matching exchange row and parent claim row.
2. If the exchange and claim are already consumed by this webhook's Memberstack
   member, lock its referenced `freelancers_v3` row, require that row to still
   belong to the same member, and continue the current user and profile update
   logic using that row without mutating the claim again. A claimed row owned by
   any other member fails closed.
3. Otherwise require an unused, unexpired exchange plus a parent claim with
   `status=active`, `expires_at > now`, and an empty `claimed_memberstack_id`.
4. Lock the referenced `freelancers_v3` row.
5. Require its `memberstack_id` to be empty or already equal to this webhook
   member. Never move a profile from a different member.
6. Set that exact profile's `memberstack_id` and normalized webhook email.
7. Atomically mark the exchange consumed and the parent claim `claimed` with the
   same Memberstack ID and timestamp.
8. Continue the current user and profile update logic using the adopted row.

The transaction must be replay-safe. A webhook retry from the same Memberstack
member returns the already-claimed profile. Any different member, target, or
claim state fails closed and must not fall through to create another profile.

## Required proof before release

1. A direct email signup submits `starter-claim-exchange` in the Memberstack
   `member.created` webhook.
2. A Google signup submits the same exchange field. Memberstack documents the
   social-auth button, but its public documentation does not establish this
   hidden custom-field behavior, so it needs an observed sandbox webhook.
3. One premade profile with no email is adopted by exact ID with no second
   `freelancers_v3` row.
4. Replaying the same webhook is idempotent.
5. Repeated active QR scans mint distinct exchange codes; the first successful
   claim wins and a second member cannot use any other exchange.
6. Expired, revoked, random, repeated, and wrong-profile tokens stay hidden and
   cause no profile write.
7. Published Hire pages without `claim` issue no prepare request and keep the
   component hidden.
8. Browser readback confirms the valid QR path removes only the `claim` query
   value before the following PostHog initialization and prepare request,
   reveals the intended component only with a valid exchange, rejects the
   trailing-slash alias, and stays scrubbed and hidden on network failure.

Run the local frontend checks with:

```sh
node --test v3/starter-profile-claim.test.js
node v3/browser-tests/starter-profile-claim.browser.cjs
```
