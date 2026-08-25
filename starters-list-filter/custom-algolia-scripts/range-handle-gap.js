// Docs: https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/custom-algolia-scripts/range-handle-gap

// Finsweet Attributes v2 `rangeslider` (module 1.10.3) keeps the two thumbs apart by exactly
// one `step`: updateSiblingConstraints() does `sibling.setConstraints(currentValue + step, …)`.
// /all-starters authors step="1" over $30-$500 on a ~328px track, so the enforced separation
// is ~0.7px — the two 2rem thumbs stack on top of each other and the two price labels
// overprint into garbage. Finsweet exposes no gap / min-distance setting, so this script
// re-expresses that separation as a MINIMUM CLEAR GAP IN PIXELS between the two thumb
// rectangles, converted to value units at the live track width.
//
// Markup contract — on the [fs-rangeslider-element="wrapper"] element:
//   starters-rangeslider-gap="48"    minimum clear gap between the two thumb rects, CSS px
//   starters-rangeslider-gap="48px"  the same, explicit unit
//   starters-rangeslider-gap="3rem"  the same, in rem (resolved against the root font-size)
// Anything else — the attribute missing, negative, another unit (em/%/vw), or junk — falls
// back to the 48px default. 48px is CLEAR AIR BETWEEN THE PILL EDGES, which for the 2rem
// prod pill is 80px centre-to-centre. It costs $115 of a $470 range as the smallest
// selectable span at the 328px prod sidebar track (~24% of the scale), and $56 at the
// 668px mobile track; lower the attribute for more range, at the cost of less air.
// Single-handle sliders, and pages with no slider at all, are a silent no-op.
//
// WHY THIS CLAMPS setValue RATHER THAN WIDENING THE CONSTRAINTS
// The obvious implementation — override updateSiblingConstraints() so the sibling's bound is
// the gap instead of `step` — breaks dragging, because the library picks which thumb you
// grabbed like this:
//     ot = (value, [h0, h1]) => { … if (value >= lo && value <= hi) return h;  /* else */ }
//     I  = (event) => { … const h = ot(valueUnderPointer, handles); if (!h) return; … }
// The value under the pointer must fall INSIDE that thumb's own constraints or no drag starts
// at all. A thumb is a 32px pill centred on its value — about +/-23 value units at the prod
// track width — so once a thumb is resting exactly on a widened bound (which is the normal
// state the moment the gap engages), every click on the half of the pill facing that bound
// resolves to a value just outside the constraint and the thumb silently refuses to move.
// Leaving the library's own `step` constraints alone keeps its picker behaving exactly as it
// does today, so the whole pill stays grabbable; the gap is instead enforced in setValue(),
// which every path funnels through — mouse drag, touch drag, click-to-jump on the track, the
// input-changed handler, and the arrow keys. Keyboard matters and is easy to miss: lt() stamps
// role="slider" + tabindex="0" on each handle and listenEvents() binds keydown -> handleKeyDown
// -> this.setValue(currentValue ± step), so a focused thumb is fully arrow-drivable. It only
// LOOKS dead because the drag-release handler calls element.blur() — tab to a thumb without
// dragging first and 40 ArrowLefts walk it 500 -> 460. Because handleKeyDown goes through
// setValue like everything else, this clamp covers it for free; do not narrow the clamp to
// pointer paths only. As a bonus the thumb still lands exactly on the gap boundary rather
// than stopping a mousemove-step short of it.
//
// VALUE POLICY — and why a resize has to be allowed to move a thumb
// During a gesture the script only ever narrows a value the library was already about to
// commit: a move that OPENS the gap is always allowed, only a move that would close it past
// the minimum is clamped.
// A gap in pixels, though, is a gap in value units only at one track width. When the track
// SHRINKS (window narrowed, phone rotated, filter panel moved from the modal to the sidebar)
// the library re-lays the thumbs out at the same values on a smaller track, so a pair that
// was legal becomes too close — and at phone-portrait widths it goes all the way back to
// overlapping pills and overprinted labels, i.e. the exact bug this script exists to kill.
// So on every track-width change the pair is re-opened to the gap the new width needs,
// preferring to push the MAX thumb up (a wider, less restrictive rate filter) and only
// pulling the MIN thumb down if the max is already at the ceiling. Where the thumb stood
// before that push is remembered as a debt, repaid at the FIRST GAP-SAFE OPPORTUNITY — the
// track growing back is the usual one, but any enforce pass (a height-only resize, a gap
// attribute edit) repays early when the user has since opened room, rather than ratcheting
// the range open one rotation at a time. Repayment can never move a thumb past where it
// stood before the push. This is the one case where the script moves a thumb on
// its own; it writes through the normal setValue path, so the input, the label, the fill and
// the wf-algolia listeners all stay in step.
// If a pair is somehow still closer than the gap (authored that way via fs-rangeslider-start
// while the track is unmeasurable) the clamp degrades to "hold still" rather than yanking a
// thumb backwards, so each thumb always keeps its escape route in the direction that opens
// the gap. If the gap is wider than the whole range can express it is capped at the range,
// which parks the thumbs at the two ends — a loud, non-overlapping failure for a
// misconfigured attribute instead of a silent return of the original bug.

(function () {
  'use strict'

  if (document.documentElement.getAttribute('data-range-handle-gap-inited') === 'true') return
  document.documentElement.setAttribute('data-range-handle-gap-inited', 'true')

  var WRAPPER_SEL = '[fs-rangeslider-element="wrapper"]'
  var GAP_ATTR = 'starters-rangeslider-gap'
  var DEFAULT_GAP_PX = 48 // 3rem of clear air between the pill edges
  var PATCHED_FLAG = 'startersGapPatched'
  var RESTART_FLAG = 'startersGapRestartWrapped'

  // Live attribute observers, one per patched pair. Dropped and rebuilt on every module
  // (re)load so a restart() can never leave an observer driving destroyed handle instances.
  var observers = []

  // Kill switches for the previous load's pairs: restart() destroys the handle instances,
  // so a pending scheduled enforce from an old closure must become a no-op, not a write
  // into the rebuilt slider's inputs.
  var retired = []

  var num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : null }

  var rootFontSize = function () {
    var n = num(window.getComputedStyle(document.documentElement).fontSize)
    return n !== null && n > 0 ? n : 16
  }

  // "16" / "16px" / "1rem" -> px. Everything else — missing, negative, "3em", "50%", junk —
  // falls back to the default rather than being silently misread as pixels.
  var parseGapPx = function (raw) {
    if (raw === null || raw === undefined) return DEFAULT_GAP_PX
    var m = /^\s*([0-9]*\.?[0-9]+)\s*(px|rem)?\s*$/i.exec(String(raw))
    if (!m) return DEFAULT_GAP_PX
    var n = num(m[1])
    if (n === null || n < 0) return DEFAULT_GAP_PX
    return m[2] && m[2].toLowerCase() === 'rem' ? n * rootFontSize() : n
  }

  var patchPair = function (handles) {
    var a = handles[0].index === 1 ? handles[1] : handles[0] // min thumb
    var b = a === handles[0] ? handles[1] : handles[0]       // max thumb
    var wrapper = a.element && a.element.closest ? a.element.closest(WRAPPER_SEL) : null

    // setValue() runs on every pointermove of a drag, so the two measurements that force
    // layout are cached and refreshed only when something that affects them has changed:
    // the track width (resize, or a hidden group being revealed) or the authored attribute.
    var gapPx = DEFAULT_GAP_PX
    var handleW = 0
    var lastTrackWidth = null
    var lastRaw = null

    var refresh = function (handle) {
      var raw = wrapper ? wrapper.getAttribute(GAP_ATTR) : null
      if (handle.trackWidth === lastTrackWidth && raw === lastRaw) return
      lastTrackWidth = handle.trackWidth
      lastRaw = raw
      gapPx = parseGapPx(raw)
      // offsetWidth, not getBoundingClientRect(): the library measures the track with
      // clientWidth, so both numbers have to be layout px or a scaled ancestor would skew
      // the px -> value conversion.
      var w = handle.element ? handle.element.offsetWidth : 0
      if (w > 0) handleW = w // keep the last good width while the group is hidden (0x0)
    }

    // Minimum separation in VALUE units that buys `gapPx` of clear air between the two thumb
    // rectangles at the current track width, rounded UP onto a legal step boundary. A thumb
    // is centred on its value position, so the centres must clear gapPx + one thumb width.
    // Capped at the full range: a gap that cannot fit parks the thumbs at the two ends
    // instead of standing down and letting them overlap again.
    // null == the geometry is unmeasurable (hidden group, zero-width track); the caller
    // stands down and leaves the library alone until it can be measured.
    var gapValue = function (handle) {
      refresh(handle)
      var track = handle.trackWidth
      var range = handle.totalRange
      var step = handle.step
      if (!(track > 0) || !(range > 0) || !(step > 0)) return null
      var need = Math.ceil((gapPx + handleW) * range / track / step) * step
      if (!isFinite(need)) return null
      if (need > range) need = range
      return need < step ? step : need
    }

    // Flipped by the next module (re)load: a restart() destroys these handle instances,
    // and a pending setTimeout enforce or a late observer delivery must not drive them.
    var dead = false

    // Where a thumb stood before a SHRINKING track forced this script to push it — the debt
    // owed back to the user. A track that grows again repays it, so rotating a phone twice
    // does not ratchet the range open one step at a time. It is only ever a repayment: a
    // widening track can never take a thumb past where it stood before our push, and a thumb
    // the user moves themselves cancels the debt on it.
    var owed = [null, null]
    var enforcing = false
    var pending = false

    // The clamp turns a rejected move into a no-op, which means the library's setValue never
    // runs and never syncs the input. Anything that wrote the input directly (a typed value,
    // a programmatic restore) would then be left disagreeing with the thumb, so pull it back
    // into line — but only when it actually diverged, never on every frame of a drag.
    var resyncInput = function (handle) {
      var el = handle.inputElement
      if (!el || typeof handle.updateInputElement !== 'function') return
      var have = num(el.value)
      if (have !== null && Math.abs(have - handle.currentValue) < 1e-9) return
      handle.updateInputElement()
    }

    var enforce = function () {
      if (enforcing) return
      var need = gapValue(a)
      if (need === null) return
      enforcing = true
      try {
        // 1. repay whatever a previously narrower track had to take.
        if (owed[1] !== null && owed[1] < b.currentValue) {
          var backB = Math.max(owed[1], a.currentValue + need)
          if (backB < b.currentValue) b.setValue(backB, true)
          if (b.currentValue <= owed[1] + 1e-9) owed[1] = null
        }
        if (owed[0] !== null && owed[0] > a.currentValue) {
          var backA = Math.min(owed[0], b.currentValue - need)
          if (backA > a.currentValue) a.setValue(backA, true)
          if (a.currentValue >= owed[0] - 1e-9) owed[0] = null
        }
        // 2. open the pair to whatever the current track width needs. Push the max thumb up
        //    first — a wider rate filter is the harmless direction — and only pull the min
        //    thumb down when the max has nowhere left to go.
        if (b.currentValue - a.currentValue < need) {
          var up = a.currentValue + need
          if (up > b.maxRange) up = b.maxRange
          if (up > b.currentValue) {
            if (owed[1] === null) owed[1] = b.currentValue
            b.setValue(up, true)
          }
        }
        if (b.currentValue - a.currentValue < need) {
          var down = b.currentValue - need
          if (down < a.minRange) down = a.minRange
          if (down < a.currentValue) {
            if (owed[0] === null) owed[0] = a.currentValue
            a.setValue(down, true)
          }
        }
      } catch (e) {
        // never let a geometry edge case throw out of a resize handler
      } finally {
        enforcing = false
      }
    }

    // updateTrackWidth() is called once per handle per resize, so coalesce to one pass after
    // both handles have taken the new width.
    var schedule = function () {
      if (pending) return
      pending = true
      window.setTimeout(function () {
        pending = false
        if (!dead) enforce()
      }, 0)
    }

    var patch = function (handle) {
      if (handle[PATCHED_FLAG]) return
      var origSetValue = handle.setValue
      var origUpdateTrackWidth = handle.updateTrackWidth
      if (typeof origSetValue !== 'function') return
      handle[PATCHED_FLAG] = true

      handle.setValue = function (value, updateInput) {
        var sibling = this.sibling
        var need = sibling ? gapValue(this) : null
        var slot = this.index === 0 ? 0 : 1
        if (need !== null && isFinite(value)) {
          if (this.index === 0) {
            // Min thumb: never climb past the ceiling the max thumb imposes.
            var ceiling = sibling.currentValue - need
            if (ceiling < this.minRange) ceiling = this.minRange
            if (value > this.currentValue && value > ceiling) {
              if (ceiling <= this.currentValue) { // already there: hold, never yank back
                resyncInput(this)
                return false
              }
              value = ceiling
            }
          } else {
            // Max thumb: never drop below the floor the min thumb imposes.
            var floor = sibling.currentValue + need
            if (floor > this.maxRange) floor = this.maxRange
            if (value < this.currentValue && value < floor) {
              if (floor >= this.currentValue) {
                resyncInput(this)
                return false
              }
              value = floor
            }
          }
        }
        var committed = origSetValue.call(this, value, updateInput)
        // A move the user actually COMMITTED is a fresh statement of intent, so nothing is
        // owed back on that thumb. A move we refused (held against the wall) is not: clearing
        // the debt there would forget a push the user never got the chance to undo, and the
        // thumb would not return on a track that grows back.
        if (committed && !enforcing) owed[slot] = null
        return committed
      }

      if (typeof origUpdateTrackWidth === 'function') {
        handle.updateTrackWidth = function (width) {
          var out = origUpdateTrackWidth.call(this, width)
          schedule()
          return out
        }
      }
    }

    patch(a)
    patch(b)

    retired.push(function () { dead = true })

    if (wrapper && window.MutationObserver) {
      var mo = new window.MutationObserver(schedule)
      mo.observe(wrapper, { attributes: true, attributeFilter: [GAP_ATTR] })
      observers.push(mo)
    }

    // A pair authored closer than the gap (fs-rangeslider-start) is the bug on arrival, so
    // open it once now. With no start values authored — the /all-starters case — the pair
    // begins at min/max and this is a no-op.
    schedule()
  }

  // One entry per wrapper on the page. A single-handle slider is emitted as
  // [handle0, undefined], so the hole has to be dropped before counting.
  var onRangeslider = function (result) {
    for (var o = 0; o < observers.length; o++) {
      try { observers[o].disconnect() } catch (e) {}
    }
    observers = []
    for (var r = 0; r < retired.length; r++) {
      try { retired[r]() } catch (e) {}
    }
    retired = []

    try { wrapRestart() } catch (e) {}

    var groups = Array.prototype.slice.call(result || [])
    for (var i = 0; i < groups.length; i++) {
      var handles = Array.prototype.slice.call(groups[i] || []).filter(Boolean)
      if (handles.length !== 2 || !handles[0].element) continue
      try {
        patchPair(handles)
      } catch (e) {
        // One malformed group must never take the rest of the page down with it.
      }
    }
  }

  // Documented public entry point. The loader resolves this against a promise, so pushing
  // before or after attributes.js lands works identically.
  var register = function () {
    try {
      window.FinsweetAttributes = window.FinsweetAttributes || []
      if (typeof window.FinsweetAttributes.push === 'function') {
        window.FinsweetAttributes.push(['rangeslider', onRangeslider])
      }
    } catch (e) {}
  }

  // restart() is Finsweet's documented remedy after the DOM changes; it destroys every handle
  // instance and builds new, unpatched ones, and the loader reassigns module.restart on each
  // load. Re-wrap it every time our callback runs and re-register against the new loading
  // promise, or the fix would silently switch itself off the first time anything restarts.
  var wrapRestart = function () {
    var fs = window.FinsweetAttributes
    var mod = fs && fs.modules ? fs.modules.rangeslider : null
    if (!mod || typeof mod.restart !== 'function' || mod.restart[RESTART_FLAG]) return
    var orig = mod.restart
    var wrapped = function () {
      try {
        return orig.apply(this, arguments)
      } finally {
        register() // load() swaps module.loading synchronously, so this lands on the new one
      }
    }
    wrapped[RESTART_FLAG] = true
    mod.restart = wrapped
  }

  register()
})()
