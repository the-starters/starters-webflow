/** Optional free welcome call after the paid Brand profile is saved.
 * @release v1.59.738
 */
;(function () {
  'use strict'

  const release = 'v1.59.738'
  const staging = 'the-starters-3-0.webflow.io'
  const hostname = window.location.hostname
  const path = window.location.pathname.replace(/\/$/, '')
  const isTrial = path === '/complete-profile-trial'
  if (![staging, 'thestarters.com', 'www.thestarters.com'].includes(hostname) ||
      (path !== '/complete-profile' && !isTrial) ||
      window.__startersCompleteProfileCallStepInit) return
  window.__startersCompleteProfileCallStepInit = true
  window.StartersCompleteProfileCallStep = Object.freeze({ release })

  const HANDOFF = 'starters:brand-profile-completed'
  const DASHBOARD = '/brand-dashboard'
  const STATUS_PATH = '/api:KZf7nFnk/starters_onboarding/get_brand_profile_status'
  const SETTING_UP = "We're still setting up your account. Try again in a moment."
  const SUCCESS = "We'll share your call request with Jai and reach out when it's been confirmed, typically within 24 hours"
  const BOOK = 'Book a free call'
  const PHONE_QUERY = '(max-width: 767px)'
  const STALE = 'This time is no longer available. Please choose another time.'
  const POLL_MS = 1000
  const POLL_BUDGET_MS = 10000
  const STATUS_GRACE_MS = 60000
  const CALENDAR_BUDGET_MS = 15000
  const TRIAL_NOTICE_MS = 24 * 60 * 60 * 1000
  const enforceTrialNotice = hostname === staging && isTrial
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

  function nativeAction(group, name, hook) {
    const holder = group && group.querySelector('[data-jai-trial-native-button="' + name + '"]')
    const theme = '[data-button-theme][data-button-style]'
    const wrapper = holder && (holder.matches(theme) ? holder : holder.querySelector(theme))
    const button = wrapper && wrapper.querySelector('button[type="button"]')
    if (!button) return null
    let label = wrapper.querySelector('[data-complete-profile-call-button-label]')
    if (!label && name === 'book') {
      // The native Button renders its visible label beside the actual button.
      const textNodes = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT)
      for (let text = textNodes.nextNode(); text; text = textNodes.nextNode()) {
        if (text.textContent.trim() !== BOOK) continue
        label = text
        break
      }
    }
    return { holder, wrapper, button, hook, label }
  }

  function setActionLabel(action, label) {
    if (action.label) action.label.textContent = label
    action.button.setAttribute('aria-label', label)
  }

  function setActionDisabled(action, disabled) {
    action.button.disabled = disabled
    action.button.setAttribute('aria-disabled', String(disabled))
    action.wrapper.setAttribute('data-button-theme', disabled ? 'disabled' : 'black')
  }

  function authoredStep(step) {
    const details = document.querySelector('[data-complete-profile-details]')
    const form = details && details.querySelector('form')
    const footer = step.querySelector('[data-complete-profile-call-footer]')
    const bookingActions = footer && footer.querySelector('[data-complete-profile-call-booking-actions]')
    const successActions = footer && footer.querySelector('[data-complete-profile-call-success-actions]')
    const calendar = step.querySelector('[data-complete-profile-call-calendar]')
    const loading = step.querySelector(calendarPart('loading'))
    const banner = step.querySelector('[data-complete-profile-call-status]')
    const success = step.querySelector('[data-complete-profile-call-success]')
    const unavailable = step.querySelector('[data-complete-profile-call-unavailable]')
    const heading = step.querySelector('[data-complete-profile-call-heading]')
    const doneHeading = step.querySelector('[data-complete-profile-call-heading-done]')
    const book = nativeAction(bookingActions, 'book', 'data-complete-profile-call-book')
    const skip = nativeAction(bookingActions, 'skip', 'data-complete-profile-call-continue')
    const done = nativeAction(successActions, 'done', 'data-complete-profile-call-done')
    if (!form || !calendar || !loading || !banner || !success || !unavailable ||
        !heading || !doneHeading || !book || !skip || !done) return null
    return { step, details, form, footer, bookingActions, successActions, calendar,
      loading, banner, success, unavailable, heading, doneHeading, book, skip, done }
  }

  function dateKey(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')].join('-')
  }

  function monthNav(direction) {
    return '[data-complete-profile-call-month-nav="' + direction + '"]'
  }

  function makeMonthButtons(month, picker) {
    const disabled = picker.datepicker('isDisabled')
    const directions = [
      { direction: 'previous', handler: 'prev', label: 'Previous month' },
      { direction: 'next', handler: 'next', label: 'Next month' },
    ]
    directions.forEach(function ({ direction, handler, label }) {
      const arrow = month.querySelector('.ui-datepicker-' + handler)
      if (!arrow || arrow.hasAttribute('data-complete-profile-call-month-nav')) return
      const button = document.createElement('button')
      button.type = 'button'
      button.className = arrow.className
      const inactive = disabled || !arrow.hasAttribute('data-handler')
      button.disabled = disabled
      button.setAttribute('aria-disabled', String(inactive))
      button.setAttribute('aria-label', label)
      button.setAttribute('data-complete-profile-call-month-nav', direction)

      // Datepicker attaches its own month-change handler to the old arrow
      // before onUpdateDatepicker runs. Forward activation to that handler.
      button.addEventListener('click', function () {
        if (inactive) return
        const focused = document.activeElement === button
        arrow.click()
        if (!focused) return
        const next = month.querySelector(monthNav(direction))
        const opposite = month.querySelector(monthNav(direction === 'next' ? 'previous' : 'next'))
        const focusTarget = next && next.getAttribute('aria-disabled') === 'false' ? next : opposite
        if (focusTarget && !focusTarget.disabled) focusTarget.focus({ preventScroll: true })
      })
      arrow.before(button)
      arrow.remove()
    })
  }

  function adaptDatepicker(calendar, mounted) {
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
        onUpdateDatepicker: function () { makeMonthButtons(month, picker) },
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
    if (!step) return
    const view = authoredStep(step)
    if (!view) {
      warn('Call step markup is incomplete')
      return
    }
    const form = view.form
    if (isTrial) {
      const label = form.querySelector('[data-complete-profile-call-submit-label]')
      const submit = form.querySelector('[type="submit"]')
      if (label && submit) {
        label.textContent = 'Continue'
        submit.setAttribute('aria-label', 'Continue')
      }
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
      if (!paid || !['mountPaidCalendar', 'createBookingAttempt', 'bookingRequestFingerprint', 'slotMeetsBookingNotice']
        .every(function (method) { return typeof paid[method] === 'function' }) ||
        (enforceTrialNotice && typeof paid.getPaidAvailability !== 'function')) return warn('Calendar engine is unavailable')
      if (!free || !['authenticatedRequest', 'selectBookableConfigurations', 'formatWithTimezone', 'canonicalBookingId']
        .every(function (method) { return typeof free[method] === 'function' }) ||
        !lifecycle || typeof lifecycle.runBooking !== 'function') return warn('Free booking helpers are unavailable')
      if (typeof window.xanoAuthFetch !== 'function' || typeof window.getXanoAuthToken !== 'function') return warn('Scheduling auth is unavailable')
      if (typeof MutationObserver !== 'function') return warn('Calendar control sync is unavailable')
      if (!detail.memberId || !cachedMember || cachedMember.id !== detail.memberId) return warn('Completed member is not in the member cache')
      if (!guard || typeof guard.memberRole !== 'function' || guard.memberRole(cachedMember) !== 'brand-paid') return warn('Current member is not a paid Brand')

      event.preventDefault()
      claimed = true
      Promise.resolve().then(function () {
        return showStep(view, { paid, free, lifecycle, memberId: detail.memberId })
      }).catch(dashboard)
    })
  }

  function showStep(view, { paid, free, lifecycle, memberId }) {
    const { step, details, footer, calendar, loading, banner, success, unavailable,
      heading, doneHeading, bookingActions, successActions, book, skip, done } = view
    const completedAt = Date.now()
    const host = hostname === staging
      ? { memberId: 'mem_sb_cmqhuaxn80d270sseeo74fn7i', slug: 'jp-dionisio' }
      : { memberId: step.getAttribute('data-call-host-member'), slug: step.getAttribute('data-call-host-slug') }
    let active = true
    let locked = false
    let retryPending = false
    let confirm
    let engineStatus
    let mounted
    let starter
    let config
    let mountDeadline
    let calendarObserver
    const isCurrent = function () { return active }
    const profile = bookingStatusPoll(new URL(STATUS_PATH, free.XANO_BASE).href, isCurrent, fallback)

    function finish() {
      active = false
      profile.stop()
      window.clearTimeout(mountDeadline)
      if (calendarObserver) calendarObserver.disconnect()
    }

    function go() {
      finish()
      dashboard()
    }

    function clearBanner() {
      banner.textContent = ''
      banner.removeAttribute('data-paid-calendar-status')
      hide(banner)
    }

    function revealBannerOnPhone() {
      if (!active || !window.matchMedia(PHONE_QUERY).matches) return
      // The banner sits just above the footer. Scroll the least distance that shows both.
      const message = banner.getBoundingClientRect()
      const area = footer.getBoundingClientRect()
      let action = book.button.getBoundingClientRect()
      if (!(action.bottom > action.top)) action = area
      const viewTop = window.visualViewport?.offsetTop ?? 0
      const viewBottom = viewTop + (window.visualViewport?.height ?? window.innerHeight)
      const pairTop = Math.min(message.top, area.top)
      const pairBottom = Math.max(message.bottom, area.bottom)
      let delta = 0
      if (pairBottom - pairTop <= viewBottom - viewTop) {
        if (pairTop < viewTop) delta = pairTop - viewTop
        else if (pairBottom > viewBottom) delta = pairBottom - viewBottom
      } else {
        // The pair cannot fit: keep the Book button whole, banner as close as possible.
        const low = action.bottom - viewBottom
        const high = action.top - viewTop
        delta = low > high ? high : Math.min(Math.max(pairTop - viewTop, low), high)
      }
      if (!delta) return
      window.scrollBy({
        top: delta,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      })
    }

    function fallback(reason) {
      if (!active) return
      warn(reason)
      finish()
      step.setAttribute('data-complete-profile-call-step', 'unavailable')
      hide(loading)
      hide(calendar)
      hide(book.holder)
      clearBanner()
      setActionDisabled(skip, false)
      skip.wrapper.setAttribute('data-button-style', 'primary')
      show(unavailable)
    }

    function renderSuccess(input) {
      let date = {}
      try {
        date = free.formatWithTimezone(input.start, {
          month: 'long', day: 'numeric', year: 'numeric', timeZone: input.timezone,
        }).list
      } catch (error) {
        warn('Could not format the call receipt date')
      }
      const fields = {
        'start-date': date.month ? date.month + ' ' + date.day + ', ' + date.year : '',
        'start-time': date.hour ? date.hour + ':' + date.minute + ' ' + date.dayPeriod + ' ' + date.timeZoneName : '',
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
      step.setAttribute('data-complete-profile-call-step', 'success')
      hide(calendar)
      clearBanner()
      hide(heading)
      show(doneHeading)
      hide(bookingActions)
      show(success)
      show(successActions)
      done.button.focus()
    }

    function rememberPhoneHeading() {
      if (!window.matchMedia(PHONE_QUERY).matches) return
      const greeting = step.querySelector('[data-jai-trial-greeting]')
      if (greeting) step.style.setProperty('--jai-booking-heading', greeting.getBoundingClientRect().height + 'px')
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
      setActionDisabled(book, true)
      setActionDisabled(skip, true)
      book.button.setAttribute('aria-busy', 'true')
      banner.setAttribute('data-paid-calendar-status', 'progress')
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
            if (!started && (!paid.slotMeetsBookingNotice(slot) ||
                (enforceTrialNotice && slot.start <= Date.now() + TRIAL_NOTICE_MS))) {
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
          renderSuccess(input)
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
        banner.setAttribute('data-paid-calendar-status', 'error')
        if (!error.staleSlot) confirm.textContent = 'Try again'
        throw error
      } finally {
        locked = false
        book.button.removeAttribute('aria-busy')
        setActionDisabled(skip, false)
      }
    }

    function styleChips() {
      calendar.querySelectorAll('[data-paid-calendar-slot]').forEach(function (chip) {
        chip.style.cssText = ''
      })
    }

    function syncCalendarControls() {
      if (!active) return
      styleChips()
      setActionLabel(book, book.label && confirm.textContent ? confirm.textContent : BOOK)
      setActionDisabled(book, confirm.disabled)
      const message = engineStatus.textContent.trim()
      if (!message) clearBanner()
      else if (banner.textContent !== message) {
        banner.textContent = message
        show(banner)
        const state = banner.getAttribute('data-paid-calendar-status')
        if (state === 'progress' || state === 'error') revealBannerOnPhone()
      }
    }

    function bindCalendarControls() {
      if (calendar.getAttribute('data-paid-calendar-state') === 'empty') return
      confirm = calendar.querySelector(calendarPart('confirm'))
      engineStatus = calendar.querySelector(calendarPart('status'))
      if (!confirm || !engineStatus) throw new Error('Calendar controls are missing')
      hide(confirm)
      confirm.tabIndex = -1
      hide(engineStatus)
      calendarObserver = new MutationObserver(syncCalendarControls)
      calendarObserver.observe(calendar, { childList: true, characterData: true, subtree: true })
      calendarObserver.observe(confirm, { attributes: true, attributeFilter: ['disabled'] })
      syncCalendarControls()
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
      let slots
      if (enforceTrialNotice) {
        const available = await paid.getPaidAvailability(calendarConfig)
        if (!active) return
        const earliest = Date.now() + TRIAL_NOTICE_MS
        slots = available.filter(function (slot) { return slot.start > earliest })
      }
      mounted = await paid.mountPaidCalendar({
        container: calendar,
        config: calendarConfig,
        slots,
        confirmText: BOOK,
        isCurrent,
        onSelectionChange: function () {
          if (confirm) confirm.textContent = BOOK
          clearBanner()
          Promise.resolve().then(styleChips)
        },
        onConfirm,
      })
      if (!active) return
      bindCalendarControls()
      const shell = calendar.querySelector(calendarPart('shell'))
      if (shell) shell.style.gap = ''
      const times = calendar.querySelector(calendarPart('times'))
      const timezone = calendar.querySelector(calendarPart('timezone-control'))
      if (times) times.style.gridTemplateColumns = ''
      if (timezone) timezone.style.cssText = ''
      const select = calendar.querySelector(calendarPart('timezone'))
      if (select) {
        select.style.cssText = ''
        if (isTrial) Array.from(select.options).forEach(function (option) {
          option.textContent = option.value.replace(/_/g, ' ').split('/').join(' / ')
        })
      }
      adaptDatepicker(calendar, mounted)
      hide(loading)
      show(calendar)
    }

    return Promise.resolve().then(function () {
      book.button.addEventListener('click', function () {
        if (!active || locked || !confirm || confirm.disabled) return
        rememberPhoneHeading()
        confirm.click()
      })
      skip.button.addEventListener('click', function () { if (!locked) go() })
      done.button.addEventListener('click', go)
      for (const action of [book, skip, done]) action.button.setAttribute(action.hook, '')
      setActionLabel(book, BOOK)
      setActionLabel(skip, 'Continue to dashboard')
      setActionLabel(done, 'Go to dashboard')
      setActionDisabled(book, true)
      setActionDisabled(skip, false)
      setActionDisabled(done, false)
      clearBanner()
      hide(calendar)
      calendar.setAttribute('data-paid-calendar-state', 'loading')
      show(loading)
      hide(details)
      hide(document.querySelector('[data-complete-profile-back]'))
      show(step)
      window.scrollTo(0, 0)
      heading.setAttribute('tabindex', '-1')
      heading.focus({ preventScroll: true })
      profile.start()
      mountDeadline = window.setTimeout(function () { fallback('Calendar load timed out') }, CALENDAR_BUDGET_MS)
      return mount().finally(function () { window.clearTimeout(mountDeadline) })
    }).catch(function (error) {
      if (!active) return
      if (step.hidden || step.style.display === 'none' || !skip.button.isConnected) go()
      else fallback(error && error.message ? error.message : 'Calendar could not load')
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true })
  else init()
})()
