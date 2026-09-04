const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./g2-proof.js'), 'utf8')

/* ------------------------------ mini DOM ------------------------------ *
 * The script is a closed IIFE that exports nothing but a release string, so
 * the only seam is what a visitor's browser would end up holding: the DOM
 * (clones), the calls the fake GSAP recorded, and the console warnings. This
 * is a small element tree implementing exactly the surface the script touches.
 *
 * Layout is test-controlled: an element's `layoutWidth` is its own measured
 * width, and anything without one measures as the sum of its children. That
 * models `scrollWidth`, `offsetWidth` and `getBoundingClientRect().width`
 * together, which is all the clone-fill maths reads.
 * -------------------------------------------------------------------- */

/**
 * Compound selectors of `.class`, `[attr]`, `[attr="value"]` and a bare tag —
 * everything the script uses (including `.card-marquee_list[data-marquee-list-clone]`)
 * and nothing else. An unsupported selector throws, so a future one cannot
 * silently match nothing and turn a real regression into a passing test.
 */
function matcher(selector) {
  const whole = String(selector).trim()
  if (!whole) throw new Error('mini DOM: empty selector')

  const tests = []
  let rest = whole
  while (rest) {
    let match
    if ((match = /^\[([a-z0-9-]+)="([^"]*)"\]/.exec(rest))) {
      const [, name, value] = match
      tests.push((el) => el.getAttribute(name) === value)
    } else if ((match = /^\[([a-z0-9-]+)\]/.exec(rest))) {
      const name = match[1]
      tests.push((el) => el.hasAttribute(name))
    } else if ((match = /^\.([a-zA-Z0-9_-]+)/.exec(rest))) {
      const name = match[1]
      tests.push((el) => el.classList.contains(name))
    } else if ((match = /^[a-z]+/.exec(rest))) {
      const tag = match[0].toUpperCase()
      tests.push((el) => el.tagName === tag)
    } else {
      throw new Error('mini DOM: unsupported selector ' + whole)
    }
    rest = rest.slice(match[0].length)
  }

  return (el) => tests.every((fn) => fn(el))
}

class El {
  constructor(tagName) {
    this.tagName = String(tagName || 'div').toUpperCase()
    this.nodeType = 1
    this.attributes = Object.create(null)
    this.children = []
    this.parentNode = null
    /** Test-controlled layout. null means "measure my children". */
    this.layoutWidth = null

    this._listeners = Object.create(null)
    this._classes = new Set()
    this.classList = {
      add: (name) => this._classes.add(name),
      remove: (name) => this._classes.delete(name),
      contains: (name) => this._classes.has(name),
    }
  }

  get parentElement() {
    return this.parentNode
  }

  get scrollWidth() {
    if (this.layoutWidth != null) return this.layoutWidth
    return this.children.reduce((sum, child) => sum + child.scrollWidth, 0)
  }

  get offsetWidth() {
    return this.scrollWidth
  }

  getBoundingClientRect() {
    return { width: this.scrollWidth }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
    return this
  }

  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null
  }

  hasAttribute(name) {
    return name in this.attributes
  }

  removeAttribute(name) {
    delete this.attributes[name]
    return this
  }

  addClass(name) {
    this._classes.add(name)
    return this
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.children.push(child)
    return child
  }

  removeChild(child) {
    const at = this.children.indexOf(child)
    if (at >= 0) this.children.splice(at, 1)
    child.parentNode = null
    return child
  }

  cloneNode(deep) {
    const copy = new El(this.tagName)
    Object.keys(this.attributes).forEach((name) =>
      copy.setAttribute(name, this.attributes[name]),
    )
    this._classes.forEach((name) => copy.classList.add(name))
    copy.layoutWidth = this.layoutWidth
    if (deep) this.children.forEach((child) => copy.appendChild(child.cloneNode(true)))
    return copy
  }

  closest(selector) {
    const test = matcher(selector)
    let node = this
    while (node) {
      if (test(node)) return node
      node = node.parentNode
    }
    return null
  }

  contains(other) {
    let node = other
    while (node) {
      if (node === this) return true
      node = node.parentNode
    }
    return false
  }

  /** `{ signal }` is honoured: an aborted listener really stops firing, so a
   *  re-arm that forgot to unbind would show up as a doubled timeScale call. */
  addEventListener(type, fn, options) {
    const list = (this._listeners[type] = this._listeners[type] || [])
    list.push(fn)
    const signal = options && options.signal
    if (!signal) return
    signal.addEventListener('abort', () => {
      const at = list.indexOf(fn)
      if (at >= 0) list.splice(at, 1)
    })
  }

  /** Fire what the script bound, the way a pointer or focus move would. */
  dispatch(type, event) {
    ;(this._listeners[type] || []).slice().forEach((fn) => fn(event || {}))
  }

  /** Depth-first self-and-descendants. */
  walk(out) {
    const acc = out || []
    acc.push(this)
    this.children.forEach((child) => child.walk(acc))
    return acc
  }

  /** Descendants only, matching the real querySelectorAll contract. */
  querySelectorAll(selector) {
    const test = matcher(selector)
    return this.walk().slice(1).filter(test)
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

/* ------------------------------ fixtures ------------------------------ */

const CLONE = 'data-marquee-list-clone'

function div(className) {
  return new El('div').addClass(className)
}

/**
 * html > body > section.section_g2-proof > .card-marquee_layout >
 * 2x .card-marquee-wrapper > 2x .card-marquee_list — the live section shape,
 * with the layout wide enough to prove the clone-fill maths either way.
 */
function makePage(options) {
  const o = options || {}
  const layoutWidth = o.layoutWidth == null ? 1000 : o.layoutWidth
  const listWidth = o.listWidth == null ? 1000 : o.listWidth
  const layoutCount = o.layouts == null ? 1 : o.layouts
  const wrapperCount = o.wrappers == null ? 2 : o.wrappers

  const html = new El('html')
  const body = new El('body')
  const section = div('section_g2-proof')
  html.appendChild(body)
  body.appendChild(section)

  const page = { html, body, section, layouts: [], wrappers: [], lists: [] }

  for (let l = 0; l < layoutCount; l++) {
    const layout = div('card-marquee_layout')
    layout.layoutWidth = layoutWidth
    section.appendChild(layout)
    page.layouts.push(layout)

    for (let w = 0; w < wrapperCount; w++) {
      const wrapper = div('card-marquee-wrapper')
      layout.appendChild(wrapper)
      page.wrappers.push(wrapper)
      for (let i = 0; i < 2; i++) {
        const list = div('card-marquee_list')
        list.layoutWidth = listWidth
        wrapper.appendChild(list)
        page.lists.push(list)
      }
    }
  }

  return page
}

function clonesIn(wrapper) {
  return wrapper.querySelectorAll('.card-marquee_list[' + CLONE + ']')
}

/* -------------------------------- gsap --------------------------------- *
 * Records `set` and `to`, and hands back tween objects with the three methods
 * the script calls. Nothing models time; what is modelled is the direction
 * pair (where a wrapper is set and where it tweens to) and every timeScale,
 * kill and pause, because those are the things under test.
 * ----------------------------------------------------------------------- */
function makeGsap(record) {
  return {
    set(target, vars) {
      record.sets.push({ target, vars })
    },
    to(target, vars) {
      const tween = {
        target,
        vars,
        killed: false,
        paused: false,
        timeScales: [],
        lastTimeScale: null,
        kill() {
          tween.killed = true
          return tween
        },
        pause() {
          tween.paused = true
          return tween
        },
        timeScale(value) {
          tween.timeScales.push(value)
          tween.lastTimeScale = value
          return tween
        },
      }
      record.tos.push(tween)
      return tween
    },
  }
}

/** The string part of one captured console.warn call. */
function warnText(args) {
  return args.filter((a) => typeof a === 'string').join(' ')
}

/** Every captured console.warn whose text matches. */
function warningsMatching(app, re) {
  return app.warnings.filter((args) => re.test(warnText(args)))
}

/** The teardown sets: what hands a wrapper back without an inline transform. */
function clearPropSets(app) {
  return app.record.sets.filter((entry) => entry.vars.clearProps === 'transform')
}

const ARMED = 'data-marquee-armed'

/**
 * Run the script for real against a page, in a fresh sandbox.
 * `gsap`: 'early' (present before the script runs), 'late' (attached by the
 * test with attachGsap()), or 'never'.
 * `hostname` defaults to production; `debug` sets window.STARTERS_DEBUG.
 */
function load(page, options) {
  const o = options || {}
  /** Raw console.warn argument lists, newest last. */
  const warnings = []
  const record = { sets: [], tos: [] }
  const windowListeners = {}
  const documentListeners = {}
  const observers = []
  const frames = []
  const timers = new Map()
  let nextTimer = 1

  const media = {
    hover: o.hoverMatches !== false,
    reduced: o.reducedMotion === true,
  }
  const mediaHandlers = { hover: [], reduced: [] }

  const sandbox = {
    console: {
      warn(...args) {
        warnings.push(args)
      },
      log() {},
    },
    // Manual-flush timers: the resize re-run is debounced by 120ms, and a test
    // that waits 120 real milliseconds is a test that flakes.
    setTimeout(fn) {
      const id = nextTimer++
      timers.set(id, fn)
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    // Recorded, not run: readyState 'complete' schedules a double rAF re-run,
    // and a test wants to read the first arming before it happens.
    requestAnimationFrame(fn) {
      frames.push(fn)
      return frames.length
    },
    AbortController,
  }

  sandbox.window = sandbox
  if (o.gsap === 'early') sandbox.gsap = makeGsap(record)
  // Production host by default: warnings are staging-only, so a case that
  // wants one has to ask for a staging hostname or the debug flag.
  sandbox.location = { hostname: o.hostname || 'www.thestarters.com' }
  sandbox.window.location = sandbox.location
  if (o.debug !== undefined) sandbox.window.STARTERS_DEBUG = o.debug

  // `noResizeObserver` models an old browser: the constructor is simply absent.
  if (!o.noResizeObserver) {
    sandbox.ResizeObserver = function ResizeObserver(callback) {
      this.callback = callback
      this.observed = null
      this.disconnected = false
      this.observe = (el) => {
        this.observed = el
        // A real observer delivers one observation right after observe().
        if (o.observerAutoFire) callback([])
      }
      this.disconnect = () => {
        this.disconnected = true
      }
      observers.push(this)
    }
  }

  sandbox.matchMedia = (query) => {
    const key = query.indexOf('reduced-motion') === -1 ? 'hover' : 'reduced'
    return {
      get matches() {
        return media[key]
      },
      addEventListener(type, fn) {
        if (type === 'change') mediaHandlers[key].push(fn)
      },
    }
  }

  sandbox.addEventListener = (type, fn) => {
    ;(windowListeners[type] = windowListeners[type] || []).push(fn)
  }
  sandbox.removeEventListener = (type, fn) => {
    const list = windowListeners[type] || []
    const at = list.indexOf(fn)
    if (at >= 0) list.splice(at, 1)
  }

  sandbox.document = {
    readyState: o.readyState || 'complete',
    documentElement: page.html,
    body: page.body,
    addEventListener(type, fn) {
      ;(documentListeners[type] = documentListeners[type] || []).push(fn)
    },
    createElement: (tag) => new El(tag),
    querySelectorAll(selector) {
      const test = matcher(selector)
      return page.html.walk().filter(test)
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null
    },
  }

  vm.createContext(sandbox)
  new vm.Script(source).runInContext(sandbox)

  const flush = () => {
    const pending = Array.from(timers.entries())
    timers.clear()
    pending.forEach(([, fn]) => fn())
  }

  return {
    warnings,
    record,
    observers,
    media,
    window: sandbox.window,
    /** Run the same source again in this sandbox — the init-guard probe. */
    runSourceAgain: () => new vm.Script(source).runInContext(sandbox),
    /** GSAP shows up after the script executed, as Webflow's footer copy does. */
    attachGsap: () => {
      sandbox.gsap = makeGsap(record)
    },
    setReadyState: (value) => {
      sandbox.document.readyState = value
    },
    domContentLoaded: () => {
      ;(documentListeners.DOMContentLoaded || []).slice().forEach((fn) => fn())
    },
    loadEvent: () => {
      ;(windowListeners.load || []).slice().forEach((fn) => fn())
    },
    /** Fire a window resize, then run whatever it scheduled. */
    resize: () => {
      ;(windowListeners.resize || []).slice().forEach((fn) => fn())
      flush()
    },
    /** Fire one wrapper's ResizeObserver, the per-track rebuild path. */
    observe: (index) => {
      observers[index].callback([])
    },
    /** Fire the hover-capability change handler — a re-run with no debounce. */
    hoverCapabilityChange: (matches) => {
      media.hover = matches
      mediaHandlers.hover.slice().forEach((fn) => fn())
    },
    /** Fire the reduced-motion change handler, as toggling the OS setting does. */
    reducedMotionChange: (matches) => {
      media.reduced = matches
      mediaHandlers.reduced.slice().forEach((fn) => fn())
    },
    /** Run the recorded double-rAF chain. */
    flushFrames: () => {
      let pending = frames.splice(0, frames.length)
      while (pending.length) {
        pending.forEach((fn) => fn())
        pending = frames.splice(0, frames.length)
      }
    },
    flush,
  }
}

/* ------------------------------ the guard ------------------------------ */

test('GSAP present at parse arms the marquee immediately, silently', () => {
  const page = makePage()
  const app = load(page, { gsap: 'early' })

  assert.equal(app.record.tos.length, 2)
  assert.equal(app.record.sets.length, 2)
  assert.deepEqual(app.warnings, [])
})

test('GSAP attached only before load: one warning, then arms on load', () => {
  const page = makePage()
  const app = load(page, {
    gsap: 'late',
    readyState: 'loading',
    hostname: 'the-starters-3-0.webflow.io',
  })

  app.domContentLoaded()
  assert.equal(app.record.tos.length, 0)
  assert.equal(app.warnings.length, 1)
  assert.match(warnText(app.warnings[0]), /GSAP not found/)

  app.attachGsap()
  app.loadEvent()

  assert.equal(app.record.tos.length, 2)
  // Still exactly one: the warning is per page, not per failed run.
  assert.equal(app.warnings.length, 1)
})

test('GSAP absent throughout warns once and touches nothing', () => {
  const page = makePage({ listWidth: 200 })
  const app = load(page, {
    gsap: 'never',
    readyState: 'loading',
    hostname: 'the-starters-3-0.webflow.io',
  })

  app.domContentLoaded()
  app.loadEvent()
  app.resize()

  assert.equal(app.warnings.length, 1)
  assert.match(warnText(app.warnings[0]), /GSAP not found/)
  assert.equal(app.record.tos.length, 0)
  assert.equal(app.record.sets.length, 0)
  // A short track would have been padded had the guard let the build run.
  assert.equal(clonesIn(page.wrappers[0]).length, 0)
})

test('on production the same missing GSAP is silent, and still inert', () => {
  const page = makePage({ listWidth: 200 })
  const app = load(page, { gsap: 'never', readyState: 'loading' })

  app.domContentLoaded()
  app.loadEvent()
  app.resize()

  assert.deepEqual(app.warnings, [])
  assert.equal(app.record.tos.length, 0)
  assert.equal(app.record.sets.length, 0)
  assert.equal(clonesIn(page.wrappers[0]).length, 0)
})

test('STARTERS_DEBUG turns the warning back on in production', () => {
  const page = makePage()
  const app = load(page, { gsap: 'never', readyState: 'loading', debug: true })

  app.domContentLoaded()
  app.loadEvent()

  assert.equal(app.warnings.length, 1)
  assert.match(warnText(app.warnings[0]), /GSAP not found/)
})

test('a lookalike host is not staging and says nothing', () => {
  const page = makePage()
  const app = load(page, {
    gsap: 'never',
    readyState: 'loading',
    hostname: 'notwebflow.io',
  })

  app.domContentLoaded()
  app.loadEvent()

  assert.deepEqual(app.warnings, [])
})

test('the release marker is readable even when GSAP never arrives', () => {
  assert.match(source, /@release v1\.59\.514/)

  const app = load(makePage(), { gsap: 'never' })
  assert.equal(app.window.G2ProofMarquee.release, 'v1.59.514')
})

test('a second copy of the tag does not double-bind', () => {
  const page = makePage()
  const app = load(page, { gsap: 'early' })
  assert.equal(app.record.tos.length, 2)

  app.runSourceAgain()

  assert.equal(app.record.tos.length, 2)
  assert.deepEqual(app.warnings, [])
})

/* ------------------------------ clone fill ------------------------------ */

test('a short track is padded with marked clones past layout plus one segment', () => {
  const page = makePage({ layoutWidth: 1000, listWidth: 200 })
  load(page, { gsap: 'early' })

  const wrapper = page.wrappers[0]
  const lists = wrapper.querySelectorAll('.card-marquee_list')

  assert.equal(clonesIn(wrapper).length, 4)
  assert.equal(lists.length, 6)
  assert.ok(wrapper.scrollWidth >= 1000 + 200)
  // The two authored lists are never marked, so a re-run can tell them apart.
  assert.equal(lists[0].hasAttribute(CLONE), false)
  assert.equal(lists[1].hasAttribute(CLONE), false)
})

test('a track already wider than layout plus one segment gets no clones', () => {
  const page = makePage({ layoutWidth: 1000, listWidth: 1000 })
  load(page, { gsap: 'early' })

  assert.equal(clonesIn(page.wrappers[0]).length, 0)
  assert.equal(page.wrappers[0].querySelectorAll('.card-marquee_list').length, 2)
})

/* ---------------------------- direction ---------------------------- */

test('tracks alternate: the first runs negative, the second starts offset', () => {
  const page = makePage()
  const app = load(page, { gsap: 'early' })

  assert.equal(app.record.sets[0].vars.x, 0)
  assert.equal(app.record.tos[0].vars.x, -1000)
  assert.equal(app.record.sets[1].vars.x, -1000)
  assert.equal(app.record.tos[1].vars.x, 0)
  assert.equal(app.record.tos[0].vars.duration, 1000 / 50)
})

test('forward and reverse attributes override the alternation', () => {
  const page = makePage()
  page.wrappers[0].setAttribute('data-marquee-reverse', '')
  page.wrappers[1].setAttribute('data-marquee-forward', '')
  const app = load(page, { gsap: 'early' })

  assert.equal(app.record.sets[0].vars.x, -1000)
  assert.equal(app.record.tos[0].vars.x, 0)
  assert.equal(app.record.sets[1].vars.x, 0)
  assert.equal(app.record.tos[1].vars.x, -1000)
})

test('data-marquee-speed sets the duration', () => {
  const page = makePage()
  page.wrappers[0].setAttribute('data-marquee-speed', '100')
  const app = load(page, { gsap: 'early' })

  assert.equal(app.record.tos[0].vars.duration, 10)
  assert.equal(app.record.tos[1].vars.duration, 20)
})

/* ------------------------------ skips ------------------------------ */

test('reduced motion creates no tweens', () => {
  const page = makePage()
  const app = load(page, { gsap: 'early', reducedMotion: true })

  assert.equal(app.record.tos.length, 0)
  assert.equal(app.record.sets.length, 0)
  assert.deepEqual(app.warnings, [])
})

test('a [data-marquee-pause] ancestor skips its wrappers', () => {
  const page = makePage({ layouts: 2 })
  page.layouts[1].setAttribute('data-marquee-pause', '')
  const app = load(page, { gsap: 'early' })

  assert.equal(app.record.tos.length, 2)
  assert.deepEqual(
    app.record.tos.map((tween) => tween.target),
    [page.wrappers[0], page.wrappers[1]],
  )
})

test('a page without wrappers does nothing at all', () => {
  const page = makePage({ layouts: 0 })
  const app = load(page, { gsap: 'early' })

  assert.equal(app.record.tos.length, 0)
  assert.equal(app.record.sets.length, 0)
  assert.deepEqual(app.warnings, [])
})

test('a wrapper with a single list warns and is not tweened', () => {
  // An unmeasurable layout is the one shape clone fill cannot rescue, so the
  // authored "needs two lists" contract is what is left to report.
  const page = makePage({ wrappers: 1, layoutWidth: 0 })
  page.wrappers[0].removeChild(page.wrappers[0].children[1])
  const app = load(page, {
    gsap: 'early',
    hostname: 'the-starters-3-0.webflow.io',
  })

  assert.equal(app.record.tos.length, 0)
  assert.match(warnText(app.warnings[0]), /needs two \.card-marquee_list/)
})

/* ------------------------------ rebuilds ------------------------------ */

test('a resize that changes a width kills the old tweens and builds new ones', () => {
  const page = makePage()
  const app = load(page, { gsap: 'early' })
  const first = app.record.tos.slice()

  page.layouts[0].layoutWidth = 1400
  app.resize()

  assert.deepEqual(
    first.map((tween) => tween.killed),
    [true, true],
  )
  assert.equal(app.record.tos.length, 4)
  assert.equal(app.record.tos[2].killed, false)
  assert.deepEqual(
    app.observers.slice(0, 2).map((ro) => ro.disconnected),
    [true, true],
  )
  // Teardown hands the wrappers back untransformed before the rebuild.
  assert.equal(clearPropSets(app).length, 2)
})

test('a resize with every width unchanged leaves the strips running', () => {
  const page = makePage()
  const app = load(page, { gsap: 'early' })
  const first = app.record.tos.slice()

  app.resize()

  // iOS collapsing its URL bar fires resize; restarting from x=0 would show.
  assert.equal(app.record.tos.length, 2)
  assert.equal(app.record.sets.length, 2)
  assert.deepEqual(
    first.map((tween) => tween.killed),
    [false, false],
  )
  assert.equal(app.window.G2ProofMarquee.armed, true)
})

test("a wrapper's ResizeObserver pauses and replaces just that tween", () => {
  const page = makePage()
  const app = load(page, { gsap: 'early' })
  const first = app.record.tos[0]

  assert.equal(app.observers[0].observed, page.wrappers[0].children[0])

  page.wrappers[0].children[0].layoutWidth = 500
  app.observe(0)

  assert.equal(first.paused, true)
  assert.equal(first.killed, true)
  assert.equal(app.record.tos.length, 3)
  assert.equal(app.record.tos[1].killed, false)
  assert.equal(app.record.sets.length, 3)
})

test("the observer's own first observation does not restart the track", () => {
  const page = makePage()
  const app = load(page, { gsap: 'early', observerAutoFire: true })

  assert.equal(app.record.tos.length, 2)
  assert.equal(app.record.sets.length, 2)
  assert.equal(app.record.tos[0].killed, false)
})

test('an observer firing at the same width changes nothing', () => {
  const page = makePage()
  const app = load(page, { gsap: 'early' })

  app.observe(0)

  assert.equal(app.record.tos.length, 2)
  assert.equal(app.record.sets.length, 2)
})

test('a hover slowdown survives an observer rebuild under the pointer', () => {
  const page = makePage()
  const app = load(page, { gsap: 'early' })

  page.layouts[0].dispatch('mouseenter')
  assert.equal(app.record.tos[0].lastTimeScale, 0.25)

  page.wrappers[0].children[0].layoutWidth = 500
  app.observe(0)

  // The pointer never left, so the replacement tween is slow from the start.
  assert.equal(app.record.tos.length, 3)
  assert.equal(app.record.tos[2].lastTimeScale, 0.25)
})

test('the hover-capability change rebinds pointer hover without rebuilding', () => {
  const page = makePage()
  const app = load(page, { gsap: 'early', hoverMatches: false })

  page.layouts[0].dispatch('mouseenter')
  assert.equal(app.record.tos[0].lastTimeScale, null)

  app.hoverCapabilityChange(true)
  page.layouts[0].dispatch('mouseenter')

  assert.equal(app.record.tos.length, 2)
  assert.equal(app.record.tos[0].lastTimeScale, 0.25)
})

test('a browser without ResizeObserver still arms, and still rebuilds on resize', () => {
  const page = makePage()
  const app = load(page, { gsap: 'early', noResizeObserver: true })

  assert.equal(app.record.tos.length, 2)
  assert.equal(app.observers.length, 0)
  assert.deepEqual(app.warnings, [])

  page.layouts[0].layoutWidth = 1400
  app.resize()
  assert.equal(app.record.tos.length, 4)
})

/* ------------------------------ hover and focus ------------------------------ */

test('hover on a hover-capable device slows every tween in that layout', () => {
  const page = makePage()
  const app = load(page, { gsap: 'early' })

  page.layouts[0].dispatch('mouseenter')
  assert.deepEqual(
    app.record.tos.map((tween) => tween.lastTimeScale),
    [0.25, 0.25],
  )

  page.layouts[0].dispatch('mouseleave')
  assert.deepEqual(
    app.record.tos.map((tween) => tween.lastTimeScale),
    [1, 1],
  )
})

test('data-marquee-hover-scale sets the slowdown factor', () => {
  const page = makePage()
  page.layouts[0].setAttribute('data-marquee-hover-scale', '0')
  const app = load(page, { gsap: 'early' })

  page.layouts[0].dispatch('mouseenter')
  assert.deepEqual(
    app.record.tos.map((tween) => tween.lastTimeScale),
    [0, 0],
  )
})

test('data-marquee-hover="off" disables the slowdown entirely', () => {
  const page = makePage()
  page.layouts[0].setAttribute('data-marquee-hover', 'off')
  const app = load(page, { gsap: 'early' })

  page.layouts[0].dispatch('mouseenter')
  page.layouts[0].dispatch('focusin')

  assert.deepEqual(
    app.record.tos.map((tween) => tween.timeScales.length),
    [0, 0],
  )
})

test('focus slows the strip, and focus moving inside it does not restore', () => {
  const page = makePage()
  const app = load(page, { gsap: 'early' })

  page.layouts[0].dispatch('focusin')
  assert.equal(app.record.tos[0].lastTimeScale, 0.25)

  page.layouts[0].dispatch('focusout', { relatedTarget: page.lists[0] })
  assert.equal(app.record.tos[0].lastTimeScale, 0.25)

  page.layouts[0].dispatch('focusout', { relatedTarget: null })
  assert.equal(app.record.tos[0].lastTimeScale, 1)
})

test('a touch device gets no fake hover, but keyboard focus still slows', () => {
  const page = makePage()
  const app = load(page, { gsap: 'early', hoverMatches: false })

  page.layouts[0].dispatch('mouseenter')
  assert.equal(app.record.tos[0].timeScales.length, 0)

  page.layouts[0].dispatch('focusin')
  assert.equal(app.record.tos[0].lastTimeScale, 0.25)
})

test('each layout owns its own hover scope', () => {
  const page = makePage({ layouts: 2 })
  const app = load(page, { gsap: 'early' })

  page.layouts[1].dispatch('mouseenter')

  assert.deepEqual(
    app.record.tos.map((tween) => tween.lastTimeScale),
    [null, null, 0.25, 0.25],
  )
})

/* --------------------- readiness, markers and teardown --------------------- */

test("readyState 'interactive' arms once, and load does not arm it again", () => {
  const page = makePage()
  const app = load(page, { gsap: 'early', readyState: 'interactive' })

  assert.equal(app.record.tos.length, 2)
  assert.equal(app.record.sets.length, 2)

  app.loadEvent()

  // Webflow's GSAP is already there at 'interactive'; re-running would show as
  // every strip jumping back to its start position.
  assert.equal(app.record.tos.length, 2)
  assert.equal(app.record.sets.length, 2)
})

test("readyState 'complete' does not arm a second time on the rAF pass", () => {
  const page = makePage()
  const app = load(page, { gsap: 'early', readyState: 'complete' })

  assert.equal(app.record.tos.length, 2)

  app.flushFrames()

  assert.equal(app.record.tos.length, 2)
  assert.equal(app.record.sets.length, 2)
})

test("readyState 'complete' with late GSAP arms on the rAF pass", () => {
  const page = makePage()
  const app = load(page, { gsap: 'late', readyState: 'complete' })

  assert.equal(app.record.tos.length, 0)

  app.attachGsap()
  app.flushFrames()

  assert.equal(app.record.tos.length, 2)
  assert.equal(app.window.G2ProofMarquee.armed, true)
})

test('armed markers appear only once tweens exist', () => {
  const armedPage = makePage()
  const armed = load(armedPage, { gsap: 'early' })

  assert.equal(armed.window.G2ProofMarquee.armed, true)
  assert.deepEqual(
    armedPage.wrappers.map((wrapper) => wrapper.hasAttribute(ARMED)),
    [true, true],
  )

  const staticPage = makePage()
  const inert = load(staticPage, { gsap: 'never' })

  assert.equal(inert.window.G2ProofMarquee.armed, false)
  assert.deepEqual(
    staticPage.wrappers.map((wrapper) => wrapper.hasAttribute(ARMED)),
    [false, false],
  )
})

test('reduced motion switched on after arming returns the strip to static', () => {
  const page = makePage({ layoutWidth: 1000, listWidth: 200 })
  const app = load(page, { gsap: 'early' })
  const first = app.record.tos.slice()

  assert.equal(clonesIn(page.wrappers[0]).length, 4)

  app.reducedMotionChange(true)

  assert.deepEqual(
    first.map((tween) => tween.killed),
    [true, true],
  )
  assert.equal(app.record.tos.length, 2)
  // Static means static: no clones, no frozen inline transform, no marker.
  assert.equal(clearPropSets(app).length, 2)
  assert.equal(clonesIn(page.wrappers[0]).length, 0)
  assert.equal(page.wrappers[0].hasAttribute(ARMED), false)
  assert.equal(app.window.G2ProofMarquee.armed, false)
})

test('a track the copy cap cannot fill warns once, not once per rebuild', () => {
  const page = makePage({ wrappers: 1, layoutWidth: 100, listWidth: 1 })
  const app = load(page, {
    gsap: 'early',
    hostname: 'the-starters-3-0.webflow.io',
  })

  assert.equal(clonesIn(page.wrappers[0]).length, 24)
  assert.equal(warningsMatching(app, /Clone cap reached/).length, 1)

  page.wrappers[0].children[0].layoutWidth = 2
  app.observe(0)

  assert.equal(warningsMatching(app, /Clone cap reached/).length, 1)
})

test('STARTERS_DEBUG set after a silent production run still surfaces the warning', () => {
  const page = makePage()
  const app = load(page, { gsap: 'never', readyState: 'loading' })

  app.domContentLoaded()
  assert.deepEqual(app.warnings, [])

  app.window.STARTERS_DEBUG = true
  app.resize()

  assert.equal(app.warnings.length, 1)
  assert.match(warnText(app.warnings[0]), /GSAP not found/)
})

test('a track measured at zero keeps its clones and its running tween', () => {
  const page = makePage({ wrappers: 1, layoutWidth: 1000, listWidth: 200 })
  const app = load(page, { gsap: 'early' })
  const first = app.record.tos[0]

  assert.equal(clonesIn(page.wrappers[0]).length, 4)

  // An ancestor hides the section: every measurement collapses to zero.
  page.layouts[0].layoutWidth = 0
  page.wrappers[0].querySelectorAll('.card-marquee_list').forEach((list) => {
    list.layoutWidth = 0
  })
  app.observe(0)

  assert.equal(clonesIn(page.wrappers[0]).length, 4)
  assert.equal(first.killed, false)
  assert.equal(app.record.tos.length, 1)

  // Shown again at the same width: the padded track is still the armed one.
  page.layouts[0].layoutWidth = 1000
  page.wrappers[0].querySelectorAll('.card-marquee_list').forEach((list) => {
    list.layoutWidth = 200
  })
  app.observe(0)

  assert.equal(clonesIn(page.wrappers[0]).length, 4)
  assert.equal(first.killed, false)
  assert.equal(app.record.tos.length, 1)
  assert.equal(page.wrappers[0].hasAttribute(ARMED), true)
})

test('losing hover capability under the pointer releases the slowdown', () => {
  const page = makePage()
  const app = load(page, { gsap: 'early' })

  page.layouts[0].dispatch('mouseenter')
  assert.equal(app.record.tos[0].lastTimeScale, 0.25)

  // The keyboard detaches: no mouseleave will ever arrive for this hold.
  app.hoverCapabilityChange(false)

  assert.equal(app.record.tos.length, 2)
  assert.equal(app.record.tos[0].lastTimeScale, 1)
  assert.equal(app.record.tos[1].lastTimeScale, 1)

  page.wrappers[0].children[0].layoutWidth = 500
  app.observe(0)

  // Nothing is held any more, so the replacement tween runs at full speed.
  assert.deepEqual(app.record.tos[2].timeScales, [])
})

test('reduced motion on then off re-arms at full speed, not the held scale', () => {
  const page = makePage()
  const app = load(page, { gsap: 'early' })

  page.layouts[0].dispatch('mouseenter')
  assert.equal(app.record.tos[0].lastTimeScale, 0.25)

  app.reducedMotionChange(true)
  app.reducedMotionChange(false)

  const rebuilt = app.record.tos.slice(2)
  assert.equal(rebuilt.length, 2)
  assert.deepEqual(
    rebuilt.map((tween) => tween.timeScales),
    [[], []],
  )
})

test('a hover slowdown survives a resize rebuild under the pointer', () => {
  const page = makePage()
  const app = load(page, { gsap: 'early' })

  page.layouts[0].dispatch('mouseenter')

  page.layouts[0].layoutWidth = 1400
  app.resize()

  const rebuilt = app.record.tos.slice(2)
  assert.equal(rebuilt.length, 2)
  assert.deepEqual(
    rebuilt.map((tween) => tween.lastTimeScale),
    [0.25, 0.25],
  )
})
