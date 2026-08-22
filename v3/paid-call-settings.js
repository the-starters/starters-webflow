;(function () {
  'use strict'

  // Native Webflow form controller for Starter-owned paid consultation calls.
  // Xano is the only service authority. The DOM holds editable intent only;
  // every terminal state comes from starter/paid-call-settings/get/v3.
  const STAGING_HOST = 'the-starters-3-0.webflow.io'
  const PRODUCTION_HOSTS = new Set(['thestarters.com', 'www.thestarters.com'])
  const API_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'
  const CALL_SETTINGS_ROOT_SELECTOR = '[data-call-settings-service="paid"]'
  const ROOT_SELECTOR = '[data-paid-call-element="settings"]'
  const CARD_ROOT_SELECTOR = '[data-availability-element="call-paid-form"]'
  const AUTHORED_PRICE_CARD_SELECTOR = '[data-service-card-element="price-card"]'
  const AUTHORED_PRICE_AMOUNT = /^\$\s*[\d.,]+$/
  const STATUS_ATTRIBUTE = 'data-paid-call-settings'
  const PANEL_SELECTOR =
    '[data-call-settings-element="panel"], [data-availability-element="call-form-wrapper"]'
  const OPEN_ACTION_SELECTOR =
    '[data-call-settings-action="open"], [data-availability-action="item-form-open"]'
  const FOREIGN_CARD_SELECTOR =
    '[data-call-settings-element="panel"], [data-availability-element="call-form-wrapper"], [data-call-settings-service], [data-availability-element="call-paid-form"]'
  const FIXED_DURATION_MINUTES = 60
  const ROOT_WAIT_TIMEOUT_MS = 10000
  const PAID_RADIO_GROUP_NAMES = [
    'consulting-calls-paid',
    'paid-consulting-calls',
    'consulting-calls',
  ]

  const hostname = window.location.hostname
  if (hostname !== STAGING_HOST && !PRODUCTION_HOSTS.has(hostname)) return
  if (window.__tsPaidCallSettings) return
  window.__tsPaidCallSettings = true

  let root = null
  let uiScope = null
  let cardMode = false
  let sessionMemberId = null
  let settings = null
  let busy = false
  let refreshVersion = 0
  let bound = false
  let wiredMemberstack = null
  let memberstackReadyResolvers = []
  let rootObserver = null
  let rootWaitTimer = null
  let initializationPromise = null
  let authoredPrice = null

  function qs(selector, scope) {
    return (scope || document).querySelector(selector)
  }

  function locateRoot() {
    root = qs(CALL_SETTINGS_ROOT_SELECTOR)
    cardMode = Boolean(root)
    if (!root) {
      root = qs(ROOT_SELECTOR)
      cardMode = false
    }
    if (!root) {
      root = qs(CARD_ROOT_SELECTOR)
      cardMode = Boolean(root)
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

  // Webflow and Memberstack can insert the Paid card after this deferred script has
  // already run, so a missing root at boot is not proof the card will never exist.
  // The deadline below only downgrades the published status to `not-applicable`; it
  // deliberately leaves the observer connected so an even later insert still boots.
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

  function qsa(selector, scope) {
    return (scope || document).querySelectorAll(selector)
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
    if (!member || !member.id) {
      throw Object.assign(new Error('No logged-in member'), {
        code: 'MEMBER_SESSION_MISSING',
      })
    }
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

  function canSaveSettings(value) {
    return Boolean(canonicalService(value)) || prerequisitesReady(value)
  }

  function field(name) {
    const canonical =
      qs('[data-call-settings-input="' + name + '"]', root) ||
      qs('[data-paid-call-input="' + name + '"]', root)
    if (canonical || !cardMode) return canonical
    const selectors = {
      title: '[name="call-description"]',
      price: '[name="call-rate"]',
    }
    if (name === 'enabled') return cardRadioPair().enabled
    return selectors[name] ? qs(selectors[name], root) : null
  }

  function radioValue(item) {
    return String(item.value || item.getAttribute('value') || '').toLowerCase()
  }

  function findRadio(name, predicate) {
    return Array.prototype.find.call(qsa('[name="' + name + '"]', root), predicate) || null
  }

  function namedRadio(name, value) {
    return findRadio(name, function (item) {
      return radioValue(item) === value
    })
  }

  // Webflow labels a radio's value from its authored copy, so a Yes or No answer
  // often reads as "Yes please" or "No thanks". Treat a leading yes or no word as
  // that answer, but never a longer word that merely starts with those letters.
  function namedRadioAnswering(name, word, exclude) {
    return findRadio(name, function (item) {
      if (item === exclude) return false
      const value = radioValue(item)
      if (value.indexOf(word) !== 0) return false
      const next = value.charAt(word.length)
      return next === '' || /[^a-z0-9]/.test(next)
    })
  }

  function namedRadioOther(name, exclude) {
    if (!exclude) return null
    return findRadio(name, function (item) {
      return item !== exclude
    })
  }

  // Yes and No resolve as one pair, never independently. Every step either
  // matches a distinct value or is anchored to the already-identified sibling, so
  // one radio can never bind as both answers even when both values are
  // non-canonical and both live in the same field name. With neither answer
  // identifiable the pair stays unresolved: the card takes no radio-driven action
  // rather than guessing an answer from DOM order.
  function cardRadioPair() {
    let enabledInput = qs('[data-call-settings-input="enabled"]', root)
    let disabledInput = qs('[data-call-settings-input="disabled"]', root)
    for (const groupName of PAID_RADIO_GROUP_NAMES) {
      if (!enabledInput) enabledInput = namedRadio(groupName, 'yes')
      if (!disabledInput) disabledInput = namedRadio(groupName, 'no')
    }
    for (const groupName of PAID_RADIO_GROUP_NAMES) {
      if (!enabledInput) enabledInput = namedRadioAnswering(groupName, 'yes', disabledInput)
      if (!disabledInput) disabledInput = namedRadioAnswering(groupName, 'no', enabledInput)
    }
    for (const groupName of PAID_RADIO_GROUP_NAMES) {
      if (!enabledInput) enabledInput = namedRadioOther(groupName, disabledInput)
      if (!disabledInput) disabledInput = namedRadioOther(groupName, enabledInput)
    }
    if (enabledInput && enabledInput === disabledInput) return { enabled: null, disabled: null }
    return { enabled: enabledInput || null, disabled: disabledInput || null }
  }

  function disabledField() {
    if (!cardMode) return null
    const canonical = qs('[data-call-settings-input="disabled"]', root)
    if (canonical) return canonical
    return cardRadioPair().disabled
  }

  // The first native Paid card shipped with Yes and No under different Webflow
  // field names. Because both radios are required, the unchecked standalone No
  // field makes the otherwise valid native form fail browser validation before
  // its submit event can reach this controller. Join that legacy No field to the
  // Paid radio group at runtime; the authored form remains native Webflow HTML.
  // Stamp the canonical input hooks first: once both radios share one field name,
  // name-and-value lookups can no longer tell them apart, so every later
  // field('enabled')/disabledField() call must resolve by that stable hook.
  function normalizeCardRadioGroup() {
    if (!cardMode) return
    const enabledInput = field('enabled')
    const disabledInput = disabledField()
    if (enabledInput === disabledInput) return
    if (enabledInput) enabledInput.setAttribute('data-call-settings-input', 'enabled')
    if (disabledInput) disabledInput.setAttribute('data-call-settings-input', 'disabled')
    if (!enabledInput || !disabledInput) return
    const enabledName = enabledInput.getAttribute('name')
    const disabledName = disabledInput.getAttribute('name')
    if (enabledName && disabledName && enabledName !== disabledName) {
      disabledInput.setAttribute('name', enabledName)
    }
  }

  function action(name) {
    const stableName = name === 'save' ? 'submit' : name
    const canonical =
      qs('[data-call-settings-action="' + stableName + '"]', uiScope || root) ||
      qs('[data-paid-call-action="' + name + '"]', root)
    if (canonical || !cardMode) return canonical
    const selectors = {
      open: '[data-availability-action="item-form-open"]',
      close: '[data-availability-action="item-form-close"]',
      save: '[data-availability-action="item-form-submit"]',
    }
    return selectors[name] ? qs(selectors[name], uiScope || root) : null
  }

  function setMessage(message) {
    const target =
      qs('[data-call-settings-output="status"]', uiScope || root) ||
      qs('[data-paid-call-element="status"]', root)
    if (target) target.textContent = message || ''
  }

  function output(name) {
    return qs('[data-call-settings-output="' + name + '"]', uiScope || root)
  }

  function leafElements(element) {
    if (!element) return []
    const children = element.children ? Array.prototype.slice.call(element.children) : []
    if (!children.length) return [element]
    return children.reduce(function (found, child) {
      return found.concat(leafElements(child))
    }, [])
  }

  // The current native Webflow Paid card predates the canonical price output, so
  // the canonical hook always wins and this resolves the existing tile only as a
  // fallback. Bind the leaf that already displays a complete currency amount:
  // that is proof the node owns the whole price, so the controller can never
  // rewrite a caption, a unit, or a bare number that a sibling symbol completes.
  // With no such leaf the tile stays Designer-owned and nothing is painted.
  function authoredPriceTarget() {
    if (!cardMode) return null
    const card = qs(AUTHORED_PRICE_CARD_SELECTOR, uiScope || root)
    if (!card) return null
    return (
      leafElements(card).find(function (leaf) {
        return AUTHORED_PRICE_AMOUNT.test(String(leaf.textContent || '').trim())
      }) || null
    )
  }

  // Only a canonical output element is controller-owned and may show a zero
  // state. The authored tile is borrowed, so it carries a canonical price while
  // one exists and returns to its authored copy on every reset path.
  function paintAuthoredPrice(service) {
    const target = authoredPriceTarget()
    if (!target) return
    if (!authoredPrice || authoredPrice.target !== target) {
      authoredPrice = { target: target, text: String(target.textContent || '') }
    }
    target.textContent = service ? formatUsd(service.price_cents) : authoredPrice.text
  }

  function restoreAuthoredPrice() {
    if (!authoredPrice) return
    authoredPrice.target.textContent = authoredPrice.text
  }

  function formatUsd(cents) {
    const amount = Number(cents || 0) / 100
    const safeAmount = Number.isFinite(amount) ? amount : 0
    if (typeof Intl !== 'undefined' && Intl && typeof Intl.NumberFormat === 'function') {
      try {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(safeAmount)
      } catch (error) {
        return '$' + safeAmount.toFixed(2)
      }
    }
    return '$' + safeAmount.toFixed(2)
  }

  function show(element, visible) {
    if (!element) return
    element.hidden = !visible
    element.style.display = visible ? '' : 'none'
  }

  function setBusy(nextBusy) {
    busy = nextBusy
    const buttons = ['open', 'close', 'save', 'disable'].map(action).filter(Boolean)
    buttons.forEach(function (button) {
      button.style.pointerEvents = nextBusy ? 'none' : ''
      button.style.opacity = nextBusy ? '0.6' : ''
      const nativeButton = button.matches && button.matches('button, input')
        ? button
        : qs('button, input', button)
      if (nativeButton) nativeButton.disabled = nextBusy
    })
    if (!nextBusy && settings) {
      const service = canonicalService(settings)
      setActionEnabled(action('save'), canSaveSettings(settings))
      setActionEnabled(action('disable'), Boolean(service))
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
    setBusy(false)
    sessionMemberId = null
    const enabledInput = field('enabled')
    const titleInput = field('title')
    const priceInput = field('price')
    const durationInput = field('duration')
    if (enabledInput) enabledInput.checked = false
    if (titleInput) titleInput.value = ''
    if (priceInput) priceInput.value = ''
    if (durationInput) durationInput.value = String(FIXED_DURATION_MINUTES)
    const disabledInput = disabledField()
    if (disabledInput) disabledInput.checked = true
    qsa('[data-paid-call-prerequisite]', uiScope || root).forEach(function (item) {
      item.setAttribute('data-ready', 'false')
    })
    root.setAttribute('data-paid-call-enabled', 'false')
    root.setAttribute('data-paid-call-bookable', 'false')
    setActionEnabled(action('save'), false)
    setActionEnabled(action('disable'), false)
    restoreAuthoredPrice()
    setMessage(message)
  }

  function failClosedSession(error) {
    const code = error && error.code
    if (code !== 'MEMBER_SESSION_MISSING' && code !== 'MEMBER_SCOPE_CHANGED') return false
    refreshVersion += 1
    clearRenderedState('Sign in to manage paid calls.')
    setBusy(false)
    setStatus('error')
    return true
  }

  function currentRender(version, memberId) {
    return version === refreshVersion && memberId === sessionMemberId
  }

  function render(value) {
    settings = value
    const service = canonicalService(value)
    const readiness = readinessState(value)
    const durationMatches = !service || Number(service.duration) === FIXED_DURATION_MINUTES
    const bookable = readiness.bookable && durationMatches
    const enabledInput = field('enabled')
    const titleInput = field('title')
    const priceInput = field('price')
    const durationInput = field('duration')

    if (enabledInput) enabledInput.checked = Boolean(service)
    const disabledInput = disabledField()
    if (disabledInput) disabledInput.checked = !service
    if (titleInput) titleInput.value = service ? service.title || '' : 'Paid Consultation Call'
    if (priceInput) priceInput.value = service ? Number(service.price_cents || 0) / 100 : ''
    if (durationInput) durationInput.value = String(FIXED_DURATION_MINUTES)
    root.setAttribute(
      'data-paid-call-duration-current',
      service ? String(Number(service.duration || 0)) : '',
    )
    root.setAttribute('data-paid-call-duration-required', String(FIXED_DURATION_MINUTES))

    Object.keys(readiness).forEach(function (name) {
      qsa('[data-paid-call-prerequisite="' + name + '"]', uiScope || root).forEach(function (item) {
        item.setAttribute('data-ready', readiness[name] ? 'true' : 'false')
      })
    })

    root.setAttribute('data-paid-call-enabled', service ? 'true' : 'false')
    root.setAttribute('data-paid-call-bookable', bookable ? 'true' : 'false')
    setActionEnabled(action('save'), canSaveSettings(value))
    setActionEnabled(action('disable'), Boolean(service))
    const priceOutput = output('price')
    if (priceOutput) priceOutput.textContent = formatUsd(service ? service.price_cents : 0)
    else paintAuthoredPrice(service)
    show(output('on'), Boolean(service))
    show(output('off'), !service)
    setMessage(
      service
        ? Number(service.duration) !== FIXED_DURATION_MINUTES
          ? 'Update this service to the required 60-minute Paid Call duration.'
          : readiness.bookable
          ? 'Paid calls are on and bookable.'
          : 'Paid calls are saved, but a prerequisite needs attention.'
        : prerequisitesReady(value)
          ? 'Paid calls are off. Add a rate to turn them on.'
          : 'Complete the required setup before you turn on paid calls.',
    )
    setStatus('ready')
    emit('starterPaidCallSettingsChanged', {
      active: Boolean(service),
      bookable: bookable,
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
    const duration = FIXED_DURATION_MINUTES
    if (title.length < 3 || title.length > 80) {
      throw new Error('Use a title between 3 and 80 characters.')
    }
    if (!Number.isInteger(price) || price < 5 || price > 999999) {
      throw new Error('Use a whole-dollar rate from $5 to $999,999.')
    }
    return { title: title, price_cents: price * 100, duration_minutes: duration }
  }

  function setCardEditorOpen(open) {
    if (!cardMode) return
    const wrapper = cardPanel()
    if (wrapper) wrapper.style.display = open ? 'flex' : 'none'
    root.setAttribute('data-paid-call-editor-open', open ? 'true' : 'false')
  }

  async function submitIntent() {
    if (cardMode) {
      const enabledInput = field('enabled')
      const disabledInput = disabledField()
      if (disabledInput && disabledInput.checked && (!enabledInput || !enabledInput.checked)) {
        const result = await disable()
        if (result) setCardEditorOpen(false)
        return result
      }
    }
    const result = await save()
    if (result) setCardEditorOpen(false)
    return result
  }

  async function save() {
    if (busy) return null
    const enabledInput = field('enabled')
    if (enabledInput && !enabledInput.checked) {
      setMessage('Turn on paid calls before you save these settings.')
      return null
    }
    if (!canSaveSettings(settings)) {
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
        if (!failClosedSession(error)) {
          setStatus('error')
          setMessage(error && error.message ? error.message : 'Paid-call settings could not be saved.')
          emit('starterPaidCallWriteError', { action: 'upsert', message: error && error.message })
        }
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
        if (!failClosedSession(error)) {
          setStatus('error')
          setMessage('Paid-call readiness could not be refreshed. Your account was not changed.')
        }
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
        if (!failClosedSession(error)) {
          setStatus('error')
          setMessage(error && error.message ? error.message : 'Paid calls could not be turned off.')
          emit('starterPaidCallWriteError', { action: 'disable', message: error && error.message })
        }
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
    resolvers.forEach(function (resolve) {
      resolve(memberstack)
    })
    memberstack.onAuthChange(function (nextMember) {
      return loadSession(authMember(nextMember), false)
    })
  }

  function waitForMemberstack() {
    const memberstack = window.$memberstackDom
    if (memberstack && typeof memberstack.getCurrentMember === 'function') {
      return Promise.resolve(memberstack)
    }
    return new Promise(function (resolve) {
      memberstackReadyResolvers.push(resolve)
    })
  }

  function bind() {
    if (bound) return
    bound = true
    normalizeCardRadioGroup()
    const form =
      qs('[data-call-settings-element="form"]', root) ||
      qs('[data-paid-call-element="form"]', root) ||
      (cardMode ? qs('[data-availability-element="availability-form"]', root) : null)
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
        // The authored Update control is wired either as a plain element this
        // controller intercepts or as the native form's own submit control. The
        // native shape is gated by browser constraint validation, so gate the
        // intercepted shape the same way: the native Webflow form still owns
        // which fields are required and still shows its own validation UI.
        if (form && typeof form.reportValidity === 'function' && !form.reportValidity()) return
        submitIntent().catch(function () {})
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
        const disabledInput = disabledField()
        if (cardMode && enabledInput.checked && disabledInput) disabledInput.checked = false
        if (!enabledInput.checked && canonicalService(settings)) {
          setMessage('Use Turn off paid calls to disable the active service safely.')
        }
      })
    }
    const disabledInput = disabledField()
    if (disabledInput) {
      disabledInput.addEventListener('change', function () {
        if (disabledInput.checked && enabledInput) enabledInput.checked = false
      })
    }
    const openButton = action('open')
    if (openButton) {
      openButton.addEventListener('click', function (event) {
        event.preventDefault()
        setCardEditorOpen(root.getAttribute('data-paid-call-editor-open') !== 'true')
      })
    }
    const closeButton = action('close')
    if (closeButton) {
      closeButton.addEventListener('click', function (event) {
        event.preventDefault()
        if (settings) render(settings)
        setCardEditorOpen(false)
      })
    }
    ;['starterSchedulingConnectionStateChanged', 'starterStripeConnectReady'].forEach(function (name) {
      window.addEventListener(name, function () {
        refreshFromPrerequisite().catch(function () {})
      })
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
      uiScope = cardMode ? findCallCardScope(root) : root
      if (cardMode) setCardEditorOpen(false)
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
