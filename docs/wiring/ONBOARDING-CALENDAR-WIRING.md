# Onboarding v2 calendar step wiring

Staff-only preview on `/starter-onboarding-v2` (JP 2026-11-09). Step 5 "Set your availability" sits before
step 6 "Get paid" in both forms (Full and Consult).

## Markup (Webflow)

- Step block `[data-form-flow-element="step-5"][data-onboarding-calendar="step"]`.
- Inside: `[data-calls-step="root"][data-calls-step-context="onboarding"]` wrapping the
  "Build Profile Calls Form" component, and `[data-form-flow-button-group="step-5"]` with Back (secondary)
  and Next (primary) Button instances.

## Scripts (page head, pinned, after the staff guard)

`v3/profile-calls-step.js`, then `v3/onboarding-calendar.js`.

| Part | Rule |
| --- | --- |
| Calls editor | Onboarding context: hours + Google only. Call switches and the component Stripe card stay hidden. |
| Next | Validates hours, `POST api:tCpV3oqd/onboarding/calendar/ensure-default/v3` (#12047, staff-gated): platform calendar if no Google calendar, hours, Free scheduler config. Then the click reaches the form flow. |
| Connect Google | Reserves a tab in the click, saves first (the dashboard switches platform -> Google only), writes localStorage `starters-onboarding-google-request` = `{memberId, createdAt}`, then opens `/starter-dashboard?onboarding_calendar=connect-google`. The dashboard consumes that request once and starts OAuth only when it names the session member and is at most 5 minutes old; the link alone does nothing. The dashboard posts `{type: 'calendar-connected', memberId}` on BroadcastChannel `starters-calendar-connect-return`; the step ignores other members and re-reads `starter/get_by_memberstack/v3` (also on focus and when the tab closes; a new click replaces the previous watcher). |
| Status | Google connected = `availability.manager === 'calendar'` with a grant. |

## Hours format (Jai: several windows in one day)

| Editor | Saved item |
| --- | --- |
| Window 1 | `general` {days, start, end, defaultDays} |
| Window 2..n | `window-<n>` {days, start, end, defaultDays, kind: 'window'} |
| Additional days | `override-onboarding` {days, start, end} |

#1463 accepts separated windows on one weekday. The dashboard (`scheduling-availability-section.js`) treats
`kind: 'window'` items as added hours: they never take days from `general`, and an edit keeps the marker. A day
override replaces the whole day: it takes its days from `general` and every window (both return to `defaultDays`
when it is removed). A window with no days left is kept in memory but not saved, since #1463 rejects an empty window.
