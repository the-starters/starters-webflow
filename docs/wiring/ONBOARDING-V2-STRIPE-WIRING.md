# Onboarding v2 Stripe step wiring

`v3/onboarding-v2-stripe.js` connects the Stripe step on `/starter-onboarding-v2` (staff-only preview,
JP 2026-11-09) to the live Stripe Connect API. Rendering stays in Jerico's `v3/onboarding-stripe-view.js`.

## Install (page head, pinned tag, in this order)

```html
<script src=".../v3/staff-preview-guard.js" data-fallback="/starter-onboarding"></script>
<script defer src=".../v3/onboarding-done-redirect.js"></script>
<script defer src=".../v3/patch-onboarding-status.js"></script>
<script defer src=".../v3/onboarding-stripe-view.js"></script>
<script defer src=".../v3/onboarding-v2-stripe.js"></script>
```

The two onboarding scripts are also in an older page embed (pinned `v1.59.731` / `v1.59.47`).
Their boot flags make the head copies win, because deferred head scripts run first.

## Behavior

| Part | Rule |
| --- | --- |
| Status | `POST api:KZf7nFnk/stripe_connect/status/v3`: disconnected -> `none`, incomplete -> `opened`, review -> `pending`, ready -> `ready` |
| Start | `[data-onboarding-stripe-action="start"]` reserves a tab in the click, `POST stripe_connect/start/v3` with `return_url = <origin>/starter-dashboard` (the only value the server accepts), sends the tab to `connect.stripe.com` |
| Return | Callback page BroadcastChannel `starters-stripe-connect-return`, window focus, or tab close -> status re-read (0, 1.5, 4, 8 s) |
| Submit | A form with a Stripe root does not submit until `StarterOnboardingStripeView.canContinue(root)` (Stripe started + confirmation ticked). Sets `data-onboarding-stripe-required="true"` on the root. |
| Done | `patch-onboarding-status.js` and `onboarding-done-redirect.js` also run on `/starter-onboarding-v2` |

Boot: staging origin, or production hosts only when the page loads `v3/staff-preview-guard.js`.
