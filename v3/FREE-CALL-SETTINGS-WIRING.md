# V3 Free Call settings wiring

The Starter dashboard keeps the Free Call form native to Webflow. The page-specific
`free-call-settings.js` controller only binds behavior, submits product intent, and paints canonical
state. Xano owns the service title, fixed duration, price, calendar identity, environment, and Nylas
payload.

## Fixed product contract

- Free Call duration: `30` minutes.
- Price: `$0`.
- Nylas service type: public Free Call configuration.
- The browser mutation payload contains the public `description` plus `config_id`,
  `expected_revision`, and `idempotency_key`. Xano still fixes the provider title, duration,
  and price.
- Initial and terminal UI state always comes from
  `GET starter/free-call-settings/get/v3`.

## Published compatibility contract

The current Designer form works without generated IDs or styling selectors:

- Form Block root: `data-availability-element="call-free-form"`
- Native form: `data-name="Call Free Form"`
- Radio group: `name="consulting-calls-free"`
- Yes/No values: `yes` and `no`
- Edit, Cancel, Update: `data-availability-action="item-form-open|item-form-close|item-form-submit"`
- Editor panel: `data-availability-element="call-form-wrapper"`; this wrapper is also the scope
  anchor that keeps the controller off the Paid card, so keep one per card
- Status pills: the two `data-availability-element="call-pill-on"` pills, resolved by their authored
  `On` and `Off` copy and then stamped with the canonical `data-call-settings-output` attribute.
  Matching ignores case, surrounding whitespace, and non-breaking spaces, but renamed copy resolves
  neither pill, shows both pills at once, and warns once in the console on staging (see
  [Staging-only console diagnostics](../README.md#staging-only-console-diagnostics))
- Radio visual: Webflow's own `w-radio-input` element inside each radio's `label`; the controller
  adds and removes `w--redirected-checked` on it so the authored visual follows canonical state
  instead of the last click

The controller stamps `data-call-settings-input="enabled|disabled"` on the verified radio pair at
runtime. It never renames the group and never binds the Paid form.

Webflow or Memberstack can insert the Free form root before the sibling status pills and Edit
control. After the root boots, the controller watches the document, re-resolves the owning Free
card when siblings arrive, binds that late Edit control once, and repaints exactly the canonical
On or Off pill. The native Webflow form and its authored sibling controls remain the markup owner.

For future Designer edits, prefer the stable contract:

- Card root: `data-call-settings-service="free"`
- Native form: `data-call-settings-element="form"`
- Editor panel: `data-call-settings-element="panel"`
- Radios: `data-call-settings-input="enabled|disabled"`
- Public description: `data-call-settings-input="description"`. The legacy
  `data-call-settings-input="title"` and `name="call-description"` selectors remain compatible.
- Actions: `data-call-settings-action="open|close|submit"`
- Optional outputs: `data-call-settings-output="status|on|off|price"`; a canonical `on` or `off`
  marker always wins over the authored pill copy above

## Painted state contract

Optional prerequisite rows use `data-free-call-prerequisite` with one of these values (authorable
anywhere inside the Free card scope, including the Call Item header):

- `calendar`
- `availability`
- `enabled`
- `bookable`

The controller sets `data-ready="true|false"` on each row and resets every row to `false` whenever
the cached Free state is cleared. It also sets these attributes:

- `data-free-call-settings` on `<html>` —
  `waiting-for-ui|not-applicable|loading|ready|saving|disabling|error`
- `data-free-call-state` on the card root — the same values
- `data-free-call-enabled="true|false"`
- `data-free-call-bookable="true|false"` (also `false` when the stored duration is not `30` or the
  stored price is not `0`)
- `data-free-call-duration-required="30"`
- `data-free-call-duration-current` — the stored duration in minutes, empty with no active service
- `data-free-call-price-cents` — the stored price in cents, `0` with no active service
- `data-free-call-editor-open="true|false"`

The canonical reader supplies `duration` on each service record, the same field every other
scheduling reader in this repository uses; `duration_minutes` stays an outbound request field only.
An absent price on a Free service reads as `0` because the product contract fixes it there.

The controller emits these window events:

- `starterFreeCallSettingsChanged` — `{ active, bookable, readiness }` on every render
- `starterFreeCallWriteSuccess` — `{ action: 'upsert'|'disable', configId }`
- `starterFreeCallWriteError` — `{ action: 'upsert'|'disable', message }`; never emitted for a
  missing or changed Memberstack session, because nothing was written

A missing or changed Memberstack session fails closed: the cached Free state clears, the description,
duration, price, and prerequisite paint reset, save disables, `data-free-call-settings` becomes
`error`, and the status reads `Sign in to manage free calls.`

`starterSchedulingConnectionStateChanged` triggers a non-destructive canonical re-read. It never
clears the session or resets an in-progress Yes/No selection.

## Xano authority

- Read: `starter/free-call-settings/get/v3`
- Enable or normalize: `starter/free-call-settings/upsert/v3`
- Disable: `starter/free-call-settings/disable/v3`

The controller calls those exact `/v3` paths through `window.xanoAuthFetch`. For this flow,
`scheduling-auth.js` authenticates only those three paths, and `scheduling-v3-stage.js` maps their
reviewed unversioned names to them and blocks lookalikes.

The endpoints derive the exact TEST or production environment from the authenticated Memberstack
mode and the approved page origin. They reject duplicate active Free services, foreign or stale
configurations, and mismatched grants. Disable blocks while a future pending, confirmed, or
rescheduled booking exists. Mutations write Nylas first, then canonical Xano state, and use durable
idempotency receipts.

## Loader order

Load the controller after `scheduling-auth.js`. `scheduling-v3-stage-component.html` already
includes it and remains the authoritative script order for the dashboard surfaces; add the tag by
hand only on a surface that does not use that loader:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/free-call-settings.js"></script>
```

The existing Paid controller remains separate. Both can coexist on the dashboard because their roots,
radio groups, status attributes, events, and Xano endpoints are distinct.

## Release gate

Free calls never charge, so no payment canary and no live-money step applies to this card. Activate
it only after the checks below pass against a Xano TEST configuration. Repair writes, provider
calls, reminders, and email canaries stay under the separate-approval rule owned by the
[Paid release gate](PAID-CALL-SETTINGS-WIRING.md#release-gate).

## Post-release live verification

Automated tests cover the controller in a synthetic DOM only: the delayed-insertion boot, the
root-first/sibling-later card recovery, the published `consulting-calls-free` hydration,
Free/Paid card isolation in both directions, the four-field upsert and guarded disable payloads,
the canonical description and fixed-product readbacks, the in-flight double-Update dedup, the
off-contract duration or price paint, the expired-session fail-closed writes, the authored
status-pill resolution and its drifted-copy diagnostic, and the `w--redirected-checked` radio sync
are executable regressions in `v3/free-call-settings.test.js`. The remaining legs need a live
Memberstack session, a live Xano TEST configuration, and an asset that only exists once the tag is
published, so they are not runnable from CI or from a local test phase; both
`the-starters-3-0.webflow.io` and `thestarters.com` answer `401` behind the site password, so a
local phase cannot read the live authored DOM either. The release owner runs them by hand, in this
order, after the PR merges:

1. Release through the sequence in [Sync Safety](../README.md#sync-safety), then confirm the served
   asset is the new build: the served `v3/free-call-settings.js` must contain the late-sibling
   recovery, `watchUiScope` together with `paintStatusPills`. The previous build
   already shipped the file itself, and `v3/scheduling-auth.js` already authenticated
   `starter/free-call-settings/get/v3`, so neither can tell this release from the one before it;
   always check a marker this release introduced.
2. On the published page, load `Dashboard / Calendar` as a Starter and confirm the Free card reaches
   `data-free-call-settings="ready"` with canonical values, including a reload where Webflow or
   Memberstack inserts the card late. Confirm exactly one status pill renders in each state, and
   that the authored radio visual matches the canonical answer after a reload.
3. With both cards present, confirm isolation by hand in both directions: Edit, Cancel, and Update
   on the Free card must never move the Paid card's controls, and the reverse, and each card must
   keep its own editor-open attribute.
4. On the Free card, enter a distinct description, pick Yes, and click Update by hand. The request
   body must carry only `config_id`, `description`, `expected_revision`, and `idempotency_key`.
   Confirm the canonical readback returns the submitted `public_description`, the public Webflow
   profile and Algolia record show the same description, and the card reaches the canonical state
   with `data-free-call-duration-current="30"` and `data-free-call-price-cents="0"`.
5. On a TEST fixture stored at a duration other than `30` or a price other than `0`, confirm the
   card reads `data-free-call-bookable="false"` and shows the real stored price, and that an Update
   whose readback is still off contract leaves the editor open and reports the error instead of
   painting success. This controller never repairs an off-contract service; Xano owns that.
6. On an active TEST Free service, pick No and click Update, and confirm canonical readback reports
   no active Free service. With a future pending, confirmed, or rescheduled booking on that service,
   confirm Xano blocks the disable instead, per [Xano authority](#xano-authority).

Record the served-asset check and the TEST enable and disable results before the Free card is
activated for any Starter outside TEST.
