/**
 * V3 public starter profile — agency section.
 *
 * @release v1.59.423
 *
 * Designer owns the agency section's markup, styling, and placement. wf-xano
 * owns the fetch, the text binds, and every per-field show/hide decision. This
 * module exists only to close the gaps wf-xano cannot cover on this page.
 *
 * Authoritative contract, markup, and install: `v3/AGENCY-PROFILE-WIRING.md`.
 *
 * What it writes to the DOM, and nothing else:
 *
 *   1. `wf-xano-param-slug` on the authored section wrapper. wf-xano has no way
 *      to source a request parameter from the URL path, and the profile slug
 *      only exists in `/hire/{slug}`.
 *   2. `display` on that same wrapper. The card's `wf-xano-if` hides the card,
 *      but the wrapper itself stays a laid-out box — and a zero-height box is
 *      still a flex/grid item, so it keeps consuming a `gap` from its parent.
 *      Measured on the profile page: a hidden section left a 96px sibling
 *      distance where a single 48px gap belonged. The wrapper is hidden at
 *      activation and revealed only for a profile that actually shows a card.
 *   3. `src` (and `loading`) on the authored video iframe, from the fetched
 *      `agency_video_link`. wf-xano binds text and image `src`, but has no
 *      documented attribute binder for an iframe's `src`. The page loads the
 *      library via `@latest`, so relying on the undocumented
 *      image-src-on-an-iframe behavior would be a silent breakage waiting for
 *      the next library release.
 *
 * Everything else is declarative and lives in the Designer markup:
 * `wf-xano-bind` for the three text fields, and `wf-xano-if` for the section
 * hide (`is_agency & agency_name`) and each per-row hide. This module never
 * decides which rows appear — read the wiring doc, not this file, to find out
 * why a row is missing.
 *
 * The wrapper is authored `wf-xano-defer="true"` and activated here. That is
 * load-bearing, not decoration: wf-xano's boot sweep and this script race on a
 * real page, and the loser is the request. Verified by probe — without the
 * defer opt-out a boot that wins the race constructs the instance before the
 * slug is stamped (`readStaticParams()` runs in the Instance constructor),
 * fires one slug-less request, gets the endpoint's safe empty shape back, and
 * hides the section for an agency, with no retry because nothing re-fetches on
 * a late attribute change.
 *
 * Failure is silent and closed. No slug, no authored section, a dead endpoint,
 * or this script never loading all end the same way: no card is rendered and
 * the section shows nothing. wf-xano injects
 * `[wf-xano-element="template"]{display:none!important}`, so even the authored
 * card stays hidden on a page where this script never ran (verified by probe) —
 * only the flex-gap collapse in (2) is lost in that case.
 *
 * Contract shared with `v3/AGENCY-PROFILE-WIRING.md`. These strings must change
 * together or the section goes dark:
 *
 *   wrapper   [data-agency-v3="section"]
 *             + wf-xano-element="wrapper"
 *             + wf-xano-instance="starter-agency"
 *             + wf-xano-defer="true"
 *   video     [data-agency-v3="video"]     (iframe, no authored src)
 *   param     wf-xano-param-slug           (stamped here)
 *
 * Staging-only console diagnostics, per the predicate documented in
 * `README.md` ("Staging-only console diagnostics"). Production says nothing.
 */
;(function (global) {
  'use strict'

  if (!global || global.__startersV3AgencyProfileBooted) return
  global.__startersV3AgencyProfileBooted = true

  var LOG_PREFIX = '[agency-profile]'
  var INSTANCE = 'starter-agency'
  var SECTION = '[data-agency-v3="section"]'
  // Rendered cards only. The authored template stays in the DOM (wf-xano hides
  // it rather than removing it), and writing a src into the template would be
  // copied into every later clone by cloneNode — a stale player surviving onto
  // a different profile.
  var RENDERED_VIDEO = '[wf-xano-item] [data-agency-v3="video"]'

  function stagingHost(hostname) {
    var host = hostname || ''
    return (
      /(\.|^)webflow\.io$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
    )
  }

  // STARTERS_DEBUG belongs here and not in stagingHost(): it may turn logging
  // on in production, but it must never change what the module does.
  function diagnosticsEnabled() {
    if (global.STARTERS_DEBUG === true) return true
    return stagingHost((global.location && global.location.hostname) || '')
  }

  function warn(message) {
    if (!diagnosticsEnabled()) return
    try {
      console.warn(LOG_PREFIX + ' ' + message)
    } catch (error) {}
  }

  function profileSlug(pathname) {
    var match = String(pathname || '').match(/^\/hire\/([^/?#]+)\/?$/i)
    if (!match) return ''
    try {
      return decodeURIComponent(match[1]).trim()
    } catch (_) {
      return ''
    }
  }

  /**
   * Stamp the slug onto the authored wrapper. Returns the wrapper so the caller
   * can activate it, or null when there is nothing to do — a non-profile URL,
   * or a page whose Designer section has not been built yet.
   *
   * Only the param is written here. The wrapper's source, method, auth,
   * instance, defer flag, and template are Designer-authored and deliberately
   * not re-stamped: duplicating them would put the same contract in two places,
   * and the section is supposed to stay dark on a page where it was never
   * authored.
   */
  function configureSection(documentObject, pathname) {
    if (!documentObject || !documentObject.querySelector) return null
    var slug = profileSlug(pathname)
    if (!slug) return null
    var root = documentObject.querySelector(SECTION)
    if (!root || !root.setAttribute) return null
    root.setAttribute('wf-xano-param-slug', slug)
    return root
  }

  /** The single agency row out of a wf-xano result. The endpoint returns one
   *  object, which the library normalizes to a one-item list. */
  function agencyRow(result) {
    return (result && result.items && result.items[0]) || null
  }

  /**
   * The section's own show rule, mirrored from the card's
   * `wf-xano-if="is_agency & agency_name"`.
   *
   * This module has to re-derive it rather than read it: the wrapper's
   * visibility and the video's src are both decided before, or independently
   * of, the card's own display. Whitespace is trimmed here where wf-xano's
   * truthiness test would not — a name of "   " would show wf-xano's card while
   * this keeps the wrapper hidden. That divergence fails closed (the visitor
   * sees nothing rather than a blank name) and no stored record looks like it.
   */
  function showsAgency(row) {
    if (!row || !row.is_agency) return false
    return String(row.agency_name == null ? '' : row.agency_name).trim() !== ''
  }

  /**
   * The stored value, accepted only as an absolute https URL.
   *
   * The endpoint is being hardened to return `""` for anything that is not
   * already https, and the row is hidden declaratively when the link is empty —
   * but this module is what puts a URL into a live iframe, so it is the last
   * belt rather than the only one. A `javascript:` or `data:` value stored on a
   * starter record must not become a frame this page executes.
   */
  function videoUrl(row) {
    var stored = row && row.agency_video_link
    if (typeof stored !== 'string') return ''
    var value = stored.trim()
    if (!value) return ''
    try {
      var parsed = new global.URL(value)
      return parsed.protocol === 'https:' ? parsed.href : ''
    } catch (_) {
      return ''
    }
  }

  /** Reveal the wrapper only for a profile that actually shows a card, so a
   *  hidden section stops being a flex/grid item and its parent's gap collapses
   *  with it. */
  function paintWrapper(root, row) {
    if (!root || !root.style) return
    if (showsAgency(row)) root.style.removeProperty('display')
    else root.style.display = 'none'
  }

  /**
   * Point the rendered video iframe at the stored player.
   *
   * Gated on the section's show rule, not merely on the link being present. A
   * display:none iframe still loads: a record flagged as an agency with a video
   * but no name renders a hidden card, and writing the src anyway made the
   * browser fetch player.vimeo.com and build a child frame the visitor could
   * never see (verified by probe).
   */
  function paintVideo(root, row) {
    if (!root || !root.querySelectorAll) return
    var url = showsAgency(row) ? videoUrl(row) : ''
    var frames = root.querySelectorAll(RENDERED_VIDEO)
    if (url && frames.length === 0) {
      warn('a video link was returned but no rendered iframe carries data-agency-v3="video"')
    }
    Array.prototype.forEach.call(frames, function (frame) {
      if (!url) {
        frame.removeAttribute('src')
        return
      }
      // The section sits below the fold; set this before the src so the
      // attribute is in place when the load would otherwise start.
      frame.loading = 'lazy'
      frame.setAttribute('src', url)
    })
  }

  /**
   * Activate the deferred wrapper and subscribe to its results.
   *
   * `init(root)` is passed the wrapper itself, which is what makes the deferred
   * root opt back in — the library's boot sweep skips `wf-xano-defer="true"`
   * roots unless they are the scope handed to init. It is also idempotent for a
   * root that already has an instance, so it cannot double-fetch.
   *
   * Scoped to this wrapper throughout. The Reviews section on this same page is
   * another wf-xano instance, and a document-wide init would drag it in.
   */
  function activate(wfx, root) {
    if (!wfx || !root) return null
    // Hidden before the request, not after it: the wrapper must never occupy a
    // flex slot during the fetch on a profile that will show nothing.
    if (root.style) root.style.display = 'none'
    wfx.init(root)
    var instance = wfx.get(INSTANCE)
    if (!instance) {
      warn(
        'the section wrapper is on the page but no "' +
          INSTANCE +
          '" instance was created — check wf-xano-element="wrapper", ' +
          'wf-xano-instance, wf-xano-source, and that a ' +
          'wf-xano-element="template" exists inside it',
      )
      return null
    }
    // 'results' fires after the cards are rendered, and replays the last result
    // to a late subscriber — so this cannot miss a response that landed first.
    instance.on('results', function (result) {
      var row = agencyRow(result)
      paintWrapper(root, row)
      paintVideo(root, row)
    })
    return instance
  }

  var api = {
    release: 'v1.59.423',
    instanceKey: INSTANCE,
    profileSlug: profileSlug,
    configureSection: configureSection,
    agencyRow: agencyRow,
    showsAgency: showsAgency,
    videoUrl: videoUrl,
    paintWrapper: paintWrapper,
    paintVideo: paintVideo,
    activate: activate,
  }
  global.StartersAgencyProfileV3 = api

  var documentObject = global.document
  if (!documentObject) return

  function boot() {
    var root = configureSection(documentObject, global.location && global.location.pathname)
    if (!root) return
    // ALWAYS go through push(), never branch on the global's shape. Both shapes
    // of window.WfXano expose it and both defer correctly: the pre-load array is
    // drained after boot, and the post-load API object runs the callback now if
    // booted or queues it until after init(document). Branching on Array.isArray
    // and acting directly was a real shipped bug in a sibling script — wf-xano
    // assigns window.WfXano = {api} at module scope, BEFORE boot() creates any
    // instance, so a deferred page script landing in that window acts against an
    // empty instance list and gives up permanently.
    global.WfXano = global.WfXano || []
    global.WfXano.push(function (wfx) {
      activate(wfx, root)
    })
  }

  if (documentObject.readyState === 'loading') {
    documentObject.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})(typeof window !== 'undefined' ? window : null)
