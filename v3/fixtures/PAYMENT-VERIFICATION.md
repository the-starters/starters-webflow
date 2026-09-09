# Payment screen verification

User request: Implement the new payment method screens and check the dashboard call modal controller. “Use this card” also changes the Brand default for future bookings.

Serve this repository locally and open fixtures/payment-secure-fields.html (real Stripe TEST Elements, no setup/save request), saved-card-picker.html, card-setup-owner.html and dashboard-payment-flow.html (synthetic Stripe and API responses). The latter three contain saved authored Brand dashboard markup. They are local demonstrations, not production financial evidence.

Verified: split field completion/error/reset, saved-card selection and readback, retry without a duplicate default command after recovery failure, Add/Back, native close and stale context, selected booking replacement, one refresh, and selection of a newly added default. Focused command: node --test v3/dashboard-call-payment.test.js v3/dashboard-calls.test.js v3/paid-call-brand-payment.test.js v3/free-call-booking.test.js (229 passing).

The authenticated read-only card-list route is already published as endpoint 8572. Its client uses only the authenticated member and cursor; never a caller-supplied customer. Production-origin reads returned two whitelisted card summaries, and malformed cursor and wrong mode/origin failed. No provider or canonical writes were made during verification.

Outstanding: actual financial-provider workflow and authenticated production screenshots; successful TEST-mode/no-customer backend reads; auth-required payment confirmation controls (separate existing unactivated path); exact visual parity of the authored decorative radio circle. Selected state currently uses outline and aria-checked. Base date/status placeholders in the connected preview are tracked by separate dashboard status/date changes.

This increment adds saved-card/default selection and eligible booking payment recovery; it does not enable Paid cancellation, reschedule policy, charging or payout changes.
