# v2 page footer code (manual paste — NOT jsDelivr)

Source-of-truth mirror of the **live, secure** V2 Webflow page footer code.

These are **paste-in `<script>` blocks** for Webflow **Page Settings → Custom Code → Footer Code**. They are **not** CDN scripts and must **not** be loaded via jsDelivr / `<script src>` — unlike `v2/contract.js` and the top-level bundles in this repo.

## What lives here

One file per page, matching the page slug:

| File | Page |
| --- | --- |
| `opportunities-apply-footer.html` | `/opportunities-apply` |
| `opportunities-applicants-footer.html` | `/opportunities-applicants` |
| `opportunities-freelancer-view-footer.html` | `/opportunities-freelancer-view` |
| `freelancer-edit-form-footer.html` | `/freelancer-edit-form` |
| `freelancer-start-project-footer.html` | `/freelancer-start-project` |
| `quiz-results-footer.html` | `/quiz-results` |

## Rules

- **Public repo — no secrets, ever.** These files are already browser-facing (served in each page's published source), so they contain only user/action data. Identity resolution + Airtable/Make calls happen server-side in the Xano bridge (`api:ZihCUE3Z`). Zero-tolerance scan before committing:
  ```sh
  grep -nE 'api\.airtable\.com|hook\.us1\.make\.com|pat[A-Za-z0-9]{14}' *.html
  ```
- **Never commit** `backups/` or `*-unsecure.html` files — the historical backups in the workspace intentionally preserve pre-remediation code with live secrets.
- Deploy is **manual paste** (Webflow custom-code API writes are blocked by token capability). See the `webflow-footer-deploy` skill in the workspace.

## Full working set + backups

The authoritative editing location (with dated backups) is the local workspace, outside this repo:

```
product-workflows/opportunities/webflow/v2/webflow-footer-code/secure/   # these files
product-workflows/opportunities/webflow/v2/webflow-footer-code/backups/  # dated + *-unsecure (NOT mirrored here)
```
