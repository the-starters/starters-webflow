/**
 * Session video gate — the Learn Sessions hero player, with a free preview for
 * logged-out visitors and the signup wall after it.
 *
 * @release v1.59.179
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
 * MEMBER STATE IS RESOLVED BEFORE MOUNT. `fullscreen` is not a Vimeo embed
 * option; it is governed by the iframe's `allowfullscreen` / `allow` attributes,
 * and permissions policy is evaluated at iframe load and never re-evaluated. So
 * a frame built before we know the viewer is either fullscreen-capable for a
 * non-member (a bypass) or fullscreen-less for a member (a downgrade). Hence the
 * budget below, and a remount if membership resolves late.
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
 *   [data-session-video="stage"]           the iframe is built in here
 *   [data-session-video="signup-trigger"]  hidden; carries data-modal-trigger
 *
 * Absorbed from the template (pre-existing, do not rename):
 *   [data-element="hero-element"]           the overlay
 *   [data-element-trigger="show-video"]     the watch control
 *   #video-controls  #playPauseBtn  #muteBtn  #fullscreenBtn  #videoClickOverlay
 *
 * STATE IS WRITTEN AS ATTRIBUTES, for the template's CSS to react to:
 *   [data-element="hero-element"]  data-sv-overlay  hidden | visible
 *   #video-controls                data-sv-controls visible | hidden
 *   #playPauseBtn                  data-sv-play     playing | paused
 *   #muteBtn                       data-sv-mute     on | off
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

  var RELEASE = 'v1.59.179'
  var LIB_SRC = 'https://player.vimeo.com/api/player.js'
  var DEFAULT_CUT_SECONDS = 180
  var DEFAULT_BG_SECONDS = 20
  var MEMBER_BUDGET_MS = 1200
  var LIB_BUDGET_MS = 6000

  var ROOT_SELECTOR = '[data-session-video="root"]'
  var ATTR_ID = 'data-session-video-id'
  var ATTR_CUT = 'data-session-video-cut'
  var ATTR_BG = 'data-session-video-bg'

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

  /** Positive seconds from an attribute, or the default for empty/unusable. */
  function seconds(root, attr, fallback) {
    var raw = root.getAttribute(attr)
    if (raw === null || String(raw).trim() === '') return fallback
    var n = Number(raw)
    if (!isFinite(n) || n <= 0) {
      warn('unusable ' + attr + ' "' + raw + '", using ' + fallback)
      return fallback
    }
    return n
  }

  function emit(name, detail) {
    if (typeof window.CustomEvent !== 'function') return
    window.dispatchEvent(new window.CustomEvent(name, { detail: detail }))
  }

  /**
   * Is a member watching? See the header: memberReady is a readiness signal that
   * resolves `{}` for everybody, so the answer comes from getCurrentMember().
   * Returns {member, settled}; settled false means the budget expired and the
   * caller must fail closed.
   */
  function resolveMember() {
    return new Promise(function (resolve) {
      var decided = false
      // `certain` is true ONLY when getCurrentMember actually answered. A missing
      // SDK, a rejection or an expired budget all mean "assume logged out for now",
      // and the caller must keep watching for a late answer — otherwise a member
      // whose SDK loaded after us stays gated for the whole page life.
      function done(member, settled, certain) {
        if (decided) return
        decided = true
        resolve({ member: member, settled: settled, certain: !!certain })
      }

      window.setTimeout(function () {
        warn('membership unresolved after ' + MEMBER_BUDGET_MS + 'ms; gating')
        done(false, false, false)
      }, MEMBER_BUDGET_MS)

      function ask() {
        var ms = window.$memberstackDom
        if (!ms || typeof ms.getCurrentMember !== 'function') {
          warn('$memberstackDom.getCurrentMember unavailable; treating as logged out')
          done(false, true, false)
          return
        }
        try {
          ms.getCurrentMember().then(
            function (res) {
              // `{ data: null }` is a logged-out visitor. Anything with a data
              // object is a member. Never test the envelope itself.
              done(!!(res && res.data), true, true)
            },
            function () {
              warn('getCurrentMember rejected; treating as logged out')
              done(false, true, false)
            },
          )
        } catch (e) {
          warn('getCurrentMember threw; treating as logged out')
          done(false, true, false)
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
   * Built here rather than authored, so the fullscreen and picture-in-picture
   * attributes are correct AT LOAD for this particular viewer. `controls=0`
   * always: the template drives playback from its own buttons and puts
   * `pointer-events: none` on the iframe, so Vimeo's own UI is unreachable and
   * showing it would only advertise a scrubber nobody can use.
   */
  function buildFrame(videoId, gated) {
    var params = [
      'autoplay=1',
      'muted=1',
      'loop=1',
      'controls=0',
      'keyboard=0',
      'pip=0',
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
    if (el.nodeName !== 'BUTTON') {
      el.setAttribute('role', 'button')
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0')
    }
    if (label && !el.hasAttribute('aria-label')) el.setAttribute('aria-label', label)
    el.addEventListener('click', function (e) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault()
      onActivate()
    })
    el.addEventListener('keydown', function (e) {
      var k = e && e.key
      if (k !== 'Enter' && k !== ' ' && k !== 'Spacebar') return
      if (typeof e.preventDefault === 'function') e.preventDefault()
      onActivate()
    })
  }

  function Controller(root) {
    this.root = root
    this.videoId = String(root.getAttribute(ATTR_ID) || '').trim()
    this.cut = seconds(root, ATTR_CUT, DEFAULT_CUT_SECONDS)
    this.bg = seconds(root, ATTR_BG, DEFAULT_BG_SECONDS)
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
  Controller.prototype.showOverlay = function (show) {
    setState(this.el('overlay'), 'data-sv-overlay', show ? 'visible' : 'hidden')
  }
  Controller.prototype.showControls = function (show) {
    setState(this.el('controls'), 'data-sv-controls', show ? 'visible' : 'hidden')
  }

  Controller.prototype.mount = function (gated) {
    var self = this
    this.gated = gated
    var stage = part(this.root, 'stage')
    if (!stage) {
      warn('root has no stage element; nothing mounted')
      return false
    }
    this.frame = buildFrame(this.videoId, gated)
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

    this.showOverlay(true)
    this.showControls(false)
    this.paintPlay(false)
    this.paintMute(true)

    // A gated viewer can never reach fullscreen, because the frame was built
    // without permission. Hide the control rather than leave a dead button.
    // Inline display keeps this working with no CSS from the Designer; the
    // attribute is written too so the template can style it if it prefers.
    var fs = this.el('fullscreen')
    if (fs) {
      setState(fs, 'data-sv-fullscreen', gated ? 'hidden' : 'visible')
      if (gated) fs.style.display = 'none'
      else fs.style.removeProperty('display')
    }

    this.bind()
    return true
  }

  Controller.prototype.bind = function () {
    // Once per root, never per mount: a remount reuses the SAME authored
    // controls, and binding twice makes one activation play and then pause.
    if (this.bound) return
    this.bound = true
    var self = this

    var watch = this.el('watch')
    if (watch) armControl(watch, 'Watch the session', function () { self.watch() })
    else warn('no [data-element-trigger="show-video"] inside the root')

    armControl(this.el('play'), 'Play or pause the session video', function () { self.toggle() })
    armControl(this.el('click'), null, function () { self.toggle() })

    armControl(this.el('mute'), 'Mute or unmute the session video', function () {
      if (!self.player) return
      var next = !self.muted
      safe(self.player.setMuted(next))
      safe(self.player.setVolume(next ? 0 : 1))
      self.paintMute(next)
    })

    armControl(this.el('fullscreen'), 'Full screen', function () {
      if (self.gated || !self.player) return
      if (typeof self.player.requestFullscreen === 'function') safe(self.player.requestFullscreen())
    })
  }

  /** The watch control: first press starts for real, later presses resume. */
  Controller.prototype.watch = function () {
    if (!this.player) return
    if (this.armed) {
      if (this.gated && this.atWall) {
        this.openWall()
        return
      }
      this.showOverlay(false)
      safe(this.player.play())
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
  }

  Controller.prototype.toggle = function () {
    if (!this.player) return
    if (this.gated && this.atWall) {
      this.openWall()
      return
    }
    if (!this.armed) {
      this.watch()
      return
    }
    if (this.playing) safe(this.player.pause())
    else safe(this.player.play())
  }

  Controller.prototype.onTime = function (d) {
    var s = d && typeof d.seconds === 'number' ? d.seconds : 0
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
    if (this.armed && this.gated && this.atWall) this.freeze()
  }

  /** The template's choice: a pause brings the overlay back. */
  Controller.prototype.onPause = function () {
    this.paintPlay(false)
    if (this.armed) this.showOverlay(true)
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

  function boot() {
    var roots = document.querySelectorAll(ROOT_SELECTOR)
    if (!roots || !roots.length) return
    Promise.all([resolveMember(), ensureLib()]).then(function (r) {
      var state = r[0]
      var lib = r[1]
      info('viewer is ' + (state.member ? 'a member' : 'logged out') + (state.settled ? '' : ' (unresolved, failing closed)'))
      for (var i = 0; i < roots.length; i += 1) {
        var c = new Controller(roots[i])
        if (!c.videoId) {
          info('root has no ' + ATTR_ID + '; leaving the page as authored')
          continue
        }
        if (!lib) {
          // Without the player API there is no way to clamp, so a gated viewer
          // gets nothing rather than the whole video.
          warn('player library unavailable')
          if (state.member) {
            var stage = part(roots[i], 'stage')
            if (stage) stage.append(buildFrame(c.videoId, false))
          }
          continue
        }
        if (!c.mount(!state.member)) continue
        controllers.push(c)
        if (!state.certain) watchForLateMember(c)
      }
    }).catch(function (e) {
      warn('boot failed: ' + (e && e.message ? e.message : e))
    })
  }

  function watchForLateMember(c) {
    var ms = window.$memberstackDom
    if (!ms || typeof ms.getCurrentMember !== 'function') return
    try {
      ms.getCurrentMember().then(function (res) {
        if (res && res.data) c.upgrade()
      }, function () {})
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
