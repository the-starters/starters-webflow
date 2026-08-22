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
- Create the canonical project immediately after the server verifies the
  Starter-to-Brand relationship and commercial fields.
- For a Standard Contract, enqueue contract generation immediately. Brand and
  Starter can sign in either order. Both signatures activate the project.
- Do not add a separate Brand **Approve Project** or **Decline Request** step.

## Backend contract required before Webflow wiring

`POST projects/options/v3` must authenticate the Starter and return only Brands
authorized by the server-verified V3 Brand-to-Starter message relationship
projection:

```json
{
  "counterparties": [
    {
      "counterparty_id": 81,
      "company_name": "Acme",
      "hiring_manager_name": "Jai"
    }
  ]
}
```

Do not return message text or use the browser's Brand value as authority.

`POST projects/submit/v3` accepts the stable `brand_id`, the shared commercial
payload, and an idempotency key. It must recheck the active relationship and
create one `core_projects_v3` row plus one `project.created` lifecycle event.
A Standard Contract creates one PandaDoc outbox job. An Own Contract uses the
existing active-project branch and creates no PandaDoc job. The endpoint must
not create a proposal row or require a later approval action.

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
  option's `company_name` fills Company and its `hiring_manager_name` full name
  fills Hiring Manager;
- the Brand email input is disabled and hidden because the options endpoint does
  not expose it;
- counterparty rail: the selected Brand member's full name fills the existing
  `full_name` binding, and the Brand company fills `professional_headline`.
  Eligible options must include both values. The controller clears and hides
  the copied Starter photo, role, role list, and profile information. Existing
  `element` attributes remain supported; new markup should use
  `data-project-bind="starter.<field>"`;
- shared commercial fields: serialized and validated by `v3/project-form.js`.

Webflow owns the native select and placeholder. JavaScript binds the authorized
Brand records as option data; it does not generate or replace the form structure.
One eligible Brand is selected automatically. Multiple eligible Brands keep the
placeholder selected and require the Starter to choose. Zero eligible Brands
disable the select and show **No eligible Brands yet**.

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
help text addresses the Starter. These are exact-text updates to existing
Designer elements, not generated markup.

After a successful submit, the controller restores the native controls before
it reveals `.generate-contract_success`. This lets the existing shared preview
renderer populate Review Details from the values that were submitted. It does
not create a second preview renderer or a second project request. The success
panel's **Manage Projects** link goes to `/starter-dashboard#projects`.

## Script order

Load the existing data and form scripts first, then the Starter adapter:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/opportunities-3.0.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/project-form.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/starter-project-form.js"></script>
```

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
one project and one `project.created` event for each submission, exactly one
PandaDoc outbox job for a Standard Contract, and no PandaDoc outbox job for an Own
Contract. Stop at the first mismatch and do not treat prior frontend evidence as
backend acceptance.

For this release, validation is staging-only and must use PandaDoc DEV routing.
Production must retain PandaDoc live routing, but this release does not authorize
a production project, PandaDoc document, signature, or email canary.

## User states

- No eligible Brand: **You can start a project after a Brand messages you.**
- Successful Standard Contract submit: **Project successfully created. Your contract is being prepared. You and the Brand can sign when it is ready.**
- Successful Own Contract submit: **Project successfully created. Your project is now active.**
- Stale relationship: ask the Starter to refresh the available Brands and retry.

The success event is `starters:project-created`. Its detail contains only the
stable `project_id` and replay state.

## Screen-share diagnostics

Add `?starterProjectDebug=1` to the Starter Dashboard URL before the test. The
controller then writes structured `[StarterProjectV3]` entries to the browser
console for controller bind, Brand-option request/result/error, submit
request/result/error, and member-scope reset.

The entries can include Xano Brand or project row IDs, HTTP status, lifecycle
state, and eligible count. They never include member IDs, email, tokens,
idempotency keys, contract payloads, project scope, or free-form server text.

For a multi-navigation session, an operator can set local storage key
`starters:project-debug` to `1`. Remove it after the test. The URL flag is the
preferred meeting option because it does not persist.
