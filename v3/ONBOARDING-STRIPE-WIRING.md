# Onboarding Stripe frontend

The browser script activates on the exact staging origin `https://the-starters-3-0.webflow.io` and the paths listed below. On `thestarters.com` and `www.thestarters.com` it activates on the same paths only when the page also loads `v3/staff-preview-guard.js` (staff-only until launch).

On `/starter-onboarding-v2` and the legacy `/starter-onboarding-test` path, both step 5 roots carry `data-onboarding-stripe="root"`. The caller supplies the account state to `StarterOnboardingStripeView.render(root, state)`. Supported states are `none`, `opened`, `pending` and `ready`. Unknown states leave the last rendered state in place.

The renderer updates the card, tag, body, live status and retry copy through the authored hooks. The retry button remains outside the live region. The ready tag gets `data-tone="ok"`. `canContinue(root)` checks the rendered Stripe state and the authored confirmation checkbox. The step controller owns submission and the integration owner supplies Stripe status and actions; on `/starter-onboarding-v2` that owner is `v3/onboarding-v2-stripe.js` ([wiring](../docs/wiring/ONBOARDING-V2-STRIPE-WIRING.md)). The view also boots on the staff-only `/starter-edit-profile-test`, where the card has no confirmation checkbox ([wiring](../docs/wiring/EDIT-PROFILE-CALLS-WIRING.md)).
