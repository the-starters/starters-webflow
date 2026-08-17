/**
 * V3 dashboards — canonical call sections and Brand identity hero.
 *
 * The Webflow call cards remain Designer-owned. This controller authenticates
 * through scheduling-auth.js, reads only the signed-in member's canonical V3
 * bookings, clones the authored templates, and owns loading/empty/list state.
 */
;(function (global) {
  'use strict'

  const isCommonJs =
    typeof module !== 'undefined' && typeof module.exports !== 'undefined'
  const XANO_SCHEDULING_BASE =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'
  const BOOKINGS_PATH = '/booking_record/get/v3'
  const CONFIRM_PATH = '/booking/confirm/v3'
  const MEMBERSTACK_TIMEOUT_MS = 10000
  const PROFILE_REFRESH_DELAYS_MS = [0, 150, 300, 600, 1000, 1600, 2500]
  const PROFILE_FORM_SELECTOR = 'form[data-ms-form="profile"]'
  const PAGE_SIZE = 6
  const PROJECT_PAGE_SIZE = 12
  const PROJECT_INSTANCE_KEYS = ['dash-projects', 'dash-brand-projects']
  const DASHBOARD_ROLES = {
    '/starter-dashboard': 'starter',
    '/starter-dashboard---availability-stage': 'starter',
    '/brand-dashboard': 'brand',
    '/brand-dashboard---availability-stage': 'brand',
  }

  function normalizedPath(pathname) {
    return String(pathname || '/').replace(/\/+$/, '') || '/'
  }

  function roleForPath(pathname) {
    return DASHBOARD_ROLES[normalizedPath(pathname)] || ''
  }

  function clean(value) {
    return String(value == null ? '' : value).trim()
  }

  function normalizeTimestamp(value) {
    const timestamp = Number(value)
    if (!Number.isFinite(timestamp) || timestamp === 0) return timestamp
    return Math.abs(timestamp) < 1e12 ? timestamp * 1000 : timestamp
  }

  function normalizeBooking(booking) {
    return Object.assign({}, booking, {
      start: normalizeTimestamp(booking && booking.start),
      end: normalizeTimestamp(booking && booking.end),
    })
  }

  function bookingStatus(booking, now) {
    const raw = clean(booking && booking.status).toLowerCase()
    if (raw === 'archived') return 'archived'
    if (['cancelled', 'canceled', 'declined', 'expired'].includes(raw)) {
      return 'cancelled'
    }
    if (['pending', 'requested', 'request'].includes(raw)) return 'pending'
    const end = Number(booking && booking.end)
    if (Number.isFinite(end) && end > 0 && end < (now || Date.now())) {
      return 'completed'
    }
    if (['completed', 'complete', 'done'].includes(raw)) return 'completed'
    return 'confirmed'
  }

  function uniqueBookings(bookings) {
    const seen = new Set()
    return (Array.isArray(bookings) ? bookings : [])
      .filter(function (booking) {
        const id = clean(
          booking && (booking.booking_id || booking.unique_id || booking.id),
        )
        if (!id || seen.has(id)) return false
        seen.add(id)
        return true
      })
      .sort(function (left, right) {
        return Number(right.start || 0) - Number(left.start || 0)
      })
  }

  function memberOwnsBooking(booking, memberId, role) {
    if (!booking || !memberId) return false
    const participant =
      role === 'starter' ? booking.starter_data : booking.brand_data
    return clean(participant && participant.memberstack_id) === clean(memberId)
  }

  function sectionBookings(bookings, role, section, now) {
    return uniqueBookings(bookings).filter(function (booking) {
      const status = bookingStatus(booking, now)
      if (role !== 'starter') return section === 'calls'
      if (section === 'requests') return status === 'pending'
      return section === 'calls' && status !== 'pending'
    })
  }

  function waitForMemberstack(timeoutMs) {
    if (
      global.$memberstackDom &&
      typeof global.$memberstackDom.getCurrentMember === 'function'
    ) {
      return Promise.resolve(global.$memberstackDom)
    }
    return new Promise(function (resolve) {
      const started = Date.now()
      const timer = global.setInterval(function () {
        if (
          global.$memberstackDom &&
          typeof global.$memberstackDom.getCurrentMember === 'function'
        ) {
          global.clearInterval(timer)
          resolve(global.$memberstackDom)
        } else if (Date.now() - started >= timeoutMs) {
          global.clearInterval(timer)
          resolve(null)
        }
      }, 100)
    })
  }

  function show(element, visible) {
    if (!element) return
    element.hidden = !visible
    element.style.display = visible ? '' : 'none'
  }

  function text(root, selector, value) {
    const element = root && root.querySelector(selector)
    if (element) element.textContent = clean(value)
  }

  function profileValues(form) {
    const value = function (field) {
      const input = form && form.querySelector('[data-ms-member="' + field + '"]')
      return clean(input && input.value)
    }
    return {
      firstName: value('free-user'),
      lastName: value('last-name'),
      company: value('company'),
    }
  }

  function memberMatchesProfile(member, values) {
    const fields = (member && member.customFields) || {}
    return (
      clean(fields['free-user']) === values.firstName &&
      clean(fields['last-name']) === values.lastName &&
      clean(fields.company) === values.company
    )
  }

  function formatDate(value, timezone) {
    const timestamp = Number(value)
    if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
    const options = {
      weekday: 'short',
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }
    if (timezone) options.timeZone = timezone
    try {
      return new Intl.DateTimeFormat('en-US', options).format(
        new Date(timestamp),
      )
    } catch (_error) {
      delete options.timeZone
      return new Intl.DateTimeFormat('en-US', options).format(
        new Date(timestamp),
      )
    }
  }

  function formatPrice(value, paidMeeting) {
    const amount = Number(value)
    if (!paidMeeting || !Number.isFinite(amount) || amount <= 0) return 'Free'
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(amount)
  }

  function statusLabel(status) {
    return {
      pending: 'Requested',
      confirmed: 'Confirmed',
      completed: 'Completed',
      cancelled: 'Cancelled',
      archived: 'Archived',
    }[status]
  }

  function decodeBookingRef(compactString) {
    const compact = clean(compactString)
    if (!compact || typeof global.atob !== 'function') return null
    try {
      const binary = global.atob(compact.replace(/-/g, '+').replace(/_/g, '/'))
      if (binary.length <= 32) return null
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      const uuid = function (offset) {
        const hex = Array.from(bytes.slice(offset, offset + 16))
          .map(function (value) { return value.toString(16).padStart(2, '0') })
          .join('')
        return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
      }
      const saltBytes = bytes.slice(32)
      let saltBinary = ''
      saltBytes.forEach(function (value) { saltBinary += String.fromCharCode(value) })
      return {
        config_id: uuid(0),
        booking_id: uuid(16),
        salt: global.btoa(saltBinary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      }
    } catch (_error) {
      return null
    }
  }

  function confirmPayload(booking, idempotencyKey) {
    const decoded = decodeBookingRef(booking && booking.booking_ref)
    const bookingId = clean(booking && booking.booking_id)
    const configId = clean(booking && booking.config_id)
    const key = clean(idempotencyKey)
    if (
      !decoded || !key ||
      decoded.booking_id !== bookingId ||
      decoded.config_id !== configId ||
      !decoded.salt
    ) return null
    return {
      booking_id: bookingId,
      config_id: configId,
      booking_ref_salt: decoded.salt,
      idempotency_key: key,
    }
  }

  function configureActionButtons(card, role, status) {
    card.querySelectorAll('[booking-card-action-btn], [booking-action-btn]').forEach(function (button) {
      const action = clean(
        button.getAttribute('booking-action-btn') ||
        button.getAttribute('booking-card-action-btn'),
      )
      // Accept is the first V3-native mutation. Every other legacy control
      // stays hidden until it has a current endpoint contract and tests.
      show(button, role === 'starter' && status === 'pending' && action === 'switch-confirm')
    })
  }

  function bindCard(card, booking, role) {
    const status = bookingStatus(booking)
    const other = role === 'starter' ? booking.brand_data : booking.starter_data
    const own = role === 'starter' ? booking.starter_data : booking.brand_data
    card.removeAttribute('bookings-item-template')
    card.setAttribute('data-booking-id', clean(booking.booking_id || booking.id))
    card.setAttribute('data-booking-status', status)
    text(card, '[booking-element="status"] [label-text]', statusLabel(status))
    text(card, '[booking-element="brand-name"]', other && other.name)
    text(card, '[booking-element="starter-name"]', other && other.name)
    text(card, '[booking-element="title"]', booking.call_context || 'Call')
    text(
      card,
      '[booking-element="start-date"]',
      formatDate(booking.start, (own && own.timezone) || (other && other.timezone)),
    )
    text(card, '[booking-element="duration"]', clean(booking.duration) + 'min')
    text(
      card,
      '[booking-element="price"]',
      formatPrice(booking.price, booking.paid_meeting),
    )

    const paymentWrap = card.querySelector('[payment-status-wrap]')
    const paymentText = booking.paid_meeting
      ? booking.pm_confirmed
        ? 'Payment method confirmed.'
        : 'Payment method pending.'
      : ''
    text(card, '[booking-element="payment-status-text"]', paymentText)
    show(paymentWrap, Boolean(paymentText))

    const brandStatus = card.querySelector('[brand-status]')
    text(brandStatus, '[label-text]', status === 'pending' ? 'Awaiting confirmation' : '')
    show(brandStatus, status === 'pending' && role === 'brand')

    configureActionButtons(card, role, status)

    const meetingLink = clean(booking.meeting_link)
    card
      .querySelectorAll('[booking-action-btn="join"], [booking-card-action-btn="join"]')
      .forEach(function (button) {
        const anchor = button.matches('a') ? button : button.querySelector('a')
        if (anchor && meetingLink) anchor.href = meetingLink
        show(button, Boolean(meetingLink) && status === 'confirmed')
      })
    return card
  }

  function collectSection(section) {
    const name = section.getAttribute('bookings-section')
    const list = section.querySelector('[bookings-list="' + name + '"]')
    const template = section.querySelector(
      '[bookings-item-template="' + name + '"]',
    )
    if (!name || !list || !template) return null
    return {
      section,
      name,
      list,
      template: template.cloneNode(true),
      loader: section.querySelector('[bookings-loader="' + name + '"]'),
      empty: section.querySelector('[bookings-empty="' + name + '"]'),
      count: section.querySelector('[bookings-count]'),
      loadMore: section.querySelector('[bookings-load-more]'),
      filters: section.querySelector('.tabs-button_component.is-dashboard'),
      rendered: 0,
      filter: 'all',
      rows: [],
    }
  }

  function clearAuthoredItems(refs) {
    refs.list
      .querySelectorAll('[bookings-item-template]')
      .forEach(function (item) {
        item.remove()
      })
    show(refs.list, false)
    show(refs.empty, false)
    show(refs.loadMore, false)
    show(refs.filters, false)
    show(refs.loader, true)
    if (refs.count) refs.count.textContent = '0'
  }

  function filteredRows(refs) {
    if (refs.filter === 'all') return refs.rows
    return refs.rows.filter(function (booking) {
      return bookingStatus(booking) === refs.filter
    })
  }

  function renderSection(refs, role, reset) {
    if (reset) {
      refs.rendered = 0
      refs.list.innerHTML = ''
    }
    const rows = filteredRows(refs)
    const target = Math.min(rows.length, refs.rendered + PAGE_SIZE)
    for (let index = refs.rendered; index < target; index += 1) {
      refs.list.appendChild(bindCard(refs.template.cloneNode(true), rows[index], role))
    }
    refs.rendered = target
    show(refs.loader, false)
    show(refs.list, rows.length > 0)
    show(refs.empty, rows.length === 0)
    show(refs.loadMore, target < rows.length)
    show(refs.filters, refs.rows.length > 0)
    if (refs.count) refs.count.textContent = String(refs.rows.length)
    refs.section.setAttribute('data-bookings-state', rows.length ? 'ready' : 'empty')
  }

  function wireSection(refs, role) {
    refs.section.querySelectorAll('[booking-filter]').forEach(function (control) {
      control.addEventListener('click', function (event) {
        event.preventDefault()
        refs.filter = clean(control.getAttribute('booking-filter')).toLowerCase()
        renderSection(refs, role, true)
      })
    })
    if (refs.loadMore) {
      refs.loadMore.addEventListener('click', function (event) {
        event.preventDefault()
        renderSection(refs, role, false)
      })
    }
  }

  function hideAuthoredDuplicates() {
    document.querySelectorAll('.dash-main_tile-item').forEach(function (tile) {
      if (tile.hasAttribute('bookings-section')) return
      const heading = tile.querySelector('h1,h2,h3,h4,h5,h6')
      const label = clean(heading && heading.textContent).toLowerCase()
      if (label === 'calls' || label === 'call requests') show(tile, false)
    })
  }

  function projectFilterIsActive(params) {
    const status = clean(params && params.status).toLowerCase()
    return Boolean(status && status !== '*')
  }

  function projectTotal(state) {
    const value = state && state.data && state.data.total
    if (value == null || clean(value) === '') return Number.NaN
    const total = Number(value)
    return Number.isFinite(total) && total >= 0 ? total : Number.NaN
  }

  function projectFilterVisible(state, memory) {
    const snapshot = state || {}
    const query = snapshot.query || {}
    const activeFilter = projectFilterIsActive(query.params)
    const total = projectTotal(snapshot)
    const resolved = snapshot.status === 'success' && Number.isFinite(total)

    if (memory.authTransition) {
      if (!resolved) return false
      memory.authTransition = false
    }

    if (resolved) {
      if (total > 0) {
        memory.known = true
        memory.hasAny = true
      } else if (!activeFilter) {
        memory.known = true
        memory.hasAny = false
      }
    }

    if (activeFilter) memory.navigationVisible = true

    // Once an unfiltered result proves projects exist, keep the controls
    // available throughout later loading/error transitions so the member can
    // switch away from the current filter. Before that proof exists, an active
    // filter is itself enough reason to keep its navigation visible. Do not
    // probe All behind the member's back: rendering that replacement list can
    // strand a selected empty filter on its loading state before it is restored.
    return memory.known
      ? memory.hasAny
      : Boolean(activeFilter || memory.navigationVisible)
  }

  function findProjectLoadMore(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return []
    const canonical = Array.prototype.slice.call(
      root.querySelectorAll('[wf-xano-element="load-more"]'),
    )
    if (canonical.length) return canonical
    return Array.prototype.slice
      .call(root.querySelectorAll('.button_main-wrap'))
      .filter(function (control) {
        if (
          typeof control.closest === 'function' &&
          control.closest('[wf-xano-item], [wf-xano-element="template"]')
        ) {
          return false
        }
        const label = control.querySelector('.button_main-text')
        return clean(label && label.textContent).toLowerCase() === 'show more'
      })
  }

  function ensureProjectLoadMore(instance) {
    if (!instance || !instance.root) return []
    const existing = findProjectLoadMore(instance.root)
    if (existing.length) return existing

    const root = instance.root
    const doc = root.ownerDocument || global.document
    if (!doc || typeof doc.querySelectorAll !== 'function') return []
    const template = Array.prototype.slice
      .call(doc.querySelectorAll('.button_main-wrap'))
      .find(function (control) {
        if (control === root || (typeof root.contains === 'function' && root.contains(control))) {
          return false
        }
        const label = control.querySelector && control.querySelector('.button_main-text')
        return clean(label && label.textContent).toLowerCase() === 'show more'
      })
    if (!template || typeof template.cloneNode !== 'function') return []

    const control = template.cloneNode(true)
    const key = root.getAttribute('wf-xano-instance')
    control.removeAttribute('bookings-load-more')
    control.removeAttribute('hidden')
    control.setAttribute('data-dashboard-project-load-more', '')
    control.setAttribute('wf-xano-element', 'load-more')
    if (key) control.setAttribute('wf-xano-instance', key)
    if (control.style) control.style.display = 'none'
    root.appendChild(control)
    return [control]
  }

  function configureProjectWrappers() {
    if (!global.document || typeof global.document.querySelectorAll !== 'function') return
    PROJECT_INSTANCE_KEYS.forEach(function (key) {
      global.document
        .querySelectorAll('[wf-xano-instance="' + key + '"][wf-xano-source]')
        .forEach(function (root) {
          root.setAttribute('wf-xano-load', 'more')
          root.setAttribute('wf-xano-per-page', String(PROJECT_PAGE_SIZE))
        })
    })
  }

  function configureProjectInstance(instance) {
    if (!instance) return false
    const state = typeof instance.getState === 'function' ? instance.getState() : null
    const configuredPerPage = Number(
      state && state.query && state.query.perPage != null
        ? state.query.perPage
        : instance.perPage,
    )
    const needsReset = Number.isFinite(configuredPerPage) && configuredPerPage !== PROJECT_PAGE_SIZE
    instance.loadMode = 'more'
    instance.appendMode = true
    instance.perPage = PROJECT_PAGE_SIZE
    if (instance.root) {
      instance.root.setAttribute('wf-xano-load', 'more')
      instance.root.setAttribute('wf-xano-per-page', String(PROJECT_PAGE_SIZE))
    }
    return needsReset
  }

  function wireProjectLoadMore(instance) {
    if (!instance || !instance.root) return
    const needsReset = configureProjectInstance(instance)
    if (needsReset && typeof instance.goToPage === 'function') instance.goToPage(1)
    const controls = ensureProjectLoadMore(instance)
    if (!controls.length) return

    controls.forEach(function (control) {
      const nativeControl = control.getAttribute('wf-xano-element') === 'load-more'
      const generatedControl = control.hasAttribute &&
        control.hasAttribute('data-dashboard-project-load-more')
      if ((!nativeControl || generatedControl) && !control.__startersProjectLoadMoreBound) {
        control.__startersProjectLoadMoreBound = true
        control.addEventListener('click', function (event) {
          if (event && typeof event.preventDefault === 'function') event.preventDefault()
          if (control.getAttribute('aria-disabled') === 'true') return
          if (typeof instance.loadNext === 'function') instance.loadNext()
        })
      }

      const repaint = function (state) {
        const data = (state && state.data) || {}
        const busy = Boolean(state && state.status === 'loading')
        const available = Boolean(data.hasMore) && !busy
        show(control, Boolean(data.hasMore) || busy)
        control.setAttribute('aria-hidden', data.hasMore || busy ? 'false' : 'true')
        control.setAttribute('aria-disabled', available ? 'false' : 'true')
        control.setAttribute('aria-busy', busy ? 'true' : 'false')
        control.setAttribute('data-opp-loading', busy ? 'true' : 'false')
        if (control.classList) control.classList.toggle('is-disabled', !available)
      }

      if (typeof instance.subscribe === 'function') instance.subscribe(repaint)
      else repaint(null)
    })
  }

  function hideProjectControls() {
    PROJECT_INSTANCE_KEYS.forEach(function (key) {
      document
        .querySelectorAll('[wf-xano-instance="' + key + '"]')
        .forEach(function (root) {
          const selector = '.tabs-button_component.is-dashboard'
          const filters =
            typeof root.matches === 'function' && root.matches(selector)
              ? root
              : root.querySelector(selector)
          show(filters, false)
          findProjectLoadMore(root).forEach(function (control) {
            show(control, false)
          })
        })
    })
  }

  function wireProjectFilters() {
    configureProjectWrappers()
    hideProjectControls()
    const queued = global.WfXano || []
    global.WfXano = queued
    if (!queued || typeof queued.push !== 'function') return
    queued.push(function (wfx) {
      PROJECT_INSTANCE_KEYS.forEach(function (key) {
        const instance = wfx && typeof wfx.get === 'function' ? wfx.get(key) : null
        if (!instance || typeof instance.subscribe !== 'function') return
        wireProjectLoadMore(instance)
        const selector = '.tabs-button_component.is-dashboard'
        const filters =
          typeof instance.qa === 'function'
            ? instance.qa(selector)
            : [instance.root && instance.root.querySelector(selector)].filter(Boolean)
        if (!filters.length) return
        const memory = {
          known: false,
          hasAny: false,
          navigationVisible: false,
          authTransition: false,
        }
        const reveal = function (visible) {
          filters.forEach(function (filter) {
            show(filter, visible)
          })
        }
        reveal(false)
        if (typeof instance.on === 'function') {
          instance.on('stateChange', function (change) {
            if (!change || change.reason !== 'auth:change') return
            memory.known = false
            memory.hasAny = false
            memory.navigationVisible = false
            memory.authTransition = true
            reveal(false)
          })
        }
        instance.subscribe(
          function (state) {
            return state
          },
          function (state) {
            reveal(projectFilterVisible(state, memory))
          },
        )
      })
    })
  }

  function heroElement(name) {
    return document.querySelector('[hero-element="' + name + '"]')
  }

  function bindBrandHero(member) {
    if (roleForPath(global.location && global.location.pathname) !== 'brand') return
    const fields = member.customFields || {}
    const firstName = heroElement('brand-first-name')
    if (firstName) firstName.textContent = clean(fields['free-user']) || 'Brand'
    const lastName = heroElement('brand-last-name')
    if (lastName) lastName.textContent = clean(fields['last-name'])
    const company = heroElement('brand-company')
    if (company) company.textContent = clean(fields.company)
  }

  function clearBrandHero(role) {
    if (role !== 'brand') return
    const firstName = heroElement('brand-first-name')
    if (firstName) firstName.textContent = ''
    const lastName = heroElement('brand-last-name')
    if (lastName) lastName.textContent = ''
    const company = heroElement('brand-company')
    if (company) company.textContent = ''
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      global.setTimeout(resolve, ms)
    })
  }

  async function repaintBrandHeroWhenSaved(memberstack, values, isCurrent) {
    for (const delayMs of PROFILE_REFRESH_DELAYS_MS) {
      if (delayMs) await wait(delayMs)
      if (!isCurrent()) return false
      try {
        const current = await memberstack.getCurrentMember()
        const member = current && (current.data || current)
        if (!isCurrent()) return false
        if (memberMatchesProfile(member, values)) {
          bindBrandHero(member)
          return true
        }
      } catch (_error) {
        // The native Memberstack form owns its success/error UI. A temporary
        // readback failure leaves the current hero intact and retries quietly.
      }
    }
    return false
  }

  function wireBrandProfileRepaint(memberstack, currentSessionGeneration) {
    if (roleForPath(global.location && global.location.pathname) !== 'brand') {
      return
    }
    document.querySelectorAll(PROFILE_FORM_SELECTOR).forEach(function (form) {
      if (form.__startersBrandProfileRepaintBound) return
      form.__startersBrandProfileRepaintBound = true
      let submissionGeneration = 0
      form.addEventListener('submit', function () {
        const expected = profileValues(form)
        if (!expected.firstName || !expected.lastName || !expected.company) {
          return
        }
        submissionGeneration += 1
        const generation = submissionGeneration
        const sessionGeneration = currentSessionGeneration()
        repaintBrandHeroWhenSaved(memberstack, expected, function () {
          return (
            generation === submissionGeneration &&
            sessionGeneration === currentSessionGeneration()
          )
        })
      })
    })
  }

  async function fetchBookings(memberId) {
    if (typeof global.xanoAuthFetch !== 'function') {
      throw new Error('Scheduling authentication bridge unavailable')
    }
    const response = await global.xanoAuthFetch(
      XANO_SCHEDULING_BASE + BOOKINGS_PATH,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberstack_id: memberId }),
      },
    )
    const body = await response.json().catch(function () {
      return null
    })
    if (!response.ok || !Array.isArray(body)) {
      throw new Error('Canonical bookings request failed')
    }
    return body.map(normalizeBooking)
  }

  function wireBookingActions(refs, role, restart) {
    if (role !== 'starter' || !global.document || !global.document.addEventListener) return
    global.document.addEventListener('click', async function (event) {
      const target = event && event.target
      const button = target && target.closest
        ? target.closest('[booking-action-btn="switch-confirm"], [booking-card-action-btn="switch-confirm"]')
        : null
      if (!button || button.__startersBookingActionBusy) return
      if (event.preventDefault) event.preventDefault()
      if (event.stopImmediatePropagation) event.stopImmediatePropagation()
      else if (event.stopPropagation) event.stopPropagation()

      const card = button.closest('[data-booking-id]')
      const bookingId = clean(card && card.getAttribute('data-booking-id'))
      let booking = null
      refs.some(function (section) {
        booking = section.rows.find(function (row) {
          return clean(row.booking_id) === bookingId
        }) || null
        return Boolean(booking)
      })
      if (!booking || bookingStatus(booking) !== 'pending') return

      if (!button.__startersBookingActionKey) {
        const randomUUID = global.crypto && global.crypto.randomUUID
        if (typeof randomUUID !== 'function') return
        button.__startersBookingActionKey = 'dashboard-confirm:' + randomUUID.call(global.crypto)
      }
      const payload = confirmPayload(booking, button.__startersBookingActionKey)
      if (!payload || typeof global.xanoAuthFetch !== 'function') return

      button.__startersBookingActionBusy = true
      button.setAttribute('aria-busy', 'true')
      button.setAttribute('aria-disabled', 'true')
      try {
        const response = await global.xanoAuthFetch(XANO_SCHEDULING_BASE + CONFIRM_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const body = await response.json().catch(function () { return null })
        if (!response.ok || !body) throw new Error('Canonical booking confirmation failed')
        button.__startersBookingActionKey = ''
        await restart()
      } catch (error) {
        console.error('[dashboard-calls] confirmation failed closed:', error && error.message)
      } finally {
        button.__startersBookingActionBusy = false
        button.setAttribute('aria-busy', 'false')
        button.setAttribute('aria-disabled', 'false')
      }
    }, true)
  }

  function resetIdentityState(refs, role) {
    clearBrandHero(role)
    refs.forEach(function (section) {
      section.rows = []
      section.rendered = 0
      section.list.innerHTML = ''
      show(section.list, false)
      show(section.empty, false)
      show(section.loadMore, false)
      show(section.filters, false)
      show(section.loader, true)
      if (section.count) section.count.textContent = '0'
      section.section.setAttribute('data-bookings-state', 'loading')
    })
    document.documentElement.setAttribute('data-dashboard-calls-v3', 'loading')
  }

  function renderFailure(refs) {
    show(refs.loader, false)
    show(refs.list, false)
    show(refs.loadMore, false)
    show(refs.filters, false)
    show(refs.empty, true)
    text(
      refs.empty,
      'h1,h2,h3,h4,h5,h6',
      refs.name === 'requests'
        ? 'Call requests are unavailable right now.'
        : 'Calls are unavailable right now.',
    )
    text(refs.empty, 'p', 'Refresh the page to try again.')
    refs.section.setAttribute('data-bookings-state', 'error')
  }

  async function refreshSession(
    memberstack,
    refs,
    role,
    generation,
    currentGeneration,
    useSharedMember,
  ) {
    try {
      let current =
        useSharedMember && global.memberReady && typeof global.memberReady.then === 'function'
          ? await global.memberReady
          : await memberstack.getCurrentMember()
      if (useSharedMember && (!current || !(current.data || current).id)) {
        current = await memberstack.getCurrentMember()
      }
      if (generation !== currentGeneration()) return
      const member = current && (current.data || current)
      const memberId = clean(member && member.id)
      if (!memberId) throw new Error('Authenticated member unavailable')
      bindBrandHero(member)
      const rows = (await fetchBookings(memberId)).filter(function (booking) {
        return memberOwnsBooking(booking, memberId, role)
      })
      if (generation !== currentGeneration()) return
      refs.forEach(function (section) {
        section.rows = sectionBookings(rows, role, section.name)
        renderSection(section, role, true)
      })
      document.documentElement.setAttribute('data-dashboard-calls-v3', 'ready')
    } catch (error) {
      if (generation !== currentGeneration()) return
      clearBrandHero(role)
      refs.forEach(renderFailure)
      document.documentElement.setAttribute('data-dashboard-calls-v3', 'error')
      console.error('[dashboard-calls] failed closed:', error && error.message)
    }
  }

  async function boot() {
    const role = roleForPath(global.location && global.location.pathname)
    if (!role) return
    if (global.__startersDashboardCallsBooted) return
    global.__startersDashboardCallsBooted = true
    wireProjectFilters()

    const refs = Array.prototype.slice
      .call(document.querySelectorAll('[bookings-section]'))
      .map(collectSection)
      .filter(Boolean)
    if (!refs.length) return
    refs.forEach(clearAuthoredItems)
    refs.forEach(function (section) {
      wireSection(section, role)
    })
    hideAuthoredDuplicates()
    resetIdentityState(refs, role)

    const memberstack = await waitForMemberstack(MEMBERSTACK_TIMEOUT_MS)
    if (!memberstack) {
      refs.forEach(renderFailure)
      document.documentElement.setAttribute('data-dashboard-calls-v3', 'error')
      console.error('[dashboard-calls] failed closed: Memberstack unavailable')
      return
    }

    let sessionGeneration = 0
    const currentGeneration = function () {
      return sessionGeneration
    }
    wireBrandProfileRepaint(memberstack, currentGeneration)
    let restartCount = 0
    const restart = function () {
      sessionGeneration += 1
      const useSharedMember = restartCount === 0
      restartCount += 1
      resetIdentityState(refs, role)
      return refreshSession(
        memberstack,
        refs,
        role,
        sessionGeneration,
        currentGeneration,
        useSharedMember,
      )
    }
    wireBookingActions(refs, role, restart)
    if (typeof memberstack.onAuthChange === 'function') {
      memberstack.onAuthChange(function () {
        restart()
      })
    }
    await restart()
  }

  const api = {
    bookingStatus,
    configureActionButtons,
    confirmPayload,
    decodeBookingRef,
    memberOwnsBooking,
    memberMatchesProfile,
    normalizeBooking,
    profileValues,
    configureProjectWrappers,
    findProjectLoadMore,
    ensureProjectLoadMore,
    projectFilterIsActive,
    projectFilterVisible,
    wireProjectLoadMore,
    roleForPath,
    sectionBookings,
    uniqueBookings,
    wireBookingActions,
  }
  if (!isCommonJs) configureProjectWrappers()
  if (isCommonJs) module.exports = api
  else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
})(typeof window === 'undefined' ? globalThis : window)
