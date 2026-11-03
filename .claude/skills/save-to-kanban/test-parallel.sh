#!/usr/bin/env bash
# Proves that parallel writes lose nothing. Builds a throwaway origin in a temp folder, a clone of it
# with a second linked worktree (two sessions on one machine, sharing one kanbans/ folder) and a
# second clone (another machine), then runs <n> `set` calls at once from each of the three and checks
# that origin has every one. Never touches the real board.
#
# Usage: test-parallel.sh [n]     n writes per checkout (default 20)
set -euo pipefail

n=${1:-20}
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com

git init -q --bare -b main "$tmp/origin.git"
git clone -q "$tmp/origin.git" "$tmp/a" 2>/dev/null
mkdir -p "$tmp/a/.claude/skills"
cp -R "$here" "$tmp/a/.claude/skills/save-to-kanban"
echo '{"local": {"dir": "kanbans", "branch": "kanbans"}, "boards": {"t": {"type": "local"}}}' > "$tmp/a/.claude/kanban.json"
echo '/kanbans/' > "$tmp/a/.gitignore"
git -C "$tmp/a" add -A
git -C "$tmp/a" commit -q -m start
git -C "$tmp/a" push -q origin main
git -C "$tmp/a" worktree add -q "$tmp/a2" -b second
git clone -q "$tmp/origin.git" "$tmp/b"

ks() { (cd "$1" && bash .claude/skills/save-to-kanban/kanban.sh "${@:2}"); }
ks "$tmp/a" init >/dev/null
ks "$tmp/a" new-board t Test T >/dev/null
total=$((n * 3))
jq -n --argjson t "$total" '[range($t) | {title: "card \(.)"}]' | ks "$tmp/a" add t >/dev/null
ks "$tmp/b" init >/dev/null

i=0
for c in a a2 b; do
  for _ in $(seq "$n"); do
    i=$((i + 1))
    ks "$tmp/$c" set t "T-$i" "{\"mark\": $i}" >"$tmp/out-$i" 2>&1 &
  done
done
fail=0
wait || true
for i in $(seq "$total"); do
  grep -q 'kanban:' "$tmp/out-$i" && { echo "write $i: $(cat "$tmp/out-$i")"; fail=$((fail + 1)); }
done

git -C "$tmp/b/kanbans" fetch -q origin kanbans
saved=0
for i in $(seq "$total"); do
  git -C "$tmp/b/kanbans" show "origin/kanbans:t/cards/T-$i.json" | jq -e --argjson i "$i" '.mark == $i' >/dev/null \
    && saved=$((saved + 1))
done
echo "$saved of $total writes on origin, $fail reported a failure"
[ "$saved" -eq "$total" ]
