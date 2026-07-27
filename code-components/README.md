# Webflow code components

This package contains the parked V3 `Talent Applications Admin` React Code
Component as a preparation-only foundation. It is not production-ready, has not
been imported into Webflow or published on a Webflow page, and must not receive
a semver tag or jsDelivr deployment. Xano is the application and audit source of
truth. The component has no Airtable, Make, or Zapier integration and leaves the
existing Admin Ops, Marketing Ops, and V2 application workflows unchanged.

## Local verification

Use Node.js with the committed lockfile:

```sh
npm ci
npm test
npm run typecheck
npm run build
```

Run these commands from `code-components/`. The build script bundles the
component with the Webflow CLI; `dist/`, `node_modules/`, and local `.env` files
are intentionally ignored.

## Webflow component

`src/TalentApplicationsAdmin.webflow.tsx` registers **Talent Applications
Admin** in the **Admin** group for the site configured in `webflow.json`. The
Designer exposes:

| Property | Default | Purpose |
| --- | --- | --- |
| Title | `Talent applications` | Dashboard heading and accessible label |
| Login URL | `/login?next=/admin/talent-applications` | Destination offered when no Memberstack session exists |

The Webflow registration deliberately does not expose the component's
`environment` prop, so Designer instances use the `Staging` default. Do not add
a Live selector, import the library into Webflow, publish the component, create
a release tag, or deploy it through jsDelivr until the Xano contract, staff
authorization, and staging QA have passed a separate cutover review.

The page must load Memberstack so `window.$memberstackDom.getMemberCookie()` is
available. The component does not contain an admin secret: it exchanges the
current Memberstack token at
`/api:g1vmSLWh/auth/trade-token/v3`, then sends the returned Xano Bearer token to
the selected talent-admin API. A missing Memberstack session shows the configured
login link. A `401` from the admin API clears the cached Xano token, trades the
current Memberstack token again, and retries once. A final `401` or any `403` is
treated as an authentication failure. Memberstack account changes, logout, or a
token change during a request invalidate in-flight work, clear cached tokens and
private application state, and require a fresh authenticated load.

## Xano contract

The environment selects one of these API groups on
`https://x08a-5ko8-jj1r.n7c.xano.io`:

| Environment | API group |
| --- | --- |
| `Staging` | `/api:talent-admin-v3:staging` |
| `Live` | `/api:talent-admin-v3` |

Every endpoint below receives `Authorization: Bearer <Xano token>`.

| Method and path | Request | Response used by the component |
| --- | --- | --- |
| `GET admin/session` | None | Staff role (`reviewer` or `admin`) and optional display name |
| `POST admin/applications/list` | `status` or `null`, `page`, `per_page: 100` | Paginated applications and optional total |
| `POST admin/applications/detail` | `application_id` | Application plus audit events |
| `PATCH admin/applications/transition` | `application_id`, `expected_status`, `next_status`, notes, and interview URL | Updated application |

The list client loads all pages, deduplicates by numeric application ID, rejects
pagination that does not advance, and stops after 1,000 pages. Status filtering
is sent to Xano; name and email search is applied in the browser to the loaded
status result.

Xano remains responsible for authenticating the staff role, restricting private
records, validating transitions, checking `expected_status`, and appending audit
events. The component's buttons are only a user-interface guard.

## Review workflow

The queue supports `submitted`, `under_review`, `interview_sent`,
`interview_completed`, `approved`, `rejected`, `on_hold`, and `withdrawn`.
Available transitions are:

| Current status | Available next statuses |
| --- | --- |
| `submitted` | `under_review`, `on_hold`, `rejected` |
| `under_review` | `interview_sent`, `approved`, `on_hold`, `rejected` |
| `interview_sent` | `interview_completed`, `approved`, `on_hold`, `rejected` |
| `interview_completed` | `approved`, `on_hold`, `rejected` |
| `on_hold` | `under_review`, `interview_sent`, `approved`, `rejected` |
| `approved`, `rejected`, `withdrawn` | Final state; no transition controls |

Review notes and the interview URL are submitted with a status transition; there
is no independent save action. After a successful transition, the component
reloads both the selected application and the queue. If either readback fails,
it keeps the optimistic update visible and tells the reviewer to refresh before
continuing.

The detail view displays the applicant's contact details, submitted time,
timezone, availability, motivation, safe HTTP(S) portfolio and LinkedIn links,
review fields, and Xano audit history. The queue exposes filters for every listed
status except `withdrawn`; withdrawn applications remain available through
**All statuses**.
