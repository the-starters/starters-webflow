# V3 Free Call settings wiring

The Starter dashboard keeps the Free Call form native to Webflow. The page-specific
`free-call-settings.js` controller only binds behavior, submits product intent, and paints canonical
state. Xano owns the service title, fixed duration, price, calendar identity, environment, and Nylas
payload.

## Fixed product contract

- Free Call duration: `30` minutes.
- Price: `$0`.
- Nylas service type: public Free Call configuration.
- The browser mutation payload contains only `config_id`, `expected_revision`, and
  `idempotency_key`.
- Initial and terminal UI state always comes from
  `GET starter/free-call-settings/get/v3`.

## Published compatibility contract

The current Designer form works without generated IDs or styling selectors:

- Form Block root: `data-availability-element="call-free-form"`
- Native form: `data-name="Call Free Form"`
- Radio group: `name="consulting-calls-free"`
- Yes/No values: `yes` and `no`
- Edit, Cancel, Update: `data-availability-action="item-form-open|item-form-close|item-form-submit"`

The controller stamps `data-call-settings-input="enabled|disabled"` on the verified radio pair at
runtime. It never renames the group and never binds the Paid form.

For future Designer edits, prefer the stable contract:

- Card root: `data-call-settings-service="free"`
- Native form: `data-call-settings-element="form"`
- Editor panel: `data-call-settings-element="panel"`
- Radios: `data-call-settings-input="enabled|disabled"`
- Actions: `data-call-settings-action="open|close|submit"`
- Optional outputs: `data-call-settings-output="status|on|off|price"`

## Xano authority

- Read: `starter/free-call-settings/get/v3`
- Enable or normalize: `starter/free-call-settings/upsert/v3`
- Disable: `starter/free-call-settings/disable/v3`

The endpoints derive the exact TEST or production environment from the authenticated Memberstack
mode and the approved page origin. They reject duplicate active Free services, foreign or stale
configurations, and mismatched grants. Disable blocks while a future pending, confirmed, or
rescheduled booking exists. Mutations write Nylas first, then canonical Xano state, and use durable
idempotency receipts.

## Loader order

Load the controller after `scheduling-auth.js`:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/free-call-settings.js"></script>
```

The existing Paid controller remains separate. Both can coexist on the dashboard because their roots,
radio groups, status attributes, events, and Xano endpoints are distinct.
