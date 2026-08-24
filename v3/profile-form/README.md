# Profile form browser ownership

The native Webflow forms, fields, success states, error states, and layout remain authored in Webflow.
This directory owns browser logic shared by Build Profile and Starter Edit Profile.

## Inline extraction candidate

`shared-foundation.js` and `incremental-dropdowns.js` are behavior-preserving extractions from the
authenticated published pages. Route-specific extracted controllers remain in `v3/build-profile/`
and `v3/starter-edit-profile/`. Deliverable files normalize trailing whitespace and excess terminal
newlines, and deferred controllers add one-time browser guards. The manifest records separate immutable
live identities and candidate identities, plus the exact inverse transformation used to reconstruct
each captured live body.

Two candidates no longer reconstruct to their published bodies. `draft-state.js` carries the
member-bound hydration fix, and `submit-writer.js` carries the profile-save and pending-photo commit
gate. Their transformations are recorded as
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
and must not be combined with this ownership cutover, which changes no behavior beyond the
declared `draft-state.js` hydration fix and `submit-writer.js` photo gate recorded above.

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
serialize each selected company as `name`, `domain`, and `logo_url` in the
authored `also-worked-with` hidden input. A platform company result keeps its
`logo_url` through selection, draft hydration, tag rendering, and later
serialization. Starter Edit Profile canonical hydration accepts the API's
`company_logo_url` field and the compatible `logo_url` field. A manually typed
company has an empty `logo_url`.

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

Stored dates are parsed into a real local `Date` before they reach
`datepicker('setDate', …)`. jQuery UI treats a bare string as its relative-offset
syntax rather than a calendar date, so a stored `Jan 2024` was read as a day offset and
hydrated the picker on an unrelated month and year (`Mar 2032` in production Work
Experience QA). The parser accepts `Month YYYY` (first of that month) and ISO
`YYYY-MM-DD` with an optional time part (that exact local calendar day, never a UTC
shift). Because Xano records hold day-precision values as well as month-only ones, it
also accepts `Month D YYYY` and `Month D, YYYY`, and it rejects an out-of-range day such
as `Jan 32 2024` rather than rolling it into the next month.

A string in none of those shapes is re-parsed with the widget's own configured
`dateFormat`. That format is set on the Webflow markup for each input, not here, so the
widget is the only thing that can recognize a value it wrote itself; jQuery UI's
`parseDate` throws on a mismatch instead of reading the string as a day offset. A value
neither path can parse yields no picker value at all, so the field renders blank rather
than hydrating an unrelated month and year. Nothing is lost when that happens: the
baseline/serialize pair below re-submits the original stored string for a date field the
member never touched.

`Present` is a stored sentinel for a current role, not a date. It never reaches the
picker and never becomes a baseline, so reopening a current role cannot turn the
sentinel into a calendar value, and clearing "I currently work here" cannot carry
`Present` into an end-date field the member can see.

Hydration also records the canonical string it came from next to the value the picker
rendered from it. Opening a different role clears date bounds and disabled state left by
the prior modal. If jQuery UI initializes after the modal opens, the controller rehydrates
the stored dates once the two pickers are ready. Input, change, and calendar-selection
guards prevent that late pass from overwriting a date the member already typed or picked.
On save, a date field the member never touched re-serializes its original canonical string,
and only a field whose visible value actually changed submits the picker's value. Editing
an unrelated field therefore cannot rewrite a stored date to the picker's own formatting.

Run this coverage with:

```sh
node --test v3/profile-form/company-experience-date-hydration.test.js
```
