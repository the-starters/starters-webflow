# Booking details browser verification

Run from the repository root:

```sh
node v3/browser-tests/booking-details.browser.cjs
```

The runner starts an isolated Chrome profile and a localhost server. It loads the real Free/Paid controllers and shared renderer, with synthetic authenticated availability, readiness and booking responses. Its Content Security Policy blocks external API connections. No live bookings, account changes or provider requests occur.

Requires Node with native `WebSocket` and Google Chrome. Set `CHROME_BIN` for another Chrome executable. Screenshots and observations default to `/tmp/nylas-details-browser`; override with `BOOKING_BROWSER_EVIDENCE`.

Checks cover:

- Continue opens details without a booking; member identity stays read-only.
- Desktop columns, mobile stacking, and no horizontal overflow.
- Optional context, five guest rows, add/remove, validation and normalization.
- Back retains the selected slot and draft; close/reopen clears drafts.
- Free and ready-card Paid commands; an ambiguous response retries the same payload/key.
- Complete authored guest compatibility and recovery after repairing rejected markup.
- Closed-dialog Hire/Messages entry, including direct entry, exposes the existing error banner for incomplete guest markup and blocks booking and native form submission.
- Stray and nested guest hooks remain rejected across call-type switches, installation order, close/reopen, and reinstall without losing authored nodes or values. Hooks on the calendar container or navigation ancestors keep the banner and Back/close controls visible, and reset restores guest display styles.
- Native keyboard Enter submits empty optional fields.
- Rescheduling keeps its existing one-step calendar.

The fixture approximates site button styling. Container sizing mirrors the `.call-details_layout` and `.nylas_custom_container` rules in the public Webflow page stylesheet referenced by `v3/fixtures/card-setup-owner.html`. This is local browser evidence, not full published Webflow visual parity. Paid card collection/setup and authenticated live endpoints are outside this runner's scope.

For regression proof, `BOOKING_SCRIPT_ROOT` can point to a directory containing baseline `free-call-booking.js` and `paid-call-brand-payment.js`. The same fixture then serves those two scripts instead. The pre-change scripts at `86848bad6e843c10f74cb781f4391546537e976b` fail because selecting a slot offers **Request free call** immediately instead of **Continue**.
