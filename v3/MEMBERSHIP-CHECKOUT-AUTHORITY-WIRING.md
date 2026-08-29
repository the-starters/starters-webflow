# V3 Membership Checkout Authority Wiring

## Boundary

- V2 stays live and unchanged.
- Do not edit or pause V2 Zaps, Stripe paths, Mailchimp templates, or Webflow code.
- V2 is a read-only reference for observed behavior.
- V3 must use its own checkout identity, authority row, webhook, and email event.

## Install

Load this GitHub-owned controller once on the V3 `/` and `/quiz-results` pages:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/membership-checkout-authority.js"></script>
```

The controller uses the existing native Memberstack `data-ms-price:add` controls.
It does not create or replace Webflow form or checkout markup.

## Contract

Before Memberstack opens Stripe checkout, the controller:

1. Confirms the V3 host, route, and price allowlists.
2. Trades the active Memberstack session for the canonical Xano V3 session.
3. Registers one `membership_checkout_intent` through the authenticated V3 endpoint.
4. Opens the original native Memberstack checkout only after Xano accepts the intent.

Registration failure blocks checkout. It does not fall back to V2.

The server must later bind the exact Memberstack connection and Stripe subscription
to the pending intent. A V3 renewal email is allowed only after that exact binding.
Unbound or legacy subscriptions fail closed from the V3 email path.

## Release gate

- Publish the Xano table and registrar first, with exact draft-free readback.
- Release this script through GitHub, a new semver tag, and jsDelivr purge.
- Preserve and verify the complete Webflow custom-code block before publish.
- Run one owned Stripe Test checkout with action-time confirmation.
- Prove the V3 payment pattern does not match the unchanged V2 Zap filter.
- Run one owned Stripe Live canary with action-time confirmation.
