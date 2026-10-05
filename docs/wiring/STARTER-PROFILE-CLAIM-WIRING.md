# Starter profile claim wiring

## Product flow

QR codes point to the normal public Hire profile URL, for example:

```text
https://www.thestarters.com/hire/jane-doe
```

The Hire frontend asks Xano whether the current `/hire/<slug>` is claimable. It
shows the claim request form only when Xano returns an exact positive status for
that slug. The QR has no token or special query parameter.

This is now a manual-review request. The Webflow form sends the request to the
team through normal Webflow form notifications. The form includes the profile
slug and the influencer's email address, so the team can create the Memberstack
account with the required plan and slug field after review.

## Frontend contract

The Hire template does not supply an allowlist and does not need a direct
`starter-profile-claim.js` script tag. The shared `v3/hire-profile.js` loader
injects the claim controller once when it finds a Claim Profile wrapper. Rollout
is controlled in Xano by the claim-status endpoint response.

Keep the Claim Profile wrapper authored with class `hide`, `hidden="hidden"`,
and `aria-hidden="true"`. Add these attributes to the outer wrapper:

| Attribute | Value |
| --- | --- |
| `data-starter-claim` | `wrapper` |
| `hidden` | `hidden` |
| `aria-hidden` | `true` |

Put this attribute on the plain Webflow form:

| Attribute | Value |
| --- | --- |
| `data-starter-claim` | `form` |

Do not put `data-ms-form` on this form. If the controller finds
`data-ms-form`, it keeps the wrapper hidden so an old Memberstack signup form
cannot be revealed.

Keep the existing visible email input inside that form:

| Property or attribute | Value |
| --- | --- |
| input type | `email` |
| `name` | `Email Address` |
| required | `required` |

Add one hidden input inside that form:

| Property or attribute | Value |
| --- | --- |
| input type | `hidden` |
| `name` | `Profile Slug` |
| `data-starter-claim` | `profile-slug` |
| autocomplete | `off` |

The controller calls:

```text
GET https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/profile/starter/claim-status/v3?slug=<slug>
```

The response must be HTTP 200 JSON:

```json
{"schema":"starter_profile_claim_status_v3","slug":"<slug>","claimable":true}
```

The controller sets the hidden `Profile Slug` field to the current slug and
reveals the form only when the schema matches, the response slug equals the
page slug, and `claimable` is `true`. `claimable: false`, a wrong schema, wrong
slug, non-200, bad JSON, a network error, timeout, missing form markup, a form
with `data-ms-form`, or a non-`/hire/<slug>` path keeps the form hidden. The
controller makes one request per page and does not change the URL. A visitor
can edit any browser field, so the team must verify the slug against the
canonical Xano profile during manual review.

Keep the Google signup control hidden. The normal Webflow form submit is the
launch path.

Load `v3/hire-profile.js` through the existing Hire template script tag. Keep
the `hide` class as the no-JavaScript and pre-initialization state.

## Manual review contract

Webflow form notifications deliver each claim request to the team. The message
must include the visible `Email Address` field and the hidden `Profile Slug`
field. The team reviews the request and confirms the target profile in Xano.
After approval, staff must create the Memberstack account with the influencer's
email address, a temporary password, the Talent free plan
`pln_dorxata-test-free-plan-dvcg0k8o`, and custom field
`starter-claim-profile-slug` set to the approved slug. All four values must be
present on the initial account creation because Xano `#1513` links this profile
only from `member.created`.

Use the platform-ops-tools handover script
`platform-ops/scripts/starter-claim-handover.mjs` for the account handoff. It
creates the account with the required email, temporary password, Talent plan,
and slug custom field in one step. Do not use a Memberstack dashboard create
path that cannot set `starter-claim-profile-slug` at creation time.

The profile slug selects the requested target. It does not prove who scanned
the QR. Manual review remains the durable ownership gate.

## Acceptance checks

- A claimable slug shows the form on the normal profile URL and fills the
  hidden `Profile Slug` field with that slug.
- `claimable: false`, a wrong schema, wrong slug, non-200, bad JSON, network
  error, timeout, non-profile URL, or missing form markup stays hidden; the
  no-JavaScript initial state also stays hidden.
- A form with `data-ms-form` stays hidden.
- The browser sends one claim-status request only on pages with the Claim
  Profile wrapper and does not modify the URL.
- Webflow form notifications deliver the request to the team with `Email
  Address` and `Profile Slug`.
- Google remains hidden.

Run the local frontend checks with:

```sh
node --test v3/starter-profile-claim.test.js
node v3/browser-tests/starter-profile-claim.browser.cjs
```

The script can be released before the Webflow markup change. Until the matching
plain Webflow form fields exist, the controller fails closed and keeps the live
form hidden. Verify the `Email Address`, `Profile Slug`, and notification
intake before treating the Webflow form as active.
