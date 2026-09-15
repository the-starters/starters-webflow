// Local browser integration with the real wf-xano binder (v0.28.0).
// NODE_PATH=<playwright>/node_modules WF_XANO_SOURCE=<wf-xano.js> node --test v3/hire-profile-taxonomy.test.cjs
// Optional TAXONOMY_EVIDENCE_DIR saves screenshots; TAXONOMY_CSS_SOURCE supports a pre-fix control.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const groups = ['Tools & Platforms', 'Skills', 'Industry Experience'];
const labels = ['Figma', 'Product strategy', 'Healthcare'];
const css = fs.readFileSync(process.env.TAXONOMY_CSS_SOURCE || require.resolve('./hire-profile-taxonomy.css'), 'utf8');
const binder = fs.readFileSync(process.env.WF_XANO_SOURCE, 'utf8');
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Hire profile taxonomy fixture</title>
<style>body{font:16px system-ui;color:#203d32;background:#f5f7f4;margin:0;padding:32px}main{max-width:760px;margin:auto;background:white;border:1px solid #d8e3dc;border-radius:16px;padding:24px}h1{margin-top:0}h2{font-size:18px}section{margin:24px 0}.profile-content_artifacts{gap:12px;flex-direction:column;border-bottom:1px solid #ddd;padding-bottom:20px}[wf-xano-element=list]{display:flex;gap:8px}[wf-xano-item]{border-radius:20px;background:#e7eee8;padding:8px 16px}[wf-xano-element=template]{display:none}footer{color:#687a70;font-size:13px}</style>
<link rel="stylesheet" href="/taxonomy.css"><script>window.WfXanoConfig={xanoBase:location.origin,preAuth:false};</script><script defer src="/wf-xano.js"></script></head><body><main>
<h1>Expertise</h1><p>Find the right experience for your project.</p>
${groups.map((name, i) => `<section class="profile-content_artifacts" xwf-empty-check id="group-${i}" style="display:${i === 1 ? 'grid' : 'flex'}"><h2>${name}</h2>
<div wf-xano-element="wrapper" wf-xano-instance="taxonomy-${i}" wf-xano-source="/taxonomy/${i}" wf-xano-method="GET" wf-xano-auth="none"><div wf-xano-element="list"><div wf-xano-element="template"><span wf-xano-bind="name">Template label</span></div></div><p wf-xano-element="empty">No results</p></div></section>`).join('')}
<section id="unmarked"><h2>About</h2><p>Available for consulting and project work.</p></section>
<footer>Local hire-profile fixture · real wf-xano binder · controlled responses</footer></main></body></html>`;

test('taxonomy groups hide independently while real wf-xano initializes, fetches and refreshes', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 920 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let mask = 1;
      let fail = false;
      let release;
      let pending = new Promise(resolve => { release = resolve; });
      let requests = [];
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://taxonomy.test') return route.abort();
        if (url.pathname === '/taxonomy.css') return route.fulfill({ contentType: 'text/css', body: css });
        if (url.pathname === '/wf-xano.js') return route.fulfill({ contentType: 'text/javascript', body: binder });
        if (url.pathname.startsWith('/taxonomy/')) {
          const index = Number(url.pathname.split('/').pop());
          requests.push({ index, method: route.request().method() });
          if (pending) await pending;
          return route.fulfill({ status: fail ? 503 : 200, contentType: 'application/json', body: JSON.stringify(fail ? { message: 'Unavailable' } : { items: mask & (1 << index) ? [{ id: index + 1, name: labels[index] }] : [] }) });
        }
        return route.fulfill({ contentType: 'text/html', body: fixture });
      });
      const capture = async stage => {
        if (process.env.TAXONOMY_EVIDENCE_DIR) {
          await page.screenshot({ path: path.join(process.env.TAXONOMY_EVIDENCE_DIR, `taxonomy-${width}-${stage}.png`), fullPage: true });
        }
      };
      const verify = async expectedMask => {
        for (let i = 0; i < groups.length; i++) {
          const group = page.locator(`#group-${i}`);
          const populated = Boolean(expectedMask & (1 << i));
          assert.equal(await group.isVisible(), populated, `${width}px: ${groups[i]} visibility`);
          assert.equal(await group.locator('[wf-xano-item]').count(), populated ? 1 : 0);
          assert.equal(await group.locator('[wf-xano-element="wrapper"]').count(), 1, 'wrapper remains available');
          assert.equal(await group.locator('[wf-xano-element="template"]').count(), 1, 'template remains available');
          if (populated) {
            assert.equal(await group.locator('[wf-xano-item]').innerText(), labels[i]);
            assert.equal(await group.evaluate(el => getComputedStyle(el).display), i === 1 ? 'grid' : 'flex', 'authored layout restored');
          }
        }
        assert.equal(await page.locator('#unmarked').isVisible(), true, 'unmarked section unaffected');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
      };
      await page.goto('http://taxonomy.test/hire/fixture', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.WfXano?.instances?.length === 3);
      await verify(0);
      await capture('pending');
      assert.deepEqual(requests.map(r => r.index).sort(), [0, 1, 2], 'all hidden lists fetch');
      assert(requests.every(r => r.method === 'GET'));
      pending = null;
      release();
      await page.waitForFunction(() => document.querySelectorAll('[wf-xano-item]').length === 1);
      await verify(1);
      await capture('tools-only');
      for (mask = 0; mask < 8; mask++) {
        await page.evaluate(() => Promise.all(WfXano.instances.map(instance => instance.refresh())));
        await verify(mask);
      }
      await capture('all-populated');
      // A refresh removes stale clones before its delayed response arrives.
      pending = new Promise(resolve => { release = resolve; });
      requests = [];
      await page.evaluate(() => { window.taxonomyRefresh = Promise.all(WfXano.instances.map(instance => instance.refresh())); });
      await verify(0);
      await capture('refresh-pending');
      mask = 4;
      pending = null;
      release();
      await page.evaluate(() => window.taxonomyRefresh);
      await verify(4);
      await capture('industry-only');
      fail = true;
      await page.evaluate(() => Promise.all(WfXano.instances.map(instance => instance.refresh())));
      await verify(0);
      fail = false;
      mask = 7;
      await page.evaluate(() => Promise.all(WfXano.instances.map(instance => instance.refresh())));
      await verify(7);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
