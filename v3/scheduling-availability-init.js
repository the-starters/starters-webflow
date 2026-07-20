;(function () {
  'use strict'

  const STAGING_HOST = 'the-starters-3-0.webflow.io'
  const CACHE_PREFIX = 'starter-scheduling-availability:'
  const CACHE_TTL_MS = 5 * 60 * 1000
  const STATUS_ATTRIBUTE = 'data-scheduling-availability-init'

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
    if (typeof window.getStarterByMemberId !== 'function') {
      throw new Error('Legacy scheduling availability reader not available')
    }
    return window.getStarterByMemberId(memberId)
  }

  async function currentMember() {
    const memberstack = window.$memberstackDom
    if (memberstack && typeof memberstack.getCurrentMember === 'function') {
      const result = await memberstack.getCurrentMember()
      const member = result && result.data
      if (member && member.id) return member
    }

    if (window.memberReady && typeof window.memberReady.then === 'function') {
      const member = await window.memberReady
      if (member && member.id) return member
    }

    throw new Error('No logged-in member')
  }

  async function loadAvailability(member) {
    const cached = readCachedAvailability(member.id)
    if (cached) return { availability: cached, source: 'cache' }

    const starter = await readStarter(member.id)
    const verifiedMember = await currentMember()
    if (verifiedMember.id !== member.id) {
      const error = new Error('Member session changed during availability read')
      error.code = 'MEMBER_SCOPE_CHANGED'
      throw error
    }
    if (starter && starter.availability != null) {
      const availability = normalizeAvailability(starter.availability)
      if (!availability) throw new Error('Starter availability is invalid')
      writeCachedAvailability(member.id, availability)
      return { availability, source: 'starter' }
    }

    // New V3 starters do not necessarily have a legacy scheduling row yet.
    // Treat that as a first-time setup state instead of leaving both controls hidden.
    return { availability: { items: {}, manager: null }, source: 'default' }
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
      const result = await loadAvailability(member)
      window.STARTER_AVAILABILITY = result.availability
      const state = renderState(result.availability)
      setStatus(state || 'missing-controls')
      window.dispatchEvent(
        new CustomEvent('starterSchedulingAvailabilityReady', {
          detail: { memberId: member.id, source: result.source, state },
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
