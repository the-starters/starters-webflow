// Local acceptance runner: every non-loopback browser request is blocked.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { chromium } = require('playwright')

async function main() {
  const root = path.resolve(__dirname, '../..')
  const evidence = path.resolve(process.argv[2] || '/tmp/dashboard-payment-convergence')
  await fs.mkdir(evidence, { recursive: true })
  const server = http.createServer(async (req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://127.0.0.1').pathname)
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end()
    try {
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html')
      res.end(await fs.readFile(file))
    } catch (_error) { res.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
    const errors = [], blocked = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === `http://127.0.0.1:${server.address().port}`) return route.continue()
      blocked.push(route.request().url())
      return route.abort()
    })
    await page.goto(`http://127.0.0.1:${server.address().port}/v3/browser-tests/dashboard-payment-convergence.html`)
    await page.waitForFunction(() => window.fixtureReady || window.fixtureError)
    assert.equal(await page.evaluate(() => window.fixtureError || ''), '')
    await page.locator('[payment-action-btn="approve-payment"] button').click()
    await page.locator('#complete').click()
    await page.waitForFunction(() => document.querySelector('[bookings-list] [booking-element="payment-status-text"]')?.textContent === 'Payment method confirmed.')
    const result = await page.evaluate(() => ({
      counts: proofState.counts,
      card: document.querySelector('[bookings-list] [booking-element="payment-status-text"]').textContent,
      modal: document.querySelector('[popup-booking-info] [booking-element="payment-status-text"]').textContent,
      approveHidden: document.querySelector('[payment-action-btn="approve-payment"]').hidden,
      modalOpen: proofState.modal.open, paymentRevision: proofState.refs[0].rows[0].payment_revision,
    }))
    assert.deepEqual(result.counts, { canonicalReads: 4, paymentActions: 1, bankSteps: 1, completeClicks: 1, productionAccess: 0 })
    assert.equal(result.card, 'Payment method confirmed.')
    assert.equal(result.modal, 'Payment method confirmed.')
    assert.equal(result.approveHidden, true)
    assert.equal(result.modalOpen, true)
    assert.equal(result.paymentRevision, 3)
    assert.deepEqual(errors, [])
    assert.deepEqual(blocked, [])
    await page.screenshot({ path: path.join(evidence, 'converged.png'), fullPage: true })
    await fs.writeFile(path.join(evidence, 'RESULT.json'), JSON.stringify({ result, errors, blocked, externalRequests: 0 }, null, 2) + '\n')
    console.log('PASS: one bank step; delayed canonical state repaints card and same open modal. External requests: 0.')
  } finally {
    if (browser) await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
