# V3 Brand project-proposal approval wiring

`v3/brand-project-proposals.js` owns the Brand half of the Starter project
request lifecycle on `/brand-dashboard`. A Starter submission through
[STARTER-PROJECT-FORM-WIRING.md](STARTER-PROJECT-FORM-WIRING.md) creates a
proposal row only. Nothing becomes a canonical project, a lifecycle event, or a
PandaDoc invitation until a Brand approves the request here, so this controller
must be installed alongside the Starter form — not after it.

## Scope

- List each pending request on `/brand-dashboard` in a proposal-owned request
  list, outside the shared Action Items wrapper so that panel's zero-item
  collapse can never hide a pending request. See the Designer contract below.
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
  ],
  "nextPage": null
}
```

`project_proposals` is the only accepted envelope; a response without that
top-level array is a load failure, not an empty list. Every page must also
carry `nextPage` explicitly — the next page number when more pending requests
remain, `null` on the last page. It is a required field, not an optional one:
a page that omits the key entirely is rejected as malformed rather than
treated as the end of the list, so a truncated list can never be painted as a
complete one. The controller drops any
row missing a positive `proposal_id`, missing a positive `lifecycle_version`, or
whose `status` is not `awaiting_brand_approval`, and it drops a row the server
marks neither acceptable nor rejectable. `can_accept` and `can_reject` are the
only authority for the dialog's controls; the browser never infers them.

The controller requests 12 rows per page and follows `nextPage` until the server
returns `null`, so a request after the first 12 remains reachable. `nextPage` is
the only continuation signal; `itemsTotal` is never used to keep paging, which
is why `nextPage` must be present on every page. A page missing that key, a page
that does not advance, and a malformed page are all rejected, and the loop stops
after 100 pages, so the browser can never loop unbounded. Every one of those
rejections surfaces the load-failure state below rather than a short list.

`POST projects/proposal-action/v3` takes
`{ proposal_id, expected_version, action, idempotency_key }` where `action` is
`accept` or `reject`. It must reject a stale `expected_version` with 409 and be
idempotent on `idempotency_key`. On accept it returns the created project:

```json
{ "proposal": { "id": 72, "status": "accepted", "lifecycle_version": 4 }, "project": { "id": 669 }, "replayed": false }
```

The browser reads the decision's proposal identity from `id` and
`lifecycle_version`, and the created project's identity from `project.id`, only;
no alternate spelling is accepted for either.

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

Webflow owns the proposal row template and its list host. JavaScript binds row
data and behavior; it does not rewrite markup any other controller owns.

These attributes are proposal-only. In particular this controller never reads
`data-project-proposal-template`, which `v3/dashboard-action-items.js` already
owns as the Brand "post your first opportunity" onboarding row and hides once
the Brand has an opportunity.

| Attribute | Purpose |
| --- | --- |
| `data-project-request-template` | The authored pending-request row template. Its parent element is the list |
| `data-project-request-list` | The list host. Used only when no `data-project-request-template` is authored: the controller appends its own hidden row template here |
| `data-project-proposal-field="<name>"` | A text slot inside the row or the dialog |
| `data-project-proposal-open` | The control that opens the review dialog. Added to the row's first link or button when absent |
| `data-project-proposal-global-feedback` | Page-level status region. It must sit outside the Action Items `data-action-element="wrapper"`, which the shared panel hides entirely once it settles with zero rows. When absent the controller creates it immediately before that wrapper (before the list when no wrapper is authored), so decision feedback and load failures survive both the dialog closing and an empty list |
| `data-modal-target="review-project-request"` | The authored review dialog. When absent the controller builds a read-only fallback dialog |
| `data-project-proposal-feedback` | Status region inside the dialog |
| `data-project-proposal-action="accept\|reject\|reject-confirm\|reject-cancel\|close\|message"` | Dialog controls. `message` keeps its authored href |
| `data-project-proposal-confirm="reject"` | The decline confirmation step, hidden until Decline is pressed |

Supported field names: `status_label`, `starter_name`, `title`, `service`,
`commercial_summary`, `submitted_at`, `start_date`, `estimated_end_date`,
`scope_preview`, `project_scope`, `engagement_type`, `contract_type`, and
`invoice_frequency`. Rendered rows always receive `data-project-proposal-id`.
They receive `data-action-element="item"` only when the list host sits inside an
Action Items `data-action-element="wrapper"`, so the shared
[dashboard Action Items](../../v3/README.md#dashboard-action-items-panel) panel counts
them exactly when the Designer put them in that panel. Rows in a
proposal-owned list outside that wrapper carry no Action Items marker and never
change that panel's count, including on a page whose panel falls back to
document scope.

With neither attribute authored the controller creates its own labelled
`<section data-project-request-list aria-labelledby="project-request-list-heading">`
holding an `<h2>Project requests</h2>` and a generated hidden row template. That
section is inserted immediately before the Action Items
`data-action-element="wrapper"` when one exists, and appended to `<body>`
otherwise. It is never placed inside that wrapper, so the panel's zero-item
collapse cannot hide pending requests. Generated markup carries
`data-project-proposal-generated="true"`.

The generated section is created hidden and is shown only while it holds at
least one pending request, so a Brand with nothing to review never sees an
empty "Project requests" box. It is hidden again whenever a render leaves zero
rows, including after the last pending request is approved or declined, after a
failed load, and on `opp30:member-scope-reset`, so a member switch never leaves
an empty section on screen while the next member's list loads. The page-level feedback region sits outside the section, so
the load-failure message stays visible while the section is hidden. An authored
`data-project-request-list` keeps whatever empty state Webflow gives it; the
controller only toggles the section it generated itself.

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
also asks the project list's owner to reload through
`Opp30.refreshProjectWorkflow('brand', true)`, so the new project appears in the
dashboard project list without a page reload and the Brand's already-loaded
project page range is replayed rather than collapsed back to page 1. This
controller never touches the `dash-brand-projects` wf-xano instance directly.
Without that bridge method the decision still succeeds; only the project list
waits for the next `pageshow`, `focus`, or visibility refresh. The proposal list
reloads independently and first: an acceptance starts the project-list reload
without waiting for it, reloads the proposal list, and only then joins the
project-list result, so a slow or failed project-list reload never leaves an
accepted request rendered as a pending row. The decision lock is released as
soon as the proposal list has reloaded, before that join, so a stalled
project-list reload can never leave the Brand's other pending requests
disabled. Only the most recently settled decision may write reload-failure copy
to the page-level region, so a late project-list result from an earlier decision
cannot overwrite the status of a newer one. A proposal-list response that was requested
before an `opp30:member-scope-reset` is discarded when it settles after one, so
the previous member's requests can never paint into the new member's dashboard
and a stale failure can never overwrite a fresh load. The same guard covers the
post-decision path: once a reset has happened, a settled decision neither
reloads the lists nor announces its reload-failure copy into the new scope.

- Approved: **Project approved and created.**
- Declined: **Project request declined.**
- Approved but the reload failed: **Project approved. Refresh the dashboard to load the project.**
- Approved or declined but the reload failed, declined case: **Project request declined. Refresh the dashboard to update the list.**
- No longer the Brand's request (403): **This project request is no longer available to your Brand account.**
- Changed or already handled (409): **This request changed or was already handled. Refresh the request before continuing.**
- Reopening a request already resolved in this session: **This project request was already handled. Refresh the dashboard to update the list.**
- No decision route on the page: **Project request actions are not available. Reload and try again.**
- No pending requests: the generated request section is hidden and no message is shown.
- The pending-request list failed to load (malformed envelope, a page missing `nextPage`, a non-advancing page, a failed page, the page cap, or a bridge without `brandProjectProposalList`): the list renders empty and the page-level feedback region reads **Your pending project requests could not be loaded. Refresh the dashboard to try again.** An empty list is never shown silently for a failed load, including when a stale cached `opportunities-3.0.js` is served without the proposal-list route.

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
