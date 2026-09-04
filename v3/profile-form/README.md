# Profile form browser ownership

The native Webflow forms, fields, success states, error states, and layout remain authored in Webflow.
This directory owns browser logic shared by Build Profile and Starter Edit Profile.

## Inline extraction candidate

`shared-foundation.js` and `incremental-dropdowns.js` are extractions from the
authenticated published pages. Route-specific extracted controllers remain in `v3/build-profile/`
and `v3/starter-edit-profile/`. Deliverable files normalize trailing whitespace and excess terminal
newlines, and deferred controllers add one-time browser guards. The manifest records separate immutable
live identities and candidate identities, plus the exact inverse transformation used to reconstruct
each captured live body.

Five candidates no longer reconstruct to their published bodies. `canonical-profile-loader.js`
carries company logo and stable client identity hydration, the
[required-mirror hydration contract](../starter-edit-profile/README.md#canonical-required-mirror-hydration),
and the
[browser-native unsaved-change prompt request](../starter-edit-profile/README.md#unsaved-change-warning),
`draft-state.js` carries the member-bound hydration fix,
`submit-writer.js` carries the behavior changes owned by the
[Build Profile documentation](../build-profile/README.md), `shared-foundation.js`
adds a taxonomy value only through an explicit option click or an Enter press on a highlighted
option, so typing an exact option name never selects it on fill, on a comma, or on blur, and
keeps delayed saved-value taxonomy hydration inside the Edit Profile dirty-state hydration guard, so
the clean page does not report an unsaved Step 6 change before the member edits it, and preserves any
saved taxonomy id that no longer has a rendered option only for a true multi-select. A scalar
Function or Availability selector keeps at most one rendered saved option and never emits a
comma-separated hidden value, and
applies the [whole-dollar price contract](#whole-dollar-price-contract) to every rate input instead
of stripping symbols and re-formatting the authored value,
and `incremental-dropdowns.js` syncs each Custom Service field into its hidden capture JSON on
every input and change, including when the member clears the field. Their transformations are recorded as
`whitespace_plus_idempotency_guard_plus_behavior_change` and name immutable published-body captures.
Tests still pin each candidate length and SHA-256, prove the published length, body hash, and
complete-embed hash from its capture, and fail if a declared change stops diverging from the published
body.

`inline-extraction-cutover-candidate.json` binds each source body to its authenticated published body
length, SHA-256, complete-embed SHA-256, script index, component instance, and node or complete
custom-code location. `inline-extraction-loaders.CANDIDATE.html` serializes one ordered page Head Code loader
template per route. The template wrappers keep this candidate file inert. Neither file authorizes an
install or publish.

The cutover is atomic across all three routes. Follow the manifest phases in order: append each complete
loader group to that route's exact saved page Head Code and read back all three saved blocks; empty the
four audited shared-component bodies once, with one before-hash gate each; then empty only the Edit
component and page-footer bodies under their route entries. Do not install one extracted loader at each
former node. Do not put different loader groups into the shared component: all three routes use the
same component definition. The live extracted bodies
run during HTML parsing, before the existing deferred photo, company, portfolio, work-date, counter,
bio, grouped-select, and diagnostic controllers. A per-node deferred replacement would move some
extracted boots after those existing controllers. Page Head Code preserves the supported controller
order. On Edit and Consult, the extracted group registers before the preserved body profile
controllers. Full Profile has one controlling site-head exception before the page group: pinned index 30
`starters-webflow@v1.56.14/profile-image-auth-shim.js` installs the authenticated image interception
first. The grouped extracted controllers run from page Head Code, then the remaining loaders keep their
DOM order. The later index 77 `@latest/profile-image-auth-shim.js` is an intentional no-op because
the index 30 script already set `window.__tsProfileImageAuthShim`.
`profile-image-auth-shim-v1.56.14.capture.txt` is the exact 16,265-byte Git-tag capture used to
execute and hash that controlling historical asset in tests. It is evidence, not a new CDN loader.

The shared component is used by all three routes. Its shared-foundation, draft, dropdown, and submit
bodies therefore appear only in `componentWideRemovals`, not under a route. Apply that set once after
all page Head Code readbacks pass. Then apply each route's Edit component or page-footer removals. Do
not turn one route group into site-wide code. Remove only a body whose exact complete-location hash
matches the recorded before hash. Read every complete saved location back before publish. Existing
profile-photo, Step 3 company, Step 4 portfolio, and later loaders stay unchanged.

The extraction does not move the form into JavaScript. It does not change the separate Step 3 company
owner or Step 4 portfolio owner. A future `wf-xano` conversion requires a separate declarative contract
and must not be combined with this ownership cutover, which changes no behavior beyond the five
declared candidate changes recorded above.

## Whole-dollar price contract

Profile price inputs preserve the member's authored text until validation. They do not strip symbols,
round decimals, or convert exponent notation. The native inputs use `type="number"`,
`inputmode="numeric"`, and `step="1"`. Hourly and Paid Call rates allow `$1` through `$1,000`,
Monthly Retainer allows `$1` through `$25,000`, and each Custom Service allows `$1` through `$50,000`.
An enabled blank, zero, decimal, comma, currency symbol, sign, exponent, unsafe integer, or value outside
its range stops before the Xano request. A toggle-owned rate is only validated while its own section
says yes. A collapsed Monthly Retainer or Paid Call section never forwards the stale text behind it,
because an unvalidated collapsed value would violate this contract: Build Profile replaces it with the
same zero or null compatibility value it uses for a section that was never filled in, so turning a
section off does discard the rate it was holding, and Edit Profile sends the canonical zero only
alongside the toggle it is turning off and otherwise omits the field. On Build Profile Consult the Paid Call
section, the Monthly Retainer section, and the Hourly Rate are all unauthored, so no hidden control
there is an answer and none of them may block a submit the member cannot repair. Each has its own
rule. For Paid Call the hidden radio is ignored and only a rate that already satisfies this contract
preserves the paid consult, so a canonical zero, blank, malformed, unsafe, or out-of-range rate keeps
`paid_call: false, paid_call_rate: null` whichever way hydration left the radio. The Hourly Rate
follows that same in-contract rule: an in-contract value is persisted, and a blank, zero, malformed,
unsafe, or out-of-range one stays `hourly_rate: 0`. The Monthly Retainer is unconditionally
inapplicable on Consult — it always submits `retainer: false, retainer_rate: 0` regardless of the
hidden radio and regardless of whether the hidden rate satisfies this contract. Full Profile authors
all three controls, so an enabled or required section there stays strict.

Wherever a blank is the compatibility-empty state, the canonical zero these same writers persist for
that field is that same state: a blank, zero, or otherwise out-of-contract profile-type-inapplicable Hourly Rate
round-trips as the zero compatibility value instead of being read back as an authored price, while a
required or applicable Hourly Rate still rejects zero and every other value this contract refuses. Service prices and names live in hidden capture inputs, where
focus and native constraint validation paint nothing, so their failures name themselves in the
authored feedback surface instead: the Edit Profile step opens its authored error modal and Build
Profile writes the same message into the `[build-profile-error]` panel it already reveals. Both are
authored markup, so each writes through only an explicit hook — `[build-profile-error-message]` in the
panel, `[data-profile-feedback-message]` in the modal — or, failing that, a first plain leaf that holds
no elements of its own (`p` or `div` in the panel, `p` in the modal); a wrapper carrying an icon beside
the copy is left untouched and the surface is revealed exactly as authored, with the failing control's
own native validation still reporting where it can. Both
surfaces are shared, so both memoize their authored copy and restore it at the single boundary every
reveal goes through: only the reveal that carries a message of its own replaces it. A reported price
failure, and any message it left behind, is therefore cleared before the next attempt, so a corrected
whole-dollar value saves without a page reload and no later failure — a rejected save, an auth
failure — inherits the previous cause. A canonical rate stored before these ranges narrowed is member
data neither page repairs: it hydrates unchanged and, wherever that price applies, blocks every save
before any Xano request until the member supplies a whole-dollar replacement of their own. Behind a
collapsed section, or on a Consult profile that authors none of these controls, it cannot block — the
compatibility rules above decide what is submitted instead.

Clearing a Custom Service price is the only remove gesture these forms author, and both writers keep
it: an empty price empties that slot — the service is dropped rather than persisted with a blank or
zero price — so a member can still delete a service they no longer offer. A non-blank price is an
authored price and stays strict, and a price authored without a name still blocks. No invalid value is
silently clamped.

Until the cutover installs this candidate foundation, the published body still live on
`/starter-edit-profile` re-formats every rate it claims to two decimals on blur, which no whole-dollar
value can survive. `starter-edit-profile.js` therefore owns the rate-input contract for that page: it
claims each price control and provides the page's shared rate setup, so the hourly, retainer, and
cloned Custom Service price rows keep the authored whole-dollar text they are validated against.

## Verification

Run:

```sh
node --test v3/profile-form/inline-extraction-contract.test.js
```

The executable suite checks immutable live identities and candidate identities against an oracle
outside the cutover manifest. It removes the recorded one-time guards and restores normalized
whitespace to reconstruct each unchanged live body, reads the published captures for candidates that
declare behavior changes, parses the loader templates, and rejects URL, defer, order, duplicate, wrong-head,
missed-removal, existing-loader, and route-owner drift. It executes each complete route sequence,
including every existing profile controller at its captured position, in one browser-like context and
pins the exact boot and handler registration order. It evaluates each grouped route twice to prove
one boot and one native-form handler owner, and
checks the shared empty-profile model,
country/state/city transitions, local-versus-member draft precedence, blank member-bound draft
hydration from the signed-in member and its write-back into the synchronized draft, canonical edit
hydration, the
normalized final Build Profile payload, and that the controllers do not create a form element.

## Company selection logo persistence

The Build Profile and Starter Edit Profile company autocomplete controllers
serialize each selected company as `name`, `domain`, `logo_url`,
`company_entity_id`, and `source` in the authored `also-worked-with` hidden
input. Starter Edit Profile also preserves `client_row_id` for each canonical
active client. Its canonical client-row ID
owns the serialized `client-{id}` key; only a selection without that ID receives
a new local key. This lets an existing legacy client with a blank domain retain
its canonical identity when saved.

The multi-value Also Worked With pickers offer the typed name as
`Use custom company`. A new domainless custom selection is stored as an
owner-scoped `pending_review` Company. It stays out of shared company
search until review. The same Starter can reload, retain, reorder, or remove it
by stable Client row and Company IDs. Custom-name duplicate checks ignore case;
canonical selections prefer Company ID, then normalized domain.

A platform company result keeps its `logo_url` through selection, draft
hydration, tag rendering, and later serialization. Starter Edit Profile
canonical hydration accepts the API's `company_logo_url` field and the
compatible `logo_url` field. An explicitly selected custom company has an empty
`logo_url`. The shared placeholder is presentation-only and is never persisted.

Starter Edit Profile saves Also Worked With before pending Work Experience
creates, updates, and deletes. A rejected mutation stops the sequence, shows the
authored error state, and does not show success. Completed mutations leave their
pending queue as they succeed, while uncommitted mutations remain queued for a
later retry. After a partial Work Experience save, the list refreshes canonical
rows and retains only the unsaved local drafts. When a save includes both a
create and a deletion, the create sends the deleted row as
`replace_companies_id` so Xano can replace it atomically at the three-company
limit; the browser does not send a separate delete for that paired row.

The single-company Work History picker stores the selected `name`, `domain`,
`logo_url`, `company_entity_id`, and `source` on its authored input. The Build
Profile and Edit Profile CRUD controllers send that metadata in create and
update payloads. A selected canonical Company is valid when it has a stable
`company_entity_id`, even if it has no domain. A selected domain match remains
valid. Each result list also includes an explicit `Use custom company` choice;
that choice is valid with `source: custom`, an empty entity ID, an empty domain,
and an empty logo. Free typing without selecting a result or that custom choice
is invalid.

Build Profile Work Experience creates, updates, and deletes are draft-stage
mutations. Each request sends `defer_projection: true`; the final Build Profile
submit remains the single owner of the complete Hire-page projection. Starter
Edit Profile keeps its immediate-save and asynchronous-projection contract.

If the member types over the selected name, the picker clears all stored
selection metadata so an old identity cannot be attached to new free text.
Editing an existing Work Experience row hydrates its entity ID, source, domain,
and stored logo without requiring reselection. The known Webflow placeholder is
presentation-only: hydration and payload construction normalize that exact URL
to an empty `company_logo_url`, and new custom Companies also persist an empty
logo.

Both route copies debounce input for 250 ms, abort a superseded request, and use
a sequence number so only the newest active query can render results or an
error. Closing the dropdown invalidates the active sequence, so a late response
cannot reopen it. A non-`2xx` response is a failure. The active failure state
keeps the dropdown open with its error message and the typed `Use custom
company` choice, so a member can still select the domainless fallback.
Refocusing reuses only results for the exact rendered query or a request for
that query that is still in flight; progress and error messages do not become
cached results.

Run the shared contract coverage with:

```sh
node --test v3/profile-form/company-autocomplete-logo-hydration.test.js
```

## Company experience date hydration

Both route copies of the company-experience controller
(`../build-profile/company-experience-crud.js` and
`../starter-edit-profile/company-experience-crud.js`) share one date contract, so the
Full Profile, Consult, and Edit Profile work-experience modals hydrate and save
identically.

The controllers convert the four existing Webflow date inputs to text controls backed
by a purpose-built month-only picker. It shows year arrows, a 3-by-4 grid of month
buttons, Today, and Clear; it has no day grid. The picker is the only way to write a
month: typing, pasting, and dropping text are all suppressed, and the field is marked
`aria-readonly`. It is deliberately not a `readonly` control, because a `readonly`
input is barred from constraint validation and could never report the inverted-range
message described below. The field carries `role="combobox"` so that the popup state
it already publishes is announced: `aria-expanded` is not a supported state of the
implicit `textbox` role, while `combobox` supports `aria-expanded`, `aria-haspopup`,
`aria-controls`, and `aria-readonly`, which are exactly the four properties the
control sets. The controllers remove the
legacy jQuery UI datepicker attributes and correct each label association at runtime,
without adding a second duration field or changing the Xano schema. Xano's existing
`start_date`, `end_date`, and `current_work` fields remain the only authority for the
tenure. The visible value is `Mon YYYY`, a changed value is normalized to `YYYY-MM`
for Xano, and cards continue to render `Mon YYYY`.

The picker opens on a click and on `Enter`, `Space`, or `ArrowDown` from the field, and
closes on `Escape`, on choosing a month, `Today`, or `Clear`, or on a mousedown outside
it. Every close except the outside mousedown returns focus to the field. Inside the
popup, `Tab` and `Shift+Tab` cycle through the year arrows, the twelve month buttons,
`Today`, and `Clear` instead of leaving it, skipping any control the end-month minimum
below has disabled, and the popup is appended into the surrounding work-experience modal
when there is one, so a keyboard member cannot land behind the dialog. The popup is
`position: fixed` and is re-measured against `window.visualViewport` on scroll, resize,
and viewport change, so a pinch-zoomed or soft-keyboard-shrunk viewport keeps it on
screen rather than clipping it off an edge.

Stored dates are parsed into a real local `Date` before they hydrate the month picker.
The parser accepts an exact full or three-letter month in
`Month YYYY` (first of that month) and ISO `YYYY-MM-DD` with an optional valid
`THH:MM:SS` suffix, fractional seconds, and `Z` or `+/-HH:MM` offset (that exact
local calendar day, never a UTC shift). Because Xano records hold day-precision
values as well as month-only ones, it also accepts native `YYYY-MM`,
`Month D YYYY`, `Month D, YYYY`, and numeric `M/D/YYYY` legacy values such as
`04/22/2026`. It rejects unknown month names, malformed ISO suffixes, invalid time or
offset values, and out-of-range dates rather than coercing or rolling the value.

A string in none of those shapes yields no visible month value, so the field renders
blank rather than hydrating an unrelated month and year. Nothing is lost when that
happens: the baseline/serialize pair below re-submits the original stored string for a
date field the member never touched.

`Present` is a stored sentinel for a current role, not a date. The disabled end-month
field shows it verbatim, both when "I currently work here" is ticked and when a stored
current role is reopened, so the two paths render the same state. It is never parsed
into a month and never becomes a baseline, so reopening a current role cannot turn the
sentinel into a calendar value, and clearing "I currently work here" restores the
member's own previous month rather than carrying `Present` into an editable field.

Work History cards use the same strict parser for their display label. Valid ISO,
month-only, and day-precision values render as `Mon YYYY`; for example,
`2026-08-03T00:00:00.000Z` renders as `Aug 2026`. This display-only transform does
not rewrite the stored value. `Present`, blanks, and unknown legacy strings keep
their existing behavior.

Hydration also records the canonical string it came from next to the visible month value.
Opening a different role clears disabled state and any date bounds left by the prior modal,
then reinstalls the end-month minimum from the role it is showing.
The bound is one-way. A non-current start month sets the end control's `min`, and its
picker disables every month before that minimum, the previous-year arrow once the
minimum's year is the one on screen, and `Today` when the current month falls before it;
a current role or a blank start month clears the bound again. The start control never
takes a `max`, so an existing or inverted range stays repairable from either side.
For a non-current role, save-time validation still requires the end month to be the same as
or later than the start month; same-month tenures are valid. A rejected range sets a custom
validity message on both month controls and reports it on the end-month control, so the
member sees which pair is wrong for as long as it stays wrong; touching either month, the
current-role checkbox, or reopening the modal clears it. A current role disables the
end-month control and stores `Present` through the existing `end_date` field.

On save, a date field the member never touched re-serializes its original canonical string,
and only a field whose visible month value actually changed submits `YYYY-MM`. Editing an
unrelated field therefore cannot rewrite a stored legacy date.

Run this coverage with:

```sh
node --test v3/profile-form/company-experience-date-hydration.test.js
```
