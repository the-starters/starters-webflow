/** Optional free welcome call after the paid Brand profile is saved.
 * @release v1.59.738
 */
;(function () {
  'use strict'

  const release = 'v1.59.738'
  const staging = 'the-starters-3-0.webflow.io'
  const hostname = window.location.hostname
  if (![staging, 'thestarters.com', 'www.thestarters.com'].includes(hostname) ||
      !(hostname === staging && /^\/complete-profile-trial\/?$/.test(window.location.pathname)) ||
      window.__startersCompleteProfileCallStepInit) return
  window.__startersCompleteProfileCallStepInit = true
  window.StartersCompleteProfileCallStep = Object.freeze({ release })

  const HANDOFF = 'starters:brand-profile-completed'
  const DASHBOARD = '/brand-dashboard'
  const STATUS_PATH = '/api:KZf7nFnk/starters_onboarding/get_brand_profile_status'
  const SETTING_UP = "We're still setting up your account. Try again in a moment."
  const SUCCESS = "We'll share your call request with Jai and reach out when it's been confirmed, typically within 24 hours"
  const UNAVAILABLE = "Jai's calendar isn't loading right now. You can still dive in. Book a free call with Jai any time from his profile."
  const BOOK = 'Book a free call'
  const STALE = 'This time is no longer available. Please choose another time.'
  const POLL_MS = 1000
  const POLL_BUDGET_MS = 10000
  const STATUS_GRACE_MS = 60000
  const TRIAL_BOOKING_NOTICE_MS = 24 * 60 * 60 * 1000
  const CALENDAR_BUDGET_MS = 15000
  const section = '[data-complete-profile-call-step]'

  function calendarPart(name) {
    return '[data-paid-calendar-element="' + name + '"]'
  }

  function diagnosticsEnabled() {
    return window.STARTERS_DEBUG === true || hostname === 'localhost' || hostname === '127.0.0.1' ||
      /(^|\.)webflow\.io$|(^|\.)trycloudflare\.com$/.test(hostname)
  }

  function warn(reason) {
    if (diagnosticsEnabled()) console.warn('[starters complete-profile-call-step] ' + reason)
  }

  function show(node) {
    if (!node) return
    node.hidden = false
    node.classList.remove('hide')
    if (node.style.display === 'none') node.style.display = ''
    node.removeAttribute('aria-hidden')
  }

  function hide(node) {
    if (!node) return
    node.hidden = true
    node.style.display = 'none'
    node.setAttribute('aria-hidden', 'true')
  }

  function dashboard() {
    window.location.assign(DASHBOARD)
  }

  async function readMember() {
    const response = await window.$memberstackDom.getCurrentMember()
    return response && response.data
  }

  function installLayout() {
    const style = document.createElement('style')
    style.id = 'starters-complete-profile-call-layout'
    style.textContent = `
${section} [data-complete-profile-call-calendar] {
  width: 100%; max-width: 51.25rem; color: #1e211e;
  font-family: Inter, sans-serif; font-size: 1rem; font-weight: 500;
}
${section} ${calendarPart('shell')} {
  display: grid; grid-template-areas: "month" "timezone" "times"; gap: 1rem;
  grid-template-columns: minmax(0, 1fr); padding: 1rem; box-sizing: border-box;
}
${section} ${calendarPart('month')} { grid-area: month; min-width: 0; }
${section} ${calendarPart('timezone-control')} { grid-area: timezone; display: block; width: 100%; min-width: 0; }
${section} ${calendarPart('timezone-caption')} { display: none; }
${section} ${calendarPart('timezone')} {
  width: 100%; min-height: 3rem; padding: 0.5rem 0.75rem; border: 0.0625rem solid #eee;
  border-radius: 0.25rem; background: white; color: inherit; font: inherit;
}
${section} ${calendarPart('times')} {
  grid-area: times; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
  align-content: start; gap: 0.5rem; max-height: 13.5rem; min-width: 0; overflow: auto;
}
${section} [data-paid-calendar-slot] {
  min-width: 0; height: 3rem; padding: 0 0.25rem; border: 0; border-radius: 0.25rem;
  background: #eee; color: #1e211e; font: inherit; line-height: 1; white-space: nowrap; cursor: pointer;
}
${section} [data-paid-calendar-slot][aria-pressed="true"] { background: #434b43; color: white; }
${section} [data-paid-calendar-slot]:disabled,
${section} ${calendarPart('confirm')}:disabled { opacity: .5; cursor: default; }
${section} [data-complete-profile-call-footer] {
  display: flex; justify-content: flex-end; align-items: center; gap: 0.5rem;
  min-height: 6.125rem; padding: 1rem 1.5rem; border-top: 0.0625rem solid #eee; box-sizing: border-box;
}
${section} ${calendarPart('status')} {
  margin: 0 1rem 1rem; padding: 0.75rem 1rem; border-radius: 0.25rem;
  background: #eee; color: #434b43; font-size: 0.875rem;
}
${section} ${calendarPart('status')}[data-paid-calendar-status="error"] {
  background: #fceae8; color: #982d26;
}
${section} ${calendarPart('status')}:empty { display: none; }
${section} [data-paid-calendar-state="loading"] ${calendarPart('month')} { opacity: .5; min-height: 15rem; background: #eee; border-radius: 0.5rem; }
${section} [data-paid-calendar-state="loading"] ${calendarPart('times')} span { height: 3rem; border-radius: 0.25rem; background: #eee; }
${section} [data-paid-calendar-element="empty-day"] {
  grid-column: 1 / -1; display: grid; gap: 0.5rem; padding: 2rem 1.5rem; border-radius: 0.25rem; background: #eee;
}
${section} [data-paid-calendar-element="empty-day"] p { margin: 0; }
${section} [data-paid-calendar-element="empty-day"] p + p { color: #434b43; font-weight: 400; }
${section} .ui-datepicker {
  overflow: hidden; box-shadow:none; border: 0.125rem solid #eee; border-radius: 0.5rem; background: #eee;
}
${section} .ui-datepicker-header {
  position: relative; display: grid; place-items: center; height: 2.75rem;
}
${section} .ui-datepicker-prev, ${section} .ui-datepicker-next {
  position: absolute; top: 0.375rem; display: grid; place-items: center;
  width: 2rem; height: 2rem; cursor: pointer; color: inherit;
}
${section} .ui-datepicker-prev { left: 0.3125rem; }
${section} .ui-datepicker-next { right: 0.3125rem; }
${section} .ui-datepicker-header .ui-icon { position: absolute; width: 0.0625rem; height: 0.0625rem; overflow: hidden; clip-path: inset(50%); }
${section} .ui-datepicker-prev::after, ${section} .ui-datepicker-next::after {
  content: ""; width: 0.5625rem; height: 0.5625rem; border-top: 0.0625rem solid; border-right: 0.0625rem solid;
  transform: rotate(45deg);
}
${section} .ui-datepicker-prev::after { transform: rotate(-135deg); }
${section} .ui-datepicker-calendar {
  width: 100%; table-layout: fixed; border-spacing: 0; border-radius: 0.5rem; background: white;
}
${section} .ui-datepicker-calendar :is(th, td) {
  height: 3.5625rem; padding: 0; text-align: center; font-weight: inherit;
}
${section} .ui-datepicker-calendar th { border-bottom: 0.0625rem solid #eee; }
${section} .ui-datepicker-calendar td :is(a, span) {
  display: grid; height: 100%; place-items: center; border-radius: 0.25rem; color: #434b43; text-decoration: none;
}
${section} .ui-datepicker-calendar :is(.ui-state-disabled, .ui-datepicker-other-month) span,
${section} .ui-datepicker-header .ui-state-disabled { opacity: .5; }
${section} .ui-datepicker-calendar td a.ui-state-active { background: #1e211e; color: white; }
@media (min-width: 62rem) {
  ${section} ${calendarPart('shell')} {
    grid-template-columns: minmax(0, 420fr) 0.0625rem minmax(0, 399fr);
    grid-template-areas: "month divider timezone" "month divider times";
    grid-template-rows: auto 1fr; gap: 0; padding: 0;
  }
  ${section} ${calendarPart('shell')}::before { content: ""; grid-area: divider; background: #eee; }
  ${section} ${calendarPart('month')} { margin: 1.5rem; }
  ${section} ${calendarPart('timezone-control')} { width: auto; margin: 1.5rem 1.5rem 1rem; }
  ${section} ${calendarPart('times')} { max-height: 25.25rem; margin: 0 1.5rem; }
}
@media (max-width: 61.9375rem) {
  ${section} [data-complete-profile-call-footer] { flex-direction: column-reverse; padding: 1rem; }
  ${section} :is([data-complete-profile-call-continue], [data-complete-profile-call-done], ${calendarPart('confirm')}) { width: 100%; }
}
`
    document.head.appendChild(style)
  }

  function disabledConfirm(calendar) {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('data-paid-calendar-element', 'confirm')
    button.textContent = BOOK
    button.disabled = true
    const classes = (calendar.getAttribute('data-booking-confirm-class') || '').trim()
    if (classes) button.classList.add(...classes.split(/\s+/))
    return button
  }

  function showLoading(calendar) {
    const shell = document.createElement('div')
    const month = document.createElement('div')
    const caption = document.createElement('p')
    const times = document.createElement('div')
    calendar.setAttribute('data-paid-calendar-state', 'loading')
    shell.setAttribute('data-paid-calendar-element', 'shell')
    month.setAttribute('data-paid-calendar-element', 'month')
    month.setAttribute('aria-hidden', 'true')
    caption.setAttribute('data-paid-calendar-element', 'timezone-control')
    caption.setAttribute('role', 'status')
    caption.textContent = "Loading Jai's available times…"
    times.setAttribute('data-paid-calendar-element', 'times')
    times.setAttribute('aria-hidden', 'true')
    for (let index = 0; index < 12; index += 1) times.appendChild(document.createElement('span'))
    shell.append(month, caption, times)
    calendar.appendChild(shell)
  }

  function dateKey(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')].join('-')
  }

  function allowEmptyDays(calendar, mounted) {
    const month = calendar.querySelector(calendarPart('month'))
    const timezone = calendar.querySelector(calendarPart('timezone'))
    const times = calendar.querySelector(calendarPart('times'))
    const $ = window.jQuery
    if (!month || !timezone || !times || !$ || !$.fn || !$.fn.datepicker) return

    function update() {
      const picker = $(month)
      const availability = picker.datepicker('option', 'beforeShowDay')
      const selectDate = picker.datepicker('option', 'onSelect')
      if (!availability || !selectDate) return
      const format = new Intl.DateTimeFormat('en-US', {
        weekday: 'long', month: 'long', day: 'numeric',
      })
      picker.datepicker('option', {
        beforeShowDay: function (date) {
          const result = availability(date)
          return result[0] ? result : [true, '', 'No available times']
        },
        onSelect: function (value) {
          const date = picker.datepicker('getDate')
          if (date && dateKey(date) === value && !availability(date)[0]) {
            mounted.clearSelection()
            const message = document.createElement('div')
            message.setAttribute('data-paid-calendar-element', 'empty-day')
            message.setAttribute('role', 'status')
            const title = document.createElement('p')
            const hint = document.createElement('p')
            title.textContent = 'No times left on ' + format.format(date)
            hint.textContent = 'Pick another date.'
            const max = picker.datepicker('option', 'maxDate')
            const next = new Date(date)
            next.setDate(next.getDate() + 1)
            while (next <= max) {
              if (availability(next)[0]) {
                hint.textContent += " Jai's next opening is " + format.format(next) + '.'
                break
              }
              next.setDate(next.getDate() + 1)
            }
            message.append(title, hint)
            times.textContent = ''
            times.appendChild(message)
            return
          }
          selectDate(value)
        },
      })
    }

    update()
    timezone.addEventListener('change', update)
  }

  function bookingStatusPoll(statusUrl, isCurrent, onUnavailable) {
    let hasRecord = false
    let pending = false
    let stop = function () {}

    function start() {
      if (hasRecord || pending || !isCurrent()) return
      pending = true
      const controller = new AbortController()
      let tick
      const deadline = window.setTimeout(finish, POLL_BUDGET_MS)
      stop = finish

      function finish() {
        pending = false
        window.clearTimeout(tick)
        window.clearTimeout(deadline)
        controller.abort()
      }

      async function read() {
        const started = Date.now()
        try {
          // The bridge only adds auth to its scheduling allowlist. Use its
          // token getter for this one authenticated onboarding read.
          const token = await window.getXanoAuthToken()
          if (!isCurrent() || controller.signal.aborted) return
          const response = await window.xanoAuthFetch(statusUrl, {
            method: 'GET',
            headers: { Authorization: 'Bearer ' + token },
            signal: controller.signal,
          })
          if (!isCurrent() || controller.signal.aborted) return
          if (response.status === 403 || response.status === 404) {
            onUnavailable('brand status returned ' + response.status)
            return
          }
          if (response.ok) {
            const data = await response.json()
            if (!controller.signal.aborted && data && data.has_record === true) {
              hasRecord = true
              finish()
              return
            }
          }
        } catch (error) {
          if (!controller.signal.aborted) warn('Could not read Brand profile status')
        }
        if (isCurrent() && !controller.signal.aborted) {
          tick = window.setTimeout(read, Math.max(0, POLL_MS - (Date.now() - started)))
        }
      }

      void read()
    }

    return { start, ready: function () { return hasRecord }, stop: function () { stop() } }
  }

  function init() {
    const step = document.querySelector(section)
    const calendar = step && step.querySelector('[data-complete-profile-call-calendar]')
    const details = document.querySelector('[data-complete-profile-details]')
    const form = details && details.querySelector('form')
    const footer = step && step.querySelector('[data-complete-profile-call-footer]')
    const skip = footer && footer.querySelector('[data-complete-profile-call-continue]')
    if (!calendar || !form || !skip) {
      warn('Call step, calendar, profile form or Continue button is missing')
      return
    }

    let cachedMember
    let claimed = false
    readMember().then(function (member) { cachedMember = member }).catch(function () {
      warn('Could not read the current member')
    })

    form.addEventListener(HANDOFF, function (event) {
      const detail = event.detail || {}
      if (claimed || event.target !== form || detail.operation !== 'brand/account/build') return
      const paid = window.StartersPaidCallBrandPayment
      const free = window.StartersFreeCallBooking
      const lifecycle = window.StartersBookingSurfaceLifecycle
      const guard = window.StartersV3RouteGuard
      if (!paid || !['mountPaidCalendar', 'createBookingAttempt', 'bookingRequestFingerprint', 'slotMeetsBookingNotice', 'getPaidAvailability']
        .every(function (method) { return typeof paid[method] === 'function' })) return warn('Calendar engine is unavailable')
      if (!free || !['authenticatedRequest', 'selectBookableConfigurations', 'formatWithTimezone', 'canonicalBookingId']
        .every(function (method) { return typeof free[method] === 'function' }) ||
        !lifecycle || typeof lifecycle.runBooking !== 'function') return warn('Free booking helpers are unavailable')
      if (typeof window.xanoAuthFetch !== 'function' || typeof window.getXanoAuthToken !== 'function') return warn('Scheduling auth is unavailable')
      if (!detail.memberId || !cachedMember || cachedMember.id !== detail.memberId) return warn('Completed member is not in the member cache')
      if (!guard || typeof guard.memberRole !== 'function' || guard.memberRole(cachedMember) !== 'brand-paid') return warn('Current member is not a paid Brand')

      event.preventDefault()
      claimed = true
      Promise.resolve().then(function () {
        return showStep({ step, calendar, details, footer, skip, paid, free, lifecycle, memberId: detail.memberId })
      }).catch(dashboard)
    })
  }

  function showStep({ step, calendar, details, footer, skip, paid, free, lifecycle, memberId }) {
    const completedAt = Date.now()
    const host = hostname === staging
      ? { memberId: 'mem_sb_cmqhuaxn80d270sseeo74fn7i', slug: 'jp-dionisio' }
      : { memberId: step.getAttribute('data-call-host-member'), slug: step.getAttribute('data-call-host-slug') }
    const success = step.querySelector('[data-complete-profile-call-success]')
    const unavailable = step.querySelector('[data-complete-profile-call-unavailable]')
    let active = true
    let locked = false
    let retryPending = false
    let confirm
    let status
    let mounted
    let starter
    let config
    let mountDeadline
    let chipObserver
    const isCurrent = function () { return active }
    const profile = bookingStatusPoll(new URL(STATUS_PATH, free.XANO_BASE).href, isCurrent, fallback)

    function finish() {
      active = false
      profile.stop()
      window.clearTimeout(mountDeadline)
      if (chipObserver) chipObserver.disconnect()
    }

    function go() {
      finish()
      dashboard()
    }

    function fallback(reason) {
      if (!active) return
      warn(reason)
      finish()
      step.setAttribute('data-complete-profile-call-step', 'unavailable')
      hide(calendar)
      hide(confirm)
      hide(status)
      skip.disabled = false
      if (unavailable) show(unavailable)
      else {
        const message = document.createElement('p')
        message.textContent = UNAVAILABLE
        footer.before(message)
      }
    }

    function renderPlainSuccess(goToDashboard) {
      calendar.textContent = ''
      const title = document.createElement('h2')
      const text = document.createElement('p')
      const button = document.createElement('button')
      title.textContent = 'Call Requested'
      text.textContent = SUCCESS
      button.type = 'button'
      button.textContent = 'Go to dashboard'
      button.setAttribute('data-complete-profile-call-done', '')
      button.addEventListener('click', goToDashboard)
      calendar.append(title, text, button)
      show(calendar)
      button.focus()
    }

    function renderSuccess(input) {
      const done = success && success.querySelector('[data-complete-profile-call-done]')
      hide(calendar)
      hide(status)
      hide(footer)
      hide(step.querySelector('[data-complete-profile-call-heading]'))
      show(step.querySelector('[data-complete-profile-call-heading-done]'))
      if (success && done) {
        const date = free.formatWithTimezone(input.start, {
          month: 'long', day: 'numeric', year: 'numeric', timeZone: input.timezone,
        }).list
        const fields = {
          'start-date': date.month + ' ' + date.day + ', ' + date.year,
          'start-time': date.hour + ':' + date.minute + ' ' + date.dayPeriod + ' ' + date.timeZoneName,
          price: '$0',
          'paid-meeting': 'Free',
          'starter-name': 'Jai',
        }
        Object.keys(fields).forEach(function (name) {
          success.querySelectorAll('[booking-element="' + name + '"]').forEach(function (node) {
            node.textContent = fields[name]
          })
        })
        success.querySelectorAll('[booking-element="context"]').forEach(function (node) {
          hide(node.closest('[booking-element-wrap]') || node)
        })
        const text = success.querySelector('[booking-success-text]')
        if (text) text.textContent = SUCCESS
        done.addEventListener('click', go)
        show(success)
        done.focus()
      } else renderPlainSuccess(go)
    }

    function setupError() {
      profile.start()
      return Object.assign(new Error(SETTING_UP), {
        status: 422,
        data: { code: 'ERROR_CODE_INPUT_ERROR', message: SETTING_UP },
      })
    }

    async function onConfirm(slot) {
      if (!active || locked) return
      locked = true
      skip.disabled = true
      status.removeAttribute('data-paid-calendar-status')
      let submittedToLifecycle = false
      try {
        if (!profile.ready()) throw setupError()
        const member = await readMember()
        if (!active) return
        if (!member || member.id !== memberId || !member.auth || !member.auth.email) {
          fallback('Completed member is no longer available')
          return
        }
        const input = {
          starter_slug: host.slug,
          config_id: config.config_id,
          start: slot.start,
          end: slot.end,
          timezone: slot.timezone,
          topic: 'New Brand welcome call',
          context: '',
          guest_emails: [],
          brand_email: member.auth.email,
          starter_email: starter.nylas_grant_email,
        }
        const fingerprint = paid.bookingRequestFingerprint(input)
        submittedToLifecycle = true
        const result = await lifecycle.runBooking(calendar, fingerprint, function () {
          const attempt = paid.createBookingAttempt(input)
          const run = attempt.run
          let started = false
          attempt.run = async function () {
            // A replay checks the original request even if the slot has aged out.
            if (!started && (!paid.slotMeetsBookingNotice(slot) || slot.start <= Date.now() + TRIAL_BOOKING_NOTICE_MS)) {
              if (mounted && mounted.clearSelection) mounted.clearSelection()
              throw Object.assign(new Error(STALE), {
                bookingNotSubmitted: true, retrySameBooking: false, staleSlot: true,
              })
            }
            started = true
            return run()
          }
          attempt.isDefinitiveRejection = function (error, uncertain) {
            if (error.status === 400 && error.data &&
                error.data.message === 'This booking request previously failed; use a new idempotency key') return true
            return !uncertain && [400, 401, 403, 404, 422].includes(error.status)
          }
          return attempt
        }, function (result) {
          if (!free.canonicalBookingId(result)) throw new Error('The canonical booking response is incomplete')
        })
        if (active) {
          finish()
          try {
            renderSuccess(input)
          } catch (error) {
            warn('Could not paint the call card')
            hide(success)
            renderPlainSuccess(go)
          }
        }
        return result
      } catch (error) {
        if (!active) return
        if (!submittedToLifecycle && retryPending) {
          error = Object.assign(new Error('The previous request still needs to be checked'), { retrySameBooking: true })
        }
        retryPending = error.retrySameBooking === true
        if (!retryPending && error.status === 403) {
          fallback('Booking is unavailable in this environment')
          return
        }
        if (!retryPending && error.status === 404) {
          if (error.data && error.data.message === 'Bookable service was not found' &&
              (!profile.ready() || Date.now() - completedAt < STATUS_GRACE_MS)) {
            error = setupError()
          } else {
            fallback('Bookable service was not found')
            return
          }
        }
        status.setAttribute('data-paid-calendar-status', 'error')
        if (!error.staleSlot) confirm.textContent = 'Try again'
        throw error
      } finally {
        locked = false
        skip.disabled = false
      }
    }

    function moveControls() {
      if (confirm) confirm.remove()
      if (status) status.remove()
      confirm = calendar.querySelector(calendarPart('confirm'))
      status = calendar.querySelector(calendarPart('status'))
      if (!status) throw new Error('Calendar status is missing')
      status.style.color = ''
      status.style.fontSize = ''
      status.style.margin = ''
      status.setAttribute('role', 'status')
      footer.before(status)
      if (!confirm) {
        if (calendar.getAttribute('data-paid-calendar-state') !== 'empty') throw new Error('Calendar confirm is missing')
        confirm = disabledConfirm(calendar)
      }
      nativeTrialConfirm(confirm, skip)
    }

    function styleChips() {
      calendar.querySelectorAll('[data-paid-calendar-slot]').forEach(function (chip) {
        chip.style.cssText = ''
      })
    }

    async function mount() {
      if (!host.memberId || !host.slug) throw new Error('Call host is missing')
      starter = await free.authenticatedRequest(free.STARTER_PATH, 'POST', { member_id: host.memberId })
      if (!active) return
      if (!starter || !starter.nylas_grant_id) throw new Error('Call host has no connected calendar')
      const grantId = starter.nylas_grant_id
      const records = await free.authenticatedRequest(free.CONFIGS_PATH, 'POST', { grant_id: grantId })
      if (!active) return
      config = free.selectBookableConfigurations(records, hostname).find(function (record) { return record.is_paid === false })
      if (!config) throw new Error('Call host has no bookable free configuration')
      const calendarConfig = Object.assign({}, config, { grant_id: grantId, duration: 30, price_cents: 0 })
      const slots = await paid.getPaidAvailability(calendarConfig)
      if (!active) return
      const earliest = Date.now() + TRIAL_BOOKING_NOTICE_MS
      mounted = await paid.mountPaidCalendar({
        container: calendar,
        config: calendarConfig,
        slots: slots.filter(function (slot) { return slot.start > earliest }),
        confirmText: BOOK,
        isCurrent,
        onSelectionChange: function () {
          if (confirm) confirm.textContent = BOOK
          Promise.resolve().then(styleChips)
        },
        onConfirm,
      })
      if (!active) return
      moveControls()
      styleChips()
      chipObserver = new MutationObserver(styleChips)
      chipObserver.observe(calendar, { childList: true, subtree: true })
      const shell = calendar.querySelector(calendarPart('shell'))
      if (shell) shell.style.gap = ''
      const times = calendar.querySelector(calendarPart('times'))
      const timezone = calendar.querySelector(calendarPart('timezone-control'))
      if (times) times.style.gridTemplateColumns = ''
      if (timezone) timezone.style.cssText = ''
      const select = calendar.querySelector(calendarPart('timezone'))
      if (select) {
        select.style.cssText = ''
        Array.from(select.options).forEach(function (option) {
          option.textContent = option.value.replace(/_/g, ' ').split('/').join(' / ')
        })
      }
      allowEmptyDays(calendar, mounted)
    }

    return Promise.resolve().then(function () {
      skip.addEventListener('click', function () { if (!locked) go() })
      installLayout()
      hide(details)
      hide(document.querySelector('[data-complete-profile-back]'))
      show(step)
      window.scrollTo(0, 0)
      const heading = step.querySelector('[data-complete-profile-call-heading]')
      if (heading) {
        heading.setAttribute('tabindex', '-1')
        heading.focus({ preventScroll: true })
      }
      showLoading(calendar)
      confirm = disabledConfirm(calendar)
      nativeTrialConfirm(confirm, skip)
      profile.start()
      mountDeadline = window.setTimeout(function () { fallback('Calendar load timed out') }, CALENDAR_BUDGET_MS)
      return mount().finally(function () { window.clearTimeout(mountDeadline) })
    }).catch(function (error) {
      if (!active) return
      if (step.hidden || step.style.display === 'none' || !skip.isConnected) go()
      else fallback(error && error.message ? error.message : 'Calendar could not load')
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true })
  else init()
})()
