// Only external data/controller boundaries are faked; DOM, adapter, attribution
// and modal runtime execute unchanged in Chrome. No authenticated requests.
const params = new URLSearchParams(location.search)
const role = params.get('role') || 'anonymous'
const ownerState = params.get('owner') || 'ready'
window.qs = (s, root = document) => root.querySelector(s)
window.qsa = (s, root = document) => root.querySelectorAll(s)
window.starter_memberstack_id = 'fixture-owner'
window.stripe_charges = false
window.MEMBER = role === 'anonymous' ? {} : {
  id: role === 'owner' ? 'fixture-owner' : 'fixture-brand',
  auth: { email: 'fixture@example.invalid' },
  customFields: { 'free-user': role === 'owner' ? 'Owner' : 'Brand', 'last-name': 'Fixture' },
  planConnections: [{ planId: role === 'owner' ? 'pln_dorxata-test-free-plan-dvcg0k8o' : 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' }],
}
window.memberReady = Promise.resolve(MEMBER)
window.waitForMember = callback => memberReady.then(callback)
window.$memberstackDom = { getCurrentMember: async () => ({ data: MEMBER.id ? MEMBER : null }), onAuthChange() {} }
window.WfAlgolia = { getObject: async () => ({ rate: 0, 'retainer-enabled': false, 'profile-type': 'Consult' }) }
const configs = ['free', 'paid'].map(type => ({ config_id: `fixture-${type}`, grant_id: 'fixture-grant', is_paid: type === 'paid', active: true, data_environment: 'production', payment_environment: 'live', currency: 'USD', price_cents: type === 'paid' ? 25000 : 0, duration: type === 'paid' ? 60 : 30, sync_status: 'synced', revision: 1 }))
function settings(type) {
  if (ownerState === 'error') return Promise.reject(new Error('Synthetic lookup failure'))
  if (ownerState === 'loading') return new Promise(() => {})
  const ready = ownerState === 'ready' || (type === 'free' && ['stripe', 'stale'].includes(ownerState))
  return Promise.resolve({ data_environment: 'production', stripe_environment: 'live', readiness: {
    calendar_connected: ownerState !== 'calendar', availability_configured: true,
    free_call_enabled: ownerState !== 'off', paid_call_enabled: ownerState !== 'off',
    stripe_connect_linked: ownerState !== 'stripe', stripe_charges_enabled: ownerState !== 'stripe',
    stripe_readiness_fresh: ownerState !== 'stale', bookable: ready,
  }, services: [configs[type === 'free' ? 0 : 1]] })
}
window.bookingEntries = []
function install(type) {
  const cta = qs(`[booking-popup-open][data-type="${type}"]`)
  cta.setAttribute(type === 'free' ? 'data-free-call-v3' : 'data-paid-call-v3', 'ready')
  cta.addEventListener('click', () => {
    bookingEntries.push(type)
    qs('#booking-type').textContent = `${type === 'free' ? 'Free Call' : 'Paid Consulting Call'} booking entry`
    window.lumos.modal.list['popup-booking-main'].close()
  })
  return true
}
window.StartersFreeCallBooking = {
  getStarterByMemberId: async () => ({ nylas_grant_id: 'fixture-grant' }),
  getConfigs: async () => configs,
  getNearestSlot: async () => null,
  authenticatedRequest: path => settings(path.includes('/free-') ? 'free' : 'paid'),
  installFreeBookingController: () => install('free'),
}
window.StartersPaidCallBrandPayment = { installPaidBookingController: () => install('paid') }
window.callResult = (paid = true) => ({ items: ['free', 'paid'].map(type => ({ id: `424:call:${type}`, type, name: type === 'free' ? 'Free Call' : 'Paid Consulting Call', description: 'Fixture call offer', price: type === 'free' ? 0 : paid ? 250 : null, currency: 'USD', unit: '/session', public_available: type === 'free' || paid })) })
window.lists = {}
for (const surface of ['header', 'services']) {
  const key = `starter-call-offers-${surface}`
  const root = document.createElement('div')
  root.setAttribute('wf-xano-element', 'wrapper')
  root.setAttribute('wf-xano-instance', key)
  root.innerHTML = '<div wf-xano-element="template" data-service-card="component"></div>' + ['free', 'paid'].map(type => `<article wf-xano-item data-wf-xano-id="424:call:${type}"><div data-service-card-element="title"></div><p data-service-card-element="description"></p><span data-millify></span><div class="service-card_content-wrapper"></div><div data-call-offer-tooltip style="display:none"><span data-call-offer-tooltip-text hover-text></span><a hover-cta data-call-setup-action="calendar" starter-dashboard-url>Calendar</a><a hover-cta data-call-setup-action="stripe" stripe-connect-url>Stripe</a><a hover-cta data-call-setup-action="settings" starter-dashboard-url>Call Settings</a></div></article>`).join('')
  qs(`#${surface}`).append(root)
  const handlers = {}
  let state = { status: params.has('failed') && surface === (params.get('failed') || 'header') ? 'error' : 'success', data: callResult() }
  lists[key] = {
    root, getState: () => state,
    on(event, fn) { handlers[event] = fn; if (event === 'results') queueMicrotask(() => fn(state.data)); return this },
    emit(paid = true) { state = { status: 'success', data: callResult(paid) }; handlers.results(state.data) },
    fail() { state = { ...state, status: 'error' }; handlers.error(new Error('Synthetic refresh failure')) },
    replay() { handlers.results(state.data) },
  }
}
window.WfXano = { push: callback => callback({ get: key => lists[key] }) }
