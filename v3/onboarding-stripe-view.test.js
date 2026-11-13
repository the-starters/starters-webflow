const assert = require('node:assert/strict')
const test = require('node:test')
const { render, canContinue } = require('./onboarding-stripe-view')

function element() {
  const attributes = new Map()
  return {
    hidden: true,
    textContent: '',
    getAttribute: (name) => attributes.get(name),
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
  }
}

test('Onboarding reveals confirmation after starting and preserves the retry button through status transitions', () => {
  const root = element()
  const card = element()
  const tag = element()
  const retry = element()
  const retryLabel = element()
  const confirmation = element()
  const checkbox = { checked: true }
  root.querySelector = (selector) => selector.endsWith('input[type="checkbox"]') ? checkbox : card
  root.querySelectorAll = () => [confirmation]
  card.querySelector = (selector) => ({
    '[data-onboarding-stripe-output="tag"]': tag,
    '[data-onboarding-stripe-element="retry"]': retry,
    '[data-onboarding-stripe-output="retry-label"]': retryLabel,
  })[selector]

  render(root, 'none')
  assert.equal(card.hidden, true)
  assert.equal(confirmation.hidden, true)
  assert.equal(canContinue(root), false)
  render(root, 'opened')
  assert.equal(tag.textContent, 'Waiting for Stripe')
  assert.equal(retryLabel.textContent, 'Open Stripe again')
  assert.equal(confirmation.hidden, false)
  assert.equal(canContinue(root), true)
  render(root, 'pending')
  assert.equal(retryLabel.textContent, 'Reopen it')
  assert.equal(retry.hidden, false)
  render(root, 'ready')
  assert.equal(tag.getAttribute('data-tone'), 'ok')
  assert.equal(retry.hidden, true)
  checkbox.checked = false
  assert.equal(canContinue(root), false)
  assert.equal(render(root, 'loading'), false)
  assert.equal(tag.textContent, 'Connected')
})

// Edit Profile v2 (JP 2026-11-12): the view also serves the Calls tab Stripe card.
const fs = require('node:fs')
const vm = require('node:vm')
const VIEW_SOURCE = fs.readFileSync(require.resolve('./onboarding-stripe-view.js'), 'utf8')

function bootView(pathname, { origin = 'https://www.thestarters.com', guard = true } = {}) {
  const window = {
    location: { origin, pathname },
    document: { querySelector: (sel) => (guard && sel === 'script[src*="/v3/staff-preview-guard.js"]' ? {} : null) },
  }
  vm.runInNewContext(VIEW_SOURCE, { window })
  return window.StarterOnboardingStripeView
}

test('the view boots on the Edit Profile v2 draft and the onboarding pages only', () => {
  assert.ok(bootView('/starter-edit-profile-test'))
  assert.ok(bootView('/starter-edit-profile-test', { origin: 'https://the-starters-3-0.webflow.io', guard: false }))
  assert.ok(bootView('/starter-onboarding-v2'))
  assert.equal(bootView('/starter-edit-profile-test', { guard: false }), undefined)
  assert.equal(bootView('/starter-edit-profile'), undefined)
  assert.equal(bootView('/starter-dashboard'), undefined)
})
