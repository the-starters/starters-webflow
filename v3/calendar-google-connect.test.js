const assert = require('node:assert/strict')
const test = require('node:test')
const { captureCallback, pageRedirectUri, createGoogleConnect, INTENT_KEY } = require('./calendar-google-connect.js')

const MEMBER = 'mem_onb03'
const PAGE = 'https://www.thestarters.com/starter-onboarding-v2'

function makeWin({ search = '', path = '/starter-onboarding-v2', intent, now = Date.now() } = {}) {
  const storage = new Map()
  if (intent !== undefined) storage.set(INTENT_KEY, JSON.stringify(intent))
  const messages = []
  const replaced = []
  const body = { children: [], appendChild(el) { this.children.push(el) } }
  const win = {
    location: { origin: 'https://www.thestarters.com', pathname: path, search, hash: '' },
    history: { state: null, replaceState(_s, _t, url) { replaced.push(url) } },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    BroadcastChannel: class {
      constructor(name) { this.name = name }
      postMessage(m) { messages.push({ channel: this.name, ...m }) }
      close() {}
    },
    setTimeout: (fn) => { win.timers.push(fn) },
    timers: [],
    closed: false,
    close() { win.closed = true },
    console: { warn() {} },
    document: {
      body,
      documentElement: { attrs: {}, setAttribute(n, v) { this.attrs[n] = v } },
      getElementById: (id) => body.children.find((c) => c.id === id) || null,
      createElement: () => ({ style: {}, setAttribute() {}, textContent: '' }),
    },
  }
  return { win, storage, messages, replaced, body, now }
}

function makeBackend({ starter = { nylas_grant_id: 'v-1', nylas_grant_email: MEMBER, timezone: 'Europe/Amsterdam', availability: { manager: 'platform', items: { general: { days: [1], start: '09:00', end: '12:00' } } } }, fail = {} } = {}) {
  const calls = []
  async function post(path, body) {
    calls.push({ path, body })
    if (fail[path] === true || fail[path] > 0) {
      if (fail[path] !== true) fail[path] -= 1
      throw new Error(path + ' failed')
    }
    if (path === '/grants/oauth/v3') return { response: { result: { data: { url: 'https://api.us.nylas.com/v3/connect/auth?x=1' } } } }
    if (path === '/starter/get_by_memberstack/v3') return starter
    if (path === '/grants/delete/v3') return { connected: false }
    if (path === '/grants/add/v3') return { grant_id: 'g-google' }
    if (path === '/onboarding/calendar/ensure-default/v3') return { manager: 'calendar' }
    throw new Error('unexpected ' + path)
  }
  return { post, calls, paths: () => calls.map((c) => c.path) }
}

const memberId = () => Promise.resolve(MEMBER)
const goodIntent = () => ({ memberId: MEMBER, redirectUri: PAGE, createdAt: Date.now() - 1000 })

test('the return params are taken off the URL at load; other params stay', () => {
  const { win, replaced } = makeWin({ search: '?code=abc&state=' + MEMBER + '&ref=x' })
  const callback = captureCallback(win)
  assert.deepEqual(callback, { code: 'abc', grantId: '', success: '', state: MEMBER, hasError: false })
  assert.deepEqual(replaced, ['/starter-onboarding-v2?ref=x'])
})

test('a page without return params has nothing to finish and the URL is untouched', () => {
  const { win, replaced } = makeWin({ search: '?ref=x' })
  assert.equal(captureCallback(win), null)
  assert.deepEqual(replaced, [])
})

test('the return address is this page: origin + path, no query, no trailing slash', () => {
  assert.equal(pageRedirectUri(makeWin({ path: '/starter-onboarding-v2/' }).win), PAGE)
  assert.equal(pageRedirectUri(makeWin({ path: '/starter-edit-profile' }).win), 'https://www.thestarters.com/starter-edit-profile')
})

test('start asks Xano for Google with this page as redirect and stores a one-time intent', async () => {
  const { win, storage } = makeWin()
  const backend = makeBackend()
  const url = await createGoogleConnect(win, { post: backend.post, memberId, callback: null }).start()
  assert.equal(url, 'https://api.us.nylas.com/v3/connect/auth?x=1')
  assert.deepEqual(backend.calls[0], { path: '/grants/oauth/v3', body: { in_provider: 'google', in_redirect_uri: PAGE } })
  const intent = JSON.parse(storage.get(INTENT_KEY))
  assert.equal(intent.memberId, MEMBER)
  assert.equal(intent.redirectUri, PAGE)
})

test('start fails without a Google URL and stores nothing', async () => {
  const { win, storage } = makeWin()
  const post = async () => ({ response: { result: { data: {} } } })
  await assert.rejects(createGoogleConnect(win, { post, memberId, callback: null }).start())
  assert.equal(storage.has(INTENT_KEY), false)
})

test('return: delete the platform grant, add the Google grant, then re-save hours with the same items', async () => {
  const page = makeWin({ intent: goodIntent() })
  const backend = makeBackend()
  const connect = createGoogleConnect(page.win, { post: backend.post, memberId, callback: { code: 'abc', state: MEMBER, hasError: false } })
  assert.equal(connect.returnPending(), true)
  assert.equal(await connect.completeReturn(), true)
  assert.deepEqual(backend.paths(), ['/starter/get_by_memberstack/v3', '/grants/delete/v3', '/grants/add/v3', '/onboarding/calendar/ensure-default/v3'])
  assert.deepEqual(backend.calls[1].body, { in_grant_id: 'v-1' })
  assert.deepEqual(backend.calls[2].body, { code: 'abc', member_id: MEMBER, in_redirect_uri: PAGE, in_state: MEMBER })
  assert.deepEqual(backend.calls[3].body, {
    member_id: MEMBER,
    availability: { items: { general: { days: [1], start: '09:00', end: '12:00' } } },
    in_timezone: 'Europe/Amsterdam',
    offer_intro_call: true,
  })
  assert.deepEqual(page.messages, [{ channel: 'starters-calendar-connect-return', type: 'calendar-connected', memberId: MEMBER }])
  assert.equal(page.storage.has(INTENT_KEY), false)
  assert.equal(page.win.document.documentElement.attrs['data-google-connect-return'], 'done')
  page.win.timers.forEach((fn) => fn())
  assert.equal(page.win.closed, true)
})

test('return with no grant yet skips the delete', async () => {
  const page = makeWin({ intent: goodIntent() })
  const backend = makeBackend({ starter: { nylas_grant_id: null, availability: { items: {} } } })
  await createGoogleConnect(page.win, { post: backend.post, memberId, callback: { code: 'abc', state: MEMBER, hasError: false } }).completeReturn()
  assert.deepEqual(backend.paths(), ['/starter/get_by_memberstack/v3', '/grants/add/v3', '/onboarding/calendar/ensure-default/v3'])
})

for (const [name, intent, callback] of [
  ['no intent (not started here)', undefined, { code: 'abc', state: MEMBER, hasError: false }],
  ['intent from another page', { memberId: MEMBER, redirectUri: 'https://www.thestarters.com/starter-dashboard', createdAt: Date.now() }, { code: 'abc', state: MEMBER, hasError: false }],
  ['intent for another member', { memberId: 'mem_other', redirectUri: PAGE, createdAt: Date.now() }, { code: 'abc', state: MEMBER, hasError: false }],
  ['expired intent', { memberId: MEMBER, redirectUri: PAGE, createdAt: Date.now() - 16 * 60 * 1000 }, { code: 'abc', state: MEMBER, hasError: false }],
  ['state for another member', goodIntent(), { code: 'abc', state: 'mem_other', hasError: false }],
  ['cancelled at Google', goodIntent(), { code: '', state: MEMBER, hasError: true }],
]) {
  test('return is refused and nothing is written: ' + name, async () => {
    const page = makeWin({ intent })
    const backend = makeBackend()
    const ok = await createGoogleConnect(page.win, { post: backend.post, memberId, callback }).completeReturn()
    assert.equal(ok, false)
    assert.deepEqual(backend.paths(), [])
    assert.deepEqual(page.messages, [{ channel: 'starters-calendar-connect-return', type: 'calendar-connect-failed', memberId: MEMBER }])
    assert.equal(page.storage.has(INTENT_KEY), false)
    assert.equal(page.win.document.documentElement.attrs['data-google-connect-return'], 'failed')
  })
}

test('if the Google grant cannot be added after the delete, the platform calendar is put back', async () => {
  const page = makeWin({ intent: goodIntent() })
  const backend = makeBackend({ fail: { '/grants/add/v3': true } })
  const ok = await createGoogleConnect(page.win, { post: backend.post, memberId, callback: { code: 'abc', state: MEMBER, hasError: false } }).completeReturn()
  assert.equal(ok, false)
  assert.deepEqual(backend.paths(), ['/starter/get_by_memberstack/v3', '/grants/delete/v3', '/grants/add/v3', '/onboarding/calendar/ensure-default/v3'])
  assert.deepEqual(backend.calls[3].body.availability.items.general, { days: [1], start: '09:00', end: '12:00' })
  assert.equal(backend.calls[3].body.in_timezone, 'Europe/Amsterdam')
  assert.equal(page.messages[0].type, 'calendar-connect-failed')
})

test('a starter without a stored timezone sends an empty one', async () => {
  const page = makeWin({ intent: goodIntent() })
  const backend = makeBackend({ starter: { nylas_grant_id: null, availability: { items: {} } } })
  await createGoogleConnect(page.win, { post: backend.post, memberId, callback: { code: 'abc', state: MEMBER, hasError: false } }).completeReturn()
  assert.equal(backend.calls[2].body.in_timezone, '')
})

test('if only the defaults fail after the Google grant is added, a successful retry counts as connected', async () => {
  const page = makeWin({ intent: goodIntent() })
  const backend = makeBackend({ fail: { '/onboarding/calendar/ensure-default/v3': 1 } })
  const ok = await createGoogleConnect(page.win, { post: backend.post, memberId, callback: { code: 'abc', state: MEMBER, hasError: false } }).completeReturn()
  assert.equal(ok, true)
  assert.deepEqual(backend.paths(), ['/starter/get_by_memberstack/v3', '/grants/delete/v3', '/grants/add/v3', '/onboarding/calendar/ensure-default/v3', '/onboarding/calendar/ensure-default/v3'])
  assert.deepEqual(backend.calls[4].body, backend.calls[3].body)
  assert.deepEqual(page.messages, [{ channel: 'starters-calendar-connect-return', type: 'calendar-connected', memberId: MEMBER }])
  assert.equal(page.win.document.documentElement.attrs['data-google-connect-return'], 'done')
  page.win.timers.forEach((fn) => fn())
  assert.equal(page.win.closed, true)
})

test('if the defaults retry also fails after the Google grant is added, it fails without a platform restore', async () => {
  const page = makeWin({ intent: goodIntent() })
  const backend = makeBackend({ fail: { '/onboarding/calendar/ensure-default/v3': true } })
  const ok = await createGoogleConnect(page.win, { post: backend.post, memberId, callback: { code: 'abc', state: MEMBER, hasError: false } }).completeReturn()
  assert.equal(ok, false)
  assert.deepEqual(backend.paths(), ['/starter/get_by_memberstack/v3', '/grants/delete/v3', '/grants/add/v3', '/onboarding/calendar/ensure-default/v3', '/onboarding/calendar/ensure-default/v3'])
  assert.deepEqual(page.messages, [{ channel: 'starters-calendar-connect-return', type: 'calendar-connect-failed', memberId: MEMBER }])
  assert.equal(page.win.document.documentElement.attrs['data-google-connect-return'], 'failed')
  assert.equal(page.win.closed, false)
})

test('a failed delete does not add the Google grant or restore anything', async () => {
  const page = makeWin({ intent: goodIntent() })
  const backend = makeBackend({ fail: { '/grants/delete/v3': true } })
  await createGoogleConnect(page.win, { post: backend.post, memberId, callback: { code: 'abc', state: MEMBER, hasError: false } }).completeReturn()
  assert.deepEqual(backend.paths(), ['/starter/get_by_memberstack/v3', '/grants/delete/v3'])
})

test('the intent is one-time: a second return with the same code is refused', async () => {
  const page = makeWin({ intent: goodIntent() })
  const backend = makeBackend()
  const callback = { code: 'abc', state: MEMBER, hasError: false }
  await createGoogleConnect(page.win, { post: backend.post, memberId, callback }).completeReturn()
  const second = makeBackend()
  assert.equal(await createGoogleConnect(page.win, { post: second.post, memberId, callback }).completeReturn(), false)
  assert.deepEqual(second.paths(), [])
})

test('Build Profile with the Free call off: the intent keeps the choice and the return does not offer the Free call', async () => {
  const bp = 'https://www.thestarters.com/build-profile/consult-test'
  const start = makeWin({ path: '/build-profile/consult-test' })
  await createGoogleConnect(start.win, { post: makeBackend().post, memberId, callback: null }).start({ offerIntroCall: false })
  const intent = JSON.parse(start.storage.get(INTENT_KEY))
  assert.equal(intent.redirectUri, bp)
  assert.equal(intent.offerIntroCall, false)

  const page = makeWin({ path: '/build-profile/consult-test', intent })
  const backend = makeBackend()
  assert.equal(await createGoogleConnect(page.win, { post: backend.post, memberId, callback: { code: 'abc', state: MEMBER, hasError: false } }).completeReturn(), true)
  const ensure = backend.calls.find((c) => c.path === '/onboarding/calendar/ensure-default/v3')
  assert.equal(ensure.body.offer_intro_call, false)
  assert.equal(backend.calls.find((c) => c.path === '/grants/add/v3').body.in_redirect_uri, bp)
})

test('start without options keeps offering the Free call (onboarding behaviour)', async () => {
  const { win, storage } = makeWin()
  await createGoogleConnect(win, { post: makeBackend().post, memberId, callback: null }).start()
  assert.equal(JSON.parse(storage.get(INTENT_KEY)).offerIntroCall, true)
})

// Regression 2026-11-12: the live Nylas app uses hosted auth. Google came back to
// /build-profile/consult-test with grant_id + success=true and no code, and the
// return never ran (jp+onb04 stayed on the platform calendar).
test('a hosted-auth return (grant_id + success, no code) is captured and the URL is cleaned', () => {
  const { win, replaced } = makeWin({ search: '?email=x%40gmail.com&grant_id=g-hosted&provider=google&state=' + MEMBER + '&success=true&ref=x' })
  const callback = captureCallback(win)
  assert.deepEqual(callback, { code: '', grantId: 'g-hosted', success: 'true', state: MEMBER, hasError: false })
  assert.deepEqual(replaced, ['/starter-onboarding-v2?ref=x'])
})

test('a hosted-auth return connects through grants/add with in_grant_id', async () => {
  const page = makeWin({ intent: goodIntent() })
  const backend = makeBackend()
  const callback = { code: '', grantId: 'g-hosted', success: 'true', state: MEMBER, hasError: false }
  assert.equal(await createGoogleConnect(page.win, { post: backend.post, memberId, callback }).completeReturn(), true)
  assert.deepEqual(backend.paths(), ['/starter/get_by_memberstack/v3', '/grants/delete/v3', '/grants/add/v3', '/onboarding/calendar/ensure-default/v3'])
  assert.deepEqual(backend.calls[2].body, { member_id: MEMBER, in_redirect_uri: PAGE, in_state: MEMBER, in_grant_id: 'g-hosted' })
  assert.deepEqual(page.messages, [{ channel: 'starters-calendar-connect-return', type: 'calendar-connected', memberId: MEMBER }])
})

test('a hosted-auth return without success=true writes nothing', async () => {
  const page = makeWin({ intent: goodIntent() })
  const backend = makeBackend()
  const callback = { code: '', grantId: 'g-hosted', success: '', state: MEMBER, hasError: false }
  assert.equal(await createGoogleConnect(page.win, { post: backend.post, memberId, callback }).completeReturn(), false)
  assert.deepEqual(backend.paths(), [])
  assert.deepEqual(page.messages, [{ channel: 'starters-calendar-connect-return', type: 'calendar-connect-failed', memberId: MEMBER }])
})

test('a hosted-auth return of the grant already stored (same Google account) keeps it and only re-saves hours', async () => {
  const page = makeWin({ intent: goodIntent() })
  const backend = makeBackend({ starter: { nylas_grant_id: 'g-hosted', timezone: 'Europe/Amsterdam', availability: { items: {} } } })
  const callback = { code: '', grantId: 'g-hosted', success: 'true', state: MEMBER, hasError: false }
  assert.equal(await createGoogleConnect(page.win, { post: backend.post, memberId, callback }).completeReturn(), true)
  assert.deepEqual(backend.paths(), ['/starter/get_by_memberstack/v3', '/onboarding/calendar/ensure-default/v3'])
  assert.deepEqual(backend.calls[1].body, { member_id: MEMBER, availability: { items: {} }, in_timezone: 'Europe/Amsterdam', offer_intro_call: true })
  assert.deepEqual(page.messages, [{ channel: 'starters-calendar-connect-return', type: 'calendar-connected', memberId: MEMBER }])
})
