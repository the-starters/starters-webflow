// node global-embeds/accordions/accordions.browser.cjs
// Requires Chrome and GSAP (GSAP_SOURCE can point to its browser distribution).
// ACCORDIONS_EVIDENCE optionally saves screenshots and observed panel state.
// This local contract fixture does not verify Webflow deployment or authored styles.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { spawn, execFileSync } = require('node:child_process')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const root = path.resolve(__dirname, '../..')

function fixture(animated, before, hover) {
  const card = (group, i, generic) => `<article ${generic ? 'data-accordion="component"' : 'data-accordion-component'}><button id="${group}-${i}" data-test="${group}-${i}" ${generic ? 'data-accordion="toggle-button"' : 'data-accordion-button-toggle'}>${['Membership benefits', 'Community access', 'Expert support'][i]}</button><div ${generic ? 'data-accordion="content-wrap"' : 'data-accordion-content-wrap'}><p>${['Explore the membership and choose what works for you.', 'Connect with fellow members and join community events.', 'Get practical guidance from experienced members.'][i]}</p></div></article>`
  const mobile = (id, title) => `<section id="${id}" data-accordion-item-wrapper><h2>${title}</h2>${[0, 1, 2].map(i => card(id, i, false)).join('')}</section>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accordion acceptance fixture</title><style>
  *{box-sizing:border-box}body{font:16px system-ui;margin:0;padding:24px;background:#f4f2eb;color:#242b21}h1{font-size:25px;margin:0 0 8px}.note{font-size:13px;color:#5b6258}main{display:grid;gap:20px}section{background:white;border:1px solid #d6d8ce;padding:16px;border-radius:12px}h2{font-size:19px;margin:0 0 12px}article{border-top:1px solid #ddd}button{font:inherit;font-weight:600;border:0;background:transparent;width:100%;padding:14px 0;text-align:left;cursor:pointer}button:after{content:'+';float:right}button[aria-expanded=true]:after{content:'−'}article.is-active>button{color:#326329}[data-accordion-content-wrap],[data-accordion="content-wrap"]{overflow:hidden}p{margin:0;padding:8px 0 16px;line-height:1.5}@media(min-width:768px){main{grid-template-columns:1fr 1fr}#generic{grid-column:1/-1}}
  </style>${animated ? '<script src="/gsap.js"></script>' : ''}<script defer src="/accordions.js${before ? '?base=1' : ''}"></script><script defer src="/mobile-accordions.js"></script><script defer src="/mobile-accordions.js"></script></head><body><h1>Membership accordions</h1><p class="note">Local contract fixture · ${animated ? 'real GSAP animation' : 'GSAP absent'}${before ? ' · pre-fix generic source' : ''}</p><main>${mobile('join', 'Join CTA')}${mobile('signup', 'Signup Modal')}<section id="generic" data-accordion="wrapper" data-open-by-default="2" data-close-previous="true" data-close-on-second-click="true" data-open-on-hover="${Boolean(hover)}"><h2>Generic accordion</h2><div data-accordion="list">${[0, 1, 2].map(i => card('generic', i, true)).join('')}</div></section></main></body></html>`
}

async function main() {
  const evidence = process.env.ACCORDIONS_EVIDENCE
  if (evidence) await fs.mkdir(evidence, { recursive: true })
  const assets = {
    '/gsap.js': await fs.readFile(process.env.GSAP_SOURCE || require.resolve('gsap'), 'utf8'),
    '/accordions.js': await fs.readFile(path.join(__dirname, 'accordions.js'), 'utf8'),
    '/mobile-accordions.js': await fs.readFile(path.join(__dirname, 'mobile-accordions.js'), 'utf8'),
  }
  const before = execFileSync('git', ['show', '3806a9012c4abdc0cb9955fb5d91a528ec9f4693:global-embeds/accordions/accordions.js'], { cwd: root, encoding: 'utf8' })
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local')
    res.setHeader('Content-Type', assets[url.pathname] ? 'text/javascript' : 'text/html')
    res.end(assets[url.pathname] ? (url.searchParams.has('base') ? before : assets[url.pathname]) : fixture(url.searchParams.has('animated'), url.searchParams.has('base'), url.searchParams.has('hover')))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const profile = await fs.mkdtemp(path.join(root, '.accordion-browser-'))
  const chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank',
  ], { stdio: 'ignore' })
  let socket
  try {
    let port
    for (let i = 0; i < 100 && !port; i++) {
      try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0] } catch { await pause(100) }
    }
    assert.ok(port, 'Chrome starts')
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl)
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
    let nextId = 0
    const pending = new Map(), errors = [], observations = []
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
      if (pending.has(message.id)) {
        const task = pending.get(message.id); pending.delete(message.id)
        message.error ? task.reject(message.error) : task.resolve(message.result)
      }
    })
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => reject(Error('CDP timeout: ' + method)), 15000)
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
      socket.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    const resize = async width => {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 1250, deviceScaleFactor: 1, mobile: false })
      await pause(150)
    }
    const state = group => evaluate(`Array.from(document.querySelectorAll('#${group} article')).map(card=>{const button=card.querySelector('button'),panel=button.nextElementSibling;return {open:button.getAttribute('aria-expanded'),active:card.classList.contains('is-active'),visible:getComputedStyle(panel).display!=='none'&&panel.getBoundingClientRect().height>0,height:panel.getBoundingClientRect().height,inlineDisplay:panel.style.display,inlineHeight:panel.style.height}})`)
    const expect = async (group, opens) => {
      const states = await state(group)
      assert.deepEqual(states.map(item => item.open === 'true'), opens, `${group}: ARIA state`)
      assert.deepEqual(states.map(item => item.active), opens, `${group}: active classes`)
      assert.deepEqual(states.map(item => item.visible), opens, `${group}: rendered panels`)
    }
    const point = selector => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    const click = async (group, i, settle = true) => {
      const xy = await point(`[data-test="${group}-${i}"]`)
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...xy, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...xy, button: 'left', clickCount: 1 })
      if (settle) await pause(450)
    }
    const record = async label => {
      await evaluate('window.scrollTo(0,0)')
      observations.push({ label, width: await evaluate('innerWidth'), gsap: await evaluate('window.gsap?.version || null'), join: await state('join'), signup: await state('signup'), generic: await state('generic'), errors: [...errors] })
      if (evidence) {
        await fs.writeFile(path.join(evidence, label + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
        await fs.writeFile(path.join(evidence, 'accordion-browser-observations.json'), JSON.stringify(observations, null, 2))
      }
    }
    const navigate = async query => {
      errors.length = 0
      await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/${query}` })
      await pause(600)
    }
    await send('Runtime.enable')
    await resize(767)
    await navigate('?base=1')
    assert.ok(errors.some(error => error.includes('gsap is not defined')), 'Pre-fix source reproduces missing-GSAP crash')
    await click('generic', 1)
    assert.notEqual((await state('generic'))[1].open, 'true', 'Pre-fix generic click remains broken')
    await record('before-missing-gsap')
    for (const animated of [false, true]) {
      const mode = animated ? 'animated' : 'no-gsap'
      await resize(767)
      await navigate(animated ? '?animated=1' : '')
      await expect('join', [true, false, false]); await expect('signup', [true, false, false]); await expect('generic', [false, true, false])
      await record(mode + '-defaults')
      await click('join', 1, !animated)
      if (animated) {
        await pause(70)
        const mid = (await state('join'))[1].height
        await pause(450)
        assert.ok(mid > 0 && mid < (await state('join'))[1].height, 'GSAP visibly animates intermediate height')
      }
      await expect('join', [false, true, false]); await expect('signup', [true, false, false])
      await click('signup', 2)
      await expect('signup', [false, false, true]); await expect('join', [false, true, false])
      await record(mode + '-independent-groups')
      await click('join', 1); await expect('join', [false, false, false])
      await click('generic', 2); await expect('generic', [false, false, true])
      await click('generic', 2); await expect('generic', [false, false, false])
      await resize(768)
      for (const group of ['join', 'signup']) {
        const states = await state(group)
        assert.ok(states.every(item => item.visible && !item.active && item.inlineDisplay === '' && item.inlineHeight === ''), 'Desktop authored layout restored')
        await click(group, 1)
        assert.deepEqual(await state(group), states, 'Desktop clicks have no mobile handler')
      }
      await record(mode + '-desktop-768')
      await resize(767)
      await expect('join', [true, false, false]); await expect('signup', [true, false, false])
      await click('join', 1); await expect('join', [false, true, false])
      await click('join', 1); await expect('join', [false, false, false])
      await record(mode + '-mobile-reentry')
      assert.deepEqual(errors, [], 'Target has no uncaught browser exceptions')
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
      await navigate(animated ? '?animated=1&hover=1' : '?hover=1')
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...await point('[data-test="generic-0"]') })
      await pause(450); await expect('generic', [true, false, false])
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...await point('[data-test="generic-0"]') })
      await pause(450); await expect('generic', [true, false, false])
      assert.deepEqual(errors, [], 'Hover has no uncaught browser exceptions')
    }
    console.log('Chrome acceptance: pre-fix missing-GSAP crash reproduced; target panels work with absent and real GSAP, independent groups, duplicate deferred includes, second-click close, generic hover, desktop teardown at 768px, and reentry at 767px.')
  } finally {
    socket?.close()
    chrome.kill()
    await new Promise(resolve => chrome.exitCode !== null ? resolve() : chrome.once('exit', resolve))
    await new Promise(resolve => server.close(resolve))
    await fs.rm(profile, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
