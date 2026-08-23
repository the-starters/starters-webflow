# V3 Paid Calls settings wiring

Place one native Webflow form inside the always-visible `Dashboard / Calendar` section. Do not put the setup in a modal and do not generate the form in JavaScript.

Paid Call duration is fixed at `60` minutes. The controller ignores any editable duration value and
always sends `duration_minutes: 60`. Duration choices can be added in a later product change. An
active canonical service stored at any other duration reads as not bookable and shows the
update-the-duration message until it is saved again at 60 minutes.

## Script

Load `v3/paid-call-settings.js` after `v3/scheduling-auth.js`. The local stage component loader already includes it.

Boot does not require the Paid card to exist yet. The controller publishes its own progress on
`<html>` as `data-paid-call-settings`, one of `waiting-for-ui`, `loading`, `ready`, `saving`,
`disabling`, `error`, or `not-applicable`. With no Paid card root on the page it stays in
`waiting-for-ui` and watches the document, so a card that Webflow or Memberstack inserts after the
deferred script has already run still boots and still loads canonical Xano configuration. After ten
seconds with no card it reports `not-applicable` but keeps watching, so an even later insertion
still recovers. Initialization is not re-entrant: overlapping boots collapse into one canonical GET.

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
value is ignored while the product duration is fixed. The rate field accepts whole US dollars from 1
to 999999.

The same `$1` minimum is enforced by the Brand-side bookable-set filter, canonical price renderer,
and both calendar-transition controllers. A saved `$1` Paid service stays visible, bookable, and
preserved when the Starter changes calendar providers.

The current native `Dashboard / Call Item` Paid instance is also supported without generated markup:

| Element | Existing authored contract |
| --- | --- |
| Paid Form Block | `data-availability-element="call-paid-form"` |
| Native form | `data-availability-element="availability-form"` |
| Editor panel | `data-availability-element="call-form-wrapper"`; this wrapper is also the scope anchor that keeps the controller off the Free card, so keep one per card |
| Yes radio | Published: `name="consulting-calls-paid"` and `value="yes"`; the legacy `paid-consulting-calls` group remains supported |
| No radio | Published: `name="consulting-calls-paid"` and `value="no"`; the controller still normalizes the older split `consulting-calls` / `paid-consulting-calls` fields at runtime |
| Description/title input | `name="call-description"` |
| Rate input | `name="call-rate"` |
| Edit, Cancel, Update | `data-availability-action="item-form-open|item-form-close|item-form-submit"` |
| Authored price tile | Preferred: `data-call-settings-output="price"`; the current component fallback resolves, inside `data-service-card-element="price-card"`, either one leaf containing a complete amount such as `$150` or the published adjacent sibling spans `$` + `150` |
| Status pills | Preferred: `data-call-settings-output="on"` and `data-call-settings-output="off"`; the current component fallback resolves the two `data-availability-element="call-pill-on"` pills by their authored `On` and `Off` copy, then stamps the canonical output attribute on the pill it matched |
| Radio visual | Webflow's own `w-radio-input` element inside each radio's `label`; the controller adds and removes `w--redirected-checked` on it so the authored visual follows canonical state instead of the last click |

Both authored pills carry the same `call-pill-on` attribute, so the fallback can only tell them
apart by copy. Matching ignores case, surrounding whitespace, and non-breaking spaces, but the pill
text itself must still read `On` or `Off`. Rename that copy in Designer and neither pill resolves,
both pills render at once again, and the controller says so once in the console on staging (see
[Staging-only console diagnostics](../README.md#staging-only-console-diagnostics)). Add the canonical
output attributes in Designer to make the copy irrelevant.

Yes and No are resolved as one pair, never independently, so a single radio can never be bound as
both answers. Canonical `yes` and `no` values match first, then a leading `yes` or `no` word such as
`No thanks`, then the remaining radio next to whichever answer was already identified. If neither
answer can be identified from its value the pair stays unbound and the card takes no radio-driven
action, so a Yes click is never read as a turn-off.

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
- Optional outputs: `data-call-settings-output="status|on|off|price"`; a canonical `on` or `off`
  marker always wins over the authored pill copy above

Keep the form native to Webflow. The controller binds behavior and does not create form HTML.
The price fallback changes only the existing tile's text. It does not replace the tile, add markup,
or use a styling class. Add the canonical output attribute in Designer when that element becomes
available through the approved element-edit path; the canonical marker always wins, and the authored
tile is then never touched.

The fallback runs in the card and stable-contract wiring only; the
`data-paid-call-element="settings"` panel renders a price through its canonical output alone.
The authored tile is borrowed, not owned, so the fallback is deliberately narrow:

- Exactly two authored shapes are bound. Either one unique leaf whose text is already a complete
  currency amount such as `$150`, or one unique pair of adjacent sibling leaves holding `$` and a
  bare number, where only the numeric leaf is painted and the authored currency leaf is preserved.
  In both shapes the amount must also end the price: a sibling that continues it with more digits or
  a cents fragment such as `.00` disqualifies the tile, so the amount is never half-rewritten into a
  doubled price. A caption, a `/hr` unit, more than one candidate, and any other shape are never
  rewritten, and such a tile is left entirely to Designer.
- Only a canonical `data-call-settings-output="price"` element, which exists solely as controller
  output, shows the `$0.00` zero state. With no active canonical service — including paid calls off,
  a signed-out member, and an expired session — the authored tile is restored to its Designer copy.

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
- Save is offered whenever an active canonical service exists, even while Stripe or calendar
  readiness is stale, so the fixed-duration repair described above stays reachable. Xano still
  revision-guards that write and canonical readback still decides the rendered state. With no active
  service, save stays blocked until every prerequisite reads ready. The Save control and the write
  guard use this same rule in both the panel and the Call Item card wiring.
- A missing or changed Memberstack session fails closed. An upsert, a turn off, or a readiness
  refresh that reports `MEMBER_SESSION_MISSING` or `MEMBER_SCOPE_CHANGED` clears the cached Paid
  state instead of leaving stale enabled controls: inputs reset, both actions disable,
  `data-paid-call-settings` becomes `error`, and the status reads `Sign in to manage paid calls.`
  No `starterPaidCallWriteError` event is emitted for that class of failure, because nothing was
  written and the card is inert until the next auth change or reload.
- The native Webflow form still owns which fields are required and still shows its own
  validation UI. An authored Update control wired as a plain element is intercepted, so the
  controller runs that form's constraint validation before writing; an invalid form blocks the
  write in that shape exactly as the browser already blocks it when Update is the form's own
  submit control.
- A rejected title or rate is reported on the field itself, through
  `setCustomValidity` plus `aria-invalid`, so the native form shows the browser's own message. The
  controller owns clearing that state as well as setting it: typing in the field, answering Yes or
  No, pressing Update again, and every canonical render or cleared-state reset clear it first. A
  rejected rate therefore never keeps the form invalid afterwards, and turning paid calls off with
  No plus Update stays reachable even though the disable path never reads the rate.
- The browser sends product intent only. It never sends a member ID, grant ID, calendar ID, Stripe account ID, or payment environment.
- Calendar setup creates only free-call configurations. Availability edits update the availability block of every active canonical configuration without sending title or price fields. Calendar code does not read `#price`, `data-rate`, or `paid_call_rate` in `localStorage`. Its bookable-slots preview does read the canonical Paid service to render duration and price read-only; the admission rules for that card live in [Booking-stage availability section](README.md#booking-stage-availability-section).
- Calendar transitions carry a one-use intent captured from canonical paid-call GET through the existing OAuth session envelope, then recreate it through paid-call upsert and canonical readback.
- The Xano projection function remains the only writer to `freelancers_v3.Paid_Call_Enabled` and `Paid_Call_Rate` for this flow.
- `scheduling-auth.js` authenticates only the three exact `/v3` endpoint paths. `scheduling-v3-stage.js` maps their reviewed unversioned names to those paths and blocks lookalikes.

## Release gate

Do not activate this form until the paid-call reconciliation dry run has zero unexplained differences. Repair writes, provider calls, payment canaries, reminders, and email canaries require separate approval.

## Post-release live verification

Automated tests cover the controller in a synthetic DOM only: the delayed-insertion
recovery, the duplicate-initialization dedup, the published `consulting-calls-paid`
binding, the stale-readiness save of an active service, the expired-session
fail-closed writes, and the authored price tile fallback — canonical precedence,
single-leaf and split `$` + number selection, the continued-amount guard that leaves a
tile with a trailing cents fragment alone, Designer-copy restore, and Free-sibling
isolation — plus the authored status-pill resolution and its drifted-copy diagnostic, the
`w--redirected-checked` radio sync, and the field validation lifecycle, including that a
rejected rate never blocks a later turn-off — are executable regressions in
`v3/paid-call-settings.test.js`. The remaining legs need a live Memberstack session, a live
Xano TEST configuration, and an asset that only exists once the tag is published, so they
are not runnable from CI or from a local test phase. Both `the-starters-3-0.webflow.io`
and `thestarters.com` answer `401` behind the site password, so a local phase cannot even
read the live authored DOM.
The release owner runs them by hand, in this order, after the PR merges:

1. Release through the sequence in [Sync Safety](../README.md#sync-safety), then confirm
   the served asset is the new build: the served file must contain the status-pill and radio
   sync, `AUTHORED_STATUS_PILL_SELECTOR` together with `setRadioChecked` and
   `clearFieldValidity`. The previous build already shipped `consulting-calls-paid`,
   `cardRadioPair`, the root-wait recovery, `normalizeCardRadioGroup`, `AUTHORED_PRICE_NUMBER`,
   and `endsAuthoredAmount`, so none of those markers can tell this release from the one
   before it; always check a marker this release introduced.
2. On the published page, load `Dashboard / Calendar` as a Starter and confirm the Paid
   card reaches `data-paid-call-settings="ready"` with canonical values, including a
   reload where Webflow or Memberstack inserts the Paid card late.
3. On that same card, pick Yes, fill the title and rate, and click Update by hand. The
   browser must no longer block the click on the No radio, and the card must reach the
   canonical readback state. Confirm this on whichever way the authored Update control is
   wired, and confirm a still-required empty field still blocks the write, per the native
   validation rule in [Authority and behavior](#authority-and-behavior).
   Then confirm the validation lifecycle by hand: enter a sub-dollar rate such as `0.5`,
   click Update, and confirm the browser shows the rate message and no write happens; then
   pick No and click Update, and confirm paid calls actually turn off rather than the stale
   rate message blocking the click. Confirm exactly one status pill renders in each state,
   and that the authored radio visual matches the canonical answer after a reload.
4. On the TEST fixture still stored at a duration other than `60`, pick Yes and click
   Update while calendar or Stripe readiness is stale, and confirm the write is accepted
   and canonical readback reports `data-paid-call-duration-current="60"`.
   `data-paid-call-bookable` turns `true` only once Xano readiness itself reports
   bookable, so re-check it after the readiness prerequisites pass.
5. On the published Paid card, confirm the authored price tile itself: with an active TEST
   service it must read the canonical Xano rate as `$1,500.00`-style USD in the amount
   element only, with any authored caption and unit untouched and no doubled currency
   symbol; after turning paid calls off it must return to the Designer copy rather than
   showing `$0.00`. If the tile does not change at all, its markup is neither of the two
   bound shapes — most often the amount is split across more than the `$` and number pair,
   such as a separate cents span — so report the real structure instead of widening the
   fallback by guess, and prefer adding `data-call-settings-output="price"` in Designer.
6. Human-click a TEST booking against a TEST Stripe configuration only, then reconcile
   it in the paid-call dry run. Never run a live-money production charge.

Record the served-asset check and the TEST booking reconciliation result before the
form is activated for any Starter outside TEST.
