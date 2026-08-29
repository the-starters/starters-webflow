/**
 * V3 public starter profile — agency section.
 *
 * @release v1.59.428
 *
 * Designer owns the agency section's markup, styling, and placement. wf-xano
 * owns the fetch, the text binds, and every per-field show/hide decision. This
 * module exists only to close the gaps wf-xano cannot cover on this page.
 *
 * Authoritative contract, markup, and install: `v3/AGENCY-PROFILE-WIRING.md`.
 *
 * Vocabulary on the page, all Designer-authored: `wf-xano-bind` for the four
 * text fields (with `wf-xano-prefix` where a row reads as one sentence),
 * `wf-xano-if` for the section hide (`is_agency & agency_name`) and each
 * per-row hide, and `wf-xano-element="loader"` on the loader Div. This module
 * never decides which rows appear — read the wiring doc, not this file, to find
 * out why a row is missing.
 *
 * What it writes to the DOM, and nothing else:
 *
 *   1. `wf-xano-param-slug` on the authored section wrapper. wf-xano has no way
 *      to source a request parameter from the URL path, and the profile slug
 *      only exists in `/hire/{slug}`.
 *   2. The wrapper's hidden state — `hidden`, inline `display`, and the
 *      module-owned `data-agency-v3-hidden` marker. The card's `wf-xano-if`
 *      hides the card, but the wrapper itself stays a laid-out box, and a
 *      zero-height box is still a flex/grid item that keeps consuming a `gap`.
 *      Measured on the profile page: a hidden section left a 96px sibling
 *      distance where a single 48px gap belonged.
 *   3. `src` (and `loading`) on the authored video iframe, from the fetched
 *      `agency_video_link`. wf-xano binds text and image `src` but has no
 *      documented binder for an iframe's `src`, and the page loads the library
 *      via `@latest`, so leaning on the undocumented image-src-on-an-iframe
 *      behavior would be a silent breakage waiting for the next release.
 *
 * THE LOADING WINDOW — the one piece of timing worth understanding.
 *
 * The wrapper is NOT hidden at activation. The authored spinner lives inside
 * it, so hiding the wrapper up front would hide the spinner it is meant to
 * reveal. The wrapper therefore stays visible from activation until the answer
 * is known, and every path that ends that window closes it explicitly:
 *
 *   - a result arrives      -> shown for an agency, hidden otherwise
 *   - the request fails     -> hidden ('error')
 *   - the instance is already terminal when we reach it -> hidden
 *   - wf-xano throws inside init/get -> hidden
 *   - the root has no instance at all -> hidden
 *   - the URL carries no slug -> hidden before activation is even attempted
 *   - nothing happens for the cap's duration -> hidden
 *
 * That last one is not belt-and-braces. wf-xano's `load()` sets no fetch
 * timeout, so a request that never settles emits neither 'results' nor 'error'
 * and would strand the spinner and the gap band on EVERY profile, forever. The
 * cap fails open the same way `v3/complete-profile-loader.js` does: a visual
 * block a visitor cannot dismiss is worse than a section that quietly gives up.
 * A response landing after the cap is still processed normally — the results
 * handler runs and re-reveals the section for an agency, so a slow endpoint
 * costs a late render, not a lost one.
 *
 * The cap re-arms on every entry into 'loading', not only the first. An
 * instance CAN be reloaded after its first render: `WfXano.refresh()` with no
 * argument reloads every registered instance (wf-xano.js:3738) and applies no
 * auth check. `wf-xano-auth="none"` exempts this instance from the
 * Memberstack-session reload (wf-xano.js:1472) and from nothing else, so a
 * one-shot cap would leave a second stalled request spinning forever.
 *
 * The complete Designer attribute contract has one owner:
 * `v3/AGENCY-PROFILE-WIRING.md`. Do not infer or copy it from this local intent
 * comment.
 *
 * Staging-only console diagnostics, per the predicate documented in
 * `README.md` ("Staging-only console diagnostics"). Production says nothing.
 */
;(function (global) {
  'use strict'

  if (!global || global.__startersV3AgencyProfileBooted) return
  global.__startersV3AgencyProfileBooted = true

  var LOG_PREFIX = '[agency-profile]'
  var INSTANCE = 'starter-agency'
  var SECTION = '[data-agency-v3="section"]'
  // Module-owned. `data-hide-when-empty-section` belongs to
  // hide-empty-sections.js, whose contract stores the pre-hide inline display
  // in the attribute value — sharing it would make that engine treat this
  // module's hides as its own the day Designer re-enables it on this template.
  var HIDE_MARKER = 'data-agency-v3-hidden'
  // Overridable so a harness can exercise the cap without waiting 8 seconds.
  var TIMEOUT_ATTR = 'data-agency-v3-timeout-ms'
  var DEFAULT_TIMEOUT_MS = 8000
  // setTimeout stores its delay in a 32-bit int; anything past ~24.8 days wraps
  // and fires immediately, turning a "very patient" value into no wait at all.
  var MAX_TIMEOUT_MS = 60000
  // Rendered cards only. The authored template stays in the DOM (wf-xano hides
  // it rather than removing it), and writing a src into the template would be
  // copied into every later clone by cloneNode — a stale player surviving onto
  // a different profile.
  var RENDERED_VIDEO = '[wf-xano-item] [data-agency-v3="video"]'

  function stagingHost(hostname) {
    var host = hostname || ''
    return (
      /(\.|^)webflow\.io$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
    )
  }

  // STARTERS_DEBUG belongs here and not in stagingHost(): it may turn logging
  // on in production, but it must never change what the module does.
  function diagnosticsEnabled() {
    if (global.STARTERS_DEBUG === true) return true
    return stagingHost((global.location && global.location.hostname) || '')
  }

  function warn(message) {
    if (!diagnosticsEnabled()) return
    try {
      console.warn(LOG_PREFIX + ' ' + message)
    } catch (error) {}
  }

  function warnDuplicateInstance(root) {
    var documentObject = (root && root.ownerDocument) || global.document
    if (!diagnosticsEnabled() || !documentObject || !documentObject.querySelectorAll) return
    try {
      if (documentObject.querySelectorAll('[wf-xano-instance="' + INSTANCE + '"]').length <= 1) return
      warn(
        'another element on the page also carries wf-xano-instance="' +
          INSTANCE +
          '" — the key should be unique; this section is using its own instance',
      )
    } catch (error) {}
  }

  function profileSlug(pathname) {
    var match = String(pathname || '').match(/^\/hire\/([^/?#]+)\/?$/i)
    if (!match) return ''
    try {
      return decodeURIComponent(match[1]).trim()
    } catch (_) {
      return ''
    }
  }

  /**
   * Stamp the slug onto the authored wrapper. Returns the wrapper so the caller
   * can activate it, or null when there is nothing to do — a non-profile URL,
   * or a page whose Designer section has not been built yet.
   *
   * Only the param is written here. The wrapper's source, method, auth,
   * instance, defer flag, and template are Designer-authored and deliberately
   * not re-stamped: duplicating them would put the same contract in two places,
   * and the section is supposed to stay dark where it was never authored.
   */
  function configureSection(documentObject, pathname) {
    if (!documentObject || !documentObject.querySelector) return null
    var root = documentObject.querySelector(SECTION)
    if (!root || !root.setAttribute) return null
    var slug = profileSlug(pathname)
    if (!slug) {
      // The section exists but the URL yields no slug — trailing segments, a
      // malformed escape. Nothing will ever activate it, so collapse it here
      // rather than leaving an authored wrapper holding a layout slot.
      hideWrapper(root)
      return null
    }
    root.setAttribute('wf-xano-param-slug', slug)
    return root
  }

  /** The single agency row out of a wf-xano result. The endpoint returns one
   *  object, which the library normalizes to a one-item list. */
  function agencyRow(result) {
    return (result && result.items && result.items[0]) || null
  }

  /**
   * The section's own show rule, mirrored from the card's
   * `wf-xano-if="is_agency & agency_name"`.
   *
   * This module has to re-derive it rather than read it: the wrapper's
   * visibility and the video's src are both decided before, or independently
   * of, the card's own display. Whitespace is trimmed here where wf-xano's
   * truthiness test would not — a name of "   " would show wf-xano's card while
   * this keeps the wrapper hidden. That divergence fails closed (the visitor
   * sees nothing rather than a blank name) and no stored record looks like it.
   */
  function showsAgency(row) {
    if (!row || !row.is_agency) return false
    return String(row.agency_name == null ? '' : row.agency_name).trim() !== ''
  }

  /**
   * The stored value, accepted only as an absolute https URL.
   *
   * The endpoint returns `""` for anything that is not already https, and the
   * row is hidden declaratively when the link is empty — but this module is
   * what puts a URL into a live iframe, so it is the last belt rather than the
   * only one. A `javascript:` or `data:` value stored on a starter record must
   * not become a frame this page executes.
   */
  function videoUrl(row) {
    var stored = row && row.agency_video_link
    if (typeof stored !== 'string') return ''
    var value = stored.trim()
    if (!value) return ''
    try {
      var parsed = new global.URL(value)
      return parsed.protocol === 'https:' ? parsed.href : ''
    } catch (_) {
      return ''
    }
  }

  /* --------------------------- wrapper visibility ---------------------- */
  // One idiom, two writes, everywhere. `display` is what collapses the flex
  // slot; `hidden` is what assistive technology reads. Webflow's published CSS
  // can carry a `display` rule that beats the `hidden` attribute's UA style, so
  // neither write is redundant.

  function hideWrapper(root) {
    // Guarded here rather than at the call sites: several of them run outside
    // the try/catch below, where a style-less root would throw into wf-xano's
    // callback runner — which only logs, leaving the loading window open.
    if (!root || !root.style) return
    root.hidden = true
    root.style.display = 'none'
    root.setAttribute(HIDE_MARKER, '')
  }

  function revealWrapper(root) {
    if (!root || !root.style) return
    root.hidden = false
    root.style.removeProperty('display')
    root.removeAttribute(HIDE_MARKER)
  }

  /** Reveal the wrapper only for a profile that actually shows a card, so a
   *  hidden section stops being a flex/grid item and its parent's gap collapses
   *  with it. Called once the answer is known — never before, or it would hide
   *  the loading spinner that lives inside the wrapper. */
  function paintWrapper(root, row) {
    if (showsAgency(row)) revealWrapper(root)
    else hideWrapper(root)
  }

  /**
   * Point the rendered video iframe at the stored player.
   *
   * Gated on the section's show rule, not merely on the link being present. A
   * display:none iframe still loads: a record flagged as an agency with a video
   * but no name renders a hidden card, and writing the src anyway made the
   * browser fetch player.vimeo.com and build a child frame the visitor could
   * never see (verified by probe).
   */
  function paintVideo(root, row) {
    if (!root || !root.querySelectorAll) return
    var url = showsAgency(row) ? videoUrl(row) : ''
    var frames = root.querySelectorAll(RENDERED_VIDEO)
    if (url && frames.length === 0) {
      warn('a video link was returned but no rendered iframe carries data-agency-v3="video"')
    }
    Array.prototype.forEach.call(frames, function (frame) {
      if (!url) {
        frame.removeAttribute('src')
        return
      }
      // The section sits below the fold; set this before the src so the
      // attribute is in place when the load would otherwise start.
      frame.loading = 'lazy'
      frame.setAttribute('src', url)
    })
  }

  function paint(root, row) {
    paintWrapper(root, row)
    paintVideo(root, row)
  }

  /**
   * The cap that ends the loading window when nothing else does.
   *
   * There is no way to switch the cap off, and that is deliberate: every value
   * that is not a usable duration falls back to the default rather than to no
   * cap at all. `0`, a negative, a typo, and an absent attribute are all
   * treated the same way, because the failure this exists to prevent is a
   * section that spins forever, and a mis-typed attribute must not be able to
   * cause it. Large values are clamped rather than honoured, for the same
   * reason in the other direction.
   */
  function timeoutMs(root) {
    var raw = root && root.getAttribute ? root.getAttribute(TIMEOUT_ATTR) : null
    var value = typeof raw === 'string' ? raw.trim() : ''
    if (!/^[0-9]+$/.test(value)) return DEFAULT_TIMEOUT_MS
    var parsed = parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS
    return Math.min(parsed, MAX_TIMEOUT_MS)
  }

  /**
   * Activate the deferred wrapper and subscribe to its results.
   *
   * `init(root)` is passed the wrapper itself, which is what makes the deferred
   * root opt back in — the library's boot sweep skips `wf-xano-defer="true"`
   * roots unless they are the scope handed to init. Scoped to this wrapper
   * throughout: the Reviews section on this same page is another wf-xano
   * instance, and a document-wide init would drag it in.
   *
   * Idempotent per root. It is reachable from the exported api, and a second
   * pass would attach a duplicate 'results' handler — which wf-xano immediately
   * replays to, re-writing the iframe src and restarting a video the visitor is
   * already watching.
   *
   * Every exit that does not end with live handlers hides the wrapper on its
   * way out; see THE LOADING WINDOW in the module header.
   */
  function activate(wfx, root) {
    if (!root) return null
    if (Object.prototype.hasOwnProperty.call(root, '__agencyV3Instance')) {
      return root.__agencyV3Instance
    }

    var instance = null
    var byKey = null
    try {
      wfx.init(root)
      // Root-first, deliberately. get() resolves by KEY and returns the first
      // instance carrying it, while init() registered OURS by root — so on a
      // page where wf-xano-instance was duplicated, get() can hand back someone
      // else's instance while this wrapper has a perfectly good one of its own.
      // The library resolves the same way (instanceForElement checks
      // el.__wfXano before falling back to the key), and __wfXano is stamped at
      // construction (wf-xano.js:1653).
      byKey = typeof wfx.get === 'function' ? wfx.get(INSTANCE) : null
      instance = root.__wfXano || (byKey && byKey.root === root ? byKey : null)
    } catch (error) {
      // wf-xano runs queued callbacks inside a try/catch that only logs
      // (wf-xano.js:3662-3668), so a throw here would otherwise be invisible
      // AND leave the loading window open forever.
      hideWrapper(root)
      warn('wf-xano threw while initializing the section: ' + ((error && error.message) || error))
      root.__agencyV3Instance = null
      return null
    }

    if (!instance) {
      // An Instance that bails in its constructor is never registered —
      // `init()` only pushes `instance.ok` ones (wf-xano.js:3654) — and it
      // never stamps __wfXano either, so a missing wf-xano-element="wrapper"
      // and a missing template both land here, silently, with no events to come.
      hideWrapper(root)
      warn(
        'no "' +
          INSTANCE +
          '" instance was created for the section — check wf-xano-element="wrapper", ' +
          'wf-xano-source, and that a wf-xano-element="template" exists inside it',
      )
      root.__agencyV3Instance = null
      return null
    }

    warnDuplicateInstance(root)

    // The settle check runs BEFORE any subscription, and returns without
    // subscribing when the instance is already terminal. Subscribing first
    // would be a race: wf-xano replays the last result to a new 'results'
    // listener on a microtask (wf-xano.js:3536), and _lastResult survives a
    // later failure — so collapsing for the error synchronously here and THEN
    // letting a queued replay repaint the section with stale data is exactly
    // what the old order did. An errored instance has no retry path, so there
    // is nothing to subscribe for.
    var state = typeof instance.getState === 'function' ? instance.getState() : null
    if (state && state.status === 'error') {
      paint(root, null)
      root.__agencyV3Instance = instance
      return instance
    }

    var timer = null
    function clearCap() {
      if (timer === null) return
      global.clearTimeout(timer)
      timer = null
    }
    function armCap() {
      clearCap()
      var cap = timeoutMs(root)
      timer = global.setTimeout(function () {
        timer = null
        warn('no response after ' + cap + 'ms — collapsing the section')
        paint(root, null)
      }, cap)
    }

    // 'results' fires after the cards are rendered, and replays the last result
    // to a late subscriber — so this cannot miss a response that landed first.
    instance.on('results', function (result) {
      clearCap()
      paint(root, agencyRow(result))
    })
    // A failed load emits 'error' (wf-xano.js:3296) after hiding the spinner
    // via setState('error'); nothing emits 'results' on that path. paint() and
    // not paintWrapper(): the empty re-render that would have removed the cards
    // is conditional on `!err.keyed && !this.keyed` (wf-xano.js:3284), so on a
    // wrapper someone has given keyed reconciliation the cards survive — and a
    // playing iframe inside a hidden wrapper keeps its audio. One extra
    // querySelectorAll on a rare path is the cheaper side of that trade.
    instance.on('error', function () {
      clearCap()
      paint(root, null)
    })

    // The cap re-arms on EVERY entry into 'loading', not just the first. An
    // instance can be reloaded after its first render — `WfXano.refresh()` with
    // no argument reloads every registered instance (wf-xano.js:3738) with no
    // auth check, and the favorites hook refreshes on its own event — so a
    // one-shot cap would leave a second, stalled request spinning forever.
    // Subscribing on the status slice covers every reload path, including ones
    // added to the library later. Handlers fire only when the value actually
    // changes (Object.is, wf-xano.js:1718) and the current value is delivered
    // immediately, so this arms the cap for the load already in flight.
    if (typeof instance.subscribe === 'function') {
      instance.subscribe(
        function (snapshot) {
          return snapshot && snapshot.status
        },
        function (status) {
          if (status === 'loading') armCap()
          else clearCap()
        },
      )
    } else {
      armCap()
    }

    root.__agencyV3Instance = instance
    return instance
  }

  var api = {
    release: 'v1.59.428',
    instanceKey: INSTANCE,
    profileSlug: profileSlug,
    configureSection: configureSection,
    agencyRow: agencyRow,
    showsAgency: showsAgency,
    videoUrl: videoUrl,
    timeoutMs: timeoutMs,
    paintWrapper: paintWrapper,
    paintVideo: paintVideo,
    activate: activate,
  }
  global.StartersAgencyProfileV3 = api

  var documentObject = global.document
  if (!documentObject) return

  function boot() {
    var root = configureSection(documentObject, global.location && global.location.pathname)
    if (!root) return
    // ALWAYS go through push(), never branch on the global's shape. Both shapes
    // of window.WfXano expose it and both defer correctly: the pre-load array is
    // drained after boot, and the post-load API object runs the callback now if
    // booted or queues it until after init(document). Branching on Array.isArray
    // and acting directly was a real shipped bug in a sibling script — wf-xano
    // assigns window.WfXano = {api} at module scope, BEFORE boot() creates any
    // instance, so a deferred page script landing in that window acts against an
    // empty instance list and gives up permanently.
    global.WfXano = global.WfXano || []
    global.WfXano.push(function (wfx) {
      activate(wfx, root)
    })
  }

  if (documentObject.readyState === 'loading') {
    documentObject.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})(typeof window !== 'undefined' ? window : null)
