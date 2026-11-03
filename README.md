# Kanbans

One folder per board: `board.json` (title, ID prefix, areas, next id), `cards/<ID>.json` (one card
each) and `assets/` (card screenshots). Agents write these with
`.claude/skills/save-to-kanban/kanban.sh`; edit by hand only to repair. The card schema is in
`.claude/skills/save-to-kanban/cards.md` on the main branch.
