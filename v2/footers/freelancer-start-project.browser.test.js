// Focused browser check: node --test v2/footers/freelancer-start-project.browser.test.js
// Requires Playwright and an installed Chrome. All provider requests are isolated.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const message = 'Select a Brand from the list before starting the project.';

async function boot(browser, artifact, memberState = 'pending') {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const setup = `window.$memberstackDom={getCurrentMember:()=>${memberState === 'pending'
    ? 'new Promise(()=>{})' : memberState === 'rejected'
      ? 'Promise.reject(new Error("Memberstack fixture rejection"))'
      : 'Promise.resolve({data:{id:"fixture",customFields:{"completed-starter-profile":true}}})'}};
    window.fetch=async()=>({ok:true,json:async()=>({freelancer:{},brands:[{full_name:"Eligible Brand",webflow_id:"eligible-brand-id"}]})});`;
  let scripts = artifact ? read(artifact) : '';
  if (artifact?.endsWith('.html')) scripts = [...scripts.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  const html = read('fixtures/contract-form.html') +
    `<script>${setup}</script><script>${read('freelancer-start-project-contract.js')}</script><script>${scripts.replaceAll("</script>", "<\\/script>")}</script>`;
  await page.route('**/*', route => route.request().url() === 'https://contract.fixture.test/'
    ? route.fulfill({contentType:'text/html', body:html}) : route.abort());
  await page.goto('https://contract.fixture.test/');
  // Observe propagation before preventing navigation. Never deliver a form.
  await page.evaluate(() => {
    window.submissions = [];
    document.querySelector('form').addEventListener('submit', event => {
      window.submissions.push({prevented:event.defaultPrevented, brand:document.querySelector('#brand-contract').value});
      event.preventDefault();
    });
  });
  return {page, errors};
}

async function assertEditing(page) {
  assert.equal(await page.locator('#brand-search').isEnabled(), true);
  assert.equal(await page.locator('#brand-search').isVisible(), true);
  assert.equal(await page.locator('#brand-selection-error').isVisible(), true);
  assert.equal(await page.locator('#brand-selection-error').innerText(), message);
  assert.equal(await page.locator('.review-button-wrapper').isVisible(), true);
  assert.equal(await page.locator('.button-group.is-confirm').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'brand-search');
  assert.equal(await page.locator('#brand-search').evaluate(e => e.validationMessage), message);
  assert.equal(await page.locator('#brand-search').evaluate(e => e.matches(':invalid') && e.willValidate), true);
}

test('real contract Review/Edit recovers invalid Brands in both artifacts', async () => {
  const browser = await chromium.launch({channel:'chrome', headless:true});
  try {
    // Reproduce the reported production baseline with the actual Review script.
    const baseline = await boot(browser);
    await baseline.page.locator('#review-btn').click();
    assert.equal(await baseline.page.locator('#brand-search').isDisabled(), true);
    assert.equal(await baseline.page.locator('.button-group.is-confirm').isVisible(), true);
    assert.equal(await baseline.page.locator('#brand-search').evaluate(e => e.validationMessage), '');
    assert.deepEqual(baseline.errors, []);
    await baseline.page.close();

    for (const artifact of ['freelancer-start-project.js','freelancer-start-project-footer.html']) {
      for (const state of ['pending','rejected','resolved']) {
        const {page, errors} = await boot(browser, artifact, state);
        try {
          await page.locator('#review-btn').click();
          await assertEditing(page);
          await page.locator('#brand-search').fill('Unselected Brand');
          await page.locator('#review-btn').click();
          await assertEditing(page);

          // Enter Review through the real handler, then invalidate identity while
          // controls are disabled to exercise submit-time recovery through Edit.
          await page.evaluate(() => {
            document.querySelector('#brand-search').value = 'Eligible Brand';
            document.querySelector('#brand-name').value = 'Eligible Brand';
            document.querySelector('#brand-contract').value = 'eligible-brand-id';
          });
          await page.locator('#review-btn').click();
          assert.equal(await page.locator('#brand-search').isDisabled(), true);
          assert.equal(await page.locator('.button-group.is-confirm').isVisible(), true);
          await page.evaluate(() => {
            document.querySelector('#brand-contract').value = '';
            document.querySelector('form').requestSubmit();
          });
          await assertEditing(page);
          if (process.env.CONTRACT_TEST_EVIDENCE_DIR && state === 'pending') {
            await page.screenshot({path:path.join(process.env.CONTRACT_TEST_EVIDENCE_DIR, `${artifact}-real-edit-recovery.png`)});
          }
          assert.deepEqual(await page.evaluate(() => submissions), []);

          if (state === 'resolved') {
            // Let the dropdown's existing 100ms blur transition finish.
            await page.waitForTimeout(150);
            await page.locator('#brand-search').blur();
            await page.waitForTimeout(150);
            await page.locator('#brand-search').fill('Eligible');
            await page.locator('#brand-search').press('ArrowRight');
            assert.deepEqual(errors, []);
            await page.locator('.brand-select__option', {hasText:'Eligible Brand'}).click({timeout:3000});
            assert.equal(await page.locator('#brand-contract').inputValue(), 'eligible-brand-id');
            assert.equal(await page.locator('#brand-selection-error').isVisible(), false);
            await page.locator('#review-btn').click();
            await page.evaluate(() => document.querySelector('form').requestSubmit());
            assert.deepEqual(await page.evaluate(() => submissions), [{prevented:false,brand:'eligible-brand-id'}]);
            await page.locator('#edit-btn').click();
            await page.locator('#brand-search').fill('Changed Brand');
            assert.equal(await page.locator('#brand-contract').inputValue(), '');
            assert.equal(await page.locator('#brand-name-contract').inputValue(), '');
            await page.locator('#review-btn').click();
            await assertEditing(page);
          }
          assert.deepEqual(errors, state === 'rejected' ? ['Memberstack fixture rejection'] : []);
        } finally { await page.close(); }
      }
    }
  } finally { await browser.close(); }
});
