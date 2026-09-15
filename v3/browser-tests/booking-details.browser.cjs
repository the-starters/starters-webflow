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
    let chooseDefaultForBooking = false
    const click = async selector => {
      assert.ok(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), selector)
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
      await pause(30)
      if (chooseDefaultForBooking && selector === confirm && await evaluate(`document.querySelector('[data-modal-target="popup-stripe-card"]').open`)) {
        await waitFor(`document.querySelector('[customer-cards-list] [aria-checked="true"]') && !document.querySelector('[pm-use-this] button').disabled`)
        await evaluate(`document.querySelector('[pm-use-this]').click()`)
        await waitFor(`!document.querySelector('[data-modal-target="popup-stripe-card"]').open`)
        await evaluate(`document.querySelector('${confirm}').click()`)
        await pause(30)
      }
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
    const openDetails = async (type, captureCalendar = false) => {
      await click('#' + type)
      await waitFor(`!!document.querySelector('[data-paid-calendar-slot]')`)
      if (captureCalendar) {
        await screenshot(type + '-calendar')
        assert.deepEqual(await evaluate(`(() => {
          const shell = document.querySelector('[data-paid-calendar-element="shell"]');
          const style = getComputedStyle(shell), bounds = shell.getBoundingClientRect();
          const footer = shell.querySelector('[data-paid-calendar-element="footer"]').getBoundingClientRect();
          const times = shell.querySelector('[data-paid-calendar-element="times"]').getBoundingClientRect();
          return {
            columnGapRem: parseFloat(style.columnGap) / parseFloat(getComputedStyle(document.documentElement).fontSize),
            rowGap: parseFloat(style.rowGap),
            footerSpansShell: Math.abs(footer.left - bounds.left) < 1 && Math.abs(footer.right - bounds.right) < 1,
            footerBelowTimes: footer.top >= times.bottom - 1,
          };
        })()`), { columnGapRem: 2, rowGap: 0, footerSpansShell: true, footerBelowTimes: true },
        type + ' desktop calendar keeps its spacing and footer below both columns')
        assert.equal(await evaluate(`(() => {
          const slot = document.querySelector('[data-paid-calendar-slot]');
          const rect = slot.getBoundingClientRect();
          const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return slot === target || slot.contains(target);
        })()`), true, type + ' calendar time button must be clickable at its visible center')
      }
      await click('[data-paid-calendar-slot]')
      assert.match(await evaluate(`document.querySelector('${role('confirm')}').textContent`), /Continue/)
      const before = await evaluate('fixture.bookings.length')
      await click(confirm)
      await waitFor(`getComputedStyle(document.querySelector('${role('details')}')).display === 'grid'`)
      assert.equal(await evaluate('fixture.bookings.length'), before, 'Continue does not submit')
      assert.deepEqual(await evaluate(`['participant-name','participant-email'].map(role => { const el = document.querySelector('[data-paid-calendar-element="'+role+'"]'); return [el.value,el.readOnly] })`), [['Brand Fixture', true], ['brand@example.invalid', true]])
    }
    await navigate()
    await openDetails('paid')
    await fill(context, 'Keep this message')
    await fill(guests, 'guest@example.invalid')
    await click(confirm)
    await waitFor(`document.querySelector('[data-modal-target="popup-stripe-card"]').open`)
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-payment-card-label]')).fontSize`), '18px', 'payment title follows the 1.125rem design')
    assert.equal(await evaluate('fixture.bookings.length'), 0, 'opening payment selection does not request the Call')
    await waitFor(`document.querySelectorAll('[customer-cards-list] [role="radio"]').length === 2`)
    await click('[customer-cards-list] [data-id="pm_other"]')
    await click('[pm-use-this]')
    await waitFor(`!document.querySelector('[data-modal-target="popup-stripe-card"]').open`)
    assert.equal(await evaluate('fixture.bookings.length'), 0, 'Use this card returns to review')
    assert.equal(await evaluate(`document.querySelector('${context}').value`), 'Keep this message')
    assert.equal(await evaluate(`document.querySelector('${guests}').value`), 'guest@example.invalid')
    assert.match(await evaluate(`document.querySelector('[data-booking-payment-review]').textContent`), /0042/)
    await click(confirm)
    await waitFor('fixture.bookings.length === 1')
    assert.equal(await evaluate('fixture.bookings[0].expected_payment_method_id'), 'pm_other')
    assert.equal(await evaluate(`document.querySelector('[paid-call-text]').textContent`),
      'Your card ending in 0042 will be used for this call.', 'receipt identifies the booked card and preserves leading zeroes')
    observations.push('booking-linked-card-receipt')
    const openPayment = async () => {
      await click(confirm)
      await waitFor(`document.querySelector('[data-modal-target="popup-stripe-card"]').open`)
    }
    const chooseCard = async (id = 'pm_original') => {
      await waitFor(`!!document.querySelector('[customer-cards-list] [data-id="${id}"]')`)
      await click(`[customer-cards-list] [data-id="${id}"]`)
      await click('[pm-use-this]')
      await waitFor(`!document.querySelector('[data-modal-target="popup-stripe-card"]').open`)
    }
    const addCard = async () => {
      await click('[data-booking-payment-picker] [aria-label="Add payment method"]')
      await waitFor(`document.querySelectorAll('[data-stripe-field] input').length === 3`)
    }
    const fillCard = async () => {
      for (const name of ['cardNumber', 'cardExpiry', 'cardCvc']) await fill(`[aria-label="${name}"]`, 'valid')
    }
    for (const receiptCard of [null, {id:'pm_original',last4:'12'}, {id:'pm_original',last4:42}, {id:'pm_foreign',last4:'1234'}]) {
      await navigate()
      await openDetails('paid')
      await openPayment()
      await chooseCard()
      await evaluate(`fixture.receiptCard = ${JSON.stringify(receiptCard)}`)
      await click(confirm)
      await waitFor('fixture.bookings.length === 1')
      assert.equal(await evaluate(`document.querySelector('[paid-call-text]').textContent`), 'Your saved payment method will be used for this call.')
      assert.equal(await evaluate('fixture.bookings.length'), 1, 'missing receipt metadata must not retry the booking')
    }
    observations.push('receipt-metadata-fallbacks')
    for (const id of [null, '', undefined]) {
      await navigate()
      await openDetails('paid')
      await openPayment()
      await chooseCard()
      await evaluate(`fixture.receiptMethodId = ${JSON.stringify(id)}; fixture.receiptCard = {id:${JSON.stringify(id)},last4:'1234'}`)
      await click(confirm)
      await waitFor('fixture.bookings.length === 1')
      assert.equal(await evaluate(`document.querySelector('[paid-call-text]').textContent`), 'Your saved payment method will be used for this call.')
    }
    observations.push('receipt-requires-booking-payment-identity')

    await navigate()
    await openDetails('paid')
    await openPayment()
    await chooseCard()
    await evaluate(`fixture.defaultCard = 'pm_other'`)
    await click(confirm)
    await waitFor('fixture.bookings.length === 1')
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[schedule-step="success"]')).display`), 'none')
    assert.match(await evaluate(`document.querySelector('[data-booking-payment-review]').textContent`), /changed/)
    await click(confirm)
    await waitFor(`document.querySelector('[data-modal-target="popup-stripe-card"]').open`)
    await chooseCard('pm_other')
    await click(confirm)
    await waitFor('fixture.bookings.length === 2')
    assert.notEqual(await evaluate('fixture.bookings[0].idempotency_key'), await evaluate('fixture.bookings[1].idempotency_key'))
    observations.push('changed-default-requires-review')
    await navigate('', 390)
    await evaluate('fixture.cards = []; fixture.failList = 1')
    await openDetails('paid')
    await fill(context, 'Preserve on add')
    await openPayment()
    await waitFor(`document.querySelector('[data-payment-selection-status]').textContent.includes('could not')`)
    await click('[aria-label="Retry loading cards"]')
    await waitFor(`document.querySelector('[data-payment-selection-status]').textContent.includes('No saved cards')`)
    assert.equal(await evaluate(`document.querySelector('[pm-use-this] button').disabled`), true)
    await addCard()
    assert.equal(await evaluate(`document.querySelector('[save-card-btn] button').disabled`), true)
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[pm-use-this]').parentElement).display`), 'none', 'entry hides the entire inactive footer')
    await fillCard()
    await evaluate('fixture.failSetup = 1')
    await click('[save-card-btn]')
    await waitFor(`document.querySelector('[card-error]').textContent.includes('could not be saved')`)
    assert.equal(await evaluate('fixture.bookings.length'), 0)
    await click('[save-card-btn]')
    await waitFor(`!document.querySelector('[data-modal-target="popup-stripe-card"]').open`)
    assert.equal(await evaluate('fixture.bookings.length'), 0, 'saving a new card does not request the Call')
    assert.equal(await evaluate(`document.querySelector('${context}').value`), 'Preserve on add')
    assert.match(await evaluate(`document.querySelector('[data-booking-payment-review]').textContent`), /0007/)
    await screenshot('added-card-mobile-review')
    await click(confirm)
    await waitFor('fixture.bookings.length === 1')
    assert.equal(await evaluate('fixture.bookings[0].expected_payment_method_id'), 'pm_added')
    observations.push('empty-list-retry-add-card-review-mobile')
    for (const dismissal of ['back', 'close', 'backdrop', 'nested-backdrop', 'escape']) {
      await navigate()
      await openDetails('paid')
      if (dismissal === 'nested-backdrop') await evaluate(`(() => {
        const modal = document.querySelector('[popup-stripe-card]');
        modal.removeAttribute('popup-stripe-card');
        modal.querySelector('.modal_content-layout').setAttribute('popup-stripe-card', '');
      })()`)
      await fill(context, 'Keep through ' + dismissal)
      await fill(guests, 'stay@example.invalid')
      await openPayment()
      await addCard()
      if (dismissal === 'back') await click('[data-payment-card-back] button')
      if (dismissal.endsWith('backdrop')) await click('[data-fixture-payment-backdrop]')
      if (dismissal === 'close') await click('[popup-stripe-card] [data-modal-close]')
      if (dismissal === 'escape') await evaluate(`document.querySelector('[popup-stripe-card]').dispatchEvent(new Event('cancel', {cancelable:true}))`)
      await waitFor(`document.querySelector('[data-modal-target="popup-stripe-card"]').getAttribute('data-booking-payment-mode') === 'picker'`)
      assert.equal(await evaluate(`document.querySelector('[data-modal-target="popup-stripe-card"]').open`), true)
      await chooseCard()
      assert.equal(await evaluate(`document.querySelector('${context}').value`), 'Keep through ' + dismissal)
      assert.equal(await evaluate(`document.querySelector('${guests}').value`), 'stay@example.invalid')
      assert.equal(await evaluate('fixture.bookings.length'), 0)
    }
    observations.push('entry-back-close-backdrop-nested-escape-preserve-draft')
    await navigate()
    await openDetails('paid')
    await openPayment()
    await addCard()
    await fillCard()
    await evaluate('fixture.pausePath = fixtureApi.SETUP_PATH')
    await click('[save-card-btn]')
    await waitFor('fixture.waiting')
    await click('[data-payment-card-back] button')
    await evaluate('fixture.pausePath = null; fixture.release()')
    await waitFor('!fixture.waiting')
    assert.equal(await evaluate('fixture.requests.some(r => r.path.endsWith(fixtureApi.SET_DEFAULT_PATH))'), false)
    assert.equal(await evaluate('fixture.bookings.length'), 0)
    await chooseCard()
    observations.push('late-setup-cannot-save-after-back')
    await navigate()
    await openDetails('paid')
    await openPayment()
    await addCard()
    await fillCard()
    await evaluate('fixture.pausePath = fixtureApi.SETUP_PATH')
    await click('[save-card-btn]')
    await waitFor('fixture.waiting')
    await evaluate('fixture.oldRelease = fixture.release; fixture.pausePath = null')
    await click('[data-payment-card-back] button')
    await addCard()
    await fillCard()
    await click('[save-card-btn]')
    await waitFor(`!document.querySelector('[data-modal-target="popup-stripe-card"]').open`)
    await evaluate('fixture.oldRelease()')
    await waitFor('!fixture.waiting')
    assert.equal(await evaluate('fixture.requests.filter(r => r.path.endsWith(fixtureApi.SET_DEFAULT_PATH)).length'), 1)
    assert.equal(await evaluate('fixture.bookings.length'), 0)
    assert.match(await evaluate(`document.querySelector('[data-booking-payment-review]').textContent`), /0007/)
    observations.push('late-save-cannot-overwrite-new-entry')

    for (const closeWhilePending of ['booking', 'reinstall']) {
      await navigate()
      await openDetails('paid')
      await openPayment()
      await addCard()
      await fillCard()
      await evaluate('fixture.pausePath = fixtureApi.SETUP_PATH')
      await click('[save-card-btn]')
      await waitFor('fixture.waiting')
      if (closeWhilePending === 'booking') await click('#close')
      else await evaluate('fixtureApi.installPaidBookingController(fixtureSettings(true))')
      await evaluate('fixture.pausePath = null; fixture.release()')
      await waitFor('!fixture.waiting')
      assert.equal(await evaluate('fixture.stripeFields.size'), 0, 'replaced/closed owner destroys secure fields')
      assert.equal(await evaluate('fixture.requests.some(r => r.path.endsWith(fixtureApi.SET_DEFAULT_PATH))'), false)
      assert.equal(await evaluate('fixture.bookings.length'), 0)
    }
    observations.push('booking-close-and-replacement-invalidate-setup')
    await navigate()
    await openDetails('paid')
    await openPayment()
    // Pause loading Stripe at the external script boundary, then replace owner.
    await evaluate(`fixture.originalStripe = window.Stripe; delete window.Stripe`)
    await click('[data-booking-payment-picker] [aria-label="Add payment method"]')
    await waitFor(`!!document.querySelector('script[src="https://js.stripe.com/v3/"]')`)
    await evaluate('fixtureApi.installPaidBookingController(fixtureSettings(true))')
    await evaluate(`window.Stripe = fixture.originalStripe; document.querySelector('script[src="https://js.stripe.com/v3/"]').dispatchEvent(new Event('load'))`)
    assert.equal(await evaluate('fixture.stripeFields.size'), 0, 'late Stripe load cannot mount for replaced owner')
    assert.equal(await evaluate('fixture.bookings.length'), 0)
    observations.push('late-stripe-load-ignored')
    await navigate()
    await openDetails('paid')
    await openPayment()
    await addCard()
    await fillCard()
    await evaluate('fixture.failDefault = 1')
    await click('[save-card-btn]')
    await waitFor(`!!document.querySelector('[card-error]').textContent`)
    await click('[save-card-btn]')
    await waitFor(`!document.querySelector('[data-modal-target="popup-stripe-card"]').open`)
    const paymentRequests = await evaluate(`fixture.requests.filter(r => r.path.endsWith(fixtureApi.SETUP_PATH) || r.path.endsWith(fixtureApi.SET_DEFAULT_PATH))`)
    assert.equal(paymentRequests.length, 4)
    assert.deepEqual(paymentRequests[0].body, paymentRequests[2].body, 'setup retry preserves command key')
    assert.deepEqual(paymentRequests[1].body, paymentRequests[3].body, 'default retry preserves command key')
    await evaluate('fixture.failBookings = 1')
    await click(confirm)
    await waitFor('fixture.bookings.length === 1')
    await click(confirm)
    await waitFor('fixture.bookings.length === 2')
    assert.deepEqual(await evaluate('fixture.bookings[0]'), await evaluate('fixture.bookings[1]'))
    assert.equal(await evaluate(`fixture.requests.filter(r => r.path.endsWith(fixtureApi.SETUP_PATH)).length`), 2, 'booking retry does not repeat setup')
    observations.push('added-card-ambiguous-retries-retain-command-identities')
    await navigate()
    await openDetails('paid')
    await openPayment()
    await chooseCard()
    await evaluate('fixture.failBookings = 1')
    await click(confirm)
    await waitFor('fixture.bookings.length === 1')
    await waitFor(`!document.querySelector('${confirm}').disabled`)
    assert.equal(await evaluate(`document.querySelector('[data-booking-payment-change] button').disabled`), true, 'uncertain booking cannot switch payment identity')
    assert.equal(await evaluate(`document.querySelector('${context}').readOnly`), true, 'uncertain booking retains reviewed details')
    await click('[data-booking-payment-change] button')
    assert.equal(await evaluate(`document.querySelector('[data-modal-target="popup-stripe-card"]').open`), false)
    await click(confirm)
    await waitFor('fixture.bookings.length === 2')
    assert.deepEqual(await evaluate('fixture.bookings[0]'), await evaluate('fixture.bookings[1]'))
    observations.push('ambiguous-booking-locks-card-and-draft-until-resolved')
    await navigate('legacy=1')
    await openDetails('paid')
    await fill('[data-call-guest-email]', 'retained@example.invalid')
    await openPayment()
    await chooseCard()
    await evaluate('fixture.unresolvedBooking = true')
    await click(confirm)
    await waitFor('fixture.bookings.length === 1')
    assert.equal(await evaluate(`document.querySelector('[data-call-guest-email]').readOnly`), true)
    assert.equal(await evaluate(`document.querySelector('[data-booking-payment-change] button').disabled`), true)
    assert.equal(await evaluate(`document.querySelector('${role('back')}').hasAttribute('data-paid-calendar-busy')`), true)
    await click(confirm)
    await waitFor('fixture.bookings.length === 2')
    assert.deepEqual(await evaluate('fixture.bookings[0]'), await evaluate('fixture.bookings[1]'))
    observations.push('unresolved-provider-response-locks-authored-details-and-back')


    await navigate()
    await openDetails('paid')
    await openPayment()
    await waitFor(`!!document.querySelector('[customer-cards-list] [aria-checked="true"]')`)
    await evaluate(`document.querySelector('[customer-cards-list] [aria-checked="true"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`)
    assert.equal(await evaluate(`document.activeElement.getAttribute('data-id')`), 'pm_other')
    assert.equal(await evaluate(`document.querySelector('[pm-use-this]').parentElement.getBoundingClientRect().height > 0`), true)
    await screenshot('saved-card-picker-desktop')
    await click('[pm-use-this]')
    await waitFor(`!document.querySelector('[data-modal-target="popup-stripe-card"]').open`)
    assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), 'Change card')
    await click('[data-booking-payment-change] button')
    await addCard()
    await screenshot('card-entry-desktop')
    assert.match(await evaluate(`document.querySelector('[data-modal-target="popup-stripe-card"]').getAttribute('aria-labelledby')`), /paid-card/)
    assert.equal(await evaluate(`document.querySelector('[card-error]').getAttribute('role')`), 'alert')
    assert.equal(await evaluate(`document.querySelector('[save-card-status]').getAttribute('role')`), 'status')
    assert.equal(await evaluate(`document.documentElement.scrollWidth > innerWidth`), false)
    observations.push('keyboard-picker-and-focus-return')
    chooseDefaultForBooking = true
    for (const type of ['free', 'paid']) {
      await navigate()
      assert.deepEqual(await evaluate('fixture.installs'), { free: true, paid: true })
      await openDetails(type, true)
      await screenshot(type + '-desktop-initial')
      const guestLayout = await evaluate(`(() => {
        const input=document.querySelector('${guests}').getBoundingClientRect(), remove=document.querySelector('${role('guest-remove')}').getBoundingClientRect();
        const add=document.querySelector('${role('guest-add')}'), style=getComputedStyle(document.querySelector('${role('guest-remove')}'));
        const icon=document.querySelector('${role('guest-remove-icon')}').getBoundingClientRect();
        return {width:remove.width,height:remove.height,iconWidth:icon.width,iconHeight:icon.height,background:style.backgroundColor,color:style.color,radius:style.borderRadius,inside:remove.x>=input.x && remove.right<=input.right && remove.y>=input.y && remove.bottom<=input.bottom,secondary:!!add.closest('[data-button-style="secondary"]')};
      })()`)

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
      await fs.writeFile(path.join(evidence, type + '-booking-requests.json'), JSON.stringify({
        boundary: 'Synthetic authenticated API; requests emitted by the real booking controller.',
        requests: await evaluate('fixture.requests.filter(request => request.method === "POST")'),
        payloads,
      }, null, 2))
      await waitFor(`getComputedStyle(document.querySelector('[schedule-step="success"]')).display !== 'none'`)
      const receipt = await evaluate(`(() => {
        const step = document.querySelector('[schedule-step="success"]');
        return Object.fromEntries(['start-date','start-time','starter-name','context','price'].map(name => [name,
          [...step.querySelectorAll('[booking-element="'+name+'"]')].map(el => ({text:el.textContent, groupVisible:getComputedStyle(el.closest('[booking-element-wrap]')).display !== 'none'}))]));
      })()`)
      for (const name of ['start-date', 'start-time', 'context']) {
        assert.ok(receipt[name].length, 'receipt has authored ' + name)
        assert.ok(receipt[name].every(field => field.groupVisible), type + ' receipt reveals ' + name)
      }
      assert.ok(receipt.context.every(field => field.text === 'Discuss the launch plan'))
      assert.ok(receipt['starter-name'].every(field => field.text === 'Starter' && field.groupVisible))
      const receiptDate = new Date(payloads[0].start)
      const receiptDay = new Intl.DateTimeFormat('en-US', {day:'numeric',timeZone:payloads[0].timezone}).format(receiptDate)
      assert.ok(Number(receiptDay) < 10, 'receipt regression must exercise a single-digit day')
      const expectedDate = new Intl.DateTimeFormat('en-US', {month:'long',day:type === 'free' ? '2-digit' : 'numeric',year:'numeric',timeZone:payloads[0].timezone}).format(receiptDate)
      assert.ok(receipt['start-date'].every(field => field.text === expectedDate))
      assert.ok(receipt['start-time'].every(field => field.text !== '3:00PM EST'))
      assert.ok(receipt.price.every(field => field.groupVisible && field.text === (type === 'paid' ? '$250' : '$0')))
      await screenshot(type + '-request-success')
      assert.deepEqual(guestLayout, {width:36,height:36,iconWidth:12,iconHeight:12,background:'rgba(221, 85, 85, 0.1)',color:'rgb(221, 85, 85)',radius:'2px',inside:true,secondary:true})
      assert.equal(await evaluate(`document.querySelectorAll('${role('call-summary')}').length`), 0)
      await click('#close')
      await waitFor(`[...document.querySelectorAll('[schedule-step="success"] [booking-element-wrap]')].every(el => getComputedStyle(el).display === 'none')`)
      assert.equal(await evaluate(`document.querySelector('[booking-element="starter-name"]').textContent`), '[Starter]')
      await openDetails(type)
      assert.equal(await evaluate(`document.querySelector('${context}').value`), '')
      assert.equal(await evaluate(`document.querySelector('${guests}').value`), '')
      await fill(context, 'Discard this draft')
      await click('#close')
      await openDetails(type)
      assert.equal(await evaluate(`document.querySelector('${context}').value`), '')
      observations.push(type + '-request-retry-close-passed')
    }
    for (const type of ['free', 'paid']) {
      await navigate('', 390)
      await openDetails(type)
      assert.deepEqual(await evaluate(`(() => {const a=document.querySelector('${role('selected-event')}').getBoundingClientRect(),b=document.querySelector('${role('details-fields')}').getBoundingClientRect();return {stacked:b.y>=a.bottom-1,overflow:document.documentElement.scrollWidth>innerWidth}})()`), { stacked: true, overflow: false })
      await screenshot(type + '-mobile-details')
      assert.equal(await evaluate(`(() => {const input=document.querySelector('${guests}').getBoundingClientRect(),remove=document.querySelector('${role('guest-remove')}').getBoundingClientRect();return remove.x>=input.x && remove.right<=input.right && remove.y>=input.y && remove.bottom<=input.bottom})()`), true)
      await click(confirm)
      await waitFor(`getComputedStyle(document.querySelector('[schedule-step="success"]')).display !== 'none'`)
      assert.equal(await evaluate(`(() => {
        const step=document.querySelector('[schedule-step="success"]');
        return [...step.querySelectorAll('[booking-element="start-date"]')].some(el=>el.getBoundingClientRect().width>0) &&
          [...step.querySelectorAll('[booking-element="start-time"]')].some(el=>el.getBoundingClientRect().width>0) &&
          step.querySelector('[booking-element="context"]').textContent==='No message provided.' && document.documentElement.scrollWidth<=innerWidth;
      })()`), true, type + ' mobile receipt shows date/time and an empty-message label without overflow')
      await screenshot(type + '-mobile-receipt')
    }
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
    for (const entry of ['hire', 'messages']) {
      for (const placement of ['nested', 'nested-complete', 'outside']) {
        for (const first of ['free', 'paid']) {
          await navigate(`legacy=1&preserve=1&entry=${entry}&preinstall=${first}${placement !== 'outside' ? '&nested=1' : ''}${placement !== 'nested-complete' ? '&partial=1' : ''}`)
          if (entry === 'hire') await waitFor(`document.querySelector('#paid').getAttribute('data-paid-call-v3') === 'ready'`)
          assert.equal(await evaluate('fixture.authoredIntact()'), true, 'installation preserves authored nodes, parents, and supplied guests')
          for (const type of ['free', 'paid', 'free']) {
            await click('#book-entry')
            await waitFor('fixtureChooser.open')
            await click('#' + type)
            await waitFor(`fixturePopup.open && !!document.querySelector('[data-paid-calendar-status="error"]')`)
            assert.equal(await evaluate('fixture.authoredIntact()'), true, 'error rendering preserves rejected markup in place')
            assert.equal(await evaluate(`document.querySelector('[data-paid-calendar-status="error"]').getClientRects().length > 0`), true)
            assert.equal(await evaluate(`document.querySelectorAll('${confirm}, [data-paid-calendar-slot]').length`), 0)
            assert.equal(await evaluate(`document.querySelector('[data-call-guest-fields]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))`), false)
            await evaluate(`fixtureApi.installPaidBookingController(fixtureSettings(true)); StartersFreeCallBooking.installFreeBookingController(fixtureSettings(false))`)
            assert.equal(await evaluate('fixture.authoredIntact()'), true, 'reinstalling against an open error preserves markup')
            await click('#close')
            assert.equal(await evaluate('fixture.authoredIntact()'), true, 'close and reset preserve rejected markup')
          }
          assert.equal(await evaluate('fixture.bookings.length'), 0)
          assert.equal(await evaluate('fixture.requests.some(request => /payment/.test(request.path))'), false)
          await evaluate(`(() => {
            const host = document.querySelector('#legacy-host')
            fixturePopup.querySelector('[schedule-step="default"]').appendChild(host)
            const list = host.querySelector('[data-call-guest-list]')
            if (list.querySelectorAll('[data-call-guest-row]').length < 5) {
              const row = list.querySelector('[data-call-guest-row]').cloneNode(true)
              row.querySelector('input').value = ''
              list.appendChild(row)
            }
            StartersFreeCallBooking.installFreeBookingController(fixtureSettings(false))
            fixtureApi.installPaidBookingController(fixtureSettings(true))
          })()`)
          for (const type of ['free', 'paid']) {
            await click('#book-entry')
            await waitFor('fixtureChooser.open')
            await openDetails(type)
            const before = await evaluate('fixture.bookings.length')
            await fill('[data-call-guest-email]', 'repaired@example.invalid')
            await click(confirm)
            await waitFor(`fixture.bookings.length === ${before + 1}`)
            assert.deepEqual(await evaluate('fixture.bookings.at(-1).guest_emails'), ['repaired@example.invalid'], 'actual markup repair permits authored guest submission')
            await click('#close')
          }
          observations.push(`${entry}-${placement}-${first}-first-preserved-and-repaired`)
        }
      }
    }
    for (const entry of ['hire', 'messages']) {
      for (const placement of ['container', 'step', 'body', 'header', 'close']) {
        await navigate(`legacy=1&partial=1&preserve=1&entry=${entry}&protected=${placement}`)
        assert.deepEqual(await evaluate('[fixturePopup.open, fixtureChooser.open]'), [false, false])
        if (entry === 'hire') await waitFor(`document.querySelector('#paid').getAttribute('data-paid-call-v3') === 'ready'`)
        const assertErrorVisible = async () => {
          await waitFor(`fixturePopup.open && !!document.querySelector('[data-paid-calendar-status="error"]')`)
          assert.deepEqual(await evaluate(`(() => {
            const banner = document.querySelector('[data-paid-calendar-status="error"]')
            const close = document.querySelector('#close')
            const back = document.querySelector('[data-booking-back] button')
            const visible = node => {
              const rect = node.getBoundingClientRect()
              if (!rect.width || !rect.height || rect.top < 0 || rect.bottom > innerHeight) return false
              for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
                const style = getComputedStyle(ancestor)
                if (style.display === 'none' || style.visibility === 'hidden') return false
              }
              return true
            }
            return { visible: [banner, close, back].every(visible),
              background: getComputedStyle(banner).backgroundColor, color: getComputedStyle(banner).color,
              intact: fixture.authoredIntact() && fixture.protectedIntact() }
          })()`), { visible: true, background: 'rgb(221, 85, 85)', color: 'rgb(255, 255, 255)', intact: true })
          assert.equal(await evaluate(`document.querySelectorAll('${confirm}, [data-paid-calendar-slot]').length`), 0)
          assert.equal(await evaluate(`document.querySelector('#legacy-host form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))`), false)
        }
        for (const type of ['free', 'paid']) {
          await click('#book-entry')
          await waitFor('fixtureChooser.open')
          await click('#' + type)
          await assertErrorVisible()
          await screenshot(`${entry}-${type}-${placement}-protected-error`)
          await click(role('back') + ' button')
          await waitFor('fixtureChooser.open && !fixturePopup.open')
          await click('#' + type)
          await assertErrorVisible()
          await click('#close')
          assert.equal(await evaluate('fixturePopup.open'), false)
          assert.deepEqual(await evaluate(`(() => { const style = document.querySelector('#legacy-host [data-call-guest-fields]').style; return [style.display, style.getPropertyPriority('display')] })()`), ['block', 'important'])
        }
        assert.equal(await evaluate('fixture.bookings.length'), 0)
        assert.equal(await evaluate('fixture.requests.some(request => /payment/.test(request.path))'), false)
        observations.push(`${entry}-${placement}-keeps-error-and-navigation-visible`)
      }
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
    await fs.writeFile(path.join(evidence, 'observations.json'), JSON.stringify({ boundary: 'Local Chrome fixture; real Free/Paid controllers and renderer; synthetic authenticated API. Paid saved/new-card review, receipt, retries and cancellation; no provider requests.', observations }, null, 2))
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
