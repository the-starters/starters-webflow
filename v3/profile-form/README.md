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
carries company logo and stable client identity hydration plus the
[browser-native unsaved-change prompt request](../starter-edit-profile/README.md#unsaved-change-warning),
`draft-state.js` carries the member-bound hydration fix,
`submit-writer.js` carries the behavior changes owned by the
[Build Profile documentation](../build-profile/README.md), `shared-foundation.js`
adds a taxonomy value only through an explicit option click or an Enter press on a highlighted
option, so typing an exact option name never selects it on fill, on a comma, or on blur, and
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
says yes; a collapsed Monthly Retainer or Paid Call section keeps its existing zero or null
compatibility state instead of blocking the submit on text the member cannot see, and its stale text is
never forwarded unvalidated: Edit Profile sends the canonical zero only alongside the toggle it is
turning off and otherwise omits the field. On Build Profile Consult, where the paid-call radio is
hidden, only a rate that already satisfies this contract enables the paid consult, so a canonical zero,
blank, malformed, or out-of-range rate behind that hidden control stays the no-paid-consult
compatibility state rather than blocking the submit. A blank
profile-type-inapplicable Hourly Rate keeps the same zero compatibility state. Service prices and names
live in hidden capture inputs, so their failures report through the authored error modal rather than
native constraint validation. No invalid value is silently clamped.

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

The controllers convert the four existing Webflow date inputs to native
`type="month"` controls. They remove the legacy jQuery UI datepicker attributes and
correct each label association at runtime, without adding a second duration field or
changing the Xano schema. Xano's existing `start_date`, `end_date`, and `current_work`
fields remain the only authority for the tenure. The control value is `YYYY-MM`, the
browser presents it as a localized month and year, and cards still render `Mon YYYY`.

Stored dates are parsed into a real local `Date` before they hydrate the native month
control. The parser accepts an exact full or three-letter month in
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

`Present` is a stored sentinel for a current role, not a date. It never reaches the
month control and never becomes a baseline, so reopening a current role cannot turn the
sentinel into a calendar value, and clearing "I currently work here" cannot carry
`Present` into an end-date field the member can see.

Work History cards use the same strict parser for their display label. Valid ISO,
month-only, and day-precision values render as `Mon YYYY`; for example,
`2026-08-03T00:00:00.000Z` renders as `Aug 2026`. This display-only transform does
not rewrite the stored value. `Present`, blanks, and unknown legacy strings keep
their existing behavior.

Hydration also records the canonical string it came from next to the native month value.
Opening a different role clears disabled state and any date bounds left by the prior modal.
The two controls intentionally do not set reciprocal native `min` and `max` bounds. Those
bounds can trap an existing or inverted range and stop a member from repairing either month.
For a non-current role, save-time validation still requires the end month to be the same as
or later than the start month; same-month tenures are valid. A rejected range sets a custom
validity message on both month controls and reports it on the end-month control, so the
member sees which pair is wrong for as long as it stays wrong; touching either month, the
current-role checkbox, or reopening the modal clears it. A current role disables the
end-month control and stores `Present` through the existing `end_date` field.

On save, a date field the member never touched re-serializes its original canonical string,
and only a field whose native month value actually changed submits `YYYY-MM`. Editing an
unrelated field therefore cannot rewrite a stored legacy date.

Run this coverage with:

```sh
node --test v3/profile-form/company-experience-date-hydration.test.js
```
