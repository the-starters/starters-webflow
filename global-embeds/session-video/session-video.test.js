const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE_PATH = path.join(__dirname, 'session-video.js')
const source = fs.readFileSync(SOURCE_PATH, 'utf8')

// ---------------------------------------------------------------------------
// Minimal DOM, same spirit as learn-cta-gate.test.js (there is no jsdom in this
// repo): attributes, a plain style bag, a parent/child tree, a tiny selector
// engine covering only the [attr="value"] shapes this module queries, plus real
// listener dispatch so click() and keydown exercise the same path a browser
// would. Timers are queued rather than run, so the member and library budgets
// are driven explicitly instead of waited on.
// ---------------------------------------------------------------------------

/**
 * childNodes is deliberately NOT an Array. A real `childNodes` is a NodeList:
 * length, item(), forEach() and indexed access, but NO indexOf, splice, find,
 * map or push. An Array here is a fake the DOM does not match, and it silently
 * greenlit a `kids.indexOf(frame); kids.splice(i, 1)` that threw TypeError in
 * every browser. Keep this shape narrow so that class of bug fails in the test.
 */
class NodeList {
  constructor() {
    this._items = []
  }
  get length() {
    return this._items.length
  }
  item(i) {
    return this._items[i] || null
  }
  forEach(fn, thisArg) {
    this._items.forEach(fn, thisArg)
  }
  [Symbol.iterator]() {
    return this._items[Symbol.iterator]()
  }
  /** internal, standing in for the parser/DOM mutation the browser does */
  _insert(node) {
    this._items.push(node)
    this._reindex()
  }
  _delete(node) {
    const i = this._items.indexOf(node)
    if (i < 0) return false
    this._items.splice(i, 1)
    this._reindex()
    return true
  }
  _reindex() {
    let i = 0
    while (Object.prototype.hasOwnProperty.call(this, String(i))) delete this[i++]
    this._items.forEach((n, idx) => {
      this[idx] = n
    })
  }
}

class Element {
  constructor(nodeName, attrs = {}) {
    this.nodeName = String(nodeName).toUpperCase()
    this.nodeType = 1
    this._attrs = new Map(Object.entries(attrs).map(([k, v]) => [k, String(v)]))
    this.style = {}
    this.childNodes = new NodeList()
    this.parentNode = null
    this._listeners = new Map()
    this.clicks = 0
  }

  remove() {
    if (this.parentNode) this.parentNode.childNodes._delete(this)
    this.parentNode = null
  }

  removeChild(node) {
    this.childNodes._delete(node)
    node.parentNode = null
    return node
  }

  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null
  }
  setAttribute(name, value) {
    this._attrs.set(name, String(value))
  }
  hasAttribute(name) {
    return this._attrs.has(name)
  }

  append(...kids) {
    kids.forEach((k) => {
      k.parentNode = this
      this.childNodes._insert(k)
    })
    return this
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, [])
    this._listeners.get(type).push(fn)
  }

  /** Records the call AND dispatches, so a synthesized click behaves like a real one. */
  click() {
    this.clicks += 1
    this._dispatch('click', { preventDefault() {} })
  }

  key(name) {
    this._dispatch('keydown', { key: name, preventDefault() {} })
  }

  _dispatch(type, event) {
    ;(this._listeners.get(type) || []).forEach((fn) => fn(event))
  }

  descendants() {
    const out = []
    const walk = (n) => {
      n.childNodes.forEach((c) => {
        out.push(c)
        if (c.nodeType === 1) walk(c)
      })
    }
    walk(this)
    return out
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null
  }
  querySelectorAll(sel) {
    return this.descendants().filter((n) => n.nodeType === 1 && matches(n, sel))
  }
}

function matches(el, sel) {
  let rest = String(sel).trim()
  if (!rest) return false
  while (rest) {
    const attr = /^\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?\]/.exec(rest)
    if (!attr) return false
    const value = el.getAttribute(attr[1])
    if (value === null) return false
    const expected = attr[2] !== undefined ? attr[2] : attr[3]
    if (expected !== undefined && value !== expected) return false
    rest = rest.slice(attr[0].length)
  }
  return true
}

function h(nodeName, attrs, kids = []) {
  const el = new Element(nodeName, attrs)
  kids.forEach((k) => el.append(k))
  return el
}

/** The authored Sessions template, reduced to what this module reads. */
function template({ videoId = '1212735272', cut = null, withTrigger = true, withStage = true } = {}) {
  const parts = []
  if (withStage) parts.push(h('div', { 'data-session-video': 'stage' }))
  parts.push(h('div', { 'data-session-video': 'play' }))
  parts.push(h('div', { 'data-session-video': 'progress' }))
  if (withTrigger) {
    parts.push(h('div', { 'data-session-video': 'signup-trigger', 'data-modal-trigger': 'authored-by-designer' }))
  }
  const rootAttrs = { 'data-session-video': 'root' }
  if (videoId !== null) rootAttrs['data-session-video-id'] = videoId
  if (cut !== null) rootAttrs['data-session-video-cut'] = cut
  return h('div', rootAttrs, parts)
}

class FakePlayer {
  constructor(frame, registry) {
    this.frame = frame
    this.calls = []
    this.handlers = new Map()
    registry.push(this)
  }
  on(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, [])
    this.handlers.get(name).push(fn)
  }
  play() {
    this.calls.push(['play'])
    return Promise.resolve()
  }
  pause() {
    this.calls.push(['pause'])
    return Promise.resolve()
  }
  setCurrentTime(s) {
    this.calls.push(['setCurrentTime', s])
    return Promise.resolve(s)
  }
  destroy() {
    this.calls.push(['destroy'])
    return Promise.resolve()
  }
  fire(name, data) {
    ;(this.handlers.get(name) || []).forEach((fn) => fn(data))
  }
  seconds(n, duration = 2220) {
    this.fire('timeupdate', { seconds: n, duration, percent: n / duration })
  }
}

async function setup({
  member = 'none', // 'none' | 'member' | 'never' | 'rejected'
  lateMember = false, // settle memberReady only AFTER the budget has expired
  watch = null, // driven against the gated player before a late upgrade
  withLib = true,
  hostname = 'the-starters-3-0.webflow.io',
  roots = [template()],
} = {}) {
  const body = h('body', {})
  roots.forEach((r) => body.append(r))

  const players = []
  const timers = []
  const events = []
  const logs = { warn: [], info: [] }

  const document = {
    readyState: 'complete',
    body,
    createElement: (tag) => new Element(tag),
    querySelector: (s) => body.querySelector(s),
    querySelectorAll: (s) => body.querySelectorAll(s),
    addEventListener: () => {},
  }

  const windowObj = {
    location: { hostname, pathname: '/learn/sessions/a-b-tests-worth-running' },
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms })
      return timers.length
    },
    dispatchEvent: (e) => events.push(e),
    CustomEvent: class {
      constructor(type, init) {
        this.type = type
        this.detail = init && init.detail
      }
    },
  }

  let release = null
  if (member !== 'absent') {
    windowObj.memberReady = new Promise((resolve, reject) => {
      release = () => {
        if (member === 'rejected') reject(new Error('ms failed'))
        else resolve(member === 'member' ? { id: 'mem_1' } : null)
      }
    })
    windowObj.memberReady.catch(() => {})
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
    windowObj.Vimeo = { Player: class extends FakePlayer {
      constructor(frame) {
        super(frame, players)
      }
    } }
  }
  context.globalThis = context

  vm.createContext(context)
  vm.runInContext(source, context, { filename: 'session-video.js' })

  const settle = () => new Promise((r) => setImmediate(r))
  const drain = () => timers.splice(0).forEach((t) => t.fn())

  if (!lateMember && member !== 'never' && release) release()
  // Let the member/lib promises settle, then drain any budget timers that the
  // module is still waiting on, then settle again.
  await settle()
  drain()
  await settle()
  drain()
  await settle()

  const stageOf = (root) => root.querySelector('[data-session-video="stage"]')

  // A late upgrade needs the gated mount to exist first, so it is driven here
  // rather than by the caller: expire the budget, act on the gated player, then
  // let membership settle.
  let gatedBeforeUpgrade = null
  if (lateMember) {
    gatedBeforeUpgrade = windowObj.StartersSessionVideo.status().sessions[0].gated
    if (watch && players[0]) watch(players[0])
    if (release) release()
    await settle()
    drain()
    await settle()
  }

  return {
    gatedBeforeUpgrade,
    api: windowObj.StartersSessionVideo,
    root: roots[0],
    players,
    events,
    logs,
    body,
    frame: () => [...stageOf(roots[0]).childNodes].find((c) => c.nodeName === 'IFRAME') || null,
    trigger: () => roots[0].querySelector('[data-session-video="signup-trigger"]'),
    playControl: () => roots[0].querySelector('[data-session-video="play"]'),
    progress: () => roots[0].querySelector('[data-session-video="progress"]'),
  }
}

const src = (frame) => frame.getAttribute('src')

// ---------------------------------------------------------------------------
// The clamp
// ---------------------------------------------------------------------------

test('a logged-out viewer is stopped at the cut point', async () => {
  const s = await setup()
  const p = s.players[0]
  p.seconds(179)
  assert.equal(s.api.status().sessions[0].atWall, false)
  p.seconds(180)
  const status = s.api.status().sessions[0]
  assert.equal(status.atWall, true)
  assert.equal(status.position, 180)
  assert.deepEqual(p.calls, [['pause'], ['setCurrentTime', 180]])
})

test('the clamp holds across repeated progress events', async () => {
  const s = await setup()
  const p = s.players[0]
  p.seconds(181)
  p.seconds(190)
  p.seconds(240)
  assert.equal(s.api.status().sessions[0].position, 180)
  const seeks = p.calls.filter((c) => c[0] === 'setCurrentTime')
  assert.ok(seeks.every((c) => c[1] === 180))
})

test('a seek past the cut point is clamped back', async () => {
  const s = await setup()
  const p = s.players[0]
  p.fire('seeked', { seconds: 900 })
  assert.equal(s.api.status().sessions[0].atWall, true)
  assert.equal(s.api.status().sessions[0].position, 180)
})

test('the clamp does not re-enter on the seek it provokes', async () => {
  const s = await setup()
  const p = s.players[0]
  p.seconds(180)
  const before = p.calls.length
  // player.js emits `seeked` in response to setCurrentTime; that must be swallowed.
  p.fire('seeked', { seconds: 180 })
  assert.equal(p.calls.length, before)
})

// ---------------------------------------------------------------------------
// The wall
// ---------------------------------------------------------------------------

test('reaching the cut point clicks the authored signup trigger', async () => {
  const s = await setup()
  s.players[0].seconds(180)
  assert.equal(s.trigger().clicks, 1)
})

test('pressing play while clamped reopens the wall', async () => {
  const s = await setup()
  const p = s.players[0]
  p.seconds(180)
  assert.equal(s.trigger().clicks, 1)
  p.fire('play')
  assert.equal(s.trigger().clicks, 2)
  assert.equal(s.api.status().sessions[0].wallOpens, 2)
})

test('the custom control reopens the wall rather than playing, once clamped', async () => {
  const s = await setup()
  const p = s.players[0]
  p.seconds(180)
  const playsBefore = p.calls.filter((c) => c[0] === 'play').length
  s.playControl().click()
  assert.equal(s.trigger().clicks, 2)
  assert.equal(p.calls.filter((c) => c[0] === 'play').length, playsBefore)
})

test('a missing signup trigger warns on staging instead of throwing', async () => {
  const s = await setup({ roots: [template({ withTrigger: false })] })
  s.players[0].seconds(180)
  assert.ok(s.logs.warn.some((m) => /signup-trigger/.test(m)))
})

// ---------------------------------------------------------------------------
// Bypass routes closed at construction
// ---------------------------------------------------------------------------

test('a gated player is built with controls, keyboard and pip off and no fullscreen', async () => {
  const s = await setup()
  const frame = s.frame()
  assert.match(src(frame), /controls=0/)
  assert.match(src(frame), /keyboard=0/)
  assert.match(src(frame), /pip=0/)
  assert.equal(frame.hasAttribute('allowfullscreen'), false)
  assert.doesNotMatch(frame.getAttribute('allow') || '', /fullscreen/)
})

test('a member player gets real controls and fullscreen', async () => {
  const s = await setup({ member: 'member' })
  const frame = s.frame()
  assert.match(src(frame), /controls=1/)
  assert.match(src(frame), /keyboard=1/)
  assert.match(src(frame), /pip=1/)
  assert.equal(frame.hasAttribute('allowfullscreen'), true)
  assert.match(frame.getAttribute('allow'), /fullscreen/)
})

// ---------------------------------------------------------------------------
// Member state
// ---------------------------------------------------------------------------

test('a member is never clamped and never sees the wall', async () => {
  const s = await setup({ member: 'member' })
  const p = s.players[0]
  p.seconds(600)
  const status = s.api.status().sessions[0]
  assert.equal(status.gated, false)
  assert.equal(status.atWall, false)
  assert.equal(status.position, 600)
  assert.equal(s.trigger().clicks, 0)
  assert.equal(p.calls.length, 0)
})

test('member state that never settles fails closed', async () => {
  const s = await setup({ member: 'never' })
  assert.equal(s.api.status().sessions[0].gated, true)
  assert.ok(s.logs.warn.some((m) => /did not settle/.test(m)))
})

test('a rejected member promise gates rather than opening up', async () => {
  const s = await setup({ member: 'rejected' })
  assert.equal(s.api.status().sessions[0].gated, true)
})

test('late member resolution upgrades to the full video at the same position', async () => {
  // The budget expires first (so the mount is gated), and only then does
  // memberReady settle as a member, which is what a slow auth check looks like.
  const s = await setup({ member: 'member', lateMember: true, watch: (h) => h.seconds(90) })
  assert.equal(s.gatedBeforeUpgrade, true, 'should have gated while the budget was open')

  assert.equal(s.players.length, 2, 'the gated player is replaced, not reused')
  assert.deepEqual(s.players[0].calls.slice(-1), [['destroy']])

  const frame = s.frame()
  assert.equal(frame.hasAttribute('allowfullscreen'), true)
  assert.match(src(frame), /controls=1/)

  assert.deepEqual(s.players[1].calls, [['setCurrentTime', 90]], 'resumes where the gated player was')
  assert.equal(s.api.status().sessions[0].gated, false)
})

test('late resolution as a non-member leaves the gate in place', async () => {
  const s = await setup({ member: 'none', lateMember: true })
  assert.equal(s.players.length, 1)
  assert.equal(s.api.status().sessions[0].gated, true)
})

test('the play control is not double-armed by an upgrade', async () => {
  const s = await setup({ member: 'member', lateMember: true })
  const p = s.players[1]
  p.calls.length = 0
  s.playControl().click()
  // One activation must mean one call, not a play immediately undone by a pause.
  assert.deepEqual(p.calls, [['play']])
})

// ---------------------------------------------------------------------------
// The cut point
// ---------------------------------------------------------------------------

test('a per-session override replaces the default', async () => {
  const s = await setup({ roots: [template({ cut: '45' })] })
  assert.equal(s.api.status().sessions[0].cut, 45)
  s.players[0].seconds(45)
  assert.equal(s.api.status().sessions[0].atWall, true)
})

test('an unusable override falls back to the default and warns', async () => {
  const s = await setup({ roots: [template({ cut: 'soon' })] })
  assert.equal(s.api.status().sessions[0].cut, 180)
  assert.ok(s.logs.warn.some((m) => /unusable/.test(m)))
})

test('a zero or negative override falls back rather than stopping instantly', async () => {
  const s = await setup({ roots: [template({ cut: '0' })] })
  assert.equal(s.api.status().sessions[0].cut, 180)
})

test('an empty override is the default, with no warning', async () => {
  const s = await setup({ roots: [template({ cut: '' })] })
  assert.equal(s.api.status().sessions[0].cut, 180)
  assert.equal(s.logs.warn.filter((m) => /unusable/.test(m)).length, 0)
})

// ---------------------------------------------------------------------------
// Progress indicator
// ---------------------------------------------------------------------------

test('the progress fill is relative to the cut point, not the runtime', async () => {
  const s = await setup()
  s.players[0].seconds(90, 2220)
  // 90s of a 180s preview is half, even though it is a fraction of a 37min video.
  assert.equal(s.progress().style.width, '50%')
})

test('the progress fill never exceeds full', async () => {
  const s = await setup()
  s.players[0].seconds(600)
  assert.equal(s.progress().style.width, '100%')
})

test('a member progress fill is relative to the real runtime', async () => {
  const s = await setup({ member: 'member' })
  s.players[0].seconds(1110, 2220)
  assert.equal(s.progress().style.width, '50%')
})

// ---------------------------------------------------------------------------
// Accessibility of the custom control
// ---------------------------------------------------------------------------

test('an authored div play control is given button semantics', async () => {
  const s = await setup()
  const control = s.playControl()
  assert.equal(control.getAttribute('role'), 'button')
  assert.equal(control.getAttribute('tabindex'), '0')
  assert.ok(control.getAttribute('aria-label'))
})

test('the play control is operable by keyboard', async () => {
  const s = await setup()
  const p = s.players[0]
  s.playControl().key('Enter')
  assert.equal(p.calls.filter((c) => c[0] === 'play').length, 1)
  s.playControl().key(' ')
  assert.equal(p.calls.filter((c) => c[0] === 'pause').length, 1)
})

test('an unrelated key does not operate the control', async () => {
  const s = await setup()
  s.playControl().key('Tab')
  assert.equal(s.players[0].calls.length, 0)
})

test('a native pause keeps the custom control in sync', async () => {
  // A member has BOTH native controls and the custom one. Driving the native
  // controls must not desync ours, or the next custom click does the wrong thing.
  const s = await setup({ member: 'member' })
  const p = s.players[0]
  s.playControl().click() // custom play
  p.fire('play')
  p.fire('pause') // user paused with the NATIVE control
  p.calls.length = 0
  s.playControl().click()
  assert.deepEqual(p.calls, [['play']], 'should play again, not pause an already-paused video')
})

test('a native play keeps the custom control in sync', async () => {
  const s = await setup({ member: 'member' })
  const p = s.players[0]
  p.fire('play') // user pressed the NATIVE play
  p.calls.length = 0
  s.playControl().click()
  assert.deepEqual(p.calls, [['pause']], 'should pause, not issue a second play')
})

test('the control relabels so it announces the action it will perform', async () => {
  const s = await setup({ member: 'member' })
  const p = s.players[0]
  assert.match(s.playControl().getAttribute('aria-label'), /^Play/)
  p.fire('play')
  assert.match(s.playControl().getAttribute('aria-label'), /^Pause/)
  p.fire('pause')
  assert.match(s.playControl().getAttribute('aria-label'), /^Play/)
})

test('preview-start does not fire for a member, who has no preview', async () => {
  const s = await setup({ member: 'member' })
  s.players[0].seconds(30)
  assert.equal(s.events.filter((e) => e.type === 'session-video-preview-start').length, 0)
})

test('aria-pressed tracks playback', async () => {
  const s = await setup()
  const p = s.players[0]
  p.fire('play')
  assert.equal(s.playControl().getAttribute('aria-pressed'), 'true')
  p.seconds(180)
  assert.equal(s.playControl().getAttribute('aria-pressed'), 'false')
})

// ---------------------------------------------------------------------------
// Degraded paths
// ---------------------------------------------------------------------------

test('a session with no video id is left exactly as authored', async () => {
  const s = await setup({ roots: [template({ videoId: null })] })
  assert.equal(s.frame(), null)
  assert.equal(s.players.length, 0)
  assert.equal(s.api.status().roots, 0)
})

test('no player library means a gated viewer gets no video at all', async () => {
  const s = await setup({ withLib: false })
  assert.equal(s.frame(), null)
  assert.ok(s.logs.warn.some((m) => /library unavailable/.test(m)))
})

test('no player library still serves a member a plain embed', async () => {
  const s = await setup({ withLib: false, member: 'member' })
  const frame = s.frame()
  assert.ok(frame, 'a member should still get the video')
  assert.match(src(frame), /controls=1/)
  assert.equal(frame.hasAttribute('allowfullscreen'), true)
})

test('a root with no stage warns rather than throwing', async () => {
  const s = await setup({ roots: [template({ withStage: false })] })
  assert.ok(s.logs.warn.some((m) => /stage/.test(m)))
})

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

test('preview start fires once, on first real progress', async () => {
  const s = await setup()
  const p = s.players[0]
  p.seconds(0)
  assert.equal(s.events.filter((e) => e.type === 'session-video-preview-start').length, 0)
  p.seconds(2)
  p.seconds(4)
  assert.equal(s.events.filter((e) => e.type === 'session-video-preview-start').length, 1)
})

test('the wall event fires once even though the wall opens repeatedly', async () => {
  const s = await setup()
  const p = s.players[0]
  p.seconds(180)
  p.fire('play')
  p.fire('play')
  assert.equal(s.events.filter((e) => e.type === 'session-video-wall').length, 1)
  assert.equal(s.api.status().sessions[0].wallOpens, 3)
})

test('completion fires for a member finishing the video', async () => {
  const s = await setup({ member: 'member' })
  s.players[0].fire('ended')
  const done = s.events.filter((e) => e.type === 'session-video-complete')
  assert.equal(done.length, 1)
  assert.equal(done[0].detail.gated, false)
})

test('event detail carries the session identity', async () => {
  const s = await setup()
  s.players[0].seconds(180)
  const wall = s.events.find((e) => e.type === 'session-video-wall')
  assert.equal(wall.detail.videoId, '1212735272')
  assert.equal(wall.detail.cut, 180)
})

// ---------------------------------------------------------------------------
// Public API, diagnostics and the module's contract with modal.js
// ---------------------------------------------------------------------------

test('reveal() forces the wall open for console debugging', async () => {
  const s = await setup()
  s.api.reveal()
  assert.equal(s.trigger().clicks, 1)
  assert.equal(s.api.status().sessions[0].atWall, true)
})

test('status reports the release marker', async () => {
  const s = await setup()
  assert.match(s.api.release, /^v\d+\.\d+\.\d+$/)
  assert.equal(s.api.status().release, s.api.release)
})

test('diagnostics are silent in production', async () => {
  const s = await setup({ hostname: 'www.thestarters.com', roots: [template({ cut: 'soon' })] })
  assert.deepEqual(s.logs.warn, [])
  assert.deepEqual(s.logs.info, [])
})

test('several sessions on one page stay independent', async () => {
  const s = await setup({ roots: [template({ videoId: '111' }), template({ videoId: '222', cut: '30' })] })
  assert.equal(s.api.status().roots, 2)
  s.players[1].seconds(30)
  const [first, second] = s.api.status().sessions
  assert.equal(first.atWall, false)
  assert.equal(second.atWall, true)
})

test('the module hardcodes no modal identifier', () => {
  // The triggers carry modal.js's own data-modal-trigger, authored in the
  // Designer. A modal id appearing here would recouple the two modules.
  assert.doesNotMatch(source, /data-modal-target/)
  assert.doesNotMatch(source, /['"][\w-]*signup-modal[\w-]*['"]/)
  assert.doesNotMatch(source, /['"][\w-]*upsell-modal[\w-]*['"]/)
})

test('the release marker in the header matches the API', () => {
  const header = /@release (v\d+\.\d+\.\d+)/.exec(source)
  const api = /var RELEASE = '(v\d+\.\d+\.\d+)'/.exec(source)
  assert.ok(header && api)
  assert.equal(header[1], api[1])
})
