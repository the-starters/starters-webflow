// Local-only cross-modal acceptance. All non-loopback requests are denied.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { promisify } = require('node:util')
const execFile = promisify(require('node:child_process').execFile)
const { chromium } = require('playwright')

async function main() {
  const root = path.resolve(__dirname, '../..'), evidence = path.resolve(process.argv[2])
  const sourceHead = process.argv[3] || ''
  if (sourceHead) assert.match(sourceHead, /^[0-9a-f]{40}$/)
  await fs.mkdir(evidence, { recursive: true })
  const server = http.createServer(async (req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://127.0.0.1').pathname)
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end()
    try {
      const relative = path.relative(root, file)
      const historical = sourceHead && /^v3\/dashboard-(?:calls|call-actions|call-payment)\.js$/.test(relative)
      const body = historical ? (await execFile('git', ['show', sourceHead + ':' + relative], { cwd: root })).stdout : await fs.readFile(file)
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html')
      res.end(body)
    } catch (_error) { res.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser, page
  const errors = [], blocked = []
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === `http://127.0.0.1:${server.address().port}`) return route.continue()
      blocked.push(route.request().url()); return route.abort()
    })
    await page.goto(`http://127.0.0.1:${server.address().port}/v3/browser-tests/dashboard-payment-cross-modal.html`)
    await page.waitForFunction(() => window.fixtureReady || window.fixtureError)
    assert.equal(await page.evaluate(() => window.fixtureError || ''), '')
    await page.locator('#open-first').click()
    await page.locator('[payment-action-btn="approve-payment"] button').click()
    await page.locator('#complete').click()
    await page.waitForFunction(() => crossProof.waitingMs === 30000)
    await page.screenshot({ path: path.join(evidence, 'first-held-post-bank-wait.png'), fullPage: true })
    await page.locator('#close-details').click()
    await page.locator('#open-second').click()
    assert.equal(await page.locator('[payment-action-btn="approve-payment"]').isVisible(), true)
    await page.locator('[payment-action-btn="approve-payment"] button').click()
    await page.locator('#bank').waitFor({ state: 'visible', timeout: 1500 })
    await page.locator('#complete').click()
    await page.waitForFunction(() => crossProof.refs[0].rows[1].payment_revision === 3)
    await page.locator('#close-details').click()
    await page.locator('#open-first').click()
    const result = await observation(page)
    assert.equal(result.cancelledWait, true)
    assert.equal(result.waitingMs, 0)
    assert.deepEqual(result.counts.paymentActions, ['synthetic-cross-modal-0', 'synthetic-cross-modal-1'])
    assert.equal(result.counts.bankSteps, 2)
    assert.equal(result.counts.completeClicks, 2)
    assert.equal(result.approveVisible, false, 'original successful payment stays latched')
    assert.equal(result.counts.productionAccess, 0)
    assert.deepEqual(errors, [])
    assert.deepEqual(blocked, [])
    await page.screenshot({ path: path.join(evidence, 'original-success-remains-latched.png'), fullPage: true })
    await fs.writeFile(path.join(evidence, 'RESULT.json'), JSON.stringify({ sourceHead, verdict: 'pass', result, errors, blocked, externalRequests: 0 }, null, 2) + '\n')
    console.log('PASS: closing the post-bank wait permits another synthetic booking; original payment remains latched. External requests: 0.')
  } catch (error) {
    if (page) {
      await fs.writeFile(path.join(evidence, 'FAILURE.json'), JSON.stringify({ sourceHead, verdict: 'fail', error: error.message,
        result: await observation(page), errors, blocked, externalRequests: blocked.length }, null, 2) + '\n')
      await page.screenshot({ path: path.join(evidence, 'second-eligible-booking-blocked.png'), fullPage: true })
    }
    throw error
  } finally {
    if (browser) await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
}
async function observation(page) {
  return page.evaluate(() => ({ counts: { ...crossProof.counts }, waitingMs: crossProof.waitingMs,
    cancelledWait: crossProof.cancelledWait,
    approveVisible: !document.querySelector('[payment-action-btn="approve-payment"]').hidden,
    modalBookingId: crossProof.modal.dataset.bookingId,
  }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
