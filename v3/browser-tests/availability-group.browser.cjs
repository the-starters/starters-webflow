// Focused acceptance: node v3/browser-tests/availability-group.browser.cjs
// CHROME_BIN optionally overrides Chrome. AVAILABILITY_EVIDENCE writes screenshots
// and intercepted requests. Local rendered fixture; simulated auth/API, no deployment.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { spawn, execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const base = '86848bad6e843c10f74cb781f4391546537e976b'

async function main() {
  const jqueryResponse = await fetch('https://code.jquery.com/jquery-3.7.1.min.js')
  assert.ok(jqueryResponse.ok)
  const jquery = await jqueryResponse.text()
  const evidence = process.env.AVAILABILITY_EVIDENCE
  if (evidence) await fs.mkdir(evidence, { recursive: true })
  const profile = await fs.mkdtemp(path.join(root, '.availability-browser-'))
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local')
    const files = {
      '/jquery.js': null,
      '/shared.js': 'v3/profile-form/shared-foundation.js',
      '/diagnostics.js': 'utils/workflow-diagnostics.js',
      '/controller.js': 'starter-edit-profile.js',
    }
    if (Object.hasOwn(files, url.pathname)) {
      res.setHeader('Content-Type', 'text/javascript')
      return res.end(url.pathname === '/jquery.js' ? jquery : url.searchParams.has('base')
        ? execFileSync('git', ['show', base + ':starter-edit-profile.js'], { cwd: root })
        : await fs.readFile(path.join(root, files[url.pathname])))
    }
    if (url.pathname !== '/starter-edit-profile') return res.writeHead(404).end()
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<!doctype html><title>Availability · Edit profile acceptance</title>
<style>body{font:18px system-ui;background:#f5f4f0;color:#25212a;margin:48px;max-width:760px}main{background:white;padding:32px;border-radius:16px}label{display:block;margin:20px 0 8px}input{font:inherit;padding:12px;border:1px solid #888;border-radius:6px;width:90%}input:focus{outline:3px solid #735bd1}button{font:inherit;padding:10px 20px;margin-top:20px;cursor:pointer}small{color:#666}[ms-code-select="tag"]{display:inline-block;background:#e9e1fb;padding:8px;border-radius:8px}[ms-code-select="tag-close"]{padding:0 8px;margin:0}[ms-code-select="list"]{padding:10px;border:1px solid #aaa}[ms-code-select="tag-name-new"]{display:block;background:white;width:100%;text-align:left;margin:4px 0}[data-modal-target]{background:#e0f2df;padding:15px;margin-top:20px}</style>
<h1>Rates & availability</h1><p id="type"></p><small>Local acceptance fixture · actual shared picker and edit controller · simulated account and save service</small>
<main><form build-profile-form><section data-form="step" data-index="6">
<label>Hourly rate ($)<input name="rate" data-element="rate" type="number" required min="1" max="1000" step="1" value="125"></label>
<div fs-list-instance="availability"><div hidden><div fs-list-element="select-value" data-id="1">Available now</div><div fs-list-element="select-value" data-id="2">Available next month</div></div>
<div ms-code-select-wrapper="single" select-wrap-entity="availability"><label>Availability<input name="availability-option" ms-code-select="input" placeholder="Choose availability" ms-code-select-min="1"></label>
<input hidden name="availability" ms-code-select="input-value"><input hidden id="availability-required" name="availability-required" ms-code-select="input-required">
<div ms-code-select="selected-wrapper"><span ms-code-select="tag"><span ms-code-select="tag-name-selected"></span><button type="button" ms-code-select="tag-close" aria-label="Remove availability">×</button></span></div>
<div ms-code-select="list"><button type="button" ms-code-select="tag-name-new"></button></div><div ms-code-select="empty-state">No matching options</div></div></div>
<div data-monthly-retainers-description></div><div data-monthly-retainers-rate></div><input type="hidden" name="service"><input type="hidden" name="offer-monthly-retainers" value="no">
<button type="button" data-edit-submit>Save changes</button></section></form>
<div data-modal-target="edit-form-success" hidden><p data-profile-feedback-message>Saved</p></div><div data-modal-target="edit-form-error" hidden><p>Unable to save</p></div></main>
<script src="/jquery.js"></script><script>window.qs=(s,r)=>(r||document).querySelector(s);window.qsa=(s,r)=>[...(r||document).querySelectorAll(s)];</script>
<script src="/shared.js"></script><script>
activeProfile.type=${JSON.stringify(url.searchParams.get('type') || 'full')};activeProfile.last_update='fixture';
document.querySelector('#type').textContent=activeProfile.type==='full'?'Full profile':'Consult profile';
window.MEMBER={id:'acceptance-synthetic'};window.waitForMember=fn=>fn(MEMBER);
window.$memberstackDom={getCurrentMember:async()=>({data:MEMBER}),onAuthChange:()=>{}};
window.requests=[];window.fetch=async(url,options)=>{if(options?.method!=='PATCH')throw Error('Unexpected fetch');requests.push({url,method:options.method,body:JSON.parse(options.body)});return {ok:true,status:200,json:async()=>({saved:true,projection_pending:false})}};
window.lumos={modal:{open:name=>{document.querySelector('[data-modal-target="'+name+'"]').hidden=false}}};
handleCustomSelects();</script><script src="/diagnostics.js"></script><script src="/controller.js${url.searchParams.has('base') ? '?base=1' : ''}"></script>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank',
  ], { stdio: 'ignore' })
  let socket
  try {
    let port
    for (let n = 0; n < 100 && !port; n++) {
      try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0] } catch { await pause(100) }
    }
    assert.ok(port, 'Chrome starts')
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    socket = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl)
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
    let id = 0
    const pending = new Map(), errors = [], observations = []
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
      if (message.id && pending.has(message.id)) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(message.error) : task.resolve(message.result) }
    })
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id
      const timer = setTimeout(() => reject(Error('CDP timeout: ' + method)), 15000)
      pending.set(requestId, { resolve: v => { clearTimeout(timer); resolve(v) }, reject: e => { clearTimeout(timer); reject(e) } })
      socket.send(JSON.stringify({ id: requestId, method, params }))
    })
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    const click = async selector => {
      const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();if(!r.width||!r.height)throw Error('Click target is hidden');return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
      await pause(150)
    }
    const state = () => evaluate(`({chips:document.querySelectorAll('[ms-code-select="tag"]').length,minimum:document.querySelector('[select-wrap-entity]').getAttribute('wf-validate-min'),mirror:document.querySelector('#availability-required').value,focused:document.activeElement.name,requests,diagnostic:window.__startersWorkflowDiagnosticLast,success:!document.querySelector('[data-modal-target="edit-form-success"]').hidden})`)
    const record = async label => {
      const result = await state(); observations.push({ label, ...result })
      if (evidence) {
        await fs.writeFile(path.join(evidence, label + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
        await fs.writeFile(path.join(evidence, 'availability-observations.json'), JSON.stringify(observations, null, 2))
      }
      return result
    }
    const navigate = async suffix => {
      await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/starter-edit-profile${suffix}` })
      await pause(500)
    }
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 950, deviceScaleFactor: 1, mobile: false })
    for (const before of [true, false]) {
      await navigate(before ? '?base=1' : '')
      await evaluate(`document.querySelector('#availability-required').value='stale'`)
      await click('[data-edit-submit]')
      let result = await record(before ? 'before-full-empty-stale-mirror' : 'full-empty-stale-mirror-blocked')
      assert.equal(result.chips, 0)
      assert.equal(result.requests.length, before ? 1 : 0)
      if (!before) { assert.equal(result.diagnostic.error_code, 'GROUP_MIN_NOT_MET'); assert.equal(result.focused, 'availability-option'); assert.equal(result.minimum, '1') }
    }
    await click('[name="rate"]')
    await click('[ms-code-select="input"]')
    await click('[ms-code-select="tag-name-new"][data-id="1"]')
    assert.equal((await state()).chips, 1)
    await click('[name="rate"]') // Settle the shared picker before injecting a stale empty mirror.
    await evaluate(`document.querySelector('#availability-required').value=''`)
    await click('[data-edit-submit]')
    let result = await record('full-one-chip-empty-mirror-saved')
    assert.equal(result.requests.length, 1); assert.equal(result.success, true); assert.equal(result.mirror, '')
    assert.equal(result.requests[0].body.Availability_ID, '1'); assert.equal(result.requests[0].body.Hourly_Rate, 125)
    await click('[ms-code-select="input"]')
    await evaluate(`document.querySelector('[ms-code-select="input"]').select()`)
    await send('Input.insertText', {text:'Available next'})
    await click('[ms-code-select="tag-name-new"][data-id="2"]')
    assert.equal((await state()).chips, 1, 'Single picker replaces rather than accumulates')
    await click('[data-edit-submit]')
    assert.equal((await state()).requests[1].body.Availability_ID, '2')
    await record('shared-single-picker-replacement-saved')
    await evaluate(`document.querySelector('[name="rate"]').value='';document.querySelector('[data-modal-target="edit-form-success"]').hidden=true`)
    await click('[data-edit-submit]')
    result = await record('native-required-rate-blocked')
    assert.equal(result.requests.length, 2); assert.equal(result.diagnostic.error_code, 'NATIVE_VALIDATION')
    await evaluate(`document.querySelector('[name="rate"]').value='125';document.querySelector('section').insertAdjacentHTML('afterbegin','<label>Required capture<input name="capture" required data-input-capture></label>')`)
    await click('[data-edit-submit]')
    result = await record('native-required-capture-blocked')
    assert.equal(result.requests.length, 2); assert.equal(result.diagnostic.error_code, 'NATIVE_VALIDATION')
    await navigate('?type=consult')
    await evaluate(`document.querySelector('[select-wrap-entity]').setAttribute('wf-validate-min','1')`)
    await click('[data-edit-submit]')
    result = await record('consult-empty-stale-minimum-saved')
    assert.equal(result.chips, 0); assert.equal(result.minimum, null); assert.equal(result.requests.length, 1); assert.equal(result.success, true)
    assert.deepEqual(errors, [], 'No uncaught browser exceptions')
    console.log('Availability acceptance: base reproduces stale-mirror save; target blocks empty Full, saves selected Full and empty Consult; native gates and shared single selection preserved.')
  } finally {
    socket?.close()
    chrome.kill()
    await new Promise(resolve => chrome.exitCode !== null ? resolve() : chrome.once('exit', resolve))
    await new Promise(resolve => server.close(resolve))
    await fs.rm(profile, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
