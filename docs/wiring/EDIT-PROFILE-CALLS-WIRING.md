# Edit Profile v2 Calls tab wiring

`v3/edit-profile-calls.js` runs the Calls tab of "Edit Profile v2", the staff-only draft page
`/starter-edit-profile-test` (JP 2026-11-12, decisions 1a + 2a). It loads the Starter's saved availability,
Free call and Paid call into the calls editor and saves each change ("Changes to your calls save as you make
them"). A dashboard modal (built separately) sends Starters with no calendar or no Stripe to this tab.

The live `/starter-edit-profile` is not changed. It keeps `v3/free-call-settings.js` and
`v3/paid-call-settings.js`, and this module does not boot there.

## Status

- Code only. Nothing is pinned in Webflow, and the Designer markup below is not complete yet.
- `onboarding/calendar/ensure-default/v3` (#12047) is staff-gated on the server. Only staff accounts can save
  hours on this page until that gate is removed.
- The Free and Paid settings endpoints are live. A staff test on this page writes real settings for the
  signed-in member. Use a test Starter (Memberstack "Login as Member").

## Install (page head, pinned tag, in this order)

```html
<script src=".../v3/staff-preview-guard.js" data-fallback="/starter-edit-profile"></script>
<script defer src=".../v3/profile-calls-step.js"></script>
<script defer src=".../v3/calendar-google-connect.js"></script>
<script defer src=".../v3/onboarding-calendar.js"></script>
<script defer src=".../v3/onboarding-stripe-view.js"></script>
<script defer src=".../v3/onboarding-v2-stripe.js"></script>
<script defer src=".../v3/edit-profile-calls.js"></script>
```

`onboarding-calendar.js` does not boot on this path. It only exposes `window.StartersOnboardingCalendar`
(save, Google connect, `fromItems`), which this module uses. `onboarding-stripe-view.js` and
`onboarding-v2-stripe.js` boot on this path for the Stripe card.

Do not pin `calendar-google-connect.js` here until the return URIs below are in place.

## Boot

| Module | Boots on |
| --- | --- |
| `edit-profile-calls.js` | `/starter-edit-profile-test` only: staging `https://the-starters-3-0.webflow.io`, or `thestarters.com` / `www.thestarters.com` when the page also loads `v3/staff-preview-guard.js` |
| `onboarding-v2-stripe.js`, `onboarding-stripe-view.js` | the same rule, on `/starter-edit-profile-test` and the onboarding pages |
| `profile-calls-step.js` | its route list (includes `/starter-edit-profile-test`); the edit editor mounts only on a root with `data-calls-step-context="edit"` |

`/starter-edit-profile` is out on purpose. Every other path starts nothing and sends no request.

## Markup contract

Root: `[data-calls-step="root"][data-calls-step-context="edit"]`. The module uses the first root on the page.

Already authored:

| Element | Attribute |
| --- | --- |
| Free row | `[data-call-settings-service="free"]` |
| Free switch | `input#free-consulting-calls[data-call-settings-input="enabled"]` (checkbox) |
| Free description | `input#free-call-description[data-call-settings-input="description"]` (maxlength 60; the server limit is 140) |
| Paid row | `[data-call-settings-service="paid"]` |
| Paid switch | `[data-call-settings-input="enabled"]` |
| Paid title | `#paid-call-description[data-call-settings-input="title"]` (3 to 80 characters) |
| Paid price | `#paid-call-rate[data-call-settings-input="price"]` (whole dollars, 1 to 1000) |
| Panels | `[data-call-settings-element="panel"]` in each row |
| Hours | `[data-calls-step-element]` availability, days, windows, window, extra, extra-days, error, calendar, calendar-none, calendar-connecting, calendar-connected; `[data-calls-step-input]` timezone, window-start, window-end, extra-start, extra-end; outputs live-tag, timezone-now, calendar-tag, calendar-title, calendar-body; day buttons `[data-day]` |

### Jerico must add (Designer)

1. `[data-calls-step-action="add-window"]` — "Add hours" button (under the windows list).
2. `[data-calls-step-action="remove-window"]` — the remove button in the window row template. Confirm it is
   present: the editor needs it on every row and fails without it.
3. `[data-calls-step-action="add-extra"]` — "Add hours on other days" button.
4. `[data-calls-step-action="remove-extra"]` — remove button inside `[data-calls-step-element="extra"]`.
5. `[data-calls-step-action="connect-google"]` — "Connect Google Calendar" button inside
   `[data-calls-step-element="calendar"]`, outside `calendar-connected`.
6. `[data-calls-step-action="switch-calendar"]` — inside `[data-calls-step-element="calendar-connected"]`.
   Runs the same Google flow; the shared module replaces the old grant.
7. `[data-calls-step-action="disconnect-calendar"]` — inside `calendar-connected`. For now it goes to
   `/starter-dashboard` (the dashboard calendar section owns disconnect). If it is an `<a>` with an `href`, the
   authored link is kept.
8. `[data-call-settings-output="status"]` — one short text element in each of the Free and Paid rows. It
   shows "Saved.", the blocker reason (for example "connect Stripe first") or the error.
9. Stripe block (below). Optional: `[data-calls-step-output="stripe-tag"]` inside the calls root mirrors the
   Stripe state ("Not connected", "Waiting for Stripe", "Verifying", "Connected").

### Stripe block (reuses `onboarding-stripe-view.js`)

Put it in the Paid row, outside the Paid panel, so a Starter sent by the dashboard modal sees it with Paid
off. Add `data-stripe-connect-element="root"` to the same element only if it must hide while Paid is off
(the calls editor hides that attribute when the Paid switch is off).

```
[data-onboarding-stripe="root"]
  [data-onboarding-stripe-action="start"]            primary "Connect Stripe" button (hides once started)
  [data-onboarding-stripe-element="card"]            hidden in markup; shown once Stripe is started
    [data-onboarding-stripe-output="tag"]
    [data-onboarding-stripe-output="body"]
    [data-onboarding-stripe-output="status-text"]
    [data-onboarding-stripe-element="retry"]
      [data-onboarding-stripe-output="retry-lead"]
      [data-onboarding-stripe-action="start"]        retry link
        [data-onboarding-stripe-output="retry-label"]
```

Do not add `[data-onboarding-stripe-element="confirm"]` or `[data-onboarding-stripe-element="finish"]` on this
page: they are onboarding-only. A failed start sets `data-onboarding-stripe-error="start"` on the root (style
hook). The Stripe tab ends on `/starter-dashboard`, because the server accepts only that `return_url`; this tab
re-reads the status when the Stripe tab reports back or closes, and on window focus.

### State attributes (style hooks)

| Attribute | On | Values |
| --- | --- | --- |
| `data-edit-calls-state` | calls root | `loading`, `ready`, `error` (load failed; nothing saves) |
| `data-edit-calls-hours` | calls root | `saving`, `saved`, `error` |
| `data-edit-calls-state` | each `[data-call-settings-service]` row | `saving`, `saved`, `blocked`, `invalid`, `error` |

## Data flow

| Action | Request (all with the trade-token Bearer, `api:tCpV3oqd` unless noted) |
| --- | --- |
| Load | `POST starter/get_by_memberstack/v3` (hours, timezone, `nylas_grant_id`, `nylas_grant_email`), `GET starter/free-call-settings/get/v3`, `GET starter/paid-call-settings/get/v3`, then `editor.load()`. Calendar shows connected only when `availability.manager === 'calendar'` and `nylas_grant_id` is set. |
| Hours | Any day, window, extra or timezone change, after 0.8 s and only when the hours are valid: `POST onboarding/calendar/ensure-default/v3` (#12047) `{member_id, availability: {items}, in_timezone, offer_intro_call}` with `offer_intro_call` = the Free switch. Items use the `toItems()` format. Saved dashboard day overrides (uuid or `override-<timestamp>` keys) are sent back unchanged, except that an override loses any weekly day the Starter unticks and is dropped when none remain; as on the dashboard, `general` and window `defaultDays` hold the full weekly days and their `days` leave out the days those overrides claim. |
| Free on | `free-call-settings/upsert/v3` `{config_id, description, expected_revision, idempotency_key}`, then a readback (active, 30 min, $0, same description). With no calendar or hours yet, the hours save first (this sets the platform calendar). Description typing saves after 1 s while the switch is on. |
| Free off | `free-call-settings/disable/v3` `{config_id, expected_revision, idempotency_key}`, then a readback (no active service). |
| Paid on | Title and price check, then (with no active service) the readiness check: calendar and hours, Stripe linked, charges enabled, status fresh. Then `paid-call-settings/upsert/v3` `{config_id, title, price_cents, duration_minutes: 60, expected_revision, idempotency_key}` and a readback. A blocked switch stays on and saves when the calendar or Stripe changes. |
| Paid off | `paid-call-settings/disable/v3`, then a readback. |
| Google | `grants/oauth/v3` (#1456) with `redirect_uri` = this page; the pop-up returns here and `calendar-google-connect.js` finishes it (`grants/delete/v3`, `grants/add/v3` (#1457), #12047). |
| Stripe | `api:KZf7nFnk` `stripe_connect/status/v3` and `start/v3` through `onboarding-v2-stripe.js`; it fires `starters:stripe-connect-state` on `document`, which this module reads. |

One writer per action: hours, Free and Paid each run one request at a time. A change made during a save runs
once after it. An unchanged Free or Paid service is not written again. Connect Google saves the hours itself
and cancels a queued hours autosave. Nothing saves before the load succeeds.

## Return URIs to add (before pinning `calendar-google-connect.js` here)

Google returns the pop-up to the page that started it. Add these to the Nylas application callback URIs and to
the redirect allowlist of `grants/oauth/v3` (#1456) and `grants/add/v3` (#1457):

- `https://www.thestarters.com/starter-edit-profile-test`
- `https://thestarters.com/starter-edit-profile-test`
- `https://the-starters-3-0.webflow.io/starter-edit-profile-test`

## Known gaps and risks

- #12047 and the Free/Paid endpoints may both act on the Free service: #12047 receives `offer_intro_call`. The
  Free switch remains the only writer this module calls for Free on/off; confirm what #12047 does with
  `offer_intro_call: false` before release.
- #12047 must accept the kept dashboard item keys (for example `override-<timestamp>`) in `availability.items`.
- Changes made while the page is still loading are replaced by the saved data.
- Disconnect goes to the dashboard. A deep link to its calendar section does not exist yet.

## QA (staging, then production with the staff guard)

1. Log in as a test Starter. Open the Calls tab: the saved hours, timezone, Free and Paid values show.
2. Change a day: one #12047 request after the pause; reload shows the change.
3. Free on/off and description; Paid on with no Stripe shows the Stripe reason; connect Stripe and the Paid
   call saves.
4. Connect Google: the pop-up returns to this page and closes; the calendar shows connected.
5. Open `/starter-edit-profile` and `/starter-dashboard`: no request from this module.
