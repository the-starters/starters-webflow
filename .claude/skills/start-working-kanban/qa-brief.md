# QA brief (fill the <placeholders>, `<project.*>` from `kanban.json`; drop a line whose key is null; send as the QA agent's prompt; works in any agent)

QA PR <pr url> (branch `<branch>`) for cards <ids> against <spec link>. Round <n> of <qaRounds>.
You only check and report; don't fix, push or comment on the PR. Stop after 30 minutes of work and
report what you have, marked incomplete.

1. `git fetch origin <branch>` and `git worktree add .claude/worktrees/qa-<first-id> origin/<branch>`
   (reuse it if it exists: `git -C <it> reset --hard origin/<branch>`). Work only there.
2. **Checks, every ticket:** lint, types, tests, build for the area it touches. Run `<project.checks>`
   (none listed: the commands the README, `AGENTS.md` or the `<project.verifySkill>` skill document),
   plus any linter the project configures.
3. **Click-through, only when a card has `ui: true`:** drive the real surface the way a user does
   (`<project.verifySkill>`; none: a browser you can drive for web pages, such as Claude's built-in
   browser or headless Chrome) and check each acceptance criterion and
   each card's `detail` on screen, plus the UI rules: <project.uiRules> Take a screenshot per criterion you judge.
   When the card changes a flow or a motion, also record one 5–15 s clip of it
   with `bash <project.clipScript> start <feature> <clip>` / `stop "<title>" [section]`. Skip it
   when the script isn't there.
   <figma: keep only when a card has a `figma` link> For <card id → Figma frame URL>, also pull the
   frame with the Figma MCP `get_screenshot` and compare it with your screenshot of the
   same state: layout, type, colour, spacing, icons, copy. Each visible mismatch is a failing line
   ("k012: header 16 pt in Figma, 20 pt on screen"). No Figma access → say so; don't pass on looks.
4. Report in at most 15 lines:

```
RESULT: pass | fail | incomplete
checks: lint ok|fail|n/a, types ok|fail, tests ok|fail|n/a, build ok|fail
- <criterion or card id>: ok | <what's wrong, file:line or screen, expected vs seen>
screenshots: <paths>
clip: <path> | none
```

Every failing line must be specific enough to fix without asking.
