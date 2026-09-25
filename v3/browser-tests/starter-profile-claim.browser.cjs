// Focused rendered acceptance: node v3/browser-tests/starter-profile-claim.browser.cjs
// Synthetic Xano boundary; this does not prove Webflow publication or Memberstack webhook behavior.
const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '../..')
const scriptPath = path.join(root, 'v3/starter-profile-claim.js')
const token = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789_-A'
const exchangeCode = 'zyxwvutsrqponmlkjihgfedcba9876543210_-ZYXWV'
const prepareUrl =
  'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starter_profile_claim/prepare'
const controllerUrl = 'https://cdn.example/starter-profile-claim.js'

function markup() {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <script src="${controllerUrl}"></script>
        <script>window.__postHogObservedUrl = location.href</script>
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
          data-starter-claim-prepare-url="${prepareUrl}">
          <form data-starter-claim="form" data-ms-form="signup">
            <h1>Claim your profile</h1>
            <input type="email" data-ms-member="email">
            <input type="hidden" data-ms-member="starter-claim-exchange" autocomplete="off">
            <button type="submit">Claim profile</button>
            <button type="button" data-ms-auth-provider="google">Continue with Google</button>
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
  const prepareRequests = []
  const requestPageUrls = []
  let failPrepare = false

  try {
    await page.route('https://www.thestarters.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: markup() }),
    )
    await page.route(controllerUrl, (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', path: scriptPath }),
    )
    await page.route(prepareUrl, async (route) => {
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
      prepareRequests.push(request.postDataJSON())
      requestPageUrls.push(page.url())
      if (failPrepare) {
        await route.abort('failed')
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          valid: true,
          status: 'active',
          profile_path: '/hire/jane-doe',
          exchange_code: exchangeCode,
        }),
      })
    })

    await page.goto(`https://www.thestarters.com/hire/jane-doe?claim=${token}&utm_source=gift`)
    await page.waitForSelector('[data-starter-claim-state="ready"]')

    const ready = await page.locator('[data-starter-claim="wrapper"]').evaluate((wrapper) => ({
      ariaHidden: wrapper.getAttribute('aria-hidden'),
      display: getComputedStyle(wrapper).display,
      hasHide: wrapper.classList.contains('hide'),
      hidden: wrapper.hidden,
      exchangeCode: wrapper.querySelector('[data-ms-member="starter-claim-exchange"]').value,
      postHogObservedUrl: window.__postHogObservedUrl,
      googleHidden: wrapper.querySelector('[data-ms-auth-provider="google"]').hidden,
      googleAriaHidden: wrapper.querySelector('[data-ms-auth-provider="google"]').getAttribute('aria-hidden'),
      url: location.href,
    }))

    assert.deepEqual(prepareRequests, [{ token, profile_path: '/hire/jane-doe' }])
    assert.deepEqual(requestPageUrls, [
      'https://www.thestarters.com/hire/jane-doe?utm_source=gift',
    ])
    assert.deepEqual(ready, {
      ariaHidden: 'false',
      display: 'grid',
      hasHide: false,
      hidden: false,
      exchangeCode,
      googleAriaHidden: 'true',
      googleHidden: true,
      postHogObservedUrl: 'https://www.thestarters.com/hire/jane-doe?utm_source=gift',
      url: 'https://www.thestarters.com/hire/jane-doe?utm_source=gift',
    })

    failPrepare = true
    await page.goto(`https://www.thestarters.com/hire/jane-doe?claim=${token}&utm_source=retry#bio`)
    await page.waitForSelector('[data-starter-claim-state="unavailable"]', { state: 'attached' })

    const failed = await page.locator('[data-starter-claim="wrapper"]').evaluate((wrapper) => ({
      exchangeCode: wrapper.querySelector('[data-ms-member="starter-claim-exchange"]').value,
      hasHide: wrapper.classList.contains('hide'),
      hidden: wrapper.hidden,
      postHogObservedUrl: window.__postHogObservedUrl,
      url: location.href,
    }))

    assert.deepEqual(failed, {
      exchangeCode: '',
      hasHide: true,
      hidden: true,
      postHogObservedUrl: 'https://www.thestarters.com/hire/jane-doe?utm_source=retry#bio',
      url: 'https://www.thestarters.com/hire/jane-doe?utm_source=retry#bio',
    })
    assert.deepEqual(requestPageUrls, [
      'https://www.thestarters.com/hire/jane-doe?utm_source=gift',
      'https://www.thestarters.com/hire/jane-doe?utm_source=retry#bio',
    ])

    failPrepare = false
    await page.goto(`https://www.thestarters.com/hire/jane-doe/?claim=${token}&utm_source=slash`)
    await page.waitForSelector('[data-starter-claim-state="misconfigured"]', {
      state: 'attached',
    })

    const nonCanonical = await page.locator('[data-starter-claim="wrapper"]').evaluate((wrapper) => ({
      hasHide: wrapper.classList.contains('hide'),
      hidden: wrapper.hidden,
      postHogObservedUrl: window.__postHogObservedUrl,
      state: wrapper.getAttribute('data-starter-claim-state'),
      url: location.href,
    }))

    assert.equal(prepareRequests.length, 2)
    assert.deepEqual(nonCanonical, {
      hasHide: true,
      hidden: true,
      postHogObservedUrl: 'https://www.thestarters.com/hire/jane-doe/?utm_source=slash',
      state: 'misconfigured',
      url: 'https://www.thestarters.com/hire/jane-doe/?utm_source=slash',
    })

    await page.goto('https://www.thestarters.com/hire/jane-doe?utm_source=gift')

    const closed = await page.locator('[data-starter-claim="wrapper"]').evaluate((wrapper) => ({
      ariaHidden: wrapper.getAttribute('aria-hidden'),
      display: getComputedStyle(wrapper).display,
      hasHide: wrapper.classList.contains('hide'),
      hidden: wrapper.hidden,
      state: wrapper.getAttribute('data-starter-claim-state'),
    }))

    assert.equal(prepareRequests.length, 2, 'a normal Hire view must not call prepare')
    assert.deepEqual(closed, {
      ariaHidden: 'true',
      display: 'none',
      hasHide: true,
      hidden: true,
      state: 'closed',
    })

    console.log(JSON.stringify({
      ready,
      failed,
      nonCanonical,
      closed,
      prepareRequests,
      requestPageUrls,
    }))
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
