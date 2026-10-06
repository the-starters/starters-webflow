# V3 Membership Checkout Authority Wiring

## Boundary

- V2 stays live and unchanged.
- Do not edit or pause V2 Zaps, Stripe paths, Mailchimp templates, or Webflow code.
- V2 is a read-only reference for observed behavior.
- V3 must use its own checkout identity, authority row, webhook, and email event.

## Install

Load this GitHub-owned controller once in the V3 site head, before
`v3/route-guard.js` and other scripts that redirect the dashboard:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/membership-checkout-authority.js"></script>
```

The controller uses the existing native Memberstack `data-ms-price:add` controls.
It does not create or replace Webflow form or checkout markup.
It captures clicks on `window`, before Memberstack's `document` capture listener,
so the authority row is committed first regardless of script load order.
While checkout is being prepared, the clicked control's authored
`[data-button-spinner]` is shown through its existing `data-opp-loading`
contract. The shared Sign Out loader must keep its `data-ms-loader` attribute for
real logout, form, and profile actions; this controller temporarily hides only
that loader's visibility during checkout handoff and releases the hold as soon
as a separate real Memberstack action starts.

## Runtime allowlists

The controller boots only on these V3 hosts:

- `thestarters.com`
- `www.thestarters.com`
- `the-starters-3-0.webflow.io`

It allows checkout on the V3 funnel routes `/` and `/quiz-results`, the public routes
`/all-starters`, `/why-us`, `/become-a-starter`, and `/case-studies`,
the `/learn` landing page and paths beneath it,
and the single-segment CMS families `/hire`, `/categories`, `/subcategories`,
`/companies`, `/competitors`, `/functions`,
`/industries`, `/roles`, `/skills`, `/tools`, and `/case-studies`. Each CMS
route requires one slug with only lowercase letters, numbers, and single
hyphens. Learn paths may have multiple segments with the same character rules.
All paths are case-sensitive. Malformed paths and nested paths outside Learn
fail closed.
`/partners` and `/services` remain excluded because their sampled live items
returned 404. The controller removes trailing slashes before it records the source path. It gates
only these V3 Memberstack price IDs:

- `prc_premium-monthly--fn1ae0qjj`
- `prc_paid-annual-2o5f040u`

The controller does not attach a click listener on any other host. On a V3 host,
it blocks price controls on non-allowlisted routes or with non-allowlisted price
IDs without sending a registrar request.

## Contract

Before Memberstack opens Stripe checkout, the controller:

1. Confirms the V3 host, safe source path, and price allowlists.
2. Reads the active Memberstack member so the pending identity cannot cross
   members.
3. Exchanges the active Memberstack session through the published POST/body
   `auth/trade-token/v3` boundary.
4. Sends the returned Xano `user_v3` token to the authenticated registrar.
5. The registrar registers one `membership_checkout_intent`.
6. Replays the original clicked control so native Memberstack checkout opens
   only after Xano accepts the intent.

An authentication, secure event identity, intent storage, or registration
failure blocks checkout. It does not fall back to V2. After the controller
clears its pending state, the member can retry. Failed and accepted registrations
reuse the same pending event identity and original route for that price until
the two-hour intent expires. A member change replaces that pending identity.
Failure also restores the clicked checkout control's authored loading state.
After an accepted intent, the Get Started spinner stays lit while native
Memberstack checkout starts. If the shared Sign Out loader is absent, never
appears, or cannot be observed, a bounded three-second fallback restores the
clicked control. If the Sign Out loader is observed, the clicked control restores
when that loader finishes or at the two-minute safety cap. Cleanup is idempotent.

The published POST trade endpoint owns Memberstack session verification. The
Memberstack token stays out of URLs and travels only in its JSON request body.
The registrar keeps `auth = user_v3`, rejects a missing, invalid, or expired Xano
bearer before it writes an intent, and resolves the canonical user from `$auth.id`.

The server must later bind the exact Memberstack connection and Stripe subscription
to the pending intent. A V3 renewal email is allowed only after that exact binding.
Unbound or legacy subscriptions fail closed from the V3 email path.

## Browser Purchase contract

The existing dashboard destination remains the paid-plan success redirect.
The controller captures Memberstack's `fromCheckout=true` and allowlisted
`msPriceId` on `/dashboard`, `/brand-dashboard`, `/complete-profile`, or
`/all-starters` before asynchronous routing can drop the query string. It saves
an expiring return record in session storage and resumes verification on these
routes after navigation. A return must match an accepted checkout intent in
this tab, including the authenticated member and the registrar's canonical
`intent_key`. URL amounts and a member's current plan amount are never proof of
payment.

`POST membership/checkout-receipt/v3` requires the same `user_v3` bearer as the
registrar. Its inputs are `intent_key` and `stripe_price_id` (the existing
Memberstack price ID vocabulary). The read-only endpoint checks authenticated
ownership, origin, environment, expiry, the signed lifecycle binding, and the
exact subscription snapshot. It reads Stripe Checkout Sessions for that
subscription and customer in the intent's two-hour window. Multiple matches,
unbound or foreign subscriptions, wrong modes, zero payments, trials, and
unsupported currencies cannot produce a paid receipt. `pending` means the
binding, snapshot, or payment is not yet ready; the browser retries up to twelve
times with 2.5 seconds between reads and a twelve-second timeout per read.

A paid receipt contains `ok: true`, `status: "paid"`, `intent_key`,
`stripe_price_id`, `transaction_id` (the actual Stripe Checkout Session ID),
`amount_total` (integer cents including discounts and tax), `currency: "USD"`,
and `source_environment`. Only production receipts on the production hosts
send `trackSingle` Purchase to the existing pixel `775648331097942`. The amount
is cents divided by 100. The Session ID is also the event ID and permanent
same-browser local-storage deduplication key. A Web Lock serializes dispatch
across tabs. Missing pixel, blocked storage, or unsupported Web Locks fails
closed and leaves the pending return available for refresh. Browser storage
clearing and a different browser are outside this deduplication boundary.

The controller does not install another base pixel or send events through the
Conversions API. Test receipts on the V3 staging host set
`data-v3-membership-purchase="test-verified"` without sending fake revenue.
The document root also reports `verifying`, `pending`, `unverified`, `queued`,
or `already-sent`. `queued` confirms the browser call, not receipt by Meta.
After verification or duplicate suppression, checkout parameters are removed
with `history.replaceState`; unrelated query parameters and the hash survive.

The backend deployment candidates are
[`checkout-receipt`](../../v3/xano-workspace/api/v3_0_starters/membership/checkout/receipt/v_3_POST.xs)
and its
[`Stripe receipt validator`](../../v3/xano-workspace/function/membership/checkout_session_receipt_v_3.xs).
Committing these documents does not deploy Xano. Deploy and exercise this
read-only endpoint before releasing the browser controller. The production
backend branch, Memberstack redirects, and native pixel configuration require
no change for candidate preparation.

## Release gate

- Deploy the bearer-verifying registrar, receipt endpoint, and receipt
  validator first, with exact draft-free readback and runtime checks.
- Release this script through GitHub with a new semver tag and jsDelivr purge.
- Preserve and verify the complete Webflow custom-code block before publish.
- Run one owned Stripe Test checkout with action-time confirmation.
- Prove the V3 payment pattern does not match the unchanged V2 Zap filter.
- Run one owned Stripe Live canary with action-time confirmation.
