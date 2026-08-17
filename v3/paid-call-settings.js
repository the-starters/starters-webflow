;(function () {
  'use strict'

  // Native Webflow form controller for Starter-owned paid consultation calls.
  // Xano is the only service authority. The DOM holds editable intent only;
  // every terminal state comes from starter/paid-call-settings/get/v3.
  const STAGING_HOST = 'the-starters-3-0.webflow.io'
  const PRODUCTION_HOSTS = new Set(['thestarters.com', 'www.thestarters.com'])
  const API_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'
  const ROOT_SELECTOR = '[data-paid-call-element="settings"]'
  const STATUS_ATTRIBUTE = 'data-paid-call-settings'

  const hostname = window.location.hostname
  if (hostname !== STAGING_HOST && !PRODUCTION_HOSTS.has(hostname)) return
  if (window.__tsPaidCallSettings) return
  window.__tsPaidCallSettings = true

  let root = null
  let sessionMemberId = null
  let settings = null
  let busy = false
  let refreshVersion = 0
  let bound = false

  function qs(selector, scope) {
    return (scope || document).querySelector(selector)
  }

  function qsa(selector, scope) {
    return (scope || document).querySelectorAll(selector)
  }

  function setStatus(value) {
    document.documentElement.setAttribute(STATUS_ATTRIBUTE, value)
    if (root) root.setAttribute('data-paid-call-state', value)
  }

  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail: detail }))
  }

  async function currentMember(requireLive) {
    if (!requireLive && window.memberReady && typeof window.memberReady.then === 'function') {
      const readyMember = await window.memberReady
      if (readyMember && readyMember.id) return readyMember
    }
    const memberstack = window.$memberstackDom
    if (!memberstack || typeof memberstack.getCurrentMember !== 'function') {
      throw new Error('Memberstack is unavailable')
    }
    const result = await memberstack.getCurrentMember()
    const member = result && result.data
    if (!member || !member.id) throw new Error('No logged-in member')
    return member
  }

  async function assertMemberScope() {
    const member = await currentMember(true)
    if (!sessionMemberId || member.id !== sessionMemberId) {
      throw Object.assign(new Error('Member session changed during paid-call request'), {
        code: 'MEMBER_SCOPE_CHANGED',
      })
    }
  }

  async function xanoRequest(path, method, payload) {
    if (typeof window.xanoAuthFetch !== 'function') {
      throw new Error('xanoAuthFetch is unavailable')
    }
    await assertMemberScope()
    const response = await window.xanoAuthFetch(API_BASE + path, {
      method: method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    const data = await response.json().catch(function () {
      return null
    })
    if (!response.ok) {
      const serverMessage = data && (data.message || data.error)
      throw Object.assign(new Error(serverMessage || path + ' failed (' + response.status + ')'), {
        status: response.status,
        data: data,
      })
    }
    return data
  }

  function canonicalService(value) {
    const services = value && Array.isArray(value.services) ? value.services : []
    const active = services.filter(function (service) {
      return service && service.active === true
    })
    if (active.length > 1) throw new Error('Multiple active paid-call services require support')
    return active[0] || null
  }

  function readinessState(value) {
    const readiness = (value && value.readiness) || {}
    return {
      calendar: readiness.calendar_connected === true,
      availability: readiness.availability_configured === true,
      stripe: readiness.stripe_connect_linked === true,
      charges: readiness.stripe_charges_enabled === true,
      fresh: readiness.stripe_readiness_fresh === true,
      enabled: readiness.paid_call_enabled === true,
      bookable: readiness.bookable === true,
    }
  }

  function prerequisitesReady(value) {
    const readiness = readinessState(value)
    return (
      readiness.calendar &&
      readiness.availability &&
      readiness.stripe &&
      readiness.charges &&
      readiness.fresh
    )
  }

  function field(name) {
    return qs('[data-paid-call-input="' + name + '"]', root)
  }

  function action(name) {
    return qs('[data-paid-call-action="' + name + '"]', root)
  }

  function setMessage(message) {
    const target = qs('[data-paid-call-element="status"]', root)
    if (target) target.textContent = message || ''
  }

  function setBusy(nextBusy) {
    busy = nextBusy
    qsa('[data-paid-call-action]', root).forEach(function (button) {
      button.style.pointerEvents = nextBusy ? 'none' : ''
      button.style.opacity = nextBusy ? '0.6' : ''
      const nativeButton = button.matches && button.matches('button, input')
        ? button
        : qs('button, input', button)
      if (nativeButton) nativeButton.disabled = nextBusy
    })
    if (!nextBusy && settings) {
      setActionEnabled(action('save'), prerequisitesReady(settings))
      setActionEnabled(action('disable'), Boolean(canonicalService(settings)))
    }
  }

  function setActionEnabled(button, enabled) {
    if (!button) return
    button.setAttribute('aria-disabled', enabled ? 'false' : 'true')
    button.style.pointerEvents = enabled ? '' : 'none'
    button.style.opacity = enabled ? '' : '0.5'
    const nativeButton = button.matches && button.matches('button, input')
      ? button
      : qs('button, input', button)
    if (nativeButton) nativeButton.disabled = !enabled
  }

  function clearRenderedState(message) {
    settings = null
    busy = false
    sessionMemberId = null
    const enabledInput = field('enabled')
    const titleInput = field('title')
    const priceInput = field('price')
    const durationInput = field('duration')
    if (enabledInput) enabledInput.checked = false
    if (titleInput) titleInput.value = ''
    if (priceInput) priceInput.value = ''
    if (durationInput) durationInput.value = '60'
    qsa('[data-paid-call-prerequisite]', root).forEach(function (item) {
      item.setAttribute('data-ready', 'false')
    })
    root.setAttribute('data-paid-call-enabled', 'false')
    root.setAttribute('data-paid-call-bookable', 'false')
    setActionEnabled(action('save'), false)
    setActionEnabled(action('disable'), false)
    setMessage(message)
  }

  function currentRender(version, memberId) {
    return version === refreshVersion && memberId === sessionMemberId
  }

  function render(value) {
    settings = value
    const service = canonicalService(value)
    const readiness = readinessState(value)
    const enabledInput = field('enabled')
    const titleInput = field('title')
    const priceInput = field('price')
    const durationInput = field('duration')

    if (enabledInput) enabledInput.checked = Boolean(service)
    if (titleInput) titleInput.value = service ? service.title || '' : 'Paid Consultation Call'
    if (priceInput) priceInput.value = service ? Number(service.price_cents || 0) / 100 : ''
    if (durationInput) durationInput.value = String(service ? service.duration || 60 : 60)

    Object.keys(readiness).forEach(function (name) {
      qsa('[data-paid-call-prerequisite="' + name + '"]', root).forEach(function (item) {
        item.setAttribute('data-ready', readiness[name] ? 'true' : 'false')
      })
    })

    root.setAttribute('data-paid-call-enabled', service ? 'true' : 'false')
    root.setAttribute('data-paid-call-bookable', readiness.bookable ? 'true' : 'false')
    setActionEnabled(action('save'), prerequisitesReady(value))
    setActionEnabled(action('disable'), Boolean(service))
    setMessage(
      service
        ? readiness.bookable
          ? 'Paid calls are on and bookable.'
          : 'Paid calls are saved, but a prerequisite needs attention.'
        : prerequisitesReady(value)
          ? 'Paid calls are off. Add a rate to turn them on.'
          : 'Complete the required setup before you turn on paid calls.',
    )
    setStatus('ready')
    emit('starterPaidCallSettingsChanged', {
      active: Boolean(service),
      bookable: readiness.bookable,
      readiness: readiness,
    })
    return value
  }

  async function readCanonicalSettings() {
    const value = await xanoRequest('/starter/paid-call-settings/get/v3', 'GET')
    if (!value || !Array.isArray(value.services) || !value.readiness) {
      throw new Error('Paid-call settings reader returned an invalid response')
    }
    canonicalService(value)
    return value
  }

  function idempotencyKey(actionName) {
    const uuid = window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : String(Date.now()) + '-' + Math.random().toString(16).slice(2)
    return 'paid-call-' + actionName + ':' + uuid
  }

  function readIntent() {
    const title = String((field('title') && field('title').value) || '').trim()
    const price = Number((field('price') && field('price').value) || 0)
    const duration = Number((field('duration') && field('duration').value) || 0)
    if (title.length < 3 || title.length > 80) {
      throw new Error('Use a title between 3 and 80 characters.')
    }
    if (!Number.isInteger(price) || price < 5 || price > 999999) {
      throw new Error('Use a whole-dollar rate from $5 to $999,999.')
    }
    if ([15, 30, 45, 60].indexOf(duration) === -1) {
      throw new Error('Choose a 15, 30, 45, or 60 minute call.')
    }
    return { title: title, price_cents: price * 100, duration_minutes: duration }
  }

  async function save() {
    if (busy) return null
    const enabledInput = field('enabled')
    if (enabledInput && !enabledInput.checked) {
      setMessage('Turn on paid calls before you save these settings.')
      return null
    }
    if (!prerequisitesReady(settings)) {
      setMessage('Complete the calendar and Stripe setup before you turn on paid calls.')
      return null
    }
    const version = ++refreshVersion
    const memberId = sessionMemberId
    setBusy(true)
    setStatus('saving')
    try {
      const service = canonicalService(settings)
      const intent = readIntent()
      await xanoRequest('/starter/paid-call-settings/upsert/v3', 'POST', {
        config_id: service ? service.config_id : null,
        title: intent.title,
        price_cents: intent.price_cents,
        duration_minutes: intent.duration_minutes,
        expected_revision: service ? Number(service.revision || 0) : 0,
        idempotency_key: idempotencyKey('upsert'),
      })
      const canonical = await readCanonicalSettings()
      const saved = canonicalService(canonical)
      if (
        !saved ||
        saved.title !== intent.title ||
        Number(saved.price_cents) !== intent.price_cents ||
        Number(saved.duration) !== intent.duration_minutes
      ) {
        throw new Error('Paid-call settings did not match canonical readback')
      }
      if (!currentRender(version, memberId)) return null
      render(canonical)
      emit('starterPaidCallWriteSuccess', { action: 'upsert', configId: saved.config_id })
      return canonical
    } catch (error) {
      if (currentRender(version, memberId)) {
        setStatus('error')
        setMessage(error && error.message ? error.message : 'Paid-call settings could not be saved.')
        emit('starterPaidCallWriteError', { action: 'upsert', message: error && error.message })
      }
      throw error
    } finally {
      if (currentRender(version, memberId)) setBusy(false)
    }
  }

  async function refreshFromPrerequisite() {
    if (!root || !sessionMemberId || busy) return settings
    const version = ++refreshVersion
    const memberId = sessionMemberId
    try {
      const canonical = await readCanonicalSettings()
      if (currentRender(version, memberId) && !busy) render(canonical)
      return canonical
    } catch (error) {
      if (currentRender(version, memberId) && !busy) {
        setStatus('error')
        setMessage('Paid-call readiness could not be refreshed. Your account was not changed.')
      }
      throw error
    }
  }

  async function disable() {
    if (busy) return null
    const service = canonicalService(settings)
    if (!service) return settings
    const version = ++refreshVersion
    const memberId = sessionMemberId
    setBusy(true)
    setStatus('disabling')
    try {
      await xanoRequest('/starter/paid-call-settings/disable/v3', 'POST', {
        config_id: service.config_id,
        expected_revision: Number(service.revision || 0),
        idempotency_key: idempotencyKey('disable'),
      })
      const canonical = await readCanonicalSettings()
      if (canonicalService(canonical)) {
        throw new Error('Paid-call service remained active after canonical readback')
      }
      if (!currentRender(version, memberId)) return null
      render(canonical)
      setMessage('Paid calls are off.')
      emit('starterPaidCallWriteSuccess', { action: 'disable', configId: service.config_id })
      return canonical
    } catch (error) {
      if (currentRender(version, memberId)) {
        setStatus('error')
        setMessage(error && error.message ? error.message : 'Paid calls could not be turned off.')
        emit('starterPaidCallWriteError', { action: 'disable', message: error && error.message })
      }
      throw error
    } finally {
      if (currentRender(version, memberId)) setBusy(false)
    }
  }

  function authMember(value) {
    return value && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value
  }

  async function loadSession(memberValue, useSharedMember) {
    const version = ++refreshVersion
    clearRenderedState('Loading paid-call settings…')
    setStatus('loading')
    try {
      const member = memberValue === undefined
        ? await currentMember(!useSharedMember)
        : authMember(memberValue)
      if (version !== refreshVersion) return null
      if (!member || !member.id) {
        setStatus('error')
        setMessage('Sign in to manage paid calls.')
        return null
      }
      sessionMemberId = member.id
      const canonical = await readCanonicalSettings()
      if (!currentRender(version, member.id)) return null
      return render(canonical)
    } catch (error) {
      if (version === refreshVersion) {
        clearRenderedState('Paid-call settings are unavailable. Your account was not changed.')
        setStatus('error')
        console.warn('[paid-call-settings] initialization failed:', error && error.message)
      }
      return null
    }
  }

  function bind() {
    if (bound) return
    bound = true
    const form = qs('[data-paid-call-element="form"]', root)
    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault()
        save().catch(function () {})
      })
    }
    const saveButton = action('save')
    if (saveButton) {
      saveButton.addEventListener('click', function (event) {
        event.preventDefault()
        save().catch(function () {})
      })
    }
    const disableButton = action('disable')
    if (disableButton) {
      disableButton.addEventListener('click', function (event) {
        event.preventDefault()
        disable().catch(function () {})
      })
    }
    const enabledInput = field('enabled')
    if (enabledInput) {
      enabledInput.addEventListener('change', function () {
        if (!enabledInput.checked && canonicalService(settings)) {
          setMessage('Use Turn off paid calls to disable the active service safely.')
        }
      })
    }
    ;['starterSchedulingConnectionStateChanged', 'starterStripeConnectReady'].forEach(function (name) {
      window.addEventListener(name, function () {
        refreshFromPrerequisite().catch(function () {})
      })
    })
    const memberstack = window.$memberstackDom
    if (memberstack && typeof memberstack.onAuthChange === 'function') {
      memberstack.onAuthChange(function (nextMember) {
        return loadSession(authMember(nextMember), false)
      })
    }
  }

  async function initialize() {
    root = qs(ROOT_SELECTOR)
    if (!root) {
      setStatus('not-applicable')
      return null
    }
    bind()
    return loadSession(undefined, true)
  }

  window.StarterPaidCallSettings = {
    initialize: initialize,
    read: readCanonicalSettings,
    save: save,
    disable: disable,
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true })
  } else {
    initialize()
  }
})()
