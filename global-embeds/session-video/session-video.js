/**
 * Session video gate — three free minutes of a Learn session, then the signup
 * wall, with the lock held by the player rather than by the modal.
 *
 * @release v1.59.169
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with `defer` in the Learn
 * Sessions template's before-</body> code.
 *
 * WHY THE PLAYER OWNS THE LOCK. There is no separate trailer asset: one video is
 * served to everyone and playback is clamped for non-members. So the gate cannot
 * be `data-ms-content` (which only hides markup that still ships in the source)
 * and it cannot be a blocking modal (the video underneath would keep playing).
 * Dismissing the wall returns the viewer to a frozen frame, and any attempt to
 * play reopens it. That is what makes "dismissible" cost nothing.
 *
 * MEMBER STATE IS RESOLVED *BEFORE* MOUNT, WHICH IS NOT WHAT THE PLAN SAID.
 * The plan had the player mount immediately for everyone and the clamp decided
 * later, on the grounds that the cut point is three minutes away. That is wrong
 * for one reason: `fullscreen` is NOT a Vimeo embed option. It is governed by the
 * iframe's `allowfullscreen` / `allow` attributes, and permissions policy is
 * evaluated at iframe load and never re-evaluated. Removing the attribute after
 * load does nothing. So a player mounted before we know who is watching is either
 * fullscreen-capable for a non-member (a bypass: fullscreen with `controls: false`
 * also strands them with no UI) or fullscreen-less for a member (a downgrade).
 * Hence: wait on `window.memberReady` with a short budget, then mount once with
 * the correct attributes. If the budget expires we mount GATED (fail closed) and
 * remount if membership resolves late — rare, and better than leaking the video.
 *
 * WHY FAIL CLOSED, WHEN learn-cta-gate.js FAILS OPEN. That embed's risk is
 * trapping a paying member on a scroll-locked page with no close control, so a
 * gate that never appears is the safer failure. Here the failure is symmetric in
 * cost but not in recoverability: a member who gets a clamped video reloads and
 * it resolves, whereas a non-member who gets the full video is gone. The clamp
 * also cannot trap anyone, because the page is never scroll-locked by this file.
 *
 * THE MARKUP (Designer-authored):
 *   [data-session-video="root"]              wrapper; carries the two data below
 *     data-session-video-id                  Vimeo ID, bound to the CMS field
 *     data-session-video-cut                 optional seconds; empty -> 180
 *   [data-session-video="stage"]             the iframe is built in here
 *   [data-session-video="play"]              custom play/pause control
 *   [data-session-video="progress"]          fill element; width is set as a %
 *   [data-session-video="signup-trigger"]    hidden; carries data-modal-trigger
 *
 * NO MODAL ID LIVES IN THIS FILE. The triggers carry the site modal module's own
 * `data-modal-trigger` attribute and this file only clicks them, so which modal
 * opens stays an authoring decision and `modal.js` (roughly 374 published pages)
 * needs no new public API. A test asserts this file contains no modal id.
 *
 * Debug from the console: `StartersSessionVideo.status()`, or force the wall with
 * `StartersSessionVideo.reveal()`.
 */
;(function () {
  'use strict'

  if (window.__startersSessionVideoBooted) return
  window.__startersSessionVideoBooted = true

  var RELEASE = 'v1.59.169'
  var LIB_SRC = 'https://player.vimeo.com/api/player.js'
  var DEFAULT_CUT_SECONDS = 180
  var MEMBER_BUDGET_MS = 1200
  var LIB_BUDGET_MS = 6000

  var ROOT_SELECTOR = '[data-session-video="root"]'
  var ATTR_ID = 'data-session-video-id'
  var ATTR_CUT = 'data-session-video-cut'

  var STAGING_HOST = /(^|\.)webflow\.io$|^localhost$|^127\.0\.0\.1$|(^|\.)trycloudflare\.com$/

  function diagnostic() {
    return STAGING_HOST.test(window.location.hostname || '') || window.STARTERS_DEBUG === true
  }
  function warn(message) {
    if (diagnostic()) console.warn('[session-video] ' + message)
  }
  function info(message) {
    if (diagnostic()) console.info('[session-video] ' + message)
  }

  function part(root, name) {
    return root.querySelector('[data-session-video="' + name + '"]')
  }

  /** Seconds from the CMS override, or the default for empty/unusable values. */
  function cutFor(root) {
    var raw = root.getAttribute(ATTR_CUT)
    if (raw === null || String(raw).trim() === '') return DEFAULT_CUT_SECONDS
    var n = Number(raw)
    if (!isFinite(n) || n <= 0) {
      warn('unusable ' + ATTR_CUT + ' "' + raw + '", falling back to ' + DEFAULT_CUT_SECONDS)
      return DEFAULT_CUT_SECONDS
    }
    return n
  }

  function emit(name, detail) {
    if (typeof window.CustomEvent !== 'function') return
    window.dispatchEvent(new window.CustomEvent(name, { detail: detail }))
  }

  /**
   * Resolve membership within a budget. Returns {member, settled}: `settled`
   * false means the budget expired and the caller must fail closed.
   */
  function resolveMember() {
    var ready = window.memberReady
    if (!ready || typeof ready.then !== 'function') {
      warn('window.memberReady absent; treating viewer as logged out')
      return Promise.resolve({ member: false, settled: false })
    }
    var decided = false
    return new Promise(function (resolve) {
      window.setTimeout(function () {
        if (decided) return
        decided = true
        warn('memberReady did not settle within ' + MEMBER_BUDGET_MS + 'ms; gating')
        resolve({ member: false, settled: false })
      }, MEMBER_BUDGET_MS)
      ready.then(
        function (member) {
          if (decided) return
          decided = true
          resolve({ member: !!member, settled: true })
        },
        function () {
          if (decided) return
          decided = true
          warn('memberReady rejected; treating viewer as logged out')
          resolve({ member: false, settled: true })
        },
      )
    })
  }

  /** Load player.js once. Resolves false when it does not arrive in budget. */
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
   * The iframe is built here rather than left to player.js so the fullscreen and
   * picture-in-picture attributes are correct at load. See the header note.
   */
  function buildFrame(videoId, gated) {
    var params = [
      'dnt=1',
      'playsinline=1',
      'title=0',
      'byline=0',
      'portrait=0',
      'controls=' + (gated ? '0' : '1'),
      'keyboard=' + (gated ? '0' : '1'),
      'pip=' + (gated ? '0' : '1'),
    ]
    var frame = document.createElement('iframe')
    frame.setAttribute('src', 'https://player.vimeo.com/video/' + videoId + '?' + params.join('&'))
    frame.setAttribute('frameborder', '0')
    frame.setAttribute('title', 'Session video')
    frame.setAttribute('width', '100%')
    frame.setAttribute('height', '100%')
    if (!gated) {
      frame.setAttribute('allowfullscreen', '')
      frame.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture')
    } else {
      frame.setAttribute('allow', 'autoplay')
    }
    return frame
  }

  /** Make an authored div behave as a button without requiring one. */
  function armControl(el, label, onActivate) {
    if (!el) return
    if (el.nodeName !== 'BUTTON') {
      el.setAttribute('role', 'button')
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0')
    }
    el.setAttribute('aria-label', label)
    el.setAttribute('aria-pressed', 'false')
    el.addEventListener('click', function (event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault()
      onActivate()
    })
    el.addEventListener('keydown', function (event) {
      var key = event && event.key
      if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return
      if (typeof event.preventDefault === 'function') event.preventDefault()
      onActivate()
    })
  }

  function Controller(root) {
    this.root = root
    this.videoId = String(root.getAttribute(ATTR_ID) || '').trim()
    this.cut = cutFor(root)
    this.gated = true
    this.player = null
    this.frame = null
    this.atWall = false
    this.clamping = false
    this.position = 0
    this.duration = 0
    this.startEmitted = false
    this.wallEmitted = false
    this.wallOpens = 0
  }

  Controller.prototype.mount = function (gated) {
    var self = this
    this.gated = gated
    var stage = part(this.root, 'stage')
    if (!stage) {
      warn('root has no stage element; nothing mounted')
      return
    }
    this.frame = buildFrame(this.videoId, gated)
    stage.append(this.frame)

    this.player = new window.Vimeo.Player(this.frame)
    this.player.on('timeupdate', function (data) {
      self.onTime(data)
    })
    this.player.on('play', function () {
      self.onPlay()
    })
    // An ungated member has BOTH native controls and the custom one, so playback
    // state has to be driven by the player's events, not only by our own
    // activations. Without this handler a native pause left `playing` true and
    // the next custom click called pause() on an already-paused video.
    this.player.on('pause', function () {
      self.onPause()
    })
    this.player.on('seeked', function (data) {
      self.onSeeked(data)
    })
    this.player.on('ended', function () {
      emit('session-video-complete', self.detail())
    })

    // Armed once per root, never per mount: an upgrade re-mounts the player on
    // the SAME authored control, and arming twice would make one activation
    // play and then immediately pause.
    var play = part(this.root, 'play')
    if (!this.controlArmed) {
      this.controlArmed = true
      armControl(play, 'Play session video', function () {
        self.toggle()
      })
    }
    this.playControl = play
    this.paint()
  }

  Controller.prototype.detail = function () {
    return {
      videoId: this.videoId,
      cut: this.cut,
      gated: this.gated,
      position: this.position,
    }
  }

  Controller.prototype.limit = function () {
    return this.gated ? this.cut : this.duration || this.cut
  }

  Controller.prototype.paint = function () {
    var fill = part(this.root, 'progress')
    if (!fill) return
    var limit = this.limit()
    var pct = limit > 0 ? Math.min(1, this.position / limit) : 0
    fill.style.width = pct * 100 + '%'
  }

  Controller.prototype.onTime = function (data) {
    var seconds = data && typeof data.seconds === 'number' ? data.seconds : 0
    if (data && typeof data.duration === 'number') this.duration = data.duration
    this.position = seconds
    this.paint()
    if (this.gated && seconds > 0 && !this.startEmitted) {
      this.startEmitted = true
      emit('session-video-preview-start', this.detail())
    }
    if (this.gated && seconds >= this.cut) this.enforce()
  }

  /**
   * `aria-pressed` alone announced "Play session video, pressed" while playing,
   * which reads as a stuck toggle. The label is relabelled too, so the control
   * always announces the action it will perform.
   */
  Controller.prototype.setPlaying = function (playing) {
    this.playing = playing
    if (!this.playControl) return
    this.playControl.setAttribute('aria-pressed', playing ? 'true' : 'false')
    this.playControl.setAttribute('aria-label', playing ? 'Pause session video' : 'Play session video')
  }

  Controller.prototype.onPlay = function () {
    this.setPlaying(true)
    if (this.gated && this.atWall) this.enforce()
  }

  Controller.prototype.onPause = function () {
    this.setPlaying(false)
  }

  Controller.prototype.onSeeked = function (data) {
    var seconds = data && typeof data.seconds === 'number' ? data.seconds : 0
    if (this.clamping) {
      this.clamping = false
      return
    }
    this.position = seconds
    this.paint()
    if (this.gated && seconds >= this.cut) this.enforce()
  }

  /**
   * Freeze at the cut point and open the wall. `clamping` swallows the `seeked`
   * this provokes, or the seek would re-enter here forever.
   */
  Controller.prototype.enforce = function () {
    this.atWall = true
    this.position = this.cut
    if (this.player) {
      this.player.pause()
      this.clamping = true
      this.player.setCurrentTime(this.cut)
    }
    this.setPlaying(false)
    this.paint()
    this.openWall()
  }

  /**
   * Clicking the authored trigger every time is deliberate: dismissing and then
   * pressing play must bring the wall back. The event fires once.
   */
  Controller.prototype.openWall = function () {
    var trigger = part(this.root, 'signup-trigger')
    this.wallOpens += 1
    if (!this.wallEmitted) {
      this.wallEmitted = true
      emit('session-video-wall', this.detail())
    }
    if (!trigger) {
      warn('no signup-trigger authored; the wall cannot open')
      return
    }
    trigger.click()
  }

  Controller.prototype.toggle = function () {
    if (this.gated && this.atWall) {
      this.openWall()
      return
    }
    if (!this.player) return
    // Set optimistically AND corrected by the player's own play/pause events, so
    // the control stays right whether the user drove us or the native controls.
    if (this.playing) {
      this.setPlaying(false)
      this.player.pause()
    } else {
      this.setPlaying(true)
      this.player.play()
    }
  }

  /** Late membership: swap the gated frame for a full one at the same position. */
  Controller.prototype.upgrade = function () {
    if (!this.gated) return
    var at = this.position
    var stage = part(this.root, 'stage')
    if (this.player && typeof this.player.destroy === 'function') this.player.destroy()
    // childNodes is a NodeList, not an Array: no indexOf, no splice. An earlier
    // version used both and threw TypeError here in every browser, AFTER the
    // destroy above, leaving a late-resolving member with a dead iframe and no
    // controller. The test harness's Array-shaped childNodes hid it.
    if (this.frame) {
      if (typeof this.frame.remove === 'function') this.frame.remove()
      else if (stage && typeof stage.removeChild === 'function') stage.removeChild(this.frame)
    }
    this.atWall = false
    this.clamping = false
    this.wallEmitted = true
    this.mount(false)
    if (this.player && at > 0) this.player.setCurrentTime(at)
    info('upgraded to the full video after late member resolution')
  }

  var controllers = []

  function boot() {
    var roots = document.querySelectorAll(ROOT_SELECTOR)
    if (!roots || !roots.length) return
    Promise.all([resolveMember(), ensureLib()]).then(function (results) {
      var state = results[0]
      var lib = results[1]
      for (var i = 0; i < roots.length; i += 1) {
        var controller = new Controller(roots[i])
        if (!controller.videoId) {
          info('root has no ' + ATTR_ID + '; leaving the page as authored')
          continue
        }
        if (!lib) {
          // Without the player API there is no way to clamp, so a gated viewer
          // gets nothing rather than the whole video.
          warn('player library unavailable; not mounting for a gated viewer')
          if (state.member) {
            var stage = part(roots[i], 'stage')
            if (stage) stage.append(buildFrame(controller.videoId, false))
          }
          continue
        }
        controller.mount(!state.member)
        controllers.push(controller)
        if (!state.settled && window.memberReady && typeof window.memberReady.then === 'function') {
          ;(function (c) {
            window.memberReady.then(function (member) {
              if (member) c.upgrade()
            }, function () {})
          })(controller)
        }
      }
    })
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
            gated: c.gated,
            atWall: c.atWall,
            position: c.position,
            wallOpens: c.wallOpens,
          }
        }),
      }
    },
    reveal: function () {
      controllers.forEach(function (c) {
        c.enforce()
      })
    },
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
