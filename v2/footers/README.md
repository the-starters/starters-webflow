# v2 page footer code

Source-of-truth for the **live, secure** V2 Webflow page footer logic. Two artifacts per page:

- **`<page>.js`** — CDN-loadable via jsDelivr with a single `<script defer>` tag (preferred).
- **`<page>-footer.html`** — the original inline paste-in `<script>` block, kept as reference / fallback.

The `.js` is extracted verbatim from the `.html` (multi-block pages are concatenated in original order — they already shared one classic-script scope, so behaviour is identical). **Edit the `.html` source, then re-extract the `.js`** so the two never drift, or pick the `.js` as sole source once a page is fully migrated to CDN.

## CDN script tags (place in Webflow Page Settings -> Head Code, replacing the inline block)

| Page | Tag |
| --- | --- |
| `/opportunities-apply` | `<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v2/footers/opportunities-apply.js"></script>` |
| `/opportunities-applicants` | `<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v2/footers/opportunities-applicants.js"></script>` |
| `/opportunities-freelancer-view` | `<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v2/footers/opportunities-freelancer-view.js"></script>` |
| `/freelancer-edit-form` | `<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v2/footers/freelancer-edit-form.js"></script>` |
| `/freelancer-start-project` | `<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v2/footers/freelancer-start-project.js"></script>` |
| `/quiz-results` | `<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v2/footers/quiz-results.js"></script>` |

`@latest` resolves to the highest **semver tag** — these files ship only after this branch is merged **and** a new tag is cut (see the `webflow-cdn-release` skill: tag + jsDelivr purge). For staging you can point at `@main` (post-merge) or `@<branch>` before then.

External libraries (Memberstack, Quill, Algolia, etc.) are **not** in these files — they load elsewhere (site head / on-canvas embeds) and must stay there. `defer` is safe: these scripts already gate on `DOMContentLoaded` / `getCurrentMember()`.

### `/freelancer-start-project` — extra Slater tag

This page still has a documented legacy exception: the deferred CDN tag above **plus** a separate inline Slater loader (`freelancer-start-project-slater.html`). The Slater loader pulls `assets.slater.app/slater/4960/9022.js` (~15KB of contract-form field logic edited in the Slater.app project 4960, not in this repo). It is deliberately **not** bundled into `freelancer-start-project.js`. Keep their relative load order intact during migration: CDN tag first, Slater tag second.

**`freelancer-start-project-contract.js`** is a GitHub-managed, readable mirror of that Slater contract logic (captured verbatim from the Slater build for version control / review). It is **not loaded live** — the page still loads the Slater copy via the loader above, so behavior is unchanged. To eventually take the code off Slater: serve this file from jsDelivr, swap the Slater loader for a `<script defer src=…freelancer-start-project-contract.js>` tag, and **staging-test first** (the mirror is Slater build `v=815454`; prod runs `v=339605` — same functions, different build). A related-but-stale earlier migration also exists at repo root as `v2/contract.js`; leave it untouched.

### `/freelancer-start-project` — Brand selection

Select a Brand from the eligible list before choosing Review Details or submitting.
Typing a name alone is insufficient: the selected Brand must have a stable ID in
`#brand-contract`, and the trimmed search text must match `#brand-name`. Editing
the search text away from the selected name clears `#brand-contract` and
`#brand-name-contract`; select an option again to restore the selection.

The footer registers the Review and submit guards at DOM initialization, before
waiting for Memberstack. An invalid selection blocks the action and displays
“Select a Brand from the list before starting the project.” If Review has already
disabled the fields, the guard invokes Edit, enables and focuses the Brand search,
and displays the same message. Valid selections continue through native Webflow
submission. Keep this guard aligned in the inline fallback and CDN artifact.

Regression coverage lives in `freelancer-start-project.test.js` and
`freelancer-start-project.browser.cjs`. Run the browser check explicitly with
`node --test v2/footers/freelancer-start-project.browser.cjs` using Playwright and
an installed Chrome; like the other `.browser.cjs` checks, it is separate from
the dependency-free Node CI suite. The browser fixture uses the contract
script mirror and sanitized form markup with minimal CSS; it intercepts submission
and does not prove production Webflow delivery.

## Rules

- **Public repo — no secrets, ever.** Content is already browser-facing (served in each page's published source). Identity resolution + Airtable/Make calls happen server-side in the Xano bridge (`api:ZihCUE3Z`). Zero-tolerance scan before committing:
  ```sh
  grep -nE 'api\.airtable\.com|hook\.us1\.make\.com|pat[A-Za-z0-9]{14}' *.js *.html
  ```
- **Never commit** `backups/` or `*-unsecure.html` — the workspace backups intentionally preserve pre-remediation code with live secrets.
- Full working set + dated backups live in the workspace (outside this repo):
  `product-workflows/opportunities/webflow/v2/webflow-footer-code/`
