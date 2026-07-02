# CLAUDE.md — Rules for this folder

This repo hosts **browser-facing Webflow CDN scripts** served via jsDelivr from
`github.com/the-starters/starters-webflow`. Treat the GitHub repo (org `the-starters`)
as the **source of truth**. Always read and follow [`README.md`](README.md) — the rules
below operationalize it. If this file and the README ever conflict, the README wins.

## 1. Before editing (sync safety — from README)

Always check GitHub first so local work never overwrites someone else's push:

```sh
git fetch origin
git status --short --branch
git log --oneline --decorate -5
```

- If `main` is behind `origin/main`, pull/rebase before editing.
- If local files are modified, inspect (`git diff`) before pulling.
- **Never** discard local changes unless the user explicitly asks.
- **Never** force-push. If a push is rejected, fetch and review remote changes first.

## 2. Script file format (do not repeat past mistakes)

These files are loaded over the CDN and dropped straight into a Webflow `<script src>`,
so they **must be raw JavaScript**:

- Extension is **`.js`**, never `.html`.
- **No** `<script>` / `</script>` wrapper tags inside the file.
- Prefer an IIFE with an init guard (see existing scripts in `all-starters/`).

## 3. Never commit

- `.DS_Store` and other local/OS artifacts (already covered by `.gitignore`).
- Stage files explicitly; do not `git add -A` / `git add .` blindly.

## 4. Do not push to `main` directly — use a PR

Direct pushes to `main` are gated. To land a change:

```sh
git checkout -b <type>/<short-desc>      # e.g. chore/…, fix/…, feat/…
git add <specific files>
git commit -m "…"
git push -u origin <branch>
gh pr create --base main --head <branch> --title "…" --body "…"
```

Merge via GitHub (the user/reviewer decides). `gh` lives at `~/.local/bin/gh`.

## 5. Making a change live on jsDelivr (REQUIRED to "make jsDelivr work")

jsDelivr's `gh` endpoint resolves `@latest` to the **latest git TAG**, *not* the latest
commit on `main`. A merged PR alone will **not** update `@latest`. After the PR merges:

```sh
git checkout main && git fetch origin && git merge --ff-only origin/main

# Secret scan before tagging (see §6)

# Bump the patch from the newest existing tag, e.g. v1.3.19 -> v1.3.20
git tag -a vX.Y.Z -m "Release vX.Y.Z: <what changed>"
git push origin vX.Y.Z
```

Then **verify** both URLs return HTTP 200 (new tags can take a moment to propagate):

```sh
curl -fsS -o /dev/null -w '%{http_code}\n' \
  "https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/<path>"
curl -fsS -o /dev/null -w '%{http_code}\n' \
  "https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@vX.Y.Z/<path>"
```

- Consumers load with `defer`. `@latest` is convenient but moves; `@vX.Y.Z` is immutable
  and better for production stability.
- To bust a stale cache: `https://purge.jsdelivr.net/gh/the-starters/starters-webflow@…`

## 6. Before publishing/tagging — scan for accidental secret exposure

These are browser-facing, so grep the diff for private values before tagging:

```txt
api.airtable.com
hook.us1.make.com
Airtable PAT-style values such as pat...
```

## 7. Keep the README current

When adding or renaming a script, update the **Current Scripts** list in `README.md`.
