# Setup gate frontend

## Dashboard gate (`v3/starter-setup-gate.js`, JP 2026-11-12 decision 1a, 2026-11-16 link-out per screen)

On `/starter-dashboard`, a Starter missing availability/calendar or Stripe sees the setup dialog on every visit
until both are done. The dialog uses the All Modals "Finish setting up your account" design and shows one
screen per missing item, availability first, then Stripe:

| Screen | Main button | Result |
| --- | --- | --- |
| `[data-setup-step="availability"]` | `a[data-setup-action="go-calendar"]` | Link to Edit Profile v2 › Calls (`/starter-edit-profile-test#calls`); the module sets the `href` |
| `[data-setup-step="stripe"]` | `[data-setup-action="go-stripe"]` | Kaeser 2026-11-18: when the first visible dashboard Stripe card has a visible `[data-stripe-connect-action="start"]`, clicks it in the same click (so the browser allows the Stripe tab) and closes the dialog. Otherwise (card loading, in review or in error) it closes the dialog, waits for the shared modal's `modal-close` event after the 300 ms fade-out (1 s fallback), scrolls to the first visible dashboard Stripe card `[data-stripe-connect-element="root"]` and focuses its visible `[data-stripe-connect-action="start"]` when that control can take focus (native button/link or `tabindex="0"`); otherwise it focuses the card root, adding `tabindex="-1"` only when the card has no authored `tabindex` (Jai 2026-11-14: Stripe stays on the dashboard) |
| `/starter-dashboard#stripe` | (no dialog) | Link from the Edit Profile v2 paid-call Stripe reason (JP 2026-11-17). For staff only: the dialog stays closed, the hash is removed with `history.replaceState`, and the page scrolls to the Stripe card once no `[data-stripe-connect-element="loading"]` shows inside it (10 s limit), with the same focus rule as `go-stripe` |

- `[data-setup-action="skip"]` ("Skip for now") shows the next missing screen, or closes after the last one.
- Any `[data-modal-close]` closes the dialog for this visit only. Other `[data-setup-step]` screens (calendar,
  done) stay hidden.
- Legacy list markup still works: `[data-setup-missing="availability|stripe"]` items and `a[data-setup-action="go"]`.
- **Staff-only until launch:** load `v3/staff-preview-guard.js` with `data-mode="flag"` in the dashboard head
  (normal script tag, before this module). Flag mode never hides or redirects; this module runs only when
  `window.StartersStaffPreview` resolves `true`. Without the flag guard it does nothing.
- **Status:** `GET api:tCpV3oqd/starter/paid-call-settings/get/v3` → `readiness`. `availability` is missing when
  `availability_configured` or `calendar_connected` is not true; `stripe` when `stripe_connect_linked` is not true.
  Google Calendar is optional and never opens the gate. A failed read opens nothing.
- **Dialog:** `dialog.modal_dialog[data-modal-target="starter-setup-required"][data-setup-gate]` on the dashboard,
  opened with `lumos.modal.open('starter-setup-required')` (`global-embeds/modal/modal.js`, live on all pages).

## Step view (`v3/starter-setup-gate-view.js`, staging `/all-modals`)

The in-modal setup design (decision 1b, not used for the dashboard gate):

The browser script only activates on the exact origin `https://the-starters-3-0.webflow.io` and the path listed below.

The setup dialog carries `data-setup-gate` and contains one element for each `data-setup-step` value. The signed-in page integration calls `StarterSetupGateView.mount(dialog)` on the staging All Modals page (`/all-modals`) and owns opening and closing through the shared modal system. The view accepts availability, calendar and Stripe status from that integration. It handles Back, Skip for now, and keyboard activation of the authored close control.

The caller invokes `begin(status)` to get the first step. Calendar is optional and can only appear in a plan with a required step. Calling `advance(status)` renders the next remaining step or Done. Skip stays in effect for the mounted page view. The integration supplies status after a confirmed operation and owns all writes.
