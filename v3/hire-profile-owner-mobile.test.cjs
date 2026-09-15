// Render the controller against the profile's responsive action-group classes.
// Run: node --test v3/hire-profile-owner-mobile.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const source = fs.readFileSync(process.env.PROFILE_CTA_SOURCE || require.resolve('./hire-profile.js'), 'utf8');

// Published profile stylesheet: these two flex groups become display:none
// at the mobile-landscape breakpoint. Brand-only mobile alternatives are
// absent after Memberstack resolves an owner session.
const group = (name) => `<div class="${name}"><div class="button-group" booking-button-wrapper>
<div data-signup-trigger-element="hire" data-modal-trigger="generate-contract">Hire</div>
<div data-signup-trigger-element="book-call" data-modal-trigger="popup-booking-main">Book Call</div>
<div data-signup-trigger-element="message">Message</div></div></div>`;

test('owner primary and sticky calls remain discoverable on mobile without self-booking', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const owner of [true, false]) {
      const page = await browser.newPage({ viewport: { width: 765, height: 900 } });
      await page.route('**/*', route => route.abort());
      await page.setContent(`<style>
        .profile-hero_action-buttons{display:flex;flex-flow:column;gap:24px}
        .profile-nav_actions{display:flex;gap:12px}
        .button-group{display:flex;gap:16px}
        @media(max-width:767px){.profile-hero_action-buttons,.profile-nav_actions{display:none}}
      </style><button id=before>Before</button>${group('profile-hero_action-buttons')}${group('profile-nav_actions')}
      <button id=after>After</button><dialog data-modal-target="popup-booking-main"></dialog>`);
      await page.evaluate(owner => {
        window.MEMBER = { id: owner ? 'fixture' : 'other' };
        window.memberReady = Promise.resolve(MEMBER);
        window.waitForMember = cb => Promise.resolve().then(() => cb(MEMBER));
        window.qs = (s, r) => (r || document).querySelector(s);
        window.qsa = (s, r) => [...(r || document).querySelectorAll(s)];
        window.starter_memberstack_id = 'fixture';
        window.stripe_charges = false;
        window.StartersFreeCallBooking = {};
      }, owner);
      await page.addScriptTag({ content: source });
      await page.waitForFunction(() => document.querySelectorAll('[data-profile-book-call]').length === 2);
      for (const width of [765, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const state = await page.evaluate(() => {
          const visible = el => el.getClientRects().length > 0;
          return {
            calls: [...document.querySelectorAll('[data-profile-book-call]')].map(visible),
            contacts: [...document.querySelectorAll('[data-signup-trigger-element="hire"], [data-signup-trigger-element="message"]')].map(visible),
          };
        });
        assert.deepEqual(state.calls, [owner || width > 767, owner || width > 767], `owner=${owner}, width=${width}`);
        assert(state.contacts.every(value => value === (!owner && width > 767)));
        if (owner) {
          const calls = page.locator('[data-profile-book-call]');
          for (let i = 0; i < 2; i++) {
            // aria-disabled intentionally remains focusable/tappable.
            const bounds = await calls.nth(i).boundingBox();
            await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
            const hint = page.locator('[data-call-availability-hint]').nth(i);
            assert(await hint.isVisible());
            const hintBounds = await hint.boundingBox();
            assert(hintBounds.x >= 0 && hintBounds.y >= 0 && hintBounds.x + hintBounds.width <= width && hintBounds.y + hintBounds.height <= 900, 'explanation fits viewport');
            assert.equal(await hint.locator('a').getAttribute('href'), '/starter-dashboard');
            assert.equal(await calls.nth(i).getAttribute('aria-disabled'), 'true');
            assert.equal(await calls.nth(i).getAttribute('data-modal-trigger'), null);
            assert.equal(await calls.nth(i).getAttribute('data-signup-trigger-element'), null);
            if (process.env.PROFILE_CTA_EVIDENCE_DIR) {
              await page.screenshot({ path: `${process.env.PROFILE_CTA_EVIDENCE_DIR}/owner-${width}-${i === 0 ? 'primary' : 'sticky'}.png`, fullPage: true });
            }
            await calls.nth(i).focus();
            await page.mouse.move(width - 1, 800);
            await page.keyboard.press('Escape');
            await calls.nth(i).evaluate(el => el.blur());
          }
          await page.mouse.move(width - 1, 800);
          await page.locator('#before').click();
          await page.keyboard.press('Tab');
          assert(await calls.nth(0).evaluate(el => el === document.activeElement));
          await page.keyboard.press('Tab');
          const firstSettings = page.locator('[data-call-availability-hint]').nth(0).locator('a');
          assert(await firstSettings.evaluate(el => el === document.activeElement));
          await page.keyboard.press('Shift+Tab');
          assert(await calls.nth(0).evaluate(el => el === document.activeElement));
          await page.keyboard.press('Tab');
          await page.keyboard.press('Tab');
          assert(await calls.nth(1).evaluate(el => el === document.activeElement));
          await page.keyboard.press('Tab');
          await page.keyboard.press('Tab');
          assert(await page.locator('#after').evaluate(el => el === document.activeElement));
          await page.locator('#before').click();
          for (let i = 0; i < 2; i++) {
            const bounds = await calls.nth(i).boundingBox();
            await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
            const hint = page.locator('[data-call-availability-hint]').nth(i);
            const box = await hint.boundingBox();
            const below = box.y > bounds.y;
            const x = Math.max(bounds.x, box.x) + 5;
            await page.mouse.move(x, below ? bounds.y + bounds.height + 4 : bounds.y - 4);
            await page.waitForTimeout(50);
            assert(await hint.isVisible(), 'hint survives pointer crossing the gap');
            await page.mouse.move(x, below ? box.y + 4 : box.y + box.height - 4);
            await page.waitForTimeout(220);
            assert(await hint.isVisible(), 'entering hint cancels dismissal');
            await hint.locator('a').hover();
            assert(await hint.isVisible());
            await page.mouse.move(width - 1, 800);
            await hint.waitFor({ state: 'hidden', timeout: 2000 });
            assert.equal(await hint.isVisible(), false);
          }
          assert.equal(await page.locator('dialog[open]').count(), 0);
        }
      }
      await page.close();
    }
  } finally { await browser.close(); }
});
