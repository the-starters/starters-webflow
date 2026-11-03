// Checks board-kit.md end to end: extracts the page and build script from it, builds fixtures, drives them in Chrome.
// Usage: npm i playwright-core && node board-kit.test.mjs board-kit.md   (needs Google Chrome installed)
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const KIT = process.argv[2];
const OUT = join(process.cwd(), 'out'); mkdirSync(OUT, { recursive: true });
const md = readFileSync(KIT, 'utf8');
const block = lang => { const m = md.match(new RegExp('```' + lang + '\\n([\\s\\S]*?)\\n```')); if (!m) throw new Error('no ' + lang + ' block'); return m[1]; };
writeFileSync(join(OUT, 'board.html'), block('html'));
writeFileSync(join(OUT, 'build_board.py'), block('python'));

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
check(!/velu/i.test(md), 'markdown has no Velu references');

const build = (name, cards, config) => {
  writeFileSync(join(OUT, name + '.cards.json'), JSON.stringify(cards));
  const args = [join(OUT, 'build_board.py'), join(OUT, 'board.html'), join(OUT, name + '.html'), '--cards', join(OUT, name + '.cards.json')];
  if (config) { writeFileSync(join(OUT, name + '.config.json'), JSON.stringify(config)); args.push('--config', join(OUT, name + '.config.json')); }
  execFileSync('python3', args);
  return 'file://' + join(OUT, name + '.html');
};

const STATUSES = ['backlog', 'next', 'doing', 'review', 'done', 'bogus'];
const scaleCfg = { title: 'Scale', brand: 'Acme', storageKey: 'scale', issueUrl: 'https://example.com/i/{id}',
  types: { dev: { label: 'Dev' }, design: { label: 'Design', accent: true }, qa: { label: 'QA' }, ops: { label: 'Ops' } },
  boards: Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['b' + i, { label: 'Board ' + i, hue: i * 17 }])) };
const scaleCards = Array.from({ length: 3000 }, (_, i) => ({ id: 'C-' + i, title: 'Card ' + i, status: STATUSES[i % 6], board: 'b' + (i % 40),
  type: ['dev', 'design', 'qa', 'ops', 'nope'][i % 5], blocker: i % 97 === 0 ? 'Pick one' : '', updatedAt: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}T10:00`, issue: String(i) }));

// Folder input: one JSON file per card.
const dir = join(OUT, 'cards-dir'); mkdirSync(dir, { recursive: true });
['A-1', 'A-2'].forEach((id, i) => writeFileSync(join(dir, id + '.json'), JSON.stringify({ id, title: 'Folder card ' + i, status: 'next', board: 'x' })));
execFileSync('python3', [join(OUT, 'build_board.py'), join(OUT, 'board.html'), join(OUT, 'folder.html'), '--cards', dir]);

const urls = {
  sample: 'file://' + join(OUT, 'board.html'),
  empty: build('empty', []),
  scale: build('scale', scaleCards, scaleCfg),
  hostile: build('hostile', [
    { id: 'X"1\'', title: '<img src=x onerror="window.__x=1">', status: 'review', board: '<b>bad</b>', pr: 'javascript:window.__x=2', issue: 'javascript:alert(1)', detail: '</script><script>window.__x=3</script>' },
    { id: 'X2', status: 'weird', type: 'unknown' }, { title: 'no id' }, null, { id: 'X3', title: 'Constructor board', board: 'constructor', status: 'doing' },
  ], { types: {}, boards: { __proto__: { label: 'proto' } } }),
  folder: 'file://' + join(OUT, 'folder.html'),
};

const browser = await chromium.launch({ channel: 'chrome' });
async function open(url, opts = {}) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await page.goto(url);
  return { page, ctx, errors };
}

{ // Sample data from the markdown, unchanged.
  const { page, ctx, errors } = await open(urls.sample, { viewport: { width: 1280, height: 900 } });
  check(await page.title() === 'Team Board', 'sample: title from config');
  check(await page.locator('.side .chip').allTextContents().then(t => t.includes('Web App') && t.includes('Mobile')), 'sample: sidebar lists configured boards');
  check(await page.locator('#sec-need [data-card="WEB-1"]').count() === 1, 'sample: review card sits under Needs you');
  check(await page.locator('#sec-need .why').innerText() === 'PR #12 waiting for your review', 'sample: PR number parsed from URL');
  check(await page.locator('#sec-backlog [data-card="MOB-2"]').count() === 1, 'sample: backlog card in Backlog');
  await page.click('[data-card="WEB-1"]');
  await page.waitForTimeout(350);
  check(await page.evaluate(() => document.documentElement.hasAttribute('data-drawer')), 'sample: row click opens drawer');
  check(await page.locator('#dw-title').innerText() === 'Sign-in page', 'sample: drawer shows the card');
  check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Close details', 'sample: focus moves into drawer');
  await page.keyboard.press('ArrowDown');
  check(await page.locator('#dw-title').innerText() === 'Settings layout', 'sample: ArrowDown steps to next card');
  check(await page.locator('#dw-prev').isEnabled(), 'sample: previous enabled after stepping');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  check(!(await page.evaluate(() => document.documentElement.hasAttribute('data-drawer'))), 'sample: Escape closes drawer');
  check(await page.evaluate(() => document.activeElement?.dataset.card) === 'WEB-2', 'sample: focus returns to the open row');
  await page.click('.side [data-f="mobile"]');
  await page.reload();
  check(await page.locator('.main-head h1').innerText() === 'Mobile', 'sample: board filter survives reload');
  check(await page.locator('[data-card="WEB-1"]').count() === 0, 'sample: filter hides other boards');
  await page.click('.side [data-t="design"]');
  check(await page.locator('.main-head p').innerText().then(t => t.includes('Design cards')), 'sample: type filter applies');
  check(errors.length === 0, 'sample: no console errors ' + errors.join(' | '));
  await ctx.close();
}

{ // Phone width and dark mode.
  const { page, ctx, errors } = await open(urls.scale, { viewport: { width: 375, height: 812 }, colorScheme: 'dark', isMobile: true, hasTouch: true });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'phone: no horizontal page scroll at 375px');
  check(!(await page.locator('.side').isVisible()) && await page.locator('.filters').first().isVisible(), 'phone: sidebar hidden, chips shown');
  check(await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(20, 21, 19)', 'phone: dark theme applied');
  await page.locator('[data-card]').first().click();
  await page.waitForTimeout(350);
  const w = await page.locator('#drawer').boundingBox();
  check(w && Math.round(w.width) === 375, 'phone: drawer is full width');
  check(errors.length === 0, 'phone: no console errors ' + errors.join(' | '));
  await ctx.close();
}

{ // 3000 cards, 40 boards (20 not in config), 4 types plus one unknown.
  const t0 = Date.now();
  const { page, ctx, errors } = await open(urls.scale, { viewport: { width: 1280, height: 900 } });
  const loadMs = Date.now() - t0;
  check(loadMs < 3000, `scale: loads in ${loadMs} ms`);
  check(await page.locator('.side [data-f]').count() === 41, 'scale: all 40 boards listed plus All');
  check(await page.locator('.side [data-f="b25"] .chip').innerText() === 'b25', 'scale: unconfigured board shows under its key');
  const hues = await page.$$eval('.side [data-f] .chip', els => new Set(els.map(e => e.getAttribute('style'))).size);
  check(hues >= 30, `scale: boards get distinct colours (${hues})`);
  check(await page.locator('#sec-next .row').count() === 6, 'scale: Up next capped at its limit');
  const expectNext = scaleCards.filter(c => c.status === 'next' && !c.blocker).length;
  check(await page.locator('#sec-next h2 .c').innerText() === String(expectNext), `scale: Up next count ${expectNext}`);
  const t1 = Date.now();
  await page.click('[data-more="next"]');
  const expandMs = Date.now() - t1;
  check(await page.locator('#sec-next .row').count() === expectNext, `scale: Show all expands (${expandMs} ms)`);
  const backlogExpected = scaleCards.filter(c => (c.status === 'backlog' || c.status === 'bogus') && !c.blocker).length;
  check(await page.locator('#sec-backlog h2 .c').innerText() === String(backlogExpected), 'scale: unknown status counts as backlog');
  check(await page.locator('.side [data-t]').count() === 5, 'scale: type filter has All plus 4 types');
  const t2 = Date.now();
  await page.click('.side [data-f="b3"]');
  check(Date.now() - t2 < 1000, `scale: filter re-render ${Date.now() - t2} ms`);
  await page.click('#sec-need [data-card]');
  await page.waitForTimeout(300);
  check(await page.locator('#dw-body a[href="https://example.com/i/0"]').count() + await page.locator('#dw-body a[href^="https://example.com/i/"]').count() > 0, 'scale: issue linked through issueUrl');
  check(errors.length === 0, 'scale: no console errors ' + errors.join(' | '));
  await ctx.close();
}

{ // Hostile and malformed input.
  const { page, ctx, errors } = await open(urls.hostile, { viewport: { width: 1280, height: 900 } });
  check(await page.evaluate(() => window.__x) === undefined, 'hostile: no injected script ran');
  check(await page.locator('#stage img').count() === 0, 'hostile: HTML in titles is escaped');
  check(await page.locator('.side .chip', { hasText: '<b>bad</b>' }).count() === 1, 'hostile: board key shown as text');
  await page.click('#sec-need [data-card]');
  await page.waitForTimeout(300);
  check(await page.locator('#dw-body a').count() === 0, 'hostile: javascript: links not rendered as links');
  check(await page.locator('#dw-body p').innerText().then(t => t.includes('</script>')), 'hostile: </script> in detail survives as text');
  await page.keyboard.press('Escape');
  check(await page.locator('[data-card]').count() === 3, 'hostile: null entry and id-less card dropped, rest kept');
  check(await page.locator('.side [data-t]').count() === 0, 'hostile: empty types fall back to one type, no type filter');
  check(await page.locator('.side .chip', { hasText: 'constructor' }).count() === 1, 'hostile: board named constructor works');
  check(errors.length === 0, 'hostile: no console errors ' + errors.join(' | '));
  await ctx.close();
}

{ // Empty data and broken config JSON.
  const { page, ctx, errors } = await open(urls.empty, { viewport: { width: 1280, height: 900 } });
  check(await page.locator('#sec-need .empty').count() === 1, 'empty: Needs you shows the empty message');
  check(await page.locator('.main-head p').innerText().then(t => t.includes('No cards yet')), 'empty: header says no cards');
  check(errors.length === 0, 'empty: no console errors ' + errors.join(' | '));
  await ctx.close();
  const broken = readFileSync(join(OUT, 'board.html'), 'utf8').replace('"title": "Team Board",', '"title": "Team Board"');
  writeFileSync(join(OUT, 'broken.html'), broken);
  const b = await open('file://' + join(OUT, 'broken.html'));
  check(await b.page.locator('[data-card]').count() === 4, 'broken config: cards still render');
  check(b.errors.some(e => /board-config/.test(e)), 'broken config: names the bad block in the console');
  await b.ctx.close();
}

{ // Folder of card files.
  const { page, ctx, errors } = await open(urls.folder);
  check(await page.locator('[data-card]').count() === 2, 'folder: build reads one-card files');
  check(errors.length === 0, 'folder: no console errors');
  await ctx.close();
}

{ // Fixes from the fresh-reader run.
  const nested = join(OUT, 'new', 'deep', 'index.html');
  writeFileSync(join(OUT, 'fix.cards.json'), JSON.stringify([
    { id: 'D-old', title: 'Old done', status: 'done', board: 'web', updatedAt: '2020-01-01 10:00' },
    { id: 'D-new', title: 'New done', status: 'done', board: 'web', updatedAt: new Date().toISOString().slice(0, 16) },
    { id: 'T-1', title: 'Typo type', status: 'next', board: 'web', type: 'Dev' },
    { id: 'B-1', title: 'Blocked', status: 'next', board: 'mobile', blocker: 'Which API?' },
    { id: 'K-1', title: 'Backlog only', status: 'backlog', board: 'data' },
  ]));
  writeFileSync(join(OUT, 'fix.config.json'), JSON.stringify({ title: 'Fix', brand: 'Northwind', doneDays: 14, types: { dev: { label: 'Dev' }, bug: { label: 'Bug' } }, boards: { web: { label: 'Web', hue: 215 }, mobile: { label: 'Mobile', hue: 150 }, data: { label: 'Data', hue: 300 } } }));
  execFileSync('python3', [join(OUT, 'build_board.py'), join(OUT, 'board.html'), nested, '--cards', join(OUT, 'fix.cards.json'), '--config', join(OUT, 'fix.config.json')]);
  check(readFileSync(nested, 'utf8').includes('Northwind'), 'fix: build creates a missing output folder');
  const warns = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', m => m.type() === 'warning' && warns.push(m.text()));
  await page.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await page.goto('file://' + nested);
  check(await page.locator('[data-card="D-old"]').count() === 0 && await page.locator('[data-card="D-new"]').count() === 1, 'fix: doneDays hides old done cards only');
  check(warns.some(w => w.includes('Unknown type "Dev"')), 'fix: unknown type logs a warning');
  check(await page.locator('#sec-need [data-card="B-1"] .why').innerText() === 'Which API?', 'fix: blocker moves a next card to Needs you');
  const side = await page.$$eval('.side [data-f]', els => els.map(e => [e.dataset.f, e.querySelector('.o').textContent]));
  await page.setViewportSize({ width: 375, height: 812 });
  const chips = await page.$$eval('.filters [data-f]', els => els.map(e => [e.dataset.f, e.querySelector('.c')?.textContent ?? null]));
  check(JSON.stringify(side.slice(1).map(x => x[0])) === JSON.stringify(chips.slice(1).map(x => x[0])), 'fix: sidebar and phone chips sort the same ' + JSON.stringify(chips));
  check(JSON.stringify(side.slice(1)) === JSON.stringify(chips.slice(1)), 'fix: sidebar and phone chips count the same');
  check(await page.locator('.main-head .brand-m').isVisible() && (await page.locator('.main-head p').innerText()).startsWith('Northwind'), 'fix: brand shows on phones');
  await page.setViewportSize({ width: 1280, height: 900 });
  check(!(await page.locator('.main-head .brand-m').isVisible()), 'fix: brand line hidden on desktop (sidebar has it)');
  await ctx.close();
}

await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
