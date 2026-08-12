'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, 'workflow-diagnostics.js'), 'utf8')

function load(existingStorage) {
  const stored = existingStorage || new Map()
  const tracked = []
  const copied = []
  const window = {
    location: { hostname: 'the-starters-3-0.webflow.io' },
    Date,
    Math,
    Uint32Array,
    crypto: { randomUUID: () => '12345678-90ab-cdef-1234-567890abcdef' },
    sessionStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
    },
    navigator: { clipboard: { writeText: async (value) => copied.push(value) } },
    console: { info() {} },
    StartersTrack: { track: (name, properties) => tracked.push({ name, properties }) },
  }
  vm.runInNewContext(SOURCE, { window, Date, Math, Uint32Array }, { filename: 'workflow-diagnostics.js' })
  return { api: window.StartersWorkflowDiagnostics, window, stored, tracked, copied }
}

test('records an allowlisted receipt and omits arbitrary or unsafe fields', () => {
  const { api, stored, tracked } = load()
  const started = api.record(api.create({
    workflow: 'Talent Application',
    controller_version: '1.0.0',
    result: 'started',
    stage: 'request',
    request_started: true,
    email: 'private@example.com',
    request_body: { secret: true },
  }))

  assert.equal(started.workflow, 'talent_application')
  assert.equal(started.environment, 'staging')
  assert.match(started.diagnostic_id, /^WFD-TALENT_APPLI-\d{8}-12345678$/)
  assert.equal(Object.hasOwn(started, 'email'), false)
  assert.equal(Object.hasOwn(started, 'request_body'), false)
  assert.equal(stored.size, 2)
  assert.equal(tracked[0].name, 'workflow_form_submit_started')
  assert.equal(Object.hasOwn(tracked[0].properties, 'email'), false)
})

test('keeps the same diagnostic id while completing success with a safe record id', () => {
  const { api } = load()
  const started = api.create({ workflow: 'generate_invoice', result: 'started', stage: 'request' })
  const completed = api.complete(started, {
    result: 'success',
    stage: 'response',
    http_status: 200,
    duration_ms: 47.6,
    request_started: true,
    resource_type: 'invoice',
    resource_id: '127',
  })
  assert.equal(completed.diagnostic_id, started.diagnostic_id)
  assert.equal(completed.time_utc, started.time_utc)
  assert.equal(completed.http_status, 200)
  assert.equal(completed.duration_ms, 48)
  assert.equal(completed.resource_type, 'invoice')
  assert.equal(completed.resource_id, '127')
})

test('rejects unsafe error codes and record ids instead of copying their content', () => {
  const { api } = load()
  const receipt = api.create({
    workflow: 'profile',
    error_code: 'Request failed for private@example.com',
    resource_id: 'member private@example.com',
  })
  assert.equal(receipt.error_code, 'WORKFLOW_ERROR')
  assert.equal(receipt.resource_id, '')
  assert.equal(receipt.resource_type, '')
})

test('formats, copies, and decorates the visible message without form data', async () => {
  const { api, copied } = load()
  const receipt = api.record(api.create({
    workflow: 'starter_profile_edit',
    result: 'failed',
    stage: 'response',
    error_code: 'HTTP_ERROR',
    http_status: 500,
  }))
  const listeners = {}
  const attrs = {}
  const element = {
    setAttribute: (name, value) => { attrs[name] = value },
    getAttribute: (name) => attrs[name] || null,
    addEventListener: (name, handler) => { listeners[name] = handler },
  }
  assert.equal(api.decorate(element, receipt), true)
  assert.match(api.message('Could not save your profile.', receipt), /Diagnostic ID: WFD-/)
  listeners.click({ type: 'click' })
  await Promise.resolve()
  assert.equal(copied.length, 1)
  assert.match(copied[0], /Workflow: starter_profile_edit/)
  assert.doesNotMatch(copied[0], /private@example\.com/)
})

test('restores and copies a redirecting receipt on the destination page', async () => {
  const origin = load()
  const receipt = origin.api.record(origin.api.create({
    workflow: 'brand_account_build',
    result: 'success',
    stage: 'response',
    request_started: true,
  }))

  const destination = load(origin.stored)
  assert.equal(destination.api.latest('brand_account_build').diagnostic_id, receipt.diagnostic_id)
  assert.equal(destination.window.__startersWorkflowDiagnosticLast.diagnostic_id, receipt.diagnostic_id)
  assert.equal(await destination.window.copyWorkflowDiagnostic('brand_account_build'), true)
  assert.match(destination.copied[0], /Workflow: brand_account_build/)
})
