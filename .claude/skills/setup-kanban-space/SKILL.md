---
name: setup-kanban-space
description: Set up the agent kanban for a repo, so save-to-kanban and start-working-kanban work for the whole team. Detects the repo, approver, stack, features and project rules, shows them with recommended answers for one confirm, then creates the boards (local in the repo on a kanbans branch, or Notion), writes .claude/kanban.json and checks it with a test card. Also joins a teammate's machine to an existing setup and adds a board. Use when the user types /setup-kanban-space, asks to set up a kanban for this repo, or a kanban skill finds no .claude/kanban.json.
---

# Set up a kanban space

The kit is three skill folders: this one, `save-to-kanban` and `start-working-kanban`. They read
everything project-specific from `.claude/kanban.json`; this skill writes it. Read
[cards.md](../save-to-kanban/cards.md) (the config keys and card schema) first, then
[local.md](../save-to-kanban/local.md) or [notion.md](../save-to-kanban/notion.md) for the backend
you build. Works in Claude Code, Codex and Cursor; "ask" means `AskUserQuestion` where it exists,
otherwise a question in chat and a stop until the answer.

**Kit in the repo.** The scripts run from the repo's `.claude/skills/`, so the kit has to live there.
If this skill's folder is not `<repo root>/.claude/skills/setup-kanban-space` (installed as a plugin
or for all projects), copy the kit in first: for each of `save-to-kanban`, `setup-kanban-space` and
`start-working-kanban`, `mkdir -p .claude/skills/<name> && cp -R <this skill's folder>/../<name>/.
.claude/skills/<name>/`, then `chmod +x` `save-to-kanban/kanban.sh` and `start-working-kanban/watch.sh`.
Setup's commit then carries those folders, so teammates get the kit with the repo. In an existing
setup, the same copy updates the repo's kit; say which files changed. Never downgrade: compare
`save-to-kanban/VERSION` here with the repo's (a missing file is `0`), and when the repo's is newer,
use the repo's kit as it is and tell the user their installed plugin is out of date and to update it.

Missing `save-to-kanban` or `start-working-kanban` next to this folder: say the kit needs all three
folders and stop.

## 0. Which job

```
.claude/kanban.json exists?
├── No → set up (sections 1–5).
└── Yes
    ├── Has local boards and kanbans/ is missing on this machine → join: run
    │   `bash .claude/skills/save-to-kanban/kanban.sh init`, then `kanban.sh boards`, and report. Done.
    ├── The user asked for a new board → "Add a board" below.
    ├── The user asked to move Notion boards to local → "Move a board from Notion to local" below.
    └── Otherwise → say it is set up (boards, backend, approvers in one line each) and ask what to change.
        Never rewrite the file from scratch: keys the user didn't name stay as they are.
```

## 1. Detect (read only)

Work out every answer before asking anything; nothing in sections 1 and 2 writes a file, makes a
branch or pushes. Each answer gets a recommended value:

| Key | Recommended value | How |
|---|---|---|
| backend | `local` | Recommended: no account needed, and the team shares it through git. Asked in the confirm: Local, Claude artifact or Notion. |
| `repo` | The `origin` remote on GitHub | `gh repo view --json nameWithOwner -q .nameWithOwner`, else `owner/name` from a `github.com` URL in `git remote get-url origin`. No GitHub remote → `null`: local boards still work, but tickets, the PR watcher and `/start-working-kanban` need it; say so in the confirm. |
| `project.name` | The repo's name, readable | The `repo` name after the slash, else the repo's folder name, with `-` and `_` as spaces and each word capitalised (`acme-web` → "Acme Web"). Asked in the confirm. |
| `approvers` | The person running setup | `repo` found on GitHub → `gh api user --jq '.name // .login'`; otherwise `git config user.name`. Neither → ask for a name in the confirm. |
| board `owner` | The person running setup, same name as `approvers` | Per board; the confirm asks who owns each board. Candidates: the approvers plus `git shortlog -sn \| head` names. |
| `maxDev`, `maxQA`, `qaRounds` | 1, 1, 3 | Fixed. Raise `maxDev` later only for local boards. |
| `doneRetentionDays` | 30 | Fixed recommendation; 60 and 90 are the other offers. |
| features → `boards` | One board per app or demo folder | `find apps demos packages src feature features modules cmd -mindepth 1 -maxdepth 1 -type d 2>/dev/null` (not a glob: zsh aborts on no match; `feature`/`modules` are Android feature modules, `cmd` is Go binaries). Skip source-layout folders, which are not apps: `main`, `test`, `tests`, `java`, `kotlin`, `resources`, `lib`. Key and area = the folder name, lowercased, minus `-demo`, `-app`, `-web`, `-ios`, `-android`; title = "<Key, first letter capitalised> Board". No such folders: one board for the repo, keyed the same way from the `repo` name, or from the repo's folder name (`basename "$(git rev-parse --show-toplevel)"`) when `repo` is `null`. Two folders giving the same key: one board, both folders in its `areas`. |
| ID prefixes | First 3 letters of the key, capitals (`wallet` → `WAL`, `drive` → `DRI`) | Only on a clash with another prefix: the first letter plus the next two consonants (`mall` vs `malls` → `MLL`); still clashing, add a digit. |
| `board` | `infra` | Always add a board with key `infra`, title "Infra Board", prefix `INF`, areas `infra` and `tooling`, for cards no feature fits (skip it if a feature is already called `infra`). |
| `notion.root` | A new private page "<repo name> Kanban" | Only for the Notion backend. |
| `project.designDoc` | The design doc, if any | `git ls-files \| grep -iE '(^\|/)design[^/]*\.md$'`, first match; none → `null`. |
| `project.verifySkill` | The repo's verify skill | `ls .claude/skills .cursor/skills .agents/skills 2>/dev/null \| grep -i verify`; none → `run`. |
| `project.uiRules` | The platform's guidelines | `*.xcodeproj`, or a `Package.swift` that declares an `.iOS(` platform → "Apple HIG text styles; SF Symbols; the app's own tokens and spacing." an `AndroidManifest.xml` in `git ls-files` → "Material 3; the app's own tokens and spacing." (not `build.gradle*` alone: a Kotlin or Java backend has one too). `package.json` → "The app's existing design tokens and components." Several → join them. None (a backend, a CLI, a library) → `null`: QA then checks behaviour only. |
| `project.checks` | The commands that prove a change works | `package.json` scripts named `test`, `lint`, `typecheck`, `build` → `npm run <name>`; `Makefile` targets `test`, `lint`, `build` → `make <target>`; `*.xcodeproj` → `xcodebuild test -scheme <the app's scheme>`; `Package.swift` with no `*.xcodeproj` → `swift test`; `gradlew` → `./gradlew test`, plus `./gradlew lint` when an `AndroidManifest.xml` is in `git ls-files` (`build.gradle*` with no `gradlew` → `gradle test`); `go.mod` → `go vet ./...` and `go test ./...`; `Cargo.toml` → `cargo test`; `pyproject.toml` → `pytest`. Several stacks → all of them. Nothing found → `[]`, and say dev and QA fall back to the README. |
| `project.clipScript` | `null` | Fixed. |
| `project.workingStyle` | The team's working-style doc, if any | `git ls-files \| grep -iE 'working-style\|CONTRIBUTING\.md'`, first match; none → `null`. |

## 2. One confirm

Show the detected settings as a short table (key, value), then ask these four questions in one ask
(four is `AskUserQuestion`'s limit), the recommendation first and marked "(Recommended)":

1. **Project name** (titles the board page): the detected name "(Recommended)", or Other to type
   one. Board names are in the settings table; "Change some" renames them.
2. **Local, Claude artifact or Notion:** always these three options, in this order.
   - "Local (Recommended)": the cards live in a `kanbans/` folder on its own `kanbans` branch,
     pushed straight to origin, no account needed. You open the board page with `kanban.sh view`.
   - "Claude artifact": the same local cards, plus the board page published as a private
     claude.ai artifact you can open from anywhere. It is a snapshot, republished after card
     changes. Needs the Artifact tool in this session; in Codex, offer "ChatGPT Site" here
     instead; with neither, say it isn't available here and offer Local.
   - "Notion": one database per board under a Notion page; needs the Notion MCP for everyone,
     and runs one unit at a time.
3. **Who owns the kanban:** one owner for all boards, or per board. Options: each approver (the
   person running setup first, "(Recommended)"), a name from recent committers, or "Other" for a
   typed name. Ask it even when there is one approver: the owner goes on every card as `ownedBy`.
4. **The settings above** (done-card removal included): "Use these (Recommended)" or "Change some".

A value setup couldn't find (no approver name, say) is asked in chat right after, with nothing else.

Say in the ask what the yes does outside this machine: Local and Claude artifact push a new
`kanbans` branch, and Claude artifact also publishes a private artifact; all three push a
`kanban/setup` branch and open a PR with the config. That yes covers those pushes.

"Change some": ask which (multi-select: repo, approvers, board names and areas, done-card removal (30, 60 or 90 days, or never), project rules), then
ask each one in chat with its recommended value shown, and change nothing else.

## 3. Build the boards

**Local** (also for Claude artifact, which adds step 5):

1. Add a `/kanbans/` line to `.gitignore` (create the file if there is none) unless
   `git check-ignore -q kanbans` already passes.
2. `bash .claude/skills/save-to-kanban/kanban.sh init` (creates the `kanbans` branch and the
   `kanbans/` worktree and pushes the branch).
3. Per board, the default board last: `kanban.sh new-board <key> "<title>" <PREFIX> <area...>`,
   then `kanban.sh board-owner <key> "<owner>"`.
4. **Board view.** Every `kanban.sh` write rebuilds `kanbans/.view/` from `save-to-kanban/viewer/`,
   the read-only One Board page titled with `project.name` (see local.md). Setup is not done until it exists: `kanbans/.view/index.html`
   and `data.js` are there. Missing: `kanban.sh sync`. Notion-only setups have no viewer; say so in the report.
5. **Hosted board page, only for Claude artifact (or ChatGPT Site).** Run
   `bash .claude/skills/save-to-kanban/kanban.sh share-page`, then publish the file it prints per
   local.md "Hosted board page": a private artifact (a Site in Codex). Write
   `view: {"kind": "artifact", "url"}` (or `"site"`) into `kanban.json`, and say it is private.
   Local: write `view: {"kind": "html", "url": null}` and publish nothing. If publishing fails, set
   `kind: "html"` and say why in the report.

**Notion:**

1. No Notion MCP in this session: say so and offer the local backend instead. Stop.
2. `notion.root`: create the page (`notion-create-pages`, no parent, so it's private) unless the
   user named one. Say it's private and that teammates need it shared to them.
3. Per board: the database and its Board view exactly as notion.md "New board" says.

Each board in `kanban.json` `boards`: `{"type": "local"|"notion", "title", "owner", "areas"}`, plus
`database`, `dataSource` and `view` for Notion.

## 4. Write the config

1. Write `.claude/kanban.json` with every key from cards.md "Config", in its order, `null` where
   there is no value (a local setup keeps `"notion": {"root": null}`). Boards carry only the keys
   their type uses.
2. Codex and Cursor read skills from `.agents/skills/` and `.cursor/skills/`. For each of those
   folders that already exists (don't create one), and each kit folder not already in it:
   `ln -s ../../.claude/skills/<name> <folder>/<name>`, run from the repo root.
3. The agent doc: `AGENTS.md` if it exists, else `CLAUDE.md`, else skip this step. If it doesn't
   mention the kanban, append a short "Kanban" section: the boards live in `.claude/kanban.json`;
   `/save-to-kanban` saves and moves cards; `/start-working-kanban` (approvers only) works Up next;
   `/setup-kanban-space` joins a new machine or adds a board.

## 5. Check, then hand over

1. **Test card:** add one card to the default board (`title: "Setup check"`, `kind: "fix"`,
   `area` = its first area, `ui: false`, `addedBy: "claude"`) and fetch it by the id the add
   returned: every field you wrote must come back, and `ownedBy` must equal the board's owner. Set it to `done` and fetch again: `status` must
   be `done`. Then remove it (local: `kanban.sh prune <board> 0`, which deletes the file and keeps
   it in the branch's history; Notion: `notion-delete-pages` with `user_confirmed: true`, since
   setup's yes covered this one card). Any mismatch is a failed setup: report it and stop.
2. **Watcher:** `bash .claude/skills/start-working-kanban/watch.sh --filter <(echo '[]')` exits 0.
3. **Commit** on a new branch `kanban/setup` from the default branch, adding only the paths setup
   wrote: the three kit folders in `.claude/skills/` when setup copied them in, `.claude/kanban.json`, `.gitignore`, the new symlinks and the agent doc (never
   `kanbans/`). Use your runtime's commit attribution. Push the branch; with a GitHub `repo`, open a
   PR (`gh pr create`) titled "Set up the agent kanban". No GitHub: say the branch is pushed and the
   team merges it their own way. Never commit to the default branch directly.
4. **Open the view:** `bash .claude/skills/save-to-kanban/kanban.sh view --no-open` prints the
   page's URL; then `kanban.sh view` opens it for the user. Look at it once: each board is in the
   picker and the test card's removal left no stray card.
5. **Report** in a few lines: the backend, each board with its prefix, the `kanban.sh view` command, the hosted board page link and that it is private (or why there is none), the PR link (or the
   branch), and what a teammate does after it merges: pull, then `/setup-kanban-space` (it joins
   their machine). For Notion: share the root page with them.
   End the report by saying the board page uses the One Board design by default and can be
   customized by asking, with two or three of the sample prompts from the kit's README
   "Customize the board page" (colours and fonts, section names, rows per section). How: edit the
   page in `save-to-kanban/one-board/board-kit.md`, run `one-board/make-viewer.py`, then `kanban.sh view`.

## Add a board

For a new feature in an existing setup: work out the key, title, areas and prefix as section 1
does (no clash with existing prefixes), ask who owns it (recommended: the person asking), show them, and on a yes create it in the default backend
(the one most boards use, unless the user names one) as section 3 says, add it to `kanban.json`
`boards`, and commit that on a `kanban/board-<key>` branch with a PR. Local boards' folders are
pushed by `kanban.sh` itself.

## Move a board from Notion to local

One board at a time; open cards move, Done cards stay on Notion as the board's archive. Never during
a `/start-working-kanban` run on that board. Re-running is safe: `import` skips cards already moved.

1. **Prefix.** `notion-fetch` one card page of the board: its `userDefined:ID` is `<PREFIX>-<n>`
   (view rows carry only `<n>`). An empty board takes a prefix as section 1 does.
2. **Rows.** Read the board with `notion-query-data-sources` in **view** mode on `boards.<key>.view`
   (`page_size` 100, follow `next_cursor`): view mode doesn't count against Notion's hourly query
   allowance, which a few SQL or rows queries use up. Save the `results` arrays, joined, to a file
   in your scratch space. No `view` in the entry: rows mode, and stop if the allowance runs out.
3. **Convert:** `jq --arg prefix <PREFIX> -f .claude/skills/setup-kanban-space/notion-to-local.jq
   rows.json > cards.json`. It drops Done cards and maps lanes, QA, "Parent / Blocked by" and times.
4. **Page bodies.** For each card in `cards.json`, `notion-fetch` its `source`. Body text worth
   keeping (not just a "Copied from…" line) goes into the card as `notesText`. Images: get their
   download URLs (`notion-get-file-download-urls`), save them to scratch, and attach them after
   step 5. Delegate this to a subagent per board when there are more than about 20 cards.
5. **Import:** `kanban.sh new-board <key> "<title>" <PREFIX> <areas…>` if the board isn't there,
   then `kanban.sh import <key> < cards.json`, then `kanban.sh attach` for each saved image.
   Then `kanban.sh reserve <key> <n>`, where `n` is the highest id number in `rows.json` (Done
   rows included) plus 1, so new cards never reuse an id a Done card keeps on Notion.
6. **Check:** `kanban.sh list <key>` has one card per non-Done Notion row, the same ids, and the
   same count per lane. A mismatch: report it and stop; don't switch the board.
7. **Switch:** in `kanban.json`, the board becomes `{"type": "local", "title", "areas", "archive":
   <its database url>}`; commit that on a `kanban/move-<key>` branch with a PR. Prepend
   "Archive: open cards moved to kanbans/<key> on <date>. Don't add cards here." to the Notion
   database's description (`notion-update-data-source`).

## Rules

- Existing setup without board owners (set up before this existed): when a kanban skill finds a
  board with no `owner`, ask who owns it, write it to `kanban.json` (and `kanban.sh board-owner`),
  and backfill `ownedBy` on its open cards with `kanban.sh set`. Do not guess.
- Detect before you ask; every question shows its recommended answer first.
- One confirm for the whole setup. Later questions only for what the user chose to change.
- Never overwrite an existing `kanban.json`, board, Notion page or `kanbans` branch: reuse it.
- Never push to the default branch, and never put tokens, emails or other secrets in the config.
