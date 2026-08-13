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
  /** wideEnough() measures the stage box; the harness sets _width on it. */
  getBoundingClientRect() { return { width: this._width || 0, height: (this._width || 0) * 9 / 16 } }
  removeChild(n) { this.childNodes._delete(n); n.parentNode = null; return n }
  addEventListener(t, fn) {
    if (!this._listeners.has(t)) this._listeners.set(t, [])
    this._listeners.get(t).push(fn)
  }
  click() { this.clicks += 1; (this._listeners.get('click') || []).forEach((fn) => fn({ preventDefault() {} })) }
  key(name) { (this._listeners.get('keydown') || []).forEach((fn) => fn({ key: name, preventDefault() {} })) }
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
function template({ videoId = '1212735272', cut = null, bg = null, nativeMin = null, stage = true, trigger = true, watch = true } = {}) {
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
  if (nativeMin !== null) attrs['data-session-video-native-min'] = nativeMin
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
  /**
   * Set `refuseFullscreen` on an instance to reproduce the platforms that turn the
   * request down. Vimeo really does reject this one, and the module's fallback for
   * a refusal is plain inline playback — which can only be tested if the harness
   * can refuse.
   */
  requestFullscreen() {
    this.calls.push(['requestFullscreen'])
    return this.refuseFullscreen ? Promise.reject(new Error('fullscreen refused')) : Promise.resolve()
  }
  destroy() { this.calls.push(['destroy']); return Promise.resolve() }
  fire(n, d) { (this.handlers.get(n) || []).forEach((fn) => fn(d)) }
  seconds(n, duration = 2220) { this.fire('timeupdate', { seconds: n, duration, percent: n / duration }) }
  /**
   * Vimeo reports entering AND leaving on one event, with the direction in the
   * payload — `fullscreen(false)` is the Done button or the back gesture.
   */
  fullscreen(on) { this.fire('fullscreenchange', { fullscreen: on }) }
  did(name) { return this.calls.filter((c) => c[0] === name) }
}

/**
 * @param member 'out' | 'in' | 'no-sdk' | 'reject' | 'never'
 *   'out' reproduces the real site exactly: memberReady resolves {} (truthy!)
 *   while getCurrentMember returns { data: null }.
 */
async function setup({ member = 'out', withLib = true, hostname = 'the-starters-3-0.webflow.io', roots = [template()], watch = null, watchClick = false, width = 1280, stageWidth = null, userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
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
    innerWidth: width,
    navigator: { userAgent, platform, maxTouchPoints },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    dispatchEvent: (e) => events.push(e),
    CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i && i.detail } },
  }

  // Reproduce the real site: memberReady ALWAYS resolves an empty object.
  if (member !== 'never') windowObj.memberReady = Promise.resolve({})
  else windowObj.memberReady = new Promise(() => {})

  // 'late': hold the answer until the test releases it, so the budget expires and
  // the mount is gated BEFORE membership arrives.
  let releaseLate = null
  const latePromise = new Promise((r) => { releaseLate = () => r({ data: { id: 'mem_late' } }) })

  if (member !== 'no-sdk') {
    windowObj.$memberstackDom = {
      getCurrentMember() {
        if (member === 'reject') return Promise.reject(new Error('ms down'))
        if (member === 'in') return Promise.resolve({ data: { id: 'mem_1' } })
        if (member === 'late') return latePromise
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

  // The stage is what wideEnough() measures, so size it like the real box.
  body.querySelectorAll('[data-session-video="stage"]').forEach((el) => {
    el._width = stageWidth === null ? width : stageWidth
  })

  vm.createContext(context)
  vm.runInContext(source, context, { filename: 'session-video.js' })

  const settle = () => new Promise((r) => setImmediate(r))
  const drain = () => timers.splice(0).forEach((t) => t.fn())
  await settle(); drain(); await settle(); drain(); await settle()

  const root = roots[0]
  const api0 = windowObj.StartersSessionVideo
  let gatedBeforeLate = null
  if (member === 'late') {
    // A no-library viewer has nothing mounted until the late answer lands, so the
    // session list is empty at this point; only a mounted controller has `gated`.
    const before = api0.status().sessions[0]
    gatedBeforeLate = before ? before.gated : null
  }
  // watchClick / watch apply to every member mode, not only late. For late they
  // still run BEFORE the answer is released, so the tap lands on the gated frame.
  if (watchClick) {
    const watchEl = root.querySelector('[data-element-trigger="show-video"]')
    if (!watchEl) throw new Error('setup({ watchClick: true }) needs a watch control')
    watchEl.click()
  }
  if (watch) {
    if (!players[0]) throw new Error('setup({ watch }) needs a mounted player')
    watch(players[0])
  }
  if (member === 'late') {
    releaseLate()
    await settle(); drain(); await settle()
  }
  return {
    gatedBeforeLate,
    api: windowObj.StartersSessionVideo,
    root, players, events, logs, timers,
    frame: () => [...root.querySelector('[data-session-video="stage"]').childNodes].filter((c) => c.nodeName === 'IFRAME').pop() || null,
    // A member is mounted gated first and then upgraded, so the live player is the
    // LAST one constructed, not players[0].
    live: () => players[players.length - 1],
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

test('on a wide screen a member gets Vimeo\'s native player, a gated viewer does not', async () => {
  const out = await setup({ member: 'out' })
  assert.match(src(out.frame()), /controls=0/)
  assert.match(src(out.frame()), /keyboard=0/)
  assert.match(src(out.frame()), /pip=0/)
  assert.equal(out.root.getAttribute('data-sv-player'), 'custom')

  const inn = await setup({ member: 'in' })
  assert.match(src(inn.frame()), /controls=1/)
  assert.match(src(inn.frame()), /keyboard=1/)
  assert.match(src(inn.frame()), /pip=1/)
  assert.equal(inn.root.getAttribute('data-sv-player'), 'native')
})

test('a gated viewer never gets a scrubber, which is what makes the clamp hold', async () => {
  // The native control bar is the only thing that could let someone drag past the
  // cut point. Enabling it for a gated viewer would be a bypass.
  const s = await setup({ member: 'out' })
  assert.doesNotMatch(src(s.frame()), /controls=1/)
})

test('the poster stays until the video is genuinely playing', async () => {
  const s = await setup()
  assert.equal(s.root.getAttribute('data-sv-video'), 'loading')
  s.players[0].seconds(0)
  assert.equal(s.root.getAttribute('data-sv-video'), 'loading', 'zero progress is not playing')
  s.players[0].seconds(0.4)
  assert.equal(s.root.getAttribute('data-sv-video'), 'ready')
})

test('the poster stays up when a mounted video never progresses', async () => {
  // The previous version used withLib:false, so mount() never ran and the
  // attribute was simply absent — assert.notEqual(null, 'ready') passes for free.
  // Mutation-proved: deleting both data-sv-video writes left it green. This mounts
  // a real player that just never reports progress, which is the actual case.
  const s = await setup()
  assert.equal(s.root.getAttribute('data-sv-video'), 'loading')
  s.players[0].fire('play')            // it claims to play...
  s.players[0].seconds(0)              // ...but never advances
  assert.equal(s.root.getAttribute('data-sv-video'), 'loading', 'no pixels, no retirement')
})

test('a member with no player library gets NATIVE controls even on a phone', async () => {
  // This path has no player object and never binds, so the template's own bar is
  // inert. Reporting `custom` on a narrow screen left a member with a muted,
  // looping, autoplaying video and no control route at all. Mutating the forced
  // `native = true` back to a width check previously left all 64 tests green.
  const s = await setup({ withLib: false, member: 'in', width: 375 })
  assert.ok(s.frame(), 'a member should still get the video')
  assert.equal(s.root.getAttribute('data-sv-player'), 'native', 'ugly beats unusable')
  assert.match(src(s.frame()), /controls=1/, 'Vimeo UI is the only surface here')
  assert.equal(s.api.status().sessions[0].player, 'native')
  assert.equal(s.state().narrow, true, 'forced native must not lie about the box')
  assert.equal(s.state().fullscreenTap, false, 'no player object, no tap-to-fullscreen')
})

test('a member with no player library still gets the full state contract', async () => {
  // The no-library branch appended a frame without calling mount(), so
  // data-sv-player and data-sv-video were never written: a working native player
  // under a poster that never retires, with the click overlay still eating clicks.
  const s = await setup({ withLib: false, member: 'in' })
  const f = s.frame()
  assert.ok(f, 'a member should still get the video')
  assert.equal(f.hasAttribute('allowfullscreen'), true)
  assert.equal(s.root.getAttribute('data-sv-player'), 'native')
  assert.equal(s.root.getAttribute('data-sv-video'), 'ready', 'no API means no progress to wait for')
  assert.equal(s.api.status().roots, 1, 'and status() must see it')
})

test('a member with no player library ends with the overlay lowered and the template bar still hidden', async () => {
  // Half a fix is not a fix: forcing Vimeo's own bar on this path still left the
  // hero overlay in its authored, covering state on top of it, and the watch
  // control that would lower it is never wired here (no player object, no bind).
  // Deleting the showOverlay(false) in mountWithoutApi must fail this.
  const s = await setup({ withLib: false, member: 'in', width: 375 })
  assert.ok(s.frame(), 'a member should still get the video')
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'hidden', 'nothing may cover the only control surface')
  // ...and the template's own bar stays hidden, because `native` is what the CSS
  // reads here and nothing on this path can drive those buttons. Revealing it
  // would contradict data-sv-player and render inert play and mute controls beside
  // Vimeo's working ones — writing showControls(true) here must fail this.
  assert.equal(s.root.getAttribute('data-sv-player'), 'native')
  assert.notEqual(s.el('video-controls').getAttribute('data-sv-controls'), 'visible')
  // No dead full-screen button either: there is no player to drive the request.
  assert.equal(s.el('fullscreenBtn').getAttribute('data-sv-fullscreen'), 'hidden')
  // And no claim about playback that nothing could ever correct.
  assert.equal(s.state().playing, false)
  assert.notEqual(s.el('playPauseBtn').getAttribute('data-sv-play'), 'playing')
})

test('a no-library viewer whose membership resolves late still gets the full contract', async () => {
  // The late path must NEVER route a no-library controller through upgrade(): that
  // calls mount(), which does `new window.Vimeo.Player`, and window.Vimeo is exactly
  // what is missing here — it threw into the page and left a poster that never
  // retired. It must go through mountWithoutApi() instead. This test fails if the
  // late handler goes back through upgrade(), which now bails and builds no frame.
  const s = await setup({ withLib: false, member: 'late' })
  const f = s.frame()
  assert.ok(f, 'a late-confirmed member should still get the native player')
  assert.equal(s.root.getAttribute('data-sv-player'), 'native')
  assert.equal(s.root.getAttribute('data-sv-video'), 'ready', 'no API means no progress to wait for')
  assert.equal(s.api.status().roots, 1, 'and status() must see it')
})

test('any resume clears the cover, not just the watch control', async () => {
  // A member pausing on Vimeo's own bar and pressing native play was left watching
  // from behind the returned overlay, with no route back but the watch button.
  const s = await setup({ member: 'in' })
  const p = s.live()
  s.watch().click()
  p.fire('play')
  p.fire('pause')
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'visible')
  assert.equal(s.el('video-controls').getAttribute('data-sv-controls'), 'hidden')
  p.fire('play')                       // native play, not the watch control
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'hidden')
  assert.equal(s.el('video-controls').getAttribute('data-sv-controls'), 'visible')
})

test('a late upgrade does not re-cover an already-playing video', async () => {
  const s = await setup({ member: 'late', watch: (p) => p.seconds(3) })
  assert.equal(s.root.getAttribute('data-sv-video'), 'ready', 'no poster flash on remount')
})

test('membership resolution is not chained behind the library load', () => {
  // Chaining it put the member clock behind LIB_BUDGET_MS, so a member could click
  // watch before the answer landed and have the frame rebuilt under them mid-play.
  assert.match(source, /var memberPromise = resolveMember\(\)[\s\S]{0,200}ensureLib\(\)/)
})

test('the ambient player starts muted and looping, with no native controls', async () => {
  const s = await setup({ member: 'out' })
  const f = s.frame()
  assert.match(src(f), /autoplay=1/)
  assert.match(src(f), /muted=1/)
  assert.match(src(f), /loop=1/)
  assert.match(src(f), /controls=0/)
})

test('the bypass routes are closed at construction', async () => {
  // keyboard=0 and pip=0 are the actual keyboard-seek and picture-in-picture
  // closures. Nothing asserted them, so dropping them from buildFrame passed CI.
  const s = await setup()
  assert.match(src(s.frame()), /keyboard=0/)
  assert.match(src(s.frame()), /pip=0/)
})

test('the complete event fires when the video ends', async () => {
  const s = await setup({ member: 'in' })
  s.watch().click()
  s.live().fire('ended')
  const done = s.events.filter((e) => e.type === 'session-video-complete')
  assert.equal(done.length, 1)
  assert.equal(done[0].detail.gated, false)
})

test('the absorbed div controls get button semantics and keyboard operation', async () => {
  const s = await setup({ member: 'in' })
  const play = s.el('playPauseBtn')
  assert.equal(play.getAttribute('role'), 'button')
  assert.equal(play.getAttribute('tabindex'), '0')
  assert.ok(play.getAttribute('aria-label'))
  s.watch().key('Enter')
  const p = s.live()
  p.fire('play')
  p.calls.length = 0
  play.key(' ')
  assert.deepEqual(p.did('pause'), [['pause']], 'Space must operate the control')
  play.key('Tab')
  assert.equal(p.did('play').length, 0, 'an unrelated key must do nothing')
})

test('the play control announces the action it will perform', async () => {
  const s = await setup({ member: 'in' })
  const p = s.live()
  p.fire('play')
  assert.match(s.el('playPauseBtn').getAttribute('aria-label'), /Pause/)
  p.fire('pause')
  assert.match(s.el('playPauseBtn').getAttribute('aria-label'), /Play/)
})

test('the watch control names fullscreen when a tap will enter it', async () => {
  const phone = await setup({ member: 'in', width: 375 })
  assert.equal(phone.watch().getAttribute('aria-label'), 'Watch the session in full screen')

  const desk = await setup({ member: 'in', width: 1280 })
  assert.equal(desk.watch().getAttribute('aria-label'), 'Watch the session')

  const gated = await setup({ member: 'out', width: 375 })
  assert.equal(gated.watch().getAttribute('aria-label'), 'Watch the session')
})

test('the click overlay is a pointer-only surface, not an unnamed button', async () => {
  // Pre-existing behaviour change: armControl used to give a null-label layer
  // role=button and tabindex, so Space on a nameless full-bleed control could
  // seize the screen. Keyboard users have the named watch and play controls.
  const s = await setup({ member: 'in', width: 375 })
  const overlay = s.el('videoClickOverlay')
  assert.equal(overlay.hasAttribute('role'), false)
  assert.equal(overlay.hasAttribute('tabindex'), false)
  assert.equal(overlay.hasAttribute('aria-label'), false)
  overlay.key(' ')
  overlay.key('Enter')
  assert.deepEqual(s.live().did('requestFullscreen'), [], 'keyboard must not fire on a pointer-only layer')
  overlay.click()
  assert.deepEqual(s.live().did('requestFullscreen'), [['requestFullscreen']], 'a tap still starts the watch')
})

test('two roots on one page do not share control listeners', async () => {
  // The controls were resolved document-wide, so a second root bound its
  // listeners to the FIRST root's #playPauseBtn: one press played then paused.
  const a = template({ videoId: '111' })
  const b = template({ videoId: '222' })
  const s = await setup({ member: 'in', roots: [a, b] })
  assert.equal(s.api.status().roots, 2)
  const own = b.querySelector('[id="playPauseBtn"]')
  assert.ok(own, 'each root carries its own controls')
  b.querySelector('[data-element-trigger="show-video"]').click()   // arm root b
  // Each root mounts gated then upgrades, so find each root's LIVE player by frame.
  const frameOf = (r) => [...r.querySelector('[data-session-video="stage"]').childNodes].filter((c) => c.nodeName === 'IFRAME').pop()
  const playerOf = (r) => s.players.filter((p) => p.frame === frameOf(r)).pop()
  const pa = playerOf(a), pb = playerOf(b)
  pb.fire('play')
  pb.calls.length = 0
  pa.calls.length = 0
  own.click()
  assert.deepEqual(pb.did('pause'), [['pause']])
  assert.deepEqual(pa.calls, [], 'the other root must be untouched')
})

test('every player promise is terminated so nothing throws into the page', () => {
  // Vimeo rejects play() with NotAllowedError and PlayInterrupted routinely, and
  // freeze() deliberately pauses on top of a play.
  const bare = source.match(/(?<!safe\()\b(?:this|self)\.player\.(?:play|pause|setCurrentTime|setMuted|setVolume|setLoop|requestFullscreen|destroy)\(/g) || []
  assert.deepEqual(bare, [], 'found unguarded player promises: ' + bare.join(', '))
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
  const p = s.live()
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
  const p = s.live()
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

test('a gated frame cannot go fullscreen, and we never touch the button\'s display', async () => {
  const s = await setup()
  const f = s.frame()
  assert.equal(f.hasAttribute('allowfullscreen'), false)
  assert.doesNotMatch(f.getAttribute('allow'), /fullscreen/)
  // Memberstack owns this button's visibility via data-ms-content="members". An
  // inline style from us on an element Memberstack meant to hide is how a
  // members-only control leaks if our answer and theirs disagree.
  // Not asserting on style.display: it can no longer be set, so the assertion
  // could never fail. The source-regex test below is what actually pins it.
  assert.equal(s.el('fullscreenBtn').getAttribute('data-sv-fullscreen'), 'hidden')
})

test('an unauthored data-ms-content on the fullscreen button warns on staging', async () => {
  // The template's Memberstack attribute is the other half of hiding this button.
  // If the Designer state was never authored, QA has to be able to see it.
  const s = await setup()
  assert.ok(s.logs.warn.some((m) => /data-ms-content/.test(m)))
  const prod = await setup({ hostname: 'www.thestarters.com' })
  assert.deepEqual(prod.logs.warn, [], 'and never in production')
})

test('the module never writes an inline display on the fullscreen button', () => {
  assert.doesNotMatch(source, /fullscreen'\)[\s\S]{0,120}style\.display/)
  assert.doesNotMatch(source, /fs\.style\.display/)
})

test('a narrow viewport gives EVERYONE the template controls, member or not', async () => {
  // Below the threshold the template UI is in charge inline (overlay + our bar).
  // A member's iframe still carries Vimeo's bar so fullscreen has an interface;
  // keyboard and pip stay off. A gated viewer stays controls=0.
  const m = await setup({ member: 'in', width: 375 })
  assert.equal(m.root.getAttribute('data-sv-player'), 'custom')
  assert.match(src(m.frame()), /controls=1/)
  assert.match(src(m.frame()), /keyboard=0/)
  assert.match(src(m.frame()), /pip=0/)

  const g = await setup({ member: 'out', width: 375 })
  assert.equal(g.root.getAttribute('data-sv-player'), 'custom')
  assert.match(src(g.frame()), /controls=0/)
})

test('a narrow iPhone member does not load Vimeo\'s bar, so ambient stays chip-free', async () => {
  // iPhone fullscreen is the OS player. controls=1 on a muted autoplay iframe
  // only paints Vimeo's Unmute pill on top of the site header. Android/desktop
  // keep the bar (test above). Fullscreen permission is unchanged.
  const s = await setup({
    member: 'in',
    width: 375,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
  })
  assert.equal(s.root.getAttribute('data-sv-player'), 'custom')
  assert.match(src(s.frame()), /controls=0/)
  assert.match(src(s.frame()), /keyboard=0/)
  assert.match(src(s.frame()), /pip=0/)
  assert.equal(s.frame().hasAttribute('allowfullscreen'), true)
  assert.match(src(s.frame()), /muted=1/)
})

test('a narrow iPhone member still enters fullscreen on the watch tap', async () => {
  // Turning Vimeo's bar off must not drop the OS-player request. Same tap,
  // same gesture, same API call — only the Unmute chip is gone.
  const s = await setup({
    member: 'in',
    width: 375,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
  })
  s.watch().click()
  assert.equal(s.live().did('requestFullscreen').length, 1)
  assert.equal(s.state().armed, true)
})

test('a gated iPhone visitor still has no scrubber', async () => {
  const s = await setup({
    member: 'out',
    width: 375,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
  })
  assert.match(src(s.frame()), /controls=0/)
})

test('a wide iPhone member still gets Vimeo\'s native bar', async () => {
  // Landscape / large iOS where the template already hands the iframe to Vimeo.
  const s = await setup({
    member: 'in',
    width: 1280,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
  })
  assert.equal(s.root.getAttribute('data-sv-player'), 'native')
  assert.match(src(s.frame()), /controls=1/)
})

test('iPadOS-as-Mac still hides the bar on a narrow box', async () => {
  const s = await setup({
    member: 'in',
    width: 375,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    platform: 'MacIntel',
    maxTouchPoints: 5,
  })
  assert.equal(s.root.getAttribute('data-sv-player'), 'custom')
  assert.match(src(s.frame()), /controls=0/)
})

test('a member on a narrow screen keeps the fullscreen permission', async () => {
  // Controls and permission are separate: the template's own button drives
  // fullscreen through the API, so the frame must still allow it.
  const s = await setup({ member: 'in', width: 375 })
  assert.equal(s.frame().hasAttribute('allowfullscreen'), true)
  assert.equal(s.el('fullscreenBtn').getAttribute('data-sv-fullscreen'), 'visible')
})

test('the threshold is overridable without a release', async () => {
  const wide = await setup({ member: 'in', width: 500, roots: [template({ nativeMin: '400' })] })
  assert.equal(wide.root.getAttribute('data-sv-player'), 'native')
  const narrow = await setup({ member: 'in', width: 500, roots: [template({ nativeMin: '900' })] })
  assert.equal(narrow.root.getAttribute('data-sv-player'), 'custom')
})

test('the threshold measures the player box, not the window', async () => {
  // A WIDE window with a NARROW hero column gets exactly the same broken Vimeo UI,
  // so the window is the wrong thing to measure. My first attempt at this test
  // asserted a source regex and mutated green — measuring window.innerWidth instead
  // of the box left all 66 passing. This separates the two dimensions for real.
  const s = await setup({ member: 'in', width: 1400, stageWidth: 320 })
  assert.equal(s.root.getAttribute('data-sv-player'), 'custom', 'narrow box -> template controls')
  assert.match(src(s.frame()), /controls=1/)
  assert.match(src(s.frame()), /keyboard=0/)
  assert.match(src(s.frame()), /pip=0/)
})

test('a narrow window with a wide box still gets native controls', async () => {
  // The mirror case, so the test above cannot pass just by ignoring width entirely.
  const s = await setup({ member: 'in', width: 400, stageWidth: 1200 })
  assert.equal(s.root.getAttribute('data-sv-player'), 'native')
  assert.match(src(s.frame()), /controls=1/)
})

test('the window is used only when the box cannot be measured', async () => {
  const s = await setup({ member: 'in', width: 1400, stageWidth: 0 })
  assert.equal(s.root.getAttribute('data-sv-player'), 'native', 'falls back to the viewport')
})

test('exactly at the threshold counts as wide', async () => {
  const s = await setup({ member: 'in', width: 768 })
  assert.equal(s.root.getAttribute('data-sv-player'), 'native')
})

test('status reports the width fact and whether a watch tap goes fullscreen', async () => {
  const phone = await setup({ member: 'in', width: 375 })
  assert.equal(phone.state().narrow, true)
  assert.equal(phone.state().fullscreenTap, true)
  assert.equal(phone.state().player, 'custom')

  const desk = await setup({ member: 'in', width: 1280 })
  assert.equal(desk.state().narrow, false)
  assert.equal(desk.state().fullscreenTap, false)
  assert.equal(desk.state().player, 'native')

  const gated = await setup({ member: 'out', width: 375 })
  assert.equal(gated.state().fullscreenTap, false, 'gated never tap-to-fullscreen')
  assert.equal(gated.state().narrow, false, 'gated mounts do not measure; unknown until upgrade')
})

test('a member frame allows fullscreen and the button works', async () => {
  const s = await setup({ member: 'in' })
  const f = s.frame()
  assert.equal(f.hasAttribute('allowfullscreen'), true)
  assert.match(f.getAttribute('allow'), /fullscreen/)
  s.el('fullscreenBtn').click()
  assert.deepEqual(s.live().did('requestFullscreen'), [['requestFullscreen']])
})

test('the fullscreen button does nothing for a gated viewer', async () => {
  const s = await setup()
  s.el('fullscreenBtn').click()
  assert.deepEqual(s.players[0].did('requestFullscreen'), [])
})

// ---------------------------------------------------------------------------
// The watch tap goes straight to fullscreen for a member on a narrow player.
//
// On a phone the inline hero is a postage stamp and the separate fullscreen
// button was a second step nobody took. Below the width threshold the member is
// on OUR controls, so the tap is the only sensible route in.
// ---------------------------------------------------------------------------

/** A narrow member mid-watch in fullscreen, with the ambient position carried over. */
async function watchingFullscreen(at = 42) {
  const s = await setup({ member: 'in', width: 375 })
  const p = s.live()
  s.watch().click()
  assert.deepEqual(p.did('requestFullscreen'), [['requestFullscreen']], 'precondition: in fullscreen')
  p.fire('play')
  p.seconds(at)
  p.calls.length = 0
  return { s, p }
}

test('a member on a narrow player enters fullscreen on the watch tap', async () => {
  const s = await setup({ member: 'in', width: 375 })
  const p = s.live()
  p.seconds(6)                          // ambient loop has been running
  p.calls.length = 0
  s.watch().click()
  assert.deepEqual(p.did('requestFullscreen'), [['requestFullscreen']])
  // ...and the shipped watch transition happened anyway, unchanged: sound on, loop
  // off, playing from the ambient position rather than restarting.
  assert.deepEqual(p.did('setMuted'), [['setMuted', false]])
  assert.deepEqual(p.did('setVolume'), [['setVolume', 1]])
  assert.deepEqual(p.did('setLoop'), [['setLoop', false]])
  assert.deepEqual(p.did('play'), [['play']])
  assert.deepEqual(p.did('setCurrentTime'), [], 'must not seek back to 0')
  assert.equal(s.state().position, 6)
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'hidden')
  assert.equal(s.el('video-controls').getAttribute('data-sv-controls'), 'visible')
  assert.equal(s.el('muteBtn').getAttribute('data-sv-mute'), 'off')
  assert.equal(s.state().armed, true)
  assert.equal(s.events.filter((e) => e.type === 'session-video-preview-start').length, 1)
})

test('the fullscreen request rides the tap itself, not a later turn', async () => {
  // Browsers only honour a fullscreen request inside the user activation, so a
  // request deferred to a timer or a promise turn is a request that never happens.
  // Asserted before any await: the call must already be recorded.
  const s = await setup({ member: 'in', width: 375 })
  const p = s.live()
  const timersBefore = s.timers.length
  p.calls.length = 0
  s.watch().click()
  assert.deepEqual(p.did('requestFullscreen'), [['requestFullscreen']], 'same tick as the tap')
  assert.equal(s.timers.length, timersBefore, 'and never scheduled')
  await new Promise((r) => setImmediate(r))
  assert.equal(p.did('requestFullscreen').length, 1, 'and not repeated on a later turn')
})

test('the watch control enters fullscreen from the keyboard as well as a tap', async () => {
  const s = await setup({ member: 'in', width: 375 })
  const s2 = await setup({ member: 'in', width: 375 })
  s.watch().key('Enter')
  assert.deepEqual(s.live().did('requestFullscreen'), [['requestFullscreen']])
  s2.watch().key(' ')
  assert.deepEqual(s2.live().did('requestFullscreen'), [['requestFullscreen']])
})

test('a hero tap during the ambient phase enters fullscreen too, same as the watch control', async () => {
  // #videoClickOverlay and #playPauseBtn both route through toggle(), which calls
  // watch() while the gate is unarmed — the same physical gesture, so it must not
  // lose the activation on the way through.
  const viaOverlay = await setup({ member: 'in', width: 375 })
  viaOverlay.el('videoClickOverlay').click()
  assert.deepEqual(viaOverlay.live().did('requestFullscreen'), [['requestFullscreen']])
  assert.equal(viaOverlay.state().armed, true)

  const viaPlay = await setup({ member: 'in', width: 375 })
  viaPlay.el('playPauseBtn').click()
  assert.deepEqual(viaPlay.live().did('requestFullscreen'), [['requestFullscreen']])
})

test('a member on a wide player keeps today\'s inline watch, with the button as the route in', async () => {
  const s = await setup({ member: 'in', width: 1280 })
  const p = s.live()
  s.watch().click()
  assert.deepEqual(p.did('requestFullscreen'), [], 'Vimeo\'s own bar is in charge up here')
  assert.deepEqual(p.did('play'), [['play']], 'and the watch transition still runs')
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'hidden')
  s.el('fullscreenBtn').click()
  assert.deepEqual(p.did('requestFullscreen'), [['requestFullscreen']], 'the button is unchanged')
})

test('a member on a narrow player still has the fullscreen button beside the tap path', async () => {
  const s = await setup({ member: 'in', width: 375 })
  const p = s.live()
  s.watch().click()
  s.el('fullscreenBtn').click()
  assert.equal(p.did('requestFullscreen').length, 2, 'both routes work, neither replaces the other')
  assert.equal(s.el('fullscreenBtn').getAttribute('data-sv-fullscreen'), 'visible')
})

test('a gated viewer never gets a fullscreen request from a watch tap, at any width', async () => {
  // Their frame is built without the permission on purpose, and the clamp is only
  // enforceable on a surface we still control.
  const narrow = await setup({ member: 'out', width: 375, roots: [template({ cut: '10', bg: '4' })] })
  narrow.watch().click()
  narrow.el('videoClickOverlay').click()
  narrow.watch().key('Enter')
  assert.deepEqual(narrow.players[0].did('requestFullscreen'), [])
  // ...and the clamp and the wall are exactly as shipped.
  narrow.players[0].seconds(10)
  assert.equal(narrow.state().atWall, true)
  assert.equal(narrow.state().position, 10)
  assert.equal(narrow.trigger().clicks, 1)
  assert.equal(narrow.el('fullscreenBtn').getAttribute('data-sv-fullscreen'), 'hidden')

  const wide = await setup({ member: 'out', width: 1280 })
  wide.watch().click()
  assert.deepEqual(wide.players[0].did('requestFullscreen'), [])
})

test('a tap that lands before membership resolves plays inline with no fullscreen request', async () => {
  // The early tap is the whole reason the fallback exists: the frame in front of the
  // viewer is still the gated one, which carries no permission. Waiting for the
  // answer would forfeit the gesture window, so the tap plays inline instead.
  const s = await setup({ member: 'late', width: 375, watchClick: true, watch: (p) => p.seconds(4) })
  assert.equal(s.gatedBeforeLate, true, 'the tap must have landed on the gated frame')
  assert.deepEqual(s.players[0].did('requestFullscreen'), [], 'no request from the gated frame')
  assert.deepEqual(s.players[0].did('play'), [['play']], 'inline watch proceeded as shipped')
  assert.deepEqual(s.players[0].did('setMuted'), [['setMuted', false]], 'with the sound on')
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'hidden')
  assert.equal(s.el('video-controls').getAttribute('data-sv-controls'), 'visible')
  // No error state either. The harness template authors no data-ms-content, so that
  // one known warning is excluded — anything else about fullscreen here is a fault.
  assert.deepEqual(
    s.logs.warn.filter((m) => /fullscreen/i.test(m) && !/data-ms-content/.test(m)),
    [],
    'an early tap must not report a fullscreen problem',
  )
})

test('the upgrade\'s own watch re-run never requests fullscreen', async () => {
  // upgrade() re-runs watch() to restore the watching state after rebuilding the
  // frame. That call is not a user gesture: a browser would refuse it anyway, and
  // seizing a member's screen because their membership answer arrived late is not
  // the behaviour anyone asked for. Passing the activation flag from upgrade(), or
  // keying the request off "watch() ran", must fail this.
  const s = await setup({ member: 'late', width: 375, watchClick: true, watch: (p) => p.seconds(4) })
  const requests = s.players.reduce((n, p) => n + p.did('requestFullscreen').length, 0)
  assert.equal(requests, 0, 'no player may be asked to go fullscreen without a tap')
  // The upgrade itself still did its job: full frame, restored position, watching.
  assert.equal(s.players.length, 2)
  assert.equal(s.state().gated, false)
  assert.equal(s.root.getAttribute('data-sv-player'), 'custom')
  assert.match(src(s.frame()), /controls=1/, 'ungated narrow still carries Vimeo\'s bar for fullscreen')
  assert.match(src(s.frame()), /keyboard=0/)
  assert.equal(s.frame().hasAttribute('allowfullscreen'), true)
  assert.deepEqual(s.players[1].did('setCurrentTime'), [['setCurrentTime', 4]])
  assert.deepEqual(s.players[1].did('play'), [['play']])
  assert.equal(s.state().armed, true)
})

test('a refused fullscreen request leaves inline playback intact and rejects nowhere', async () => {
  // Vimeo rejects this call on platforms that will not grant it. A refusal is the
  // designed fallback, not an error: the transition has already run, so the member
  // simply watches inline with the sound on and the controls up.
  const s = await setup({ member: 'in', width: 375 })
  const p = s.live()
  p.refuseFullscreen = true
  const unhandled = []
  const onUnhandled = (e) => unhandled.push(e)
  process.on('unhandledRejection', onUnhandled)
  try {
    s.watch().click()
    assert.deepEqual(p.did('requestFullscreen'), [['requestFullscreen']])
    p.fire('play')
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setTimeout(r, 0))
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
  assert.deepEqual(unhandled, [], 'nothing may reject into the page')
  assert.equal(s.state().armed, true)
  assert.equal(s.state().playing, true)
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'hidden')
  assert.equal(s.el('video-controls').getAttribute('data-sv-controls'), 'visible')
  assert.equal(s.el('muteBtn').getAttribute('data-sv-mute'), 'off')
  assert.deepEqual(p.did('setLoop'), [['setLoop', false]])
})

// ---------------------------------------------------------------------------
// Leaving fullscreen pauses; the next watch tap goes back in.
//
// An exit reads as "I'm done for now", not as "keep the audio going in a
// postage stamp". The pause shape is the template's shipped one, reached by
// pausing the player rather than by painting a second copy of it here.
// ---------------------------------------------------------------------------

test('leaving fullscreen pauses the video and brings the hero back, position kept', async () => {
  const { s, p } = await watchingFullscreen(42)
  p.fullscreen(false)
  assert.deepEqual(p.did('pause'), [['pause']], 'the exit pauses through the player')
  p.fire('pause')                       // the player confirms, as it does for any pause
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'visible')
  assert.equal(s.el('video-controls').getAttribute('data-sv-controls'), 'hidden')
  assert.equal(s.el('playPauseBtn').getAttribute('data-sv-play'), 'paused')
  assert.equal(s.state().playing, false)
  assert.equal(s.state().position, 42, 'the position is pinned, not rewound')
  assert.deepEqual(p.did('setCurrentTime'), [], 'and nothing seeks')
  assert.equal(s.state().armed, true, 'still watching, just paused')
  assert.equal(s.state().atWall, false)
})

test('entering fullscreen is not mistaken for leaving it', async () => {
  // One event carries both directions. Acting on the enter would pause the video
  // the instant it went fullscreen.
  const { p } = await watchingFullscreen()
  p.fullscreen(true)
  assert.deepEqual(p.did('pause'), [], 'entering must never pause')
})

test('leaving fullscreen during the ambient phase does not freeze the muted loop', async () => {
  // Confirmed member, narrow, never tapped watch: still ambient. An OS or
  // browser fullscreenchange(false) must not pause() — onPause returns early
  // on !armed, timeupdates stop, and the hero loop freezes.
  const s = await setup({ member: 'in', width: 375 })
  const p = s.live()
  p.seconds(3)
  p.calls.length = 0
  p.fullscreen(false)
  assert.deepEqual(p.did('pause'), [], 'ambient exit must not pause')
  assert.equal(s.state().armed, false)
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'visible', 'overlay still covering')
  assert.equal(s.el('video-controls').getAttribute('data-sv-controls'), 'hidden')
})

test('a fullscreen-change with no usable direction is ignored', async () => {
  // Defensive: if a platform emits the event bare, the failure mode must be "no
  // pause on exit", never a pause at the wrong moment and never a throw.
  const { s, p } = await watchingFullscreen()
  p.fire('fullscreenchange')
  p.fire('fullscreenchange', {})
  assert.deepEqual(p.did('pause'), [])
  assert.equal(s.state().playing, true)
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'hidden')
})

test('the next watch tap re-enters fullscreen from the kept position', async () => {
  const { s, p } = await watchingFullscreen(42)
  p.fullscreen(false)
  p.fire('pause')
  p.calls.length = 0
  s.watch().click()
  assert.deepEqual(p.did('requestFullscreen'), [['requestFullscreen']], 'resume is one tap, same as starting')
  assert.deepEqual(p.did('play'), [['play']])
  assert.deepEqual(p.did('setCurrentTime'), [], 'resumes where it stopped, no seek needed')
  assert.equal(s.state().position, 42)
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'hidden')
  assert.equal(s.el('video-controls').getAttribute('data-sv-controls'), 'visible')
  assert.equal(s.events.filter((e) => e.type === 'session-video-preview-start').length, 1, 'and never re-counts the funnel')
})

test('every exit and resume cycle behaves the same', async () => {
  // The armed branch of the watch control is what makes this repeatable; a
  // first-tap-only implementation passes the entry test and fails here.
  const s = await setup({ member: 'in', width: 375 })
  const p = s.live()
  for (let i = 1; i <= 3; i += 1) {
    s.watch().click()
    assert.equal(p.did('requestFullscreen').length, i, 'tap ' + i + ' must enter fullscreen')
    assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'hidden')
    p.fire('play')
    p.seconds(60 * i)
    p.fullscreen(false)
    assert.equal(p.did('pause').length, i, 'exit ' + i + ' must pause')
    p.fire('pause')
    assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'visible')
    assert.equal(s.state().position, 60 * i, 'each cycle keeps its own position')
  }
})

test('the play control is not a fullscreen route', async () => {
  // After an exit the overlay is up, so the watch control is the surface the member
  // is looking at. #playPauseBtn stays plain play/pause.
  const { s, p } = await watchingFullscreen()
  p.fullscreen(false)
  p.fire('pause')
  p.calls.length = 0
  s.el('playPauseBtn').click()
  assert.deepEqual(p.did('play'), [['play']], 'it still plays')
  assert.deepEqual(p.did('requestFullscreen'), [], 'but it does not go fullscreen')
  s.el('videoClickOverlay').click()
  assert.deepEqual(p.did('requestFullscreen'), [], 'nor does the click layer once armed')
})

test('a member on a wide player sees no change from the fullscreen-change handling', async () => {
  // Up here fullscreen is Vimeo's own UI or the button, and an exit must leave
  // playback exactly as it is today.
  const s = await setup({ member: 'in', width: 1280 })
  const p = s.live()
  s.watch().click()
  s.el('fullscreenBtn').click()
  p.fire('play')
  p.seconds(30)
  p.calls.length = 0
  p.fullscreen(false)
  assert.deepEqual(p.did('pause'), [], 'no pause-on-exit for a wide player')
  assert.equal(s.state().playing, true)
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'hidden')
  s.watch().click()
  assert.deepEqual(p.did('requestFullscreen'), [], 'and no re-entry on a resume tap either')
})

test('a gated viewer\'s fullscreen-change is inert, and the clamp is untouched', async () => {
  const s = await setup({ member: 'out', width: 375, roots: [template({ cut: '10', bg: '4' })] })
  const p = s.players[0]
  s.watch().click()
  p.fire('play')
  p.seconds(5)
  p.calls.length = 0
  p.fullscreen(false)                   // cannot happen, and must do nothing if it does
  assert.deepEqual(p.did('pause'), [])
  assert.equal(s.state().playing, true)
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'hidden')
  p.seconds(10)
  assert.equal(s.state().atWall, true)
  assert.equal(s.state().position, 10)
  assert.equal(s.trigger().clicks, 1)
})

test('a gated tap at the wall opens the wall and nothing else', async () => {
  // The wall check has to stay ahead of everything the armed branch does.
  const s = await setup({ member: 'out', width: 375, roots: [template({ cut: '10', bg: '4' })] })
  const p = s.players[0]
  s.watch().click()
  p.seconds(10)
  assert.equal(s.trigger().clicks, 1)
  p.calls.length = 0
  s.watch().click()
  assert.equal(s.trigger().clicks, 2)
  assert.deepEqual(p.did('requestFullscreen'), [])
  assert.deepEqual(p.did('play'), [], 'a frozen frame must not be played')
})

test('the fullscreen handling survives the upgrade remount', async () => {
  // upgrade() rebuilds the frame and constructs a NEW player, so the
  // fullscreen-change listener has to be registered where the other player events
  // are. Registering it outside mount() leaves a late-confirmed member with a
  // fullscreen they can enter and never exit cleanly.
  const s = await setup({ member: 'late', width: 375, watchClick: true, watch: (p) => p.seconds(4) })
  const p = s.live()
  assert.equal(s.state().gated, false)
  assert.equal(s.state().armed, true)
  p.calls.length = 0
  s.watch().click()
  assert.deepEqual(p.did('requestFullscreen'), [['requestFullscreen']], 'the rebuilt player takes the tap')
  p.fire('play')
  p.fullscreen(false)
  assert.deepEqual(p.did('pause'), [['pause']], 'and the rebuilt player is listened to')
  p.fire('pause')
  assert.equal(s.overlay().getAttribute('data-sv-overlay'), 'visible')
  assert.equal(s.state().position, 4, 'with the position carried through the upgrade')
})

test('neither watch branch hardcodes the activation flag', () => {
  // Both branches must forward the caller's flag. There is no gestureless caller of
  // the ARMED branch to catch a hardcoded `true` from the outside — upgrade() enters
  // through the unarmed one — so the source is what pins it, in the same spirit as
  // the late-watcher count test above.
  assert.doesNotMatch(source, /enterFullscreen\(\s*(?:true|1)\s*\)/)
  assert.doesNotMatch(source, /self\.watch\(true\)/)
  assert.doesNotMatch(source, /self\.toggle\(true\)/)
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
  // The previous version of this test used member:'never', so getCurrentMember
  // never answered, upgrade() was never reached, and it asserted that NOTHING
  // happened. upgrade() had zero coverage: deleting the method kept it green.
  // 'late' answers only AFTER the budget has already gated the mount.
  const s = await setup({ member: 'late', watch: (p) => p.seconds(9) })
  assert.equal(s.gatedBeforeLate, true, 'must have gated while the answer was outstanding')

  assert.equal(s.players.length, 2, 'the gated frame is replaced, not reused')
  assert.deepEqual(s.players[0].did('destroy'), [['destroy']])
  const f = s.frame()
  assert.equal(f.hasAttribute('allowfullscreen'), true, 'the member frame allows fullscreen')
  assert.deepEqual(s.players[1].did('setCurrentTime'), [['setCurrentTime', 9]], 'resumes where it was')
  assert.equal(s.state().gated, false)
})

test('a late upgrade does not double-count preview-start', async () => {
  const s = await setup({ member: 'late', watch: (p) => { p.seconds(4) } , watchClick: true })
  assert.equal(s.events.filter((e) => e.type === 'session-video-preview-start').length, 1)
})

test('a missing Memberstack SDK still watches for a late answer', async () => {
  // 'no-sdk' is reported settled, but NOT certain, so the late watcher must arm.
  // Reporting it certain left a member whose SDK loaded after us gated for the
  // whole page life.
  const s = await setup({ member: 'no-sdk' })
  assert.equal(s.state().gated, true)
  // Both late watchers — the mounted one and the no-library one — must arm on
  // !certain. The SDK is absent in this harness, so the watcher itself cannot be
  // observed from the outside; the source is what pins the condition.
  assert.equal((source.match(/!state\.certain\)\s*\{?\s*watchForLateMember/g) || []).length, 2)
})

test('the play control is not double-bound by a remount', async () => {
  const s = await setup({ member: 'in' })
  const p = s.live()
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
  // Also must not reach for modal.js's trigger attribute itself: the trigger is
  // found by its data-session-video role, and the modal name stays in the Designer.
  assert.doesNotMatch(source, /querySelector[^\n]*data-modal-trigger/)
})

test('the release marker in the header matches the API', () => {
  const header = /@release (v\d+\.\d+\.\d+)/.exec(source)
  const api = /var RELEASE = '(v\d+\.\d+\.\d+)'/.exec(source)
  assert.ok(header && api)
  assert.equal(header[1], api[1])
})
