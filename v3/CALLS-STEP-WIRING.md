# Calls step wiring

The browser script only activates on the exact origin `https://the-starters-3-0.webflow.io` and the path listed below.

Build mounts on `/build-profile/full-profile-test` and `/build-profile/consult-test` when the form has a `[data-calls-step="root"]` inside `[data-form="step"][data-index="6"]`. Edit mounts on `/starter-edit-profile-test` with `data-calls-step-context="edit"` on that root. The Edit pane carries no form index. Build owns its Continue preflight on the existing `[data-form="next-btn"]`. Edit saves calls independently of Services.

| Hook | Values and ownership |
| --- | --- |
| `data-call-settings-service`, `data-call-settings-element`, `data-call-settings-input` | Free and paid service roots, panel, and enabled, description, title and price. Enabled is a native checkbox. Unchecked maps to the legacy Build draft value `no`. |
| `data-calls-step-element` | Availability, days, windows, window, extra, extra-days, error, calendar, calendar-connecting and calendar-connected. Edit also has calendar-none and required-tag. |
| `data-calls-step-input` | timezone, window-start, window-end, extra-start, extra-end. |
| `data-calls-step-action` | add-window, remove-window, add-extra, remove-extra, connect-google, switch-google and disconnect-google. Component actions belong on the Button instance. |
| `data-calls-step-output` | timezone-now, calendar-tag, calendar-title, calendar-body, stripe-tag (Build), live-tag (Edit). Set tag text and tone together. |
| `data-stripe-connect-element="root"`, `data-stripe-connect-action="start"` | Stripe client owns account status and start/retry. |

Google is optional. Edit's Live tag requires an enabled call and saved hours. Build Continue requires an enabled call, a valid price when paid is on, and valid hours. Consult requires paid calls. Reuse scheduling auth and the availability and call-settings writers. Provision the platform calendar before the first save without seeding hours.

## Saved Webflow preflight, 3 November 2026

Full Profile Test (`6ae41b87662d53e0bbfac832`) and Edit Profile Test (`6aab4c38d8fb3081fee9063f`) expose the 3 November output hooks in the saved element tree. Button instance attributes require Designer or rendered DOM verification because the element API omits them.

Consult Test (`6ae4249b60c929ab61ff5eff`) now has `calendar-tag`, `calendar-title`, `calendar-body`, `stripe-tag` and the two hidden Calendar state elements. The legacy `calendar-status` and `stripe-status` strips were removed. Designer showed the direct `switch-google` and `disconnect-google` actions and the hidden Stripe retry with `data-stripe-connect-action="start"` and `data-stripe-connect-element="retry"`. The saved element tree outside the Calls root matched its baseline. No legacy output fallback is part of the contract.

Build final submit reads the authored checkbox directly because FormData omits unchecked controls. The normalized choice still goes through the member-bound pending intent receipt. Generic Build draft storage deliberately excludes call settings and remains separate from that receipt.

The 22 October booking QA captured Xano refusing a Brand booking with “Select a call more than 24 hours from now” (commit `6442c3b5`). The Paid provider configuration is also server-owned, as documented in the scheduling section of `v3/README.md`. An 8-hour frontend cutoff requires confirmation that the deployed booking endpoint and existing provider configurations accept it.

The hours editor uses the authored `data-day` buttons, including their native disabled and aria-pressed states. It clones the existing window and day markup, and its read operation returns timezone, weekly days, windows and optional additional days. It reports validation before the route's persistence adapter handles Continue.

Frontend state is supplied through `StarterProfileCallsStep.editorFor(root).setStatus({ calendar, email, stripe, hoursSaved })`. Calendar takes `disconnected`, `connecting` or `connected`. Stripe takes `disconnected`, `opened`, `pending` or `ready`. Values can be updated independently. A weekly-hours change clears the local saved indicator until the caller confirms the write. The editor never initiates network requests.

The standalone staging page `/build-profile-form-test` mounts the same Calls component without a multi-step wrapper. It uses a page-local loader and prevents form submission during frontend QA.
