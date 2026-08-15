# TalkJS chat themes

The chat UI renders inside TalkJS's own iframe, so no Webflow page style and no
CDN script in this repo can reach it. Its look lives in TalkJS-hosted **themes**,
and this folder is the source of truth for the two the site uses:

| Folder | Theme name on TalkJS | Where it renders |
| --- | --- | --- |
| `the-starters-3-0/` | `the-starters-3-0` | the `/messages` inbox (`v3/messages.js`) |
| `the-starters-3-0-profile/` | `the-starters-3-0-profile` | the message modal on `/hire/<slug>` (`v3/messages-profile.js`) |

Nothing in here is served over the CDN. These files exist so the chat's look is
reviewable, diffable, and rollback-able. The decision and its consequences are
recorded in **ADR 0004, "TalkJS chat themes are managed as code via the REST
API"** — it lives in the `starters-git` workspace at
`docs/adr/0004-talkjs-themes-as-code-via-rest.md`, one level above this checkout,
so it is deliberately not a link here.

## Folder format

Each folder is one theme, exported from `GET /v1/{appId}/themes`:

- **`<Component>.template`** — one file per entry in the theme's `files` map,
  named exactly as TalkJS names it. A `.template` file is the component's markup
  plus its `<style>` block; `layout.json` is the theme's global layout settings.
- **`theme.json`** — everything in the theme object that is *not* a file.
  Currently just `{"base": "default_v7"}`, the TalkJS base theme these extend.
- **`README.md`** — this file. The export/import tooling skips it and
  `theme.json`; every other file in the folder is sent as a theme file.
- **`tools/`** — the pipeline scripts (see "Tooling"). Skipped like the two
  above, and not a theme folder.

Two things are deliberately *not* sent, because the loader reads the working
tree rather than git:

- **Dotfiles.** One Finder visit leaves a `.DS_Store` behind, and without the
  filter it becomes a theme file — shipping binary junk or 400ing the PUT.
  `.gitignore` cannot help here; nothing in this path consults it.
- **Untracked files.** `promote-to-real.mjs` refuses to run when a theme folder
  holds a file git does not know about, and names it — an added file silently
  becoming "a live file was deleted" is not an acceptable failure mode.
  `--exclude-untracked` proceeds with them left out.

Promotion additionally refuses a folder that is **not clean at HEAD**
(`--allow-dirty` overrides). Without that, "only committed content ships" was
false in the ordinary case: `git ls-files` reports tracked-ness, so a
tracked-but-edited or staged-but-uncommitted file shipped while the evidence
file named a commit that did not describe it.

The format is lossless: rebuilding the payload from these files reproduces the
API's response byte-for-byte (`roundtrip-check.mjs`, below).

## Rules

1. **Do not edit these themes in the TalkJS dashboard.** The dashboard's copy is
   overwritten by the next PUT, silently and without a diff. Dashboard editing of
   these two themes is retired; change the files here instead.
2. **The committed export is the durable rollback.** A PUT replaces the whole
   theme (verified — see "PUT semantics") and TalkJS keeps no history, so
   "undo" means re-pushing content you still hold. There are two layers: a
   snapshot file, which is faster and captures themes this folder does not
   track, and this folder, which survives a lost laptop. Neither is optional —
   the snapshots live in `.scratch/`, outside git, and a recovery plan that
   depends on one machine's untracked directory is not a plan.
3. **The API bypasses the dashboard's Test → Publish safeguard.** A PUT lands on
   live instantly. Every change therefore goes to a **clone theme** first
   (`…-qa`), passes the visual gate, and only then to the real names.
4. **The TalkJS secret key never enters this repo.** It lives only in
   `staging-qa/.env`, which sits outside every git checkout. No script here, and
   no script anywhere in this repo, may contain it.

## PUT semantics (verified 2026-08-14, not assumed)

`PUT /v1/{appId}/themes` takes a map of theme name → theme object.

- **Between themes it merges per key.** Themes you don't name are untouched.
  Verified by pushing two clones and re-reading all 11 pre-existing themes
  byte-for-byte afterwards.
- **Within a theme it replaces wholesale.** A PUT carrying only one file *drops
  every other file in that theme*. Always send the complete file set — which is
  what the tooling does, since it reads the whole folder.
- **A `null` value deletes that theme.**
- There is no per-theme endpoint: `GET /v1/{appId}/themes/<name>` is a 404, and
  `?names=` is ignored. It's the whole collection or nothing.

## Tooling

Split by what a rollback needs, which is the only line that matters here:

| Where | Scripts | Why there |
| --- | --- | --- |
| `talkjs-themes/tools/` (this repo) | `get-themes`, `export-themes`, `roundtrip-check`, `put-clones`, `promote-to-real`, `restore`, `selftest`, `lib` | Release-critical. A rollback that exists on one laptop is not a rollback, and a fresh clone must be able to run every step this README documents. |
| `staging-qa/talkjs-theme-rig/` (local-only) | `compare-themes`, `identity-gate`, `typing-gate`, `verifier-*` | QA gates. They drive a real browser through the Playwright harness, so they live with it. |

`restore`, `export-themes` and `roundtrip-check` in `staging-qa/talkjs-theme-rig/`
are now **stubs that refuse and point here**. They used to resolve the snapshot
from a hardcoded dated path and ignore `--snapshot`, so reaching for the
familiar name mid-incident returned a confident exit 0 having restored a
week-old account.

Every script here reads `TALKJS_SECRET_KEY` from the environment and contains
no secret of any kind. This machine keeps that key in `staging-qa/.env`, which
sits outside every git checkout, so run the tools from `staging-qa/` and let
Node load it with `--env-file`. Nothing binds the tools to that folder — any
directory with a `.env` holding the key works — but do not put the key on the
command line, where it lands in shell history and process listings.

**Confirm word.** `--confirm` writes; `--yes` is accepted as an alias by all
three writing tools. Anything else is rejected rather than ignored, including
`--confirm --dry-run` together, which used to discard the `--dry-run` and write
to live.

**Exit codes** are distinct because "aborted safely" and "live is now wrong"
must never be the same number:

| Code | Meaning |
| --- | --- |
| 0 | dry run, no-op, or verified success |
| 1 | aborted before any write; the account was not touched |
| 2 | a PUT was sent and the outcome could **not** be established |
| 3 | live was mutated and verification **failed** — roll back |

## Workflow

```sh
cd staging-qa
unset PLAYWRIGHT_BROWSERS_PATH            # Cursor injects an empty browser cache
T=../starters-webflow/talkjs-themes/tools

# 1. snapshot every theme on the account (disaster recovery, stays out of git)
node --env-file=.env $T/get-themes.mjs

# 2. refresh this folder from that snapshot
node --env-file=.env $T/export-themes.mjs

# 3. prove the folder still reconstructs the live payload exactly
node --env-file=.env $T/roundtrip-check.mjs --live

# --- now edit the files in this folder, then: ---

# 4. push clones (…-qa) and assert no other theme moved
node --env-file=.env $T/put-clones.mjs --confirm

# 5. visual gate: same conversation, real theme vs clone, in a local rig
node --env-file=.env talkjs-theme-rig/compare-themes.mjs \
  --a the-starters-3-0 --b the-starters-3-0-qa

# 6. promote to the real names — read "Promotion" first, the ordering is load-bearing
node --env-file=.env $T/promote-to-real.mjs             # dry run, prints the diff
node --env-file=.env $T/promote-to-real.mjs --confirm   # add --allow-deletions if the
                                                        # diff shows files being removed
```

The gate compares the theme stylesheet rule-for-rule, the computed styles and
geometry of the message row, avatar, bubble, timestamp and header, and the
container screenshot byte-for-byte. For a no-change export it must report zero
differences; for a real edit, only the differences the change intends.

**On snapshot filenames.** `get-themes.mjs` names the file itself
(`full-themes-backup-<timestamp>.json`) and every other tool then resolves *the
newest snapshot in the directory*. Passing your own filename still works, but
it is no longer the documented path: the old flow invited you to invent a name
the tools did not know about, so a freshly taken snapshot sat there while
`restore` and `export` silently kept using an older one. `--snapshot <path>`
pins a specific file, and each tool prints which snapshot it loaded.

## Promotion (step 6, the live cutover)

`promote-to-real.mjs` is the only tool that writes `the-starters-3-0` and
`the-starters-3-0-profile`. It pushes what is committed in this folder.

**Ordering is load-bearing: controller first, theme LAST.** Themes are stored
per TalkJS *app*, with no staging/production split, and both controllers
hardcode the theme name — so a PUT here is live for every member the instant it
lands. Ship and publish the controller that understands the new markup first,
confirm it loaded in production under the *old* theme, and only then promote.
The reverse order gives every member a UI wired to a controller that isn't
there yet, and TalkJS drops unhandled custom actions silently, so nothing
errors — it just quietly does nothing. The full ordered checklist is ticket 06
(`.scratch/talkjs-chat-theme/issues/06-cutover-live-verification.md`).

What the tool does before it writes anything:

1. Rejects unknown arguments, and refuses `--confirm --dry-run` together
   instead of picking one.
2. Reads the complete file map per theme. Refuses **untracked** files
   (`--exclude-untracked` proceeds with them left out) and refuses a folder
   that is **not clean at HEAD** (`--allow-dirty` overrides, and the report
   then records that the content matches no commit). That is what makes "only
   committed content ships" a fact: tracked-ness alone says nothing about
   whether the bytes match the commit the evidence file names.
3. Prints every resolved path — theme folder, snapshot directory, pinned
   snapshot, evidence directory — and where each came from, because all of
   them can be redirected by environment variables set in a `.env` nobody
   reads mid-incident.
4. GETs the account and prints the **exact diff** — files added, changed, and
   deleted, with line and byte counts. A PUT replaces a theme wholesale, so
   any file that exists live but not in the folder is a deletion, and
   deletions are **refused** unless `--allow-deletions` is passed. Deleting a
   live file is the one irreversible thing here and it is the one that used to
   have no gate.
5. Refuses a theme name that does not exist on the account (`--allow-new`
   overrides), warns when you promote one of the pair (the inbox and the
   profile modal would then disagree), and exits without touching the API when
   there is nothing to do.
6. Probes the snapshot **and** evidence directories for writability up front.
7. Re-reads the account immediately before the PUT and aborts if anything
   moved since the diff was computed — another session's write must not be
   captured in the rollback snapshot or blamed on this run.
8. Writes a **pre-PUT snapshot of every theme** to `.scratch/talkjs-chat-theme/`
   and reads it back. No verified snapshot, no promotion — that file is the
   rollback. It then writes `pre-put-plan.json` (targets, diff, snapshot path,
   rollback command) **before** the PUT, so a dropped connection or a Ctrl-C
   leaves a record naming the way back. `SIGINT`/`SIGTERM` print it too.
9. After the PUT, re-reads the account and proves each promoted theme is
   byte-identical to the folder *and* every other theme byte-identical to the
   snapshot, then writes the evidence JSON. A failed PUT is **verified**
   rather than assumed: a 502 from an intermediary after the origin applied
   the write looks identical to a rejection, so the account is re-read and
   what actually changed is reported.

A dry run takes a full snapshot too, into `.scratch/talkjs-chat-theme/dry-runs/`.
Snapshot resolution is a prefix match on a non-recursive listing, so a
rehearsal cannot be picked up as a rollback *by construction* — which matters
most in the sequence nobody plans: promote, notice something wrong, run a dry
run to inspect it, and have that rehearsal become the newest "rollback",
capturing the broken state. A no-op run writes no snapshot at all, because
there is nothing to roll back to.

It is a dry run unless `--confirm` is passed.

### Proving it works

`selftest.mjs` exercises the whole tool against a throwaway theme name
(`zz-selftest-promote`), because the promotion path cannot be rehearsed against
the real themes:

```sh
cd staging-qa
node --env-file=.env ../starters-webflow/talkjs-themes/tools/selftest.mjs
```

It seeds a real divergence (one changed file, one file that exists only live),
drives every refusal and the success path through the actual CLI, checks that
the deletion happened and that no other theme moved, deletes the throwaway, and
asserts the account and the real snapshot directory are exactly as it found
them. 23 checks, roughly ten seconds, safe to run any time.

## Clickable Identity contract (inbox theme only)

The inbox theme's chat-header photo, chat-header name and received-message
avatar are `<ActionButton>`s. Clicking one is answered by `v3/messages.js`,
which resolves the member id to a public profile slug and opens `/hire/`+slug
in a new tab. The two sides agree on exactly three things, so changing either
half without the other breaks the feature silently:

| | Value |
| --- | --- |
| action name | `starters-open-profile` |
| parameter | `data-member` on the button, arriving as `event.params.member` |
| channels | `ChatHeader` raises a **conversation** action, `UserMessage` raises a **message** action; the controller registers the same handler on both |

Rules the templates enforce, not the controller:

- Only the **other** participant is wrapped. Your own avatar stays a plain
  `<Avatar>`, so there is no button to click and no pointer cursor.
- The header buttons only render for a one-on-one conversation
  (`conversation.otherParticipants.length == 1`).
- The pointer cursor and the hover dim are declared **only** on the identity
  buttons, so an affordance never appears where a click cannot do anything.

The affordance is optimistic: the theme cannot know whether a member has a
published profile, so brands and profile-less starters show the cursor and the
click quietly does nothing (the resolver answers an empty slug). That trade-off
was decided in the grill; see the round's spec.

`data-member` is a single word on purpose. TalkJS turns `data-<key>` into
`event.params.<key>`, and a hyphenated key's arrival form is not documented.

### The slug is resolved when the conversation opens, not when you click

The controller listens for `onConversationSelected` (registered **before**
`mount()`) and resolves the other participant's slug then, caching it for the
page's lifetime. A click is then a Map read followed immediately by
`window.open`.

That is a correctness requirement rather than a speed one, and it constrains
the theme too. The handler is not in the click's own call stack and cannot be:
TalkJS's UI is cross-origin, so the action arrives over postMessage in a later
task, carrying a transient activation forwarded to the parent window. WebKit
budgets that forwarding at about a second, shared with TalkJS's own dispatch,
so a tab opened after the ~2.5s resolver round-trip is refused on Safari and
iOS — silently, with no error to catch. If you ever add another identity
surface, it must raise the same action with the same `data-member`, so it is
served by the same cache entry and stays a Map read rather than a request.

Register before `mount()` because it is the only ordering that cannot lose the
race, not because a later listener is guaranteed to miss the event: measured,
listeners added pre-mount, at mount and +50ms all received the first selection
event, and only one added +3s later missed it.

The two accessible names in this theme (`View <name>'s profile`, on the header
photo and on the message avatar) exist because those buttons wrap only an
image. Do not replace them with `ariaLabel` on the ActionButton: unknown props
become `data-*` attributes, and would arrive in `event.params`.

The profile-modal theme (`the-starters-3-0-profile/`) deliberately has **no**
click wiring — that chat already sits on the person's profile page.

### A parser trap worth remembering

TalkJS parses the whole `.template` file, comments included. A comment
containing something that looks like a tag — `/hire/<slug>`, "as a `<span>`" —
opens an element that is never closed, and the theme fails to compile with
`Unexpected close tag` pointing at the last line of the file. TalkJS then
silently renders its **default** theme instead of erroring in any visible way.
Write `[slug]`, not `<slug>`, in template comments.

`tools/lint-templates.mjs` refuses to push a theme whose comments contain a
tag, and **every** script here that writes themes from these files runs it
first: `tools/put-clones.mjs` and `tools/promote-to-real.mjs` in this repo, and
`put-geometry-clones.mjs` plus `put-clones.mjs` in the `staging-qa` rig.
`tools/restore.mjs` deliberately does not — it replays a snapshot that already
compiled, and the rollback path must not grow a new way to fail. A gate wired
into only one push path would not close this trap; it cost two debugging rounds
before the lint existed.

### Reserve the avatar column with margin, never with row padding

`max-width` on a bubble is a percentage, and it resolves against the message
ROW's content box. Padding the row to reserve the dropped avatar's width
therefore shrinks the cap for exactly the rows that carry it, so a long grouped
bubble ends up narrower than its group's first bubble — a ragged far edge worth
16px at the desktop 50% cap and 27px at the 644px 85% one. The reservation is a
`margin` on `.message` for that reason. `staging-qa/talkjs-theme-rig/cap-gate.mjs`
measures it at both breakpoints.

## Restore

If a PUT lands something wrong, re-push from a snapshot (the key comes from
`staging-qa/.env` via `--env-file`, never on the command line):

```sh
cd staging-qa
T=../starters-webflow/talkjs-themes/tools
node --env-file=.env $T/restore.mjs the-starters-3-0 the-starters-3-0-profile            # dry run
node --env-file=.env $T/restore.mjs the-starters-3-0 the-starters-3-0-profile --confirm
```

**Name the themes that are actually wrong.** `--all` exists and restores every
theme in the snapshot, but it also reverts any unrelated theme another person
legitimately changed since the snapshot was taken — a recovery with a wider
blast radius than the incident. A failed promotion prints a scoped, fully
qualified restore command; use that one.

It uses the newest snapshot unless you pass `--snapshot <path>`, and echoes
which one it resolved along with the environment variables that could have
redirected it. After a promotion that actually wrote, the newest is the pre-PUT
snapshot that promotion took, which is the state you want back. A promotion
that turned out to be a no-op writes no snapshot, so in that case the newest is
whatever came before. The script re-reads the account afterwards and fails
loudly if anything did not come back identical.

### If there is no snapshot at all

Then `restore.mjs` cannot help you — it says so and points here. This folder is
the fallback, and `promote-to-real.mjs` is the tool that pushes it back under
the real names:

```sh
cd staging-qa
node --env-file=.env ../starters-webflow/talkjs-themes/tools/promote-to-real.mjs           # shows the diff
node --env-file=.env ../starters-webflow/talkjs-themes/tools/promote-to-real.mjs --confirm
```

It never reads a snapshot to do this — it reads the committed folder and the
live account — and it takes a fresh pre-PUT snapshot on the way, so the
recovery run also restores the thing that was missing. Check out the commit you
want first: what it pushes is whatever this folder contains.

## Clone themes on the account

`the-starters-3-0-qa` and `the-starters-3-0-profile-qa` exist as QA targets.
They currently carry this folder's edits while the real theme names still carry
the pre-change look; the cutover to the real names is the last step of the
round. Nothing in production points at the clones — they are only ever loaded by
the local rig or a dev-tunnel build of the page controller.
