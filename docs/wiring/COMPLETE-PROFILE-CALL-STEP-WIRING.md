# Complete Profile call step

After a paid Brand saves Complete Profile, they can request a free 30-minute
welcome call with Jai or continue to the Brand dashboard. The form and call
step share one page. The form's `redirect="/brand-dashboard"` stays in place
for pages where the call step is absent or cannot start.

The production installation is `/complete-profile` on `thestarters.com`,
pinned to `v1.59.741`. The page keeps its existing
[page-load redirect](COMPLETE-PROFILE-REDIRECT-WIRING.md).
Use `/complete-profile-trial` on staging to review the trial flow.

## Webflow markup

In Designer, copy the call step section from the staging review page and place
it after the existing production form section. Use the existing form, Button
components, spinner, and booking popup success card.
Custom code loads the styles and scripts. The module uses the authored
elements and mounts the shared calendar into the empty calendar container.

| Element | Custom attributes | Authoring notes |
| --- | --- | --- |
| Existing form section | `data-jai-trial-first-step`, `data-complete-profile-details` | Include the entire Webflow Form Block and its success and error states. Preserve the form's redirect, validation, and existing trial terms fields. |
| Existing submit Button | Optional `data-complete-profile-call-submit-label` | Set the Button instance label to **Continue** and keep the native `button[type="submit"]`. If the visible label can carry an attribute, the module also supports the label hook. |
| Call step section | `data-complete-profile-call-step`, `data-call-host-member="mem_clxzbkxqi02ya0sreedez9c8f"`, `data-call-host-slug="jai"` | Author hidden. Use the existing `section_complete-profile` class. |
| Section padding and content | `data-jai-trial-content` | Keep the native `padding-global padding-section-small` wrapper as the section's direct child. Put the attribute on its `container-large` child. |
| Two-column layout | `data-jai-trial-layout` | Add to the `complete-profile_layout` inside the content container. The greeting, card, and quote are its children. |
| Headline wrapper and states | `data-jai-trial-greeting`, `data-complete-profile-call-heading`, `data-complete-profile-call-heading-done` | Place the latter two on sibling blocks inside the greeting wrapper. Author the done block hidden. |
| Card and inner panel | `data-jai-trial-card` | Add to `complete-profile_form-block`. The `complete-profile_form` inside it holds the loading body, calendar, unavailable body, success body, banner, and footer as siblings. |
| Loading body | `data-paid-calendar-element="loading"` | Author hidden. Inside it reuse the `experts-list_loader is-complete-profile` spinner with `data-loader="1000"` and `aria-hidden="true"`. Add visually hidden text with `data-paid-calendar-element="loading-text"` and `role="status"`: “Loading Jai's available times…” |
| Calendar mount | `data-complete-profile-call-calendar` | Leave empty. The engine adds the month, timezone, and available times. |
| Calendar unavailable body | `data-complete-profile-call-unavailable` | Author hidden. Use “Jai's calendar isn't loading right now” and “You can still dive in. Book a free call with Jai any time from his profile.” |
| Request sent body | `data-complete-profile-call-success` | Author hidden. Copy the booking popup's **Call Requested** card content. |
| Status banner | `data-complete-profile-call-status`, `data-paid-calendar-element="status"` | Use an empty paragraph before the footer with `role="status"` and `aria-atomic="true"`. |
| Shared footer | `data-complete-profile-call-footer` | Add to `complete-profile_button-wrapper`. Keep it outside the calendar and success bodies. |
| Footer action groups | `data-complete-profile-call-booking-actions`, `data-complete-profile-call-success-actions` | Add to two siblings inside the shared footer. Start with booking actions visible and success actions hidden. |
| Continue, Book, and Done holders | `data-jai-trial-native-button="skip"`, `data-jai-trial-native-button="book"`, `data-jai-trial-native-button="done"` | Put Continue then Book in the booking actions. Put Done in the success actions. Use the existing tertiary Button for Continue and primary Button for Book and Done. |
| Clickable native Buttons | Optional `data-complete-profile-call-button-label` | Set visible copy through the instance properties and use `button[type="button"]` controls. Keep `data-button-theme` and `data-button-style` on the component wrappers. If the Book label accepts attributes, the optional hook allows it to change to **Try again**. Without the hook, the module falls back to the Book label's exact text, `Book a free call`. |
| Quote and attribution | `data-jai-trial-quote` | Use a figure with a blockquote and figcaption inside the layout. |
| Portrait frame and image | `data-jai-trial-portrait-frame`, `data-jai-trial-portrait` | Place the frame after the layout, inside the content container. Use `jai-dolwani-complete-profile.png` with alt text “Jai Dolwani”. |

The module adds the `data-complete-profile-call-continue`,
`data-complete-profile-call-book`, and `data-complete-profile-call-done` hooks
to the native buttons once it finds their holders. A retry is announced in the
status banner even when the Button component uses a fixed label.

Use `hidden` for elements that start hidden. The existing `hide` utility and
inline `display: none` are also supported. Keep the call step outside any
`data-ms-form` contract.

Copy the **Call Requested** card from the booking popup's
`[schedule-step="success"]` state. Keep its inner card, including
`call-details_layout` and `table-price_layout is-consult`. Leave the popup
shell and its actions behind. Preserve both desktop and phone date/time rows
and the `booking-element` hooks for `start-date`, `start-time`, `price`,
`paid-meeting`, `starter-name` and `context`, with `booking-element-wrap`
and `booking-success-text`. The copied card shows the selected time, “Free”,
and “$0”. The module hides the unused context row and places **Go to dashboard**
in the shared footer.

See the [desktop design](https://www.figma.com/design/QPZC8rJROId5dr19xKosjq/The-Starters-3.0?node-id=10676-9565),
[phone design](https://www.figma.com/design/QPZC8rJROId5dr19xKosjq/The-Starters-3.0?node-id=10729-1216)
and [state designs](https://www.figma.com/design/QPZC8rJROId5dr19xKosjq/The-Starters-3.0?node-id=10725-924).
At 768 px and wider, the greeting and card sit side by side, and the card splits
the month and times into two panels. On phones, the greeting, card, quote, and
cropped portrait stack. The phone calendar shows up to twelve times before
scrolling. On phones, status messages sit above the footer and take space from
the time list instead of covering it. The card fits the successful request at
all sizes. On tablets, the status appears at the top of the card.

## Pinned page code

In the `/complete-profile` page head, after the sitewide Memberstack and route
guard installs and before the Brand Account Controller HTML Embed, add these tags in
order. Use the release tag for all five assets. The staging review page can
use a full pushed commit SHA for review builds.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.741/v3/complete-profile-call-step.css">
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.741/v3/scheduling-auth.js"></script>
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.741/v3/paid-call-brand-payment.js"></script>
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.741/v3/free-call-booking.js"></script>
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.741/v3/complete-profile-call-step.js" defer></script>
```

Load the first three scheduling scripts synchronously. Place the Brand Account
Controller HTML Embed before the main content on `/complete-profile`.

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.741/v3/brand-account-controller.js"></script>
```

The shared Site Settings loader currently emits the older controller. Keep its
configuration and pin for other pages. Omit its controller tag on
`/complete-profile` and `/complete-profile/` so the HTML Embed supplies the
only controller on that page. The first controller to boot owns the form,
so leaving the older deferred tag on the page prevents the handoff event.
Verify the pinned controller URL before applying the exclusion. Save the
page install and shared loader change together. Webflow requires a full-site
publish to the staging subdomain to apply the Site Settings change.

In **Before `</body>`** code, load jQuery UI after Webflow's jQuery. The
call step stylesheet supplies the datepicker styling.

```html
<script src="https://code.jquery.com/ui/1.14.1/jquery-ui.min.js"></script>
```

Copy only the authored call step section. Leave the trial page's pilot
template, inline script and styles, and owner-review embed on the trial page.
Keep the target form's existing trial terms. Verify the pinned URLs return
HTTP 200 and the changed assets carry the expected `@release` marker. Publish
to the Webflow staging subdomain first and verify the form handoff. Publish
to the custom domains after release approval.

## Handoff and diagnostics

After a successful Build Account save, the controller dispatches the
cancelable `starters:brand-profile-completed` event. The step claims it when
the authored elements and dependencies are ready and the current paid Brand
matches the completed member. If the calendar fails after the handoff, the
member can still continue to the dashboard.

The step resolves the available free configuration at runtime. Staging uses
`jp-dionisio` on `the-starters-3-0.webflow.io`. The custom domains use the
Starter specified in the authored host attributes.

The Brand row can take a few seconds to appear after the form saves. The step
reads the onboarding status with the scheduling bridge's token before booking
and asks the member to retry if their account is still being set up. A
submitted request stays pending until the Starter accepts it.

Check `window.StartersCompleteProfileCallStep.release` and
`[starters complete-profile-call-step]` console messages for failed readiness
checks or unavailable calendar data. Logging follows the shared
[staging diagnostics gate](../../README.md#staging-only-console-diagnostics).

## Staging QA

Run the workspace's `staging-qa/checks/complete-profile-trial-round2.mjs`
against the published trial page. From `staging-qa/`, run
`node --env-file=.env checks/complete-profile-trial-round2.mjs`. Use the
`brand-paid` sandbox session, the published SHA pins, and mocked booking
responses. No draft substitution or real booking is needed.

Check the **Continue** submit label and trial terms, then verify loading,
ready, unavailable, no-times, and error states. Check the Book Button's
disabled state and keyboard focus, shared footer, timezone changes, and that
Continue remains available except during a request. Verify a mocked successful
request displays the existing success card and its single dashboard action.
Confirm tablet split layout, phone stacking, portrait crop, and that status
messages stay tappable and clear of the time list on phones. Confirm the authored form
redirect still works when the call step cannot start.
