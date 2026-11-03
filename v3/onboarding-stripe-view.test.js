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
