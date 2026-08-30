# `v3/hire-profile.js` — wiring and ownership

Last updated: 2026-08-30
Status: Call projections and Free Call behavior are GitHub-owned; direct Webflow head cleanup remains pending

## What this is

The `/hire/<slug>` profile renderer. It previously lived as ~37KB of inline
custom code in the **footer** of the Webflow hire template (page
`69f241ed147b71addb6f153d`, "Hire | Freelancers 3.0s – Pages Template"). It now
lives here, and the page footer loads it from jsDelivr instead.

This is the same move already made for `v3/profile-portfolio.js`: GitHub is the
source of truth for browser code, and page/site custom code stays thin.

The initial port was **behaviour-for-behaviour**. The exact pre-migration block
is kept at
`webflow-sites/starters-3/custom-code-backups/hire-template-footer-pre-cdn-migration-2026-08-16.html`
in the ops workspace.

Phase 2 removed Experiences and Clients from this runtime. Webflow now renders
Notable Experience from the **Work Histories** collection list filtered to the
current freelancer, and Clients from the freelancer's **also-worked-with**
multi-reference. The 2026-08-16 Xano-to-CMS projection finished with zero drift
for 515 of 517 profiles. The 74 collision-blocked profiles continue to use their
stale-but-present CMS rows, so both sections still render natively.

## Install

Webflow → hire template → Page Settings → Custom Code → **Head**:

```html
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/scheduling-auth.js"></script>
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/scheduling-v3-stage.js"></script>
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/free-call-booking.js"></script>
```

Use [`scheduling-v3-hire-template-head.html`](scheduling-v3-hire-template-head.html)
as the owned embed source. All three tags are intentionally synchronous. The
adapter must own scheduling requests, and the Free controller must define its
namespace, before the shared **Call Scheduling - Global Code** component can
execute its legacy helpers.

`hire-profile.js` also verifies this dependency at runtime. If an older saved
page head does not contain `free-call-booking.js`, it adds that exact jsDelivr
asset once and waits up to five seconds for that loader before booking
discovery. A load error or timeout leaves every Book Call trigger and both call
options hidden. An existing controller or matching loader that can still settle
— an `async` or `defer` tag, or a loader this recovery already injected — is
reused, so this recovery does not create a second chooser owner. Each watched
loader gets its own five-second wait, so the reuse path can wait once for the
existing tag and once more for the canonical loader before giving up. A stale
blocking tag cannot settle again, because this file is deferred and that tag has
already executed; it is therefore superseded by the canonical loader instead of
waited on. Every give-up path re-reads `window.StartersFreeCallBooking` first,
so a controller that installs without notifying this file still counts. Keep the
direct synchronous head tag as the final Webflow install; the runtime loader
prevents the current missing-tag state from disabling Free and Paid discovery
while the shared component cleanup is still pending.

Webflow → hire template → Page Settings → Custom Code → **Footer**:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/hire-profile.js"></script>
```

Nothing else belongs in that footer. The page **head** keeps the three synchronous
scheduling loads above before the shared component. Its other page scripts can
remain deferred (`paid-call-brand-payment.js`,
`freelancer-cms/stripe-connect.js`, `reviews.js`, `project-form.js`,
`starters-ms-redirect.js`, `profile-portfolio.js`).

## Page ownership

| Area | Audience | Owner / source |
| --- | --- | --- |
| Notable Experience | everyone, incl. logged out | native Webflow CMS / Work Histories |
| Clients ("also worked with") | everyone, incl. logged out | native Webflow CMS / also-worked-with multi-reference |
| Call projections (hero, sticky header, Services, and chooser) | owner: live connection state · anonymous: closed · brand: accepted canonical configuration plus successful controller install | this file / authenticated Xano, Nylas, and Stripe |
| Rate and next-slot text on those projections | owner: their own call settings · anonymous: CMS · brand: accepted canonical configuration | this file / authenticated Xano |
| Non-call Service cards | everyone; logged-out cards open signup, eligible Brand cards open the project modal, and Talent or owner cards stay inert | native Webflow CMS plus side-by-side `starter-services` wf-xano canary / canonical `freelancers_v3.Services`; this file adds interaction attributes to rendered Xano clones |
| Freelance rate card | everyone | this file / Algolia record, cloned from the section's Default card |
| Retainer rate card | everyone | authored `starter-retainer` wf-xano wrapper / canonical Xano endpoint `profile/starter/retainer/v3`; the Algolia-derived runtime clone remains only as the unresolved/error fallback |
| Free booking popup | signed-in Brand members | this file + `free-call-booking.js` + shared call calendar / authenticated canonical Xano booking command |
| Paid booking popup | signed-in Brand members | this file + `paid-call-brand-payment.js` / authenticated Xano + Stripe Elements + Nylas calendar |
| Utilities | everyone | this file / rate formatting, rating average, dropdowns, anchor scroll, mobile TOC, view-all |

The runtime no longer calls `api:SYL06lUR/companies`,
`edit_profile/starter/get_also_worked_with`, or `profile/get_companies`.
`FREELANCER_ID` remains the Memberstack ID used by booking. The public Algolia
lookup instead reads the starter's positive integer Xano ID at parse time from
`[data-starter-xano-id]` inside the hidden `.data-native-binding` wrapper. If
the carrier is absent or invalid, the lookup warns and stands down.

## Dependencies this file does NOT own

All of these are defined by **other** page or site embeds that run before it.
The file reads the page-owned identity and shared helper globals from `window`.
It stands down with a `[hire-profile]` warning when `qs`, `qsa`,
`waitForMember`, or `starter_memberstack_id` is missing, because an uncaught
`ReferenceError` would abort the whole file and take every section with it.
The Free booking namespace normally comes from the page install order above.
`hire-profile.js` supplies the bounded GitHub/jsDelivr recovery when that tag is
missing and stands down if the namespace still cannot load.

- Site head: `qs`, `qsa`, `MEMBER`, `memberReady`, `waitForMember`
- Page embeds: `starter_memberstack_id`, `stripe_charges`, and the CMS-bound
  `[data-starter-xano-id]` carrier inside `.data-native-binding`
- GitHub module: `window.StartersFreeCallBooking`. It owns
  `getStarterByMemberId`, `getConfigs`, `getNearestSlot`,
  `authenticatedRequest` (the shared bridge the owner-path settings reads go
  through), the Free chooser, the authored calendar, guest controls, and
  authenticated canonical booking command. `hire-profile.js` does not use the
  old bare booking globals.
- jQuery `$` — used by the dropdown and anchor-scroll blocks only; each is
  individually guarded, so a missing jQuery costs those two behaviours and
  nothing else. The anchor utilities also ignore a bare `#` or an invalid hash
  selector so a placeholder link cannot abort the remaining page utilities
- `window.WfAlgolia` — the search client, awaited with a 30s deadline
- `window.WfXano` — the late-safe callback queue used to reach the
  `starter-services` and `starter-retainer` instances and consume their current
  or future canonical results. A missing Services instance leaves the existing
  CMS cards unchanged. A missing Retainer instance leaves the runtime fallback
  in place
- `window.__startersEmptyNavRefresh` — optional, debounced refresh hook from
  `utils/section-custom-toc/hide-empty-sections.js`. After canonical discovery
  changes a call projection or the rate-card path renders, this file asks the
  empty-section owner to re-evaluate the Services section and its TOC link. The
  call is guarded: a missing or failing cosmetic hook must not stop card
  rendering.

### Dependency contract

Checked on `www.thestarters.com/hire/ashna-rana` at `document.readyState:
"complete"` — i.e. exactly the moment a deferred script runs — on 2026-08-16:

| Global | At defer time |
| --- | --- |
| `qs`, `qsa`, `waitForMember`, `$` | `function` |
| `StartersFreeCallBooking` | existing frozen object, or loaded once by the bounded runtime recovery |
| `MEMBER`, `memberReady`, `WfAlgolia` | `object` |
| `starter_memberstack_id` | `string` |
| `stripe_charges` | property present, value `undefined` |
| `[data-starter-xano-id]` inside `.data-native-binding` | positive integer text |
| `[wf-algolia-index]` resolved by the environment script | `Freelancers3.0-production` |

`stripe_charges` is only ever written as `window.stripe_charges` (three
assignments, no `var`/`let`/`const` declaration anywhere on the page). The
property exists, so the footer's original bare `stripe_charges` reference
resolved to `undefined` rather than throwing; reading it as
`window.stripe_charges` here is therefore equivalent today, and stays safe if
that assignment ever fails to run.

## Scoping

Each original `<script>` block keeps **its own IIFE**. They were separate
scripts, so a single shared scope would collide — two of them declare `el`.
No page code outside the footer referenced any of these symbols (verified
against published source, 2026-08-16), so nothing depends on them being global.

## Timing

Deferred, therefore strictly **later** than the inline footer was: it runs after
HTML parse rather than mid-parse. Every global it consumes is set by then,
except `StartersFreeCallBooking` on an older saved head, which the bounded
recovery described under **Install** loads before booking discovery. This
is the only intentional timing change in the port.

The empty-section observer watches child-list mutations, not attribute changes.
Changing a call projection's inline `display` therefore does not trigger that
observer. Canonical Brand discovery refreshes the empty-section owner when it
changes a call projection, and the rate-card render path refreshes it after
adding cards. This keeps `#services` and its TOC link aligned with the final
visible-card state even when no rate card adds a DOM child.

## ⛔ The Algolia index must never be hardcoded

`resolveStartersIndex()` reads `[wf-algolia-index]` from the page.
`v3/algolia-environment.js` rewrites that attribute per environment
(`Freelancers3.0-production` on prod, `Freelancers3.0-staging-test` on
`webflow.io`) before wf-algolia boots, and the rotated search key **403s any
other index**. If the page does not declare an index, the public-record lookup
warns and stands down without making an Algolia request.

A hardcoded `Freelancers3.0-dev` is exactly what silently broke the entire
Services section on 2026-08-16, for every viewer, after the index migration.

## Verification

Use profiles whose current production Xano readback proves one valid Free-only
configuration and one valid Free-plus-Paid configuration. Do not select a
canary from legacy Webflow or Algolia call flags.

1. Anonymous: every hero, sticky-header, Services, and chooser call projection
   stays hidden, even when the public search record carries legacy Free or Paid
   call flags. Native CMS Experiences and Clients remain present, and no
   profile-data Xano request runs.
2. Anonymous click on any visible non-call service card opens the signup modal
   in place.
   That is driven by `v3/signup-attribution.js` off `data-signup-trigger-*`, so
   the cloned rate cards must keep those attributes (values `Freelance` /
   `Retainer`) and must **not** carry `data-modal-trigger`, `booking-popup-open`,
   or `data-type` — otherwise a logged-in click opens an unconfigured booking
   popup for a card that cannot be booked.
3. Eligible signed-in Brand: canonical discovery keeps every call projection
   closed until its exact controller installs. A successful Free install reveals
   every Free projection; a successful Paid install reveals every Paid
   projection. Generic Book Call buttons open the authored chooser. A Free or
   Paid call service in the hero or Services section reuses its exact installed
   chooser CTA and opens that call flow directly, including on a migrated
   profile whose legacy Book Call button is absent. A failed Paid
   install leaves Paid hidden without closing an installed Free option. Each
   non-call card opens Start a Project with its exact native Services preset.
4. `document.documentElement` carries `data-v3-algolia-status="ready"`.
5. The Algolia object ID matches the positive integer in
   `[data-starter-xano-id]`.

## Call modal and project-service routing

The beside-services calendar markup remains authored for possible future use,
but runtime keeps `[data-availability-element="wrapper"]` hidden. The live flow
uses the existing modal sequence: Book Call opens `popup-booking-main`, and an
eligible Free or Paid option opens `popup-booking`. Free and Paid use the
authenticated authored calendar. Paid uses the booking flow owned by
[`README.md`](README.md#brand-paid-call-payment-method-client) inside the same
authored modal. Valid `/hire/<slug>` paths use the host-classified TEST or
production route map. Every authored
`[data-modal-trigger="popup-booking-main"]` stays hidden with
`data-booking-trigger-unavailable` and `aria-disabled="true"`, and the Book Call
wrapper stays hidden with `aria-hidden="true"`, until canonical discovery
produces a Free option that the GitHub Free controller can own or a Paid option
that the V3 controller accepts. This includes triggers outside the wrapper, so
no entry point can open an empty chooser while discovery is closed.
The authored `[data-modal-target="popup-booking-main"]` dialog also stays marked
`data-booking-surface-unavailable` until that same discovery succeeds.
Production `/hire/jp-dionisio` remains blocked before grant or configuration
discovery, so the TEST fixture cannot activate on a production host.

Every authored Free and Paid projection starts hidden. Anonymous viewers cannot
reveal one from the public search record. For a signed-in Brand,
`hire-profile.js` reveals all matching `[has-connection="free"]` or
`[has-connection="paid"]` surfaces only after the exact canonical option passes
the client filter and its controller installs successfully. Hidden runtime call
templates remain hidden. A missing configuration or failed controller install
removes legacy visibility from the matching hero, sticky-header, Services, and
chooser projection so stale Webflow or Algolia intent cannot advertise an
unbookable call.

The native Free and Paid call service components in the hero and Services
section are type-specific shortcuts.
`hire-profile.js` removes their retired direct-scheduler attributes, then finds
the exact matching authored chooser CTA. The CTA must carry its matching
`data-free-call-v3="ready"` or `data-paid-call-v3="ready"` installation marker,
an accepted `data-config`, and an available chooser row. The service component
clicks the ready `popup-booking-main` trigger first, then activates that exact
CTA on the next task. This preserves the authored two-dialog lifecycle while
the generic chooser does not remain visible. A migrated profile with no
authored main trigger opens `popup-booking-main` through the Lumos modal
registry before activating the ready CTA. If neither entry path can open the
authored dialog, the shortcut fails closed. A missing,
hidden, unavailable, or uninstalled matching CTA fails closed. Generic Book Call
buttons retain `data-modal-trigger="popup-booking-main"` and continue to open the
Free/Paid chooser. The direct service click does not itself perform booking,
payment, or Stripe-readiness work.

The controller repeats this idempotent shortcut binding after canonical call
discovery and observes later child insertions. Element identity, not the copied
diagnostic attribute, owns the listener guard. This covers hero call components
that Webflow inserts or clones after the initial deferred-script scan while
keeping the generic Book Call chooser unchanged.

### The chooser pass-through, the entry stamp and the back arrow

Three attributes carry the direct-entry seam. Two are written and read only by
`hire-profile.js`; the third is a Designer element this file never creates.

`data-booking-pass-through` is set on every
`[data-modal-target="popup-booking-main"]` dialog for the duration of a direct
service-card entry. The guard stylesheet hides a marked dialog *and its subtree*
with `visibility: hidden !important`, which beats the inline styles GSAP writes
on the backdrop and content while leaving the dialog laid out, so the
controllers' open-dialog mount contract is untouched. This is what upgrades the
older "does not remain visible" wording above into "never paints a frame". The
marker is released once the chooser reports itself closed, so the chooser's own
close fade is covered too, with a 2000 ms failsafe on the theory that an
invisible open dialog is worse than a late one. Both failure paths — the
registry open failing, and the row CTA disappearing between the two clicks —
release it immediately. Registry failure remains failed closed; a disappearing
row leaves the already-open chooser visible and usable. Clearing is done by the
marker, not by the chooser selector, so a dialog renamed or removed mid-flight
cannot strand the attribute.

`data-booking-entry` is written on `[data-modal-target="popup-booking"]` at open
time and reads `direct` or `chooser`. The direct path stamps it before it
activates the matching CTA; a capture-phase listener on each
`[call-type-item] [booking-popup-open][data-type]` row stamps `chooser`. That
listener only reads the click — no `preventDefault`, no `stopPropagation`, no
re-ordering — so the row's two authored hats are untouched. A module flag, not
`event.isTrusted`, distinguishes the pass-through's own programmatic row click
from a visitor's, because synthetic drivers make `isTrusted` unreliable. The
modal embed's close-complete event removes the stamp once the booking dialog is
closed, so a later opener that does not stamp cannot inherit the previous
entry. A close-complete event that arrives after the dialog has already reopened
leaves the fresh stamp alone.

`[data-booking-back]` is **built by the shared calendar engine**
([`paid-call-brand-payment.js`](paid-call-brand-payment.js), `mountPaidCalendar`),
in the footer row it renders beside the Request call button. It has to be:
the calendar mounts into `[nylas-container]`, which every reset of the booking
surface clears, so an authored element inside it would not survive the first
open. The engine builds it only when the mount resolves inside the booking
dialog, so the dashboard's reschedule calendar — the same engine, a different
dialog — does not get one.

Both footer controls are rendered as the **site's own button component** —
`.button_main-wrap` > `.clickable_wrap` > `button.clickable_btn`, alongside
`.button_main-element` > `.button_main-text` — carrying `data-button-theme` and
`data-button-style` on the wrap. Back is the black secondary and reads "Back";
the confirm is the black primary. That markup is the whole styling contract: the
fill, text colour, border and hover come from the global
`[data-button-theme][data-button-style]` rules, and the padding, uppercase, size
and weight from `.button_main-element`. No size variant class is applied,
because the Designer's default size is the absence of one.

Because the component supersedes them, **`data-booking-confirm-class` and
`data-booking-back-class` are ignored on this surface.** Leaving them authored
is harmless — nothing reads them here and no warning is raised. The optional
`data-booking-footer-class` still applies its class to the footer row verbatim,
but **it no longer opts the row out of the engine's frame** — see the footer
frame contract below. Unauthored, the engine's own row is a full-width flex row
(`display:flex;gap:0.5rem;width:100%` inline). Either way the injected sheet
decides how the two wraps sit in it — right-aligned at their natural width from
768px up, a full-width stack with the confirm on top below it. The engine writes
no inline style on either control: their size comes from the sheet's rules on
the row, and their appearance from the component alone.

The markers and modal attributes sit on the **wrap**, not the inner button. That
is the node the modal embed resolves — it reads `closest()` from the click
target, and the click lands on the overlaid `.clickable_btn` — and it is the
node this script hides and writes `aria-hidden` on, so the component disappears
whole.

Off the booking surface nothing changed: the reschedule calendar still gets a
plain single-element confirm that reads `data-booking-confirm-class` and falls
back to its own inline styles.

The engine also injects one id-guarded `<style>` (`starters-booking-calendar-layout`)
carrying what inline styles cannot: the two responsive layouts, the interior
frame that spaces the calendar off the modal's edges at both widths, and the page's own
datepicker CSS adjusted inside this dialog — the drop shadow dropped in favour
of the ring and fill alone, and the weekday header row re-centred, since the
page leaves those labels left-aligned against centred dates below its tablet
breakpoint. On desktop the footer spans both grid columns on its own bottom
row, so the buttons anchor to the bottom of the panel rather than to one
column, and the shared engine's timezone control — a `<label>` wrapping a
caption and a `<select>` — takes the top of the right column above the slots,
with the month spanning down beside it so the control costs the panel no
height. Its booking-only closed-face treatment and the corresponding inline-style
split are owned by the [paid-call client reference](README.md#brand-paid-call-payment-method-client).
Stacked, `order` holds that control
between the month and the first row of chips; the engine appends it under the
month, ahead of the times, so document order already reads that way and its
reading order matches its visual position at both widths. The engine's three
responsive wrappers — `layout` around the two panels, `calendar-panel` around
the month and the caption, `time-panel` around the chips — are skipped on this
surface for the same outranking reason, and the sheet collapses them with
`display:contents` so the sheet's own placement still reaches the elements
inside them; off this surface they keep the inline columns they ship with. Every selector in that sheet is scoped under
`[data-modal-target="popup-booking"]` and none uses `!important`; the contract
form's datepickers and the dashboard's reschedule calendar share these class
names and must stay pixel-identical.

#### The footer frame contract (reversed August 2026)

On the booking surface the engine ALWAYS paints the footer's frame — the even
`1.25rem` padding, the white fill, the mobile sticky and the alignment. There
is no hairline at either width any more. Those rules key on
`[data-paid-calendar-element="footer"][data-paid-calendar-footer]`, which
matches both stamped values; the attribute is doubled for specificity, taking
them to (0,3,0) so they outrank the authored `.call-sched_button-group`
(0,1,0) without `!important`. They declare their own `display:flex`, because
everything that arranges the two actions is a flex-container property and only
the engine's fallback row carries an inline `display`. An authored class may
still add what the engine does not declare, but it can no longer take the frame
away. Placement (`grid-area`, `order`) still keys on the role attribute alone,
and a test walks the emitted CSS to keep that split honest: appearance must
never sit on the bare role selector, and no appearance rule may pin itself to a
single `data-paid-calendar-footer` value. Everything stays scoped under
`[data-modal-target="popup-booking"]`, and off that surface no footer is built
at all.

Below 768px the footer is `position:sticky; bottom:0` with an opaque white
fill — no hairline, the fill is the only divider — and a `1.25rem` frame on all
four sides: the
whole panel scrolls inside `.modal_content-layout` (the modal's body, and the
only real scrollport here — measured, not assumed), and the buttons stay pinned
to the bottom of it while remaining in flow, so the last slots still end above
them. Two supporting rules make that work: the shell is a flex column at this
width, since a grid item cannot travel outside its own grid area; and
`.call-details_layout` gives up its `overflow-y:auto`, which made it a
scrollport that never scrolls and swallowed the sticky. Desktop keeps the grid
and its always-visible band — the times scroll inside their own cell there.

Every footer row is given an inline `column-gap:0.5rem` between Back and the
request button; on the fallback row its own `gap:0.5rem` shorthand supersedes
that at the same length. The stacked pair is spaced by a `0.5rem` **`row-gap`**
in that same mobile rule, because a column gap places nothing once the row is a
column. The fallback row is unaffected there too: its inline `gap:0.5rem`
shorthand sets both axes to the same length and outranks any sheet rule.

**Lengths in that sheet are rem, and every remaining px is a border, except the
transparent `2px` outline used only as a forced-colors/High-Contrast focus
hook.** The rem values track the site's responsive root font size; borders stay
px because a hairline is a device-pixel affordance and at the site's 12.93px
root a `0.0625rem` border computes to 0.81px and renders inconsistently. The
same convention now holds in `global-embeds/form-embeds/datepicker/datepicker.css`
and `.../timepicker/timepicker.css`. Read those as a change rather than a
rename: the root here is 12.93px at 1280 and 16.34px at 400, so a converted
value is about 19% smaller on desktop than the pixel it replaced.

The shell declares **no row gap**. The frame padding is the whole vertical
rhythm: the month's bottom padding separates it from the times and the times'
from the buttons, one `1.25rem` each. Desktop still says `row-gap:0` out loud,
which is the initial value now but documents the footer band as the only
separator.

That sheet also **zeroes the authored step's own padding**
(`.call-details_layout`, which the site pads by
`--_spacing---spacer--spacing-14`) at every width, so the interior frame is the
only inset between the modal's edges and the calendar. Without it the two
stacked: the status banner could not run the panel's full width. It wins on
specificity — the site's declarations are flat class selectors, and the dialog
attribute puts this one rank above them — never with `!important`.

#### The status banner and the four-state min-height

That sheet also turns the calendar's status line into a **banner across the top
of the modal's body**: absolutely positioned against `.modal_content-layout`, so
it lands directly under the "Book a Call" header bar at the panel's full width
and overlays the calendar rather than adding a row under the buttons. It is the
only rule in the sheet that leaves the flow. Each message is tagged by the
engine with `data-paid-calendar-status`, and the tone is what colours it:
`error` (a booking that failed) is white on `#DD5555`; `progress` (the in-flight
notice) and `empty` (no availability in the next 14 days) share a white-on-dark
`#434B43`. The engine writes no inline styles on it here, since an inline
declaration would outrank the sheet's own colour. With nothing to say the
element is `:empty` and collapses; writing a
message scrolls the modal's body back to the top, since the banner is painted
at the top of the scrollable content and mid-scroll would otherwise land above
what the visitor can see. Because the banner is out of flow, the mount carries
a `20rem` min-height and the empty-availability state pushes its footer to the bottom — otherwise that panel
would collapse to the height of one button and the banner would cover it. That
min-height reaches all four states the mount wears — `ready`, `empty`,
`loading` and `error`, the last two stamped by the free-call controller on this
same mount as well. Scoping it to the first two left the pre-mount states
with no height source, since the sheet zeroes the step wrapper's padding, and
the dialog opened as a ~72px strip. Those two also carry the `1.25rem` interior
frame and centre their message on both axes.

None of this reaches the dashboard's reschedule calendar: no sheet is injected
there, no tone attribute is written, and the status keeps the plain inline grey
line it has always had.

#### When the back control is on screen

This script still owns *when* the control is on screen. The guard stylesheet
keyed on `data-booking-entry` shows it only when the entry stamp reads `chooser`
and hides it otherwise, so it cannot flash before the stamp lands; the script
owns only `aria-hidden`, writes it when the state changes, and never writes
`style.display`. The mount is a late-node path, so the body MutationObserver's
`syncBookingBackControls()` is what stamps the freshly rendered control. An
absent control is still a silent no-op, which is what a page with no calendar
mounted looks like. The control combines the close marker with a trigger naming
`popup-booking-main` — the cross-modal hand-off pattern the modal embed's
trigger precedence deliberately preserves — plus this marker attribute.

A second guard rule hides **every `[data-booking-back]` the calendar engine did
not build**, on every entry:

```css
[data-modal-target="popup-booking"]
  [data-booking-back]:not([data-paid-calendar-element="back"]) { display: none !important }
```

The footer control is the Back now, so a second one in the dialog's header
would be a duplicate of it. The two are told apart structurally rather than by
`[data-booking-back]`, which both carry: only the wrap the engine builds is
stamped `data-paid-calendar-element="back"`. `syncBookingBackControls()` writes
`aria-hidden="true"` on the unmarked ones to match. Nothing in the published
Designer authors such a control today, so this rule is inert on the live page
and exists to keep an old or re-authored header arrow from doubling up.

Because that trigger name is now also carried by a script-rendered control
inside the dialog, every document-wide pass over
`[data-modal-trigger="popup-booking-main"]` excludes `[data-booking-back]`:
the availability gate and the direct-entry trigger lookup here, and the Free
controller's next-slot prefetch in
[`free-call-booking.js`](free-call-booking.js). Without that, the availability
gate could stamp the back control unavailable (the guard stylesheet would then
hide it for good), the direct-entry lookup could click it instead of a real
chooser opener, and the prefetch would fire a stray availability read on the way
back to the chooser.

Non-call service cards open `generate-contract` for eligible signed-in Brands.
They use the existing project-form smart-fill attributes to select an exact
native `Services` option. The consumer here is [`project-form.js`](project-form.js),
not the `freelancer-cms/pre-fill-attr-val.js` embed, which is not loaded on
`/hire/<slug>`. The stamped `data-sp-fill-category` is therefore `service`,
singular: `project-form.js` routes a category normalizing to `service` straight
to the form's native `Services` field, and that native priority is what stops a
stale tagged helper from taking the preset. `Services` would normalize to
`services`, miss the route, and fall through to the tagged-helper lookup. The
two rate formats map to different options. Freelance takes `Freelance work`.
Retainer requires the exact authored `Monthly retainer` option. A missing or
unmatched option fails closed; Retainer never falls back to `Freelance work`.
Logged-out cards keep the signup-attribution modal, and Talent or unknown roles
do not get the Brand project trigger.

The `starter-services` wf-xano wrapper is a side-by-side canary for canonical
`freelancers_v3.Services`. Webflow owns one native Service Card template and
wf-xano clones it after the Xano response. `hire-profile.js` subscribes through
the late-safe `window.WfXano` callback queue. If that subscription does not
replay a result that completed before this deferred controller registered, the
adapter reads the instance's successful public state once. A replayed result is
not read or adapted again from state. Future result events stay subscribed.
The adapter then modifies only rendered `[wf-xano-item]` clones owned by that
wrapper. Webflow currently drops the nested Label component's title and
description Attribute-property overrides from published markup, so the adapter
repaints those two existing text nodes only when the clone's
`data-wf-xano-id` exactly matches a returned item id. It does not create markup
or fall back by position. It gives logged-out cards the same signup-attribution
contract as CMS cards. For an eligible Brand, it adds the normal project
smart-fill attributes for the exact canonical service name.
Webflow owns the native `Services` select and all authored options. The adapter
may add a missing exact option tagged
`data-xano-service-option="starter-services"`, and it removes only stale options
with that same adapter-owned tag. It never changes or removes authored options,
and repeated results do not create duplicates. Talent, the profile owner, and
unknown roles stay inert. The authored wf-xano template, existing CMS cards,
Free Call, Paid Call, and Freelance behavior remain unchanged.
CMS services stay visible until a separate cutover decision follows role-matched
browser parity proof.

The separate `starter-retainer` wf-xano wrapper owns the canonical Retainer
card. Its public source is `KZf7nFnk:profile/starter/retainer/v3` (endpoint
`#5899`), which returns one item only when canonical `Retainer_Enabled` is true
and `Retainer_Rate` is positive. The published wrapper initially points at the
shared taxonomy source. `hire-profile.js` upgrades only that named instance
through wf-xano's public `destroy`/`init` API; it does not change endpoint
`#5860` or its unrelated draft. Webflow owns the native wrapper and card
template. The adapter only repaints the rendered title and description and
adds the existing signup or exact project-service attributes.

The Algolia-derived runtime Retainer clone remains visible while the canonical
request is pending or when it errors. The first resolved canonical result
removes that fallback, including when the result is empty, so a disabled or
unpriced canonical profile cannot leave a stale Retainer card or create a
duplicate. Logged-out clicks open `signup-modal` with Retainer attribution.
Eligible signed-in Brands open `generate-contract` with `Monthly retainer`
selected. Talent, the profile owner, and unknown roles stay inert.

## Rate surfaces are repainted from the canonical source

The rate lives in four stores and the CMS-bound `[data-millify]` surfaces were
never re-painted after a settings save, so a stale CMS rate outlived the change
(verified: trent reads `150` in Algolia and `$250` in the markup). Every rate
display — card, tout, and the chooser's `[call-type-price]` — is repainted from
the same canonical source the booking popup's CTA already trusts: the accepted
Nylas configuration's `price_cents`. The CMS value degrades to a cosmetic
fallback for viewers who never reach canonical discovery, and Xano's projection
is untouched (a separate post-launch item).

`millify` only re-processes **added** nodes, so setting `data-millify` on an
element already in the DOM would never repaint on its own. The repaint writes the
canonical value, drops the stale `data-millify-raw` (which would otherwise make
millify re-parse its own formatted output), strips the authored
`data-millify-max` (that ceiling was sized for the CMS value, and left in place a
later re-process `fails('max')` and reverts to the raw number), and paints the
text through `window.__startersMillify`.

### Calling millify correctly

`millifyCore` reads `units.length` **unconditionally**, so calling it with `{}`
throws a `TypeError` for every value there is. Shipped that way, the throw was
swallowed by the caller's `try`/`catch` and the raw number painted — `$1500`
where the page should read `$1.5K`. The repaint therefore passes a complete
options object (`precision`, `space`, `lowercase`, `units`, `max`) and honors any
authored `data-millify-*` overrides on the element.

The option literal is duplicated from `global-embeds/millify.js`'s `readOptions`
rather than imported, because that file carries no `@release` header and is a
paste-in mirror of a live Webflow embed, not a CDN-served module — there is
nothing to import from. **Keep the two in step by hand.**

A refusal is not a failure. `data-millify-max` exists to make bad data visible,
so when millify refuses a value the repaint leaves the authored text untouched
and warns, rather than painting an approximation.

### Amounts, and who writes which hook

Cents are rendered with byte-parity to `canonicalPaidPrice` in
`paid-call-brand-payment.js`: an exact dollar amount renders as an integer,
anything else keeps both decimals.

| Hook | Free config | Paid config |
| --- | --- | --- |
| `[data-millify]` (card / tout) | never written | written |
| `[call-type-price]` (chooser row) | written as `$0` | never written |

Both blanks are deliberate. **Paid `[call-type-price]` belongs to the Paid
controller**, whose `installPaidBookingController` writes `canonicalPaidPrice`
into it *after* this file runs — a write here would be dead code and a second
format of the same number. **Free `[data-millify]` is never written** because a
free config's amount is always zero, and painting `0` over an authored card rate
is a visible regression; the chooser row is the one intentional `$0`.

That `$0` matters: `selectBookableConfigurations` deliberately admits a Free
record whose `price_cents` is `null` or absent, and `Number(undefined)` is `NaN`,
which used to bail out and leave the `$00` sentinel standing on a **visible**
free chooser row.

Only ONE price hook per surface is written, anchored with `querySelector` the way
`renderRateCards` anchors it. A blanket `querySelectorAll('[data-millify]')`
sweep would overwrite every millified number in the surface — a call duration of
`60` would become the price.

## Next Available is painted on load, for both call types

Q6 is **reversed** (Jerico, 2026-08-27): the paid card's "Next Available" row
stays and must show real data. Previously `free-call-booking.js` was the sole
slot writer — its `updateNearestSlot` ran only after a Book Call click and only
on the free row — so every other hook showed a Designer placeholder forever.

This file now paints every `[next-available-slot]` hook on load: the free and
paid Services cards and both chooser rows (four hooks per profile, verified on
production 2026-08-27). `free-call-booking.js` now **exports** its `nextSlotText`
and its `NO_SLOTS_TEXT`, and this file uses them, so the load path and the click
path are the same code and the copy cannot drift. A local reimplementation
remains only as a fallback for a controller that predates those exports.

The click path also stamps `data-next-slot-state` now, so a hook is
self-describing whichever writer got there last.

Availability is asked **only** through the controller's exported
`getNearestSlot`. That export owns the minimum booking notice — 24 hours on
production, 5 minutes on staging — in both the window it queries and the filter
it applies to the answer, so fetching availability here instead would silently
drop it.

**Both** painters key on the **installed** set, not the accepted one, on the
canonical brand path. (The owner path has no installed set; it paints the
records described under "The owner paints from their own settings".) A rejected
or uninstallable call type keeps its structural hide, so painting it would waste
the request, break the standing contract that an empty or rejected set never
requests a nearest slot, and leave a canonical price sitting on a card nobody can
book — one hide-regression away from being visible. The slot paint is
fire-and-forget: a slow availability answer must not hold up either controller's
install.

### Both painters re-run for late cards

Webflow can insert or clone hero call components after the initial deferred scan
— which is why `wireCallServiceCardsToDirectEntry` is idempotent and why
`observeCallServiceCards` watches for added nodes. A card that arrives after
discovery would otherwise keep both defects this writer exists to remove: the
stale CMS price and the slot sentinel. Both painters are therefore re-run from
the existing re-run point and from the observer callback.

Re-running is safe by construction: every write is equality-guarded and only one
hook per surface is targeted, so repainting an already-correct node is a
byte-identical no-op. The slot re-run replays the remembered answer rather than
issuing a second availability request.

### Never leaving a sentinel, on any path

Both degrade paths clear the hook instead of returning early: a booking
controller with no `getNearestSlot` writes the no-slots copy with
`data-next-slot-state="error"`, and so does a missing grant. (The grant guard is
belt-and-braces for a direct caller — discovery never reaches it, because no
grant means no accepted config and every call surface is already closed.)

The one carve-out is the owner call site, which passes `leaveRowOnDegrade` and
keeps the authored row on the **fault** paths only (see "The owner never reads
'No available slots'" below). An empty availability answer still writes the
no-slots copy for every viewer, owner included, so a placeholder time never
survives an answer the page can trust.

A successful availability answer that cannot be **formatted** is `error`, never
`empty`. That case is version skew — an older controller exporting
`getNearestSlot` but no formatter — and labelling it "No available slots" would
send whoever reads it to look at the wrong system entirely.

### Sentinels

The Designer placeholders are `00:00pm on 00/00` for the slot and `$00` for the
chooser price. They replace the older `11:00pm on 12/10` and `$50`, but that swap only
partially landed — served markup still carries `11:00PM on 12/10` twice and `$50`
in `call-type_price-text`, alongside one `00:00`. QA must therefore treat **both
generations** as "unpainted".

Nothing in the runtime pattern-matches them: a sentinel is by definition
whatever has not been painted yet, so the writer simply always writes. It also
never leaves one standing — an empty availability answer and a failed request
both write `No available slots`, because showing an invented time is worse
than admitting there is nothing to show. (The owner call site keeps the
authored row on the failure half of that pair only; the empty answer is
written for them too.) Each hook carries `data-next-slot-state="painted" |
"empty" | "error"` so QA can tell the three apart without reading the copy.

The runtime fallback rate cards also get their chip label from this file, and
the two formats label differently. Freelance prices a unit, so it renders
`/hour` under the amount. The fallback Retainer quotes a starting price, so it
renders `from` above the amount, as a from-price rather than a unit. Both use
the same element, a
`<p class="service-card_price-unit text-size-small line-height-100">` placed
inside the price chip layout so it stacks centred with the amount and
inherits the white chip text. Only the side differs, and the side carries the
meaning: `from` below the price would misread as a unit.

That label is anchored on the `[data-millify]` price hook, not on the chip
Designer class. The paragraph is the nearest `<p>` above the hook and the
layout is that paragraph parent, so a class rename cannot silently ship a
chip with no label. A card with no price paragraph warns and renders without
a label rather than failing. Cloned rate cards also strip every other child of
the chip layout, so Designer-authored chip text such as `/hr` or `/session`
never leaks into a script-built card and double-labels it; the template keeps
its own authored labels, because only the clones are rewritten. The title
renders alone in `.service-card_title-wrapper`. The class
`service-card_description` is deliberately not reused here because it carries
`word-break: break-all` and the body-regular size. If the Designer ever authors
a native label inside the chip, drop the script insert rather than letting both
render.

Free-call access keeps the V2 product rule: any signed-in Brand, including
Brand Free, can select a free call without an upgrade. The controller resolves
the role from the active, stable Memberstack plan IDs defined in
[`ACCESS-MATRIX.md`](ACCESS-MATRIX.md), using the same map as `route-guard.js`.
An explicit empty, inactive, unknown-only, or cross-role plan state fails
closed. The legacy `brands-dashboard-url` field is only a compatibility
fallback when the SDK payload omits `planConnections`; it cannot override
supplied plan state. Regression coverage in
[`hire-profile.test.js`](hire-profile.test.js) includes Test Brand and Brand
Free plan-only members, plus empty, inactive, and cross-role plan states.
Paid direct entry remains gated by the existing canonical configuration.
Stripe readiness is read only after the Brand confirms a slot, and booking
submission remains gated by that canonical result. This routing change does not
trigger Stripe, reminders, transactional email, or a booking submission by
itself.

`nylas_configurations/get_bookable/v3` owns the authoritative bookable-set
filter. `hire-profile.js` applies a second, fail-closed check before it gives
that set to the two GitHub modal controllers. Each record must have a `config_id`, `active ===
true`, and the host's exact `data_environment` (`test` on the Webflow test host,
`production` on the production hosts). Free records must have `is_paid ===
false`; when present, `price_cents` must resolve to zero and `duration` must
resolve to 30 minutes. The controller normalizes every accepted Free calendar
to zero cents and 30 minutes before slot selection. Paid records must have
`is_paid === true` and the matching
`payment_environment` (`test` or `live`), USD currency, and an integer
`price_cents` of at least 100, plus a `duration` of exactly 60 minutes. Unknown
hosts return no bookable set. The client excludes records from another data or
payment environment and rejects invalid Paid prices or durations. It rejects the
complete remaining set if a `config_id` repeats or if more than one active Free
or Paid record remains. A valid pair is ordered Free then Paid so the
nearest-slot preview is deterministic. An empty or rejected set does not reveal
the Book Call trigger, initialize booking components, or request a nearest slot.

Before it checks page helpers or member identity, `hire-profile.js` hides every
Designer-authored `[call-type-item]` and removes `data-config` from its booking
CTA. It also marks unavailable options with `data-booking-unavailable` and
`aria-hidden="true"`; an injected `!important` guard keeps those options hidden
even if a delayed shared-initializer callback changes their inline display.
After discovery accepts the canonical set, the controller offers each accepted
Free or Paid configuration only to its matching controller.
`free-call-booking.js` receives only the accepted Free configuration and keeps
the existing Free modal flow. It replaces handlers instead of adding duplicate
listeners. Its install does not require a legacy main Book Call button. Each
Book Call click makes one availability request, and each Free option click
mounts one authored calendar in the existing `[nylas-container]` and submits
one idempotent canonical booking command for the selected slot.
The timezone dropdown and slot-selection contract are owned by the
[Brand paid-call payment method client](README.md#brand-paid-call-payment-method-client).
The Free controller uses the calendar and idempotent booking-command primitives
exported by `paid-call-brand-payment.js`. It does not mount the public Nylas
scheduler or create a provider booking directly. Success requires the server
response to contain both the provider booking ID and the canonical Xano row ID.
After that response, the shared success step labels the booking `Free Call`,
shows only the Free actions, displays the Free request confirmation, and hides
the legacy card-charge notice. The Paid success-state contract is owned by the
[Brand paid-call payment method client](README.md#brand-paid-call-payment-method-client).

`paid-call-brand-payment.js` receives the exact accepted Paid configuration and
owns that authored CTA, Stripe Card Element, and paid booking command. Only
successfully installed configurations are reconciled into the chooser and the
matching page projections. A call type without one exact accepted and installed
configuration keeps no `data-config` and retains the structural hide. This
keeps Paid closed during startup, when its controller is missing, and whenever
Paid has no accepted configuration. A failed Paid install does not remove an
installed Free chooser row or add a duplicate call row. A Paid-only set also
keeps the Book Call trigger closed when the Paid controller cannot install.

On the Free Call details screen, the authored calendar reveals the native guest
form after a timeslot is selected. Add and remove controls manage up to five
guest email fields. The authenticated canonical Xano command derives member
identity and sends the selected slot, call details, and normalized guest emails.
The browser does not create a provider booking directly. Free uses the same
optional five-row guest-hook structure and validation contract linked below.
No guest hooks keep Free bookable without `guest_emails`; a partial guest tree
fails closed.

The Paid guest-field markup, validation, payload, and retry contract is owned by
the [Brand paid-call payment method client](README.md#brand-paid-call-payment-method-client).
Zero guest hooks keep Paid bookable without `guest_emails`. When guest entry is
installed, its complete five-row native Designer-authored tree sits outside
`[nylas-container]` and enables Paid guests. Any partial guest tree or stray
guest hook fails closed. The Paid controller owns the complete tree's
Paid/Free/close/success visibility and reset lifecycle.

## The owner paints from their own settings

The non-brand branch of the booking block reveals the owner's call cards from
live connection state and then **returns** — before `startersBooking_handler`,
which is the only caller of the two painters. A starter opening their own
`/hire/<slug>` therefore kept the stale CMS rate and the authored
`00:00pm on 00/00` sentinel forever, on the same markup where every brand
viewer saw canonical values.

The gate is ownership, not role: the paint runs only when
`MEMBER.id === FREELANCER_ID`. `FREELANCER_ID` is what this file feeds to
`getStarterByMemberId`, whose Xano input is a Memberstack id, so both sides of
that comparison live in one id space. A talent viewing **someone else's**
profile is not an owner and gets the unchanged non-brand behaviour, byte for
byte. The reveal itself is untouched for every viewer — the paint is layered on
top of it and changes only what the revealed surfaces say.

### Where the owner's canonical values come from

The owner cannot read the brand path's source. `getConfigs` goes through
`nylas_configurations/get_bookable/v3`, whose precondition hard-rejects a
non-brand with `Brand membership is required`. The two settings endpoints the
scheduling dashboard already uses are the owner's equivalent — `user_v3` auth,
the starter derived from the member's own bearer token, and no brand gate at
all:

| Endpoint | Supplies |
| --- | --- |
| `GET starter/free-call-settings/get/v3` | `readiness`, the free `services[]`, and the availability `grant_id` |
| `GET starter/paid-call-settings/get/v3` | `readiness` and the paid `services[]` with `price_cents` and `currency` |

Both go through `authenticatedRequest`, the booking controller's own export, so
the owner path stays on the one authenticated Xano bridge this page already
uses rather than standing up a second auth stack for two call sites.

Each answer maps to one record shaped exactly like an accepted configuration —
`{is_paid, price_cents, config_id, duration, active, data_environment}`, plus
`currency` and `payment_environment` on paid — so both painters and the
admission rules keep a single record shape to reason about.
`readiness.bookable` is the gate, and `active === true` the filter: a service
nobody could book earns no rate paint and no availability request, the same
rule the brand path applies by keying on its **installed** set. More than one
active service for a type is a reconciliation case, not a choice, so that type
is left alone with a warning rather than painted from whichever record came
first.

Every owner record then goes through `isBookableRecordShape`, the same
admission rules `selectBookableConfigurations` runs over a brand viewer's
records — host environment, and the free/paid price, currency and duration
contracts described above — with one qualification on the paid data
environment, described in the mapping notes below. `bookableEnvironments()` is
the single reader for both. Readiness says a starter finished setting a
service up; it does not say the service is shaped like something anybody could
book, and a half-configured record that reaches only the owner's screen is the
worst kind — the owner has no second view to notice it against. A free service
priced above zero, a cross-environment record on staging, or a paid service
quoted in the wrong currency is refused with a warning and leaves the authored
row standing.

Three shape details differ from `get_bookable/v3` and are handled at the
mapping step, so the shared predicate itself never has to know the owner path
exists.

The settings payloads name a service's length as either `duration` or
`duration_minutes` (the tolerance `free-call-settings.js` already applies).

They report environment differently, and each payload's contract is owned by
its own endpoint document: free always stamps `data_environment` at the top
level ([Environment in the canonical GET
payload](FREE-CALL-SETTINGS-WIRING.md#environment-in-the-canonical-get-payload)),
while paid **reports no `data_environment` at all** ([Environment in the
canonical GET
payload](PAID-CALL-SETTINGS-WIRING.md#environment-in-the-canonical-get-payload)).
Each environment an endpoint does report is checked against the host, so on a
paid record that field is filled from the host rather than invented, and the
paid record's environment authority is the `payment_environment` that endpoint
does report, which is checked. This is the one place the owner gate is weaker
than the brand gate. A free record missing `data_environment` fails closed
here instead, on the strength of that guarantee: absence means the free
contract changed upstream, not that the check should be skipped.

Stamps are trimmed and lowercased on the record before the predicate compares
them, matching how stamps are compared elsewhere in this repo. The predicate
keeps comparing strictly, because loosening it would change what a **brand**
viewer is shown. Fallbacks use `== null`, so an explicit Xano `null` and an
absent key mean the same thing.

**A revealed but not-yet-bookable owner keeps the authored row and the CMS
rate, deliberately.** The reveal runs off calendar and Stripe connection state,
so an owner mid-setup — calendar connected, availability not configured yet, or
the call type still toggled off — sees their cards while `readiness.bookable`
is still `false`. Their settings values are not stable enough to display at
that point, so nothing is painted over the authored markup. The card is not
hidden and the reveal is not changed; this is a gap in what the paint covers,
not a new state.

Availability is asked against the `nylas_grant_id` on the starter record the
branch already fetched. The free settings payload carries its own `grant_id`;
a disagreement between the two is warned about but does not change which grant
is used.

### The owner never reads "No available slots" for a lookup fault

`paintNextAvailableSlots` takes an options argument, and the owner call site
passes `leaveRowOnDegrade`. Every **fault** path — a failed settings lookup, an
unbookable readiness, a missing availability export, a missing grant, a slot
that cannot be formatted — leaves the authored row exactly as it found it,
warns, and paints nothing.

An **empty answer** is not a fault and is not covered by the option. When
`getNearestSlot` resolves with nothing, the calendar really is booked out for
the window, and that is information the owner is entitled to: the no-slots copy
and `data-next-slot-state="empty"` are written for them exactly as for a brand
viewer. So the "never leave a sentinel standing" invariant holds for the brand
on every path and for the owner on the empty-answer path; only a genuine
lookup fault leaves the owner's authored row alone.

That carve-out is deliberate. For a brand viewer, a standing placeholder time
is the worst outcome, so every degrade writes the no-slots copy. The owner is
the one viewer for whom `No available slots` over a *broken lookup* is an
accusation — it sends them to fix availability settings that may be perfectly
correct. The brand call site omits the option and behaves exactly as it always
has.

Failure is quiet and total. Each settings endpoint catches its own rejection,
so one 4xx costs that call type its paint and nothing else, and an outer catch
means no throw on this path can reach the reveal that already ran.

## Inline Global Code cutover boundary

The released Webflow component still contains legacy JavaScript across its
Global Code embeds. The scoped cutover removes the retired Free behavior:
Starter booking-profile reads, bookable configuration reads, nearest-slot
reads, Free chooser handlers, public Nylas scheduler mounting, and direct
provider submission. `free-call-booking.js` owns the replacement authenticated
calendar and canonical command. Keep the native chooser, modal shell, Nylas
container, guest fields, and success step in Designer.

Do not port or remove the legacy Paid/Stripe branches, dashboard call lists,
call details, confirmation, decline, cancel, reschedule, payment actions, or
unrelated component code as part of this change. Those areas have separate V3
owners or require a separate cutover. Remove the old Free handlers only in the
same authorized Webflow publish that installs the new script. This prevents two
owners from binding the same click.

Note: the staging test index does not contain production records, so a
`404 ObjectID does not exist` on `webflow.io` is a data condition, not a code
fault. Card rendering is verified on production.

## QA venue limits for the call-surface rules

Both the canonical rate repaint and the next-slot paint are only observable to a
**logged-in** viewer — a Brand on the canonical path, or the profile's own
starter on the owner path: `hire-profile.js` returns before booking discovery
when there is no `MEMBER.id`, so every `[has-connection]` call card stays
`display:none` for an anonymous viewer and neither writer ever runs. An anonymous
prod or staging check that comes back clean has therefore not exercised them.

The other half of the squeeze: sandbox members exist only on staging, and the
staging index holds no production starters, so there is no venue where a member
session and a rendered call card meet. Machine verification of the logged-in
half is impossible from this harness. Final acceptance is a console paste from a
logged-in browser.

The owner path is the tighter case of the same limit: it needs a session that is
the starter whose profile is rendered, so it cannot be exercised by any brand
sandbox member either, on either host. Its unit coverage in
[`hire-profile.test.js`](hire-profile.test.js) is the whole automated venue;
acceptance is a console paste from the starter's own logged-in browser.

## Not owned here — `No button group "step-1" in scope`

The `[data-form-flow="generate-contract"] No button group "step-1" in scope`
warning on every profile load comes from
`global-embeds/step-flow/step-flow.js:959`, not from this file. The
generate-contract form's authored markup carries two `data-form-flow-step`
elements with **empty** ids and a single `data-form-flow-button-group="step-2"`,
so step-flow's `STEP1_ID` never resolves (verified on
`www.thestarters.com/hire/trent`, 2026-08-27). The fix is in Webflow — author
`step-1` on the first step and its button group — and is independent of the
service-card wiring: the warning also fires on staging where the wiring never
runs at all.
