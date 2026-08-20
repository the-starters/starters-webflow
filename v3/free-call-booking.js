/**
 * GitHub-owned Free Call booking controller for /hire/<slug>.
 *
 * Webflow owns the chooser, modal, form rows, and success step. This module
 * only binds those authored elements, reads canonical V3 booking data, and
 * mounts the Nylas scheduling custom element after an explicit Free click.
 */
;(function (global) {
  'use strict'

  const isCommonJs =
    typeof module !== 'undefined' && typeof module.exports !== 'undefined'
  const XANO_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'
  const STARTER_PATH = '/starter/get_booking_profile/v3'
  const CONFIGS_PATH = '/nylas_configurations/get_bookable/v3'
  const AVAILABILITY_PATH = '/scheduler/get_availability/v3'
  const NYLAS_MODULE_URL =
    'https://cdn.jsdelivr.net/npm/@nylas/web-elements@latest/dist/cdn/nylas-scheduling/nylas-scheduling.es.js'
  const SCHEDULER_API_URL = 'https://api.us.nylas.com'
  const chooserBindings = new WeakMap()
  let schedulerModulePromise = null

  const SHADOW_STYLES = Object.freeze({
    main: `
      #report-issue { display: none !important; }
      .additional-data-page .left-panel { background: white !important; }
      .language-feedback-container { display: none !important; }
      .message-banner { border: none !important; color: var(--colors--black-olive) !important; }
      nylas-date-picker { padding: 0 20px !important; }
      nylas-selected-event-card {
        padding: 0 24px !important;
        margin-inline: 16px !important;
        background: var(--_colors---fill--primary) !important;
        border-radius: 4px !important;
      }
      nylas-locale-switch {
        border-color: var(--_colors---fill--primary) !important;
        padding: 23px !important;
      }`,
    timePicker: `
      .time .time-label span.spots { display: none !important; }
      .footer {
        display: flex;
        justify-content: flex-end;
        border-color: var(--_colors---fill--primary) !important;
        padding: 25px !important;
      }
      .footer .button-primary { padding-inline: 20px !important; }
      @media screen and (max-width: 768px) {
        .footer {
          position: fixed !important;
          bottom: 0 !important;
          left: 0 !important;
          width: 100% !important;
          background: #fff !important;
          padding: 16px 25px !important;
        }
      }`,
    datePicker: '.pagination { min-width: 72px !important; }',
    bookingForm: `
      .cta {
        border-color: var(--_colors---fill--primary) !important;
        display: flex !important;
        justify-content: flex-end !important;
        padding: 25px !important;
      }
      .nylas-booking-form {
        margin-top: -16px !important;
        padding: 24px 24px 16px !important;
      }
      .input-wrapper { margin-bottom: 20px !important; gap: 8px !important; }
      .input-wrapper label { color: var(--_colors---text-color--primary) !important; }
      .guest-email-input input {
        border: 1px solid var(--_colors---fill--primary) !important;
        border-radius: 0 !important;
        outline: none !important;
      }
      .guest-email-input input[type="email"][part="nbf__input-textfield"].guest-email::placeholder {
        color: #1E211E66 !important;
      }`,
    locale: `
      .dropdown-content {
        bottom: calc(100% + 6px) !important;
        width: 300px !important;
        border: 1px solid var(--_colors---fill--primary) !important;
        border-radius: 4px !important;
      }
      .dropbtn {
        padding: 15px !important;
        outline: none !important;
        border-radius: 4px !important;
        color: var(--colors--black-olive) !important;
      }
      .dropbtn:hover, .dropbtn[aria-expanded="true"] {
        background: var(--_colors---fill--primary) !important;
      }
      @media screen and (max-width: 768px) {
        .dropdown-content { left: 24px !important; right: 24px !important; width: unset !important; }
      }`,
    buttons: `
      button.sc-button-component { outline: none !important; box-shadow: none !important; }
      .button-primary {
        background-color: var(--colors--black-olive) !important;
        border: 1px solid var(--colors--black-olive) !important;
        border-radius: 4px !important;
        padding: 0 16px !important;
        font-size: 14px !important;
        height: 46px !important;
        text-transform: uppercase !important;
      }
      .button-primary:hover {
        background-color: var(--_colors---fill--olive) !important;
        border-color: var(--_colors---fill--olive) !important;
        color: #fff !important;
      }
      .add-guest { width: 100% !important; }
      .button-invisible, .button-basic {
        background-color: #fff !important;
        border: 1px solid var(--colors--black-olive) !important;
        border-radius: 4px !important;
        font-size: 14px !important;
        height: 46px !important;
        color: var(--colors--black-olive) !important;
        text-transform: uppercase !important;
      }`,
    input: `
      label { gap: 8px !important; }
      label input {
        border-radius: 4px !important;
        border: 1px solid var(--_colors---border--primary) !important;
        color: var(--_colors---text-color--primary) !important;
        outline: none !important;
      }
      label input:read-only { background-color: var(--_colors---fill--primary) !important; }
      label .label { color: var(--_colors---text-color--primary) !important; font-size: 16px; }`,
  })

  function clean(value) {
    return String(value == null ? '' : value).trim()
  }

  async function authenticatedRequest(path, method, payload) {
    if (typeof global.xanoAuthFetch !== 'function') {
      throw new Error('The authenticated Xano bridge is unavailable')
    }
    const options = {
      method: method || 'GET',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    }
    if (payload !== undefined) options.body = JSON.stringify(payload)
    const response = await global.xanoAuthFetch(XANO_BASE + path, options)
    const data = await response.json().catch(function () { return null })
    if (!response.ok) {
      throw Object.assign(new Error(path + ' failed (' + response.status + ')'), {
        status: response.status,
        data,
      })
    }
    return data
  }

  async function getStarterByMemberId(memberId) {
    const id = clean(memberId)
    if (!id) throw new Error('A Starter member ID is required')
    try {
      const result = await authenticatedRequest(STARTER_PATH, 'POST', { member_id: id })
      return result && result.id ? result : null
    } catch (error) {
      console.error('[free-call-booking] Starter lookup failed:', error)
      return null
    }
  }

  async function getConfigs(grantId) {
    const id = clean(grantId)
    if (!id) throw new Error('A Nylas grant ID is required')
    try {
      const result = await authenticatedRequest(CONFIGS_PATH, 'POST', { grant_id: id })
      return Array.isArray(result) ? result : []
    } catch (error) {
      console.error('[free-call-booking] configuration lookup failed:', error)
      return []
    }
  }

  function availabilityPath(grantId, configId, nowMs) {
    const grant = clean(grantId)
    const config = clean(configId)
    if (!grant || !config) throw new Error('A grant and configuration are required')
    const start = Math.floor(Number(nowMs === undefined ? Date.now() : nowMs) / 1000) + 86400
    const query = new URLSearchParams({
      grant_id: grant,
      configuration_id: config,
      start_time: String(start),
      end_time: String(start + 14 * 86400),
      region: 'us',
    })
    return AVAILABILITY_PATH + '?' + query.toString()
  }

  async function getNearestSlot(grantId, configId, nowMs) {
    const result = await authenticatedRequest(availabilityPath(grantId, configId, nowMs), 'GET')
    const minimum = Math.floor(Number(nowMs === undefined ? Date.now() : nowMs) / 1000) + 86400
    const slots = Array.isArray(result && result.time_slots) ? result.time_slots : []
    const starts = slots.map(function (slot) {
      return Number(slot && slot.start_time)
    }).filter(function (start) {
      return Number.isFinite(start) && start >= minimum
    }).sort(function (a, b) { return a - b })
    return starts.length ? starts[0] : null
  }

  function formatWithTimezone(timestamp, formatOptions) {
    const date = new Date(timestamp)
    if (!Number.isFinite(date.getTime())) return { default: '', list: {} }
    const formatter = new Intl.DateTimeFormat('en-US', Object.assign({
      weekday: 'short',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    }, formatOptions || {}))
    const values = {}
    formatter.formatToParts(date).forEach(function (part) {
      if (part.type !== 'literal') values[part.type] = part.value
    })
    values.dayPeriod = clean(values.dayPeriod).toUpperCase()
    return {
      default: [
        values.weekday + ' ' + values.month + ' ' + values.day + ',',
        values.hour + ':' + values.minute + values.dayPeriod,
        values.timeZoneName,
      ].join(' '),
      list: values,
    }
  }

  function styleNode(id, css) {
    const style = global.document.createElement('style')
    style.id = id
    style.textContent = css
    return style
  }

  function appendStyle(root, id, css) {
    if (!root || (root.getElementById && root.getElementById(id))) return
    root.appendChild(styleNode(id, css))
  }

  function pollFor(read, apply, attempts) {
    let remaining = Number.isInteger(attempts) ? attempts : 2000
    const run = function () {
      const value = read()
      if (value) {
        apply(value)
        return
      }
      remaining -= 1
      if (remaining > 0) global.setTimeout(run, 5)
    }
    run()
  }

  function styleTimeslotPicker(scheduler) {
    pollFor(
      function () { return scheduler.shadowRoot.querySelector('nylas-timeslot-picker') },
      function (picker) {
        appendStyle(picker.shadowRoot, 'starters-free-timeslot', SHADOW_STYLES.timePicker)
        appendStyle(picker.shadowRoot, 'starters-free-buttons', SHADOW_STYLES.buttons)
        const submit = picker.shadowRoot.querySelector('.footer button.button-primary')
        if (submit) submit.textContent = 'Schedule A Call'
      },
    )
  }

  function styleFirstView(scheduler) {
    pollFor(
      function () { return scheduler.shadowRoot.querySelector('nylas-date-picker') },
      function (picker) {
        appendStyle(picker.shadowRoot, 'starters-free-date-picker', SHADOW_STYLES.datePicker)
      },
    )
    pollFor(
      function () { return scheduler.shadowRoot.querySelector('nylas-locale-switch') },
      function (picker) {
        const select = picker.shadowRoot.querySelector('select-dropdown')
        if (select) appendStyle(select.shadowRoot, 'starters-free-locale', SHADOW_STYLES.locale)
      },
    )
    styleTimeslotPicker(scheduler)
  }

  function styleBookingForm(scheduler) {
    pollFor(
      function () { return scheduler.shadowRoot.querySelector('nylas-booking-form') },
      function (form) {
        appendStyle(form.shadowRoot, 'starters-free-booking-form', SHADOW_STYLES.bookingForm)
        appendStyle(form.shadowRoot, 'starters-free-buttons', SHADOW_STYLES.buttons)
        const submit = form.shadowRoot.querySelector('button[type="submit"]')
        if (submit) submit.textContent = 'Request Call'
        pollFor(
          function () {
            const rows = Array.from(form.shadowRoot.querySelectorAll('input-component'))
            const ids = new Set(rows.map(function (row) { return row.id }))
            return ids.has('brand_memberstack_id') && ids.has('starter_memberstack_id')
              ? rows
              : null
          },
          function (rows) {
            rows.forEach(function (row) {
              appendStyle(row.shadowRoot, 'starters-free-input', SHADOW_STYLES.input)
              if ([
                'rescheduled_reason',
                'unique_id',
                'from_stage',
                'brand_memberstack_id',
                'starter_memberstack_id',
              ].includes(row.id) && row.parentElement) {
                row.parentElement.style.display = 'none'
              }
            })
          },
        )
      },
    )
  }

  function populateSuccess(popup, bookingData, timeslot) {
    if (!popup || !bookingData) return
    const additional = bookingData.additional_fields || {}
    const values = {
      title: additional.call_full_title,
      context: additional.call_context,
      'start-date': timeslot && timeslot.start_time
        ? formatWithTimezone(timeslot.start_time.getTime()).default
        : '',
      'paid-meeting': 'Free Call',
      price: '',
    }
    popup.querySelectorAll('[booking-element]').forEach(function (element) {
      const key = element.getAttribute('booking-element')
      if (!Object.prototype.hasOwnProperty.call(values, key)) return
      const wrapper = element.closest && element.closest('[booking-element-wrap]')
      if (!values[key]) {
        element.style.display = 'none'
        if (wrapper) wrapper.style.display = 'none'
        return
      }
      element.style.display = ''
      if (wrapper) wrapper.style.display = wrapper.hasAttribute('display-flex') ? 'flex' : 'block'
      if (key === 'start-date' && wrapper) {
        const parts = String(values[key]).split(',')
        const date = wrapper.querySelector('[booking-element="start-date"]')
        const time = wrapper.querySelector('[booking-element="start-time"]')
        if (date) date.textContent = clean(parts[0])
        if (time) time.textContent = clean(parts.slice(1).join(','))
        return
      }
      element.textContent = values[key]
    })
    popup.querySelectorAll('[schedule-step]').forEach(function (step) {
      step.style.display = step.getAttribute('schedule-step') === 'success' ? 'flex' : 'none'
    })
    popup.querySelectorAll('[booking-success-text]').forEach(function (text) {
      const starter = clean(additional.starter_name) || 'the Starter'
      text.textContent = 'We will share your call request with ' + starter +
        ' and notify you after confirmation, typically within 48 hours.'
    })
  }

  async function ensureSchedulerElement(loader) {
    if (global.customElements && global.customElements.get('nylas-scheduling')) return
    if (!schedulerModulePromise) {
      const load = typeof loader === 'function'
        ? loader
        : function (url) { return import(url) }
      schedulerModulePromise = Promise.resolve(load(NYLAS_MODULE_URL)).then(function (mod) {
        if (!mod || typeof mod.defineCustomElement !== 'function') {
          throw new Error('The Nylas scheduler module is unavailable')
        }
        mod.defineCustomElement()
      }).catch(function (error) {
        schedulerModulePromise = null
        throw error
      })
    }
    await schedulerModulePromise
  }

  async function createScheduler(options) {
    const settings = options || {}
    const configId = clean(settings.configId)
    const name = clean(settings.brandName)
    const email = clean(settings.brandEmail)
    const container = settings.container || global.document.querySelector('[nylas-container]')
    if (!configId || !name || !email || !container) {
      throw new Error('The Free Call scheduler contract is incomplete')
    }
    await ensureSchedulerElement(settings.loadSchedulerModule)
    container.replaceChildren()
    const scheduler = global.document.createElement('nylas-scheduling')
    scheduler.schedulerApiUrl = SCHEDULER_API_URL
    scheduler.configurationId = configId
    scheduler.bookingInfo = {
      primaryParticipant: { name, email },
      additionalFields: {
        rescheduled_reason: { value: ' ', type: 'text' },
        unique_id: { value: global.crypto.randomUUID(), type: 'text' },
        from_stage: {
          value: String(global.location.hostname === 'the-starters-3-0.webflow.io'),
          type: 'text',
        },
      },
    }
    scheduler.eventOverrides = {
      bookedEventInfo: function (event, connector) {
        if (!event || !event.detail || event.detail.error) return
        const timeslot = connector.schedulerStore.get('selectedTimeslot')
        populateSuccess(container.closest('[popup-booking]'), event.detail.data, timeslot)
      },
      timeslotConfirmed: function () { styleBookingForm(scheduler) },
      backButtonClicked: function () { styleFirstView(scheduler) },
      timeslotSelected: function () { styleTimeslotPicker(scheduler) },
    }
    appendStyle(scheduler.shadowRoot, 'starters-free-main', SHADOW_STYLES.main)
    container.appendChild(scheduler)
    global.setTimeout(function () { styleFirstView(scheduler) }, 500)
    return scheduler
  }

  function nextSlotText(value) {
    const list = formatWithTimezone(value * 1000, { month: '2-digit' }).list
    return list.hour + ':' + list.minute + list.dayPeriod + ' on ' + list.month + '/' + list.day
  }

  function updateNearestSlot(state, value) {
    const item = state.cta.closest('[call-type-item]') || state.cta
    const target = item.querySelector('[next-available-slot]')
    if (target) target.textContent = value
  }

  function installFreeBookingController(options) {
    const settings = options || {}
    const config = settings.config || {}
    const configId = clean(config.config_id)
    const grantId = clean(settings.grantId)
    if (!configId || config.is_paid !== false || !grantId) return false
    const popup = global.document.querySelector('[popup-booking]')
    const ctas = Array.from(global.document.querySelectorAll(
      '[call-type-item] [booking-popup-open][data-type="free"]',
    ))
    const mainButtons = Array.from(global.document.querySelectorAll(
      '[data-modal-trigger="popup-booking-main"]',
    ))
    if (!popup || !ctas.length || !mainButtons.length) return false

    const state = {
      config,
      configId,
      grantId,
      brandName: clean(settings.brandName),
      brandEmail: clean(settings.brandEmail),
      loadSchedulerModule: settings.loadSchedulerModule,
      popup,
      cta: ctas[0],
    }
    if (!state.brandName || !state.brandEmail) return false

    ctas.forEach(function (cta) {
      const binding = chooserBindings.get(cta) || { state: null, schedulerLock: false }
      binding.state = Object.assign({}, state, { cta })
      chooserBindings.set(cta, binding)
      cta.setAttribute('data-config', configId)
      const item = cta.closest('[call-type-item]')
      if (item) item.style.display = 'block'
      cta.onclick = async function (event) {
        event.preventDefault()
        if (binding.schedulerLock) return
        binding.schedulerLock = true
        try {
          await createScheduler({
            configId: binding.state.configId,
            brandName: binding.state.brandName,
            brandEmail: binding.state.brandEmail,
            loadSchedulerModule: binding.state.loadSchedulerModule,
          })
          binding.state.popup.querySelectorAll('[success-call-buttons]').forEach(function (element) {
            element.style.display = element.getAttribute('data-type') === 'free' ? 'flex' : 'none'
          })
        } catch (error) {
          console.error('[free-call-booking] scheduler failed:', error)
        } finally {
          binding.schedulerLock = false
        }
      }
    })

    mainButtons.forEach(function (button) {
      button.onclick = async function (event) {
        event.preventDefault()
        updateNearestSlot(state, 'Loading...')
        try {
          const slot = await getNearestSlot(state.grantId, state.configId)
          updateNearestSlot(state, slot ? nextSlotText(slot) : 'No available slots')
        } catch (error) {
          updateNearestSlot(state, 'No available slots')
          console.error('[free-call-booking] availability failed:', error)
        }
      }
    })
    return true
  }

  const api = {
    AVAILABILITY_PATH,
    CONFIGS_PATH,
    NYLAS_MODULE_URL,
    STARTER_PATH,
    XANO_BASE,
    authenticatedRequest,
    availabilityPath,
    createScheduler,
    ensureSchedulerElement,
    formatWithTimezone,
    getConfigs,
    getNearestSlot,
    getStarterByMemberId,
    installFreeBookingController,
  }

  if (isCommonJs) {
    module.exports = api
    return
  }
  global.StartersFreeCallBooking = Object.freeze(api)
})(typeof window !== 'undefined' ? window : globalThis)
