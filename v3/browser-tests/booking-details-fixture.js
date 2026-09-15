// All network boundaries are synthetic. The controllers and renderer are real.
window.fixture = { requests: [], bookings: [], failBookings: 0, installs: {} }
const fixtureApi = window.StartersPaidCallBrandPayment
const fixtureParams = new URLSearchParams(location.search)
const fixturePopup = document.querySelector('[popup-booking]')
const fixtureConfig = paid => ({ config_id: paid ? 'fixture-paid' : 'fixture-free',
  grant_id: 'fixture-grant', duration: paid ? 60 : 30, price_cents: paid ? 25000 : 0,
  currency: 'USD', is_paid: paid, active: true, payment_environment: 'test' })
window.xanoAuthFetch = async (url, options) => {
  const parsed = new URL(url)
  fixture.requests.push({ path: parsed.pathname, method: options.method })
  let body
  if (parsed.pathname.endsWith(fixtureApi.AVAILABILITY_PATH)) {
    const start = Number(parsed.searchParams.get('start_time')) + 86400
    const duration = parsed.searchParams.get('configuration_id') === 'fixture-paid' ? 3600 : 1800
    body = { time_slots: [0, 7200, 86400].map(offset => ({ start_time: start + offset, end_time: start + offset + duration })) }
  } else if (parsed.pathname.endsWith(fixtureApi.READINESS_PATH)) {
    body = { bookable: true, environment: 'test' }
  } else if (parsed.pathname.endsWith(fixtureApi.BOOKING_PATH)) {
    const payload = JSON.parse(options.body)
    fixture.bookings.push(payload)
    if (fixture.failBookings > 0) { fixture.failBookings--; throw new Error('Synthetic ambiguous booking response') }
    body = { booking: { booking_id: 'fixture-provider', row_id: 71 } }
  } else throw new Error('Unexpected fixture request: ' + parsed.pathname)
  return { ok: true, status: 200, json: async () => body }
}
if (fixtureParams.has('legacy')) {
  document.querySelector('#legacy-host').innerHTML = '<div data-call-guest-fields><div data-call-guest-list>' +
    Array.from({ length: fixtureParams.has('partial') ? 4 : 5 }, (_, i) => '<div data-call-guest-row><input type="email" aria-label="Authored guest ' + (i + 1) + '" data-call-guest-email><button type="button" data-call-guest-remove>Remove</button></div>').join('') +
    '</div><button type="button" data-call-guest-add>Add guest</button><p data-call-guest-error role="alert"></p></div>'
}
const fixtureSettings = paid => ({ config: fixtureConfig(paid), grantId: 'fixture-grant',
  starterSlug: 'fixture-starter', brandName: 'Brand Fixture', brandEmail: 'brand@example.invalid',
  starterEmail: 'starter@example.invalid', bookingApi: fixtureApi })
fixture.installs.free = window.StartersFreeCallBooking.installFreeBookingController(fixtureSettings(false))
fixture.installs.paid = fixtureApi.installPaidBookingController(fixtureSettings(true))
document.querySelector('#close').addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('modal-close', { detail: { modal: fixturePopup } }))
})
fixture.mountReschedule = async () => {
  fixturePopup.style.display = 'none'
  return fixtureApi.mountPaidCalendar({ container: document.querySelector('#reschedule'), config: fixtureConfig(false),
    confirmText: 'Propose new time', onConfirm: async slot => { fixture.reschedule = slot } })
}
fixture.ready = true
