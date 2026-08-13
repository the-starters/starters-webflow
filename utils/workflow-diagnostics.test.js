'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, 'workflow-diagnostics.js'), 'utf8')
const visualEvidence = {}

test.after(() => {
  const evidenceFile = process.env.NO_MISTAKES_VISUAL_EVIDENCE_FILE
  if (!evidenceFile || !visualEvidence.message || !visualEvidence.console) return

  const escape = (value) => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
  fs.writeFileSync(evidenceFile, `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Workflow diagnostic evidence</title>
<style>body{font:16px/1.5 system-ui;background:#f5f6f8;color:#17202a;padding:40px}.card{max-width:720px;margin:auto;background:white;border:1px solid #d8dde5;border-radius:12px;padding:24px;box-shadow:0 8px 24px #17202a18}.status{border-left:4px solid #c0392b;padding:12px 16px;background:#fff6f5}.copy{white-space:pre-wrap;background:#f1f3f5;border-radius:8px;padding:16px}</style>
<body><main class="card"><h1>Console-only workflow diagnostic</h1><p class="status">${escape(visualEvidence.message)}</p><h2>Browser console</h2><pre class="copy">${escape(visualEvidence.console)}</pre></main></body></html>\n`)
})

function load(existingStorage) {
  const stored = existingStorage || new Map()
  const tracked = []
  const copied = []
  const consoleLogs = []
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
    console: { info: (...args) => consoleLogs.push(args) },
    StartersTrack: { track: (name, properties) => tracked.push({ name, properties }) },
  }
  vm.runInNewContext(SOURCE, { window, Date, Math, Uint32Array }, { filename: 'workflow-diagnostics.js' })
  return { api: window.StartersWorkflowDiagnostics, window, stored, tracked, copied, consoleLogs }
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

test('keeps the page message clean and logs the diagnostic to the console', () => {
  const { api, copied, consoleLogs } = load()
  const receipt = api.record(api.create({
    workflow: 'starter_profile_edit',
    result: 'failed',
    stage: 'response',
    error_code: 'HTTP_ERROR',
    http_status: 500,
  }))
  const element = {}
  assert.equal(api.decorate(element, receipt), false)
  assert.equal(api.message('Could not save your profile.', receipt), 'Could not save your profile.')
  assert.equal(copied.length, 0)
  assert.equal(consoleLogs.length, 1)
  assert.equal(consoleLogs[0][0], '[Workflow diagnostic]')
  assert.equal(consoleLogs[0][1].workflow, 'starter_profile_edit')
  visualEvidence.message = api.message('Could not save your profile.', receipt)
  visualEvidence.console = api.format(receipt)
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
