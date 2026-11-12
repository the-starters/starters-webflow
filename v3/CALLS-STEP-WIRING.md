# Calls step wiring

The browser script activates on the exact staging origin `https://the-starters-3-0.webflow.io` and the paths listed below. On `thestarters.com` and `www.thestarters.com` it activates on the same paths only when the page also loads `v3/staff-preview-guard.js` (staff-only until launch).

Edit mounts on `/starter-edit-profile-test` with `data-calls-step-context="edit"` on that root. The Edit pane carries no form index. Onboarding mounts on `/starter-onboarding-v2` and `/starter-onboarding-v2-wip` with `data-calls-step-context="onboarding"` on that root: hours and Google only, call switches and the Stripe card hidden ([onboarding calendar wiring](../docs/wiring/ONBOARDING-CALENDAR-WIRING.md)). Build Profile mounts on `/build-profile/full-profile-test`, `/build-profile/consult-test`, `/build-profile/full-profile` and `/build-profile/consult` for a root inside any `[data-form="step"]` that has no `data-calls-step-context` or has `data-calls-step-context="build-profile"` (no marker is needed: a new attribute written through the Webflow Data API is not published, and full-profile uses the shared Calls Form component): hours, Google and the Free switch; the Paid row is hidden, unchecked and disabled, the Stripe card is hidden, and Continue needs valid hours only ([onboarding calendar wiring](../docs/wiring/ONBOARDING-CALENDAR-WIRING.md#build-profile-context-jp-2026-11-12-1a--2a)). Build owns its Continue preflight on the existing `[data-form="next-btn"]`. Edit saves calls independently of Services.

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

The hours editor uses the authored `data-day` buttons, including their native disabled and aria-pressed states. It clones the existing window and day markup, and its read operation returns timezone, weekly days, windows and optional additional days. Each weekly window has a visible native remove button. The sole remaining window’s button is disabled and uses the not-allowed cursor. It reports validation before the route's persistence adapter handles Continue.

Frontend state is supplied through `StarterProfileCallsStep.editorFor(root).setStatus({ calendar, email, stripe, hoursSaved })`. Calendar takes `disconnected`, `connecting` or `connected`. Stripe takes `disconnected`, `opened`, `pending` or `ready`. Values can be updated independently. `offerIntroCall()` returns the Free switch state, or `true` where the step shows no Free switch (onboarding). A weekly-hours change clears the local saved indicator until the caller confirms the write. The editor never initiates network requests.

`load(state)` fills the editor from saved data in every context: `{ timezone, days, windows: [{start, end}], extra: {days, start, end} | null, free: {enabled, description}, paid: {enabled, title, price} }`. Times may be saved 24 h `HH:MM` or editor `9:00 AM`. An off-grid time or an unknown timezone is added as an option, not dropped. Absent keys keep the authored values. The Paid row is not filled in onboarding or Build Profile. `load()` sets no saved flag; the caller sends `setStatus({ hoursSaved })`. `v3/edit-profile-calls.js` is the caller on `/starter-edit-profile-test` ([wiring](../docs/wiring/EDIT-PROFILE-CALLS-WIRING.md)).

The standalone staging page `/build-profile-form-test` mounts the same Calls component without a multi-step wrapper. It uses a page-local loader and prevents form submission during frontend QA. The block is a capture listener on the root's closest `<form>`, so the root must sit inside one. The loader and TO alignment CSS stay page-local, and the Webflow page is not republished. The live toggle and submit-block check is pending republication.
