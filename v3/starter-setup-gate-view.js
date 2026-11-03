(function (global) {
  'use strict'

  const stripeStarted = new Set(['incomplete', 'review', 'pending', 'ready'])

  function stepsFor(status, skipped = false) {
    const steps = []
    if (!status.availability) steps.push('availability')
    if (!stripeStarted.has(status.stripe)) steps.push('stripe')
    if (steps.length && !status.calendar && !skipped) steps.splice(status.availability ? 0 : 1, 0, 'calendar')
    return steps
  }

  const mounted = new WeakMap()

  function mount(dialog) {
    if (!dialog.matches('[data-setup-gate]')) return null
    if (mounted.has(dialog)) return mounted.get(dialog)
    let status
    let plan = []
    let current
    let skipped = false

    function output(name, value) {
      const element = dialog.querySelector('[data-setup-el="' + name + '"]')
      if (element) element.textContent = value
    }

    function show(step) {
      current = step
      const index = plan.indexOf(step)
      for (const element of dialog.querySelectorAll('[data-setup-step]')) {
        element.hidden = element.getAttribute('data-setup-step') !== step
        const eyebrow = element.querySelector('[data-setup-el="eyebrow"]')
        if (eyebrow && !element.hidden) eyebrow.textContent = plan.length > 1 ? 'Step ' + (index + 1) + ' of ' + plan.length : ''
        for (const back of element.querySelectorAll('[data-setup-action="back"]')) back.hidden = index < 1
      }
      if (step === 'done') {
        if (status.availabilitySummary) output('summary-avail', status.availabilitySummary)
        output('summary-calendar', status.calendar
          ? 'Google Calendar' + (status.calendarEmail ? ' (' + status.calendarEmail + ')' : '')
          : 'Not connected. Connect it any time in Edit profile › Calls.')
        output('summary-stripe', status.stripe === 'ready'
          ? 'Connected. Payouts are on.'
          : 'Verifying. Usually a few minutes, sometimes up to a day.')
      }
      dialog.querySelector('[data-modal-scroll]')?.scrollTo?.(0, 0)
      return step
    }

    const view = {
      begin(nextStatus) {
        status = nextStatus
        plan = stepsFor(status, skipped)
        return plan.length ? show(plan[0]) : null
      },
      advance(nextStatus) {
        status = nextStatus
        const remaining = stepsFor(status, skipped)
        return show(remaining[0] || 'done')
      },
    }

    dialog.addEventListener('click', (event) => {
      if (!current) return
      const action = event.target.closest('[data-setup-action]')?.getAttribute('data-setup-action')
      const index = plan.indexOf(current)
      if (action === 'back' && index > 0) {
        event.preventDefault()
        show(plan[index - 1])
      } else if (action === 'skip-calendar' && current === 'calendar') {
        event.preventDefault()
        skipped = true
        view.advance(status)
      }
    })
    dialog.addEventListener('keydown', (event) => {
      const close = event.target.closest('[data-modal-close][role="button"]')
      if (!close || (event.key !== 'Enter' && event.key !== ' ')) return
      event.preventDefault()
      close.click()
    })
    mounted.set(dialog, view)
    return view
  }

  const api = { mount, stepsFor }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else if (
    global.location.origin === 'https://the-starters-3-0.webflow.io' &&
    global.location.pathname.replace(/\/$/, '') === '/all-modals' &&
    !global.StarterSetupGateView
  ) {
    global.StarterSetupGateView = api
  }
})(typeof window === 'undefined' ? globalThis : window)
