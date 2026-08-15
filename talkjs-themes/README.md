# TalkJS chat themes

The chat UI renders inside TalkJS's own iframe, so no Webflow page style and no
CDN script in this repo can reach it. Its look lives in TalkJS-hosted **themes**,
and this folder is the source of truth for the two the site uses:

| Folder | Theme name on TalkJS | Where it renders |
| --- | --- | --- |
| `the-starters-3-0/` | `the-starters-3-0` | the `/messages` inbox (`v3/messages.js`) |
| `the-starters-3-0-profile/` | `the-starters-3-0-profile` | the message modal on `/hire/<slug>` (`v3/messages-profile.js`) |

Nothing in here is served over the CDN. These files exist so the chat's look is
reviewable, diffable, and rollback-able. The decision and its consequences are
recorded in **ADR 0004, "TalkJS chat themes are managed as code via the REST
API"** — it lives in the `starters-git` workspace at
`docs/adr/0004-talkjs-themes-as-code-via-rest.md`, one level above this checkout,
so it is deliberately not a link here.

## Folder format

Each folder is one theme, exported from `GET /v1/{appId}/themes`:

- **`<Component>.template`** — one file per entry in the theme's `files` map,
  named exactly as TalkJS names it. A `.template` file is the component's markup
  plus its `<style>` block; `layout.json` is the theme's global layout settings.
- **`theme.json`** — everything in the theme object that is *not* a file.
  Currently just `{"base": "default_v7"}`, the TalkJS base theme these extend.
- **`README.md`** — this file. The export/import tooling skips it and
  `theme.json`; every other file in the folder is sent as a theme file.
- **`tools/`** — the pipeline scripts (see "Tooling"). Skipped like the two
  above, and not a theme folder.

Two things are deliberately *not* sent, because the loader reads the working
tree rather than git:

- **Dotfiles.** One Finder visit leaves a `.DS_Store` behind, and without the
  filter it becomes a theme file — shipping binary junk or 400ing the PUT.
  `.gitignore` cannot help here; nothing in this path consults it.
- **Untracked files.** Only committed content is promotable. `put-clones.mjs`
  and `promote-to-real.mjs` refuse to run when a theme folder holds a file git
  does not know about, and name it. `--allow-untracked` overrides, on purpose
  awkwardly.

The format is lossless: rebuilding the payload from these files reproduces the
API's response byte-for-byte (`roundtrip-check.mjs`, below).

## Rules

1. **Do not edit these themes in the TalkJS dashboard.** The dashboard's copy is
   overwritten by the next PUT, silently and without a diff. Dashboard editing of
   these two themes is retired; change the files here instead.
2. **The committed export is the durable rollback.** A PUT replaces the whole
   theme (verified — see "PUT semantics") and TalkJS keeps no history, so
   "undo" means re-pushing content you still hold. There are two layers: a
   snapshot file, which is faster and captures themes this folder does not
   track, and this folder, which survives a lost laptop. Neither is optional —
   the snapshots live in `.scratch/`, outside git, and a recovery plan that
   depends on one machine's untracked directory is not a plan.
3. **The API bypasses the dashboard's Test → Publish safeguard.** A PUT lands on
   live instantly. Every change therefore goes to a **clone theme** first
   (`…-qa`), passes the visual gate, and only then to the real names.
4. **The TalkJS secret key never enters this repo.** It lives only in
   `staging-qa/.env`, which sits outside every git checkout. No script here, and
   no script anywhere in this repo, may contain it.

## PUT semantics (verified 2026-08-14, not assumed)

`PUT /v1/{appId}/themes` takes a map of theme name → theme object.

- **Between themes it merges per key.** Themes you don't name are untouched.
  Verified by pushing two clones and re-reading all 11 pre-existing themes
  byte-for-byte afterwards.
- **Within a theme it replaces wholesale.** A PUT carrying only one file *drops
  every other file in that theme*. Always send the complete file set — which is
  what the tooling does, since it reads the whole folder.
- **A `null` value deletes that theme.**
- There is no per-theme endpoint: `GET /v1/{appId}/themes/<name>` is a 404, and
  `?names=` is ignored. It's the whole collection or nothing.

## Tooling

Split by what a rollback needs, which is the only line that matters here:

| Where | Scripts | Why there |
| --- | --- | --- |
| `talkjs-themes/tools/` (this repo) | `get-themes`, `export-themes`, `roundtrip-check`, `put-clones`, `promote-to-real`, `restore`, `lib` | Release-critical. A rollback that exists on one laptop is not a rollback, and a fresh clone must be able to run every step this README documents. |
| `staging-qa/talkjs-theme-rig/` (local-only) | `compare-themes`, `identity-gate`, `typing-gate`, `verifier-*` | QA gates. They drive a real browser through the Playwright harness, so they live with it. |

Every script here reads `TALKJS_SECRET_KEY` from the environment and contains
no secret of any kind. This machine keeps that key in `staging-qa/.env`, which
is outside every git checkout, so the commands below run from `staging-qa/` and
let Node load it — but nothing binds the tools to that folder. Anywhere with
the key in the environment works:

```sh
TALKJS_SECRET_KEY=… node talkjs-themes/tools/get-themes.mjs
```

## Workflow

```sh
cd staging-qa
unset PLAYWRIGHT_BROWSERS_PATH            # Cursor injects an empty browser cache
T=../starters-webflow/talkjs-themes/tools

# 1. snapshot every theme on the account (disaster recovery, stays out of git)
node --env-file=.env $T/get-themes.mjs

# 2. refresh this folder from that snapshot
node --env-file=.env $T/export-themes.mjs

# 3. prove the folder still reconstructs the live payload exactly
node --env-file=.env $T/roundtrip-check.mjs --live

# --- now edit the files in this folder, then: ---

# 4. push clones (…-qa) and assert no other theme moved
node --env-file=.env $T/put-clones.mjs --yes

# 5. visual gate: same conversation, real theme vs clone, in a local rig
node --env-file=.env talkjs-theme-rig/compare-themes.mjs \
  --a the-starters-3-0 --b the-starters-3-0-qa

# 6. promote to the real names — read "Promotion" first, the ordering is load-bearing
node --env-file=.env $T/promote-to-real.mjs             # dry run, prints the diff
node --env-file=.env $T/promote-to-real.mjs --confirm
```

The gate compares the theme stylesheet rule-for-rule, the computed styles and
geometry of the message row, avatar, bubble, timestamp and header, and the
container screenshot byte-for-byte. For a no-change export it must report zero
differences; for a real edit, only the differences the change intends.

**On snapshot filenames.** `get-themes.mjs` names the file itself
(`full-themes-backup-<timestamp>.json`) and every other tool then resolves *the
newest snapshot in the directory*. Passing your own filename still works, but
it is no longer the documented path: the old flow invited you to invent a name
the tools did not know about, so a freshly taken snapshot sat there while
`restore` and `export` silently kept using an older one. `--snapshot <path>`
pins a specific file, and each tool prints which snapshot it loaded.

## Promotion (step 6, the live cutover)

`promote-to-real.mjs` is the only tool that writes `the-starters-3-0` and
`the-starters-3-0-profile`. It pushes what is committed in this folder.

**Ordering is load-bearing: controller first, theme LAST.** Themes are stored
per TalkJS *app*, with no staging/production split, and both controllers
hardcode the theme name — so a PUT here is live for every member the instant it
lands. Ship and publish the controller that understands the new markup first,
confirm it loaded in production under the *old* theme, and only then promote.
The reverse order gives every member a UI wired to a controller that isn't
there yet, and TalkJS drops unhandled custom actions silently, so nothing
errors — it just quietly does nothing. The full ordered checklist is ticket 06
(`.scratch/talkjs-chat-theme/issues/06-cutover-live-verification.md`).

What the tool does before it writes anything:

1. Reads the complete file map per theme, refusing untracked files.
2. GETs the account and prints the **exact diff** — files added, changed, and
   deleted, with line and byte counts. A PUT replaces a theme wholesale, so any
   file that exists live but not in the folder is called out as a deletion.
3. Refuses a theme name that does not exist on the account (`--allow-new`
   overrides), and exits without touching the API when there is nothing to do.
4. Writes a **pre-PUT snapshot of every theme** to
   `.scratch/talkjs-chat-theme/` and reads it back before writing. No verified
   snapshot, no promotion — that file is the rollback.
5. After the PUT, re-reads the account and proves each promoted theme is
   byte-identical to the folder *and* every other theme byte-identical to the
   snapshot, then writes an evidence JSON under `promote-evidence/<timestamp>/`.

It is a dry run unless `--confirm` is passed.

## Restore

If a PUT lands something wrong, re-push from a snapshot (the key comes from
`staging-qa/.env` via `--env-file`, never on the command line):

```sh
cd staging-qa
T=../starters-webflow/talkjs-themes/tools
node --env-file=.env $T/restore.mjs the-starters-3-0 the-starters-3-0-profile          # dry run
node --env-file=.env $T/restore.mjs the-starters-3-0 the-starters-3-0-profile --yes
```

It uses the newest snapshot unless you pass `--snapshot <path>`; after a
promotion, the newest is the pre-PUT snapshot that promotion just took, which
is exactly the state you want back. `--all` restores every theme in it. The
script re-reads the account afterwards and fails loudly if anything did not
come back identical.

### If there is no snapshot at all

Then `restore.mjs` cannot help you — it says so and points here. This folder is
the fallback, and `promote-to-real.mjs` is the tool that pushes it back under
the real names:

```sh
cd staging-qa
node --env-file=.env ../starters-webflow/talkjs-themes/tools/promote-to-real.mjs           # shows the diff
node --env-file=.env ../starters-webflow/talkjs-themes/tools/promote-to-real.mjs --confirm
```

It never reads a snapshot to do this — it reads the committed folder and the
live account — and it takes a fresh pre-PUT snapshot on the way, so the
recovery run also restores the thing that was missing. Check out the commit you
want first: what it pushes is whatever this folder contains.

## Clone themes on the account

`the-starters-3-0-qa` and `the-starters-3-0-profile-qa` exist as QA targets and
are currently byte-identical to their sources. Nothing in production points at
them — they are only ever loaded by the local rig or a dev-tunnel build of the
page controller.
