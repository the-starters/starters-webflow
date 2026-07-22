# freelancer-cms

**This folder is the source of truth.** The code that lives in Webflow (page/site
custom code and embed elements) is a mirror of what's in here — not the other way
around.

Unlike the CDN-served scripts elsewhere in this repo, these files are **not**
loaded via jsDelivr. They are copied/pasted into Webflow embeds by hand, and this
folder exists as the versioned backup of that code.

## Workflow

1. Make changes **here first** (or, if a change was made directly in Webflow,
   copy it back here immediately so this folder stays authoritative).
2. Paste the updated code into the corresponding Webflow embed.
3. Commit via the normal PR flow so the history stays clean.

If this folder and Webflow ever disagree, treat **this folder** as correct and
re-sync Webflow from it.

## Stripe Connect CTAs (secured) — `stripe-connect.js`

> ⚠ Exception to the folder rule above: unlike the other files here (which are
> hand-pasted into Webflow embeds), `stripe-connect.js` **is** served over
> jsDelivr and loaded with a `<script src>` tag. It is raw JavaScript (IIFE, no
> `<script>` wrapper) for exactly that reason.

`stripe-connect.js` is the Webflow 3.0 replacement for the legacy V2 inline
embed that wired the "Connect Stripe" / "Connect Calendar" CTAs on the
freelancer profile (hire) template.

Security rationale: the V2 embed shipped a live Make webhook URL and a
pre-minted, member-id-bearing Stripe Connect link directly in the public page
HTML for every freelancer, so any viewer could read another member's onboarding
link out of the source. This module puts **no** Stripe links or webhook URLs in
the page. It fetches them on demand from an authenticated Xano endpoint, and
only when the logged-in member IS the profile owner. The server resolves the
starter from the Bearer session (`$auth`); the client sends no ids.

It depends on `v3/scheduling-auth.js` (which exposes `window.xanoAuthFetch` and
whose allowlist carries the exact `/api:tCpV3oqd/stripe/connect_links` path), so
load that first:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/scheduling-auth.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/freelancer-cms/stripe-connect.js"></script>
```

Safety boundary:

- Staging-hostname-only (`the-starters-3-0.webflow.io`), same as the v3 modules.
- Non-owners (and logged-out visitors) never trigger a Stripe-link fetch: the
  module compares the live Memberstack `member.id` against
  `#ts-stripe-connect-data[data-memberstack-id]` before calling Xano.
- Any failure — not logged in, non-owner, missing `xanoAuthFetch`, network or
  parse error, or a `404` while the endpoint is still unbuilt — is a graceful
  no-op: defaults are left in place, nothing throws to the production console,
  and `window.tsStripeConnectReady` resolves `null`.
- Dev-only diagnostics are gated to staging hosts (`*.webflow.io`,
  `localhost`/`127.0.0.1`, `*.trycloudflare.com`) with a
  `window.STRIPE_CONNECT_DEBUG = true/false` override (also honored via a
  `localStorage` `STRIPE_CONNECT_DEBUG` key); silent in production.

Webflow markup contract:

- Hidden data element (CMS-bound):
  `<div id="ts-stripe-connect-data" data-memberstack-id="{{ memberstack-id }}" data-xano-id="{{ xano-id }}" style="display:none"></div>`.
  `data-memberstack-id` is used **only** for the client-side ownership check and
  is never sent to Xano.
- Hover cards `[no-connection="paid"]` containing
  `<a hover-cta stripe-connect-url href="#">Connect Stripe</a>` and
  `[no-connection="free"]` containing
  `<a starter-dashboard-url href="#">Connect Calendar</a>`, same attributes as
  V2. Site CSS keeps `[stripe-connect-url]`, `[stripe-dashboard-url]`, and
  `[hover-cta][starter-dashboard-url]` hidden by default; the module reveals the
  active one with `display:flex`.

Runtime contract:

- Synchronously sets `window.starter_dashboard_url = '/starter-dashboard'` (the
  3.0 dashboard is a single static page, not V2's per-member CMS page) and, on
  `DOMContentLoaded`, points every `[starter-dashboard-url]` control at it. Sets
  `window.stripe_charges = false` as a safe default **only if it is undefined**;
  after a successful owner fetch it becomes `response.charges_enabled`.
- Owner path: `POST /api:tCpV3oqd/stripe/connect_links` (empty JSON body, Bearer
  added by `xanoAuthFetch`). Response
  `{ charges_enabled, connect_url, dashboard_url }`. If `charges_enabled` →
  leave every CTA hidden; else if `dashboard_url` → reveal + wire
  `[stripe-dashboard-url]`; else if `connect_url` → reveal + wire
  `[stripe-connect-url]`.
- `window.tsStripeConnectReady` is a Promise resolving to the endpoint response
  (or `null` on any failure); `window.tsStripeConnect.run()` re-runs the flow.

The Xano endpoint does not exist yet. The paste-ready builder spec is in
[`stripe-connect-xano-spec.md`](./stripe-connect-xano-spec.md). Until it ships,
the module fails closed (404 → no-op) and the CTAs stay hidden.

Run its focused test with:

```sh
node freelancer-cms/stripe-connect.test.js
```
