# Starters Webflow CDN Scripts

This folder is the local checkout for:

```txt
https://github.com/the-starters/starters-webflow
```

Treat the GitHub repo under the `the-starters` org as the source of truth for these browser-facing Webflow CDN scripts.

## Before Editing

Always check GitHub first so local work does not overwrite code updated by someone else:

```sh
git fetch origin
git status --short --branch
git log --oneline --decorate -5
```

If `main` is behind `origin/main`, pull or rebase before editing. If local files are modified, inspect them before pulling:

```sh
git diff
git diff --stat
```

Do not discard local changes unless the user explicitly asks.

## Sync Safety

- Assume GitHub may have newer code than this local folder.
- Do not force-push.
- Do not overwrite remote changes with stale local files.
- If a push is rejected, fetch and review the remote changes before trying again.
- For Webflow footer work, prefer loading scripts from the GitHub/jsDelivr CDN at `@latest` with `defer`, so new tagged releases do not require a Webflow URL edit.

## Current Scripts

- `quiz-results.js`
- `quiz-results.min.js`
- `opportunities-3.0.js`
- `opportunities---create.js`
- `all-starters/apply-button-disable.js`
- `all-starters/range-backfill.js`

After browser-facing changes, scan for accidental private exposure before publishing or tagging:

```txt
api.airtable.com
hook.us1.make.com
Airtable PAT-style values such as pat...
```
