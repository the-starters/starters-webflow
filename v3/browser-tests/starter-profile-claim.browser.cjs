// Focused rendered acceptance: node v3/browser-tests/starter-profile-claim.browser.cjs
// Synthetic Xano boundary; this does not prove Webflow publication or Memberstack webhook behavior.
const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '../..')
const scriptPath = path.join(root, 'v3/starter-profile-claim.js')
const token = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789_-A'
const validationUrl =
  'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starter_profile_claim/validate'

function markup() {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { margin: 0; font-family: sans-serif; }
          .hide { display: none !important; }
          .claim-modal { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.65); }
          form { width: 22rem; padding: 2rem; background: white; }
        </style>
      </head>
      <body>
        <main>Starter profile</main>
        <section class="claim-modal hide" hidden aria-hidden="true"
          data-starter-claim="wrapper"
          data-starter-claim-validate-url="${validationUrl}">
          <form data-starter-claim="form" data-ms-form="signup">
            <h1>Claim your profile</h1>
            <input type="email" data-ms-member="email">
            <input type="hidden" data-ms-member="starter-claim-token" autocomplete="off">
            <button type="submit">Claim profile</button>
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
  const validationRequests = []

  try {
    await page.route('https://www.thestarters.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: markup() }),
    )
    await page.route(validationUrl, async (route) => {
      const request = route.request()
      const corsHeaders = {
        'Access-Control-Allow-Origin': 'https://www.thestarters.com',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }

      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders })
        return
      }

      assert.equal(request.method(), 'POST')
      validationRequests.push(request.postDataJSON())
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          valid: true,
          status: 'active',
          profile_path: '/hire/jane-doe',
        }),
      })
    })

    await page.goto(`https://www.thestarters.com/hire/jane-doe?claim=${token}&utm_source=gift`)
    await page.addScriptTag({ path: scriptPath })
    await page.waitForSelector('[data-starter-claim-state="ready"]')

    const ready = await page.locator('[data-starter-claim="wrapper"]').evaluate((wrapper) => ({
      ariaHidden: wrapper.getAttribute('aria-hidden'),
      display: getComputedStyle(wrapper).display,
      hasHide: wrapper.classList.contains('hide'),
      hidden: wrapper.hidden,
      token: wrapper.querySelector('[data-ms-member="starter-claim-token"]').value,
      url: location.href,
    }))

    assert.deepEqual(validationRequests, [{ token, profile_path: '/hire/jane-doe' }])
    assert.deepEqual(ready, {
      ariaHidden: 'false',
      display: 'grid',
      hasHide: false,
      hidden: false,
      token,
      url: 'https://www.thestarters.com/hire/jane-doe?utm_source=gift',
    })

    await page.goto('https://www.thestarters.com/hire/jane-doe?utm_source=gift')
    await page.addScriptTag({ path: scriptPath })

    const closed = await page.locator('[data-starter-claim="wrapper"]').evaluate((wrapper) => ({
      ariaHidden: wrapper.getAttribute('aria-hidden'),
      display: getComputedStyle(wrapper).display,
      hasHide: wrapper.classList.contains('hide'),
      hidden: wrapper.hidden,
      state: wrapper.getAttribute('data-starter-claim-state'),
    }))

    assert.equal(validationRequests.length, 1, 'a normal Hire view must not call validation')
    assert.deepEqual(closed, {
      ariaHidden: 'true',
      display: 'none',
      hasHide: true,
      hidden: true,
      state: 'closed',
    })

    console.log(JSON.stringify({ ready, closed, validationRequests }))
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
