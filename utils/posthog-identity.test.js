const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./posthog-identity.js'), 'utf8')

// Runs the real script against a stub PostHog and Memberstack, then returns
// the identify() calls it made.
async function identify(member) {
  const calls = []
  const context = {
    document: { readyState: 'complete', addEventListener() {} },
    setInterval,
    clearInterval,
    window: {},
  }
  context.window.posthog = { identify: (id, props) => calls.push({ id, props }) }
  context.window.memberReady = Promise.resolve(member)
  context.window.window = context.window
  vm.createContext(context)
  vm.runInContext(`(function (window) { ${source} })(window)`, context)
  await new Promise((resolve) => setImmediate(resolve))
  return calls
}

const active = (planId) => ({ planId, active: true, status: 'ACTIVE' })

test('a V3 Brand with only an active brand plan is labelled brand', async () => {
  // V3 Brands no longer get brands-dashboard-url once the V2 Make signup
  // scenario stops; the plan connection is the canonical role source.
  for (const planId of ['pln_free-plan-f6kn0dxz', 'pln_new-paid-plan-463h04ph']) {
    const [call] = await identify({ id: 'mem_brand', customFields: {}, planConnections: [active(planId)] })
    assert.equal(call.id, 'mem_brand')
    assert.deepEqual({ ...call.props }, { persona: 'brand', persona_brand: true, persona_freelancer: false })
  }
})

test('a Starter with only the talent plan is labelled freelancer', async () => {
  const [call] = await identify({
    id: 'mem_talent',
    customFields: {},
    planConnections: [active('pln_dorxata-test-free-plan-dvcg0k8o')],
  })
  assert.deepEqual({ ...call.props }, { persona: 'freelancer', persona_brand: false, persona_freelancer: true })
})

test('an inactive plan connection does not set a persona', async () => {
  const [call] = await identify({
    id: 'mem_lapsed',
    customFields: {},
    planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', active: false, status: 'CANCELED' }],
  })
  assert.deepEqual({ ...call.props }, { persona: 'none', persona_brand: false, persona_freelancer: false })
})

test('legacy dashboard-url custom fields still set the persona', async () => {
  const [call] = await identify({
    id: 'mem_legacy',
    customFields: { 'brands-dashboard-url': 'x', 'freelancer-dashboard-url': 'y' },
  })
  assert.deepEqual({ ...call.props }, { persona: 'both', persona_brand: true, persona_freelancer: true })
})
