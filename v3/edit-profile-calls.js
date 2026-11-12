/**
 * Edit Profile v2 — Calls tab controller (JP 2026-11-12, decisions 1a + 2a).
 *
 * Page: the staff-only draft /starter-edit-profile-test. The live
 * /starter-edit-profile keeps its own controllers (free-call-settings.js,
 * paid-call-settings.js) and is not touched by this file.
 *
 * Jerico's v3/profile-calls-step.js renders and validates the editor. This
 * module loads saved data into it and saves each change ("Changes to your
 * calls save as you make them"). It reuses the library modules; it has no
 * HTTP or OAuth code of its own:
 *
 *   load       starter/get_by_memberstack/v3 (hours, timezone, Google grant),
 *              GET starter/free-call-settings/get/v3 and
 *              GET starter/paid-call-settings/get/v3 -> editor.load().
 *              Saved items the editor cannot show (a dashboard day override)
 *              stay in memory and go back unchanged with every hours save.
 *              Nothing saves until the load succeeds.
 *   hours      any hours change, debounced, only when editor.validate() is ''
 *              -> onboarding/calendar/ensure-default/v3 (#12047) with
 *              offer_intro_call = the Free switch (onboarding-calendar.js save()).
 *   Free       switch on  -> free-call-settings/upsert/v3 {config_id,
 *                            description, expected_revision, idempotency_key};
 *                            with no calendar/hours yet, the hours save first.
 *              switch off -> free-call-settings/disable/v3.
 *              Description edits (debounced) upsert while the switch is on.
 *   Paid       switch on  -> paid-call-settings/upsert/v3 {config_id, title,
 *                            price_cents, duration_minutes: 60, ...} after the
 *                            title (3-80) and whole-dollar price ($1-$1,000)
 *                            check. With no active service the readiness must
 *                            allow it (calendar, hours, Stripe linked, charges,
 *                            fresh); otherwise the reason shows and the save
 *                            runs again when the calendar or Stripe changes.
 *              switch off -> paid-call-settings/disable/v3.
 *              Every write reads the settings back and checks them.
 *   Google     [data-calls-step-action="connect-google"|"switch-calendar"]:
 *              onboarding-calendar.js wireConnect() + calendar-google-connect.js
 *              (pop-up; this page is the OAuth return page).
 *   Disconnect [data-calls-step-action="disconnect-calendar"] goes to the
 *              dashboard calendar section (/starter-dashboard) for now.
 *   Stripe     onboarding-v2-stripe.js + onboarding-stripe-view.js own the card
 *              ([data-onboarding-stripe="root"]); this module only listens to
 *              their 'starters:stripe-connect-state' event.
 *
 * One writer per action: each of hours, Free and Paid runs one request at a
 * time; a change made during a save runs once after it, and an unchanged
 * Free/Paid service is not written again.
 *
 * Boot: /starter-edit-profile-test on the staging origin, or on
 * thestarters.com / www.thestarters.com only when the page also loads
 * v3/staff-preview-guard.js. Load order: profile-calls-step.js,
 * calendar-google-connect.js, onboarding-calendar.js, onboarding-stripe-view.js,
 * onboarding-v2-stripe.js, then this file.
 * Wiring: docs/wiring/EDIT-PROFILE-CALLS-WIRING.md
 */
;(function (global) {
  'use strict'

  const ROUTE = '/starter-edit-profile-test'
  const ROOT = '[data-calls-step="root"][data-calls-step-context="edit"]'
  const STARTER_PATH = '/starter/get_by_memberstack/v3'
  const FREE = '/starter/free-call-settings/'
  const PAID = '/starter/paid-call-settings/'
  const CONNECT = '[data-calls-step-action="connect-google"], [data-calls-step-action="switch-calendar"]'
  const DISCONNECT = '[data-calls-step-action="disconnect-calendar"]'
  const HOURS_ACTIONS = ['add-window', 'remove-window', 'add-extra', 'remove-extra']
  const STRIPE_EVENT = 'starters:stripe-connect-state'
  const DASHBOARD_CALENDAR_URL = '/starter-dashboard'
  const HOURS_DELAY_MS = 800
  const TEXT_DELAY_MS = 1000
  const FREE_DURATION_MINUTES = 30
  const PAID_DURATION_MINUTES = 60
  // #5674 refuses more than 140 characters (B76); the markup limits input to 60.
  const FREE_DESCRIPTION_MAX = 140
  const COPY = {
    loadFailed: 'We couldn’t load your call settings. Reload the page to try again.',
    hoursFailed: 'We couldn’t save your availability. Please try again.',
    hoursFirst: 'Set your weekly hours first.',
    freeBlocked: 'Connect your calendar and set your hours to turn on free calls.',
    freeTooLong: 'Free call description must be 140 characters or fewer.',
    freeFailed: 'We couldn’t save your free call. Please try again.',
    paidFailed: 'We couldn’t save your paid call. Please try again.',
    title: 'Use a title between 3 and 80 characters.',
    price: 'Use a whole-dollar rate from $1 to $1,000.',
    calendar: 'To turn on paid calls, first connect your calendar and set your availability.',
    stripe: 'To turn on paid calls, connect Stripe first. Stripe sends call payments to you.',
    charges: 'To turn on paid calls, finish your Stripe setup first. Stripe must be able to accept payments.',
    fresh: 'Your Stripe status is updating. Try again in a minute.',
    saved: 'Saved.',
    freeOff: 'Free calls are off.',
    paidOff: 'Paid calls are off.',
  }
  const STRIPE_STATUS = { none: 'disconnected', opened: 'opened', pending: 'pending', ready: 'ready' }

  function bootAllowed(win) {
    const location = win.location
    if (location.pathname.replace(/\/$/, '') !== ROUTE) return false
    if (location.origin === 'https://the-starters-3-0.webflow.io') return true
    if (location.origin !== 'https://www.thestarters.com' && location.origin !== 'https://thestarters.com') return false
    return Boolean(win.document && win.document.querySelector('script[src*="/v3/staff-preview-guard.js"]'))
  }

  function activeService(value, label) {
    const services = value && Array.isArray(value.services) ? value.services : []
    const active = services.filter(function (service) { return service && service.active === true })
    if (active.length > 1) throw new Error('Multiple active ' + label + ' services require support')
    return active[0] || null
  }

  function minutesOf(service) {
    return Number(service.duration === undefined || service.duration === null ? service.duration_minutes : service.duration)
  }

  function freeValid(service) {
    const cents = service.price_cents
    return minutesOf(service) === FREE_DURATION_MINUTES && (cents === undefined || cents === null || cents === '' || Number(cents) === 0)
  }

  function freeReady(value) {
    const readiness = (value && value.readiness) || {}
    return readiness.calendar_connected === true && readiness.availability_configured === true
  }

  // Same order and copy as the dashboard card (paid-call-settings.js setupBlocker).
  function paidBlocker(value) {
    const readiness = (value && value.readiness) || {}
    if (readiness.calendar_connected !== true || readiness.availability_configured !== true) return COPY.calendar
    if (readiness.stripe_connect_linked !== true) return COPY.stripe
    if (readiness.stripe_charges_enabled !== true) return COPY.charges
    if (readiness.stripe_readiness_fresh !== true) return COPY.fresh
    return ''
  }

  // Paid title + price from the form, or {error}.
  function paidIntent(titleValue, priceValue) {
    const title = String(titleValue || '').trim()
    if (title.length < 3 || title.length > 80) return { error: COPY.title }
    const raw = String(priceValue || '').trim()
    const price = /^[0-9]+$/.test(raw) ? Number(raw) : NaN
    if (!Number.isSafeInteger(price) || price < 1 || price > 1000) return { error: COPY.price }
    return { title, price_cents: price * 100, duration_minutes: PAID_DURATION_MINUTES }
  }

  function wholeDollars(service) {
    const cents = Number(service && service.price_cents)
    return Number.isInteger(cents) && cents >= 100 && cents <= 100000 && cents % 100 === 0 ? cents / 100 : undefined
  }

  // deps: { calendar: the onboarding-calendar.js module, editorFor(root) }
  function createEditCalls(win, deps) {
    let root = null
    let editor = null
    let controller = null
    let loaded = false
    let saved = { items: {}, days: [] }
    let free = null
    let paid = null
    let hoursTimer = null

    function remember(items) {
      const parsed = deps.calendar.fromItems(items)
      saved = { items: parsed.rest, days: parsed.hours ? parsed.hours.days : [] }
      return parsed
    }
    let hoursVersion = 0
    const textTimers = {}
    const lanes = {}

    const service = function (name) { return root.querySelector('[data-call-settings-service="' + name + '"]') }
    const field = function (name, key) {
      const row = service(name)
      return row ? row.querySelector('[data-call-settings-input="' + key + '"]') : null
    }

    function idempotencyKey(action) {
      const uuid = win.crypto && typeof win.crypto.randomUUID === 'function'
        ? win.crypto.randomUUID()
        : String(Date.now()) + '-' + Math.random().toString(16).slice(2)
      return action + ':' + uuid
    }

    // One request at a time per action. A call made while one runs queues a
    // single re-run (the latest task), which reads the form again when it
    // starts. Every caller gets the result of the last run.
    function serial(name, task) {
      const lane = lanes[name] || (lanes[name] = { running: null, again: false, task: null })
      lane.task = task
      if (lane.running) {
        lane.again = true
        return lane.running
      }
      lane.running = (async function () {
        let result
        try {
          do {
            lane.again = false
            result = await lane.task()
          } while (lane.again)
        } finally {
          lane.running = null
        }
        return result
      })()
      return lane.running
    }

    function setRow(name, state, message) {
      const row = service(name)
      if (!row) return
      row.setAttribute('data-edit-calls-state', state)
      const output = row.querySelector('[data-call-settings-output="status"]')
      if (output) output.textContent = message || ''
    }

    function showError(message) {
      const error = root.querySelector('[data-calls-step-element="error"]')
      if (error) error.textContent = message
    }

    async function readFree() {
      const value = await controller.get(FREE + 'get/v3')
      if (!value || !Array.isArray(value.services) || !value.readiness) throw new Error('free-call settings read returned an invalid response')
      activeService(value, 'free-call')
      return value
    }

    async function readPaid() {
      const value = await controller.get(PAID + 'get/v3')
      if (!value || !Array.isArray(value.services) || !value.readiness) throw new Error('paid-call settings read returned an invalid response')
      activeService(value, 'paid-call')
      return value
    }

    async function load() {
      root.setAttribute('data-edit-calls-state', 'loading')
      try {
        const id = await controller.memberId()
        const results = await Promise.all([controller.post(STARTER_PATH, { member_id: id }), readFree(), readPaid()])
        const starter = results[0] || {}
        free = results[1]
        paid = results[2]
        const availability = starter.availability || {}
        const parsed = remember(availability.items)
        const freeService = activeService(free, 'free-call')
        const paidService = activeService(paid, 'paid-call')
        const state = {
          free: { enabled: Boolean(freeService), description: String(free.public_description || '') },
          paid: { enabled: Boolean(paidService), title: paidService ? String(paidService.title || '') : undefined, price: wholeDollars(paidService) },
        }
        if (parsed.hours) Object.assign(state, parsed.hours)
        if (starter.timezone) state.timezone = starter.timezone
        editor.load(state)
        const google = availability.manager === 'calendar' && Boolean(starter.nylas_grant_id)
        editor.setStatus({
          calendar: google ? 'connected' : 'disconnected',
          email: google ? String(starter.nylas_grant_email || '') : '',
          hoursSaved: Boolean(parsed.hours),
        })
        loaded = true
        root.setAttribute('data-edit-calls-state', 'ready')
        return true
      } catch (error) {
        warn('load failed', error && error.message)
        root.setAttribute('data-edit-calls-state', 'error')
        showError(COPY.loadFailed)
        return false
      }
    }

    function scheduleHours() {
      if (!loaded) return
      hoursVersion++
      if (hoursTimer !== null) win.clearTimeout(hoursTimer)
      hoursTimer = win.setTimeout(function () {
        hoursTimer = null
        saveHours()
      }, HOURS_DELAY_MS)
    }

    function cancelHoursTimer() {
      if (hoursTimer !== null) win.clearTimeout(hoursTimer)
      hoursTimer = null
    }

    // Saves the hours now (Free/Paid prerequisites, debounced autosave).
    // Resolves true when the hours on screen are saved.
    function saveHours() {
      return serial('hours', async function () {
        if (editor.validate()) return false
        const version = hoursVersion
        root.setAttribute('data-edit-calls-hours', 'saving')
        try {
          await controller.save(editor)
          root.setAttribute('data-edit-calls-hours', 'saved')
          if (version === hoursVersion) editor.setStatus({ hoursSaved: true })
          return true
        } catch (error) {
          warn('hours save failed', error && error.message)
          root.setAttribute('data-edit-calls-hours', 'error')
          showError(COPY.hoursFailed)
          return false
        }
      })
    }

    function syncFree() {
      if (!loaded) return Promise.resolve()
      return serial('free', async function () {
        const toggle = field('free', 'enabled')
        if (!toggle) return
        const want = Boolean(toggle.checked)
        try {
          free = await readFree()
          let current = activeService(free, 'free-call')
          if (!want) {
            if (!current) return setRow('free', 'saved', COPY.freeOff)
            setRow('free', 'saving')
            await controller.post(FREE + 'disable/v3', {
              config_id: current.config_id,
              expected_revision: Number(current.revision || 0),
              idempotency_key: idempotencyKey('free-call-disable'),
            })
            const canonical = await readFree()
            if (activeService(canonical, 'free-call')) throw new Error('free-call service stayed active after disable')
            free = canonical
            return setRow('free', 'saved', COPY.freeOff)
          }
          const input = field('free', 'description')
          const description = String((input && input.value) || '').trim()
          if (description.length > FREE_DESCRIPTION_MAX) return setRow('free', 'invalid', COPY.freeTooLong)
          if (!current && !freeReady(free)) {
            // The hours save also sets the platform calendar when no Google
            // calendar is connected, which is what the Free call needs.
            if (editor.validate()) return setRow('free', 'blocked', COPY.hoursFirst)
            cancelHoursTimer()
            if (!(await saveHours())) return setRow('free', 'error', COPY.freeFailed)
            free = await readFree()
            current = activeService(free, 'free-call')
            if (!current && !freeReady(free)) return setRow('free', 'blocked', COPY.freeBlocked)
          }
          if (current && freeValid(current) && String(free.public_description || '') === description) {
            return setRow('free', 'saved', COPY.saved)
          }
          setRow('free', 'saving')
          await controller.post(FREE + 'upsert/v3', {
            config_id: current ? current.config_id : null,
            description,
            expected_revision: current ? Number(current.revision || 0) : 0,
            idempotency_key: idempotencyKey('free-call-upsert'),
          })
          const canonical = await readFree()
          const saved = activeService(canonical, 'free-call')
          if (!saved || !freeValid(saved)) throw new Error('free-call settings did not match the 30-minute/$0 readback')
          if (String(canonical.public_description || '') !== description) throw new Error('free-call description did not match the readback')
          free = canonical
          setRow('free', 'saved', COPY.saved)
        } catch (error) {
          warn('free call save failed', error && error.message)
          setRow('free', 'error', COPY.freeFailed)
        }
      })
    }

    function syncPaid() {
      if (!loaded) return Promise.resolve()
      return serial('paid', async function () {
        const toggle = field('paid', 'enabled')
        if (!toggle) return
        const want = Boolean(toggle.checked)
        try {
          paid = await readPaid()
          const current = activeService(paid, 'paid-call')
          if (!want) {
            if (!current) return setRow('paid', 'saved', COPY.paidOff)
            setRow('paid', 'saving')
            await controller.post(PAID + 'disable/v3', {
              config_id: current.config_id,
              expected_revision: Number(current.revision || 0),
              idempotency_key: idempotencyKey('paid-call-disable'),
            })
            const canonical = await readPaid()
            if (activeService(canonical, 'paid-call')) throw new Error('paid-call service stayed active after disable')
            paid = canonical
            return setRow('paid', 'saved', COPY.paidOff)
          }
          const titleInput = field('paid', 'title')
          const priceInput = field('paid', 'price')
          const intent = paidIntent(titleInput && titleInput.value, priceInput && priceInput.value)
          if (intent.error) return setRow('paid', 'invalid', intent.error)
          if (!current) {
            const blocker = paidBlocker(paid)
            if (blocker) return setRow('paid', 'blocked', blocker)
          }
          if (current && current.title === intent.title && Number(current.price_cents) === intent.price_cents &&
              minutesOf(current) === intent.duration_minutes) {
            return setRow('paid', 'saved', COPY.saved)
          }
          setRow('paid', 'saving')
          await controller.post(PAID + 'upsert/v3', {
            config_id: current ? current.config_id : null,
            title: intent.title,
            price_cents: intent.price_cents,
            duration_minutes: intent.duration_minutes,
            expected_revision: current ? Number(current.revision || 0) : 0,
            idempotency_key: idempotencyKey('paid-call-upsert'),
          })
          const canonical = await readPaid()
          const saved = activeService(canonical, 'paid-call')
          if (!saved || saved.title !== intent.title || Number(saved.price_cents) !== intent.price_cents ||
              minutesOf(saved) !== intent.duration_minutes) {
            throw new Error('paid-call settings did not match the readback')
          }
          paid = canonical
          setRow('paid', 'saved', COPY.saved)
        } catch (error) {
          warn('paid call save failed', error && error.message)
          setRow('paid', 'error', COPY.paidFailed)
        }
      })
    }

    // A calendar or Stripe change can unblock a switch that is on but not saved.
    function retryBlocked() {
      if (!loaded) return
      const freeToggle = field('free', 'enabled')
      const paidToggle = field('paid', 'enabled')
      const freeActive = (function () { try { return Boolean(activeService(free, 'free-call')) } catch (_e) { return true } })()
      const paidActive = (function () { try { return Boolean(activeService(paid, 'paid-call')) } catch (_e) { return true } })()
      if (freeToggle && freeToggle.checked && !freeActive) syncFree()
      if (paidToggle && paidToggle.checked && !paidActive) syncPaid()
    }

    function scheduleText(name, sync) {
      if (!loaded) return
      if (textTimers[name] !== undefined) win.clearTimeout(textTimers[name])
      textTimers[name] = win.setTimeout(function () {
        delete textTimers[name]
        sync()
      }, TEXT_DELAY_MS)
    }

    function flushText(name, sync) {
      if (textTimers[name] !== undefined) {
        win.clearTimeout(textTimers[name])
        delete textTimers[name]
      }
      if (loaded) sync()
    }

    function rowName(target) {
      const row = target && typeof target.closest === 'function' ? target.closest('[data-call-settings-service]') : null
      return row && root.contains(row) ? row.getAttribute('data-call-settings-service') : null
    }

    function onClick(event) {
      const target = event.target
      if (!target || typeof target.closest !== 'function') return
      const disconnect = target.closest(DISCONNECT)
      if (disconnect && root.contains(disconnect)) {
        // A real link keeps its authored href; anything else goes to the dashboard.
        if (disconnect.tagName === 'A' && disconnect.getAttribute('href')) return
        event.preventDefault()
        win.location.assign(DASHBOARD_CALENDAR_URL)
        return
      }
      if (target.closest('[data-day]')) return scheduleHours()
      const action = target.closest('[data-calls-step-action]')
      if (action && HOURS_ACTIONS.indexOf(action.getAttribute('data-calls-step-action')) !== -1) scheduleHours()
    }

    function onChange(event) {
      const target = event.target
      if (!target || typeof target.getAttribute !== 'function') return
      const name = rowName(target)
      const key = target.getAttribute('data-call-settings-input')
      if (name === 'free') {
        if (key === 'enabled' || key === 'description') flushText('free', syncFree)
        return
      }
      if (name === 'paid') {
        if (key === 'enabled' || key === 'title' || key === 'price') flushText('paid', syncPaid)
        return
      }
      if (target.getAttribute('data-calls-step-input')) scheduleHours()
    }

    function onInput(event) {
      const target = event.target
      if (!target || typeof target.getAttribute !== 'function') return
      const name = rowName(target)
      const key = target.getAttribute('data-call-settings-input')
      if (name === 'free' && key === 'description') scheduleText('free', syncFree)
      if (name === 'paid' && (key === 'title' || key === 'price')) scheduleText('paid', syncPaid)
    }

    function onStripe(event) {
      const state = event && event.detail && event.detail.state
      if (!STRIPE_STATUS[state] || !editor) return
      editor.setStatus({ stripe: STRIPE_STATUS[state] })
      if (state === 'ready' || state === 'pending') retryBlocked()
    }

    async function mount() {
      controller = deps.calendar.createController(win, {
        baseItems: function () { return saved },
        onSaved: remember,
        beforeSave: cancelHoursTimer,
        onCalendarStatus: function () { retryBlocked() },
        connectSelector: CONNECT,
      })
      // This page is the Google pop-up return: the shared module finishes it.
      if (controller.setupGoogle()) return 'google-return'
      root = win.document.querySelector(ROOT)
      if (!root) return 'no-root'
      editor = deps.editorFor(root)
      if (!editor || typeof editor.load !== 'function') return 'no-editor'
      root.addEventListener('click', onClick)
      root.addEventListener('change', onChange)
      root.addEventListener('input', onInput)
      if (typeof win.document.addEventListener === 'function') win.document.addEventListener(STRIPE_EVENT, onStripe)
      if (!(await load())) return 'load-failed'
      controller.wireConnect(root, editor)
      return 'ready'
    }

    function warn() {
      if (win.console) win.console.warn.apply(win.console, ['[edit-profile-calls]'].concat(Array.prototype.slice.call(arguments)))
    }

    return { mount, load, saveHours, syncFree, syncPaid }
  }

  const exported = { bootAllowed, paidBlocker, paidIntent, createEditCalls, ROUTE }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported
    return
  }
  if (global.__startersEditProfileCallsBooted || !bootAllowed(global)) return
  global.__startersEditProfileCallsBooted = true

  function boot() {
    const calendar = global.StartersOnboardingCalendar
    const steps = global.StarterProfileCallsStep
    if (!calendar || !steps) {
      if (global.console) global.console.warn('[edit-profile-calls] load profile-calls-step.js and onboarding-calendar.js first')
      return
    }
    createEditCalls(global, { calendar, editorFor: steps.editorFor }).mount()
  }
  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', boot, { once: true })
  else boot()
})(typeof window === 'undefined' ? globalThis : window)
