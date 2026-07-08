# Slater code mirror

GitHub-managed copies of the **Slater.app-hosted** JavaScript served across the site. We do **not** have Slater account access, so these are captured from the served builds, not exported from the editor. Two builds per project:

- `<id>.readable.js` — from `slater.app/<id>/<file>.js` (staging/editor build; **unminified/readable** — use for review/dieffs).
- `<id>.prod.min.js` — from `assets.slater.app/slater/<id>/<file>.js` (production build; **minified; the exact bytes live in prod**).

The readable and prod builds carry different `?v=` cache-busters (staging is usually ahead of prod) but are the same logic.

## Inventory (crawl of 42 pages, 2026-07-08)

| Slater project | File | Live on page | Title | What it is | Loaded live from |
| --- | --- | --- | --- | --- | --- |
| `4885` | `8804.js` | `/contract` (public) | `the-starters-contract.js` | Contract-form UI: field show/hide, progress steps, review/edit, validation. Funcs: hideAllElements, formProgressBasicInfo, reviewForm, editForm, validateForm. | Slater loader in the page's custom code |
| `4960` | `9022.js` | `/freelancer-start-project` (app) | `Contract.js` | Contract-form UI (superset of 4885 — adds showConditionDropdownWeeks/Months, showConditionals, feeStructureTypeChange). | Slater loader in the page footer |

Neither is loaded from this repo — both pages still load from Slater's CDN. This folder is a **version-controlled mirror for management/backup/review**, not a deploy path.

- `4960` is also mirrored (page-scoped) at `../v2/footers/freelancer-start-project-contract.js`, and a stale/partial earlier migration sits at `../v2/contract.js`. Leave both as-is.
- No secrets, no Xano/Airtable/Make calls in either — pure DOM/form logic (scanned clean).

## How Slater loads on a page

A per-page loader (in Webflow custom code) picks staging vs prod by host and dynamic-`import()`s the bundle:

```
window.location.host.includes('webflow.io')
  ? 'https://slater.app/<id>.js'                          // → import slater.app/<id>/<file>.js
  : 'https://slater-app.s3.amazonaws.com/slater/<id>.js'  // → import assets.slater.app/slater/<id>/<file>.js
```

## Refresh these mirrors

```sh
for id in 4885 4960; do
  s=$(curl -s "https://slater.app/$id.js" | grep -oE "https://slater\.app/$id/[0-9]+\.js\?v=[0-9]+" | head -1)
  p=$(curl -s "https://slater-app.s3.amazonaws.com/slater/$id.js" | grep -oE "https://assets\.slater\.app/slater/$id/[0-9]+\.js\?v=[0-9]+" | head -1)
  curl -s "$s" -o "slater/$id.readable.js"
  curl -s "$p" -o "slater/$id.prod.min.js"
done
```

⚠️ Source of truth is still the **Slater editor** (we lack access). If someone edits a project in Slater, these mirrors go stale until re-pulled. To fully own the code, take a project off Slater: serve the readable build from jsDelivr, repoint the page's loader, and staging-test first.
