# Payment screen verification

Payment-screen behavior is owned by the [shared client](../README.md#brand-paid-call-payment-method-client) and [dashboard recovery contract](../README.md#dashboard-payment-recovery).

Serve this repository locally and open `v3/fixtures/payment-secure-fields.html` (real Stripe TEST Elements, no setup/save request), `v3/fixtures/saved-card-picker.html`, `v3/fixtures/card-setup-owner.html` and `v3/fixtures/dashboard-payment-flow.html` (synthetic Stripe and API responses). The latter three contain saved authored Brand dashboard markup. They are local demonstrations, not production financial evidence.

Verified: split field completion/error/reset, saved-card selection and readback, retry without a duplicate default command after recovery failure, Add/Back, native close and stale context, selected booking replacement, one refresh, and selection of a newly added default. Focused command: `node --test v3/dashboard-call-payment.test.js v3/dashboard-calls.test.js v3/paid-call-brand-payment.test.js v3/free-call-booking.test.js`.

The authenticated read-only card-list route is already published as endpoint 8572. Its client uses only the authenticated member and cursor; never a caller-supplied customer. Production-origin reads returned two whitelisted card summaries, and malformed cursor and wrong mode/origin failed. No provider or canonical writes were made during verification.

Outstanding: actual financial-provider workflow and authenticated production screenshots; successful TEST-mode/no-customer backend reads; auth-required payment confirmation controls (separate existing unactivated path); exact visual parity of the authored decorative radio circle. Selected state currently uses outline and aria-checked. Base date/status placeholders in the connected preview are tracked by separate dashboard status/date changes.

The scope and unchanged policy boundaries are documented in the dashboard recovery contract linked above.
