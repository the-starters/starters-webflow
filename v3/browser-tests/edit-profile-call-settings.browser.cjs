// Focused native-browser acceptance for Edit Profile step 6 call settings:
//   node v3/browser-tests/edit-profile-call-settings.browser.cjs
// Optional: CHROME_BIN and EDIT_PROFILE_BROWSER_EVIDENCE (screenshots/observations).
// Real scheduling-auth bridge, real call controllers, authored step 6 DOM.
// Synthetic Memberstack and Xano boundaries; not production Webflow proof.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { spawn, execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const BASE_COMMIT = process.env.EDIT_PROFILE_BASE_COMMIT || 'd9da4a7'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
;(async () => {
  const profile = await fs.mkdtemp(path.join(root, '.edit-profile-browser-'))
  const evidence = process.env.EDIT_PROFILE_BROWSER_EVIDENCE
  if (evidence) await fs.mkdir(evidence, { recursive: true })
  const server = http.createServer(async (req, res) => {
    const requested = new URL(req.url, 'http://local').pathname
    const send = (body, type) => {
      res.setHeader('Content-Type', type)
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'")
      res.end(body)
    }
    // Pre-fix controller sources, read straight out of git so the worktree stays clean.
    if (requested.startsWith('/base/')) {
      try {
        send(execFileSync('git', ['show', `${BASE_COMMIT}:${requested.slice('/base/'.length)}`], { cwd: root }), 'text/javascript')
      } catch { res.writeHead(404).end() }
      return
    }
    const file = requested === '/starter-edit-profile'
      ? path.join(__dirname, 'edit-profile-call-settings.html')
      : path.resolve(root, '.' + requested)
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return }
    try { send(await fs.readFile(file), file.endsWith('.js') ? 'text/javascript' : 'text/html') }
    catch { res.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--no-proxy-server',
    '--host-resolver-rules=MAP www.thestarters.com 127.0.0.1', 'about:blank',
  ], { stdio: 'ignore' })
  let socket
  try {
    let port
    for (let i = 0; i < 100; i++) {
      try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await pause(100) }
    }
    assert.ok(port, 'Chrome must start')
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl)
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
    let id = 0
    const pending = new Map()
    let errors = []
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text)
      if (message.id && pending.has(message.id)) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(message.error) : task.resolve(message.result) }
    })
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timed out: ${method}`)) }, 20000)
      pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
      socket.send(JSON.stringify({ id: requestId, method, params }))
    })
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 860, height: 1000, deviceScaleFactor: 2, mobile: false })

    const observations = []
    const READ = `({
      status: {
        free: document.documentElement.getAttribute('data-free-call-settings'),
        paid: document.documentElement.getAttribute('data-paid-call-settings'),
      },
      free: { yes: document.getElementById('free-yes').checked, no: document.getElementById('free-no').checked, description: document.getElementById('free-call-description').value },
      paid: { yes: document.getElementById('paid-yes').checked, no: document.getElementById('paid-no').checked, description: document.getElementById('paid-call-description').value, rate: document.getElementById('paid-call-rate').value },
      retainer: { yes: document.getElementById('retainer-yes').checked, description: document.getElementById('description-retainer').value, rate: document.getElementById('rate-retainer').value },
      network: window.__tsNetworkLog,
    })`
    const snapshot = async (label, note) => {
      const state = await evaluate(READ)
      observations.push({ label, note, ...state })
      if (evidence) {
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
        await fs.writeFile(path.join(evidence, `${label}.png`), Buffer.from(shot.data, 'base64'))
      }
      return state
    }
    const navigate = async query => {
      errors = []
      await send('Page.navigate', { url: `http://www.thestarters.com:${server.address().port}/starter-edit-profile?${query}` })
      for (let i = 0; i < 200; i++) {
        if (await evaluate(`document.readyState === 'complete' && !!window.__tsControllersReady && !!document.documentElement.getAttribute('data-free-call-settings') && !!document.documentElement.getAttribute('data-paid-call-settings')`)) break
        await pause(50)
      }
      await pause(200)
    }
    const settleUntil = async predicate => {
      for (let i = 0; i < 60; i++) { if (await evaluate(predicate)) return true; await pause(50) }
      return false
    }

    for (const order of ['free,paid', 'paid,free']) {
      const tag = order.replace(',', '-then-')

      // 1. Pre-fix control: the reported production failure, same late bridge.
      await navigate(`order=${order}&source=base`)
      await evaluate('window.__tsNotifyAuthChange()')
      await pause(150)
      const brokenBefore = await snapshot(`${tag}-1-prefix-late-bridge`, 'base d9da4a7, bridge still loading')
      await evaluate('window.__tsInstallSchedulingAuth()')
      await pause(600)
      const brokenAfter = await snapshot(`${tag}-2-prefix-bridge-arrived`, 'base d9da4a7, bridge installed')
      assert.deepEqual(brokenBefore.status, { free: 'error', paid: 'error' }, 'pre-fix controllers fail the moment they load without the bridge')
      assert.deepEqual(brokenAfter.status, { free: 'error', paid: 'error' }, 'pre-fix controllers never recover once the bridge arrives')
      assert.equal(brokenAfter.free.no, true); assert.equal(brokenAfter.free.description, '')
      assert.equal(brokenAfter.paid.no, true); assert.equal(brokenAfter.paid.rate, '')
      assert.deepEqual(brokenAfter.network, [], 'pre-fix page never reaches the canonical call-settings reads')

      // 2. Fixed: controllers first, bridge late.
      await navigate(`order=${order}`)
      const waiting = await snapshot(`${tag}-3-fixed-waiting-for-bridge`, 'HEAD 600dd0c, bridge still loading')
      assert.deepEqual(waiting.status, { free: 'loading', paid: 'loading' }, 'fixed controllers hold the loading state instead of flashing unavailable')
      await evaluate('window.__tsNotifyAuthChange()')
      await pause(200)
      const duringAuthChange = await snapshot(`${tag}-4-fixed-auth-change-during-wait`, 'HEAD 600dd0c, Memberstack auth change while waiting')
      assert.deepEqual(duringAuthChange.status, { free: 'loading', paid: 'loading' }, 'a Memberstack auth change during the wait does not flash the unavailable state')
      await evaluate('window.__tsInstallSchedulingAuth()')
      assert.ok(await settleUntil(`document.documentElement.getAttribute('data-free-call-settings') === 'ready' && document.documentElement.getAttribute('data-paid-call-settings') === 'ready'`), 'both controllers hydrate once the late bridge installs')
      const hydrated = await snapshot(`${tag}-5-fixed-hydrated-after-late-bridge`, 'HEAD 600dd0c, late bridge installed')

      // 3. Fixed: the hydrated controls accept real member typing.
      const caret = await evaluate(`(() => { const el = document.getElementById('free-call-description'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...caret, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...caret, button: 'left', clickCount: 1 })
      await evaluate(`document.getElementById('free-call-description').setSelectionRange(document.getElementById('free-call-description').value.length, document.getElementById('free-call-description').value.length)`)
      for (const character of ' for founders') await send('Input.insertText', { text: character })
      await pause(100)
      const edited = await snapshot(`${tag}-6-fixed-member-edits-free-description`, 'HEAD 600dd0c, member typing into the hydrated Free Call description')
      assert.equal(edited.free.description, 'Intro call about growth strategy for founders', 'the hydrated Free Call description accepts member typing')
      assert.equal(await evaluate('window.StarterFreeCallSettings.hasChanges()'), true, 'typing marks the Free controller dirty')
      assert.equal(await evaluate('window.StarterPaidCallSettings.hasChanges()'), false, 'typing in the Free field leaves the Paid controller clean')
      assert.deepEqual(edited.network.filter(entry => entry.method !== 'GET'), [], 'editing sends no write')

      // 4. Fixed: bridge first, then controllers (the other arrival order).
      await navigate(`order=${order}&bridge=early`)
      assert.ok(await settleUntil(`document.documentElement.getAttribute('data-free-call-settings') === 'ready' && document.documentElement.getAttribute('data-paid-call-settings') === 'ready'`), 'both controllers hydrate when the bridge is already installed')
      const early = await snapshot(`${tag}-7-fixed-bridge-first-reload`, 'HEAD 600dd0c, bridge installed before the controllers')

      for (const state of [hydrated, early]) {
        assert.deepEqual(state.status, { free: 'ready', paid: 'ready' })
        assert.equal(state.free.yes, true, 'Free Call reads Yes')
        assert.equal(state.free.description, 'Intro call about growth strategy')
        assert.equal(state.paid.yes, true, 'Paid Call reads Yes')
        assert.equal(state.paid.description, 'Deep-dive strategy session')
        assert.equal(state.paid.rate, '350')
        assert.deepEqual(state.retainer, { yes: true, description: 'Fractional growth lead, two days a week', rate: '12000' }, 'monthly retainers are untouched by either call controller')
        const reads = state.network.filter(entry => entry.url.includes('call-settings'))
        assert.deepEqual(reads.map(entry => `${entry.method} ${new URL(entry.url).pathname} ${entry.authorization}`).sort(), [
          'GET /api:tCpV3oqd/starter/free-call-settings/get/v3 Bearer …',
          'GET /api:tCpV3oqd/starter/paid-call-settings/get/v3 Bearer …',
        ], 'each canonical call-settings route is read exactly once, credentialed')
      }
      assert.deepEqual(errors, [], 'no uncaught browser errors')
    }

    if (evidence) await fs.writeFile(path.join(evidence, 'observations.json'), JSON.stringify({
      boundary: 'Authored step 6 DOM, real scheduling-auth.js, real free/paid call controllers in Chrome; synthetic Memberstack session and Xano responses; no request leaves the browser',
      baseCommit: BASE_COMMIT,
      observations,
    }, null, 2))
    console.log(`PASS: ${observations.length} native-browser observations across both controller orders and both bridge arrival orders`)
  } finally {
    socket?.close()
    const closed = new Promise(resolve => chrome.once('exit', resolve))
    chrome.kill()
    await closed
    await new Promise(resolve => server.close(resolve))
    await fs.rm(profile, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
