window.__tsSchedulingAuthFetch = () => {}
window.StartersPaidCallBrandPayment = {}
window.lumos = { modal: { list: { 'popup-booking-main': { close() {} }, 'popup-booking': { close() {} } } } }
window.StartersFreeCallBooking = {
  STARTER_PATH: '/starter', CONFIGS_PATH: '/configs',
  selectBookableConfigurations: records => records,
  authenticatedRequest: async () => { throw Object.assign(Error('calendar absent'), { status: 404, data: { message: 'Bookable Starter calendar not found' } }) }
}
window.controller = StartersMessagesCalls.install({
  member: { id: 'mem_brand', planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', active: true }] },
  inbox: { onConversationSelected(fn) { window.selectConversation = fn } },
  identity: { prefetch: async () => 'published-starter' }
})
window.ready = selectConversation({ conversation: { id: 'a' }, others: [{ id: 'mem_a' }] }).then(() => { window.fixtureReady = true })
