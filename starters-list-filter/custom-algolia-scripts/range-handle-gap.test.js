const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./range-handle-gap.js'), 'utf8')

const WRAPPER_SEL = '[fs-rangeslider-element="wrapper"]'

/**
 * Loads range-handle-gap.js in a DOM-less sandbox and hands back the internals
 * the gap clamp is built from. The file is an IIFE with no exports, so it is
 * run against a stub `document`/`window` that reach nothing real (the
 * FinsweetAttributes queue is a bare array, so registering is inert) and the
 * functions are re-exposed through an injected tail.
 *
 * The IIFE stamps an init flag on document.documentElement and bails if it is
 * already set, so a sandbox can only ever load it ONCE — build a fresh one per
 * test rather than sharing.
 *
 * `setTimeout` is a manual queue: `flush()` drains the callbacks the script
 * schedules (enforce() runs on a setTimeout(0)) so resize behaviour is
 * deterministic without real timers.
 *
 * `observerLog` records every MutationObserver the script builds — what it was
 * pointed at, its filter, how often it was disconnected, and the callback, so a
 * test can deliver a mutation by hand.
 *
 * @param {{rootFontSize?: number, finsweet?: object}} [options]
 * @returns {{parseGapPx: Function, patchPair: Function, onRangeslider: Function,
 *   DEFAULT_GAP_PX: number, GAP_ATTR: string, flush: Function,
 *   observerLog: object[], deliver: Function, loadAgain: Function, context: object}}
 */
function loadInternals(options = {}) {
  const rootFontSize = options.rootFontSize === undefined ? 16 : options.rootFontSize

  const exposed = source.replace(
    /\}\)\(\);?\s*$/,
    'globalThis.__internals = { parseGapPx, patchPair, onRangeslider, DEFAULT_GAP_PX, GAP_ATTR };\n})();',
  )

  assert.notEqual(exposed, source, 'failed to inject the test tail')

  const timers = []
  const htmlAttrs = new Map()
  const observerLog = []

  const context = {
    document: {
      documentElement: {
        getAttribute: (name) => (htmlAttrs.has(name) ? htmlAttrs.get(name) : null),
        setAttribute: (name, value) => htmlAttrs.set(name, String(value)),
      },
    },
    window: {
      setTimeout: (fn) => timers.push(fn),
      getComputedStyle: () => ({ fontSize: `${rootFontSize}px` }),
      MutationObserver: function MutationObserver(callback) {
        const record = { callback, target: null, options: null, disconnects: 0 }
        observerLog.push(record)
        this.observe = (target, opts) => {
          record.target = target
          record.options = opts
        }
        this.disconnect = () => {
          record.disconnects += 1
        }
      },
    },
  }

  if (options.finsweet) context.window.FinsweetAttributes = options.finsweet

  vm.createContext(context)
  vm.runInContext(exposed, context)

  assert.ok(context.__internals, 'the test tail did not run')

  const flush = () => {
    let guard = 0
    while (timers.length) {
      if ((guard += 1) > 50) throw new Error('scheduled callbacks never settled')
      timers.shift()()
    }
  }

  return Object.assign(
    {
      flush,
      observerLog,
      context,
      /** Hands the script a mutation the way a real MutationObserver would. */
      deliver: (record) => record.callback([{ attributeName: 'starters-rangeslider-gap' }], record),
      /** Re-runs the very same IIFE source in this same sandbox. */
      loadAgain: () => vm.runInContext(exposed, context),
    },
    context.__internals,
  )
}

/**
 * A synchronously-settled stand-in for the loader's `module.loading` promise, so
 * the resolve -> callback hop stays on the test's own stack (no microtasks, no
 * real timers).
 */
function makeThenable() {
  const subscribers = []
  let settled = false
  let result

  return {
    then(fn) {
      if (settled) fn(result)
      else subscribers.push(fn)
      return this
    },
    resolve(value) {
      settled = true
      result = value
      while (subscribers.length) subscribers.shift()(value)
    },
  }
}

/**
 * A fake `window.FinsweetAttributes` shaped like the real loaded API rather than
 * the bare bootstrap array: entries pushed as ['rangeslider', cb] are resolved
 * against `modules.rangeslider.loading`, and restart() swaps that thenable for a
 * fresh one synchronously the way load() does.
 */
function makeFinsweetApi() {
  const pushes = []
  const restarts = []

  const api = {
    pushes,
    restarts,
    modules: {
      rangeslider: {
        loading: makeThenable(),
        restart() {
          restarts.push(1)
          api.modules.rangeslider.loading = makeThenable()
        },
      },
    },
    push(entry) {
      pushes.push(entry)
      const name = entry && entry[0]
      const cb = entry && entry[1]
      const mod = api.modules[name]
      if (mod && mod.loading && typeof cb === 'function') mod.loading.then(cb)
      return pushes.length
    },
    /** Hands the currently-subscribed callbacks a module result (the handle groups). */
    resolveLoading(result) {
      api.modules.rangeslider.loading.resolve(result)
    },
  }

  return api
}

/**
 * Builds a fake handle pair that mimics the shipped Finsweet rangeslider
 * instances closely enough for the clamp to drive them.
 *
 * @param {object} [options] slider geometry
 * @returns {{wrapper: object, minHandle: object, maxHandle: object, handles: object[]}}
 */
function makeSlider(options = {}) {
  const min = options.min === undefined ? 30 : options.min
  const max = options.max === undefined ? 500 : options.max
  const step = options.step === undefined ? 1 : options.step
  const startMin = options.startMin === undefined ? min : options.startMin
  const startMax = options.startMax === undefined ? max : options.startMax
  const trackWidth = options.trackWidth === undefined ? 328 : options.trackWidth
  const handleWidth = options.handleWidth === undefined ? 32 : options.handleWidth
  const gapAttr = options.gapAttr === undefined ? null : options.gapAttr

  const attrs = new Map()
  if (gapAttr !== null) attrs.set('starters-rangeslider-gap', gapAttr)

  const wrapper = {
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
  }

  const makeHandle = (index, value) => ({
    index,
    sibling: null,
    step,
    minRange: min,
    maxRange: max,
    totalRange: max - min,
    currentValue: value,
    minValue: min,
    maxValue: max,
    trackWidth,
    inputElement: { value: value.toFixed(2) },
    inputWrites: 0,
    element: {
      offsetWidth: handleWidth,
      closest: (sel) => (sel === WRAPPER_SEL ? wrapper : null),
    },
    updateInputElement() {
      this.inputWrites += 1
      this.inputElement.value = this.currentValue.toFixed(2)
    },
    updateTrackWidth(width) {
      this.trackWidth = width
      return width
    },
    // Deminified from the shipped Finsweet bundle. The `n = true` DEFAULT
    // PARAMETER is load-bearing: every path that forwards an absent flag
    // (keyboard, click-to-jump) still syncs the input element.
    setValue(t, n = true) {
      if (t === this.currentValue || t < this.minValue || t > this.maxValue) return false
      this.currentValue = t
      if (n) this.updateInputElement()
      return true
    },
  })

  const minHandle = makeHandle(0, startMin)
  const maxHandle = makeHandle(1, startMax)
  minHandle.sibling = maxHandle
  maxHandle.sibling = minHandle

  return { wrapper, minHandle, maxHandle, handles: [minHandle, maxHandle] }
}

/**
 * Fresh sandbox + patched fake pair, with the script's arrival-time enforce
 * pass already flushed.
 */
function setup(options = {}) {
  const internals = loadInternals(options)
  const slider = makeSlider(options)
  internals.patchPair(slider.handles)
  internals.flush()
  return Object.assign({}, internals, slider)
}

/** Re-lays the pair out on a new track width, the way a resize does. */
function resizeTrack(slider, width) {
  slider.minHandle.updateTrackWidth(width)
  slider.maxHandle.updateTrackWidth(width)
  slider.flush()
}

// --- the gap attribute ------------------------------------------------------

test('a bare number, an explicit px value and a rem value all name the same gap', () => {
  const { parseGapPx } = loadInternals()
  assert.equal(parseGapPx('48'), 48)
  assert.equal(parseGapPx('48px'), 48)
  assert.equal(parseGapPx('48PX'), 48)
  assert.equal(parseGapPx('  48  '), 48)
  assert.equal(parseGapPx('3rem'), 48)
  assert.equal(parseGapPx('1.5rem'), 24)
})

test('a rem gap resolves against the live root font size, not a hardcoded 16', () => {
  const { parseGapPx } = loadInternals({ rootFontSize: 20 })
  assert.equal(parseGapPx('2rem'), 40)
  assert.equal(parseGapPx('40px'), 40, 'px values must not be scaled by the root font size')
})

test('a missing, negative, junk or unsupported-unit gap falls back to the default', () => {
  const { parseGapPx, DEFAULT_GAP_PX } = loadInternals()
  assert.equal(DEFAULT_GAP_PX, 48)
  for (const raw of [null, undefined, '-5', '-5px', '3em', '50%', '48vw', '', '   ', 'abc', 'px', 'NaN']) {
    assert.equal(parseGapPx(raw), DEFAULT_GAP_PX, `"${raw}" should have fallen back to the default`)
  }
})

test('a zero gap is honoured rather than swapped for the default', () => {
  const { parseGapPx } = loadInternals()
  assert.equal(parseGapPx('0'), 0)
  assert.equal(parseGapPx('0px'), 0)
})

// --- the clamp --------------------------------------------------------------
// prod sidebar geometry: $30–$500, step 1, 328px track, 32px pill, 48px gap.
// need = ceil((48 + 32) * 470 / 328 / 1) * 1 = ceil(114.63) = 115.

test('the max thumb dragged down stops exactly on the gap boundary and not below', () => {
  const slider = setup()
  assert.equal(slider.maxHandle.setValue(100, true), true)
  assert.equal(slider.maxHandle.currentValue, 145) // 30 + 115
  assert.equal(slider.maxHandle.setValue(144, true), false)
  assert.equal(slider.maxHandle.currentValue, 145)
})

test('the min thumb dragged up stops exactly on the gap boundary and not above', () => {
  const slider = setup()
  assert.equal(slider.minHandle.setValue(450, true), true)
  assert.equal(slider.minHandle.currentValue, 385) // 500 - 115
  assert.equal(slider.minHandle.setValue(386, true), false)
  assert.equal(slider.minHandle.currentValue, 385)
})

test('a move that opens the gap is always allowed through untouched', () => {
  const slider = setup({ startMin: 200, startMax: 400 })
  assert.equal(slider.minHandle.setValue(150, true), true)
  assert.equal(slider.minHandle.currentValue, 150)
  assert.equal(slider.maxHandle.setValue(450, true), true)
  assert.equal(slider.maxHandle.currentValue, 450)
})

test('a closing move that still leaves the gap is committed unchanged', () => {
  const slider = setup({ startMin: 200, startMax: 400 })
  assert.equal(slider.maxHandle.setValue(390, true), true) // 390 - 200 = 190 >= 115
  assert.equal(slider.maxHandle.currentValue, 390)
  assert.equal(slider.minHandle.setValue(270, true), true) // 390 - 270 = 120 >= 115
  assert.equal(slider.minHandle.currentValue, 270)
})

test('a move refused at the wall reports failure and leaves the thumb where it was', () => {
  const slider = setup({ startMin: 30, startMax: 145 })
  assert.equal(slider.maxHandle.setValue(120, true), false)
  assert.equal(slider.maxHandle.currentValue, 145)
  assert.equal(slider.minHandle.setValue(60, true), false)
  assert.equal(slider.minHandle.currentValue, 30)
})

test('a clamped move writes the clamped value into the input element', () => {
  const slider = setup()
  slider.maxHandle.setValue(100, true)
  assert.equal(slider.maxHandle.currentValue, 145)
  assert.equal(slider.maxHandle.inputElement.value, '145.00')
})

test('a refused move pulls a diverged input element back onto the thumb', () => {
  const slider = setup()
  slider.maxHandle.setValue(100, true)
  assert.equal(slider.maxHandle.inputElement.value, '145.00')
  const writesAfterClamp = slider.maxHandle.inputWrites

  // Something wrote the input directly (a typed value) and the clamp then
  // refused the move, so the library's own sync never ran.
  slider.maxHandle.inputElement.value = '100'
  assert.equal(slider.maxHandle.setValue(100, true), false)
  assert.equal(slider.maxHandle.inputElement.value, '145.00')
  assert.equal(slider.maxHandle.inputWrites, writesAfterClamp + 1)

  // Already in agreement: no redundant write on every frame of a drag.
  assert.equal(slider.maxHandle.setValue(100, true), false)
  assert.equal(slider.maxHandle.inputWrites, writesAfterClamp + 1)
})

test('a move that omits the update flag still writes the input element', () => {
  const slider = setup()
  assert.equal(slider.maxHandle.setValue(300), true) // keyboard path: one argument
  assert.equal(slider.maxHandle.currentValue, 300)
  assert.equal(slider.maxHandle.inputElement.value, '300.00')

  // …and an explicit false is forwarded rather than fabricated.
  assert.equal(slider.maxHandle.setValue(250, false), true)
  assert.equal(slider.maxHandle.currentValue, 250)
  assert.equal(slider.maxHandle.inputElement.value, '300.00')
})

test('the gap in value units follows the live track width', () => {
  const wide = setup({ trackWidth: 668 })
  wide.maxHandle.setValue(50, true)
  assert.equal(wide.maxHandle.currentValue, 87) // 30 + ceil(80 * 470 / 668) = 30 + 57

  const narrow = setup({ trackWidth: 328 })
  narrow.maxHandle.setValue(50, true)
  assert.equal(narrow.maxHandle.currentValue, 145) // 30 + 115
})

test('editing the gap attribute changes the clamp on the very next move', () => {
  const slider = setup({ gapAttr: '48' })
  slider.wrapper.setAttribute(slider.GAP_ATTR, '96')
  slider.maxHandle.setValue(100, true)
  // ceil((96 + 32) * 470 / 328) = 184, so 30 + 184. The stale 48px gap would
  // have stopped it at 145.
  assert.equal(slider.maxHandle.currentValue, 214)
})

test('a single-handle slider is never clamped and sweeps the whole range', () => {
  const internals = loadInternals()
  const { minHandle } = makeSlider()
  minHandle.sibling = null

  // Finsweet emits a single-handle group as [handle0, undefined].
  internals.onRangeslider([[minHandle, undefined]])
  internals.flush()

  assert.equal(minHandle.startersGapPatched, undefined)
  assert.equal(minHandle.setValue(500, true), true)
  assert.equal(minHandle.currentValue, 500)
  assert.equal(minHandle.setValue(30, true), true)
  assert.equal(minHandle.currentValue, 30)
})

test('one malformed group cannot stop the other sliders on the page being patched', () => {
  const internals = loadInternals()

  const broken = makeSlider()
  broken.minHandle.element.closest = () => {
    throw new Error('boom')
  }
  const noElement = makeSlider()
  noElement.minHandle.element = null
  const good = makeSlider()

  internals.onRangeslider([
    broken.handles,
    noElement.handles,
    [good.minHandle, undefined],
    good.handles,
  ])
  internals.flush()

  assert.equal(broken.minHandle.startersGapPatched, undefined)
  assert.equal(noElement.minHandle.startersGapPatched, undefined)
  good.maxHandle.setValue(100, true)
  assert.equal(good.maxHandle.currentValue, 145)
})

test('a gap wider than the whole range parks the thumbs at the two ends', () => {
  const slider = setup({ startMin: 100, startMax: 400, gapAttr: '5000px' })

  assert.equal(slider.minHandle.currentValue, 30)
  assert.equal(slider.maxHandle.currentValue, 500)
  assert.equal(slider.minHandle.inputElement.value, '30.00')
  assert.equal(slider.maxHandle.inputElement.value, '500.00')

  // Capped at the full range rather than standing down: neither thumb can move
  // back inwards at all.
  assert.equal(slider.minHandle.setValue(200, true), false)
  assert.equal(slider.minHandle.currentValue, 30)
  assert.equal(slider.maxHandle.setValue(400, true), false)
  assert.equal(slider.maxHandle.currentValue, 500)
})

// --- resize debt ------------------------------------------------------------

test('a track that grows back returns the thumb a shrink pushed, even after a refused move', () => {
  const slider = setup({ startMin: 200, startMax: 260, trackWidth: 668 })

  // 60 apart on a 668px track needs 57 — legal, so nothing moved on arrival.
  assert.equal(slider.maxHandle.currentValue, 260)

  // Shrink to the sidebar track: 115 needed, so the max thumb is pushed up and
  // the script owes 260 back.
  resizeTrack(slider, 328)
  assert.equal(slider.maxHandle.currentValue, 315) // 200 + 115

  // The user shoves that thumb back down into the wall. Both shapes of refusal
  // have to leave the debt standing — only a move that actually COMMITS is a
  // fresh statement of intent.
  //
  // (a) the gap clamp refuses it outright: 300 is inside the forbidden zone
  //     and the thumb is already sitting on the boundary.
  assert.equal(slider.maxHandle.setValue(300, true), false)
  assert.equal(slider.maxHandle.currentValue, 315)

  // (b) the move survives the clamp untouched and the library then refuses it —
  //     the drag frame that re-reports the value the thumb is already on. This
  //     one runs all the way through to the debt bookkeeping, so it is the path
  //     that a "clear the debt whenever setValue returns" bug would break.
  assert.equal(slider.maxHandle.setValue(315, true), false)
  assert.equal(slider.maxHandle.currentValue, 315)

  // Track grows back: the debt is repaid.
  resizeTrack(slider, 668)
  assert.equal(slider.maxHandle.currentValue, 260)
  assert.equal(slider.maxHandle.inputElement.value, '260.00')
})

test('a pair caught closer than the gap holds still rather than yanking a thumb backwards', () => {
  const slider = setup({ startMin: 200, startMax: 260, trackWidth: 668 })

  // The track shrank but the coalesced enforce() pass has not run yet — the
  // pair is 60 apart on a track that now needs 115. Every thumb has to keep its
  // escape route in the direction that OPENS the gap, and must not be dragged
  // backwards to satisfy a boundary that is already behind it.
  slider.minHandle.updateTrackWidth(328)
  slider.maxHandle.updateTrackWidth(328)

  assert.equal(slider.minHandle.setValue(210, true), false)
  assert.equal(slider.minHandle.currentValue, 200)
  assert.equal(slider.maxHandle.setValue(250, true), false)
  assert.equal(slider.maxHandle.currentValue, 260)

  // Opening moves still go through while the pair is over-tight.
  assert.equal(slider.minHandle.setValue(190, true), true)
  assert.equal(slider.minHandle.currentValue, 190)

  // …and the pending pass then opens the pair for real.
  slider.flush()
  assert.equal(slider.maxHandle.currentValue, 305) // 190 + 115
})

test('a move the user commits cancels the debt, so a growing track leaves the thumb alone', () => {
  const slider = setup({ startMin: 200, startMax: 260, trackWidth: 668 })

  resizeTrack(slider, 328)
  assert.equal(slider.maxHandle.currentValue, 315)

  assert.equal(slider.maxHandle.setValue(400, true), true)

  resizeTrack(slider, 668)
  assert.equal(slider.maxHandle.currentValue, 400, 'a repaid debt must never drag a user move back')
})

test('a widening track never repays past where the thumb stood before the push', () => {
  const slider = setup({ startMin: 200, startMax: 260, trackWidth: 668 })

  resizeTrack(slider, 328)
  assert.equal(slider.maxHandle.currentValue, 315)

  // Far wider than either measured track: the repayment still stops at 260.
  resizeTrack(slider, 2000)
  assert.equal(slider.maxHandle.currentValue, 260)
})

test('the min thumb is only pulled down when the max thumb has nowhere left to go', () => {
  const slider = setup({ startMin: 460, startMax: 500, trackWidth: 668 })

  // 40 apart needs 57: the max thumb is already at the ceiling, so the min
  // thumb is the one that gives.
  assert.equal(slider.maxHandle.currentValue, 500)
  assert.equal(slider.minHandle.currentValue, 443) // 500 - 57
  assert.equal(slider.minHandle.inputElement.value, '443.00')

  resizeTrack(slider, 2000)
  assert.equal(slider.minHandle.currentValue, 460, 'the min thumb debt is repaid too')
})

// --- module lifecycle -------------------------------------------------------

test('a Finsweet restart re-registers the fix onto the rebuilt handles', () => {
  const api = makeFinsweetApi()
  const internals = loadInternals({ finsweet: api })

  // The IIFE registers against the loader's current loading promise.
  assert.equal(api.pushes.length, 1)
  assert.equal(api.pushes[0][0], 'rangeslider')

  const pairA = makeSlider()
  api.resolveLoading([pairA.handles])
  internals.flush()
  pairA.maxHandle.setValue(100, true)
  assert.equal(pairA.maxHandle.currentValue, 145)

  // restart() destroys the instances and builds new, UNPATCHED ones. The
  // wrapper has to re-register against the freshly swapped loading promise or
  // the fix silently switches itself off for the rest of the page's life.
  api.modules.rangeslider.restart()
  assert.equal(api.restarts.length, 1)
  assert.equal(api.pushes.length, 2, 'restart must re-register')

  const pairB = makeSlider()
  api.resolveLoading([pairB.handles])
  internals.flush()
  assert.equal(pairB.maxHandle.startersGapPatched, true)
  pairB.maxHandle.setValue(100, true)
  assert.equal(pairB.maxHandle.currentValue, 145, 'the clamp must engage on the rebuilt pair')
})

test('re-wrapping restart is idempotent, so restarts do not compound', () => {
  const api = makeFinsweetApi()
  const internals = loadInternals({ finsweet: api })

  api.resolveLoading([makeSlider().handles])
  internals.flush()

  api.modules.rangeslider.restart()
  api.resolveLoading([makeSlider().handles])
  internals.flush()

  const observersBefore = internals.observerLog.length
  api.modules.rangeslider.restart()
  assert.equal(api.pushes.length, 3, 'each restart re-registers exactly once, never 2^n times')

  const pairC = makeSlider()
  api.resolveLoading([pairC.handles])
  internals.flush()

  // A double-wrapped restart would run the callback twice per load and stand up
  // two observers for the one wrapper.
  assert.equal(internals.observerLog.length - observersBefore, 1)
  pairC.maxHandle.setValue(100, true)
  assert.equal(pairC.maxHandle.currentValue, 145)
})

test('a new module load disconnects the previous pair’s attribute observer', () => {
  const internals = loadInternals()

  const pairA = makeSlider()
  internals.onRangeslider([pairA.handles])
  internals.flush()

  assert.equal(internals.observerLog.length, 1)
  assert.equal(internals.observerLog[0].target, pairA.wrapper)
  assert.equal(internals.observerLog[0].options.attributes, true)
  // Array.from: the filter is built inside the vm, so it is a foreign-realm Array.
  assert.deepEqual(
    Array.from(internals.observerLog[0].options.attributeFilter),
    [internals.GAP_ATTR],
  )
  assert.equal(internals.observerLog[0].disconnects, 0)

  const pairB = makeSlider()
  internals.onRangeslider([pairB.handles])
  internals.flush()

  assert.equal(internals.observerLog[0].disconnects, 1, 'the old observer must be dropped')
  assert.equal(internals.observerLog.length, 2)
  assert.equal(internals.observerLog[1].disconnects, 0, 'the live observer must survive')
})

test('an attribute mutation re-opens the pair on its own, with no move to trigger it', () => {
  const slider = setup({ startMin: 200, startMax: 330, trackWidth: 328 })
  assert.equal(slider.maxHandle.currentValue, 330) // 130 apart, legal at a 48px gap

  // Editing the attribute alone changes nothing: it is the observer delivery
  // that has to schedule the pass.
  slider.wrapper.setAttribute(slider.GAP_ATTR, '96')
  slider.flush()
  assert.equal(slider.maxHandle.currentValue, 330)

  const record = slider.observerLog[slider.observerLog.length - 1]
  slider.deliver(record)
  slider.flush()

  // ceil((96 + 32) * 470 / 328) = 184, so the max thumb is pushed to 200 + 184
  // by the scheduled enforce — no setValue was issued by this test.
  assert.equal(slider.maxHandle.currentValue, 384)
  assert.equal(slider.maxHandle.inputElement.value, '384.00')
})

test('a thumb measured at zero width keeps reserving the last good pill width', () => {
  const slider = setup()

  // The group is hidden (0x0) by the time the gap attribute changes, so the
  // re-measure comes back empty. Forgetting the pill width would silently
  // shrink the reservation by a whole thumb.
  slider.minHandle.element.offsetWidth = 0
  slider.maxHandle.element.offsetWidth = 0
  slider.wrapper.setAttribute(slider.GAP_ATTR, '48px') // same gap, fresh cache key

  slider.maxHandle.setValue(100, true)
  assert.equal(slider.maxHandle.currentValue, 145, 'must still reserve 48px + a 32px pill')
  assert.notEqual(slider.maxHandle.currentValue, 99, 'a forgotten pill width would land here')
})

test('loading the script a second time is completely inert', () => {
  const api = makeFinsweetApi()
  const internals = loadInternals({ finsweet: api })
  const firstInternals = internals.context.__internals

  internals.loadAgain()

  // The init guard bails before the injected tail, so the second body never ran.
  assert.equal(internals.context.__internals, firstInternals, 'the second load executed')
  assert.equal(api.pushes.length, 1, 'a second registration would double every callback')

  const pair = makeSlider()
  api.resolveLoading([pair.handles])
  internals.flush()

  assert.equal(internals.observerLog.length, 1, 'one observer per wrapper, not one per load')
  pair.maxHandle.setValue(100, true)
  assert.equal(pair.maxHandle.currentValue, 145)
})

test('a pending pass from a retired pair never writes into the rebuilt slider', () => {
  const internals = loadInternals()

  const pairA = makeSlider({ startMin: 200, startMax: 260, trackWidth: 668 })
  internals.onRangeslider([pairA.handles])
  internals.flush()
  assert.equal(pairA.maxHandle.currentValue, 260) // 60 apart needs 57: legal
  const writesA = pairA.maxHandle.inputWrites

  // A resize queues a pass for pair A…
  pairA.minHandle.updateTrackWidth(328)
  pairA.maxHandle.updateTrackWidth(328)

  // …but the module reloads first, destroying those instances.
  const pairB = makeSlider({ startMin: 200, startMax: 260, trackWidth: 328 })
  internals.onRangeslider([pairB.handles])

  internals.flush()

  // Pair A's queued pass must have become a no-op. Un-retired it would push the
  // dead max thumb to 315 and write 315.00 into an input the new slider owns.
  assert.equal(pairA.maxHandle.currentValue, 260)
  assert.equal(pairA.minHandle.currentValue, 200)
  assert.equal(pairA.maxHandle.inputWrites, writesA)
  assert.equal(pairA.maxHandle.inputElement.value, '260.00')

  // Pair B is unaffected: its own arrival pass ran and its clamp is live.
  assert.equal(pairB.maxHandle.currentValue, 315) // 200 + 115
  assert.equal(pairB.maxHandle.setValue(250, true), false)
})
