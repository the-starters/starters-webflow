/*!
 * Opportunities 3.0 — Create-page controller
 * Page: /opportunities---create
 * ------------------------------------------------------------------
 * Binds the brand "create opportunity" form to Xano `brand/opportunities/create`
 * via the shared core (window.Opp30 from opportunities-3.0.js).
 *
 * Load order (page footer), AFTER the existing Memberstack + Xano scripts:
 *   1. opportunities-3.0.js        (shared core — exposes window.Opp30)
 *   2. opportunities---create.js   (this file)
 *
 * Conventions: see product-workflows/opportunities/docs/wf-js-guide.md
 * ------------------------------------------------------------------
 */
;(function () {
  'use strict'

  /**
   * Run-once guard. Shared flag with the core's standalone create handler so the
   * form is never double-bound if both scripts load on the same page.
   */
  if (window.__opp30CreatePage) return
  window.__opp30CreatePage = true

  /** Verbose console logging during rollout; flip to false for production quiet. @type {boolean} */
  const DEBUG_LOG = true

  /**
   * Namespaced console logger; no-op unless DEBUG_LOG.
   * @param {...unknown} args
   * @returns {void}
   */
  const log = (...args) => {
    if (DEBUG_LOG) console.info('[opp30:create]', ...args)
  }

  /** Project-Type radio `id` -> the human string Xano stores. @type {Record<string, string>} */
  const PROJECT_TYPE = {
    'One-Time': 'One Time',
    'Ongoing-Part-Time': 'Ongoing Part Time',
    'Full-Time': 'Full Time',
  }
  /** project_type -> budget_frequency. @type {Record<string, string>} */
  const BUDGET_FREQUENCY = {
    'One Time': 'project',
    'Ongoing Part Time': 'month',
    'Full Time': 'year',
  }
  /** project_type -> the visible budget input's `name`. @type {Record<string, string>} */
  const BUDGET_FIELD = {
    'One Time': 'One-Time-Budget',
    'Ongoing Part Time': 'Part-Time-Budget',
    'Full Time': 'Full-Time-Budget',
  }

  /**
   * Resolve the create form. Prefers the data-attribute hook (add this in Webflow);
   * falls back to the id/class so the page keeps working until the attribute exists.
   * @returns {HTMLFormElement | null}
   */
  const getForm = () =>
    /** @type {HTMLFormElement | null} */ (
      document.querySelector('[data-opp-form="create"]') ||
      document.querySelector('#opportunities-create-form') ||
      document.querySelector('#email-form.create-opportunities_layout') ||
      document.querySelector('#email-form')
    )

  /**
   * Build the Xano create payload from the form's field `name`s.
   * `est_project_duration` reads the radio VALUE (e.g. "≤ 1 months"), not its id.
   * @param {HTMLFormElement} form
   * @returns {{title:string, description:string, exp_requirements:string, role_name:string, project_type:string, est_project_duration:string, budget:string, budget_frequency:string}}
   */
  const readForm = (form) => {
    /** @param {string} name @returns {string} */
    const val = (name) => {
      const el = form.querySelector(`[name="${name}"]`)
      return el ? el.value.trim() : ''
    }
    /** @param {string} name @returns {HTMLInputElement | null} */
    const checked = (name) =>
      /** @type {HTMLInputElement | null} */ (form.querySelector(`[name="${name}"]:checked`))
    /**
     * Reads native multi-fields plus optional custom chip hooks and returns a
     * comma-separated value for Xano's server-side role resolver.
     * @param {string} name
     * @returns {string}
     */
    const multiVal = (name) => {
      /** @type {string[]} */
      const values = []
      const seen = new Set()
      /** @param {unknown} raw @returns {void} */
      const add = (raw) => {
        String(raw || '')
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
          .forEach((part) => {
            const key = part.toLowerCase()
            if (!seen.has(key)) {
              seen.add(key)
              values.push(part)
            }
          })
      }

      Array.from(form.querySelectorAll(`[name="${name}"]`)).forEach((el) => {
        if (el instanceof HTMLSelectElement && el.multiple) {
          Array.from(el.selectedOptions).forEach((opt) => add(opt.value || opt.textContent))
          return
        }
        if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) {
          if (el.checked) add(el.value)
          return
        }
        if ('value' in el) add(/** @type {{value: string}} */ (el).value)
      })

      Array.from(form.querySelectorAll('[data-opp-role-value][aria-selected="true"], [data-opp-role-value].is-selected, [data-opp-role-value].w--current')).forEach((el) => {
        add(el.getAttribute('data-opp-role-value') || el.textContent)
      })

      return values.join(', ')
    }

    const ptEl = checked('Project-Type')
    const project_type = ptEl ? PROJECT_TYPE[ptEl.id] || ptEl.value : ''
    const durEl = checked('Duration')
    return {
      title: val('Opportunity-title'),
      description: val('Description'),
      exp_requirements: val('Requirements'),
      role_name: multiVal('Role-option'),
      project_type,
      est_project_duration: durEl ? durEl.value : '',
      budget: project_type
        ? val(BUDGET_FIELD[project_type])
        : val('One-Time-Budget') || val('Part-Time-Budget') || val('Full-Time-Budget'),
      budget_frequency: BUDGET_FREQUENCY[project_type] || '',
      // Server sets brand_memberstack_id / brands_reference / company / status from $auth.
    }
  }

  /**
   * Lightweight auth presence check. Brand-type identity is enforced server-side.
   * @returns {Promise<boolean>}
   */
  const ensureMember = async () => {
    const ms = window.$memberstackDom
    if (!ms) {
      log('Memberstack not present')
      return false
    }
    const { data: member } = await ms.getCurrentMember()
    if (!member || !member.id) {
      location.href = '/login'
      return false
    }
    return true
  }

  /**
   * Bind the submit handler. Capture phase + stopPropagation stops Webflow's own
   * (bubble-phase) submit handler, and preventDefault stops the native GET reload.
   * @param {HTMLFormElement} form
   * @returns {void}
   */
  const bindForm = (form) => {
    const statusEl = document.querySelector('[data-opp-create-status]')
    let submitting = false
    /** @param {string} msg @returns {void} */
    const say = (msg) => {
      if (statusEl) statusEl.textContent = msg
      log(msg)
    }
    const btn =
      form.querySelector('[data-opp-submit="create"]') ||
      form.querySelector('input[type="submit"]') ||
      form.querySelector('[type="submit"]')

    form.addEventListener(
      'submit',
      async (e) => {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        if (submitting) return
        if (!window.Opp30 || !window.Opp30.API) return say('Core not loaded (window.Opp30 missing).')
        if (!(await ensureMember())) return

        const payload = readForm(form)
        log('payload', payload)
        if (!payload.title) return say('Please enter an opportunity title.')
        if (!payload.project_type) return say('Please choose a project type.')
        if (!payload.budget) return say('Please enter a budget.')

        submitting = true
        if (btn) {
          btn.disabled = true
          btn.style.opacity = '0.6'
        }
        say('Submitting…')
        try {
          const created = await window.Opp30.API.brandOppCreate(payload)
          log('created', created)
          say('Submitted! Your opportunity is now live.')
          location.href = '/opportunities-brands-view'
        } catch (err) {
          console.error('[opp30:create]', err)
          say((err && err.data && err.data.message) || 'Something went wrong. Please try again.')
          submitting = false
          if (btn) {
            btn.disabled = false
            btn.style.opacity = ''
          }
        }
      },
      true,
    )
    log('create form bound', form)
  }

  /** Entry point, runs once the DOM is parsed. @returns {void} */
  const init = () => {
    const form = getForm()
    if (!form) return log('no create form found on this page')
    bindForm(form)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
