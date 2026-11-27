const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./affiliate-ref.js'), 'utf8')
const API = 'https://fquyhwkttuhxjzfrdhjt.supabase.co/functions/v1/aff-api/'
const DAY = 86400000

/** A cookie jar that honours max-age and records the attributes of each write. */
function cookieJar(now) {
    const jar = new Map()
    const writes = []
    return {
        writes,
        jar,
        get cookie() {
            return [...jar.entries()]
                .filter(([, c]) => c.expiresAt > now())
                .map(([name, c]) => `${name}=${c.value}`)
                .join('; ')
        },
        set cookie(text) {
            const [pair, ...attrs] = text.split(';').map((s) => s.trim())
            const eq = pair.indexOf('=')
            const name = pair.slice(0, eq)
            const value = pair.slice(eq + 1)
            const attributes = {}
            for (const a of attrs) {
                const [k, v] = a.split('=')
                attributes[k.toLowerCase()] = v === undefined ? true : v
            }
            writes.push({ name, value, attributes })
            const maxAge = Number(attributes['max-age'])
            if (maxAge <= 0) jar.delete(name)
            else jar.set(name, { value, expiresAt: now() + maxAge * 1000 })
        },
    }
}

function storedAffiliate(env) {
    const c = env.cookies.jar.get('ts_aff')
    return c && c.expiresAt > env.now() ? JSON.parse(decodeURIComponent(c.value)) : null
}

/**
 * Boots affiliate-ref.js in a sandbox.
 * replies: { click?: object | Error | number, lead?: object | Error | number } — an object is
 * a 200 JSON reply, a number a bare status, an Error a network failure.
 */
function boot(opts = {}) {
    let clock = opts.now ?? Date.parse('2026-11-27T12:00:00Z')
    const now = () => clock
    const url = new URL(opts.url ?? 'https://www.thestarters.com/')
    const cookies = cookieJar(now)
    if (opts.affiliate) {
        cookies.jar.set('ts_aff', { value: encodeURIComponent(JSON.stringify(opts.affiliate)), expiresAt: clock + 365 * DAY })
    }
    const requests = []
    const updates = []
    const logs = []
    const storage = new Map(Object.entries(opts.storage ?? {}))
    let authListener = null
    let member = opts.member ?? null
    const replies = { click: { ok: true, known: true, counted: true, cookie_days: 60, attribution: 'first_touch' }, lead: { ok: true, bound: true }, ...opts.replies }

    const fetch = async (target, init) => {
        const route = target.slice(API.length)
        requests.push({ route, body: JSON.parse(init.body), init })
        const reply = replies[route]
        if (reply instanceof Error) throw reply
        if (typeof reply === 'number') return { ok: reply < 300, status: reply, json: async () => ({}) }
        return { ok: true, status: 200, json: async () => reply }
    }

    const memberstack = opts.noMemberstack
        ? undefined
        : {
              getCurrentMember: async () => ({ data: member }),
              onAuthChange: (cb) => {
                  authListener = cb
              },
              getMemberCookie: async () => 'ms-member-token',
              updateMember: async (payload) => {
                  updates.push(payload)
                  return { data: member }
              },
          }

    class FakeDate extends Date {
        constructor(...args) {
            super(...(args.length ? args : [clock]))
        }
        static now() {
            return clock
        }
    }

    const window = {
        location: { hostname: url.hostname, protocol: url.protocol, search: url.search, pathname: url.pathname },
        fetch,
        $memberstackDom: memberstack,
        localStorage: {
            getItem: (k) => (storage.has(k) ? storage.get(k) : null),
            setItem: (k, v) => storage.set(k, String(v)),
        },
        crypto: { randomUUID: () => '7f0c2b0e-3a51-4c1e-9a43-8b5d1f2e6a10' },
        STARTERS_AFFILIATE_PARAMS: opts.params,
    }
    const document = { referrer: opts.referrer ?? '' }
    Object.defineProperty(document, 'cookie', {
        get: () => cookies.cookie,
        set: (v) => {
            cookies.cookie = v
        },
    })
    const context = {
        window,
        document,
        URL,
        URLSearchParams,
        JSON,
        Math,
        Promise,
        Date: FakeDate,
        setTimeout,
        console: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    }
    window.window = window
    vm.runInNewContext(source, context)

    return {
        requests,
        updates,
        logs,
        storage,
        cookies,
        now,
        advance: (ms) => {
            clock += ms
        },
        signIn(m) {
            member = m
            authListener && authListener({ data: m })
        },
        window,
        rerun: () => vm.runInNewContext(source, context),
    }
}

const settle = async () => {
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r))
}

test('stores ?via= as a first-party cookie on the site domain and records the click', async () => {
    const env = boot({
        url: 'https://www.thestarters.com/hire?via=Jane&utm_source=ig',
        referrer: 'https://l.instagram.com/x',
        replies: { click: { ok: true, known: true, counted: true, cookie_days: 90, attribution: 'first_touch' } },
    })
    await settle()
    assert.deepEqual(storedAffiliate(env), { t: 'jane', v: '7f0c2b0e-3a51-4c1e-9a43-8b5d1f2e6a10', at: env.now(), d: 90 })
    const last = env.cookies.writes.at(-1)
    assert.equal(last.attributes.domain, '.thestarters.com')
    assert.equal(last.attributes.secure, true)
    assert.equal(last.attributes.samesite, 'Lax')
    assert.equal(Number(last.attributes['max-age']), 90 * 86400)
    assert.equal(env.requests.length, 1)
    assert.equal(env.requests[0].route, 'click')
    assert.deepEqual(env.requests[0].body, {
        token: 'jane',
        visitor_id: '7f0c2b0e-3a51-4c1e-9a43-8b5d1f2e6a10',
        path: '/hire',
        referrer_host: 'l.instagram.com',
        utm: { utm_source: 'ig' },
    })
    assert.equal(env.requests[0].init.keepalive, true)
    assert.equal(env.requests[0].init.headers['content-type'], 'text/plain;charset=UTF-8')
})

test('keeps the first affiliate under a first-touch campaign but still records the new click', async () => {
    const first = { t: 'jane', v: 'visitor-abcdef12', at: Date.parse('2026-11-20T00:00:00Z'), d: 60 }
    const env = boot({ url: 'https://www.thestarters.com/?via=bob', affiliate: first })
    await settle()
    assert.equal(storedAffiliate(env).t, 'jane')
    assert.equal(env.requests[0].body.token, 'bob')
    assert.equal(env.requests[0].body.visitor_id, 'visitor-abcdef12')
})

test('switches to the new affiliate when the campaign is last touch', async () => {
    const first = { t: 'jane', v: 'visitor-abcdef12', at: Date.parse('2026-11-20T00:00:00Z'), d: 60 }
    const env = boot({
        url: 'https://www.thestarters.com/?via=bob',
        affiliate: first,
        replies: { click: { ok: true, known: true, counted: true, cookie_days: 30, attribution: 'last_touch' } },
    })
    await settle()
    assert.deepEqual(storedAffiliate(env), { t: 'bob', v: 'visitor-abcdef12', at: env.now(), d: 30 })
})

test('drops the cookie when the server does not know the token', async () => {
    const env = boot({ url: 'https://www.thestarters.com/?via=nobody', replies: { click: { ok: true, known: false } } })
    await settle()
    assert.equal(storedAffiliate(env), null)
})

test('treats an expired cookie as absent', async () => {
    const old = { t: 'jane', v: 'visitor-abcdef12', at: Date.parse('2026-08-01T00:00:00Z'), d: 60 }
    const env = boot({ url: 'https://www.thestarters.com/?via=bob', affiliate: old })
    await settle()
    assert.equal(storedAffiliate(env).t, 'bob')
})

test('reads ?ref= and legacy parameter names, and ignores malformed tokens', async () => {
    const ref = boot({ url: 'https://thestarters.com/?ref=Mia' })
    await settle()
    assert.equal(storedAffiliate(ref).t, 'mia')

    const legacy = boot({ url: 'https://www.thestarters.com/?partner=Kim', params: ['partner'] })
    await settle()
    assert.equal(storedAffiliate(legacy).t, 'kim')

    const bad = boot({ url: 'https://www.thestarters.com/?via=bad%20token!' })
    await settle()
    assert.equal(storedAffiliate(bad), null)
    assert.equal(bad.requests.length, 0)
})

test('binds the member at signup and writes the affiliate-ref field once', async () => {
    const aff = { t: 'jane', v: 'visitor-abcdef12', at: Date.parse('2026-11-26T00:00:00Z'), d: 60 }
    const env = boot({ affiliate: aff })
    await settle()
    assert.equal(env.requests.length, 0)

    env.signIn({ id: 'mem_new1', customFields: {} })
    await settle()
    assert.deepEqual(
        env.requests.map((r) => [r.route, r.body]),
        [['lead', { token: 'jane', visitor_id: 'visitor-abcdef12', member_token: 'ms-member-token' }]],
    )
    assert.deepEqual(JSON.parse(JSON.stringify(env.updates)), [{ customFields: { 'affiliate-ref': 'jane' } }])
    assert.equal(env.storage.get('startersAffiliateBoundV1'), 'mem_new1:jane')
})

test('binds a logged-in member on load, but not one who already has the field or was already sent', async () => {
    const aff = { t: 'jane', v: 'visitor-abcdef12', at: Date.parse('2026-11-26T00:00:00Z'), d: 60 }

    const fresh = boot({ affiliate: aff, member: { id: 'mem_old1', customFields: {} } })
    await settle()
    assert.equal(fresh.requests.filter((r) => r.route === 'lead').length, 1)

    const hasField = boot({ affiliate: aff, member: { id: 'mem_old2', customFields: { 'affiliate-ref': 'bob' } } })
    await settle()
    assert.equal(hasField.requests.length, 0)

    const sent = boot({ affiliate: aff, member: { id: 'mem_old3', customFields: {} }, storage: { startersAffiliateBoundV1: 'mem_old3:jane' } })
    await settle()
    assert.equal(sent.requests.length, 0)
})

test('does not write the field when the server does not bind', async () => {
    const aff = { t: 'jane', v: 'visitor-abcdef12', at: Date.parse('2026-11-26T00:00:00Z'), d: 60 }
    const env = boot({ affiliate: aff, member: { id: 'mem_paying', customFields: {} }, replies: { lead: { ok: true, bound: false, reason: 'existing_customer' } } })
    await settle()
    assert.equal(env.updates.length, 0)
    assert.equal(env.storage.get('startersAffiliateBoundV1'), 'mem_paying:jane')
})

test('never throws or blocks signup when the endpoints fail', async () => {
    const aff = { t: 'jane', v: 'visitor-abcdef12', at: Date.parse('2026-11-26T00:00:00Z'), d: 60 }
    const env = boot({ url: 'https://www.thestarters.com/?via=jane', affiliate: aff, replies: { click: new Error('offline'), lead: new Error('offline') } })
    await settle()
    env.signIn({ id: 'mem_x', customFields: {} })
    await settle()
    assert.equal(env.updates.length, 0)
    assert.equal(storedAffiliate(env).t, 'jane')
    const down = boot({ url: 'https://www.thestarters.com/?via=jane', replies: { click: 503 } })
    await settle()
    assert.equal(storedAffiliate(down).t, 'jane')
})

test('logs on staging hosts only', async () => {
    const prod = boot({ url: 'https://www.thestarters.com/?via=nobody', replies: { click: { ok: true, known: false } } })
    await settle()
    assert.deepEqual(prod.logs, [])
    const staging = boot({ url: 'https://the-starters-3-0.webflow.io/?via=nobody', replies: { click: { ok: true, known: false } } })
    await settle()
    assert.ok(staging.logs.some((m) => m.includes('[starters affiliate] unknown token nobody')))
    const last = staging.cookies.writes.at(-1)
    assert.equal(last.attributes.domain, undefined, 'staging cookies are host-only')
})

test('boots once per page', async () => {
    const env = boot({ url: 'https://www.thestarters.com/?via=jane' })
    env.rerun()
    await settle()
    assert.equal(env.requests.length, 1)
})

test('works without Memberstack on the page', async () => {
    const env = boot({ url: 'https://www.thestarters.com/?via=jane', noMemberstack: true })
    await settle()
    assert.equal(storedAffiliate(env).t, 'jane')
    // The sandbox clock is frozen, so end the Memberstack wait by letting it appear late.
    env.window.$memberstackDom = { getCurrentMember: async () => ({ data: null }) }
    await new Promise((r) => setTimeout(r, 150))
    await settle()
    assert.equal(env.requests.length, 1)
})

test('carries no secrets and pins its release in the header', () => {
    for (const forbidden of [/sb_secret/i, /service_role/i, /airtable/i, /hooks\.slack/i, /sk_live|sk_test/i, /apikey/i]) {
        assert.equal(forbidden.test(source), false, `found ${forbidden}`)
    }
    const header = source.slice(0, source.indexOf('*/'))
    const release = /var RELEASE = '([^']+)'/.exec(source)[1]
    assert.ok(header.includes(`@release ${release}`))
})
