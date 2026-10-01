// Run with Playwright on NODE_PATH and QUIZ_EVIDENCE_DIR pointing to test evidence.
// Uses published markup and local controllers; all remote mutations are blocked.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')
const evidence = process.env.QUIZ_EVIDENCE_DIR
assert.ok(evidence, 'QUIZ_EVIDENCE_DIR is required')
const root = path.resolve(__dirname, '..')
const categories = [{ id: 'operations-supply-chain', label: 'Operations & Supply Chain' }]
const subcategories = [{ id: 'demand-planning', label: 'Demand Planning', categoryId: 'operations-supply-chain' }]

async function scenario(browser, mode) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' })
    const report = { mode, substitutions: [], navigations: [], writes: [], blockedRequests: [], errors: [] }
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    await context.route('**/*', async route => {
        const request = route.request()
        const url = new URL(request.url())
        if (url.pathname.startsWith('/__quiz-test/')) {
            report.writes.push({ method: url.pathname.split('/').pop(), payload: request.postDataJSON() })
            return route.fulfill({ json: { data: request.postDataJSON() } })
        }
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
            report.blockedRequests.push({ method: request.method(), url: request.url() })
            return route.abort('blockedbyclient')
        }
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) report.navigations.push(url.pathname)
        if (url.hostname === 'static.memberstack.com' && url.pathname.endsWith('/memberstack.js')) {
            return route.fulfill({ contentType: 'application/javascript', body: '/* Memberstack API is supplied by the isolated test. */' })
        }
        const name = url.pathname.split('/').pop()
        if ((url.pathname.includes('/quiz-main/') && ['quiz-main.js', 'quiz-tabs.js'].includes(name)) || name === 'quiz-results.js') {
            report.substitutions.push(name)
            return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(root, name === 'quiz-results.js' ? name : 'quiz-main/' + name), 'utf8') })
        }
        return route.continue()
    })
    await context.addInitScript(({ mode }) => {
        const member = { id: 'mem_quiz_browser_test', customFields: { 'signup-source': '/previous' }, planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }] }
        const storedJson = { unrelated: { preserved: true }, starterQuiz: {
            status: 'ready', categoryIds: ['paid-media', 'operations-supply-chain'], subcategoryIds: ['paid-social', 'fulfillment-logistics'],
            categories: [{ id: 'paid-media', label: 'Paid Media' }, { id: 'operations-supply-chain', label: 'Operations & Supply Chain' }],
            subcategories: [{ id: 'paid-social', label: 'Paid Social', categoryId: 'paid-media' }, { id: 'fulfillment-logistics', label: 'Fulfillment & Logistics', categoryId: 'operations-supply-chain' }],
        } }
        let release
        const delayedMember = new Promise(resolve => { release = resolve })
        window.__releaseQuizMember = () => release({ data: member })
        const save = (method, payload) => fetch('/__quiz-test/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(response => response.json())
        window.$memberstackDom = {
            getCurrentMember: () => location.pathname === '/quiz' && mode !== 'authenticated' ? delayedMember : Promise.resolve({ data: member }),
            getMemberJSON: async () => ({ data: storedJson }),
            updateMemberJSON: payload => save('updateMemberJSON', payload),
            updateMember: payload => save('updateMember', payload),
            onAuthChange: () => () => {},
            getMemberCookie: () => null,
        }
        const nativeSet = Storage.prototype.setItem
        Storage.prototype.setItem = function (key, value) {
            if (this === sessionStorage && key === 'starterQuizPending' && location.pathname === '/quiz') {
                const payload = JSON.parse(value)
                if (payload.status === 'ready') {
                    const writes = JSON.parse(sessionStorage.getItem('quizTestReadyWrites') || '[]')
                    writes.push(payload)
                    nativeSet.call(sessionStorage, 'quizTestReadyWrites', JSON.stringify(writes))
                }
            }
            return nativeSet.call(this, key, value)
        }
        const observeSignup = () => {
            if (!window.__quizObserveSignup) return
            const signup = document.querySelector('[data-tab-content="signup"]')
            if (signup && signup.getClientRects().length && getComputedStyle(signup).visibility !== 'hidden') {
                nativeSet.call(sessionStorage, 'quizTestSignupVisible', 'true')
            }
        }
        new MutationObserver(observeSignup).observe(document, { subtree: true, attributes: true, childList: true })
        const tick = () => { observeSignup(); requestAnimationFrame(tick) }
        requestAnimationFrame(tick)
    }, { mode })
    try {
        await page.goto('https://www.thestarters.com/quiz?retake=true', { waitUntil: 'domcontentloaded' })
        await page.waitForFunction(() => document.querySelector('input[id="paid-media"]')?.checked && document.querySelector('input[id="fulfillment-logistics"]')?.checked)
        assert.equal(await page.locator('[data-tab-content=ways]').count(), 0)
        const next = page.locator('[data-tab=next] button')
        const label = id => page.locator('label').filter({ has: page.locator('input[id="' + id + '"]') })
        await label('paid-media').click()
        await next.focus()
        await page.keyboard.press('Enter')
        await page.locator('[data-tab-content="operations-supply-chain"]').waitFor({ state: 'visible' })
        await label('fulfillment-logistics').click()
        await page.waitForFunction(() => document.querySelector('[data-tab=next] button')?.disabled, null, { timeout: 2000 })
        assert.equal(await next.isDisabled(), true)
        await label('demand-planning').click()
        await page.screenshot({ path: path.join(evidence, mode + '-latest-answers.png') })
        await page.evaluate(() => { window.__quizObserveSignup = true })
        if (mode === 'authenticated') {
            await next.focus()
            await page.keyboard.press('Space')
        } else {
            await next.dblclick()
            assert.equal(await page.locator('[data-tab-content=signup]').isVisible(), false)
            assert.equal(new URL(page.url()).pathname, '/quiz')
            assert.equal(await page.evaluate(() => sessionStorage.getItem('quizTestReadyWrites')), null)
            await page.screenshot({ path: path.join(evidence, mode + '-pending-membership.png') })
            if (mode === 'delayed') await page.evaluate(() => window.__releaseQuizMember())
        }
        if (mode === 'never') {
            await page.locator('[data-tab-content=signup]').waitFor({ state: 'visible', timeout: 15000 })
            assert.equal(new URL(page.url()).pathname, '/quiz')
            assert.equal(report.writes.length, 0)
            report.redirect = await page.locator('[data-quiz-form=signup]').evaluate(form => ({ redirect: form.getAttribute('redirect'), provider: form.getAttribute('data-ms-redirect') }))
            assert.deepEqual(report.redirect, { redirect: '/quiz-results', provider: '/quiz-results' })
            report.pending = await page.evaluate(() => JSON.parse(sessionStorage.getItem('starterQuizPending')))
            assert.deepEqual(report.pending.categories, categories)
            assert.deepEqual(report.pending.subcategories, subcategories)
            assert.equal(report.pending.status, 'ready')
        } else {
            await page.waitForURL('**/quiz-results', { timeout: 15000, waitUntil: 'domcontentloaded' })
            for (let attempt = 0; attempt < 60 && !report.writes.some(write => write.method === 'updateMember'); attempt++) await page.waitForTimeout(500)
            assert.equal(report.writes.filter(write => write.method === 'updateMemberJSON').length, 1, JSON.stringify(report))
            assert.equal(report.writes.filter(write => write.method === 'updateMember').length, 1)
            assert.deepEqual(report.navigations, ['/quiz', '/quiz-results'])
            report.readyWrites = await page.evaluate(() => JSON.parse(sessionStorage.getItem('quizTestReadyWrites') || '[]'))
            assert.equal(report.readyWrites.length, 1)
            const pending = report.readyWrites[0]
            assert.deepEqual(pending, { categories, subcategories, resultSlug: null, status: 'ready', updatedAt: pending.updatedAt, completedAt: pending.updatedAt })
            assert.ok(Number.isFinite(Date.parse(pending.updatedAt)))
            assert.equal(await page.evaluate(() => sessionStorage.getItem('quizTestSignupVisible')), null)
            const json = report.writes.find(write => write.method === 'updateMemberJSON').payload.json
            assert.deepEqual(json.unrelated, { preserved: true })
            assert.deepEqual(json.starterQuiz.categories, categories)
            assert.deepEqual(json.starterQuiz.subcategories, subcategories)
            assert.deepEqual(json.starterQuiz.categoryIds, categories.map(item => item.id))
            assert.deepEqual(json.starterQuiz.subcategoryIds, subcategories.map(item => item.id))
            assert.equal(json.starterQuiz.status, 'ready')
            assert.equal(json.starterQuiz.updatedAt, pending.updatedAt)
            assert.equal(json.starterQuiz.completedAt, pending.completedAt)
            assert.ok(json.starterQuiz.memberstackSavedAt)
            const eventId = (await context.cookies()).find(cookie => cookie.name === 'event_id')?.value
            assert.ok(eventId, 'Published attribution creates the event_id cookie')
            assert.deepEqual(report.writes.find(write => write.method === 'updateMember').payload, { customFields: { 'event-id': decodeURIComponent(eventId), 'starter-quiz': json.starterQuiz.resultSlug || 'ready' } })
            assert.ok(report.substitutions.includes('quiz-results.js'))
        }
        assert.ok(report.substitutions.includes('quiz-main.js'))
        assert.ok(report.substitutions.includes('quiz-tabs.js'))
        assert.deepEqual(report.errors, [])
        await page.waitForTimeout(700) // Let the published signup panel animation finish.
        await page.screenshot({ path: path.join(evidence, mode + (mode === 'never' ? '-completion.png' : '-results-navigation.png')) })
        report.result = 'pass'
        report.boundary = 'Published DOM with local controllers; simulated Memberstack API; all remote mutations blocked. No real account creation or server persistence verified.'
        console.log(mode + ': passed')
    } catch (error) {
        report.result = 'fail'
        report.failure = error.stack
        await page.screenshot({ path: path.join(evidence, mode + '-failure.png') }).catch(() => {})
        throw error
    } finally {
        fs.writeFileSync(path.join(evidence, mode + '-browser-results.json'), JSON.stringify(report, null, 2))
        await context.close()
    }
}

;(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
    try {
        for (const mode of ['authenticated', 'delayed', 'never']) await scenario(browser, mode)
    } finally {
        await browser.close()
    }
})().catch(error => { console.error(error); process.exitCode = 1 })
