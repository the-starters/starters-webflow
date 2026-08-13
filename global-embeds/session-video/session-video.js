/**
 * Session video gate — the Learn Sessions hero player, with a free preview for
 * logged-out visitors and the signup wall after it.
 *
 * @release v1.59.229
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with `defer` in the Learn
 * Sessions template's before-</body> code. It REPLACES the template's inline
 * hero-video script; do not run both.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES
 *
 *   1. BACKGROUND phase. The video autoplays muted and loops inside the first
 *      `data-session-video-bg` seconds (default 20) as an ambient hero. The gate
 *      is NOT armed here.
 *   2. The visitor clicks [data-element-trigger="show-video"]. The overlay hides,
 *      the controls appear, sound comes on, looping stops, and the gate arms.
 *      Playback CONTINUES from where the ambient loop was — it does not restart.
 *   3. For a logged-out visitor, playback freezes at `data-session-video-cut`
 *      seconds (default 180) and the signup trigger is clicked. Dismissing the
 *      modal leaves the frame frozen; any play attempt reopens it.
 *   4. A member gets the whole video, fullscreen included, and never sees a wall.
 *   5. A confirmed member whose player box is NARROWER than the native-controls
 *      threshold (read once at mount — a later rotation does not rebuild) goes
 *      fullscreen on the watch tap — the same tap, plus a fullscreen request
 *      fired inside that gesture. On iPhone that is the device's own player; on
 *      Android and narrow desktop the browser fullscreens our iframe, which
 *      carries Vimeo's bar so fullscreen has pause, scrub, volume and exit.
 *      iPhone stays controls=0 on that narrow frame so the muted ambient loop
 *      does not paint Vimeo's Unmute chip. Inline, the template UI stays in
 *      charge. Only on a genuine activation
 *      (see enterFullscreen), never for a gated viewer, and never above the
 *      threshold as measured at mount, where Vimeo's own bar already carries
 *      the button. An early tap on a not-yet-upgraded frame, or a refused
 *      request, plays inline exactly as (3) and (4) describe — that fallback is
 *      the designed outcome, not an error.
 *      LEAVING fullscreen pauses: the shipped pause shape returns (overlay back,
 *      controls hidden) with the position pinned, and the next watch tap re-enters
 *      fullscreen from there, cycle after cycle. See onFullscreenChange().
 *      BEFORE THE GATE ARMS, any tap that starts the watch is that member's route
 *      into fullscreen — the watch control, #videoClickOverlay and #playPauseBtn
 *      all run the same transition through watch(), so all three enter. ONCE
 *      ARMED, only the watch control re-enters; the other two are back to being
 *      plain play/pause.
 *
 * WHY THE BACKGROUND PHASE MUST NOT ARM THE GATE. An ambient loop left running
 * would eventually cross the cut point on its own and throw the signup wall at
 * somebody who never asked to watch anything, possibly while they were reading
 * further down the page. Arming on the watch click is what prevents that. The
 * loop is also capped inside the teaser window, because otherwise a page left
 * open would roll past the cut point while muted and the watch click would then
 * freeze instantly and look broken.
 *
 * ---------------------------------------------------------------------------
 * MEMBERSHIP COMES FROM getCurrentMember(), NOT FROM memberReady's VALUE.
 *
 * This is the bug that made v1.59.170 inert: `window.memberReady` on this site
 * resolves with an EMPTY OBJECT `{}` for every visitor, logged in or not. It
 * signals *when* Memberstack has settled, not *who* is watching. Treating its
 * resolved value as the answer made `!!{}` true for everyone, so every visitor
 * was classified as a member and the gate never engaged at all. Verified live on
 * staging while logged out: memberReady resolved `{}` while
 * `getCurrentMember()` returned `{ data: null }` and there were no Memberstack
 * cookies. So: await memberReady for readiness, then ask getCurrentMember and
 * test `data`. Do not "simplify" this back.
 *
 * IT MOUNTS GATED FIRST, THEN UPGRADES. `fullscreen` is not a Vimeo embed option;
 * it is governed by the iframe's `allowfullscreen` / `allow` attributes, and
 * permissions policy is evaluated at iframe load and NEVER re-evaluated. So the
 * frame cannot be amended once built — it has to be rebuilt. Rather than delay
 * every visitor's hero by up to MEMBER_BUDGET_MS waiting to find out who they
 * are, the ambient phase (muted, looping, no controls, no fullscreen) mounts
 * immediately in the GATED shape, which is both the safe default and correct for
 * a logged-out viewer, and `upgrade()` rebuilds the frame if membership comes
 * back a member. Membership resolution runs in PARALLEL with the library load,
 * never chained behind it.
 *
 * FAIL CLOSED, unlike learn-cta-gate.js which fails open. That embed risks
 * trapping a member on a scroll-locked page; a gate that never appears is safer
 * there. Here a clamped member reloads and recovers, whereas a leaked video is
 * gone, and this file never locks scroll.
 *
 * ---------------------------------------------------------------------------
 * MARKUP. Found by ATTRIBUTE or ID only — never by class.
 *
 *   [data-session-video="root"]            wrapper containing everything below
 *     data-session-video-id                Vimeo ID, CMS-bound
 *     data-session-video-cut               optional seconds, default 180
 *     data-session-video-bg                optional seconds, default 20
 *     data-session-video-native-min        optional px, default 768. Below this
 *                                          player width (read once at mount)
 *                                          nobody gets Vimeo's UI in charge —
 *                                          the template overlay and bar stay in
 *                                          front. For a confirmed member it also
 *                                          means the watch tap goes fullscreen
 *                                          and leaving fullscreen pauses. The
 *                                          iframe still carries Vimeo's bar
 *                                          (controls=1) so Android/desktop
 *                                          iframe-fullscreen has an interface.
 *                                          iPhone uses the OS player, so a
 *                                          narrow iOS frame stays controls=0
 *                                          and does not paint Vimeo's Unmute
 *                                          chip on the muted ambient loop.
 *                                          keyboard and pip stay off.
 *   [data-session-video="stage"]           the iframe is built in here
 *   [data-session-video="signup-trigger"]  hidden; carries data-modal-trigger
 *
 * Absorbed from the template (pre-existing, do not rename):
 *   [data-element="hero-element"]           the overlay
 *   [data-element-trigger="show-video"]     the watch control
 *   #video-controls  #playPauseBtn  #muteBtn  #fullscreenBtn  #videoClickOverlay
 *
 * REQUIRED OF THE TEMPLATE, not written by this file:
 *   #fullscreenBtn carries Memberstack's `data-ms-content="members"`, and the CSS
 *   carries `#fullscreenBtn[data-sv-fullscreen="hidden"] { display: none }`. This
 *   file writes the attribute and never an inline style — see showFullscreen().
 *
 * STATE IS WRITTEN AS ATTRIBUTES, for the template's CSS to react to:
 *   [data-session-video="root"]    data-sv-player   native | custom
 *   [data-session-video="root"]    data-sv-video    loading | ready
 *   [data-element="hero-element"]  data-sv-overlay  hidden | visible
 *   #video-controls                data-sv-controls visible | hidden
 *   #playPauseBtn                  data-sv-play     playing | paused
 *   #muteBtn                       data-sv-mute     on | off
 *   #fullscreenBtn                 data-sv-fullscreen hidden | visible
 *
 * `data-sv-player="native"` is the CSS's cue to lift `pointer-events` onto the
 * iframe, hide `#videoClickOverlay` (it would swallow every click meant for
 * Vimeo's bar) and hide the template's own control bar.
 *
 * OPTIONAL, authored by the Designer: an `[data-sv-poster]` cover image INSIDE
 * the stage. `data-sv-video` retires it once the video is genuinely playing, and
 * deliberately never does so if the video never loads.
 *
 * NO MODAL ID LIVES IN THIS FILE. The trigger carries modal.js's own
 * `data-modal-trigger`, authored in the Designer, and this file only clicks it —
 * so modal.js needs no public API. A test pins that.
 *
 * Debug: `StartersSessionVideo.status()`, or force the wall with `.reveal()`.
 */
;(function () {
  'use strict'

  if (window.__startersSessionVideoBooted) return
  window.__startersSessionVideoBooted = true

  var RELEASE = 'v1.59.229'
  var LIB_SRC = 'https://player.vimeo.com/api/player.js'
  var DEFAULT_CUT_SECONDS = 180
  var DEFAULT_BG_SECONDS = 20
  var MEMBER_BUDGET_MS = 1200
  var LIB_BUDGET_MS = 6000

  // Vimeo drops its full-screen button and lets its control bar overflow below
  // roughly this width — measured on a bare player at 375px: no play button, no
  // full screen, no quality, and `scrollWidth > clientWidth` on the bar itself.
  // Its native UI is cross-origin, so no CSS of ours can repair it. Below this
  // width EVERYONE gets the template's own controls in charge, member or not.
  // Ungated non-iOS frames still load Vimeo's bar (see showsVimeoControls) so
  // a fullscreen of the iframe has an interface. iPhone does not: the OS
  // player covers fullscreen, and controls=1 on a muted ambient loop paints
  // Vimeo's Unmute chip over the site header.
  var NATIVE_MIN_WIDTH = 768

  var ROOT_SELECTOR = '[data-session-video="root"]'
  var ATTR_ID = 'data-session-video-id'
  var ATTR_CUT = 'data-session-video-cut'
  var ATTR_BG = 'data-session-video-bg'
  var ATTR_NATIVE_MIN = 'data-session-video-native-min'

  var STAGING_HOST = /(^|\.)webflow\.io$|^localhost$|^127\.0\.0\.1$|(^|\.)trycloudflare\.com$/

  function diagnostic() {
    return STAGING_HOST.test(window.location.hostname || '') || window.STARTERS_DEBUG === true
  }
  function warn(m) {
    if (diagnostic()) console.warn('[session-video] ' + m)
  }
  function info(m) {
    if (diagnostic()) console.info('[session-video] ' + m)
  }

  /**
   * Nothing in this repo may throw into the page, and every Vimeo call returns a
   * promise that really does reject: play() gives NotAllowedError when autoplay
   * is refused and PlayInterrupted whenever a pause or seek lands on top of it —
   * which freeze() does deliberately. Terminate every chain here rather than
   * remembering at each call site.
   */
  function safe(p) {
    if (p && typeof p.catch === 'function') p.catch(function () {})
    return p
  }

  function part(root, name) {
    return root.querySelector('[data-session-video="' + name + '"]')
  }
  function byId(id) {
    return document.getElementById(id)
  }
  function setState(el, attr, value) {
    if (el) el.setAttribute(attr, value)
  }

  /** A positive number from an attribute, or the default for empty/unusable. */
  function positiveNumber(root, attr, fallback) {
    var raw = root.getAttribute(attr)
    if (raw === null || String(raw).trim() === '') return fallback
    var n = Number(raw)
    if (!isFinite(n) || n <= 0) {
      warn('unusable ' + attr + ' "' + raw + '", using ' + fallback)
      return fallback
    }
    return n
  }

  /**
   * Is the player box wide enough for Vimeo's own controls to be usable? Measured
   * at mount, because the iframe's `controls` parameter is fixed at load and a
   * rotation cannot change it without rebuilding the frame, which would interrupt
   * playback. So a viewer keeps what they got unless something else remounts —
   * `upgrade()` does recompute, so a rotation before a late membership answer can
   * change it.
   */
  function wideEnough(root) {
    var min = positiveNumber(root, ATTR_NATIVE_MIN, NATIVE_MIN_WIDTH)
    // The player's own box, not the window: the evidence for this threshold is a
    // 375px PLAYER, and a wide window with a narrow hero column gets exactly the
    // same broken Vimeo UI. Falls back to the viewport, then to 0 — and 0 resolves
    // to the template's own controls, which always work.
    var w = 0
    var stage = part(root, 'stage') || root
    if (stage && typeof stage.getBoundingClientRect === 'function') {
      var rect = stage.getBoundingClientRect()
      w = (rect && rect.width) || 0
    }
    if (!w) w = window.innerWidth || 0
    return w >= min
  }

  function emit(name, detail) {
    if (typeof window.CustomEvent !== 'function') return
    window.dispatchEvent(new window.CustomEvent(name, { detail: detail }))
  }

  /**
   * Is a member watching? See the header: memberReady is a readiness signal that
   * resolves `{}` for everybody, so the answer comes from getCurrentMember().
   * Returns {member, certain}. `certain` is true only when getCurrentMember
   * actually answered; anything else means "assume logged out FOR NOW" and the
   * caller must keep watching for a late answer.
   */
  function resolveMember() {
    return new Promise(function (resolve) {
      var decided = false
      // `certain` is true ONLY when getCurrentMember actually answered. A missing
      // SDK, a rejection or an expired budget all mean "assume logged out for now",
      // and the caller must keep watching for a late answer — otherwise a member
      // whose SDK loaded after us stays gated for the whole page life.
      function done(member, certain) {
        if (decided) return
        decided = true
        resolve({ member: member, certain: !!certain })
      }

      window.setTimeout(function () {
        warn('membership unresolved after ' + MEMBER_BUDGET_MS + 'ms; gating')
        done(false, false)
      }, MEMBER_BUDGET_MS)

      function ask() {
        var ms = window.$memberstackDom
        if (!ms || typeof ms.getCurrentMember !== 'function') {
          warn('$memberstackDom.getCurrentMember unavailable; treating as logged out')
          done(false, false)
          return
        }
        try {
          ms.getCurrentMember().then(
            function (res) {
              // `{ data: null }` is a logged-out visitor. Anything with a data
              // object is a member. Never test the envelope itself.
              done(!!(res && res.data), true)
            },
            function () {
              warn('getCurrentMember rejected; treating as logged out')
              done(false, false)
            },
          )
        } catch (e) {
          warn('getCurrentMember threw; treating as logged out')
          done(false, false)
        }
      }

      var ready = window.memberReady
      if (ready && typeof ready.then === 'function') ready.then(ask, ask)
      else ask()
    })
  }

  /** Load player.js once. Resolves false if it does not arrive in budget. */
  function ensureLib() {
    if (window.Vimeo && window.Vimeo.Player) return Promise.resolve(true)
    return new Promise(function (resolve) {
      var done = false
      function finish(ok) {
        if (done) return
        done = true
        resolve(ok)
      }
      var el = document.createElement('script')
      el.src = LIB_SRC
      el.async = true
      el.onload = function () {
        finish(!!(window.Vimeo && window.Vimeo.Player))
      }
      el.onerror = function () {
        finish(false)
      }
      document.body.append(el)
      window.setTimeout(function () {
        finish(!!(window.Vimeo && window.Vimeo.Player))
      }, LIB_BUDGET_MS)
    })
  }

  /**
   * iPhone / iPad / iPod, including iPadOS that reports as Mac.
   * iPhone fullscreen is the OS player, so a muted ambient iframe with
   * controls=1 only adds Vimeo's Unmute chip — it does not add a useful bar.
   */
  function isIos() {
    var nav = window.navigator
    if (!nav) return false
    var ua = nav.userAgent || ''
    if (/iPad|iPhone|iPod/.test(ua)) return true
    return nav.platform === 'MacIntel' && Number(nav.maxTouchPoints) > 1
  }

  /**
   * Vimeo's control bar is ON for an ungated frame that is not a narrow iOS
   * player. `player.requestFullscreen()` fullscreens the iframe; with
   * controls=0 that is a bare video filling the screen — no pause, scrub,
   * volume, or visible exit — on Android Chrome and narrow desktop. iPhone
   * masks this via the OS player, so a custom/narrow iOS frame stays
   * controls=0 and does not paint Vimeo's Unmute chip on the muted ambient
   * loop. Wide iOS still uses Vimeo's native UI. Inline, the template UI
   * stays in charge (`data-sv-player=custom`, #videoClickOverlay intercepts
   * taps). Gated frames stay controls=0: a scrubber would advertise the full
   * runtime and make the wall look abrupt.
   */
  function showsVimeoControls(gated, native) {
    if (gated) return false
    if (isIos() && !native) return false
    return true
  }

  /**
   * Built here rather than authored, so the controls, fullscreen and
   * picture-in-picture attributes are correct AT LOAD for this particular viewer:
   * a gated viewer and a member get different native UI, per the split below.
   */
  function buildFrame(videoId, gated, native) {
    // `native` decides keyboard, pip, and which UI is in charge. `gated` and
    // iOS together decide Vimeo's control bar (see showsVimeoControls). They
    // are separate because a member on a narrow Android/desktop screen keeps
    // the template's overlay in charge inline, but the iframe still carries
    // Vimeo's bar so a fullscreen of that iframe has an interface. A narrow
    // iPhone does not need that bar: fullscreen is the OS player, and the bar
    // would only show Unmute on the muted ambient loop.
    //
    // keyboard and pip stay off on every non-native frame: no keyboard seeking
    // and no picture-in-picture window carrying its own scrubber. Gated frames
    // also omit the control bar. The clamp catches seeks anyway, so a scrubber
    // was never a bypass — it only makes the wall look abrupt and advertises
    // the full runtime.
    var params = [
      'autoplay=1',
      'muted=1',
      'loop=1',
      'controls=' + (showsVimeoControls(gated, native) ? '1' : '0'),
      'keyboard=' + (native ? '1' : '0'),
      'pip=' + (native ? '1' : '0'),
      'title=0',
      'byline=0',
      'portrait=0',
      'dnt=1',
      'playsinline=1',
    ]
    var frame = document.createElement('iframe')
    frame.setAttribute('src', 'https://player.vimeo.com/video/' + videoId + '?' + params.join('&'))
    frame.setAttribute('frameborder', '0')
    frame.setAttribute('title', 'Session video')
    if (gated) {
      frame.setAttribute('allow', 'autoplay')
    } else {
      frame.setAttribute('allow', 'autoplay; fullscreen')
      frame.setAttribute('allowfullscreen', '')
    }
    return frame
  }

  /**
   * The template's controls are <div>s. Ticket 01 requires them operable by
   * mouse, touch AND keyboard, and announced correctly, so give them button
   * semantics without needing the Designer to change the elements.
   */
  function armControl(el, label, onActivate) {
    if (!el) return
    // A null label is a pointer-only surface (#videoClickOverlay). Keyboard
    // users have the named controls; giving this full-bleed layer role=button
    // and tabindex made an unnamed focusable button that could seize the
    // screen on Space.
    if (label) {
      if (el.nodeName !== 'BUTTON') {
        el.setAttribute('role', 'button')
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0')
      }
      if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', label)
    }
    el.addEventListener('click', function (e) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault()
      onActivate(true)
    })
    if (label) {
      el.addEventListener('keydown', function (e) {
        var k = e && e.key
        if (k !== 'Enter' && k !== ' ' && k !== 'Spacebar') return
        if (typeof e.preventDefault === 'function') e.preventDefault()
        onActivate(true)
      })
    }
  }

  function Controller(root) {
    this.root = root
    this.videoId = String(root.getAttribute(ATTR_ID) || '').trim()
    this.cut = positiveNumber(root, ATTR_CUT, DEFAULT_CUT_SECONDS)
    this.bg = positiveNumber(root, ATTR_BG, DEFAULT_BG_SECONDS)
    this.gated = true
    this.armed = false
    this.atWall = false
    this.clamping = false
    this.playing = false
    this.muted = true
    this.position = 0
    this.wallEmitted = false
    this.startEmitted = false
    this.wallOpens = 0
    this.bound = false
    this.ready = false
    this.native = false
    // Is the player box too narrow for Vimeo's own bar to be in charge? Width
    // only, no membership in it. For a member that box is the one where a watch
    // tap goes fullscreen. Set by the ungated mount path (and mountWithoutApi).
    this.narrow = false
  }

  /**
   * Scoped to the root FIRST, falling back to the document. Resolving the
   * controls document-wide meant two roots on one page bound their listeners to
   * the same #playPauseBtn, so one press played and then immediately paused —
   * the very thing bind()'s once-only guard exists to prevent, except that guard
   * is per-controller and these ids are global.
   */
  Controller.prototype.el = function (name) {
    var byRole = {
      overlay: '[data-element="hero-element"]',
      watch: '[data-element-trigger="show-video"]',
    }
    if (byRole[name]) return this.root.querySelector(byRole[name])
    var ids = {
      controls: 'video-controls',
      play: 'playPauseBtn',
      mute: 'muteBtn',
      fullscreen: 'fullscreenBtn',
      click: 'videoClickOverlay',
    }
    var id = ids[name]
    if (!id) return part(this.root, name)
    return this.root.querySelector('[id="' + id + '"]') || byId(id)
  }

  Controller.prototype.detail = function () {
    return {
      videoId: this.videoId,
      cut: this.cut,
      bg: this.bg,
      gated: this.gated,
      armed: this.armed,
      position: this.position,
    }
  }

  Controller.prototype.paintPlay = function (on) {
    this.playing = on
    var el = this.el('play')
    setState(el, 'data-sv-play', on ? 'playing' : 'paused')
    // Announced as well as styled: aria-label carries the action the press will
    // perform, so it never reads as a stuck toggle.
    if (el) el.setAttribute('aria-label', on ? 'Pause the session video' : 'Play the session video')
  }
  Controller.prototype.paintMute = function (m) {
    this.muted = m
    var el = this.el('mute')
    setState(el, 'data-sv-mute', m ? 'on' : 'off')
    if (el) el.setAttribute('aria-label', m ? 'Unmute the session video' : 'Mute the session video')
  }
  Controller.prototype.paintWatch = function () {
    var el = this.el('watch')
    if (!el) return
    el.setAttribute(
      'aria-label',
      this.watchDrivesFullscreen() ? 'Watch the session in full screen' : 'Watch the session',
    )
  }
  Controller.prototype.showOverlay = function (show) {
    setState(this.el('overlay'), 'data-sv-overlay', show ? 'visible' : 'hidden')
  }
  Controller.prototype.showControls = function (show) {
    setState(this.el('controls'), 'data-sv-controls', show ? 'visible' : 'hidden')
  }

  /**
   * The full-screen control is revealed only to an ungated viewer holding a
   * player object to drive the request. Both terms matter: `gated` stays true on
   * every path where membership is merely assumed (no SDK, a rejection, an expired
   * budget) — exactly the paths where Memberstack is absent too, so nothing else
   * would hide the button — and it is false on the no-API member path, which has
   * no player at all and would leave a dead button.
   *
   * The attribute ONLY, never an inline style. This button carries Memberstack's
   * own `data-ms-content="members"`, so Memberstack owns its visibility, and an
   * inline style written by us onto an element Memberstack meant to hide is how a
   * members-only control leaks when the two answers disagree.
   *
   * THE TEMPLATE MUST THEREFORE CARRY
   *   #fullscreenBtn[data-sv-fullscreen="hidden"] { display: none }
   * or the button is visible and inert everywhere we hide it: on a gated mount
   * bind() still arms the control and it is armControl's handler that returns
   * early on `gated`, and on the no-API path bind() is never called at all.
   */
  Controller.prototype.showFullscreen = function () {
    var el = this.el('fullscreen')
    var reachable = !this.gated && !!this.player
    setState(el, 'data-sv-fullscreen', reachable ? 'visible' : 'hidden')
    if (el && !el.hasAttribute('data-ms-content')) {
      warn('#fullscreenBtn carries no data-ms-content; Memberstack is not hiding it for non-members')
    }
  }

  /**
   * Member fallback when player.js never arrived. Still writes the full state
   * contract: without it `data-sv-player` and `data-sv-video` are absent, so the
   * authored poster never retires and #videoClickOverlay keeps swallowing the
   * clicks meant for Vimeo's own bar — a working player nobody can see or reach.
   * Marked `ready` because with no API there is no progress event to wait for.
   */
  Controller.prototype.mountWithoutApi = function () {
    var stage = part(this.root, 'stage')
    if (!stage) return false
    this.gated = false
    // FORCED native, regardless of width. This path has no player object and never
    // calls bind(), so the template's own bar is inert here — reporting `custom` on
    // a narrow screen left a member with a muted, looping, autoplaying video and no
    // play, pause, mute or full-screen route at all, with the CSS also keeping
    // pointer-events off the iframe. Vimeo's cramped bar beats no bar.
    this.native = true
    // Width is still a fact about the box. native is forced; narrow must not lie.
    this.narrow = !wideEnough(this.root)
    stage.append(buildFrame(this.videoId, false, true))
    setState(this.root, 'data-sv-player', 'native')
    setState(this.root, 'data-sv-video', 'ready')
    this.ready = true
    // The overlay, and ONLY the overlay. Left in its authored covering state it
    // sits on top of the very player this path exists to hand over, and the watch
    // control that would lower it is never wired here. The template's own bar is
    // deliberately left alone: `native` above tells the CSS to hide it, and with no
    // player object and no bind() call revealing it would put inert play and mute
    // buttons beside Vimeo's working ones. Nothing paints a play or mute state for
    // the same reason — no event stream can ever correct a guess about playback.
    this.showOverlay(false)
    // Hidden, not visible: `gated` is false here but there is no player object and
    // bind() is deliberately never called, so the template's own button could only
    // be a dead control.
    this.showFullscreen()
    controllers.push(this)
    info('member fallback: native player, no script control')
    return true
  }

  Controller.prototype.mount = function (gated) {
    // Measure only when ungated. A gated mount is always custom, and reading the
    // box here used to thrash layout on every visitor's first paint for a fact
    // that cannot change the gated frame. upgrade() remounts ungated and measures
    // then. One writer of the width fact per path: gated leaves narrow unknown
    // (false); ungated writes both native and narrow from the same reading.
    if (!gated) {
      var wide = wideEnough(this.root)
      this.native = wide
      this.narrow = !wide
    } else {
      this.native = false
      this.narrow = false
    }
    var self = this
    if (!window.Vimeo || typeof window.Vimeo.Player !== 'function') {
      warn('mount called without the Vimeo Player API; refusing to build a frame')
      return false
    }
    this.gated = gated
    var stage = part(this.root, 'stage')
    if (!stage) {
      warn('root has no stage element; nothing mounted')
      return false
    }
    this.frame = buildFrame(this.videoId, gated, this.native)
    stage.append(this.frame)
    this.player = new window.Vimeo.Player(this.frame)

    this.player.on('timeupdate', function (d) {
      self.onTime(d)
    })
    this.player.on('play', function () {
      self.onPlay()
    })
    this.player.on('pause', function () {
      self.onPause()
    })
    this.player.on('seeked', function (d) {
      self.onSeeked(d)
    })
    this.player.on('ended', function () {
      emit('session-video-complete', self.detail())
    })
    // Registered here with the rest, so it survives the upgrade() remount that
    // rebuilds the frame and constructs a new player.
    this.player.on('fullscreenchange', function (d) {
      self.onFullscreenChange(d)
    })

    // Which UI is in charge, for the template's CSS: `native` lifts
    // pointer-events onto the iframe, hides #videoClickOverlay (it would swallow
    // every click meant for Vimeo's bar) and hides the template's own controls.
    setState(this.root, 'data-sv-player', this.native ? 'native' : 'custom')
    // The poster stays up until the video is genuinely playing, which also covers
    // it never loading at all: nothing flips this to `ready` in that case.
    // Preserve `ready` across a remount: an upgrade replaces the frame under a
    // video that is already showing pixels, and resetting to `loading` re-covered
    // it with the poster for a beat.
    setState(this.root, 'data-sv-video', this.ready ? 'ready' : 'loading')

    this.showOverlay(true)
    this.showControls(false)
    this.paintPlay(false)
    this.paintMute(true)

    // A gated viewer can never reach fullscreen, because the frame was built
    // without permission. Hide the control rather than leave a dead button — and
    // hide it too whenever membership is merely assumed. See showFullscreen().
    this.showFullscreen()

    this.bind()
    this.paintWatch()
    return true
  }

  Controller.prototype.bind = function () {
    // Once per root, never per mount: a remount reuses the SAME authored
    // controls, and binding twice makes one activation play and then pause.
    if (this.bound) return
    this.bound = true
    var self = this

    // armControl calls back with `true` from a click or (when labelled) an
    // Enter/Space keydown, so every route through here is a real gesture —
    // which is what licenses the fullscreen request in watch(). upgrade() calls
    // watch() with no argument, and must keep doing so.
    var watch = this.el('watch')
    if (watch) armControl(watch, 'Watch the session', function (byGesture) { self.watch(byGesture) })
    else warn('no [data-element-trigger="show-video"] inside the root')

    armControl(this.el('play'), 'Play or pause the session video', function (byGesture) { self.toggle(byGesture) })
    armControl(this.el('click'), null, function (byGesture) { self.toggle(byGesture) })

    armControl(this.el('mute'), 'Mute or unmute the session video', function () {
      if (!self.player) return
      var next = !self.muted
      safe(self.player.setMuted(next))
      safe(self.player.setVolume(next ? 0 : 1))
      self.paintMute(next)
    })

    armControl(this.el('fullscreen'), 'Full screen', function () {
      // Memberstack hides this button for non-members, but guard anyway: a gated
      // frame carries no full-screen permission, so the request would only fail.
      if (self.gated || !self.player) return
      if (typeof self.player.requestFullscreen === 'function') safe(self.player.requestFullscreen())
    })
  }

  /**
   * Is fullscreen THIS module's to drive for this viewer? Three things at once: a
   * confirmed member (a gated frame is built without the permission), a player box
   * too narrow for Vimeo's own bar, and a player object to send the request to.
   *
   * One predicate, both directions, so entry and exit can never drift apart: the
   * same viewer whose watch tap opens fullscreen is the one whose exit from it
   * pauses. A wide member drives fullscreen through Vimeo's own UI and is not our
   * business in either direction.
   */
  Controller.prototype.watchDrivesFullscreen = function () {
    return !this.gated && !!this.narrow && !!this.player
  }

  /**
   * Straight into fullscreen for a confirmed member whose player box is too
   * narrow for Vimeo's bar to be in charge, fired inside the tap that asked for
   * it. On a phone the inline hero is a postage stamp with our minimal controls,
   * and finding the separate fullscreen button was a second step nobody took.
   * On iPhone the OS takes over; elsewhere the browser fullscreens our iframe,
   * which carries Vimeo's bar so the full-screen surface has an interface.
   *
   * Called from BOTH of watch()'s branches: the first tap starts fullscreen, and
   * every later tap re-enters it from wherever an exit left the position. On a
   * narrow player the watch control always means fullscreen for a member.
   *
   * ONLY ON A REAL USER ACTIVATION. upgrade() re-runs watch() to restore the
   * watching state after rebuilding the frame, and that is not a gesture: browsers
   * only honour a fullscreen request inside one, so attempting it there would
   * trade a member's restored playback for a console error — and hijacking the
   * whole screen because a membership answer arrived late is nobody's request.
   *
   * Who qualifies is watchDrivesFullscreen()'s answer — narrow only, because at or
   * above the threshold Vimeo's own bar is in charge and already carries its own
   * fullscreen button, which is the desktop behaviour members have today; and never
   * gated, because that frame is deliberately built without the permission, so the
   * request could only fail, and the clamp is only enforceable on a surface we still
   * control.
   *
   * A refusal needs no handling. Inline playback with the sound on and the controls
   * up IS the fallback — the whole watch transition has already run by the time this
   * is called — so the rejection dies in safe() and no state is written either way.
   */
  Controller.prototype.enterFullscreen = function (byGesture) {
    if (byGesture !== true) return
    if (!this.watchDrivesFullscreen()) return
    if (typeof this.player.requestFullscreen !== 'function') return
    safe(this.player.requestFullscreen())
    info('member on a narrow player: requested fullscreen from the watch tap')
  }

  /**
   * The watch control: first press starts for real, later presses resume.
   *
   * `byGesture` is true only when a user activation routed here (see bind()); it
   * licenses the fullscreen request and nothing else.
   */
  Controller.prototype.watch = function (byGesture) {
    if (!this.player) return
    if (this.armed) {
      // The wall stays first: a gated viewer tapping a frozen frame gets the wall
      // and nothing else, fullscreen request included.
      if (this.gated && this.atWall) {
        this.openWall()
        return
      }
      this.showOverlay(false)
      this.showControls(true)
      safe(this.player.play())
      // Resume means the same thing as start on a narrow player: back into
      // fullscreen, from the position the exit left pinned. Once armed, the watch
      // control is the ONLY surface that does this — #playPauseBtn and the click
      // layer reach toggle()'s play/pause branch instead of this one, because after
      // an exit-pause the overlay is up and the watch control is what the member is
      // looking at.
      this.enterFullscreen(byGesture)
      return
    }
    this.armed = true
    this.showOverlay(false)
    this.showControls(true)
    safe(this.player.setMuted(false))
    safe(this.player.setVolume(1))
    this.paintMute(false)
    if (typeof this.player.setLoop === 'function') safe(this.player.setLoop(false))
    safe(this.player.play())
    info('watching from ' + this.position.toFixed(1) + 's; gate ' + (this.gated ? 'armed at ' + this.cut + 's' : 'not armed (member)'))
    // Once only: upgrade() re-runs watch() to restore the watching state, and a
    // second preview-start would double-count the funnel.
    if (!this.startEmitted) {
      this.startEmitted = true
      emit('session-video-preview-start', this.detail())
    }
    // LAST, and still inside the tap's own synchronous task. Nothing above may
    // depend on the fullscreen outcome: the transition — overlay down, controls up,
    // sound on, loop off, playing from the ambient position — is the shipped
    // behaviour for everybody and stays that way whether the request is granted,
    // refused, or never made at all.
    this.enterFullscreen(byGesture)
  }

  Controller.prototype.toggle = function (byGesture) {
    if (!this.player) return
    if (this.gated && this.atWall) {
      this.openWall()
      return
    }
    if (!this.armed) {
      // A tap on the hero during the ambient phase IS the watch gesture, so carry
      // the activation through rather than dropping it here.
      this.watch(byGesture)
      return
    }
    if (this.playing) safe(this.player.pause())
    else safe(this.player.play())
  }

  Controller.prototype.onTime = function (d) {
    var s = d && typeof d.seconds === 'number' ? d.seconds : 0
    // First real progress means pixels are on screen: retire the poster.
    if (!this.ready && s > 0) {
      this.ready = true
      setState(this.root, 'data-sv-video', 'ready')
    }
    if (!this.armed) {
      // Ambient phase: keep the loop inside the teaser window so it can never
      // roll past the cut point while muted.
      this.position = s
      if (s >= this.bg && this.player) {
        this.clamping = true
        safe(this.player.setCurrentTime(0))
      } else {
        // Do not let the latch stick: if the seek above never produced a `seeked`,
        // a later genuine one would be swallowed.
        this.clamping = false
      }
      return
    }
    // Already frozen: stay PINNED at the cut point. The player keeps reporting
    // for a few events after pause() is called, and letting those through made
    // the reported position drift past the wall it is supposed to be held at.
    if (this.gated && this.atWall) {
      this.freeze()
      return
    }
    this.position = s
    if (this.gated && s >= this.cut) this.freeze()
  }

  Controller.prototype.onPlay = function () {
    this.paintPlay(true)
    if (this.armed && this.gated && this.atWall) {
      this.freeze()
      return
    }
    // Any resume clears the cover, not just the watch control. A member pausing on
    // Vimeo's own bar and pressing native play was left watching the video from
    // behind the returned overlay, with no way back except the watch button.
    if (this.armed) {
      this.showOverlay(false)
      this.showControls(true)
    }
  }

  /**
   * The template's choice: a pause brings the overlay back. The control bar has to
   * go with it — leaving both on screen put the controls underneath the returning
   * overlay, which is what Jerico saw.
   */
  Controller.prototype.onPause = function () {
    this.paintPlay(false)
    if (!this.armed) return
    this.showOverlay(true)
    this.showControls(false)
  }

  /**
   * Leaving fullscreen is treated as a pause: the member said "done for now", and
   * audio continuing in a postage-stamp hero is not what an exit means.
   *
   * It calls pause() and lets the SHIPPED pause handler produce the shape — overlay
   * back, controls hidden, play state repainted — rather than painting a second
   * version of it here that could drift from the real one. The position is pinned by
   * doing nothing to it: nothing seeks, so `position` still holds the last reported
   * second and the next watch tap resumes from there. No `playing` guard: onPause is
   * idempotent, and skipping the call on a stale belief about playback is how a
   * member ends up behind an overlay that never returned.
   *
   * ONE EVENT, BOTH DIRECTIONS. Vimeo reports entering fullscreen on this event too,
   * so only an explicit `fullscreen: false` acts — anything else, including an event
   * with no usable data at all, is ignored. If some platform never emits it the
   * failure mode is "no pause on exit", never an error or a stuck frame.
   *
   * SAME VIEWER AS THE ENTRY PATH, by the same predicate: whoever's watch tap opens
   * fullscreen is whoever's exit from it pauses. A wide member enters fullscreen
   * through Vimeo's own UI and keeps today's behaviour untouched; a gated viewer has
   * no fullscreen to leave.
   */
  Controller.prototype.onFullscreenChange = function (d) {
    if (!d || typeof d.fullscreen === 'undefined') return
    if (d.fullscreen) return
    if (!this.watchDrivesFullscreen()) return
    // Ambient loop: pause() would fire, onPause would return early on !armed,
    // timeupdates would stop, and the muted hero would freeze.
    if (!this.armed) return
    safe(this.player.pause())
    info('left fullscreen at ' + this.position.toFixed(1) + 's; pausing')
  }

  Controller.prototype.onSeeked = function (d) {
    if (this.clamping) {
      this.clamping = false
      return
    }
    var s = d && typeof d.seconds === 'number' ? d.seconds : 0
    this.position = s
    if (this.armed && this.gated && s >= this.cut) this.freeze()
  }

  /**
   * Freeze at the cut point. Idempotent: the player emits several timeupdates
   * before a pause takes effect, and re-opening the wall is the job of a PLAY
   * attempt, not of arriving at the cut point again.
   */
  Controller.prototype.freeze = function () {
    if (this.atWall) {
      if (this.player) safe(this.player.pause())
      return
    }
    this.atWall = true
    this.position = this.cut
    if (this.player) {
      safe(this.player.pause())
      this.clamping = true
      safe(this.player.setCurrentTime(this.cut))
    }
    this.paintPlay(false)
    this.openWall()
  }

  Controller.prototype.openWall = function () {
    this.wallOpens += 1
    if (!this.wallEmitted) {
      this.wallEmitted = true
      emit('session-video-wall', this.detail())
    }
    var trigger = part(this.root, 'signup-trigger')
    if (!trigger) {
      warn('no signup-trigger authored; the wall cannot open')
      return
    }
    trigger.click()
  }

  /** Late membership: swap the gated frame for a full one, same position. */
  Controller.prototype.upgrade = function () {
    if (!this.gated) return
    var at = this.position
    var wasArmed = this.armed
    if (this.player && typeof this.player.destroy === 'function') safe(this.player.destroy())
    // childNodes is a NodeList: no indexOf, no splice. Use remove().
    if (this.frame && typeof this.frame.remove === 'function') this.frame.remove()
    this.atWall = false
    this.clamping = false
    this.armed = false
    this.wallEmitted = true
    if (!this.mount(false)) return
    if (at > 0 && this.player) safe(this.player.setCurrentTime(at))
    if (wasArmed) this.watch()
    info('upgraded to the full video after late membership')
  }

  var controllers = []

  /**
   * WHY MOUNT BEFORE KNOWING THE VIEWER, when the header says the opposite.
   *
   * The ambient phase is identical for everybody: muted, looping, no controls, no
   * fullscreen. Only the WATCH transition differs. Waiting on membership before
   * mounting cost every visitor up to MEMBER_BUDGET_MS of empty hero, which is the
   * slow start Jerico reported.
   *
   * So mount gated immediately — that is the safe shape, and the correct one for a
   * logged-out visitor — and upgrade in the background if membership comes back a
   * member. Fullscreen permission is still fixed at frame load, which is exactly
   * why the upgrade path REBUILDS the frame rather than amending it.
   */
  function boot() {
    var roots = document.querySelectorAll(ROOT_SELECTOR)
    if (!roots || !roots.length) return
    // Started NOW, not after the library. Chaining it behind ensureLib() put the
    // membership clock behind up to LIB_BUDGET_MS, so a member could click watch
    // before the answer landed and have the frame rebuilt under them mid-play.
    var memberPromise = resolveMember()
    ensureLib().then(function (lib) {
      var pending = []
      var noLib = []
      for (var i = 0; i < roots.length; i += 1) {
        var c = new Controller(roots[i])
        if (!c.videoId) {
          info('root has no ' + ATTR_ID + '; leaving the page as authored')
          continue
        }
        if (!lib) {
          // No player API means no way to clamp, so a gated viewer gets nothing
          // rather than the whole video. A member still deserves the video, but we
          // do not know yet whether this is one — so defer that to the answer.
          warn('player library unavailable')
          noLib.push(c)
          continue
        }
        if (!c.mount(true)) continue
        controllers.push(c)
        pending.push(c)
      }
      if (!pending.length && !noLib.length) return
      return memberPromise.then(function (state) {
        info('viewer is ' + (state.member ? 'a member' : 'logged out') + (state.certain ? '' : ' (unconfirmed)'))
        // Only getCurrentMember answering with a member is confirmation; everything
        // else is "assume logged out for now", which must not be paid out as if we
        // knew who was watching.
        var confirmed = !!(state.member && state.certain)
        pending.forEach(function (c) {
          if (confirmed) c.upgrade()
          else if (!state.certain) watchForLateMember(c, function () { c.upgrade() })
        })
        noLib.forEach(function (c) {
          if (!confirmed) {
            // Not confirmed logged out? Keep asking, or a member with both a slow
            // SDK and a failed library gets nothing for the page's whole life. A
            // noLib controller was never mounted with the API, so a late answer must
            // go through mountWithoutApi() — routing it through upgrade()/mount()
            // would touch window.Vimeo.Player, which is exactly what is missing here.
            if (!state.certain) watchForLateMember(c, function () { c.mountWithoutApi() })
            return
          }
          c.mountWithoutApi()
        })
      })
    }).catch(function (e) {
      warn('boot failed: ' + (e && e.message ? e.message : e))
    })
  }

  function watchForLateMember(c, onLate) {
    var ms = window.$memberstackDom
    if (!ms || typeof ms.getCurrentMember !== 'function') return
    var handler = onLate || function () { c.upgrade() }
    try {
      var p = ms.getCurrentMember().then(function (res) {
        if (res && res.data) handler()
      }, function () {})
      // Terminate the chain: handler() may build a frame, and nothing may reject
      // into the page.
      if (p && typeof p.catch === 'function') p.catch(function () {})
    } catch (e) {
      /* never throws into the page */
    }
  }

  window.StartersSessionVideo = {
    release: RELEASE,
    status: function () {
      return {
        release: RELEASE,
        roots: controllers.length,
        sessions: controllers.map(function (c) {
          return {
            videoId: c.videoId,
            cut: c.cut,
            bg: c.bg,
            gated: c.gated,
            armed: c.armed,
            atWall: c.atWall,
            playing: c.playing,
            muted: c.muted,
            position: c.position,
            player: c.native ? 'native' : 'custom',
            narrow: !!c.narrow,
            fullscreenTap: c.watchDrivesFullscreen(),
            videoReady: c.ready,
            wallOpens: c.wallOpens,
          }
        }),
      }
    },
    reveal: function () {
      controllers.forEach(function (c) {
        c.armed = true
        c.freeze()
      })
    },
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
