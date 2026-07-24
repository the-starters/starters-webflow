/**
 * V3 onboarding product tours (driver.js).
 *
 * Attribute-driven page tours for onboarding members to the V3 platform.
 * Steps are authored in the Webflow Designer, so copy changes need no code
 * release:
 *
 *   data-tour-step="starter-dashboard:1"   required; "<tourId>:<order>"
 *   data-tour-title="Your dashboard"       popover title
 *   data-tour-text="Track your ..."        popover body
 *   data-tour-side="bottom"                optional driver.js popover side
 *   data-tour-align="start"                optional driver.js popover align
 *   data-tour-roles="talent"               optional, on any step; comma list of
 *                                          roles the tour auto-starts for
 *   data-tour-once="false"                 optional, on any step; disable the
 *                                          show-once persistence for the tour
 *   data-tour-start="starter-dashboard"    optional, on any element; click
 *                                          replays the tour regardless of state
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
  // { id, steps: [{ element, order, title, text, side, align }], roles, once }.
  // Steps sort by order (ties keep DOM order); malformed values are skipped
  // with a console warning rather than breaking the page.
  function parseTours(root) {
    var nodes = root.querySelectorAll('[data-tour-step]')
    var tours = {}
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
        element: node,
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

  function buildDriverSteps(tour) {
    return tour.steps.map(function (step) {
      var popover = {}
      if (step.title) popover.title = step.title
      if (step.text) popover.description = step.text
      if (step.side) popover.side = step.side
      if (step.align) popover.align = step.align
      return { element: step.element, popover: popover }
    })
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

  async function memberSeenIds(memberstack) {
    try {
      var response = await memberstack.getMemberJSON()
      var json = response && response.data
      return json && json.tours ? Object.keys(json.tours) : []
    } catch (error) {
      console.warn('[v3-onboarding-tour] Could not read member JSON', error)
      return null // unknown; caller decides whether to fail open or closed
    }
  }

  async function memberMarkSeen(memberstack, tourId) {
    try {
      var response = await memberstack.getMemberJSON()
      var json = (response && response.data) || {}
      if (!json.tours) json.tours = {}
      json.tours[tourId] = new Date().toISOString()
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
  function loadDriver() {
    var existing = currentDriverFactory()
    if (existing) return Promise.resolve(existing)
    if (driverLoadPromise) return driverLoadPromise

    driverLoadPromise = new Promise(function (resolve, reject) {
      var link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = DRIVER_CSS_URL
      document.head.appendChild(link)

      var script = document.createElement('script')
      script.src = DRIVER_JS_URL
      script.defer = true

      var timer = window.setTimeout(function () {
        reject(new Error('driver.js load timed out'))
      }, DRIVER_LOAD_TIMEOUT_MS)

      script.onload = function () {
        window.clearTimeout(timer)
        var factory = currentDriverFactory()
        if (factory) resolve(factory)
        else reject(new Error('driver.js loaded but factory missing'))
      }
      script.onerror = function () {
        window.clearTimeout(timer)
        reject(new Error('driver.js failed to load'))
      }
      document.head.appendChild(script)
    })
    return driverLoadPromise
  }

  async function startTour(tour) {
    var driverFactory = await loadDriver()
    var instance = driverFactory({
      showProgress: tour.steps.length > 1,
      steps: buildDriverSteps(tour),
    })
    instance.drive()
    window.dispatchEvent(
      new CustomEvent('starters:v3-tour-started', {
        detail: { tourId: tour.id },
      }),
    )
    return instance
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

  async function boot() {
    var tours = parseTours(document)
    if (!tours.length) return
    wireManualTriggers(tours)

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

    // Mark before starting so a mid-tour refresh or crash never replays it.
    if (target.once) {
      if (member && member.id) await memberMarkSeen(memberstack, target.id)
      else guestMarkSeen(target.id)
    }
    await startTour(target)
  }

  window.StartersV3OnboardingTour = {
    activePlanIds: activePlanIds,
    memberRole: memberRole,
    parseTours: parseTours,
    buildDriverSteps: buildDriverSteps,
    autoStartTarget: autoStartTarget,
    startTour: startTour,
  }

  function run() {
    boot().catch(function (error) {
      console.error('[v3-onboarding-tour] Boot failed', error)
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true })
  } else {
    run()
  }
})()
