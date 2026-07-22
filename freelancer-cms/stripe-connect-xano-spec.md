# Xano endpoint spec — `POST /api:tCpV3oqd/stripe/connect_links`

Paste-ready brief for the Xano AI builder. This endpoint backs
`freelancer-cms/stripe-connect.js`. Until it exists the browser module fails closed (404 →
no-op), so building it is what turns the CTAs on.

## What it must do

Create an authenticated endpoint in the **`api:tCpV3oqd`** API group:

```
POST /stripe/connect_links
```

- **Auth: required.** Same Bearer scheme as the other V3 scheduling endpoints
  (`auth = "user_v3"`; token member id == the resolved starter). Reject
  unauthenticated calls with `401`.
- **Inputs: none.** The endpoint takes an empty JSON body `{}`. It must **never**
  accept a member id, starter id, Stripe account id, or email from the client.
  Resolve the acting starter **only** from `$auth` (the Bearer session).
- **Never trust the client for identity.** If any id-shaped input is present,
  ignore it. The starter is `$auth`-derived, full stop.

## Logic

1. Resolve the starter record from `$auth` (the authenticated member). If no
   starter row exists for the session member, return `404` (or an empty
   `charges_enabled:false` payload with both urls `null` — see response shape).
2. Read the starter's stored Stripe Connect account id (e.g. a
   `stripe_account_id` column on the starter/freelancers table). Add the column
   if it does not exist.
3. **No account yet** (`stripe_account_id` empty) — `setup_state = "not_connected"`:
   - Create (or reuse) a **Stripe Connect Express** account for this starter
     (`POST /v1/accounts`, `type=express`). Persist the returned account id on
     the starter row so it is reused next time.
   - Create an **Account Link** (`POST /v1/account_links`):
     - `type = account_onboarding`
     - `refresh_url = https://the-starters-3-0.webflow.io/hire/{slug}?after_onboarding=true`
     - `return_url  = https://the-starters-3-0.webflow.io/hire/{slug}?after_onboarding=true`
       where `{slug}` is the starter's published profile slug.
   - Return its `url` as `connect_url`.
4. **Account exists AND `charges_enabled` is true** — `setup_state = "complete"`
   (read from the Stripe account's `charges_enabled` flag, via
   `GET /v1/accounts/{id}` or the create response):
   - Create an **Express dashboard login link**
     (`POST /v1/accounts/{id}/login_links`).
   - Return its `url` as `dashboard_url`.
5. **Account exists but `charges_enabled` is false** (onboarding incomplete) —
   `setup_state = "incomplete"`:
   - Create a **fresh `account_onboarding` Account Link** (as in step 3) and
     return it as `connect_url` so the owner can **resume** onboarding. (The
     client relabels the CTA "Complete Setup" for this state.)
6. Always include `charges_enabled` (the live Stripe value; `false` if no
   account) **and** `setup_state`.

## Response shape (exact — the browser module depends on it)

```json
{
  "charges_enabled": false,
  "setup_state": "not_connected",
  "connect_url": "https://connect.stripe.com/setup/...",
  "dashboard_url": null
}
```

- `charges_enabled`: boolean, required.
- `setup_state`: string, required — one of `"not_connected"`, `"incomplete"`,
  `"complete"`.
  - `"not_connected"`: no Stripe account yet → `connect_url` is a new
    onboarding link; client shows the default "Connect Stripe" label.
  - `"incomplete"`: account exists but `charges_enabled` is false → `connect_url`
    is a **new `account_onboarding` link to resume**; client relabels the CTA
    "Complete Setup".
  - `"complete"`: `charges_enabled` is true → `dashboard_url` is set; the client
    hides the CTA.
- `connect_url`: string or `null`. Present for `not_connected` and `incomplete`.
- `dashboard_url`: string or `null`. Present for `complete`.
- At most one of `connect_url` / `dashboard_url` is non-null in normal flow;
  the client prefers `dashboard_url`, then `connect_url`. `setup_state` is the
  authoritative signal; the client treats a missing `setup_state` as the prior
  two-state behavior (no relabel).

## Security / operational requirements

- **Single-use, short-lived links.** Both Stripe Account Links and login links
  are single-use and expire quickly. Generate them fresh on every call and
  **never store them** in the database or logs.
- **Rate-limit** the endpoint per member (e.g. a few calls/minute) — each call
  hits the Stripe API and mints links.
- The **Stripe secret key** lives in a Xano environment variable
  (e.g. `$env.stripe_secret_key`), never in client code or CMS fields.
- Keep the Stripe account id server-side only; it is not part of the response.
- Do not echo the acting member id or email back to the client.

## Manual test checklist

1. **Unauthenticated** → `401` (no body needed).
2. **Authenticated non-starter member** (no starter row) → `404` (or
   `{charges_enabled:false, setup_state:"not_connected", connect_url:null, dashboard_url:null}`),
   and no Stripe account is created.
3. **Owner, no Stripe account yet** → `setup_state:"not_connected"`, non-null
   `connect_url`, `charges_enabled:false`; a Stripe Express account now exists
   and its id is persisted on the starter row; the returned URL opens Stripe
   onboarding.
4. **Owner, account exists, onboarding incomplete** (`charges_enabled:false`) →
   `setup_state:"incomplete"`, non-null `connect_url` that is a fresh
   `account_onboarding` (resume) link, `dashboard_url:null`, no new duplicate
   account created (id reused). (Client relabels the CTA "Complete Setup".)
5. **Owner, account exists, `charges_enabled:true`** → `setup_state:"complete"`,
   non-null `dashboard_url`, `connect_url:null`; the URL opens the Stripe
   Express dashboard.
6. **Client tries to spoof identity** (send `{ "member_id": "..." }` or a
   Stripe account id in the body) → ignored; the `$auth` starter is used.
7. **Rapid repeat calls** → rate limit engages; links are always freshly minted
   (never a cached/stored URL).
8. Confirm the returned links are **not** written to any table or log row.

## Wiring notes

- After this ships, add the exact path `/api:tCpV3oqd/stripe/connect_links` to
  `AUTHENTICATED_PATHS` in `v3/scheduling-auth.js` (already done) so the browser
  bridge attaches the Bearer token.
- The `redirect_uri`/`return_url` host is pinned to the staging domain
  `the-starters-3-0.webflow.io`. When V3 launches on the custom domain, update
  the `refresh_url`/`return_url` here in the same change (same caveat as the
  scheduling OAuth endpoints).
- If the `/hire/{slug}` profile slug pattern changes, update `return_url` /
  `refresh_url` to match the published slug.
