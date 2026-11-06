const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const staging = 'https://the-starters-3-0.webflow.io'
const scripts = [
  ['profile-calls-step', 'StarterProfileCallsStep', [
    '/build-profile/full-profile-test', '/build-profile/consult-test', '/starter-edit-profile-test',
  ]],
  ['onboarding-stripe-view', 'StarterOnboardingStripeView', ['/starter-onboarding-test']],
  ['starter-setup-gate-view', 'StarterSetupGateView', ['/all-modals']],
]

for (const [script, api, paths] of scripts) {
  test(script + ' activates only on its exact HTTPS staging routes', () => {
    const source = fs.readFileSync(require.resolve('./' + script), 'utf8')
    function load(url) {
      let listeners = 0
      const window = {
        location: new URL(url),
        document: { readyState: 'loading', addEventListener() { listeners++ } },
      }
      vm.runInNewContext(source, { window })
      vm.runInNewContext(source, { window })
      return { api: window[api], listeners }
    }
    for (const path of paths) {
      const allowed = load(staging + path + '?qa=1')
      assert.ok(allowed.api)
      assert.equal(allowed.listeners, script === 'profile-calls-step' ? 1 : 0)
      for (const origin of ['https://www.thestarters.com', 'https://thestarters.com',
        'https://the-starters-3-0.webflow.io.example.org', 'http://the-starters-3-0.webflow.io',
        'https://the-starters-3-0.webflow.io:8443']) {
        assert.deepEqual(load(origin + path), { api: undefined, listeners: 0 })
      }
      assert.deepEqual(load(staging + path + '/other'), { api: undefined, listeners: 0 })
    }
    assert.deepEqual(load(staging + '/starter-dashboard'), { api: undefined, listeners: 0 })
  })
}
