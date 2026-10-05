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

function markup() {
  return `<!doctype html>
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
}

;(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const claimRequests = []

  try {
    await page.route('https://www.thestarters.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: markup() }),
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

    console.log(JSON.stringify({ ready, submits, unlisted, claimRequests }))
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
