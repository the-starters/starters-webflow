/**
 * Canonical dashboard call lifecycle actions.
 *
 * Webflow owns the base modal plus the authored decline, cancel, and reschedule
 * reason fields. This module binds those elements, creates only missing
 * supporting reschedule views, and sends environment-safe commands with
 * published V3 contracts: decline, cancel, and propose-then-confirm reschedule
 * for eligible Free calls.
 */
;(function (global) {
  'use strict'

  const isCommonJs =
    typeof module !== 'undefined' && typeof module.exports !== 'undefined'
  const XANO_SCHEDULING_BASE =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'

  const KINDS = {
    decline: {
      path: '/booking/decline/v3',
      storagePrefix: 'starters:dashboard-decline:v1:',
      attemptPrefix: 'dashboard-decline',
      reasonField: 'reason',
      reasonAttribute: 'booking-decline-reason',
      responseKey: 'decline',
      successStatus: 'declined',
      firstContent: 'decline',
      reasonContent: 'decline-reason',
      successContent: 'declined',
      failureMessage: 'Canonical booking decline failed',
    },
    cancel: {
      path: '/booking/cancel/v3',
      storagePrefix: 'starters:dashboard-cancel:v1:',
      attemptPrefix: 'dashboard-cancel',
      reasonField: 'cancelled_reason',
      reasonAttribute: 'booking-cancel-reason',
      responseKey: 'cancel',
      successStatus: 'cancelled',
      firstContent: 'cancel',
      reasonContent: 'cancel-reason',
      successContent: 'cancelled',
      failureMessage: 'Canonical booking cancel failed',
    },
    'reschedule-propose': {
      path: '/booking/reschedule/propose/v3',
      storagePrefix: 'starters:dashboard-reschedule-propose:v1:',
      attemptPrefix: 'dashboard-reschedule-propose',
      reasonField: 'rescheduled_reason',
      reasonAttribute: 'booking-reschedule-reason',
      responseKey: 'reschedule',
      successStatus: 'rescheduled',
      successContent: 'reschedule-proposed',
      failureMessage: 'Canonical reschedule proposal failed',
    },
    'reschedule-confirm': {
      path: '/booking/reschedule/confirm/v3',
      storagePrefix: 'starters:dashboard-reschedule-confirm:v1:',
      attemptPrefix: 'dashboard-reschedule-confirm',
      reasonField: null,
      responseKey: 'reschedule_confirm',
      successStatus: 'confirmed',
      successContent: 'reschedule-accepted',
      failureMessage: 'Canonical reschedule confirmation failed',
    },
    'reschedule-decline': {
      path: '/booking/reschedule/decline/v3',
      storagePrefix: 'starters:dashboard-reschedule-decline:v1:',
      attemptPrefix: 'dashboard-reschedule-decline',
      reasonField: null,
      responseKey: 'reschedule_decline',
      successStatus: 'confirmed',
      successContent: 'reschedule-declined',
      failureMessage: 'Canonical reschedule response failed',
    },
  }

  const CALENDAR_MODULE_PATH =
    'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/paid-call-brand-payment.js'

  function clean(value) {
    return String(value == null ? '' : value).trim()
  }

  function bookingStatus(booking) {
    return clean(booking && booking.status).toLowerCase()
  }

  function bookingEnvironment(booking) {
    return clean(booking && booking.data_environment).toLowerCase()
  }

  function bookingIdentified(booking) {
    return (
      clean(booking && booking.booking_id) !== '' &&
      clean(booking && booking.config_id) !== '' &&
      ['test', 'production'].includes(bookingEnvironment(booking))
    )
  }

  function actorMemberId(role, booking) {
    const source =
      role === 'starter'
        ? booking && booking.starter_data
        : role === 'brand'
          ? booking && booking.brand_data
          : null
    return clean(source && source.memberstack_id)
  }

  function freeBooking(booking) {
    const value = booking && (
      booking.is_paid != null ? booking.is_paid : booking.paid_meeting
    )
    return value === false || value === 0 || clean(value).toLowerCase() === 'false'
  }

  /**
   * Lenient paid check matching dashboard-calls' paidBooking: a missing flag
   * counts as Free. canCancel must not hide Cancel on Free rows that never
   * stamped the flag, so it gates on this instead of the strict freeBooking.
   */
  function paidFlag(booking) {
    const value = booking && (
      booking.is_paid != null ? booking.is_paid : booking.paid_meeting
    )
    return value === true || value === 1 || clean(value).toLowerCase() === 'true'
  }

  function canDecline(role, booking) {
    return (
      role === 'starter' &&
      bookingStatus(booking) === 'pending' &&
      bookingIdentified(booking)
    )
  }

  function canCancel(role, booking, now) {
    const start = Number(booking && booking.start)
    const reference = Number.isFinite(Number(now)) ? Number(now) : Date.now()
    return (
      (role === 'starter' || role === 'brand') &&
      // booking/cancel/v3 (#1545) rejects Paid bookings until the paid-cancel
      // fast follow ships; hide the button instead of offering an action the
      // server always refuses with a 400.
      !paidFlag(booking) &&
      ['confirmed', 'rescheduled'].includes(bookingStatus(booking)) &&
      actorMemberId(role, booking) !== '' &&
      Number.isFinite(start) &&
      start > reference &&
      bookingIdentified(booking)
    )
  }

  function canProposeReschedule(role, booking, now) {
    const start = Number(booking && booking.start)
    const duration = Number(booking && booking.duration)
    const reference = Number.isFinite(Number(now)) ? Number(now) : Date.now()
    return (
      (role === 'starter' || role === 'brand') &&
      freeBooking(booking) &&
      bookingStatus(booking) === 'confirmed' &&
      actorMemberId(role, booking) !== '' &&
      clean(booking && booking.grant_id) !== '' &&
      Number.isFinite(duration) &&
      duration > 0 &&
      Number.isFinite(start) &&
      start > reference &&
      bookingIdentified(booking)
    )
  }

  function canRespondReschedule(role, booking) {
    const proposer = clean(booking && booking.rescheduled_by).toLowerCase()
    return (
      (role === 'starter' || role === 'brand') &&
      freeBooking(booking) &&
      bookingStatus(booking) === 'rescheduled' &&
      ['starter', 'brand'].includes(proposer) &&
      proposer !== role &&
      actorMemberId(role, booking) !== '' &&
      bookingIdentified(booking)
    )
  }

  function canAct(kind, role, booking, now) {
    if (kind === 'decline') return canDecline(role, booking)
    if (kind === 'cancel') return canCancel(role, booking, now)
    if (kind === 'reschedule-propose') return canProposeReschedule(role, booking, now)
    if (kind === 'reschedule-confirm' || kind === 'reschedule-decline') {
      return canRespondReschedule(role, booking)
    }
    return false
  }

  async function stableScopeHash(value) {
    const input = clean(value)
    const crypto = global.crypto
    const TextEncoder = global.TextEncoder
    if (
      !input ||
      !crypto ||
      !crypto.subtle ||
      typeof crypto.subtle.digest !== 'function' ||
      typeof TextEncoder !== 'function'
    ) return ''
    try {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(input),
      )
      return Array.from(new Uint8Array(digest), function (byte) {
        return byte.toString(16).padStart(2, '0')
      }).join('')
    } catch (_error) {
      return ''
    }
  }

  async function actionStorageKey(kind, booking, reason, role) {
    const config = KINDS[kind]
    const bookingId = clean(booking && booking.booking_id)
    const actorId = actorMemberId(role, booking)
    const environment = bookingEnvironment(booking)
    const actorScope = await stableScopeHash(actorId)
    const reasonScope = await stableScopeHash(reason)
    if (
      !config ||
      !bookingId ||
      !actorScope ||
      !reasonScope ||
      !['test', 'production'].includes(environment)
    ) return ''
    return (
      config.storagePrefix +
      environment +
      ':' +
      actorScope +
      ':' +
      bookingId +
      ':' +
      reasonScope
    )
  }

  function declineStorageKey(booking, reason) {
    return actionStorageKey('decline', booking, reason, 'starter')
  }

  function cancelStorageKey(booking, reason, role) {
    return actionStorageKey('cancel', booking, reason, role)
  }

  function kindAttemptKeyPattern(kind) {
    const config = KINDS[kind]
    if (!config) return null
    return new RegExp(
      '^' +
      config.attemptPrefix +
      ':[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      'i',
    )
  }

  function validKindAttemptKey(kind, value) {
    const pattern = kindAttemptKeyPattern(kind)
    return Boolean(pattern && pattern.test(clean(value)))
  }

  function validAttemptKey(value) {
    return validKindAttemptKey('decline', value)
  }

  async function actionAttemptKey(kind, booking, reason, role) {
    const config = KINDS[kind]
    const storageKey = await actionStorageKey(kind, booking, reason, role)
    const storage = global.sessionStorage
    if (
      !config ||
      !storageKey ||
      !storage ||
      typeof storage.getItem !== 'function' ||
      typeof storage.setItem !== 'function'
    ) return ''
    try {
      const existing = clean(storage.getItem(storageKey))
      if (validKindAttemptKey(kind, existing)) return existing
      if (existing && typeof storage.removeItem === 'function') {
        storage.removeItem(storageKey)
      }
      const randomUUID = global.crypto && global.crypto.randomUUID
      if (typeof randomUUID !== 'function') return ''
      const created = config.attemptPrefix + ':' + randomUUID.call(global.crypto)
      if (!validKindAttemptKey(kind, created)) return ''
      storage.setItem(storageKey, created)
      return clean(storage.getItem(storageKey)) === created ? created : ''
    } catch (_error) {
      return ''
    }
  }

  function declineAttemptKey(booking, reason) {
    return actionAttemptKey('decline', booking, reason, 'starter')
  }

  function cancelAttemptKey(booking, reason, role) {
    return actionAttemptKey('cancel', booking, reason, role)
  }

  async function clearActionAttemptKey(kind, booking, reason, role, value) {
    const storageKey = await actionStorageKey(kind, booking, reason, role)
    const storage = global.sessionStorage
    if (
      !storageKey ||
      !storage ||
      typeof storage.getItem !== 'function' ||
      typeof storage.removeItem !== 'function'
    ) return
    try {
      if (clean(storage.getItem(storageKey)) === clean(value)) {
        storage.removeItem(storageKey)
      }
    } catch (_error) {}
  }

  function clearDeclineAttemptKey(booking, reason, value) {
    return clearActionAttemptKey('decline', booking, reason, 'starter', value)
  }

  function clearCancelAttemptKey(booking, reason, role, value) {
    return clearActionAttemptKey('cancel', booking, reason, role, value)
  }

  function actionPayload(kind, role, booking, reason, idempotencyKey, now, extra) {
    const config = KINDS[kind]
    if (!config || !canAct(kind, role, booking, now)) return null
    const payload = {
      booking_id: clean(booking && booking.booking_id),
      config_id: clean(booking && booking.config_id),
      idempotency_key: clean(idempotencyKey),
    }
    if (config.reasonField) {
      payload[config.reasonField] = clean(reason)
      if (!payload[config.reasonField]) return null
    }
    if (extra && typeof extra === 'object') {
      Object.keys(extra).forEach(function (key) {
        payload[key] = extra[key]
      })
    }
    if (!validKindAttemptKey(kind, payload.idempotency_key)) return null
    return payload
  }

  function declinePayload(booking, reason, idempotencyKey) {
    return actionPayload('decline', 'starter', booking, reason, idempotencyKey)
  }

  function cancelPayload(booking, reason, idempotencyKey, role, now) {
    return actionPayload('cancel', role, booking, reason, idempotencyKey, now)
  }

  function actionSucceeded(kind, body, bookingId) {
    const config = KINDS[kind]
    const result = config && body && body[config.responseKey]
    return Boolean(
      config &&
      result &&
      clean(result.booking_id) === clean(bookingId) &&
      clean(bookingId) !== '' &&
      clean(result.status).toLowerCase() === config.successStatus
    )
  }

  function declineSucceeded(body, bookingId) {
    return actionSucceeded('decline', body, bookingId)
  }

  function cancelSucceeded(body, bookingId) {
    return actionSucceeded('cancel', body, bookingId)
  }

  async function submitAction(kind, role, booking, reason, now, extra, scope) {
    const config = KINDS[kind]
    if (
      !config ||
      !canAct(kind, role, booking, now) ||
      typeof global.xanoAuthFetch !== 'function'
    ) return null
    const attemptScope = clean(scope) || clean(reason)
    const attemptKey = await actionAttemptKey(kind, booking, attemptScope, role)
    const payload = actionPayload(kind, role, booking, reason, attemptKey, now, extra)
    if (!payload) return null
    const response = await global.xanoAuthFetch(
      XANO_SCHEDULING_BASE + config.path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
    const body = await response.json().catch(function () {
      return null
    })
    if (!response.ok || !actionSucceeded(kind, body, payload.booking_id)) {
      // Prefer the server's own message (for example the paid-cancel gate in
      // booking/cancel/v3) so the modal can explain the refusal to the user.
      const serverMessage = clean(body && (body.message || body.error))
      throw new Error(serverMessage || config.failureMessage)
    }
    await clearActionAttemptKey(kind, booking, attemptScope, role, attemptKey)
    return body
  }

  function proposeReschedule(booking, role, reason, slot, now) {
    const start = Number(slot && slot.start)
    const end = Number(slot && slot.end)
    const timezone = clean(slot && slot.timezone)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return Promise.resolve(null)
    }
    const proposedSlot = { new_start: start, new_end: end }
    if (timezone) proposedSlot.timezone = timezone
    return submitAction(
      'reschedule-propose',
      role,
      booking,
      reason,
      now,
      proposedSlot,
      clean(reason) + '|' + String(start) + '|' + timezone,
    )
  }

  function respondReschedule(kind, booking, role) {
    if (kind !== 'reschedule-confirm' && kind !== 'reschedule-decline') {
      return Promise.resolve(null)
    }
    return submitAction(kind, role, booking, '', undefined, null, 'respond')
  }

  function declineBooking(booking, reason) {
    return submitAction('decline', 'starter', booking, reason)
  }

  function cancelBooking(booking, reason, role, now) {
    return submitAction('cancel', role, booking, reason, now)
  }

  function counterpartName(role, booking) {
    const source =
      role === 'starter'
        ? booking && booking.brand_data
        : booking && booking.starter_data
    return clean(source && source.name) || 'the other participant'
  }

  const counterpartPlaceholderTemplates = new WeakMap()

  function fillCounterpartPlaceholders(modal, panelName, role, booking) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return 0
    const name = counterpartName(role, booking)
    let replaced = 0
    modal
      .querySelectorAll('[booking-popup-content="' + panelName + '"]')
      .forEach(function (panel) {
        function render(node) {
          if (!node) return
          if (node.nodeType === 3) {
            const current = String(node.nodeValue == null ? '' : node.nodeValue)
            const template = counterpartPlaceholderTemplates.get(node) || current
            if (template.indexOf('[Starter]') === -1 && template.indexOf('[Brand]') === -1) return
            counterpartPlaceholderTemplates.set(node, template)
            node.nodeValue = template
              .split('[Starter]')
              .join(name)
              .split('[Brand]')
              .join(name)
            replaced += 1
            return
          }
          Array.prototype.forEach.call(node.childNodes || [], render)
        }
        render(panel)
      })
    return replaced
  }

  function switchPopupContent(modal, target) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return false
    let found = false
    modal.querySelectorAll('[booking-popup-content]').forEach(function (content) {
      const active = content.getAttribute('booking-popup-content') === target
      content.hidden = !active
      content.style.display = active ? 'flex' : 'none'
      if (active) found = true
    })
    // The authored back control returns to the base panel, so it is only
    // meaningful away from it. Hiding it there removes the doubled close icon
    // Kaeser reported on the Brand dialog.
    modal
      .querySelectorAll(
        '[booking-action-btn="switch-base"], [booking-card-action-btn="switch-base"]',
      )
      .forEach(function (control) {
        const visible = target !== 'base'
        control.hidden = !visible
        control.style.display = visible ? '' : 'none'
      })
    return found
  }

  /**
   * Closes the details dialog through the authored close control so the
   * native modal system runs its own close flow; falls back to the dialog
   * API when no authored control exists.
   */
  function closeDetailModal(modal) {
    if (!modal) return false
    const control =
      typeof modal.querySelector === 'function' &&
      modal.querySelector('[booking-popup-info-close], [data-modal-close]')
    if (control && typeof control.click === 'function') {
      control.click()
      return true
    }
    if (typeof modal.close === 'function') {
      try {
        modal.close()
      } catch (_error) {}
      return true
    }
    return false
  }

  function reasonValue(modal, kind) {
    const config = KINDS[kind] || KINDS.decline
    const field =
      modal &&
      typeof modal.querySelector === 'function' &&
      modal.querySelector('[' + config.reasonAttribute + ']')
    if (!field) return { field: null, value: '' }
    return { field, value: clean(field.value) }
  }

  function validateReason(field, value) {
    if (!field) return false
    if (typeof field.setCustomValidity === 'function') {
      field.setCustomValidity(value ? '' : 'Please provide a reason.')
    }
    if (!value && typeof field.reportValidity === 'function') {
      field.reportValidity()
    }
    return Boolean(value)
  }

  function actionForButton(button) {
    const action = clean(
      button.getAttribute('booking-action-btn') ||
        button.getAttribute('booking-card-action-btn'),
    )
    if (action === 'switch-decline') return { kind: 'decline', step: 'open' }
    if (action === 'switch-decline-reason') return { kind: 'decline', step: 'reason' }
    if (action === 'decline') return { kind: 'decline', step: 'submit' }
    if (action === 'switch-cancel') return { kind: 'cancel', step: 'open' }
    if (action === 'switch-cancel-reason') return { kind: 'cancel', step: 'reason' }
    if (action === 'cancel') return { kind: 'cancel', step: 'submit' }
    if (action === 'reschedule') return { kind: 'reschedule-propose', step: 'open' }
    if (action === 'reschedule-calendar') return { kind: 'reschedule-propose', step: 'calendar' }
    if (action === 'confirm-reschedule') return { kind: 'reschedule-confirm', step: 'respond' }
    if (action === 'reschedule-decline') return { kind: 'reschedule-decline', step: 'respond' }
    // Modal chrome: the authored back and close controls. The legacy inline
    // delegation used to own these; this module owns them now so they work on
    // both dashboards and stop bubbling into legacy handlers.
    if (action === 'switch-base') return { kind: 'navigate', step: 'base' }
    if (action === 'switch-close') return { kind: 'navigate', step: 'close' }
    return null
  }

  const WIRE_SELECTOR = [
    'switch-decline',
    'switch-decline-reason',
    'decline',
    'switch-cancel',
    'switch-cancel-reason',
    'cancel',
    'reschedule',
    'reschedule-calendar',
    'confirm-reschedule',
    'reschedule-decline',
    'switch-base',
    'switch-close',
  ]
    .map(function (action) {
      return (
        '[booking-action-btn="' +
        action +
        '"], [booking-card-action-btn="' +
        action +
        '"]'
      )
    })
    .join(', ')

  const CLOSE_SELECTOR =
    '[booking-action-btn="switch-close"], [booking-card-action-btn="switch-close"], [data-modal-close], [booking-popup-close], [popup-booking-close]'

  function restartAfterModalClose(document, modal, restart) {
    if (
      !document ||
      typeof document.addEventListener !== 'function' ||
      !modal ||
      typeof restart !== 'function'
    ) return false
    let pending = true
    const detach = function () {
      if (typeof document.removeEventListener === 'function') {
        document.removeEventListener('click', onClick, true)
      }
      if (typeof modal.removeEventListener === 'function') {
        modal.removeEventListener('close', onClose)
      }
    }
    const run = function () {
      if (!pending) return
      pending = false
      detach()
      Promise.resolve()
        .then(restart)
        .catch(function (error) {
          console.error(
            '[dashboard-call-actions] refresh after close failed:',
            error && error.message,
          )
        })
    }
    const onClose = function () {
      run()
    }
    const onClick = function (event) {
      const target = event && event.target
      const close = target && target.closest && target.closest(CLOSE_SELECTOR)
      if (!close || !close.closest) return
      const owner = close.closest(
        '[popup-booking-info], dialog[data-modal-target="popup-booking-info"]',
      )
      if (owner === modal) run()
    }
    document.addEventListener('click', onClick, true)
    if (typeof modal.addEventListener === 'function') {
      modal.addEventListener('close', onClose)
    }
    return true
  }

  function loaderCacheSuffix(document) {
    const loader =
      document &&
      typeof document.querySelector === 'function' &&
      document.querySelector('script[src*="/v3/dashboard-calls.js"]')
    const src = clean(loader && loader.getAttribute('src'))
    const query = src.indexOf('?')
    if (query === -1) return ''
    const suffix = src.slice(query + 1)
    return suffix ? '?' + suffix : ''
  }

  async function loadCalendarModule(document) {
    function ready() {
      const candidate = global.StartersPaidCallBrandPayment
      return candidate && typeof candidate.mountPaidCalendar === 'function'
        ? candidate
        : null
    }
    if (ready()) return ready()
    if (!document || typeof document.createElement !== 'function') return null
    await new Promise(function (resolve) {
      let script = document.querySelector(
        'script[data-starters-reschedule-calendar], script[src*="/v3/paid-call-brand-payment.js"]',
      )
      if (!script) {
        script = document.createElement('script')
        script.src = CALENDAR_MODULE_PATH + loaderCacheSuffix(document)
        script.defer = true
        script.setAttribute('data-starters-reschedule-calendar', '')
        ;(document.head || document.documentElement).appendChild(script)
      }
      script.addEventListener('load', resolve, { once: true })
      script.addEventListener('error', resolve, { once: true })
      global.setTimeout(resolve, 8000)
    })
    return ready()
  }

  function styledActionButton(document, modal, action, label) {
    const template =
      modal &&
      typeof modal.querySelector === 'function' &&
      (modal.querySelector('[booking-action-btn="cancel"]') ||
        modal.querySelector('[booking-action-btn="decline"]'))
    let button
    if (template && typeof template.cloneNode === 'function') {
      button = template.cloneNode(true)
    } else {
      button = document.createElement('button')
      button.type = 'button'
      button.style.padding = '12px 16px'
      button.style.border = '1px solid #1f211d'
      button.style.borderRadius = '6px'
      button.style.background = '#1f211d'
      button.style.color = '#ffffff'
      button.style.cursor = 'pointer'
    }
    button.setAttribute('booking-action-btn', action)
    button.removeAttribute('booking-card-action-btn')
    button.hidden = false
    button.style.display = ''
    button.textContent = label
    return button
  }

  function setAuthoredActionLabel(control, label) {
    if (!control) return false
    const labels =
      typeof control.querySelectorAll === 'function'
        ? Array.prototype.slice.call(
            control.querySelectorAll('.button_main-text, [button-text], [data-button-text]'),
          )
        : []
    if (labels.length) {
      labels.forEach(function (node) {
        node.textContent = label
      })
    } else {
      control.textContent = label
    }
    return true
  }

  function replaceAuthoredPlaceholder(root, replacement) {
    let changed = 0
    function visit(node) {
      if (!node) return
      if (node.nodeType === 3) {
        if (clean(node.nodeValue) === 'This is some text inside of a div block.') {
          node.nodeValue = replacement
          changed += 1
        }
        return
      }
      Array.prototype.forEach.call(node.childNodes || [], visit)
    }
    visit(root)
    return changed
  }

  /**
   * Keeps the Designer-owned reschedule form and normalizes only its copy.
   * Webflow's default Div Block text can otherwise ship as the field label,
   * and cloned Button components keep that same placeholder in their labels.
   */
  function normalizeRescheduleViewCopy(modal) {
    if (!modal || typeof modal.querySelector !== 'function') return false
    const panel = modal.querySelector('[booking-popup-content="reschedule"]')
    if (!panel || typeof panel.querySelectorAll !== 'function') return false
    panel
      .querySelectorAll(
        '[booking-action-btn="switch-base"], [booking-card-action-btn="switch-base"]',
      )
      .forEach(function (control) {
        setAuthoredActionLabel(control, 'Back')
      })
    panel
      .querySelectorAll(
        '[booking-action-btn="reschedule-calendar"], [booking-card-action-btn="reschedule-calendar"]',
      )
      .forEach(function (control) {
        setAuthoredActionLabel(control, 'Continue')
      })
    const reason = panel.querySelector('[booking-reschedule-reason]')
    if (reason) {
      reason.placeholder = 'Why do you need a new time?'
      if (typeof reason.setAttribute === 'function') {
        reason.setAttribute('aria-label', 'Why do you need a new time?')
      }
    }
    replaceAuthoredPlaceholder(panel, 'Why do you need a new time?')
    return true
  }

  function reschedulePanel(document, name, marker) {
    const panel = document.createElement('div')
    panel.setAttribute('booking-popup-content', name)
    if (marker) panel.setAttribute('data-starters-reschedule-views', '')
    panel.hidden = true
    panel.style.display = 'none'
    panel.style.flexDirection = 'column'
    panel.style.gap = '12px'
    panel.style.width = '100%'
    return panel
  }

  function panelText(document, tag, text, muted) {
    const node = document.createElement(tag)
    node.textContent = text
    if (muted) {
      node.style.color = '#6f746d'
      node.style.fontSize = '13px'
      node.style.margin = '0'
    }
    return node
  }

  function ensureRescheduleViews(document, modal) {
    if (
      !document ||
      !modal ||
      typeof modal.querySelector !== 'function' ||
      typeof document.createElement !== 'function'
    ) return false
    const hasAuthoredRescheduleView = normalizeRescheduleViewCopy(modal)
    if (modal.querySelector('[data-starters-reschedule-views]')) {
      ensureRespondButtons(document, modal)
      return true
    }
    const sibling =
      modal.querySelector('[booking-popup-content="cancel-reason"]') ||
      modal.querySelector('[booking-popup-content="base"]')
    const host = sibling && sibling.parentNode
    if (!host || typeof host.appendChild !== 'function') return false

    if (!hasAuthoredRescheduleView) {
      const reasonPanel = reschedulePanel(document, 'reschedule', true)
      reasonPanel.appendChild(panelText(document, 'h3', 'Propose a new time'))
      reasonPanel.appendChild(
        panelText(
          document,
          'p',
          'Your call keeps its current time until the other participant confirms the new one. Changes close to the start time can be disruptive, so add a short note about why.',
          true,
        ),
      )
      const reason = document.createElement('textarea')
      reason.setAttribute('booking-reschedule-reason', '')
      reason.rows = 3
      reason.placeholder = 'Why do you need a new time?'
      reason.style.width = '100%'
      reason.style.padding = '10px'
      reason.style.border = '1px solid #d7d9d2'
      reason.style.borderRadius = '6px'
      reasonPanel.appendChild(reason)
      reasonPanel.appendChild(
        styledActionButton(document, modal, 'reschedule-calendar', 'Continue'),
      )
      host.appendChild(reasonPanel)
    }

    if (!modal.querySelector('[booking-popup-content="reschedule-calendar"]')) {
      const calendarPanel = reschedulePanel(document, 'reschedule-calendar')
      calendarPanel.appendChild(panelText(document, 'h3', 'Pick a new time'))
      const calendarHost = document.createElement('div')
      calendarHost.setAttribute('booking-reschedule-calendar', '')
      calendarHost.style.width = '100%'
      calendarPanel.appendChild(calendarHost)
      host.appendChild(calendarPanel)
    }

    if (!modal.querySelector('[booking-popup-content="reschedule-proposed"]')) {
      const proposedPanel = reschedulePanel(document, 'reschedule-proposed')
      proposedPanel.appendChild(panelText(document, 'h3', 'Reschedule request sent'))
      proposedPanel.appendChild(
        panelText(
          document,
          'p',
          'We will notify you when the other participant responds. The call keeps its current time until then.',
          true,
        ),
      )
      host.appendChild(proposedPanel)
    }

    if (!modal.querySelector('[booking-popup-content="reschedule-accepted"]')) {
      const acceptedPanel = reschedulePanel(document, 'reschedule-accepted')
      acceptedPanel.appendChild(panelText(document, 'h3', 'New time confirmed'))
      acceptedPanel.appendChild(
        panelText(document, 'p', 'The call has been moved to the proposed time.', true),
      )
      host.appendChild(acceptedPanel)
    }

    if (!modal.querySelector('[booking-popup-content="reschedule-declined"]')) {
      const declinedPanel = reschedulePanel(document, 'reschedule-declined')
      declinedPanel.appendChild(panelText(document, 'h3', 'Proposal declined'))
      declinedPanel.appendChild(
        panelText(document, 'p', 'The call keeps its original time.', true),
      )
      host.appendChild(declinedPanel)
    }

    ensureRespondButtons(document, modal)
    normalizeRescheduleViewCopy(modal)
    return true
  }

  function ensureRespondButtons(document, modal) {
    if (
      !document ||
      !modal ||
      typeof modal.querySelector !== 'function' ||
      typeof document.createElement !== 'function'
    ) return false
    if (modal.querySelector('[data-starters-reschedule-respond]')) return true
    // The authored confirm-reschedule button lives inside a legacy hidden
    // panel, so the counterpart needs base-view respond controls instead. The
    // authored base reschedule trigger anchors their placement and styling.
    const anchor = (function () {
      const candidates = modal.querySelectorAll(
        '[booking-action-btn="reschedule"], [booking-action-btn="switch-cancel"]',
      )
      for (let index = 0; index < candidates.length; index += 1) {
        const base = candidates[index].closest
          ? candidates[index].closest('[booking-popup-content]')
          : null
        if (base && base.getAttribute('booking-popup-content') === 'base') {
          return candidates[index]
        }
      }
      return null
    })()
    if (!anchor || !anchor.parentNode) return false
    const accept = styledActionButton(
      document,
      modal,
      'confirm-reschedule',
      'Accept new time',
    )
    accept.setAttribute('data-starters-reschedule-respond', '')
    const decline = styledActionButton(
      document,
      modal,
      'reschedule-decline',
      'Keep current time',
    )
    decline.setAttribute('data-starters-reschedule-respond', '')
    anchor.parentNode.insertBefore(accept, anchor.nextSibling)
    anchor.parentNode.insertBefore(decline, accept.nextSibling)
    return true
  }

  function resetRescheduleState(modal) {
    if (!modal || typeof modal.querySelector !== 'function') return false
    modal.__startersRescheduleCalendarToken = null
    const reason = modal.querySelector('[booking-reschedule-reason]')
    if (reason) reason.value = ''
    const calendar = modal.querySelector('[booking-reschedule-calendar]')
    if (calendar) calendar.textContent = ''
    // A reset can land mid-load (the member closed the modal or switched
    // bookings), so the loader must not be left covering the next open.
    showCalendarLoader(modal, false)
    return true
  }

  /**
   * Shows or hides the authored calendar loader. The site's `.loader_wrap` is
   * authored `display:none`, so a reveal has to name the display it wants;
   * `flex` is what that class is built around. Returns whether an authored
   * loader exists, which is what tells the caller a text fallback is needed.
   * @param {HTMLElement|null} modal Detail modal being populated.
   * @param {boolean} visible Whether the loader should show.
   * @returns {boolean} Whether an authored loader was found.
   */
  function showCalendarLoader(modal, visible) {
    const loader =
      modal &&
      typeof modal.querySelector === 'function' &&
      modal.querySelector('[booking-calendar-loader]')
    if (!loader) return false
    loader.hidden = !visible
    if (loader.style) loader.style.display = visible ? 'flex' : 'none'
    return true
  }

  async function mountRescheduleCalendar(document, modal, booking, role, reason, restart) {
    const container = modal && modal.querySelector('[booking-reschedule-calendar]')
    if (!container) return false
    const bookingId = clean(booking && booking.booking_id)
    const mountToken = {}
    modal.__startersRescheduleCalendarToken = mountToken
    const isCurrent = function () {
      return (
        modal.__startersRescheduleCalendarToken === mountToken &&
        clean(modal.getAttribute && modal.getAttribute('data-booking-id')) === bookingId &&
        modal.querySelector('[booking-reschedule-calendar]') === container
      )
    }
    /* The loader covers BOTH waits, not just the script fetch: the engine
       clears the container and only then requests availability, so the slow
       half of this used to render as an empty panel. */
    const authoredLoader = showCalendarLoader(modal, true)
    if (!authoredLoader) container.textContent = 'Loading available times...'
    const calendarModule = await loadCalendarModule(document)
    if (!isCurrent()) return false
    if (!calendarModule) {
      showCalendarLoader(modal, false)
      container.textContent = 'The calendar could not load. Please try again.'
      return false
    }
    if (!authoredLoader) container.textContent = ''
    try {
      await calendarModule.mountPaidCalendar({
      container,
      config: {
        config_id: clean(booking && booking.config_id),
        grant_id: clean(booking && booking.grant_id),
        duration: Number(booking && booking.duration),
      },
      confirmText: 'Propose new time',
      isCurrent,
      onConfirm: async function (slot) {
        if (!isCurrent()) return null
        showActionError(modal, '')
        let result
        try {
          result = await proposeReschedule(booking, role, reason, {
            start: Number(slot && slot.start),
            end: Number(slot && slot.end),
            timezone: clean(slot && slot.timezone),
          })
          if (!result) throw new Error(KINDS['reschedule-propose'].failureMessage)
        } catch (error) {
          showActionError(
            modal,
            (error && error.message) || KINDS['reschedule-propose'].failureMessage,
          )
          throw error
        }
        if (!isCurrent()) return result
        const reasonField = modal.querySelector('[booking-reschedule-reason]')
        if (reasonField) reasonField.value = ''
        switchPopupContent(modal, KINDS['reschedule-propose'].successContent)
        restartAfterModalClose(document, modal, restart)
      },
      })
    } finally {
      // The engine has painted (or failed) by here, so the loader comes down
      // either way rather than covering a rendered calendar.
      if (isCurrent()) showCalendarLoader(modal, false)
    }
    return true
  }

  /**
   * Shows (or clears, with an empty message) a module-owned error line inside
   * the details modal. A failed command must never end as a console-only
   * event: Kaeser's QA read those silent failures as dead buttons.
   */
  function showActionError(modal, message) {
    if (!modal || typeof modal.querySelector !== 'function') return
    const text = clean(message)
    let note = modal.querySelector('[data-starters-action-error]')
    if (!text) {
      if (note) {
        note.hidden = true
        note.style.display = 'none'
      }
      return
    }
    if (!note) {
      const document = modal.ownerDocument || global.document
      if (
        !document ||
        typeof document.createElement !== 'function' ||
        typeof modal.appendChild !== 'function'
      ) return
      note = document.createElement('div')
      note.setAttribute('data-starters-action-error', '')
      note.setAttribute('role', 'alert')
      note.style.color = '#b3261e'
      note.style.fontSize = '14px'
      note.style.lineHeight = '1.4'
      note.style.margin = '12px 24px'
      modal.appendChild(note)
    }
    note.textContent = text
    note.hidden = false
    note.style.display = ''
  }

  function wire(options) {
    const settings = options || {}
    const document = settings.document || global.document
    if (
      !document ||
      typeof document.addEventListener !== 'function' ||
      typeof settings.getBooking !== 'function'
    ) return false
    document.addEventListener(
      'click',
      async function (event) {
        const target = event && event.target
        const button =
          target && target.closest && target.closest(WIRE_SELECTOR)
        if (!button) return
        const step = actionForButton(button)
        if (!step) return
        if (event.preventDefault) event.preventDefault()
        if (event.stopImmediatePropagation) event.stopImmediatePropagation()
        else if (event.stopPropagation) event.stopPropagation()
        const modal =
          button.closest &&
          (button.closest(
            '[popup-booking-info], dialog[data-modal-target="popup-booking-info"]',
          ) ||
            (document.querySelector &&
              document.querySelector(
                '[popup-booking-info], dialog[data-modal-target="popup-booking-info"]',
              )))
        if (step.kind === 'navigate') {
          // Modal chrome needs no booking gate: back returns to the base
          // panel, close dismisses the dialog.
          if (step.step === 'base') {
            showActionError(modal, '')
            switchPopupContent(modal, 'base')
          } else {
            closeDetailModal(modal)
          }
          return
        }
        const booking = settings.getBooking(button)
        if (!canAct(step.kind, settings.role, booking)) {
          // Never fail silently: a blocked click with no trace reads as a dead
          // button. The gate snapshot names the reason without member PII.
          console.warn('[dashboard-call-actions] ' + step.kind + ' blocked:', {
            role: settings.role,
            status: bookingStatus(booking),
            paid: booking ? paidFlag(booking) : null,
            identified: bookingIdentified(booking),
          })
          return
        }
        const config = KINDS[step.kind]
        if (step.step === 'open') {
          if (step.kind === 'reschedule-propose') {
            ensureRescheduleViews(document, modal)
            switchPopupContent(modal, 'reschedule')
            return
          }
          switchPopupContent(modal, config.firstContent)
          return
        }
        if (step.step === 'reason') {
          switchPopupContent(modal, config.reasonContent)
          return
        }
        if (step.step === 'calendar') {
          const proposalReason = reasonValue(modal, 'reschedule-propose')
          if (!validateReason(proposalReason.field, proposalReason.value)) return
          switchPopupContent(modal, 'reschedule-calendar')
          mountRescheduleCalendar(
            document,
            modal,
            booking,
            settings.role,
            proposalReason.value,
            settings.restart,
          ).catch(function (error) {
            console.error(
              '[dashboard-call-actions] reschedule calendar failed:',
              error && error.message,
            )
          })
          return
        }
        if (button.__startersActionBusy) return
        if (step.step === 'respond') {
          button.__startersActionBusy = true
          button.setAttribute('aria-busy', 'true')
          button.setAttribute('aria-disabled', 'true')
          showActionError(modal, '')
          try {
            const result = await respondReschedule(step.kind, booking, settings.role)
            if (!result) throw new Error(config.failureMessage)
            ensureRescheduleViews(document, modal)
            switchPopupContent(modal, config.successContent)
            restartAfterModalClose(document, modal, settings.restart)
          } catch (error) {
            console.error(
              '[dashboard-call-actions] ' + step.kind + ' failed closed:',
              error && error.message,
            )
            showActionError(modal, (error && error.message) || config.failureMessage)
          } finally {
            button.__startersActionBusy = false
            button.setAttribute('aria-busy', 'false')
            button.setAttribute('aria-disabled', 'false')
          }
          return
        }
        const reason = reasonValue(modal, step.kind)
        if (!validateReason(reason.field, reason.value)) return
        button.__startersActionBusy = true
        button.setAttribute('aria-busy', 'true')
        button.setAttribute('aria-disabled', 'true')
        showActionError(modal, '')
        try {
          const result = await submitAction(
            step.kind,
            settings.role,
            booking,
            reason.value,
          )
          if (!result) throw new Error(config.failureMessage)
          if (reason.field) reason.field.value = ''
          fillCounterpartPlaceholders(modal, config.successContent, settings.role, booking)
          switchPopupContent(modal, config.successContent)
          restartAfterModalClose(document, modal, settings.restart)
        } catch (error) {
          console.error(
            '[dashboard-call-actions] ' + step.kind + ' failed closed:',
            error && error.message,
          )
          showActionError(modal, (error && error.message) || config.failureMessage)
        } finally {
          button.__startersActionBusy = false
          button.setAttribute('aria-busy', 'false')
          button.setAttribute('aria-disabled', 'false')
        }
      },
      true,
    )
    return true
  }

  const api = {
    canCancel,
    canDecline,
    counterpartName,
    fillCounterpartPlaceholders,
    canProposeReschedule,
    canRespondReschedule,
    ensureRescheduleViews,
    normalizeRescheduleViewCopy,
    mountRescheduleCalendar,
    proposeReschedule,
    respondReschedule,
    resetRescheduleState,
    cancelAttemptKey,
    cancelBooking,
    cancelPayload,
    cancelStorageKey,
    cancelSucceeded,
    clearCancelAttemptKey,
    clearDeclineAttemptKey,
    declineAttemptKey,
    declineBooking,
    declinePayload,
    declineStorageKey,
    closeDetailModal,
    declineSucceeded,
    showActionError,
    switchPopupContent,
    validAttemptKey,
    wire,
  }
  if (isCommonJs) module.exports = api
  else global.StartersDashboardCallActions = api
})(typeof window === 'undefined' ? globalThis : window)
