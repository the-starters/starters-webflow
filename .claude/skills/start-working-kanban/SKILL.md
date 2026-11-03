---
name: start-working-kanban
description: Work the Up next cards on the project's kanban boards (Notion or local in the repo), after one confirm, in any agent (Claude Code, Codex, Cursor). Local dev sessions, each in its own worktree, one branch and one PR per ticket (small fixes batched per area), QA on this Mac, cards moved as work lands. Only when an approver types /start-working-kanban.
disable-model-invocation: true
---

# Start working the kanban

You are the coordinator. Run this in a **local** session on the approver's machine, in any agent (Claude Code,
Codex, Cursor): dev sessions are local too, each in its own worktree, because dev and QA need this
machine's build tools, simulators, browser and Figma tools. You write the board; dev sessions never do. No `.claude/kanban.json` or no
`.claude/skills/save-to-kanban/kanban.sh` in the repo: offer `/setup-kanban-space` and stop.

Read first: [cards.md](../save-to-kanban/cards.md) (config, board, schema, rules), the board's
backend file ([notion.md](../save-to-kanban/notion.md): read-check-write claims, so Notion boards
run one unit at a time whatever `maxDev` says; [local.md](../save-to-kanban/local.md): `kanban.sh`,
whose claims are atomic, so local boards use `maxDev`), `.claude/kanban.json` (`repo`,
`approvers`, limits, `project`), and `project.workingStyle` when it is set. "The approver" below is
whoever started the run; `<repo>` is `kanban.json` `repo`.

## Runtime

The steps below name capabilities, not tools. Use what your runtime has:

| Capability | Claude Code (desktop app) | Codex, Cursor or another agent |
|---|---|---|
| **Ask** one question and wait | `AskUserQuestion` | Ask in chat and stop until the approver answers. |
| **Start a dev session** in its own worktree | `mcp__ccd_session__start_session`, `initiation: "user_asked"`, `context: "fresh"`, `use_worktree: true`, never `target: "cloud"`. On a turn a background event started, the app refuses it: propose it (`"own_initiative"`) and **notify**. | `git worktree add .claude/worktrees/<branch> origin/main`, then a headless run of your agent there with the brief (Codex: `codex exec "<brief>"`; Cursor: `cursor-agent -p "<brief>"`) in the background. Record its session id. |
| **Message** a dev session | `SendMessage` to its `local_…` id | Codex: `codex exec resume <id> "<message>"`; Cursor: `cursor-agent -p --resume <id> "<message>"`. |
| **Find / stop** a dev session | `mcp__ccd_session_mgmt__get_session` / `stop_session` | Its session id still resumes / kill its process. |
| **Notify** the approver | `PushNotification` | Say it in chat; the approver reads it there. |
| **Background shell** | Bash `run_in_background` (you are woken when it exits) | Run it in a background process and check its output when your turn resumes, or run it in the foreground: it blocks until an event. |
| **QA agent** | Background `Agent` (`general-purpose`, model `sonnet`) | A subagent on a cheaper model if your runtime has one; otherwise run the QA brief yourself. |

No way to start a separate dev session: run the units yourself, one at a time, each in its own
worktree as the dev brief says, and skip the Watch section (you know when you're done).

`repo` is `null` in `kanban.json`: say the kanban runs need a GitHub repo and stop.

## 0. Pick up a run already in flight

Your context can be compacted or the session restarted mid-run; the board is the record, not your
memory. Before anything else, and again whenever you no longer know which session or PR a card
belongs to: query `status = doing`, limit 50, and sort each card:

```
Has a blocker? → logged; leave it.
owner == "starting"? → claimed but never got a session; continue it from section 2, step 3.
owner is a session you can **find**? → live unit.
Otherwise (no owner, an unknown name, a session that's gone) → not this run's; leave it and list it
  as "stale in progress" in your report. Never adopt it: no one approved it for this run.
```

For each live unit, rebuild unit → card ids, `owner`, `branch`, `pr`, `qa.rounds` from the cards,
check its PR with `gh pr view <pr> --json state,isDraft` and carry on from the step that state
implies. Live units were approved when they started, so they need no new ask; new cards do.

## 1. Preflight (read only)

0. **Pick the board first.** A run works one board. If the approver's message or a board link names
   one, use it. Otherwise **ask** which board before any read or write beyond section 0 (that
   includes requests like "move the backlog to Up next" that come with the command): list the
   boards from `kanban.json` `boards` and put your recommendation first, marked
   "(Recommended)", with a one-line reason drawn from what you know: the feature this session or
   the user's recent messages are about, the current branch, open `kanban/` PRs, and memory notes
   on what the approver is focused on. Never act on every board because the message said "backlogs" or
   "all"; ask which board that means.
1. Query `status = next` on that board, limit 20. Moving a card to Up next is how the approver picks it; there is no
   other gate. Ignore `meta/run` and any "Mark list ready" switch, even on boards whose page still
   shows one. No `next` cards: say "Nothing is in Up next on <board>. Move the cards you want run
   there, then run /start-working-kanban again." and stop. (On a local board: "Tell me which cards to
   move to Up next, then run /start-working-kanban again.")
2. Skip, and list as skipped: tickets (`kind: "ticket"`) without
   a `spec` link, tickets whose issue (the number in `Spec`) is already closed, and tickets with
   an open blocker (the "Blocked by" numbers in `Detail`), unless that blocker is in this run ahead of it. Such a ticket is approved but **waiting**:
   it starts only when its last open blocker merges (see the `merged` event).
   Check each state once: `gh issue view <n> --repo <repo> --json state --jq .state`.
3. Group into **units**: each ticket is one unit; all `next` fixes of one `area` are one unit
   (at most 8 per unit; split larger ones). Order: tickets in board order, then fix batches.
4. **Ask once per run.** **Ask** once: the units (id, title, area, ticket/fix), at most
   `maxDev` dev at a time and `maxQA` QA, options "Run these" / "Not now". The yes covers exactly
   these card ids: start every one of them as slots free up (later batches, waiting tickets whose
   blockers merge) without asking again, and **notify** the approver as each starts. Cards that reach
   `next` later need a new ask.
5. **Old done cards**, when `doneRetentionDays` is set. Local board: `kanban.sh prune <board>
   <days>` (the cards stay in the branch's history). Notion board: list the done cards past the
   cutoff (notion.md) in the step 4 ask as one more line, "Also move <n> done cards older than
   <days> days to Notion's Trash", and trash them only on its yes.

## 2. Start dev (up to `maxDev` units at once)

For each unit, in order, while fewer than `maxDev` are in dev:

1. Branch: `kanban/<first-id>-<slug>` (slug from the title, 3–5 words).
2. **Claim** each card with the backend's claim (Notion: read-check-write; local: `kanban.sh claim
   <board> <id> starting`), then set `branch` and `progress: "Dev starting"`. Claim before starting a session, so a lost
   race costs a write, not a dev session. If someone else claimed a card, drop it from the unit.
3. **Start a dev session** (see Runtime) with the brief from [dev-brief.md](dev-brief.md), the
   placeholders filled (`<repo>` and `<project.*>` from `kanban.json`). Its worktree is its own; the brief's first step puts it on `<branch>` from
   `origin/main`. Keep the brief's `<figma>` block,
   with each card's frame link, when any card in the unit has `figma`; drop it otherwise.
4. **Record it**: set each card's `Owner` to the session id and `Progress: "Dev started"`. The session id on the card is what lets section 0 find
   the unit again; a card still at `owner: "starting"` in section 0 never got its session, so start
   one for it.

## 3. Watch (no model polling)

Start [watch.sh](watch.sh) once as a **background shell**, naming every unit of this run by its
branch (from the cards' `branch`) or PR number:
`bash .claude/skills/start-working-kanban/watch.sh <scratchpad>/kanban-watch.state <branch|pr>...`.
It polls GitHub in the shell and exits when one of those PRs merges, closes, or gets a new
`kanban:` comment from a repo owner, member or collaborator (local dev sessions comment as the
approver), or a `claude…` bot, printing one line per event. Other runs' PRs never wake it. Handle
the events, then start it again with the run's current branches: add a unit you just started, drop
one that merged or closed. Keep your own context
small: unit → card ids, session id, PR number, QA rounds. Nothing else; section 0 rebuilds it.

| Event | Do |
|---|---|
| `<pr> ready-for-qa <branch>` | Set the cards' `pr`, `progress: "Waiting for QA"`. Queue the unit for QA. |
| `<pr> blocked: <question>` | Set `blocker` on the cards, **notify** the approver the question with the PR link. The unit keeps its dev slot: its session holds the context, and restarting it costs more than waiting. If every slot is blocked, say so once in the notification. When the approver answers in chat, **message** the answer to that session, clear `blocker`. |
| `<pr> merged <branch>` | Cards → `done`, `progress: "Merged"`. Then start every **waiting** ticket whose blockers are now all closed (section 2), as dev slots allow. The merge itself frees no slot; QA pass already did. |
| `<pr> closed <branch>` | Cards back to `next`, clear `owner`, `branch`, `pr`, note why in `progress`. |

## 4. QA (local, `maxQA` at a time, never blocks dev)

Take the oldest queued unit. Dispatch a **QA agent** (see Runtime) with [qa-brief.md](qa-brief.md)
filled in. A cheaper model on purpose: QA checks a written list of criteria
and runs commands, which doesn't need the strongest model, and it runs every round. Dev sessions keep working while QA runs; other ready
units wait in the queue. When the QA report comes back:

- **Pass:** `gh pr ready <pr>` (the PR review and merge watch take it from there; never merge
  yourself). Cards → `review`, `qa: {rounds, last: "pass"}`. The dev slot is free: start the next
  approved unit (section 2).
- **Fail, rounds < `qaRounds`:** cards' `qa: {rounds, last: "fail", note}`. **Message** the
  findings (the report's list, verbatim, plus "fix these, push, comment `kanban: ready-for-qa`") to
  that unit's dev session.
- **Fail at `qaRounds`:** log it and move on. Cards keep `doing`, get `blocker: "QA failed <n>
  rounds: <one line>"`, PR stays draft with a comment listing the last findings. **Stop** that dev
  session so it stops spending tokens, clear `owner`, and
  free the slot. The branch and PR keep the work for whoever picks it up.
- **QA ran out of time** (report says incomplete): requeue it once at the back; a second timeout
  counts as a failed round.

## 5. Finish

When every approved unit is in `review`, `done`, or logged as blocked, stop the watcher, remove the
QA worktrees (`git worktree remove`), and report: one line per unit (cards, PR link, state), then
the blockers that need the approver. Don't wait for merges.

## Rules

- **Done means the card fully matches its spec.** A unit isn't QA-ready until its dev says every
  acceptance criterion is met, and isn't `review` until QA confirms it.
- **Questions: decide unless the tree says ask.** The approver's time is the scarcest thing in the run;
  each ping stalls a unit until they are back.
  ```
  Does the spec, project.designDoc, an approved design, or the code answer it?
  ├── Yes → follow it.
  └── No
      ├── Is the choice reversible and invisible to the user (naming, structure, test shape)?
      │   └── Yes → decide, note it in the PR body.
      └── Is it a product or visual call no approved design covers, or does it need access,
          credentials, or money?
          ├── Yes → blocker.
          └── Otherwise → pick the option closest to the code's existing pattern, note it in the PR.
  ```
  The same tree is in the dev brief.
- **Design truth:** `project.designDoc`, approved designs and the code's existing conventions win
  over skill defaults; `project.uiRules` are what QA checks on screen. A card with a `figma` link is a
  signed-off design whose source of truth is that Figma frame: dev builds it with the Figma
  design-to-code skill for the stack (named in `project.workingStyle`) and reuses Code
  Connect–mapped components, and QA compares the screen with the frame. Without the link, Figma is
  not consulted.
- **Tokens:** cards stay slim, briefs pass links not spec text, queries stay narrow, QA reports stay
  under 15 lines, and you don't re-read what a report already told you.
- **pstack** (Claude Code with pstack installed; otherwise skip it): tickets may use `/pstack:poteto-mode` with the Feature, Bug fix, Refactoring or
  Prototype playbook only. Fix batches skip it. Never Autopilot, Orchestrate, Babysit or
  `/pstack:swarm`: the board decides what gets worked, the PR watch decides what merges.
- **Never** push to `main`, merge, force-push someone else's branch, or start cards the approver didn't
  approve in section 1.
