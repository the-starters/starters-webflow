# V3 Brand project form wiring

`v3/project-form.js` connects the Webflow-authored **Generate Contract** form to
Xano `POST projects/create/v3` through the existing `window.Opp30` authenticated
Memberstack-to-Xano bridge.

The backend endpoint is Brand-only. Do not attach this controller to the
Starter **Start a Project** component until a separately reviewed Starter
authorization/product flow exists.

## Native Webflow contract

Keep all form HTML in Designer. The controller does not create inputs, buttons,
success UI, or error UI.

Add `data-project-form-v3="brand"` to the native `<form>`. Add one authored
control for every field below using `data-project-field="<name>"`:

| Field | Authored control | Notes |
| --- | --- | --- |
| `opportunity_id` | hidden input | populated from the selected applicant trigger |
| `application_id` | hidden input | populated from `data-wf-xano-id` or an explicit trigger attribute |
| `idempotency_key` | hidden input | populated immediately before the first submission and reused on retry |
| `title` | text input | required |
| `service` | select/input | required |
| `engagement_type` | select/radio | accepted values: `Flat Fee`, `Weekly Recurring`, `Monthly Recurring`, `My own contract` |
| `total_cost` | numeric/text input | required for Flat Fee |
| `paid_upfront_pct` | numeric/text input | optional, 0–100 |
| `weekly_rate` | numeric/text input | required for Weekly Recurring |
| `monthly_rate` | numeric/text input | required for Monthly Recurring |
| `start_date` | date/text input | `YYYY-MM-DD` or `MM/DD/YYYY` |
| `estimated_end_date` | date/text input | optional |
| `number_of_weeks` | select/input | optional for ongoing Weekly |
| `number_of_months` | select/input | optional for ongoing Monthly |
| `project_scope` | textarea | required |

Add `data-project-contract-choice` to the authored Standard Contract / My Own
Contract radio inputs. When My Own Contract is checked, the adapter selects the
server-side `own_contract` engagement/template while retaining the entered
commercial terms.

The controller ignores unmarked Hiring Manager, Company, and Email fields.
Xano derives those values from the authenticated Brand and must remain the
authority. It also derives `pandadoc_template_key` from the validated
engagement type, preventing a price model from being paired with the wrong
server-side template.

Hourly and Ongoing Hourly options fail closed. Endpoint #1678 currently stores
hourly fields but its `engagement_type` enum accepts only `flat_fee`, `weekly`,
`monthly`, and `own_contract`.

## Applicant trigger

Add `data-project-form-open` to the Brand action that opens the Generate
Contract modal. Put the action inside the wf-xano applicant card so the adapter
can read the application ID from `data-wf-xano-id`.

Supply the opportunity ID through either:

- `data-project-opportunity-id="<id>"` on the trigger/card; or
- the existing CMS-bound `[data-opp-page-id]` element on an opportunity detail
  page; or
- `data-opp30-opportunity-id="<id>"` on `<html>`.

If the form is not the first Brand project form on the page, add
`data-project-form-target="#authored-form-id"` to the trigger.

## Authored states

- Add `[data-project-form-state="error"]` inside the form. It receives a safe
  message and `role="alert"`.
- The form receives `data-project-form-status="ready|submitting|success|error"`
  and `aria-busy`.
- Native submit buttons and `[data-project-submit]` are disabled while pending.
- The authored `[data-project-form-state="success"]` is revealed after Xano accepts the
  project while the native form is hidden. Reopening from another applicant
  restores the form and hides the prior success state.
- Success dispatches `starters:project-created` with only `project_id` and
  `replayed`.

## Loader

Load after `opportunities-3.0.js`:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/project-form.js"></script>
```

## Release verification

1. Confirm the page contains one native Brand project form and all required
   authored fields.
2. Confirm the selected applicant supplies exact `opportunity_id` and
   `application_id` before review.
3. Exercise invalid required fields and an unsupported Hourly option; neither
   may issue a request.
4. With an approved Test Data canary, submit once and verify exactly one
   `projects/create/v3` request with Bearer auth and no Airtable/Make/browser
   secrets.
5. Read the created project back from Xano and verify the selected stable IDs,
   `sync_origin=v3`, lifecycle event, and one PandaDoc outbox item.
6. Retry the exact request and verify `replayed=true` with no duplicate project,
   event, document, or outbox row.
