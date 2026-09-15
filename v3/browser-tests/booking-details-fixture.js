// All network boundaries are synthetic. The controllers and renderer are real.
Date.now = () => Date.UTC(2026, 8, 30, 12)
window.fixture = { requests: [], bookings: [], failBookings: 0, installs: {} }
fixture.defaultCard = 'pm_original'
fixture.cards = [{ id:'pm_original',brand:'visa',last4:'4242',exp_month:12,exp_year:2030 }, {id:'pm_other',brand:'mastercard',last4:'0042',exp_month:9,exp_year:2031}]
const fixtureApi = window.StartersPaidCallBrandPayment
const fixtureParams = new URLSearchParams(location.search)
const fixturePopup = document.querySelector('[popup-booking]')
const fixtureConfig = paid => ({ config_id: paid ? 'fixture-paid' : 'fixture-free',
  grant_id: 'fixture-grant', duration: paid ? 60 : 30, price_cents: paid ? 25000 : 0,
  currency: 'USD', is_paid: paid, active: true, data_environment: 'production',
  payment_environment: fixtureParams.has('entry') ? 'live' : 'test' })
const fixtureConfigs = () => [fixtureConfig(false), fixtureConfig(true)]
  .filter(config => !fixtureParams.has('only') || (config.is_paid ? 'paid' : 'free') === fixtureParams.get('only'))
const fixtureStarter = { id: 383, nylas_grant_id: 'fixture-grant', nylas_grant_email: 'starter@example.invalid' }
window.xanoAuthFetch = async (url, options) => {
  const parsed = new URL(url)
  fixture.requests.push({ path: parsed.pathname, method: options.method, body: options.body ? JSON.parse(options.body) : null })
  let body
  if (fixture.pausePath && parsed.pathname.endsWith(fixture.pausePath)) {
    fixture.waiting = true
    await new Promise(resolve => { fixture.release = resolve })
    fixture.waiting = false
  }
  if (parsed.pathname.endsWith(window.StartersFreeCallBooking.STARTER_PATH)) {
    body = fixtureStarter
  } else if (parsed.pathname.endsWith(window.StartersFreeCallBooking.CONFIGS_PATH)) {
    body = fixtureConfigs()
  } else if (parsed.pathname.endsWith(fixtureApi.AVAILABILITY_PATH)) {
    const start = Number(parsed.searchParams.get('start_time')) + 86400
    const duration = parsed.searchParams.get('configuration_id') === 'fixture-paid' ? 3600 : 1800
    body = { time_slots: [0, 7200, 86400].map(offset => ({ start_time: start + offset, end_time: start + offset + duration })) }
  } else if (parsed.pathname.endsWith(fixtureApi.READINESS_PATH)) {
    body = { bookable: fixture.cards.length > 0, environment: fixture.environment || 'test' }
  } else if (parsed.pathname.endsWith(fixtureApi.PAYMENT_METHODS_PATH)) {
    if (fixture.failList) { fixture.failList--; throw new Error('Synthetic list failure') }
    body = { environment:fixture.environment || 'test', items:fixture.cards.map(card => ({...card,is_default:card.id === fixture.defaultCard})), has_more:false,next_cursor:'' }
  } else if (parsed.pathname.endsWith(fixtureApi.SETUP_PATH)) {
    body = { client_secret:'seti_fixture_secret' }
  } else if (parsed.pathname.endsWith(fixtureApi.SET_DEFAULT_PATH)) {
    fixture.defaultCard = JSON.parse(options.body).payment_method_id
    if (fixture.failDefault) { fixture.failDefault--; throw new Error('Synthetic default response lost') }
    body = { environment:fixture.environment || 'test',bookable:true }
  } else if (parsed.pathname.endsWith(fixtureApi.BOOKING_PATH)) {
    const payload = JSON.parse(options.body)
    fixture.bookings.push(payload)
    if (payload.expected_payment_method_id && payload.expected_payment_method_id !== fixture.defaultCard) {
      return {ok:false,status:409,json:async () => ({code:'PAYMENT_METHOD_CHANGED'})}
    }
    if (fixture.unresolvedBooking) { fixture.unresolvedBooking = false; return {ok:false,status:400,json:async () => ({message:'Nylas booking creation is unresolved; reconciliation is required'})} }
    if (fixture.failBookings > 0) { fixture.failBookings--; throw new Error('Synthetic ambiguous booking response') }
    body = { booking: { booking_id: 'fixture-provider', row_id: 71, payment_method_id: 'receiptMethodId' in fixture ? fixture.receiptMethodId : payload.expected_payment_method_id,
      payment_method: fixture.receiptCard === undefined ? fixture.cards.find(card => card.id === payload.expected_payment_method_id) : fixture.receiptCard } }
  } else throw new Error('Unexpected fixture request: ' + parsed.pathname)
  return { ok: true, status: 200, json: async () => body }
}
// Stripe is a synthetic boundary: no provider calls or card numbers leave this page.
fixture.stripeFields = new Map()
window.Stripe = () => ({
  elements: options => { fixture.stripeOptions = options; return { create: (name, options) => {
    let listener
    const input = document.createElement('input')
    input.setAttribute('aria-label', name)
    input.addEventListener('input', () => listener?.({complete: input.value === 'valid'}))
    const field = { on: (event, callback) => {listener = callback}, mount: host => host.appendChild(input),
      clear: () => { input.value = ''; listener?.({complete:false}) }, destroy: () => {input.remove(); fixture.stripeFields.delete(name)},
      update: value => {fixture.lastFieldStyle = value.style} }
    fixture.stripeFields.set(name, field)
    return field
  } } },
  confirmCardSetup: async () => {
    if (fixture.failSetup) { fixture.failSetup--; return {error:{message:'Your card could not be saved.'}} }
    const card = {id:'pm_added',brand:'visa',last4:'0007',exp_month:8,exp_year:2032}
    if (!fixture.cards.some(item => item.id === card.id)) fixture.cards.push(card)
    return {setupIntent:{payment_method:card.id}}
  },
})
if (fixtureParams.has('legacy')) {
  document.querySelector('#legacy-host').innerHTML = '<form data-call-guest-fields><div data-call-guest-list>' +
    Array.from({ length: fixtureParams.has('partial') ? 4 : 5 }, (_, i) => '<div data-call-guest-row><input type="email" aria-label="Authored guest ' + (i + 1) + '" data-call-guest-email><button type="button" data-call-guest-remove>Remove</button></div>').join('') +
    '</div><button type="button" data-call-guest-add>Add guest</button><p data-call-guest-error role="alert"></p></form>'
  if (fixtureParams.has('stray')) {
    const row = document.createElement('div')
    row.id = 'stray-guest-row'
    row.setAttribute('data-call-guest-row', '')
    document.querySelector('#legacy-host').appendChild(row)
  }
  if (fixtureParams.has('nested')) {
    document.querySelector('[nylas-container]').appendChild(document.querySelector('#legacy-host'))
  }
  if (fixtureParams.has('protected')) {
    fixturePopup.querySelector('header').appendChild(document.querySelector('#close'))
    document.querySelector('#close').setAttribute('data-modal-close', '')
    const placements = {
      container: '[nylas-container]', step: '[schedule-step="default"]',
      body: '.modal_content-layout', header: 'header', close: '#close',
    }
    const target = fixturePopup.querySelector(placements[fixtureParams.get('protected')])
    target.setAttribute(['step', 'body', 'header'].includes(fixtureParams.get('protected'))
      ? 'data-call-guest-fields' : 'data-call-guest-row', '')
    const parent = target.parentNode
    fixture.protectedIntact = () => target.isConnected && target.parentNode === parent
    document.querySelector('#legacy-host [data-call-guest-fields]').style.setProperty('display', 'block', 'important')
  }
  if (fixtureParams.has('preserve')) {
    const host = document.querySelector('#legacy-host')
    host.querySelectorAll('input').forEach((field, index) => { field.value = `guest${index}@example.invalid` })
    const authored = [host, ...host.querySelectorAll('*')].map(node => ({ node, parent: node.parentNode, value: node.value }))
    fixture.authoredIntact = () => authored.every(({ node, parent, value }) => node.isConnected && node.parentNode === parent && node.value === value)
  }
}
const fixtureSettings = paid => ({ config: fixtureConfig(paid), grantId: 'fixture-grant',
  starterSlug: 'fixture-starter', starterName: 'Starter Fixture', brandName: 'Brand Fixture', brandEmail: 'brand@example.invalid',
  starterEmail: 'starter@example.invalid', bookingApi: fixtureApi })
const fixtureChooser = document.querySelector('[popup-booking-main]')
window.lumos = { modal: { list: {} } }
for (const [name, el] of [['popup-booking-main', fixtureChooser], ['popup-booking', fixturePopup], ['popup-stripe-card', document.querySelector('[popup-stripe-card]')]]) {
  lumos.modal.list[name] = {
    el,
    open() { el.showModal(); window.dispatchEvent(new CustomEvent('modal-open', { detail: { modal: el } })) },
    close() { el.close(); window.dispatchEvent(new CustomEvent('modal-close', { detail: { modal: el } })) },
  }
}
document.addEventListener('click', event => {
  const row = event.target.closest('[booking-popup-open]')
  if (row && !row.closest('[call-type-item]').hasAttribute('data-booking-unavailable')) {
    lumos.modal.list['popup-booking-main'].close()
    lumos.modal.list['popup-booking'].open()
  } else {
    const trigger = event.target.closest('[data-modal-trigger]')
    if (trigger && trigger.hasAttribute('data-modal-close')) lumos.modal.list['popup-booking'].close()
    if (trigger) lumos.modal.list[trigger.getAttribute('data-modal-trigger')]?.open()
  }
})
document.querySelector('#close').addEventListener('click', () => {
  lumos.modal.list['popup-booking'].close()
})
fixture.mountReschedule = async () => {
  fixturePopup.style.display = 'none'
  return fixtureApi.mountPaidCalendar({ container: document.querySelector('#reschedule'), config: fixtureConfig(false),
    confirmText: 'Propose new time', onConfirm: async slot => { fixture.reschedule = slot } })
}
fixture.initialize = async () => {
  const entry = fixtureParams.get('entry')
  if (fixtureParams.get('preinstall') === 'paid') fixtureApi.installPaidBookingController(fixtureSettings(true))
  if (fixtureParams.get('preinstall') === 'free') window.StartersFreeCallBooking.installFreeBookingController(fixtureSettings(false))
  if (!entry) {
    fixture.installs.free = window.StartersFreeCallBooking.installFreeBookingController(fixtureSettings(false))
    fixture.installs.paid = fixtureApi.installPaidBookingController(fixtureSettings(true))
    fixture.ready = true
    return
  }
  fixturePopup.querySelector('header').appendChild(document.querySelector('#close'))
  fixtureChooser.appendChild(document.querySelector('nav'))
  window.MEMBER = { id: 'mem_brand', auth: { email: 'brand@example.invalid' },
    customFields: { 'free-user': 'Brand', 'last-name': 'Fixture' },
    planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', active: true }] }
  window.__tsSchedulingAuthFetch = window.xanoAuthFetch
  window.fetch = async () => ({ ok: true, json: async () => ({ starter_id: 383, slug: 'fixture-starter',
    items: fixtureConfigs().map(config => ({ type: config.is_paid ? 'paid' : 'free', public_available: true })) }) })
  const load = name => new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '../' + name + '.js'
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
  if (entry === 'hire') {
    const identity = document.createElement('a')
    identity.setAttribute('messages-profile-message', 'mem_starter')
    identity.setAttribute('messages-profile-name', 'Starter Fixture')
    document.body.appendChild(identity)
    window.qs = (selector, root = document) => root.querySelector(selector)
    window.qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector))
    window.memberReady = Promise.resolve(MEMBER)
    window.waitForMember = callback => memberReady.then(callback)
    window.starter_memberstack_id = 'mem_starter'
    window.WfAlgolia = { getObject: async () => ({}) }
    await load('hire-profile')
  } else {
    await load('messages-calls')
    window.StartersMessagesCalls.install({
      member: MEMBER,
      inbox: { onConversationSelected(select) { fixture.selectConversation = select } },
      identity: { prefetch: async () => 'fixture-starter' },
    })
    await fixture.selectConversation({ conversation: { id: 'fixture-conversation' }, others: [{ id: 'mem_starter', name: 'Starter Fixture' }] })
  }
  fixture.ready = true
}
fixture.initialize()
