const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const staging = 'https://the-starters-3-0.webflow.io'
const production = ['https://www.thestarters.com', 'https://thestarters.com']
const lookalikes = [
  'https://the-starters-3-0.webflow.io.example.org', 'http://the-starters-3-0.webflow.io',
  'https://the-starters-3-0.webflow.io:8443', 'https://www.thestarters.com.example.org',
  'http://www.thestarters.com', 'https://www.thestarters.com:8443', 'https://hirethestarters.com',
]
const guardSrc = 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@044e624e/v3/staff-preview-guard.js'
const scripts = [
  ['profile-calls-step', 'StarterProfileCallsStep', [
    '/build-profile/full-profile-test', '/build-profile/consult-test', '/starter-edit-profile-test', '/build-profile-form-test',
  ], true],
  ['onboarding-stripe-view', 'StarterOnboardingStripeView', ['/starter-onboarding-test', '/starter-onboarding-v2'], true],
  ['starter-setup-gate-view', 'StarterSetupGateView', ['/all-modals'], false],
]

function loader(script, api) {
  const source = fs.readFileSync(require.resolve('./' + script), 'utf8')
  return function load(url, { guard = false } = {}) {
    let listeners = 0
    const window = {
      location: new URL(url),
      document: {
        readyState: 'loading',
        addEventListener() { listeners++ },
        querySelector(selector) {
          return guard && selector === 'script[src*="/v3/staff-preview-guard.js"]' ? { src: guardSrc } : null
        },
      },
    }
    vm.runInNewContext(source, { window })
    vm.runInNewContext(source, { window })
    return { api: window[api], listeners }
  }
}

for (const [script, api, paths, productionForStaff] of scripts) {
  const load = loader(script, api)
  const listenerCount = script === 'profile-calls-step' ? 1 : 0
  const none = { api: undefined, listeners: 0 }

  test(script + ' activates on its exact HTTPS staging routes', () => {
    for (const path of paths) {
      const allowed = load(staging + path + '?qa=1')
      assert.ok(allowed.api, api)
      assert.equal(allowed.listeners, listenerCount)
      assert.deepEqual(load(staging + path + '/other'), none)
    }
    assert.deepEqual(load(staging + '/starter-dashboard'), none)
  })

  test(script + (productionForStaff ? ' activates on production only with the staff guard' : ' stays off production'), () => {
    for (const origin of production) {
      for (const path of paths) {
        assert.deepEqual(load(origin + path), none, 'no guard: ' + origin + path)
        const guarded = load(origin + path, { guard: true })
        if (productionForStaff) {
          assert.ok(guarded.api, origin + path)
          assert.equal(guarded.listeners, listenerCount)
        } else {
          assert.deepEqual(guarded, none)
        }
      }
      assert.deepEqual(load(origin + '/starter-dashboard', { guard: true }), none)
      assert.deepEqual(load(origin + '/starter-onboarding', { guard: true }), none)
    }
  })

  test(script + ' never activates on lookalike or downgraded origins', () => {
    for (const origin of lookalikes) {
      for (const path of paths) assert.deepEqual(load(origin + path, { guard: true }), none, origin + path)
    }
  })
}
