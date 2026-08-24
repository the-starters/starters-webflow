/**
 * Canonical dashboard call lifecycle actions.
 *
 * Webflow owns the authored modal and reason fields. This module binds those
 * elements and sends only environment-safe commands that have a published V3
 * contract. Cancel and reschedule stay hidden until their canonical lifecycle
 * contracts are reviewed as safe.
 */
;(function (global) {
  'use strict'

  const isCommonJs =
    typeof module !== 'undefined' && typeof module.exports !== 'undefined'
  const XANO_SCHEDULING_BASE =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'
  const DECLINE_PATH = '/booking/decline/v3'
  const DECLINE_STORAGE_PREFIX = 'starters:dashboard-decline:v1:'

  function clean(value) {
    return String(value == null ? '' : value).trim()
  }

  function bookingStatus(booking) {
    return clean(booking && booking.status).toLowerCase()
  }

  function canDecline(role, booking) {
    const environment = clean(booking && booking.data_environment).toLowerCase()
    return (
      role === 'starter' &&
      bookingStatus(booking) === 'pending' &&
      clean(booking && booking.booking_id) !== '' &&
      clean(booking && booking.config_id) !== '' &&
      ['test', 'production'].includes(environment)
    )
  }

  async function stableScopeHash(value) {
    const input = clean(value)
    const crypto = global.crypto
    const TextEncoder = global.TextEncoder
    if (
      !input ||
      !crypto ||
      !crypto.subtle ||
      typeof crypto.subtle.digest !== 'function' ||
      typeof TextEncoder !== 'function'
    ) return ''
    try {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(input),
      )
      return Array.from(new Uint8Array(digest), function (byte) {
        return byte.toString(16).padStart(2, '0')
      }).join('')
    } catch (_error) {
      return ''
    }
  }

  async function declineStorageKey(booking, reason) {
    const bookingId = clean(booking && booking.booking_id)
    const actorId = clean(
      booking && booking.starter_data && booking.starter_data.memberstack_id,
    )
    const environment = clean(booking && booking.data_environment).toLowerCase()
    const actorScope = await stableScopeHash(actorId)
    const reasonScope = await stableScopeHash(reason)
    if (
      !bookingId ||
      !actorScope ||
      !reasonScope ||
      !['test', 'production'].includes(environment)
    ) return ''
    return (
      DECLINE_STORAGE_PREFIX +
      environment +
      ':' +
      actorScope +
      ':' +
      bookingId +
      ':' +
      reasonScope
    )
  }

  function validAttemptKey(value) {
    return /^dashboard-decline:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      clean(value),
    )
  }

  async function declineAttemptKey(booking, reason) {
    const storageKey = await declineStorageKey(booking, reason)
    const storage = global.sessionStorage
    if (
      !storageKey ||
      !storage ||
      typeof storage.getItem !== 'function' ||
      typeof storage.setItem !== 'function'
    ) return ''
    try {
      const existing = clean(storage.getItem(storageKey))
      if (validAttemptKey(existing)) return existing
      if (existing && typeof storage.removeItem === 'function') {
        storage.removeItem(storageKey)
      }
      const randomUUID = global.crypto && global.crypto.randomUUID
      if (typeof randomUUID !== 'function') return ''
      const created = 'dashboard-decline:' + randomUUID.call(global.crypto)
      if (!validAttemptKey(created)) return ''
      storage.setItem(storageKey, created)
      return clean(storage.getItem(storageKey)) === created ? created : ''
    } catch (_error) {
      return ''
    }
  }

  async function clearDeclineAttemptKey(booking, reason, value) {
    const storageKey = await declineStorageKey(booking, reason)
    const storage = global.sessionStorage
    if (
      !storageKey ||
      !storage ||
      typeof storage.getItem !== 'function' ||
      typeof storage.removeItem !== 'function'
    ) return
    try {
      if (clean(storage.getItem(storageKey)) === clean(value)) {
        storage.removeItem(storageKey)
      }
    } catch (_error) {}
  }

  function declinePayload(booking, reason, idempotencyKey) {
    const payload = {
      booking_id: clean(booking && booking.booking_id),
      config_id: clean(booking && booking.config_id),
      reason: clean(reason),
      idempotency_key: clean(idempotencyKey),
    }
    if (
      !canDecline('starter', booking) ||
      !payload.reason ||
      !validAttemptKey(payload.idempotency_key)
    ) return null
    return payload
  }

  function declineSucceeded(body, bookingId) {
    const result = body && body.decline
    return Boolean(
      result &&
      clean(result.booking_id) === clean(bookingId) &&
      clean(bookingId) !== '' &&
      clean(result.status).toLowerCase() === 'declined'
    )
  }

  async function declineBooking(booking, reason) {
    if (
      !canDecline('starter', booking) ||
      typeof global.xanoAuthFetch !== 'function'
    ) return null
    const attemptKey = await declineAttemptKey(booking, reason)
    const payload = declinePayload(booking, reason, attemptKey)
    if (!payload) return null
    const response = await global.xanoAuthFetch(
      XANO_SCHEDULING_BASE + DECLINE_PATH,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
    const body = await response.json().catch(function () {
      return null
    })
    if (!response.ok || !declineSucceeded(body, payload.booking_id)) {
      throw new Error('Canonical booking decline failed')
    }
    await clearDeclineAttemptKey(booking, reason, attemptKey)
    return body
  }

  function switchPopupContent(modal, target) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return false
    let found = false
    modal.querySelectorAll('[booking-popup-content]').forEach(function (content) {
      const active = content.getAttribute('booking-popup-content') === target
      content.style.display = active ? 'flex' : 'none'
      if (active) found = true
    })
    return found
  }

  function reasonValue(modal) {
    const field =
      modal &&
      typeof modal.querySelector === 'function' &&
      modal.querySelector('[booking-decline-reason]')
    if (!field) return { field: null, value: '' }
    return { field, value: clean(field.value) }
  }

  function validateReason(field, value) {
    if (!field) return false
    if (typeof field.setCustomValidity === 'function') {
      field.setCustomValidity(value ? '' : 'Please provide a reason.')
    }
    if (!value && typeof field.reportValidity === 'function') {
      field.reportValidity()
    }
    return Boolean(value)
  }

  function wire(options) {
    const settings = options || {}
    const document = settings.document || global.document
    if (
      !document ||
      typeof document.addEventListener !== 'function' ||
      typeof settings.getBooking !== 'function'
    ) return false
    document.addEventListener(
      'click',
      async function (event) {
        const target = event && event.target
        const button =
          target &&
          target.closest &&
          target.closest(
            '[booking-action-btn="switch-decline"], [booking-card-action-btn="switch-decline"], [booking-action-btn="decline"], [booking-card-action-btn="decline"]',
          )
        if (!button) return
        const booking = settings.getBooking(button)
        if (!canDecline(settings.role, booking)) return
        if (event.preventDefault) event.preventDefault()
        if (event.stopImmediatePropagation) event.stopImmediatePropagation()
        else if (event.stopPropagation) event.stopPropagation()
        const modal =
          button.closest &&
          (button.closest(
            '[popup-booking-info], dialog[data-modal-target="popup-booking-info"]',
          ) ||
            (document.querySelector &&
              document.querySelector(
                '[popup-booking-info], dialog[data-modal-target="popup-booking-info"]',
              )))
        const action = clean(
          button.getAttribute('booking-action-btn') ||
            button.getAttribute('booking-card-action-btn'),
        )
        if (action === 'switch-decline') {
          switchPopupContent(modal, 'decline')
          return
        }
        if (button.__startersDeclineBusy) return
        const reason = reasonValue(modal)
        if (!validateReason(reason.field, reason.value)) return
        button.__startersDeclineBusy = true
        button.setAttribute('aria-busy', 'true')
        button.setAttribute('aria-disabled', 'true')
        try {
          await declineBooking(booking, reason.value)
          if (reason.field) reason.field.value = ''
          switchPopupContent(modal, 'declined')
          if (typeof settings.restart === 'function') await settings.restart()
        } catch (error) {
          console.error(
            '[dashboard-call-actions] decline failed closed:',
            error && error.message,
          )
        } finally {
          button.__startersDeclineBusy = false
          button.setAttribute('aria-busy', 'false')
          button.setAttribute('aria-disabled', 'false')
        }
      },
      true,
    )
    return true
  }

  const api = {
    canDecline,
    clearDeclineAttemptKey,
    declineAttemptKey,
    declineBooking,
    declinePayload,
    declineStorageKey,
    declineSucceeded,
    switchPopupContent,
    validAttemptKey,
    wire,
  }
  if (isCommonJs) module.exports = api
  else global.StartersDashboardCallActions = api
})(typeof window === 'undefined' ? globalThis : window)
