// Focused rendered acceptance. This mocks Xano claim-status and does not prove
// Webflow publication or Webflow form notification behavior.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '../..')
const scriptPath = path.join(root, 'v3/starter-profile-claim.js')
const controllerUrl = 'https://cdn.example/starter-profile-claim.js'
const claimStatusUrl =
  'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/profile/starter/claim-status/v3'
const source = fs.readFileSync(scriptPath, 'utf8')

function markup(interaction = false) {
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <script src="${controllerUrl}" defer></script>
        <style>
          body { margin: 0; font-family: sans-serif; }
          .hide { display: none !important; }
          .button.is-google { display: inline-flex; }
          .claim-modal { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.65); }
          form { width: 22rem; padding: 2rem; background: white; }
        </style>
      </head>
      <body>
        <main>Starter profile</main>
        <section class="claim-modal hide" hidden aria-hidden="true"
          data-starter-claim="wrapper">
          <form data-starter-claim="form">
            <h1>Claim your profile</h1>
            <input type="email" name="Email Address" required>
            <input type="hidden" name="Profile Slug" data-starter-claim="profile-slug" autocomplete="off">
            <div class="button_main-wrap">
              <p class="button_main-text">Claim profile</p>
              <div class="clickable_wrap"><button type="button" class="clickable_btn">Claim profile</button></div>
            </div>
            <input type="submit" class="hide" value="Submit">
            <a href="#" class="button is-google w-button" data-ms-auth-provider="google">Continue with Google</a>
          </form>
        </section>
      </body>
    </html>`
  if (!interaction) return html
  return html.replace('</style>', `
    .claim-modal { inset: auto 0 0; display: flex; background: none; }
    [data-button-theme="white"][data-button-style="primary"] { background:#fff;border-color:#fff; }
    [data-wf--background--variant] { position:absolute;inset:0;background: linear-gradient(100deg,#d2e0da,#91acb1); }
    [data-starter-claim="content"] { padding: 48px 20px; }
    form { background: none; width: min(100%,500px); padding: 0; margin: auto; }
    [data-starter-claim="close"] { position:absolute;right:20px;top:8px;border:0;background:none; }
    input[type="email"] { width:100%;box-sizing:border-box; }
  </style>`).replace('<form data-starter-claim="form">', '<div data-starter-claim="panel"><div data-starter-claim="mask"><div data-wf--background--variant="gradient"></div><div data-starter-claim="content"><form data-starter-claim="form">')
    .replace('</form>', `</form>
      <div data-starter-claim="success" style="display:none" tabindex="-1">Almost there.</div>
      <div data-starter-claim="error" style="display:none">Please try again.</div>
      </div>
      </div>
      <button type="button" data-starter-claim="toggle" hidden><div data-starter-claim="visual" data-button-theme="white" data-button-style="primary"><span data-starter-claim="toggle-label">View Less</span><span data-starter-claim="chevron" aria-hidden="true"></span></div></button>
      <button type="button" data-starter-claim="close">X</button>
      </div>
      <div data-starter-claim="compact" class="hide" hidden><span data-starter-claim="compact-label">Claim Your Profile</span></div>`)

}

;(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const claimRequests = []
  let interaction = false

  try {
    await page.route('https://www.thestarters.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: markup(interaction) }),
    )
    await page.route(controllerUrl, (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: source }),
    )
    await page.route(`${claimStatusUrl}**`, (route) => {
      const url = new URL(route.request().url())
      const slug = url.searchParams.get('slug')
      claimRequests.push(route.request().url())
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema: 'starter_profile_claim_status_v3',
          slug,
          claimable: slug === 'jane-doe',
        }),
      })
    })
    const listedUrl = 'https://www.thestarters.com/hire/jane-doe?claim=unused&first=1&utm_source=qr'
    await page.goto(listedUrl)
    await page.waitForSelector('[data-starter-claim="wrapper"]', { state: 'visible' })

    const ready = await page.locator('[data-starter-claim="wrapper"]').evaluate((wrapper) => {
      const google = wrapper.querySelector('[data-ms-auth-provider="google"]')
      return {
        ariaHidden: wrapper.getAttribute('aria-hidden'),
        display: getComputedStyle(wrapper).display,
        hasHide: wrapper.classList.contains('hide'),
        hidden: wrapper.hidden,
        profileSlug: wrapper.querySelector('[data-starter-claim="profile-slug"]').value,
        googleDisplay: getComputedStyle(google).display,
        googleHasHide: google.classList.contains('hide'),
        googleHidden: google.hidden,
        controllerExported: Object.prototype.hasOwnProperty.call(window, 'StarterProfileClaim'),
        url: location.href,
      }
    })

    assert.deepEqual(ready, {
      ariaHidden: 'false',
      display: 'grid',
      hasHide: false,
      hidden: false,
      profileSlug: 'jane-doe',
      googleDisplay: 'none',
      googleHasHide: true,
      googleHidden: true,
      controllerExported: false,
      url: listedUrl,
    })
    assert.deepEqual(claimRequests, [`${claimStatusUrl}?slug=jane-doe`])

    // The Webflow Button component renders type="button"; its click must
    // become one native submit, and native validation must still block an
    // empty email.
    await page.evaluate(() => {
      window.__claimSubmits = []
      document.querySelector('[data-starter-claim="form"]').addEventListener('submit', (event) => {
        event.preventDefault()
        window.__claimSubmits.push(new FormData(event.target).get('Profile Slug'))
      })
    })
    await page.click('.clickable_btn')
    const blockedSubmits = await page.evaluate(() => window.__claimSubmits.length)
    assert.equal(blockedSubmits, 0)
    await page.fill('input[name="Email Address"]', 'claimant@example.test')
    await page.click('.clickable_btn')
    const submits = await page.evaluate(() => window.__claimSubmits)
    assert.deepEqual(submits, ['jane-doe'])

    const unlistedUrl = 'https://www.thestarters.com/hire/john-smith?claim=unused&utm_source=qr'
    await page.goto(unlistedUrl)
    await page.waitForFunction(() =>
      document.querySelector('[data-ms-auth-provider="google"]')?.classList.contains('hide'),
    )
    const unlisted = await page.locator('[data-starter-claim="wrapper"]').evaluate((wrapper) => ({
      ariaHidden: wrapper.getAttribute('aria-hidden'),
      display: getComputedStyle(wrapper).display,
      hasHide: wrapper.classList.contains('hide'),
      hidden: wrapper.hidden,
      profileSlug: wrapper.querySelector('[data-starter-claim="profile-slug"]').value,
      url: location.href,
    }))

    assert.deepEqual(unlisted, {
      ariaHidden: 'true',
      display: 'none',
      hasHide: true,
      hidden: true,
      profileSlug: '',
      url: unlistedUrl,
    })
    assert.deepEqual(claimRequests, [
      `${claimStatusUrl}?slug=jane-doe`,
      `${claimStatusUrl}?slug=john-smith`,
    ])


    interaction = true
    await page.goto('https://www.thestarters.com/hire/jane-doe')
    const wrapper = page.locator('[data-starter-claim="wrapper"]')
    const state = () => wrapper.getAttribute('data-starter-claim-state')
    await page.waitForSelector('[data-starter-claim-state="expanded"]')
    const email = page.locator('input[type="email"]')
    const toggle = page.locator('[data-starter-claim="toggle"]')
    const collapse = toggle
    const expand = toggle
    await toggle.evaluate(node => { window.__claimToggle = node })
    await email.fill('draft@example.test')
    const initialContentY = await page.locator('[data-starter-claim="content"]').evaluate(node => node.getBoundingClientRect().y)
    await page.evaluate(() => {
      window.__claimMotionSamples = []
      const content = document.querySelector('[data-starter-claim="content"]')
      let frames = 0
      function sample() {
        window.__claimMotionSamples.push(content.getBoundingClientRect().y)
        if (++frames < 28) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await collapse.click()
    assert.equal(await state(), 'collapsed')
    assert.equal(await page.locator('[data-starter-claim="content"]').evaluate(node => node.inert), true)
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-starter-claim="compact-label"]')).filter === 'blur(0px)')
    const samples = await page.evaluate(() => window.__claimMotionSamples)
    assert.ok(samples.length > 8)
    assert.ok(samples.every(y => Math.abs(y - initialContentY) < 0.2), JSON.stringify(samples))
    const compactBox = await page.locator('[data-starter-claim="compact"]').boundingBox()
    const toggleBox = await toggle.boundingBox()
    const panelBox = await page.locator('[data-starter-claim="panel"]').boundingBox()
    assert.equal(compactBox.height, 88)
    assert.ok(Math.abs(panelBox.y - compactBox.y) < 0.2)
    assert.ok(Math.abs(toggleBox.y + toggleBox.height / 2 - panelBox.y) < 0.2)
    assert.ok(Math.abs(toggleBox.x + toggleBox.width / 2 - 195) < 0.2)
    assert.equal(await toggle.textContent(), 'View More')
    assert.equal(await toggle.evaluate(node => node === window.__claimToggle), true)
    const visual = page.locator('[data-starter-claim="visual"]')
    await page.mouse.move(5, 5)
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-starter-claim="visual"]')).backgroundColor === 'rgb(238, 238, 238)')
    assert.equal((await visual.boundingBox()).height, 32)
    await toggle.hover()
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-starter-claim="visual"]')).backgroundColor === 'rgb(239, 251, 168)')
    const labelBox = await page.locator('[data-starter-claim="compact-label"]').boundingBox()
    assert.ok(Math.abs(labelBox.y - (toggleBox.y + 38) - 24) < 0.2)
    assert.ok(Math.abs(844 - labelBox.y - labelBox.height - 24) < 0.2)
    await expand.click()
    assert.equal(await state(), 'expanded')
    assert.equal(await email.inputValue(), 'draft@example.test')
    await collapse.press('Enter')
    assert.equal(await wrapper.getAttribute('data-starter-claim-motion'), 'instant')
    await expand.press('Enter')
    await page.evaluate(() => {
      window.__claimSubmits = []
      document.querySelector('[data-starter-claim="form"]').addEventListener('submit', event => {
        event.preventDefault()
        window.__claimSubmits.push(new FormData(event.target).get('Profile Slug'))
      })
    })
    await email.fill('invalid')
    await page.locator('.clickable_btn').click()
    assert.equal(await page.evaluate(() => window.__claimSubmits.length), 0)
    await email.fill('claimant@example.test')
    await page.locator('.clickable_btn').click()
    assert.deepEqual(await page.evaluate(() => window.__claimSubmits), ['jane-doe'])
    await collapse.click()
    await page.evaluate(() => {
      document.querySelector('[data-starter-claim="form"]').style.display = 'none'
      document.querySelector('[data-starter-claim="success"]').style.display = 'block'
    })
    await page.waitForSelector('[data-starter-claim-state="success"]')
    await page.getByRole('button', { name: 'Close claim confirmation' }).click()
    await page.waitForFunction(() => document.querySelector('[data-starter-claim="wrapper"]').hidden)
    assert.equal(await state(), 'dismissed')
    await page.goto('https://www.thestarters.com/hire/jane-doe')
    await page.waitForSelector('[data-starter-claim-state="expanded"]')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await collapse.click()
    assert.equal(await page.locator('[data-starter-claim="panel"]').evaluate(node => getComputedStyle(node).transitionDuration), '0s')
    await page.locator('[data-starter-claim="compact"]').evaluate(node => { node.style.minHeight = '110px' })
    await page.waitForFunction(() => Math.abs(document.querySelector('[data-starter-claim="panel"]').getBoundingClientRect().y - document.querySelector('[data-starter-claim="compact"]').getBoundingClientRect().y) < 0.1)
    await page.locator('[data-starter-claim="compact"]').evaluate(node => { node.style.minHeight = '' })
    await page.waitForFunction(() => Math.abs(document.querySelector('[data-starter-claim="panel"]').getBoundingClientRect().y - document.querySelector('[data-starter-claim="compact"]').getBoundingClientRect().y) < 0.1)
    await expand.click()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    for (const viewport of [{ width: 320, height: 568 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport)
      await collapse.click()
      await page.waitForFunction(() => Math.abs(document.querySelector('[data-starter-claim="panel"]').getBoundingClientRect().y - document.querySelector('[data-starter-claim="compact"]').getBoundingClientRect().y) < 0.1)
      const box = await toggle.boundingBox()
      assert.ok(Math.abs(box.x + box.width / 2 - viewport.width / 2) < 0.1)
      assert.equal((await page.locator('[data-starter-claim="compact"]').boundingBox()).height, 88)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await expand.click()
    }
    console.log(JSON.stringify({ ready, submits, unlisted, claimRequests, interaction: 'collapse/reopen/email retention/native validation/success dismissal/reload/reduced motion/mobile and desktop passed' }))
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
