// Focused rendered acceptance for Starter Dashboard Calendar routing.
// CALENDAR_SCROLL_EVIDENCE=/absolute/evidence/path node v3/browser-tests/scheduling-availability-scroll.browser.cjs
// Real browser/controller; synthetic new-Starter auth read; no provider writes.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '../..')
const evidence = process.env.CALENDAR_SCROLL_EVIDENCE
const baseline = 'e05e73fcf10f21e1fc886d403c9496162256f0a4'
const targetCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim()

const hash = value => crypto.createHash('sha256').update(value).digest('hex')

function actionMarkup(kind) {
  if (kind === 'legacy' || kind === 'base-legacy') {
    return `<div class="dash-hero_action-item" data-action-element="item">
      <a id="calendar-action" href="#calendar" data-modal-trigger="set-availability">
        <strong>Connect Calendar</strong><span>Finish your scheduling setup</span>
      </a>
    </div>`
  }
  return `<div class="dash-hero_action-item" data-action-element="item">
    <button id="calendar-action" type="button" calendar-connection-action data-modal-trigger="set-availability">
      <strong>Connect Calendar</strong><span>Finish your scheduling setup</span>
    </button>
  </div>`
}

function fixture(scenario, version) {
  const section = scenario === 'fallback'
    ? `<section class="legacy"><p class="eyebrow">LEGACY PAGE</p><h2>No inline Calendar section</h2><p>The availability dialog remains the safe fallback.</p></section>`
    : `<section id="calendar" data-availability-element="section">
        <p class="eyebrow">CALENDAR &amp; AVAILABILITY</p><h2>Calendar and availability</h2>
        <p>Connect a calendar and manage weekly availability here in the dashboard.</p>
        <div class="cards"><article><strong>Calendar connection</strong><span>Ready to connect</span></article><article><strong>Weekly availability</strong><span>Set preferred hours</span></article></div>
      </section>`
  const action = scenario === 'late' ? '' : actionMarkup(scenario)
  const label = version === 'base' ? 'Before-fix regression reproduction' : 'Target browser acceptance'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Starter Dashboard Calendar acceptance</title><style>
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f7f5fb;color:#21163f;font:16px/1.45 system-ui,sans-serif}.hero{max-width:1120px;margin:auto;padding:36px 34px 0}.eyebrow{color:#6844c7;font-size:12px;font-weight:800;letter-spacing:.12em}.hero h1{font-size:48px;line-height:1.05;letter-spacing:-.04em;margin:10px 0}.intro{max-width:670px;color:#625b70;font-size:18px}.toolbar{display:flex;gap:12px;margin:28px 0}button,a#calendar-action{border:0;border-radius:14px;padding:16px 20px;font:inherit;font-weight:750;text-decoration:none;cursor:pointer}[update-availability]{display:none}#hero-availability{background:white;color:#21163f;box-shadow:0 0 0 1px #d8d1e8 inset}#action-items{max-width:720px;margin-top:18px}.dash-hero_action-item{overflow:hidden;border:1px solid #ded7eb;border-radius:22px;background:white;box-shadow:0 14px 38px rgba(45,28,88,.1)}#calendar-action{width:100%;min-height:98px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:4px;background:white;color:#21163f;text-align:left}#calendar-action strong{font-size:21px}#calendar-action span{color:#6f677a;font-weight:500}.spacer{height:780px;display:grid;place-items:center;color:#978da7}.spacer:after{content:'Dashboard content';padding:8px 15px;border:1px dashed #ccc2dc;border-radius:99px}#calendar,.legacy{min-height:780px;padding:70px max(34px,calc((100vw - 1052px)/2));border-top:1px solid #d9d0ed;background:linear-gradient(145deg,#eee8ff,#fff)}#calendar h2,.legacy h2{font-size:38px;letter-spacing:-.03em;margin:8px 0}.cards{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:32px}.cards article{display:flex;flex-direction:column;gap:8px;padding:25px;border:1px solid #d5c9ed;border-radius:18px;background:rgba(255,255,255,.72)}dialog{width:min(620px,calc(100vw - 42px));border:0;border-radius:24px;padding:0;color:#21163f;box-shadow:0 28px 90px rgba(20,10,44,.35)}dialog::backdrop{background:rgba(26,16,48,.58);backdrop-filter:blur(2px)}.modal{padding:34px}.modal h2{font-size:31px}[availability-step]{display:none}.modal-note{margin:18px 0;padding:14px 16px;border-left:4px solid #6a45da;border-radius:10px;background:#eee8ff}[data-modal-close]{background:#21163f;color:white}#hud{position:fixed;right:18px;top:18px;z-index:2147483647;width:300px;padding:14px 16px;border-radius:15px;background:rgba(30,20,54,.94);color:white;box-shadow:0 10px 30px rgba(0,0,0,.2);font:13px/1.45 ui-monospace,monospace;white-space:pre-line;pointer-events:none}#hud b{color:#bff6d2}
  </style><script>
  window.__qa={scenario:${JSON.stringify(scenario)},version:${JSON.stringify(version)},delegatedModalOpens:0,requests:[]}
  window.memberReady=Promise.resolve({id:'member-new-browser-acceptance',customFields:{}})
  window.xanoAuthFetch=async function(url,options){__qa.requests.push({url:String(url),method:options&&options.method});return{ok:true,status:200,json:async()=>null}}
  window.lumos={modal:{open:function(id){const modal=document.querySelector('dialog[data-modal-target="'+id+'"]');if(modal&&!modal.open)modal.showModal()}}}
  document.addEventListener('click',function(event){const trigger=event.target.closest&&event.target.closest('[data-modal-trigger="set-availability"]');if(!trigger)return;__qa.delegatedModalOpens+=1;lumos.modal.open('set-availability');setTimeout(function(){if(window.__renderEvidence)__renderEvidence()},0)})
  </script></head><body><div id="hud"><b>QA evidence</b>\nwaiting for controller...</div><main><section class="hero"><p class="eyebrow">${label} · ${scenario}</p><h1>Welcome to your Starter Dashboard</h1><p class="intro">Complete action items, then manage Calendar and availability in the inline section below.</p><div class="toolbar"><button id="hero-availability" type="button" init-availability data-modal-trigger="set-availability">Set availability</button><button type="button" update-availability data-modal-trigger="set-availability">Edit availability</button></div><h2>Action items</h2><div id="action-items">${action}</div></section><div class="spacer"></div>${section}</main>
  <dialog data-modal-target="set-availability"><div class="modal"><p class="eyebrow">AVAILABILITY DIALOG</p><section availability-step="setup-form"><h2>Set your availability</h2><p class="modal-note">Choose the days and hours when brands can book.</p></section><section availability-step="default"><h2>Availability settings</h2></section><section availability-step="how-to-manage"><h2>Manage your calendar</h2></section><section availability-step="config-request-error"><h2>Calendar setup needs attention</h2></section><button type="button" data-modal-close onclick="this.closest('dialog').close()">Close</button></div></dialog>
  <script src="/controller.js?version=${version}"></script><script>
  window.__observation=function(){const modal=document.querySelector('dialog[data-modal-target="set-availability"]'),action=document.querySelector('#calendar-action'),section=document.querySelector('[data-availability-element="section"]'),step=Array.from(document.querySelectorAll('[availability-step]')).find(node=>getComputedStyle(node).display!=='none');return{scenario:__qa.scenario,version:__qa.version,initStatus:document.documentElement.getAttribute('data-scheduling-availability-init'),calendarState:document.documentElement.getAttribute('data-scheduling-calendar-state'),actionPresent:Boolean(action),actionModalTrigger:action&&action.getAttribute('data-modal-trigger'),actionConnectionState:action&&action.getAttribute('data-calendar-connection-state'),modalOpen:Boolean(modal&&modal.open),delegatedModalOpens:__qa.delegatedModalOpens,visibleStep:step&&step.getAttribute('availability-step'),hash:location.hash,scrollY:Math.round(scrollY),sectionTop:section?Math.round(section.getBoundingClientRect().top):null,requests:__qa.requests.length}}
  window.__renderEvidence=function(){const state=__observation();document.querySelector('#hud').innerHTML='<b>QA evidence</b>\\nscenario: '+state.scenario+'\\ncontroller: '+state.version+'\\nmodal open: '+state.modalOpen+'\\nmodal trigger: '+String(state.actionModalTrigger)+'\\nhash: '+(state.hash||'(none)')+'\\nscrollY: '+state.scrollY+'\\nsection top: '+String(state.sectionTop)};addEventListener('scroll',__renderEvidence,{passive:true});setInterval(__renderEvidence,100);__renderEvidence()
  </script></body></html>`
}

;(async () => {
  if (evidence) await fs.mkdir(evidence, { recursive: true })
  const targetSource = await fs.readFile(path.join(root, 'v3/scheduling-availability-init.js'))
  const baseSource = execFileSync('git', ['show', `${baseline}:v3/scheduling-availability-init.js`], { cwd: root })
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://www.thestarters.com')
    if (url.pathname === '/controller.js') {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(url.searchParams.get('version') === 'base' ? baseSource : targetSource)
      return
    }
    if (url.pathname === '/starter-dashboard') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(fixture(url.searchParams.get('scenario') || 'canonical', url.searchParams.get('version') || 'target'))
      return
    }
    res.writeHead(404).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  const pageErrors = []
  const scenarios = []
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--host-resolver-rules=MAP www.thestarters.com 127.0.0.1', '--no-proxy-server', '--disable-background-networking'] })
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } })
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') pageErrors.push(`console: ${message.text()}`) })
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      return url.hostname === 'www.thestarters.com' && Number(url.port) === server.address().port ? route.continue() : route.abort()
    })
    const navigate = async (scenario, version = 'target') => {
      await page.goto(`http://www.thestarters.com:${server.address().port}/starter-dashboard?scenario=${scenario}&version=${version}`, { waitUntil: 'networkidle' })
      await page.waitForFunction(() => document.documentElement.getAttribute('data-scheduling-availability-init') === 'init')
    }
    const observe = () => page.evaluate(() => window.__observation())
    const capture = async name => {
      if (!evidence) return null
      await page.evaluate(() => window.__renderEvidence())
      const file = path.join(evidence, `${name}.png`)
      await page.screenshot({ path: file })
      return file
    }
    const clickAction = async () => { await page.locator('#calendar-action').click(); await page.waitForTimeout(900) }

    await navigate('base-legacy', 'base')
    assert.equal((await observe()).actionModalTrigger, 'set-availability')
    await clickAction()
    let state = await observe()
    assert.equal(state.modalOpen, true, 'baseline must reproduce the unwanted modal')
    assert.equal(state.delegatedModalOpens, 1)
    scenarios.push({ name: 'Before-fix published legacy anchor regression', result: 'reproduced', observation: state, screenshot: await capture('calendar-scroll-base-legacy-modal-regression') })

    await navigate('canonical')
    assert.equal((await observe()).actionModalTrigger, null)
    await clickAction()
    await page.waitForFunction(() => scrollY > 600 && document.querySelector('[data-availability-element="section"]').getBoundingClientRect().top < 220)
    state = await observe()
    assert.equal(state.modalOpen, false); assert.equal(state.delegatedModalOpens, 0); assert.equal(state.hash, ''); assert.ok(state.sectionTop < 220)
    scenarios.push({ name: 'Canonical action scrolls inline without modal', result: 'pass', observation: state, screenshot: await capture('calendar-scroll-target-canonical-inline') })

    await navigate('legacy')
    assert.equal((await observe()).actionModalTrigger, null)
    await clickAction()
    await page.waitForFunction(() => location.hash === '#calendar' && scrollY > 600)
    state = await observe()
    assert.equal(state.modalOpen, false); assert.equal(state.delegatedModalOpens, 0); assert.equal(state.hash, '#calendar'); assert.ok(state.sectionTop < 220)
    scenarios.push({ name: 'Published legacy anchor keeps native inline scroll without modal', result: 'pass', observation: state, screenshot: await capture('calendar-scroll-target-published-legacy-inline') })

    await navigate('late')
    await page.evaluate(markup => { document.querySelector('#action-items').innerHTML = markup }, actionMarkup('canonical'))
    await page.waitForFunction(() => document.querySelector('#calendar-action').getAttribute('data-modal-trigger') === null)
    assert.equal((await observe()).actionConnectionState, 'disconnected')
    await clickAction()
    await page.waitForFunction(() => scrollY > 600 && document.querySelector('[data-availability-element="section"]').getBoundingClientRect().top < 220)
    state = await observe()
    assert.equal(state.modalOpen, false); assert.equal(state.delegatedModalOpens, 0); assert.equal(state.actionConnectionState, 'disconnected')
    scenarios.push({ name: 'Late-inserted action gets retained state and inline route', result: 'pass', observation: state, screenshot: await capture('calendar-scroll-target-late-inserted-inline') })

    await navigate('hero')
    await page.locator('#hero-availability').click()
    await page.waitForFunction(() => document.querySelector('dialog').open)
    state = await observe()
    assert.equal(state.modalOpen, true); assert.equal(state.delegatedModalOpens, 1); assert.equal(state.visibleStep, 'setup-form')
    scenarios.push({ name: 'Hero availability still opens setup modal once', result: 'pass', observation: state, screenshot: await capture('calendar-scroll-target-hero-modal-preserved') })

    await navigate('fallback')
    assert.equal((await observe()).actionModalTrigger, 'set-availability')
    await page.locator('#calendar-action').click()
    await page.waitForFunction(() => document.querySelector('dialog').open)
    state = await observe()
    assert.equal(state.modalOpen, true); assert.equal(state.delegatedModalOpens, 1); assert.equal(state.visibleStep, 'setup-form'); assert.equal(state.scrollY, 0)
    scenarios.push({ name: 'Section-absent action keeps safe modal fallback', result: 'pass', observation: state, screenshot: await capture('calendar-scroll-target-section-absent-fallback') })

    assert.deepEqual(pageErrors, [])
    const report = { boundary: 'Rendered Chrome acceptance using the real target/base controllers with a synthetic new-Starter auth read; no provider or production mutation.', browser: browser.version(), source: { baseline, targetCommit, baseScriptSha256: hash(baseSource), targetScriptSha256: hash(targetSource) }, pageErrors, scenarios }
    if (evidence) await fs.writeFile(path.join(evidence, 'calendar-scroll-browser-observations.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    if (browser) await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
