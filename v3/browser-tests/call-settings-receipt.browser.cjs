// Focused native-browser acceptance for the Build Profile -> Call Settings
// receipt handoff edges:
//   node v3/browser-tests/call-settings-receipt.browser.cjs
// Optional: CHROME_BIN and CALL_RECEIPT_BROWSER_EVIDENCE (screenshots/observations).
//
// Real scheduling-auth bridge, real free/paid call controllers, real onboarding
// tour, real canonical-profile-loader dirty-state module, authored step 6 and
// dashboard DOM. Synthetic Memberstack, Xano and driver.js boundaries; not
// production Webflow proof.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { spawn, execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
// The commit before "fix: keep receipt cleanup outside profile edits": it already
// hydrates and consumes the receipt, but re-renders outside the hydration
// boundary and leaves the tour's member-JSON write unserialized.
const BASE_COMMIT = process.env.CALL_RECEIPT_BASE_COMMIT || '86a5ad08'
// The commit before "canonical rate outranks pending receipt": it paints the
// unconsumed Build Profile rate over a confirmed canonical rate.
const RATE_BASE_COMMIT = process.env.CALL_RECEIPT_RATE_BASE_COMMIT || 'e450dfc3'
// The commit before "consume pending call receipt when declining with no
// service": declining an unconsumed "Yes" receipt writes nothing, so the Build
// Profile answer survives and re-asserts itself on the next load.
const DECLINE_BASE_COMMIT = process.env.CALL_RECEIPT_DECLINE_BASE_COMMIT || 'f507851d'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
;(async () => {
  const profile = await fs.mkdtemp(path.join(root, '.call-receipt-browser-'))
  const evidence = process.env.CALL_RECEIPT_BROWSER_EVIDENCE
  if (evidence) await fs.mkdir(evidence, { recursive: true })
  const server = http.createServer(async (req, res) => {
    const requested = new URL(req.url, 'http://local').pathname
    const send = (body, type) => {
      res.setHeader('Content-Type', type)
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'")
      res.end(body)
    }
    for (const [prefix, commit] of [['/base/', BASE_COMMIT], ['/base-rate/', RATE_BASE_COMMIT], ['/base-decline/', DECLINE_BASE_COMMIT]]) {
      if (!requested.startsWith(prefix)) continue
      try {
        send(execFileSync('git', ['show', `${commit}:${requested.slice(prefix.length)}`], { cwd: root }), 'text/javascript')
      } catch { res.writeHead(404).end() }
      return
    }
    const file = requested === '/starter-edit-profile'
      ? path.join(__dirname, 'call-settings-receipt.html')
      : requested === '/starter-dashboard'
        ? path.join(__dirname, 'call-settings-receipt-dashboard.html')
        : requested === '/build-profile/full-profile'
          ? path.join(__dirname, 'call-settings-receipt-build-profile.html')
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
  const results = []
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
    let dialogs = []
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text)
      if (message.method === 'Page.javascriptDialogOpening') {
        dialogs.push({ type: message.params.type, message: message.params.message })
        socket.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }))
      }
      if (message.id && pending.has(message.id)) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(message.error) : task.resolve(message.result) }
    })
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timed out: ${method}`)) }, 30000)
      pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
      socket.send(JSON.stringify({ id: requestId, method, params }))
    })
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    await send('Runtime.enable')
    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 860, height: 1000, deviceScaleFactor: 2, mobile: false })

    const observations = []
    const READ = `((root) => ({
      callStatus: {
        free: document.documentElement.getAttribute('data-free-call-settings'),
        paid: document.documentElement.getAttribute('data-paid-call-settings'),
      },
      buildIntent: {
        free: root ? root.getAttribute('data-free-build-call-intent') : null,
        paid: root ? root.getAttribute('data-paid-build-call-intent') : null,
      },
      free: { yes: document.getElementById('free-yes').checked, no: document.getElementById('free-no').checked, description: document.getElementById('free-call-description').value },
      paid: document.getElementById('paid-price-output') ? {
        enabled: document.querySelector('[data-call-settings-service="paid"]').getAttribute('data-paid-call-enabled'),
        bookable: document.querySelector('[data-call-settings-service="paid"]').getAttribute('data-paid-call-bookable'),
        buildIntent: document.querySelector('[data-call-settings-service="paid"]').getAttribute('data-paid-build-call-intent'),
        displayedRate: document.getElementById('paid-price-output').textContent,
        rateInput: document.getElementById('paid-call-rate').value,
        titleInput: document.getElementById('paid-call-title').value,
      } : null,
      memberJson: window.__tsMemberJsonState(),
      pendingWrites: window.__tsPendingWriteCount(),
      writes: window.__tsMemberJsonLog.filter(entry => entry.op === 'write').length,
      reads: window.__tsMemberJsonLog.filter(entry => entry.op === 'read').length,
      unsavedChanges: window.__tsProfileDirtyState ? window.__tsProfileDirtyState.isDirty() : null,
      leavePagePrompt: window.__tsProfileDirtyState ? window.__tsBeforeUnloadPrompts() : null,
      tourPopover: !!document.querySelector('.driver-popover'),
      network: window.__tsNetworkLog,
    }))(document.querySelector('[data-call-settings-service="free"], [data-form="step"][data-index="6"]'))`
    const snapshot = async (label, note) => {
      const state = await evaluate(READ)
      observations.push({ label, note, ...state })
      if (evidence) {
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
        await fs.writeFile(path.join(evidence, `${label}.png`), Buffer.from(shot.data, 'base64'))
      }
      return state
    }
    // A click anywhere outside step 6 gives the frame the user activation Chrome
    // requires before it will show a beforeunload prompt at all, without
    // touching a single form control.
    const clickHeading = async () => {
      const box = await evaluate(`(() => { const r = document.querySelector('h1').getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 } })()`)
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...box, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...box, button: 'left', clickCount: 1 })
    }
    // Leaves the page the way a member does. Any beforeunload prompt Chrome
    // raises is captured, then accepted so the run continues.
    const leavePage = async () => {
      dialogs = []
      await send('Page.navigate', { url: 'about:blank' })
      await pause(500)
      return dialogs
    }
    const navigate = async (route, query) => {
      errors = []
      dialogs = []
      await send('Page.navigate', { url: `http://www.thestarters.com:${server.address().port}${route}?${query}` })
      for (let i = 0; i < 300; i++) {
        if (await evaluate(`document.readyState === 'complete' && !!window.__tsControllersLoaded`)) break
        await pause(50)
      }
    }
    const settleUntil = async (predicate, attempts = 120) => {
      for (let i = 0; i < attempts; i++) { if (await evaluate(predicate)) return true; await pause(50) }
      return false
    }
    const BUILD_READ = `({
      success: getComputedStyle(document.querySelector('[build-profile-success]')).display,
      error: getComputedStyle(document.querySelector('[build-profile-error]')).display,
      errorMessage: document.querySelector('[build-profile-error] div').textContent,
      paidRateValidation: document.getElementById('paid-call-rate').validationMessage,
      focusedField: document.activeElement && document.activeElement.id,
      onboardingCta: document.querySelector('[build-profile-success] [dashboard-button-wrap] .button').getAttribute('href'),
      profileSaves: window.__tsProfileRequestLog(),
      memberJson: window.__tsMemberJsonState(),
      network: window.__tsNetworkLog,
    })`
    const buildSnapshot = async (label, note) => {
      const state = await evaluate(BUILD_READ)
      observations.push({ label, note, ...state })
      if (evidence) {
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
        await fs.writeFile(path.join(evidence, `${label}.png`), Buffer.from(shot.data, 'base64'))
      }
      return state
    }
    const clickSubmit = async () => {
      const box = await evaluate(`(() => { const el = document.querySelector('[form-submit]'); el.scrollIntoView(); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...box, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...box, button: 'left', clickCount: 1 })
    }
    const record = (name, detail) => { results.push({ name, detail }); console.log(`  ok  ${name}`) }
    const xanoWrites = state => state.network.filter(entry => entry.method !== 'GET')

    // ------------------------------------------------------------------
    // 1. Edit Profile: an already-satisfied off receipt is consumed without
    //    creating an unsaved step-6 state, so leaving the page is silent.
    // ------------------------------------------------------------------
    const openEditProfile = async query => {
      await navigate('/starter-edit-profile', query)
      assert.ok(await settleUntil(`document.documentElement.getAttribute('data-free-call-settings') === 'ready' && document.documentElement.getAttribute('data-paid-call-settings') === 'ready'`), 'both controllers hydrate')
      assert.ok(await settleUntil('window.__tsPendingWriteCount() === 1'), 'the receipt cleanup write is in flight')
      // The Edit Profile profile hydration completes here, the same point where
      // canonical-profile-loader.js calls finishHydration() in production.
      assert.equal(await evaluate('window.__tsFinishProfileHydration()'), true)
      assert.equal((await evaluate(READ)).unsavedChanges, false, 'step 6 is clean the moment hydration finishes')
      await evaluate('window.__tsOpenGate()')
      assert.ok(await settleUntil(`!window.__tsMemberJsonState().starter_call_settings_intent_v3`), 'the satisfied receipt is dropped from the member JSON')
    }

    await openEditProfile('page=edit&receipt=off-both&gate=1')
    const pendingSeen = observations.length
    assert.ok(await settleUntil(`document.querySelector('[data-form="step"][data-index="6"]').getAttribute('data-free-build-call-intent') === ''`), 'the Free card repaints without the pending affordance')
    const consumed = await snapshot('01-edit-head-consumed-no-unsaved-changes', 'HEAD, satisfied off receipt consumed, step 6 still clean')
    assert.equal(consumed.free.no, true, 'the Free card reads the No the member chose in Build Profile')
    assert.deepEqual(consumed.buildIntent, { free: '', paid: '' }, 'both cards drop the pending affordance after consumption')
    assert.equal(consumed.unsavedChanges, false, 'auto-consuming the receipt leaves no unsaved step-6 state')
    assert.equal(await evaluate('window.StarterFreeCallSettings.hasChanges()'), false, 'the Free controller reports nothing to save')
    assert.equal(await evaluate('window.StarterPaidCallSettings.hasChanges()'), false, 'the Paid controller reports nothing to save')
    assert.equal(consumed.memberJson.keep, 'private', 'unrelated member JSON keys survive the cleanup')
    assert.deepEqual(xanoWrites(consumed), [], 'consuming a satisfied receipt sends no canonical write')
    assert.deepEqual(errors, [], 'no uncaught browser errors')
    await clickHeading()
    const quietExit = await leavePage()
    assert.deepEqual(quietExit, [], 'leaving the page raises no unsaved-changes prompt')
    record('edit-profile-off-receipt-auto-consume-leaves-step-6-clean', {
      unsavedChanges: consumed.unsavedChanges, leavePagePrompt: quietExit, memberJson: consumed.memberJson, pendingSeen,
    })

    // ------------------------------------------------------------------
    // 2. Same page, same member: a real member edit after the consume still
    //    marks step 6 dirty and still guards navigation.
    // ------------------------------------------------------------------
    await openEditProfile('page=edit&receipt=off-both&gate=1')
    await settleUntil(`document.querySelector('[data-form="step"][data-index="6"]').getAttribute('data-free-build-call-intent') === ''`)
    const yesBox = await evaluate(`(() => { const r = document.getElementById('free-yes').closest('label').getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 } })()`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...yesBox, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...yesBox, button: 'left', clickCount: 1 })
    await pause(200)
    const edited = await snapshot('02-edit-head-real-edit-marks-dirty', 'HEAD, member clicks Free = Yes after the consume')
    assert.equal(edited.free.yes, true, 'the click lands on the Free Yes radio')
    assert.equal(edited.unsavedChanges, true, 'a real member edit still marks step 6 dirty')
    const guardedExit = await leavePage()
    assert.equal(guardedExit.length, 1, 'a real member edit still raises the browser unsaved-changes prompt')
    assert.equal(guardedExit[0].type, 'beforeunload')
    record('edit-profile-real-member-edit-after-consume-still-prompts', { unsavedChanges: edited.unsavedChanges, dialogs: guardedExit })

    // ------------------------------------------------------------------
    // 3. Pre-fix control: the same page, same steps, controllers from the
    //    commit before the fix.
    // ------------------------------------------------------------------
    await openEditProfile('page=edit&receipt=off-both&gate=1&base=free-call-settings.js,paid-call-settings.js')
    assert.ok(await settleUntil('window.__tsProfileDirtyState.isDirty() === true'), 'pre-fix build marks step 6 dirty from its own repaint')
    const prefix = await snapshot('03-edit-prefix-unsaved-changes-from-repaint', 'pre-fix build, same receipt, step 6 now reports unsaved changes')
    assert.equal(prefix.unsavedChanges, true, 'pre-fix regression reproduces: the synthetic repaint marks step 6 dirty')
    await clickHeading()
    const prefixExit = await leavePage()
    assert.equal(prefixExit.length, 1, 'pre-fix regression reproduces: leaving the untouched page prompts about unsaved changes')
    record('edit-profile-pre-fix-control-prompts-about-unsaved-changes', { unsavedChanges: prefix.unsavedChanges, dialogs: prefixExit })

    // ------------------------------------------------------------------
    // 4. Adversarial: a receipt bound to a different member is never hydrated
    //    and never consumed.
    // ------------------------------------------------------------------
    await navigate('/starter-edit-profile', 'page=edit&receipt=foreign&gate=1')
    assert.ok(await settleUntil(`document.documentElement.getAttribute('data-free-call-settings') === 'ready' && document.documentElement.getAttribute('data-paid-call-settings') === 'ready'`), 'controllers hydrate')
    await evaluate('window.__tsFinishProfileHydration()')
    await pause(600)
    const foreign = await snapshot('04-edit-head-foreign-receipt-ignored', "HEAD, receipt bound to another member's id")
    assert.deepEqual(foreign.buildIntent, { free: '', paid: '' }, "another member's receipt is never painted as a pending choice")
    assert.equal(foreign.writes, 0, "another member's receipt is never written to")
    assert.equal(foreign.pendingWrites, 0, 'no member JSON write is even attempted')
    assert.equal(foreign.memberJson.starter_call_settings_intent_v3.member_id, 'mem_sb_someone_else', "the other member's receipt is left intact")
    assert.equal(foreign.unsavedChanges, false, 'an ignored receipt creates no unsaved step-6 state')
    record('edit-profile-receipt-bound-to-another-member-is-ignored', { buildIntent: foreign.buildIntent, writes: foreign.writes })

    // ------------------------------------------------------------------
    // 5. Dashboard: the onboarding tour's seen write waits for the in-flight
    //    receipt consumption instead of replaying its pre-consume snapshot.
    // ------------------------------------------------------------------
    await navigate('/starter-dashboard', 'page=dashboard&receipt=free-off-paid-pending&gate=1')
    assert.ok(await settleUntil(`document.documentElement.getAttribute('data-free-call-settings') === 'ready'`), 'the Free card hydrates')
    assert.ok(await settleUntil('window.__tsPendingWriteCount() === 1'), 'the receipt cleanup write is in flight')
    assert.ok(await settleUntil(`!!document.querySelector('.driver-popover')`, 200), 'the onboarding tour starts')
    await pause(800)
    const tourHeld = await snapshot('05-dashboard-head-tour-write-queued', 'HEAD, tour showing while the receipt cleanup write is still open')
    assert.equal(tourHeld.pendingWrites, 1, "the tour's seen write waits behind the receipt cleanup instead of racing it")
    assert.equal(tourHeld.writes, 1, 'only the receipt cleanup has reached Memberstack')

    await evaluate('window.__tsOpenGate()')
    assert.ok(await settleUntil(`!!window.__tsMemberJsonState().tours`), 'the tour seen-stamp is persisted')
    await pause(300)
    const dashboard = await snapshot('06-dashboard-head-tour-seen-receipt-stays-consumed', 'HEAD, tour marked seen after the receipt cleanup landed')
    assert.equal(dashboard.memberJson.starter_call_settings_intent_v3.free, undefined, 'the tour write cannot resurrect the consumed Free branch')
    assert.deepEqual(dashboard.memberJson.starter_call_settings_intent_v3.paid, { enabled: true, title: 'Strategy call', price_dollars: 250 }, 'the untouched Paid branch survives both writes')
    assert.equal(typeof dashboard.memberJson.tours['starter-dashboard'], 'string', 'the tour is marked seen')
    assert.equal(dashboard.memberJson.keep, 'private', 'unrelated member JSON keys survive both writes')
    assert.deepEqual(xanoWrites(dashboard), [], 'no canonical write, booking, charge, message or email call is made')
    assert.deepEqual(errors, [], 'no uncaught browser errors')
    record('dashboard-tour-seen-write-cannot-resurrect-consumed-receipt', { memberJson: dashboard.memberJson })

    // ------------------------------------------------------------------
    // 6. Pre-fix control: the same dashboard sequence with the unserialized tour.
    // ------------------------------------------------------------------
    await navigate('/starter-dashboard', 'page=dashboard&receipt=free-off-paid-pending&gate=1&base=onboarding-tour.js')
    assert.ok(await settleUntil(`document.documentElement.getAttribute('data-free-call-settings') === 'ready'`), 'the Free card hydrates')
    assert.ok(await settleUntil(`!!document.querySelector('.driver-popover')`, 200), 'the onboarding tour starts')
    assert.ok(await settleUntil('window.__tsPendingWriteCount() === 2'), 'pre-fix tour issues its own write while the cleanup is still open')
    await evaluate('window.__tsReleaseNextWrite()')
    await pause(200)
    await evaluate('window.__tsReleaseNextWrite()')
    await pause(300)
    const prefixTour = await snapshot('07-dashboard-prefix-tour-resurrects-receipt', 'pre-fix tour, same sequence: the consumed Free branch comes back')
    assert.deepEqual(prefixTour.memberJson.starter_call_settings_intent_v3.free, { enabled: false, description: '' }, 'pre-fix regression reproduces: the tour write resurrects the consumed Free branch')
    record('dashboard-pre-fix-tour-write-resurrects-consumed-receipt', { memberJson: prefixTour.memberJson })

    // ------------------------------------------------------------------
    // 7. Dashboard tour reset (?tour=reset) serializes with the consumption.
    // ------------------------------------------------------------------
    await navigate('/starter-dashboard', 'page=dashboard&receipt=free-off-paid-pending&gate=1&seen=1&tour=reset')
    assert.ok(await settleUntil(`document.documentElement.getAttribute('data-free-call-settings') === 'ready'`), 'the Free card hydrates')
    assert.ok(await settleUntil('window.__tsPendingWriteCount() >= 1'), 'a member JSON write is in flight')
    assert.equal(await evaluate('window.__tsPendingWriteCount()'), 1, 'reset and cleanup never hold two writes at once')
    await evaluate('window.__tsOpenGate()')
    assert.ok(await settleUntil(`!!document.querySelector('.driver-popover')`, 200), 'the reset replays the tour')
    assert.ok(await settleUntil(`(window.__tsMemberJsonState().tours || {})['starter-dashboard'] > '2026-09-02'`), 'the reset tour is marked seen again with a fresh stamp')
    await pause(300)
    const reset = await snapshot('08-dashboard-head-tour-reset-serialized', 'HEAD, ?tour=reset clears and re-stamps seen state around the receipt cleanup')
    assert.equal(reset.memberJson.starter_call_settings_intent_v3.free, undefined, 'the reset and re-seen writes cannot resurrect the consumed Free branch')
    assert.deepEqual(reset.memberJson.starter_call_settings_intent_v3.paid, { enabled: true, title: 'Strategy call', price_dollars: 250 }, 'the Paid branch survives the reset path')
    assert.equal(reset.memberJson.keep, 'private', 'unrelated member JSON keys survive the reset path')
    assert.deepEqual(xanoWrites(reset), [], 'the reset path makes no canonical write')
    assert.deepEqual(errors, [], 'no uncaught browser errors')
    record('dashboard-tour-reset-write-serializes-with-receipt-consumption', { memberJson: reset.memberJson })

    // ------------------------------------------------------------------
    // 8. Dashboard Paid card: an unconsumed pending rate never outranks the
    //    rate the Starter is actually charging.
    // ------------------------------------------------------------------
    await navigate('/starter-dashboard', 'page=dashboard&paid=1&canonical=paid-active&receipt=paid-pending')
    assert.ok(await settleUntil(`document.documentElement.getAttribute('data-paid-call-settings') === 'ready'`), 'the Paid card hydrates')
    const paidRate = await snapshot('09-dashboard-head-canonical-rate-outranks-receipt', 'HEAD, active $350 canonical service with an unconsumed $250 Build Profile receipt')
    assert.equal(paidRate.paid.enabled, 'true', 'the canonical service is active')
    assert.equal(paidRate.paid.displayedRate, '$350.00', 'the card shows the rate the Starter actually charges, not the pending receipt rate')
    assert.equal(paidRate.paid.rateInput, '250', 'the pending Build Profile choice still prefills the editable rate for setup')
    assert.equal(paidRate.paid.titleInput, 'Strategy call', 'the pending Build Profile title still prefills the editable title')
    assert.equal(paidRate.paid.buildIntent, 'pending', 'the receipt is still pending confirmation')
    assert.deepEqual(xanoWrites(paidRate), [], 'hydrating the pending rate writes nothing')
    record('dashboard-confirmed-canonical-rate-outranks-pending-receipt-rate', {
      displayedRate: paidRate.paid.displayedRate, rateInput: paidRate.paid.rateInput,
    })

    await navigate('/starter-dashboard', 'page=dashboard&paid=1&canonical=paid-active&receipt=paid-pending&base=paid-call-settings.js&baseRef=rate')
    assert.ok(await settleUntil(`document.documentElement.getAttribute('data-paid-call-settings') === 'ready'`), 'the pre-fix Paid card hydrates')
    const paidRatePrefix = await snapshot('10-dashboard-prefix-pending-rate-outranks-canonical', 'pre-fix build, same state: the card advertises the unconfirmed $250')
    assert.equal(paidRatePrefix.paid.displayedRate, '$250.00', 'pre-fix regression reproduces: the card advertises a rate the Starter is not charging')
    record('dashboard-pre-fix-control-displays-unconfirmed-receipt-rate', { displayedRate: paidRatePrefix.paid.displayedRate })

    // ------------------------------------------------------------------
    // 9. Build Profile: the submit that produces the receipt in the first place.
    // ------------------------------------------------------------------
    await navigate('/build-profile/full-profile', 'page=build&receipt=none')
    await clickSubmit()
    assert.ok(await settleUntil(`getComputedStyle(document.querySelector('[build-profile-success]')).display === 'block'`), 'the authored success panel appears')
    const submitted = await buildSnapshot('11-build-profile-submit-writes-receipt', 'HEAD, Free = No and Paid = Yes at $250 submitted from Build Profile')
    assert.equal(submitted.error, 'none', 'no error panel on a clean submit')
    assert.equal(submitted.onboardingCta, '/starter-onboarding', 'the authored onboarding CTA is preserved')
    assert.equal(submitted.profileSaves.length, 1, 'the canonical profile is saved exactly once')
    assert.equal('paid-call-rate' in submitted.profileSaves[0].body, false, 'provider call fields stay out of the canonical profile payload')
    const receipt = submitted.memberJson.starter_call_settings_intent_v3
    assert.equal(receipt.version, 1, 'the receipt carries its envelope version')
    assert.equal(receipt.member_id, 'mem_sb_918receipt', 'the receipt is bound to the submitting member')
    assert.deepEqual(receipt.free, { enabled: false, description: '' }, 'the Free = No choice is stored')
    assert.deepEqual(receipt.paid, { enabled: true, title: 'Strategy call', price_dollars: 250 }, 'the Paid = Yes choice and its rate are stored')
    assert.deepEqual(errors, [], 'no uncaught browser errors')
    record('build-profile-submit-writes-member-bound-receipt-and-keeps-onboarding-cta', {
      onboardingCta: submitted.onboardingCta, receipt,
    })

    // Adversarial: a rate the member can repair must fail before the profile save.
    await navigate('/build-profile/full-profile', 'page=build&receipt=none&rate=0')
    await clickSubmit()
    assert.ok(await settleUntil(`document.getElementById('paid-call-rate').validationMessage.includes('whole-dollar')`), 'the authored rate field names the bad rate')
    const rejected = await buildSnapshot('12-build-profile-invalid-rate-fails-before-save', 'HEAD, Paid = Yes with an unusable rate')
    assert.equal(rejected.paidRateValidation, 'Use a whole-dollar paid-call rate from $1 to $1,000.')
    assert.equal(rejected.focusedField, 'paid-call-rate', 'the invalid authored control receives focus')
    assert.equal(rejected.success, 'none', 'no success panel over a rejected submit')
    assert.equal(rejected.profileSaves.length, 0, 'the canonical profile is never saved behind a member-repairable receipt error')
    assert.equal(rejected.memberJson.starter_call_settings_intent_v3, undefined, 'no receipt is written for a rejected submit')
    record('build-profile-invalid-paid-rate-fails-before-the-canonical-profile-save', {
      errorMessage: rejected.errorMessage, profileSaves: rejected.profileSaves.length,
    })

    // Pre-fix control: the same bad rate used to land after the profile save.
    await navigate('/build-profile/full-profile', 'page=build&receipt=none&rate=0&base=build-profile/submit-writer.js&baseRef=rate')
    await clickSubmit()
    assert.ok(await settleUntil(`document.querySelector('[build-profile-error] div').textContent.includes('whole-dollar')`), 'the pre-fix build also shows the error')
    const rejectedPrefix = await buildSnapshot('13-build-profile-prefix-saves-before-validating', 'pre-fix build, same bad rate: the profile is already saved')
    assert.equal(rejectedPrefix.profileSaves.length, 1, 'pre-fix regression reproduces: the member sees an error over an already-saved profile')
    record('build-profile-pre-fix-control-saves-profile-before-validating-receipt', { profileSaves: rejectedPrefix.profileSaves.length })

    // ------------------------------------------------------------------
    // 10. Edit Profile: a member who changes their mind and declines an
    //     unconsumed Build Profile "Yes" keeps that decline.
    // ------------------------------------------------------------------
    const openDeclineSurface = async query => {
      await navigate('/starter-edit-profile', query)
      assert.ok(await settleUntil(`document.documentElement.getAttribute('data-free-call-settings') === 'ready'`), 'the Free card hydrates')
      assert.equal(await evaluate('window.__tsFinishProfileHydration()'), true)
      assert.equal(await evaluate('window.__tsPendingWriteCount()'), 0, 'an unconsumed enable receipt is never auto-consumed')
      const noBox = await evaluate(`(() => { const r = document.getElementById('free-no').closest('label').getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 } })()`)
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...noBox, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...noBox, button: 'left', clickCount: 1 })
      await pause(200)
      // What the Edit Profile step 6 save runs for a card that reports changes
      // (starter-edit-profile.js submitCanonicalCallSettings).
      return evaluate(`(async () => {
        const controller = window.StarterFreeCallSettings
        const changed = controller.hasChanges()
        const saved = changed ? await controller.submit() : null
        return { changed, stepSaveAccepted: !changed || Boolean(saved) }
      })()`)
    }

    await navigate('/starter-edit-profile', 'page=edit&receipt=free-pending')
    assert.ok(await settleUntil(`document.querySelector('[data-form="step"][data-index="6"]').getAttribute('data-free-build-call-intent') === 'pending'`), 'the Build Profile Yes is carried into step 6')
    const carried = await snapshot('14-edit-head-pending-yes-carried-into-step-6', 'HEAD, unconsumed Build Profile Free = Yes prefilled before the member changes their mind')
    assert.equal(carried.free.yes, true, 'the Build Profile Yes is preselected')
    assert.equal(carried.free.description, 'Quick intro', 'the Build Profile description is prefilled')

    const declined = await openDeclineSurface('page=edit&receipt=free-pending')
    assert.equal(declined.changed, true, 'clicking No marks step 6 as having a call-settings change')
    assert.equal(declined.stepSaveAccepted, true, 'Edit Profile accepts the step 6 save')
    assert.ok(await settleUntil(`!window.__tsMemberJsonState().starter_call_settings_intent_v3`), 'the declined receipt is removed from the member JSON')
    const declinedState = await snapshot('15-edit-head-decline-persists', 'HEAD, member declined the pending Yes and the receipt is gone')
    assert.equal(declinedState.free.no, true, 'the card keeps the No the member just chose')
    assert.equal(declinedState.free.description, '', 'the prefilled Build Profile description is dropped')
    assert.equal(declinedState.buildIntent.free, '', 'the pending affordance is gone')
    assert.equal(declinedState.memberJson.keep, 'private', 'unrelated member JSON keys survive the decline')
    assert.deepEqual(xanoWrites(declinedState), [], 'declining with no canonical service makes no canonical write')
    assert.deepEqual(errors, [], 'no uncaught browser errors')
    // The receipt is what a reload re-hydrates from, so its absence is the proof
    // the Build Profile Yes cannot come back.
    assert.equal(await evaluate(`(async () => { const json = (await window.$memberstackDom.getMemberJSON()).data; return JSON.stringify(json.starter_call_settings_intent_v3 || null) })()`), 'null', 'nothing is left for the next page load to re-assert')
    record('edit-profile-declining-an-unconsumed-yes-receipt-persists-the-decline', {
      memberJson: declinedState.memberJson, freeRadio: declinedState.free,
    })

    // Pre-fix control: the same decline used to be a silent no-op.
    const declinedPrefix = await openDeclineSurface('page=edit&receipt=free-pending&base=free-call-settings.js&baseRef=decline')
    assert.equal(declinedPrefix.stepSaveAccepted, true, 'pre-fix Edit Profile also reports step 6 as saved')
    await pause(400)
    const prefixDecline = await snapshot('16-edit-prefix-decline-lost', 'pre-fix build, same decline: the Build Profile Yes survives in the member JSON')
    assert.deepEqual(prefixDecline.memberJson.starter_call_settings_intent_v3.free, { enabled: true, description: 'Quick intro' }, 'pre-fix regression reproduces: the declined Yes is still stored and re-asserts on the next load')
    record('edit-profile-pre-fix-control-drops-the-decline-and-keeps-the-build-profile-yes', {
      memberJson: prefixDecline.memberJson,
    })

    // ------------------------------------------------------------------
    // 11. Adversarial: a pending Paid "Yes" cannot buy its way past the
    //     Stripe and scheduling prerequisites.
    // ------------------------------------------------------------------
    await navigate('/starter-dashboard', 'page=dashboard&paid=1&receipt=paid-pending&seen=1')
    assert.ok(await settleUntil(`document.documentElement.getAttribute('data-paid-call-settings') === 'ready'`), 'the Paid card hydrates')
    const clickPaid = async action => {
      const box = await evaluate(`(() => { const el = document.querySelector('[data-call-settings-service="paid"] [data-call-settings-action="${action}"]'); el.scrollIntoView(); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...box, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...box, button: 'left', clickCount: 1 })
      await pause(300)
    }
    await clickPaid('open')
    const submitState = await evaluate(`(() => { const el = document.querySelector('[data-call-settings-service="paid"] [data-call-settings-action="submit"]'); return { ariaDisabled: el.getAttribute('aria-disabled'), pointerEvents: el.style.pointerEvents } })()`)
    assert.equal(submitState.ariaDisabled, 'true', 'Update is not offered for a pending Yes the prerequisites cannot honour')
    await clickPaid('submit')
    await pause(500)
    const blocked = await snapshot('17-dashboard-head-pending-paid-blocked-on-stripe', 'HEAD, pending Paid = Yes at $250 with no Stripe or scheduling setup')
    assert.equal(blocked.paid.enabled, 'false', 'no canonical paid service is created')
    assert.equal(blocked.paid.rateInput, '250', 'the Build Profile rate still prefills the editable field for setup')
    assert.equal(blocked.paid.buildIntent, 'pending', 'the receipt stays pending until the setup is finished')
    assert.equal(await evaluate(`document.querySelector('[data-call-settings-service="paid"] [data-call-settings-output="status"]').textContent`),
      'Your Build Profile choice is saved. Complete Calendar, Availability, and Stripe setup to turn on paid calls.',
      'the card keeps naming the missing prerequisites instead of offering a save that cannot succeed')
    assert.deepEqual(xanoWrites(blocked), [], 'clicking the inert Update writes nothing canonical while Stripe is unconnected')
    // The same guard from the controller's own entry point, not just the
    // disabled button: this is what the Edit Profile step 6 save calls.
    const forced = await evaluate(`(async () => {
      const saved = await window.StarterPaidCallSettings.save()
      return { saved, status: document.querySelector('[data-call-settings-service="paid"] [data-call-settings-output="status"]').textContent }
    })()`)
    assert.equal(forced.saved, null, 'a forced save is refused while the prerequisites are unmet')
    assert.equal(forced.status, 'Complete the calendar and Stripe setup before you turn on paid calls.', 'the refusal names the missing Stripe setup')
    const stillBlocked = await snapshot('18-dashboard-head-forced-save-refused', 'HEAD, forced save refused and the receipt left untouched')
    assert.deepEqual(xanoWrites(stillBlocked), [], 'the forced save sends no canonical write either')
    assert.deepEqual(stillBlocked.memberJson.starter_call_settings_intent_v3.paid, { enabled: true, title: 'Strategy call', price_dollars: 250 }, 'the unconfirmed receipt survives so the choice is not silently lost')
    assert.deepEqual(errors, [], 'no uncaught browser errors')
    record('dashboard-pending-paid-yes-cannot-bypass-stripe-readiness', {
      status: forced.status, paidEnabled: stillBlocked.paid.enabled, receipt: stillBlocked.memberJson.starter_call_settings_intent_v3,
    })

    // The same pending receipt must let the Starter change their mind before
    // those prerequisites exist. Off consumes only the receipt and makes no
    // canonical provider write.
    await navigate('/starter-dashboard', 'page=dashboard&paid=1&receipt=paid-pending&seen=1')
    assert.ok(await settleUntil(`document.documentElement.getAttribute('data-paid-call-settings') === 'ready'`), 'the Paid decline card hydrates')
    await clickPaid('open')
    await evaluate(`document.getElementById('paid-no').click()`)
    await clickPaid('submit')
    assert.ok(await settleUntil(`!window.__tsMemberJsonState().starter_call_settings_intent_v3`), 'the declined receipt is consumed')
    const dashboardDecline = await snapshot('19-dashboard-head-pending-paid-decline-persists', 'HEAD, pending Paid = Yes declined before Stripe or scheduling setup')
    assert.equal(await evaluate(`document.getElementById('paid-no').checked`), true, 'the authored No radio stays selected')
    assert.equal(dashboardDecline.paid.buildIntent, '', 'the pending marker clears after the decline')
    assert.deepEqual(xanoWrites(dashboardDecline), [], 'declining with no service makes no canonical provider write')
    record('dashboard-declining-a-gated-pending-paid-receipt-persists-off', {
      memberJson: dashboardDecline.memberJson,
      paidEnabled: dashboardDecline.paid.enabled,
    })

    // ------------------------------------------------------------------
    // 12. A pending "Yes" the canonical service already satisfies exactly is
    //     retired on load, with no canonical write and no stale prefill.
    // ------------------------------------------------------------------
    await navigate('/starter-dashboard', 'page=dashboard&paid=1&canonical=paid-active&receipt=paid-satisfied&seen=1')
    assert.ok(await settleUntil(`document.documentElement.getAttribute('data-paid-call-settings') === 'ready'`), 'the satisfied Paid card hydrates')
    assert.ok(await settleUntil(`!window.__tsMemberJsonState().starter_call_settings_intent_v3`), 'the already-satisfied receipt is consumed')
    await clickPaid('open')
    const satisfied = await snapshot('20-dashboard-head-satisfied-receipt-consumed', 'HEAD, pending Paid = Yes that the live $350 canonical service already satisfies')
    assert.equal(satisfied.paid.enabled, 'true', 'the canonical paid service stays on')
    assert.equal(satisfied.paid.displayedRate, '$350.00', 'the card keeps showing the canonical rate')
    assert.equal(satisfied.paid.rateInput, '350', 'the editable rate holds the canonical value, not a stale receipt value')
    assert.equal(satisfied.paid.titleInput, 'Deep-dive strategy session', 'the editable title holds the canonical value')
    assert.equal(satisfied.paid.buildIntent, '', 'the pending marker clears once the receipt is retired')
    assert.deepEqual(xanoWrites(satisfied), [], 'retiring a satisfied receipt makes no canonical provider write')
    assert.deepEqual(errors, [], 'no uncaught browser errors')
    record('dashboard-satisfied-pending-yes-is-retired-without-a-canonical-write', {
      memberJson: satisfied.memberJson, displayedRate: satisfied.paid.displayedRate, rateInput: satisfied.paid.rateInput,
    })

    // ------------------------------------------------------------------
    // 13. Adversarial: the receipt cleanup itself fails. The member must be
    //     told the choice was not saved instead of seeing a clean off state.
    // ------------------------------------------------------------------
    await navigate('/starter-dashboard', 'page=dashboard&paid=1&receipt=paid-pending&seen=1')
    assert.ok(await settleUntil(`document.documentElement.getAttribute('data-paid-call-settings') === 'ready'`), 'the Paid card hydrates before the failing cleanup')
    await clickPaid('open')
    await evaluate(`document.getElementById('paid-no').click()`)
    await evaluate(`window.__tsFailNextMemberJsonWrite()`)
    await clickPaid('submit')
    await pause(500)
    const cleanupFailed = await snapshot('21-dashboard-head-failed-cleanup-tells-the-truth', 'HEAD, the decline is refused out loud because the receipt cleanup write failed')
    assert.equal(await evaluate(`document.querySelector('[data-call-settings-service="paid"] [data-call-settings-output="status"]').textContent`),
      'Your Build Profile choice could not be cleared. Your selection was not saved.',
      'the failed cleanup is reported instead of a save that never happened')
    assert.deepEqual(cleanupFailed.memberJson.starter_call_settings_intent_v3.paid, { enabled: true, title: 'Strategy call', price_dollars: 250 }, 'the receipt survives the failed cleanup so the choice is not silently lost')
    assert.equal(cleanupFailed.paid.buildIntent, 'pending', 'the card still marks the receipt as pending')
    assert.deepEqual(xanoWrites(cleanupFailed), [], 'a failed cleanup makes no canonical provider write')
    const refused = await evaluate(`(async () => await window.StarterPaidCallSettings.save())()`)
    assert.equal(refused, null, 'the controller entry point Edit Profile step 6 calls reports the refusal as null')
    record('dashboard-failed-receipt-cleanup-is-reported-not-swallowed', {
      status: 'Your Build Profile choice could not be cleared. Your selection was not saved.',
      receipt: cleanupFailed.memberJson.starter_call_settings_intent_v3,
    })

    // ------------------------------------------------------------------
    // 14. Adversarial: the session expires and the card loses its canonical
    //     snapshot while a receipt is still pending. Acting on the receipt
    //     must refuse instead of destroying it against unknown canonical state.
    // ------------------------------------------------------------------
    await navigate('/starter-dashboard', 'page=dashboard&paid=1&receipt=paid-pending&seen=1')
    assert.ok(await settleUntil(`document.documentElement.getAttribute('data-paid-call-settings') === 'ready'`), 'the Paid card hydrates before the session expires')
    await evaluate(`window.__tsExpirePaidReads()`)
    await evaluate(`window.dispatchEvent(new Event('starterSchedulingConnectionStateChanged'))`)
    assert.ok(await settleUntil(`document.querySelector('[data-call-settings-service="paid"] [data-call-settings-output="status"]').textContent === 'Sign in to manage paid calls.'`), 'the expired session fails the card closed')
    const unknownCanonical = await evaluate(`(async () => {
      const saved = await window.StarterPaidCallSettings.disable()
      return { saved, status: document.querySelector('[data-call-settings-service="paid"] [data-call-settings-output="status"]').textContent }
    })()`)
    const noCanonical = await snapshot('22-dashboard-head-no-canonical-state-refuses', 'HEAD, the receipt cannot be acted on while the canonical state is unknown')
    assert.equal(unknownCanonical.saved, null, 'the refusal is reported as null, not a phantom save')
    assert.equal(unknownCanonical.status, 'Paid-call settings could not be confirmed. Reload and try again.', 'the member is told to reload instead of seeing a clean off state')
    assert.deepEqual(noCanonical.memberJson.starter_call_settings_intent_v3.paid, { enabled: true, title: 'Strategy call', price_dollars: 250 }, 'the receipt survives an action taken against unknown canonical state')
    assert.equal(noCanonical.paid.buildIntent, '', 'the fail-closed card stops advertising a pending Build Profile choice')
    assert.deepEqual(xanoWrites(noCanonical), [], 'nothing canonical is written while the session is expired')
    record('dashboard-receipt-is-not-consumed-against-unknown-canonical-state', {
      status: unknownCanonical.status, receipt: noCanonical.memberJson.starter_call_settings_intent_v3,
    })

    // The Free branch of the same already-satisfied rule: a pending Free "Yes"
    // whose description the canonical service already carries is retired too.
    await navigate('/starter-dashboard', 'page=dashboard&canonical=free-active&receipt=free-pending&seen=1')
    assert.ok(await settleUntil(`document.documentElement.getAttribute('data-free-call-settings') === 'ready'`), 'the satisfied Free card hydrates')
    assert.ok(await settleUntil(`!window.__tsMemberJsonState().starter_call_settings_intent_v3`), 'the already-satisfied Free receipt is consumed')
    const freeSatisfied = await snapshot('23-dashboard-head-satisfied-free-receipt-consumed', 'HEAD, pending Free = Yes that the live canonical Free service already satisfies')
    assert.equal(freeSatisfied.free.yes, true, 'the canonical Free service stays on')
    assert.equal(freeSatisfied.free.description, 'Quick intro', 'the canonical description is what the member sees')
    assert.equal(freeSatisfied.buildIntent.free, '', 'the pending marker clears once the Free receipt is retired')
    assert.deepEqual(xanoWrites(freeSatisfied), [], 'retiring a satisfied Free receipt makes no canonical provider write')
    assert.deepEqual(errors, [], 'no uncaught browser errors')
    record('dashboard-satisfied-pending-free-yes-is-retired-without-a-canonical-write', {
      memberJson: freeSatisfied.memberJson, description: freeSatisfied.free.description,
    })

    // ------------------------------------------------------------------
    // 16. Boundary: every Xano call made across the run.
    // ------------------------------------------------------------------
    const allCalls = observations.flatMap(entry => entry.network.map(call => `${call.method} ${new URL(call.url).pathname}`))
    const unique = Array.from(new Set(allCalls)).sort()
    assert.deepEqual(unique, [
      'GET /api:g1vmSLWh/auth/trade-token/v3',
      'GET /api:tCpV3oqd/starter/free-call-settings/get/v3',
      'GET /api:tCpV3oqd/starter/paid-call-settings/get/v3',
    ], 'only the canonical call-settings reads and the auth trade happen; no booking, charge, message or email call')
    record('receipt-handoff-touches-only-canonical-call-settings-endpoints', { endpoints: unique })

    if (evidence) await fs.writeFile(path.join(evidence, 'observations.json'), JSON.stringify({
      boundary: 'Authored Edit Profile step 6 and dashboard DOM, real scheduling-auth.js, real free/paid call controllers, real onboarding-tour.js, real canonical-profile-loader dirty state in Chrome; synthetic Memberstack, Xano and driver.js popover; no request leaves the browser',
      baseCommit: BASE_COMMIT,
      scenarios: results,
      observations,
    }, null, 2))
    console.log(`PASS: ${results.length} scenarios, ${observations.length} native-browser observations`)
  } finally {
    socket?.close()
    const closed = new Promise(resolve => chrome.once('exit', resolve))
    chrome.kill()
    await closed
    await new Promise(resolve => server.close(resolve))
    await fs.rm(profile, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
