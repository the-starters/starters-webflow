# V3 Paid Calls settings wiring

Place one native Webflow form inside the always-visible `Dashboard / Calendar` section. Do not put the setup in a modal and do not generate the form in JavaScript.

## Script

Load `v3/paid-call-settings.js` after `v3/scheduling-auth.js`. The local stage component loader already includes it.

## Native Designer attributes

Use these attributes on existing native Webflow elements:

| Element | Attribute | Value |
| --- | --- | --- |
| Settings wrapper | `data-paid-call-element` | `settings` |
| Native form | `data-paid-call-element` | `form` |
| Status text | `data-paid-call-element` | `status` |
| Enabled checkbox | `data-paid-call-input` | `enabled` |
| Title text input | `data-paid-call-input` | `title` |
| Rate number input | `data-paid-call-input` | `price` |
| Duration select | `data-paid-call-input` | `duration` |
| Save button wrapper | `data-paid-call-action` | `save` |
| Disable button wrapper | `data-paid-call-action` | `disable` |

The title must contain 3 to 80 characters. The duration select must use `15`, `30`, `45`, and `60` as option values. The rate field accepts whole US dollars from 5 to 999999.

Optional prerequisite rows use `data-paid-call-prerequisite` with one of these values:

- `calendar`
- `availability`
- `stripe`
- `charges`
- `fresh`
- `bookable`

The controller sets `data-ready="true|false"` on each row. It also sets these wrapper attributes:

- `data-paid-call-state="loading|ready|saving|disabling|error"`
- `data-paid-call-enabled="true|false"`
- `data-paid-call-bookable="true|false"`

## Authority and behavior

- Initial and terminal state comes from `GET starter/paid-call-settings/get/v3` (`#2924`).
- Save uses revision-guarded `POST starter/paid-call-settings/upsert/v3` (`#2925`).
- Turn off uses guarded `POST starter/paid-call-settings/disable/v3` (`#2923`).
- Each mutation gets a new idempotency key and is followed by canonical GET readback.
- The browser sends product intent only. It never sends a member ID, grant ID, calendar ID, Stripe account ID, or payment environment.
- Calendar setup and configuration-update behavior is owned by [the availability writer contract](README.md#booking-stage-availability-writer). Calendar code does not read `#price`, `data-rate`, or `paid_call_rate` in `localStorage`.
- Calendar transitions carry a one-use intent captured from canonical paid-call GET through the existing OAuth session envelope, then recreate it through paid-call upsert and canonical readback.
- The Xano projection function remains the only writer to `freelancers_v3.Paid_Call_Enabled` and `Paid_Call_Rate` for this flow.
- `scheduling-auth.js` authenticates only the three exact `/v3` endpoint paths. `scheduling-v3-stage.js` maps their reviewed unversioned names to those paths and blocks lookalikes.

## Release gate

Do not activate this form until the paid-call reconciliation dry run has zero unexplained differences. Repair writes, provider calls, payment canaries, reminders, and email canaries require separate approval.
