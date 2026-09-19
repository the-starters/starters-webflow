# V3 Brand project-proposal approval wiring

`v3/brand-project-proposals.js` owns the Brand half of the Starter project
request lifecycle on `/brand-dashboard`. A Starter submission through
[STARTER-PROJECT-FORM-WIRING.md](STARTER-PROJECT-FORM-WIRING.md) creates a
proposal row only. Nothing becomes a canonical project, a lifecycle event, or a
PandaDoc invitation until a Brand approves the request here, so this controller
must be installed alongside the Starter form — not after it.

## Scope

- List each pending request as an Action Items row on `/brand-dashboard`.
- Open a read-only review dialog for one request. The Brand can never edit
  Starter-authored commercial terms from this surface.
- Submit a versioned **Approve & Create Project** or **Decline Request**
  decision. Acceptance creates the canonical project and, for a Standard
  Contract, the single PandaDoc invitation owned by the existing project outbox.
  This path never enqueues a second invitation.
- A proposal is never treated as a canonical project before acceptance.

## Backend contract

`POST brand/project-proposals/mine/v3` authenticates the Brand and returns that
Brand's own pending requests. The body is `{ "page": 1, "per_page": 12 }`:

```json
{
  "project_proposals": [
    {
      "proposal_id": 72,
      "lifecycle_version": 3,
      "status": "awaiting_brand_approval",
      "can_accept": true,
      "can_reject": true,
      "starter_name": "Alex Starter",
      "title": "Retention program",
      "service": "Lifecycle Strategy",
      "engagement_type": "monthly",
      "monthly_rate": 2500,
      "number_of_months": 3,
      "contract_type": "standard_contract",
      "invoice_frequency": "monthly",
      "project_scope": "Build and launch the retention program.",
      "start_date": "2026-08-20",
      "created_at": "2026-08-12T00:00:00Z"
    }
  ]
}
```

The array may also arrive as `data.project_proposals`. The controller drops any
row missing a positive `proposal_id`, missing a positive `lifecycle_version`, or
whose `status` is not `awaiting_brand_approval`, and it drops a row the server
marks neither acceptable nor rejectable. `can_accept` and `can_reject` are the
only authority for the dialog's controls; the browser never infers them.

The controller requests 12 rows per page and follows `nextPage` alone until the
server stops returning one, so a request after the first 12 remains reachable.
`nextPage` is the only continuation signal; `itemsTotal` is never used to keep
paging. A page that does not advance is rejected, a malformed page is rejected,
and the loop stops after 100 pages, so the browser can never loop unbounded.

`POST projects/proposal-action/v3` takes
`{ proposal_id, expected_version, action, idempotency_key }` where `action` is
`accept` or `reject`. It must reject a stale `expected_version` with 409 and be
idempotent on `idempotency_key`. On accept it returns the created project:

```json
{ "proposal": { "id": 72, "status": "accepted", "lifecycle_version": 4 }, "project": { "id": 669 }, "replayed": false }
```

A decline returns the settled proposal and no project:

```json
{ "proposal": { "id": 72, "status": "rejected", "lifecycle_version": 4 }, "replayed": false }
```

`project` may be absent, `null`, or an empty object on a decline. Any of those
is accepted. A decline that carries a positive project ID is rejected as
malformed, because a decline must never create a project.

The browser reports success only when the returned proposal ID matches the
request, the lifecycle version advanced, the terminal status matches the
action, acceptance includes a positive project ID, and a decline carries no
project ID. A fulfilled malformed response stays in retry state and reuses the
same idempotency key.

Both routes are authenticated `api:opp30` routes reached through the
`Opp30.API` bridge in `opportunities-3.0.js`. The controller calls no other
route and never reads Memberstack as authority.

## Designer contract

Webflow owns the Action Items row template. JavaScript binds row data and
behavior; it does not generate the dashboard markup.

| Attribute | Purpose |
| --- | --- |
| `data-project-proposal-template` | The authored pending-request row template. Its parent element is the list. Required — with no template the controller does not mount |
| `data-project-proposal-field="<name>"` | A text slot inside the row or the dialog |
| `data-project-proposal-open` | The control that opens the review dialog. Added to the row's first link or button when absent |
| `data-project-proposal-global-feedback` | Page-level status region. Created above the list when absent, so decision feedback survives the dialog closing |
| `data-modal-target="review-project-request"` | The authored review dialog. When absent the controller builds a read-only fallback dialog |
| `data-project-proposal-feedback` | Status region inside the dialog |
| `data-project-proposal-action="accept\|reject\|reject-confirm\|reject-cancel\|close\|message"` | Dialog controls. `message` keeps its authored href |
| `data-project-proposal-confirm="reject"` | The decline confirmation step, hidden until Decline is pressed |

Supported field names: `status_label`, `starter_name`, `title`, `service`,
`commercial_summary`, `submitted_at`, `start_date`, `estimated_end_date`,
`scope_preview`, `project_scope`, `engagement_type`, `contract_type`, and
`invoice_frequency`. Rendered rows also receive `data-project-proposal-id` and
`data-action-element="item"`, so the shared
[dashboard Action Items](../../v3/README.md#dashboard-action-items-panel) panel counts
them.

## Script order

Install on `/brand-dashboard` Page Settings -> Custom Code -> Footer, after
`opportunities-3.0.js`, which owns the authenticated `Opp30.API` bridge:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/opportunities-3.0.js"></script>
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/brand-project-proposals.js"></script>
```

Install this loader in the same release as the Starter loader in
[STARTER-PROJECT-FORM-WIRING.md](STARTER-PROJECT-FORM-WIRING.md#script-order).
Shipping the Starter half alone leaves every new request unactionable, because
no other surface can accept or decline one.

## Refresh and user states

The list loads on mount, reloads after every settled decision, reloads after a
403 or 409, and resets on `opp30:member-scope-reset`. A successful acceptance
also reloads the shared `dash-brand-projects` WfXano projection when that
runtime is present, so the new project appears in the dashboard project list
without a reload. Without that runtime the decision still succeeds; only the
project list waits for the next `pageshow`, `focus`, or visibility refresh.

- Approved: **Project approved and created.**
- Declined: **Project request declined.**
- Approved but the reload failed: **Project approved. Refresh the dashboard to load the project.**
- Stale or already handled (403/409): **This project request changed or was already handled.**
- Reopening a request already resolved in this session: **This project request was already handled. Refresh the dashboard to update the list.**
- No decision route on the page: **Project request actions are not available. Reload and try again.**
- The pending-request list failed to load (malformed envelope, failed page, or page cap): the list renders empty and the page-level feedback region reads **Your pending project requests could not be loaded. Refresh the dashboard to try again.** An empty list is never shown silently for a failed load.

Raw server text is never shown. Decision events
`starters:project-proposal-accepted` and `starters:project-proposal-rejected`
carry only `proposal_id`, `project_id`, and replay state.

## Release evidence

Frontend unit tests and mocked route tests do not prove canonical Xano writes or
PandaDoc outbox behavior. Before installing the loader, run a separately
approved, bounded backend canary and read back the canonical records. The
evidence must show exactly one project and one `project.created` event per
acceptance, exactly one PandaDoc outbox job for a Standard Contract acceptance,
no PandaDoc outbox job for an Own Contract acceptance or for any decline, and no
additional rows for a replayed idempotency key. Validation is staging-only and
must use PandaDoc DEV routing; this release does not authorize a production
project, PandaDoc document, signature, or email canary.

Rollback is removing this loader and the Starter loader together, which returns
`/brand-dashboard` and `/starter-dashboard` to their authored Designer state and
stops new proposal rows from being created.

Run the focused tests with:

```sh
node --test v3/brand-project-proposals.test.js
```
