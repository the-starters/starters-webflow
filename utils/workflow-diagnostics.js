/**
 * Privacy-safe workflow diagnostics for browser-owned Webflow forms.
 *
 * The receipt is intentionally allowlisted. Do not add names, emails, form
 * answers, prices, tokens, request bodies, response bodies, or idempotency
 * keys. Controllers should pass only stable workflow metadata and canonical
 * numeric/string record IDs that are already safe for support use.
 */
;(function (global) {
  'use strict'

  if (!global || global.StartersWorkflowDiagnostics) return

  var SCHEMA = 'starters_workflow_diagnostic_v1'
  var STORAGE_PREFIX = 'starters.workflow.diagnostic.'

  function clean(value, limit) {
    return String(value == null ? '' : value).trim().slice(0, limit || 120)
  }

  function slug(value, fallback) {
    var normalized = clean(value, 80)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
    if (normalized) return normalized
    if (fallback !== undefined) return fallback
    return 'workflow'
  }

  function errorCode(value) {
    var normalized = clean(value, 64).toUpperCase()
    if (!normalized) return ''
    if (!/^[A-Z0-9_:-]+$/.test(normalized)) return 'WORKFLOW_ERROR'
    return normalized
  }

  function environment() {
    var host = clean(global.location && global.location.hostname, 120).toLowerCase()
    if (/\.webflow\.io$/.test(host)) return 'staging'
    if (host === 'thestarters.com' || host === 'www.thestarters.com') return 'production'
    return host ? 'other' : 'unknown'
  }

  function timestamp() {
    try {
      return new global.Date().toISOString()
    } catch (_) {
      return new Date().toISOString()
    }
  }

  function randomSuffix() {
    try {
      if (global.crypto && typeof global.crypto.randomUUID === 'function') {
        return global.crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
      }
      if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
        var values = new Uint32Array(1)
        global.crypto.getRandomValues(values)
        return values[0].toString(16).padStart(8, '0').slice(-8).toUpperCase()
      }
    } catch (_) {}
    return Math.random().toString(16).slice(2, 10).padEnd(8, '0').toUpperCase()
  }

  function diagnosticId(workflow, time) {
    return 'WFD-' + slug(workflow, 'workflow').slice(0, 12).toUpperCase() + '-' +
      clean(time, 10).replace(/-/g, '') + '-' + randomSuffix()
  }

  function finiteNumber(value) {
    if (value === '' || value === null || value === undefined) return null
    var number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function safeResourceId(value) {
    var normalized = clean(value, 80)
    if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) return ''
    return normalized
  }

  function normalize(input, base) {
    input = input || {}
    base = base || {}
    var workflow = slug(input.workflow || base.workflow, 'workflow')
    var time = clean(input.time_utc || base.time_utc, 40) || timestamp()
    var status = finiteNumber(input.http_status)
    var duration = finiteNumber(input.duration_ms)
    return {
      schema: SCHEMA,
      diagnostic_id: clean(input.diagnostic_id || base.diagnostic_id, 100) || diagnosticId(workflow, time),
      time_utc: time,
      controller_version: clean(input.controller_version || base.controller_version, 80) || 'unknown',
      environment: clean(input.environment || base.environment, 40) || environment(),
      workflow: workflow,
      result: slug(input.result || base.result, 'unknown'),
      stage: slug(input.stage || base.stage, 'unknown'),
      error_code: errorCode(input.error_code || ''),
      http_status: status === null ? null : Math.max(0, Math.floor(status)),
      duration_ms: duration === null ? null : Math.max(0, Math.round(duration)),
      request_started: Boolean(input.request_started),
      resource_type: slug(input.resource_type || base.resource_type, ''),
      resource_id: safeResourceId(input.resource_id),
      replayed: Boolean(input.replayed),
    }
  }

  function create(input) {
    return normalize(input)
  }

  function complete(receipt, fields) {
    var merged = Object.assign({}, receipt || {}, fields || {})
    if (!Object.prototype.hasOwnProperty.call(merged, 'diagnostic_id')) {
      merged.diagnostic_id = receipt && receipt.diagnostic_id
    }
    if (!Object.prototype.hasOwnProperty.call(merged, 'time_utc')) {
      merged.time_utc = receipt && receipt.time_utc
    }
    return normalize(merged, receipt)
  }

  function eventName(receipt) {
    if (receipt.result === 'opened') return 'workflow_form_opened'
    if (receipt.result === 'started') return 'workflow_form_submit_started'
    if (receipt.result === 'success') return 'workflow_form_submit_succeeded'
    if (receipt.stage === 'validation') return 'workflow_form_validation_failed'
    return 'workflow_form_submit_failed'
  }

  function eventProperties(receipt) {
    return {
      diagnostic_id: receipt.diagnostic_id,
      controller_version: receipt.controller_version,
      environment: receipt.environment,
      workflow: receipt.workflow,
      result: receipt.result,
      stage: receipt.stage,
      error_code: receipt.error_code || undefined,
      http_status: receipt.http_status == null ? undefined : receipt.http_status,
      duration_ms: receipt.duration_ms == null ? undefined : receipt.duration_ms,
      request_started: receipt.request_started,
      resource_type: receipt.resource_type || undefined,
      resource_id: receipt.resource_id || undefined,
      replayed: receipt.replayed,
    }
  }

  function record(receipt) {
    if (!receipt) return null
    global.__startersWorkflowDiagnosticLast = receipt
    global.__startersWorkflowDiagnostics = global.__startersWorkflowDiagnostics || {}
    global.__startersWorkflowDiagnostics[receipt.workflow] = receipt
    try {
      if (global.sessionStorage) {
        global.sessionStorage.setItem(STORAGE_PREFIX + receipt.workflow, JSON.stringify(receipt))
      }
    } catch (_) {}
    try {
      if (global.console && typeof global.console.info === 'function') {
        global.console.info('[Workflow diagnostic]', receipt)
      }
    } catch (_) {}
    try {
      if (global.StartersTrack && typeof global.StartersTrack.track === 'function') {
        global.StartersTrack.track(eventName(receipt), eventProperties(receipt))
      }
    } catch (_) {}
    return receipt
  }

  function format(receipt) {
    if (!receipt) return ''
    return [
      'The Starters workflow diagnostic',
      'ID: ' + (receipt.diagnostic_id || 'unknown'),
      'Workflow: ' + (receipt.workflow || 'unknown'),
      'Result: ' + (receipt.result || 'unknown'),
      'Time: ' + (receipt.time_utc || 'unknown'),
      'Controller: ' + (receipt.controller_version || 'unknown'),
      'Environment: ' + (receipt.environment || 'unknown'),
      'Stage: ' + (receipt.stage || 'unknown'),
      'Error code: ' + (receipt.error_code || 'none'),
      'HTTP status: ' + (receipt.http_status == null ? 'none' : receipt.http_status),
      'Duration: ' + (receipt.duration_ms == null ? 'none' : receipt.duration_ms + 'ms'),
      'Request attempted: ' + (receipt.request_started ? 'yes' : 'no'),
      'Record type: ' + (receipt.resource_type || 'none'),
      'Record ID: ' + (receipt.resource_id || 'none'),
      'Replayed: ' + (receipt.replayed ? 'yes' : 'no'),
    ].join('\n')
  }

  function latest(workflow) {
    var key = slug(workflow, '')
    if (key && global.__startersWorkflowDiagnostics && global.__startersWorkflowDiagnostics[key]) {
      return global.__startersWorkflowDiagnostics[key]
    }
    return global.__startersWorkflowDiagnosticLast || null
  }

  function copy(receiptOrWorkflow) {
    var receipt = receiptOrWorkflow && typeof receiptOrWorkflow === 'object'
      ? receiptOrWorkflow
      : latest(receiptOrWorkflow)
    var text = format(receipt)
    if (!text) return Promise.resolve(false)
    try {
      if (global.navigator && global.navigator.clipboard && typeof global.navigator.clipboard.writeText === 'function') {
        return Promise.resolve(global.navigator.clipboard.writeText(text)).then(function () { return true })
      }
    } catch (_) {}
    try {
      if (global.console && typeof global.console.info === 'function') global.console.info(text)
    } catch (_) {}
    return Promise.resolve(false)
  }

  function message(value, receipt) {
    var base = clean(value, 500)
    if (!receipt || !receipt.diagnostic_id) return base
    return base + ' Diagnostic ID: ' + receipt.diagnostic_id + '. Click this message to copy the diagnostic log.'
  }

  function decorate(element, receipt) {
    if (!element || !receipt) return false
    element.setAttribute('data-workflow-diagnostic-copy', receipt.workflow)
    element.setAttribute('data-workflow-diagnostic-id', receipt.diagnostic_id)
    element.setAttribute('role', element.getAttribute('role') || 'button')
    if (!element.getAttribute('tabindex')) element.setAttribute('tabindex', '0')
    element.setAttribute('title', 'Copy diagnostic log')
    element.__startersWorkflowDiagnosticReceipt = receipt
    if (element.__startersWorkflowDiagnosticBound || typeof element.addEventListener !== 'function') return true
    element.__startersWorkflowDiagnosticBound = true
    var activate = function (event) {
      if (event && event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return
      if (event && event.type === 'keydown' && event.preventDefault) event.preventDefault()
      copy(element.__startersWorkflowDiagnosticReceipt)
    }
    element.addEventListener('click', activate)
    element.addEventListener('keydown', activate)
    return true
  }

  global.StartersWorkflowDiagnostics = {
    schema: SCHEMA,
    create: create,
    complete: complete,
    record: record,
    format: format,
    latest: latest,
    copy: copy,
    message: message,
    decorate: decorate,
    errorCode: errorCode,
  }
  global.copyWorkflowDiagnostic = function (workflow) { return copy(workflow) }
})(window)
