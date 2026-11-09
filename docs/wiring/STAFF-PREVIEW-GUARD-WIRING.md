# Staff Preview Guard Wiring

`v3/staff-preview-guard.js` shows a page only to verified staff. Use it for a
feature that is not launched yet and lives on its own Webflow page.

First user: `/starter-onboarding-v2` (onboarding with calendar + Stripe setup,
Jai ask 2026-11-09). The current `/starter-onboarding` does not change.

## Rule

Xano owns the rule. The guard calls `GET api:kR5gpIDB/staff/session`
(Staff Console v1, endpoint 12006, fn 5796/5797):

- live Memberstack member (not `mem_sb_`)
- email domain exactly `thestarters.com` or `hirethestarters.com`
- `verified = true` in Memberstack
- local part (before `+`) not in the deny list (`hello`, `support`, ...)

Staff test Starters use the formula `<person>+onb<NN>@<domain>`. Claude verifies
them with `platform-ops/onboarding-v2-20261109/verify-onb-aliases.py` (workspace repo).

## Install

In the page head, as a normal script (not `defer`, not `async`), pinned to a tag:

```html
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@vX.Y.Z/v3/staff-preview-guard.js"
        data-fallback="/starter-onboarding"></script>
```

- `data-fallback`: where non-staff go. Same-site path only. Default `/starter-dashboard`.
- Also set the page to noindex and do not link it from any page.

## Outcomes

| Visitor | Result |
| --- | --- |
| Verified staff | Page shows; `html[data-staff-preview="allowed"]` |
| Logged out | `/login?next=<path+query>` |
| Logged-in non-staff, unverified staff alias | `data-fallback` |
| Memberstack missing (8 s), trade fails, timeout, check over 20 s, bad answer | `data-fallback` (fail closed) |

## Limits

- This hides UI. It is not a data boundary. A new Xano endpoint used only by the
  preview page must call fn 5797 `require_staff_v1` until launch.
- The body stays hidden until the check ends (2 network calls, at most 20 s).
- Login does not bring the tester back. `/login` only honors `next` paths in the
  `v3/auth-route.js` `ROLE_DESTINATIONS` list, and `/starter-onboarding-v2` is not
  in it, so after login the tester lands on their role home. Log in first, then
  open `/starter-onboarding-v2` directly. Adding the path to `ROLE_DESTINATIONS`
  is a later option (it needs a sitewide auth-route release).

## QA

1. Logged out: open the page, expect `/login?next=...`. After login you land on
   your role home; open the page again.
2. Non-staff Starter: expect `data-fallback`.
3. Unverified `+onb` alias: expect `data-fallback`.
4. Verified `+onb` alias: page shows.
