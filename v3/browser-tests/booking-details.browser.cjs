// Focused native-browser acceptance: node v3/browser-tests/booking-details.browser.cjs
// Optional: CHROME_BIN, BOOKING_BROWSER_EVIDENCE, BOOKING_SCRIPT_ROOT (baseline scripts).
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
  const evidence = process.env.BOOKING_BROWSER_EVIDENCE || '/tmp/nylas-details-browser'
  if (evidence) await fs.mkdir(evidence, { recursive: true })
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://local').pathname
    const baselineScript = process.env.BOOKING_SCRIPT_ROOT && ['/v3/free-call-booking.js', '/v3/paid-call-brand-payment.js'].includes(pathname)
    const file = baselineScript ? path.resolve(process.env.BOOKING_SCRIPT_ROOT, path.basename(pathname)) : path.resolve(root, '.' + pathname)
    if (!baselineScript && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return }
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
    const layoutFailures = []
    const waitFor = async expression => {
      for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(30) }
      throw new Error('Timed out: ' + expression)
    }
    const click = async selector => {
      assert.ok(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), selector)
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
      await pause(30)
    }
    const fill = (selector, value) => evaluate(`(() => { const field = document.querySelector(${JSON.stringify(selector)}); field.value = ${JSON.stringify(value)}; field.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    const role = value => `[data-paid-calendar-element="${value}"]`
    const confirm = role('confirm') + ' button'
    const guests = role('guest-email')
    const context = role('context')
    const navigate = async (query = '', width = 1100) => {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: width < 600 })
      await send('Page.navigate', { url: `http://www.thestarters.com:${server.address().port}/v3/browser-tests/booking-details.html?${query}` })
      await waitFor('window.fixture && fixture.ready')
    }
    const screenshot = async label => {
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      await fs.writeFile(path.join(evidence, label + '.png'), Buffer.from(shot.data, 'base64'))
      observations.push(label)
    }
    const openDetails = async type => {
      await click('#' + type)
      await waitFor(`!!document.querySelector('[data-paid-calendar-slot]')`)
      await click('[data-paid-calendar-slot]')
      assert.match(await evaluate(`document.querySelector('${role('confirm')}').textContent`), /Continue/)
      const before = await evaluate('fixture.bookings.length')
      await click(confirm)
      await waitFor(`getComputedStyle(document.querySelector('${role('details')}')).display === 'grid'`)
      assert.equal(await evaluate('fixture.bookings.length'), before, 'Continue does not submit')
      assert.deepEqual(await evaluate(`['participant-name','participant-email'].map(role => { const el = document.querySelector('[data-paid-calendar-element="'+role+'"]'); return [el.value,el.readOnly] })`), [['Brand Fixture', true], ['brand@example.invalid', true]])
    }
    for (const type of ['free', 'paid']) {
      await navigate()
      assert.deepEqual(await evaluate('fixture.installs'), { free: true, paid: true })
      await openDetails(type)
      await screenshot(type + '-desktop-initial')
      await fill(context, 'Discuss the launch plan')
      await fill(guests, 'invalid')
      await click(confirm)
      assert.equal(await evaluate('fixture.bookings.length'), 0, 'invalid guest prevents command')
      assert.match(await evaluate(`document.querySelector('${role('details-error')}').textContent`), /valid guest email/)
      await fill(guests, 'Guest@Example.invalid')
      assert.equal(await evaluate(`document.querySelector('${role('details-error')}').textContent`), '', 'editing clears stale validation copy')
      for (let i = 0; i < 4; i++) await click(role('guest-add'))
      assert.equal(await evaluate(`document.querySelector('${role('guest-add')}').disabled`), true)
      assert.equal(await evaluate(`document.querySelectorAll('${guests}:not(:disabled)').length`), 5)
      await click(role('guest-row') + ':nth-child(5) ' + role('guest-remove'))
      assert.equal(await evaluate(`document.querySelectorAll('${guests}:not(:disabled)').length`), 4)
      assert.equal(await evaluate(`document.querySelector('${role('guest-add')}').disabled`), false)
      const slot = await evaluate(`document.querySelector('[data-paid-calendar-slot][aria-pressed="true"]').getAttribute('data-paid-calendar-slot')`)
      await click(role('details-back') + ' button')
      assert.equal(await evaluate(`document.querySelector('[data-paid-calendar-slot][aria-pressed="true"]').getAttribute('data-paid-calendar-slot')`), slot)
      await click(confirm)
      assert.equal(await evaluate(`document.querySelector('${context}').value`), 'Discuss the launch plan')
      assert.equal(await evaluate(`document.querySelector('${guests}').value`), 'Guest@Example.invalid')
      const layout = await evaluate(`(() => {const a=document.querySelector('${role('selected-event')}').getBoundingClientRect(),b=document.querySelector('${role('details-fields')}').getBoundingClientRect();return {sideBySide:b.x>=a.right-1,sameTop:Math.abs(a.y-b.y)<2,overflow:document.documentElement.scrollWidth>innerWidth}})()`)
      await screenshot(type + '-desktop-details')
      if (!layout.sideBySide) console.log('LAYOUT', await evaluate(`[...document.querySelectorAll('[data-paid-calendar-element]')].filter(el=>['shell','layout','calendar-panel','time-panel','details','footer','status'].includes(el.getAttribute('data-paid-calendar-element'))).map(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {role:el.getAttribute('data-paid-calendar-element'),display:s.display,columns:s.gridTemplateColumns,areas:s.gridTemplateAreas,area:s.gridArea,x:r.x,y:r.y,width:r.width,height:r.height}})`))
      if (!layout.sideBySide || !layout.sameTop || layout.overflow) layoutFailures.push({ type, ...layout })
      await evaluate('fixture.failBookings = 1')
      await click(confirm)
      await waitFor('fixture.bookings.length === 1')
      await waitFor(`!document.querySelector('${confirm}').disabled`)
      await click(confirm)
      await waitFor('fixture.bookings.length === 2')
      const payloads = await evaluate('fixture.bookings')
      assert.deepEqual(payloads[0], payloads[1], 'ambiguous retry preserves payload and key')
      assert.equal(payloads[0].config_id, 'fixture-' + type)
      assert.equal(payloads[0].context, 'Discuss the launch plan')
      assert.deepEqual(payloads[0].guest_emails, ['guest@example.invalid'])
      assert.equal(payloads[0].start, Number(slot))
      assert.ok(!('brand_email' in payloads[0]) && !('name' in payloads[0]) && !('email' in payloads[0]))
      await waitFor(`getComputedStyle(document.querySelector('[schedule-step="success"]')).display !== 'none'`)
      await click('#close')
      await openDetails(type)
      assert.equal(await evaluate(`document.querySelector('${context}').value`), '')
      assert.equal(await evaluate(`document.querySelector('${guests}').value`), '')
      await fill(context, 'Discard this draft')
      await click('#close')
      await openDetails(type)
      assert.equal(await evaluate(`document.querySelector('${context}').value`), '')
      observations.push(type + '-request-retry-close-passed')
    }
    await navigate('', 390)
    await openDetails('free')
    assert.deepEqual(await evaluate(`(() => {const a=document.querySelector('${role('selected-event')}').getBoundingClientRect(),b=document.querySelector('${role('details-fields')}').getBoundingClientRect();return {stacked:b.y>=a.bottom-1,overflow:document.documentElement.scrollWidth>innerWidth}})()`), { stacked: true, overflow: false })
    await screenshot('free-mobile-details')
    for (const type of ['free', 'paid']) {
      await navigate('legacy=1')
      await openDetails(type)
      assert.equal(await evaluate(`document.querySelectorAll('${guests}').length`), 0, 'authored fields prevent duplicate generated guests')
      assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('[data-call-guest-fields]')).display`), 'none')
      await fill('[data-call-guest-email]', 'legacy@example.invalid')
      await click(role('details-back') + ' button')
      await click(confirm)
      assert.equal(await evaluate(`document.querySelector('[data-call-guest-email]').value`), 'legacy@example.invalid')
      await click(confirm)
      await waitFor('fixture.bookings.length === 1')
      assert.deepEqual(await evaluate('fixture.bookings[0].guest_emails'), ['legacy@example.invalid'])
      observations.push(type + '-authored-guests-passed')
    }
    await navigate()
    await openDetails('free')
    await evaluate(`document.querySelector('${guests}').focus()`)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await waitFor('fixture.bookings.length === 1')
    assert.equal(await evaluate('fixture.bookings[0].guest_emails'), undefined)
    assert.equal(await evaluate('fixture.bookings[0].context'), undefined)
    observations.push('keyboard-enter-empty-optional-fields-passed')
    for (const entry of ['hire', 'messages']) {
      for (const type of ['free', 'paid']) {
        for (const direct of [false, true]) {
          await navigate(`legacy=1&partial=1&entry=${entry}${direct && entry === 'messages' ? '&only=' + type : ''}`, direct ? 390 : 1100)
          assert.deepEqual(await evaluate('[fixturePopup.open, fixtureChooser.open]'), [false, false], 'entry starts with both dialogs closed')
          const enter = async () => {
            if (entry === 'hire') await waitFor(`document.querySelector('#${type}').getAttribute('data-${type}-call-v3') === 'ready'`)
            if (direct && entry === 'hire') {
              await click('#direct-' + type)
            } else {
              await click('#book-entry')
              if (!direct) {
                await waitFor('fixtureChooser.open')
                assert.equal(await evaluate(`document.querySelector('#${type}').getClientRects().length > 0`), true, 'rejected form keeps its call option reachable')
                await click('#' + type)
              }
            }
            await waitFor(`fixturePopup.open && !!document.querySelector('[data-paid-calendar-status="error"]')`)
          }
          await enter()
          assert.deepEqual(await evaluate(`(() => {
            const banner = document.querySelector('[data-paid-calendar-status="error"]')
            const style = getComputedStyle(banner), rect = banner.getBoundingClientRect()
            return { text: banner.textContent, role: banner.getAttribute('role'), background: style.backgroundColor,
              color: style.color, visible: rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight && style.visibility === 'visible' }
          })()`), { text: 'We could not load the booking form. Please contact support.', role: 'alert',
            background: 'rgb(221, 85, 85)', color: 'rgb(255, 255, 255)', visible: true })
          assert.equal(await evaluate(`document.querySelectorAll('${confirm}, [data-paid-calendar-slot]').length`), 0, 'invalid form cannot select or request a call')
          assert.equal(await evaluate(`document.querySelector('[data-call-guest-fields]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))`), false, 'native form submission is blocked')
          assert.equal(await evaluate('fixture.bookings.length'), 0)
          assert.equal(await evaluate('fixture.requests.some(request => /payment/.test(request.path))'), false, 'invalid form never enters payment setup')
          await screenshot(`${entry}-${type}-${direct ? 'direct' : 'chooser'}-legacy-error`)
          await click('#close')
          assert.equal(await evaluate('fixturePopup.open'), false)
          await enter()
          assert.equal(await evaluate('fixture.bookings.length'), 0, 'reopening remains blocked')
          observations.push(`${entry}-${type}-${direct ? 'direct' : 'chooser'}-legacy-error-passed`)
        }
      }
    }
    for (const entry of ['hire', 'messages']) {
      await navigate(`legacy=1&stray=1&entry=${entry}`)
      assert.deepEqual(await evaluate('[fixturePopup.open, fixtureChooser.open]'), [false, false])
      if (entry === 'hire') await waitFor(`document.querySelector('#free').getAttribute('data-free-call-v3') === 'ready'`)
      await click('#book-entry')
      await waitFor('fixtureChooser.open')
      for (const type of ['free', 'paid', 'free']) {
        await click('#' + type)
        await waitFor(`fixturePopup.open && !!document.querySelector('[data-paid-calendar-status="error"]')`)
        assert.equal(await evaluate(`document.querySelector('[data-paid-calendar-status="error"]').getClientRects().length > 0`), true)
        assert.equal(await evaluate(`document.querySelectorAll('${confirm}, [data-paid-calendar-slot]').length`), 0, 'stray markup blocks both controllers')
        assert.equal(await evaluate(`document.querySelector('[data-call-guest-fields]').getClientRects().length`), 0, 'invalid form is hidden only during error entry')
        assert.equal(await evaluate(`document.querySelector('[data-call-guest-fields]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))`), false)
        await click(role('back') + ' button')
        await waitFor('fixtureChooser.open && !fixturePopup.open')
      }
      assert.equal(await evaluate('fixture.bookings.length'), 0, 'switching invalid call types never books')
      assert.equal(await evaluate('fixture.requests.some(request => /payment/.test(request.path))'), false)
      observations.push(entry + '-stray-guest-switching-blocked')
    }
    for (const type of ['free', 'paid']) {
      await navigate('legacy=1&stray=1')
      await click('#' + type)
      await waitFor(`!!document.querySelector('[data-paid-calendar-status="error"]')`)
      await evaluate(`document.querySelector('#stray-guest-row').remove()`)
      assert.equal(await evaluate(type === 'free'
        ? 'StartersFreeCallBooking.installFreeBookingController(fixtureSettings(false))'
        : 'fixtureApi.installPaidBookingController(fixtureSettings(true))'), true)
      await openDetails(type)
      assert.equal(await evaluate(`document.querySelector('[data-call-guest-email]').getClientRects().length > 0`), true, 'another error controller cannot hide accepted guest fields')
      await fill('[data-call-guest-email]', 'restored@example.invalid')
      await click(confirm)
      await waitFor('fixture.bookings.length === 1')
      assert.deepEqual(await evaluate('fixture.bookings[0].guest_emails'), ['restored@example.invalid'])
      observations.push(type + '-authored-guests-survive-other-error-controller')
    }
    await navigate()
    await evaluate('fixture.mountReschedule()')
    assert.equal(await evaluate(`document.querySelector('#reschedule').querySelectorAll('input,textarea').length`), 0)
    assert.match(await evaluate(`document.querySelector('#reschedule ${role('confirm')}').textContent`), /Propose new time/)
    await click('#reschedule [data-paid-calendar-slot]')
    await click('#reschedule ' + role('confirm'))
    assert.ok(await evaluate('fixture.reschedule && fixture.reschedule.start'))
    assert.equal(await evaluate('fixture.bookings.length'), 0)
    observations.push('reschedule-retains-one-step')
    assert.deepEqual(errors, [], 'no uncaught browser exceptions')
    assert.deepEqual(layoutFailures, [], 'desktop details must show two columns without overflow')
    await fs.writeFile(path.join(evidence, 'observations.json'), JSON.stringify({ boundary: 'Local Chrome fixture; real Free/Paid controllers and renderer; synthetic authenticated API. Paid ready-card path only; no provider requests.', observations }, null, 2))
    console.log('PASS: ' + observations.join(', '))
  } finally {
    socket?.close()
    const closed = chrome.exitCode !== null || chrome.signalCode !== null ? Promise.resolve() : new Promise(resolve => chrome.once('exit', resolve))
    chrome.kill()
    await closed
    await new Promise(resolve => server.close(resolve))
    await fs.rm(profile, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
