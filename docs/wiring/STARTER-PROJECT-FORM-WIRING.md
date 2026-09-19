# V3 Starter project form wiring

`v3/starter-project-form.js` connects the detached Starter Dashboard copy of the
shared **Contract Generation** component to the authenticated V3 project endpoints.
V2 is a behavior reference only. This controller does not call a V2 route,
Airtable, Make, or a legacy TalkJS table.

## Phase 1 scope

- Reuse the detached `/hire/<slug>` **Contract Generation** form. Do not maintain
  a second Starter-only commercial form.
- Identify the detached Starter copy by its authored profile marker
  `[element="profile_photo"]`; the controller promotes that dialog to
  `data-project-form-v3="starter"` and `data-modal-target="start-project"`.
- Use its Designer-authored native Brand select `select#Brand[name="Brand"]`.
- Keep `#Project-Name` and the existing commercial fields.
- Do not add or send Connection Type.
- Do not show opportunity choices or prefill Project Scope yet.
- Create a project *request* after the server verifies the Starter-to-Brand
  relationship and commercial fields. A Starter submission never creates a
  canonical project on its own.
- The Brand accepts or declines that request from `/brand-dashboard`. Acceptance
  creates the canonical project and, for a Standard Contract, enqueues the single
  PandaDoc contract invitation through the existing project outbox. The proposal
  path adds no second invitation.
- Brand and Starter can sign in either order. Both signatures activate the
  project.
- The Brand **Approve Project** / **Decline Request** step is required. Its
  Designer, endpoint, and install contract lives in
  [BRAND-PROJECT-PROPOSALS-WIRING.md](BRAND-PROJECT-PROPOSALS-WIRING.md).

## Backend contract required before Webflow wiring

`POST projects/proposal-options/v3` must authenticate the Starter and return only paid Brands
with a current active `talkjs_brand_message` relationship. The shared
`projects/options/v3` route remains the direct-hire option source.
authorized by the server-verified V3 Brand-to-Starter message relationship
projection:

```json
{
  "counterparties": [
    {
      "counterparty_id": 81,
      "company_name": "Acme",
      "hiring_manager_name": "Jai",
      "memberstack_member_id": "mem_brand"
    }
  ]
}
```

`hiring_manager_name` may be empty. The company name remains the visible Party
fallback in that state. `memberstack_member_id` is the authenticated Brand
member ID. The controller validates it and uses
`/messages?with=<memberstack_member_id>` for the existing Message action.

Do not return message text or use the browser's Brand value as authority.

`POST projects/proposal-request/v3` accepts the stable `brand_id`, the shared
commercial payload, and an idempotency key. It must recheck the active
relationship and create one proposal row awaiting Brand approval:

```json
{
  "kind": "proposal",
  "proposal": { "id": 669, "status": "awaiting_brand_approval", "lifecycle_version": 1 },
  "replayed": false
}
```

The browser requires `kind: "proposal"`, a positive proposal ID and lifecycle
version, and a known proposal status. This keeps idempotent terminal replays
valid while a fulfilled malformed response remains a retryable failure.

The endpoint must not create a `core_projects_v3` row, a `project.created`
lifecycle event, or a PandaDoc outbox job. Those belong to Brand acceptance —
see [BRAND-PROJECT-PROPOSALS-WIRING.md](BRAND-PROJECT-PROPOSALS-WIRING.md).
Replaying the same idempotency key must return the same proposal instead of
creating a second one.

## Starter service names

The authenticated `starter/profile/me` response supplies the canonical service
names as `services`, or as `Services` when `services` is absent. Both the array
shape and the three-slot object shape are accepted:

```json
{ "services": ["Paid Media Audit", "Lifecycle Strategy"] }
```

```json
{
  "services": {
    "service-1": "Paid Media Audit",
    "service-2": "Lifecycle Strategy"
  }
}
```

Array items may be plain strings or objects carrying `name`, `label`, or `raw`.
Object keys are read in slot order and tolerate the `service-1`, `service_1`,
and `Service 1` spellings; any other key is ignored, so sibling metadata can
never become a selectable service. Names are trimmed, empty values dropped, and
duplicates removed case-insensitively. Generic `Service 1`, `Service 2`, and
`Service 3` values are dropped from every response shape.

The authored `Monthly retainer` option is a separate canonical gate. The same
profile response must contain `retainer_enabled: true` and a positive numeric
`retainer_rate`; the canonical `Retainer_Enabled` and `Retainer_Rate` spellings
are also accepted. The controller removes `Monthly retainer` when either value
is missing, disabled, zero, or invalid. A service named `Monthly retainer`
cannot bypass this gate.

The `freelancers_v3.Services` field is live in production and the profile
endpoint projects it into the response. A read-only production reconciliation
on 2026-08-24 found 677 profiles with non-empty canonical service arrays. The
three production test profiles used for this workflow currently have empty
arrays. For an empty array, the controller removes the generic service
placeholders, applies the Retainer gate, and keeps every other valid authored
option.

### Profile request paths

The controller reads the profile through `Opp30.API.starterProfile()` whenever
that method exists. That remains the primary path. Browser sessions holding a
cached `opportunities-3.0.js` predating the method would otherwise get no
profile at all, so the controller falls back to a direct
`POST https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30/starter/profile/me` with a
`{}` body, authorized by the shared `window.getXanoAuthToken` bridge. It sets
the `Authorization` header itself instead of calling `window.xanoAuthFetch`,
because that helper only credentials the reviewed `api:tCpV3oqd` scheduling
paths and would pass this `api:opp30` route through unauthenticated.

**The fallback therefore requires `v3/scheduling-auth.js` on the page.** That
script owns `window.getXanoAuthToken`, and `/starter-dashboard` is inside its
install boundary; the authoritative host and path list lives in
[Scheduling auth](../../v3/README.md#scheduling-auth). Without the bridge the fallback
issues no request at all and no error is surfaced. The modal still removes the
generic service placeholders, removes `Monthly retainer`, and keeps every other
valid authored option. Keep the
loader in the Script order block below when installing or auditing this page.

The fallback issues no request when the bridge or `window.fetch` is missing, and
rejects before issuing one when the bridge resolves a blank token, so it never
sends `Bearer undefined`. A non-ok response — including one whose body is not
JSON — also rejects. The profile load swallows every rejection. The controller
removes `Monthly retainer` and the generic `Service 1`, `Service 2`, and
`Service 3` options, while every other valid authored option remains. The token
is only ever passed to the `Authorization` header; it is never rendered, logged,
or submitted.

## Shared Designer contract

The controller binds these existing elements:

- source modal: the detached `dialog[data-modal-target="generate-contract"]`
  containing `[element="profile_photo"]`;
- runtime modal: `dialog[data-project-form-v3="starter"][data-modal-target="start-project"]`;
- form: the native form inside that dialog;
- Confirm submitter: keep the Designer-authored submit button, input, or
  `[data-project-submit]` control inside `.button-group.is-confirm`. The
  controller enables only this Confirm control while the form is `ready` or
  after a retryable submit failure. It keeps Confirm disabled while the form is
  idle, loading, blocked, submitting, or successful, and after validation,
  authorization, conflict, or session failures. The controller also reasserts
  that state if a delayed Turnstile update changes the authored control;
- the controller adds `data-starters-turnstile-fix="true"` to that native form
  during boot so the sitewide Turnstile repair targets the form, not a visual
  wrapper;
- Brand select: `select#Brand[name="Brand"]`, labeled **Select a Brand**, with one
  authored empty placeholder option labeled **Choose a Brand**;
- stable selected Brand ID: `#brand-contract`;
- Brand display fields: `#Company-Name` and `#Hiring-Manager-Name` (legacy
  lowercase Starter IDs remain supported during rollback). The selected
  option's `company_name` fills Company. Its `hiring_manager_name` fills Hiring
  Manager when present; otherwise Hiring Manager remains empty;
- the Brand email input is disabled and hidden because the options endpoint does
  not expose it;
- Service select: the authored `select[name="Services"]` (also matched by
  `[data-project-field="service"]` and a lowercase `services` name). Webflow
  authors every option, including **Freelance work**, **Monthly retainer**, and
  the generic **Service 1**, **Service 2**, and **Service 3** placeholders. The
  controller always drops the generic `Service 1/2/3` slots. It also drops
  **Monthly retainer** unless the authenticated profile enables Retainer and
  supplies a positive rate. It keeps every other authored option and its order.
  When canonical services are present, it
  appends each name as both the submitted option value and its visible label. It
  rewrites option data only; it does not replace the select or the form
  structure;
- counterparty rail: the selected Brand manager's full name, when present,
  fills the existing `full_name` binding, and the Brand company fills
  `professional_headline`.
  Eligible options must include a company name. The controller clears and hides
  the copied Starter photo, role, role list, and profile information. Existing
  `element` attributes remain supported; new markup should use
  `data-project-bind="starter.<field>"`;
- shared commercial fields: serialized and validated by `v3/project-form.js`.

Webflow owns the native select and placeholder. JavaScript binds the authorized
Brand records as option data; it does not generate or replace the form structure.
One eligible Brand is selected automatically. Multiple eligible Brands keep the
placeholder selected and require the Starter to choose. Zero eligible Brands
disable the select and show **No eligible Brands yet**.

Each modal open refreshes the Starter profile and the service names alongside
the Brand options. The controller never restores the generic `Service 1/2/3`
slots after an empty service list, a failed profile request, or a member scope
change. It also fails closed by removing `Monthly retainer` until a successful
profile response proves the enabled flag and positive rate. It keeps every
other valid authored option. A selection that survives the refresh is kept;
one whose option no longer exists is cleared to the empty value. Service
loading is independent of the Brand identity rail: the
controller still clears the copied Starter photo, role, role list, and profile
information rather than repainting them from the profile response.

The canonical modal is the detached shared Contract Generation dialog with the
Starter profile marker. Before the shared modal initializer runs, the controller
changes every other
`start-project` dialog target to `start-project-legacy-disabled-N`. If no dialog
contains the authored Starter profile marker, it disables every `start-project`
dialog target. It also changes the nested `a.clickable_link` in each `start-project`
trigger to `href="#start-project"`, so the Navbar control cannot follow its
legacy opportunities URL.

The copied CMS-only identity inputs remain compatibility markup only. The
controller disables them, removes Starter Memberstack bindings from the Brand
display fields, and submits only the authenticated Starter plus the selected
server-authorized Brand ID. JavaScript binds behavior and values; it does not
generate form HTML.

The controller also corrects the copied Brand-facing text in the native modal
for the Starter flow. The right rail says **Selected Brand**, the introduction
describes working with a Brand, and the scope, upfront-payment, and ongoing-term
help text addresses the Starter. After a Brand is selected, the alignment notice
and **Message Party** action use the Brand manager's first name. They use the
company name when the manager name is empty and return to neutral **Party** copy
when the selection is cleared. The same selection updates the action destination
to `/messages?with=<memberstack_member_id>` and restores `#` when the selection
is cleared or the ID is invalid. These are updates to existing Designer
elements, not generated markup.

After a successful submit, the controller restores the native controls before
it reveals `.generate-contract_success`. This lets the existing shared preview
renderer populate Review Details from the values that were submitted. It does
not create a second preview renderer or a second project request. The success
panel's **Manage Projects** link goes to `/starter-dashboard#projects`.

## Script order

Load the shared auth bridge and the existing data and form scripts first, then
the Starter adapter:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/scheduling-auth.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/opportunities-3.0.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/project-form.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/starter-project-form.js"></script>
```

`scheduling-auth.js` is required, not optional. It installs the
`window.getXanoAuthToken` bridge that backs the profile fallback described under
[Profile request paths](#profile-request-paths). Omit it and any session with a
cached `opportunities-3.0.js` lacking `Opp30.API.starterProfile` cannot load
canonical services. The controller still removes the generic placeholders and
`Monthly retainer`, and keeps every other valid authored option.

Do not add the last loader until both V3 endpoints exist and pass backend tests.
After release, install it on the Starter Dashboard so the existing Navbar action
opens the detached shared Contract Generation form.
The deferred Starter adapter must execute before `global-embeds/modal/modal.js`
initializes the shared modal registry, because it normalizes duplicate targets
and the Navbar link during boot.

## Backend release evidence

Frontend unit tests and mocked route tests do not prove canonical Xano writes or
PandaDoc outbox behavior. Before installing the loader, run a separately approved,
bounded backend canary and read back the canonical records. The evidence must show
one proposal row and no project, no `project.created` event, and no PandaDoc
outbox job for each Starter submission; then, after the Brand accepts, exactly
one project, one `project.created` event, exactly one PandaDoc outbox job for a
Standard Contract, and no PandaDoc outbox job for an Own Contract. A replayed
idempotency key must add nothing on either side. Stop at the first mismatch and
do not treat prior frontend evidence as backend acceptance.

For this release, validation is staging-only and must use PandaDoc DEV routing.
Production must retain PandaDoc live routing, but this release does not authorize
a production project, PandaDoc document, signature, or email canary.

## User states

- No eligible Brand: **You can start a project after a Brand messages you.**
- Successful submit, either contract type: **Project request sent. The Brand can
  review your project terms. A project and contract are created only after
  approval.**
- Duplicate request (409): **A project request already exists for this Brand.**
- Stale relationship: ask the Starter to refresh the available Brands and retry.

The success event is `starters:project-proposal-requested`. Its detail contains
only the stable `proposal_id` and replay state.

The PostHog funnel event is `project_proposal_requested` with a `proposal_id`
property, renamed from `project_created`. `v3/project-form.js` keeps emitting
`project_created` for the Brand direct-hire path on `/hire/<slug>`, so any
dashboard keyed on `project_created` now measures direct hires only. The rename
needs its migration note in `platform-ops/architecture/posthog-funnel-events-plan.md`,
which lives outside this repository; land that note before reading the renamed
event in a funnel.

## Screen-share diagnostics

Add `?starterProjectDebug=1` to the Starter Dashboard URL before the test. The
controller then writes structured `[StarterProjectV3]` entries to the browser
console for controller bind, Brand-option request/result/error, submit
request/result/error, and member-scope reset.

The entries can include Xano Brand or proposal row IDs, HTTP status, proposal
status, and eligible count. They never include member IDs, email, tokens,
idempotency keys, contract payloads, project scope, or free-form server text.

For a multi-navigation session, an operator can set local storage key
`starters:project-debug` to `1`. Remove it after the test. The URL flag is the
preferred meeting option because it does not persist.
