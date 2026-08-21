# V3 Paid Calls settings wiring

Place one native Webflow form inside the always-visible `Dashboard / Calendar` section. Do not put the setup in a modal and do not generate the form in JavaScript.

Paid Call duration is fixed at `60` minutes. The controller ignores any editable duration value and
always sends `duration_minutes: 60`. Duration choices can be added in a later product change. An
active canonical service stored at any other duration reads as not bookable and shows the
update-the-duration message until it is saved again at 60 minutes.

## Script

Load `v3/paid-call-settings.js` after `v3/scheduling-auth.js`. The local stage component loader already includes it.

## Native Designer attributes

Use these attributes on existing native Webflow elements:

| Element | Attribute | Value |
| --- | --- | --- |
| Settings wrapper | `data-paid-call-element` | `settings` |
| Native form | `data-paid-call-element` | `form` |
| Status text | `data-paid-call-element` | `status` |
| Enabled checkbox | `data-paid-call-input` | `enabled` |
| Title text input | `data-paid-call-input` | `title` |
| Rate number input | `data-paid-call-input` | `price` |
| Duration select | `data-paid-call-input` | `duration` |
| Save button wrapper | `data-paid-call-action` | `save` |
| Disable button wrapper | `data-paid-call-action` | `disable` |

The title must contain 3 to 80 characters. A legacy duration select can remain in Designer, but its
value is ignored while the product duration is fixed. The rate field accepts whole US dollars from 5
to 999999.

The current native `Dashboard / Call Item` Paid instance is also supported without generated markup:

| Element | Existing authored contract |
| --- | --- |
| Paid Form Block | `data-availability-element="call-paid-form"` |
| Native form | `data-availability-element="availability-form"` |
| Yes radio | `name="paid-consulting-calls"` |
| No radio | `name="consulting-calls"` within the Paid Form Block |
| Description/title input | `name="call-description"` |
| Rate input | `name="call-rate"` |
| Edit, Cancel, Update | `data-availability-action="item-form-open|item-form-close|item-form-submit"` |

The controller scopes every compatibility selector to the Paid card. It anchors on the Paid Form
Block's own enclosing form wrapper and only widens to the Call Item that owns that wrapper. If the
Call Item also holds another card's form wrapper, the controller stays inside the Paid wrapper, so it
never binds or toggles the Free card. Give the Paid card its own `item-form-open` inside that Call
Item so Edit stays wired. It does not use styling classes, generated element IDs, or the duplicate
Form Block ID.

For new Designer wiring, use the stable contract instead of the compatibility names:

- Paid card root: `data-call-settings-service="paid"`
- Native form: `data-call-settings-element="form"`
- Edit panel: `data-call-settings-element="panel"`
- Inputs: `data-call-settings-input="enabled|disabled|title|price"`
- Actions: `data-call-settings-action="open|close|submit"`
- Optional outputs: `data-call-settings-output="status|on|off|price"`

Keep the form native to Webflow. The controller binds behavior and does not create form HTML.

Optional prerequisite rows use `data-paid-call-prerequisite` with one of these values (authorable
anywhere inside the Paid card scope, including the Call Item header):

- `calendar`
- `availability`
- `stripe`
- `charges`
- `fresh`
- `bookable`

The controller sets `data-ready="true|false"` on each row. It also sets these wrapper attributes:

- `data-paid-call-state="loading|ready|saving|disabling|error"`
- `data-paid-call-enabled="true|false"`
- `data-paid-call-bookable="true|false"` (also `false` when the stored duration is not `60`)
- `data-paid-call-duration-required="60"`
- `data-paid-call-duration-current` — the stored duration in minutes, empty with no active service
- `data-paid-call-editor-open="true|false"` — card and stable-contract wiring only

## Authority and behavior

- Initial and terminal state comes from `GET starter/paid-call-settings/get/v3` (`#2924`).
- Save uses revision-guarded `POST starter/paid-call-settings/upsert/v3` (`#2925`).
- Turn off uses guarded `POST starter/paid-call-settings/disable/v3` (`#2923`).
- Each mutation gets a new idempotency key and is followed by canonical GET readback.
- The browser sends product intent only. It never sends a member ID, grant ID, calendar ID, Stripe account ID, or payment environment.
- Calendar setup creates only free-call configurations. Availability edits update the availability block of every active canonical configuration without sending title or price fields. Calendar code does not read `#price`, `data-rate`, or `paid_call_rate` in `localStorage`.
- Calendar transitions carry a one-use intent captured from canonical paid-call GET through the existing OAuth session envelope, then recreate it through paid-call upsert and canonical readback.
- The Xano projection function remains the only writer to `freelancers_v3.Paid_Call_Enabled` and `Paid_Call_Rate` for this flow.
- `scheduling-auth.js` authenticates only the three exact `/v3` endpoint paths. `scheduling-v3-stage.js` maps their reviewed unversioned names to those paths and blocks lookalikes.

## Release gate

Do not activate this form until the paid-call reconciliation dry run has zero unexplained differences. Repair writes, provider calls, payment canaries, reminders, and email canaries require separate approval.

## Post-release live verification

Automated tests cover the controller in a synthetic DOM only: the delayed-insertion
recovery and duplicate-initialization dedup are executable regressions in
`v3/paid-call-settings.test.js`. The remaining legs need a live Memberstack session, a
live Xano TEST configuration, and an asset that only exists once the tag is published,
so they are not runnable from CI or from a local test phase. The release owner runs
them by hand, in this order, after the PR merges:

1. Tag the release, then purge the jsDelivr path the page loads and confirm the served
   asset is the new build (the served file must contain the root-wait recovery, not the
   previous immediate `not-applicable` bail).
2. On the published page, load `Dashboard / Calendar` as a Starter and confirm the Paid
   card reaches `data-paid-call-settings="ready"` with canonical values, including a
   reload where Webflow or Memberstack inserts the Paid card late.
3. Human-click a TEST booking against a TEST Stripe configuration only, then reconcile
   it in the paid-call dry run. Never run a live-money production charge.

Record the served-asset check and the TEST booking reconciliation result before the
form is activated for any Starter outside TEST.
