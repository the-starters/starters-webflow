// Local authored UI acceptance. No production API requests or mutations.
// DECLINE_EVIDENCE=/absolute/evidence/path node v3/browser-tests/dashboard-request-decline.browser.cjs
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
    try { res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(await fs.readFile(file)) }
    catch { res.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/*', route => {
      const r = route.request()
      if (r.method() !== 'GET' || (!r.url().startsWith('http://127.0.0.1:') && !['stylesheet', 'font', 'image'].includes(r.resourceType()))) return route.abort()
      return route.continue()
    })
    await page.goto(`http://127.0.0.1:${server.address().port}/v3/fixtures/dashboard-request-decline.html`)
    const card = page.locator('#fixture-request')
    const decline = card.locator('[booking-action-btn="switch-decline"]')
    const modal = page.locator('dialog')
    const panel = modal.locator('[booking-popup-content="decline"]')
    const observations = []
    for (const paid of [false, true]) {
      await page.evaluate(paid => {
        const dialog = document.querySelector('dialog')
        if (dialog.open) dialog.close()
        fixtureCalls.openBookingDetail(dialog, { ...booking, booking_id: 'stale-booking', brand_data: { name: 'Stale Brand', memberstack_id: 'stale-brand' } }, 'starter')
        dialog.close()
        booking.is_paid = paid
        booking.price = paid ? 50 : 0
        fixtureCalls.bindCard(document.getElementById('fixture-request'), booking, 'starter')
      }, paid)
      assert.equal(await decline.isVisible(), true)
      assert.equal(await card.locator('[booking-action-btn="switch-reschedule"]').isVisible(), false)
      await decline.locator('button').click()
      assert.equal(await modal.evaluate(e => e.open), true)
      assert.equal(await modal.getAttribute('data-booking-id'), 'synthetic-booking')
      assert.equal(await panel.isVisible(), true)
      assert.equal((await panel.locator('[booking-action-btn="switch-decline-reason"]').innerText()).toLowerCase(), 'decline call')
      const text = await panel.innerText()
      assert.match(text, /Example Brand/)
      assert.doesNotMatch(text, /Stale Brand/)
      assert.match(text, paid ? /Paid Call/ : /Free Call/)
      if (paid) assert.match(text, /\$50/)
      assert.match(await panel.locator('[booking-element="brand-message-link"]').first().getAttribute('href'), /synthetic-brand/)
      observations.push({ paid, booking: await modal.getAttribute('data-booking-id'), visiblePanel: text })
      if (process.env.DECLINE_EVIDENCE) {
        await fs.mkdir(process.env.DECLINE_EVIDENCE, { recursive: true })
        await page.screenshot({ path: path.join(process.env.DECLINE_EVIDENCE, paid ? 'decline-paid.png' : 'decline-free.png') })
      }
      await panel.locator('[booking-action-btn="switch-decline-reason"] button').click()
      const reasonPanel = modal.locator('[booking-popup-content="decline-reason"]')
      assert.equal(await reasonPanel.isVisible(), true)
      assert.equal(await modal.getAttribute('data-booking-id'), 'synthetic-booking')
      assert.equal(await reasonPanel.locator('[booking-decline-reason]').isVisible(), true)
      if (process.env.DECLINE_EVIDENCE) await page.screenshot({ path: path.join(process.env.DECLINE_EVIDENCE, paid ? 'decline-reason-paid.png' : 'decline-reason-free.png') })
      await reasonPanel.locator('[booking-action-btn="switch-base"] button').click()
      assert.equal(await modal.locator('[booking-popup-content="base"]').isVisible(), true)
      await modal.locator('[booking-popup-info-close], [data-modal-close]').first().click()
      assert.equal(await modal.evaluate(e => e.open), false)
    }
    for (const scenario of ['brand', 'expired', 'booked', 'missing-module']) {
      await page.evaluate(scenario => {
        const row = { ...booking }
        if (scenario === 'expired') row.confirmation_expires_at = Date.now() - 1000
        if (scenario === 'booked') row.status = 'booked'
        if (scenario === 'missing-module') window.StartersDashboardCallActions = undefined
        fixtureCalls.bindCard(document.getElementById('fixture-request'), row, scenario === 'brand' ? 'brand' : 'starter')
      }, scenario)
      assert.equal(await decline.isVisible(), false, scenario)
    }
    assert.deepEqual(errors, [])
    if (process.env.DECLINE_EVIDENCE) await fs.writeFile(path.join(process.env.DECLINE_EVIDENCE, 'decline-observations.json'), JSON.stringify(observations, null, 2))
    console.log('Real card clicks opened Free and Paid decline panels with the selected booking and counterpart, replacing stale context. Brand, expired, booked, and unloaded-contract cards hid Decline; pending reschedule stayed hidden. No API mutations.')
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
})().catch(error => { console.error(error); process.exitCode = 1 })
