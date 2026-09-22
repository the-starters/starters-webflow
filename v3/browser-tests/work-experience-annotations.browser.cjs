// GSAP_SOURCE=<path to a GSAP UMD build> node v3/browser-tests/work-experience-annotations.browser.cjs
// GSAP_SOURCE is required: the animated pass needs the real library, and this repository has no
// manifest and does not vendor one, so the path is an explicit input rather than a resolution
// that only succeeds where an undeclared copy happens to sit above the checkout.
// Optional: CHROME_BIN and WORK_EXPERIENCE_BROWSER_EVIDENCE (screenshots/observations).
// Isolated Chrome, local fixture, in-memory writer; no member session or live writes.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
;(async () => {
  // Read before anything is spawned or bound, so a missing library fails as a clear message
  // rather than a mid-run crash that strands Chrome and its profile directory.
  const gsapSource = process.env.GSAP_SOURCE
  assert.ok(gsapSource, 'GSAP_SOURCE is required: set it to a GSAP UMD build (for example node_modules/gsap/dist/gsap.js). The animated pass needs the real library and this repository does not vendor one.')
  let gsapLibrary
  try {
    gsapLibrary = await fs.readFile(gsapSource, 'utf8')
  } catch (error) {
    assert.fail('GSAP_SOURCE is not readable: ' + gsapSource + ' (' + error.code + ')')
  }
  const profile = await fs.mkdtemp(path.join(root, '.work-experience-browser-'))
  const evidence = process.env.WORK_EXPERIENCE_BROWSER_EVIDENCE
  if (evidence) await fs.mkdir(evidence, { recursive: true })
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local')
    if (url.pathname === '/gsap.js') {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(gsapLibrary)
      return
    }
    const file = path.resolve(root, '.' + url.pathname)
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return }
    try {
      res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript')
      res.end(await fs.readFile(file))
    } catch { res.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking', '--no-proxy-server', 'about:blank',
  ], { stdio: 'ignore' })
  let socket
  try {
    let port
    for (let attempt = 0; attempt < 100; attempt++) {
      try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await pause(100) }
    }
    assert.ok(port, 'Chrome must start')
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl)
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
    let nextId = 0
    const pending = new Map(), errors = [], observations = []
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
      const request = pending.get(message.id)
      if (request) { pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result) }
    })
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)) }, 15000)
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
      socket.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    const shot = async label => {
      if (!evidence) return
      const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      await fs.writeFile(path.join(evidence, label + '.png'), Buffer.from(result.data, 'base64'))
    }
    const click = async selector => {
      const point = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
      await pause(30)
    }
    const state = () => evaluate(`(()=>{
      const rows=[...document.querySelectorAll('[profile-item-row]')];const add=document.querySelector('[profile-items-add]');
      const visible=el=>!!el&&!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
      return {addLast:rows.every(row=>!!(row.compareDocumentPosition(add)&Node.DOCUMENT_POSITION_FOLLOWING)),rows:rows.map(row=>({
       heading:row.querySelector('[profile-items-summary]').textContent,badge:visible(row.querySelector('[profile-items-unsaved]')),
       remove:visible(row.querySelector('[profile-item-remove]')),disabled:row.querySelector('[profile-item-remove] button').disabled,
       theme:row.querySelector('[profile-item-remove] [data-button-theme]').getAttribute('data-button-theme'),
       undo:visible(row.querySelector('[profile-items-undo]')),undoText:row.querySelector('[profile-items-undo]').innerText,
       content:visible(row.querySelector('[profile-item-content]'))})),save:visible(document.querySelector('[data-edit-submit]')),mutations:fixture.mutations(),stored:fixture.stored()}
    })()`)
    const type = (key, value, index = 0) => evaluate(`(()=>{const row=document.querySelectorAll('[profile-item-row]')[${index}];const el=row.querySelector('[profile-company-field="${key}"]');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`)
    await send('Runtime.enable')
    await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]})
    for (const [device, width, height] of [['desktop', 1200, 1000], ['mobile', 390, 844]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: device === 'mobile' })
      await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/v3/starter-edit-profile/unified-companies.fixture.html` })
      await pause(250)
      await evaluate('fixture.ready')
      let view = await state()
      assert.equal(view.addLast, true); assert.equal(view.save, true); assert.equal(view.rows[0].disabled, true)
      assert.equal(view.rows[0].theme, 'disabled'); assert.equal(view.rows[0].badge, false)
      assert.equal(view.rows[0].heading, 'Work Experience (Example Company · Designer)')
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('[profile-item-remove] [data-button-theme]')).backgroundColor`), 'rgb(221, 221, 221)')
      await click('[profile-item-remove] button')
      assert.equal((await state()).rows.length, 1)
      assert.equal((await state()).rows[0].undo, false)
      await shot(device + '-hydrated')
      await click('[profile-item-toggle]')
      assert.equal(await evaluate(`document.querySelector('[profile-company-field="start_date"]').value`), '2022-03')
      await type('job_title', 'Engineer')
      assert.equal((await state()).rows[0].badge, true)
      await type('job_title', 'Designer')
      assert.equal((await state()).rows[0].badge, false)
      await type('start_date', '2021-06')
      await click('[profile-company-field="current_work"]')
      assert.equal(await evaluate(`document.querySelector('[profile-company-field="end_date"]').disabled`), true)
      await shot(device + '-edited-dates')
      await click('[data-edit-submit] button')
      view = await state()
      assert.equal(view.stored[0].start_date, '2021-06'); assert.equal(view.stored[0].end_date, 'Present')
      assert.equal(view.stored[0].current_work, true); assert.equal(view.rows[0].badge, false)
      await click('[profile-items-add] button')
      view = await state(); assert.equal(view.rows.length, 2); assert.equal(view.addLast, true)
      // A blank added row is not a second entry, so the only filled one stays unremovable.
      assert.equal(view.rows[0].disabled, true); assert.equal(view.rows[0].theme, 'disabled')
      assert.equal(view.rows[1].heading, 'Work Experience')
      await type('company_name', 'Second Company', 1); await type('job_title', 'CMO', 1)
      view = await state()
      assert.ok(view.rows.every(row => !row.disabled)); assert.equal(view.rows[0].theme, 'danger')
      // A row that has never been saved heads with what was typed; the saved one does not move.
      assert.equal(view.rows[1].heading, 'Work Experience (Second Company · CMO)')
      assert.equal(view.rows[0].heading, 'Work Experience (Example Company · Designer)')
      // The shared accordion keeps one entry open: opening a row closes the one that was open.
      await click('[profile-item-toggle]')
      view = await state(); assert.equal(view.rows[0].content, true); assert.equal(view.rows[1].content, false)
      await click('[profile-item-row] ~ [profile-item-row] [profile-item-toggle]')
      view = await state(); assert.equal(view.rows[0].content, false); assert.equal(view.rows[1].content, true)
      await shot(device + '-two-rows')
      await click('[profile-item-remove] button')
      view = await state(); assert.equal(view.rows[0].remove, false); assert.equal(view.rows[0].undo, true)
      assert.equal(view.rows[0].undoText.trim(), 'Undo removal'); assert.equal(view.rows[0].content, false)
      assert.equal(view.rows[0].badge, true); assert.equal(view.rows[1].disabled, true)
      const sameSlot = await evaluate(`(()=>{const undo=document.querySelector('[profile-items-undo]');return undo.parentElement===document.querySelector('[profile-item-remove]').parentElement})()`)
      assert.equal(sameSlot, true)
      await shot(device + '-undo-removal')
      await click('[profile-items-undo] button')
      view = await state(); assert.equal(view.rows[0].remove, true); assert.equal(view.rows[0].undo, false)
      assert.equal(view.rows[0].content, true); assert.equal(view.rows[0].badge, false)
      const writes = view.mutations
      await click('[profile-items-discard] button')
      view = await state(); assert.equal(view.rows.length, 1); assert.equal(view.addLast, true); assert.equal(view.mutations, writes)
      assert.equal(view.rows[0].disabled, true); assert.equal(view.rows[0].badge, false)
      await click('[profile-item-toggle]')
      await type('job_title', 'Saved title')
      await click('[data-edit-submit] button')
      view = await state(); assert.equal(view.rows[0].heading, 'Work Experience (Example Company · Saved title)')
      assert.equal(view.rows[0].badge, false)
      await shot(device + '-saved')
      observations.push({device,checks:'hydration, Add order, disabled theme with a blank added row, one-open accordion, dates/current-role payload, saved and typed headings, row status/revert, authored Remove/Undo placement and visibility, Discard without save',view})
    }
    // With GSAP on the page an accordion open renders on the next frame, so every path that
    // focuses the row it just opened has to open that row instantly. Anything less leaves the
    // focus inside a `display: none` panel with no layout at all.
    await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/v3/starter-edit-profile/unified-companies.fixture.html?gsap=1` })
    await pause(300)
    await evaluate('fixture.ready')
    const version = await evaluate('window.gsap && window.gsap.version')
    assert.ok(version, 'the animated pass runs against real GSAP')
    const focused = () => evaluate(`(()=>{const el=document.activeElement;if(!el)return null;
      const r=el.getBoundingClientRect();const rows=[...document.querySelectorAll('[profile-item-row]')];
      const panel=el.closest('[profile-item-content]');
      return {field:el.getAttribute('profile-company-field'),row:rows.indexOf(el.closest('[profile-item-row]')),
       width:r.width,height:r.height,panel:panel?getComputedStyle(panel).display:null,
       panelHeight:panel?Math.round(panel.getBoundingClientRect().height):0,
       panelContent:panel?panel.scrollHeight:0,
       spill:panel?Math.round(r.bottom-panel.getBoundingClientRect().bottom):0}})()`)
    // An instant open must still be open once the 300ms animation budget has passed. Reading
    // only the frame the focus landed on would certify a panel that animates straight back shut.
    const settled = async () => { await pause(400); return focused() }
    // A reversed timeline leaves the panel at `display: block` with `height: 0` while its
    // children still paint outside the box, so "displayed" and "non-zero rect" both stay true.
    // The panel is only really open when its measured box covers its content and the focused
    // field sits inside it.
    const holds = (view, field, row, label) => {
      assert.equal(view.field, field, label + ': focus stays on ' + field)
      assert.equal(view.row, row, label + ': focus stays in row ' + row)
      assert.notEqual(view.panel, 'none', label + ': the panel stays displayed')
      assert.ok(view.width > 0 && view.height > 0, label + ': the focused field keeps layout')
      assert.ok(view.panelHeight >= view.panelContent - 1,
        label + ': the panel box covers its content (' + view.panelHeight + ' of ' + view.panelContent + ')')
      assert.ok(view.spill <= 0, label + ': the focused field sits inside the panel box')
    }
    // Add opens the new row and focuses its Company field.
    await click('[profile-items-add] button')
    let landed = await focused()
    assert.equal(landed.field, 'company_name'); assert.equal(landed.row, 1)
    assert.notEqual(landed.panel, 'none')
    assert.ok(landed.width > 0 && landed.height > 0, 'the focused field has layout')
    assert.ok(landed.panelHeight > 0, 'the opened panel has height')
    holds(await settled(), 'company_name', 1, 'Add')
    // Add on a collapsed unfinished row opens that row and puts the Starter in its Company field.
    await click('[profile-item-row] ~ [profile-item-row] [profile-item-toggle]')
    await pause(400)
    await click('[profile-items-add] button')
    landed = await focused()
    assert.equal(landed.field, 'company_name'); assert.equal(landed.row, 1)
    assert.notEqual(landed.panel, 'none')
    assert.ok(landed.width > 0 && landed.height > 0, 'the reopened unfinished row has layout')
    holds(await settled(), 'company_name', 1, 'Add on a collapsed unfinished row')
    assert.equal((await state()).rows.length, 2, 'the unfinished row is reused rather than joined by another')
    await type('company_name', 'Second Company', 1); await type('job_title', 'CMO', 1)
    // Undo restores the removed row, opens it and focuses its Company field.
    await click('[profile-item-remove] button')
    await click('[profile-items-undo] button')
    landed = await focused()
    assert.equal(landed.field, 'company_name'); assert.equal(landed.row, 0)
    assert.notEqual(landed.panel, 'none')
    assert.ok(landed.width > 0 && landed.height > 0, 'the restored row focused field has layout')
    holds(await settled(), 'company_name', 0, 'Undo')
    // A failing field in a collapsed row: validation opens that row and focuses into it.
    await type('job_title', '', 0)
    await click('[profile-item-row] ~ [profile-item-row] [profile-item-toggle]')
    await pause(400)
    await click('[data-edit-submit] button')
    landed = await focused()
    assert.equal(landed.field, 'job_title'); assert.equal(landed.row, 0)
    assert.notEqual(landed.panel, 'none')
    assert.ok(landed.width > 0 && landed.height > 0, 'the revealed field has layout')
    holds(await settled(), 'job_title', 0, 'validation reveal')
    assert.equal((await state()).mutations, 0)
    await shot('animated-focus')
    assert.equal((await state()).rows[1].content, false,
      'validation reveal closes the other row without leaving its fields over the footer')
    observations.push({ device: 'desktop-gsap', gsap: version,
      checks: 'real GSAP instant opens land focus and stay open past the animation for Add, Add on a collapsed unfinished row, Undo and validation reveal', view: await state() })
    assert.deepEqual(errors, [])
    if (evidence) await fs.writeFile(path.join(evidence, 'observations.json'), JSON.stringify({ boundary: 'Isolated local Chrome fixture; in-memory writer; no authenticated-page or real persistence proof', observations }, null, 2))
    console.log('Desktop and mobile Work Experience component checks passed' + (evidence ? '; evidence: ' + evidence : ''))
  } finally {
    socket?.close()
    const closed = new Promise(resolve => chrome.once('exit', resolve)); chrome.kill(); await closed
    await new Promise(resolve => server.close(resolve)); await fs.rm(profile, {recursive:true,force:true})
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
