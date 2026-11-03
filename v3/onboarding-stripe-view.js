(function (global) {
  'use strict'

  const inProgress = 'You’ve started your Stripe account. You can finish onboarding while Stripe checks your details.'
  const states = {
    opened: {
      tag: 'Waiting for Stripe',
      body: inProgress,
      'status-text': 'Finish the steps in the Stripe tab. This page updates when you’re back.',
      'retry-lead': 'Didn’t open?',
      'retry-label': 'Open Stripe again',
    },
    pending: {
      tag: 'Verifying',
      body: inProgress,
      'status-text': 'Usually a few minutes, sometimes up to a day. We’ll email you if Stripe needs anything else.',
      'retry-lead': 'Stuck in Stripe?',
      'retry-label': 'Reopen it',
    },
    ready: {
      tag: 'Connected',
      body: 'Invoices and paid calls pay out to your bank through Stripe.',
      'status-text': 'Payouts are on. You can turn on paid calls.',
    },
  }

  function render(root, state) {
    if (state !== 'none' && !Object.hasOwn(states, state)) return false
    const card = root.querySelector('[data-onboarding-stripe-element="card"]')
    if (!card) return false
    root.setAttribute('data-onboarding-stripe-state', state)
    card.hidden = state === 'none'
    for (const confirm of root.querySelectorAll('[data-onboarding-stripe-element="confirm"]')) {
      confirm.hidden = card.hidden
    }
    if (card.hidden) return true

    for (const [name, copy] of Object.entries(states[state])) {
      const output = card.querySelector('[data-onboarding-stripe-output="' + name + '"]')
      if (output) output.textContent = copy
    }

    const tag = card.querySelector('[data-onboarding-stripe-output="tag"]')
    if (state === 'ready') tag?.setAttribute('data-tone', 'ok')
    else tag?.removeAttribute('data-tone')
    const retry = card.querySelector('[data-onboarding-stripe-element="retry"]')
    if (retry) retry.hidden = state === 'ready'
    return true
  }

  function canContinue(root) {
    const confirm = root.querySelector('[data-onboarding-stripe-element="confirm"] input[type="checkbox"]')
    return Boolean(confirm?.checked && Object.hasOwn(states, root.getAttribute('data-onboarding-stripe-state')))
  }

  const api = { render, canContinue }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else if (
    global.location.origin === 'https://the-starters-3-0.webflow.io' &&
    global.location.pathname.replace(/\/$/, '') === '/starter-onboarding-test' &&
    !global.StarterOnboardingStripeView
  ) {
    global.StarterOnboardingStripeView = api
  }
})(typeof window === 'undefined' ? globalThis : window)
