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
 * @param {{rootFontSize?: number}} [options] root font-size px for rem parsing
 * @returns {{parseGapPx: Function, patchPair: Function, onRangeslider: Function,
 *   DEFAULT_GAP_PX: number, GAP_ATTR: string, flush: Function}}
 */
function loadInternals(options = {}) {
  const rootFontSize = options.rootFontSize === undefined ? 16 : options.rootFontSize

  const exposed = source.replace(
    /\}\)\(\);?\s*$/,
    'globalThis.__internals = { parseGapPx, patchPair, onRangeslider, DEFAULT_GAP_PX, GAP_ATTR };\n})();',
  )

  assert.notEqual(exposed, source, 'failed to inject the test tail')

  const noop = () => {}
  const timers = []
  const htmlAttrs = new Map()

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
        this.callback = callback
        this.observe = noop
        this.disconnect = noop
      },
    },
  }

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

  return Object.assign({ flush }, context.__internals)
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
