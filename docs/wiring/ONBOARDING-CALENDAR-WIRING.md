# Onboarding v2 calendar step wiring

Staff-only preview on `/starter-onboarding-v2` (JP 2026-11-09). Step 5 "Set your availability" sits before
step 6 "Get paid" in both forms (Full and Consult).

## Markup (Webflow)

- Step block `[data-form-flow-element="step-5"][data-onboarding-calendar="step"]`.
- Inside: `[data-calls-step="root"][data-calls-step-context="onboarding"]` wrapping the
  "Build Profile Calls Form" component, and `[data-form-flow-button-group="step-5"]` with Back (secondary)
  and Next (primary) Button instances.

## Scripts (page head, pinned, after the staff guard)

`v3/profile-calls-step.js`, then `v3/calendar-google-connect.js`, then `v3/onboarding-calendar.js`.

Do not pin `v3/calendar-google-connect.js` until the Xano allowlist for `grants/oauth/v3` (#1456) and
`grants/add/v3` (#1457) and the Nylas callback URIs include the onboarding pages (released separately).

| Part | Rule |
| --- | --- |
| Calls editor | Onboarding context: hours + Google only. Call switches and the component Stripe card stay hidden. |
| Next | Validates hours, `POST api:tCpV3oqd/onboarding/calendar/ensure-default/v3` (#12047, staff-gated): platform calendar if no Google calendar, hours, Free scheduler config. Then the click reaches the form flow. |
| Connect Google | Reserves a pop-up in the click and saves first. `calendar-google-connect.js` posts `grants/oauth/v3` (#1456) with `redirect_uri` = this page (origin + path), writes localStorage `starters-google-connect-intent` = `{memberId, redirectUri, createdAt}`, and the pop-up opens Google. Google returns the pop-up to the same onboarding page; the first tab keeps its form state. The pop-up takes `code`/`state` off the URL at load, accepts them only when `state` is the session member and the intent matches this member and page and is at most 15 minutes old, then: `starter/get_by_memberstack/v3`, `grants/delete/v3` for the current platform grant (#1457 refuses to bind over one), `grants/add/v3` with the same redirect, `onboarding/calendar/ensure-default/v3` (#12047) with the stored items and timezone. If the add fails after the delete, #12047 runs again to put the platform calendar back; if only #12047 fails after the add, it is retried once. A cancel at Google writes nothing. The pop-up posts `{type: 'calendar-connected' \| 'calendar-connect-failed', memberId}` on BroadcastChannel `starters-calendar-connect-return` and closes on success (on failure it stays open with the message). The step ignores other members and re-reads `starter/get_by_memberstack/v3` (also on focus and when the pop-up closes; a new click replaces the previous watcher). The dashboard deep link `/starter-dashboard?onboarding_calendar=connect-google` is no longer used by onboarding but stays in the dashboard for now. |
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
