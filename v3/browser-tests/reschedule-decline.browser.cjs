// Local browser acceptance with controlled API responses; no backend mutations.
// CS17_EVIDENCE=/absolute/evidence/path node v3/browser-tests/reschedule-decline.browser.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { chromium } = require('playwright')
const root = path.resolve(__dirname, '../..')
;(async () => {
  const server = http.createServer(async (req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname)
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end()
    try {
      let body = await fs.readFile(file)
      if (file.endsWith('dashboard-request-decline.html')) {
        body = body.toString().replace(/<script>\s*window.StartersDashboardCallActions=module.exports;[\s\S]*$/, '<script>window.StartersDashboardCallActions=module.exports;</script>')
      }
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html')
      res.end(body)
    } catch { res.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    const observations = []
    for (const role of ['starter', 'brand']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
      await page.route('**/*', route => {
        const r = route.request()
        return r.method() === 'GET' && (r.url().startsWith('http://127.0.0.1:') || ['stylesheet', 'font', 'image'].includes(r.resourceType())) ? route.continue() : route.abort()
      })
      await page.goto(`http://127.0.0.1:${server.address().port}/v3/fixtures/dashboard-request-decline.html`)
      await page.evaluate(role => {
        const modal = document.querySelector('dialog')
        window.booking = { booking_id: 'cs17-' + role, config_id: 'synthetic-config', data_environment: 'test', status: 'rescheduled', rescheduled_by: role === 'brand' ? 'starter' : 'brand', start: Date.UTC(2027, 0, 18, 12), end: Date.UTC(2027, 0, 18, 12, 30), start_old: Date.UTC(2027, 0, 17, 12), duration: 30, price: 0, is_paid: false, brand_data: { name: 'Example Brand', memberstack_id: 'synthetic-brand', timezone: 'UTC' }, starter_data: { name: 'Example Starter', memberstack_id: 'synthetic-starter', timezone: 'UTC' } }
        window.requests = []
        window.responseStatus = 'confirmed'
        window.xanoAuthFetch = async (url, options) => {
          requests.push({ url, body: JSON.parse(options.body) })
          return { ok: true, json: async () => ({ reschedule_decline: { booking_id: booking.booking_id, status: responseStatus, start: Date.UTC(2027, 0, 17, 12), end: Date.UTC(2027, 0, 17, 12, 30) } }) }
        }
        StartersDashboardCallActions.wire({ document, role, getBooking: () => booking, refreshDetail: (target, row) => fixtureCalls.populateDetailModal(target, row, role) })
        fixtureCalls.openBookingDetail(modal, booking, role)
      }, role)
      const control = page.locator('dialog [booking-action-btn="reschedule-decline"]:visible').first()
      assert.equal((await control.innerText()).toLowerCase(), 'cancel call')
      if (process.env.CS17_EVIDENCE) {
        await fs.mkdir(process.env.CS17_EVIDENCE, { recursive: true })
        await page.screenshot({ path: path.join(process.env.CS17_EVIDENCE, role + '-cancel-action.png') })
      }
      await control.click()
      await page.waitForFunction(() => requests.length === 1 && document.querySelector('[role="alert"]')?.textContent)
      assert.equal(await page.evaluate(() => booking.status), 'rescheduled')
      await page.evaluate(() => { responseStatus = 'cancelled' })
      await control.click()
      await page.waitForFunction(() => booking.status === 'cancelled')
      const receipt = page.locator('[booking-popup-content="reschedule-declined"]')
      assert.equal(await receipt.isVisible(), true)
      assert.match(await receipt.innerText(), /Call cancelled/)
      assert.doesNotMatch(await receipt.innerText(), /keeps its original time/)
      const state = await page.evaluate(() => ({ booking, requests, receipt: document.querySelector('[booking-popup-content="reschedule-declined"]').innerText }))
      assert.equal(state.booking.start, Date.UTC(2027, 0, 17, 12))
      assert.equal(state.requests.length, 2)
      assert.equal(state.requests[0].body.idempotency_key, state.requests[1].body.idempotency_key)
      assert.match(state.requests[1].url, /booking\/reschedule\/decline\/v3$/)
      observations.push({ role, ...state })
      if (process.env.CS17_EVIDENCE) await page.screenshot({ path: path.join(process.env.CS17_EVIDENCE, role + '-cancelled-receipt.png') })
      await page.close()
    }
    if (process.env.CS17_EVIDENCE) await fs.writeFile(path.join(process.env.CS17_EVIDENCE, 'reschedule-decline-observations.json'), JSON.stringify(observations, null, 2))
    console.log('Both roles: Cancel call rejected confirmed response, retained retry key, then displayed cancelled receipt with canonical confirmed interval. Controlled API only.')
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
})().catch(error => { console.error(error); process.exitCode = 1 })
