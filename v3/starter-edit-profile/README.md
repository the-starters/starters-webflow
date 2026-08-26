# Starter Edit Profile browser controllers

The native `/starter-edit-profile` form, fields, and success/error elements stay authored in Webflow. This directory owns the published-form contract and the page-specific portfolio and company controllers. It reuses the reviewed profile-photo and work-date assets from `v3/build-profile/`.

The remaining inline Starter Edit Profile bodies now also have GitHub-owned extraction candidates.
The authoritative ownership, provenance, atomic page-Head-Code cutover, loader-order, and verification
contract lives in [`../profile-form/README.md`](../profile-form/README.md). This repository change
does not install or publish those candidates.

## In-place loader replacements

Replace only an exact live inline body whose index and SHA-256 match the captured `page.scripts` records in `live-body-provenance.json`. The separate `candidateAssets` records identify the instrumented GitHub files. Keep each replacement in its existing Code Embed position.

| Live index | GitHub asset | Responsibility |
| --- | --- | --- |
| 84 | `v3/build-profile/profile-photo.js` | Authenticated profile-photo upload |
| 87 | `v3/starter-edit-profile/portfolio-crud.js` | Edit-profile portfolio create, edit, delete, media, and previews |
| 88 | `v3/starter-edit-profile/portfolio-list.js` | Edit-profile portfolio list read and render |
| 89 | `v3/starter-edit-profile/company-autocomplete.js` | Edit-profile company and logo autocomplete |
| 90 | `v3/starter-edit-profile/company-experience-crud.js` | Edit-profile company-experience CRUD |
| 91 | `v3/build-profile/work-dates.js` | Work-date validation and current-role state |

Work Highlight updates are approved and live immediately. After an update
succeeds, the portfolio controller replaces the shared generic message with
`Your changes were saved and are now live.`, then restores the shared modal copy
when it closes. Keep the pending and rejected status-badge rendering until the
legacy rows with those statuses have been backfilled.

### Work Highlight modal lifecycle

While the edit modal is visible, it retains the selected Work Highlight and its
existing image and video previews. A document-level `Escape` closes only the
remove and notification modals; it must not close or reset the editor because an
image picker can send the same key event. A `pageshow` closes the edit modal only
when the browser restored it without an active Work Highlight. Opening or filling
an editor cancels any delayed reset from an earlier close.

The Edit portfolio controllers are the only Work Highlights owners on
`/starter-edit-profile`. The Build portfolio controllers fail closed outside the
two exact Build routes, even if an obsolete nested Webflow component still loads
their files. This prevents duplicate immediate Build writes from bypassing the
Edit controller and racing its write. Structural Webflow cleanup must still
remove the obsolete nested Build component; the code gate is the runtime safety
boundary until that component repair is published.

`company-experience-crud.js` deliberately diverges from the live body it was captured
from: it carries the work-experience date fix, whose contract is shared with Build
Profile and owned by
[Company experience date hydration](../profile-form/README.md#company-experience-date-hydration).

Loader pattern:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/starter-edit-profile/portfolio-crud.js"></script>
```

Use the matching asset path for the other five replacements. Do not combine or reorder the loaders.

The sitewide `v3/native-form-diagnostics.js` loader must run before these
deferred mutation assets so their photo, portfolio, and company-experience
requests can emit receipts. The root [Current Scripts](../../README.md#current-scripts)
section owns that shared loader contract.

## Validation and submit ownership

After the approved whole-block cutover, `starter-edit-profile.js` is the only
validation owner for its main section-submit buttons. It owns steps 1, 2, 5, 6,
and 7 through an explicit published-markup contract. The Companies controller
owns step 3 and the Portfolio controller owns step 4. No second controller may
disable, intercept, or validate the same submit path.

The main form must not opt into sitewide `utils/wf-validate.js`. Its capture-phase
submit gate can run before the page controller. The live inline validator must be
removed only after the replacement CDN controller and published-form contract
tests pass. Until that whole-block cutover is approved and published, the inline
block remains a known second owner and the reliability fix is not live.

The native Webflow form, field names, success/error elements, hidden mirror
elements, and component markup stay authored in Webflow. Hidden mirrors are
logically required by the page controller and map failure focus to an authored
visible control. They must not prevent the controller click handler from recording
a console-only validation receipt. Only the page controller's request-loading
state may apply `pointer-events: none`, and only after validation succeeds.

The sanitized structural contract lives in `published-form-contract.json`.
`published-form-contract.js` normalizes official Webflow element-tree evidence
plus the authenticated published-page control inventory without retaining field
values, member data, text, component props, styles, URLs, tokens, or Webflow
element IDs. Contract drift must fail tests; do not silently refresh the fixture.

Account-settings tabs, membership panels, pause/cancel UI, scheduling persistence,
and paid/free-call business rules remain separate shared-component work. The page
controller validates the authored required state but does not take ownership of
those systems.

## Release verification

Implementation, automated, and live evidence for the in-flight reliability
workflow is tracked in [PROGRESS-CHECKLIST.md](PROGRESS-CHECKLIST.md).

1. Recapture the official element tree and authenticated published structural
   inventory, compare both with `published-form-contract.json`, and stop on
   unexplained drift.
2. Run the published-form contract, controller behavior, ownership, syntax, and
   browser-secret tests.
3. For the shared profile-photo asset, follow the server-idempotency and cutover
   gate in the [authoritative upload contract](../build-profile/README.md#profile-photo-upload-contract).
   Release the other approved assets through no-mistakes, semver, and jsDelivr
   purge.
4. Save exact complete-location backups and compare the validation block with the
   whole-block sentinel inventory.
5. Remove only the exact inline validation owner after the CDN candidate is served;
   read the complete saved location back before publish.
6. Publish staging only with approval. Test empty visible fields, empty mirrors,
   hydrated unchanged saves, full/consult branches, location transitions, reviewer
   tuples, and computed pointer behavior.
7. For the shared-foundation extraction, use only the atomic route page-Head-Code cutover in
   [`../profile-form/README.md`](../profile-form/README.md). Do not install one extracted loader at
   each former inline node. The six earlier provenance-locked controller replacements keep their
   existing positions and remain a separate scope.
8. Verify current network responses, console-only diagnostics, and no unexpected
   Xano writes. Obtain separate approval before production publish and repeat QA.
9. Scan every authorized published domain for Airtable, Make, and PAT exposure patterns.
