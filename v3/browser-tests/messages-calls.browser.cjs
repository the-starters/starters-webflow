// Focused native-browser acceptance: node v3/browser-tests/messages-calls.browser.cjs
// Optional: CHROME_BIN and MESSAGES_BROWSER_EVIDENCE (screenshots/observations).
// Synthetic provider/controller boundaries; not production Webflow/Nylas proof.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
;(async () => {
  const profile = await fs.mkdtemp(path.join(root, '.messages-browser-'))
  const evidence = process.env.MESSAGES_BROWSER_EVIDENCE
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
    await send('Page.navigate', { url: `http://www.thestarters.com:${server.address().port}/v3/browser-tests/messages-calls.html` })
    for (let i=0; i<100 && !await evaluate('window.fixtureReady === true'); i++) await pause(50)
    assert.equal(await evaluate('window.fixtureReady'), true)
    const visible = () => evaluate(`getComputedStyle(document.querySelector('[role=tooltip]')).display !== 'none'`)
    const point = () => evaluate(`(() => {const r=document.querySelector('button').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    const shot = async label => { if(evidence) {const result=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(evidence,label+'.png'),Buffer.from(result.data,'base64'))} }
    assert.equal(await evaluate(`document.querySelector('button').getAttribute('aria-disabled')`),'true')
    await send('Input.dispatchMouseEvent', {type:'mouseMoved', ...await point()})
    assert.equal(await visible(),true)
    await shot('messages-unavailable-hover')
    await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:2,y:2})
    assert.equal(await visible(),false)
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
    assert.equal(await visible(),true)
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
    assert.equal(await visible(),false)
    await send('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:1,mobile:true})
    await send('Emulation.setTouchEmulationEnabled',{enabled:true})
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[await point()]})
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    await pause(100)
    assert.equal(await visible(),true)
    assert.equal(await evaluate(`(() => {const r=document.querySelector('[role=tooltip]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`),true)
    await shot('messages-unavailable-mobile-tap')
    await evaluate(`selectConversation({conversation:null})`)
    assert.equal(await visible(),false)
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[booking-button-wrapper]')).display`),'none')
    assert.deepEqual(errors,[])
    console.log('PASS: unavailable hover, focus, Escape, touch, viewport fit and selection clearing; synthetic services; no submissions')
  } finally {
    socket?.close()
    const closed = new Promise(resolve => chrome.once('exit', resolve))
    chrome.kill()
    await closed
    await new Promise(resolve => server.close(resolve))
    await fs.rm(profile, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
