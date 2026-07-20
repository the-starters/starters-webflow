;(function () {
  'use strict'

  const STAGING_HOST = 'the-starters-3-0.webflow.io'
  const LEGACY_STARTER_ENDPOINT =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/starter/get_by_memberstack'
  const CACHE_PREFIX = 'starter-scheduling-availability:'
  const CACHE_TTL_MS = 5 * 60 * 1000
  const STATUS_ATTRIBUTE = 'data-scheduling-availability-init'

  // TEMPORARY staging QA override (?test_member_id=...). Read/UI-state only:
  // it never bypasses Bearer auth or server ownership checks, and must never
  // be used for profile or scheduling writes. Allowlist Memberstack Test-Data
  // sandbox QA members only — never live member IDs.
  // ⛔ LAUNCH BLOCKER: remove this override before enabling the script on the
  // custom production domains (thestarters.com / www.thestarters.com).
  const TEST_MEMBER_PARAM = 'test_member_id'
  const TEST_MEMBER_ALLOWLIST = ['mem_sb_cmqhuaxn80d270sseeo74fn7i']
  const TEST_MEMBER_ID_PATTERN = /^mem_(?:sb_)?[a-z0-9]{10,64}$/
  const TEST_MEMBER_ATTRIBUTE = 'data-scheduling-test-member'

  if (window.location.hostname !== STAGING_HOST) return
  if (window.__tsSchedulingAvailabilityInit) return
  window.__tsSchedulingAvailabilityInit = true

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

  function cacheKey(memberId) {
    return CACHE_PREFIX + memberId
  }

  function readCachedAvailability(memberId) {
    try {
      const cached = JSON.parse(window.localStorage.getItem(cacheKey(memberId)))
      const cacheAge = cached && Date.now() - cached.cachedAt
      if (
        !cached ||
        typeof cached.cachedAt !== 'number' ||
        cacheAge < 0 ||
        cacheAge > CACHE_TTL_MS
      ) {
        return null
      }
      return normalizeAvailability(cached.availability)
    } catch (error) {
      return null
    }
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
      const response = await window.xanoAuthFetch(LEGACY_STARTER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId }),
      })
      const starter = await response.json().catch(function () {
        throw new Error('Legacy scheduling reader returned invalid JSON')
      })
      if (!response.ok) {
        throw new Error('Legacy scheduling reader failed (' + response.status + ')')
      }
      if (starter === null) return null
      if (
        typeof starter !== 'object' ||
        Array.isArray(starter) ||
        !Object.prototype.hasOwnProperty.call(starter, 'availability')
      ) {
        throw new Error('Legacy scheduling reader returned invalid data')
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
    const cached = readCachedAvailability(readMemberId)
    if (cached) return { availability: cached, source: 'cache' }

    const starter = await readStarter(readMemberId)
    const verifiedMember = await currentMember()
    if (verifiedMember.id !== sessionMemberId) {
      const error = new Error('Member session changed during availability read')
      error.code = 'MEMBER_SCOPE_CHANGED'
      throw error
    }
    if (starter === null) {
      // New V3 starters do not necessarily have a legacy scheduling row yet.
      // Treat that as a first-time setup state instead of leaving both controls hidden.
      return { availability: { items: {}, manager: null }, source: 'default' }
    }

    const availability = normalizeAvailability(starter.availability)
    if (!availability) throw new Error('Starter availability is invalid')
    writeCachedAvailability(readMemberId, availability)
    return { availability, source: 'starter' }
  }

  function showOnly(active, inactive) {
    if (inactive) inactive.style.display = 'none'
    if (active) active.style.display = 'flex'
  }

  function showStep(name) {
    const steps = document.querySelectorAll('[availability-step]')
    steps.forEach(function (step) {
      step.style.display = step.getAttribute('availability-step') === name ? 'block' : 'none'
    })
  }

  function bindStep(control, stepName) {
    if (!control || control.__tsAvailabilityStepBound) return
    control.__tsAvailabilityStepBound = true
    control.addEventListener('click', function () {
      showStep(stepName)
    })
  }

  function renderState(availability) {
    const initControl = document.querySelector('[init-availability]')
    const updateControl = document.querySelector('[update-availability]')
    if (!initControl && !updateControl) return null

    const hasAvailability = Object.keys(availability.items).length > 0
    if (hasAvailability) {
      showOnly(updateControl, initControl)
      showStep('default')
      bindStep(updateControl, 'default')
      return 'update'
    }

    showOnly(initControl, updateControl)
    showStep('setup-form')
    bindStep(initControl, 'setup-form')
    return 'init'
  }

  function renderError() {
    const initControl = document.querySelector('[init-availability]')
    const updateControl = document.querySelector('[update-availability]')
    if (initControl) initControl.style.display = 'none'
    if (updateControl) updateControl.style.display = 'none'
    document.querySelectorAll('[availability-step]').forEach(function (step) {
      step.style.display = 'none'
    })
  }

  async function initialize() {
    if (!document.querySelector('[init-availability], [update-availability]')) {
      setStatus('not-applicable')
      return null
    }

    setStatus('loading')
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
      const state = renderState(result.availability)
      setStatus(state || 'missing-controls')
      window.dispatchEvent(
        new CustomEvent('starterSchedulingAvailabilityReady', {
          detail: {
            memberId: readMemberId,
            source: testMemberId ? 'query-test' : result.source,
            state,
          },
        }),
      )
      return state
    } catch (error) {
      window.STARTER_AVAILABILITY = null
      renderError()
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true })
  } else {
    initialize()
  }
})()
