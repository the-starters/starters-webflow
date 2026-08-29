# V3 Membership Checkout Authority Wiring

## Boundary

- V2 stays live and unchanged.
- Do not edit or pause V2 Zaps, Stripe paths, Mailchimp templates, or Webflow code.
- V2 is a read-only reference for observed behavior.
- V3 must use its own checkout identity, authority row, webhook, and email event.

## Install

Load this GitHub-owned controller once in the V3 site head:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/membership-checkout-authority.js"></script>
```

The controller uses the existing native Memberstack `data-ms-price:add` controls.
It does not create or replace Webflow form or checkout markup.

## Runtime allowlists

The controller boots only on these V3 hosts:

- `thestarters.com`
- `www.thestarters.com`
- `the-starters-3-0.webflow.io`

It listens on the V3 funnel routes `/` and `/quiz-results`, the public routes
`/all-starters` and `/why-us`, and the single-segment CMS families `/hire`,
`/categories`, `/subcategories`, `/companies`, `/competitors`, `/functions`,
`/industries`, `/roles`, `/skills`, and `/tools`. Each CMS route requires one
slug with only lowercase letters, numbers, and single hyphens. Nested or
malformed paths fail closed. `/partners` and `/services` remain excluded because
their sampled live items returned 404. The controller removes trailing slashes
before it records the source path. It gates only these V3 Memberstack price IDs:

- `prc_premium-monthly--fn1ae0qjj`
- `prc_paid-annual-2o5f040u`

The controller does not attach a click listener on any other host. On V3, it
leaves a non-allowlisted price control to its existing owner without sending a
registrar request.

## Contract

Before Memberstack opens Stripe checkout, the controller:

1. Confirms the V3 host, safe source path, and price allowlists.
2. Exchanges the active Memberstack session through the published POST/body
   `auth/trade-token/v3` boundary.
3. Sends the returned Xano `user_v3` token to the authenticated registrar.
4. The registrar registers one `membership_checkout_intent`.
5. Opens the original native Memberstack checkout only after Xano accepts the intent.

An authentication, secure event identity, or registration failure blocks
checkout. It does not fall back to V2. After the controller clears its pending
state, the member can retry. A failed registration keeps the same event identity
for that route and price; an accepted registration clears it.

The published POST trade endpoint owns Memberstack session verification. The
Memberstack token stays out of URLs and travels only in its JSON request body.
The registrar keeps `auth = user_v3`, rejects a missing, invalid, or expired Xano
bearer before it writes an intent, and resolves the canonical user from `$auth.id`.

The server must later bind the exact Memberstack connection and Stripe subscription
to the pending intent. A V3 renewal email is allowed only after that exact binding.
Unbound or legacy subscriptions fail closed from the V3 email path.

## Release gate

- Publish the Xano table and bearer-verifying registrar first, with exact
  draft-free readback.
- Release this script through GitHub with the `v1.59.430` tag and jsDelivr purge.
- Preserve and verify the complete Webflow custom-code block before publish.
- Run one owned Stripe Test checkout with action-time confirmation.
- Prove the V3 payment pattern does not match the unchanged V2 Zap filter.
- Run one owned Stripe Live canary with action-time confirmation.
