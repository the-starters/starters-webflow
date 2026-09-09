/**
 * Canonical Paid Call dashboard recovery commands.
 *
 * Booking recovery stays behind Xano ownership and idempotency checks. Card
 * setup is delegated to the shared payment client; modal ownership must remain
 * current before a verified default can trigger booking recovery.
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

  function createCardReplacementAttempt(role, booking, paymentMethodId, isCurrent) {
    if (!canReplacePaymentMethod(role, booking) || !validPaymentMethodId(paymentMethodId) ||
        typeof isCurrent !== 'function') throw new Error('A current Brand payment recovery context is required')
    const snapshot = Object.assign({}, booking)
    const methodId = clean(paymentMethodId)
    const key = createReplacementKey()
    if (!key) throw new Error('Payment replacement identity is unavailable')
    let pending = null
    let result = null
    return {
      run: function () {
        if (!isCurrent()) return Promise.reject(new Error('Payment recovery context changed'))
        if (result) return Promise.resolve(result)
        if (pending) return pending
        pending = replacePaymentMethod(role, snapshot, methodId, key).then(function (response) {
          result = response
          if (!isCurrent()) throw new Error('Payment recovery context changed')
          return response
        }).finally(function () { pending = null })
        return pending
      },
    }
  }

  const wiredDocuments = new WeakSet()
  const paymentOwners = new WeakMap()
  function invalidateModal(modal) { paymentOwners.get(modal)?.() }
  let managementReady = false
  function canManageCards(role, booking) {
    return managementReady && canReplacePaymentMethod(role, booking)
  }

  async function loadPaymentClient(document) {
    const valid = client => client && ['getReadiness', 'installSavedCardPicker', 'installCardSetupForm', 'stripeForPaymentEnvironment']
      .every(name => typeof client[name] === 'function')
    if (valid(global.StartersPaidCallBrandPayment)) return global.StartersPaidCallBrandPayment
    return new Promise(function (resolve, reject) {
      let script = document.querySelector('script[data-dashboard-payment-client]')
      if (!script) {
        script = document.createElement('script')
        script.src = 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/paid-call-brand-payment.js'
        script.setAttribute('data-dashboard-payment-client', '')
        script.defer = true
        document.head.appendChild(script)
      }
      function finish() {
        const client = global.StartersPaidCallBrandPayment
        if (valid(client)) resolve(client)
        else reject(new Error('Payment form client unavailable'))
      }
      script.addEventListener('load', finish, { once: true })
      script.addEventListener('error', finish, { once: true })
      global.setTimeout(finish, 10000)
    })
  }

  async function wire(options) {
    const settings = options || {}
    const document = settings.document || global.document
    if (settings.role !== 'brand' || !document || typeof settings.getBooking !== 'function') return false
    if (wiredDocuments.has(document)) return true
    let client
    try { client = await loadPaymentClient(document) } catch (error) { return false }
    if (wiredDocuments.has(document)) return true
    wiredDocuments.add(document)
    managementReady = true
    let active = null
    let opening = false
    let selecting = false
    function paintAdd(context) {
      context.modal.querySelectorAll?.('[popup-stripe-card-open], [payment-action-btn="add-card"]').forEach(control => {
        control.setAttribute('aria-disabled', String(selecting || context.adding))
        control.querySelectorAll('button').forEach(button => { button.disabled = selecting || context.adding })
      })
    }
    document.addEventListener('close', event => { invalidateModal(event.target) }, true)
    document.addEventListener('click', async function (event) {
      const close = event.target?.closest?.('[data-modal-close], [booking-popup-info-close], [booking-action-btn="switch-close"], [booking-card-action-btn="switch-close"]')
      if (close) invalidateModal(close.closest('[popup-booking-info]'))
      const target = event.target && event.target.closest
        ? event.target.closest('[payment-action-btn], [popup-stripe-card-open]') : null
      if (!target) return
      const action = target.getAttribute('payment-action-btn')
      const add = action === 'add-card' || target.hasAttribute('popup-stripe-card-open')
      if (!add && !['change-card', 'change-card-v2'].includes(action)) return
      const modal = target.closest('[popup-booking-info]')
      const booking = modal && settings.getBooking(modal)
      if (!modal || !canManageCards(settings.role, booking)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (opening || selecting || (active?.isCurrent() && active.adding)) return
      const actions = global.StartersDashboardCallActions
      if (!actions || typeof actions.switchPopupContent !== 'function') return
      opening = true
      try {
        if (!active || !active.picker || !active.isCurrent() || active.bookingId !== booking.booking_id) {
          if (active) active.invalidate()
          const context = { modal, bookingId: booking.booking_id, booking: Object.assign({}, booking), attempts: new Map(), adding: false }
          let valid = true
          let observer
          context.invalidate = () => {
            valid = false
            observer?.disconnect()
            context.picker?.dispose()
            context.form?.dispose()
            context.adding = false
            paintAdd(context)
          }
          paymentOwners.set(modal, context.invalidate)
          if (typeof global.MutationObserver === 'function') {
            observer = new global.MutationObserver(records => {
              if (records.some(record => record.attributeName === 'open' ||
                  (record.attributeName === 'data-booking-id' && record.oldValue !== modal.getAttribute('data-booking-id')))) context.invalidate()
            })
            observer.observe(modal, { attributes: true, attributeOldValue: true, attributeFilter: ['open', 'data-booking-id'] })
          }
          context.isCurrent = () => valid && active === context &&
            (!('open' in modal) || modal.open) &&
            clean(settings.getBooking(modal)?.booking_id) === clean(context.bookingId) &&
            canReplacePaymentMethod(settings.role, settings.getBooking(modal))
          active = context
          const readiness = await client.getReadiness()
          if (!context.isCurrent()) return
          if (readiness.environment !== booking.payment_environment) throw new Error('Payment environment changed')
          const panel = modal.querySelector('[booking-popup-content="payment-methods"]')
          context.picker = client.installSavedCardPicker(panel, {
            environment: readiness.environment, isCurrent: () => context.isCurrent() && !context.adding,
            acquire: () => {
              if (selecting || opening || context.adding || !context.isCurrent()) return false
              selecting = true
              paintAdd(context)
              return true
            },
            release: () => { selecting = false; if (active) paintAdd(active) },
            onSaved: async function (methodId) {
              if (!context.attempts.has(methodId)) context.attempts.set(methodId,
                createCardReplacementAttempt(settings.role, context.booking, methodId, context.isCurrent))
              await context.attempts.get(methodId).run()
              if (!context.isCurrent()) return
              actions.switchPopupContent(modal, 'base')
              if (typeof settings.restart === 'function') await settings.restart()
            },
          })
        }
        const context = active
        actions.switchPopupContent(modal, 'payment-methods')
        if (!add) { await context.picker.load(); return }
        const cardModal = document.querySelector('[popup-stripe-card]')
        context.adding = true
        paintAdd(context)
        const stripe = await client.stripeForPaymentEnvironment(booking.payment_environment)
        if (!context.isCurrent()) return
        context.form?.dispose()
        const finishAdd = () => { context.adding = false; paintAdd(context) }
        cardModal.addEventListener('close', finishAdd, { once: true })
        context.form = client.installCardSetupForm(cardModal, {
          stripe, environment: booking.payment_environment, isCurrent: context.isCurrent,
          onBack: () => { finishAdd(); cardModal.close(); context.picker.load() },
          onSaved: async () => { finishAdd(); cardModal.close(); await context.picker.load({ selectDefault: true }) },
        })
        cardModal.showModal()
      } catch (error) {
        if (active) { active.adding = false; paintAdd(active) }
        if (active && active.isCurrent() && typeof actions.showActionError === 'function') {
          actions.showActionError(modal, error.message || 'Payment methods unavailable')
        }
      } finally { opening = false }
    }, true)
    if (typeof settings.onAvailable === 'function') settings.onAvailable()
    return true
  }

  const api = {
    invalidateModal,
    canReplacePaymentMethod,
    canRequestPaymentAction,
    canManageCards,
    createReplacementKey,
    createCardReplacementAttempt,
    getPaymentAction,
    replacePaymentMethod,
    validPaymentMethodId,
    validReplacementKey,
    wire,
  }
  if (isCommonJs) module.exports = api
  else global.StartersDashboardCallPayment = api
})(typeof window === 'undefined' ? globalThis : window)
