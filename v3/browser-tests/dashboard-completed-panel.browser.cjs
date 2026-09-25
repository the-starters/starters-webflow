// Rendered local acceptance. Real dashboard controllers; synthetic bookings; no API mutations.
// COMPLETED_PANEL_EVIDENCE=/absolute/evidence/path node v3/browser-tests/dashboard-completed-panel.browser.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '../..')
const evidence = process.env.COMPLETED_PANEL_EVIDENCE

;(async () => {
  const server = http.createServer(async (req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname)
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const errors = []
    const observations = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => {
      const request = route.request()
      if (request.method() !== 'GET' || !request.url().startsWith('http://127.0.0.1:')) return route.abort()
      return route.continue()
    })

    for (const role of ['starter', 'brand']) {
      for (const load of ['initial', 'reload']) {
        const url = `http://127.0.0.1:${server.address().port}/v3/browser-tests/dashboard-completed-panel.html?role=${role}`
        if (load === 'initial') await page.goto(url)
        else await page.reload()
        assert.equal(await page.evaluate(() => window.fixtureState.role), role)
        await page.locator('[data-booking-id="free-completed"] button').click()
        const modal = page.locator('dialog')
        assert.equal(await modal.evaluate(element => element.open), true)
        const completed = modal.locator('[booking-popup-content="completed"]')
        assert.equal(await completed.count(), 2)
        assert.equal(await completed.nth(0).isVisible(), false, `${role} ${load} proposal panel`)
        assert.equal(await completed.nth(1).isVisible(), true, `${role} ${load} completed panel`)
        assert.match(await completed.nth(1).innerText(), /Call Completed/)
        assert.doesNotMatch(await completed.nth(1).innerText(), /New time proposed/)
        observations.push({ role, load, freeVisible: await completed.nth(1).innerText() })
        if (evidence && load === 'reload') {
          await fs.mkdir(evidence, { recursive: true })
          await page.screenshot({ path: path.join(evidence, `${role}-free-completed-after-reload.png`), fullPage: true })
        }
        await page.locator('#close').click()
      }
    }

    await page.goto(`http://127.0.0.1:${server.address().port}/v3/browser-tests/dashboard-completed-panel.html?role=brand`)
    await page.locator('[data-booking-id="paid-completed"] button').click()
    let completed = page.locator('dialog [booking-popup-content="completed"]')
    assert.equal(await completed.nth(0).isVisible(), true, 'Paid proposal-result behavior')
    assert.equal(await completed.nth(1).isVisible(), true, 'Paid terminal behavior')
    observations.push({ role: 'brand', state: 'paid-completed', visiblePanels: await completed.allInnerTexts() })
    if (evidence) await page.screenshot({ path: path.join(evidence, 'brand-paid-completed-preserved.png'), fullPage: true })
    await page.locator('#close').click()

    await page.locator('[data-booking-id="free-confirmed"] button').click()
    assert.equal(await page.locator('dialog [booking-popup-content="base"]').isVisible(), true)
    completed = page.locator('dialog [booking-popup-content="completed"]')
    assert.equal(await completed.nth(0).isVisible(), false)
    assert.equal(await completed.nth(1).isVisible(), false)
    assert.match(await page.locator('dialog [booking-popup-content="base"]').innerText(), /Upcoming/)
    observations.push({ role: 'brand', state: 'free-confirmed', visiblePanel: await page.locator('dialog [booking-popup-content="base"]').innerText() })
    if (evidence) {
      await page.screenshot({ path: path.join(evidence, 'brand-free-confirmed-preserved.png'), fullPage: true })
      await fs.writeFile(path.join(evidence, 'completed-panel-observations.json'), JSON.stringify(observations, null, 2))
    }
    assert.deepEqual(errors, [])
    console.log('Rendered real-controller card clicks showed only Call Completed for naturally completed Free calls for Starter and Brand after reload; Paid retained both authored completed panels; confirmed Free stayed on base. No external requests or mutations.')
  } finally {
    if (browser) await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
