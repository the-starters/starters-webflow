#!/usr/bin/env bash
# Reads and writes the local kanban: the kanbans/ folder at the main checkout's root, a worktree of
# the `kanbans` branch (names from .claude/kanban.json `local`). Every write pulls, changes the
# files, commits and pushes; a rejected push drops the commit and redoes the change on the new
# state, so two agents never both win a claim or an id. Every write and sync then rebuilds the
# read-only viewer in kanbans/.view/, which git never tracks. See local.md.
#
# Usage:
#   kanban.sh init                                  set up kanbans/ (creates the branch if missing)
#   kanban.sh boards                                one line per board: key, prefix, title
#   kanban.sh new-board <key> <title> <PREFIX> [area...]
#   kanban.sh board-owner <board> <name>            who owns the board; add stamps it on new cards as ownedBy
#   kanban.sh list <board> [jq condition]           cards as JSON lines, by order ('.status=="next"')
#   kanban.sh get <board> <id>
#   kanban.sh add <board> < cards.json              JSON object or array; prints the new ids
#   kanban.sh import <board> < cards.json           cards that keep their id and times (moving boards)
#   kanban.sh reserve <board> <n>                   next new id is at least <n> (ids used elsewhere)
#   kanban.sh set <board> <id> '<json>'             merges fields; null removes one
#   kanban.sh claim <board> <id> <owner>            next + no owner -> doing; exit 3 if taken
#   kanban.sh attach <board> <id> <image>           copies it into assets/, adds it to .images
#   kanban.sh prune <board> <days>                  removes done cards untouched for <days> (0: all)
#   kanban.sh sync                                  pulls the latest board, rebuilds the viewer
#   kanban.sh view [board] [--no-open]              syncs, then opens the viewer
#   kanban.sh share-page                            syncs, then writes .view/share.html: the viewer as one
#                                                   self-contained file (no card images) to publish; prints its path
set -euo pipefail

die() { echo "kanban: $*" >&2; exit 1; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

root=$(cd "$(git rev-parse --git-common-dir)/.." && pwd)
config="$root/.claude/kanban.json"
dir=kanbans
branch=kanbans
if [ -f "$config" ]; then
  dir=$(jq -r '.local.dir // "kanbans"' "$config")
  branch=$(jq -r '.local.branch // "kanbans"' "$config")
fi
K="$root/$dir"

has_remote() { git -C "$root" remote get-url origin >/dev/null 2>&1; }
remote_branch() { has_remote && git -C "$root" ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; }
need_board() { [ -f "$K/$1/board.json" ] || die "no board '$1' in $dir/ (kanban.sh boards)"; }
card_file() { echo "$K/$1/cards/$2.json"; }

# Every checkout and worktree on this machine shares the one kanbans/ folder, so two runs at once
# would pull, stage, commit and reset in the same working tree. lock makes them take turns: a
# directory in the repo's common git dir, holding the owner's pid, removed on exit. A lock whose
# owner is gone is taken over.
lock_dir="$(cd "$(git rev-parse --git-common-dir)" && pwd)/kanban.lock"
locked=0
lock() {
  local waited=0 pid
  [ "$locked" -eq 0 ] || return 0
  until mkdir "$lock_dir" 2>/dev/null; do
    pid=$(cat "$lock_dir/pid" 2>/dev/null || true)
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null && [ "$(cat "$lock_dir/pid" 2>/dev/null)" = "$pid" ]; then
      rm -rf "$lock_dir"; continue
    fi
    [ "$waited" -lt 1200 ] || die "another kanban.sh has held $lock_dir for 2 minutes; nothing was saved"
    sleep 0.1; waited=$((waited + 1))
  done
  echo $$ > "$lock_dir/pid"
  locked=1
  trap 'rm -rf "$lock_dir"' EXIT
}

# Fetches into origin/<branch> only (a bare `pull` also writes FETCH_HEAD and can move the checked-out
# branch), then rebases onto it. Retries a failed fetch or rebase, as txn retries a rejected push.
pull() {
  local try
  remote_branch || return 0
  lock
  for try in 1 2 3 4 5; do
    if git -C "$K" fetch -q origin "+refs/heads/$branch:refs/remotes/origin/$branch" \
      && git -C "$K" rebase -q "origin/$branch"; then
      return 0
    fi
    git -C "$K" rebase --abort 2>/dev/null || true
    sleep "$try"
  done
  die "pull failed after 5 tries; nothing was saved"
}

# txn <message> <command...>: runs the command on fresh state, commits, pushes; redoes it on a
# rejected push. The command's exit code 3 means "nothing to do" and is passed through.
txn() {
  local msg=$1 try rc out; shift
  lock
  for try in 1 2 3 4 5; do
    pull
    rc=0; out=$("$@") || rc=$?
    [ "$rc" -eq 0 ] || return "$rc"
    git -C "$K" add -A
    if git -C "$K" diff --cached --quiet; then printf '%s' "${out:+$out$'\n'}"; refresh_view; return 0; fi
    git -C "$K" commit -q -m "$msg"
    if ! has_remote || git -C "$K" push -q origin "HEAD:$branch" 2>/dev/null; then
      printf '%s' "${out:+$out$'\n'}"; refresh_view; return 0
    fi
    git -C "$K" reset -q --hard HEAD~1
    sleep "$try"
  done
  die "could not push to origin/$branch after 5 tries; nothing was saved"
}

cmd_init() {
  lock
  if [ -e "$K/.git" ]; then pull; refresh_view; echo "kanban: $dir/ ready on $branch"; return; fi
  [ -e "$K" ] && die "$dir/ exists but is not a worktree; move it aside first"
  if remote_branch; then
    git -C "$root" fetch -q origin "$branch"
    git -C "$root" show-ref -q "refs/heads/$branch" || git -C "$root" branch -q "$branch" "origin/$branch"
    git -C "$root" worktree add -q "$K" "$branch"
  elif git -C "$root" show-ref -q "refs/heads/$branch"; then
    git -C "$root" worktree add -q "$K" "$branch"
  else
    git -C "$root" worktree add -q --detach "$K"
    git -C "$K" checkout -q --orphan "$branch"
    git -C "$K" rm -rqf --ignore-unmatch . >/dev/null
    cat > "$K/README.md" <<'EOF'
# Kanbans

One folder per board: `board.json` (title, ID prefix, areas, next id), `cards/<ID>.json` (one card
each) and `assets/` (card screenshots). Agents write these with
`.claude/skills/save-to-kanban/kanban.sh`; edit by hand only to repair. The card schema is in
`.claude/skills/save-to-kanban/cards.md` on the main branch.
EOF
    git -C "$K" add -A
    git -C "$K" commit -q -m "kanban: start the board branch"
    if has_remote; then git -C "$K" push -q -u origin "$branch"; fi
  fi
  git -C "$root" check-ignore -q "$dir" || echo "kanban: add '/$dir/' to .gitignore on main" >&2
  refresh_view
  echo "kanban: $dir/ ready on $branch"
}

cmd_boards() {
  local b
  for b in "$K"/*/board.json; do
    [ -f "$b" ] || continue
    jq -r --arg k "$(basename "$(dirname "$b")")" '"\($k)\t\(.prefix)\t\(.title)"' "$b"
  done
}

do_new_board() {
  local key=$1 title=$2 prefix=$3; shift 3
  [ -e "$K/$key" ] && { echo "kanban: board '$key' exists" >&2; return 3; }
  mkdir -p "$K/$key/cards" "$K/$key/assets"
  touch "$K/$key/cards/.keep" "$K/$key/assets/.keep"
  jq -n --arg t "$title" --arg p "$prefix" --args '{title: $t, prefix: $p, areas: $ARGS.positional, nextId: 1}' "$@" \
    > "$K/$key/board.json"
}

do_board_owner() {
  local b="$K/$1/board.json"
  jq --arg o "$2" '.owner = $o' "$b" > "$b.tmp" && mv "$b.tmp" "$b"
}

cmd_list() {
  local board=$1 cond=${2:-true}
  need_board "$board"
  find "$K/$board/cards" -name '*.json' -print0 | xargs -0 cat 2>/dev/null \
    | jq -cs "map(select($cond)) | sort_by(.order // 0) | .[]"
}

cmd_get() {
  need_board "$1"
  local f; f=$(card_file "$1" "$2")
  [ -f "$f" ] || die "no card $2 on $1"
  jq . "$f"
}

do_add() {
  local board=$1 input=$2 b="$K/$1/board.json" ts n prefix owner card id status order
  ts=$(now)
  n=$(jq -r .nextId "$b")
  prefix=$(jq -r .prefix "$b")
  owner=$(jq -r '.owner // empty' "$b")
  while IFS= read -r card; do
    id="$prefix-$n"
    status=$(jq -r '.status // "backlog"' <<<"$card")
    order=$(jq -r '.order // empty' <<<"$card")
    if [ -z "$order" ]; then
      order=$(cmd_list "$board" ".status==\"$status\"" | jq -s 'map(.order // 0) | max // 0 | . + 1')
    fi
    jq --arg id "$id" --arg s "$status" --argjson o "$order" --arg ts "$ts" --arg ow "$owner" \
      '(if $ow != "" and (.ownedBy // "") == "" then . + {ownedBy: $ow} else . end) + {id: $id, status: $s, order: $o, createdAt: $ts, updatedAt: $ts} | with_entries(select(.value != null))' \
      <<<"$card" > "$(card_file "$board" "$id")"
    echo "$id"
    n=$((n + 1))
  done < <(jq -c 'if type == "array" then .[] else . end' <<<"$input")
  jq --argjson n "$n" '.nextId = $n' "$b" > "$b.tmp" && mv "$b.tmp" "$b"
}

do_import() {
  local board=$1 input=$2 b="$K/$1/board.json" prefix max card id f
  prefix=$(jq -r .prefix "$b")
  max=$(jq -r '.nextId - 1' "$b")
  while IFS= read -r card; do
    id=$(jq -r '.id // empty' <<<"$card")
    case "$id" in
      "$prefix"-[0-9]*) ;;
      *) echo "kanban: skipped a card with id '$id' (needs $prefix-<n>)" >&2; continue ;;
    esac
    f=$(card_file "$board" "$id")
    if [ -f "$f" ]; then echo "kanban: skipped $id (already on $board)" >&2; continue; fi
    if jq -e '(.notesText // "") != ""' <<<"$card" >/dev/null; then
      jq -r .notesText <<<"$card" > "$K/$board/assets/$id.md"
      card=$(jq --arg n "assets/$id.md" '.notes = $n' <<<"$card")
    fi
    jq --arg ts "$(now)" 'del(.notesText) | .createdAt //= $ts | .updatedAt //= .createdAt
      | .status //= "backlog" | with_entries(select(.value != null and .value != ""))' <<<"$card" > "$f"
    echo "$id"
    [ "${id#"$prefix"-}" -gt "$max" ] && max=${id#"$prefix"-}
  done < <(jq -c 'if type == "array" then .[] else . end' <<<"$input")
  jq --argjson n "$((max + 1))" '.nextId = $n' "$b" > "$b.tmp" && mv "$b.tmp" "$b"
}

do_set() {
  local f; f=$(card_file "$1" "$2")
  [ -f "$f" ] || { echo "kanban: no card $2 on $1" >&2; return 1; }
  jq --argjson p "$3" --arg ts "$(now)" \
    '. * $p | with_entries(select(.value != null)) | .updatedAt = $ts' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
}

do_claim() {
  local board=$1 id=$2 owner=$3 f
  f=$(card_file "$board" "$id")
  [ -f "$f" ] || { echo "kanban: no card $id on $board" >&2; return 1; }
  if ! jq -e '.status == "next" and ((.owner // "") == "")' "$f" >/dev/null; then
    echo "kanban: $id is taken ($(jq -r '"\(.status), owner \(.owner // "none")"' "$f"))" >&2
    return 3
  fi
  do_set "$board" "$id" "$(jq -n --arg o "$owner" '{status: "doing", owner: $o}')"
}

do_attach() {
  local board=$1 id=$2 src=$3 f n ext rel
  f=$(card_file "$board" "$id")
  [ -f "$f" ] || { echo "kanban: no card $id on $board" >&2; return 1; }
  n=$(jq '(.images // []) | length + 1' "$f")
  ext=${src##*.}
  rel="assets/$id-$n.$ext"
  cp "$src" "$K/$board/$rel"
  do_set "$board" "$id" "$(jq --arg r "$rel" '{images: ((.images // []) + [$r])}' "$f")"
}

do_reserve() {
  local b="$K/$1/board.json"
  jq --argjson n "$2" '.nextId = ([.nextId, $n] | max)' "$b" > "$b.tmp" && mv "$b.tmp" "$b"
}

do_prune() {
  local board=$1 days=$2 cutoff f id
  if [ "$days" -eq 0 ]; then cutoff=9999; else
    cutoff=$(date -u -v-"$days"d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "$days days ago" +%Y-%m-%dT%H:%M:%SZ)
  fi
  for f in "$K/$board"/cards/*.json; do
    [ -f "$f" ] || continue
    if jq -e --arg c "$cutoff" '.status == "done" and .updatedAt < $c' "$f" >/dev/null; then
      id=$(basename "$f" .json)
      echo "$id"
      rm -f "$f" "$K/$board/assets/$id"-*
    fi
  done
}

# Rebuilds the viewer in kanbans/.view/: the files in viewer/ next to this script, plus data.js with
# every board, its cards and notes. Card images load from the board folders beside it. .view/ is
# kept out of git by the worktree's local exclude file, so no commit carries it. A bad card file
# leaves the old view and warns; the write that called this has already been pushed.
refresh_view() {
  local out="$K/.view" exclude key d f
  exclude=$(git -C "$K" rev-parse --path-format=absolute --git-path info/exclude)
  mkdir -p "$(dirname "$exclude")"
  grep -qxF '/.view/' "$exclude" 2>/dev/null || echo '/.view/' >> "$exclude"
  for f in "$K"/*/cards/*.json; do
    [ -f "$f" ] || continue
    jq -e 'type == "object"' "$f" >/dev/null 2>&1 || { echo "kanban: view not rebuilt, not a JSON card: ${f#"$root"/}" >&2; return 0; }
  done
  rm -rf "$out"; mkdir -p "$out"
  cp -R "$(cd "$(dirname "$0")" && pwd)/viewer/." "$out/"
  for d in "$K"/*/; do
    key=$(basename "$d")
    [ -f "$d/board.json" ] || continue
    jq -n --arg key "$key" --slurpfile b "$d/board.json" \
      --slurpfile cards <(find "$d/cards" -name '*.json' -exec cat {} + 2>/dev/null) \
      --slurpfile notes <(find "$d/assets" -name '*.md' 2>/dev/null | while read -r n; do
        jq -n --arg f "assets/$(basename "$n")" --rawfile t "$n" '{($f): $t}'; done) \
      --argjson archive "$(jq --arg k "$key" '.boards[$k].archive // null' "$config" 2>/dev/null || echo null)" \
      '($notes | add // {}) as $n | $b[0] + {key: $key, archive: $archive, cards: ($cards | map(. + {
        notesText: (if .notes then $n[.notes] else null end),
        imageUrls: ((.images // []) | map("../\($key)/\(.)"))}))}'
  done | jq -s --arg repo "$(jq -r '.repo // empty' "$config" 2>/dev/null)" --arg at "$(date '+%Y-%m-%d %H:%M')" \
    --arg name "$(jq -r '.project.name // empty' "$config" 2>/dev/null)" \
    '"window.KANBAN = " + ({repo: (if $repo == "" then null else $repo end), name: (if $name == "" then null else $name end), generated: $at,
      boards: sort_by(.title)} | tojson) + ";"' -r > "$out/data.js"
}

cmd_view() {
  local board="" open=1 url
  for a in "$@"; do case "$a" in --no-open) open=0 ;; *) board=$a ;; esac; done
  [ -z "$board" ] || need_board "$board"
  pull
  refresh_view
  url="file://$(sed 's/%/%25/g; s/ /%20/g; s/#/%23/g' <<<"$K/.view")/index.html${board:+#$board}"
  echo "$url"
  [ "$open" -eq 1 ] || return 0
  if command -v open >/dev/null; then open "$url"
  elif command -v xdg-open >/dev/null; then xdg-open "$url"; fi
}

# The viewer as one file: data.js and viewer.js inlined, for a hosted page (a claude.ai
# artifact, a ChatGPT Site) that cannot load the files beside it. Card images are left out.
cmd_share_page() {
  local v="$K/.view" line title
  pull
  refresh_view
  # A host names the page from its <title>, so give it the project's name, HTML-escaped.
  title=$(jq -r '((.project.name // (.repo // "" | split("/") | last)) | if . == "" then "Kanban" else . + " kanban" end)
    | gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;")' "$config" 2>/dev/null || echo Kanban)
  while IFS= read -r line; do
    case "$line" in
      '<title>Kanban</title>') printf '<title>%s</title>\n' "$title" ;;
      *'<script src="data.js">'*) printf '<script>\n'; cat "$v/data.js"; printf '\n</script>\n' ;;
      *'<script src="viewer.js">'*) printf '<script>\n'; cat "$v/viewer.js"; printf '\n</script>\n' ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < "$v/index.html" > "$v/share.html"
  echo "$v/share.html"
}

[ $# -ge 1 ] || { grep '^#   kanban.sh' "$0" | cut -c5-; exit 1; }
op=$1; shift
case "$op" in
  init) cmd_init ;;
  sync) pull; refresh_view ;;
  view) cmd_view "$@" ;;
  share-page) cmd_share_page ;;
  boards) cmd_boards ;;
  list) [ $# -ge 1 ] || die "list <board> [jq condition]"; cmd_list "$@" ;;
  get) [ $# -eq 2 ] || die "get <board> <id>"; cmd_get "$@" ;;
  new-board)
    [ $# -ge 3 ] || die "new-board <key> <title> <PREFIX> [area...]"
    txn "kanban($1): new board" do_new_board "$@" ;;
  add)
    [ $# -eq 1 ] || die "add <board> < cards.json"
    need_board "$1"; input=$(cat)
    txn "kanban($1): add cards" do_add "$1" "$input" ;;
  import)
    [ $# -eq 1 ] || die "import <board> < cards.json"
    need_board "$1"; input=$(cat)
    txn "kanban($1): import cards" do_import "$1" "$input" ;;
  board-owner)
    [ $# -eq 2 ] || die "board-owner <board> <name>"
    need_board "$1"; txn "kanban($1): owner is $2" do_board_owner "$@" ;;
  reserve)
    [ $# -eq 2 ] && [[ $2 =~ ^[0-9]+$ ]] || die "reserve <board> <n>"
    need_board "$1"; txn "kanban($1): reserve ids below $2" do_reserve "$@" ;;
  set)
    [ $# -eq 3 ] || die "set <board> <id> '<json>'"
    need_board "$1"; jq -e 'type == "object"' <<<"$3" >/dev/null || die "fields must be a JSON object"
    txn "kanban($1): update $2" do_set "$@" ;;
  claim)
    [ $# -eq 3 ] || die "claim <board> <id> <owner>"
    need_board "$1"; txn "kanban($1): $3 claims $2" do_claim "$@" ;;
  attach)
    [ $# -eq 3 ] || die "attach <board> <id> <image>"
    need_board "$1"; [ -f "$3" ] || die "no file $3"
    src=$(cd "$(dirname "$3")" && pwd)/$(basename "$3")
    txn "kanban($1): image for $2" do_attach "$1" "$2" "$src" ;;
  prune)
    [ $# -eq 2 ] || die "prune <board> <days>"
    need_board "$1"; txn "kanban($1): remove done cards older than $2 days" do_prune "$@" ;;
  *) die "unknown command '$op'" ;;
esac
