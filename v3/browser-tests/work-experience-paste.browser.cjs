// Focused acceptance: node v3/browser-tests/work-experience-paste.browser.cjs
// Optional: CHROME_BIN and PASTE_BROWSER_EVIDENCE (screenshots/observations).
// Actual Build/Edit controllers with simulated provider data; not production proof.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const { execFileSync, spawn } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
;(async () => {
  const profile = await fs.mkdtemp(path.join(root, '.paste-browser-'))
  const evidence = process.env.PASTE_BROWSER_EVIDENCE
  if (evidence) await fs.mkdir(evidence, { recursive: true })
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/overlap') {
      const surface = url.searchParams.get('surface') || 'build'
      const profileWords = url.searchParams.has('profile')
      const words = profileWords || url.searchParams.get('words') === '1'
      const maximum = profileWords ? 200 : 3
      const base = url.searchParams.get('base') === '1'
      const order = url.searchParams.get('order')
      const scripts = order === 'counter-first' ? ['counter', 'validator'] : ['validator', 'counter']
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(`<!doctype html><title>Description paste acceptance</title>
      <style>body{font:20px system-ui;padding:48px;background:#f5f5f0}textarea{display:block;width:700px;height:130px;font:22px system-ui;padding:18px;margin:20px 0}output{display:block;margin-top:20px}</style>
      <h1>Profile description paste</h1><p>Local actual-controller fixture · ${surface} · ${order} · ${words ? 'words' : 'characters'} · ${base ? 'before fix' : 'after fix'}</p>
      <form wf-validate-element="form"><div class="form_input-wr"><label>Description<textarea name="description" class="with-count" ${words ? `count-by-words data-max-words="${maximum}" ${profileWords ? 'maxlength="5000"' : ''}` : 'maxlength="20"'}></textarea></label>
      <span class="count-input"></span> / ${words ? maximum : 20}
      <div ${profileWords ? '' : 'wf-validate-element="count"'} wf-validate-count-max="${words ? maximum : 20}" ${words ? 'wf-validate-count-mode="words"' : ''}></div></div><button type="submit">Save description</button></form><output></output>
      <script>window.qs=(s,r)=>(r||document).querySelector(s);window.qsa=(s,r)=>[...(r||document).querySelectorAll(s)];window.mutations=[];window.pastes=[];qs('form').addEventListener('input',e=>{mutations.push(e.target.value);qs('output').textContent='Form received '+mutations.length+' input notification(s): '+e.target.value});qs('textarea').addEventListener('paste',e=>pastes.push({trusted:e.isTrusted}));</script>
      ${scripts.map(name => `<script src="/overlap-script?surface=${surface}&name=${name}&base=${base ? 1 : 0}${profileWords ? '&profile=1' : ''}"></script>${name === 'validator' ? '<script>WfValidate.init()</script>' : ''}`).join('')}`)
      return
    }
    if (url.pathname === '/overlap-script') {
      if (url.searchParams.get('surface') === 'edit' && url.searchParams.get('name') === 'counter') {
        const source = url.searchParams.get('base') === '1'
          ? execFileSync('git', ['show', '97e208fcc9e9f5acbfec32190c574ef3d022abea:starter-edit-profile.js'], {cwd:root, encoding:'utf8'})
          : await fs.readFile(path.join(root, 'starter-edit-profile.js'), 'utf8')
        res.setHeader('Content-Type', 'text/javascript')
        res.end('window.onDomReady=callback=>callback();\n' + source.split('// Inline block 2')[1].split('// Inline block 3')[0])
        return
      }
      const file = url.searchParams.get('name') === 'counter' ? 'v3/build-profile/field-counters.js' : 'utils/wf-validate.js'
      res.setHeader('Content-Type', 'text/javascript')
      res.end(url.searchParams.get('base') === '1' && url.searchParams.get('surface') !== 'edit' ? execFileSync('git', ['show', (url.searchParams.has('profile') ? '70ab7d02fd5699b3899064d2c4917f5bd2b3a02d:' : 'f6fc497f1a0d78aff856f0dc3a85fbbe2750e1ae:') + file], {cwd:root}) : await fs.readFile(path.join(root,file)))
      return
    }
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><title>Work experience paste regression</title><style>body{font:18px system-ui;background:#f5f5f0;padding:50px;max-width:800px}input{display:block;padding:14px;width:90%;margin:12px 0}button{padding:14px 28px;background:#241342;color:white;border:0;border-radius:8px}.company-card{background:white;padding:20px;margin:12px 0}small{color:#555}</style>
      <h1>${url.searchParams.get('mode')} · Add Work Experience</h1><small>Local acceptance fixture · actual controllers · simulated provider · ${url.searchParams.get('base') ? 'before fix' : 'after fix'}</small>
      <div class="company-list"><div class="company-card"><strong class="company-card__name"></strong><p class="company-card__meta position"></p></div></div>
      <h2 dropdown-toggle-label>Add Work Experience - 1 of 3</h2>
      <form wf-validate-element="form"><label>Company<input id="company-name" name="company" required></label><label>Title<input id="company-position" name="title" required maxlength="30"></label><button type="button" id="add-company"><div>Add</div></button></form>
      <script>
      window.qs=(s,r)=> (r||document).querySelector(s);window.qsa=(s,r)=> [...(r||document).querySelectorAll(s)];
      window.MEMBER={id:'synthetic-starter'};window.waitForMember=fn=>fn();
      window.records=[{id:1,company_name:'First Company',job_title:'Designer'}];window.requests=[];
      window.fetch=async (url,opts={})=>{if(opts.method==='POST'){const p=JSON.parse(opts.body);requests.push(p);records.push({...p,id:records.length+1})}return {ok:true,json:async()=>({companies:records,starter_id:100})}};
      </script><script src="/validator.js${url.searchParams.get('base') ? '?base=1' : ''}"></script><script src="/v3/${url.searchParams.get('mode')}/company-experience-crud.js"></script>`);
      return;
    }
    try {
      const body = url.pathname === '/validator.js'
        ? (url.searchParams.has('base') ? execFileSync('git',['show','75e1d19:utils/wf-validate.js'],{cwd:root}) : await fs.readFile(path.join(root,'utils/wf-validate.js')))
        : await fs.readFile(path.join(root,url.pathname));
      res.setHeader('Content-Type','text/javascript');res.end(body);
    } catch {res.writeHead(404).end()}
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
    const observations = [];
    for (const mode of ['build-profile','starter-edit-profile']) {
      for (const base of [true,false]) {
        await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?mode=${mode}&base=${base ? '1' : ''}`});
        await pause(350);
        await evaluate(`(()=>{const c=qs('#company-name');c.value='Second Company';c.dataset.selectedCompanyName=c.value;c.dataset.selectedCompanySource='custom';c.dispatchEvent(new Event('input',{bubbles:true}));window.fieldEvents=[];window.formEvents=[];qs('#company-position').addEventListener('input',e=>fieldEvents.push(e.target.value));qs('form').addEventListener('input',e=>formEvents.push(e.target.value));qs('#company-position').focus()})()`);
        const paste = text => evaluate(`(()=>{const d=new DataTransfer();d.setData('text/plain',${JSON.stringify(text)});qs('#company-position').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));return {value:qs('#company-position').value,disabled:qs('#add-company').getAttribute('aria-disabled'),caret:qs('#company-position').selectionStart,fieldEvents,formEvents}})()`);
        const state = await paste('Chief Marketing Officer');
        assert.equal(state.value,'Chief Marketing Officer');
        assert.equal(state.disabled,base ? 'true':'false');
        assert.equal(state.caret,23);
        assert.deepEqual(state.fieldEvents,base ? []:['Chief Marketing Officer']);
        assert.deepEqual(state.formEvents,base ? []:['Chief Marketing Officer']);
        const label=`${mode}-${base ? 'before' : 'after'}-paste`;
        observations.push({label,...state});
        if(evidence){const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(evidence,label+'.png'),Buffer.from(shot.data,'base64'))}
        if(base){await send('Input.insertText',{text:' '});assert.equal(await evaluate(`qs('#add-company').getAttribute('aria-disabled')`),'false')}
        else {
          await evaluate(`qs('#company-position').setSelectionRange(0,23)`);
          let replaced=await paste('x'.repeat(40));assert.equal(replaced.value,'x'.repeat(30));assert.equal(replaced.caret,30);
          const full=await paste('Z');assert.equal(full.value,replaced.value);assert.equal(full.fieldEvents.length,2);
          await evaluate(`qs('#company-position').setSelectionRange(0,30)`);await paste('QA Lead');
          await evaluate(`qs('#add-company').click()`);await pause(100);
          const cards=await evaluate(`[...document.querySelectorAll('.company-card')].filter(e=>e.style.display!=='none').map(e=>e.textContent)`);
          assert.ok(cards.some(t=>t.includes('Second Company')&&t.includes('QA Lead')),JSON.stringify(cards));
          observations.push({label:mode+'-added-second-company',cards,requests:await evaluate('requests')});
          if(evidence){const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(evidence,mode+'-added.png'),Buffer.from(shot.data,'base64'))}
        }
      }
    }
    await send('Emulation.setFocusEmulationEnabled', {enabled:true})
    await send('Browser.grantPermissions', {origin:`http://127.0.0.1:${server.address().port}`,permissions:['clipboardReadWrite','clipboardSanitizedWrite']})
    for (const surface of ['build','edit']) {
    for (const order of ['counter-first','validator-first']) {
      for (const words of [false,true]) {
        for (const base of [true,false]) {
          await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/overlap?surface=${surface}&order=${order}&words=${words ? 1 : 0}&base=${base ? 1 : 0}`})
          await pause(200)
          const paste = async text => {
            await evaluate(`qs('textarea').focus();navigator.clipboard.writeText(${JSON.stringify(text)})`)
            await send('Input.dispatchKeyEvent',{type:'keyDown',key:'v',code:'KeyV',modifiers:4,commands:['paste']})
            await send('Input.dispatchKeyEvent',{type:'keyUp',key:'v',code:'KeyV',modifiers:4})
            return evaluate(`({value:qs('textarea').value,caret:qs('textarea').selectionStart,count:qs('.count-input').textContent,mutations:[...mutations],pastes:[...pastes]})`)
          }
          const state = await paste('Paste once')
          assert.ok(state.pastes[0].trusted, 'Use a browser-generated clipboard event')
          if (evidence) {
            const shot = await send('Page.captureScreenshot', {format:'png'})
            await fs.writeFile(path.join(evidence, `single-paste-${surface}-${order}-${words ? 'words' : 'chars'}-${base ? 'before' : 'after'}.png`), Buffer.from(shot.data, 'base64'))
          }
          if(base && (surface === 'build' || order === 'validator-first')) assert.notEqual(state.value,'Paste once','Base must reproduce duplicate insertion')
          else {
            assert.equal(state.value,'Paste once');assert.equal(state.mutations.length,1)
            assert.equal(state.count,words ? '02' : '10')
            await evaluate(`qs('textarea').setSelectionRange(0,10)`)
            const replacement = await paste('New content')
            assert.equal(replacement.value,'New content');assert.equal(replacement.mutations.length,2)
            await evaluate(`qs('textarea').setSelectionRange(4,11)`)
            assert.equal((await paste('role')).value,'New role')
            await evaluate(`qs('textarea').select()`)
            const capped = await paste(words ? 'one two three four' : '1234567890123456789012345')
            assert.equal(capped.value,words ? 'one two three' : '12345678901234567890')
            assert.equal(capped.caret,capped.value.length)
            const full = await paste('extra')
            assert.equal(full.value,capped.value);assert.equal(full.mutations.length,capped.mutations.length)
          }
          const label=`description-${surface}-${order}-${words ? 'words' : 'chars'}-${base ? 'before' : 'after'}`
          observations.push({label,state,final:await evaluate(`({value:qs('textarea').value,mutations,pastes})`)})
          if(evidence){const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(evidence,label+'.png'),Buffer.from(shot.data,'base64'))}
        }
      }
    }
    for (const order of ['counter-first','validator-first']) {
      for (const base of (surface === 'edit' ? [false] : [true,false])) {
        await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/overlap?surface=${surface}&profile=1&order=${order}&base=${base ? 1 : 0}`})
        await pause(200)
        await evaluate(`qs('textarea').focus();navigator.clipboard.writeText(Array(205).fill('service').join(' '))`)
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:'v',code:'KeyV',modifiers:4,commands:['paste']})
        await send('Input.dispatchKeyEvent',{type:'keyUp',key:'v',code:'KeyV',modifiers:4})
        const state = await evaluate(`({words:qs('textarea').value.trim().split(/\\s+/).length,count:qs('.count-input').textContent,mutations:mutations.length,trusted:pastes[0].trusted})`)
        assert.equal(state.words,base && order === 'validator-first' ? 205 : 200)
        assert.equal(state.mutations,1)
        assert.equal(state.trusted,true)
        const label = `profile-200-${surface}-${order}-${base ? 'before' : 'after'}`
        observations.push({label,...state})
        if(evidence){const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(evidence,label+'.png'),Buffer.from(shot.data,'base64'))}
        if (!base) {
          await send('Input.insertText',{text:' extra'})
          assert.equal(await evaluate(`qs('textarea').value.trim().split(/\\s+/).length`),200)
          for (const maximum of [200,160]) {
            const result = await evaluate(`(()=>{const el=qs('textarea');${maximum === 160 ? "el.removeAttribute('data-max-words');" : ''}el.value=Array(${maximum+1}).fill('restored').join(' ');el.dispatchEvent(new Event('input',{bubbles:true}));const event=new Event('submit',{bubbles:true,cancelable:true});qs('form').dispatchEvent(event);return {blocked:event.defaultPrevented,text:qs('form').textContent}})()`)
            assert.equal(result.blocked,true)
            observations.push({label:label+'-restored-'+maximum,...result})
          }
        }
      }
    }
    }
    assert.deepEqual(errors,[]);
    if(evidence)await fs.writeFile(path.join(evidence,'paste-observations.json'),JSON.stringify({boundary:'Local fixture, actual controllers, simulated provider; not production proof',observations},null,2));
    console.log('Build and Edit: baseline paste leaves Add disabled; typed space recovers. Fixed paste enables Add, truncates, preserves caret and no-room behavior; second company card added.');
  } finally {
    socket?.close();const closed=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill();await closed;
    await new Promise(resolve=>server.close(resolve));await fs.rm(profile,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1})
