(function (global) {
  'use strict'

  const selector = (kind, value) => '[data-calls-step-' + kind + '="' + value + '"]'
  const rootSelector = '[data-calls-step="root"]'
  const standalonePath = '/build-profile-form-test'
  // Onboarding v2 (JP 2026-11-09): the calendar step on the staff-only onboarding page.
  const onboardingPaths = new Set(['/starter-onboarding-v2', '/starter-onboarding-v2-wip'])
  // Build Profile (Jai 2026-11-12: availability is set in Build Profile, not
  // onboarding; JP 1a): the calls root inside a Build Profile form step (no
  // context, or context "build-profile") asks for hours, Google and the Free
  // call. The Paid row and the Stripe card stay hidden, because Stripe is set
  // up later in onboarding.
  const buildProfilePaths = new Set(['/build-profile/full-profile-test', '/build-profile/consult-test', '/build-profile/full-profile', '/build-profile/consult'])
  const routes = new Set(['/starter-edit-profile-test', standalonePath, ...buildProfilePaths, ...onboardingPaths])

  // Staff-only on production until launch (JP 2026-11-09): a production host
  // boots only when the page also loads the fail-closed staff preview guard
  // (docs/wiring/STAFF-PREVIEW-GUARD-WIRING.md). Staging keeps its exact routes.
  function bootAllowed(global, paths) {
    const location = global.location
    if (!paths.has(location.pathname.replace(/\/$/, ''))) return false
    if (location.origin === 'https://the-starters-3-0.webflow.io') return true
    if (location.origin !== 'https://www.thestarters.com' && location.origin !== 'https://thestarters.com') return false
    const query = global.document && global.document.querySelector
    return Boolean(query && global.document.querySelector('script[src*="/v3/staff-preview-guard.js"]'))
  }

  function minutes(value) {
    const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(value)
    if (!match || +match[1] < 1 || +match[1] > 12 || +match[2] > 59) return NaN
    return (+match[1] % 12 + (match[3] === 'PM' ? 12 : 0)) * 60 + +match[2]
  }

  function validateHours(hours) {
    if (!hours.days.length || (hours.extra && !hours.extra.days.length)) return 'Pick at least one day.'
    const windows = hours.windows.map(({ start, end }) => [minutes(start), minutes(end)])
    const extra = hours.extra && [minutes(hours.extra.start), minutes(hours.extra.end)]
    if ([...windows, ...(extra ? [extra] : [])].some(([start, end]) => !(end > start))) {
      return 'A window has to end after it starts.'
    }
    windows.sort((a, b) => a[0] - b[0])
    if (windows.some(([start], index) => index > 0 && start < windows[index - 1][1])) {
      return 'These windows overlap. Adjust one so they don’t.'
    }
    return ''
  }

  function mount(root) {
    const get = (kind, value) => root.querySelector(selector(kind, value))
    const days = get('element', 'days')
    const extraDays = get('element', 'extra-days')
    const windows = get('element', 'windows')
    const extra = get('element', 'extra')
    const timezone = get('input', 'timezone')
    const clock = get('output', 'timezone-now')
    const error = get('element', 'error')
    const availability = get('element', 'availability')
    const calendar = get('element', 'calendar')
    const stripe = root.querySelector('[data-stripe-connect-element="root"]')
    const services = [...root.querySelectorAll('[data-call-settings-service]')]
    const enabledSelector = '[data-call-settings-input="enabled"]'
    const rowSelector = selector('element', 'window')
    const source = windows?.querySelector(rowSelector)
    const path = root.ownerDocument.defaultView?.location.pathname.replace(/\/$/, '')
    const context = root.getAttribute('data-calls-step-context')
    // Build Profile mode needs no marker (2026-11-12: a NEW attribute written
    // through the Webflow Data API does not reach the published page, and on
    // full-profile the root sits inside the shared Calls Form component). On a
    // Build Profile page, a root with no context (or the build-profile marker)
    // inside a multistep [data-form="step"] is the Build Profile step.
    const buildProfile = buildProfilePaths.has(path) && (context === 'build-profile' || context === null)
      && Boolean(root.closest('[data-form="step"]'))
    const step = buildProfile ? root.closest('[data-form="step"]') : root.closest('[data-form="step"][data-index="6"]')
    const edit = path === '/starter-edit-profile-test'
    const standalone = path === standalonePath
    const onboarding = onboardingPaths.has(path) && context === 'onboarding'
    if (context === 'build-profile' && (!buildProfile || !step)) return null
    if (!onboarding && !buildProfile && (edit ? context !== 'edit' : !step && !standalone)) return null
    if (!days || !extraDays || !source || !extra || !timezone || !clock || !error) return null

    const doc = root.ownerDocument
    if (standalone) {
      root.closest('form')?.addEventListener('submit', (event) => {
        event.preventDefault()
        event.stopImmediatePropagation()
      }, true)
    }
    const consult = path === '/build-profile/consult-test'
    const paid = services.find((service) => service.getAttribute('data-call-settings-service') === 'paid')
    const paidToggle = paid?.querySelector(enabledSelector)
    const price = paid?.querySelector('[data-call-settings-input="price"]')
    const paidDescription = paid?.querySelector('[data-call-settings-input="title"]')
    let continueError
    const status = { calendar: 'disconnected', email: '', stripe: 'disconnected', hoursSaved: false }
    const calendarBody = get('output', 'calendar-body')
    const calendarTitle = get('output', 'calendar-title')
    const defaultCalendarBody = calendarBody?.textContent
    const rows = () => [...windows.querySelectorAll(rowSelector)]
    const selected = (group) => [...group.querySelectorAll('[data-day][aria-pressed="true"]')].map((day) => Number(day.dataset.day))
    const value = (scope, key) => scope.querySelector(selector('input', key)).value
    const read = () => ({
      timezone: timezone.value,
      days: selected(days),
      windows: rows().map((row) => ({ start: value(row, 'window-start'), end: value(row, 'window-end') })),
      extra: extra.hidden ? null : {
        days: selected(extraDays),
        start: value(extra, 'extra-start'),
        end: value(extra, 'extra-end'),
      },
    })

    function addOption(select, value) {
      const option = doc.createElement('option')
      option.value = value
      option.textContent = value
      select.appendChild(option)
    }

    function fillTimes(select, fallback) {
      const previous = minutes(select.value) >= 0 ? select.value : fallback
      select.replaceChildren()
      for (let i = 0; i < 48; i++) {
        const hour = Math.floor(i / 2)
        addOption(select, (hour % 12 || 12) + (i % 2 ? ':30 ' : ':00 ') + (hour < 12 ? 'AM' : 'PM'))
      }
      if (previous && ![...select.options].some((option) => option.value === previous)) addOption(select, previous)
      if (previous) select.value = previous
    }

    const defaults = {
      'window-start': '9:00 AM', 'window-end': '6:00 PM',
      'extra-start': '9:00 AM', 'extra-end': '1:00 PM',
    }
    const timeFields = Object.entries(defaults).map(([key, fallback]) => [get('input', key), fallback])
    if (timeFields.some(([field]) => !field)) return null
    if (edit && paidDescription) paidDescription.maxLength = 80
    for (const [field, fallback] of timeFields) fillTimes(field, fallback)
    const template = source.cloneNode(true)
    for (const field of template.querySelectorAll('[id]')) field.removeAttribute('id')
    const endChoices = new Set([...template.querySelector(selector('input', 'window-end')).options]
      .map((option) => option.value))
    const timeChoices = [...template.querySelector(selector('input', 'window-start')).options]
      .map((option) => option.value)
      .filter((value) => endChoices.has(value))
      .sort((a, b) => minutes(a) - minutes(b))

    function addWindow() {
      const occupied = read().windows.map(({ start, end }) => [minutes(start), minutes(end)])
      const latestEnd = Math.max(...occupied.map(([, end]) => end))
      const choices = timeChoices.map((start, index) => [start, timeChoices[index + 1]])
        .filter(([start, end]) => end && occupied.every(([from, to]) =>
          minutes(end) <= from || minutes(start) >= to))
      const next = choices.find(([start]) => minutes(start) >= latestEnd) || choices[0]
      if (!next) {
        error.textContent = 'No room for another window. Adjust an existing window first.'
        return false
      }
      const row = template.cloneNode(true)
      row.querySelector(selector('input', 'window-start')).value = next[0]
      row.querySelector(selector('input', 'window-end')).value = next[1]
      windows.appendChild(row)
      return true
    }
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    const authored = timezone.value
    const zones = new Set([detected, 'UTC', ...(Intl.supportedValuesOf?.('timeZone') || [])])
    for (const zone of zones) {
      if (zone && ![...timezone.options].some((option) => option.value === zone)) addOption(timezone, zone)
    }
    timezone.value = authored && zones.has(authored) ? authored : detected

    if (!extraDays.querySelector('[data-day]')) {
      for (const day of days.querySelectorAll('[data-day]')) {
        const clone = day.cloneNode(true)
        clone.setAttribute('aria-pressed', 'false')
        extraDays.appendChild(clone)
      }
    }

    function refreshClock() {
      try {
        const now = new Intl.DateTimeFormat('en-US', { timeZone: timezone.value, hour: 'numeric', minute: '2-digit' })
        clock.textContent = 'It’s ' + now.format(new Date()) + ' there now.'
      } catch {
        clock.textContent = ''
      }
    }

    function setTag(name, label, tone) {
      const tag = get('output', name)
      if (!tag) return
      tag.textContent = label
      if (tone) tag.setAttribute('data-tone', tone)
      else tag.removeAttribute('data-tone')
    }

    function renderStatus() {
      const connected = status.calendar === 'connected'
      const connecting = status.calendar === 'connecting'
      setTag('calendar-tag', connected ? 'Connected' : connecting ? 'Connecting…' : 'Not connected', connected ? 'ok' : '')
      if (calendarTitle) {
        const account = status.email ? ' (' + status.email + ')' : ''
        calendarTitle.textContent = connected ? 'Google Calendar connected' + account : 'Connect your Google Calendar (Optional)'
      }
      if (calendarBody) calendarBody.textContent = connected
        ? 'Booked calls show up here. Brands can’t book times you’re already busy.'
        : defaultCalendarBody
      const connectingLine = get('element', 'calendar-connecting')
      const connectedActions = get('element', 'calendar-connected')
      const connect = get('action', 'connect-google')
      const connectButton = connect?.matches('button') ? connect : connect?.querySelector('button')
      if (connectingLine) connectingLine.hidden = !connecting
      if (connectedActions) connectedActions.hidden = !connected
      if (connect) connect.hidden = connected
      if (connectButton) connectButton.disabled = connecting

      const stripeLabels = { opened: 'Waiting for Stripe', pending: 'Verifying', ready: 'Connected' }
      setTag('stripe-tag', stripeLabels[status.stripe] || 'Not connected', status.stripe === 'ready' ? 'ok' : '')
      const intro = root.querySelector('[data-call-settings-service="free"]')?.querySelector(enabledSelector)
      const liveTag = get('output', 'live-tag')
      const live = Boolean(intro?.checked && status.hoursSaved && !validateHours(read()))
      if (liveTag) liveTag.hidden = !intro?.checked
      setTag('live-tag', live ? 'Live' : 'Not live yet', live ? 'ok' : 'slate')
    }

    function refresh() {
      if (continueError) continueError.textContent = ''
      let anyEnabled = false
      let paidEnabled = false
      for (const service of services) {
        // Onboarding asks for hours and calendar only: Build Profile already
        // recorded the call choices, and Stripe has its own onboarding step.
        if (onboarding || (buildProfile && service === paid)) {
          service.hidden = true
          if (buildProfile) {
            if (paidToggle) paidToggle.checked = false
            for (const field of ['input', 'select', 'textarea'].flatMap((tag) => [...service.querySelectorAll(tag)])) field.disabled = true
          }
          continue
        }
        const enabled = service.querySelector(enabledSelector)
        const panel = service.querySelector('[data-call-settings-element="panel"]')
        if (!enabled || !panel) continue
        if (consult && !buildProfile && enabled === paidToggle) {
          enabled.checked = true
          enabled.disabled = true
        }
        panel.hidden = !enabled.checked
        anyEnabled ||= enabled.checked
        if (service.getAttribute('data-call-settings-service') === 'paid') paidEnabled = enabled.checked
      }
      // Hours and calendar are required in onboarding and Build Profile, so they
      // show even when no call type is on.
      const hoursRequired = onboarding || buildProfile
      if (availability) availability.hidden = !(anyEnabled || hoursRequired)
      if (calendar) calendar.hidden = !(anyEnabled || hoursRequired)
      if (stripe) stripe.hidden = hoursRequired || !paidEnabled
      const taken = new Set(selected(days))
      for (const day of extraDays.querySelectorAll('[data-day]')) {
        day.disabled = taken.has(Number(day.dataset.day))
        if (day.disabled) day.setAttribute('aria-pressed', 'false')
      }
      rows().forEach((row, index, list) => {
        row.querySelector(selector('input', 'window-start')).setAttribute('aria-label', 'Window ' + (index + 1) + ' starts')
        row.querySelector(selector('input', 'window-end')).setAttribute('aria-label', 'Window ' + (index + 1) + ' ends')
        const remove = row.querySelector(selector('action', 'remove-window'))
        remove.hidden = false
        remove.disabled = list.length === 1
        remove.style.cursor = remove.disabled ? 'not-allowed' : ''
        remove.setAttribute('aria-label', 'Remove window ' + (index + 1))
      })
      const addExtra = get('action', 'add-extra')
      if (addExtra) addExtra.hidden = !extra.hidden
      error.textContent = validateHours(read())
      refreshClock()
      renderStatus()
    }

    function validateContinue() {
      if (onboarding || buildProfile) return validateHours(read())
      if (!services.some((service) => service.querySelector(enabledSelector)?.checked)) {
        return 'Turn on at least one call type to continue.'
      }
      if (paidToggle?.checked && (!/^\d+$/.test(price?.value.trim() || '') ||
          Number(price.value) < 1 || Number(price.value) > 1000)) {
        return 'Add a price for the consulting call.'
      }
      return validateHours(read())
    }

    if (step && !edit) {
      step.addEventListener('click', (event) => {
        if (!event.target.closest('[data-form="next-btn"]')) return
        const message = validateContinue()
        if (!message) return
        event.preventDefault()
        event.stopImmediatePropagation()
        if (!continueError) {
          continueError = doc.createElement('p')
          continueError.setAttribute('role', 'alert')
          root.appendChild(continueError)
        }
        continueError.textContent = message
      }, true)
    }

    root.addEventListener('click', (event) => {
      const day = event.target.closest('[data-day]')
      if (day && (days.contains(day) || extraDays.contains(day)) && !day.disabled) {
        day.setAttribute('aria-pressed', String(day.getAttribute('aria-pressed') !== 'true'))
      } else {
        const action = event.target.closest('[data-calls-step-action]')
        switch (action?.getAttribute('data-calls-step-action')) {
          case 'add-window':
            event.preventDefault()
            if (!addWindow()) return
            break
          case 'remove-window':
            if (rows().length > 1) action.closest(rowSelector)?.remove()
            break
          case 'add-extra': extra.hidden = false; break
          case 'remove-extra':
            extra.hidden = true
            for (const extraDay of extraDays.querySelectorAll('[data-day]')) extraDay.setAttribute('aria-pressed', 'false')
            break
          default: return
        }
      }
      event.preventDefault()
      status.hoursSaved = false
      refresh()
    })
    root.addEventListener('change', (event) => {
      if (availability?.contains(event.target)) status.hoursSaved = false
      refresh()
    })
    root.addEventListener('input', (event) => {
      if (event.target === price && continueError) continueError.textContent = ''
    })
    refresh()
    const freeToggle = services.find((service) => service.getAttribute('data-call-settings-service') === 'free')
      ?.querySelector(enabledSelector)
    return {
      read,
      validate: () => validateHours(read()),
      // The Free call follows its switch where the step shows one; onboarding
      // has no switch and always offers it.
      offerIntroCall: () => (onboarding || !freeToggle ? true : Boolean(freeToggle.checked)),
      setStatus(next) {
        Object.assign(status, next)
        renderStatus()
      },
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { validateHours, mount }
    return
  }
  if (!bootAllowed(global, routes) || global.StarterProfileCallsStep) return

  const editors = new WeakMap()
  global.StarterProfileCallsStep = {
    editorFor(root) {
      if (!editors.has(root)) editors.set(root, mount(root))
      return editors.get(root)
    },
  }

  function initialize() {
    for (const root of global.document.querySelectorAll(rootSelector)) global.StarterProfileCallsStep.editorFor(root)
  }
  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', initialize, { once: true })
  else initialize()
})(typeof window === 'undefined' ? globalThis : window)
