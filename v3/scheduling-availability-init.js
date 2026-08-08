;(function () {
  'use strict'

  const STAGING_HOST = 'the-starters-3-0.webflow.io'
  const PRODUCTION_HOSTS = new Set(['thestarters.com', 'www.thestarters.com'])
  const PRODUCTION_PATH = '/starter-dashboard'
  const STARTER_ENDPOINT =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/starter/get_by_memberstack/v3'
  const CACHE_PREFIX = 'starter-scheduling-availability:'
  const STATUS_ATTRIBUTE = 'data-scheduling-availability-init'
  const CONNECTION_STATUS_ATTRIBUTE = 'data-scheduling-calendar-state'

  // TEMPORARY staging QA override (?test_member_id=...). Read/UI-state only:
  // it never bypasses Bearer auth or server ownership checks, and must never
  // be used for profile or scheduling writes. Allowlist Memberstack Test-Data
  // sandbox QA members only — never live member IDs.
  // The override must remain independently staging-host gated. Production
  // dashboard reads always use the authenticated Memberstack member.
  const TEST_MEMBER_PARAM = 'test_member_id'
  const TEST_MEMBER_ALLOWLIST = ['mem_sb_cmqhuaxn80d270sseeo74fn7i']
  const TEST_MEMBER_ID_PATTERN = /^mem_(?:sb_)?[a-z0-9]{10,64}$/
  const TEST_MEMBER_ATTRIBUTE = 'data-scheduling-test-member'

  const activePath = window.location.pathname.replace(/\/+$/, '') || '/'
  const isStagingHost = window.location.hostname === STAGING_HOST
  const isApprovedProductionPath =
    PRODUCTION_HOSTS.has(window.location.hostname) && activePath === PRODUCTION_PATH
  if (!isStagingHost && !isApprovedProductionPath) return
  if (window.__tsSchedulingAvailabilityInit) return
  window.__tsSchedulingAvailabilityInit = true

  let activeAvailability = null
  let activeConnectionState = 'loading'

  function setStatus(value) {
    document.documentElement.setAttribute(STATUS_ATTRIBUTE, value)
  }

  function isAvailability(value) {
    return Boolean(
      value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        value.items &&
        typeof value.items === 'object' &&
        !Array.isArray(value.items),
    )
  }

  function normalizeAvailability(value) {
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value)
      } catch (error) {
        return null
      }
    }
    if (!isAvailability(value)) return null
    return {
      ...value,
      items: { ...value.items },
      manager: value.manager || null,
    }
  }

  function isFirstTimeV3Projection(starter) {
    const availability = starter && starter.availability
    const isEmptyAvailability =
      (Array.isArray(availability) && availability.length === 0) ||
      (availability &&
        typeof availability === 'object' &&
        !Array.isArray(availability) &&
        Object.keys(availability).length === 0)
    return Boolean(
      starter &&
        isEmptyAvailability &&
        !starter.nylas_grant_id &&
        !starter.nylas_calendar_id,
    )
  }

  function cacheKey(memberId) {
    return CACHE_PREFIX + memberId
  }

  function writeCachedAvailability(memberId, availability) {
    try {
      window.localStorage.setItem(
        cacheKey(memberId),
        JSON.stringify({ cachedAt: Date.now(), availability }),
      )
    } catch (error) {
      console.warn('[scheduling-availability] cache unavailable:', error && error.message)
    }
  }

  async function readStarter(memberId) {
    if (typeof window.xanoAuthFetch === 'function') {
      const response = await window.xanoAuthFetch(STARTER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId }),
      })
      const starter = await response.json().catch(function () {
        throw new Error('V3 scheduling reader returned invalid JSON')
      })
      if (!response.ok) {
        throw new Error('V3 scheduling reader failed (' + response.status + ')')
      }
      if (starter === null) return null
      if (
        typeof starter !== 'object' ||
        Array.isArray(starter) ||
        !Object.prototype.hasOwnProperty.call(starter, 'availability')
      ) {
        throw new Error('V3 scheduling reader returned invalid data')
      }
      return starter
    }
    if (typeof window.getStarterByMemberId === 'function') {
      return window.getStarterByMemberId(memberId)
    }
    throw new Error('Legacy scheduling availability reader not available')
  }

  function resolveTestMemberOverride() {
    // Independently hostname-gated so the override stays dead on the custom
    // production domains even if the top-level staging guard is later lifted.
    if (window.location.hostname !== STAGING_HOST) return null
    let value = null
    try {
      value = new URLSearchParams(window.location.search).get(TEST_MEMBER_PARAM)
    } catch (error) {
      return null
    }
    if (!value) return null
    if (
      !TEST_MEMBER_ID_PATTERN.test(value) ||
      TEST_MEMBER_ALLOWLIST.indexOf(value) === -1
    ) {
      // Deliberately does not echo the supplied value.
      console.warn(
        '[scheduling-availability] ignoring ' +
          TEST_MEMBER_PARAM +
          ': not an allowlisted staging test member',
      )
      return null
    }
    return value
  }

  async function currentMember() {
    const memberstack = window.$memberstackDom
    if (memberstack && typeof memberstack.getCurrentMember === 'function') {
      const result = await memberstack.getCurrentMember()
      const member = result && result.data
      if (member && member.id) return member
      throw new Error('No logged-in member')
    }

    if (window.memberReady && typeof window.memberReady.then === 'function') {
      const member = await window.memberReady
      if (member && member.id) return member
    }

    throw new Error('No logged-in member')
  }

  async function loadAvailability(readMemberId, sessionMemberId) {
    // Connection state must never come from the availability cache. A grant,
    // calendar, or configuration can change independently of saved hours, so
    // every initializer boot performs the authenticated canonical read.
    const starter = await readStarter(readMemberId)
    const verifiedMember = await currentMember()
    if (verifiedMember.id !== sessionMemberId) {
      const error = new Error('Member session changed during availability read')
      error.code = 'MEMBER_SCOPE_CHANGED'
      throw error
    }
    if (starter === null || isFirstTimeV3Projection(starter)) {
      // New V3 starters do not necessarily have an availability_v3 row yet.
      // Endpoint 1583 projects that state as availability=[] before the row
      // exists and availability={} after timezone bootstrap creates it. Both
      // use blank grant fields; older readers may still return null. A non-empty
      // container or an empty one paired with grant data stays invalid so a
      // malformed existing scheduling record does not fail open.
      return {
        availability: { items: {}, manager: null },
        connectionState: 'disconnected',
        source: 'default',
      }
    }

    const availability = normalizeAvailability(starter.availability)
    if (!availability) throw new Error('Starter availability is invalid')
    writeCachedAvailability(readMemberId, availability)
    const hasGrant = Boolean(starter.nylas_grant_id)
    const hasCalendar = Boolean(starter.nylas_calendar_id)
    const hasManager = Boolean(availability.manager)
    let connectionState = 'disconnected'
    if (hasGrant && hasCalendar) connectionState = 'loading'
    else if (hasGrant || hasCalendar || hasManager) connectionState = 'reconnect'
    return { availability, connectionState, source: 'starter' }
  }

  function showOnly(activeControls, inactiveControls) {
    inactiveControls.forEach(function (control) {
      control.style.display = 'none'
    })
    activeControls.forEach(function (control) {
      control.style.display = 'flex'
    })
  }

  function showStep(name) {
    const steps = document.querySelectorAll('[availability-step]')
    steps.forEach(function (step) {
      step.style.display = step.getAttribute('availability-step') === name ? 'block' : 'none'
    })
  }

  function bindStep(control, resolveStep) {
    if (!control) return
    control.__tsAvailabilityStepResolver = resolveStep
    if (control.__tsAvailabilityStepBound) return
    control.__tsAvailabilityStepBound = true
    control.addEventListener('click', function () {
      const stepName = control.__tsAvailabilityStepResolver()
      if (stepName) showStep(stepName)
    })
  }

  function renderConnectionAction(state, availability) {
    const actions = Array.from(document.querySelectorAll('[calendar-connection-action]'))
    actions.forEach(function (action) {
      action.setAttribute('data-calendar-connection-state', state)
      action.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false')
      action.style.display = state === 'connected' ? 'none' : 'flex'
      bindStep(action, function () {
        if (activeConnectionState === 'error') return 'config-request-error'
        return Object.keys((availability && availability.items) || {}).length > 0
          ? 'how-to-manage'
          : 'setup-form'
      })
    })
  }

  function renderState(availability, connectionState, selectInitialStep) {
    const shouldSelectStep = selectInitialStep !== false
    const initControls = Array.from(document.querySelectorAll('[init-availability]'))
    const updateControls = Array.from(document.querySelectorAll('[update-availability]'))
    if (!initControls.length && !updateControls.length) return null

    const hasAvailability = Object.keys(availability.items).length > 0
    const hasUsableConnection = connectionState === 'connected'
    if (hasAvailability || hasUsableConnection) {
      showOnly(updateControls, initControls)
      if (shouldSelectStep) showStep(hasAvailability ? 'default' : 'setup-form')
      updateControls.forEach(function (control) {
        bindStep(control, function () {
          if (!hasAvailability) return 'setup-form'
          if (
            activeConnectionState === 'disconnected' ||
            activeConnectionState === 'reconnect'
          ) {
            return 'how-to-manage'
          }
          if (activeConnectionState === 'error') return 'config-request-error'
          return 'default'
        })
      })
      return 'update'
    }

    showOnly(initControls, updateControls)
    if (shouldSelectStep) showStep('setup-form')
    initControls.forEach(function (control) {
      bindStep(control, function () {
        return activeConnectionState === 'error' ? 'config-request-error' : 'setup-form'
      })
    })
    return 'init'
  }

  function setConnectionState(state, detail) {
    const allowed = ['loading', 'disconnected', 'connected', 'reconnect', 'error']
    activeConnectionState = allowed.indexOf(state) > -1 ? state : 'error'
    document.documentElement.setAttribute(CONNECTION_STATUS_ATTRIBUTE, activeConnectionState)
    window.STARTER_SCHEDULING_CONNECTION = Object.assign({}, detail || {}, {
      state: activeConnectionState,
    })
    renderConnectionAction(activeConnectionState, activeAvailability)
    if (activeAvailability) renderState(activeAvailability, activeConnectionState, false)
    return activeConnectionState
  }

  function renderError() {
    const controls = Array.from(
      document.querySelectorAll('[init-availability], [update-availability]'),
    )
    controls.forEach(function (control) {
      control.style.display = 'none'
    })
    const heroControl = document.querySelector('[init-availability]')
    if (heroControl) {
      heroControl.style.display = 'flex'
      bindStep(heroControl, function () {
        return 'config-request-error'
      })
    }
    document.querySelectorAll('[availability-step]').forEach(function (step) {
      step.style.display = 'none'
    })
  }

  async function initialize() {
    if (
      !document.querySelector(
        '[init-availability], [update-availability], [calendar-connection-action]',
      )
    ) {
      setStatus('not-applicable')
      return null
    }

    setStatus('loading')
    setConnectionState('loading')
    try {
      const member = await currentMember()
      const testMemberId = resolveTestMemberOverride()
      if (testMemberId && typeof window.xanoAuthFetch !== 'function') {
        throw new Error('Authenticated staging test-member reader not available')
      }
      // The override only changes which member's availability is read and
      // which UI state renders; the session anchor stays the authenticated
      // member, and xanoAuthFetch keeps authenticating as that member.
      const readMemberId = testMemberId || member.id
      if (testMemberId) {
        document.documentElement.setAttribute(TEST_MEMBER_ATTRIBUTE, 'true')
      }
      const result = await loadAvailability(readMemberId, member.id)
      window.STARTER_AVAILABILITY = result.availability
      activeAvailability = result.availability
      setConnectionState(result.connectionState)
      const state = renderState(result.availability, activeConnectionState)
      setStatus(state || 'missing-controls')
      window.dispatchEvent(
        new CustomEvent('starterSchedulingAvailabilityReady', {
          detail: {
            memberId: readMemberId,
            source: testMemberId ? 'query-test' : result.source,
            state,
            connectionState: activeConnectionState,
          },
        }),
      )
      return state
    } catch (error) {
      window.STARTER_AVAILABILITY = null
      activeAvailability = null
      renderError()
      setConnectionState('error')
      setStatus('error')
      console.warn('[scheduling-availability] initialization failed:', error && error.message)
      window.dispatchEvent(
        new CustomEvent('starterSchedulingAvailabilityError', {
          detail: { message: (error && error.message) || 'Initialization failed' },
        }),
      )
      return null
    }
  }

  window.StarterSchedulingAvailability = {
    initialize,
    normalizeAvailability,
    renderState,
    setConnectionState,
  }

  window.addEventListener('starterSchedulingConnectionStateChanged', function (event) {
    const detail = (event && event.detail) || {}
    setConnectionState(detail.state, detail)
  })

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true })
  } else {
    initialize()
  }
})()
