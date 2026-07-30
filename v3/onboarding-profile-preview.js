/**
 * V3 onboarding profile preview — the freelancer's own profile card.
 *
 * Page glue for the wf-xano list keyed `onboarding-self-preview`, the
 * self-preview card on the onboarding completion page ("Your 30-day visibility
 * boost is already running"). The Designer/embed owns all markup and CSS; this
 * module owns exactly one thing: the `beforeRender` transform that turns the
 * Xano response into the single item the card template binds.
 *
 * WHY A TRANSFORM IS NEEDED AT ALL:
 * `starters_onboarding/get_freelancers` answers with an ENVELOPE —
 * `{"freelancer": [ <one record> ]}`. wf-xano's normalize() sees an object
 * rather than an array and takes its single-object branch, so items[0] is the
 * whole body and every plain bind (`wf-xano-bind="First_Name"`) would resolve
 * against the envelope, not the record. `unwrap()` pulls the record out and adds
 * the three computed fields the template binds and Xano does not send:
 *
 *   Role_1 / Role_2 / Role_3  the `Roles` comma-string split and trimmed, first
 *                             three only; each chip hides on an empty value
 *   Location                  "City, State_Province, Country", empty parts
 *                             skipped so no orphan commas render
 *   Bio                       the Quill rich-text HTML flattened to plain text
 *
 * The Bio flattening is text-only by construction: the result is handed back to
 * wf-xano, whose binds assign textContent. Nothing here is ever inserted as
 * HTML, so a stray `<img onerror>` in a Bio cannot execute — it is stripped, and
 * whatever survives is printed as characters.
 *
 * HOOK-ORDERING (verified against wf-xano.js v0.27.0/v0.28.0, unchanged
 * between them): the load path reads `this.listeners['beforeRender']` only
 * AFTER `await fetch` and `await res.json()`, while boot() runs init(document)
 * — which starts that fetch — and then drains queued callbacks synchronously in
 * the same task. So a callback queued through `WfXano.push()` is always
 * registered before the first response can be rendered, whichever order the two
 * script tags load in. The settled-state `refresh()` below is the belt for the
 * one case that ordering cannot cover: some other script booted wf-xano early
 * enough that a response already rendered before this file ran. Re-fetching
 * then is cheap (one GET) and repaints the card correctly instead of leaving the
 * raw-envelope render on screen.
 *
 * STAGING-ONLY TESTER: `?ms=<memberstack_id>` on the page URL previews another
 * member's card, so QA does not need that member's login. Honored only on
 * `*.webflow.io`, `localhost`/`127.0.0.1`, and `*.trycloudflare.com` — never on
 * the production domain, and never unlocked by `STARTERS_DEBUG`. It works today
 * only because the endpoint still trusts a client-supplied `memberstack_id`;
 * after the Xano auth flip the server derives the member from the token and
 * ignores the param, so the override goes inert by itself.
 *
 * ALWAYS go through `WfXano.push()`, never call arm() directly on
 * `window.WfXano`. Both shapes of that global expose push() and both defer
 * correctly (pre-load array drained at boot; post-load API object runs now if
 * booted, else queues). Branching on Array.isArray and arming directly was a
 * real bug in a sibling script: wf-xano assigns `window.WfXano = {api}` at
 * module scope, BEFORE boot() creates any instance, so a deferred page script
 * landing in that window arms against an empty instance list and gives up.
 *
 * Install: the onboarding completion page's HTML Embed, one deferred tag next
 * to the pinned wf-xano tag. See v3/ONBOARDING-PROFILE-PREVIEW-WIRING.md for
 * the paste block, the tune-ables, and the Xano auth flip.
 */
;(function () {
  'use strict'

  if (window.__startersV3OnboardingProfilePreviewBooted) return
  window.__startersV3OnboardingProfilePreviewBooted = true

  var INSTANCE = 'onboarding-self-preview'
  // Marker gate: the wrapper ships in the embed's raw HTML, so its instance key
  // is a reliable "is this page relevant" check with one selector.
  var WRAPPER = '[wf-xano-instance="' + INSTANCE + '"]'
  // First three only — the card has exactly three chip slots.
  var ROLE_SLOTS = 3
  var LOCATION_FIELDS = ['City', 'State_Province', 'Country']

  // Named entities Quill and hand-authored bios actually produce. Numeric
  // references are handled generically below, so this list only has to cover
  // names. An unknown name is left as written rather than guessed at.
  var ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ndash: '–', mdash: '—', hellip: '…',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
    bull: '•', middot: '·', trade: '™', copy: '©',
    reg: '®', deg: '°', eacute: 'é', egrave: 'è'
  }

  // Staging, local, or a cloudflared dev tunnel — never the production domain.
  //
  // Tighter than the loose `/webflow\.io$|^localhost$|trycloudflare\.com$/` the
  // sibling v3 modules use, on purpose: there it only gates a console.warn,
  // whereas here it also gates the ?ms= member override below, which reads
  // another member's record. Anchoring the dots means a lookalike domain like
  // "notwebflow.io" or "evil-trycloudflare.com" cannot pass for staging.
  function stagingHost() {
    var host = location.hostname
    return /(\.|^)webflow\.io$/.test(host) ||
      host === 'localhost' || host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
  }

  // Same shape as the sibling v3 modules: loud on staging/local/tunnel, silent
  // in production unless explicitly asked. A missing instance renders a
  // plausible-looking card, so this bug class is invisible without the warning.
  // STARTERS_DEBUG belongs HERE and not in stagingHost() — it may turn logging
  // on in production, and must never unlock the member override.
  function diagnostic() {
    return stagingHost() || window.STARTERS_DEBUG
  }

  function warn(message) {
    if (diagnostic()) console.warn('[starters onboarding-preview] ' + message)
  }

  // SINGLE PASS, deliberately: a loop-until-stable decode would turn the
  // literal "&amp;lt;" into "<" instead of the "&lt;" the author typed, which is
  // how an escaped-then-decoded bio can smuggle markup back in.
  function decodeEntities(value) {
    return value.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]{1,10});/g, function (whole, ref) {
      if (ref.charAt(0) === '#') {
        var code = ref.charAt(1) === 'x' || ref.charAt(1) === 'X'
          ? parseInt(ref.slice(2), 16)
          : parseInt(ref.slice(1), 10)
        if (!isFinite(code) || code < 9 || code > 0x10ffff) return whole
        try {
          return String.fromCodePoint(code)
        } catch (e) {
          return whole // lone surrogate or other unpaired code point
        }
      }
      var named = ENTITIES[ref] || ENTITIES[ref.toLowerCase()]
      return named == null ? whole : named
    })
  }

  // Rich-text HTML -> one line of plain text. Block ends and <br> become spaces
  // first, otherwise "<p>a</p><p>b</p>" would flatten to "ab".
  function htmlToText(value) {
    if (value == null) return ''
    var out = String(value)
    out = out.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    out = out.replace(/<\s*br\s*\/?\s*>/gi, ' ')
    out = out.replace(/<\s*\/\s*(p|div|li|ul|ol|h[1-6]|blockquote|tr|td|th|section|pre)\s*>/gi, ' ')
    out = out.replace(/<[^>]*>/g, '')
    out = decodeEntities(out)
    return out.replace(/\s+/g, ' ').trim()
  }

  function text(value) {
    return value == null ? '' : String(value).trim()
  }

  // Xano stores this record's roles as ONE comma string. Unlike the saved-list
  // sibling this does NOT split on ";" — the onboarding record is a different
  // column with a different delimiter, and accepting ";" here would break a role
  // whose display name legitimately contains one.
  function splitRoles(value) {
    return text(value)
      .split(',')
      .map(function (part) {
        return part.trim()
      })
      .filter(function (part) {
        return part.length > 0
      })
  }

  function joinLocation(record) {
    return LOCATION_FIELDS.map(function (field) {
      return text(record ? record[field] : '')
    })
      .filter(function (part) {
        return part.length > 0
      })
      .join(', ')
  }

  // items[0] is the whole response body (normalize()'s single-object branch).
  // Returning [] on anything unexpected is the safe direction: the card template
  // carries wf-xano-if="First_Name|Last_Name|Professional_Headline", so zero
  // items shows the authored empty state instead of a phantom blank card.
  function unwrap(items) {
    var body = items && items.length ? items[0] : null
    var list = body && body.freelancer
    var record = Array.isArray(list) && list.length ? list[0] : null
    if (!record || typeof record !== 'object') return []

    var roles = splitRoles(record.Roles)
    var out = {}
    for (var key in record) {
      if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key]
    }
    for (var slot = 0; slot < ROLE_SLOTS; slot++) {
      out['Role_' + (slot + 1)] = roles[slot] || ''
    }
    out.Location = joinLocation(record)
    out.Bio = htmlToText(record.Bio)
    return [out]
  }

  // STAGING-ONLY TESTER: `?ms=<memberstack_id>` on the page URL previews any
  // member's card, so QA does not need that member's login. Returns null in
  // production, whatever the query string says — the page's own hardcoded param
  // is the only id honored there.
  //
  // This is a stopgap that exists because the endpoint currently trusts a
  // client-supplied `memberstack_id`. After the Xano auth flip (see the wiring
  // doc) the server derives the member from the auth token and ignores the
  // param, so this override goes inert on its own rather than becoming a hole.
  function memberOverride() {
    if (!stagingHost()) return null
    try {
      var value = new URLSearchParams(location.search).get('ms')
      value = value == null ? '' : String(value).trim()
      return value.length ? value : null
    } catch (e) {
      return null // no URLSearchParams, or a query string it refuses to parse
    }
  }

  function arm(api) {
    var instance = api && typeof api.get === 'function' ? api.get(INSTANCE) : null
    if (!instance || typeof instance.on !== 'function') {
      // Either the wrapper lost its wf-xano-instance="onboarding-self-preview"
      // key or the list failed to initialize. Without the hook the binds resolve
      // against the envelope, the wf-xano-if guard hides the card, and the page
      // silently shows the empty state to a member who has a full profile.
      warn('no wf-xano instance "' + INSTANCE + '" — the card cannot unwrap the response and will show its empty state.')
      return
    }
    instance.on('beforeRender', unwrap)

    var override = memberOverride()
    if (override && typeof instance.setParam === 'function') {
      // setParam sets the param, resets to page 1, and reloads (wf-xano
      // docs/api.md). That reload subsumes the settled-state belt below, so
      // return early — running both would fire two GETs for one paint.
      warn('previewing member "' + override + '" from ?ms= (staging only).')
      instance.setParam('memberstack_id', override)
      return
    }

    var state = typeof instance.getState === 'function' ? instance.getState() : null
    // Only true if something booted wf-xano before this file ran, i.e. a render
    // already happened without the transform. Repaint it.
    if (state && (state.status === 'success' || state.status === 'error')) {
      if (typeof instance.refresh === 'function') instance.refresh()
    }
  }

  function boot() {
    if (!document.querySelector(WRAPPER)) return
    window.WfXano = window.WfXano || []
    window.WfXano.push(arm)
  }

  // Console debugging: the transform is pure, so each piece can be checked
  // against a real Bio or Roles string without reloading the page.
  window.StartersV3OnboardingProfilePreview = {
    htmlToText: htmlToText,
    splitRoles: splitRoles,
    joinLocation: joinLocation,
    unwrap: unwrap,
    // Answers "why is/isn't ?ms= doing anything here" without reading the source.
    stagingHost: stagingHost,
    memberOverride: memberOverride,
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
