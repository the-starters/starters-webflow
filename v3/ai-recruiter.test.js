const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'ai-recruiter.js'), 'utf8')

function load() {
  const window = { crypto: { randomUUID: () => 'test-id' } }
  vm.runInNewContext(source, { window, document: undefined, console, setTimeout, clearTimeout })
  return window.StartersAIRecruiter
}

test('only paid and test Brand plans are recruiter eligible', () => {
  const api = load()
  const member = (planId) => ({ planConnections: [{ planId, status: 'ACTIVE' }] })
  assert.equal(api.roleForMember(member('pln_new-paid-plan-463h04ph')), 'brand-paid')
  assert.equal(api.roleForMember(member('pln_dorxata-test-brand-plan-777r02pa')), 'brand-paid')
  assert.equal(api.roleForMember(member('pln_free-plan-f6kn0dxz')), 'brand-free')
  assert.equal(api.roleForMember(member('pln_dorxata-test-free-plan-dvcg0k8o')), 'ineligible')
  assert.equal(api.roleForMember(null), 'ineligible')
})

test('inactive plans do not grant recruiter access', () => {
  const api = load()
  assert.equal(api.roleForMember({
    planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', status: 'CANCELED' }],
  }), 'ineligible')
})

test('response normalization caps candidates and removes invalid canonical IDs', () => {
  const api = load()
  const response = api.normalizeResponse({
    status: 'recommendations',
    message: 'Matches',
    trace_id: 'trace',
    session_id: 'session',
    retryable: false,
    top_candidates: [
      { freelancer_v3_id: 1 },
      { freelancer_v3_id: 0 },
      { freelancer_v3_id: 2 },
      { freelancer_v3_id: 3 },
      { freelancer_v3_id: 4 },
    ],
  })
  assert.deepEqual(response.top_candidates.map((item) => item.freelancer_v3_id), [1, 2])
})

test('browser script contains only the authenticated Xano boundaries', () => {
  assert.match(source, /api:g1vmSLWh/)
  assert.match(source, /api:opp30/)
  assert.doesNotMatch(source, /supabase\.co|app\.n8n\.cloud|api\.openai\.com|hook\./i)
  assert.doesNotMatch(source, /api[_-]?key|service[_-]?role|bearer\s+[a-z0-9]/i)
})

test('controller binds native templates and never constructs HTML strings', () => {
  assert.match(source, /message-template/)
  assert.match(source, /candidate-template/)
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|createElement\s*\(/)
})
