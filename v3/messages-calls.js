/** Messages booking adapter. TalkJS owns selection; the shared booking controllers own booking. */
;(function (global) {
  'use strict'
  const MEMBER_ID = /^mem_(?:sb_)?[A-Za-z0-9]+$/
  const CDN = 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/'
  const PUBLIC_CALLS = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/profile/starter/calls/v3'

  function isBrand(member) {
    const roles = (Array.isArray(member && member.planConnections) ? member.planConnections : [])
      .filter(p => p && (p.active === true || p.status === 'ACTIVE'))
      .map(p => p.planId)
    return !roles.includes('pln_dorxata-test-free-plan-dvcg0k8o') && roles.some(id =>
      ['pln_free-plan-f6kn0dxz', 'pln_new-paid-plan-463h04ph', 'pln_dorxata-test-brand-plan-777r02pa'].includes(id))
  }

  function selection(event, myId) {
    const conversation = event && event.conversation
    const id = conversation && conversation.id || event && event.conversationId
    if (!id) return null
    const participants = conversation && conversation.participants
    const users = Array.isArray(event.others) ? event.others : Array.isArray(participants)
      ? participants : Object.keys(participants || {}).map(id => ({ id }))
    const others = [...new Set(users.map(u => u && u.id).filter(id => id && id !== myId))]
    return others.length === 1 && MEMBER_ID.test(others[0])
      ? { conversationId: String(id), memberId: others[0] } : null
  }

  // Each selection owns its response. Clearing is synchronous, before any I/O.
  function createController(options) {
    let generation = 0
    let current = null
    let opening = false
    async function select(event) {
      const own = ++generation
      current = null
      opening = false
      options.clear()
      if (!isBrand(options.member)) return
      const target = selection(event, options.member.id)
      if (!target) return
      try {
        const result = await options.discover(target)
        if (own !== generation || !result || !result.configs.length) return
        current = { ...target, ...result }
        options.show(current)
      } catch (error) {
        if (own === generation && options.warn) options.warn(error)
      }
    }
    async function open() {
      if (!current || opening || !isBrand(options.member)) return false
      opening = true
      const own = generation
      const target = current
      try {
        // Recheck on entry: cached eligibility must never admit a disabled call.
        const result = await options.discover(target)
        if (own !== generation) return false
        if (!result || !result.configs.length) {
          current = null
          options.clear()
          return false
        }
        current = { ...target, ...result }
        return await options.open(current, () => own === generation)
      } catch (error) {
        if (own === generation) {
          current = null
          options.clear()
          if (options.warn) options.warn(error)
        }
        return false
      } finally {
        if (own === generation) opening = false
      }
    }
    return { select, open }
  }

  const loads = new Map()
  function load(name, ready) {
    if (ready()) return Promise.resolve()
    if (loads.has(name)) return loads.get(name)
    const promise = new Promise((resolve, reject) => {
      const script = global.document.createElement('script')
      const timer = global.setTimeout(() => reject(new Error('Booking dependency timed out')), 15000)
      script.src = CDN + name
      script.async = true
      script.onload = () => {
        global.clearTimeout(timer)
        if (ready()) resolve()
        else reject(new Error('Booking dependency unavailable'))
      }
      script.onerror = () => { global.clearTimeout(timer); reject(new Error('Booking dependency failed')) }
      global.document.head.appendChild(script)
    })
    loads.set(name, promise)
    promise.catch(() => loads.delete(name))
    return promise
  }

  async function dependencies() {
    await load('scheduling-auth.js', () => typeof global.__tsSchedulingAuthFetch === 'function')
    await load('paid-call-brand-payment.js', () => !!global.StartersPaidCallBrandPayment)
    await load('free-call-booking.js', () => !!(global.StartersFreeCallBooking && global.StartersFreeCallBooking.selectBookableConfigurations))
  }

  function preparePage() {
    const doc = global.document
    if (!doc) return
    doc.querySelectorAll('[booking-button-wrapper]').forEach(wrapper => {
      wrapper.setAttribute('data-messages-call-hidden', '')
      wrapper.querySelectorAll('[data-modal-trigger="popup-booking-main"]').forEach(cta => {
        cta.setAttribute('data-messages-call-trigger', '')
        cta.removeAttribute('data-modal-trigger')
      })
    })
    const style = doc.createElement('style')
    style.textContent = '[booking-button-wrapper][data-messages-call-hidden]{display:none!important}[data-booking-pass-through],[data-booking-pass-through] *{visibility:hidden!important}[data-modal-target="popup-booking"]:not([data-booking-entry="chooser"]) [data-booking-back]{display:none!important}'
    doc.head.appendChild(style)
  }

  function install(options) {
    const { inbox, member, identity } = options
    const doc = global.document
    const wrapper = doc.querySelector('[booking-button-wrapper]')
    const trigger = wrapper && wrapper.querySelector('[data-messages-call-trigger]')
    const button = trigger && trigger.querySelector('button')
    if (!wrapper || !trigger || !button || !isBrand(member) || typeof inbox.onConversationSelected !== 'function') return null
    button.setAttribute('aria-haspopup', 'dialog')
    button.setAttribute('aria-label', 'Schedule a call')
    // The native wrapper was gated to paid plans. The authenticated role check
    // owns both Brand Free and Brand Paid; Starter never enters this branch.
    wrapper.removeAttribute('data-ms-content')
    const chooser = doc.querySelector('[popup-booking-main]')
    const popup = doc.querySelector('[popup-booking]')
    const rows = Array.from(doc.querySelectorAll('[call-type-item] [booking-popup-open][data-type]'))
    const registry = () => global.lumos && global.lumos.modal && global.lumos.modal.list
    function closeDialogs() {
      for (const name of ['popup-booking-main', 'popup-booking', 'popup-stripe-card']) {
        const entry = registry() && registry()[name]
        if (entry && entry.el && entry.el.open) entry.close()
      }
      if (popup && global.StartersBookingSurfaceLifecycle) global.StartersBookingSurfaceLifecycle.reset(popup)
    }
    function clear() {
      wrapper.setAttribute('data-messages-call-hidden', '')
      button.disabled = false
      button.removeAttribute('data-conversation-id')
      closeDialogs()
      rows.forEach(cta => {
        cta.onclick = null
        cta.setAttribute('data-config', '')
        cta.removeAttribute('data-free-call-v3')
        cta.removeAttribute('data-paid-call-v3')
        const row = cta.closest('[call-type-item]')
        if (row) row.style.display = 'none'
      })
    }
    async function discover(target) {
      await dependencies()
      if (!chooser || !popup || !registry() || !registry()['popup-booking-main']) return null
      const api = global.StartersFreeCallBooking
      const starter = await api.getStarterByMemberId(target.memberId)
      if (!starter || !starter.nylas_grant_id || !Number.isInteger(Number(starter.id))) return null
      const [records, response, slug] = await Promise.all([
        api.getConfigs(starter.nylas_grant_id),
        global.fetch(PUBLIC_CALLS + '?starter_id=' + encodeURIComponent(starter.id), { cache: 'no-store' }),
        identity.prefetch(target.memberId),
      ])
      if (!response.ok || !slug) return null
      const dto = await response.json()
      if (!dto || Number(dto.starter_id) !== Number(starter.id) || dto.slug !== slug) return null
      const items = dto.items
      if (!Array.isArray(items)) return null
      const ready = new Set(items.filter(item => item.public_available === true).map(item => item.type))
      const configs = api.selectBookableConfigurations(records).filter(c => ready.has(c.is_paid ? 'paid' : 'free'))
      return { starter, slug, configs }
    }
    const controller = createController({
      member, clear, discover,
      warn: () => console.warn('[messages-calls] Call availability could not be confirmed'),
      show(target) {
        button.setAttribute('data-conversation-id', target.conversationId)
        wrapper.removeAttribute('data-messages-call-hidden')
        wrapper.style.display = 'flex'
      },
      async open(target, isCurrent) {
        if (!chooser || !popup || !registry() || !registry()['popup-booking-main']) return false
        const installed = []
        rows.forEach(cta => {
          const type = cta.getAttribute('data-type')
          const config = target.configs.find(c => (c.is_paid ? 'paid' : 'free') === type)
          cta.setAttribute('data-config', config ? config.config_id : '')
          cta.closest('[call-type-item]').style.display = 'none'
          cta.onclick = null
        })
        for (const config of target.configs) {
          const settings = {
            config, grantId: target.starter.nylas_grant_id, starterSlug: target.slug,
            starterMemberstackId: target.memberId,
            brandName: [member.customFields && member.customFields['free-user'], member.customFields && member.customFields['last-name']].filter(Boolean).join(' '),
            brandEmail: member.auth && member.auth.email,
            starterEmail: target.starter.nylas_grant_email,
          }
          const success = config.is_paid
            ? global.StartersPaidCallBrandPayment.installPaidBookingController(settings)
            : global.StartersFreeCallBooking.installFreeBookingController(settings)
          if (success === true) {
            const type = config.is_paid ? 'paid' : 'free'
            installed.push(type)
            const cta = rows.find(row => row.getAttribute('data-type') === type)
            const nearest = cta && cta.closest('[call-type-item]').querySelector('[next-available-slot]')
            if (nearest) {
              nearest.textContent = 'Loading...'
              global.StartersFreeCallBooking.getNearestSlot(settings.grantId, config.config_id).then(slot => {
                if (isCurrent() && cta.getAttribute('data-config') === config.config_id) {
                  nearest.textContent = slot ? global.StartersFreeCallBooking.nextSlotText(slot) : 'No available slots'
                }
              }).catch(() => {
                if (isCurrent() && cta.getAttribute('data-config') === config.config_id) nearest.textContent = 'Could not load availability'
              })
            }
          }
        }
        if (!isCurrent() || !installed.length) { clear(); return false }
        rows.forEach(cta => {
          const active = installed.includes(cta.getAttribute('data-type'))
          cta.closest('[call-type-item]').style.display = active ? 'block' : 'none'
        })
        const direct = installed.length === 1
        popup.setAttribute('data-booking-entry', direct ? 'direct' : 'chooser')
        if (direct) chooser.setAttribute('data-booking-pass-through', '')
        registry()['popup-booking-main'].open()
        if (direct) {
          global.setTimeout(() => {
            if (isCurrent()) rows.find(cta => cta.getAttribute('data-type') === installed[0]).click()
          }, 0)
          global.setTimeout(() => chooser.removeAttribute('data-booking-pass-through'), 500)
        }
        return true
      },
    })
    button.addEventListener('click', async () => {
      button.disabled = true
      await controller.open()
      button.disabled = false
    })
    inbox.onConversationSelected(controller.select)
    return controller
  }

  const api = { isBrand, selection, createController, install }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else {
    global.StartersMessagesCalls = api
    preparePage()
  }
})(typeof window !== 'undefined' ? window : globalThis)
