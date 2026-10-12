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
    const workerDelayMs = Number(process.argv[3] || 0)
    const exhausted = workerDelayMs > 100000
    await page.goto(`http://127.0.0.1:${server.address().port}/v3/browser-tests/dashboard-payment-convergence.html?worker_delay_ms=${workerDelayMs}`)
    await page.waitForFunction(() => window.fixtureReady || window.fixtureError)
    assert.equal(await page.evaluate(() => window.fixtureError || ''), '')
    await page.locator('[payment-action-btn="approve-payment"] button').click()
    await page.locator('#complete').click()
    if (exhausted) {
      await page.waitForFunction(() => proofState.counts.canonicalReads === 9 && proofState.elapsedRetryDelaysMs === 100000)
      // The final mocked read resolves immediately; let its click handler
      // settle before testing a close/reopen of the exact old payment row.
      await page.waitForTimeout(80)
      await page.evaluate(() => {
        proofState.modal.close()
        proofState.calls.populateDetailModal(proofState.modal, proofState.refs[0].rows[0], 'brand')
        proofState.modal.showModal()
        document.querySelector('[payment-action-btn="approve-payment"] button').click()
      })
    } else {
      await page.waitForFunction(() => document.querySelector('[bookings-list] [booking-element="payment-status-text"]')?.textContent === 'Payment method confirmed.')
    }
    const result = await page.evaluate(() => ({
      counts: proofState.counts, elapsedRetryDelaysMs: proofState.elapsedRetryDelaysMs,
      card: document.querySelector('[bookings-list] [booking-element="payment-status-text"]').textContent,
      modal: document.querySelector('[popup-booking-info] [booking-element="payment-status-text"]').textContent,
      approveHidden: document.querySelector('[payment-action-btn="approve-payment"]').hidden,
      approveDisabled: document.querySelector('[payment-action-btn="approve-payment"]').getAttribute('aria-disabled'),
      modalOpen: proofState.modal.open, paymentRevision: proofState.refs[0].rows[0].payment_revision,
    }))
    assert.deepEqual(result.counts, { canonicalReads: workerDelayMs ? 9 : 4, paymentActions: 1, bankSteps: 1, completeClicks: 1, productionAccess: 0 })
    assert.equal(result.card, exhausted ? 'Payment needs attention.' : 'Payment method confirmed.')
    assert.equal(result.modal, exhausted ? 'Payment needs attention.' : 'Payment method confirmed.')
    assert.equal(result.approveHidden, true)
    assert.equal(result.modalOpen, true)
    assert.equal(result.paymentRevision, exhausted ? 2 : 3)
    if (workerDelayMs) assert.equal(result.elapsedRetryDelaysMs, 100000)
    if (exhausted) assert.equal(result.approveDisabled, 'true')
    if (exhausted) {
      await page.screenshot({ path: path.join(evidence, 'latched-exhaustion.png'), fullPage: true })
      // A genuinely new canonical payment must regain normal eligibility.
      // Only its read response changes; there is no second bank action.
      result.newPaymentControl = await page.evaluate(async () => {
        const originalFetch = window.xanoAuthFetch
        window.xanoAuthFetch = async (url, options) => {
          const response = await originalFetch(url, options)
          if (!url.endsWith('/booking_record/get/v3')) return response
          const body = await response.json()
          return { ok: true, json: async () => body.map(row => ({ ...row,
            payment_intent: 'pi_synthetic_new_hold', payment_revision: 3,
          })) }
        }
        await proofState.refresh()
        const control = document.querySelector('[payment-action-btn="approve-payment"]')
        return { visible: !control.hidden, ariaDisabled: control.getAttribute('aria-disabled') }
      })
      assert.deepEqual(result.newPaymentControl, { visible: true, ariaDisabled: 'false' })
      assert.equal(result.counts.bankSteps, 1)
      assert.equal(result.counts.paymentActions, 1)
      await page.screenshot({ path: path.join(evidence, 'new-payment-visible.png'), fullPage: true })
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(blocked, [])
    if (!exhausted) await page.screenshot({ path: path.join(evidence, 'converged.png'), fullPage: true })
    await fs.writeFile(path.join(evidence, 'RESULT.json'), JSON.stringify({ workerDelayMs, exhausted, result, errors, blocked, externalRequests: 0 }, null, 2) + '\n')
    console.log(exhausted
      ? 'PASS: exhausted read budget keeps same-payment approval hidden; a new payment restores eligibility. External requests: 0.'
      : 'PASS: one bank step; delayed canonical state repaints card and same open modal. External requests: 0.')
  } finally {
    if (browser) await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
