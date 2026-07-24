/**
 * V3 onboarding product tours (driver.js).
 *
 * Attribute-driven page tours for onboarding members to the V3 platform.
 * Steps are authored in the Webflow Designer, so copy changes need no code
 * release:
 *
 *   data-tour-step="starter-dashboard:1"   required; unique "<tourId>:<order>"
 *                                          value per page
 *   data-tour-title="Your dashboard"       popover title
 *   data-tour-text="Track your ..."        popover body
 *   data-tour-side="bottom"                optional driver.js popover side
 *   data-tour-align="start"                optional driver.js popover align
 *   data-tour-target="<css>|text:<label>"  optional; highlight a DIFFERENT
 *                                          element than the tagged one (e.g. a
 *                                          button inside a shared component
 *                                          that can't carry the attribute).
 *                                          CSS selector, or text:<label> to
 *                                          match by visible text.
 *   data-tour-open="<css selector>"        optional; a disclosure control (e.g.
 *                                          an avatar toggle) clicked to reveal
 *                                          data-tour-target before highlighting,
 *                                          and restored on leave. A step whose
 *                                          open control is not visible (e.g.
 *                                          collapsed into a mobile hamburger) is
 *                                          dropped from the tour.
 *   data-tour-roles="talent"               optional, on any step; comma list of
 *                                          roles the tour auto-starts for
 *   data-tour-once="false"                 optional, on any step; disable the
 *                                          show-once persistence for the tour
 *   data-tour-start="starter-dashboard"    optional, on any element; click
 *                                          replays the tour regardless of state
 *
 * Replay controls (staging and prod; tours are presentation-only):
 *   ?tour=<tourId>   starts that tour on demand, bypassing roles and
 *                    seen-state; never marks it seen
 *   ?tour=reset      clears the visitor's seen-state (member JSON tours key,
 *                    or guest localStorage) so auto-start runs again
 *   Alt+Shift+T      replays the page's first tour (ignored while typing)
 *
 * Behavior:
 *   - At most one tour auto-starts per page load (first eligible in DOM order).
 *   - A tour with data-tour-roles only auto-starts for a member whose stable
 *     Memberstack plan-ID role matches; role mapping is identical to
 *     v3/route-guard.js / v3/auth-route.js (never gate on plan display names).
 *   - Seen-state persists per member in Memberstack member JSON under
 *     json.tours[tourId], so a tour shows once per member, not per device.
 *     Logged-out visitors on public pages fall back to localStorage.
 *   - driver.js (MIT) JS + CSS load from jsDelivr on demand, pinned to an
 *     exact version, only when the page actually has an eligible tour.
 *
 * This module is presentation-only: it never gates access. Route protection
 * stays with v3/route-guard.js and Memberstack gated content.
 *
 * See v3/ONBOARDING-TOUR-WIRING.md and INITIATIVE-125.
 */
;(function () {
  'use strict'

  if (window.__startersV3OnboardingTourBooted) return
  window.__startersV3OnboardingTourBooted = true

  var DRIVER_VERSION = '1.8.0'
  var DRIVER_JS_URL =
    'https://cdn.jsdelivr.net/npm/driver.js@' +
    DRIVER_VERSION +
    '/dist/driver.js.iife.js'
  var DRIVER_CSS_URL =
    'https://cdn.jsdelivr.net/npm/driver.js@' + DRIVER_VERSION + '/dist/driver.css'
  var DRIVER_LOAD_TIMEOUT_MS = 15000
  var MEMBERSTACK_TIMEOUT_MS = 10000
  var SETTLE_DELAY_MS = 1000
  var GUEST_STORAGE_KEY = 'thestarters:v3-tours-seen'

  // Identical to v3/route-guard.js, v3/auth-route.js and opportunities-3.0.js
  // (MS_PLAN_ROLES). Stable plan IDs only; display names are not contracts.
  var PLAN_ROLES = {
    'pln_free-plan-f6kn0dxz': 'brand-free',
    'pln_new-paid-plan-463h04ph': 'brand-paid',
    'pln_dorxata-test-free-plan-dvcg0k8o': 'talent',
    'pln_dorxata-test-brand-plan-777r02pa': 'brand-paid',
  }

  function activePlanIds(member) {
    return (member && member.planConnections ? member.planConnections : [])
      .filter(function (connection) {
        return connection.active === true || connection.status === 'ACTIVE'
      })
      .map(function (connection) {
        return connection.planId
      })
  }

  // Mixed mapped/unmapped plans use the highest mapped role, matching
  // v3/auth-route.js.
  function memberRole(member) {
    var roles = activePlanIds(member)
      .map(function (planId) {
        return PLAN_ROLES[planId]
      })
      .filter(Boolean)

    if (roles.includes('brand-paid')) return 'brand-paid'
    if (roles.includes('brand-free')) return 'brand-free'
    if (roles.includes('talent')) return 'talent'
    return null
  }

  // ---------------------------------------------------------------------
  // Step parsing
  // ---------------------------------------------------------------------

  // Collects [data-tour-step] elements under root into per-tour definitions:
  // { id, steps: [{ selector, target, order, title, text, side, align }],
  //   roles, once }.
  // Steps sort by order (ties keep DOM order); malformed and duplicate values
  // are skipped with a console warning rather than breaking the page.
  function parseTours(root) {
    var nodes = root.querySelectorAll('[data-tour-step]')
    var tours = Object.create(null)
    var seenStepValues = Object.create(null)
    var orderOfAppearance = []

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i]
      var raw = node.getAttribute('data-tour-step') || ''
      var splitAt = raw.lastIndexOf(':')
      var tourId = splitAt > 0 ? raw.slice(0, splitAt).trim() : ''
      var order = splitAt > 0 ? parseInt(raw.slice(splitAt + 1), 10) : NaN

      if (!tourId || isNaN(order)) {
        console.warn(
          '[v3-onboarding-tour] Ignoring malformed data-tour-step:',
          raw,
        )
        continue
      }
      if (Object.prototype.hasOwnProperty.call(seenStepValues, raw)) {
        console.warn(
          '[v3-onboarding-tour] Ignoring duplicate data-tour-step:',
          raw,
        )
        continue
      }
      seenStepValues[raw] = true

      var tour = tours[tourId]
      if (!tour) {
        tour = tours[tourId] = { id: tourId, steps: [], roles: null, once: true }
        orderOfAppearance.push(tour)
      }

      var rolesAttr = node.getAttribute('data-tour-roles')
      if (rolesAttr) {
        var roles = rolesAttr
          .split(',')
          .map(function (role) {
            return role.trim()
          })
          .filter(Boolean)
        tour.roles = (tour.roles || []).concat(
          roles.filter(function (role) {
            return (tour.roles || []).indexOf(role) === -1
          }),
        )
      }
      if (node.getAttribute('data-tour-once') === 'false') tour.once = false

      tour.steps.push({
        // A selector, not the node: V3 pages hydrate after DOMContentLoaded
        // (dashboard hero, tiles), which can detach the nodes captured here.
        // driver.js re-resolves selector strings at each step, so the tour
        // always highlights the live element.
        selector: '[data-tour-step="' + cssAttrEscape(raw) + '"]',
        // Optional highlight override. Lets a step tagged on a page-scoped
        // element point driver.js at a different element that can't carry the
        // attribute itself (e.g. a button inside a shared component, where
        // custom attributes are Designer-only). Two forms:
        //   data-tour-target="<css selector>"   highlight that selector
        //   data-tour-target="text:<label>"     highlight the smallest visible
        //                                        element whose trimmed text
        //                                        equals <label>
        target: node.getAttribute('data-tour-target') || '',
        // Optional disclosure to open before highlighting: a CSS selector for a
        // control (e.g. an account-menu avatar toggle) that must be clicked to
        // reveal data-tour-target. The step opens it on highlight and restores
        // it on leave. A step whose open control is not visible (e.g. the
        // avatar is collapsed into a mobile hamburger) is dropped from the tour.
        open: node.getAttribute('data-tour-open') || '',
        order: order,
        title: node.getAttribute('data-tour-title') || '',
        text: node.getAttribute('data-tour-text') || '',
        side: node.getAttribute('data-tour-side') || '',
        align: node.getAttribute('data-tour-align') || '',
      })
    }

    orderOfAppearance.forEach(function (tour) {
      // Stable sort: equal orders keep Designer/DOM order.
      tour.steps = tour.steps
        .map(function (step, index) {
          return { step: step, index: index }
        })
        .sort(function (a, b) {
          return a.step.order - b.step.order || a.index - b.index
        })
        .map(function (entry) {
          return entry.step
        })
    })

    return orderOfAppearance
  }

  // Escapes a value for use inside a double-quoted CSS attribute selector.
  function cssAttrEscape(value) {
    return value.replace(/[\0-\x1f\x7f"\\]/g, function (character) {
      if (character === '"' || character === '\\') return '\\' + character
      return '\\' + character.charCodeAt(0).toString(16) + ' '
    })
  }

  function findSmallestVisibleTextMatch(selector, label) {
    var all = document.querySelectorAll(selector)
    var best = null
    var bestSize = Infinity
    for (var i = 0; i < all.length; i++) {
      var el = all[i]
      if ((el.textContent || '').trim() !== label) continue
      var rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue // hidden
      var size = el.getElementsByTagName('*').length
      if (size < bestSize) {
        best = el
        bestSize = size
      }
    }
    return best
  }

  // Finds the smallest visible interactive element whose trimmed text equals
  // label, falling back to non-interactive text containers when needed.
  function findElementByText(label) {
    return (
      findSmallestVisibleTextMatch('a, button, [role="button"]', label) ||
      findSmallestVisibleTextMatch('span, div, p', label)
    )
  }

  // Resolves a step's highlight to a selector string or a live Element.
  // driver.js accepts either. Falls back to the step's own selector when a
  // target is set but cannot be resolved, so the tour never breaks.
  function resolveStepElement(step) {
    if (!step.target) return step.selector
    if (step.target.indexOf('text:') === 0) {
      var el = findElementByText(step.target.slice('text:'.length).trim())
      return el || step.selector
    }
    try {
      return document.querySelector(step.target) ? step.target : step.selector
    } catch (error) {
      return step.selector
    }
  }

  function isVisible(el) {
    if (!el) return false
    var rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  // Toggles a Webflow-style disclosure (dropdown/menu). A synthetic .click()
  // is ignored by Webflow's dropdown runtime, so dispatch the full mouse
  // sequence it listens for. Returns the toggle element, or null if absent.
  function toggleDisclosure(selector) {
    var toggle
    try {
      toggle = document.querySelector(selector)
    } catch (error) {
      return null
    }
    if (!toggle) return null
    ;['mousedown', 'mouseup', 'click'].forEach(function (type) {
      toggle.dispatchEvent(
        new window.MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      )
    })
    return toggle
  }

  // The active driver instance, so per-step hooks can reposition the popover
  // after a disclosure opens (its content may reveal/animate asynchronously).
  var activeInstance = null

  // The disclosure selector the tour currently has open (only one at a time),
  // so it can be closed again when the step is left or the tour ends.
  var openedDisclosure = null
  function restoreOpenedDisclosure() {
    if (!openedDisclosure) return
    var selector = openedDisclosure
    openedDisclosure = null
    toggleDisclosure(selector)
  }

  // Reposition a few times so the popover follows the revealed element as the
  // disclosure finishes opening, without depending on one exact timing.
  function scheduleRefresh() {
    ;[150, 350, 600].forEach(function (ms) {
      window.setTimeout(function () {
        try {
          if (activeInstance && typeof activeInstance.refresh === 'function') {
            activeInstance.refresh()
          }
        } catch (error) {
          // Instance may have been destroyed between schedule and fire.
        }
      }, ms)
    })
  }

  function buildDriverSteps(tour) {
    return tour.steps
      .map(function (step) {
        // Drop a disclosure step whose control is not currently visible
        // (e.g. the avatar toggle collapsed into a mobile hamburger).
        if (step.open) {
          var opener = null
          try {
            opener = document.querySelector(step.open)
          } catch (error) {
            opener = null
          }
          if (!isVisible(opener)) return null
        }

        var popover = {}
        if (step.title) popover.title = step.title
        if (step.text) popover.description = step.text
        if (step.side) popover.side = step.side
        if (step.align) popover.align = step.align

        var driverStep = { element: resolveStepElement(step), popover: popover }

        // Every step first restores any disclosure a previous step opened, so
        // moving on (next or prev) closes the menu; then this step opens its
        // own if needed. The end-of-tour watcher in startTour handles the final
        // step's close (no later step fires to restore it).
        driverStep.onHighlightStarted = function () {
          restoreOpenedDisclosure()
          if (step.open && !isVisible(resolvedTarget(step))) {
            toggleDisclosure(step.open)
            openedDisclosure = step.open
            scheduleRefresh()
          }
        }
        return driverStep
      })
      .filter(Boolean)
  }

  // The live element a step points at (for visibility checks in hooks).
  function resolvedTarget(step) {
    var resolved = resolveStepElement(step)
    if (typeof resolved !== 'string') return resolved
    try {
      return document.querySelector(resolved)
    } catch (error) {
      return null
    }
  }

  // The first tour (DOM order) that should auto-start for this visitor, or
  // null. seenIds is an array of tour IDs already seen. Pure; the async seen
  // lookups happen in boot().
  function autoStartTarget(tours, role, seenIds) {
    for (var i = 0; i < tours.length; i++) {
      var tour = tours[i]
      if (!tour.steps.length) continue
      if (tour.roles && (!role || tour.roles.indexOf(role) === -1)) continue
      if (tour.once && seenIds.indexOf(tour.id) !== -1) continue
      return tour
    }
    return null
  }

  // ---------------------------------------------------------------------
  // Seen-state persistence
  // ---------------------------------------------------------------------

  function guestSeenIds() {
    try {
      var raw = window.localStorage.getItem(GUEST_STORAGE_KEY)
      var parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      return []
    }
  }

  function guestMarkSeen(tourId) {
    try {
      var seen = guestSeenIds()
      if (seen.indexOf(tourId) === -1) seen.push(tourId)
      window.localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(seen))
    } catch (error) {
      // Private mode / blocked storage: the tour may replay next visit.
    }
  }

  function memberJson(response) {
    if (response && response.data && typeof response.data === 'object') {
      return response.data
    }
    return response && typeof response === 'object' ? response : {}
  }

  async function memberSeenIds(memberstack) {
    try {
      var response = await memberstack.getMemberJSON()
      var json = memberJson(response)
      return json && json.tours ? Object.keys(json.tours) : []
    } catch (error) {
      console.warn('[v3-onboarding-tour] Could not read member JSON', error)
      return null // unknown; caller decides whether to fail open or closed
    }
  }

  async function memberMarkSeen(memberstack, tourId) {
    try {
      var response = await memberstack.getMemberJSON()
      var json = memberJson(response)
      var tours = Object.create(null)
      if (json.tours && typeof json.tours === 'object') {
        Object.keys(json.tours).forEach(function (id) {
          tours[id] = json.tours[id]
        })
      }
      tours[tourId] = new Date().toISOString()
      json.tours = tours
      await memberstack.updateMemberJSON({ json: json })
    } catch (error) {
      console.warn('[v3-onboarding-tour] Could not persist tour state', error)
    }
  }

  // ---------------------------------------------------------------------
  // driver.js loading
  // ---------------------------------------------------------------------

  function currentDriverFactory() {
    return window.driver && window.driver.js && window.driver.js.driver
  }

  var driverLoadPromise = null
  var driverLoadFailed = false
  var tourStartInFlight = false
  function loadDriver() {
    var existing = currentDriverFactory()
    if (existing && !driverLoadFailed) return Promise.resolve(existing)
    if (driverLoadPromise) return driverLoadPromise

    var loadAttempt = new Promise(function (resolve, reject) {
      var link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = DRIVER_CSS_URL

      var script = document.createElement('script')
      script.src = DRIVER_JS_URL
      script.defer = true

      var cssLoaded = false
      var scriptLoaded = false
      var settled = false

      function remove(element) {
        if (element.parentNode) element.parentNode.removeChild(element)
      }

      function fail(error) {
        if (settled) return
        settled = true
        driverLoadFailed = true
        window.clearTimeout(timer)
        remove(link)
        remove(script)
        reject(error)
      }

      function finish() {
        if (settled || !cssLoaded || !scriptLoaded) return
        var factory = currentDriverFactory()
        if (!factory) {
          fail(new Error('driver.js loaded but factory missing'))
          return
        }
        settled = true
        driverLoadFailed = false
        window.clearTimeout(timer)
        resolve(factory)
      }

      var timer = window.setTimeout(function () {
        fail(new Error('driver.js assets load timed out'))
      }, DRIVER_LOAD_TIMEOUT_MS)

      link.onload = function () {
        cssLoaded = true
        finish()
      }
      link.onerror = function () {
        fail(new Error('driver.js stylesheet failed to load'))
      }
      script.onload = function () {
        scriptLoaded = true
        finish()
      }
      script.onerror = function () {
        fail(new Error('driver.js script failed to load'))
      }
      document.head.appendChild(link)
      document.head.appendChild(script)
    })
    driverLoadPromise = loadAttempt.catch(function (error) {
      driverLoadPromise = null
      throw error
    })
    return driverLoadPromise
  }

  // Themes the popover with the site's own typography: serif headings and
  // sans body copy. Fonts are read from the live page (first heading / body)
  // so a site-wide font change follows automatically; the fallbacks are the
  // brand stacks in use at ship time.
  var themeInjected = false
  function injectThemeStyle() {
    if (themeInjected) return
    themeInjected = true
    var style = document.createElement('style')
    style.textContent =
      '.driver-popover .driver-popover-title{' +
      'font-family:var(--starters-tour-title-font,Baskervville,Georgia,serif);' +
      'font-weight:500;}' +
      '.driver-popover .driver-popover-description{' +
      'font-family:var(--starters-tour-text-font,"Inter Variable",Tahoma,sans-serif);}'
    document.head.appendChild(style)
    try {
      var heading = document.querySelector('h1, h2, .heading-style-h1')
      if (heading) {
        document.documentElement.style.setProperty(
          '--starters-tour-title-font',
          window.getComputedStyle(heading).fontFamily,
        )
      }
      document.documentElement.style.setProperty(
        '--starters-tour-text-font',
        window.getComputedStyle(document.body).fontFamily,
      )
    } catch (error) {
      // Computed styles unavailable: the fallback stacks in the CSS apply.
    }
  }

  async function startTour(tour) {
    if (tourStartInFlight || document.querySelector('.driver-popover')) {
      return null
    }
    tourStartInFlight = true
    try {
      injectThemeStyle()
      var driverFactory = await loadDriver()
      // Build once: disclosure steps whose control is hidden get dropped, so
      // the built count (not tour.steps) decides the progress indicator.
      var driverSteps = buildDriverSteps(tour)
      var instance = driverFactory({
        showProgress: driverSteps.length > 1,
        steps: driverSteps,
      })
      activeInstance = instance
      instance.drive()
      // The flag only covers the async start window. Once the popover is in
      // the DOM, the DOM check above is the authoritative "running" signal —
      // driver 1.8's onDestroyed hook does not fire for close-button
      // dismissals, so a callback-based release would stick and block every
      // later replay. The timeout bound releases even if drive() rendered
      // nothing (e.g. all step elements disappeared).
      var releaseStartedAt = Date.now()
      var releaseTimer = window.setInterval(function () {
        if (
          document.querySelector('.driver-popover') ||
          Date.now() - releaseStartedAt >= 2000
        ) {
          window.clearInterval(releaseTimer)
          tourStartInFlight = false
        }
      }, 100)
      // Once the tour ends (popover gone after having appeared), close any
      // disclosure the last step left open. Covers Done and X-dismiss, which
      // fire no reliable driver callback. Only armed when a step actually opens
      // a disclosure, and self-stops if the tour never renders, so it never
      // spins indefinitely.
      if (
        tour.steps.some(function (step) {
          return step.open
        })
      ) {
        var endWatchStartedAt = Date.now()
        var appeared = false
        var endWatch = window.setInterval(function () {
          if (document.querySelector('.driver-popover')) {
            appeared = true
            return
          }
          if (appeared || Date.now() - endWatchStartedAt >= 15000) {
            window.clearInterval(endWatch)
            restoreOpenedDisclosure()
          }
        }, 200)
      }
      window.dispatchEvent(
        new CustomEvent('starters:v3-tour-started', {
          detail: { tourId: tour.id },
        }),
      )
      return instance
    } catch (error) {
      tourStartInFlight = false
      throw error
    }
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  function waitForMemberstack() {
    if (
      window.$memberstackDom &&
      typeof window.$memberstackDom.getCurrentMember === 'function'
    ) {
      return Promise.resolve(window.$memberstackDom)
    }

    return new Promise(function (resolve) {
      var startedAt = Date.now()
      var timer = window.setInterval(function () {
        if (
          window.$memberstackDom &&
          typeof window.$memberstackDom.getCurrentMember === 'function'
        ) {
          window.clearInterval(timer)
          resolve(window.$memberstackDom)
          return
        }

        if (Date.now() - startedAt >= MEMBERSTACK_TIMEOUT_MS) {
          window.clearInterval(timer)
          resolve(null)
        }
      }, 100)
    })
  }

  function wireManualTriggers(tours) {
    var triggers = document.querySelectorAll('[data-tour-start]')
    for (var i = 0; i < triggers.length; i++) {
      ;(function (trigger) {
        trigger.addEventListener('click', function (event) {
          event.preventDefault()
          var tourId = trigger.getAttribute('data-tour-start')
          var tour = tours.filter(function (candidate) {
            return candidate.id === tourId
          })[0]
          if (!tour) {
            console.warn('[v3-onboarding-tour] No steps found for tour:', tourId)
            return
          }
          startTour(tour).catch(function (error) {
            console.error('[v3-onboarding-tour] Manual tour failed', error)
          })
        })
      })(triggers[i])
    }
  }

  function findTour(tours, tourId) {
    return (
      tours.filter(function (candidate) {
        return candidate.id === tourId
      })[0] || null
    )
  }

  // Replay controls from the URL: ?tour=<tourId> starts that tour on demand
  // (bypasses roles and seen-state, never marks seen); ?tour=reset clears the
  // visitor's seen-state so the page's normal auto-start runs again. Works on
  // staging and prod alike; harmless because tours are presentation-only.
  function replayRequestFromQuery(search) {
    var value = ''
    try {
      value = new window.URLSearchParams(search).get('tour') || ''
    } catch (error) {
      value = ''
    }
    value = value.trim()
    if (!value) return { startTourId: null, reset: false }
    if (value === 'reset') return { startTourId: null, reset: true }
    return { startTourId: value, reset: false }
  }

  async function clearSeen(memberstack, member) {
    if (member && member.id) {
      try {
        var response = await memberstack.getMemberJSON()
        var json = memberJson(response)
        if (json && json.tours) {
          delete json.tours
          await memberstack.updateMemberJSON({ json: json })
        }
      } catch (error) {
        console.warn('[v3-onboarding-tour] Could not reset tour state', error)
      }
    }
    try {
      window.localStorage.removeItem(GUEST_STORAGE_KEY)
    } catch (error) {
      // Blocked storage: nothing to clear.
    }
  }

  // Alt+Shift+T replays the page's first tour (support/QA affordance, works
  // on prod too). e.code keeps it keyboard-layout independent, and inputs
  // are excluded so typing never triggers it.
  function wireKeyboardShortcut(tours) {
    window.addEventListener('keydown', function (event) {
      if (!event.altKey || !event.shiftKey || event.code !== 'KeyT') return
      if (event.repeat) return
      var target = event.target || {}
      var tag = (target.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || target.isContentEditable) {
        return
      }
      event.preventDefault()
      startTour(tours[0]).catch(function (error) {
        console.error('[v3-onboarding-tour] Shortcut tour failed', error)
      })
    })
  }

  // Let post-load hydration (dashboard hero, wf-xano tiles) settle before
  // highlighting, so the first paint of the tour lands on final layout.
  function waitForSettle() {
    return new Promise(function (resolve) {
      if (document.readyState === 'complete') {
        window.setTimeout(resolve, SETTLE_DELAY_MS)
        return
      }
      window.addEventListener(
        'load',
        function () {
          window.setTimeout(resolve, SETTLE_DELAY_MS)
        },
        { once: true },
      )
    })
  }

  async function boot() {
    var tours = parseTours(document)
    if (!tours.length) return
    wireManualTriggers(tours)
    wireKeyboardShortcut(tours)
    var replay = replayRequestFromQuery(window.location.search)

    // Wait for the route guard where present, so a redirecting page never
    // flashes a tour. 'allowed' is set synchronously before this microtask
    // on guarded pages; unguarded pages have no attribute and proceed.
    var guardState = document.documentElement.getAttribute('data-route-guard')
    if (guardState === 'checking') {
      await new Promise(function (resolve) {
        window.addEventListener('starters:v3-route-guard-allowed', resolve, {
          once: true,
        })
      })
    }

    var memberstack = await waitForMemberstack()
    var member = null
    if (memberstack) {
      try {
        var response = await memberstack.getCurrentMember()
        member = (response && response.data) || null
      } catch (error) {
        member = null
      }
    }
    var role = memberRole(member)

    if (replay.reset) await clearSeen(memberstack, member)

    if (replay.startTourId) {
      var requested = findTour(tours, replay.startTourId)
      if (!requested) {
        console.warn(
          '[v3-onboarding-tour] No steps found for requested tour:',
          replay.startTourId,
        )
        return
      }
      await waitForSettle()
      if (!document.querySelector(requested.steps[0].selector)) return
      await startTour(requested)
      return
    }

    var seenIds
    if (member && member.id) {
      seenIds = await memberSeenIds(memberstack)
      // Unknown seen-state fails closed: never nag a member because a
      // Memberstack read hiccuped.
      if (seenIds === null) return
    } else {
      seenIds = guestSeenIds()
    }

    var target = autoStartTarget(tours, role, seenIds)
    if (!target) return

    await waitForSettle()
    // Hydration may have removed the tour's markup entirely; re-check.
    if (!document.querySelector(target.steps[0].selector)) return

    var instance = await startTour(target)
    if (instance && target.once) {
      if (member && member.id) await memberMarkSeen(memberstack, target.id)
      else guestMarkSeen(target.id)
    }
  }

  window.StartersV3OnboardingTour = {
    activePlanIds: activePlanIds,
    memberRole: memberRole,
    parseTours: parseTours,
    buildDriverSteps: buildDriverSteps,
    resolveStepElement: resolveStepElement,
    autoStartTarget: autoStartTarget,
    replayRequestFromQuery: replayRequestFromQuery,
    loadDriver: loadDriver,
    startTour: startTour,
  }

  function run() {
    return boot().catch(function (error) {
      console.error('[v3-onboarding-tour] Boot failed', error)
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true })
  } else {
    run()
  }
})()
