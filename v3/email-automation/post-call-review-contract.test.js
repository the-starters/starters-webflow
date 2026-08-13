const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const contract = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'post-call-review-v1.json'), 'utf8'),
)

test('post-call review email contract produces the stable CTA', () => {
  assert.equal(contract.contract_version, 1)
  assert.equal(contract.release_mode, 'configuration_only_no_send_no_activation')
  assert.deepEqual(contract.sender, {
    name: 'The Starters',
    email: 'hello@thestarters.com',
  })
  assert.deepEqual(contract.personalization, {
    brand_name_field: 'brand_first_name',
    starter_name_field: 'starter_first_name',
    name_policy: 'first_name_only',
  })

  const url = new URL(contract.cta.path, 'https://www.thestarters.com')
  url.searchParams.set(contract.cta.booking_query_parameter, 'booking/email 42')
  for (const [name, value] of Object.entries(contract.cta.utm)) {
    url.searchParams.set(name, value)
  }
  url.hash = contract.cta.fragment

  assert.equal(
    url.href,
    'https://www.thestarters.com/brand-dashboard?review_booking=booking%2Femail+42' +
      '&utm_source=mandrill&utm_medium=email&utm_campaign=v3_call_scheduling' +
      '&utm_content=post_call_review#calls-section',
  )
})
