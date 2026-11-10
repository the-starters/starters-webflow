# Complete Profile call step

After a paid Brand saves Complete Profile, they can request a free 30-minute
welcome call with Jai or continue to the Brand dashboard. The step replaces the
form on the same page. Reloading after the save goes to the dashboard through
the existing [page-load redirect](COMPLETE-PROFILE-REDIRECT-WIRING.md).
`/complete-profile-trial` keeps its direct dashboard redirect.

## Webflow markup

In Designer, wire this only on `/complete-profile`. Keep the form's
`redirect="/brand-dashboard"` as the fallback if the step cannot start. Wrap
the full Webflow Form Block in the details column so the form and its Webflow
success message disappear together.

| Element | Custom attributes | Authoring notes |
| --- | --- | --- |
| Existing details column | `data-complete-profile-details` | Contains the existing form and its Webflow success and error states. |
| Call step section | `data-complete-profile-call-step`, `data-call-host-member="mem_clxzbkxqi02ya0sreedez9c8f"`, `data-call-host-slug="jai"` | Author hidden. Includes the headlines, quote, photo and card. |
| Calendar mount | `data-complete-profile-call-calendar`, `data-booking-confirm-class="…"` | Leave empty. Supply the Webflow primary button classes that style a bare `<button>`. |
| Calendar card footer | `data-complete-profile-call-footer` | Place outside the calendar mount. Right-align the actions in a 98 px row on desktop. The script moves the generated booking button after Continue. |
| Continue to dashboard button | `data-complete-profile-call-continue` | Inside the footer. Use a native `<button type="button">`. |
| Request sent block | `data-complete-profile-call-success` | Author hidden, outside the calendar mount and its footer. Copy the existing Webflow call card from the booking popup's `[schedule-step="success"]`. Keep `booking-element="start-date"`, `"start-time"`, `"price"`, `"paid-meeting"`, `"context"`, `booking-element-wrap` and `booking-success-text`. |
| Go to dashboard button | `data-complete-profile-call-done` | Inside the success block. Use a native `<button type="button">`. |
| Booking headline and subcopy | `data-complete-profile-call-heading` | “Before you dive in, book a free call with Jai” and its subcopy. |
| Success headline and subcopy | `data-complete-profile-call-heading-done` | Author hidden. “You're all set. Talk soon.” and “In the meantime, explore vetted talent and start building your team.” |
| Calendar unavailable block | `data-complete-profile-call-unavailable` | Author hidden, outside the calendar mount. “Jai's calendar isn't loading right now” and “You can still dive in. Book a free call with Jai any time from his profile.” Continue stays available and becomes the primary action. |

Use the existing `hide` utility, `hidden` attribute, or inline
`display: none` for hidden step elements so the script can reveal them. Bind
the step through the attributes above. Keep it outside any `data-ms-form`
contract and omit the booking popup's `data-modal-target` attribute.

The copied call card title is “Call Requested”. It displays the selected date
and time in the slot's timezone, “Free”, “$0”, and “We'll share your call
request with Jai and reach out when it's been confirmed, typically within 24
hours”. The script hides the context row because this flow sends no message.

Use the [desktop design](https://www.figma.com/design/QPZC8rJROId5dr19xKosjq/The-Starters-3.0?node-id=10676-9565)
and [state designs](https://www.figma.com/design/QPZC8rJROId5dr19xKosjq/The-Starters-3.0?node-id=10725-924).
On mobile, place the headline first, then the card, then the quote and photo.
The card shows the month, timezone, three columns of time choices, a full-width
**Book a free call** button, and **Continue to dashboard**.

## Script order

In the page head, after the sitewide Memberstack and route guard installs and
before the existing controller embeds, add the following tags. Replace
`vX.Y.Z` with the approved release tag and use that release for the existing
Brand Account controller, which dispatches the completion event.

```html
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@vX.Y.Z/v3/scheduling-auth.js"></script>
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@vX.Y.Z/v3/paid-call-brand-payment.js"></script>
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@vX.Y.Z/v3/free-call-booking.js"></script>
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@vX.Y.Z/v3/complete-profile-call-step.js" defer></script>
```

Load the first three scripts synchronously. In **Before `</body>`** code,
load jQuery UI after Webflow's jQuery so the calendar can render its month
grid.

```html
<script src="https://code.jquery.com/ui/1.14.1/jquery-ui.min.js"></script>
```

The step styles the datepicker. Leave out the jQuery UI theme CSS. The inline
calendar and free request use the shared booking code without Stripe. Confirm
in the staging console and Network panel that this install has no missing
dependencies.

## Handoff and diagnostics

On successful Build Account submit, the controller dispatches the cancelable
`starters:brand-profile-completed` event after saving the completion marker.
The step claims it only when its required markup and scheduling helpers are
ready and the current paid Brand matches the completed member. Otherwise the
form redirects using its authored fallback. If the calendar fails after the
step opens, the member can still continue to the dashboard.

The step resolves an active, ready free configuration at runtime. Staging uses
the test Starter `jp-dionisio` on `the-starters-3-0.webflow.io`. The custom
domains use the Starter specified in the step's attributes. The Xano
environment and origin checks require the actual staging hostname for booking
QA.

The Brand row can take a few seconds to appear after the form saves. The step
reuses the scheduling bridge's token to read the onboarding status endpoint
before booking. If the row is still missing, the step asks the member to try
again. A submitted request stays pending until the Starter accepts it.

Check `window.StartersCompleteProfileCallStep.release` and use the
`[starters complete-profile-call-step]` console messages to identify a failed readiness
check or unavailable calendar. Logging follows the shared
[staging diagnostics gate](../../README.md#staging-only-console-diagnostics).

## Staging QA after review

Use the workspace's `staging-qa/` session as a fresh unfinished `brand-paid`
member on `the-starters-3-0.webflow.io`.

1. Submit Complete Profile. Verify the marker is set, the spinner clears, and
   the form and back button give way to the call step without navigation.
2. Compare the month grid, timezone and time choices with Figma at desktop
   widths 1600 and 1280 and mobile width 375. Change the timezone and confirm
   times update. Staging slots require at least five minutes' notice.
3. Request one call and verify one booking request, the **Call Requested**
   card, and a pending call in the staging dashboard. Check that a double
   click sends one request and that retry after an ambiguous network response
   reuses its idempotency key.
4. With fresh fixtures, check that **Continue to dashboard** creates no booking,
   reloading exits the step, and blocking the step script keeps the form's
   dashboard fallback. Verify Talent and free Brands still leave on page load.
5. Exercise the loading, no-times, setup retry and calendar unavailable states.
   Check that Continue remains available except while a booking is in flight.

After release, production checks are read-only. Verify the scheduling bridge
installs on `/complete-profile` and the free call is still offered on
`/hire/jai`. Leave production forms unsubmitted.
