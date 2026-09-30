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
      const state = await evaluate(`(() => {
        const card = el => {
          const slot = el.querySelector('[next-available-slot]')
          return {
            visible: el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none',
            display: getComputedStyle(el).display,
            ariaHidden: el.getAttribute('aria-hidden'),
            type: el.getAttribute('data-call-offer-type'),
            state: el.getAttribute('data-service-card-state'),
            offerState: el.getAttribute('data-call-offer-state'),
            busy: el.getAttribute('aria-busy') === 'true',
            price: el.querySelector('[data-millify]').textContent,
            tooltip: el.querySelector('[hover-text]').textContent,
            tooltipDisplay: getComputedStyle(el.querySelector('[data-call-offer-tooltip]')).display,
            tooltipHidden: el.querySelector('[data-call-offer-tooltip]').hasAttribute('hidden'),
            cursor: getComputedStyle(el).cursor,
            inlineCursor: el.style.cursor,
            slotText: slot ? slot.textContent : null,
            slotVisibility: slot ? getComputedStyle(slot).visibility : null,
            bookingPopup: el.hasAttribute('booking-popup-open'),
            signup: el.getAttribute('data-signup-trigger-element'),
            modal: el.getAttribute('data-modal-trigger'),
            direct: el.getAttribute('data-call-service-direct'),
            tabIndex: el.tabIndex,
            role: el.getAttribute('role'),
            ariaLabel: el.getAttribute('aria-label'),
          }
        }
        const trigger = document.querySelector('[booking-button-wrapper] .button_main-wrap')
        const hitTarget = trigger.querySelector('.clickable_wrap > .clickable_btn')
        const spinner = trigger.querySelector('[data-button-spinner]')
        const loadingHide = trigger.querySelector('[data-opp-element="loading-hide"]')
        return {
          cards: [...document.querySelectorAll('[wf-xano-item]')].map(card),
          legacyCards: [...document.querySelectorAll('[data-call-canary-legacy-wrapper="header"] [data-service-card="component"]')].map(card),
          book: {
            visible: trigger.getBoundingClientRect().height > 0,
            disabled: trigger.getAttribute('aria-disabled') === 'true',
            loading: trigger.hasAttribute('data-booking-trigger-loading'),
            busy: trigger.getAttribute('aria-busy') === 'true',
            signup: trigger.getAttribute('data-signup-trigger-element'),
            modal: trigger.getAttribute('data-modal-trigger'),
            cursor: getComputedStyle(hitTarget).cursor,
            spinner: getComputedStyle(spinner).display,
            spinnerInline: spinner.style.display,
            loadingHide: getComputedStyle(loadingHide).display,
            loadingHideInline: loadingHide.style.display,
          },
        }
      })()`)
      observations.push({ label, ...state })
      if (evidence) { const shot = await send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(evidence, `${label}.png`), Buffer.from(shot.data, 'base64')) }
      return state
    }
    const navigate = async query => {
      await send('Page.navigate', { url: `http://www.thestarters.com:${server.address().port}/v3/browser-tests/hire-calls.html?${query}` })
      let ready = false
      for (let i = 0; i < 100; i++) {
        if (await evaluate(`(() => {
          const cards = [...document.querySelectorAll('[wf-xano-instance^="starter-call-offers-"] [wf-xano-item]')]
          const callsSettled = !!document.querySelector('[data-call-offer-type]') ||
            (cards.length === 4 && cards.every(card => getComputedStyle(card).display === 'none'))
          return document.readyState === 'complete' &&
            !!window.lumos?.modal?.list['signup-modal'] && callsSettled
        })()`)) {
          ready = true
          break
        }
        await pause(50)
      }
      assert.equal(ready, true, `browser fixture did not become ready for ${query}`)
      await pause(150)
    }
    const assertBookCall = async (role, available) => {
      const button = await evaluate(`(() => { const el = document.querySelector('[booking-button-wrapper] .clickable_wrap > .clickable_btn'); el.scrollIntoView({block: 'center'}); const r = el.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2} })()`)
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
    await navigate('role=brand&discovery=held&header=legacy')
    let legacyState = await snapshot('brand-legacy-header-loading')
    assert.equal(legacyState.legacyCards.length, 2)
    assert.ok(legacyState.legacyCards.every(card => card.visible && card.state === 'Default'))
    assert.ok(legacyState.legacyCards.every(card => card.offerState === 'loading' && card.busy))
    assert.ok(legacyState.legacyCards.every(card => card.slotText === '00:00pm on 00/00' && card.slotVisibility === 'hidden' && card.cursor === 'progress'), 'loading masks the slot and shows progress')
    assert.ok(legacyState.legacyCards.every(card => card.signup === null && card.modal === null && card.direct === null))
    assert.ok(legacyState.legacyCards.every(card => card.tabIndex === -1 && card.role === null && card.ariaLabel === null), 'loading removes the Book Call button role')
    await evaluate(`document.querySelector('[data-call-canary-legacy-wrapper="header"] [data-type="free"]').click()`)
    await pause(50)
    assert.deepEqual(await evaluate(`({ entries: bookingEntries.length, chooser: document.querySelector('[data-modal-target="popup-booking-main"]').open, booking: document.querySelector('[data-modal-target="popup-booking"]').open })`), { entries: 0, chooser: false, booking: false })
    assert.equal(await evaluate('resolveStarterDiscovery()'), true)
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`(() => { const cards = [...document.querySelectorAll('[data-call-canary-legacy-wrapper="header"] [data-service-card="component"]')]; return cards.length === 2 && cards.every(card => card.getAttribute('data-call-offer-state') === 'available') })()`)) break
      await pause(25)
    }
    legacyState = await snapshot('brand-legacy-header-available')
    assert.equal(legacyState.legacyCards.length, 2)
    assert.ok(legacyState.legacyCards.every(card => card.visible && card.offerState === 'available' && !card.busy))
    // origin/main semantics once known: a focusable, named button with its hooks.
    assert.ok(legacyState.legacyCards.every(card => card.tabIndex === 0 && card.role === 'button' && card.ariaLabel === 'Book a Call'))
    assert.ok(legacyState.legacyCards.every(card => card.modal === 'popup-booking-main' && card.signup === 'service' && card.direct === 'ready'))
    assert.equal(await evaluate(`(() => { const el = document.querySelector('[data-call-canary-legacy-wrapper="header"] [data-type="free"]'); el.focus(); return document.activeElement === el })()`), true, 'keyboard can reach the offered tout')
    const legacyFree = await evaluate(`(() => { const el = document.querySelector('[data-call-canary-legacy-wrapper="header"] [data-type="free"]'); el.scrollIntoView({block: 'center'}); const r = el.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2} })()`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...legacyFree, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...legacyFree, button: 'left', clickCount: 1 })
    await pause(100)
    assert.deepEqual(await evaluate(`({ entry: bookingEntries.at(-1), chooser: document.querySelector('[data-modal-target="popup-booking-main"]').open, booking: document.querySelector('[data-modal-target="popup-booking"]').open, label: document.querySelector('#booking-type').textContent })`), {
      entry: 'free', chooser: false, booking: true, label: 'Free Call booking entry',
    })
    await evaluate('lumos.modal.closeAll()')

    await navigate('role=brand&discovery=held&header=legacy')
    legacyState = await snapshot('brand-legacy-header-loading-empty')
    assert.equal(legacyState.legacyCards.length, 2)
    assert.ok(legacyState.legacyCards.every(card => card.offerState === 'loading' && card.busy))
    assert.equal(await evaluate(`resolveStarterDiscovery('empty')`), true)
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`(() => { const cards = [...document.querySelectorAll('[data-call-canary-legacy-wrapper="header"] [data-service-card="component"]')]; return cards.length === 2 && cards.every(card => card.getAttribute('data-call-offer-state') === 'hidden') })()`)) break
      await pause(25)
    }
    legacyState = await snapshot('brand-legacy-header-hidden')
    assert.equal(legacyState.legacyCards.length, 2)
    assert.ok(legacyState.legacyCards.every(card => !card.visible && card.display === 'none'))
    assert.ok(legacyState.legacyCards.every(card => card.ariaHidden === 'true' && card.offerState === 'hidden' && !card.busy))

    for (const role of ['anonymous', 'free']) {
      await navigate(`role=${role}&header=legacy&dto=held`)
      let publicLegacy = await snapshot(`${role}-legacy-header-loading`)
      assert.equal(publicLegacy.legacyCards.length, 2)
      assert.ok(publicLegacy.legacyCards.every(card => card.visible && card.offerState === 'loading' && card.busy), `${role}: legacy touts wait for the DTO`)
      assert.ok(publicLegacy.legacyCards.every(card => card.signup === null && card.modal === null && card.direct === null))
      assert.equal(publicLegacy.cards.length, 2)
      assert.ok(publicLegacy.cards.every(card => card.visible && card.offerState === 'loading' && card.busy))
      await evaluate(`lists['starter-call-offers-services'].emit(false)`)
      for (let i = 0; i < 100; i++) {
        if (await evaluate(`[...document.querySelectorAll('[data-call-canary-legacy-wrapper="header"] [data-service-card="component"]')].every(card => card.getAttribute('data-call-offer-state') !== 'loading')`)) break
        await pause(25)
      }
      publicLegacy = await snapshot(`${role}-legacy-header-settled`)
      const [legacyOffered, legacyRefused] = publicLegacy.legacyCards
      assert.ok(legacyOffered.visible && legacyOffered.offerState === 'available' && !legacyOffered.busy && legacyOffered.signup === 'service')
      assert.ok(legacyOffered.tabIndex === 0 && legacyOffered.role === 'button' && legacyOffered.ariaLabel === 'Book a Call' && legacyOffered.modal === null, `${role}: the offered tout is a focusable signup button, as on origin/main`)
      assert.ok(!legacyRefused.visible && legacyRefused.offerState === 'hidden' && !legacyRefused.busy && legacyRefused.ariaHidden === 'true')
      assert.ok(legacyRefused.signup === null && legacyRefused.modal === null && legacyRefused.role === null, `${role}: a hidden tout keeps no hook`)
    }
    for (const role of ['anonymous', 'free']) {
      // The public Algolia record reaches markServiceCardsClickable while the
      // DTO is held. Clones that carry data-service-card, as published
      // clones do, must keep the loading progress cursor until they settle.
      await navigate(`role=${role}&header=legacy&dto=held&servicecard=authored`)
      let cursorState = await snapshot(`${role}-services-cursor-loading`)
      assert.equal(cursorState.cards.length, 2)
      assert.ok(cursorState.cards.every(card => card.visible && card.offerState === 'loading' && card.busy))
      assert.ok(cursorState.cards.every(card => card.cursor === 'progress' && card.inlineCursor === ''), `${role}: loading Services clones keep the progress cursor`)
      await evaluate(`lists['starter-call-offers-services'].emit(false)`)
      for (let i = 0; i < 100; i++) {
        if (await evaluate(`[...document.querySelectorAll('#services [wf-xano-item]')].every(card => card.getAttribute('data-call-offer-state') !== 'loading')`)) break
        await pause(25)
      }
      cursorState = await snapshot(`${role}-services-cursor-settled`)
      const [cursorOffered, cursorRefused] = cursorState.cards
      assert.ok(cursorOffered.visible && cursorOffered.offerState === 'available' && cursorOffered.cursor === 'pointer' && cursorOffered.inlineCursor === 'pointer', `${role}: an offered Services card gets the origin/main pointer`)
      assert.ok(!cursorRefused.visible && cursorRefused.offerState === 'hidden')
    }
    await navigate('role=talent&header=legacy')
    const talentLegacy = await snapshot('talent-legacy-header')
    assert.equal(talentLegacy.legacyCards.length, 2)
    assert.equal(talentLegacy.cards.length, 2)
    assert.ok(talentLegacy.legacyCards.concat(talentLegacy.cards).every(card => !card.visible && card.offerState === 'hidden' && !card.busy), 'talent sees no call card')

    for (const grantOrder of ['fast', 'slow']) {
      await navigate(`role=owner&owner=loading&header=legacy&tooltip=shown${grantOrder === 'slow' ? '&discovery=held' : ''}`)
      let ownerLegacyState = await snapshot(`owner-legacy-${grantOrder}-grant-loading`)
      assert.equal(ownerLegacyState.legacyCards.length, 2)
      assert.ok(ownerLegacyState.legacyCards.every(card => card.visible && card.state === 'Default'))
      assert.ok(ownerLegacyState.legacyCards.every(card => card.offerState === 'settings-loading' && card.busy))
      assert.ok(ownerLegacyState.legacyCards.every(card => card.tooltipDisplay === 'none' && card.tooltipHidden && card.slotVisibility === 'hidden'), 'settings-loading hides the authored-visible tooltip')
      assert.ok(ownerLegacyState.legacyCards.every(card => card.cursor === 'progress'))
      assert.ok(ownerLegacyState.legacyCards.every(card => !card.bookingPopup && card.signup === null && card.modal === null && card.direct === null))
      if (grantOrder === 'slow') {
        assert.equal(await evaluate('resolveStarterDiscovery()'), true)
        await pause(100)
        ownerLegacyState = await snapshot('owner-legacy-slow-grant-settled-settings-loading')
        assert.equal(ownerLegacyState.legacyCards.length, 2)
        assert.ok(ownerLegacyState.legacyCards.every(card => card.offerState === 'settings-loading' && card.busy))
      }
    }

    await navigate('role=brand&discovery=held')
    let loadingState = await snapshot('brand-discovery-loading')
    assert.equal(loadingState.cards.length, 4)
    assert.ok(loadingState.cards.every(card => card.visible && card.offerState === 'loading' && card.busy), 'Brand cards wait for discovery')
    assert.ok(loadingState.cards.every(card => card.slotText === '00:00pm on 00/00' && card.slotVisibility === 'hidden' && card.cursor === 'progress'), 'loading masks the slot and shows progress')
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
      if (await evaluate(`!document.querySelector('[booking-button-wrapper] .button_main-wrap').hasAttribute('data-booking-trigger-loading')`)) break
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
    assert.equal(loadingState.book.loadingHide, 'flex')
    assert.equal(loadingState.book.loadingHideInline, 'inline-flex')
    for (const role of ['anonymous', 'free']) {
      await navigate(`role=${role}`)
      const state = await snapshot(`${role}-settled`)
      assert.equal(state.cards.length, 4)
      assert.ok(state.cards.every(card => card.visible && card.offerState === 'available' && !card.busy), `${role}: public cards settle without aria-busy`)
    }
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
        assert.ok(state.cards.every(card => !card.busy && card.offerState === 'available'), 'settled cards drop aria-busy')
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
        assert.equal(state.cards.length, 4)
        assert.ok(state.cards.every(card => card.visible === (card.type === 'free')))
        assert.ok(state.cards.every(card => !card.busy && card.offerState === (card.type === 'free' ? 'available' : 'hidden')), 'revoked cards settle without aria-busy')
      }
    }
    for (const owner of ['ready', 'off', 'calendar', 'stripe', 'stale', 'loading', 'error']) {
      await navigate(`role=owner&owner=${owner}&failed=header${owner === 'loading' ? '&tooltip=shown' : ''}`)
      const state = await snapshot(`owner-${owner}`)
      assert.equal(state.cards.length, 4, 'owners retain two cards in both wrappers')
      assert.ok(state.cards.every(card => card.visible), 'owners retain both cards in both wrappers')
      assert.ok(state.cards.every(card => card.state === (owner === 'ready' || owner === 'loading' ? 'Default' : owner === 'stripe' || owner === 'stale' ? card.type === 'free' ? 'Default' : 'Disabled' : 'Disabled')), JSON.stringify(state))
      const messages = { off: { free: 'Enable your Free Call service.', paid: 'Enable and price your Paid Call service.' }, calendar: { free: 'Connect your calendar to offer calls.', paid: 'Connect your calendar to offer calls.' }, stripe: { paid: 'Connect Stripe to offer paid calls.' }, stale: { paid: 'Refresh your Stripe connection to offer paid calls.' }, loading: { free: '', paid: '' }, error: { free: 'Call settings could not be loaded. Refresh or open Call Settings.', paid: 'Call settings could not be loaded. Refresh or open Call Settings.' } }
      for (const card of state.cards) if (messages[owner]?.[card.type] !== undefined) assert.equal(card.tooltip, messages[owner][card.type])
      if (owner === 'loading') {
        assert.ok(state.cards.every(card => card.offerState === 'settings-loading' && card.busy && card.tooltipDisplay === 'none' && card.tooltipHidden))
        assert.ok(state.cards.every(card => card.cursor === 'progress'))
        assert.ok(state.cards.every(card => card.slotText === '00:00pm on 00/00' && card.slotVisibility === 'hidden'))
      }
    }
    assert.deepEqual(errors, [], 'no uncaught browser errors')
    if (evidence) await fs.writeFile(path.join(evidence, 'observations.json'), JSON.stringify({ boundary: 'Local fixture; real adapter, attribution, modal; synthetic data and booking controllers', observations }, null, 2))
    console.log(`PASS: ${observations.length} native-browser observations; canonical and legacy calls, signup, booking entry, owner states`)
  } finally {
    socket?.close()
    const closed = new Promise(resolve => chrome.once('exit', resolve))
    chrome.kill()
    await closed
    await new Promise(resolve => server.close(resolve))
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
