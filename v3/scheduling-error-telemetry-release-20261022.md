# Scheduling failure telemetry release packet

Status: local candidate. No merge, CDN release, loader change, Webflow publish,
provider call, live canary, or PostHog configuration change has run for this slice.

Risk tier: **T2**, because the changed module owns shared scheduling authentication.
Release owner: the parent platform-monitoring workstream. One writer owns this
module. The separate split-day-availability pipeline remains untouched.

## Scope and blast radius

The changed owners are `v3/scheduling-auth.js` and its existing neutral-path
alias `v3/scheduling-bridge.js`, specifically the authenticated
request execution shared by `__tsSchedulingAuthFetch`, `xanoAuthFetch`, and the
global authenticated-fetch adapter. Approved surfaces include the V3 Starter
and Brand dashboards, Edit Profile, Messages, valid Hire profiles, and the
Webflow staging host. The retained V2 Messages adapter shares the module.

The telemetry can describe failures on reviewed calendar, availability,
Free/Paid call-settings, booking, payment-method, and media-read endpoints.
It changes no endpoint, credentials, request payload, auth retry policy,
session ownership, shared-read policy, provider state, or production record.
The only new external side effect after release is an attempted `bridge_error`
capture through the existing shared tracker and PostHog SDK.

## Behavior and failsafe

- Report final non-2xx responses after the existing session checks.
- Report network rejection once and rethrow the original exception.
- Wait for pending auth reconciliation only in contained telemetry work. The
  original rejection does not wait for a deferred or hung cookie read.
- A recovered 401 is silent. A failed refresh reports the retained final 401.
- Shared-read consumers share one underlying failure event.
- Expected aborts and stale member-session outcomes are silent.
- Event construction and capture are contained in `try/catch`. Missing or
  throwing analytics cannot change the request result.
- Only reviewed route names and fixed metadata enter event properties.
  Queries, fragments, headers, credentials, request/response bodies, member IDs,
  and exception text are excluded. Custom HTTP methods become `OTHER`.
- Exact immutable jsDelivr semver URLs can supply `source_release`. Other
  loaders report `unknown`; `instrumentation_version=1` identifies this contract.
- Host environment is not member Test/production classification. Alert queries
  must retain their separate internal/Test-traffic policy.

The neutral alias retains its older auth implementation. Only the matching
telemetry boundary is added; newer token/cache/shared-read behavior from the
main owner is not copied into the alias.

Coverage limits: explicit-auth pass-throughs, initial token-trade failures,
legacy unauthenticated fallbacks, and pre-dispatch failures remain outside this
event contract. Capture attempts do not prove ingestion or alert delivery.

## Rollback target and triggers

Pre-change source: commit `134f2bff50aba671615f6e3afc1f1c3cb0247b07`,
`v3/scheduling-auth.js`, SHA-256
`a1fcacb98b02a2dfca0da3f334aa47559660070effa57ca9afbe516e6587fc99`.
Tag `v1.59.718` contains the same bytes. This is repository evidence, not a claim
that the tag is the current live loader target.

Fresh published-source reads on 2026-10-22 found both production and staging
Edit Profile loading exactly one deferred classic `scheduling-bridge.js` from
immutable tag `v1.59.593`. A normal `@latest` release cannot change that loader.
Its served asset is 14,528 bytes, SHA-256
`00d341b097684a841d9032f1243b6f692095648b66cf70bf84608e3771348444`.
The same alias bytes were verified at tags `v1.59.718`, `v1.59.719`, and `main`.
The exact reversible loader target is
`https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.593/v3/scheduling-bridge.js?v=1.59.593`.
Preserve the complete owning Webflow location before any loader edit. That edit
and whole-site publication are separate release gates;
this packet does not authorize publication or unrelated pending Webflow work.

Before any release, record the actual live loader location/URL and served hash.
Prepare the exact reversible loader rollback to the verified prior immutable
asset. For an `@latest` loader, prepare a normal reviewed rollback release that
restores these exact module bytes; do not edit unrelated custom code.

Rollback first if a role-correct login, scheduling, booking or payment-method
journey regresses, telemetry exposes a prohibited field, capture changes a
request result, or the new owner causes a repeat/error spike.

## Proof path

1. Local: disposable VM browser, fake Memberstack, fake fetch, in-memory
   analytics. The 118-case focused suite passes after the external-review fixes.
   New alias and deferred-auth regressions failed on the prior PR head, then
   passed after the fixes. Syntax checks
   and `git diff --check` pass. No provider request or credential access occurred.
2. Review/gate: run the configured no-mistakes pipeline on the committed feature
   branch. It owns independent review, tests, docs, lint, push, PR and CI. Do not
   merge from a partial local result.
3. Staging: verify exact candidate bytes for each applicable asset and owner activation in the normal
   designated Test Starter session. Use tab-local transport and analytics
   substitutes for a reviewed read endpoint to prove HTTP/network failure,
   recovered-401 silence, redaction and unchanged response behavior. Separately
   prove staging event ingestion and alert routing with an approved marked test
   signal. No booking, payment, provider send or canonical mutation is required.
4. Isolated production: preserve the existing live asset. Use a tab-local
   candidate override, designated Test role, and local capture sink. Confirm
   boot, the expected authenticated read, and response/event preservation.
5. Full production: after prior stages pass, perform the normal reviewed CDN
   release and served-byte readback. Run one role-correct normal canary on
   read-only settings/availability. Do not force real production provider errors.
   Observe frontend exceptions, request failures and telemetry for 30 minutes.

Previous real staging boot/read proof is bound to head
`f9fcbdc746d819ff50ae0818bd652893c4c338a4`; it does not prove execution of this
follow-up candidate or the pinned Edit Profile alias. Intercepted Chromium
fixtures are separate from actual staging and production canaries.

Release is held until the live rollback target, exact Test identity, staging
evidence, isolated-production evidence, final review and green CI are recorded
by the release owner. This packet authorizes no new production action itself.

## Local execution detail

The nested checkout inherits `/Users/jp/the-starters/package.json` with
`type=module`, while this repository's tests are CommonJS. A direct nested
invocation fails before test execution. Focused proof therefore copied only
both source assets and the test into a disposable directory under `/private/tmp` outside
that package boundary and ran `node --test scheduling-auth.test.js` there.
No repository package metadata or gate configuration was changed.
