;(function () {
  'use strict'

  const STAGING_HOST = 'the-starters-3-0.webflow.io'
  const PRODUCTION_HOSTS = new Set(['thestarters.com', 'www.thestarters.com'])
  const STAGE_PATHS = [
    '/starter-dashboard---availability-stage',
    '/brand-dashboard---availability-stage',
    '/messages-stage',
    '/hire-stage',
    '/hire/jp-dionisio',
  ]
  const PRODUCTION_PATHS = ['/hire/jp-dionisio']
  const XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
  const API_PREFIX = '/api:tCpV3oqd/'
  const STATUS_ATTRIBUTE = 'data-scheduling-v3-stage'

  const V3_PATHS = {
    'booking/cancel': 'booking/cancel/v3',
    'booking/live/cancel': 'booking/live/cancel/v3',
    'booking/confirm': 'booking/confirm/v3',
    'booking/decline': 'booking/decline/v3',
    'booking/reschedule': 'booking/reschedule/v3',
    'booking_record/archive': 'booking_record/archive/v3',
    'booking_record/get': 'booking_record/get/v3',
    'booking_record/get_one': 'booking_record/get_one/v3',
    'booking_record/payment_method_confirm': 'booking_record/payment_method_confirm/v3',
    'booking_record/update_paid_booking_price': 'booking_record/update_paid_booking_price/v3',
    'booking_record/update_payment_status': 'booking_record/update_payment_status/v3',
    'booking_record/update_reschedule': 'booking_record/update_reschedule/v3',
    'brands/customer/get': 'brands/customer/get/v3',
    'brands/update/customer_id': 'brands/update/customer_id/v3',
    'brands/update/payment_method': 'brands/update/payment_method/v3',
    'grants/add': 'grants/add/v3',
    'grants/add_virtual': 'grants/add_virtual/v3',
    'grants/create_virtual_account': 'grants/create_virtual_account/v3',
    'grants/create_virtual_calendar': 'grants/create_virtual_calendar/v3',
    'grants/delete': 'grants/delete/v3',
    'grants/oauth': 'grants/oauth/v3',
    'notetaker/get_media': 'notetaker/get_media/v3',
    'nylas_configurations/get_all': 'nylas_configurations/get_all/v3',
    'nylas_configurations/get_one': 'nylas_configurations/get_one/v3',
    'scheduler/configurations/create': 'scheduler/configurations/create/v3',
    'scheduler/configurations/delete': 'scheduler/configurations/delete/v3',
    'scheduler/configurations/update': 'scheduler/configurations/update/v3',
    'scheduler/get_availability': 'scheduler/get_availability/v3',
    'starter/clear_calendar_data': 'starter/clear_calendar_data/v3',
    'starter/get_by_memberstack': 'starter/get_by_memberstack/v3',
    'starter/get_charges_enabled': 'starter/get_charges_enabled/v3',
    'starter/set_timezone': 'starter/set_timezone/v3',
    'starter/update_availability': 'starter/update_availability/v3',
  }
  const HIRE_BOOKING_PATHS = {
    'nylas_configurations/get_all': 'nylas_configurations/get_bookable/v3',
    'starter/get_by_memberstack': 'starter/get_booking_profile/v3',
  }
  const LEGACY_PROVIDER_PATH = /^stripe\/(?:live\/)?(?:customer|payment_intent|payment_method|setup_intent)(?:\/|$)/

  function normalizedPagePath() {
    return window.location.pathname.replace(/\/+$/, '') || '/'
  }

  const activePath = normalizedPagePath()
  const activeHost = window.location.hostname
  const isStagingPath = activeHost === STAGING_HOST && STAGE_PATHS.includes(activePath)
  const isProductionPath =
    PRODUCTION_HOSTS.has(activeHost) && PRODUCTION_PATHS.includes(activePath)
  if (!isStagingPath && !isProductionPath) return
  if (window.__tsSchedulingV3Stage) return
  window.__tsSchedulingV3Stage = true

  const activeRouteMap = Object.freeze({
    ...V3_PATHS,
    ...(activePath === '/hire/jp-dionisio' ? HIRE_BOOKING_PATHS : {}),
  })
  const activeV3Targets = new Set(Object.values(activeRouteMap))

  const originalFetch = window.fetch.bind(window)

  function setStatus(value) {
    document.documentElement.setAttribute(STATUS_ATTRIBUTE, value)
  }

  function blockedResponse(route) {
    console.warn('[scheduling-v3-stage] blocked unclassified scheduling route:', route)
    return Promise.resolve(
      new Response(
        JSON.stringify({
          code: 'SCHEDULING_V3_ROUTE_BLOCKED',
          message: 'This scheduling action is not available in the V3 stage workflow.',
        }),
        { status: 410, headers: { 'Content-Type': 'application/json' } },
      ),
    )
  }

  function schedulingRoute(request) {
    let url
    try {
      url = new URL(request.url, window.location.href)
    } catch (error) {
      return null
    }
    if (url.origin !== XANO_ORIGIN || !url.pathname.startsWith(API_PREFIX)) return null
    return { url: url, route: url.pathname.slice(API_PREFIX.length) }
  }

  function requestAt(request, url) {
    return new Request(url.href, request)
  }

  function injectBookingIdentity(scheduler) {
    if (activePath !== '/hire/jp-dionisio' || !scheduler) return false

    const brandMemberstackId = window.MEMBER && window.MEMBER.id
    const starterMemberstackId = window.starter_memberstack_id
    if (!brandMemberstackId || !starterMemberstackId) return false

    const serialized = typeof scheduler.bookingInfo === 'string'
    let bookingInfo = scheduler.bookingInfo
    if (serialized) {
      try {
        bookingInfo = JSON.parse(bookingInfo)
      } catch (error) {
        console.warn('[scheduling-v3-stage] could not parse scheduler booking identity')
        return false
      }
    }
    if (!bookingInfo || typeof bookingInfo !== 'object') return false

    bookingInfo.additionalFields = bookingInfo.additionalFields || {}
    bookingInfo.additionalFields.brand_memberstack_id = {
      value: brandMemberstackId,
      type: 'text',
      readOnly: true,
    }
    bookingInfo.additionalFields.starter_memberstack_id = {
      value: starterMemberstackId,
      type: 'text',
      readOnly: true,
    }

    scheduler.bookingInfo = serialized ? JSON.stringify(bookingInfo) : bookingInfo
    return true
  }

  function installSchedulerIdentityObserver() {
    if (activePath !== '/hire/jp-dionisio') return

    function injectAvailableSchedulers() {
      if (!document.querySelectorAll) return false
      const schedulers = Array.from(document.querySelectorAll('nylas-scheduling'))
      if (!schedulers.length) return false
      let allInjected = true
      schedulers.forEach((scheduler) => {
        if (!injectBookingIdentity(scheduler)) allInjected = false
      })
      return allInjected
    }

    let retryId = null

    function startRetryLoop() {
      if (retryId !== null || typeof window.setInterval !== 'function') return
      retryId = window.setInterval(() => {
        const allInjected = injectAvailableSchedulers()
        if (allInjected && typeof window.clearInterval === 'function') {
          window.clearInterval(retryId)
          retryId = null
        }
      }, 500)
    }

    if (!injectAvailableSchedulers()) startRetryLoop()

    if (typeof MutationObserver === 'function') {
      const observer = new MutationObserver((records) => {
        let needsRetry = false
        for (const record of records) {
          for (const node of record.addedNodes || []) {
            if (!node || node.nodeType !== 1) continue
            if (
              node.matches &&
              node.matches('nylas-scheduling') &&
              !injectBookingIdentity(node)
            ) {
              needsRetry = true
            }
            if (node.querySelectorAll) {
              node.querySelectorAll('nylas-scheduling').forEach((scheduler) => {
                if (!injectBookingIdentity(scheduler)) needsRetry = true
              })
            }
          }
        }
        if (needsRetry) startRetryLoop()
      })
      observer.observe(document.documentElement, { childList: true, subtree: true })
    }
  }

  async function stageFetch(input, init) {
    const request = new Request(input, init)
    const scheduling = schedulingRoute(request)
    if (!scheduling) return originalFetch(request)

    const target = activeRouteMap[scheduling.route]
    if (target) {
      if (typeof window.xanoAuthFetch !== 'function') {
        setStatus('auth-unavailable')
        return blockedResponse(scheduling.route)
      }
      scheduling.url.pathname = API_PREFIX + target
      return window.xanoAuthFetch(requestAt(request, scheduling.url))
    }

    if (activeV3Targets.has(scheduling.route)) {
      if (typeof window.xanoAuthFetch !== 'function') {
        setStatus('auth-unavailable')
        return blockedResponse(scheduling.route)
      }
      return window.xanoAuthFetch(request)
    }

    if (LEGACY_PROVIDER_PATH.test(scheduling.route)) return originalFetch(request)

    return blockedResponse(scheduling.route)
  }

  window.fetch = stageFetch
  window.__tsSchedulingV3StageOriginalFetch = originalFetch
  window.StarterSchedulingV3Stage = Object.freeze({
    paths: STAGE_PATHS.slice(),
    productionPaths: PRODUCTION_PATHS.slice(),
    routeMap: activeRouteMap,
    injectBookingIdentity: injectBookingIdentity,
  })
  installSchedulerIdentityObserver()
  setStatus('ready')
  console.info('[scheduling-v3-stage] installed')
})()
