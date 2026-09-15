# Paid Call card selection: backend deployment candidate

Status: all ten isolated Xano runtime groups passed on 2026-09-15; production publication remains pending.

These files are backend source, not browser scripts. Shipping them through GitHub/jsDelivr does not install them in Xano. Deploy and verify this contract before releasing the frontend that sends a reviewed card. The older endpoint ignores the additional request field and cannot provide its guarantee.

## Source and changes

The existing endpoint and upsert were read from workspace 2, branch `v1`, on 2026-09-15. The configured `staging` branch does not contain these canonical V3 endpoints. Published source backups were kept locally. The later runtime verification installed a scoped instrumented copy and synthetic records in workspace 6/v1; production workspace 2 remains unchanged.

- `api/scheduling_calls_in_app/brand/booking/request/v_3_POST.xs`: existing authenticated `POST brand/booking/request/v3` in Scheduling Calls In-App; adds optional `expected_payment_method_id`, verifies the owned card through Stripe, locks the Brand row while claiming the reviewed payment identity, and caches receipt metadata with the completed command.
- `function/bookings/upsert_from_nylas_v_3.xs`: existing `Bookings/upsert_from_nylas_v3`; consumes a trusted payment claim only when command actor, environment, configuration, provider booking ID, phase, customer and payment method agree. A later default change cannot substitute its card. Callers without this server-created claim retain existing default/readiness checks.
- `function/bookings/read_owned_card_v_3.xs`: new internal, read-only Stripe adapter. Returns only `{id, last4, brand}` after validating customer, method, mode, type and four-character last4. Provider failures return null.
- `function/bookings/payment_receipt_v_3.xs`: new internal helper reads an owned canonical booking's recorded customer and payment method. It never reads the account default. Missing metadata returns a nullable summary without failing a successful booking.

The request field remains optional for existing clients and Free Calls. New paid requests include the reviewed method in the command fingerprint. Requests omitting it retain the original fingerprint calculation. A different card cannot reuse the same successful command identity.

Response additions under `booking`:

```json
{
  "payment_method_id": "pm_selected",
  "payment_method": {"id": "pm_selected", "last4": "0042", "brand": "visa"}
}
```

Either addition can be null. The frontend must retain booking success and use generic receipt copy when the summary is unavailable or invalid. Completed retries return the stored result; they do not look up the current default or require current payment readiness.

Before calling Nylas, the command checks the card under the Brand row lock and stores the verified claim. If the default changed before this boundary, the request fails before provider booking creation. After this boundary, canonical persistence uses the claimed card even if the default changes while the provider responds. No payment timing or collection policy changes.

## Required backend runtime checks

Run the approved focused tests through the real booking command using isolated test records and mocked provider responses. All ten groups below passed in isolated workspace 6/v1 using real authenticated HTTP requests and simulated providers. The dashboard portion of case 10 separately passed 100 Node tests. See [runtime evidence and importer fixes](../fixtures/PAYMENT-VERIFICATION.md#isolated-xano-runtime-execution-and-importer-fixes). This does not establish production or real-provider behavior.

1. Select default card A, request with `expected_payment_method_id=A`, receive booking A and last4 `0042`; repeat identical request and require the original booking and card, with no second Nylas booking.
2. Confirm saved card B as default, submit B and verify the canonical payment snapshot and receipt both identify B.
3. Change the default to B before a request reviewing A claims the Brand row. Require a selection error and no Nylas booking request.
4. Change the default from A to B after A's command claim while the mocked Nylas response is delayed. Require a canonical booking for A, then replay after B is default and require the same booking/summary.
5. Retry a successful key with a different reviewed card. Require an idempotency conflict and no provider request.
6. Reject a foreign customer's card, a wrong Stripe mode, invalid method ID, detached/unavailable card, and unauthenticated/wrong-origin/wrong-member-environment requests before booking creation.
7. Return a malformed or unavailable summary after canonical creation. Require a successful booking and null card metadata; retry must not create a second booking.
8. Reconcile a provider-created canonical row after the account default changes. The reviewed card and original command fingerprint must still match; a foreign booking, environment, or claimed card must be rejected.
9. Exercise an unclaimed internal upsert and a forged/mismatched claim. Preserve legacy expected-default validation; never accept another actor, configuration, provider booking identity, customer, environment or command phase.
10. Regression-check Free Call submission and existing dashboard payment recovery.

Use the existing role-based staging harness for any authenticated browser checks. Do not run real provider booking/charge mutations as a substitute for isolated command tests.

## Import readback requirement

Runtime verification found that the importer dropped the left operand when comparing against a nested boolean expression or ternary. The card adapter now calculates actual/expected mode separately (requiring a boolean provider mode); the request endpoint calculates the expected reconciliation card separately. Both comparisons survived isolated import/readback and passed runtime checks. Verify these comparisons in the target's source readback during the eventual approved publication; syntax validation alone did not catch the original loss.

## Deployment and rollback

Read the workspace's `edit-endpoint-safely` skill before any remote write. Inspect existing drafts first and preserve unrelated changes. Prepare and verify the two new helper functions, then the upsert and request endpoint together in an isolated environment. Publish only the intended items after the required approval and runtime checks. Do not use workspace-wide Publish or `PUT ...?publish=true` in this workspace.

Keep backups of the original request and upsert. The change adds no schema, changes no existing records, and preserves optional-input compatibility. If rollback is required, revert the frontend first so it no longer promises a reviewed-card guarantee, then restore the original request/upsert source through the approved endpoint workflow. Preserve command results and claimed metadata for investigation; do not clear records or reuse command IDs.
