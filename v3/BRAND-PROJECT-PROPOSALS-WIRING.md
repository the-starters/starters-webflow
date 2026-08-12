# V3 Brand project-proposal approval wiring

`v3/brand-project-proposals.js` adds Starter project requests to the existing
Brand Dashboard **Action Items** panel. It reads only Brand-scoped pending
proposals, opens a read-only review modal, and sends an authenticated accept or
reject command. A proposal is not a canonical project until Xano accepts it.

## Backend contract required before Webflow wiring

The existing Brand projects projection must add `project_proposals` beside its
canonical project items. Each visible row must have:

- a positive `proposal_id` and `lifecycle_version`;
- `status=awaiting_brand_approval`;
- server-computed `can_accept` and `can_reject` booleans;
- the Starter display fields and submitted project terms needed by the card and
  review modal.

`POST projects/proposal-action/v3` accepts only:

```json
{
  "proposal_id": 41,
  "expected_version": 3,
  "action": "accept",
  "idempotency_key": "project-proposal-ui:..."
}
```

Xano must authenticate the paid Brand, verify proposal ownership and current
state, enforce the advertised capability, and process the command
idempotently. Accept must call the shared canonical project-creation command.
Reject must not create a project or downstream work.

## Action Items template

Author one hidden row inside the existing Action Items list:

```html
<div data-project-proposal-template hidden>
  <span data-project-proposal-field="status_label"></span>
  <span data-project-proposal-field="starter_name"></span>
  <span data-project-proposal-field="title"></span>
  <span data-project-proposal-field="commercial_summary"></span>
  <button type="button" data-project-proposal-open>Review request</button>
</div>
```

The script clones this authored row and adds `data-action-element="item"`, so
`dashboard-action-items.js` owns the shared count and empty state. The proposal
script must not add a second Action Items section or place a pending proposal in
the canonical Projects list.

## Review modal

Author one native dialog with
`data-modal-target="review-project-request"`. Add read-only text elements using
`data-project-proposal-field` for the same field names as the card plus:

- `service`, `project_scope`, and `engagement_type`;
- `contract_type`, `invoice_frequency`, and dates;
- Starter profile and message links using
  `data-project-proposal-link="profile|message"`.

Use these action attributes on native buttons or links:

- `data-project-proposal-action="accept"`;
- `data-project-proposal-action="reject"`;
- `data-project-proposal-action="reject-confirm"`;
- `data-project-proposal-action="reject-cancel"`;
- `data-project-proposal-action="message"`.

Add modal feedback with `data-project-proposal-feedback`, a reject confirmation
wrapper with `data-project-proposal-confirm="reject"`, and one persistent Action
Items status node with `data-project-proposal-global-feedback`. The last node
keeps the success message visible if canonical readback removes the request and
closes the modal.

The modal is read-only. Approval accepts the submitted terms as one unit. The
Brand can decline and message the Starter if the terms need changes.

## Script order and release gate

Load the existing project projection and Action Items controller before this
adapter:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/opportunities-3.0.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/dashboard-action-items.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/brand-project-proposals.js"></script>
```

Do not install the last loader until the Brand projection and action endpoint
exist and pass backend tests. Verify paid-Brand role gating, exact proposal
ownership, 403/409 behavior, duplicate-action locking, canonical readback, and
the accepted project in `core_projects_v3` before release.
