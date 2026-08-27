;(function () {
  'use strict'

  // Native Webflow form controller for Starter-owned free consultation calls.
  // Xano owns the title, duration, price, provider payload, and environment.
  // The browser submits the public description plus guarded service intent.
  const STAGING_HOST = 'the-starters-3-0.webflow.io'
  const PRODUCTION_HOSTS = new Set(['thestarters.com', 'www.thestarters.com'])
  const API_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'
  const ROOT_SELECTOR = '[data-call-settings-service="free"]'
  const CARD_ROOT_SELECTOR = '[data-availability-element="call-free-form"]'
  const FORM_SELECTOR =
    '[data-call-settings-element="form"], form[data-name="Call Free Form"], form[name="Call Free Form"]'
  const PANEL_SELECTOR =
    '[data-call-settings-element="panel"], [data-availability-element="call-form-wrapper"]'
  const OPEN_ACTION_SELECTOR =
    '[data-call-settings-action="open"], [data-availability-action="item-form-open"]'
  const AUTHORED_STATUS_PILL_SELECTOR = '[data-availability-element="call-pill-on"]'
  const FOREIGN_CARD_SELECTOR =
    '[data-call-settings-element="panel"], [data-availability-element="call-form-wrapper"], [data-call-settings-service], [data-availability-element="call-free-form"], [data-availability-element="call-paid-form"]'
  const STATUS_ATTRIBUTE = 'data-free-call-settings'
  const FIXED_DURATION_MINUTES = 30
  const ROOT_WAIT_TIMEOUT_MS = 10000
  const FREE_RADIO_GROUP_NAME = 'consulting-calls-free'
  const BUSY_STYLE_ID = 'ts-call-settings-busy-style'

  const hostname = window.location.hostname
  if (hostname !== STAGING_HOST && !PRODUCTION_HOSTS.has(hostname)) return
  if (window.__tsFreeCallSettings) return
  window.__tsFreeCallSettings = true

  let root = null
  let uiScope = null
  let sessionMemberId = null
  let settings = null
  let busy = false
  // Only a real radio change may turn an existing service off. Published
  // Webflow forms can briefly expose stale checked properties while their
  // redirected radio UI hydrates. Treating that transient DOM state as intent
  // made an unchanged Update click call the destructive disable endpoint.
  let explicitIntent = null
  let refreshVersion = 0
  let bound = false
  let wiredMemberstack = null
  let memberstackReadyResolvers = []
  let rootObserver = null
  let uiObserver = null
  let statusPillWarned = false
  let rootWaitTimer = null
  let initializationPromise = null
  let activeWrite = null

  function qs(selector, scope) {
    return (scope || document).querySelector(selector)
  }

  function qsa(selector, scope) {
    return (scope || document).querySelectorAll(selector)
  }

  function locateRoot() {
    root = qs(ROOT_SELECTOR)
    if (!root) root = qs(CARD_ROOT_SELECTOR)
    return root
  }

  function clearRootWaitTimer() {
    if (rootWaitTimer && typeof window.clearTimeout === 'function') {
      window.clearTimeout(rootWaitTimer)
    }
    rootWaitTimer = null
  }

  function stopRootWait() {
    if (rootObserver) rootObserver.disconnect()
    rootObserver = null
    clearRootWaitTimer()
  }

  function waitForRoot() {
    if (rootObserver) return
    setStatus('waiting-for-ui')
    if (typeof MutationObserver !== 'function') {
      setStatus('not-applicable')
      return
    }
    const resume = function () {
      if (!locateRoot()) return
      stopRootWait()
      initialize().catch(function () {})
    }
    rootObserver = new MutationObserver(resume)
    rootObserver.observe(document.documentElement, { childList: true, subtree: true })
    rootWaitTimer = window.setTimeout(function () {
      clearRootWaitTimer()
      if (!locateRoot()) {
        setStatus('not-applicable')
        return
      }
      stopRootWait()
      initialize().catch(function () {})
    }, ROOT_WAIT_TIMEOUT_MS)
  }

  function containsElement(ancestor, node) {
    let current = node
    while (current) {
      if (current === ancestor) return true
      current = current.parentElement
    }
    return false
  }

  function closestMatch(element, selector) {
    let candidate = element
    while (candidate && candidate !== document) {
      if (candidate.matches && candidate.matches(selector)) return candidate
      candidate = candidate.parentElement
    }
    return null
  }

  function ownsElement(item, panel) {
    if (item === root || item === panel) return true
    if (panel && (containsElement(panel, item) || containsElement(item, panel))) return true
    return containsElement(root, item) || containsElement(item, root)
  }

  function hasForeignCard(candidate, panel) {
    return Array.prototype.some.call(qsa(FOREIGN_CARD_SELECTOR, candidate), function (item) {
      return !ownsElement(item, panel)
    })
  }

  function cardPanel() {
    return (
      closestMatch(root, PANEL_SELECTOR) ||
      qs('[data-call-settings-element="panel"]', uiScope || root) ||
      qs('[data-availability-element="call-form-wrapper"]', uiScope || root)
    )
  }

  function findCallCardScope(element) {
    const panel = closestMatch(element, PANEL_SELECTOR)
    const anchor = panel || element
    let candidate = anchor
    while (candidate && candidate !== document) {
      if (hasForeignCard(candidate, panel)) return anchor
      if (qs(OPEN_ACTION_SELECTOR, candidate)) return candidate
      candidate = candidate.parentElement
    }
    return anchor
  }

  function paintStatusPills() {
    const active = Boolean(settings && canonicalService(settings))
    show(output('on'), active)
    show(output('off'), !active)
  }

  function bindOpenAction() {
    const openButton = action('open')
    if (!openButton || openButton.__tsFreeCallOpenBound) return
    openButton.__tsFreeCallOpenBound = true
    openButton.addEventListener('click', function (event) {
      event.preventDefault()
      setCardEditorOpen(root.getAttribute('data-free-call-editor-open') !== 'true')
    })
  }

  function refreshUiScope() {
    if (!root) return
    uiScope = findCallCardScope(root)
    bindOpenAction()
    paintStatusPills()
  }

  function watchUiScope() {
    if (uiObserver || typeof MutationObserver !== 'function') return
    uiObserver = new MutationObserver(refreshUiScope)
    uiObserver.observe(document.documentElement, { childList: true, subtree: true })
  }

  function setStatus(value) {
    document.documentElement.setAttribute(STATUS_ATTRIBUTE, value)
    if (root) root.setAttribute('data-free-call-state', value)
    if (value !== 'error') hideNativeError()
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
    if (!member || !member.id) {
      throw Object.assign(new Error('No logged-in member'), { code: 'MEMBER_SESSION_MISSING' })
    }
    return member
  }

  async function assertMemberScope() {
    const member = await currentMember(true)
    if (!sessionMemberId || member.id !== sessionMemberId) {
      throw Object.assign(new Error('Member session changed during free-call request'), {
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
    const data = await response.json().catch(function () { return null })
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
    if (active.length > 1) throw new Error('Multiple active free-call services require support')
    return active[0] || null
  }

  function readinessState(value) {
    const readiness = (value && value.readiness) || {}
    return {
      calendar: readiness.calendar_connected === true,
      availability: readiness.availability_configured === true,
      enabled: readiness.free_call_enabled === true,
      bookable: readiness.bookable === true,
    }
  }

  function prerequisitesReady(value) {
    const readiness = readinessState(value)
    return readiness.calendar && readiness.availability
  }

  function canSaveSettings(value) {
    return Boolean(canonicalService(value)) || prerequisitesReady(value)
  }

  function radioValue(item) {
    return String(item.value || item.getAttribute('value') || '').toLowerCase()
  }

  function namedRadio(word) {
    return Array.prototype.find.call(qsa('[name="' + FREE_RADIO_GROUP_NAME + '"]', root), function (item) {
      const value = radioValue(item)
      if (value.indexOf(word) !== 0) return false
      const next = value.charAt(word.length)
      return next === '' || /[^a-z0-9]/.test(next)
    }) || null
  }

  function radioPair() {
    const enabled = qs('[data-call-settings-input="enabled"]', root) || namedRadio('yes')
    const disabled = qs('[data-call-settings-input="disabled"]', root) || namedRadio('no')
    if (!enabled || !disabled || enabled === disabled) return { enabled: null, disabled: null }
    return { enabled: enabled, disabled: disabled }
  }

  function stampRadioHooks() {
    const pair = radioPair()
    if (!pair.enabled || !pair.disabled) return pair
    pair.enabled.setAttribute('data-call-settings-input', 'enabled')
    pair.disabled.setAttribute('data-call-settings-input', 'disabled')
    return pair
  }

  function field(name) {
    if (name === 'enabled' || name === 'disabled') return radioPair()[name]
    const canonical = qs('[data-call-settings-input="' + name + '"]', root)
    if (canonical) return canonical
    if (name !== 'description') return null
    return (
      qs('[data-call-settings-input="title"]', root) ||
      qs('[name="call-description"]', root)
    )
  }

  function action(name) {
    const stableName = name === 'save' ? 'submit' : name
    const canonical = qs('[data-call-settings-action="' + stableName + '"]', uiScope || root)
    if (canonical) return canonical
    const selectors = {
      open: '[data-availability-action="item-form-open"]',
      close: '[data-availability-action="item-form-close"]',
      save: '[data-availability-action="item-form-submit"]',
    }
    return selectors[name] ? qs(selectors[name], uiScope || root) : null
  }

  function setMessage(message) {
    const target = qs('[data-call-settings-output="status"]', uiScope || root)
    if (target) target.textContent = message || ''
    const nativeError = findNativeError()
    if (!nativeError) return
    const text = document.documentElement.getAttribute(STATUS_ATTRIBUTE) === 'error'
      ? String(message || '')
      : ''
    const content = nativeErrorContent(nativeError)
    content.textContent = text
    nativeError.style.display = text ? 'block' : 'none'
    nativeError.setAttribute('aria-hidden', text ? 'false' : 'true')
    if (text) nativeError.setAttribute('role', 'alert')
  }

  function findNativeError() {
    const scope = uiScope || root
    return (
      (scope && qs('.w-form-fail', scope)) ||
      (root && scope !== root ? qs('.w-form-fail', root) : null)
    )
  }

  function nativeErrorContent(nativeError) {
    return (
      qs('[data-call-settings-error-message]', nativeError) ||
      qs('div', nativeError) ||
      nativeError
    )
  }

  function hideNativeError() {
    const nativeError = findNativeError()
    if (!nativeError) return
    nativeErrorContent(nativeError).textContent = ''
    nativeError.style.display = 'none'
    nativeError.setAttribute('aria-hidden', 'true')
  }

  function pillLabel(item) {
    return String(item.textContent || '')
      .replace(/\u00a0/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
  }

  function warnUnresolvedStatusPill(name, candidates) {
    if (!candidates.length || statusPillWarned) return
    if (hostname !== STAGING_HOST && window.STARTERS_DEBUG !== true) return
    statusPillWarned = true
    console.warn(
      '[free-call-settings] no authored status pill reads "' + name + '", so the canonical ' + name +
        ' state cannot be shown. Authored pill copy: ' +
        (Array.prototype.map.call(candidates, pillLabel).join(' | ') || '(empty)'),
    )
  }

  function output(name) {
    const canonical = qs('[data-call-settings-output="' + name + '"]', uiScope || root)
    if (canonical || (name !== 'on' && name !== 'off')) return canonical
    const candidates = qsa(AUTHORED_STATUS_PILL_SELECTOR, uiScope || root)
    const authored = Array.prototype.find.call(candidates, function (item) {
      return pillLabel(item) === name
    }) || null
    if (authored) authored.setAttribute('data-call-settings-output', name)
    else warnUnresolvedStatusPill(name, candidates)
    return authored
  }

  function setRadioChecked(item, checked) {
    if (!item) return
    item.checked = Boolean(checked)
    const label = closestMatch(item, 'label')
    if (!label) return
    const visual = Array.prototype.find.call(qsa('[class]', label), function (candidate) {
      return String(candidate.getAttribute('class') || '').split(/\s+/).includes('w-radio-input')
    })
    if (!visual) return
    const classes = String(visual.getAttribute('class') || '').split(/\s+/).filter(Boolean)
    const next = classes.filter(function (name) { return name !== 'w--redirected-checked' })
    if (checked) next.push('w--redirected-checked')
    visual.setAttribute('class', next.join(' '))
  }

  function show(element, visible) {
    if (!element) return
    element.hidden = !visible
    element.style.display = visible ? '' : 'none'
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

  function ensureBusyStyles() {
    if (!document.head || typeof document.createElement !== 'function') return
    if (document.getElementById && document.getElementById(BUSY_STYLE_ID)) return
    const style = document.createElement('style')
    style.id = BUSY_STYLE_ID
    style.textContent =
      '@keyframes ts-call-settings-spin{to{transform:rotate(360deg)}}' +
      '[data-call-settings-busy="true"]:not([data-call-settings-native-spinner="true"])::after{' +
      'content:"";display:inline-block;width:.85em;height:.85em;margin-left:.5em;' +
      'border:2px solid currentColor;border-right-color:transparent;border-radius:50%;' +
      'vertical-align:-.1em;animation:ts-call-settings-spin .7s linear infinite}' +
      '[data-call-settings-busy="true"] [data-call-settings-icon="success"],' +
      '[data-call-settings-busy="true"] [data-opp-element="loading-hide"],' +
      '[data-call-settings-busy="true"] [loading-hide]{' +
      'display:none!important}'
    document.head.appendChild(style)
  }

  function paintSaveBusy(nextBusy) {
    const saveButton = action('save')
    if (!saveButton) return
    ensureBusyStyles()
    const spinner = qs('[data-button-spinner], [loading-spinner]', saveButton)
    const successIcon = qs(
      '[data-call-settings-icon="success"], [data-opp-element="loading-hide"], [loading-hide]',
      saveButton
    )
    saveButton.setAttribute('data-call-settings-native-spinner', spinner ? 'true' : 'false')
    saveButton.setAttribute('data-opp-loading', nextBusy ? 'true' : 'false')
    saveButton.setAttribute('data-call-settings-busy', nextBusy ? 'true' : 'false')
    saveButton.setAttribute('aria-busy', nextBusy ? 'true' : 'false')
    if (spinner) {
      spinner.hidden = !nextBusy
      spinner.setAttribute('aria-hidden', nextBusy ? 'false' : 'true')
      spinner.style.display = nextBusy ? 'flex' : 'none'
    }
    if (successIcon) {
      successIcon.hidden = nextBusy
      successIcon.style.display = nextBusy ? 'none' : ''
    }
  }

  function setBusy(nextBusy) {
    busy = nextBusy
    paintSaveBusy(nextBusy)
    const buttons = ['open', 'close', 'save'].map(action).filter(Boolean)
    buttons.forEach(function (button) {
      button.style.pointerEvents = nextBusy ? 'none' : ''
      button.style.opacity = nextBusy ? '0.6' : ''
      const nativeButton = button.matches && button.matches('button, input')
        ? button
        : qs('button, input', button)
      if (nativeButton) nativeButton.disabled = nextBusy
    })
    if (!nextBusy && settings) setActionEnabled(action('save'), canSaveSettings(settings))
  }

  function clearRenderedState(message) {
    settings = null
    setBusy(false)
    sessionMemberId = null
    const pair = radioPair()
    setRadioChecked(pair.enabled, false)
    setRadioChecked(pair.disabled, true)
    const descriptionInput = field('description')
    if (descriptionInput) descriptionInput.value = ''
    qsa('[data-free-call-prerequisite]', uiScope || root).forEach(function (item) {
      item.setAttribute('data-ready', 'false')
    })
    root.setAttribute('data-free-call-duration-current', '')
    root.setAttribute('data-free-call-duration-required', String(FIXED_DURATION_MINUTES))
    root.setAttribute('data-free-call-price-cents', '0')
    root.setAttribute('data-free-call-enabled', 'false')
    root.setAttribute('data-free-call-bookable', 'false')
    const priceOutput = output('price')
    if (priceOutput) priceOutput.textContent = formatFreePrice(0)
    paintStatusPills()
    setActionEnabled(action('save'), false)
    setMessage(message)
  }

  function failClosedSession(error) {
    const code = error && error.code
    if (code !== 'MEMBER_SESSION_MISSING' && code !== 'MEMBER_SCOPE_CHANGED') return false
    refreshVersion += 1
    setStatus('error')
    clearRenderedState('Sign in to manage free calls.')
    setBusy(false)
    return true
  }

  function currentRender(version, memberId) {
    return version === refreshVersion && memberId === sessionMemberId
  }

  function beginWrite(memberId) {
    let resolve
    const done = new Promise(function (finish) { resolve = finish })
    const write = { memberId: memberId, done: done, resolve: resolve }
    activeWrite = write
    return write
  }

  function finishWrite(write) {
    if (activeWrite === write) activeWrite = null
    write.resolve()
  }

  function serviceDuration(service) {
    if (!service) return NaN
    const raw = service.duration === undefined || service.duration === null
      ? service.duration_minutes
      : service.duration
    return Number(raw)
  }

  function servicePriceCents(service) {
    const raw = service && service.price_cents
    if (raw === undefined || raw === null || raw === '') return 0
    return Number(raw)
  }

  function formatFreePrice(cents) {
    const amount = Number(cents || 0) / 100
    const safeAmount = Number.isFinite(amount) ? amount : 0
    return safeAmount === 0 ? '$0' : '$' + safeAmount.toFixed(2)
  }

  function validateService(service) {
    if (!service) return true
    return serviceDuration(service) === FIXED_DURATION_MINUTES && servicePriceCents(service) === 0
  }

  function render(value) {
    settings = value
    const service = canonicalService(value)
    explicitIntent = null
    const readiness = readinessState(value)
    const contractMatches = validateService(service)
    const bookable = readiness.bookable && contractMatches
    const pair = radioPair()
    setRadioChecked(pair.enabled, Boolean(service))
    setRadioChecked(pair.disabled, !service)
    const descriptionInput = field('description')
    if (descriptionInput) {
      descriptionInput.value = value.public_description || ''
      descriptionInput.readOnly = false
      descriptionInput.setAttribute('aria-readonly', 'false')
    }
    root.setAttribute(
      'data-free-call-duration-current',
      service ? String(serviceDuration(service) || 0) : '',
    )
    root.setAttribute('data-free-call-duration-required', String(FIXED_DURATION_MINUTES))
    root.setAttribute(
      'data-free-call-price-cents',
      service ? String(servicePriceCents(service) || 0) : '0',
    )
    root.setAttribute('data-free-call-enabled', service ? 'true' : 'false')
    root.setAttribute('data-free-call-bookable', bookable ? 'true' : 'false')
    Object.keys(readiness).forEach(function (name) {
      qsa('[data-free-call-prerequisite="' + name + '"]', uiScope || root).forEach(function (item) {
        item.setAttribute('data-ready', readiness[name] ? 'true' : 'false')
      })
    })
    setActionEnabled(action('save'), canSaveSettings(value))
    const priceOutput = output('price')
    if (priceOutput) priceOutput.textContent = formatFreePrice(service ? servicePriceCents(service) : 0)
    paintStatusPills()
    setMessage(
      service
        ? !contractMatches
          ? 'Update this service to the required 30-minute Free Call settings.'
          : readiness.bookable
            ? 'Free calls are on and bookable.'
            : 'Free calls are saved, but a prerequisite needs attention.'
        : prerequisitesReady(value)
          ? 'Free calls are off. Turn them on to accept 30-minute calls.'
          : 'Connect your calendar and set availability before you turn on free calls.',
    )
    setStatus('ready')
    emit('starterFreeCallSettingsChanged', {
      active: Boolean(service),
      bookable: bookable,
      readiness: readiness,
    })
    return value
  }

  async function readCanonicalSettings() {
    const value = await xanoRequest('/starter/free-call-settings/get/v3', 'GET')
    if (!value || !Array.isArray(value.services) || !value.readiness) {
      throw new Error('Free-call settings reader returned an invalid response')
    }
    canonicalService(value)
    return value
  }

  function idempotencyKey(actionName) {
    const uuid = window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : String(Date.now()) + '-' + Math.random().toString(16).slice(2)
    return 'free-call-' + actionName + ':' + uuid
  }

  function setCardEditorOpen(open) {
    const wrapper = cardPanel()
    if (wrapper) wrapper.style.display = open ? 'flex' : 'none'
    root.setAttribute('data-free-call-editor-open', open ? 'true' : 'false')
  }

  async function refreshFromPrerequisite() {
    if (!root || !sessionMemberId || busy) return settings
    hideNativeError()
    const version = ++refreshVersion
    const memberId = sessionMemberId
    try {
      const canonical = await readCanonicalSettings()
      if (currentRender(version, memberId) && !busy) render(canonical)
      return canonical
    } catch (error) {
      if (currentRender(version, memberId) && !busy) {
        if (!failClosedSession(error)) {
          setStatus('error')
          setMessage('Free-call readiness could not be refreshed. Your account was not changed.')
        }
      }
      throw error
    }
  }

  async function save() {
    if (busy || activeWrite) return null
    const pair = radioPair()
    if (!pair.enabled || !pair.disabled) {
      setMessage('Free-call controls are not configured correctly.')
      return null
    }
    if (!canonicalService(settings) && !pair.enabled.checked) {
      setMessage('Turn on free calls before you save these settings.')
      return null
    }
    if (!canSaveSettings(settings)) {
      setMessage('Connect your calendar and set availability before you turn on free calls.')
      return null
    }
    const version = ++refreshVersion
    const memberId = sessionMemberId
    const write = beginWrite(memberId)
    setBusy(true)
    setStatus('saving')
    try {
      const service = canonicalService(settings)
      const descriptionInput = field('description')
      const description = String((descriptionInput && descriptionInput.value) || '').trim()
      if (description.length > 60) {
        throw new Error('Free-call description must be 60 characters or fewer.')
      }
      await xanoRequest('/starter/free-call-settings/upsert/v3', 'POST', {
        config_id: service ? service.config_id : null,
        description: description,
        expected_revision: service ? Number(service.revision || 0) : 0,
        idempotency_key: idempotencyKey('upsert'),
      })
      const canonical = await readCanonicalSettings()
      const saved = canonicalService(canonical)
      if (!saved || !validateService(saved)) {
        throw new Error('Free-call settings did not match canonical 30-minute/$0 readback')
      }
      if (String(canonical.public_description || '') !== description) {
        throw new Error('Free-call description did not match canonical readback')
      }
      if (!currentRender(version, memberId)) return null
      render(canonical)
      emit('starterFreeCallWriteSuccess', { action: 'upsert', configId: saved.config_id })
      return canonical
    } catch (error) {
      if (currentRender(version, memberId)) {
        if (!failClosedSession(error)) {
          setStatus('error')
          setMessage(error && error.message ? error.message : 'Free-call settings could not be saved.')
          emit('starterFreeCallWriteError', { action: 'upsert', message: error && error.message })
        }
      }
      throw error
    } finally {
      finishWrite(write)
      if (currentRender(version, memberId)) setBusy(false)
    }
  }

  async function disable() {
    if (busy || activeWrite) return null
    const service = canonicalService(settings)
    if (!service) return settings
    const version = ++refreshVersion
    const memberId = sessionMemberId
    const write = beginWrite(memberId)
    setBusy(true)
    setStatus('disabling')
    try {
      await xanoRequest('/starter/free-call-settings/disable/v3', 'POST', {
        config_id: service.config_id,
        expected_revision: Number(service.revision || 0),
        idempotency_key: idempotencyKey('disable'),
      })
      const canonical = await readCanonicalSettings()
      if (canonicalService(canonical)) {
        throw new Error('Free-call service remained active after canonical readback')
      }
      if (!currentRender(version, memberId)) return null
      render(canonical)
      setMessage('Free calls are off.')
      emit('starterFreeCallWriteSuccess', { action: 'disable', configId: service.config_id })
      return canonical
    } catch (error) {
      if (currentRender(version, memberId)) {
        if (!failClosedSession(error)) {
          setStatus('error')
          setMessage(error && error.message ? error.message : 'Free calls could not be turned off.')
          emit('starterFreeCallWriteError', { action: 'disable', message: error && error.message })
        }
      }
      throw error
    } finally {
      finishWrite(write)
      if (currentRender(version, memberId)) setBusy(false)
    }
  }

  async function submitIntent() {
    const pair = radioPair()
    const service = canonicalService(settings)
    if (explicitIntent === 'disabled') {
      const result = await disable()
      if (result) setCardEditorOpen(false)
      return result
    }
    if (!service && explicitIntent !== 'enabled') {
      if (!pair.enabled || !pair.enabled.checked || (pair.disabled && pair.disabled.checked)) {
        setCardEditorOpen(false)
        return settings
      }
    }
    const result = await save()
    if (result) setCardEditorOpen(false)
    return result
  }

  function authMember(value) {
    return value && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value
  }

  async function handleAuthChange(nextMemberValue) {
    const notifiedMember = authMember(nextMemberValue)
    if (notifiedMember && notifiedMember.id) {
      if (notifiedMember.id === sessionMemberId && settings) return settings
      return loadSession(notifiedMember, false)
    }
    const memberId = sessionMemberId
    const pendingWrite = activeWrite && activeWrite.memberId === memberId ? activeWrite : null
    const version = ++refreshVersion
    clearRenderedState('Checking your account…')
    if (pendingWrite) sessionMemberId = memberId
    setStatus('loading')
    let member = null
    try {
      member = await currentMember(true)
    } catch (error) {
      member = null
    }
    if (version !== refreshVersion) return null
    if (!member || !member.id) {
      sessionMemberId = null
      setStatus('error')
      setMessage('Sign in to manage free calls.')
      return null
    }
    return loadSession(member, false)
  }

  async function loadSession(memberValue, useSharedMember) {
    const version = ++refreshVersion
    clearRenderedState('Loading free-call settings…')
    setStatus('loading')
    try {
      const member = memberValue === undefined
        ? await currentMember(!useSharedMember)
        : authMember(memberValue)
      if (version !== refreshVersion) return null
      if (!member || !member.id) {
        setStatus('error')
        setMessage('Sign in to manage free calls.')
        return null
      }
      sessionMemberId = member.id
      const pendingWrite = activeWrite && activeWrite.memberId === member.id ? activeWrite : null
      let canonical = await readCanonicalSettings()
      if (pendingWrite) {
        await pendingWrite.done
        if (!currentRender(version, member.id)) return null
        let liveMember = null
        try {
          liveMember = await currentMember(true)
        } catch (error) {
          liveMember = null
        }
        if (!currentRender(version, member.id)) return null
        if (!liveMember || !liveMember.id) {
          setStatus('error')
          clearRenderedState('Sign in to manage free calls.')
          return null
        }
        if (liveMember.id !== member.id) return loadSession(liveMember, false)
        canonical = await readCanonicalSettings()
      }
      if (!currentRender(version, member.id)) return null
      return render(canonical)
    } catch (error) {
      if (version === refreshVersion) {
        setStatus('error')
        clearRenderedState('Free-call settings are unavailable. Your account was not changed.')
        console.warn('[free-call-settings] initialization failed:', error && error.message)
      }
      return null
    }
  }

  function wireAuthChanges() {
    const memberstack = window.$memberstackDom
    if (
      !memberstack ||
      typeof memberstack.getCurrentMember !== 'function' ||
      typeof memberstack.onAuthChange !== 'function'
    ) {
      window.setTimeout(wireAuthChanges, 100)
      return
    }
    if (memberstack === wiredMemberstack) return
    wiredMemberstack = memberstack
    const resolvers = memberstackReadyResolvers
    memberstackReadyResolvers = []
    resolvers.forEach(function (resolve) { resolve(memberstack) })
    memberstack.onAuthChange(handleAuthChange)
  }

  function waitForMemberstack() {
    const memberstack = window.$memberstackDom
    if (memberstack && typeof memberstack.getCurrentMember === 'function') {
      return Promise.resolve(memberstack)
    }
    return new Promise(function (resolve) { memberstackReadyResolvers.push(resolve) })
  }

  function bind() {
    if (bound) return
    bound = true
    stampRadioHooks()
    const form = qs(FORM_SELECTOR, root)
    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault()
        submitIntent().catch(function () {})
      })
    }
    const saveButton = action('save')
    if (saveButton) {
      saveButton.addEventListener('click', function (event) {
        event.preventDefault()
        hideNativeError()
        if (form && typeof form.reportValidity === 'function' && !form.reportValidity()) return
        submitIntent().catch(function () {})
      })
    }
    const pair = radioPair()
    if (pair.enabled) {
      pair.enabled.addEventListener('change', function () {
        if (pair.enabled.checked) explicitIntent = 'enabled'
        setRadioChecked(pair.enabled, pair.enabled.checked)
        if (pair.enabled.checked) setRadioChecked(pair.disabled, false)
      })
    }
    if (pair.disabled) {
      pair.disabled.addEventListener('change', function () {
        if (pair.disabled.checked) explicitIntent = 'disabled'
        setRadioChecked(pair.disabled, pair.disabled.checked)
        if (pair.disabled.checked) setRadioChecked(pair.enabled, false)
      })
    }
    bindOpenAction()
    const closeButton = action('close')
    if (closeButton) {
      closeButton.addEventListener('click', function (event) {
        event.preventDefault()
        if (settings) render(settings)
        setCardEditorOpen(false)
      })
    }
    window.addEventListener('starterSchedulingConnectionStateChanged', function () {
      refreshFromPrerequisite().catch(function () {})
    })
    wireAuthChanges()
  }

  async function initialize() {
    if (initializationPromise) return initializationPromise
    locateRoot()
    if (!root) {
      waitForRoot()
      return null
    }
    initializationPromise = (async function () {
      stopRootWait()
      uiScope = findCallCardScope(root)
      watchUiScope()
      setCardEditorOpen(false)
      bind()
      await waitForMemberstack()
      return loadSession(undefined, false)
    })()
    try {
      return await initializationPromise
    } finally {
      initializationPromise = null
    }
  }

  window.StarterFreeCallSettings = {
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
