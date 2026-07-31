/**
 * V3 xano-grabber — live mirror of a rendered value into another element.
 *
 * Page glue for pages that render a value in one place (a wf-xano card, a
 * Webflow CMS binding, an Algolia hit, hand-written HTML) and need the SAME
 * value in a second, structurally unrelated place — the onboarding preview's
 * profile photo repeated in the page hero, a team list mirrored into a strip
 * further down the page. The Designer owns all markup, classes and layout; this
 * module owns exactly one thing: copying a rendered value from a `source`
 * element into every `landing` element that shares its `wf-xano-grab-id`.
 *
 * It never fetches anything, never reads storage, and writes only two things:
 * `textContent` on a non-IMG landing, and `src` (after `srcset` is stripped) on
 * an IMG landing. See v3/xano-grabber/XANO-GRABBER-WIRING.md for the attribute
 * table and the Designer checklist.
 *
 * WHY A DOM MIRROR AND NOT A wf-xano BIND:
 * wf-xano binds one template per wrapper, and a value can only be bound inside
 * the wrapper that fetched it. A hero band outside that wrapper — or a second
 * section on the same page — has no instance of its own and no way to reach the
 * response. Adding a second wrapper means a second GET of the same endpoint and
 * a second render to keep in sync. Mirroring the rendered DOM value costs no
 * request and cannot disagree with what the user is already looking at.
 *
 * WHY SOURCES ARE DESCRIPTORS, NOT NODES (do not "simplify" this to a cached
 * element reference): wf-xano's default, non-keyed render REPLACES cards. Its
 * `load()` removes every `[wf-xano-item]` clone BEFORE the fetch starts, then
 * `render()` clones brand-new nodes from the template. So for the whole width of
 * a refresh there is no source element on the page at all, and afterwards its
 * identity has changed. Every flush therefore re-resolves sources from the DOM
 * by attribute. Verified against wf-xano v0.28.0 (`load()` pre-clear, `render()`
 * re-clone, `_renderItemsKeyed` fill-in-place).
 *
 * WHY THE TEMPLATE IS EXCLUDED: the source attributes are authored on the
 * hidden `[wf-xano-element="template"]`, so every rendered clone inherits them —
 * that is how one Designer edit covers N cards. But the template itself is never
 * filled and never removed: it keeps its authored `data:` SVG placeholder for the
 * page's whole life, and it precedes its clones in DOM order. A grabber that took
 * the first match would mirror that placeholder forever with no error anywhere.
 * Template descendants are never sources.
 *
 * WHY LANDINGS NEVER REVERT: because of the pre-clear above, "no source right
 * now" is the normal state during every refresh, and a member with no photo
 * produces no mutation at all. So a landing keeps its authored content until a
 * REAL value arrives (non-empty; for images, not a `data:`/`blob:` URI), and once
 * it holds a real value only another real value can overwrite it. The single
 * exception is a list landing whose source container is showing its wf-xano
 * `empty` state block: that is an authoritative "there genuinely are no items",
 * and the mirrored clones are cleared.
 *
 * WHY ONE BODY-LEVEL OBSERVER: there is no document-level "render complete"
 * event in wf-xano (the only document events it dispatches are
 * `wf-xano:favorite*`), and no "instance created" event, and sources/landings can
 * live in different Webflow sections with no common wf-xano ancestor. So the
 * primary trigger is one long-lived MutationObserver on `document.body`, exactly
 * like wf-xano's own favorites observer. `childList` does double duty: it catches
 * new clones AND text writes, because a `textContent` assignment replaces the
 * text node (it never fires `characterData` — do not add it expecting text
 * binds). Re-scans are coalesced with `setTimeout(…, 0)` and NEVER
 * `requestAnimationFrame`: rAF is throttled to zero in a hidden browser pane,
 * which is exactly the QA setup this repo uses.
 *
 * LOOP GUARD, three parts, all needed: this module writes `textContent` and
 * `src` — the same record types it observes. Records whose target sits inside a
 * landing (or one of our clones, or the overlay) are ignored; every write is
 * compared against the last value written for that landing so a re-entrant pass
 * is a no-op; and `observer.takeRecords()` discards our own echo at the end of
 * each flush. Do NOT disconnect/reconnect around writes instead — a real render
 * landing in that window would be missed entirely.
 *
 * ALWAYS go through `WfXano.push()`, never call arm directly on `window.WfXano`.
 * Both shapes of that global expose push() and both defer correctly (pre-load
 * array drained at boot; post-load API object runs now if booted, else queues).
 * Branching on Array.isArray and arming directly was a real shipped bug in a
 * sibling script: wf-xano assigns `window.WfXano = {api}` at module scope, BEFORE
 * boot() creates any instance, so a deferred page script landing in that window
 * arms against an empty instance list and gives up permanently. Here the wf-xano
 * hooks are only a belt — the observer alone is sufficient, and the module works
 * on a page with no wf-xano at all.
 *
 * Install: any page that mirrors a value. One deferred jsDelivr tag, next to the
 * pinned wf-xano tag when the page uses wf-xano. Inert on pages with no
 * `wf-xano-grab-element` attribute. Staging-only diagnostics; add `?xano-grab`
 * to the URL on a staging host for the pairing overlay.
 */
;(function () {
  'use strict'

  if (window.__startersV3XanoGrabberBooted) return
  window.__startersV3XanoGrabberBooted = true

  /* ------------------------------- attributes ------------------------------ */

  // Our own grammar. Additive to wf-xano's vocabulary, never a rename of it.
  var GRAB_ELEMENT = 'wf-xano-grab-element'
  var GRAB_ID = 'wf-xano-grab-id'
  var GRAB_LIST = 'wf-xano-grab-list'
  var GRAB_LIST_CONTAINER = 'wf-xano-grab-list-container'
  var GRAB_ITEM = 'wf-xano-grab-item'
  // Marks the clones this module owns inside a list landing. Ours to rebuild,
  // and never a source: a clone carrying a source attribute would feed itself.
  var CLONE_ATTR = 'data-wf-xano-grab-clone'
  var OVERLAY_ATTR = 'data-starters-xano-grab-overlay'

  // Read, never written: wf-xano's own vocabulary.
  var XANO_ELEMENT = 'wf-xano-element'
  var XANO_ITEM = 'wf-xano-item'
  var XANO_RECORD_ID = 'data-wf-xano-id'

  // Selector strings are built once, from the attribute-name constants above —
  // never inlined at a call site, so a rename is one edit.
  var SOURCE = '[' + GRAB_ELEMENT + '="source"]'
  var LANDING = '[' + GRAB_ELEMENT + '="landing"]'
  var ITEM_TEMPLATE = '[' + GRAB_ELEMENT + '="list-item"]'
  var SOURCE_CANDIDATE = SOURCE + '[' + GRAB_ID + ']'
  var LANDING_CANDIDATE = LANDING + '[' + GRAB_ID + ']'
  var CLONE = '[' + CLONE_ATTR + ']'
  var OVERLAY = '[' + OVERLAY_ATTR + ']'
  var XANO_TEMPLATE = '[' + XANO_ELEMENT + '="template"]'
  var XANO_EMPTY = '[' + XANO_ELEMENT + '="empty"]'
  var RECORD_HOLDER = '[' + XANO_RECORD_ID + ']'
  // Marker gate: any element of our grammar, sources included — they are
  // authored on the static (hidden) wf-xano template, so they exist in the
  // page HTML at parse time, before any render.
  var MARKER = '[' + GRAB_ELEMENT + ']'
  // Everything this module owns. Records inside it are our own echo, and an
  // element inside it is never a source.
  var OWNED = LANDING + ', ' + CLONE + ', ' + OVERLAY

  /* -------------------------------- tune-ables ----------------------------- */

  // Belt sweeps after boot, for instances created by a later WfXano.init(el) —
  // the library emits no "instance created" event to subscribe to.
  var SWEEP_DELAYS = [250, 800]
  // "Nothing has rendered yet" is the NORMAL state at boot: the first flush runs
  // at DOMContentLoaded, before any fetch has answered, and the only sources on
  // the page then are inside the hidden template (correctly skipped). So the
  // orphan warnings wait out one grace window and re-check, or every healthy
  // page would print "no source element on the page" for every grab-id.
  var ORPHAN_GRACE = 3000
  // What the observer listens for. `childList` catches clone add/remove AND
  // textContent writes; `characterData` is pointless against wf-xano (§ header).
  // `style`/`class` are in the filter because the visible-source preference
  // below depends on the computed display chain, which Webflow drives with both.
  var ATTRIBUTE_FILTER = [
    'src',
    'srcset',
    'style',
    'class',
    XANO_ITEM,
    XANO_RECORD_ID,
    'data-wf-xano-bound-value',
  ]
  var OVERLAY_PARAM = 'xano-grab'
  // Truncation for overlay/log values only — never applied to a mirrored value.
  var PREVIEW = 60

  /* ------------------------------- diagnostics ----------------------------- */

  // Staging, local, or a cloudflared dev tunnel — never the production domain.
  // Copied from v3/saved-starters-roles.js, with the dots anchored: this gate
  // also decides whether the ?xano-grab overlay may render, and a lookalike
  // domain like "notwebflow.io" must not pass for staging.
  function stagingHost() {
    var host = location.hostname
    return (
      /(\.|^)webflow\.io$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
    )
  }

  // STARTERS_DEBUG belongs HERE and not in stagingHost() — it may turn logging
  // on in production, and must never unlock the overlay, which prints the page's
  // record ids.
  function diagnostic() {
    return stagingHost() || window.STARTERS_DEBUG
  }

  var warned = Object.create(null)

  function warn(message) {
    if (diagnostic()) console.warn('[starters xano-grabber] ' + message)
  }

  // Every warning here fires from inside a flush, and a flush runs on every
  // mutation batch. Once per distinct message, or a miswired page would print
  // thousands of identical lines.
  function warnOnce(key, message) {
    if (warned[key]) return
    warned[key] = true
    warn(message)
  }

  function note(message) {
    if (diagnostic()) console.info('[starters xano-grabber] ' + message)
  }

  /* ------------------------------ pure helpers ----------------------------- */

  function all(root, selector) {
    if (!root || typeof root.querySelectorAll !== 'function') return []
    return Array.prototype.slice.call(root.querySelectorAll(selector))
  }

  function elementChildren(el) {
    if (!el) return []
    if (el.children) return Array.prototype.slice.call(el.children)
    return Array.prototype.filter.call(el.childNodes || [], function (node) {
      return node.nodeType === 1
    })
  }

  // "Real content" gate, the single rule behind never-revert. An image src that
  // is a data:/blob: URI is a placeholder by construction — wf-xano only writes
  // a src when the resolved value is non-blank, so a member with no photo keeps
  // the authored inline SVG and fires no mutation at all.
  function isRealValue(value) {
    if (value == null) return false
    var text = String(value)
    return text.trim() !== '' && !/^\s*(data:|blob:)/i.test(text)
  }

  function trimText(el) {
    if (!el) return ''
    return String(el.textContent == null ? '' : el.textContent)
      .replace(/\s+/g, ' ')
      .trim()
  }

  function inlineHidden(el) {
    return !!(el && el.style && el.style.display === 'none')
  }

  function computedDisplay(el) {
    if (typeof window.getComputedStyle !== 'function') return ''
    try {
      var style = window.getComputedStyle(el)
      return (style && style.display) || ''
    } catch (e) {
      return '' // detached node, or a realm without a view
    }
  }

  // Visibility as a CHAIN, not one element: the onboarding page keeps both form
  // blocks in the DOM at all times and switches them with inline `display` on
  // the wrapper, so the hidden card's own style says nothing. Inline display is
  // checked first so the rule still holds in a headless/no-view context.
  function hiddenChain(el) {
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (inlineHidden(node)) return true
      if (computedDisplay(node) === 'none') return true
    }
    return false
  }

  function firstImg(el) {
    if (!el) return null
    if (el.tagName === 'IMG') return el
    return typeof el.querySelector === 'function' ? el.querySelector('img') : null
  }

  // A "text slot" is a leaf element: it holds text and nothing structural. Used
  // on both sides — the item's slots are the values, the clone's slots are the
  // destinations — so the pairing is symmetrical by construction.
  function leafTextSlots(root) {
    return all(root, '*').filter(function (el) {
      if (elementChildren(el).length) return false
      if (el.tagName === 'IMG' || el.tagName === 'BR') return false
      return true
    })
  }

  // The item's values, in DOM order. Empty leaves are dropped rather than
  // occupying a slot: a card whose optional location field rendered blank must
  // not push every later value out of its slot.
  function itemTexts(item) {
    return leafTextSlots(item)
      .map(trimText)
      .filter(function (text) {
        return !!text
      })
  }

  function matches(el, selector) {
    return !!(el && typeof el.matches === 'function' && el.matches(selector))
  }

  function closest(el, selector) {
    return el && typeof el.closest === 'function' ? el.closest(selector) : null
  }

  function truncate(value) {
    var text = String(value == null ? '' : value)
    return text.length > PREVIEW ? text.slice(0, PREVIEW) + '…' : text
  }

  /* ------------------------------ module state ----------------------------- */

  // landing (or clone slot) -> last value this module wrote there. Doubles as
  // "has ever held a real value", which is what never-revert keys on.
  var lastWritten = new WeakMap()
  // list landing -> signature of the items it was last built from.
  var lastSignature = new WeakMap()
  // grab-id -> the source element used last flush, for the re-resolve counter.
  var lastSource = Object.create(null)
  var counters = { flushes: 0, echoes: 0, reresolves: 0, templateSkips: 0, writes: 0 }
  var lastReport = { ids: [], counters: counters }
  var observer = null
  var queued = false
  // False until the grace window above has passed. Gates only the warnings that
  // "not rendered yet" would make wrong; the overlay reports WAITING from the
  // first pass either way.
  var settled = false

  /* --------------------------- descriptor resolution ---------------------- *
   * A source is a DESCRIPTOR — (attribute, id) — resolved fresh every flush.
   * Never a cached node: see the header. The exclusions here are all traps that
   * have bitten a sibling script, not defensive noise.
   * ----------------------------------------------------------------------- */

  function scanSources() {
    var byId = Object.create(null)
    all(document, SOURCE_CANDIDATE).forEach(function (el) {
      if (el.isConnected === false) return
      if (closest(el, XANO_TEMPLATE)) {
        counters.templateSkips++ // the decoy placeholder img — never a source
        return
      }
      if (closest(el, OWNED)) return // a landing (or our clone) is never a source
      var id = el.getAttribute(GRAB_ID)
      if (!id) return
      ;(byId[id] = byId[id] || []).push(el)
    })
    return byId
  }

  function scanLandings() {
    var byId = Object.create(null)
    all(document, LANDING_CANDIDATE).forEach(function (el) {
      if (el.isConnected === false) return
      if (closest(el, CLONE)) return // a slot inside our own clone
      var id = el.getAttribute(GRAB_ID)
      if (!id) return
      ;(byId[id] = byId[id] || []).push(el)
    })
    return byId
  }

  function recordId(el) {
    var holder = closest(el, RECORD_HOLDER)
    return holder ? holder.getAttribute(XANO_RECORD_ID) : null
  }

  function candidateRecordIds(candidates) {
    return candidates.map(function (el) {
      return recordId(el) || '(none)'
    })
  }

  // Which of N rendered candidates this landing wants.
  //
  // `wf-xano-grab-item` exists because source attributes are authored on the
  // wf-xano template, so ALL rendered clones inherit them: with 10 items there
  // was otherwise no way to say "mirror Alex Rivera's card". It lives on the
  // LANDING, so two landings can mirror two different records of one list.
  //   "#2"      -> 1-based index into the rendered candidates, in DOM order.
  //                Re-evaluated every flush, so it shifts with sort/filter —
  //                that is the point ("featured = the first card").
  //   "<value>" -> the candidate whose closest [data-wf-xano-id] equals it.
  // When present it OVERRIDES the visible-preferred rule below. No match is not
  // an error state on the page: the landing keeps its last real value and the
  // overlay says ITEM NOT FOUND.
  function pickSource(candidates, landing) {
    if (!candidates.length) return { source: null, reason: null }
    var want = landing ? landing.getAttribute(GRAB_ITEM) : null
    if (want != null && String(want).trim() !== '') {
      var value = String(want).trim()
      if (value.charAt(0) === '#') {
        var index = parseInt(value.slice(1), 10)
        var picked = index > 0 ? candidates[index - 1] : null
        return picked
          ? { source: picked, reason: null, item: value }
          : { source: null, reason: 'ITEM NOT FOUND', item: value }
      }
      for (var i = 0; i < candidates.length; i++) {
        if (recordId(candidates[i]) === value) {
          return { source: candidates[i], reason: null, item: value }
        }
      }
      return { source: null, reason: 'ITEM NOT FOUND', item: value }
    }
    // Visible-preferred, DOM order as the tie-break: the onboarding page has two
    // wrappers carrying the same grab-ids and switches them with inline display,
    // so plain first-in-DOM would mirror the hidden form's card.
    for (var v = 0; v < candidates.length; v++) {
      if (!hiddenChain(candidates[v])) return { source: candidates[v], reason: null }
    }
    return { source: candidates[0], reason: null, allHidden: true }
  }

  /* --------------------------- single-value mirroring ---------------------- */

  function writeText(el, value) {
    if (lastWritten.get(el) === value) return
    el.textContent = value
    lastWritten.set(el, value)
    counters.writes++
  }

  function writeSrc(el, value) {
    if (lastWritten.get(el) === value) return
    // Order matters, and mirrors wf-xano's own fillCard: a surviving srcset
    // wins over src in the browser's selection, so strip it first.
    el.removeAttribute('srcset')
    el.setAttribute('src', value)
    lastWritten.set(el, value)
    counters.writes++
  }

  // Returns the landing's state: REAL | GATED | MISMATCH.
  function mirrorValue(source, landing) {
    if (landing.tagName === 'IMG') {
      var img = firstImg(source)
      var src = img && img.getAttribute('src')
      if (!isRealValue(src)) return lastWritten.has(landing) ? 'REAL' : 'GATED'
      writeSrc(landing, src)
      return 'REAL'
    }
    // Image URL into a text landing is UNSUPPORTED in v1 (no
    // `wf-xano-grab-type` override). An IMG source's textContent is empty, so
    // without this branch the landing would sit "gated" forever with no clue
    // anywhere that the wiring is wrong.
    if (source.tagName === 'IMG') return 'MISMATCH'
    var text = trimText(source)
    if (!text) return lastWritten.has(landing) ? 'REAL' : 'GATED'
    writeText(landing, text)
    return 'REAL'
  }

  /* -------------------------------- list mode ----------------------------- *
   * The SOURCE is a container and each rendered child is one item. Item
   * selection is the finding that ticket 04's prototype was built to settle:
   * wf-xano's loader/empty/error state blocks live INSIDE the container, so a
   * plain "every non-template child" rule mirrors "Loading team…" as a card.
   * ----------------------------------------------------------------------- */

  function listItems(container) {
    var kids = elementChildren(container)
    var marked = kids.filter(function (kid) {
      return kid.hasAttribute(XANO_ITEM)
    })
    if (marked.length) return marked // wf-xano rendered clones: authoritative
    // No wf-xano markers (a CMS list, hand-written HTML): anything carrying a
    // wf-xano-element role is a template or a state block, never an item.
    return kids.filter(function (kid) {
      if (kid.hasAttribute(XANO_ELEMENT)) return false
      if (kid.hasAttribute(CLONE_ATTR)) return false
      return !inlineHidden(kid)
    })
  }

  // "Genuinely zero results", as opposed to the transient clear that precedes
  // every fetch. wf-xano shows the container's `empty` state block for the
  // former and nothing at all for the latter, so the block's visibility is the
  // only honest signal — 0 children is not.
  function confirmedEmpty(container) {
    var empty = typeof container.querySelector === 'function' ? container.querySelector(XANO_EMPTY) : null
    return !!(empty && !hiddenChain(empty))
  }

  function itemSignature(items) {
    return items
      .map(function (item) {
        var img = firstImg(item)
        return (img ? img.getAttribute('src') : 'NOIMG') + '~' + itemTexts(item).join('|')
      })
      .join('||')
  }

  function fillClone(clone, item) {
    var target = firstImg(clone)
    var img = firstImg(item)
    var src = img && img.getAttribute('src')
    // No img on the item, or an img still holding its placeholder: the clone
    // keeps the authored placeholder. It is never hidden — layout is
    // Designer-owned, and a missing photo is not a missing card.
    if (target && isRealValue(src)) writeSrc(target, src)

    var slots = leafTextSlots(clone)
    if (!slots.length) return
    // One slot means the Designer asked for the whole item as one string.
    if (slots.length === 1) {
      writeText(slots[0], trimText(item))
      return
    }
    var texts = itemTexts(item)
    slots.forEach(function (slot, index) {
      // Unfilled slots are BLANKED, deliberately: keeping the authored copy
      // leaks Designer lorem ("Lorem location TBD") to production.
      writeText(slot, texts[index] == null ? '' : texts[index])
    })
  }

  function clones(landing) {
    return all(landing, CLONE)
  }

  function clearClones(landing) {
    clones(landing).forEach(function (node) {
      node.remove()
    })
  }

  // Returns { state, items, note } for the overlay.
  function mirrorList(source, landing) {
    var template = landing.querySelector(ITEM_TEMPLATE)
    if (!template) {
      warnOnce(
        'no-item-template:' + landing.getAttribute(GRAB_ID),
        'grab-id "' + landing.getAttribute(GRAB_ID) + '": list landing has no [' + GRAB_ELEMENT +
          '="list-item"] template — nothing can be mirrored into it.',
      )
      return { state: 'ERROR', items: '0/0', note: 'no list-item template' }
    }
    // The template is the pattern, never a rendered row. Hidden the same way
    // wf-xano hides its own.
    if (template.style) template.style.display = 'none'

    var items = listItems(source)
    var have = clones(landing).length

    if (!items.length) {
      if (confirmedEmpty(source)) {
        // Authoritative empty: clear. Never-revert protects a transient clear,
        // not a real zero-result — otherwise stale cards outlive the data.
        clearClones(landing)
        lastSignature.set(landing, '')
        return { state: 'REAL', items: '0/0', note: 'confirmed empty — cleared' }
      }
      return {
        state: have ? 'REAL' : 'WAITING',
        items: '0/' + have,
        note: 'never-revert: kept ' + have + ' clone(s)',
      }
    }

    var signature = itemSignature(items)
    if (lastSignature.get(landing) === signature && have === items.length) {
      return { state: 'REAL', items: items.length + '/' + have }
    }
    lastSignature.set(landing, signature)
    // Rebuilt wholesale rather than reconciled: no state lives inside a clone,
    // so a rebuild is always correct and never half-applied.
    clearClones(landing)
    items.forEach(function (item) {
      var clone = template.cloneNode(true)
      clone.removeAttribute(GRAB_ELEMENT) // a clone is never a template or a source
      clone.removeAttribute(GRAB_ID)
      clone.setAttribute(CLONE_ATTR, '')
      if (clone.style) clone.style.display = ''
      fillClone(clone, item)
      landing.appendChild(clone)
    })
    return { state: 'REAL', items: items.length + '/' + items.length }
  }

  /* ---------------------------------- flush ------------------------------- */

  function schedule() {
    if (queued) return
    queued = true
    setTimeout(flush, 0)
  }

  function mirrorPair(source, landing, row) {
    var sourceIsList = source.hasAttribute(GRAB_LIST)
    var landingIsList = landing.hasAttribute(GRAB_LIST_CONTAINER)
    var id = row.id

    if (sourceIsList && !landingIsList) {
      warnOnce(
        'list-into-single:' + id,
        'grab-id "' + id + '": the source is a list container (' + GRAB_LIST +
          ') but this landing is not (' + GRAB_LIST_CONTAINER +
          ') — no silent whole-container text fallback, nothing is mirrored.',
      )
      return { state: 'ERROR', note: 'list source, non-list landing' }
    }
    if (!sourceIsList && landingIsList) {
      // Writing the source's text into a list container would destroy the
      // list-item template it holds. Refuse, loudly.
      warnOnce(
        'single-into-list:' + id,
        'grab-id "' + id + '": this landing is a list container (' + GRAB_LIST_CONTAINER +
          ') but the source is not a list (' + GRAB_LIST + ') — refusing to write into it.',
      )
      return { state: 'ERROR', note: 'non-list source, list landing' }
    }
    if (sourceIsList) return mirrorList(source, landing)

    var state = mirrorValue(source, landing)
    if (state === 'MISMATCH') {
      warnOnce(
        'mismatch:' + id,
        'grab-id "' + id + '": an IMG source cannot fill a non-IMG landing in v1 ' +
          '(there is no wf-xano-grab-type override) — the landing keeps its authored content.',
      )
      return { state: state, note: 'IMG source -> text landing' }
    }
    return { state: state }
  }

  function flush() {
    queued = false
    counters.flushes++

    var sources = scanSources()
    var landings = scanLandings()
    var ids = Object.create(null)
    Object.keys(sources).forEach(function (id) {
      ids[id] = true
    })
    Object.keys(landings).forEach(function (id) {
      ids[id] = true
    })

    var rows = Object.keys(ids)
      .sort()
      .map(function (id) {
        var candidates = sources[id] || []
        var pairs = landings[id] || []
        var row = {
          id: id,
          sourceFound: candidates.length > 0,
          candidates: candidates.length,
          candidateIds: candidateRecordIds(candidates),
          landings: pairs.length,
          list: candidates.length ? candidates[0].hasAttribute(GRAB_LIST) : false,
          states: [],
          state: 'WAITING',
          items: '',
          notes: [],
        }

        if (!candidates.length) {
          row.notes.push('ORPHAN LANDING(S)')
          if (settled) {
            warnOnce(
              'orphan-landing:' + id,
              'grab-id "' + id + '": no source element on the page — ' + pairs.length +
                ' landing(s) keep their authored content.',
            )
          }
          row.states = pairs.map(function () {
            return 'WAITING'
          })
        } else if (!pairs.length) {
          row.notes.push('ORPHAN SOURCE')
          if (settled) {
            warnOnce(
              'orphan-source:' + id,
              'grab-id "' + id + '": a source is marked but no landing carries this id — nothing is mirrored.',
            )
          }
        } else {
          if (candidates.length > 1) {
            row.notes.push('DUP SOURCES: ' + candidates.length + ' candidates')
            warnOnce(
              'duplicate-sources:' + id,
              'grab-id "' + id + '": ' + candidates.length +
                ' connected sources — using the first VISIBLE one (DOM order breaks ties); ' +
                'add ' + GRAB_ITEM + ' on the landing to choose a record explicitly.',
            )
          }
          row.states = pairs.map(function (landing) {
            var pick = pickSource(candidates, landing)
            if (!pick.source) {
              row.notes.push(pick.reason + ': ' + pick.item)
              // Graced like the orphan warnings: a filtered or paginated list can
              // legitimately not contain the wanted record for one pass.
              if (settled) {
                warnOnce(
                  'item-not-found:' + id + ':' + pick.item,
                  'grab-id "' + id + '": ' + GRAB_ITEM + '="' + pick.item +
                    '" matched none of the ' + candidates.length +
                    ' rendered source(s) — the landing keeps its last real value.',
                )
              }
              return 'ITEM NOT FOUND'
            }
            if (pick.allHidden) row.notes.push('ALL SOURCES HIDDEN')
            if (lastSource[id] && lastSource[id] !== pick.source) counters.reresolves++
            lastSource[id] = pick.source
            var result = mirrorPair(pick.source, landing, row)
            if (result.items) row.items = row.items ? row.items + ' / ' + result.items : result.items
            if (result.note) row.notes.push(result.note)
            return result.state
          })
        }

        var unique = row.states.filter(function (state, index) {
          return row.states.indexOf(state) === index
        })
        if (unique.length) row.state = unique.join('+')
        return row
      })

    lastReport = { ids: rows, counters: counters }
    // Discard our own echo before the observer can deliver it. Cheap, and it
    // keeps a mirror write from costing a second full pass.
    if (observer && typeof observer.takeRecords === 'function') observer.takeRecords()
    renderOverlay()
    return lastReport
  }

  /* -------------------------------- observer ------------------------------ */

  function ownRecord(record) {
    var target = record && record.target
    var el = target && (target.nodeType === 1 ? target : target.parentElement)
    return !!(el && closest(el, OWNED))
  }

  function onRecords(records) {
    var relevant = false
    for (var i = 0; i < records.length; i++) {
      if (ownRecord(records[i])) {
        counters.echoes++
        continue
      }
      relevant = true
    }
    if (relevant) schedule()
  }

  function observe() {
    if (typeof window.MutationObserver !== 'function') {
      warn('no MutationObserver — mirroring runs once at boot and will not follow re-renders.')
      return
    }
    observer = new window.MutationObserver(onRecords)
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ATTRIBUTE_FILTER,
    })
  }

  /* ---------------------------- ?xano-grab overlay ------------------------ *
   * Staging + explicit opt-in, both required. Pure DOM inspection: it reports
   * only what the page already renders, and makes no request. It exists because
   * every failure in this module is invisible by nature — a landing showing its
   * authored placeholder looks exactly like a landing showing real data.
   * ----------------------------------------------------------------------- */

  function overlayRequested() {
    try {
      var search = String(location.search || '')
      return new RegExp('[?&]' + OVERLAY_PARAM + '(=|&|$)').test(search)
    } catch (e) {
      return false
    }
  }

  function overlayActive() {
    return overlayRequested() && stagingHost()
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function stateClass(state) {
    if (/ERROR|MISMATCH|NOT FOUND/.test(state)) return 'xg-bad'
    if (/GATED/.test(state)) return 'xg-gated'
    if (/WAITING/.test(state)) return 'xg-wait'
    return 'xg-real'
  }

  var overlayEl = null

  function overlayHost() {
    if (overlayEl && overlayEl.isConnected !== false) return overlayEl
    if (!document.body || typeof document.createElement !== 'function') return null
    overlayEl = document.createElement('div')
    overlayEl.setAttribute(OVERLAY_ATTR, '')
    overlayEl.style.cssText =
      'position:fixed;right:8px;bottom:8px;width:min(560px,96vw);max-height:46vh;overflow:auto;' +
      'background:#111;color:#0f0;font:10.5px/1.35 ui-monospace,Menlo,monospace;' +
      'border:2px solid #0f0;padding:6px;z-index:2147483647;white-space:normal;'
    document.body.appendChild(overlayEl)
    return overlayEl
  }

  function renderOverlay() {
    if (!overlayActive()) return
    var host = overlayHost()
    if (!host) return
    try {
      var rows = lastReport.ids
        .map(function (row) {
          return (
            '<tr><td>' +
            escapeHtml(row.id) +
            '</td><td>' +
            (row.sourceFound
              ? escapeHtml(String(row.candidates)) + (row.list ? ' (list)' : '')
              : '<b class="xg-bad">NO</b>') +
            '</td><td>' +
            escapeHtml(String(row.landings)) +
            '</td><td class="' +
            stateClass(row.state) +
            '">' +
            escapeHtml(row.state) +
            '</td><td>' +
            escapeHtml(row.items || '–') +
            '</td><td>' +
            escapeHtml(row.candidateIds.join(', ') || '–') +
            '</td><td>' +
            escapeHtml(row.notes.join('; ')) +
            '</td></tr>'
          )
        })
        .join('')
      host.innerHTML =
        '<style>' +
        '[' + OVERLAY_ATTR + '] table{border-collapse:collapse;width:100%}' +
        '[' + OVERLAY_ATTR + '] th,[' + OVERLAY_ATTR + '] td{border:1px solid #060;padding:1px 3px;' +
        'text-align:left;vertical-align:top;word-break:break-word}' +
        '[' + OVERLAY_ATTR + '] .xg-real{color:#0f0}[' + OVERLAY_ATTR + '] .xg-gated{color:#ff0}' +
        '[' + OVERLAY_ATTR + '] .xg-wait{color:#f80}[' + OVERLAY_ATTR + '] .xg-bad{color:#f55}' +
        '</style>' +
        '<div>?' + OVERLAY_PARAM + ' overlay · flush #' + counters.flushes +
        ' · writes ' + counters.writes +
        ' · echoes ignored ' + counters.echoes +
        ' · source re-resolves ' + counters.reresolves +
        ' · template candidates skipped ' + counters.templateSkips +
        '</div>' +
        '<table><tr><th>grab-id</th><th>src</th><th>land</th><th>state</th>' +
        '<th>items in/out</th><th>' + XANO_RECORD_ID + '</th><th>notes</th></tr>' +
        rows +
        '</table>'
    } catch (e) {
      /* never break the page */
    }
  }

  /* ------------------------------ wf-xano belt ----------------------------- */

  // STRICTLY optional. The observer alone is sufficient — this module has to
  // work on a page with no wf-xano at all (Webflow CMS, Memberstack, Algolia,
  // hand-written HTML). `results` fires AFTER render() and replays the last
  // result to a late subscriber; `error` covers the path that clears the cards
  // and emits no results. Both only tighten timing.
  function arm(api) {
    var instances = (api && api.instances) || []
    var armed = 0
    Array.prototype.forEach.call(instances, function (instance) {
      if (!instance || typeof instance.on !== 'function') return
      try {
        instance.on('results', schedule)
        instance.on('error', schedule)
        armed++
      } catch (e) {
        /* never break the page */
      }
    })
    note('wf-xano belt armed on ' + armed + ' instance(s); the observer covers the rest.')
    schedule()
  }

  function boot() {
    // Inert on every page that does not use the grammar. Source attributes live
    // on the static wf-xano template and landings are plain page HTML, so this
    // is a reliable relevance check at DOMContentLoaded.
    if (!document.querySelector(MARKER)) return
    observe()
    // Read at resolution time, not only on mutation: a member with no photo
    // never mutates anything, and a value rendered before this file ran would
    // otherwise never be seen.
    flush()
    SWEEP_DELAYS.forEach(function (delay) {
      setTimeout(flush, delay)
    })
    setTimeout(function () {
      settled = true
      flush() // re-check: anything still orphaned now is genuinely miswired
    }, ORPHAN_GRACE)
    // ALWAYS through push(), never a direct arm() — see the header. Both shapes
    // of window.WfXano expose it and both defer correctly.
    window.WfXano = window.WfXano || []
    window.WfXano.push(arm)
  }

  // Console + tests. Assigned BEFORE boot runs, so the helpers are reachable on
  // any host and on a page where boot() bails at the marker gate.
  window.StartersV3XanoGrabber = {
    // Pure helpers: check a value or a slot pairing without reloading.
    isRealValue: isRealValue,
    trimText: trimText,
    leafTextSlots: leafTextSlots,
    itemTexts: itemTexts,
    itemSignature: itemSignature,
    listItems: listItems,
    confirmedEmpty: confirmedEmpty,
    hiddenChain: hiddenChain,
    pickSource: pickSource,
    // Answers "why is this landing not mirroring": run a pass, read the table
    // the overlay renders from.
    flush: flush,
    report: function () {
      return lastReport
    },
    counters: counters,
    // Answers "why is the overlay not showing".
    stagingHost: stagingHost,
    diagnostic: diagnostic,
    overlayActive: overlayActive,
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
