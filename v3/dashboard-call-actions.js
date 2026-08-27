/**
 * Canonical dashboard call lifecycle actions.
 *
 * Webflow owns the authored modal and reason fields. This module binds those
 * elements and sends only environment-safe commands that have a published V3
 * contract: Starter decline of a pending call, and Starter or Brand cancel of
 * a booked (confirmed/rescheduled) call. Reschedule stays hidden until its
 * canonical lifecycle contract ships.
 */
;(function (global) {
  'use strict'

  const isCommonJs =
    typeof module !== 'undefined' && typeof module.exports !== 'undefined'
  const XANO_SCHEDULING_BASE =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'

  const KINDS = {
    decline: {
      path: '/booking/decline/v3',
      storagePrefix: 'starters:dashboard-decline:v1:',
      attemptPrefix: 'dashboard-decline',
      reasonField: 'reason',
      reasonAttribute: 'booking-decline-reason',
      responseKey: 'decline',
      successStatus: 'declined',
      firstContent: 'decline',
      reasonContent: 'decline-reason',
      successContent: 'declined',
      failureMessage: 'Canonical booking decline failed',
    },
    cancel: {
      path: '/booking/cancel/v3',
      storagePrefix: 'starters:dashboard-cancel:v1:',
      attemptPrefix: 'dashboard-cancel',
      reasonField: 'cancelled_reason',
      reasonAttribute: 'booking-cancel-reason',
      responseKey: 'cancel',
      successStatus: 'cancelled',
      firstContent: 'cancel',
      reasonContent: 'cancel-reason',
      successContent: 'cancelled',
      failureMessage: 'Canonical booking cancel failed',
    },
  }

  function clean(value) {
    return String(value == null ? '' : value).trim()
  }

  function bookingStatus(booking) {
    return clean(booking && booking.status).toLowerCase()
  }

  function bookingEnvironment(booking) {
    return clean(booking && booking.data_environment).toLowerCase()
  }

  function bookingIdentified(booking) {
    return (
      clean(booking && booking.booking_id) !== '' &&
      clean(booking && booking.config_id) !== '' &&
      ['test', 'production'].includes(bookingEnvironment(booking))
    )
  }

  function actorMemberId(role, booking) {
    const source =
      role === 'starter'
        ? booking && booking.starter_data
        : role === 'brand'
          ? booking && booking.brand_data
          : null
    return clean(source && source.memberstack_id)
  }

  function canDecline(role, booking) {
    return (
      role === 'starter' &&
      bookingStatus(booking) === 'pending' &&
      bookingIdentified(booking)
    )
  }

  function canCancel(role, booking, now) {
    const start = Number(booking && booking.start)
    const reference = Number.isFinite(Number(now)) ? Number(now) : Date.now()
    return (
      (role === 'starter' || role === 'brand') &&
      ['confirmed', 'rescheduled'].includes(bookingStatus(booking)) &&
      actorMemberId(role, booking) !== '' &&
      Number.isFinite(start) &&
      start > reference &&
      bookingIdentified(booking)
    )
  }

  function canAct(kind, role, booking, now) {
    if (kind === 'decline') return canDecline(role, booking)
    if (kind === 'cancel') return canCancel(role, booking, now)
    return false
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

  async function actionStorageKey(kind, booking, reason, role) {
    const config = KINDS[kind]
    const bookingId = clean(booking && booking.booking_id)
    const actorId = actorMemberId(role, booking)
    const environment = bookingEnvironment(booking)
    const actorScope = await stableScopeHash(actorId)
    const reasonScope = await stableScopeHash(reason)
    if (
      !config ||
      !bookingId ||
      !actorScope ||
      !reasonScope ||
      !['test', 'production'].includes(environment)
    ) return ''
    return (
      config.storagePrefix +
      environment +
      ':' +
      actorScope +
      ':' +
      bookingId +
      ':' +
      reasonScope
    )
  }

  function declineStorageKey(booking, reason) {
    return actionStorageKey('decline', booking, reason, 'starter')
  }

  function cancelStorageKey(booking, reason, role) {
    return actionStorageKey('cancel', booking, reason, role)
  }

  function kindAttemptKeyPattern(kind) {
    const config = KINDS[kind]
    if (!config) return null
    return new RegExp(
      '^' +
      config.attemptPrefix +
      ':[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      'i',
    )
  }

  function validKindAttemptKey(kind, value) {
    const pattern = kindAttemptKeyPattern(kind)
    return Boolean(pattern && pattern.test(clean(value)))
  }

  function validAttemptKey(value) {
    return validKindAttemptKey('decline', value)
  }

  async function actionAttemptKey(kind, booking, reason, role) {
    const config = KINDS[kind]
    const storageKey = await actionStorageKey(kind, booking, reason, role)
    const storage = global.sessionStorage
    if (
      !config ||
      !storageKey ||
      !storage ||
      typeof storage.getItem !== 'function' ||
      typeof storage.setItem !== 'function'
    ) return ''
    try {
      const existing = clean(storage.getItem(storageKey))
      if (validKindAttemptKey(kind, existing)) return existing
      if (existing && typeof storage.removeItem === 'function') {
        storage.removeItem(storageKey)
      }
      const randomUUID = global.crypto && global.crypto.randomUUID
      if (typeof randomUUID !== 'function') return ''
      const created = config.attemptPrefix + ':' + randomUUID.call(global.crypto)
      if (!validKindAttemptKey(kind, created)) return ''
      storage.setItem(storageKey, created)
      return clean(storage.getItem(storageKey)) === created ? created : ''
    } catch (_error) {
      return ''
    }
  }

  function declineAttemptKey(booking, reason) {
    return actionAttemptKey('decline', booking, reason, 'starter')
  }

  function cancelAttemptKey(booking, reason, role) {
    return actionAttemptKey('cancel', booking, reason, role)
  }

  async function clearActionAttemptKey(kind, booking, reason, role, value) {
    const storageKey = await actionStorageKey(kind, booking, reason, role)
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

  function clearDeclineAttemptKey(booking, reason, value) {
    return clearActionAttemptKey('decline', booking, reason, 'starter', value)
  }

  function clearCancelAttemptKey(booking, reason, role, value) {
    return clearActionAttemptKey('cancel', booking, reason, role, value)
  }

  function actionPayload(kind, role, booking, reason, idempotencyKey, now) {
    const config = KINDS[kind]
    if (!config || !canAct(kind, role, booking, now)) return null
    const payload = {
      booking_id: clean(booking && booking.booking_id),
      config_id: clean(booking && booking.config_id),
      idempotency_key: clean(idempotencyKey),
    }
    payload[config.reasonField] = clean(reason)
    if (
      !payload[config.reasonField] ||
      !validKindAttemptKey(kind, payload.idempotency_key)
    ) return null
    return payload
  }

  function declinePayload(booking, reason, idempotencyKey) {
    return actionPayload('decline', 'starter', booking, reason, idempotencyKey)
  }

  function cancelPayload(booking, reason, idempotencyKey, role, now) {
    return actionPayload('cancel', role, booking, reason, idempotencyKey, now)
  }

  function actionSucceeded(kind, body, bookingId) {
    const config = KINDS[kind]
    const result = config && body && body[config.responseKey]
    return Boolean(
      config &&
      result &&
      clean(result.booking_id) === clean(bookingId) &&
      clean(bookingId) !== '' &&
      clean(result.status).toLowerCase() === config.successStatus
    )
  }

  function declineSucceeded(body, bookingId) {
    return actionSucceeded('decline', body, bookingId)
  }

  function cancelSucceeded(body, bookingId) {
    return actionSucceeded('cancel', body, bookingId)
  }

  async function submitAction(kind, role, booking, reason, now) {
    const config = KINDS[kind]
    if (
      !config ||
      !canAct(kind, role, booking, now) ||
      typeof global.xanoAuthFetch !== 'function'
    ) return null
    const attemptKey = await actionAttemptKey(kind, booking, reason, role)
    const payload = actionPayload(kind, role, booking, reason, attemptKey, now)
    if (!payload) return null
    const response = await global.xanoAuthFetch(
      XANO_SCHEDULING_BASE + config.path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
    const body = await response.json().catch(function () {
      return null
    })
    if (!response.ok || !actionSucceeded(kind, body, payload.booking_id)) {
      throw new Error(config.failureMessage)
    }
    await clearActionAttemptKey(kind, booking, reason, role, attemptKey)
    return body
  }

  function declineBooking(booking, reason) {
    return submitAction('decline', 'starter', booking, reason)
  }

  function cancelBooking(booking, reason, role, now) {
    return submitAction('cancel', role, booking, reason, now)
  }

  function switchPopupContent(modal, target) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return false
    let found = false
    modal.querySelectorAll('[booking-popup-content]').forEach(function (content) {
      const active = content.getAttribute('booking-popup-content') === target
      content.hidden = !active
      content.style.display = active ? 'flex' : 'none'
      if (active) found = true
    })
    return found
  }

  function reasonValue(modal, kind) {
    const config = KINDS[kind] || KINDS.decline
    const field =
      modal &&
      typeof modal.querySelector === 'function' &&
      modal.querySelector('[' + config.reasonAttribute + ']')
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

  function actionForButton(button) {
    const action = clean(
      button.getAttribute('booking-action-btn') ||
        button.getAttribute('booking-card-action-btn'),
    )
    if (action === 'switch-decline') return { kind: 'decline', step: 'open' }
    if (action === 'switch-decline-reason') return { kind: 'decline', step: 'reason' }
    if (action === 'decline') return { kind: 'decline', step: 'submit' }
    if (action === 'switch-cancel') return { kind: 'cancel', step: 'open' }
    if (action === 'switch-cancel-reason') return { kind: 'cancel', step: 'reason' }
    if (action === 'cancel') return { kind: 'cancel', step: 'submit' }
    return null
  }

  const WIRE_SELECTOR = [
    'switch-decline',
    'switch-decline-reason',
    'decline',
    'switch-cancel',
    'switch-cancel-reason',
    'cancel',
  ]
    .map(function (action) {
      return (
        '[booking-action-btn="' +
        action +
        '"], [booking-card-action-btn="' +
        action +
        '"]'
      )
    })
    .join(', ')

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
          target && target.closest && target.closest(WIRE_SELECTOR)
        if (!button) return
        const step = actionForButton(button)
        if (!step) return
        const booking = settings.getBooking(button)
        if (!canAct(step.kind, settings.role, booking)) return
        if (event.preventDefault) event.preventDefault()
        if (event.stopImmediatePropagation) event.stopImmediatePropagation()
        else if (event.stopPropagation) event.stopPropagation()
        const config = KINDS[step.kind]
        const modal =
          button.closest &&
          (button.closest(
            '[popup-booking-info], dialog[data-modal-target="popup-booking-info"]',
          ) ||
            (document.querySelector &&
              document.querySelector(
                '[popup-booking-info], dialog[data-modal-target="popup-booking-info"]',
              )))
        if (step.step === 'open') {
          switchPopupContent(modal, config.firstContent)
          return
        }
        if (step.step === 'reason') {
          switchPopupContent(modal, config.reasonContent)
          return
        }
        if (button.__startersActionBusy) return
        const reason = reasonValue(modal, step.kind)
        if (!validateReason(reason.field, reason.value)) return
        button.__startersActionBusy = true
        button.setAttribute('aria-busy', 'true')
        button.setAttribute('aria-disabled', 'true')
        try {
          await submitAction(step.kind, settings.role, booking, reason.value)
          if (reason.field) reason.field.value = ''
          switchPopupContent(modal, config.successContent)
          if (typeof settings.restart === 'function') await settings.restart()
        } catch (error) {
          console.error(
            '[dashboard-call-actions] ' + step.kind + ' failed closed:',
            error && error.message,
          )
        } finally {
          button.__startersActionBusy = false
          button.setAttribute('aria-busy', 'false')
          button.setAttribute('aria-disabled', 'false')
        }
      },
      true,
    )
    return true
  }

  const api = {
    canCancel,
    canDecline,
    cancelAttemptKey,
    cancelBooking,
    cancelPayload,
    cancelStorageKey,
    cancelSucceeded,
    clearCancelAttemptKey,
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
