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
  const AVAILABILITY_PATH = '/scheduler/get_availability/v3'
  const BOOKING_PATH = '/brand/booking/request/v3'
  const STRIPE_PUBLIC_KEY_TEST =
    'pk_test_51MMhu4AW8v1kanawI48Is1kTMhsz4XbB1XVOjw5xxLiFlKXuehHSFWhApJiUKquc8bmwjtuSTlTMitYjjShjB6aQ00Dhe2oFlX'
  const STRIPE_PUBLIC_KEY_LIVE =
    'pk_live_51MMhu4AW8v1kanawUQQjQTpTWBAsdVusIXoXSA26AcTHtZPYbJt6sr98ishd7cs5DXx4QeSMHw45QqrTuzftXaJm005MjZL3sz'
  const MAX_KEY_LENGTH = 128
  const MAX_PAYMENT_METHOD_LENGTH = 128
  const MAX_GUEST_EMAILS = 5
  const GUEST_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const bookingSurfaceGenerations = new WeakMap()

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

  function normalizeGuestEmails(values, excludedEmails) {
    const excluded = new Set((excludedEmails || []).map(function (value) {
      return String(value || '').trim().toLowerCase()
    }).filter(Boolean))
    const normalized = []
    const seen = new Set()
    ;(Array.isArray(values) ? values : []).forEach(function (value) {
      const email = String(value || '').trim().toLowerCase()
      if (!email) return
      if (!GUEST_EMAIL_PATTERN.test(email)) {
        throw new Error('Enter a valid guest email address')
      }
      if (excluded.has(email) || seen.has(email)) return
      if (normalized.length >= MAX_GUEST_EMAILS) {
        throw new Error('You can add up to five guest email addresses')
      }
      seen.add(email)
      normalized.push(email)
    })
    return normalized.sort()
  }

  function readGuestEmails(popup, excludedEmails) {
    if (!popup || typeof popup.querySelectorAll !== 'function') {
      throw new Error('The authored guest email form is unavailable')
    }
    const values = Array.from(popup.querySelectorAll('[data-call-guest-email]')).map(function (field) {
      return field && field.value
    })
    if (values.length !== MAX_GUEST_EMAILS) {
      throw new Error('The authored guest email form is incomplete')
    }
    return normalizeGuestEmails(values, excludedEmails)
  }

  function bookingRequestFingerprint(input) {
    const payload = bookingPayload(input, 'fingerprint')
    delete payload.idempotency_key
    return JSON.stringify(payload)
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

  function availabilityQuery(config, nowMs) {
    const configId = String((config && config.config_id) || '').trim()
    const grantId = String((config && config.grant_id) || '').trim()
    const duration = Number(config && config.duration)
    if (!configId || !grantId || !Number.isInteger(duration) || duration <= 0) {
      throw new Error('A valid paid-call service is required')
    }
    const start = Math.floor(Number(nowMs === undefined ? Date.now() : nowMs) / 1000) + 24 * 60 * 60
    const end = start + 14 * 24 * 60 * 60
    const query = new URLSearchParams({
      grant_id: grantId,
      configuration_id: configId,
      start_time: String(start),
      end_time: String(end),
      region: 'us',
    })
    return AVAILABILITY_PATH + '?' + query.toString()
  }

  function normalizeAvailabilitySlots(result, config) {
    const durationMs = Number(config && config.duration) * 60 * 1000
    const rows = Array.isArray(result && result.time_slots) ? result.time_slots : []
    return rows.map(function (slot) {
      const startSeconds = Number(slot && slot.start_time)
      const endSeconds = Number(slot && slot.end_time)
      const start = startSeconds * 1000
      const end = Number.isFinite(endSeconds) && endSeconds > startSeconds
        ? endSeconds * 1000
        : start + durationMs
      return { start, end }
    }).filter(function (slot) {
      return Number.isFinite(slot.start) && Number.isFinite(slot.end) && slot.end > slot.start
    }).sort(function (a, b) {
      return a.start - b.start
    })
  }

  async function getPaidAvailability(config, nowMs) {
    const result = await authenticatedRequest(availabilityQuery(config, nowMs), 'GET')
    return normalizeAvailabilitySlots(result, config)
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
    const guestEmails = normalizeGuestEmails(source.guest_emails, [
      source.brand_email,
      source.starter_email,
    ])
    if (guestEmails.length) payload.guest_emails = guestEmails
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

  function canonicalPaidPrice(config) {
    const cents = Number(config && config.price_cents)
    const currency = String((config && config.currency) || '').toUpperCase()
    if (!Number.isInteger(cents) || cents < 500 || currency !== 'USD') return ''
    return cents % 100 === 0
      ? '$' + String(cents / 100)
      : '$' + (cents / 100).toFixed(2)
  }

  function applyStyles(node, styles) {
    Object.keys(styles).forEach(function (name) {
      node.style[name] = styles[name]
    })
    return node
  }

  function calendarDateKey(timestamp, timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: timezone,
    }).formatToParts(new Date(timestamp))
    const values = {}
    parts.forEach(function (part) { values[part.type] = part.value })
    return [values.year, values.month, values.day].join('-')
  }

  function localDateFromKey(key) {
    const parts = String(key || '').split('-').map(Number)
    return new Date(parts[0], parts[1] - 1, parts[2])
  }

  function localDateKey(date) {
    return [
      String(date.getFullYear()),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-')
  }

  async function mountPaidCalendar(options) {
    const settings = options || {}
    const container = settings.container
    const config = settings.config
    const onConfirm = settings.onConfirm
    const isCurrent = typeof settings.isCurrent === 'function'
      ? settings.isCurrent
      : function () { return true }
    if (!container || !global.document || typeof onConfirm !== 'function') {
      throw new Error('The authored paid-call calendar is unavailable')
    }
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const slots = await getPaidAvailability(config)
    if (!isCurrent()) return { slots: [], stale: true }
    container.textContent = ''
    container.setAttribute('data-paid-calendar-state', slots.length ? 'ready' : 'empty')

    const status = applyStyles(global.document.createElement('p'), {
      color: '#6f746d',
      fontSize: '13px',
      margin: '0',
    })
    status.setAttribute('data-paid-calendar-element', 'status')
    if (!slots.length) {
      status.textContent = 'No available times were found in the next 14 days.'
      container.appendChild(status)
      return { slots: [] }
    }

    const groups = {}
    const dateKeys = []
    slots.forEach(function (slot) {
      const key = calendarDateKey(slot.start, timezone)
      if (!groups[key]) {
        groups[key] = []
        dateKeys.push(key)
      }
      groups[key].push(slot)
    })
    let selectedDate = dateKeys[0]
    let selectedSlot = null

    const shell = applyStyles(global.document.createElement('div'), {
      display: 'grid',
      gap: '16px',
      width: '100%',
    })
    shell.setAttribute('data-paid-calendar-element', 'shell')
    const calendarHost = global.document.createElement('div')
    calendarHost.setAttribute('data-paid-calendar-element', 'month')
    const times = applyStyles(global.document.createElement('div'), {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))',
      gap: '8px',
    })
    times.setAttribute('data-paid-calendar-element', 'times')
    const confirm = applyStyles(global.document.createElement('button'), {
      padding: '12px 16px',
      border: '1px solid #1f211d',
      borderRadius: '6px',
      background: '#1f211d',
      color: '#ffffff',
      cursor: 'pointer',
    })
    confirm.type = 'button'
    confirm.disabled = true
    confirm.textContent = 'Request paid call'
    confirm.setAttribute('data-paid-calendar-element', 'confirm')

    function renderTimes() {
      times.textContent = ''
      selectedSlot = null
      confirm.disabled = true
      groups[selectedDate].forEach(function (slot) {
        const button = global.document.createElement('button')
        button.type = 'button'
        button.textContent = new Intl.DateTimeFormat('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: timezone,
        }).format(new Date(slot.start))
        button.setAttribute('data-paid-calendar-slot', String(slot.start))
        button.setAttribute('aria-pressed', 'false')
        applyStyles(button, {
          padding: '10px 11px',
          border: '1px solid transparent',
          borderRadius: '6px',
          background: '#f3f4ef',
          color: '#1f211d',
          cursor: 'pointer',
        })
        button.addEventListener('click', function () {
          Array.from(times.querySelectorAll('[data-paid-calendar-slot]')).forEach(function (candidate) {
            candidate.setAttribute('aria-pressed', candidate === button ? 'true' : 'false')
            candidate.style.background = candidate === button ? '#1f211d' : '#f3f4ef'
            candidate.style.color = candidate === button ? '#ffffff' : '#1f211d'
          })
          selectedSlot = slot
          confirm.disabled = false
          status.textContent = ''
        })
        times.appendChild(button)
      })
    }

    const $ = global.jQuery
    if ($ && $.fn && $.fn.datepicker) {
      $(calendarHost).datepicker({
        dateFormat: 'yy-mm-dd',
        defaultDate: localDateFromKey(selectedDate),
        minDate: localDateFromKey(dateKeys[0]),
        maxDate: localDateFromKey(dateKeys[dateKeys.length - 1]),
        showOtherMonths: true,
        selectOtherMonths: false,
        beforeShowDay: function (date) {
          const available = Boolean(groups[localDateKey(date)])
          return [available, available ? 'scheduling-preview-available-date' : '', available ? 'Available' : 'Unavailable']
        },
        onSelect: function (dateText) {
          selectedDate = dateText
          renderTimes()
        },
      })
    } else {
      applyStyles(calendarHost, {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))',
        gap: '8px',
      })
      dateKeys.forEach(function (key) {
        const button = global.document.createElement('button')
        button.type = 'button'
        button.textContent = new Intl.DateTimeFormat('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: timezone,
        }).format(new Date(groups[key][0].start))
        button.addEventListener('click', function () {
          selectedDate = key
          renderTimes()
        })
        calendarHost.appendChild(button)
      })
    }

    confirm.addEventListener('click', async function () {
      if (!selectedSlot || confirm.disabled) return
      confirm.disabled = true
      status.textContent = 'Sending your request...'
      try {
        await onConfirm({
          start: selectedSlot.start,
          end: selectedSlot.end,
          timezone,
        })
      } catch (error) {
        console.error('[paid-call] booking failed', error)
        status.textContent = 'We could not book this call. Please try again.'
        confirm.disabled = false
      }
    })

    shell.appendChild(calendarHost)
    shell.appendChild(times)
    shell.appendChild(confirm)
    shell.appendChild(status)
    container.appendChild(shell)
    renderTimes()
    return { slots, timezone }
  }

  function installPaidBookingController(options) {
    const settings = options || {}
    const config = settings.config
    const grantId = String(settings.grantId || (config && config.grant_id) || '').trim()
    const duration = Number(config && config.duration)
    const document = global.document
    const priceText = canonicalPaidPrice(config)
    if (!document || !config || config.is_paid !== true || !config.config_id || !grantId || !Number.isInteger(duration) || duration <= 0 || !priceText) {
      return false
    }
    const availabilityConfig = Object.assign({}, config, {
      grant_id: grantId,
      duration,
    })
    const ctas = Array.from(document.querySelectorAll(
      '[call-type-item] [booking-popup-open][data-type="paid"][data-config]',
    )).filter(function (cta) {
      return cta.getAttribute('data-config') === config.config_id
    })
    const popup = document.querySelector('[popup-booking]')
    const container = popup && popup.querySelector('[nylas-container]')
    if (!ctas.length || !popup || !container) return false
    const guestWrapper = popup.querySelector('[data-call-guest-fields]')
    const guestList = guestWrapper && guestWrapper.querySelector('[data-call-guest-list]')
    const guestError = guestWrapper && guestWrapper.querySelector('[data-call-guest-error]')
    const guestAdd = guestWrapper && guestWrapper.querySelector('[data-call-guest-add]')
    const guestRows = guestList
      ? Array.from(guestList.querySelectorAll('[data-call-guest-row]'))
      : []
    const guestBindings = guestRows.map(function (row) {
      return {
        row,
        field: row.querySelector('[data-call-guest-email]'),
        remove: row.querySelector('[data-call-guest-remove]'),
      }
    })
    const authoredGuestFields = typeof popup.querySelectorAll === 'function'
      ? Array.from(popup.querySelectorAll('[data-call-guest-email]'))
      : []
    if (
      !guestWrapper ||
      !guestList ||
      !guestError ||
      !guestAdd ||
      guestRows.length !== MAX_GUEST_EMAILS ||
      authoredGuestFields.length !== MAX_GUEST_EMAILS ||
      guestBindings.some(function (binding) { return !binding.field || !binding.remove }) ||
      guestBindings.some(function (binding) { return !authoredGuestFields.includes(binding.field) }) ||
      (typeof container.contains === 'function' && container.contains(guestWrapper))
    ) {
      return false
    }
    const bindings = ctas.map(function (cta) {
      const item = cta.closest('[call-type-item]')
      const price = item && item.querySelector('[call-type-price]')
      return { cta, item, price }
    })
    if (bindings.some(function (binding) { return !binding.item || !binding.price })) return false

    let cardElement = null
    let cardSetupInstalled = false
    let cardSetupAttempt = null
    let defaultSelectionAttempt = null
    let defaultSelectionPaymentMethod = ''
    let paidClickLock = false
    let bookingLock = false
    let bookingAttempt = null
    let activeBookingFingerprint = ''
    let activePaidGeneration = 0
    let queuedPaidGeneration = 0

    function nextSurfaceGeneration() {
      const generation = (bookingSurfaceGenerations.get(container) || 0) + 1
      bookingSurfaceGenerations.set(container, generation)
      return generation
    }

    function ownsSurface(generation) {
      return bookingSurfaceGenerations.get(container) === generation
    }

    function claimPaidSurface() {
      const generation = nextSurfaceGeneration()
      activePaidGeneration = generation
      resetGuestUi()
      setGuestUiVisible(true)
      container.textContent = 'Loading available times...'
      container.setAttribute('data-paid-calendar-state', 'loading')
      return generation
    }

    function fieldValue(selector) {
      const field = popup.querySelector(selector)
      return field ? String(field.value || '').trim() : ''
    }

    function setGuestError(message) {
      guestError.textContent = String(message || '')
      guestError.style.display = message ? 'block' : 'none'
    }

    function setGuestUiVisible(visible) {
      guestWrapper.style.display = visible ? 'flex' : 'none'
      guestWrapper.setAttribute('aria-hidden', visible ? 'false' : 'true')
    }

    function updateGuestControls() {
      const visibleCount = guestBindings.filter(function (binding) {
        return binding.row.getAttribute('aria-hidden') !== 'true'
      }).length
      guestAdd.disabled = visibleCount >= MAX_GUEST_EMAILS
      guestAdd.style.display = guestAdd.disabled ? 'none' : ''
    }

    function resetGuestUi() {
      guestBindings.forEach(function (binding, index) {
        binding.field.value = ''
        binding.field.disabled = index !== 0
        binding.row.style.display = index === 0 ? 'flex' : 'none'
        binding.row.setAttribute('aria-hidden', index === 0 ? 'false' : 'true')
        binding.remove.style.display = index === 0 ? 'none' : ''
      })
      setGuestError('')
      updateGuestControls()
    }

    function closeGuestUi() {
      resetGuestUi()
      setGuestUiVisible(false)
      bookingAttempt = null
      activeBookingFingerprint = ''
    }

    function showBookingError(error) {
      console.error('[paid-call] booking failed', error)
      container.setAttribute('data-paid-calendar-state', 'error')
      container.textContent = 'We could not load the calendar. Please try again.'
      const message = popup.querySelector('[paid-call-text]')
      if (message) message.textContent = 'We could not book this call. Please try again.'
    }

    async function submitBooking(slot) {
      if (bookingLock) return
      let guestEmails
      try {
        guestEmails = readGuestEmails(popup, [settings.brandEmail, settings.starterEmail])
        setGuestError('')
      } catch (error) {
        setGuestError(error && error.message)
        throw error
      }
      const bookingInput = {
        starter_slug: settings.starterSlug,
        config_id: config.config_id,
        start: slot.start,
        end: slot.end,
        timezone: slot.timezone,
        topic: fieldValue('[name="topic"], [booking-topic]'),
        context: fieldValue('[name="context"], [booking-context]'),
        guest_emails: guestEmails,
        brand_email: settings.brandEmail,
        starter_email: settings.starterEmail,
      }
      const fingerprint = bookingRequestFingerprint(bookingInput)
      if (!bookingAttempt || activeBookingFingerprint !== fingerprint) {
        activeBookingFingerprint = fingerprint
        bookingAttempt = createBookingAttempt(bookingInput)
      }
      bookingLock = true
      try {
        const result = await bookingAttempt.run()
        const successText = popup.querySelector('[booking-success-text]')
        if (successText) {
          successText.textContent = 'Your paid call request was sent. We will notify you when the Starter confirms it.'
        }
        closeGuestUi()
        switchStep(popup, 'success')
        return result
      } finally {
        bookingLock = false
      }
    }

    async function mountCalendar(generation) {
      if (!ownsSurface(generation)) return
      const mount = typeof settings.mountCalendar === 'function'
        ? settings.mountCalendar
        : mountPaidCalendar
      const result = await mount({
        container,
        config: availabilityConfig,
        onConfirm: submitBooking,
        isCurrent: function () { return ownsSurface(generation) },
      })
      return ownsSurface(generation) ? result : undefined
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
          await onReady()
        } catch (error) {
          errorText.textContent = error.message || 'Card setup failed'
          statusText.textContent = ''
        } finally {
          save.disabled = false
        }
      }, true)
      cardSetupInstalled = true
    }

    async function runPaidSelection(generation) {
      try {
        const readiness = await getReadiness()
        if (!ownsSurface(generation)) return
        if (readiness.bookable) {
          await mountCalendar(generation)
          return
        }
        await installCardSetup(function () { return mountCalendar(activePaidGeneration) })
        if (!ownsSurface(generation)) return
        const openCard = document.querySelector('[popup-stripe-card-open]')
        if (!openCard) throw new Error('The payment form opener is unavailable')
        openCard.click()
      } catch (error) {
        if (ownsSurface(generation)) showBookingError(error)
      }
    }

    async function paidClick(event) {
      event.preventDefault()
      if (paidClickLock && ownsSurface(activePaidGeneration)) return
      queuedPaidGeneration = claimPaidSurface()
      if (paidClickLock) return
      paidClickLock = true
      try {
        while (queuedPaidGeneration) {
          const generation = queuedPaidGeneration
          queuedPaidGeneration = 0
          await runPaidSelection(generation)
        }
      } finally {
        paidClickLock = false
      }
    }

    Array.from(document.querySelectorAll(
      '[call-type-item] [booking-popup-open][data-type="free"][data-config]',
    )).forEach(function (cta) {
      if (typeof cta.addEventListener === 'function') {
        cta.addEventListener('click', function () {
          closeGuestUi()
          nextSurfaceGeneration()
        }, true)
      }
    })

    guestAdd.addEventListener('click', function (event) {
      event.preventDefault()
      const next = guestBindings.find(function (binding) {
        return binding.row.getAttribute('aria-hidden') === 'true'
      })
      if (!next) return
      next.row.style.display = 'flex'
      next.row.setAttribute('aria-hidden', 'false')
      next.field.disabled = false
      if (typeof next.field.focus === 'function') next.field.focus()
      updateGuestControls()
    })

    guestBindings.forEach(function (binding, index) {
      binding.remove.addEventListener('click', function (event) {
        event.preventDefault()
        binding.field.value = ''
        if (index !== 0) {
          binding.field.disabled = true
          binding.row.style.display = 'none'
          binding.row.setAttribute('aria-hidden', 'true')
        }
        setGuestError('')
        updateGuestControls()
      })
    })

    Array.from(popup.querySelectorAll(
      '[data-modal-close], [booking-popup-close], [popup-booking-close]',
    )).forEach(function (control) {
      if (typeof control.addEventListener === 'function') {
        control.addEventListener('click', closeGuestUi)
      }
    })

    closeGuestUi()

    bindings.forEach(function (binding) {
      const cta = binding.cta
      cta.onclick = paidClick
      cta.setAttribute('data-paid-call-v3', 'ready')
      binding.price.textContent = priceText
      binding.item.style.display = 'block'
    })
    return true
  }

  const api = {
    SETUP_PATH,
    SET_DEFAULT_PATH,
    READINESS_PATH,
    AVAILABILITY_PATH,
    BOOKING_PATH,
    XANO_BASE,
    authenticatedRequest,
    authenticatedPost,
    bookingPayload,
    bookingRequestFingerprint,
    canonicalPaidPrice,
    createBookingAttempt,
    createAttemptKey,
    createDefaultSelectionAttempt,
    createSetupAttempt,
    availabilityQuery,
    getReadiness,
    getPaidAvailability,
    installPaidBookingController,
    mountPaidCalendar,
    normalizeGuestEmails,
    normalizeAvailabilitySlots,
    readGuestEmails,
    validateKey,
    validatePaymentMethodId,
  }

  if (isCommonJs) {
    module.exports = api
    return
  }
  global.StartersPaidCallBrandPayment = api
})(typeof window !== 'undefined' ? window : globalThis)
