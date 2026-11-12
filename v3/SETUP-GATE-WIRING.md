# Setup gate frontend

## Dashboard gate (`v3/starter-setup-gate.js`, JP 2026-11-12 decision 1a)

On `/starter-dashboard`, a Starter missing availability/calendar or Stripe sees the setup dialog on every visit
until both are done. The dialog lists what is missing and sends them to Edit Profile v2 › Calls
(`/starter-edit-profile-test#calls`). "Later" (any authored `[data-modal-close]`) closes it for this visit only.

- **Staff-only until launch:** load `v3/staff-preview-guard.js` with `data-mode="flag"` in the dashboard head
  (normal script tag, before this module). Flag mode never hides or redirects; this module runs only when
  `window.StartersStaffPreview` resolves `true`. Without the flag guard it does nothing.
- **Status:** `GET api:tCpV3oqd/starter/paid-call-settings/get/v3` → `readiness`. `availability` is missing when
  `availability_configured` or `calendar_connected` is not true; `stripe` when `stripe_connect_linked` is not true.
  Google Calendar is optional and never opens the gate. A failed read opens nothing.
- **Markup:** the shared modal dialog `dialog.modal_dialog[data-modal-target="starter-setup-required"][data-setup-gate]`
  on the dashboard, with `[data-setup-missing="availability"]`, `[data-setup-missing="stripe"]`,
  `a[data-setup-action="go"]` (href set by the module) and a `[data-modal-close]` "Later". Opened with
  `lumos.modal.open('starter-setup-required')` (`global-embeds/modal/modal.js`, live on all pages).

## Step view (`v3/starter-setup-gate-view.js`, staging `/all-modals`)

The in-modal setup design (decision 1b, not used for the dashboard gate):

The browser script only activates on the exact origin `https://the-starters-3-0.webflow.io` and the path listed below.

The setup dialog carries `data-setup-gate` and contains one element for each `data-setup-step` value. The signed-in page integration calls `StarterSetupGateView.mount(dialog)` on the staging All Modals page (`/all-modals`) and owns opening and closing through the shared modal system. The view accepts availability, calendar and Stripe status from that integration. It handles Back, Skip for now, and keyboard activation of the authored close control.

The caller invokes `begin(status)` to get the first step. Calendar is optional and can only appear in a plan with a required step. Calling `advance(status)` renders the next remaining step or Done. Skip stays in effect for the mounted page view. The integration supplies status after a confirmed operation and owns all writes.
