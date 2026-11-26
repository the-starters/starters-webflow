# Build Profile select-profile wiring

Status: added 2026-11-26. Needs one Webflow page change on `/build-profile/select-profile`; a jsDelivr tag alone does not activate it.

`v3/build-profile/select-profile.js` replaces the inline `<script>` embed on `/build-profile/select-profile` (the `waitForMember(() => { const LOCAL_STORAGE_KEY = 'ts:build_profile:member:' + MEMBER.id; ... })` block). It manages only the profile-type choice. Routing stays in `v3/route-guard.js` and `v3/build-profile-redirect.js`.

## Markup contract (unchanged)

| Element | Attribute | Value |
| --- | --- | --- |
| Full profile link | `data-btn` | `profile-full`, with `href="/build-profile/full-profile"` |
| Consult profile link | `data-btn` | `profile-consult`, with `href="/build-profile/consult"` |

A `data-btn` value that is not `profile-full` or `profile-consult` keeps its native link behavior.

## Behavior

1. When `ts:build_profile:member:<member id>` exists in localStorage (the Starter chose a type before), remove `build_profile` from the Memberstack member JSON. It skips the write when the JSON is empty or has no `build_profile`.
2. The member JSON read-modify-write runs inside `window.__tsMemberJsonWrite`, the shared queue that every member JSON writer must use.
3. Remove every `ts:build_profile:member*` localStorage key.
4. On click, save `{ type, type_id, last_update: null, data: {} }` under the member key. Wait for the pending clear for at most 1.5 s, then navigate to the link `href`.

Read or write failures go to `console.warn` and are never thrown, so PostHog records no unhandled rejection.

## Install

Replace the inline embed with:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@vX.Y.Z/v3/build-profile/select-profile.js"></script>
```

Pin a released tag (`@vX.Y.Z`), not `@latest`, like the other Build Profile scripts. Follow `webflow-custom-code-whole-block-safety` for the page change. The page needs the site head `window.waitForMember` helper, which every V3 page has.
