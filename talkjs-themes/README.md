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

The format is lossless: rebuilding the payload from these files reproduces the
API's response byte-for-byte (`roundtrip-check.mjs`, below).

## Rules

1. **Do not edit these themes in the TalkJS dashboard.** The dashboard's copy is
   overwritten by the next PUT, silently and without a diff. Dashboard editing of
   these two themes is retired; change the files here instead.
2. **The committed export is the only rollback.** A PUT replaces the whole theme
   (verified — see "PUT semantics"), and TalkJS keeps no history, so the previous
   commit of this folder is what "undo" means.
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

## Workflow

Tooling lives in `staging-qa/talkjs-theme-rig/` — outside git, because it needs
the secret key at runtime. Run everything from `staging-qa/`:

```sh
cd staging-qa
unset PLAYWRIGHT_BROWSERS_PATH            # Cursor injects an empty browser cache

# 1. snapshot every theme on the account (disaster recovery, stays out of git)
node --env-file=.env talkjs-theme-rig/get-themes.mjs ../.scratch/talkjs-chat-theme/full-themes-backup-<date>.json

# 2. refresh this folder from that snapshot
node --env-file=.env talkjs-theme-rig/export-themes.mjs

# 3. prove the folder still reconstructs the live payload exactly
node --env-file=.env talkjs-theme-rig/roundtrip-check.mjs --live

# --- now edit the files in this folder, then: ---

# 4. push clones (…-qa) and assert no other theme moved
node --env-file=.env talkjs-theme-rig/put-clones.mjs --yes

# 5. visual gate: same conversation, real theme vs clone, in a local rig
node --env-file=.env talkjs-theme-rig/compare-themes.mjs \
  --a the-starters-3-0 --b the-starters-3-0-qa
```

The gate compares the theme stylesheet rule-for-rule, the computed styles and
geometry of the message row, avatar, bubble, timestamp and header, and the
container screenshot byte-for-byte. For a no-change export it must report zero
differences; for a real edit, only the differences the change intends.

Only after the gate passes does the same content go to the real theme names.

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
`mount()`, because the event fires once as the inbox loads) and resolves the
other participant's slug then, caching it for the page's lifetime. A click is
then a Map read followed immediately by `window.open`.

That is a correctness requirement rather than a speed one, and it constrains
the theme too: WebKit only honours a popup opened inside the click's own
synchronous call stack, so a tab opened after the ~2.5s resolver round-trip is
refused on Safari and iOS — silently, with no error to catch. If you ever add
another identity surface, it must raise the same action with the same
`data-member`, so it is served by the same cache entry.

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

`staging-qa/talkjs-theme-rig/lint-templates.mjs` now refuses to push a theme
whose comments contain a tag, and `put-geometry-clones.mjs` runs it first. The
trap cost two debugging rounds before that existed.

### Reserve the avatar column with margin, never with row padding

`max-width` on a bubble is a percentage, and it resolves against the message
ROW's content box. Padding the row to reserve the dropped avatar's width
therefore shrinks the cap for exactly the rows that carry it, so a long grouped
bubble ends up narrower than its group's first bubble — a ragged far edge worth
16px at the desktop 50% cap and 27px at the 644px 85% one. The reservation is a
`margin` on `.message` for that reason. `staging-qa/talkjs-theme-rig/cap-gate.mjs`
measures it at both breakpoints.

## Restore

If a PUT lands something wrong, re-push from the snapshot taken in step 1 (the
key comes from `staging-qa/.env` via `--env-file`, never on the command line):

```sh
cd staging-qa
node --env-file=.env talkjs-theme-rig/restore.mjs the-starters-3-0 the-starters-3-0-profile   # dry run
node --env-file=.env talkjs-theme-rig/restore.mjs the-starters-3-0 the-starters-3-0-profile --yes
```

`--all` restores every theme in the snapshot. The script re-reads the account
afterwards and fails loudly if anything did not come back identical.

If the snapshot file is gone, this folder is the fallback: `export-themes.mjs`
wrote it, and `put-clones.mjs` reads it, so the same content can be pushed back
under the real names.

## Clone themes on the account

`the-starters-3-0-qa` and `the-starters-3-0-profile-qa` exist as QA targets.
They currently carry this folder's edits while the real theme names still carry
the pre-change look; the cutover to the real names is the last step of the
round. Nothing in production points at the clones — they are only ever loaded by
the local rig or a dev-tunnel build of the page controller.
