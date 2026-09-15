# Payment screen verification

Payment-screen behavior is owned by the [shared client](../README.md#brand-paid-call-payment-method-client) and [dashboard recovery contract](../README.md#dashboard-payment-recovery).

Serve this repository locally and open `v3/fixtures/payment-secure-fields.html` (real Stripe TEST Elements, no setup/save request), `v3/fixtures/saved-card-picker.html`, `v3/fixtures/card-setup-owner.html` and `v3/fixtures/dashboard-payment-flow.html` (synthetic Stripe and API responses). The latter three contain saved authored Brand dashboard markup. They are local demonstrations, not production financial evidence.

Verified: split field completion/error/reset, saved-card selection and readback, retry without a duplicate default command after recovery failure, Add/Back, native close and stale context, selected booking replacement, one refresh, and selection of a newly added default. Focused command: `node --test v3/dashboard-call-payment.test.js v3/dashboard-calls.test.js v3/paid-call-brand-payment.test.js v3/free-call-booking.test.js`.

The authenticated read-only card-list route is already published as endpoint 8572. Its client uses only the authenticated member and cursor; never a caller-supplied customer. Production-origin reads returned two whitelisted card summaries, and malformed cursor and wrong mode/origin failed. No provider or canonical writes were made during verification.

Outstanding: actual financial-provider workflow and authenticated production screenshots; successful TEST-mode/no-customer backend reads; auth-required payment confirmation controls (separate existing unactivated path); exact visual parity of the authored decorative radio circle. Selected state currently uses outline and aria-checked. Base date/status placeholders in the connected preview are tracked by separate dashboard status/date changes.

The scope and unchanged policy boundaries are documented in the dashboard recovery contract linked above.

## Paid Call card review — local verification, 2026-09-15

The implementation now requires a confirmed saved/new card before Request Call and identifies the canonical booking's card on the receipt. Added-card setup returns to review. The browser fixture covers card selection, empty/error states, leading-zero and malformed receipt metadata, preserved drafts, keyboard/focus, nested payment-dialog backdrops, late responses, replacement, and retries. An unresolved booking locks its card/details and retries the original payload/key.

- Full repository Node suite: 4,667 passed, zero failed/skipped (137 test files).
- Final focused Free/Paid/dashboard Node checks after review fixes: 147 passed.
- Extended `booking-details.browser.cjs`: passed in local Chrome, synthetic payment/scheduling APIs and Stripe boundaries.
- Existing `payment-secure-fields.html` with real Stripe TEST iframes: Inter loaded in all three actual inputs at 16px; changing page-root font size to 20px updated the number field to 20px. No setup, card save, booking or charge was performed. Local evidence: `/tmp/paid-card-stripe-font.json` and `/tmp/paid-card-stripe-font.png`.
- Four backend XanoScript deployment-candidate files: syntax-valid. Isolated backend command runtime tests remain pending. See [deployment contract and required cases](../xano-workspace/PAID-CALL-CARD-SELECTION.md).

Review caught and corrected ambiguous-response card switching, missing receipt IDs being accepted, the Back wrapper losing its busy marker, and stale documentation. These checks do not establish deployed backend behavior. Do not publish the frontend until the backend contract is runtime-tested and deployed. No push, PR, tag, or production deployment was performed in this implementation run.

## Xano runtime setup — 2026-09-15 continuation

Status: infrastructure probe passed; booking-command runtime cases remain pending.

- Fetched GitHub and confirmed the feature worktree remains two commits ahead of `origin/main`, with no intervening source changes.
- Read workspace 2 branch inventory: `v1` is live. Fresh, read-only inspection found Scheduling Calls In-App group 11, `POST brand/booking/request/v3` endpoint 2918 and `Bookings/upsert_from_nylas_v3` function 282. Both report no draft. Their source matches the handoff export apart from the export-only GUID line. The two proposed card helpers are absent. Private backups are under `/tmp/paid-call-xano-current/`.
- Provisioned personal sandbox 3 (`scy1-ixcs-171f`). Its initial export contained only workspace settings. Installed only a synthetic arithmetic function, an echo API group/endpoint and a workflow probe. No payment source, business records, provider credentials, tasks or triggers were installed.
- The arithmetic unit test executed successfully. The workflow probe passed input arithmetic but returned an empty `$env.$http_headers` and Origin, despite preserving the supplied headers in source readback. Native array, documented JSON-string array and JSON-string object header representations all produced empty headers. This is an observed sandbox workflow-runner limitation, not a booking-code failure or evidence that authentication works.
- Evidence: `/tmp/paid-call-sandbox-unit-probe-result.json`, `/tmp/paid-call-sandbox-header-probe-result.json`, `/tmp/paid-call-xano-runtime/` and `/tmp/paid-call-xano-runtime-readback/`. The final workflow diagnostic intentionally compares the returned object with `{}` so the assertion output exposes the synthetic response; it is not a passing feature test.
- Prepared a separate, local 16-file package at `/tmp/paid-call-xano-booking-candidate/` with source hashes in `manifest.json`: the booking endpoint, five functions, nine table schemas and a sandbox-specific API group. It includes no records or environment values. Fifteen files passed syntax validation; the existing exported `user_v3` schema was rejected by the validator at the legacy quoted `first-name` field. No legacy fields were renamed, and this package was not installed.

Next: use the browser debugger or another verified isolated transport to supply real authentication and Origin without changing the command's guards. Both available browser sessions reached the Xano login screen; browser sign-in was requested. Then complete the ten cases in the backend deployment guide with synthetic records and provider responses. Sandbox infrastructure checks do not satisfy those cases.

The live workspace remains read-only. No booking, charge, Git push, PR, tag or production publication occurred. The required no-mistakes pipeline has not run; its gate remains required before Git delivery. Sandbox sessions expire, so inspect the sandbox again before resuming instead of assuming its identifiers remain current.

### CLI-only follow-up

The user requested continuing through the Xano CLI. Browser sign-in is not a prerequisite for source management. Inspected official CLI 1.2.0 in `/tmp/paid-call-xano-cli-1.2/` without replacing installed 1.0.5; its sandbox workflow execution uses the same route and adds correct nonzero exit codes for JSON-mode failures, but no header-transport option. Also tested an Origin header on the outer Meta API workflow execution request; the echo endpoint still received empty headers (`/tmp/paid-call-cli-header-probe-result.json`).

Proposed a separate persistent workspace named `paid-call-card-selection-test-20260915`, using the prepared dependency package, synthetic records and simulated providers, so the unchanged authenticated command can be called over real HTTP. Automatic approval review rejected the creation before execution because a persistent remote workspace may have cost and lifecycle impact and had not been explicitly approved. No new workspace was created. This path now requires the user's explicit approval; do not substitute changes to another workspace to bypass that rejection. Production publication remains a separate later step after runtime verification.

### Local harness preparation after handoff review

- Fetched GitHub again; the feature branch remains two commits ahead of `origin/main` at `1201468f`. Repository implementation source was not changed.
- Reproduced the `user_v3` validator failure with a minimal quoted-field schema. Quoted names without hyphens also fail; a bare snake-case control passes. A direct, read-only importer preview of the original user schema against workspace 2, branch `v1`, returned HTTP 200, one unchanged table and zero operations. This establishes a local-validator/export discrepancy; fresh-workspace import is still unverified. Legacy field names are preserved. Evidence: `/tmp/paid-call-schema-dry-run-result.json`.
- Found a missing transitive dependency in the original 16-file package: `Bookings/sync_starter_connect_readiness_v3` calls `Bookings/sync_paid_call_settings_v3`. The new local package includes it.
- Prepared `/tmp/paid-call-xano-harness/`: an 18-file scoped package, synthetic fixture setup/inspection endpoint, synthetic Stripe/Nylas HTTP simulator, and a runner for the ten case groups. The preparation script verifies dependency closure, source hashes, and that redirecting provider URL literals is the only change to copied business logic beyond removing export GUIDs. Authentication, Origin/environment guards and provider-result validation are preserved. The test copy is not a production release candidate.
- Local checks: dependency/source checks passed; simulator HTTP test passed (leading zeros, held booking response, receipt corruption, isolation, unsupported operations); runner syntax/plan checks passed. Seventeen XanoScript files validate; the preserved user schema has the known validator discrepancy. Existing dashboard payment/calls Node regression: 100 passed, zero failed/skipped; log `/tmp/paid-call-harness-dashboard-regression.log`.
- No new workspace, tunnel, Xano source/record write, synthetic token issuance, booking-command runtime execution, Git delivery, or production publication occurred in this preparation. All ten backend runtime case groups remain pending. Fresh import, fixture authentication, real HTTP Origin delivery, hidden-field behavior and simulator reachability still need proof.

Next: obtain approval for the named isolated workspace and scoped synthetic test setup. Follow `/tmp/paid-call-xano-harness/README.md`, inspect the import preview/readback, establish real HTTP transport, then execute the prepared cases. The existing no-mistakes and production publication gates still apply.

### Approved isolated workspace creation

The user approved creating `paid-call-card-selection-test-20260915`, installing the scoped package, and running synthetic tests. The CLI created workspace **6**, branch **v1**, at `2026-09-15T15:00:02Z`. Its initial export contains only workspace settings and is saved at `/tmp/paid-call-xano-harness/remote-original/`.

The new workspace has `allow_push: false`. Automatic approval review separately rejected enabling this persistent CLI setting, requiring explicit approval for the setting and its future push scope. A CLI dry-run also stops at this gate; no import preview or installation occurred. A question is pending to enable it temporarily for the scoped import and then disable it again. Do not bypass the rejected setting through another route.

The local synthetic provider and a temporary HTTPS tunnel were started. A read-only HTTPS request reached the protected simulator and correctly returned `404 Unknown run`; this is workstation-to-simulator connectivity, not Xano-to-simulator or booking runtime proof. Five synthetic environment values were prepared locally in a private workspace file, not installed. No Xano fixture records or booking commands were executed.

The task-owned provider and tunnel processes were stopped while awaiting the setting approval. Restart them and regenerate the local tunnel-dependent configuration before resuming. Workspace 6 remains; its push gate is unchanged and disabled.

### Isolated Xano runtime execution and importer fixes

The user approved temporarily enabling workspace 6's direct-push setting. The scoped package was previewed, imported into **6/v1**, and read back; direct push was disabled after each import. The resulting package has 19 documents: nine tables, six functions, one API group, two endpoints and private test workspace configuration. The legacy quoted user fields imported successfully without renaming. Only synthetic provider credentials and records were installed. Production workspace 2 remained read-only.

Actual authenticated HTTP execution exposed two expressions that the importer did not preserve despite passing local syntax validation:

- `read_owned_card_v3`: the card's mode comparison against a nested boolean expression lost its left operand. TEST card reads consequently returned no usable card. The candidate now separates the actual/expected mode into variables and requires the returned mode to be boolean.
- `brand/booking/request/v3`: the reconciliation snapshot comparison against a ternary expression lost its left operand. The candidate now calculates the expected payment method separately before comparing it with the booking snapshot.

Both fixes were applied to the local release candidates and imported only into the isolated test workspace. Syntax checks passed and source readback retains both comparisons. The request endpoint retains the same 21 database operations and six function calls. CLI 1.0.5 printed unresolved-reference warnings on scoped force imports; readback retained the references and actual runtime execution exercised them successfully.

An initial reconciliation test also exposed a fixture bug: its patch object cleared fields omitted by the test. The fixture now passes only the requested patch fields. Before/after inspection confirmed that changing status preserves the command fingerprint, actor, environment, booking and cached result. This correction exists only in the temporary harness.

Final evidence from the complete rerun:

- **10/10 real-HTTP Xano runtime groups passed**, including canonical card A/B snapshots, leading-zero receipts, exact replay, default changes before/after claim, idempotency conflicts, ownership/mode/auth/Origin rejection, missing receipt tolerance, reconciliation, internal legacy/forged-claim checks, and Free Call submission/replay.
- Existing dashboard regression: **100 passed**, zero failed/skipped (`node --test v3/dashboard-call-payment.test.js v3/dashboard-calls.test.js`).
- Two changed deployment candidates and the corrected fixture endpoint pass syntax validation. `git diff --check` passed.
- Sanitized runtime results: `/tmp/paid-call-xano-harness/runtime-results.json`. Harness, source manifest, initial export and latest readback: `/tmp/paid-call-xano-harness/`. Dashboard log: `/tmp/paid-call-harness-dashboard-regression.log`. Private workspace configuration and runtime secrets must not be copied into the repository or shared.
- Direct push is disabled on workspace 6. The task-owned simulator and HTTPS tunnel were stopped after the suite; the isolated workspace and synthetic records remain for inspection. Rerunning requires restarting transport and updating its test-only URL.

These are actual Xano booking-command tests with simulated Stripe/Nylas responses. They do not verify real provider bookings, charges, production browser behavior or production publication. The two new source fixes and this evidence remain uncommitted. No Git push, PR, tag or production release occurred. Next delivery gate: run the required no-mistakes pipeline before Git push/PR; then review and approve exact backend publication before frontend rollout.
