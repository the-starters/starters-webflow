/**
 * Dashboard 3.0 — Action Items panel controller (starter + brand dashboards).
 *
 * The Action Items panel is shared infrastructure: feature scripts (Stripe
 * Connect, calendar, projects, future sections) own their individual rows and
 * show/hide them; this controller owns only the panel chrome — the loading
 * card, the "all caught up" empty card, and the live count badge. It never
 * shows, hides, or edits a feature row.
 *
 * Designer wiring (grammar authored on the brand dashboard):
 *   data-action-element="wrapper"  — panel scope root (optional; falls back
 *                                    to document when absent)
 *   data-action-element="list"     — list container (informational)
 *   data-action-element="loading"  — loading card, visible until first settle
 *   data-action-element="empty"    — empty-state card, visible when 0 items
 *   data-action-element="total"    — text node that receives the live count
 *   data-action-element="item"     — an actionable row. Legacy rows without
 *                                    the attribute are matched by the authored
 *                                    `.dash-hero_action-item` class instead.
 *
 * An item counts as pending when its bounding rect has height (covers
 * display:none rows, hidden ancestor groups, and empty zero-height rows).
 * The panel settles (spinner hides) at the first of: an item becoming
 * visible, a feature controller readiness event, or SETTLE_TIMEOUT_MS.
 */
;(function (global) {
  'use strict'

  const isCommonJs =
    typeof module !== 'undefined' && typeof module.exports !== 'undefined'
  if (!isCommonJs) {
    if (global.__startersActionItemsBooted) return
    global.__startersActionItemsBooted = true
  }

  const ELEMENT_ATTR = 'data-action-element'
  const ITEM_CLASS = 'dash-hero_action-item'
  const SETTLE_TIMEOUT_MS = 4000
  const SETTLE_EVENTS = [
    'starterStripeConnectReady',
    'starterStripeConnectError',
  ]
  const CHANGED_EVENT = 'actionItemsChanged'

  const COUNT_ATTR = 'data-action-items-count'

  const elementSelector = (name) => '[' + ELEMENT_ATTR + '="' + name + '"]'
  const ITEM_SELECTOR = elementSelector('item') + ', .' + ITEM_CLASS
  const CHROME_SELECTOR = [
    elementSelector('loading'),
    elementSelector('empty'),
    elementSelector('total'),
  ].join(', ')

  function isChromeCard(element) {
    const role = element.getAttribute(ELEMENT_ATTR)
    return role === 'loading' || role === 'empty'
  }

  function isPendingItem(element) {
    if (isChromeCard(element)) return false
    if (typeof element.getBoundingClientRect !== 'function') return false
    const rect = element.getBoundingClientRect()
    return !!rect && rect.height > 0
  }

  function countPendingItems(scope) {
    const matches = scope.querySelectorAll(ITEM_SELECTOR)
    let count = 0
    for (let i = 0; i < matches.length; i += 1) {
      const element = matches[i]
      // A row nested inside another matched row (a group that also carries
      // the class) must not double-count; only count leaf matches.
      if (element.querySelector && element.querySelector(ITEM_SELECTOR)) {
        continue
      }
      if (isPendingItem(element)) count += 1
    }
    return count
  }

  // A document scope has no setAttribute; the count belongs on its root
  // element so consumers and CSS can still read it.
  function countAttributeTarget(scope) {
    if (!scope) return null
    if (typeof scope.setAttribute === 'function') return scope
    return scope.body || scope.documentElement || null
  }

  function show(element, visible) {
    if (!element) return
    const hidden = !visible
    if (element.hidden !== hidden) element.hidden = hidden
    const display = visible ? '' : 'none'
    if (element.style.display !== display) element.style.display = display
  }

  function setTotal(element, count) {
    if (!element) return
    const text = String(count)
    if (element.textContent !== text) element.textContent = text
  }

  function emit(count) {
    if (
      typeof global.CustomEvent !== 'function' ||
      typeof global.dispatchEvent !== 'function'
    ) {
      return
    }
    global.dispatchEvent(
      new global.CustomEvent(CHANGED_EVENT, { detail: { count } }),
    )
  }

  function createPanel(scope) {
    const panel = {
      scope,
      loading: scope.querySelector(elementSelector('loading')),
      empty: scope.querySelector(elementSelector('empty')),
      total: scope.querySelector(elementSelector('total')),
      settled: false,
      lastCount: null,
    }

    panel.render = function render() {
      const count = countPendingItems(scope)
      if (!panel.settled && count > 0) panel.settled = true

      show(panel.loading, !panel.settled)
      show(panel.empty, panel.settled && count === 0)
      setTotal(panel.total, count)
      const countTarget = countAttributeTarget(scope)
      if (countTarget && typeof countTarget.setAttribute === 'function') {
        countTarget.setAttribute(COUNT_ATTR, String(count))
      }

      if (count !== panel.lastCount) {
        panel.lastCount = count
        emit(count)
      }
      return count
    }

    panel.settle = function settle() {
      if (panel.settled) return
      panel.settled = true
      panel.render()
    }

    return panel
  }

  function resolveScopes(doc) {
    const scopes = Array.prototype.slice.call(
      doc.querySelectorAll(elementSelector('wrapper')),
    )
    if (scopes.length) return scopes
    // Starter dashboard shipped before the wrapper attribute existed; fall
    // back to a document-wide panel when any panel chrome is authored.
    return doc.querySelector(CHROME_SELECTOR) ? [doc] : []
  }

  // Mutation bursts (Webflow IX2 writes inline styles per frame) must not run
  // a full recount each time; render is idempotent, so one per frame suffices.
  function createRenderScheduler(render) {
    let pending = false
    const run = function () {
      pending = false
      render()
    }
    return function schedule() {
      if (pending) return
      pending = true
      if (typeof global.requestAnimationFrame === 'function') {
        global.requestAnimationFrame(run)
      } else {
        global.setTimeout(run, 0)
      }
    }
  }

  function mount() {
    const doc = global.document
    const scopes = resolveScopes(doc)
    if (!scopes.length) return []

    const panels = scopes.map(createPanel)
    const renderAll = function () {
      panels.forEach(function (panel) {
        panel.render()
      })
    }

    renderAll()

    SETTLE_EVENTS.forEach(function (name) {
      global.addEventListener(name, function () {
        panels.forEach(function (panel) {
          panel.settle()
        })
      })
    })

    global.setTimeout(function () {
      panels.forEach(function (panel) {
        panel.settle()
      })
    }, SETTLE_TIMEOUT_MS)

    if (typeof global.MutationObserver === 'function') {
      const observer = new global.MutationObserver(
        createRenderScheduler(renderAll),
      )
      scopes.forEach(function (scope) {
        observer.observe(scope === doc ? doc.body || doc : scope, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['style', 'class', 'hidden'],
        })
      })
    }

    return panels
  }

  const testApi = {
    CHANGED_EVENT,
    COUNT_ATTR,
    ITEM_SELECTOR,
    SETTLE_EVENTS,
    SETTLE_TIMEOUT_MS,
    countAttributeTarget,
    countPendingItems,
    createPanel,
    createRenderScheduler,
    isPendingItem,
    mount,
    resolveScopes,
    setTotal,
    show,
  }

  if (isCommonJs) {
    module.exports = testApi
    return
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', mount, { once: true })
  } else {
    mount()
  }
})(typeof window !== 'undefined' ? window : globalThis)
