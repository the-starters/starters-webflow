# Dev brief (fill the <placeholders>, `<project.*>` from `kanban.json`; drop a line whose key is null; send as the local dev session's prompt; works in any agent)

You are building <unit: "ticket k012" | "fix batch k020, k021, k024 (area drive)"> in
<repo>. You run in your own worktree on this machine. First:
`git fetch origin main && git switch -c <branch> origin/main`. Work only in this worktree, never in
the main checkout or another session's worktree. One PR for this unit.

Cards (board <board url>, read-only for you; the coordinator updates it):
<for each card: id, title, detail, where, spec link>

## Done

Done means every card fully matches its spec: each acceptance criterion in <spec link> is met
(for a ticket, read its parent spec issue #<parent> too), and
for fixes the card's `detail` is true, and a card with a Figma frame matches that frame on screen.
Keep going until it is. Out-of-scope things you notice: list
them under "Follow-ups" in the PR body; don't build them.

## How

- Read `AGENTS.md` (or `CLAUDE.md`) and `<project.workingStyle>`, then the skills they name for the work. For UI, start with
  `<project.designDoc>` and the feature context; approved designs and the code's existing
  conventions win over defaults. UI rules: <project.uiRules> No placeholder data, TODOs, commented-out code, debug prints or new one-off components
  where the code already has one; QA fails a PR for any of them.
- <ticket only> In Claude Code, use `/pstack:poteto-mode` with the <Feature | Bug fix | Refactoring | Prototype>
  playbook for this one ticket. Never its Autopilot, Orchestrate or Babysit playbooks, and no
  `/pstack:swarm`. Other runtimes: plan, test first, then build, the same way. <fix batch> Skip poteto-mode; make each fix directly, one commit per card.
- Questions: walk this tree; each blocker stalls your unit until the approver is back.
  ```
  Does the spec, <project.designDoc>, an approved design, or the code answer it?
  ├── Yes → follow it.
  └── No
      ├── Reversible and invisible to the user (naming, structure, test shape)? → decide, note it in the PR body.
      ├── A product or visual call no approved design covers, or needs access, credentials, money? → blocker.
      └── Otherwise → the option closest to the code's existing pattern, noted in the PR body.
  ```
<figma: keep this block only when a card has a `figma` link, with the card → frame list filled in>
- **Build from Figma.** Figma is the source of truth for <card id → Figma frame URL, one per line>.
  The HTML canvas and older screenshots of these screens are history; don't build from them.
  1. Check the Figma MCP tools (`get_design_context`, `get_screenshot`, `get_code_connect_map`)
     are available. If not, comment `kanban: blocked: no Figma access in this session` and wait.
  2. Load the Figma design-to-code skill for the stack (the project's working-style doc names it;
     else `figma:figma-design-to-code`; where your runtime lacks it, follow the same steps from
     the Figma MCP's own instructions): `get_design_context` per frame with the stack's
     `clientLanguages` and `clientFrameworks`, plus `get_screenshot`.
     The screenshot is the look; the React/Tailwind in the response is a structural hint only.
  3. Reuse before you build. `get_code_connect_map` on the frame: a component mapped to a code
     component → use it. Unmapped, but the code already has a matching one → use it and list the
     pair under "Code Connect" in the PR body. A new one only when the code has nothing like it.
  4. Figma variables map to the code's existing tokens (colour, spacing, type); no hex where a
     token covers it. A variable with no token → add it to the token file, note it in the PR.
  5. Code Connect templates (`figma-code-connect` skill, `.figma.ts` only) only when the file's
     components are published to a team library and the plan allows Code Connect (Organization or
     Enterprise). Otherwise the PR's "Code Connect" list is the mapping for later.
  6. Figma and the spec disagree: the spec wins on behaviour, Figma on looks. Anything else → blocker.
</figma>
- Run `<project.checks>` before you signal (none listed: the commands the README or `AGENTS.md`
  documents). Anything that needs a device, simulator or browser: use one you start for this
  session, never one QA or another session is using. Leave the click-through to QA. Say in the PR what you couldn't run.

## Signals (exact first line of a PR comment)

1. Open the PR as a **draft** early, body starting `Kanban: <ids>` and linking <spec link>. For a
   ticket, add `Closes #<issue>` so the merge closes it and unblocks the tickets after it.
2. When every criterion is met: comment `kanban: ready-for-qa`.
3. Blocked: comment `kanban: blocked: <the question, one line>` and wait. The answer comes as a
   message to this session.
4. QA findings arrive as a message. Fix all of them, push, comment `kanban: ready-for-qa` again.

Never mark the PR ready for review, merge it, or push to `main`; QA does the first, the PR watch the
second.
