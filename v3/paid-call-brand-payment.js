/**
 * V3 paid-call Brand payment client.
 *
 * Xano derives the Brand and payment environment from the authenticated
 * session. A selection attempt owns one bounded idempotency key: retries reuse
 * that key, while every later intentional selection creates a new attempt.
 */
;(function (global) {
  'use strict'

  const isCommonJs =
    typeof module !== 'undefined' && typeof module.exports !== 'undefined'
  const XANO_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'
  const SETUP_PATH = '/brand/payment-method/setup/v3'
  const SET_DEFAULT_PATH = '/brand/payment-method/set-default/v3'
  const READINESS_PATH = '/brand/payment-readiness/v3'
  const BOOKING_PATH = '/brand/booking/request/v3'
  const STRIPE_PUBLIC_KEY_TEST =
    'pk_test_51MMhu4AW8v1kanawI48Is1kTMhsz4XbB1XVOjw5xxLiFlKXuehHSFWhApJiUKquc8bmwjtuSTlTMitYjjShjB6aQ00Dhe2oFlX'
  const STRIPE_PUBLIC_KEY_LIVE =
    'pk_live_51MMhu4AW8v1kanawUQQjQTpTWBAsdVusIXoXSA26AcTHtZPYbJt6sr98ishd7cs5DXx4QeSMHw45QqrTuzftXaJm005MjZL3sz'
  const MAX_KEY_LENGTH = 128
  const MAX_PAYMENT_METHOD_LENGTH = 128

  function createAttemptKey(prefix) {
    const safePrefix = String(prefix || 'attempt').replace(/[^a-z0-9_-]/gi, '-')
    let entropy = ''
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      entropy = global.crypto.randomUUID()
    } else {
      entropy =
        Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14)
    }
    const key = safePrefix + '-' + entropy
    if (!key || key.length > MAX_KEY_LENGTH) {
      throw new Error('Unable to create a bounded idempotency key')
    }
    return key
  }

  function validateKey(value) {
    if (typeof value !== 'string' || !value || value.length > MAX_KEY_LENGTH) {
      throw new Error('A bounded idempotency key is required')
    }
    return value
  }

  function validatePaymentMethodId(value) {
    if (
      typeof value !== 'string' ||
      !value.startsWith('pm_') ||
      value.length > MAX_PAYMENT_METHOD_LENGTH
    ) {
      throw new Error('A valid Stripe PaymentMethod ID is required')
    }
    return value
  }

  async function authenticatedRequest(path, method, payload) {
    const url = XANO_BASE + path
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    }
    if (payload !== undefined) options.body = JSON.stringify(payload)
    let response
    if (typeof global.xanoAuthFetch === 'function') {
      response = await global.xanoAuthFetch(url, options)
    } else if (typeof global.getXanoAuthToken === 'function') {
      const token = await global.getXanoAuthToken()
      if (!token) throw new Error('Xano authentication returned no token')
      options.headers.Authorization = 'Bearer ' + token
      response = await global.fetch(url, options)
    } else {
      throw new Error('The authenticated Xano bridge is unavailable')
    }
    const data = await response.json().catch(function () {
      return null
    })
    if (!response.ok) {
      throw Object.assign(new Error(path + ' failed (' + response.status + ')'), {
        status: response.status,
        data,
      })
    }
    if (!data || typeof data !== 'object') {
      throw new Error(path + ' returned no data')
    }
    return data
  }

  function authenticatedPost(path, payload) {
    return authenticatedRequest(path, 'POST', payload)
  }

  function getReadiness() {
    return authenticatedRequest(READINESS_PATH, 'GET')
  }

  function createSetupAttempt(idempotencyKey) {
    const key = validateKey(
      idempotencyKey || createAttemptKey('brand-payment-setup'),
    )
    return {
      idempotencyKey: key,
      run: function () {
        return authenticatedPost(SETUP_PATH, { idempotency_key: key })
      },
    }
  }

  function createDefaultSelectionAttempt(paymentMethodId, idempotencyKey) {
    const methodId = validatePaymentMethodId(paymentMethodId)
    const key = validateKey(
      idempotencyKey || createAttemptKey('brand-default-card'),
    )
    return {
      paymentMethodId: methodId,
      idempotencyKey: key,
      run: function () {
        return authenticatedPost(SET_DEFAULT_PATH, {
          payment_method_id: methodId,
          idempotency_key: key,
        })
      },
    }
  }

  function bookingPayload(input, idempotencyKey) {
    const source = input || {}
    const start = Number(source.start)
    const end = Number(source.end)
    const starterSlug = String(source.starter_slug || '').trim()
    const configId = String(source.config_id || '').trim()
    const timezone = String(source.timezone || '').trim()
    if (!starterSlug || !configId || !timezone || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
      throw new Error('A valid paid-call slot is required')
    }
    const payload = {
      starter_slug: starterSlug,
      config_id: configId,
      start,
      end,
      timezone,
      idempotency_key: validateKey(idempotencyKey),
    }
    const topic = String(source.topic || '').trim()
    const context = String(source.context || '').trim()
    if (topic) payload.topic = topic
    if (context) payload.context = context
    return payload
  }

  function createBookingAttempt(input, idempotencyKey) {
    const key = validateKey(
      idempotencyKey || createAttemptKey('brand-paid-call-booking'),
    )
    const payload = bookingPayload(input, key)
    return {
      idempotencyKey: key,
      payload,
      run: function () {
        return authenticatedPost(BOOKING_PATH, payload)
      },
    }
  }

  function loadStripe() {
    if (typeof global.Stripe === 'function') return Promise.resolve(global.Stripe)
    if (!global.document) return Promise.reject(new Error('Stripe.js is unavailable'))
    const existing = global.document.querySelector('script[src="https://js.stripe.com/v3/"]')
    if (existing) {
      return new Promise(function (resolve, reject) {
        existing.addEventListener('load', function () { resolve(global.Stripe) }, { once: true })
        existing.addEventListener('error', function () { reject(new Error('Stripe.js failed to load')) }, { once: true })
      })
    }
    return new Promise(function (resolve, reject) {
      const script = global.document.createElement('script')
      script.src = 'https://js.stripe.com/v3/'
      script.addEventListener('load', function () { resolve(global.Stripe) }, { once: true })
      script.addEventListener('error', function () { reject(new Error('Stripe.js failed to load')) }, { once: true })
      global.document.head.appendChild(script)
    })
  }

  function switchStep(popup, target) {
    if (!popup) return
    popup.querySelectorAll('[schedule-step]').forEach(function (step) {
      step.style.display = step.getAttribute('schedule-step') === target ? 'flex' : 'none'
    })
  }

  function installPaidBookingController(options) {
    const settings = options || {}
    const config = settings.config
    const createScheduler = settings.createScheduler
    const document = global.document
    if (!document || !config || config.is_paid !== true || !config.config_id || typeof createScheduler !== 'function') {
      return false
    }
    const ctas = Array.from(document.querySelectorAll(
      '[call-type-item] [booking-popup-open][data-type="paid"][data-config]',
    )).filter(function (cta) {
      return cta.getAttribute('data-config') === config.config_id
    })
    const popup = document.querySelector('[popup-booking]')
    const container = popup && popup.querySelector('[nylas-container]')
    if (!ctas.length || !popup || !container) return false

    let scheduler = null
    let cardElement = null
    let cardSetupInstalled = false
    let cardSetupAttempt = null
    let defaultSelectionAttempt = null
    let defaultSelectionPaymentMethod = ''
    let paidClickLock = false
    let bookingLock = false
    let bookingAttempt = null
    let bookingFingerprint = ''

    function fieldValue(selector) {
      const field = popup.querySelector(selector)
      return field ? String(field.value || '').trim() : ''
    }

    function showBookingError(error) {
      console.error('[paid-call] booking failed', error)
      const message = popup.querySelector('[paid-call-text]')
      if (message) message.textContent = 'We could not book this call. Please try again.'
    }

    function mountScheduler() {
      scheduler = createScheduler(
        config.config_id,
        settings.brandName || '',
        settings.brandEmail || '',
      )
      if (!scheduler) throw new Error('The scheduling calendar is unavailable')
      const inherited = scheduler.eventOverrides || {}
      scheduler.eventOverrides = Object.assign({}, inherited, {
        detailsConfirmed: function (event, connector) {
          // This must happen before any await. Xano, not the public Scheduler
          // component, owns the paid booking mutation.
          event.preventDefault()
          if (bookingLock) return
          const store = connector && connector.schedulerStore
          const slot = store && store.get('selectedTimeslot')
          const selectedTimezone = store && store.get('selectedTimezone')
          const start = slot && new Date(slot.start_time).getTime()
          const end = slot && new Date(slot.end_time).getTime()
          const fingerprint = String(start) + '|' + String(end)
          if (!bookingAttempt || bookingFingerprint !== fingerprint) {
            bookingFingerprint = fingerprint
            bookingAttempt = createBookingAttempt({
              starter_slug: settings.starterSlug,
              config_id: config.config_id,
              start,
              end,
              timezone: selectedTimezone,
              topic: fieldValue('[name="topic"], [booking-topic]'),
              context: fieldValue('[name="context"], [booking-context]'),
            })
          }
          bookingLock = true
          Promise.resolve(bookingAttempt.run()).then(function (result) {
            const successText = popup.querySelector('[booking-success-text]')
            if (successText) {
              successText.textContent = 'Your paid call request was sent. We will notify you when the Starter confirms it.'
            }
            switchStep(popup, 'success')
            return result
          }).catch(showBookingError).finally(function () {
            bookingLock = false
          })
        },
      })
      return scheduler
    }

    async function installCardSetup(onReady) {
      if (cardSetupInstalled) return
      const cardMount = document.querySelector('[popup-stripe-card] [card-element], [card-element]')
      const save = document.querySelector('[popup-stripe-card] [save-card-btn], [save-card-btn]')
      const errorText = document.querySelector('[popup-stripe-card] [card-error], [card-error]')
      const statusText = document.querySelector('[popup-stripe-card] [save-card-status], [save-card-status]')
      if (!cardMount || !save || !errorText || !statusText) {
        throw new Error('The authored payment form is incomplete')
      }
      const Stripe = await loadStripe()
      const initialReadiness = await getReadiness()
      const stripe = Stripe(initialReadiness.environment === 'test' ? STRIPE_PUBLIC_KEY_TEST : STRIPE_PUBLIC_KEY_LIVE)
      cardElement = stripe.elements().create('card', { hidePostalCode: true })
      cardElement.mount(cardMount)
      cardElement.on('change', function (event) {
        errorText.textContent = event.error ? event.error.message : ''
      })
      save.addEventListener('click', async function (event) {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (save.disabled) return
        save.disabled = true
        errorText.textContent = ''
        statusText.textContent = 'Saving...'
        try {
          if (!cardSetupAttempt) cardSetupAttempt = createSetupAttempt()
          const setup = await cardSetupAttempt.run()
          const confirmed = await stripe.confirmCardSetup(setup.client_secret, {
            payment_method: {
              card: cardElement,
              billing_details: {
                name: settings.brandName || '',
                email: settings.brandEmail || '',
              },
            },
          })
          if (confirmed.error) throw new Error(confirmed.error.message || 'Card setup failed')
          const paymentMethod = confirmed.setupIntent && confirmed.setupIntent.payment_method
          if (!defaultSelectionAttempt || defaultSelectionPaymentMethod !== paymentMethod) {
            defaultSelectionPaymentMethod = paymentMethod
            defaultSelectionAttempt = createDefaultSelectionAttempt(paymentMethod)
          }
          await defaultSelectionAttempt.run()
          const readiness = await getReadiness()
          if (!readiness.bookable) throw new Error('The payment method is not ready')
          cardSetupAttempt = null
          defaultSelectionAttempt = null
          defaultSelectionPaymentMethod = ''
          statusText.textContent = 'Card saved.'
          const close = document.querySelector('[popup-stripe-card-close]')
          if (close) close.click()
          onReady()
        } catch (error) {
          errorText.textContent = error.message || 'Card setup failed'
          statusText.textContent = ''
        } finally {
          save.disabled = false
        }
      }, true)
      cardSetupInstalled = true
    }

    async function paidClick(event) {
      event.preventDefault()
      if (paidClickLock) return
      paidClickLock = true
      try {
        const readiness = await getReadiness()
        if (readiness.bookable) {
          mountScheduler()
          return
        }
        await installCardSetup(mountScheduler)
        const openCard = document.querySelector('[popup-stripe-card-open]')
        if (!openCard) throw new Error('The payment form opener is unavailable')
        openCard.click()
      } catch (error) {
        showBookingError(error)
      } finally {
        paidClickLock = false
      }
    }

    ctas.forEach(function (cta) {
      cta.onclick = paidClick
      cta.setAttribute('data-paid-call-v3', 'ready')
      const item = cta.closest('[call-type-item]')
      if (item) item.style.display = 'block'
    })
    return true
  }

  const api = {
    SETUP_PATH,
    SET_DEFAULT_PATH,
    READINESS_PATH,
    BOOKING_PATH,
    XANO_BASE,
    authenticatedRequest,
    authenticatedPost,
    bookingPayload,
    createBookingAttempt,
    createAttemptKey,
    createDefaultSelectionAttempt,
    createSetupAttempt,
    getReadiness,
    installPaidBookingController,
    validateKey,
    validatePaymentMethodId,
  }

  if (isCommonJs) {
    module.exports = api
    return
  }
  global.StartersPaidCallBrandPayment = api
})(typeof window !== 'undefined' ? window : globalThis)
