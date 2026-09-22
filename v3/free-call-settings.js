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
  const AUTH_BRIDGE_WAIT_INTERVAL_MS = 100
  const AUTH_BRIDGE_WAIT_ATTEMPTS = 100
  const FREE_RADIO_GROUP_NAMES = ['consulting-calls-free', 'free-consulting-calls']
  const SHARED_RADIO_HOOK = 'data-call-settings-input'
  const FREE_RADIO_HOOK = 'data-free-call-settings-input'
  const BUSY_STYLE_ID = 'ts-call-settings-busy-style'

  const hostname = window.location.hostname
  if (hostname !== STAGING_HOST && !PRODUCTION_HOSTS.has(hostname)) return
  if (window.__tsFreeCallSettings) return
  window.__tsFreeCallSettings = true

  let root = null
  let uiScope = null
  let editProfileMode = false
  let sessionMemberId = null
  let sessionAuthScope = null
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
  let authTransitionPending = null
  let prerequisiteRefreshQueued = false
  let editProfileDirty = false
  let editProfileReady = false
  let applyingCanonicalRender = false
  let pendingBuildIntent = null
  let memberEditRevision = 0
  // Retiring a receipt canonical already satisfies is passive: it must never
  // disable a control or reject a member action, only delay one.
  let receiptCleanup = null

  function memberJsonValue(response) {
    const value = response && Object.prototype.hasOwnProperty.call(response, 'data')
      ? response.data
      : response
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  }

  async function readPendingBuildIntent() {
    const memberstack = window.$memberstackDom
    if (!memberstack || typeof memberstack.getMemberJSON !== 'function') return null
    const json = memberJsonValue(await queueMemberJsonWrite(function () {
      return memberstack.getMemberJSON()
    }))
    const envelope = json.starter_call_settings_intent_v3
    if (
      !envelope ||
      Number(envelope.version) !== 1 ||
      envelope.member_id !== sessionMemberId ||
      !envelope.free ||
      typeof envelope.free.enabled !== 'boolean'
    ) return null
    return {
      enabled: envelope.free.enabled,
      description: String(envelope.free.description || '').trim().slice(0, 60),
    }
  }

  // Memberstack replaces the whole member JSON on every write. Build Profile draft,
  // submit, Free, and Paid read-modify-write passes must share one writer or a later
  // write can erase the receipt or resurrect a branch another controller consumed.
  function queueMemberJsonWrite(task) {
    const previous = window.__tsMemberJsonWrite || Promise.resolve()
    const next = previous.then(task, task)
    window.__tsMemberJsonWrite = next.then(function () {}, function () {})
    return next
  }

  async function consumePendingBuildIntentBestEffort() {
    try {
      await consumePendingBuildIntent()
    } catch (error) {
      pendingBuildIntent = null
      console.warn('Canonical Free Call Settings were saved, but the pending Build Profile receipt could not be cleared.', error)
    }
  }

  async function consumePendingBuildIntent() {
    if (!pendingBuildIntent) return
    const memberstack = window.$memberstackDom
    if (
      !memberstack ||
      typeof memberstack.getMemberJSON !== 'function' ||
      typeof memberstack.updateMemberJSON !== 'function'
    ) throw new Error('Pending Build Profile Call Settings could not be cleared')
    const consumeMemberId = sessionMemberId
    await queueMemberJsonWrite(async function () {
      if (!pendingBuildIntent || sessionMemberId !== consumeMemberId) return
      const json = memberJsonValue(await memberstack.getMemberJSON())
      const envelope = json.starter_call_settings_intent_v3
      if (sessionMemberId !== consumeMemberId) return
      if (!envelope || envelope.member_id !== consumeMemberId) {
        pendingBuildIntent = null
        return
      }
      const nextEnvelope = Object.assign({}, envelope)
      delete nextEnvelope.free
      const nextJson = Object.assign({}, json)
      if (nextEnvelope.paid) nextJson.starter_call_settings_intent_v3 = nextEnvelope
      else delete nextJson.starter_call_settings_intent_v3
      await memberstack.updateMemberJSON({ json: nextJson })
      pendingBuildIntent = null
    })
  }

  function qs(selector, scope) {
    return (scope || document).querySelector(selector)
  }

  function qsa(selector, scope) {
    return (scope || document).querySelectorAll(selector)
  }

  function locateRoot() {
    root = qs(ROOT_SELECTOR)
    if (!root) root = qs(CARD_ROOT_SELECTOR)
    editProfileMode = false
    if (!root && String(window.location.pathname || '').replace(/\/+$/, '') === '/starter-edit-profile') {
      root = qs('[data-form="step"][data-index="6"]')
      editProfileMode = Boolean(root)
    }
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
    uiScope = editProfileMode ? root : findCallCardScope(root)
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

  async function xanoRequest(path, method, payload, expectedScope) {
    const authFetch = typeof window.__tsSchedulingAuthFetch === 'function'
      ? window.__tsSchedulingAuthFetch
      : window.__tsSchedulingAuthBridgeOwner === 'scheduling-auth' &&
          typeof window.xanoAuthFetch === 'function'
        ? window.xanoAuthFetch
        : null
    if (typeof authFetch !== 'function') {
      throw new Error('xanoAuthFetch is unavailable')
    }
    const requestScope = expectedScope || sessionAuthScope
    assertAuthScope(await currentAuthScope(), requestScope)
    const response = await authFetch(API_BASE + path, {
      method: method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }, requestScope)
    const data = await response.json().catch(function () { return null })
    assertAuthScope(await currentAuthScope(), requestScope)
    if (!response.ok) {
      const serverMessage = data && (data.message || data.error)
      throw Object.assign(new Error(serverMessage || path + ' failed (' + response.status + ')'), {
        status: response.status,
        data: data,
      })
    }
    return data
  }

  async function currentAuthScope() {
    if (typeof window.__tsSchedulingAuthGetScope !== 'function') {
      throw new Error('Scheduling auth scope is unavailable')
    }
    return window.__tsSchedulingAuthGetScope()
  }

  function assertAuthScope(scope, expectedScope) {
    const requestScope = expectedScope || sessionAuthScope
    if (!requestScope || scope !== requestScope) {
      throw Object.assign(new Error('Member session changed during free-call request'), {
        code: 'MEMBER_SCOPE_CHANGED',
      })
    }
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

  function canSubmitSettings(value) {
    return canSaveSettings(value) || (Boolean(pendingBuildIntent) && explicitIntent === 'disabled')
  }

  function canonicalSatisfiesPendingIntent(value) {
    if (!pendingBuildIntent) return false
    const service = canonicalService(value)
    if (!pendingBuildIntent.enabled) return !service
    return (
      Boolean(service) &&
      String((value && value.public_description) || '') === pendingBuildIntent.description
    )
  }

  function radioValue(item) {
    return String(item.value || item.getAttribute('value') || '').toLowerCase()
  }

  function namedRadio(word) {
    for (const groupName of FREE_RADIO_GROUP_NAMES) {
      const match = Array.prototype.find.call(qsa('[name="' + groupName + '"]', root), function (item) {
        const value = radioValue(item)
        if (value.indexOf(word) !== 0) return false
        const next = value.charAt(word.length)
        return next === '' || /[^a-z0-9]/.test(next)
      }) || null
      if (match) return match
    }
    return null
  }

  // Edit Profile gives the Free and Paid controllers one shared step-6 root, so the
  // canonical hook cannot say which service a stamped radio belongs to there.
  function radioHook() {
    return editProfileMode ? FREE_RADIO_HOOK : SHARED_RADIO_HOOK
  }

  function radioPair() {
    const hook = radioHook()
    const enabled = qs('[' + hook + '="enabled"]', root) || namedRadio('yes')
    const disabled = qs('[' + hook + '="disabled"]', root) || namedRadio('no')
    if (!enabled || !disabled || enabled === disabled) return { enabled: null, disabled: null }
    return { enabled: enabled, disabled: disabled }
  }

  function stampRadioHooks() {
    const pair = radioPair()
    if (!pair.enabled || !pair.disabled) return pair
    const hook = radioHook()
    pair.enabled.setAttribute(hook, 'enabled')
    pair.disabled.setAttribute(hook, 'disabled')
    return pair
  }

  function field(name) {
    if (name === 'enabled' || name === 'disabled') return radioPair()[name]
    if (editProfileMode) {
      return name === 'description' ? qs('[name="free-call-description"]', root) : null
    }
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
    if (canonical || editProfileMode) return canonical
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
    if (text) ensureBusyStyles()
    nativeError.setAttribute('data-call-settings-error-visible', text ? 'true' : 'false')
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
    nativeError.setAttribute('data-call-settings-error-visible', 'false')
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

  // canonical-profile-loader.js hydrates these same step 6 controls from the legacy profile
  // record and dispatches native input and change events on each one. Those are not member
  // gestures, so the shared hydration window - the same one the page dirty state answers with -
  // decides what counts as an Edit Profile change. Without it a freshly hydrated page reports
  // unsaved call settings, and a failed canonical read then wedges every other step 6 field.
  function markEditProfileDirty() {
    if (!editProfileMode) return
    const dirtyState = window.__tsProfileDirtyState
    if (dirtyState && typeof dirtyState.isHydrating === 'function' && dirtyState.isHydrating()) return
    editProfileDirty = true
  }

  // Edit Profile derives the dependent field's enabled and visible state from a radio
  // change, so a canonical write has to announce itself the same way a member click does.
  function notifyRadioChange(item) {
    if (!editProfileMode || !item || typeof item.dispatchEvent !== 'function') return
    applyingCanonicalRender = true
    try {
      item.dispatchEvent(new CustomEvent('change', { bubbles: true }))
    } finally {
      applyingCanonicalRender = false
    }
  }

  function renderWithoutProfileDirty(canonical) {
    const dirtyState = window.__tsProfileDirtyState
    if (editProfileMode && dirtyState && typeof dirtyState.runHydrationSync === 'function') {
      return dirtyState.runHydrationSync(function () { return render(canonical) })
    }
    return render(canonical)
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
      'display:none!important}' +
      '[data-call-settings-error-visible="true"].w-form-fail{display:block!important}'
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
    if (!nextBusy && settings) setActionEnabled(action('save'), canSubmitSettings(settings))
  }

  function refreshSubmitEnabled() {
    if (busy || !settings) return
    setActionEnabled(action('save'), canSubmitSettings(settings))
  }

  function clearRenderedState(message) {
    settings = null
    pendingBuildIntent = null
    setBusy(false)
    sessionMemberId = null
    sessionAuthScope = null
    // Edit Profile shows these controls while the canonical GET is still in flight, so a
    // pre-load reset would wipe hydrated or typed answers the member can see.
    if (!editProfileMode) {
      const pair = radioPair()
      setRadioChecked(pair.enabled, false)
      setRadioChecked(pair.disabled, true)
      const descriptionInput = field('description')
      if (descriptionInput) descriptionInput.value = ''
    }
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
    const message = String((error && error.message) || '')
    if (
      code !== 'MEMBER_SESSION_MISSING' &&
      code !== 'MEMBER_SCOPE_CHANGED' &&
      Number(error && error.status) !== 401 &&
      message !== 'No Memberstack session'
    ) return false
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
    if (write.failed) {
      prerequisiteRefreshQueued = false
      return
    }
    flushQueuedPrerequisiteRefresh()
  }

  function startReceiptCleanup(repaint) {
    const cleanup = consumePendingBuildIntent()
      .then(repaint)
      .catch(function () {})
      .then(function () { if (receiptCleanup === cleanup) receiptCleanup = null })
    receiptCleanup = cleanup
    return cleanup
  }

  async function settleReceiptCleanup() {
    while (receiptCleanup) {
      const pending = receiptCleanup
      await pending
      if (receiptCleanup === pending) receiptCleanup = null
    }
  }

  function beginAuthTransition() {
    const transition = {}
    authTransitionPending = transition
    return transition
  }

  function finishAuthTransition(transition) {
    if (authTransitionPending !== transition) return
    authTransitionPending = null
    flushQueuedPrerequisiteRefresh()
  }

  function flushQueuedPrerequisiteRefresh() {
    if (!prerequisiteRefreshQueued || activeWrite || authTransitionPending) return
    prerequisiteRefreshQueued = false
    refreshFromPrerequisite().catch(function () {})
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
    editProfileDirty = false
    editProfileReady = true
    const readiness = readinessState(value)
    const contractMatches = validateService(service)
    const bookable = readiness.bookable && contractMatches
    const pair = radioPair()
    setRadioChecked(pair.enabled, Boolean(service))
    setRadioChecked(pair.disabled, !service)
    notifyRadioChange(service ? pair.enabled : pair.disabled)
    const descriptionInput = field('description')
    if (descriptionInput) {
      descriptionInput.value = value.public_description || ''
      descriptionInput.readOnly = false
      descriptionInput.setAttribute('aria-readonly', 'false')
    }
    // A receipt canonical already satisfies would repaint the values canonical
    // just painted, so it is retired in the background rather than announced.
    const unsavedIntent = pendingBuildIntent && !canonicalSatisfiesPendingIntent(value)
      ? pendingBuildIntent
      : null
    if (unsavedIntent) {
      setRadioChecked(pair.enabled, unsavedIntent.enabled)
      setRadioChecked(pair.disabled, !unsavedIntent.enabled)
      notifyRadioChange(unsavedIntent.enabled ? pair.enabled : pair.disabled)
      if (descriptionInput && unsavedIntent.enabled) {
        descriptionInput.value = unsavedIntent.description
      }
      explicitIntent = unsavedIntent.enabled ? 'enabled' : 'disabled'
      if (editProfileMode && (service || unsavedIntent.enabled) && canSaveSettings(value)) editProfileDirty = true
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
    // A pending Build Profile receipt must stay declinable even before Calendar
    // and Availability are ready, so Save is live whenever Off is the current
    // choice. An enable still needs those prerequisites before Save can run.
    setActionEnabled(action('save'), canSubmitSettings(value))
    const priceOutput = output('price')
    if (priceOutput) priceOutput.textContent = formatFreePrice(service ? servicePriceCents(service) : 0)
    paintStatusPills()
    setMessage(
      unsavedIntent
        ? unsavedIntent.enabled
          ? prerequisitesReady(value) || Boolean(service)
            ? 'Your Build Profile choice is ready. Select Update to save free calls.'
            : 'Your Build Profile choice is saved. Connect your calendar and set availability to turn on free calls.'
          : service
            ? 'Your Build Profile choice is ready. Select Update to turn off free calls.'
            : 'Free calls are off, matching your Build Profile choice.'
        : service
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

  async function readCanonicalSettings(expectedScope) {
    const value = await xanoRequest('/starter/free-call-settings/get/v3', 'GET', undefined, expectedScope)
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
    if (editProfileMode) return
    const wrapper = cardPanel()
    if (wrapper) wrapper.style.display = open ? 'flex' : 'none'
    root.setAttribute('data-free-call-editor-open', open ? 'true' : 'false')
  }

  async function refreshFromPrerequisite() {
    if (!root || !sessionMemberId) return settings
    if (busy || activeWrite || authTransitionPending) {
      prerequisiteRefreshQueued = true
      return settings
    }
    if (receiptCleanup) {
      await settleReceiptCleanup()
      if (!root || !sessionMemberId) return settings
    }
    hideNativeError()
    const version = ++refreshVersion
    const memberId = sessionMemberId
    try {
      const canonical = await readCanonicalSettings()
      const pending = await readPendingBuildIntent().catch(function () { return undefined })
      if (!currentRender(version, memberId) || busy) return canonical
      // A failed receipt read is not a confirmed absence: keep the pending
      // choice on the card and let a later refresh reconcile it.
      if (pending !== undefined) pendingBuildIntent = pending
      render(canonical)
      if (pending !== undefined && canonicalSatisfiesPendingIntent(canonical)) {
        const consumeEditRevision = memberEditRevision
        startReceiptCleanup(function () {
          if (currentRender(version, memberId) && !busy && memberEditRevision === consumeEditRevision) {
            renderWithoutProfileDirty(canonical)
          }
        })
      }
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
    if (receiptCleanup) await settleReceiptCleanup()
    if (busy || activeWrite || authTransitionPending) return null
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
      await consumePendingBuildIntentBestEffort()
      write.canonical = canonical
      if (!currentRender(version, memberId)) return null
      render(canonical)
      emit('starterFreeCallWriteSuccess', { action: 'upsert', configId: saved.config_id })
      return canonical
    } catch (error) {
      write.failed = true
      if (currentRender(version, memberId)) {
        if (!failClosedSession(error)) {
          setStatus('error')
          setMessage(error && error.message ? error.message : 'Free-call settings could not be saved.')
          emit('starterFreeCallWriteError', { action: 'upsert', message: error && error.message })
        }
      }
      throw error
    } finally {
      if (currentRender(version, memberId)) setBusy(false)
      finishWrite(write)
    }
  }

  async function disable() {
    if (receiptCleanup) await settleReceiptCleanup()
    if (busy || activeWrite || authTransitionPending) return null
    const service = canonicalService(settings)
    if (!service) {
      if (pendingBuildIntent) {
        if (!settings) {
          setStatus('error')
          setMessage('Free-call settings could not be confirmed. Reload and try again.')
          return null
        }
        const version = ++refreshVersion
        const memberId = sessionMemberId
        const write = beginWrite(memberId)
        setBusy(true)
        setStatus('disabling')
        try {
          await consumePendingBuildIntent()
        } catch (error) {
          write.failed = true
          if (!currentRender(version, memberId)) return null
          setStatus('error')
          setMessage('Your Build Profile choice could not be cleared. Your selection was not saved.')
          return null
        } finally {
          if (currentRender(version, memberId)) setBusy(false)
          finishWrite(write)
        }
        if (memberId !== sessionMemberId || !settings) return null
        if (currentRender(version, memberId)) render(settings)
        else setStatus('ready')
      }
      return settings
    }
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
      await consumePendingBuildIntentBestEffort()
      write.canonical = canonical
      if (!currentRender(version, memberId)) return null
      render(canonical)
      setMessage('Free calls are off.')
      emit('starterFreeCallWriteSuccess', { action: 'disable', configId: service.config_id })
      return canonical
    } catch (error) {
      write.failed = true
      if (currentRender(version, memberId)) {
        if (!failClosedSession(error)) {
          setStatus('error')
          setMessage(error && error.message ? error.message : 'Free calls could not be turned off.')
          emit('starterFreeCallWriteError', { action: 'disable', message: error && error.message })
        }
      }
      throw error
    } finally {
      if (currentRender(version, memberId)) setBusy(false)
      finishWrite(write)
    }
  }

  async function submitIntent() {
    if (editProfileMode && !editProfileDirty) return settings
    const pair = radioPair()
    const service = canonicalService(settings)
    if (explicitIntent === 'disabled') {
      const result = await disable()
      if (result && !editProfileMode) setCardEditorOpen(false)
      return result
    }
    if (!service && explicitIntent !== 'enabled') {
      if (!pair.enabled || !pair.enabled.checked || (pair.disabled && pair.disabled.checked)) {
        if (!editProfileMode) setCardEditorOpen(false)
        return settings
      }
    }
    const result = await save()
    if (result && !editProfileMode) setCardEditorOpen(false)
    return result
  }

  function authMember(value) {
    return value && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value
  }

  function waitForAuthRetry() {
    return new Promise(function (resolve) { window.setTimeout(resolve, 250) })
  }

  function showAuthRecovery() {
    setStatus('error')
    setMessage('Free-call settings are reconnecting. Update will resume automatically.')
    setActionEnabled(action('save'), false)
  }

  async function reconcileSameMemberScope(transition, notifiedMember, fallbackCanonical) {
    showAuthRecovery()
    while (
      authTransitionPending === transition &&
      notifiedMember.id === sessionMemberId &&
      settings
    ) {
      let scope = null
      try {
        scope = await currentAuthScope()
        if (authTransitionPending !== transition) return null
        const canonical = await readCanonicalSettings(scope)
        if (
          authTransitionPending !== transition ||
          notifiedMember.id !== sessionMemberId ||
          !settings
        ) return null
        sessionAuthScope = scope
        prerequisiteRefreshQueued = false
        return render(canonical)
      } catch (error) {
        if (authTransitionPending !== transition) return null
        if (error && error.code !== 'MEMBER_SCOPE_CHANGED' && failClosedSession(error)) return null
        if (fallbackCanonical && scope === sessionAuthScope) return render(fallbackCanonical)
        showAuthRecovery()
        await waitForAuthRetry()
      }
    }
    return null
  }

  async function handleAuthChange(nextMemberValue) {
    const notifiedMember = authMember(nextMemberValue)
    if (notifiedMember && notifiedMember.id) {
      const transition = beginAuthTransition()
      try {
        if (notifiedMember.id === sessionMemberId && settings) {
          return await reconcileSameMemberScope(transition, notifiedMember)
        }
        return await loadSession(notifiedMember, false)
      } finally {
        finishAuthTransition(transition)
      }
    }
    const transition = beginAuthTransition()
    try {
      const memberId = sessionMemberId
      if (!memberId || !settings) return loadSession(undefined, false)
      const pendingWrite = activeWrite && activeWrite.memberId === memberId ? activeWrite : null
      showAuthRecovery()
      if (pendingWrite) {
        await pendingWrite.done
        if (authTransitionPending !== transition) return null
        if (pendingWrite.failed) return null
      }
      if (memberId !== sessionMemberId || !settings) return null
      let liveMember = null
      while (authTransitionPending === transition && memberId === sessionMemberId && settings) {
        try {
          liveMember = await currentMember(true)
          break
        } catch (error) {
          if (authTransitionPending !== transition) return null
          if (failClosedSession(error)) return null
          showAuthRecovery()
          await waitForAuthRetry()
        }
      }
      if (!liveMember || authTransitionPending !== transition) return null
      if (liveMember.id !== memberId) return await loadSession(liveMember, false)
      return await reconcileSameMemberScope(
        transition,
        liveMember,
        pendingWrite && pendingWrite.canonical,
      )
    } finally {
      if (authTransitionPending === transition && settings && sessionMemberId) {
        setActionEnabled(action('save'), canSubmitSettings(settings))
      }
      finishAuthTransition(transition)
    }
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
      const pending = await readPendingBuildIntent().catch(function () { return null })
      if (version !== refreshVersion) return null
      pendingBuildIntent = pending
      await waitForSchedulingAuth()
      if (version !== refreshVersion) return null
      sessionAuthScope = await currentAuthScope()
      if (!currentRender(version, member.id)) return null
      const pendingWrite = activeWrite && activeWrite.memberId === member.id ? activeWrite : null
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
      }
      let canonical
      try {
        canonical = await readCanonicalSettings()
      } catch (error) {
        if (!pendingWrite || !pendingWrite.canonical) throw error
        let fallbackMember = null
        try {
          fallbackMember = await currentMember(true)
        } catch (memberError) {
          fallbackMember = null
        }
        if (!currentRender(version, member.id)) return null
        if (!fallbackMember || !fallbackMember.id) {
          setStatus('error')
          clearRenderedState('Sign in to manage free calls.')
          return null
        }
        if (fallbackMember.id !== member.id) return loadSession(fallbackMember, false)
        return render(pendingWrite.canonical)
      }
      if (!currentRender(version, member.id)) return null
      const rendered = render(canonical)
      if (canonicalSatisfiesPendingIntent(canonical)) {
        const consumeEditRevision = memberEditRevision
        startReceiptCleanup(function () {
          if (currentRender(version, member.id) && !busy && memberEditRevision === consumeEditRevision) {
            renderWithoutProfileDirty(canonical)
          }
        })
      }
      return rendered
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

  let schedulingAuthWait = null

  function schedulingAuthReady() {
    return (
      typeof window.__tsSchedulingAuthGetScope === 'function' &&
      typeof window.__tsSchedulingAuthFetch === 'function'
    )
  }

  function waitForSchedulingAuth() {
    if (schedulingAuthReady()) return Promise.resolve()
    if (schedulingAuthWait) return schedulingAuthWait
    schedulingAuthWait = new Promise(function (resolve) {
      let attempts = 0
      function check() {
        if (schedulingAuthReady()) {
          resolve()
          return
        }
        attempts += 1
        if (attempts >= AUTH_BRIDGE_WAIT_ATTEMPTS) {
          console.warn(
            '[free-call-settings] scheduling-auth bridge never installed on ' +
              window.location.pathname +
              '; canonical free-call reads and writes cannot be authenticated',
          )
          resolve()
          return
        }
        window.setTimeout(check, AUTH_BRIDGE_WAIT_INTERVAL_MS)
      }
      check()
    })
    return schedulingAuthWait
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
        if (applyingCanonicalRender) return
        memberEditRevision += 1
        if (pair.enabled.checked) explicitIntent = 'enabled'
        markEditProfileDirty()
        setRadioChecked(pair.enabled, pair.enabled.checked)
        if (pair.enabled.checked) setRadioChecked(pair.disabled, false)
        refreshSubmitEnabled()
      })
    }
    if (pair.disabled) {
      pair.disabled.addEventListener('change', function () {
        if (applyingCanonicalRender) return
        memberEditRevision += 1
        if (pair.disabled.checked) explicitIntent = 'disabled'
        markEditProfileDirty()
        setRadioChecked(pair.disabled, pair.disabled.checked)
        if (pair.disabled.checked) setRadioChecked(pair.enabled, false)
        refreshSubmitEnabled()
      })
    }
    const descriptionInput = field('description')
    if (descriptionInput) {
      descriptionInput.addEventListener('input', function () {
        if (applyingCanonicalRender) return
        memberEditRevision += 1
        markEditProfileDirty()
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
      uiScope = editProfileMode ? root : findCallCardScope(root)
      watchUiScope()
      if (!editProfileMode) setCardEditorOpen(false)
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
    submit: submitIntent,
    hasChanges: function () { return editProfileMode && editProfileDirty },
    isReady: function () { return !editProfileMode || editProfileReady },
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true })
  } else {
    initialize()
  }
})()
