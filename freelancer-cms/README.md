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
- The module supports **two markup shapes** and drives both on every run:
  - **Legacy discrete anchors** (as in V2): hover cards `[no-connection="paid"]`
    containing `<a hover-cta stripe-connect-url href="#">Connect Stripe</a>` and
    `[no-connection="free"]` containing
    `<a starter-dashboard-url href="#">Connect Calendar</a>`. Site CSS keeps
    `[stripe-connect-url]`, `[stripe-dashboard-url]`, and
    `[hover-cta][starter-dashboard-url]` hidden by default; the module reveals
    the active one with `display:flex`.
  - **Component mode** (the current 3.0 hire template): the CTAs are shared
    design-system component instances, not discrete attribute-tagged anchors.
    The wrapper is the `service-card_tooltip` block of the "Service Card -
    Tooltip" component; its `no-connection` value is bound to a per-instance
    "Connect Type" prop (`paid` / `free`). The module resolves the CTA inside as
    the first `a` **or** `button.clickable_btn` (falling back to the first
    `button`), because the 3.0 Button component renders a **native `<button>`,
    not an `<a>`** — verified on staging, its markup is
    `<div class="button_main-wrap">…<button class="clickable_btn"></button>…</div>`
    with no anchor anywhere in the card. Wiring:
    - an `<a>` CTA gets its `href` set (legacy behavior);
    - a `<button>` CTA gets a click listener that runs
      `window.location.assign(url)`, the `.button_main-wrap` gets
      `cursor:pointer`, the listener is bound at most once, and the target URL
      is stored on the element's `dataset` (read at click time) so a later run
      that swaps connect ↔ dashboard navigates to the latest URL.

    In both cases the module sets **only** the CTA target — it never adds the
    `stripe-connect-url`/`stripe-dashboard-url` attributes and never touches
    display. Component visibility is owned by the **Service Card State** prop,
    not by this script. Wrappers with no CTA are skipped; nothing throws.

Runtime contract:

- Synchronously sets `window.starter_dashboard_url = '/starter-dashboard'` (the
  3.0 dashboard is a single static page, not V2's per-member CMS page) and, on
  `DOMContentLoaded`, points every `[starter-dashboard-url]` control at it **and**
  wires the CTA (anchor or button) inside every `[no-connection="free"]` wrapper
  to it (unconditionally, for any visitor). Sets `window.stripe_charges = false` as a
  safe default **only if it is undefined**; after a successful owner fetch it
  becomes `response.charges_enabled`.
- Owner path: `POST /api:tCpV3oqd/stripe/connect_links` (empty JSON body, Bearer
  added by `xanoAuthFetch`). Response
  `{ charges_enabled, setup_state, connect_url, dashboard_url }`. If
  `charges_enabled` → leave every CTA hidden. Otherwise, besides the legacy
  `[stripe-dashboard-url]` / `[stripe-connect-url]` reveal, the module wires the
  CTA (anchor or button) inside every `[no-connection="paid"]` wrapper to
  `dashboard_url` if non-empty, else `connect_url`.
- **Paid CTA has three states via `setup_state`** (`"not_connected"` |
  `"incomplete"` | `"complete"`):
  - `"not_connected"` → onboarding `connect_url`; default Designer label
    ("Connect Stripe") is left untouched.
  - `"incomplete"` → a Stripe account exists but `charges_enabled` is false; the
    server returns a fresh `account_onboarding` (resume) link as `connect_url`
    and the module **relabels the CTA "Complete Setup"** by setting the
    `.button_main-text` node inside the wrapper's `.button_main-wrap`. The label
    is changed only when that node exists; the Designer default is left as-is
    otherwise.
  - `"complete"` → `charges_enabled` true; the CTA stays hidden.
  - **A missing `setup_state` reproduces the prior two-state behavior exactly**
    (no relabel) — the field is backward compatible.
- `window.tsStripeConnectReady` is a Promise resolving to the endpoint response
  (or `null` on any failure); `window.tsStripeConnect.run()` re-runs the flow.

The Xano endpoint does not exist yet. The paste-ready builder spec is in
[`stripe-connect-xano-spec.md`](./stripe-connect-xano-spec.md). Until it ships,
the module fails closed (404 → no-op) and the CTAs stay hidden.

Run its focused test with:

```sh
node freelancer-cms/stripe-connect.test.js
```
