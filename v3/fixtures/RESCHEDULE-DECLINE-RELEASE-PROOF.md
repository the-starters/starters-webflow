# Free reschedule-decline backend release evidence

Verified 10 September 2026. Scope: the prerequisite for PR878's Free-call decline UI.

## Published source readback

- `/function/2098`: SHA256 `401e309db4abb58a9ac2b84a98e14f83cb7e88701cef7c251fc365eed39abfe3`, verified 2026-09-10T10:24:09.649352+00:00
- `/function/2099`: SHA256 `f34a4b232ff297065f3263a214240fac8b5a0c44b9e208b98c625055a982662c`, verified 2026-09-10T10:24:11.754723+00:00
- `/apigroup/11/api/5760`: SHA256 `8a72b616146a2fac7dd06ab05eb7d4580955525249486d1884d1692a8a177496`, verified 2026-09-10T10:24:13.507938+00:00

Endpoint5760 now calls the shared cancellation helper with operation `decline`. It authenticates the user and binds the environment to the request Origin. Paid bookings remain blocked.

## Native Test evidence

- Starter response, booking937: full draft cancellation and duplicate replay passed. Canonical cancelled revision10; owning grant200, event404 and actual notetaker404 independently read back. Screenshot CS-17-DECLINE-STARTER-937-PASS.png; provider evidence CS-17-937-PROVIDER-TERMINAL.json.
- Brand response, booking946: full draft endpoint5760 -> helper2099 -> claim2098 cancellation passed (261 statements,1.72s). Canonical cancelled revision4. Response, replay and canonical row retain the confirmed September17 interval instead of the unaccepted September18 proposal. Independent provider readback: booking cancelled, event404. Screenshots CS-17-DECLINE-BRAND-946-PASS.png and CS-17-OFF-342-PASS.png.
- Booking946 had no canonical notetaker. It does not prove notetaker creation or shutdown; booking937 supplies actual shutdown evidence. Test conference first-creation remains a separate open requirement.
- Four date cases passed with the actual published claim helper in clone workflow28: confirmed call, accepted reschedule with stale old timestamps, and both counterpart decline roles. Pending proposal and confirmed intervals deliberately differ in duration.
- After publication, native authenticated completed-receipt replay passed (146 statements,200ms), keeping the confirmed interval and canonical row unchanged. Screenshot CS-17-NATIVE-PUBLISHED-REPLAY-PASS.png. The CLI clone API test29 stopped Unauthorized and is not counted as passing evidence.
- The Test fixtures are cancelled and services Off. All8 application notification rows for946 remain suppressed with blank recipients. No production booking canary or financial action was performed.

Full source, native screenshots, provider readbacks and release manifest are retained under the operational workspace `product-workflows/beta-testing/call-scheduling-2026-09-09/`. This summary does not claim Paid settlement, authenticated frontend interaction or completion of the full scheduling checklist. Historical completed receipts remain immutable.
