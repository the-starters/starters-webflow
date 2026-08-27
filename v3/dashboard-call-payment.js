/**
 * Canonical Paid Call dashboard recovery commands.
 *
 * This module never writes Stripe objects directly. It only calls the two
 * booking-scoped Xano commands that verify the owning Brand, immutable booking
 * payment identity, Stripe mode, and idempotency before provider access.
 */
;(function (global) {
  'use strict'

  const isCommonJs =
    typeof module !== 'undefined' && typeof module.exports !== 'undefined'
  const XANO_SCHEDULING_BASE =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'
  const PAYMENT_ACTION_PATH = '/brand/booking/payment-action/v3'
  const PAYMENT_METHOD_REPLACE_PATH =
    '/brand/booking/payment-method-replace/v3'

  function clean(value) {
    return String(value == null ? '' : value).trim()
  }

  function canRequestPaymentAction(role, booking) {
    return (
      role === 'brand' &&
      Boolean(booking && booking.paid_meeting) &&
      clean(booking && booking.booking_id) !== '' &&
      clean(booking && booking.payment_status).toLowerCase() ===
        'auth_required' &&
      ['test', 'live'].includes(
        clean(booking && booking.payment_environment).toLowerCase(),
      )
    )
  }

  function canReplacePaymentMethod(role, booking) {
    return (
      role === 'brand' &&
      Boolean(booking && booking.paid_meeting) &&
      clean(booking && booking.booking_id) !== '' &&
      [
        'card_or_payment_declined',
        'insufficient_funds',
        'lost_or_stolen_card',
        'expired_card',
        'payment_intent_confirm_expired',
      ].includes(clean(booking && booking.payment_status).toLowerCase()) &&
      ['test', 'live'].includes(
        clean(booking && booking.payment_environment).toLowerCase(),
      )
    )
  }

  function validPaymentMethodId(value) {
    return /^pm_[A-Za-z0-9_]{1,125}$/.test(clean(value))
  }

  function validReplacementKey(value) {
    const key = clean(value)
    return (
      key.length <= 128 &&
      /^dashboard-payment-replace:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      )
    )
  }

  function createReplacementKey() {
    const randomUUID = global.crypto && global.crypto.randomUUID
    if (typeof randomUUID !== 'function') return ''
    const key =
      'dashboard-payment-replace:' + randomUUID.call(global.crypto)
    return validReplacementKey(key) ? key : ''
  }

  async function canonicalPost(path, payload) {
    if (typeof global.xanoAuthFetch !== 'function') {
      throw new Error('Scheduling authentication bridge unavailable')
    }
    const response = await global.xanoAuthFetch(
      XANO_SCHEDULING_BASE + path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
    const body = await response.json().catch(function () {
      return null
    })
    if (!response.ok || !body) {
      throw new Error(path + ' failed')
    }
    return body
  }

  async function getPaymentAction(role, booking) {
    if (!canRequestPaymentAction(role, booking)) return null
    const result = await canonicalPost(PAYMENT_ACTION_PATH, {
      booking_id: clean(booking.booking_id),
    })
    if (
      clean(result.booking_id) !== clean(booking.booking_id) ||
      clean(result.payment_status).toLowerCase() !== 'auth_required' ||
      clean(result.client_secret) === ''
    ) {
      throw new Error('Canonical payment action response is invalid')
    }
    return result
  }

  async function replacePaymentMethod(
    role,
    booking,
    paymentMethodId,
    idempotencyKey,
  ) {
    const key = clean(idempotencyKey)
    if (
      !canReplacePaymentMethod(role, booking) ||
      !validPaymentMethodId(paymentMethodId) ||
      !validReplacementKey(key)
    ) return null
    const result = await canonicalPost(PAYMENT_METHOD_REPLACE_PATH, {
      booking_id: clean(booking.booking_id),
      payment_method_id: clean(paymentMethodId),
      idempotency_key: key,
    })
    const recovery = result && result.payment_recovery
    if (
      !recovery ||
      clean(recovery.booking_id) !== clean(booking.booking_id) ||
      clean(recovery.payment_status) === ''
    ) {
      throw new Error('Canonical payment replacement response is invalid')
    }
    return result
  }

  // UI activation remains deliberately closed. Xano can retrieve the
  // authentication secret and replace an already attached PaymentMethod, but
  // the current native dashboard form has no reviewed, canonical card-setup
  // ownership contract. The Hire controller must not be reused implicitly.
  function wire() {
    return false
  }

  const api = {
    canReplacePaymentMethod,
    canRequestPaymentAction,
    createReplacementKey,
    getPaymentAction,
    replacePaymentMethod,
    validPaymentMethodId,
    validReplacementKey,
    wire,
  }
  if (isCommonJs) module.exports = api
  else global.StartersDashboardCallPayment = api
})(typeof window === 'undefined' ? globalThis : window)
