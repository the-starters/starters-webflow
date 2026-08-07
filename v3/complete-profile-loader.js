/**
 * /complete-profile — the submit spinner, and the dim behind it.
 *
 * @release v1.59.125
 *
 * ONE job: while the Complete-profile form is submitting, show the designer's
 * loader and fade back what is behind it. It never submits anything, never
 * touches the network, never reads Memberstack, and never enables or disables a
 * control. It watches one attribute and writes `display`, `opacity`,
 * `pointer-events` and `transition` — nothing else.
 *
 * THE PROBLEM IT SOLVES. `v3/brand-account-controller.js` runs this form, and a
 * durable submit is several round trips long. Today the page gives the member no
 * sign that anything is happening: the button greys out (the controller disables
 * it) and then the page sits there until it redirects. On a slow connection that
 * reads as a dead form, and a member who believes a form is dead starts clicking
 * things. So the page gets a spinner and a dimmed backdrop for exactly as long as
 * the submit is in flight.
 *
 * WHERE THE SIGNAL COMES FROM. `aria-busy` on the form, which the controller
 * already maintains: `setBusy(form, busy)` in `v3/brand-account-controller.js`
 * writes `aria-busy="true"` when a submit starts and `aria-busy="false"` when it
 * ends.
 *
 * THE CONTROLLER GUARANTEE THIS MODULE DEPENDS ON. On a successful submit that
 * initiates a redirect, the controller deliberately does NOT clear busy: the
 * form stays `aria-busy="true"` until the page unloads, so this loader stays up
 * across the navigation. That latch was added alongside this module and is
 * load-bearing for it. The reasoning lives at the `redirecting` flag in
 * `bindForm()` in v3/brand-account-controller.js; the short version is that
 * `location.assign()` only queues a navigation, so the old code released the
 * form while the browser was still fetching the destination.
 *
 * So busy clears on two paths, both of which leave the member on this page and
 * wanting the form back: an error, and a success that did NOT initiate a
 * redirect (no redirect URL resolved). A success that DID initiate one never
 * clears it.
 *
 * If anyone reverts that latch, this module does not break. It just stops
 * covering the redirect, which is the most valuable second it covers. A
 * controller test pins it: `a successful submit that initiated a redirect stays
 * busy until the page unloads`.
 *
 * This module is a pure observer of that attribute. It deliberately does not
 * bind `submit`, and deliberately does not touch the submit button:
 * double-submit is already guarded by the controller, and two owners of one
 * button is how a form ends up permanently disabled.
 *
 * THE DESIGNER CONTRACT (one required hook, two optional):
 *
 *   [data-complete-profile-loader]  the loader element, AUTHORED HIDDEN, and
 *                                   OUTSIDE any dim target (see below). Its
 *                                   `data-loader` attribute carries the minimum
 *                                   display time in milliseconds. Shown with an
 *                                   INLINE `display: flex` and hidden with an
 *                                   INLINE `display: none`, because the
 *                                   Designer's Display:None usually compiles to
 *                                   a class rule and a class rule would beat
 *                                   anything this module wrote to the
 *                                   stylesheet.
 *   [data-complete-profile-element="form"]           dim target, optional.
 *   [data-complete-profile-element="profile-photo"]  dim target, optional.
 *
 * A missing loader is the bail: no observer, no writes, and the exported
 * show/hide replaced by no-ops. That is what makes this file safe to load
 * site-wide even though it is only wanted on one page. Missing DIM targets are
 * skipped silently and individually: the spinner still shows, it just has
 * nothing to fade behind it, and "absent" is a supported state rather than an
 * error.
 *
 * A dim target that CONTAINS the loader is skipped too, with a staging warning.
 * Opacity on an ancestor creates a rendering group its children cannot escape,
 * and `pointer-events: none` inherits, so dimming such an element would fade the
 * spinner to 0.2 and make it inert: the feature looking broken at the exact
 * moment it is meant to reassure. Losing the dim and keeping a healthy spinner
 * is the better half to keep, and it makes a half-finished Designer edit
 * (attribute added before the loader was moved out) degrade quietly.
 *
 * MINIMUM DISPLAY. A spinner that appears and vanishes inside 80ms is a flash of
 * noise, so once shown the loader stays for at least `data-loader` milliseconds
 * (1000 as authored). The value must be wholly numeric; a missing, malformed or
 * unit-suffixed one ("1s", "1000px") falls back to 200ms, the same default the
 * sibling explore-search list loader uses. When `aria-busy` goes false before
 * that window is up, the hide is deferred, not skipped.
 *
 * FAIL-OPEN, and why it is not optional. Every show arms a 5000ms hard cap. If
 * the cap fires while the loader is still up, the loader hides and the dim is
 * restored no matter what `aria-busy` says. A spinner is a full-page visual
 * block, so a controller that throws before clearing `aria-busy`, an attribute
 * the module never sees, or a bug in this file must not be able to trap a member
 * behind a permanent overlay. The submit button staying disabled in that
 * situation is the controller's business; leaving the member able to see and
 * scroll the page is this module's.
 *
 * Note the interaction with the redirect latch above: on a successful submit
 * `aria-busy` is never cleared, so the cap is the NORMAL end of a successful
 * session whenever the redirect takes longer than 5s. That is the intended
 * trade: a member on a slow connection briefly sees the form again before the
 * new page paints, which is strictly better than a member on a stalled
 * navigation staring at a spinner with no way out. `state.capHits` above zero is
 * therefore not automatically a bug — see the wiring doc.
 *
 * COALESCING. Rapid busy/idle toggles resolve to one visible session: a fresh
 * `aria-busy="true"` while the loader is already up cancels any pending hide and
 * restarts BOTH the minimum-display window and the 5s cap, so a stray timer from
 * the previous submit can never un-dim a submit that is still running. The dim
 * bookkeeping outlives the hide by one transition length precisely so a
 * re-show inside that window reuses the ORIGINAL captured inline values instead
 * of capturing this module's own dim values as if the page had authored them.
 *
 * Install: one deferred page-level tag on /complete-profile. Order against the
 * controller does not matter — this module reads an attribute whenever it
 * changes and reads it once at init in case a submit somehow beat it to the
 * page. Diagnostics are staging-only (`*.webflow.io`, localhost, 127.0.0.1,
 * `*.trycloudflare.com`, or `window.STARTERS_DEBUG === true`); production is
 * silent. Wiring: v3/COMPLETE-PROFILE-LOADER-WIRING.md.
 */
;(function () {
  'use strict'

  if (window.__startersCompleteProfileLoaderBooted) return
  window.__startersCompleteProfileLoaderBooted = true

  var LOADER_SELECTOR = '[data-complete-profile-loader]'
  var FORM_SELECTOR = '#wf-form-Complete-Profile-Form'
  var MIN_MS_ATTRIBUTE = 'data-loader'
  var BUSY_ATTRIBUTE = 'aria-busy'

  // Both optional. Order is display order, so a staging log reads top-to-bottom.
  var DIM_SELECTORS = [
    '[data-complete-profile-element="form"]',
    '[data-complete-profile-element="profile-photo"]',
  ]

  var DEFAULT_MIN_MS = 200
  var MAX_MS = 5000

  var SHOW_DISPLAY = 'flex'
  var HIDE_DISPLAY = 'none'

  var DIM_OPACITY = '0.2'
  var DIM_POINTER_EVENTS = 'none'
  var DIM_TRANSITION = 'opacity 0.2s ease'
  // Matches the transition above. The inline transition is cleared this long
  // after a restore so the fade back in animates too; see releaseDimmed().
  var DIM_TRANSITION_MS = 200

  var LOG_PREFIX = '[starters complete-profile-loader]'

  /* ------------------------------ environment ------------------------------ */

  // Anchored, the same shape as the sibling v3 scripts: a lookalike such as
  // "notwebflow.io" or "evil-trycloudflare.com" must not read as staging. Here
  // it only gates logging — this module has no host gate on running, because the
  // presence of the loader element IS its gate.
  function stagingHost(hostname) {
    var host = hostname || ''
    return (
      /(\.|^)webflow\.io$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
    )
  }

  function diagnosticsEnabled() {
    if (window.STARTERS_DEBUG === true) return true
    try {
      return stagingHost((window.location && window.location.hostname) || '')
    } catch (error) {
      return false
    }
  }

  function note(message) {
    if (!diagnosticsEnabled()) return
    try {
      console.info(LOG_PREFIX + ' ' + message)
    } catch (error) {}
  }

  function warn(message) {
    if (!diagnosticsEnabled()) return
    try {
      console.warn(LOG_PREFIX + ' ' + message)
    } catch (error) {}
  }

  function describe(error) {
    return (error && error.message) || String(error)
  }

  /* --------------------------------- timers --------------------------------- */

  // Reached through `window` rather than the bare globals so the test harness
  // can drive a deterministic clock, the way the sibling v3 modules do.
  function later(fn, ms) {
    try {
      if (typeof window.setTimeout !== 'function') return null
      return window.setTimeout(fn, ms)
    } catch (error) {
      return null
    }
  }

  function cancel(id) {
    try {
      if (id !== null && typeof window.clearTimeout === 'function') {
        window.clearTimeout(id)
      }
    } catch (error) {}
    return null
  }

  function now() {
    try {
      return Date.now()
    } catch (error) {
      return 0
    }
  }

  /* ---------------------------------- DOM ---------------------------------- */

  function find(selector, root) {
    try {
      var scope = root || document
      if (!scope || typeof scope.querySelector !== 'function') return null
      return scope.querySelector(selector) || null
    } catch (error) {
      return null
    }
  }

  function setStyle(element, property, value) {
    try {
      if (!element || !element.style) return false
      element.style[property] = value
      return true
    } catch (error) {
      warn('could not write ' + property + ': ' + describe(error))
      return false
    }
  }

  function readStyle(element, property) {
    try {
      if (!element || !element.style) return ''
      var value = element.style[property]
      return typeof value === 'string' ? value : ''
    } catch (error) {
      return ''
    }
  }

  /**
   * The authored minimum-display value, or the 200ms default.
   *
   * Strict on purpose. `parseInt` is happy to read "1s" as 1 and "1000px" as
   * 1000, so a plausible-looking typo in the Designer would silently defeat the
   * anti-flash window (in the "1s" case, reduce it to a single millisecond)
   * without anything to see in the markup. Only a wholly numeric value counts;
   * surrounding whitespace is forgiven because a copy-paste often carries it.
   * Anything else falls back to the default rather than to a guess.
   */
  function parseMinMs(raw) {
    if (typeof raw !== 'string') return DEFAULT_MIN_MS
    var trimmed = raw.trim()
    if (!/^\d+$/.test(trimmed)) return DEFAULT_MIN_MS
    var value = Number(trimmed)
    if (!isFinite(value) || value < 0) return DEFAULT_MIN_MS
    return value
  }

  /* -------------------------------- the loader ------------------------------ */

  var loader = find(LOADER_SELECTOR)

  /**
   * The live picture, readable from the console on staging. `showing` is the
   * one-word answer; `reason` names the branch that produced the current state.
   */
  var state = {
    booted: false,
    showing: false,
    reason: null,
    minMs: DEFAULT_MIN_MS,
    maxMs: MAX_MS,
    shows: 0,
    hides: 0,
    capHits: 0,
    dimCount: 0,
  }

  // Exported before the bail so a staging session can always ask why nothing is
  // happening. Nothing below this line runs without a loader element.
  window.StartersCompleteProfileLoader = {
    // Keep in sync with the @release line in this file's header comment; the
    // v3/complete-profile-loader.test.js drift guard asserts they match. The
    // placeholder is replaced with the real tag at release time.
    release: 'v1.59.125',
    state: state,
    show: show,
    hide: hide,
    stagingHost: stagingHost,
    diagnosticsEnabled: diagnosticsEnabled,
    loaderSelector: LOADER_SELECTOR,
    formSelector: FORM_SELECTOR,
    dimSelectors: DIM_SELECTORS.slice(),
    defaultMinMs: DEFAULT_MIN_MS,
    maxMs: MAX_MS,
  }

  if (!loader) {
    state.reason = 'no-loader'
    // Inert stand-ins. Everything below this line, `minMs` included, is never
    // initialized on a page with no loader, so the real show()/hide() would
    // half-run against undefined state. This file loads site-wide, so those
    // functions are reachable from the console on pages that have nothing to do
    // with the form.
    window.StartersCompleteProfileLoader.show = function () {}
    window.StartersCompleteProfileLoader.hide = function () {}
    // No warning: this file is safe to load site-wide, and every page that is
    // not /complete-profile would otherwise log on staging.
    return
  }

  var minMs = parseMinMs(loader.getAttribute(MIN_MS_ATTRIBUTE))
  state.minMs = minMs

  /* Self-heal. The contract says author the loader hidden, but a Designer edit
     can ship it visible, and an authored-visible loader on a page whose script
     failed to load is a spinner nobody can dismiss. Force it hidden now, with
     the same INLINE write the show/hide path uses. */
  setStyle(loader, 'display', HIDE_DISPLAY)

  /* The form is the loader's SIBLING, so resolve it from the shared parent
     first; the id is the fallback for the day the Designer re-nests either one.
     No form means no aria-busy to watch and nothing this module can do.

     The parent check is load-bearing, not defensive noise: find() falls back to
     `document` when handed a null root, so a parentless loader would turn the
     "scoped" lookup into `document.querySelector('form')` — the FIRST form in
     the page, which here is the nav search form, not the profile form — and the
     id fallback would never be consulted. Wrong form is worse than no form. */
  var parent = loader.parentElement || null
  var form = (parent && find('form', parent)) || find(FORM_SELECTOR) || null

  if (!form) {
    state.reason = 'no-form'
    warn('found the loader but no form to watch; leaving the page as authored.')
    return
  }

  /* --------------------------------- dimming -------------------------------- */

  /**
   * Targets currently carrying this module's dim, each with the inline values
   * the page had BEFORE the first dim. The list survives the hide by one
   * transition length (see releaseDimmed), which is what stops a rapid re-show
   * from recording this module's own `opacity: 0.2` as the page's authored
   * value.
   */
  var dimmed = []

  /**
   * True when this candidate is an ancestor of the loader (or the loader
   * itself). A browser without `contains` reads as "no", which keeps the old
   * behaviour rather than silently dropping every dim target.
   */
  function containsLoader(element) {
    try {
      if (!element || typeof element.contains !== 'function') return false
      return element.contains(loader)
    } catch (error) {
      return false
    }
  }

  function entryFor(element) {
    for (var index = 0; index < dimmed.length; index += 1) {
      if (dimmed[index].element === element) return dimmed[index]
    }
    return null
  }

  function dimTargets() {
    for (var index = 0; index < DIM_SELECTORS.length; index += 1) {
      var element = find(DIM_SELECTORS[index])
      if (!element) {
        // Expected until the Designer adds the attributes. Not a warning.
        note('no ' + DIM_SELECTORS[index] + ' on this page; skipping it.')
        continue
      }
      if (containsLoader(element)) {
        // Dimming an ancestor of the loader would dim the loader. Opacity on an
        // ancestor creates a rendering group its children cannot escape, and
        // pointer-events: none inherits, so the spinner would fade to 0.2 and go
        // inert — the feature looking broken at the exact moment it is meant to
        // reassure. Skipping loses the dim and keeps a healthy spinner, which is
        // the better half to keep.
        warn(
          DIM_SELECTORS[index] +
            ' contains the loader, so dimming it would dim the spinner too;' +
            ' skipping it. Move the loader out of that element.',
        )
        continue
      }
      var entry = entryFor(element)
      if (!entry) {
        entry = {
          element: element,
          opacity: readStyle(element, 'opacity'),
          pointerEvents: readStyle(element, 'pointerEvents'),
          transition: readStyle(element, 'transition'),
        }
        dimmed.push(entry)
      }
      setStyle(element, 'transition', DIM_TRANSITION)
      setStyle(element, 'opacity', DIM_OPACITY)
      setStyle(element, 'pointerEvents', DIM_POINTER_EVENTS)
    }
    state.dimCount = dimmed.length
  }

  /**
   * Put back exactly what was there. An empty captured value writes an empty
   * string, which removes the inline declaration and hands the element back to
   * the stylesheet — the same thing the sibling modules do when they clear an
   * inline display.
   */
  function undimTargets() {
    for (var index = 0; index < dimmed.length; index += 1) {
      var entry = dimmed[index]
      // The transition is left in place for now so the fade back in animates.
      setStyle(entry.element, 'opacity', entry.opacity)
      setStyle(entry.element, 'pointerEvents', entry.pointerEvents)
    }
    // The dim is off the page as of this write. `dimmed` itself stays populated
    // for one transition so a re-show can reuse the captured values, but
    // reporting that count as applied dim would be a lie for those 200ms.
    state.dimCount = 0
  }

  function releaseDimmed() {
    for (var index = 0; index < dimmed.length; index += 1) {
      setStyle(dimmed[index].element, 'transition', dimmed[index].transition)
    }
    dimmed = []
    // Already zeroed by undimTargets(); repeated here so the invariant holds if
    // releaseDimmed() is ever reached by another path.
    state.dimCount = 0
  }

  /* --------------------------------- session -------------------------------- */

  var shownAt = 0
  var hideTimer = null
  var capTimer = null
  var releaseTimer = null

  function clearTimers() {
    hideTimer = cancel(hideTimer)
    capTimer = cancel(capTimer)
  }

  /**
   * Raise the loader and dim the backdrop. Idempotent in effect: calling it
   * while already showing restarts the minimum-display window and the cap rather
   * than stacking a second session.
   */
  function show() {
    try {
      // Any pending un-dim from the previous submit is cancelled here — this is
      // the guard that keeps a stray timer from un-dimming a live submit.
      releaseTimer = cancel(releaseTimer)
      clearTimers()

      var reshow = state.showing
      shownAt = now()
      state.showing = true
      state.reason = reshow ? 'reshown' : 'shown'
      state.shows += 1

      setStyle(loader, 'display', SHOW_DISPLAY)
      dimTargets()

      capTimer = later(function () {
        capTimer = null
        if (!state.showing) return
        state.capHits += 1
        warn(
          'the form stayed busy for ' +
            MAX_MS +
            'ms; hiding the loader anyway so the page is never trapped behind it.',
        )
        finish('cap')
      }, MAX_MS)

      note(reshow ? 'busy again; loader stays up.' : 'busy; loader shown.')
    } catch (error) {
      // Worst case, do not leave a half-raised overlay behind.
      warn('could not show the loader: ' + describe(error))
      finish('show-failed')
    }
  }

  /**
   * Ask for the loader to come down. Honors the minimum-display window: an
   * `aria-busy` that flips false 40ms after it flipped true still leaves the
   * spinner up for the authored duration.
   */
  function hide() {
    try {
      if (!state.showing) return
      hideTimer = cancel(hideTimer)

      var elapsed = now() - shownAt
      var remaining = minMs - elapsed
      if (remaining <= 0) {
        finish('idle')
        return
      }

      state.reason = 'min-display'
      note('idle after ' + elapsed + 'ms; holding the loader for ' + remaining + 'ms more.')
      hideTimer = later(function () {
        hideTimer = null
        if (!state.showing) return
        finish('idle')
      }, remaining)
    } catch (error) {
      warn('could not schedule the hide: ' + describe(error))
      finish('hide-failed')
    }
  }

  /** The single place the loader actually comes down. */
  function finish(reason) {
    try {
      clearTimers()
      state.showing = false
      state.reason = reason
      state.hides += 1

      setStyle(loader, 'display', HIDE_DISPLAY)
      undimTargets()

      // Hold the captured values for one transition, then clear the inline
      // transition. A show inside that window cancels this and reuses them.
      releaseTimer = cancel(releaseTimer)
      releaseTimer = later(function () {
        releaseTimer = null
        releaseDimmed()
      }, DIM_TRANSITION_MS)

      note('loader hidden (' + reason + ').')
    } catch (error) {
      warn('could not hide the loader cleanly: ' + describe(error))
    }
  }

  /* ---------------------------------- boot ---------------------------------- */

  function isBusy() {
    try {
      return form.getAttribute(BUSY_ATTRIBUTE) === 'true'
    } catch (error) {
      return false
    }
  }

  function sync() {
    if (isBusy()) show()
    else hide()
  }

  // Read once before observing: a submit could in principle have started before
  // this deferred script ran, and an already-busy form must not wait for the
  // NEXT attribute write to get its spinner.
  if (isBusy()) show()

  try {
    if (typeof window.MutationObserver === 'function') {
      var observer = new window.MutationObserver(sync)
      observer.observe(form, {
        attributes: true,
        attributeFilter: [BUSY_ATTRIBUTE],
      })
      window.StartersCompleteProfileLoader.observer = observer
      state.booted = true
      if (!state.reason) state.reason = 'watching'
      note('watching ' + BUSY_ATTRIBUTE + ' on the form; min display ' + minMs + 'ms.')
    } else {
      state.reason = 'no-mutation-observer'
      warn('this browser has no MutationObserver; the loader stays hidden.')
    }
  } catch (error) {
    state.reason = 'observe-failed'
    warn('could not watch the form: ' + describe(error))
  }
})()
