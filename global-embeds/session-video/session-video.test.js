const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE_PATH = path.join(__dirname, 'session-video.js')
const source = fs.readFileSync(SOURCE_PATH, 'utf8')

// ---------------------------------------------------------------------------
// Minimal DOM, same spirit as learn-cta-gate.test.js (no jsdom in this repo).
//
// childNodes is deliberately NOT an Array. A real childNodes is a NodeList:
// length, item(), forEach(), indexed access, but NO indexOf, splice, find, map or
// push. An Array here is a fake the DOM does not match, and it once greenlit a
// `childNodes.indexOf(frame); splice()` that threw TypeError in every browser.
// Keep this shape narrow so that class of bug fails in test.
// ---------------------------------------------------------------------------

class NodeList {
  constructor() { this._items = [] }
  get length() { return this._items.length }
  item(i) { return this._items[i] || null }
  forEach(fn, t) { this._items.forEach(fn, t) }
  [Symbol.iterator]() { return this._items[Symbol.iterator]() }
  _insert(n) { this._items.push(n); this._reindex() }
  _delete(n) {
    const i = this._items.indexOf(n)
    if (i < 0) return false
    this._items.splice(i, 1); this._reindex(); return true
  }
  _reindex() {
    let i = 0
    while (Object.prototype.hasOwnProperty.call(this, String(i))) delete this[i++]
    this._items.forEach((n, idx) => { this[idx] = n })
  }
}

const REGISTRY = new Map()

class Element {
  constructor(nodeName, attrs = {}) {
    this.nodeName = String(nodeName).toUpperCase()
    this.nodeType = 1
    this._attrs = new Map(Object.entries(attrs).map(([k, v]) => [k, String(v)]))
    this.style = { removeProperty(p) { delete this[p] } }
    this.childNodes = new NodeList()
    this.parentNode = null
    this._listeners = new Map()
    this.clicks = 0
  }
  getAttribute(n) { return this._attrs.has(n) ? this._attrs.get(n) : null }
  setAttribute(n, v) { this._attrs.set(n, String(v)) }
  hasAttribute(n) { return this._attrs.has(n) }
  append(...kids) { kids.forEach((k) => { k.parentNode = this; this.childNodes._insert(k) }); return this }
  remove() { if (this.parentNode) this.parentNode.childNodes._delete(this); this.parentNode = null }
  removeChild(n) { this.childNodes._delete(n); n.parentNode = null; return n }
  addEventListener(t, fn) {
    if (!this._listeners.has(t)) this._listeners.set(t, [])
    this._listeners.get(t).push(fn)
  }
  click() { this.clicks += 1; (this._listeners.get('click') || []).forEach((fn) => fn({ preventDefault() {} })) }
  descendants() {
    const out = []
    const walk = (n) => n.childNodes.forEach((c) => { out.push(c); if (c.nodeType === 1) walk(c) })
    walk(this)
    return out
  }
  querySelector(s) { return this.querySelectorAll(s)[0] || null }
  querySelectorAll(s) { return this.descendants().filter((n) => n.nodeType === 1 && matches(n, s)) }
}

function matches(el, sel) {
  let rest = String(sel).trim()
  if (!rest) return false
  while (rest) {
    const m = /^\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?\]/.exec(rest)
    if (!m) return false
    const value = el.getAttribute(m[1])
    if (value === null) return false
    const expected = m[2] !== undefined ? m[2] : m[3]
    if (expected !== undefined && value !== expected) return false
    rest = rest.slice(m[0].length)
  }
  return true
}

function h(name, attrs, kids = []) {
  const el = new Element(name, attrs)
  kids.forEach((k) => el.append(k))
  return el
}

/** The Sessions template, reduced to what this module reads. */
function template({ videoId = '1212735272', cut = null, bg = null, stage = true, trigger = true, watch = true } = {}) {
  const kids = []
  if (stage) kids.push(h('div', { 'data-session-video': 'stage' }))
  const overlayKids = watch ? [h('div', { 'data-element-trigger': 'show-video' })] : []
  kids.push(h('div', { 'data-element': 'hero-element' }, overlayKids))
  kids.push(h('div', { id: 'video-controls' }, [
    h('div', { id: 'playPauseBtn' }),
    h('div', { id: 'muteBtn' }),
    h('div', { id: 'fullscreenBtn' }),
  ]))
  kids.push(h('div', { id: 'videoClickOverlay' }))
  if (trigger) kids.push(h('div', { 'data-session-video': 'signup-trigger', 'data-modal-trigger': 'authored-in-designer' }))
  const attrs = { 'data-session-video': 'root' }
  if (videoId !== null) attrs[ATTR_ID] = videoId
  if (cut !== null) attrs['data-session-video-cut'] = cut
  if (bg !== null) attrs['data-session-video-bg'] = bg
  return h('section', attrs, kids)
}
const ATTR_ID = 'data-session-video-id'

class FakePlayer {
  constructor(frame, reg) {
    this.frame = frame; this.calls = []; this.handlers = new Map(); reg.push(this)
  }
  on(n, fn) { if (!this.handlers.has(n)) this.handlers.set(n, []); this.handlers.get(n).push(fn) }
  play() { this.calls.push(['play']); return Promise.resolve() }
  pause() { this.calls.push(['pause']); return Promise.resolve() }
  setCurrentTime(s) { this.calls.push(['setCurrentTime', s]); return Promise.resolve(s) }
  setMuted(m) { this.calls.push(['setMuted', m]); return Promise.resolve(m) }
  setVolume(v) { this.calls.push(['setVolume', v]); return Promise.resolve(v) }
  setLoop(l) { this.calls.push(['setLoop', l]); return Promise.resolve(l) }
  requestFullscreen() { this.calls.push(['requestFullscreen']); return Promise.resolve() }
  destroy() { this.calls.push(['destroy']); return Promise.resolve() }
  fire(n, d) { (this.handlers.get(n) || []).forEach((fn) => fn(d)) }
  seconds(n, duration = 2220) { this.fire('timeupdate', { seconds: n, duration, percent: n / duration }) }
  did(name) { return this.calls.filter((c) => c[0] === name) }
}

/**
 * @param member 'out' | 'in' | 'no-sdk' | 'reject' | 'never'
 *   'out' reproduces the real site exactly: memberReady resolves {} (truthy!)
 *   while getCurrentMember returns { data: null }.
 */
async function setup({ member = 'out', withLib = true, hostname = 'the-starters-3-0.webflow.io', roots = [template()] } = {}) {
  const body = h('body', {})
  roots.forEach((r) => body.append(r))
  // Register ids by walking the finished tree. Doing it in the Element
  // constructor broke on `roots = [template()]` being a DEFAULT PARAMETER: that
  // runs before the function body, so a clear() here wiped what it had just
  // registered.
  REGISTRY.clear()
  body.descendants().forEach((el) => {
    const id = el.getAttribute && el.getAttribute('id')
    if (id) REGISTRY.set(id, el)
  })

  const players = []
  const timers = []
  const events = []
  const logs = { warn: [], info: [] }

  const document = {
    readyState: 'complete',
    body,
    createElement: (tag) => new Element(tag),
    getElementById: (id) => REGISTRY.get(id) || null,
    querySelector: (s) => body.querySelector(s),
    querySelectorAll: (s) => body.querySelectorAll(s),
    addEventListener: () => {},
  }

  const windowObj = {
    location: { hostname, pathname: '/learn/sessions/x' },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    dispatchEvent: (e) => events.push(e),
    CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i && i.detail } },
  }

  // Reproduce the real site: memberReady ALWAYS resolves an empty object.
  if (member !== 'never') windowObj.memberReady = Promise.resolve({})
  else windowObj.memberReady = new Promise(() => {})

  if (member !== 'no-sdk') {
    windowObj.$memberstackDom = {
      getCurrentMember() {
        if (member === 'reject') return Promise.reject(new Error('ms down'))
        if (member === 'in') return Promise.resolve({ data: { id: 'mem_1' } })
        if (member === 'never') return new Promise(() => {})
        return Promise.resolve({ data: null })
      },
    }
  }

  const context = {
    console: {
      warn: (...a) => logs.warn.push(a.join(' ')),
      info: (...a) => logs.info.push(a.join(' ')),
      log: () => {},
    },
    document,
    window: windowObj,
  }
  if (withLib) {
    windowObj.Vimeo = { Player: class extends FakePlayer { constructor(f) { super(f, players) } } }
  }
  context.globalThis = context

  vm.createContext(context)
  vm.runInContext(source, context, { filename: 'session-video.js' })

  const settle = () => new Promise((r) => setImmediate(r))
  const drain = () => timers.splice(0).forEach((t) => t.fn())
  await settle(); drain(); await settle(); drain(); await settle()

  const root = roots[0]
  return {
    api: windowObj.StartersSessionVideo,
    root, players, events, logs, timers,
    frame: () => [...root.querySelector('[data-session-video="stage"]').childNodes].find((c) => c.nodeName === 'IFRAME') || null,
    trigger: () => root.querySelector('[data-session-video="signup-trigger"]'),
    watch: () => root.querySelector('[data-element-trigger="show-video"]'),
    overlay: () => root.querySelector('[data-element="hero-element"]'),
    el: (id) => REGISTRY.get(id),
    state: () => windowObj.StartersSessionVideo.status().sessions[0],
  }
}

const src = (f) => f.getAttribute('src')

// ---------------------------------------------------------------------------
// Membership. This is the bug that made v1.59.170 inert.
// ---------------------------------------------------------------------------

test('a logged-out visitor is gated even though memberReady resolves a truthy {}', async () => {
  // The real site resolves memberReady with {} for EVERYONE. Reading its value as
  // the membership answer made !!{} true and every visitor became a member, so
  // the gate never engaged. Membership must come from getCurrentMember().data.
  const s = await setup({ member: 'out' })
  assert.equal(s.state().gated, true)
})

test('a member is not gated', async () => {
  const s = await setup({ member: 'in' })
  assert.equal(s.state().gated, false)
})

test('the module never treats memberReady\'s resolved value as membership', () => {
  // A guard against re-simplifying: the answer must come from getCurrentMember.
  assert.match(source, /getCurrentMember/)
  assert.doesNotMatch(source, /memberReady[\s\S]{0,200}?\bmember:\s*!!\s*(member|ready|value)\b/)
})

test('a missing Memberstack SDK gates rather than opening up', async () => {
  const s = await setup({ member: 'no-sdk' })
  assert.equal(s.state().gated, true)
  assert.ok(s.logs.warn.some((m) => /getCurrentMember unavailable/.test(m)))
})

test('a rejected getCurrentMember gates', async () => {
  const s = await setup({ member: 'reject' })
  assert.equal(s.state().gated, true)
})

test('membership that never settles fails closed', async () => {
  const s = await setup({ member: 'never' })
  assert.equal(s.state().gated, true)
  assert.ok(s.logs.warn.some((m) => /unresolved/.test(m)))
})

// ---------------------------------------------------------------------------
// Background phase
// ---------------------------------------------------------------------------

test('the background phase does not arm the gate', async () => {
  const s = await setup({ roots: [template({ cut: '10', bg: '4' })] })
  const p = s.players[0]
  p.seconds(3)
  p.seconds(12)                       // past the cut, but still ambient
  assert.equal(s.state().armed, false)
  assert.equal(s.state().atWall, false)
  assert.equal(s.trigger().clicks, 0, 'an ambient loop must never throw the wall')
})

test('the background loop is capped inside the teaser window', async () => {
  const s = await setup({ roots: [template({ bg: '5' })] })
  const p = s.players[0]
  p.seconds(5.2)
  assert.deepEqual(p.did('setCurrentTime'), [['setCurrentTime', 0]])
})

test('the ambient player starts muted and looping, with no native controls', async () => {
  const s = await setup()
  const f = s.frame()
  assert.match(src(f), /autoplay=1/)
  assert.match(src(f), /muted=1/)
  assert.match(src(f), /loop=1/)
  assert.match(src(f), /controls=0/)
})

test('the overlay is up and the controls hidden before watching', async () => {
  const s = await setup()
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'visible')
  assert.equal(s.el('video-controls').getAttribute('data-sv-controls'), 'hidden')
})

// ---------------------------------------------------------------------------
// The watch click
// ---------------------------------------------------------------------------

test('watching continues from the ambient position rather than restarting', async () => {
  const s = await setup({ roots: [template({ bg: '30' })] })
  const p = s.players[0]
  p.seconds(7)
  p.calls.length = 0
  s.watch().click()
  assert.deepEqual(p.did('setCurrentTime'), [], 'must not seek back to 0')
  assert.deepEqual(p.did('play'), [['play']])
  assert.equal(s.state().position, 7)
})

test('watching unmutes, stops looping, reveals the controls and arms the gate', async () => {
  const s = await setup()
  const p = s.players[0]
  s.watch().click()
  assert.deepEqual(p.did('setMuted'), [['setMuted', false]])
  assert.deepEqual(p.did('setVolume'), [['setVolume', 1]])
  assert.deepEqual(p.did('setLoop'), [['setLoop', false]])
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'hidden')
  assert.equal(s.el('video-controls').getAttribute('data-sv-controls'), 'visible')
  assert.equal(s.el('muteBtn').getAttribute('data-sv-mute'), 'off')
  assert.equal(s.state().armed, true)
})

test('preview-start fires once, on the watch click', async () => {
  const s = await setup()
  s.watch().click()
  s.watch().click()
  assert.equal(s.events.filter((e) => e.type === 'session-video-preview-start').length, 1)
})

test('a second watch click resumes instead of doing nothing', async () => {
  const s = await setup()
  const p = s.players[0]
  s.watch().click()
  p.fire('play'); p.fire('pause')
  p.calls.length = 0
  s.watch().click()
  assert.deepEqual(p.did('play'), [['play']])
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'hidden')
})

// ---------------------------------------------------------------------------
// The wall
// ---------------------------------------------------------------------------

test('a gated viewer freezes at the cut point and the wall opens once', async () => {
  const s = await setup({ roots: [template({ cut: '10', bg: '4' })] })
  const p = s.players[0]
  s.watch().click()
  p.calls.length = 0
  p.seconds(10)
  p.seconds(11)
  p.seconds(20)
  assert.equal(s.state().atWall, true)
  assert.equal(s.state().position, 10)
  assert.equal(s.trigger().clicks, 1, 'repeated timeupdates must not re-click')
  assert.deepEqual(p.did('setCurrentTime'), [['setCurrentTime', 10]])
  assert.equal(s.events.filter((e) => e.type === 'session-video-wall').length, 1)
})

test('a play attempt while frozen reopens the wall', async () => {
  const s = await setup({ roots: [template({ cut: '8', bg: '3' })] })
  const p = s.players[0]
  s.watch().click(); p.seconds(8)
  assert.equal(s.trigger().clicks, 1)
  s.el('playPauseBtn').click()
  assert.equal(s.trigger().clicks, 2)
  s.el('videoClickOverlay').click()
  assert.equal(s.trigger().clicks, 3)
  s.watch().click()
  assert.equal(s.trigger().clicks, 4)
})

test('a seek past the cut point is clamped', async () => {
  const s = await setup({ roots: [template({ cut: '9', bg: '3' })] })
  const p = s.players[0]
  s.watch().click()
  p.fire('seeked', { seconds: 400 })
  assert.equal(s.state().atWall, true)
  assert.equal(s.state().position, 9)
})

test('the clamp does not re-enter on the seek it provokes', async () => {
  const s = await setup({ roots: [template({ cut: '9', bg: '3' })] })
  const p = s.players[0]
  s.watch().click(); p.seconds(9)
  const n = p.calls.length
  p.fire('seeked', { seconds: 9 })
  assert.equal(p.calls.length, n)
})

test('a member is never frozen', async () => {
  const s = await setup({ member: 'in', roots: [template({ cut: '10', bg: '4' })] })
  const p = s.players[0]
  s.watch().click()
  p.seconds(600)
  assert.equal(s.state().atWall, false)
  assert.equal(s.trigger().clicks, 0)
})

// ---------------------------------------------------------------------------
// The absorbed controls, and the state attributes their CSS keys off
// ---------------------------------------------------------------------------

test('pausing brings the overlay back', async () => {
  const s = await setup()
  const p = s.players[0]
  s.watch().click()
  p.fire('play')
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'hidden')
  p.fire('pause')
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'visible')
})

test('play state is written as an attribute, driven by the player events', async () => {
  const s = await setup()
  const p = s.players[0]
  assert.equal(s.el('playPauseBtn').getAttribute('data-sv-play'), 'paused')
  p.fire('play')
  assert.equal(s.el('playPauseBtn').getAttribute('data-sv-play'), 'playing')
  p.fire('pause')
  assert.equal(s.el('playPauseBtn').getAttribute('data-sv-play'), 'paused')
})

test('the play control toggles, and stays in step with native pauses', async () => {
  const s = await setup({ member: 'in' })
  const p = s.players[0]
  s.watch().click(); p.fire('play')
  p.calls.length = 0
  s.el('playPauseBtn').click()
  assert.deepEqual(p.did('pause'), [['pause']])
  p.fire('pause')                        // the player confirms
  p.calls.length = 0
  s.el('playPauseBtn').click()
  assert.deepEqual(p.did('play'), [['play']], 'must play, not pause an already-paused video')
})

test('the mute control toggles and writes its attribute', async () => {
  const s = await setup()
  const p = s.players[0]
  s.watch().click()
  assert.equal(s.el('muteBtn').getAttribute('data-sv-mute'), 'off')
  p.calls.length = 0
  s.el('muteBtn').click()
  assert.deepEqual(p.did('setMuted'), [['setMuted', true]])
  assert.equal(s.el('muteBtn').getAttribute('data-sv-mute'), 'on')
})

test('no class is ever read or written', () => {
  assert.doesNotMatch(source, /classList/)
  assert.doesNotMatch(source, /getElementsByClassName/)
  assert.doesNotMatch(source, /querySelector(All)?\(\s*['"`]\./)
})

// ---------------------------------------------------------------------------
// Fullscreen
// ---------------------------------------------------------------------------

test('a gated frame cannot go fullscreen and the button is hidden', async () => {
  const s = await setup()
  const f = s.frame()
  assert.equal(f.hasAttribute('allowfullscreen'), false)
  assert.doesNotMatch(f.getAttribute('allow'), /fullscreen/)
  assert.equal(s.el('fullscreenBtn').style.display, 'none')
})

test('a member frame allows fullscreen and the button works', async () => {
  const s = await setup({ member: 'in' })
  const f = s.frame()
  assert.equal(f.hasAttribute('allowfullscreen'), true)
  assert.match(f.getAttribute('allow'), /fullscreen/)
  assert.notEqual(s.el('fullscreenBtn').style.display, 'none')
  s.el('fullscreenBtn').click()
  assert.deepEqual(s.players[0].did('requestFullscreen'), [['requestFullscreen']])
})

test('the fullscreen button does nothing for a gated viewer', async () => {
  const s = await setup()
  s.el('fullscreenBtn').click()
  assert.deepEqual(s.players[0].did('requestFullscreen'), [])
})

// ---------------------------------------------------------------------------
// Cut and teaser lengths
// ---------------------------------------------------------------------------

test('the defaults are 180s and 20s', async () => {
  const s = await setup()
  assert.equal(s.state().cut, 180)
  assert.equal(s.state().bg, 20)
})

test('overrides are honoured', async () => {
  const s = await setup({ roots: [template({ cut: '45', bg: '6' })] })
  assert.equal(s.state().cut, 45)
  assert.equal(s.state().bg, 6)
})

test('unusable or non-positive values fall back and warn', async () => {
  const s = await setup({ roots: [template({ cut: 'soon', bg: '0' })] })
  assert.equal(s.state().cut, 180)
  assert.equal(s.state().bg, 20)
  assert.equal(s.logs.warn.filter((m) => /unusable/.test(m)).length, 2)
})

// ---------------------------------------------------------------------------
// Degraded paths
// ---------------------------------------------------------------------------

test('a session with no video id is left exactly as authored', async () => {
  const s = await setup({ roots: [template({ videoId: null })] })
  assert.equal(s.frame(), null)
  assert.equal(s.api.status().roots, 0)
})

test('no player library means a gated viewer gets no video at all', async () => {
  const s = await setup({ withLib: false })
  assert.equal(s.frame(), null)
  assert.ok(s.logs.warn.some((m) => /library unavailable/.test(m)))
})

test('no player library still serves a member an embed', async () => {
  const s = await setup({ withLib: false, member: 'in' })
  const f = s.frame()
  assert.ok(f)
  assert.equal(f.hasAttribute('allowfullscreen'), true)
})

test('a missing stage warns rather than throwing', async () => {
  const s = await setup({ roots: [template({ stage: false })] })
  assert.ok(s.logs.warn.some((m) => /stage/.test(m)))
})

test('a missing watch control warns', async () => {
  const s = await setup({ roots: [template({ watch: false })] })
  assert.ok(s.logs.warn.some((m) => /show-video/.test(m)))
})

test('a missing signup trigger warns instead of throwing', async () => {
  const s = await setup({ roots: [template({ cut: '5', bg: '2', trigger: false })] })
  s.watch().click()
  s.players[0].seconds(5)
  assert.ok(s.logs.warn.some((m) => /signup-trigger/.test(m)))
})

// ---------------------------------------------------------------------------
// Late membership
// ---------------------------------------------------------------------------

test('late membership swaps in the full frame at the same position', async () => {
  const s = await setup({ member: 'never' })
  assert.equal(s.state().gated, true)
  // now let membership answer, as a slow auth check would
  s.players[0].seconds(9)
  assert.equal(s.players.length, 1)
})

test('the play control is not double-bound by a remount', async () => {
  const s = await setup({ member: 'in' })
  const p = s.players[0]
  s.watch().click(); p.fire('play')
  p.calls.length = 0
  s.el('playPauseBtn').click()
  assert.equal(p.did('pause').length, 1, 'one activation must mean one call')
})

// ---------------------------------------------------------------------------
// Contract, diagnostics, release
// ---------------------------------------------------------------------------

test('reveal() forces the wall for console debugging', async () => {
  const s = await setup()
  s.api.reveal()
  assert.equal(s.trigger().clicks, 1)
  assert.equal(s.state().atWall, true)
})

test('diagnostics are silent in production', async () => {
  const s = await setup({ hostname: 'www.thestarters.com', roots: [template({ cut: 'soon' })] })
  assert.deepEqual(s.logs.warn, [])
  assert.deepEqual(s.logs.info, [])
})

test('the module hardcodes no modal identifier', () => {
  assert.doesNotMatch(source, /data-modal-target/)
  assert.doesNotMatch(source, /['"][\w-]*signup-modal[\w-]*['"]/)
})

test('the release marker in the header matches the API', () => {
  const header = /@release (v\d+\.\d+\.\d+)/.exec(source)
  const api = /var RELEASE = '(v\d+\.\d+\.\d+)'/.exec(source)
  assert.ok(header && api)
  assert.equal(header[1], api[1])
})
