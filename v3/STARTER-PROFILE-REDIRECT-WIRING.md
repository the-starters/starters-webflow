# Starter Profile Redirect Wiring

Status: Built in git, not yet released — no tag, no Webflow embed. `@release`
and the exported `release` property carry `vX.Y.Z` until the tag stamps them.
Tickets: `.scratch/starter-profile-redirect/issues/`. Spec:
[STARTER-PROFILE-REDIRECT-SPEC.md](STARTER-PROFILE-REDIRECT-SPEC.md).
The Layer 3 funnel map lives in workspace-root `REDIRECT-STRATEGIES.md` (outside
this git repo by design; already updated to BUILT, not yet embedded).

`v3/starter-profile-redirect.js` is the inbound half of the Talent funnel. A
signed-in Talent whose Xano funnel is unfinished is sent forward with
`location.replace()`. It never writes to Xano or Memberstack. The only markup
it touches is an optional `[data-page-spinner]`.

**In-scope paths** (exact + trailing-slash twin; `/opportunities/<slug>` too) —
identical net to [brand-profile-redirect.js](BRAND-PROFILE-REDIRECT-WIRING.md):

| Path | Why |
| --- | --- |
| `/starter-dashboard` | Talent home — the page this exists to close |
| `/opportunities` (+ single-segment detail) | Shared feed |
| `/all-starters` | Browse |
| `/messages` | Shared inbox |
| `/brand-dashboard` | Symmetric with the Brand twin |
| `/dashboard` | Thin router |

Out of scope: `/starter-onboarding`, `/build-profile/*` (outbound halves own
those), `/opportunities-freelancer-view`, `/favorites`, `/complete-profile`.
Do **not** backfill Brand-profile-redirect embeds on `/starter-dashboard` or
`/dashboard` this round.

## Decision table

First match wins.

| Situation | Action | Xano? |
| --- | --- | --- |
| Unapproved host, or path not in the net | Do nothing | No |
| Not Talent / missing role contract | Stay | **No** |
| Logged out / Memberstack absent | Stay | **No** |
| `build_profile_done === false` (literal) | `/build-profile/select-profile` | Yes |
| `build_profile_done === true`, `onboarding_done` not literal `true` | `/starter-onboarding` | Yes |
| Both done | Stay | Yes |
| Trade failed, HTTP error, malformed/unknown body, timeout | Stay | attempted |
| No `[data-page-spinner]` | Decision unchanged, uncovered | — |

Role comes from `window.StartersV3RouteGuard.memberRole`. Install **after**
`route-guard.js`. Same signal as auth-route: `GET api:KZf7nFnk/starters_onboarding/get_build_profile_status`.
`has_record` is unread. No sessionStorage marker — a failed onboarding PATCH
bounces the member back to resubmit.

Flash is accepted until Designer adds `[data-page-spinner]`. That is the revert
path; no code change. Reveal matches the Brand twin: `display: block` and the
`hidden` attribute cleared on show, `display: none` on hide.

## Webflow install

One deferred tag per in-scope page, Page Settings → Custom Code → Before `</body>`:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/starter-profile-redirect.js"></script>
```

Pages: `/starter-dashboard`, `/opportunities` (CMS template covers detail
slugs), `/all-starters`, `/messages`, `/brand-dashboard`, `/dashboard`.
Pin `@vX.Y.Z` at the deferred prod publish.

Do not add this file to `/starter-onboarding` or `/build-profile/*`.

## Staging QA order

Prefix: `[starters starter-profile-redirect]`. Staging is chatty, production silent.

1. Logged out on `/starter-dashboard` — stay, no Xano.
2. Finished Talent — stay, spinner down if present.
3. Unfinished Build-profile Talent, direct-open `/starter-dashboard` — `replace()` to `/build-profile/select-profile`.
4. Build done, onboarding not — `replace()` to `/starter-onboarding`.
5. Paid Brand on `/brand-dashboard` — stay, **no** `get_build_profile_status`.
6. Failed-PATCH bounce-back — block Xano after onboarding submit; land on dashboard; bounce to onboarding.
7. Offline — page renders, spinner down, not stuck.
8. Production silence on `thestarters.com` after the deferred publish.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Never redirects, console silent | Tag missing, or host not approved. Check `window.StartersStarterProfileRedirect`. |
| Console says "role contract unavailable" | Loaded before `route-guard.js`. |
| Console says `role "brand-paid" is not Talent` | Role gate working. |
| Dashboard flashes then redirects | No `[data-page-spinner]`. Expected until Designer adds one. |
| Ping-pong with onboarding or Build-profile | Outbound half and this file disagree on `get_build_profile_status`. |

## Release gate

- `node --test v3/starter-profile-redirect.test.js`
- `node --check v3/starter-profile-redirect.js`
- Stamp the real tag into both `@release` and `release`.
- Walk QA, do not skip step 5.
- Ticket 06 is the paste + headed QA; this file does not ship the embeds.
