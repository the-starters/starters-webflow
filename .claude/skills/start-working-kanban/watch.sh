#!/usr/bin/env bash
# Polls GitHub for the run's kanban/ PR events and exits, printing one line per new event:
#   <pr> <kanban comment's first line, minus "kanban: "> <branch> <comment id>
#   <pr> merged|closed <branch>
# Only the PRs named on the command line count, by number or by head branch, so parallel runs on
# other boards never wake this one. Only comments from repo owners, members or collaborators, or a
# Claude bot, count. Seen events are kept in <state-file>. The repo is .claude/kanban.json `repo`
# (or $KANBAN_REPO); the poll interval is $KANBAN_WATCH_EVERY seconds (default 120).
# Usage: watch.sh <state-file> <pr|branch>...
#        watch.sh --filter <prs.json> [pr|branch...]   (prints the events in a saved `gh pr list`
#                                                       JSON, for testing; no PRs named: all of them)
set -euo pipefail

filter='.[] | select(.headRefName | startswith("kanban/"))
  | select(($ARGS.positional | length) == 0
      or ((.number | tostring) as $n | $ARGS.positional | index($n))
      or (.headRefName as $b | $ARGS.positional | index($b))) | . as $p
  | ([.comments[]
      | select((.body | startswith("kanban:"))
          and ((.authorAssociation | IN("OWNER", "MEMBER", "COLLABORATOR"))
               or (.author.login | test("^claude"))))]
     | last) as $c
  | if $p.state == "MERGED" then "\($p.number) merged \($p.headRefName)"
    elif $p.state == "CLOSED" then "\($p.number) closed \($p.headRefName)"
    elif $c then "\($p.number) \($c.body | split("\n")[0] | ltrimstr("kanban:") | ltrimstr(" ")) \($p.headRefName) \($c.id)"
    else empty end'

if [ "${1:-}" = "--filter" ]; then
  file=$2; shift 2
  jq -r "$filter" "$file" --args "$@"
  exit 0
fi

[ $# -ge 2 ] || { echo "watch.sh: usage: watch.sh <state-file> <pr|branch>..." >&2; exit 1; }
state=$1; shift
every=${KANBAN_WATCH_EVERY:-120}
root=$(cd "$(git rev-parse --git-common-dir)/.." && pwd)
repo=${KANBAN_REPO:-$(jq -r '.repo // empty' "$root/.claude/kanban.json")}
[ -n "$repo" ] || { echo "watch.sh: no repo in .claude/kanban.json" >&2; exit 1; }
touch "$state"

while :; do
  events=$(gh pr list --repo "$repo" --state all --limit 50 \
    --json number,headRefName,state,comments | jq -r "$filter" --args "$@")
  new=$(comm -13 <(sort -u "$state") <(printf '%s\n' "$events" | sed '/^$/d' | sort -u))
  if [ -n "$new" ]; then
    printf '%s\n' "$new" | tee -a "$state"
    exit 0
  fi
  sleep "$every"
done
