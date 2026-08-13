# Learn Sessions video gate

`session-video.js` owns the hero player on the Learn Sessions template
(`/learn/sessions/<slug>`): a free preview for logged-out visitors, and the
site's signup modal as the wall after it. It is raw JS loaded with `defer` in that
template's before-`</body>` code:

```html
<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/global-embeds/session-video/session-video.js"></script>
```

Unlike most of [`global-embeds/`](../README.md), this file is **CDN-served rather
than pasted into a Webflow embed**, so a change to it only reaches the site once a
release tag is pushed and jsDelivr resolves `@latest` to it.

**It REPLACES the template's inline hero-video script — do not run both.** The
template already shipped a working Vimeo player for the same video, so the module
absorbs that player's controls rather than adding a second one; two players of
the same video on one page, only one of them clamped, makes the gate decorative.

The header block in [`session-video.js`](session-video.js) is the **authoritative
markup contract**. This document explains the model behind it and the parts the
Designer has to provide; where the two ever disagree, the header wins.

The module is **inert until that markup exists**. With no
`[data-session-video="root"]` on the page it returns immediately and leaves the
page exactly as authored.

## The three phases

| Phase | Trigger | Behaviour | Gate |
| --- | --- | --- | --- |
| Background | mount | Autoplays muted, loops inside the first `data-session-video-bg` seconds (default 20). No controls, no sound, no full screen. | **Not armed** |
| Watch | click on `[data-element-trigger="show-video"]`, and also a click on `#videoClickOverlay` or `#playPauseBtn`: both are wired through `toggle()`, which calls `watch()` while the gate is unarmed, so a plain click on the hero during the background phase arms the clamp too | Overlay hides, controls appear, sound comes on, looping stops. Playback **continues from where the ambient loop was** — it does not restart. | Armed |
| Clamp | playback reaches `data-session-video-cut` seconds (default 180) | Playback freezes, position is pinned at the cut point, and the signup trigger is clicked. Dismissing the modal leaves the frame frozen; any play attempt reopens it. | Enforced |

A member never reaches the third phase and gets the whole video, full screen
included.

**On a narrow player the watch control means full screen for a member.** Below the
`data-session-video-native-min` threshold the inline hero is a postage stamp
carrying the template's minimal controls, so a confirmed member's watch tap asks
the player for full screen as well, fired inside that tap's own gesture — only
ever a real tap or keyboard activation, never automatically. On iPhone that is
the device's own player, so that narrow iframe stays `controls=0` and does not
paint Vimeo's Unmute chip on the muted ambient loop; on Android and narrow
desktop the browser fullscreens our iframe, which carries Vimeo's bar so the
full-screen surface has pause, scrub, volume and a visible exit. Leaving full
screen (Done, or the back gesture) is treated as a pause: the overlay returns, the control bar goes with
it, and the position is pinned, so the next watch tap goes straight back in from
where they stopped, cycle after cycle. A tap that arrives before membership has
resolved is still looking at the gated frame, which carries no permission, so it
plays inline exactly as it always did and the full-screen button is the second
chance once the upgrade lands; a request the browser refuses degrades the same
way, with no error state either time. Members at or above the threshold — as
measured once at mount; a later rotation does not rebuild the frame — keep
today's inline watch with Vimeo's own bar and its own full-screen button, and
gated viewers are untouched at every width.

Which control counts as "the watch tap" depends on whether the gate has armed yet.
**Before it arms, any tap that starts the watch is a route into full screen** for
that member: the watch control, `#videoClickOverlay` and `#playPauseBtn` all run
the same watch transition (see the table above), so all three enter full screen.
**Once armed, only the watch control re-enters** — the click layer and the play
button are back to plain play/pause, because after an exit the overlay is up and
the watch control is the surface the member is looking at.

**Why the background phase must not arm the gate.** An ambient loop left running
would eventually cross the cut point on its own and throw the signup wall at
somebody who never asked to watch anything — possibly while they were reading
further down the page. Arming on the watch click is what prevents that.

**Why the ambient loop is capped inside the teaser window.** Otherwise a page
left open rolls past the cut point while muted, and the watch click then freezes
instantly and looks broken.

**Why the freeze is idempotent and pins the position.** The player keeps
reporting `timeupdate` for a few events after `pause()` is called; letting those
through made the reported position drift past the wall it is meant to be held at.
Re-opening the wall is the job of a *play attempt*, not of arriving at the cut
point again.

Because the clamp catches seeks as well as progress, a scrubber was never
actually a bypass route — removing native UI only stops the wall looking abrupt
and stops the player advertising the full runtime.

## Membership resolution

**Membership comes from `$memberstackDom.getCurrentMember().data`, never from
`window.memberReady`'s resolved value.** On this site `memberReady` resolves an
empty object `{}` for every visitor, logged in or not. Reading it as the answer
made `!!{}` true for everyone, so v1.59.170 classified *everybody* as a member
and the gate was inert for its entire life. Verified live while logged out:
`memberReady` gave `{}` while `getCurrentMember()` gave `{ data: null }`, with no
Memberstack cookies. `memberReady` is a **readiness** signal only — await it,
then ask, then test `data`. Do not "simplify" this back.

Resolution returns two values, `member` and `certain`:

| Outcome | `member` | `certain` | Consequence |
| --- | --- | --- | --- |
| `getCurrentMember()` answered with a `data` object | `true` | `true` | Upgrade to the full video |
| `getCurrentMember()` answered `{ data: null }` | `false` | `true` | Stay gated; no further asking |
| Memberstack SDK absent | `false` | `false` | Stay gated, keep watching for a late answer |
| `getCurrentMember()` rejected | `false` | `false` | Stay gated, keep watching for a late answer |
| `getCurrentMember()` threw | `false` | `false` | Stay gated, keep watching for a late answer |
| Nothing answered within the 1200 ms budget | `false` | `false` | Stay gated, keep watching for a late answer |

Those last four are the module's fail-closed paths, one per place it gives up on
an answer. `certain` exists because only one of the four used to arm the retry:
a member whose SDK loaded after the module stayed gated for the page's whole
life.

**It fails closed**, unlike [`learn-cta-gate.js`](../learn-cta-gate/learn-cta-gate.js),
which fails open. That embed risks trapping a member on a scroll-locked page, so
a gate that never appears is the safer failure there. Here a clamped member
reloads and recovers, whereas a leaked video is gone — and this file never locks
scroll.

### It mounts gated first, then upgrades

`fullscreen` is not a Vimeo embed option; it is governed by the iframe's
`allowfullscreen` / `allow` attributes, and **permissions policy is evaluated at
iframe load and never re-evaluated**. So the frame cannot be amended once built —
it has to be rebuilt.

Since the ambient phase is identical for everyone, delaying it to find out who is
watching only cost every visitor up to 1200 ms of empty hero. So the module
mounts in the **gated** shape immediately — the safe default, and the correct one
for a logged-out viewer — and `upgrade()` rebuilds the frame for a member,
preserving the playback position, the poster state and the watching state.

Membership resolution runs **in parallel** with the player-library load, never
chained behind it. Chained, the membership clock sat behind the library's 6000 ms
budget, so a member could click watch before the answer landed and have the frame
rebuilt under them mid-play.

**If the player library never arrives** there is no way to clamp, so a gated
viewer gets nothing rather than the whole video. A confirmed member still gets a
player through a separate no-API path, which is **forced native regardless of
width**: that path holds no player object and binds no controls, so the
template's own bar would be inert, and Vimeo's cramped bar beats no bar at all.
It writes `data-sv-overlay="hidden"` — plus the `data-sv-fullscreen="hidden"`
described below — and nothing else about the control surfaces. The hero overlay
has to come down or it covers the only player the viewer can reach, and the watch
control that would normally lower it is never wired there; `data-sv-player="native"`
keeps the template's own bar hidden, because revealing it would put inert play and
mute buttons beside Vimeo's working ones. No play or mute state is painted either:
with no event stream a guess about playback could never be corrected, and
`status()` would report a stalled video as playing.

## Native controls vs the template's own

Vimeo's native player needs **both a member and a player box at least
`data-session-video-native-min` px wide** (default 768). Everyone else — member
or not — gets the template's controls.

Below that width Vimeo drops its full-screen button entirely and lets its control
bar overflow its own container. Measured on a bare player at **375px**: no play
button, no full screen, no quality control, and `scrollWidth > clientWidth` on
the bar itself. That UI is cross-origin, so no CSS of ours can repair it — which
is why the split is by width and not by membership alone.

- **Measured on the stage**, not the window, via `getBoundingClientRect`, falling
  back to the viewport and then to 0. The evidence is a 375px *player*, and a
  wide window with a narrow hero column gets exactly the same broken UI. A width
  of 0 resolves to the template's controls, which always work.
- **Read once at mount.** The iframe's `controls` parameter is fixed at load, so a
  rotation cannot change it without rebuilding the frame and interrupting
  playback. A viewer keeps what they got until something remounts — `upgrade()`
  does recompute, so a rotation before a late membership answer can change it.
- **Controls and full-screen permission are separate.** A member on a narrow
  screen drives full screen through the Vimeo API — from the watch tap described
  above, and from the template's own button — so that frame still carries
  `allowfullscreen`.

Frames are built rather than authored so that `controls`, `keyboard` and `pip`
are correct *at load* for this particular viewer. `keyboard` and `pip` follow
the **native** decision — both off whenever the template's controls are in
charge, which is every gated viewer and any member on a narrow screen.
`controls` follows **gated**, with an iOS exception: an ungated frame
carries Vimeo's bar, even a narrow one, **except** a custom/narrow iOS
player. Inline the template UI is still in charge (`data-sv-player="custom"`,
the overlay intercepts taps so Vimeo's bar idles); the enabled bar exists so
that when the browser fullscreens the iframe, fullscreen has pause, scrub,
volume and a visible exit. iPhone fullscreen is the OS player, so that bar
would only paint Vimeo's Unmute chip on the muted ambient loop — a narrow
iOS frame stays `controls=0`. Wide iOS still uses Vimeo's native UI. Gated
frames stay `controls=0`. The full-screen attributes follow the **gated**
decision too: a gated frame gets `allow="autoplay"`, an ungated one gets
`allow="autoplay; fullscreen"` plus `allowfullscreen`.

Turning off `keyboard` and `pip` closes two bypass routes deliberately, not
incidentally: arrow keys seek, and a picture-in-picture window ships its own
scrubber outside our control. Full screen is withheld from a gated viewer for the
opposite reason — full screen with no visible controls would strand them with no
interface at all.

**The module never writes an inline `display` on `#fullscreenBtn`.** That button
carries Memberstack's own `data-ms-content="members"`, and an inline style from us
on an element Memberstack meant to hide is how a members-only control leaks when
the two answers disagree. The module writes only the diagnostic
`data-sv-fullscreen` attribute.

## Markup

Found by **attribute or id only, never by class**. A test asserts the file never
touches `classList`.

Authored for this module:

| Attribute | On | Purpose |
| --- | --- | --- |
| `data-session-video="root"` | hero wrapper | Scopes everything below it. Several roots on one page are independent. |
| `data-session-video-id` | root | Vimeo ID, CMS-bound to the `id-video-for-waching` field. A root without one is skipped and the page is left as authored. |
| `data-session-video-cut` | root | Optional seconds before the wall. Empty or unusable falls back to 180. |
| `data-session-video-bg` | root | Optional ambient-loop length in seconds. Empty or unusable falls back to 20. |
| `data-session-video-native-min` | root | Optional minimum player width in px (default 768). Below it the template's UI is in charge (not Vimeo's), a confirmed member's watch tap goes fullscreen, and leaving fullscreen pauses. Read once at mount. |
| `data-session-video="stage"` | inside root | The iframe is built in here. Without it nothing mounts. |
| `data-session-video="signup-trigger"` | inside root, hidden | The element the module clicks to open the wall. Carries `modal.js`'s own `data-modal-trigger`. |

Absorbed from the template — pre-existing, do not rename:

| Selector | Role |
| --- | --- |
| `[data-element="hero-element"]` | The overlay |
| `[data-element-trigger="show-video"]` | The watch control |
| `#video-controls` | The template's control bar |
| `#playPauseBtn` | Play / pause |
| `#muteBtn` | Mute / unmute |
| `#fullscreenBtn` | Full screen |
| `#videoClickOverlay` | Click-to-toggle layer over the video |

The id-based controls are resolved **inside the root first**, falling back to the
document. Resolving them document-wide meant two roots on one page bound their
listeners to the same `#playPauseBtn`, so one press played and then immediately
paused.

**No modal id lives in the file.** The trigger carries `modal.js`'s
`data-modal-trigger`, authored in the Designer, so `modal.js` needs no public
API and which modal opens stays an authoring decision. A test pins that.

The template's controls are `<div>`s, so the module gives them button semantics
itself rather than requiring a Designer change: `role="button"`, a `tabindex`, an
`aria-label` that names the action the next press performs, and both click and
Enter/Space handling. `#videoClickOverlay` is the exception — a pointer-only
surface with no role or tabindex, because keyboard users have the named watch
and play controls. The watch control's label becomes "Watch the session in full
screen" when a tap will enter fullscreen.

## State attributes

State is written as **attributes** for the template's CSS to react to — never
classes.

| Attribute | On | Values | Meaning |
| --- | --- | --- | --- |
| `data-sv-player` | root | `native` \| `custom` | Which UI is in charge |
| `data-sv-video` | root | `loading` \| `ready` | `ready` once the video is genuinely playing, except on the no-library member path, which has no progress event to wait for and writes `ready` at mount |
| `data-sv-overlay` | `[data-element="hero-element"]` | `visible` \| `hidden` | Overlay state |
| `data-sv-controls` | `#video-controls` | `visible` \| `hidden` | Control-bar state |
| `data-sv-play` | `#playPauseBtn` | `playing` \| `paused` | Playback state |
| `data-sv-mute` | `#muteBtn` | `on` \| `off` | `on` means the video is muted |
| `data-sv-fullscreen` | `#fullscreenBtn` | `visible` \| `hidden` | `visible` only for an ungated viewer holding a player object; `hidden` everywhere else |

`data-sv-player="native"` is the CSS's cue to lift `pointer-events` onto the
iframe, hide `#videoClickOverlay` (it would otherwise swallow every click meant
for Vimeo's bar) and hide the template's own control bar.

`data-sv-video` retires an optional `[data-sv-poster]` cover image authored
*inside* the stage, and **deliberately never retires it if the video never
loads**. The one exception is the no-library member fallback: with no player
object there is no `timeupdate` to prove pixels are on screen, so that path
writes `ready` at mount and the poster is retired immediately rather than
covering a player that may well be working. `ready` is preserved across a
remount: an upgrade replaces the frame
under a video that is already showing pixels, and resetting to `loading` re-covered
it with the poster for a beat.

A pause re-shows the overlay and hides the controls — the template's existing
behaviour — and **any** resume clears them again, not just the watch control, so
the watch control doubles as resume. Leaving both on screen put the controls
underneath the returning overlay; and a member pausing on Vimeo's own bar and
pressing native play was left watching from behind the returned overlay with no
route back.

## Required of the template

Not written by this module, and the gate is wrong without them:

- **The inline hero-video script must be removed.** This module replaces it.
- `#fullscreenBtn` carries Memberstack's `data-ms-content="members"`.
- The CSS carries `#fullscreenBtn[data-sv-fullscreen="hidden"] { display: none }`.
  **The attribute reads `visible` only for an ungated viewer holding a player
  object.** It is `hidden` on every path where membership is merely assumed (no
  SDK, a rejection, an expired budget — exactly the paths where Memberstack is
  absent too, so nothing else would hide the button), and on the no-API member
  fallback, which is ungated but has no player to drive the request. Without the
  CSS rule the button is visible and inert everywhere the module hides it, and a
  press gives no feedback at all: on a gated mount `bind()` does arm the control
  and its handler returns early, and on the no-API path `bind()` is never called.
  A missing `data-ms-content` on that element warns on staging, so an unauthored
  Designer state surfaces in QA rather than shipping as a members-only control
  nobody is hiding.
- Whatever CSS sized the authored iframe still has to match the built one. The
  existing `.hero-video-wrap iframe` rule sizes any iframe created inside that
  wrapper, so it keeps working if the stage sits there; retarget it at the stage
  attribute if the stage sits anywhere else.
- The signup trigger carries a `data-modal-trigger` pointing at the signup modal.

CMS-bound attributes can only be authored in the Designer and are invisible to
the site's data API, so `data-session-video-id` and the optional overrides cannot
be set or verified programmatically.

## Events and diagnostics

Window events, emitted with `{ videoId, cut, bg, gated, armed, position }`. No
destination is wired — consuming them is separate work.

| Event | When |
| --- | --- |
| `session-video-preview-start` | First watch click. Once only: `upgrade()` re-runs the watch transition, and a second event would double-count the funnel. |
| `session-video-wall` | First time the wall opens. Once only; re-opens are not re-emitted. |
| `session-video-complete` | Playback ended. |

`window.StartersSessionVideo` exposes `release`, `status()` for per-root state,
and `reveal()` to force the wall.

`console` diagnostics are emitted on staging hosts (`*.webflow.io`, `localhost`,
`127.0.0.1`, `*.trycloudflare.com`) and when `window.STARTERS_DEBUG === true`;
production is silent.

Every Vimeo call is routed through a `safe()` wrapper, because `play()` rejects
with `NotAllowedError` when autoplay is refused and with `PlayInterrupted`
whenever a pause or seek lands on top of it — which the freeze does deliberately.
Nothing may reject into the page; a test greps for unguarded player promises.

## Tests

[`session-video.test.js`](session-video.test.js) reads the source as text and
evaluates it in a sandbox against a hand-built minimal DOM with one fake
`Vimeo.Player`, following the harness style already used by
[`learn-cta-gate.test.js`](../learn-cta-gate/learn-cta-gate.test.js).

Two harness rules exist because breaking them shipped real bugs:

- The fake `childNodes` is **NodeList-shaped on purpose** (length, `item`,
  `forEach`, indexed access — no `indexOf`, `splice`, `find`, `map` or `push`). A
  harness that fakes a DOM collection as an Array greenlit code that threw in
  every browser.
- A stub that encodes an assumption cannot falsify it. The old tests stubbed
  `memberReady` as resolving `null` when logged out, which is not what the site
  does, so they passed while the gate was completely inert.

Spec, plan and tickets live outside this repo in
`starters-git/.scratch/sessions-video-gate/`. Note that the plan predates the
shipped module and still describes markup that was never built (a `play` element,
a `progress` element, an `upsell-trigger`, and a sessionStorage resume marker);
this document and the module header describe what actually ships.
