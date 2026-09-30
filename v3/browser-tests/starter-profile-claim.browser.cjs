// Focused rendered acceptance. This uses a local slug allowlist and does not
// prove Webflow publication or Memberstack webhook behavior.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '../..')
const scriptPath = path.join(root, 'v3/starter-profile-claim.js')
const controllerUrl = 'https://cdn.example/starter-profile-claim.js'
const source = fs.readFileSync(scriptPath, 'utf8')

function markup() {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <script>window.STARTER_PROFILE_CLAIM_SLUGS = ["jane-doe"]</script>
        <script src="${controllerUrl}"></script>
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
          data-starter-claim="wrapper">
          <form data-starter-claim="form" data-ms-form="signup">
            <h1>Claim your profile</h1>
            <input type="email" data-ms-member="email">
            <input type="hidden" data-ms-member="starter-claim-profile-slug" autocomplete="off">
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
  const remoteRequests = []

  try {
    await page.route('https://www.thestarters.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: markup() }),
    )
    await page.route(controllerUrl, (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: source }),
    )
    page.on('request', (request) => {
      if (!request.url().startsWith('https://www.thestarters.com/') && request.url() !== controllerUrl) {
        remoteRequests.push(request.url())
      }
    })

    await page.goto('https://www.thestarters.com/hire/jane-doe?utm_source=gift')
    await page.waitForSelector('[data-starter-claim-state="ready"]')

    const ready = await page.locator('[data-starter-claim="wrapper"]').evaluate((wrapper) => ({
      ariaHidden: wrapper.getAttribute('aria-hidden'),
      display: getComputedStyle(wrapper).display,
      hasHide: wrapper.classList.contains('hide'),
      hidden: wrapper.hidden,
      profileSlug: wrapper.querySelector('[data-ms-member="starter-claim-profile-slug"]').value,
      googleHidden: wrapper.querySelector('[data-ms-auth-provider="google"]').hidden,
      url: location.href,
    }))

    assert.deepEqual(ready, {
      ariaHidden: 'false',
      display: 'grid',
      hasHide: false,
      hidden: false,
      profileSlug: 'jane-doe',
      googleHidden: true,
      url: 'https://www.thestarters.com/hire/jane-doe?utm_source=gift',
    })
    assert.deepEqual(remoteRequests, [])

    await page.goto('https://www.thestarters.com/hire/john-smith?utm_source=gift')
    await page.waitForSelector('[data-starter-claim-state="closed"]', { state: 'attached' })
    const unlisted = await page.locator('[data-starter-claim="wrapper"]').evaluate((wrapper) => ({
      ariaHidden: wrapper.getAttribute('aria-hidden'),
      display: getComputedStyle(wrapper).display,
      hasHide: wrapper.classList.contains('hide'),
      hidden: wrapper.hidden,
      profileSlug: wrapper.querySelector('[data-ms-member="starter-claim-profile-slug"]').value,
      state: wrapper.getAttribute('data-starter-claim-state'),
    }))

    assert.deepEqual(unlisted, {
      ariaHidden: 'true',
      display: 'none',
      hasHide: true,
      hidden: true,
      profileSlug: '',
      state: 'closed',
    })
    assert.deepEqual(remoteRequests, [])

    console.log(JSON.stringify({ ready, unlisted, remoteRequests }))
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
