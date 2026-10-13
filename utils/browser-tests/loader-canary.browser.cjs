const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { chromium } = require('playwright')

// Local synthetic HTTP pages only. No existing Chrome session or real SDK/API.
const source = fs.readFileSync(path.join(__dirname, '../loader.js'))
const output = process.env.LOADER_CANARY_EVIDENCE || '/tmp/loader-canary-browser.json'
const errors = [], blocked = [], results = []

function bootstrap() {
  const scenario = new URLSearchParams(location.search).get('scenario')
  window.observed = { reads: 0, executed: [], loaded: [], conflicts: [] }
  let memberId = 'mem_canary'
  window.$memberstackDom = { getCurrentMember() {
    observed.reads++
    if (scenario === 'reject') return Promise.reject(Error('fixture rejection'))
    const id = scenario === 'mismatch' ? 'mem_other' : memberId
    return new Promise(resolve => setTimeout(() => resolve({ data: { id } }), scenario === 'timeout' ? 3200 : 40))
  } }
  document.addEventListener('DOMContentLoaded', async () => {
    const config = { name: 'calendar', staging: location.origin + '/stage.js', live: location.origin + '/live.js', type: 'text/javascript', productionCanary: { memberId: 'mem_canary', src: 'https://candidate.fixture.invalid/candidate.js' } }
    // The candidate hostname is mapped to the same local fixture below. It has
    // no network/provider service and every request is fulfilled locally.
    try {
      const first = loadEnvScript(config)
      if (scenario === 'once') {
        observed.samePromise = first === loadEnvScript({ ...config })
        await loadEnvScript({ ...config, live: location.origin + '/different.js' }).catch(error => observed.conflicts.push(error.message))
      }
      await first
      observed.loaded.push('first')
      if (scenario === 'ordered' || scenario === 'account-switch') {
        if (scenario === 'account-switch') memberId = 'mem_other'
        await loadEnvScript({ ...config, name: 'second' })
        observed.loaded.push('second')
      }
      if (scenario === 'timeout') await new Promise(resolve => setTimeout(resolve, 300))
      observed.done = true
      document.querySelector('pre').textContent = JSON.stringify(observed, null, 2)
    } catch (error) { observed.error = error.message; observed.done = true }
  })
}

;(async () => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture')
    if (url.pathname === '/loader.js') { res.setHeader('content-type', 'text/javascript'); return res.end(source) }
    if (['/live.js', '/stage.js'].includes(url.pathname)) {
      res.setHeader('content-type', 'text/javascript')
      return res.end(`window.observed.executed.push(${JSON.stringify(url.pathname)});`)
    }
    if (url.pathname === '/') {
      res.setHeader('content-type', 'text/html')
      return res.end(`<!doctype html><title>Local loader canary fixture</title><h1>Local synthetic loader fixture</h1><pre>Waiting</pre><script>(${bootstrap.toString()})()</script><script defer src="/loader.js"></script>`)
    }
    res.writeHead(404).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  let browser
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-networking', '--no-proxy-server', '--host-resolver-rules=MAP canary.webflow.io 127.0.0.1'] })
    const context = await browser.newContext()
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.href === 'https://candidate.fixture.invalid/candidate.js') return route.fulfill({ contentType: 'text/javascript', body: "window.observed.executed.push('/candidate.js');" })
      if ((url.hostname === '127.0.0.1' || url.hostname === 'canary.webflow.io') && url.port === String(port)) return route.continue()
      blocked.push(url.origin + url.pathname)
      return route.abort()
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    for (const scenario of ['match', 'mismatch', 'reject', 'timeout', 'once', 'ordered', 'account-switch', 'staging']) {
      const host = scenario === 'staging' ? 'canary.webflow.io' : '127.0.0.1'
      await page.goto(`http://${host}:${port}/?scenario=${scenario}`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => window.observed && observed.done)
      const result = await page.evaluate(() => observed)
      assert.equal(result.error, undefined)
      const expected = scenario === 'staging' ? ['/stage.js'] : ['mismatch', 'reject', 'timeout'].includes(scenario) ? ['/live.js'] : scenario === 'ordered' ? ['/candidate.js', '/candidate.js'] : scenario === 'account-switch' ? ['/candidate.js', '/live.js'] : ['/candidate.js']
      assert.deepEqual(result.executed, expected)
      assert.equal(result.reads, scenario === 'staging' ? 0 : ['ordered', 'account-switch'].includes(scenario) ? 2 : 1)
      if (scenario === 'once') { assert.equal(result.samePromise, true); assert.equal(result.conflicts.length, 1) }
      results.push({ scenario, ...result })
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(blocked, [])
    fs.writeFileSync(output, JSON.stringify({ observed_at: new Date().toISOString(), evidence: 'Local native Chrome; synthetic SDK and scripts; no production session/provider/API', loader_sha256: crypto.createHash('sha256').update(source).digest('hex'), results, errors, blocked }, null, 2) + '\n')
    console.log(JSON.stringify({ passed: results.length, errors: errors.length, external_attempts: blocked.length, output }))
  } finally {
    if (browser) await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
