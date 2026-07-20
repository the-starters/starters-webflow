;(function () {
  'use strict'

  // Writer counterpart to scheduling-availability-init.js for the renamed
  // `Starter Dashboard - Booking stage` page. Ports the legacy V2 availability
  // writer flow (form submit, manager selection, Nylas scheduler configuration
  // create/update, timezone set, OAuth grant redirect) against the same
  // Webflow `availability-step` markup, with the loader and success/error
  // steps restored. Every api:tCpV3oqd call goes through window.xanoAuthFetch;
  // write payload member ids always come from the authenticated Memberstack
  // session — never from query parameters, page markup, or cached page state.
  //
  // Deliberately NOT ported from the legacy inline writer:
  // - the hardcoded test member id and dashboard/onboarding redirects;
  // - the unscoped `starter-availability` localStorage key (replaced by the
  //   init module's member-scoped cache);
  // - the `dev-speed-test` localStorage payload override;
  // - the bookings list machinery (delegated to the page's bookings embed
  //   via guarded window.generateBookingsList / window.clearGrantData).

  const STAGING_HOST = 'the-starters-3-0.webflow.io'
  const XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
  const API_BASE = XANO_ORIGIN + '/api:tCpV3oqd'
  const STATUS_ATTRIBUTE = 'data-scheduling-availability-writer'
  const TEST_MEMBER_ATTRIBUTE = 'data-scheduling-test-member'
  // Shared with scheduling-availability-init.js so a successful write
  // refreshes what the initializer renders on the next load.
  const CACHE_PREFIX = 'starter-scheduling-availability:'
  const TIMEZONE_CACHE_PREFIX = 'starter-timezone:'
  const PAID_RATE_STORAGE_KEY = 'paid_call_rate'

  if (window.location.hostname !== STAGING_HOST) return
  if (window.__tsSchedulingAvailabilityWriter) return
  window.__tsSchedulingAvailabilityWriter = true

  let sessionMemberId = null
  let memberFields = {}
  let availability = null
  let initialState = true
  let configs = []
  let grantId = null
  let grantEmail = null
  let grantCalendarId = null
  let activeManager = null
  let timezone = null

  function qs(selector, scope) {
    return (scope || document).querySelector(selector)
  }

  function qsa(selector, scope) {
    return (scope || document).querySelectorAll(selector)
  }

  function setStatus(value) {
    document.documentElement.setAttribute(STATUS_ATTRIBUTE, value)
  }

  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail: detail }))
  }

  function memberScopeChangedError() {
    return Object.assign(new Error('Member session changed during write'), {
      code: 'MEMBER_SCOPE_CHANGED',
    })
  }

  async function currentMember() {
    const memberstack = window.$memberstackDom
    if (memberstack && typeof memberstack.getCurrentMember === 'function') {
      const result = await memberstack.getCurrentMember()
      const member = result && result.data
      if (member && member.id) return member
      throw new Error('No logged-in member')
    }
    if (window.memberReady && typeof window.memberReady.then === 'function') {
      const member = await window.memberReady
      if (member && member.id) return member
    }
    throw new Error('No logged-in member')
  }

  // Writes never trust page state for identity: re-resolve the live session
  // and refuse to send if the member changed since the writer bootstrapped.
  async function writeMemberId() {
    const member = await currentMember()
    if (!sessionMemberId || member.id !== sessionMemberId) {
      throw memberScopeChangedError()
    }
    return member.id
  }

  async function xanoPost(path, payload) {
    if (typeof window.xanoAuthFetch !== 'function') {
      throw new Error('xanoAuthFetch is not available')
    }
    const response = await window.xanoAuthFetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(function () {
      return null
    })
    if (!response.ok) {
      throw Object.assign(new Error(path + ' failed (' + response.status + ')'), {
        status: response.status,
        data: data,
      })
    }
    return data
  }

  /* ------------------------------------------------------------------ */
  /* UI helpers (legacy step semantics)                                  */
  /* ------------------------------------------------------------------ */

  function switchStep(step) {
    let stepElement = null
    qsa('[availability-step]').forEach(function (el) {
      if (el.getAttribute('availability-step') === step) {
        el.style.display = 'block'
        stepElement = el
      } else {
        el.style.display = 'none'
      }
    })
    return stepElement
  }

  // Matches the page's shared `[data-custom-loader]` contract.
  function setLoader(state, wrapper) {
    const loader = qs('[data-custom-loader]', wrapper || undefined)
    if (!loader) return
    loader.setAttribute(
      'style',
      'display: flex; visibility: ' +
        (state ? 'visible' : 'hidden') +
        '; opacity: ' +
        (state ? 1 : 0) +
        '; pointer-events: ' +
        (state ? 'auto' : 'none') +
        ';',
    )
    if (!state) {
      setTimeout(function () {
        loader.style.display = 'none'
      }, 300)
    }
  }

  function showError(group) {
    if (!group) return
    group.classList.add('is-error')
    setTimeout(function () {
      group.classList.remove('is-error')
    }, 200)
    setTimeout(function () {
      group.classList.add('is-error')
    }, 400)
    setTimeout(function () {
      group.classList.remove('is-error')
    }, 600)
  }

  function toggleManagerSubmit(state) {
    qsa('[availability-action-btn="manager-submit"]').forEach(function (btn) {
      if (state) btn.classList.remove('disabled')
      else btn.classList.add('disabled')
    })
  }

  function bookingsWrapper(state) {
    qsa('[bookings-wrapper]').forEach(function (el) {
      el.style.display = state === 'show' ? 'flex' : 'none'
    })
  }

  function changeSubmitText(text) {
    const textEl = qs(
      '[availability-step="setup-form"] [availability-action-btn="submit"] [btn-text]',
    )
    if (textEl) textEl.textContent = text
  }

  function closeConfigPopup() {
    const close = qs('[availability-popup-close]')
    if (close) close.click()
  }

  function showManagerActions() {
    const managerActions = qs('[config-manager-element]')
    if (!managerActions) return
    managerActions.style.display = 'flex'
    qsa('[change-manager-link]').forEach(function (btn) {
      btn.style.display = btn.dataset.type === availability.manager ? 'flex' : 'none'
    })
  }

  function daysAlias(days) {
    if (!days || !days.length) return { short: '', full: '' }
    const map = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const mapFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const sorted = Array.from(new Set(days)).sort(function (a, b) {
      return a - b
    })
    const ranges = []
    const rangesFull = []
    let start = sorted[0]
    let prev = sorted[0]
    for (let i = 1; i <= sorted.length; i++) {
      const curr = sorted[i]
      if (curr !== prev + 1) {
        if (start === prev) {
          ranges.push(map[start])
          rangesFull.push(mapFull[start])
        } else {
          ranges.push(map[start] + ' - ' + map[prev])
          rangesFull.push(mapFull[start] + ' - ' + mapFull[prev])
        }
        start = curr
      }
      prev = curr
    }
    return { short: ranges.join(', '), full: rangesFull.join(', ') }
  }

  /* ------------------------------------------------------------------ */
  /* Availability model                                                  */
  /* ------------------------------------------------------------------ */

  let overrides = []
  let cachedTemplate = null

  function renderAvail() {
    if (!cachedTemplate) cachedTemplate = qs('[availability-template]')
    const template = cachedTemplate
    const list = qs('[availability-list]')
    if (!template || !list) {
      console.warn('[scheduling-writer] availability template/list missing')
      return
    }

    const avails = availability.items
    list.innerHTML = ''
    overrides = []
    for (const id in avails) {
      if (!Object.prototype.hasOwnProperty.call(avails, id)) continue
      const avail = avails[id]

      if (id !== 'general') {
        avail.days.forEach(function (day) {
          if (overrides.indexOf(day) === -1) overrides.push(day)
        })
      }

      const card = template.cloneNode(true)
      card.removeAttribute('availability-template')
      card.setAttribute('availability-item', '')
      card.dataset.id = id

      const daysText = daysAlias(avail.days)
      qsa('[availability-title]', card).forEach(function (el) {
        el.textContent = id === 'general' ? 'General Availability' : daysText.full
      })
      qsa('[availability-action-btn]', card).forEach(function (el) {
        if (id === 'general' && el.getAttribute('availability-action-btn') === 'availability-remove') {
          el.remove()
        }
      })
      qsa('[availability-type]', card).forEach(function (el) {
        if (id !== 'general') el.remove()
      })
      let short = daysText.short
      if (avail.days.length === 1) short += ' only'
      qsa('[availability-days]', card).forEach(function (el) {
        el.textContent = short
      })
      qsa('[availability-time]', card).forEach(function (el) {
        el.textContent = avail.start + ' - ' + avail.end
      })
      list.appendChild(card)
    }
  }

  function getAvailArray() {
    const availabilityArray = []
    const avails = availability.items
    for (const id in avails) {
      if (!Object.prototype.hasOwnProperty.call(avails, id)) continue
      availabilityArray.push({
        days: avails[id].days,
        start: avails[id].start,
        end: avails[id].end,
      })
    }
    return availabilityArray
  }

  function writeAvailabilityCache() {
    try {
      window.localStorage.setItem(
        CACHE_PREFIX + sessionMemberId,
        JSON.stringify({ cachedAt: Date.now(), availability: availability }),
      )
    } catch (error) {
      console.warn('[scheduling-writer] cache unavailable:', error && error.message)
    }
  }

  async function updateAvail() {
    const memberId = await writeMemberId()
    const updated = await xanoPost('/starter/update_availability', {
      member_id: memberId,
      availability: availability,
    })
    if (!updated) throw new Error('starter/update_availability returned no record')
    window.STARTER_AVAILABILITY = availability
    writeAvailabilityCache()
    return updated
  }

  /* ------------------------------------------------------------------ */
  /* Timezone                                                            */
  /* ------------------------------------------------------------------ */

  async function resolveTimezone() {
    try {
      const cached = window.localStorage.getItem(TIMEZONE_CACHE_PREFIX + sessionMemberId)
      if (cached) return cached
    } catch (error) {
      /* storage unavailable */
    }

    let resolved = null
    try {
      const starter = await xanoPost('/starter/get_by_memberstack', {
        member_id: await writeMemberId(),
      })
      if (starter && typeof starter.timezone === 'string' && starter.timezone.trim() !== '') {
        resolved = starter.timezone
      }
      if (!resolved) {
        const updated = await xanoPost('/starter/set_timezone', {
          member_id: await writeMemberId(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        })
        resolved = updated && updated.timezone ? updated.timezone : null
      }
    } catch (error) {
      console.warn('[scheduling-writer] timezone resolution failed:', error && error.message)
    }

    if (resolved) {
      try {
        window.localStorage.setItem(TIMEZONE_CACHE_PREFIX + sessionMemberId, resolved)
      } catch (error) {
        /* storage unavailable */
      }
    }
    return resolved
  }

  function renderTimezone() {
    qsa('[starter-timezone]').forEach(function (el) {
      if (timezone) el.textContent = 'Your timezone is - ' + timezone
      else el.style.display = 'none'
    })
  }

  /* ------------------------------------------------------------------ */
  /* Nylas scheduler configurations                                      */
  /* ------------------------------------------------------------------ */

  async function getConfigs(id) {
    try {
      const response = await xanoPost('/nylas_configurations/get_all', { grant_id: id })
      if (!Array.isArray(response) || !response.length) return null
      return response
    } catch (error) {
      console.warn('[scheduling-writer] getConfigs failed:', error && error.message)
      return null
    }
  }

  // The paid-call rate comes from the page's `#price` input (Designer-bound,
  // like V2) with the shared localStorage key as fallback. Without a resolved
  // positive rate, no paid configuration is created — a bookable $0 "paid"
  // call is worse than the paid option being absent.
  function resolvePaidRate() {
    const form = qs('[availability-form]')
    const priceInp = form ? qs('#price', form) : null
    if (priceInp) {
      const rate = Number(priceInp.dataset.rate || priceInp.value || 0)
      if (rate > 0) return rate
    }
    try {
      const stored = Number(window.localStorage.getItem(PAID_RATE_STORAGE_KEY) || 0)
      if (stored > 0) return stored
    } catch (error) {
      /* storage unavailable */
    }
    return 0
  }

  async function createConfigPair() {
    const free = await setupConfigs('free')
    if (free === null) return null
    if (resolvePaidRate() > 0) return setupConfigs('paid')
    console.info('[scheduling-writer] no paid-call rate; skipping paid configuration')
    return free
  }

  async function setupConfigs(type, isUpdate, configId) {
    const isPaidCall = type === 'paid'
    const openHours = getAvailArray()
    const price = isPaidCall ? String(resolvePaidRate()) : '0'
    const duration = isPaidCall ? 60 : 30
    const interval = 15
    const buffer = 10

    const firstName = memberFields['free-user'] || ''
    const lastName = memberFields['last-name'] || ''
    const memberEmail = (window.MEMBER && window.MEMBER.auth && window.MEMBER.auth.email) || ''

    const tinyTitle = isPaidCall ? 'Paid Consultation Call' : 'Free Consultation Call'
    const fullTitle = isPaidCall
      ? tinyTitle + ' - ' + duration + 'min - $' + price
      : tinyTitle + ' - ' + duration + 'min'

    const requestConfig = {}
    if (isUpdate && configId) requestConfig.config_id = configId

    // Booking confirmation/reschedule/cancel links land back on this page —
    // its bookings embed owns booking_ref handling. No separate landing page.
    const redirectURL = window.location.origin + window.location.pathname

    const payload = Object.assign({}, requestConfig, {
      grant_id: grantId,
      in_config_name: fullTitle,
      in_availability: {
        duration_minutes: duration,
        interval_minutes: interval,
        availability_rules: {
          availability_method: 'collective',
          buffer: { before: buffer, after: buffer },
          default_open_hours: openHours,
        },
      },
      in_event_booking: {
        title: fullTitle,
        hide_participants: true,
        notify_participants: false,
        disable_emails: true,
        booking_type: 'organizer-confirmation',
        timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        conferencing: {
          provider: 'Google Meet',
          autocreate: { conf_grant_id: grantId },
        },
      },
      in_participants: [
        {
          name: firstName + ' ' + lastName,
          email: grantEmail,
          is_organizer: true,
          availability: { calendar_ids: [grantCalendarId] },
          booking: { calendar_id: grantCalendarId },
        },
      ],
      in_scheduler: {
        available_days_in_future: 14,
        organizer_confirmation_url: redirectURL + '?confirmation=:booking_ref',
        rescheduling_url: redirectURL + '?reschedule=:booking_ref',
        cancellation_url: redirectURL + '?cancel=:booking_ref',
        hide_rescheduling_options: true,
        hide_cancellation_options: true,
        min_booking_notice: 1440,
        additional_fields: {
          call_full_title: { type: 'metadata', label: 'Call Full Title', default: fullTitle, required: false },
          call_tiny_title: { type: 'metadata', label: 'Call Tiny Title', default: tinyTitle, required: false },
          call_type: { type: 'metadata', label: 'Call Type', default: isPaidCall ? 'paid' : 'free', required: false },
          starter_name: { type: 'metadata', label: 'Starter Name', default: firstName + ' ' + lastName, required: false },
          starter_email: { type: 'metadata', label: 'Starter Email', default: memberEmail, required: false },
          call_price: { type: 'metadata', label: 'Call Price', default: price, required: false },
          call_provider: { type: 'metadata', label: 'Call Provider', default: 'google', required: false },
          call_context: { type: 'text', label: 'Call Context', default: '', required: false },
          rescheduled_by: { type: 'text', label: 'Rescheduled By', default: '', required: false },
          rescheduled_reason: { type: 'text', label: 'Rescheduled Reason', default: '', required: true },
          unique_id: { type: 'text', label: 'Unique ID', default: '', required: false },
          from_stage: { type: 'text', label: 'Is From Stage', default: '', required: false },
        },
      },
    })

    try {
      const res = await xanoPost(
        '/scheduler/configurations/' + (isUpdate ? 'update' : 'create'),
        payload,
      )
      if (res && res.response && res.response.status === 200) return true
      switchStep('config-request-error')
      console.warn('[scheduling-writer] configuration request rejected')
      return null
    } catch (error) {
      switchStep('config-request-error')
      console.warn('[scheduling-writer] configuration request failed:', error && error.message)
      return null
    }
  }

  async function refreshConfigsSoon(delay) {
    setTimeout(async function () {
      configs = (await getConfigs(grantId)) || []
    }, delay)
  }

  async function updateConfigs(step, removeAvail) {
    const configsResponse = []
    for (const record of configs) {
      const res = await setupConfigs(record.is_paid ? 'paid' : 'free', true, record.config_id)
      configsResponse.push(res)
    }
    // Unlike the legacy inline writer, a failed update must not be replaced
    // by the success step — setupConfigs already switched to the error step.
    // Rate-gated starters may legitimately carry a single (free) config.
    if (
      configsResponse.length > 0 &&
      configsResponse.every(Boolean) &&
      !removeAvail
    ) {
      switchStep('success')
    }
    if (step) setLoader(false, step)
  }

  /* ------------------------------------------------------------------ */
  /* Virtual (platform-managed) calendar + disconnect                    */
  /* ------------------------------------------------------------------ */

  async function createVirtualCalendarFlow(memberId) {
    const result = { status: 400, grant_id: null, email: null, calendar_id: null }
    let account = null
    try {
      const accountResponse = await xanoPost('/grants/create_virtual_account', {
        member_id: memberId,
      })
      account = accountResponse && accountResponse.response && accountResponse.response.result
    } catch (error) {
      console.warn('[scheduling-writer] virtual account failed:', error && error.message)
      return result
    }
    const virtualGrantId = account && account.data && account.data.id
    if (!virtualGrantId) return result

    try {
      // V3 endpoint: keyed on memberstack_id, no Airtable row-key involved.
      const grantAdded = await xanoPost('/grants/add_virtual/v3', {
        grant_id: virtualGrantId,
        member_id: memberId,
      })
      if (!grantAdded) return result

      const calendarResponse = await xanoPost('/grants/create_virtual_calendar', {
        grant_id: virtualGrantId,
        member_id: memberId,
      })
      const calendar =
        calendarResponse && calendarResponse.response && calendarResponse.response.result
      if (!(calendar && calendar.data && calendar.data.id)) return result

      result.status = 200
      result.grant_id = virtualGrantId
      result.email = account.data.email || null
      result.calendar_id = calendar.data.id
      return result
    } catch (error) {
      console.warn('[scheduling-writer] virtual calendar failed:', error && error.message)
      return result
    }
  }

  async function clearGrant(memberId, currentGrantId) {
    if (!currentGrantId) return
    // Prefer the page's bookings-aware composite (declines pending bookings and
    // repaints booking cards) when the dashboard embed provides it.
    if (typeof window.clearGrantData === 'function') {
      await window.clearGrantData(memberId, currentGrantId)
      return
    }
    await xanoPost('/starter/clear_calendar_data', { member_id: memberId })
    const currentConfigs = (await getConfigs(currentGrantId)) || []
    for (const config of currentConfigs) {
      try {
        await xanoPost('/scheduler/configurations/delete', {
          grant_id: config.grant_id,
          configuration_id: config.config_id,
        })
      } catch (error) {
        console.warn('[scheduling-writer] config delete failed:', error && error.message)
      }
    }
    try {
      await xanoPost('/grants/delete', { in_grant_id: currentGrantId })
    } catch (error) {
      console.warn('[scheduling-writer] grant delete failed:', error && error.message)
    }
  }

  /* ------------------------------------------------------------------ */
  /* Form handling                                                       */
  /* ------------------------------------------------------------------ */

  function resetAvailForm(form, id) {
    qsa('input, textarea, select', form).forEach(function (field) {
      if (field.type === 'hidden') return
      if (field.type === 'checkbox' || field.type === 'radio') {
        field.checked = false
        field.disabled = false
        if (field.previousElementSibling) {
          field.previousElementSibling.classList.remove('w--redirected-checked')
        }
        if (field.parentElement) field.parentElement.classList.remove('overridden')
      } else {
        field.value = ''
      }
    })

    const availDays = qsa('[type=checkbox][name=avail-day]', form)
    availDays.forEach(function (day, i) {
      if (
        overrides.indexOf(i) > -1 &&
        !(availability.items[id] && availability.items[id].days.indexOf(i) > -1)
      ) {
        day.disabled = true
        if (day.parentElement) day.parentElement.classList.add('overridden')
      }
    })
  }

  function availabilityFormPopulate(form, id) {
    form.style.display = 'flex'
    const item = availability.items[id]
    if (!item) return
    const availDays = qsa('[type=checkbox][name=avail-day]', form)
    availDays.forEach(function (day, i) {
      if (item.days.indexOf(i) > -1 && day.parentElement) {
        day.parentElement.dispatchEvent(new MouseEvent('click'))
      }
    })
    const startTime = qs('[name=start-time]', form)
    if (startTime) startTime.value = item.start
    const endTime = qs('[name=end-time]', form)
    if (endTime) endTime.value = item.end
  }

  function availFormPrepare(form, id) {
    if (!id || !form) return
    if (!qs('[availability-list]')) return
    form.dataset.availabilityId = id
    resetAvailForm(form, id)
    availabilityFormPopulate(form, id)
    switchStep('setup-form')
  }

  async function availFormHandler(form) {
    if (!form) return

    const availDays = qsa('[type=checkbox][name=avail-day]', form)
    const selectedDays = []
    availDays.forEach(function (day, i) {
      if (day.checked) selectedDays.push(i)
    })
    if (selectedDays.length === 0) {
      if (availDays[0]) showError(availDays[0].closest('[set-availability-group]'))
      console.warn('[scheduling-writer] select at least one available day')
      return
    }
    const startTime = qs('[name=start-time]', form)
    if (!(startTime && startTime.value)) {
      if (startTime) showError(startTime.closest('[set-availability-group]'))
      console.warn('[scheduling-writer] start time required')
      return
    }
    const endTime = qs('[name=end-time]', form)
    if (!(endTime && endTime.value)) {
      if (endTime) showError(endTime.closest('[set-availability-group]'))
      console.warn('[scheduling-writer] end time required')
      return
    }

    const step = form.closest('[availability-step]')
    setLoader(true, step)

    try {
      const availId = form.dataset.availabilityId || 'general'
      const avail = { days: selectedDays, start: startTime.value, end: endTime.value }

      if (availId !== 'general') {
        const general = availability.items.general
        if (general) {
          general.days = general.days.filter(function (day) {
            return avail.days.indexOf(day) === -1
          })
          availability.items.general = general
        }
      } else {
        avail.defaultDays = avail.days
      }

      availability.items[availId] = avail
      await updateAvail()
      renderAvail()
      emit('starterSchedulingWriteSuccess', { action: 'availability-save' })

      if (initialState) {
        switchStep('default')
        qsa('[config-initial-element="setup-form"]').forEach(function (el) {
          el.style.display = 'none'
        })
        setLoader(false, step)
        return
      }

      if (availability.manager === null) {
        switchStep('how-to-manage')
        setLoader(false, step)
        return
      }

      if (grantId) {
        if (configs.length !== 0) {
          await updateConfigs(step)
        } else {
          await createConfigPair()
          refreshConfigsSoon(500)
          switchStep('default')
          setLoader(false, step)
        }
      } else {
        setLoader(false, step)
      }
    } catch (error) {
      setLoader(false, step)
      switchStep('config-request-error')
      console.warn('[scheduling-writer] availability save failed:', error && error.message)
      emit('starterSchedulingWriteError', {
        action: 'availability-save',
        message: (error && error.message) || 'Availability save failed',
      })
    }
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  async function handleManagerSubmit(step) {
    if (initialState) {
      initialState = false
      qsa('[config-initial-element]').forEach(function (el) {
        el.style.display = 'none'
      })
    }
    if (activeManager === availability.manager) return

    bookingsWrapper('show')
    setLoader(true, step)

    try {
      if (activeManager === 'platform') {
        switchStep('virtual-connect')
        const memberId = await writeMemberId()
        const virtual = await createVirtualCalendarFlow(memberId)
        if (virtual.status === 200) {
          grantId = virtual.grant_id
          grantEmail = virtual.email
          grantCalendarId = virtual.calendar_id

          await createConfigPair()
          refreshConfigsSoon(500)

          availability.manager = activeManager
          await updateAvail()
          try {
            window.localStorage.setItem('prev-availability-manager', activeManager)
          } catch (error) {
            /* storage unavailable */
          }
          showManagerActions()
          switchStep('success')
          emit('starterSchedulingWriteSuccess', { action: 'manager-platform' })
        } else {
          switchStep('config-request-error')
          console.warn('[scheduling-writer] virtual calendar setup failed')
        }
      } else {
        const memberId = await writeMemberId()
        await clearGrant(memberId, grantId)
        if (availability.manager !== null) {
          availability.manager = null
          await updateAvail()
        }
        switchStep('success-calendar')
        emit('starterSchedulingWriteSuccess', { action: 'manager-calendar' })
      }
    } catch (error) {
      switchStep('config-request-error')
      console.warn('[scheduling-writer] manager change failed:', error && error.message)
      emit('starterSchedulingWriteError', {
        action: 'manager-submit',
        message: (error && error.message) || 'Manager change failed',
      })
    }
    setLoader(false, step)
  }

  async function handleDisconnectCalendar(step) {
    setLoader(true, step)
    try {
      const memberId = await writeMemberId()
      await clearGrant(memberId, grantId)
      availability.manager = null

      const virtual = await createVirtualCalendarFlow(memberId)
      if (virtual.status === 200) {
        grantId = virtual.grant_id
        grantEmail = virtual.email
        grantCalendarId = virtual.calendar_id

        await createConfigPair()
        refreshConfigsSoon(500)

        availability.manager = 'platform'
        switchStep('success-disconnect')
        emit('starterSchedulingWriteSuccess', { action: 'disconnect-calendar' })
      } else {
        switchStep('config-request-error')
        console.warn('[scheduling-writer] virtual calendar setup failed')
        grantId = null
        grantEmail = null
        grantCalendarId = null
        configs = []
      }

      await updateAvail()
    } catch (error) {
      switchStep('config-request-error')
      console.warn('[scheduling-writer] disconnect failed:', error && error.message)
      emit('starterSchedulingWriteError', {
        action: 'disconnect-calendar',
        message: (error && error.message) || 'Disconnect failed',
      })
    }
    setLoader(false, step)
    showManagerActions()
  }

  function handlePreRedirect() {
    switchStep('pre-redirect')
    setTimeout(async function () {
      try {
        // The OAuth `state` round-trips to the V3 connect-success page, whose
        // grants/add/v3 callback is keyed on memberstack_id — the state IS the
        // authenticated member id, never a client-editable value.
        const memberId = await writeMemberId()
        const response = await xanoPost('/grants/oauth/v3', {
          in_state: memberId,
          in_provider: 'google',
        })
        const url =
          response &&
          response.response &&
          response.response.result &&
          response.response.result.data &&
          response.response.result.data.url
        if (!url) throw new Error('grants/oauth returned no URL')
        window.open(url, '_blank')
        switchStep('reload-page')
      } catch (error) {
        switchStep('config-request-error')
        console.warn('[scheduling-writer] OAuth redirect failed:', error && error.message)
        emit('starterSchedulingWriteError', {
          action: 'pre-redirect',
          message: (error && error.message) || 'OAuth redirect failed',
        })
      }
    }, 2500)
  }

  async function handleAvailabilityRemove(item) {
    const removed = availability.items[item.dataset.id]
    const general = availability.items.general
    if (!removed || !general) return
    removed.days.forEach(function (day) {
      if (general.defaultDays && general.defaultDays.indexOf(day) > -1) {
        general.days.push(day)
      }
    })
    availability.items.general = general
    delete availability.items[item.dataset.id]

    try {
      await updateAvail()
      renderAvail()
      emit('starterSchedulingWriteSuccess', { action: 'availability-remove' })
      if (grantId && configs.length !== 0) updateConfigs(null, true)
    } catch (error) {
      switchStep('config-request-error')
      console.warn('[scheduling-writer] availability remove failed:', error && error.message)
      emit('starterSchedulingWriteError', {
        action: 'availability-remove',
        message: (error && error.message) || 'Availability remove failed',
      })
    }
  }

  async function handleAction(btn, form) {
    const item = btn.closest('[availability-item]')
    const action = btn.getAttribute('availability-action-btn')
    const step = btn.closest('[availability-step]')

    if (action === 'submit') {
      await availFormHandler(form)
    } else if (action === 'availability-edit') {
      if (item) {
        availFormPrepare(form, item.dataset.id)
        changeSubmitText('Edit configuration')
      }
    } else if (action === 'availability-create') {
      if (initialState) {
        const backBtn = qs('[availability-step="setup-form"] [data-to]')
        if (backBtn) backBtn.style.display = 'flex'
      }
      changeSubmitText('Add configuration')
      availFormPrepare(form, crypto.randomUUID())
    } else if (action === 'availability-remove') {
      if (item) await handleAvailabilityRemove(item)
    } else if (action === 'manager-submit') {
      await handleManagerSubmit(step)
    } else if (action === 'back' || action === 'disconnect-confirm') {
      switchStep(btn.dataset.to)
    } else if (action === 'close') {
      closeConfigPopup()
    } else if (action === 'disconnect-calendar') {
      await handleDisconnectCalendar(step)
    } else if (action === 'how-to-manage') {
      switchStep('how-to-manage')
    } else if (action === 'pre-redirect') {
      handlePreRedirect()
    }
  }

  /* ------------------------------------------------------------------ */
  /* Bootstrap                                                           */
  /* ------------------------------------------------------------------ */

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

  function availabilityFromInitializer() {
    if (isAvailability(window.STARTER_AVAILABILITY)) {
      return Promise.resolve(window.STARTER_AVAILABILITY)
    }
    return new Promise(function (resolve, reject) {
      window.addEventListener(
        'starterSchedulingAvailabilityReady',
        function () {
          if (isAvailability(window.STARTER_AVAILABILITY)) resolve(window.STARTER_AVAILABILITY)
          else reject(new Error('Initializer produced no availability'))
        },
        { once: true },
      )
      window.addEventListener(
        'starterSchedulingAvailabilityError',
        function (event) {
          reject(
            new Error(
              (event && event.detail && event.detail.message) || 'Initializer failed',
            ),
          )
        },
        { once: true },
      )
    })
  }

  function testMemberOverrideActive() {
    return document.documentElement.getAttribute(TEST_MEMBER_ATTRIBUTE) === 'true'
  }

  async function initialize() {
    const form = qs('[availability-form]')
    if (!form) {
      setStatus('not-applicable')
      return null
    }
    if (typeof window.xanoAuthFetch !== 'function') {
      setStatus('missing-auth')
      console.warn('[scheduling-writer] xanoAuthFetch unavailable; writer disabled')
      return null
    }

    setStatus('loading')
    try {
      const member = await currentMember()
      sessionMemberId = member.id
      memberFields = member.customFields || {}

      availability = await availabilityFromInitializer()

      // The ?test_member_id override renders another member's availability.
      // Submitting edits would overwrite the logged-in member's data with the
      // displayed member's schedule, so the writer stays read-only.
      if (testMemberOverrideActive()) {
        setStatus('blocked-test-member')
        console.warn('[scheduling-writer] test-member override active; writes disabled')
        return null
      }

      initialState = Object.keys(availability.items).length === 0
      grantId = memberFields['nylas-grant-id'] || null
      grantEmail = memberFields['nylas-grant-email'] || null
      grantCalendarId = memberFields['nylas-calendar-id'] || null

      form.addEventListener('submit', function (e) {
        e.preventDefault()
      })

      // Populate price input from Paid Consulting Call Rate.
      const priceInp = qs('#price', form)
      if (priceInp) {
        const rate = Number(priceInp.dataset.rate || 0)
        priceInp.value = rate
        try {
          window.localStorage.setItem(PAID_RATE_STORAGE_KEY, rate)
        } catch (error) {
          /* storage unavailable */
        }
      }

      timezone = await resolveTimezone()
      renderTimezone()

      const urlParams = new URLSearchParams(window.location.search)
      let connectedCalendar = urlParams.get('calendar') || null

      // OAuth return lands directly on this page (?code&state) — no separate
      // connect-success page. grants/add/v3 exchanges the code and persists
      // the grant server-side; `state` was set by grants/oauth/v3 from the
      // caller's Bearer token and must match the logged-in member.
      const oauthCode = urlParams.get('code')
      if (oauthCode) {
        const oauthState = urlParams.get('state')
        urlParams.delete('code')
        urlParams.delete('state')
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname + '?' + urlParams.toString(),
        )
        try {
          const memberId = await writeMemberId()
          if (oauthState && oauthState !== memberId) {
            throw new Error('OAuth state does not match the logged-in member')
          }
          const grant = await xanoPost('/grants/add/v3', {
            code: oauthCode,
            member_id: memberId,
          })
          if (!(grant && grant.grant_id)) {
            throw new Error('grants/add/v3 returned no grant')
          }
          grantId = grant.grant_id
          grantEmail = grant.email || null
          grantCalendarId = grant.calendar_id || null
          connectedCalendar = connectedCalendar || 'google'
          emit('starterSchedulingWriteSuccess', { action: 'oauth-connect' })
        } catch (error) {
          console.warn('[scheduling-writer] OAuth grant save failed:', error && error.message)
          emit('starterSchedulingWriteError', {
            action: 'oauth-connect',
            message: (error && error.message) || 'OAuth grant save failed',
          })
        }
      }

      if (grantId) {
        configs = (await getConfigs(grantId)) || []
        if (!configs.length && !connectedCalendar) {
          await createConfigPair()
          refreshConfigsSoon(500)
        }
      }

      // Returning from the calendar OAuth round trip.
      if (connectedCalendar && !configs.length) {
        urlParams.delete('calendar')
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname + '?' + urlParams.toString(),
        )
        availability.manager = 'calendar'
        await updateAvail()
        await createConfigPair()
        refreshConfigsSoon(1000)
        switchStep('default')
      }

      // Initial-visibility refinements beyond the init module's state.
      if (initialState) {
        qsa('[config-initial-element]').forEach(function (el) {
          el.style.display = 'flex'
        })
        const setupStep = qs('[availability-step="setup-form"]')
        const backBtn = setupStep ? qs('[data-to]', setupStep) : null
        if (backBtn) backBtn.style.display = 'none'
        bookingsWrapper('hide')
      } else {
        if (typeof window.generateBookingsList === 'function') {
          window.generateBookingsList(sessionMemberId)
        }
        if (availability.manager === null) {
          switchStep('how-to-manage')
          bookingsWrapper('hide')
          qsa('[config-initial-element="general"]').forEach(function (el) {
            el.style.display = 'flex'
          })
        } else {
          bookingsWrapper('show')
        }
        renderAvail()
      }

      // Manager selection.
      const activeManagerEl = qs('[config-manager].is-active')
      if (activeManagerEl) {
        activeManager = activeManagerEl.dataset.type
        if (activeManager === availability.manager) toggleManagerSubmit(false)
      }
      const managers = qsa('[config-manager]')
      managers.forEach(function (manager) {
        manager.addEventListener('click', function () {
          toggleManagerSubmit(true)
          managers.forEach(function (m) {
            m.classList.remove('is-active')
          })
          manager.classList.add('is-active')
          activeManager = manager.dataset.type
          if (activeManager === availability.manager) toggleManagerSubmit(false)
        })
      })
      if (availability.manager !== null) showManagerActions()

      // Popup close.
      qsa('[availability-popup-close]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          if (btn.getAttribute('availability-popup-close') === 'pre-redirect') {
            let previousManager = null
            try {
              previousManager = window.localStorage.getItem('prev-availability-manager')
            } catch (error) {
              /* storage unavailable */
            }
            availability.manager = previousManager || null
            try {
              await updateAvail()
            } catch (error) {
              console.warn(
                '[scheduling-writer] manager restore failed:',
                error && error.message,
              )
            }
            if (availability.manager === null) {
              switchStep('how-to-manage')
              return
            }
          }
          if (initialState) return
          setTimeout(function () {
            switchStep('default')
          }, 50)
        })
      })

      // Action delegation.
      document.addEventListener('click', function (e) {
        const btn = e.target.closest && e.target.closest('[availability-action-btn]')
        if (!btn) return
        e.preventDefault()
        e.stopPropagation()
        handleAction(btn, form)
      })

      setStatus('ready')
      emit('starterSchedulingWriterReady', { memberId: sessionMemberId })
      return 'ready'
    } catch (error) {
      setStatus('error')
      console.warn('[scheduling-writer] initialization failed:', error && error.message)
      emit('starterSchedulingWriteError', {
        action: 'initialize',
        message: (error && error.message) || 'Writer initialization failed',
      })
      return null
    }
  }

  window.StarterSchedulingAvailabilityWriter = {
    initialize: initialize,
    switchStep: switchStep,
    daysAlias: daysAlias,
    getAvailArray: getAvailArray,
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true })
  } else {
    initialize()
  }
})()
