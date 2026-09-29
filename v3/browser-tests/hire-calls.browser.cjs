// Focused native-browser acceptance: node v3/browser-tests/hire-calls.browser.cjs
// Optional: CHROME_BIN and HIRE_BROWSER_EVIDENCE (screenshots/observations).
// Synthetic provider/controller boundaries; not production Webflow/Nylas proof.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
;(async () => {
  const profile = await fs.mkdtemp(path.join(root, '.hire-browser-'))
  const evidence = process.env.HIRE_BROWSER_EVIDENCE
  if (evidence) await fs.mkdir(evidence, { recursive: true })
  const server = http.createServer(async (req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname)
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return }
    try {
      const body = await fs.readFile(file)
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html')
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'")
      res.end(body)
    } catch { res.writeHead(404).end() }
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
    const errors = []
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
      if (message.id && pending.has(message.id)) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(message.error) : task.resolve(message.result) }
    })
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timed out: ${method}`)) }, 15000)
      pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
      socket.send(JSON.stringify({ id: requestId, method, params }))
    })
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 950, deviceScaleFactor: 1, mobile: false })
    const observations = []
    const snapshot = async label => {
      const state = await evaluate(`({ cards: [...document.querySelectorAll('[wf-xano-item]')].map(el => ({ visible: el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none', type: el.getAttribute('data-call-offer-type'), state: el.getAttribute('data-service-card-state'), offerState: el.getAttribute('data-call-offer-state'), busy: el.getAttribute('aria-busy') === 'true', price: el.querySelector('[data-millify]').textContent, tooltip: el.querySelector('[hover-text]').textContent, tooltipDisplay: getComputedStyle(el.querySelector('[data-call-offer-tooltip]')).display })), book: (() => { const button = document.querySelector('[booking-button-wrapper] button'); const spinner = button.querySelector('[data-button-spinner]'); const loadingHide = button.querySelector('[data-opp-element="loading-hide"]'); return { visible: button.getBoundingClientRect().height > 0, disabled: button.getAttribute('aria-disabled') === 'true', loading: button.hasAttribute('data-booking-trigger-loading'), busy: button.getAttribute('aria-busy') === 'true', signup: button.getAttribute('data-signup-trigger-element'), modal: button.getAttribute('data-modal-trigger'), cursor: getComputedStyle(button).cursor, spinner: getComputedStyle(spinner).display, spinnerInline: spinner.style.display, loadingHide: getComputedStyle(loadingHide).display, loadingHideInline: loadingHide.style.display } })() })`)
      observations.push({ label, ...state })
      if (evidence) { const shot = await send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(evidence, `${label}.png`), Buffer.from(shot.data, 'base64')) }
      return state
    }
    const navigate = async query => {
      await send('Page.navigate', { url: `http://www.thestarters.com:${server.address().port}/v3/browser-tests/hire-calls.html?${query}` })
      for (let i = 0; i < 100; i++) {
        if (await evaluate(`document.readyState === 'complete' && !!window.lumos?.modal?.list['signup-modal'] && !!document.querySelector('[data-call-offer-type]')`)) break
        await pause(50)
      }
      await pause(150)
    }
    const assertBookCall = async (role, available) => {
      const button = await evaluate(`(() => { const el = document.querySelector('[booking-button-wrapper] button'); el.scrollIntoView({block: 'center'}); const r = el.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2} })()`)
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...button })
      const hintVisible = await evaluate(`[...document.querySelectorAll('[data-call-availability-hint]')].some(el => getComputedStyle(el).display !== 'none')`)
      assert.equal(hintVisible, role === 'brand' && !available, 'only unavailable paid Brands see the hint')
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...button, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...button, button: 'left', clickCount: 1 })
      await pause(100)
      const dialogs = await evaluate(`({ signup: document.querySelector('[data-modal-target="signup-modal"]').open, chooser: document.querySelector('[data-modal-target="popup-booking-main"]').open, booking: document.querySelector('[data-modal-target="popup-booking"]').open })`)
      assert.deepEqual(dialogs, { signup: role !== 'brand', chooser: role === 'brand' && available, booking: false })
      await evaluate('lumos.modal.closeAll()')
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
      await pause(220)
    }
    const assertBookState = (state, role, available) => {
      assert.equal(state.book.visible, true, 'Book Call remains discoverable')
      assert.equal(state.book.disabled, role === 'brand' && !available)
      assert.equal(state.book.signup, role !== 'brand' || available ? 'book-call' : null)
      assert.equal(state.book.modal, role === 'brand' && available ? 'popup-booking-main' : null)
    }
    await navigate('role=brand&discovery=held')
    let loadingState = await snapshot('brand-discovery-loading')
    assert.equal(loadingState.book.loading, true)
    assert.equal(loadingState.book.busy, true)
    assert.equal(loadingState.book.disabled, true)
    assert.equal(loadingState.book.signup, null)
    assert.equal(loadingState.book.modal, null)
    assert.equal(loadingState.book.cursor, 'progress')
    assert.equal(loadingState.book.spinner, 'flex')
    assert.equal(loadingState.book.spinnerInline, 'none')
    assert.equal(loadingState.book.loadingHide, 'none')
    assert.equal(loadingState.book.loadingHideInline, 'inline-flex')
    await assertBookCall('brand', false)
    assert.equal(await evaluate('resolveStarterDiscovery()'), true)
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`!document.querySelector('[booking-button-wrapper] button').hasAttribute('data-booking-trigger-loading')`)) break
      await pause(25)
    }
    loadingState = await snapshot('brand-discovery-settled')
    assert.equal(loadingState.book.loading, false)
    assert.equal(loadingState.book.busy, false)
    assert.equal(loadingState.book.disabled, false)
    assert.equal(loadingState.book.signup, 'book-call')
    assert.equal(loadingState.book.modal, 'popup-booking-main')
    assert.notEqual(loadingState.book.cursor, 'progress')
    assert.equal(loadingState.book.spinner, 'none')
    assert.equal(loadingState.book.spinnerInline, 'none')
    assert.equal(loadingState.book.loadingHide, 'inline-flex')
    assert.equal(loadingState.book.loadingHideInline, 'inline-flex')
    for (const role of ['anonymous', 'free', 'brand']) {
      for (const failed of ['header', 'services']) {
        await navigate(`role=${role}&failed=${failed}`)
        let state = await snapshot(`${role}-${failed}-stale`)
        assert.ok(state.cards.every(card => !card.visible)); assertBookState(state, role, false)
        await assertBookCall(role, false)
        await evaluate(`lists['starter-call-offers-${failed === 'header' ? 'services' : 'header'}'].replay()`)
        await pause(50)
        state = await snapshot(`${role}-${failed}-replay`)
        assert.ok(state.cards.every(card => !card.visible))
        await evaluate(`lists['starter-call-offers-${failed}'].emit()`)
        await pause(100)
        state = await snapshot(`${role}-${failed}-recovered`)
        assert.equal(state.cards.length, 4); assert.ok(state.cards.every(card => card.visible)); assertBookState(state, role, true)
        await assertBookCall(role, true)
        assert.ok(state.cards.filter(card => card.type === 'paid').every(card => card.price === '250'))
        for (const surface of ['header', 'services']) for (const type of ['free', 'paid']) {
          const point = await evaluate(`(() => { const el = document.querySelector('#${surface} [data-call-offer-type="${type}"]'); el.scrollIntoView({block: 'center'}); const r = el.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + 20} })()`)
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
          await pause(100)
          if (role !== 'brand') {
            assert.equal(await evaluate(`document.querySelector('[data-modal-target="signup-modal"]').open`), true)
            if (role === 'anonymous') assert.ok((await evaluate('decodeURIComponent(document.cookie)')).includes(`signup_trigger=service:${type === 'free' ? 'Free Call' : 'Paid Consulting Call'}`))
          } else {
            assert.equal(await evaluate('bookingEntries.at(-1)'), type)
            assert.equal(await evaluate(`document.querySelector('[data-modal-target="popup-booking"]').open`), true)
          }
          await snapshot(`${role}-${failed}-${surface}-${type}-entry`)
          await evaluate('lumos.modal.closeAll()')
        }
        await evaluate(`lists['starter-call-offers-${failed}'].fail()`)
        await pause(50)
        state = await snapshot(`${role}-${failed}-refresh-error`)
        assert.ok(state.cards.every(card => !card.visible)); assertBookState(state, role, false)
        await assertBookCall(role, false)
        await evaluate(`lists['starter-call-offers-${failed}'].emit(false)`)
        await pause(50)
        state = await snapshot(`${role}-${failed}-paid-revoked`)
        assert.ok(state.cards.every(card => card.visible === (card.type === 'free')))
      }
    }
    for (const owner of ['ready', 'off', 'calendar', 'stripe', 'stale', 'loading', 'error']) {
      await navigate(`role=owner&owner=${owner}&failed=header`)
      const state = await snapshot(`owner-${owner}`)
      assert.ok(state.cards.every(card => card.visible), 'owners retain both cards in both wrappers')
      assert.ok(state.cards.every(card => card.state === (owner === 'ready' || owner === 'loading' ? 'Default' : owner === 'stripe' || owner === 'stale' ? card.type === 'free' ? 'Default' : 'Disabled' : 'Disabled')), JSON.stringify(state))
      const messages = { off: { free: 'Enable your Free Call service.', paid: 'Enable and price your Paid Call service.' }, calendar: { free: 'Connect your calendar to offer calls.', paid: 'Connect your calendar to offer calls.' }, stripe: { paid: 'Connect Stripe to offer paid calls.' }, stale: { paid: 'Refresh your Stripe connection to offer paid calls.' }, loading: { free: '', paid: '' }, error: { free: 'Call settings could not be loaded. Refresh or open Call Settings.', paid: 'Call settings could not be loaded. Refresh or open Call Settings.' } }
      for (const card of state.cards) if (messages[owner]?.[card.type] !== undefined) assert.equal(card.tooltip, messages[owner][card.type])
      if (owner === 'loading') assert.ok(state.cards.every(card => card.offerState === 'settings-loading' && card.busy && card.tooltipDisplay === 'none'))
    }
    assert.deepEqual(errors, [], 'no uncaught browser errors')
    if (evidence) await fs.writeFile(path.join(evidence, 'observations.json'), JSON.stringify({ boundary: 'Local fixture; real adapter, attribution, modal; synthetic data and booking controllers', observations }, null, 2))
    console.log(`PASS: ${observations.length} native-browser observations; both wrappers, signup, booking entry, owner states`)
  } finally {
    socket?.close()
    const closed = new Promise(resolve => chrome.once('exit', resolve))
    chrome.kill()
    await closed
    await new Promise(resolve => server.close(resolve))
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
