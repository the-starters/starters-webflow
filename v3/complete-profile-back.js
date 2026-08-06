/**
 * /complete-profile — the "Go back to <where you came from>" escape hatch.
 *
 * @release v1.59.117
 *
 * ONE job: the Complete-profile form has an authored back button that is inert
 * and hidden. This module decides whether that button deserves to exist for THIS
 * visit, names the place it points at, and wires the click. It never redirects
 * anybody, never reads Memberstack, and never touches the network.
 *
 * THE PROBLEM IT SOLVES. A paid Brand who has not finished the profile form is
 * pushed onto /complete-profile from a growing list of pages by
 * v3/brand-profile-redirect.js, and lands there by their own navigation from the
 * marketing site too. Once there, the only authored way out is the browser's own
 * back button — which on a `location.replace()` arrival does not go where the
 * member expects, because the replaced entry is gone from history. So the page
 * gets an in-page back button instead, pointing at a URL this module captured
 * rather than at a history entry it cannot trust.
 *
 * THE DESIGNER CONTRACT (three hooks, all optional at runtime):
 *
 *   [data-complete-profile-back]        the wrapper, AUTHORED HIDDEN. Revealed
 *                                       here by removing the `hide` class and
 *                                       clearing an inline `display:none`.
 *   [data-complete-profile-back-label]  the text element. Its FULL text is
 *                                       replaced, so it holds "Go back to Home",
 *                                       not just "Home".
 *   button.clickable_btn                the real control, looked up STRICTLY
 *                                       inside the wrapper — the class is the
 *                                       project's generic button class, so a
 *                                       document-wide search would find the
 *                                       form's own Submit button, and the
 *                                       wrapper as authored today holds no
 *                                       <button> at all. The click is bound on
 *                                       BOTH it and the wrapper, because the
 *                                       wrapper is what the member's pointer
 *                                       usually lands on, and a one-shot latch
 *                                       keeps the bubbling pair from navigating
 *                                       twice. `type="button"`, so there is no
 *                                       submit to preventDefault.
 *
 * If any hook is missing the page is left exactly as authored — hidden button,
 * no error, one staging warning. That is the whole failure mode: this is a
 * convenience control on a funnel page, never a security boundary and never
 * something whose absence should break the form underneath it.
 *
 * WHERE THE DESTINATION COMES FROM. `document.referrer`, captured on init and
 * mirrored into sessionStorage under `thestarters:v3-complete-profile-back`:
 *
 *   - a non-empty referrer whose ORIGIN passes the same allowedHost() gate as
 *     the module itself is stored (overwriting any prior value) and used;
 *   - a non-empty referrer from anywhere else — Google, a newsletter, a partner
 *     site — is not stored and not used. We only ever send a member back to a
 *     page this site owns;
 *   - an EMPTY referrer means a reload, a direct hit, or a stripped referrer
 *     policy, and falls back to the stored value. That fallback is the entire
 *     reason the key exists: without it the button disappears the first time the
 *     member refreshes the form, which is exactly when they are most likely to
 *     want out;
 *   - neither → the button stays hidden.
 *
 * The stored value is re-validated on the way back out, so a hand-edited or
 * stale-origin entry cannot become a navigation target. It is deliberately
 * sessionStorage: it dies with the tab, which is the right lifetime for "where
 * this visit came from". Every access is wrapped, because Safari private mode
 * throws on the property itself, and a storage failure only costs the button.
 *
 * THIS KEY IS OURS ALONE. `thestarters:v3-brand-profile-completed` on the same
 * page belongs to v3/brand-account-controller.js, v3/complete-profile-redirect.js
 * and v3/brand-profile-redirect.js. This module never reads or writes it.
 *
 * THE HIDE LIST, and why it is not just "the funnel". A back button is only
 * worth showing when going back is somewhere the member can actually stay. It
 * stays hidden when the effective referrer is:
 *
 *   - a login/funnel page (/auth-route, /login, /sign-up, /starter-login) —
 *     sending an authenticated member back to a login form is nonsense;
 *   - /complete-profile itself — a self-referential loop;
 *   - any page guarded by v3/brand-profile-redirect.js v1.59.116
 *     (/brand-dashboard, /all-starters, /messages, /starter-dashboard,
 *     /dashboard, /opportunities and /opportunities/<slug>). This is the load
 *     bearing one: those pages are precisely where an unfinished Brand gets
 *     bounced BACK to /complete-profile from, so a "go back" to any of them is a
 *     round trip that lands the member on the same form a second later, having
 *     watched two navigations to get nowhere.
 *
 * Which is also why the label map below deliberately has no entry for All
 * Starters, Opportunities, Messages, or either dashboard: they can never be
 * reached, and an entry for them would read as an oversight the day someone
 * loosens the hide list.
 *
 * THE LABEL MAP is curated, not derived. A slug-to-title-case guess produces
 * "Go back to Frameworks Playbooks" and "Go back to Interview News", which is
 * worse than saying nothing, so every public surface a Brand can plausibly come
 * from is named by hand and everything else falls back to a bare "Go back" — a
 * button that still works and simply does not promise where it goes. The one
 * derived label is /hire/<slug>, which becomes the Starter's FIRST NAME
 * ("/hire/john-doe" → "Go back to John"), because that is the only case where the
 * slug carries the exact word the member is looking for.
 *
 * Install: one deferred page-level tag on /complete-profile. Order against the
 * other two scripts on this page does not matter — this module shares no state
 * with either, and if v3/complete-profile-redirect.js decides to navigate, the
 * button simply never gets clicked. Diagnostics are staging-only
 * (`*.webflow.io`, localhost, 127.0.0.1, `*.trycloudflare.com`, or
 * `window.STARTERS_DEBUG === true`); production is silent. Wiring: see
 * v3/COMPLETE-PROFILE-BACK-WIRING.md.
 */
;(function () {
  'use strict'

  if (window.__startersCompleteProfileBackBooted) return
  window.__startersCompleteProfileBackBooted = true

  // Both slash forms, for the same reason the sibling redirect lists both: no
  // prefix rule catches the trailing-slash twin, so each URL form needs its own
  // entry to behave identically if Webflow ever serves the page un-normalized.
  var COMPLETE_PROFILE_PATHS = ['/complete-profile', '/complete-profile/']

  // The PRODUCTION allowlist only, identical to v3/brand-profile-redirect.js.
  // Staging, localhost and the ./dev-tunnel.sh hosts are not listed here — they
  // come in through stagingHost() inside allowedHost(), which is the gate every
  // caller actually uses, both for "may this module run?" and for "is this
  // referrer one of ours?".
  var APPROVED_HOSTS = [
    'the-starters-3-0.webflow.io',
    'thestarters.com',
    'www.thestarters.com',
  ]

  // Ours alone. Never confuse this with the completion marker
  // `thestarters:v3-brand-profile-completed`, which three other modules share.
  var STORAGE_KEY = 'thestarters:v3-complete-profile-back'

  var WRAPPER_SELECTOR = '[data-complete-profile-back]'
  var LABEL_SELECTOR = '[data-complete-profile-back-label]'
  var BUTTON_SELECTOR = 'button.clickable_btn'
  var HIDDEN_CLASS = 'hide'

  var LABEL_PREFIX = 'Go back to '
  var FALLBACK_LABEL = 'Go back'

  // Funnel/login pages plus every page v3/brand-profile-redirect.js v1.59.116
  // guards. All compared AFTER normalization, so the trailing-slash twins are
  // covered without a second entry each.
  var HIDDEN_PATHS = [
    '/auth-route',
    '/login',
    '/sign-up',
    '/starter-login',
    '/brand-dashboard',
    '/all-starters',
    '/messages',
    '/starter-dashboard',
    '/dashboard',
    '/opportunities',
    '/complete-profile',
  ]

  // Single-segment opportunity detail only, the same shape route-guard.js and
  // brand-profile-redirect.js use. Nested paths like …/apply are not guarded
  // there, so they are not hidden here.
  var OPPORTUNITY_DETAIL = /^\/opportunities\/[^/]+$/

  /**
   * Curated destination names, most specific first. Anchored patterns, so the
   * order is documentation rather than load-bearing — but it is kept in
   * specificity order so a future entry cannot be silently shadowed by a
   * shallower one.
   *
   * `name` is either a literal or a function of the regex match, which is how
   * /hire/<slug> resolves to a person's first name.
   */
  var LABEL_RULES = [
    // The only derived label on the list: the Starter's first name.
    { pattern: /^\/hire\/([^/]+)$/, name: hireFirstName },
    // Learn, deepest first.
    { pattern: /^\/learn\/sessions(?:\/[^/]+)?$/, name: 'Sessions' },
    { pattern: /^\/learn\/interview-news\/[^/]+$/, name: 'Article' },
    { pattern: /^\/learn\/interviews$/, name: 'Article' },
    { pattern: /^\/learn\/playbooks-frameworks\/[^/]+$/, name: 'Playbook' },
    { pattern: /^\/learn\/frameworks-playbooks$/, name: 'Playbook' },
    { pattern: /^\/learn\/webinar$/, name: 'Webinar' },
    { pattern: /^\/learn\/events$/, name: 'Events' },
    { pattern: /^\/learn$/, name: 'Learn' },
    // The rest of the public site.
    { pattern: /^\/case-studies(?:\/[^/]+)?$/, name: 'Case Studies' },
    { pattern: /^\/why-us$/, name: 'Why Us' },
    { pattern: /^\/functions\/[^/]+$/, name: 'Functions' },
    { pattern: /^\/industries\/[^/]+$/, name: 'Industries' },
    { pattern: /^\/$/, name: 'Home' },
  ]

  var LOG_PREFIX = '[starters complete-profile-back]'

  /* ------------------------------ environment ------------------------------ */

  // Anchored on purpose (same shape as the sibling v3 scripts): a lookalike such
  // as "notwebflow.io" or "evil-trycloudflare.com" must not read as staging,
  // because this gate also decides whether the module runs at all — and, here,
  // whether a referrer is a place we are willing to navigate back to.
  function stagingHost(hostname) {
    var host = hostname || ''
    return (
      /(\.|^)webflow\.io$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
    )
  }

  function allowedHost(hostname) {
    return APPROVED_HOSTS.indexOf(hostname) !== -1 || stagingHost(hostname)
  }

  function isCompleteProfilePath(pathname) {
    return COMPLETE_PROFILE_PATHS.indexOf(pathname) !== -1
  }

  // STARTERS_DEBUG belongs here and not in stagingHost(): it may turn logging on
  // in production, but it must never make the module run on an unapproved host,
  // nor make an unapproved referrer look like one of ours.
  function diagnosticsEnabled() {
    if (window.STARTERS_DEBUG === true) return true
    return stagingHost((window.location && window.location.hostname) || '')
  }

  function note(message) {
    if (!diagnosticsEnabled()) return
    try {
      console.info(LOG_PREFIX + ' ' + message)
    } catch (error) {}
  }

  function warn(message) {
    if (!diagnosticsEnabled()) return
    try {
      console.warn(LOG_PREFIX + ' ' + message)
    } catch (error) {}
  }

  function describe(error) {
    return (error && error.message) || String(error)
  }

  /* --------------------------------- paths --------------------------------- */

  /**
   * One trailing slash off, except at the root — the single normalization every
   * path comparison in this file runs through, so '/login/' and '/login' cannot
   * disagree about whether they are the same page.
   */
  function normalizePath(pathname) {
    var path = pathname || '/'
    if (path.charAt(0) !== '/') path = '/' + path
    if (path.length > 1 && path.charAt(path.length - 1) === '/') {
      path = path.slice(0, -1)
    }
    return path
  }

  /**
   * A URL object, or null. `window.URL` is used rather than the bare global for
   * the same reason the sibling modules reach through `window`: the harness (and
   * a hostile page) can replace it, and an unparseable value must read as "not a
   * destination" instead of throwing on a page that is otherwise fine.
   */
  function parseUrl(value) {
    if (!value || typeof value !== 'string') return null
    if (typeof window.URL !== 'function') return null
    var parsed
    try {
      parsed = new window.URL(value)
    } catch (error) {
      return null
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed
  }

  /**
   * Accepts either a bare pathname or a full URL, so `labelFor()` can be handed
   * whatever a staging session happens to have in the clipboard.
   */
  function pathnameOf(value) {
    if (!value || typeof value !== 'string') return null
    if (value.indexOf('://') !== -1) {
      var parsed = parseUrl(value)
      return parsed ? normalizePath(parsed.pathname) : null
    }
    // Strip a query/hash off a bare path so '/learn?x=1' still reads as /learn.
    var path = value.split('#')[0].split('?')[0]
    return normalizePath(path)
  }

  /* --------------------------------- labels -------------------------------- */

  /**
   * 'john-doe' → 'John'. The segment before the first hyphen, title-cased. A slug
   * with nothing before the hyphen ('-doe') or nothing at all yields null, which
   * demotes the button to the bare 'Go back' rather than to 'Go back to '.
   */
  function hireFirstName(match) {
    var slug = (match && match[1]) || ''
    try {
      slug = decodeURIComponent(slug)
    } catch (error) {}
    var first = slug.split('-')[0]
    if (!first) return null
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
  }

  /**
   * The curated name for a path, or null when nothing on the list claims it.
   * Exported because "what does the map think this page is called?" is the first
   * question anyone debugging the label asks.
   */
  function destinationNameFor(pathOrUrl) {
    var path = pathnameOf(pathOrUrl)
    if (path === null) return null
    for (var index = 0; index < LABEL_RULES.length; index += 1) {
      var rule = LABEL_RULES[index]
      var match = rule.pattern.exec(path)
      if (!match) continue
      var name = typeof rule.name === 'function' ? rule.name(match) : rule.name
      return name || null
    }
    return null
  }

  /**
   * The full string written into the label element. An unmapped page gets exactly
   * 'Go back' — the button still works, it just stops promising a destination.
   */
  function labelFor(pathOrUrl) {
    var name = destinationNameFor(pathOrUrl)
    return name ? LABEL_PREFIX + name : FALLBACK_LABEL
  }

  /* -------------------------------- referrer -------------------------------- */

  function sessionStore() {
    try {
      var storage = window.sessionStorage
      if (!storage || typeof storage.getItem !== 'function') return null
      return storage
    } catch (error) {
      // Safari private mode throws on the property itself.
      note('sessionStorage is unavailable: ' + describe(error))
      return null
    }
  }

  function storedReferrer() {
    var storage = sessionStore()
    if (!storage) return null
    try {
      var value = storage.getItem(STORAGE_KEY)
      return typeof value === 'string' && value.trim() !== '' ? value : null
    } catch (error) {
      note('could not read the stored referrer: ' + describe(error))
      return null
    }
  }

  function storeReferrer(url) {
    var storage = sessionStore()
    if (!storage || typeof storage.setItem !== 'function') return false
    try {
      storage.setItem(STORAGE_KEY, url)
      return true
    } catch (error) {
      note('could not store the referrer: ' + describe(error))
      return false
    }
  }

  function documentReferrer() {
    try {
      var referrer = document.referrer
      return typeof referrer === 'string' ? referrer : ''
    } catch (error) {
      return ''
    }
  }

  function sameSiteReferrer(url) {
    var parsed = parseUrl(url)
    if (!parsed) return false
    return allowedHost(parsed.hostname)
  }

  /**
   * The URL this visit came from, or null.
   *
   * A live same-site referrer always wins and is mirrored into storage,
   * overwriting whatever was there — the member's most recent entry into this
   * page is the only one worth going back to. An empty referrer (reload, direct
   * hit, stripped policy) falls back to the stored value, re-validated on the way
   * out so a hand-edited entry cannot become a navigation target. A non-empty
   * OFF-SITE referrer is neither stored nor used, and does not fall back either:
   * the member's last move was to arrive here from somewhere we do not own, and
   * quietly offering them a stale internal page instead would be a lie about
   * where "back" goes.
   */
  function effectiveReferrer() {
    var referrer = documentReferrer()

    if (referrer) {
      if (!sameSiteReferrer(referrer)) {
        note('referrer is off-site; the back button stays hidden.')
        return null
      }
      storeReferrer(referrer)
      return referrer
    }

    var stored = storedReferrer()
    if (!stored) return null
    if (!sameSiteReferrer(stored)) {
      warn('the stored referrer is not one of ours; ignoring it.')
      return null
    }
    note('no document.referrer (reload or direct entry); using the stored one.')
    return stored
  }

  /**
   * True when the button must stay hidden for this referrer: nothing to go back
   * to, something we do not own, or one of the funnel/guarded pages that would
   * bounce an unfinished Brand straight back here.
   */
  function shouldHide(referrerUrl) {
    if (!referrerUrl) return true
    var parsed = parseUrl(referrerUrl)
    if (!parsed) return true
    if (!allowedHost(parsed.hostname)) return true
    var path = normalizePath(parsed.pathname)
    if (HIDDEN_PATHS.indexOf(path) !== -1) return true
    return OPPORTUNITY_DETAIL.test(path)
  }

  /* ---------------------------------- DOM ---------------------------------- */

  function findWrapper() {
    try {
      return document.querySelector(WRAPPER_SELECTOR)
    } catch (error) {
      return null
    }
  }

  /**
   * STRICTLY inside the wrapper, with no document-wide fallback — and that is the
   * whole point of the function, not an implementation detail.
   *
   * `button.clickable_btn` is the project's generic button class, so the form's
   * own Submit control matches it too. The wrapper as authored today contains NO
   * <button> element at all, so a fallback to `document.querySelector()` would
   * hand the click binding to the first `.clickable_btn` on the page — the Submit
   * button — and pressing Submit would navigate to the referrer instead of
   * submitting the form. A missing inner button is already covered: the wrapper
   * itself is bound, and a missing label already keeps the button hidden.
   */
  function findInWrapper(wrapper, selector) {
    try {
      if (!wrapper || typeof wrapper.querySelector !== 'function') return null
      return wrapper.querySelector(selector) || null
    } catch (error) {
      return null
    }
  }

  /**
   * The wrapper is authored hidden, and Webflow has two ways of saying so: the
   * project's `hide` utility class, and an inline `display:none`. Both are
   * cleared, independently, because a Designer edit can leave either one behind.
   * An inline display that is something other than `none` is left alone — that is
   * a deliberate layout value, not a hiding mechanism.
   */
  function reveal(wrapper) {
    var revealed = false
    try {
      if (wrapper.classList && typeof wrapper.classList.remove === 'function') {
        wrapper.classList.remove(HIDDEN_CLASS)
        revealed = true
      }
    } catch (error) {
      warn('could not remove the "' + HIDDEN_CLASS + '" class: ' + describe(error))
    }
    try {
      if (wrapper.style && wrapper.style.display === 'none') {
        wrapper.style.display = ''
        revealed = true
      }
    } catch (error) {
      warn('could not clear the inline display: ' + describe(error))
    }
    return revealed
  }

  function setLabel(element, text) {
    try {
      element.textContent = text
      return true
    } catch (error) {
      warn('could not write the button label: ' + describe(error))
      return false
    }
  }

  function listen(element, handler) {
    try {
      if (!element || typeof element.addEventListener !== 'function') return false
      element.addEventListener('click', handler)
      return true
    } catch (error) {
      return false
    }
  }

  /* --------------------------------- state --------------------------------- */

  /**
   * The live decision, readable from the console on staging. `applied` is true
   * only when the button was actually revealed and wired; every other outcome
   * leaves the page as authored and says why in `reason`.
   */
  var state = {
    applied: false,
    referrer: null,
    label: null,
    reason: null,
    navigated: false,
  }

  function stayHidden(reason) {
    state.applied = false
    state.reason = reason
    return state
  }

  /**
   * Read the referrer, decide, and — only on a positive decision — reveal, label,
   * and bind. Safe to call by hand on staging: it never navigates on its own, and
   * calling it twice does not double-bind.
   */
  function init() {
    if (state.applied) {
      note('the back button is already applied; nothing to do.')
      return state
    }

    var wrapper = findWrapper()
    if (!wrapper) {
      warn('no ' + WRAPPER_SELECTOR + ' element on this page; nothing to reveal.')
      return stayHidden('no-wrapper')
    }

    var referrer = effectiveReferrer()
    state.referrer = referrer
    if (!referrer) {
      note('no usable referrer; the back button stays hidden.')
      return stayHidden('no-referrer')
    }

    if (shouldHide(referrer)) {
      note(
        'the referrer is a funnel or guarded page; the back button stays hidden ' +
          'rather than round-tripping the member back to this form.',
      )
      return stayHidden('excluded-referrer')
    }

    var labelElement = findInWrapper(wrapper, LABEL_SELECTOR)
    if (!labelElement) {
      // Revealing now would ship the authored placeholder — a literal "[Name]" —
      // to a real member, which is worse than the hidden button they have today.
      warn('no ' + LABEL_SELECTOR + ' element; leaving the button hidden.')
      return stayHidden('no-label')
    }

    var text = labelFor(referrer)
    if (!setLabel(labelElement, text)) return stayHidden('label-write-failed')
    state.label = text

    reveal(wrapper)

    // One latch for both bindings: the inner button's click bubbles to the
    // wrapper, so without it a single press would call assign() twice.
    function go() {
      if (state.navigated) return
      state.navigated = true
      note('going back to ' + referrer + '.')
      try {
        window.location.assign(referrer)
      } catch (error) {
        state.navigated = false
        warn('could not navigate back: ' + describe(error))
      }
    }

    listen(wrapper, go)
    listen(findInWrapper(wrapper, BUTTON_SELECTOR), go)

    state.applied = true
    state.reason = 'applied'
    note('back button applied: "' + text + '" → ' + referrer + '.')
    return state
  }

  /* ---------------------------------- boot ---------------------------------- */

  window.StartersCompleteProfileBack = {
    // Keep in sync with the @release line in this file's header comment; the
    // v3/complete-profile-back.test.js drift guard asserts they match.
    release: 'v1.59.117',
    // The live decision. `applied` is the one-word answer.
    state: state,
    init: init,
    // Environment gates.
    allowedHost: allowedHost,
    stagingHost: stagingHost,
    isCompleteProfilePath: isCompleteProfilePath,
    diagnosticsEnabled: diagnosticsEnabled,
    // Pure helpers, so every half of the decision can be asked in isolation.
    normalizePath: normalizePath,
    destinationNameFor: destinationNameFor,
    labelFor: labelFor,
    shouldHide: shouldHide,
    storedReferrer: storedReferrer,
    effectiveReferrer: effectiveReferrer,
    // Constants worth reading back from a console session.
    storageKey: STORAGE_KEY,
    completeProfilePaths: COMPLETE_PROFILE_PATHS.slice(),
    hiddenPaths: HIDDEN_PATHS.slice(),
    wrapperSelector: WRAPPER_SELECTOR,
    labelSelector: LABEL_SELECTOR,
    buttonSelector: BUTTON_SELECTOR,
    hiddenClass: HIDDEN_CLASS,
    fallbackLabel: FALLBACK_LABEL,
  }

  if (!allowedHost(window.location.hostname)) return
  if (!isCompleteProfilePath(window.location.pathname)) return

  // With `defer` the document is already parsed; the readyState branch only
  // matters if the tag is ever moved into the head without it.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init()
    })
  } else {
    init()
  }
})()
