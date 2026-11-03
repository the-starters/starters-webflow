---
name: save-to-kanban
description: Save small fixes and follow-ups as slim cards on the project's kanban boards (Notion or local in the repo) so they can be batch-fixed later, put the GitHub tickets from /to-tickets on the board as ticket cards, or move cards between lanes when the approver asks. Use when the user types /save-to-kanban, says "save that to the kanban" / "card it" / "put the tickets on the board" / "move DRV-3 to Up next", right after /to-tickets publishes, or when you find an out-of-scope fix mid-task (in a dev or QA loop) that should not be built now.
---

# Save to kanban

Turn each fix or follow-up into one slim card in the `backlog` lane, confirm in one line, and stop.
Build nothing. Read [cards.md](cards.md) first (the config, which board, the card schema, the
rules), then the board's backend file: [notion.md](notion.md) for `"type": "notion"`,
[local.md](local.md) for `"type": "local"`. Works in any agent with a shell (and the Notion MCP for
Notion boards): Claude Code, Codex, Cursor. No `.claude/kanban.json`, or no `.claude/skills/save-to-kanban/kanban.sh` in the repo (the kit was
installed as a plugin and setup never ran here): say the project has no kanban yet and offer
`/setup-kanban-space`.

## Steps

1. **Collect the items.** From the user's message (each distinct change is one card; a screenshot
   with three issues is three cards), or from what you found in passing. An item is a fix only when
   it touches one screen or component, needs no new data shape, and fits in one commit. Anything
   else is a feature: say in one line that it belongs in `/to-spec`, and don't card it. Fix batches
   skip the spec and poteto-mode, so a feature carded as a fix gets built without either.
2. **Write each card** to the schema: a title that says what changes, a `detail` that says what done
   looks like, `area`, `where` when you know the file or screen, `ui`, `kind: "fix"`,
   `ownedBy` (the board's `owner` from `kanban.json`; local `add` fills it for you, Notion needs it written), `addedBy` (`you` for the user's requests, `claude` for what you, any agent, found), `spec` when the fix
   belongs to a spec, `figma` when the screen's signed-off design lives in Figma (the frame link
   the user gave, or the one the spec names). Keep the user's meaning; tighten the words, don't add scope. Settle what you
   can from the code (file path, screen code); leave the rest out rather than ask.
3. **Skip duplicates.** One narrow query per area (see cards.md). An open card is a duplicate when
   it has the same `area` and either the same `where` or the same screen and the same wrong
   behaviour. Then update that card's `detail` instead and say so. Different wording of
   the same bug is a duplicate; the same screen with a different bug is not.
4. **Write once.** All new cards in one write, in `backlog`, each after the lane's last `order`
   (the backend file says how; the backend numbers the ids and sets the times). Every screenshot
   the user sent goes with its card (Notion: an image in the page body; local: `kanban.sh
   attach`); when the runtime can't save an image, say so in the card's `detail` ("screenshot in
   chat <date>").
5. **Confirm** in one line per batch: board, ids and titles. No summary, no next-step offer.

## Tickets from /to-tickets

Run this right after `/to-tickets` publishes, or when the user says `/save-to-kanban tickets #<spec>`.
One card per open ticket, `kind: "ticket"`, in `backlog` until the approver moves it to Up next. The issue holds
the spec text; the card holds only what the coordinator needs to pick it up. `<repo>` is
`kanban.json` `repo`.

1. **Find the tickets.** The spec issue's sub-issues:
   `gh api repos/<repo>/issues/<spec>/sub_issues --jq '.[] | select(.state=="open") | .number'`.
   If there are none, take the issue numbers `/to-tickets` just printed. Never import an issue that
   isn't a ticket of that spec.
2. **Skip ones already on the board.** For each number, look for a card whose `spec` contains
   `/issues/<n>`. A hit is left as it is.
3. **Read each new ticket once:** `gh issue view <n> --repo <repo> --json title,body,url` and its
   blockers with `gh api repos/<repo>/issues/<n>/dependencies/blocked_by --jq '[.[].number]'`
   (if that's empty, use the numbers under the body's "Blocked by").
4. **Build the card:** `title` = the issue title; `detail` = one sentence from "What to build" plus
   "Done: <k> acceptance criteria in the issue"; `spec` = the ticket's issue URL; `issue` = its
   number, `parent` = the spec number and `blockedBy` = the blocker numbers (local boards store
   them as fields; Notion has no property yet, so put them in `Detail` as "Parent #<p>. Blocked by
   #<a>, #<b>."); `area` and `ui` from what the ticket touches (settle it from the text and the
   code, don't ask); `figma` = the Figma frame link in the ticket or its spec, if there is one;
   `addedBy: "you"` (the approver approved the breakdown); `order` = the lane's last order + the
   ticket's position in dependency order, so blockers sort first.
5. Write them in one write, as in step 4 above. Confirm in one line: board,
   spec number, card ids with their issue numbers, and any skipped as already on the board.

## Moving and editing cards

When an approver (`kanban.json` `approvers`) asks to move cards ("DRV-3 and DRV-4 to Up next") or
change one, write only the fields that change and confirm in one line. Only approvers move cards
into `next`; anyone may move a card back to `backlog`. Never move a `doing` card someone else owns:
that's the coordinator's.

## Inside a dev or QA loop

An agent working a ticket that spots something outside its ticket saves it here instead of fixing
it, with `addedBy: "claude"` and `spec` set to the ticket's spec, then carries on. Only fixes that
block the ticket's own done-criteria get built in the ticket. Dev sessions don't otherwise write
the board.

## Not here

Per-feature change requests go to that feature's board in `.claude/kanban.json` `boards` (pick by
`areas`). Use the default `board` when the user names no other and no feature fits. A new board is
`/setup-kanban-space`'s "Add a board".
