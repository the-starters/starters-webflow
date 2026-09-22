// Local Chrome fixture for Services headers. Synthetic saved data; no profile writes.
// Run: EDIT_PROFILE_BROWSER_EVIDENCE=/tmp/services-headers node v3/browser-tests/services-row-headers.browser.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
;(async () => {
  const profile = await fs.mkdtemp(path.join(root, '.services-headers-browser-'))
  const evidence = process.env.EDIT_PROFILE_BROWSER_EVIDENCE
  if (evidence) await fs.mkdir(evidence, { recursive: true })
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font:16px system-ui;margin:0;background:#f8f8f5;color:#242424}main{max-width:680px;margin:32px auto;padding:24px}h1{font-size:28px}[increment-dropdown]{border:1px solid #ccc;border-radius:6px;background:white;margin:16px 0}[increment-dropdown-toggle]{display:flex;align-items:center;padding:18px;gap:12px;cursor:pointer}[profile-items-label]{font-weight:600}[profile-items-unsaved]{font-size:13px;color:#745114}[increment-dropdown-content]{padding:0 18px 18px}label{display:block;margin:14px 0 6px}input,textarea{box-sizing:border-box;width:100%;padding:12px;font:inherit;border:1px solid #aaa;border-radius:4px}textarea{min-height:180px}button{padding:10px 16px;font:inherit;background:white;border:1px solid #aaa;border-radius:4px}[increment-dropdown-remove]{padding:5px 10px;font-size:13px}[profile-items-status]{margin-top:16px}</style>
<script defer src="/fixture.js"></script><script defer src="/v3/starter-edit-profile/profile-section-validation.js"></script><script defer src="/v3/starter-edit-profile/unified-services.js"></script></head>
<body><main><h1>Services &amp; Rates</h1><section profile-unified-items="services"><div increment-dropdown="1" data-entity="Service"><div increment-dropdown-toggle><span profile-items-label>Service1</span><button type="button" increment-dropdown-remove>Remove</button><span increment-dropdown-icon aria-hidden="true">⌄</span></div><div increment-dropdown-content><label>Service name</label><input data-name="service-name" required><label>Price</label><input data-name="service-price" required><label>Description</label><textarea data-name="service-description"></textarea></div></div><button profile-items-add type="button">Add service</button> <button data-edit-submit type="button">Save</button> <button profile-items-discard type="button">Discard changes</button></section></main></body></html>`
  const server = http.createServer(async (req, res) => {
    const requested = new URL(req.url, 'http://local').pathname
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'")
    if (requested === '/') { res.setHeader('Content-Type','text/html'); res.end(html); return }
    if (requested === '/fixture.js') {
      res.setHeader('Content-Type','text/javascript')
      res.end("window.activeProfile={last_update:1,type:'full',data:{step_6:{service:{name:'Profile audit',price:'500',description:'A saved service'}}}};")
      return
    }
    const file = path.resolve(root, '.' + requested)
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return }
    try { res.setHeader('Content-Type','text/javascript'); res.end(await fs.readFile(file)) }
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
    const observations = []
    for (const [width, height] of [[1100, 900], [390, 844]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` })
      await pause(350)
      assert.equal(await evaluate(`document.querySelector('[profile-items-label]').textContent`), 'Service 1')
      assert.equal(await evaluate(`document.querySelector('[profile-items-unsaved]').hidden`), true)
      await evaluate(`(() => {document.querySelector('[profile-items-add]').scrollIntoView({block:'center'});const input=document.querySelector('[data-name="service-name"]');input.value='Edited service';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[profile-items-add]').click()})()`)
      await pause(100)
      const state = await evaluate(`(() => {
        const rows=[...document.querySelectorAll('[increment-dropdown]')];
        return {labels:rows.map(r=>r.querySelector('[profile-items-label]').textContent),badges:rows.map(r=>!r.querySelector('[profile-items-unsaved]').hidden),headers:rows.map(r=>{const toggle=r.querySelector('[increment-dropdown-toggle]'),icon=r.querySelector('[increment-dropdown-icon]');return {right:toggle.getBoundingClientRect().right,iconRight:icon.getBoundingClientRect().right}}),newHeaderTop:rows[1].querySelector('[increment-dropdown-toggle]').getBoundingClientRect().top,overflow:document.documentElement.scrollWidth>innerWidth,summaries:document.querySelectorAll('[profile-items-summary]').length}
      })()`)
      assert.deepEqual(state.labels, ['Service 1', 'Service 2'])
      assert.deepEqual(state.badges, [true, false])
      assert.equal(state.summaries, 0)
      assert.equal(state.overflow, false)
      assert.ok(state.newHeaderTop >= 0 && state.newHeaderTop < height)
      state.headers.forEach(h => assert.ok(h.right - h.iconRight < 25, 'arrow stays at far right'))
      const visibility = await evaluate(`(() => {
        const row=document.querySelector('[increment-dropdown]'),toggle=row.querySelector('[increment-dropdown-toggle]');
        const seen=()=>({display:getComputedStyle(toggle).display,height:toggle.getBoundingClientRect().height,label:[...document.querySelectorAll('[increment-dropdown]:not([profile-items-removed]) [profile-items-label]')].map(l=>l.textContent)});
        const loaded=seen();row.querySelector('[increment-dropdown-remove]').click();const removed=seen();
        row.querySelector('[profile-items-undo]').click();return {loaded,removed,restored:seen()}
      })()`)
      assert.equal(visibility.loaded.display, 'flex')
      assert.equal(visibility.removed.display, 'none', 'Remove hides the inline flex header')
      assert.equal(visibility.removed.height, 0)
      assert.deepEqual(visibility.removed.label, ['Service 1'])
      assert.equal(visibility.restored.display, 'flex', 'Undo reveals the header again')
      assert.ok(visibility.restored.height > 0)
      assert.deepEqual(visibility.restored.label, ['Service 1'], 'Undo drops the unused blank row and restores this one')
      observations.push({ width, height, ...state, visibility })
      if (evidence) { const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(evidence, `services-${width}.png`),Buffer.from(shot.data,'base64')) }
    }
    assert.deepEqual(errors, [])
    if (evidence) await fs.writeFile(path.join(evidence,'observations.json'),JSON.stringify(observations,null,2))
    console.log('Services headers: desktop/mobile native browser checks passed')
  } finally {
    socket?.close()
    const closed = new Promise(resolve => chrome.once('exit', resolve))
    chrome.kill()
    await closed
    await new Promise(resolve => server.close(resolve))
    await fs.rm(profile, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
