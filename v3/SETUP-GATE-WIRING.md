# Setup gate frontend

The browser script only activates on the exact origin `https://the-starters-3-0.webflow.io` and the path listed below.

The setup dialog carries `data-setup-gate` and contains one element for each `data-setup-step` value. The signed-in page integration calls `StarterSetupGateView.mount(dialog)` on the staging All Modals page (`/all-modals`) and owns opening and closing through the shared modal system. The view accepts availability, calendar and Stripe status from that integration. It handles Back, Skip for now, and keyboard activation of the authored close control.

The caller invokes `begin(status)` to get the first step. Calendar is optional and can only appear in a plan with a required step. Calling `advance(status)` renders the next remaining step or Done. Skip stays in effect for the mounted page view. The integration supplies status after a confirmed operation and owns all writes.
