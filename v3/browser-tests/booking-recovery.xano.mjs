import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

assert.equal(process.argv[2], '--run', 'Explicit --run is required for isolated synthetic writes')
const base = process.env.PAID_CALL_XANO_BASE
const secret = process.env.PAID_CALL_HARNESS_KEY
assert.equal(process.env.PAID_CALL_WORKSPACE_APPROVED, 'paid-call-card-selection-test-20260915')
assert.match(base || '', /^https:\/\/[^/]+\/api:paid-card-isolated-booking-20260915(?::v1)?$/)
assert.ok(secret && secret.length >= 32)
const runId = randomBytes(6).toString('hex')
const evidence = { run_id: runId, cases: [] }
async function post(path, body, headers = {}) {
  const result = await fetch(base + path, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  return { status: result.status, data: await result.json() }
}
function good(result) {
  assert.equal(result.status, 200, `Unexpected response: ${JSON.stringify(result)}`)
  return result.data
}
const control = async (action, payload = {}) => good(await post('/test-harness/control', { action, run_id: runId, payload }, { 'X-Paid-Call-Harness': secret }))
const seed = await control('seed')
const start = Math.floor((Date.now() - 86400000) / 60000) * 60000
const input = { starter_slug: seed.starter_slug, config_id: seed.config_id, start, end: start + 1800000,
  timezone: 'UTC', topic: '', context: '', guest_emails: [], expected_payment_method_id: seed.card_a, idempotency_key: runId + '-past' }
const headers = { Origin: 'https://the-starters-3-0.webflow.io', Authorization: 'Bearer ' + seed.token }
const request = (changes = {}, auth = headers) => post('/brand/booking/request/v3', { ...input, ...changes }, auth)
const rejected = (result, message) => {
  assert.ok(result.status >= 400 && result.status < 500, `Expected rejection: ${JSON.stringify(result)}`)
  assert.match(result.data.message, message)
}
const fingerprint = createHash('sha256').update([seed.brand_member, seed.starter_member, seed.config_id, input.start,
  input.end, input.timezone, '', '', 'test', ''].join('|') + '|payment_method=' + seed.card_a).digest('hex')
try {
  rejected(await request(), /Booking details are invalid/)
  assert.equal((await control('inspect')).commands.length, 0)
  evidence.cases.push('past fresh request rejected before command creation')
  const booking = await control('upsert', { booking_id: runId + '-booking', booking_ref: runId + '-ref', config_id: seed.config_id,
    grant_id: seed.grant_id, start: input.start, end: input.end, starter_memberstack_id: seed.starter_member,
    brand_memberstack_id: seed.brand_member, nylas_request_id: '', event_id: '', meeting_link: '', call_context: '',
    unique_id: input.idempotency_key, participants: [], payment_environment: 'test', expected_configuration_revision: 1,
    expected_amount_cents: 2500, expected_duration: 30, expected_destination_account: seed.destination,
    expected_customer_id: seed.customer, expected_payment_method_id: seed.card_a })
  const safeResult = { ...booking, payment_method_id: seed.card_a, payment_method: { id: seed.card_a, brand: 'visa', last4: '0042' } }
  await control('command-add', { idempotency_key: input.idempotency_key, actor_memberstack_id: seed.brand_member,
    booking_id: booking.booking_id, safe_result: safeResult })
  const patchCommand = patch => control('command-patch', { key: input.idempotency_key, patch })
  await patchCommand({ status: 'completed', request_fingerprint: fingerprint, safe_result: safeResult })
  const completed = good(await request())
  assert.deepEqual(completed.booking, safeResult)
  assert.equal(completed.duplicate, true)
  evidence.cases.push('completed Paid command replays after start with original card')
  rejected(await request({ context: 'changed' }), /different booking request/)
  rejected(await request({ expected_payment_method_id: seed.card_b }), /different booking request/)
  rejected(await request({}, { ...headers, Origin: 'https://www.thestarters.com' }), /environment/)
  const unauthenticated = await request({}, { Origin: headers.Origin })
  assert.ok(unauthenticated.status === 401 || unauthenticated.status === 403)
  await patchCommand({ actor_memberstack_id: 'mem_sb_other_fixture' })
  rejected(await request(), /different booking request/)
  await patchCommand({ actor_memberstack_id: seed.brand_member, data_environment: 'production' })
  rejected(await request(), /reconciliation/)
  await patchCommand({ data_environment: 'test', status: 'reconciliation_required' })
  await control('default', { card: seed.card_b })
  const reconciled = good(await request())
  assert.equal(reconciled.recovered, true)
  assert.equal(reconciled.booking.booking_id, booking.booking_id)
  assert.equal(reconciled.booking.payment_method_id, seed.card_a)
  evidence.cases.push('past reconciliation preserves original Paid snapshot after default changes')
  await patchCommand({ status: 'reconciliation_required' })
  await control('booking-patch', { booking_id: booking.booking_id, patch: { data_environment: 'production' } })
  rejected(await request(), /reconciliation does not match/)
  await control('booking-patch', { booking_id: booking.booking_id, patch: { data_environment: 'test' } })
  const patchBooking = patch => control('booking-patch', { booking_id: booking.booking_id, patch })
  await patchCommand({ status: 'reconciliation_required', safe_result: {
    claimed_payment_method_id: seed.card_a, claimed_customer_id: seed.customer
  } })
  await control('configuration-patch', { patch: { price_cents: 5000, price: 50, duration: 60, revision: 2 } })
  await patchBooking({ status: 'confirmed', from_pending: false, payment_status: 'intent_created', payment_revision: 1 })
  for (const [patch, restore, message] of [
    [{ brand_data: { memberstack_id: 'mem_sb_foreign' } }, { brand_data: { memberstack_id: seed.brand_member } }, /reconciliation does not match/],
    [{ stripe_payment_method_id_snapshot: seed.card_b }, { stripe_payment_method_id_snapshot: seed.card_a }, /snapshot does not match/],
    [{ stripe_customer_id_snapshot: 'cus_foreign' }, { stripe_customer_id_snapshot: seed.customer }, /snapshot does not match/],
    [{ start: input.start - 60000 }, { start: input.start }, /reconciliation does not match/]
  ]) {
    await patchBooking(patch)
    rejected(await request(), message)
    await patchBooking(restore)
  }
  const accepted = good(await request())
  assert.equal(accepted.recovered, true)
  assert.equal(accepted.booking.booking_id, booking.booking_id)
  assert.equal(accepted.booking.status, 'confirmed')
  assert.equal(accepted.booking.amount_cents, 2500)
  assert.equal(accepted.booking.start, input.start)
  assert.equal(accepted.booking.end, input.end)
  assert.equal(accepted.booking.payment_method_id, seed.card_a)
  evidence.cases.push('accepted booking reconciles at original price and duration after service changes')
  evidence.cases.push('foreign actor, customer, card and slot snapshots are rejected')
  const future = Date.now() + 86400000
  const fresh = { idempotency_key: runId + '-fresh', start: future, end: future + 1800000 }
  rejected(await request(fresh), /service duration/)
  await control('configuration-patch', { patch: { price_cents: 50 } })
  rejected(await request({ ...fresh, end: future + 3600000 }), /payment readiness/)
  await control('configuration-patch', { patch: { price_cents: 5000, active: false } })
  rejected(await request({ ...fresh, end: future + 3600000 }), /service was not found/)
  evidence.cases.push('fresh requests retain current duration, price and active-service validation')
  const final = await control('inspect')
  assert.equal(final.commands.length, 1)
  assert.equal(final.bookings.length, 1)
  evidence.cases.push('fingerprint, actor, Origin, auth and command/booking environment guards retained')
  evidence.status = 'passed'
} finally {
  await writeFile(process.env.PAID_CALL_RECOVERY_EVIDENCE || 'booking-recovery-results.json', JSON.stringify(evidence, null, 2))
}
console.log('PASS: ' + evidence.cases.join('; '))
