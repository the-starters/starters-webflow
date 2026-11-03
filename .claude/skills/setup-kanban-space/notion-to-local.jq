# Turns Notion board rows (view-mode `results`) into local cards for `kanban.sh import`.
# Usage: jq --arg prefix DRV -f notion-to-local.jq rows.json > cards.json
# Done cards are dropped: they stay on the Notion board as its archive.
def lane: {"Backlog": "backlog", "Up next": "next", "Doing": "doing", "Review": "review"}[.];
# Notion escapes Markdown characters in exported text ("local\_abc", "\<"); undo that.
def plain: if type == "string" then gsub("\\\\(?<c>[_<>~*`#|{}\\[\\]])"; "\(.c)") else . end;
def stamp: if . then sub("\\.[0-9]+Z$"; "Z") else null end;
def qa: if (. // "") == "" then null
  else (capture("^(?<rounds>[0-9]+) rounds?, last (?<last>pass|fail)(: (?<note>.*))?$")
        | {rounds: (.rounds | tonumber), last, note}) // {note: .} end;
def links: ((capture("Parent #(?<p>[0-9]+)") | {parent: (.p | tonumber)}) // {})
  + ((capture("Blocked by (?<b>#[0-9]+(, #[0-9]+)*)") | {blockedBy: [.b | scan("[0-9]+") | tonumber]}) // {});

map(select(.Status != "Done"))
| map(
    . as $r
    | {
        id: ($prefix + "-" + ($r["userDefined:ID"] | tostring | sub("^[A-Z]+-"; ""))),
        title: $r.Title,
        detail: ($r.Detail // "" | sub(" ?Parent #[0-9]+\\. ?(Blocked by [#0-9, ]+\\.)?"; "")),
        kind: $r.Kind,
        area: $r.Area,
        where: $r.Where,
        spec: $r.Spec,
        figma: $r.Figma,
        pr: $r.PR,
        ui: ($r.UI == "__YES__"),
        status: ($r.Status | lane),
        addedBy: $r["Added by"],
        priority: $r.Priority,
        order: $r.Order,
        owner: $r.Owner,
        branch: $r.Branch,
        blocker: $r.Blocker,
        progress: $r.Progress,
        qa: ($r.QA | qa),
        oldId: $r["Old ID"],
        source: $r.url,
        createdAt: ($r.Created | stamp),
        updatedAt: ($r.Updated | stamp)
      }
    + (($r.Detail // "") | links)
    + (if ($r.Spec // "") | test("/issues/[0-9]+$") and $r.Kind == "ticket"
       then {issue: ($r.Spec | capture("/issues/(?<n>[0-9]+)$").n | tonumber)} else {} end)
    | map_values(plain)
    | with_entries(select(.value != null and .value != ""))
  )
