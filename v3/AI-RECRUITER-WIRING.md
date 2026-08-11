# V3 AI Recruiter wiring and operations

`ai-recruiter.js` binds the native Webflow `data-ai-recruiter` markup and is
available only to an authenticated Memberstack member with an active paid Brand
or test Brand plan. The browser sends requests only to the authenticated Xano
V3 boundary. Xano owns authorization, session ownership, rate limits, and all
calls to n8n, Supabase, and OpenAI.

## Native Webflow markup

Build the root from [`ai-recruiter-webflow.html`](ai-recruiter-webflow.html) as
native Designer elements. The file is the complete attribute, copy, state, and
responsive-style contract. Do not install it as an HTML embed and do not make
the controller generate its markup. Keep one root per page and load the
controller after Memberstack and the authenticated Xano token bridge:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@<release-tag>/v3/ai-recruiter.js"></script>
```

Replace `<release-tag>` with the release that passed the production canaries.
Do not use `latest` in production.

## Monitoring

The controller emits `ai_recruiter_request` and `ai_recruiter_failure` PostHog
events when PostHog is available. It also dispatches matching
`starters:ai-recruiter-request` and `starters:ai-recruiter-failure` window
events. Payloads contain only the operation, outcome, HTTP status, and Xano
trace ID. They do not contain member IDs, prompts, candidate data, tokens, or
response text.

Monitor the Xano endpoint error rate, timeout outcomes, rate-limit outcomes,
and the n8n execution linked by `trace_id`. Alert when message failures exceed
5% for 10 minutes or when five consecutive message requests fail. Confirm that
feedback and session-reset failures remain visible even though they do not stop
the conversation.

## Release and rollback

Release the controller behind the native Webflow root. Before broad release,
verify one paid Brand canary, one free Brand, one inactive paid Brand, and one
logged-out session on desktop and mobile. Confirm the served script version,
the Xano trace, and the monitoring events.

The release is not production-ready until the published page contains the
native root and pinned script and all canaries above have recorded readback.
Local controller tests and a Designer preview do not satisfy this gate.

To roll back the browser experience, remove the AI Recruiter script include or
hide the native root in Webflow and publish. This leaves V2 and the Xano, n8n,
Supabase, and OpenAI services unchanged. Verify the published page no longer
loads the controller and that V2 pages are unchanged. If the Xano routes also
need rollback, disable the AI Recruiter routes only after the browser root is
off, then confirm direct requests fail closed with authorization intact. Keep
the last known good script URL and Webflow publish available for restoration.
