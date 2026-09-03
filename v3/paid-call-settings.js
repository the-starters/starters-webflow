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
  const AUTHORED_PRICE_NUMBER = /^[\d.,]+$/
  const STATUS_ATTRIBUTE = 'data-paid-call-settings'
  const PANEL_SELECTOR =
    '[data-call-settings-element="panel"], [data-availability-element="call-form-wrapper"]'
  const OPEN_ACTION_SELECTOR =
    '[data-call-settings-action="open"], [data-availability-action="item-form-open"]'
  const AUTHORED_STATUS_PILL_SELECTOR = '[data-availability-element="call-pill-on"]'
  const FOREIGN_CARD_SELECTOR =
    '[data-call-settings-element="panel"], [data-availability-element="call-form-wrapper"], [data-call-settings-service], [data-availability-element="call-paid-form"]'
  const FIXED_DURATION_MINUTES = 60
  const VALIDATED_FIELD_NAMES = ['title', 'price']
  const ROOT_WAIT_TIMEOUT_MS = 10000
  const BUSY_STYLE_ID = 'ts-call-settings-busy-style'
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
  let sessionAuthScope = null
  let settings = null
  let busy = false
  // Disable is destructive, so only a real user radio change may request it.
  // The native Webflow radio DOM can expose a stale checked state during load.
  let explicitIntent = null
  let refreshVersion = 0
  let bound = false
  let wiredMemberstack = null
  let memberstackReadyResolvers = []
  let rootObserver = null
  let uiObserver = null
  let rootWaitTimer = null
  let initializationPromise = null
  let authoredPrice = null
  let statusPillWarned = false
  let activeWrite = null
  let authTransitionPending = null
  let prerequisiteRefreshQueued = false

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

  function paintStatusPills() {
    const active = Boolean(settings && canonicalService(settings))
    show(output('on'), active)
    show(output('off'), !active)
  }

  function bindOpenAction() {
    const openButton = action('open')
    if (!openButton || openButton.__tsPaidCallOpenBound) return
    openButton.__tsPaidCallOpenBound = true
    openButton.addEventListener('click', function (event) {
      event.preventDefault()
      setCardEditorOpen(root.getAttribute('data-paid-call-editor-open') !== 'true')
    })
  }

  function refreshUiScope() {
    if (!root || !cardMode) return
    uiScope = findCallCardScope(root)
    ensureAccessibilityLabels()
    bindOpenAction()
    paintStatusPills()
  }

  function watchUiScope() {
    if (!cardMode || uiObserver || typeof MutationObserver !== 'function') return
    uiObserver = new MutationObserver(refreshUiScope)
    uiObserver.observe(document.documentElement, { childList: true, subtree: true })
  }

  function setStatus(value) {
    document.documentElement.setAttribute(STATUS_ATTRIBUTE, value)
    if (root) root.setAttribute('data-paid-call-state', value)
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
      throw Object.assign(new Error('No logged-in member'), {
        code: 'MEMBER_SESSION_MISSING',
      })
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
    const data = await response.json().catch(function () {
      return null
    })
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
      throw Object.assign(new Error('Member session changed during paid-call request'), {
        code: 'MEMBER_SCOPE_CHANGED',
      })
    }
  }

  function canonicalService(value) {
    const services = value && Array.isArray(value.services) ? value.services : []
    const active = services.filter(function (service) {
      return service && service.active === true
    })
    if (active.length > 1) throw new Error('Multiple active paid-call services require support')
    return active[0] || null
  }

  function displayableRate(value) {
    if (!value || String(value.currency || '').toLowerCase() !== 'usd') return null
    const cents = Number(value.price_cents)
    return Number.isInteger(cents) && cents >= 100 && cents <= 100000 && cents % 100 === 0
      ? value
      : null
  }

  function importedRateSuggestion(value) {
    const suggestion = value && value.suggestion
    if (
      !displayableRate(suggestion) ||
      suggestion.source !== 'legacy_v2' ||
      suggestion.requires_confirmation !== true ||
      Number(suggestion.price_cents) % 100 !== 0
    ) return null
    return suggestion
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

  function setAccessibleName(target, label) {
    if (!target) return
    const nativeControl = target.matches && target.matches('button, input, select, textarea, a')
      ? target
      : qs('button, input, select, textarea, a', target)
    const control = nativeControl || target
    const labelledBy = String(control.getAttribute('aria-labelledby') || '').trim()
    const ariaLabel = String(control.getAttribute('aria-label') || '').trim()
    const title = String(control.getAttribute('title') || '').trim()
    if (labelledBy || ariaLabel || title) return

    const labels = control.labels ? Array.prototype.slice.call(control.labels) : []
    let ancestor = control.parentElement
    while (ancestor) {
      if (ancestor.matches && ancestor.matches('label')) {
        labels.push(ancestor)
        break
      }
      ancestor = ancestor.parentElement
    }
    const id = String(control.getAttribute('id') || '').trim()
    if (id) {
      Array.prototype.forEach.call(qsa('label[for]', document), function (item) {
        if (item.getAttribute('for') === id) labels.push(item)
      })
    }
    if (labels.some(function (item) { return String(item.textContent || '').trim() })) return

    if (String(control.textContent || '').trim()) return
    const tagName = String(control.tagName || '').toLowerCase()
    if (tagName === 'input') {
      const type = String(control.getAttribute('type') || '').toLowerCase()
      if (
        ['button', 'submit', 'reset'].indexOf(type) !== -1 &&
        String(control.value || control.getAttribute('value') || '').trim()
      ) return
      if (type === 'image' && String(control.getAttribute('alt') || '').trim()) return
    }
    control.setAttribute('aria-label', label)
  }

  function ensureAccessibilityLabels() {
    setAccessibleName(action('open'), 'Edit paid call settings')
    setAccessibleName(action('close'), 'Cancel paid call settings')
    setAccessibleName(action('save'), 'Update paid call settings')
    setAccessibleName(action('disable'), 'Turn off paid calls')
    setAccessibleName(field('enabled'), 'Yes, enable paid calls')
    setAccessibleName(disabledField(), 'No, keep paid calls off')
    setAccessibleName(field('title'), 'Paid call description')
    setAccessibleName(field('price'), 'Paid call rate per hour')
    setAccessibleName(field('duration'), 'Paid call duration')

    const priceInput = field('price')
    if (priceInput) {
      priceInput.setAttribute('type', 'number')
      priceInput.setAttribute('inputmode', 'numeric')
      priceInput.setAttribute('step', '1')
      priceInput.setAttribute('min', '1')
      priceInput.setAttribute('max', '1000')
    }

    const status =
      qs('[data-call-settings-output="status"]', uiScope || root) ||
      qs('[data-paid-call-element="status"]', root)
    if (status) {
      if (!String(status.getAttribute('role') || '').trim()) status.setAttribute('role', 'status')
      if (!String(status.getAttribute('aria-live') || '').trim()) status.setAttribute('aria-live', 'polite')
    }
  }

  function setMessage(message) {
    const target =
      qs('[data-call-settings-output="status"]', uiScope || root) ||
      qs('[data-paid-call-element="status"]', root)
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

  function setFieldValidity(input, message) {
    if (!input) return
    if (typeof input.setCustomValidity === 'function') input.setCustomValidity(message || '')
    input.setAttribute('aria-invalid', message ? 'true' : 'false')
  }

  function reportFieldInvalid(input, message) {
    if (!input) return
    setFieldValidity(input, message)
    if (typeof input.reportValidity === 'function') input.reportValidity()
  }

  function clearFieldValidity() {
    VALIDATED_FIELD_NAMES.forEach(function (name) {
      setFieldValidity(field(name), '')
    })
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
      '[paid-call-settings] no authored status pill reads "' + name + '", so the canonical ' + name +
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

  function leafElements(element) {
    if (!element) return []
    const children = element.children ? Array.prototype.slice.call(element.children) : []
    if (!children.length) return [element]
    return children.reduce(function (found, child) {
      return found.concat(leafElements(child))
    }, [])
  }

  // An amount only owns the whole price when no sibling continues it, so a
  // trailing cents or digit fragment leaves the tile Designer-owned instead of
  // being painted over into a doubled amount.
  function endsAuthoredAmount(leaves, index) {
    const leaf = leaves[index]
    const next = leaves[index + 1]
    if (!leaf || !next) return true
    if (leaf.parentElement !== next.parentElement) return true
    return !AUTHORED_PRICE_NUMBER.test(String(next.textContent || '').trim())
  }

  // The current native Webflow Paid card predates the canonical price output, so
  // the canonical hook always wins and this resolves the existing tile only as a
  // fallback. Prefer the leaf that already displays a complete currency amount.
  // The published Webflow component splits "$" and "150" into adjacent sibling
  // spans, so that exact shape is also safe: paint only the numeric sibling and
  // preserve the authored currency span. With no unique amount the tile stays
  // Designer-owned and nothing is painted.
  function authoredPriceTarget() {
    if (!cardMode) return null
    const card = qs(AUTHORED_PRICE_CARD_SELECTOR, uiScope || root)
    if (!card) return null
    const leaves = leafElements(card)
    const complete = leaves.filter(function (leaf) {
      return AUTHORED_PRICE_AMOUNT.test(String(leaf.textContent || '').trim())
    })
    if (complete.length > 1) return null
    if (complete.length === 1) {
      const index = leaves.indexOf(complete[0])
      return endsAuthoredAmount(leaves, index)
        ? { target: complete[0], mode: 'currency', prefix: null }
        : null
    }

    const split = []
    leaves.forEach(function (leaf, index) {
      const number = leaves[index + 1]
      if (
        String(leaf.textContent || '').trim() === '$' &&
        number &&
        leaf.parentElement === number.parentElement &&
        AUTHORED_PRICE_NUMBER.test(String(number.textContent || '').trim()) &&
        endsAuthoredAmount(leaves, index + 1)
      ) {
        split.push({ target: number, mode: 'number', prefix: leaf })
      }
    })
    return split.length === 1 ? split[0] : null
  }

  function paintAuthoredPrice(rate, emptyText) {
    const resolved = authoredPriceTarget() || authoredPrice
    if (!resolved) return
    const target = resolved.target
    if (!authoredPrice || authoredPrice.target !== target || authoredPrice.mode !== resolved.mode) {
      authoredPrice = {
        target: target,
        text: String(target.textContent || ''),
        mode: resolved.mode,
        prefix: resolved.prefix,
        prefixDisplay: resolved.prefix ? resolved.prefix.style.display : '',
      }
    }
    const formatted = rate ? formatUsd(rate.price_cents) : String(emptyText || authoredPrice.text)
    if (authoredPrice.prefix) authoredPrice.prefix.style.display = rate ? authoredPrice.prefixDisplay : 'none'
    target.textContent = rate && resolved.mode === 'number'
      ? formatted.replace(/^\$\s*/, '')
      : formatted
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
    paintSaveBusy(nextBusy)
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

  function clearRenderedState(message) {
    settings = null
    setBusy(false)
    sessionMemberId = null
    sessionAuthScope = null
    const enabledInput = field('enabled')
    const titleInput = field('title')
    const priceInput = field('price')
    const durationInput = field('duration')
    setRadioChecked(enabledInput, false)
    if (titleInput) titleInput.value = ''
    if (priceInput) priceInput.value = ''
    if (durationInput) durationInput.value = String(FIXED_DURATION_MINUTES)
    const disabledInput = disabledField()
    setRadioChecked(disabledInput, true)
    clearFieldValidity()
    qsa('[data-paid-call-prerequisite]', uiScope || root).forEach(function (item) {
      item.setAttribute('data-ready', 'false')
    })
    root.setAttribute('data-paid-call-duration-current', '')
    root.setAttribute('data-paid-call-duration-required', String(FIXED_DURATION_MINUTES))
    root.setAttribute('data-paid-call-enabled', 'false')
    root.setAttribute('data-paid-call-bookable', 'false')
    setActionEnabled(action('save'), false)
    setActionEnabled(action('disable'), false)
    const priceOutput = output('price')
    if (priceOutput) priceOutput.textContent = 'Not set'
    else paintAuthoredPrice(null, 'Not set')
    paintStatusPills()
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
    clearRenderedState('Sign in to manage paid calls.')
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

  function render(value) {
    settings = value
    const service = canonicalService(value)
    explicitIntent = null
    const readiness = readinessState(value)
    const durationMatches = !service || Number(service.duration) === FIXED_DURATION_MINUTES
    const bookable = readiness.bookable && durationMatches
    const enabledInput = field('enabled')
    const titleInput = field('title')
    const priceInput = field('price')
    const durationInput = field('duration')
    const confirmedRate = displayableRate(service)

    setRadioChecked(enabledInput, Boolean(service))
    const disabledInput = disabledField()
    setRadioChecked(disabledInput, !service)
    if (titleInput) titleInput.value = service ? service.title || '' : 'Paid Consultation Call'
    if (priceInput) priceInput.value = confirmedRate ? Number(confirmedRate.price_cents) / 100 : ''
    if (durationInput) durationInput.value = String(FIXED_DURATION_MINUTES)
    clearFieldValidity()
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
    const suggestion = service ? null : importedRateSuggestion(value)
    const cardStateTarget = uiScope || root
    cardStateTarget.setAttribute('data-paid-call-card-state', service ? 'on' : 'off')
    root.setAttribute('data-paid-call-rate-source', suggestion ? 'legacy_v2' : '')
    setActionEnabled(action('save'), canSaveSettings(value))
    setActionEnabled(action('disable'), Boolean(service))
    const priceOutput = output('price')
    const displayedRate = confirmedRate || suggestion
    if (priceOutput) {
      priceOutput.textContent = displayedRate ? formatUsd(displayedRate.price_cents) : 'Not set'
    } else {
      paintAuthoredPrice(displayedRate, 'Not set')
    }
    if (!service && suggestion && priceInput) priceInput.value = Number(suggestion.price_cents) / 100
    paintStatusPills()
    setMessage(
      service
        ? Number(service.duration) !== FIXED_DURATION_MINUTES
          ? 'Update this service to the required 60-minute Paid Call duration.'
          : readiness.bookable
          ? 'Paid calls are on and bookable.'
          : 'Paid calls are saved, but a prerequisite needs attention.'
        : suggestion
          ? 'Paid calls are off. Confirm the imported V2 rate to turn them on.'
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

  async function readCanonicalSettings(expectedScope) {
    const value = await xanoRequest('/starter/paid-call-settings/get/v3', 'GET', undefined, expectedScope)
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
    const titleInput = field('title')
    const priceInput = field('price')
    const title = String((titleInput && titleInput.value) || '').trim()
    const rawPrice = String((priceInput && priceInput.value) || '').trim()
    const price = /^[0-9]+$/.test(rawPrice) ? Number(rawPrice) : NaN
    const duration = FIXED_DURATION_MINUTES
    clearFieldValidity()
    if (title.length < 3 || title.length > 80) {
      const message = 'Use a title between 3 and 80 characters.'
      reportFieldInvalid(titleInput, message)
      throw new Error(message)
    }
    if (!Number.isSafeInteger(price) || price < 1 || price > 1000) {
      const message = 'Use a whole-dollar rate from $1 to $1,000.'
      reportFieldInvalid(priceInput, message)
      throw new Error(message)
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
      const service = canonicalService(settings)
      if (explicitIntent === 'disabled') {
        const result = await disable()
        if (result) setCardEditorOpen(false)
        return result
      }
      if (!service && explicitIntent !== 'enabled') {
        if (!enabledInput || !enabledInput.checked || (disabledInput && disabledInput.checked)) {
          setCardEditorOpen(false)
          return settings
        }
      }
    }
    const result = await save()
    if (result) setCardEditorOpen(false)
    return result
  }

  async function save() {
    if (busy || activeWrite || authTransitionPending) return null
    const enabledInput = field('enabled')
    if (!canonicalService(settings) && enabledInput && !enabledInput.checked) {
      setMessage('Turn on paid calls before you save these settings.')
      return null
    }
    if (!canSaveSettings(settings)) {
      setMessage('Complete the calendar and Stripe setup before you turn on paid calls.')
      return null
    }
    const version = ++refreshVersion
    const memberId = sessionMemberId
    const write = beginWrite(memberId)
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
      write.canonical = canonical
      if (!currentRender(version, memberId)) return null
      render(canonical)
      emit('starterPaidCallWriteSuccess', { action: 'upsert', configId: saved.config_id })
      return canonical
    } catch (error) {
      write.failed = true
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
      finishWrite(write)
    }
  }

  async function refreshFromPrerequisite() {
    if (!root || !sessionMemberId) return settings
    if (busy || activeWrite || authTransitionPending) {
      prerequisiteRefreshQueued = true
      return settings
    }
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
          setMessage('Paid-call readiness could not be refreshed. Your account was not changed.')
        }
      }
      throw error
    }
  }

  async function disable() {
    if (busy || activeWrite || authTransitionPending) return null
    const service = canonicalService(settings)
    if (!service) return settings
    const version = ++refreshVersion
    const memberId = sessionMemberId
    const write = beginWrite(memberId)
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
      write.canonical = canonical
      if (!currentRender(version, memberId)) return null
      render(canonical)
      setMessage('Paid calls are off.')
      emit('starterPaidCallWriteSuccess', { action: 'disable', configId: service.config_id })
      return canonical
    } catch (error) {
      write.failed = true
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
      finishWrite(write)
    }
  }

  function authMember(value) {
    return value && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value
  }

  function waitForAuthRetry() {
    return new Promise(function (resolve) { window.setTimeout(resolve, 250) })
  }

  function showAuthRecovery() {
    setStatus('error')
    setMessage('Paid-call settings are reconnecting. Update will resume automatically.')
    setActionEnabled(action('save'), false)
    setActionEnabled(action('disable'), false)
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
        setActionEnabled(action('save'), canSaveSettings(settings))
        setActionEnabled(action('disable'), Boolean(canonicalService(settings)))
      }
      finishAuthTransition(transition)
    }
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
          clearRenderedState('Sign in to manage paid calls.')
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
          clearRenderedState('Sign in to manage paid calls.')
          return null
        }
        if (fallbackMember.id !== member.id) return loadSession(fallbackMember, false)
        return render(pendingWrite.canonical)
      }
      if (!currentRender(version, member.id)) return null
      return render(canonical)
    } catch (error) {
      if (version === refreshVersion) {
        setStatus('error')
        clearRenderedState('Paid-call settings are unavailable. Your account was not changed.')
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
    memberstack.onAuthChange(handleAuthChange)
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
    ensureAccessibilityLabels()
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
        hideNativeError()
        // The authored Update control is wired either as a plain element this
        // controller intercepts or as the native form's own submit control. The
        // native shape is gated by browser constraint validation, so gate the
        // intercepted shape the same way: the native Webflow form still owns
        // which fields are required and still shows its own validation UI.
        clearFieldValidity()
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
        if (enabledInput.checked) explicitIntent = 'enabled'
        const disabledInput = disabledField()
        setRadioChecked(enabledInput, enabledInput.checked)
        if (cardMode && enabledInput.checked) setRadioChecked(disabledInput, false)
        clearFieldValidity()
        if (!enabledInput.checked && canonicalService(settings)) {
          setMessage('Use Turn off paid calls to disable the active service safely.')
        }
      })
    }
    const disabledInput = disabledField()
    if (disabledInput) {
      disabledInput.addEventListener('change', function () {
        if (disabledInput.checked) explicitIntent = 'disabled'
        setRadioChecked(disabledInput, disabledInput.checked)
        if (disabledInput.checked) setRadioChecked(enabledInput, false)
        clearFieldValidity()
      })
    }
    VALIDATED_FIELD_NAMES.forEach(function (name) {
      const input = field(name)
      if (!input) return
      input.addEventListener('input', function () {
        setFieldValidity(input, '')
      })
    })
    bindOpenAction()
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
      watchUiScope()
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
