# V3 Starter project proposal form wiring

`v3/starter-project-form.js` connects the existing V3 Starter Dashboard
**Start a Project** modal to the authenticated V3 project proposal endpoints.
V2 is a behavior reference only. This controller does not call a V2 route,
Airtable, Make, or a legacy TalkJS table.

## Phase 1 scope

- Reuse `dialog[data-modal-target="start-project"]` and its existing native form.
- Reuse the authored searchable Brand field `#Select-Brand` and list `#brand-list`.
- Keep `#Project-Name` and the existing commercial fields.
- Do not add or send Connection Type.
- Do not show opportunity choices or prefill Project Scope yet.
- Submit a proposal that waits for Brand approval. Do not report that a project
  or contract was created.

## Backend contract required before Webflow wiring

`POST projects/options/v3` must authenticate the Starter and return only Brands
authorized by the V3 signed-message relationship projection:

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
create one `core_project_proposals_v3` row with
`status=awaiting_brand_approval`. It must create zero projects, contract jobs,
emails, invoices, and points events.

## Existing Designer contract

The controller binds these existing elements:

- modal: `dialog[data-modal-target="start-project"]`;
- form: the native form inside that dialog;
- Brand search: `#Select-Brand`;
- Brand list: `#brand-list`;
- authored option template: `.brand-select_dropdown-item.is-not-found`;
- stable selected Brand ID: `#brand-contract`;
- Brand display fields: `#brand-company-name` and `#hiring-manager-name`;
- shared commercial fields: serialized and validated by `v3/project-form.js`.

The authored option element is cloned for each result. JavaScript binds data;
it does not generate or replace the Webflow form structure.

## Script order

Load the existing shared scripts first, then the Starter adapter:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/opportunities-3.0.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/project-form.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/starter-project-form.js"></script>
```

Do not add the last loader until both V3 endpoints exist and pass backend tests.
After release, install it on the reusable V3 **Start a Project** component so
the existing Navbar action opens the same modal wherever that component renders.

## User states

- No eligible Brand: **You can start a project after a Brand messages you.**
- Successful submit: **Project request sent. The Brand must approve it before the contract is created.**
- Stale relationship: ask the Starter to refresh the available Brands and retry.

The success event is `starters:project-proposal-created`. The controller never
dispatches the canonical project-created event for a Starter proposal.
