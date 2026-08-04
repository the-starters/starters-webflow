/**
 * Memberstack plan dates — render a member's plan/billing dates into the page.
 *
 * @release v1.59.89
 *
 * ONE job: find every element carrying `ms-form-pause-date`, resolve the named
 * date off the logged-in Memberstack member, and write it as text formatted
 * "Jan 10, 2000".
 *
 * Designer contract (the only attribute you have to place):
 *
 *   <span ms-form-pause-date="next-billing">—</span>
 *
 * Field names accepted by `ms-form-pause-date`:
 *   signup        member.createdAt — the SIGNUP date, not the subscription start
 *   last-billing  payment.lastBillingDate — start of the current billing period
 *   next-billing  payment.nextBillingDate — end of the current billing period
 *   cancel-at     payment.cancelAtDate — set only when cancel-at-period-end is on
 *   resumes-at    next-billing + the pause length (see ms-form-pause-months)
 *
 * Optional attributes, all readable from the element itself or any ancestor
 * (so a wrapper can set them once for a whole block):
 *   ms-form-pause-months="1"       months to add for `resumes-at` (default 1)
 *   ms-form-pause-format="medium"  medium (default) | long | numeric | iso
 *   ms-form-pause-empty="—"        text used when the date cannot be resolved
 *   ms-form-pause-id="pln_abc123"  pin to one plan connection instead of auto-pick
 *   ms-form-pause-tz="UTC"         advanced; see WHY UTC below
 *
 * HIDING THE WHOLE SENTENCE UNTIL THE MEMBER CHOOSES. Wrap the paragraph — text
 * and inline date together — in `ms-form-pause-reveal`, and paste the paired CSS
 * once. The block stays hidden until a pause option is selected:
 *
 *   <style>
 *     [ms-form-pause-reveal]:not(.is-ms-form-pause-shown) { display: none !important; }
 *   </style>
 *
 *   <div ms-form-pause-reveal>
 *     <p>Your membership pauses and billing resumes
 *        <span ms-form-pause-date="resumes-at">—</span>.</p>
 *   </div>
 *
 * WHY A CLASS AND A CSS RULE, NOT AN INLINE STYLE: the rule hides the block from
 * the very first paint, so nothing flashes before this deferred script runs, and
 * revealing does not have to guess whether the Designer set the block to `block`,
 * `flex`, or `grid` — which is exactly what restoring an inline `display` would
 * have to do. If the script never loads the block simply stays hidden, which is
 * the right outcome for a sentence whose only content is a date it cannot fill.
 * Do not swap the rule for the `hidden` attribute: a Webflow class carrying
 * `display: flex` beats the user-agent `[hidden]` rule and the block stays
 * visible.
 *
 * A wrapper reveals only when BOTH a marked control has expressed a pause length
 * AND every date element it governs resolved to a real date. The second half is
 * the point of wrapping a sentence: a logged-out visitor, a free-plan member, or
 * a failed lookup renders "Billing resumes —" if the only test is whether a radio
 * is checked. Note that "not chosen yet" and "chose one month" both resolve to a
 * one-month pause, so the reveal test is the SOURCE of the answer, not its value.
 *
 * LIVE PAUSE LENGTH FROM RADIOS. To let the member choose the pause length, mark
 * the radio group — either the wrapper once, or each input — with
 * `ms-form-pause-input`, and `resumes-at` re-renders on every change:
 *
 *   <div ms-form-pause-input>
 *     <label class="w-radio"><input type="radio" name="pause" value="1 month"> 1 month</label>
 *     <label class="w-radio"><input type="radio" name="pause" value="2 months"> 2 months</label>
 *     <label class="w-radio"><input type="radio" name="pause" value="3 months"> 3 months</label>
 *   </div>
 *   <p>Billing resumes <span ms-form-pause-date="resumes-at">—</span></p>
 *
 * The value is parsed for its first integer, so "2" and "2 months" both mean two
 * — a Webflow group authored for this reads naturally either way and neither
 * spelling silently strands the member on the default. An UNCHECKED radio
 * expresses nothing: reading its value anyway is how a three-option group ends up
 * reporting whichever option sits first in the DOM rather than the one picked.
 * Radios, checkboxes, `<select>`, and a plain number input all work.
 *
 * Sources are resolved nearest-first — a marked control inside the closest
 * ancestor that has one, then the document, then the static
 * `ms-form-pause-months`, then one month. Walking up before reading the document
 * is what lets two independent pause groups coexist on one page. With nothing
 * checked yet, the static attribute (or the default) still renders, so the page
 * never shows a blank or broken date before the member touches the form.
 *
 * WHY `resumes-at` IS ANCHORED ON next-billing AND NOT ON signup:
 * a member who pauses on the 20th with a cycle that renews on the 1st would,
 * under "signup + 1 month", either ride 11 unpaid days or get charged mid-pause.
 * The paid-through date is the end of the period they already bought, so the
 * pause starts there. This mirrors Stripe's own `pause_collection.resumes_at`,
 * which is what has to perform the actual pause — see NOT A PAUSE below.
 *
 * WHY UTC IS THE DEFAULT TIMEZONE:
 * Memberstack hands back billing dates as instants (Unix timestamps). Rendering
 * an instant in the viewer's local zone moves the calendar day for everyone west
 * of UTC, so a member in Los Angeles reads a renewal one day earlier than the
 * one they are actually billed on. Formatting in UTC keeps the printed day equal
 * to the billing day for every viewer. Override per element only if a specific
 * block must show wall-clock time in a fixed business zone.
 *
 * WHY THE TIMESTAMP UNIT IS SNIFFED AND NOT ASSUMED:
 * `createdAt` arrives as an ISO string while the `payment.*` dates arrive as
 * numbers, and Memberstack is not consistent about seconds vs milliseconds
 * across plans. toDate() accepts Date | ISO string | Unix seconds | Unix ms and
 * splits on 1e10 (1e10 seconds is the year 2286, 1e10 ms is 1970 — no real
 * billing date is ambiguous). Never "simplify" this to `new Date(value)`: a
 * seconds timestamp through that constructor renders in January 1970.
 *
 * NOT A PAUSE. This module only READS and PRINTS. Pausing a subscription needs
 * the Stripe secret key, so it cannot happen in the browser — it belongs behind
 * a Xano endpoint that calls Stripe `pause_collection` with `resumes_at`. This
 * script is safe to install before that endpoint exists; it just shows the dates.
 *
 * UNVERIFIED FIELD: `payment.cancelAtDate` is the one field name here not
 * confirmed against Memberstack's published response example (the docs list
 * amount, currency, status, lastBillingDate, nextBillingDate). `cancel-at`
 * therefore renders the empty text on a member where that key is absent, which
 * is the correct failure. Confirm it against a real cancel-at-period-end member
 * before shipping UI that depends on it.
 *
 * Re-renders on login/logout without a refresh via onAuthChange, plus a bfcache
 * (pageshow) guard, matching navbar-embeds/memberstack/free-paid-anon.js.
 *
 * Diagnostics are staging-only (`*.webflow.io`, localhost, 127.0.0.1,
 * `*.trycloudflare.com`) or with `window.STARTERS_DEBUG === true`; production
 * stays silent.
 *
 * Install: Page Settings -> Custom Code -> Footer, one deferred jsDelivr tag,
 * AFTER the Memberstack script.
 */
;(function () {
  'use strict'

  if (window.__startersPlanDatesBooted) return
  window.__startersPlanDatesBooted = true

  var LOG_PREFIX = '[starters plan-dates]'

  var TARGET_ATTR = 'ms-form-pause-date'
  var TARGET = '[' + TARGET_ATTR + ']'
  var PAUSE_ATTR = 'ms-form-pause-months'
  var PAUSE_INPUT_ATTR = 'ms-form-pause-input'
  var PAUSE_INPUT = '[' + PAUSE_INPUT_ATTR + ']'
  var FORMAT_ATTR = 'ms-form-pause-format'
  var EMPTY_ATTR = 'ms-form-pause-empty'
  var PLAN_ID_ATTR = 'ms-form-pause-id'
  var TZ_ATTR = 'ms-form-pause-tz'
  var REVEAL_ATTR = 'ms-form-pause-reveal'
  var REVEAL = '[' + REVEAL_ATTR + ']'
  var SHOWN_CLASS = 'is-ms-form-pause-shown'

  var lastMember = null

  var DEFAULT_PAUSE_MONTHS = 1
  var DEFAULT_EMPTY = '—'
  var DEFAULT_TZ = 'UTC'
  var MS_PER_DAY = 86400000
  var MS_WAIT_MS = 2000
  var MS_POLL_MS = 100

  // Values above this are milliseconds, below are seconds. 1e10 seconds is the
  // year 2286; 1e10 milliseconds is 1970. No billing date falls in the overlap.
  var SECONDS_CEILING = 1e10

  var FORMATS = {
    medium: { month: 'short', day: 'numeric', year: 'numeric' }, // Jan 10, 2000
    long: { month: 'long', day: 'numeric', year: 'numeric' }, //    January 10, 2000
    numeric: { month: '2-digit', day: '2-digit', year: 'numeric' }, // 01/10/2000
  }

  /* ------------------------------ environment ------------------------------ */

  // Anchored on purpose (same shape as v3/onboarding-done-redirect.js): a
  // lookalike such as "notwebflow.io" or "evil-trycloudflare.com" must not read
  // as staging.
  function stagingHost(hostname) {
    var host = hostname || ''
    return (
      /(\.|^)webflow\.io$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
    )
  }

  // STARTERS_DEBUG belongs here and not in stagingHost(): it may turn logging on
  // in production, but it must never widen what counts as a staging host.
  function diagnosticsEnabled() {
    if (window.STARTERS_DEBUG === true) return true
    return stagingHost((window.location && window.location.hostname) || '')
  }

  function warn(message, detail) {
    if (!diagnosticsEnabled()) return
    if (detail === undefined) console.warn(LOG_PREFIX + ' ' + message)
    else console.warn(LOG_PREFIX + ' ' + message, detail)
  }

  /* -------------------------------- date core ------------------------------- */

  /**
   * Normalize Date | ISO string | Unix seconds | Unix milliseconds to a Date.
   * Returns null for null, undefined, '', and anything unparseable, so a missing
   * value renders the empty text instead of "Invalid Date".
   */
  function toDate(value) {
    if (value === null || value === undefined || value === '') return null

    if (value instanceof Date) return isNaN(value.getTime()) ? null : value

    if (typeof value === 'number') {
      if (!isFinite(value)) return null
      return new Date(value < SECONDS_CEILING ? value * 1000 : value)
    }

    if (typeof value === 'string') {
      // A numeric string is a timestamp an API stringified, not a date string.
      if (/^\d+$/.test(value)) return toDate(Number(value))
      var parsed = new Date(value)
      return isNaN(parsed.getTime()) ? null : parsed
    }

    return null
  }

  /** Format a normalized date. Default preset renders "Jan 10, 2000". */
  function formatDate(value, format, timeZone) {
    var date = toDate(value)
    if (!date) return ''

    var tz = timeZone || DEFAULT_TZ

    // ISO is a slice, not a locale format: toLocaleDateString has no ISO preset
    // and en-CA only coincidentally matches it.
    if (format === 'iso') {
      var isoParts = isoPartsIn(date, tz)
      if (!isoParts) return ''
      return isoParts
    }

    var options = FORMATS[format] || FORMATS.medium
    return date.toLocaleDateString('en-US', {
      month: options.month,
      day: options.day,
      year: options.year,
      timeZone: tz,
    })
  }

  // YYYY-MM-DD for the given zone, built from en-CA parts (which are already
  // zero-padded) rather than from toISOString, so a non-UTC tz is honored.
  function isoPartsIn(date, timeZone) {
    var text = date.toLocaleDateString('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: timeZone,
    })
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
  }

  /**
   * Add whole months, clamping the day to the target month's last day so
   * Jan 31 + 1 month is Feb 28 (Feb 29 in a leap year) and never Mar 3.
   * Plain setMonth overflows into the following month; do not swap it back in.
   */
  function addMonths(value, months) {
    var date = toDate(value)
    if (!date) return null
    var count = Number(months)
    if (!isFinite(count)) return null

    var day = date.getUTCDate()
    var out = new Date(date.getTime())
    out.setUTCDate(1) // park on the 1st first, or the month shift itself can overflow
    out.setUTCMonth(out.getUTCMonth() + count)
    var lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate()
    out.setUTCDate(day < lastDay ? day : lastDay)
    return out
  }

  /** Whole days from a to b, or null if either side is unresolvable. */
  function daysBetween(a, b) {
    var from = toDate(a)
    var to = toDate(b)
    if (!from || !to) return null
    return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)
  }

  /* ----------------------------- member reading ---------------------------- */

  /**
   * Pick the plan connection to read dates from.
   * Preference order: the pinned planId when given, then the first active
   * connection that actually carries a `payment` object, then the first active
   * connection at all. A member can hold both a free and a paid connection
   * (see navbar-embeds/memberstack/free-paid-anon.js), and only the paid one has
   * billing dates, so "first connection" is never a safe default.
   */
  function pickConnection(member, planId) {
    var connections = (member && member.planConnections) || []
    if (!connections.length) return null

    var i
    if (planId) {
      for (i = 0; i < connections.length; i++) {
        if (connections[i] && connections[i].planId === planId) return connections[i]
      }
      return null // pinned and absent: report nothing rather than the wrong plan
    }

    for (i = 0; i < connections.length; i++) {
      if (connections[i] && connections[i].active && connections[i].payment) return connections[i]
    }
    for (i = 0; i < connections.length; i++) {
      if (connections[i] && connections[i].active) return connections[i]
    }
    return null
  }

  /**
   * Collapse an absent key to null. `undefined` is reserved as this module's
   * "that field name is not one I know" signal, so a real member value must
   * never be able to produce it — otherwise a member simply lacking
   * `cancelAtDate` would be reported to the author as a misspelled attribute.
   */
  function orNull(value) {
    return value === undefined ? null : value
  }

  /**
   * Resolve one field name to a raw date value (not yet formatted).
   * Returns null when the member has no such date — a FREE connection has
   * `payment: null`, so every billing field is legitimately absent there.
   * Returns undefined ONLY for a field name this module does not implement.
   */
  function resolveField(member, field, options) {
    var opts = options || {}
    var connection = pickConnection(member, opts.planId)
    var payment = (connection && connection.payment) || null

    switch (field) {
      case 'signup':
        return member ? orNull(member.createdAt) : null
      case 'last-billing':
        return payment ? orNull(payment.lastBillingDate) : null
      case 'next-billing':
        return payment ? orNull(payment.nextBillingDate) : null
      case 'cancel-at':
        return payment ? orNull(payment.cancelAtDate) : null
      case 'resumes-at':
        if (!payment) return null
        return addMonths(payment.nextBillingDate, opts.pauseMonths)
      default:
        return undefined // unknown field: caller warns
    }
  }

  /* ------------------------------- DOM writing ------------------------------ */

  /**
   * Read an attribute off the element or the nearest ancestor that sets it, so a
   * wrapper can configure a whole block once. Returns null when nobody sets it.
   */
  function inheritedAttr(el, name) {
    var node = el
    while (node && node.getAttribute) {
      if (node.hasAttribute && node.hasAttribute(name)) return node.getAttribute(name)
      var value = node.getAttribute(name)
      if (value !== null && value !== undefined) return value
      node = node.parentNode
    }
    return null
  }

  /**
   * Pull a month count out of a control value or attribute.
   * Deliberately tolerant of a unit suffix: a Webflow radio group built for this
   * is as likely to carry value="2 months" as value="2", and silently reading
   * the first as NaN would strand the member on the default. Returns null when
   * there is no integer to find, so callers can tell "no answer" from "zero".
   */
  function parseMonths(raw) {
    if (raw === null || raw === undefined) return null
    var match = String(raw).match(/-?\d+/)
    if (!match) return null
    var months = Number(match[0])
    return isFinite(months) ? months : null
  }

  /**
   * The form controls a marked element contributes.
   * `ms-form-pause-input` may sit on each control OR on a wrapper around
   * the group — a Webflow radio group is authored as a stack of `.w-radio`
   * labels, and tagging the wrapper once is the far easier Designer edit.
   */
  function controlsIn(marked) {
    var tag = String(marked.tagName || '').toUpperCase()
    if (tag === 'INPUT' || tag === 'SELECT') return [marked]
    if (typeof marked.querySelectorAll !== 'function') return []
    var found = marked.querySelectorAll('input, select')
    return found ? Array.prototype.slice.call(found) : []
  }

  /**
   * The value a control is currently expressing, or null if it is expressing
   * none. An unchecked radio is not an answer — reading its value anyway is how
   * a three-option group ends up reporting whichever option happens to be first
   * in the DOM instead of the one the member picked.
   */
  function controlValue(control) {
    var type = String(control.type || '').toLowerCase()
    if (type === 'radio' || type === 'checkbox') {
      return control.checked ? control.value : null
    }
    return control.value
  }

  /**
   * Inspect `scope` for marked pause controls. Three outcomes, all distinct:
   *   null            no marked control here — the caller should keep walking up
   *   {months: n}     a control answered
   *   {months: null}  controls are here but none is expressing a value
   *
   * The third case must not collapse into the first. A group whose radios are all
   * unchecked HAS an answer — "the member has not chosen" — and treating that as
   * "no group here" sends the walk on to a common ancestor, where it finds a
   * SIBLING group's checked radio and reports the neighbour's months. On a page
   * with two pause blocks that silently reveals the untouched one.
   *
   * `scope` ITSELF counts when it carries the attribute. querySelectorAll is
   * descendants-only, and the wrapper the author marked is exactly the node the
   * upward walk arrives at — without the self check the walk finds nothing at the
   * right wrapper and falls through the same way.
   */
  function pauseScopeIn(scope) {
    if (!scope || typeof scope.querySelectorAll !== 'function') return null

    var candidates = []
    if (typeof scope.hasAttribute === 'function' && scope.hasAttribute(PAUSE_INPUT_ATTR)) {
      candidates.push(scope)
    }
    var descendants = scope.querySelectorAll(PAUSE_INPUT)
    for (var d = 0; d < descendants.length; d++) candidates.push(descendants[d])
    if (!candidates.length) return null

    for (var i = 0; i < candidates.length; i++) {
      var controls = controlsIn(candidates[i])
      for (var j = 0; j < controls.length; j++) {
        var months = parseMonths(controlValue(controls[j]))
        if (months !== null) return { months: months }
      }
    }
    return { months: null }
  }

  /**
   * Resolve the pause length for one element, nearest source first:
   *   1. a marked control in the closest ancestor that has one,
   *   2. a marked control anywhere in the document,
   *   3. the inherited static `ms-form-pause-months`,
   *   4. one month.
   * Walking up rather than reading the document straight away is what lets two
   * independent pause groups coexist on a page: each output reads the group it
   * is nested inside, and only an output outside every group falls through to
   * the document-wide lookup.
   *
   * `fromControl` reports whether a real control answered (1 or 2) rather than a
   * fallback (3 or 4). `ms-form-pause-reveal` needs that distinction: "the member
   * has not chosen yet" and "the member chose one month" both resolve to 1, and
   * only the second may reveal the block.
   */
  function resolvePause(el) {
    var node = el
    while (node) {
      var scope = pauseScopeIn(node)
      if (scope) {
        // The nearest enclosing group owns the answer, including the answer
        // "nothing chosen". Do not keep walking past it to a neighbour's group.
        if (scope.months !== null) return { months: scope.months, fromControl: true }
        break
      }
      node = node.parentNode
    }

    // Only an element enclosed by NO group falls through to a document-wide
    // lookup. In a real DOM the walk above already reaches `document`; this
    // covers a detached subtree, which is what the tests build.
    if (!node) {
      var documentWide = pauseScopeIn(document)
      if (documentWide && documentWide.months !== null) {
        return { months: documentWide.months, fromControl: true }
      }
    }

    var raw = inheritedAttr(el, PAUSE_ATTR)
    if (raw === null || String(raw).trim() === '') {
      return { months: DEFAULT_PAUSE_MONTHS, fromControl: false }
    }
    var months = parseMonths(raw)
    if (months === null) {
      warn('ignoring non-numeric ' + PAUSE_ATTR + '="' + raw + '"; using ' + DEFAULT_PAUSE_MONTHS)
      return { months: DEFAULT_PAUSE_MONTHS, fromControl: false }
    }
    return { months: months, fromControl: false }
  }

  function pauseMonthsFor(el) {
    return resolvePause(el).months
  }

  function emptyTextFor(el) {
    var raw = inheritedAttr(el, EMPTY_ATTR)
    return raw === null ? DEFAULT_EMPTY : raw
  }

  function formatFor(el) {
    var raw = inheritedAttr(el, FORMAT_ATTR)
    if (raw === null || String(raw).trim() === '') return 'medium'
    var name = String(raw).trim().toLowerCase()
    if (name !== 'iso' && !FORMATS[name]) {
      warn('unknown ' + FORMAT_ATTR + '="' + raw + '"; using medium')
      return 'medium'
    }
    return name
  }

  /** Render one element. Exposed for tests and one-off re-renders. */
  function renderElement(el, member) {
    var field = String(el.getAttribute(TARGET_ATTR) || '').trim().toLowerCase()
    var empty = emptyTextFor(el)

    if (!field) {
      warn('element has an empty ' + TARGET_ATTR + '; nothing to render', el)
      el.textContent = empty
      return ''
    }

    var raw = resolveField(member, field, {
      planId: inheritedAttr(el, PLAN_ID_ATTR),
      pauseMonths: pauseMonthsFor(el),
    })

    if (raw === undefined) {
      warn('unknown ' + TARGET_ATTR + '="' + field + '"', el)
      el.textContent = empty
      return ''
    }

    var text = formatDate(raw, formatFor(el), inheritedAttr(el, TZ_ATTR) || DEFAULT_TZ)
    el.textContent = text === '' ? empty : text
    return text
  }

  /* --------------------------------- reveal --------------------------------- */

  /**
   * Every date element governed by a reveal wrapper: its descendants, plus the
   * wrapper itself when the author put both attributes on one node. The self case
   * matters for the same reason it does in pauseMonthsIn — querySelectorAll is
   * descendants-only, and a wrapper that is also the date element would otherwise
   * count as having no dates at all and reveal on an unresolved value.
   */
  function datesUnder(wrapper) {
    var found = []
    if (typeof wrapper.hasAttribute === 'function' && wrapper.hasAttribute(TARGET_ATTR)) {
      found.push(wrapper)
    }
    if (typeof wrapper.querySelectorAll !== 'function') return found
    var descendants = wrapper.querySelectorAll(TARGET)
    for (var i = 0; i < descendants.length; i++) found.push(descendants[i])
    return found
  }

  /**
   * A reveal wrapper shows only when BOTH conditions hold:
   *   1. a marked control has expressed a pause length (the member chose), and
   *   2. every date element it governs resolved to a real date.
   *
   * Condition 2 is the point of wrapping a whole sentence: the wrapper exists so
   * the member never reads "Billing resumes —", and a logged-out visitor, a
   * free-plan member, or a failed lookup produces exactly that if the only test
   * is whether a radio is checked. A wrapper containing no date element at all is
   * governed by condition 1 alone.
   */
  function shouldReveal(wrapper, resolved) {
    if (!resolvePause(wrapper).fromControl) return false
    var dates = datesUnder(wrapper)
    for (var i = 0; i < dates.length; i++) {
      if (resolved.indexOf(dates[i]) === -1) return false
    }
    return true
  }

  /**
   * Toggle the marker class the anti-flicker CSS keys on. A class rather than an
   * inline style, deliberately: the paired rule hides the block from the very
   * first paint, so nothing flashes before this deferred script runs, and
   * revealing does not have to guess whether the Designer set the block to
   * `block`, `flex`, or `grid` the way restoring an inline display would.
   */
  function applyReveal(resolved) {
    var wrappers = document.querySelectorAll(REVEAL)
    for (var i = 0; i < wrappers.length; i++) {
      var wrapper = wrappers[i]
      if (!wrapper.classList) continue
      if (shouldReveal(wrapper, resolved)) wrapper.classList.add(SHOWN_CLASS)
      else wrapper.classList.remove(SHOWN_CLASS)
    }
    return wrappers.length
  }

  /** Render every tagged element for the given member (null = logged out). */
  function renderAll(member) {
    lastMember = member || null
    var targets = document.querySelectorAll(TARGET)

    var resolved = []
    for (var i = 0; i < targets.length; i++) {
      if (renderElement(targets[i], member) !== '') resolved.push(targets[i])
    }

    // Runs even with zero date elements, so a reveal wrapper on a page whose
    // dates were removed collapses instead of staying open on stale content.
    applyReveal(resolved)
    return targets.length
  }

  /**
   * Re-render against the member already resolved, for when only the page's own
   * inputs changed. Kept separate from renderAll so a pause-radio click costs no
   * Memberstack round trip — the member has not changed, only the arithmetic.
   */
  function rerender() {
    return renderAll(lastMember)
  }

  /* ---------------------------------- boot ---------------------------------- */

  function syncFromMemberstack(ms) {
    return ms
      .getCurrentMember()
      .then(function (res) {
        renderAll((res && res.data) || null)
      })
      .catch(function (err) {
        warn('getCurrentMember failed; rendering the empty text', err)
        renderAll(null) // lookup failed: treat as logged out, never leave stale dates
      })
  }

  function wire(ms) {
    syncFromMemberstack(ms)

    if (typeof ms.onAuthChange === 'function') {
      ms.onAuthChange(function (member) {
        renderAll(member || null)
      })
    }

    // Back/forward cache restores the old DOM with the previous member's dates.
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) syncFromMemberstack(ms)
    })
  }

  /**
   * Re-render whenever a marked pause control changes.
   * Delegated on document rather than bound per input, because `change` bubbles
   * and because a Webflow radio group can be inside a component or a tab pane
   * that is not in the DOM when this script runs. Bound before Memberstack is
   * known to exist, so the arithmetic still follows the radios on a page where
   * the member never resolves.
   */
  function watchPauseInputs() {
    document.addEventListener('change', function (e) {
      var target = e && e.target
      if (!target || typeof target.closest !== 'function') return
      if (!target.closest(PAUSE_INPUT)) return
      rerender()
    })
  }

  // Memberstack can load after this script even with defer. Poll briefly.
  function init() {
    // A reveal wrapper counts too: its block is hidden by CSS until this module
    // says otherwise, so bailing out on "no date elements" would leave an
    // author's wrapper hidden forever with no explanation.
    if (!document.querySelector(TARGET) && !document.querySelector(REVEAL)) return

    watchPauseInputs()

    var waited = 0
    var tryWire = function () {
      var ms = window.$memberstackDom
      if (ms && typeof ms.getCurrentMember === 'function') {
        wire(ms)
        return
      }
      if (waited < MS_WAIT_MS) {
        waited += MS_POLL_MS
        setTimeout(tryWire, MS_POLL_MS)
        return
      }
      warn('$memberstackDom never appeared; rendering the empty text')
      renderAll(null)
    }
    tryWire()
  }

  window.StartersPlanDates = {
    // Keep in sync with the @release line in this file's header comment; the
    // account-settings/plan-dates.test.js drift guard asserts they match.
    release: 'v1.59.89',
    stagingHost: stagingHost,
    diagnosticsEnabled: diagnosticsEnabled,
    toDate: toDate,
    formatDate: formatDate,
    addMonths: addMonths,
    daysBetween: daysBetween,
    pickConnection: pickConnection,
    resolveField: resolveField,
    parseMonths: parseMonths,
    resolvePause: resolvePause,
    pauseMonthsFor: pauseMonthsFor,
    shouldReveal: shouldReveal,
    applyReveal: applyReveal,
    renderElement: renderElement,
    renderAll: renderAll,
    rerender: rerender,
    fields: ['signup', 'last-billing', 'next-billing', 'cancel-at', 'resumes-at'],
    pauseInputAttr: PAUSE_INPUT_ATTR,
    revealAttr: REVEAL_ATTR,
    shownClass: SHOWN_CLASS,
    defaultPauseMonths: DEFAULT_PAUSE_MONTHS,
    defaultTimeZone: DEFAULT_TZ,
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
