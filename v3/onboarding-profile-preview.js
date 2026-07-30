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
 *   Role_1 / Role_2 / Role_3  role display names, first three only (extras
 *                             dropped); each chip hides when empty. Source of
 *                             truth is a server-resolved `roles_resolved` array
 *                             when present; otherwise the `Roles` string, whose
 *                             stored format varies per record (comma-separated
 *                             display names OR semicolon-separated slugs). See
 *                             roleNames() / parseRoles().
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
 * ONE INSTANCE PER FORM BLOCK: the page's consult and full form blocks each want
 * their own card layout, and wf-xano binds exactly ONE template per wrapper — so
 * each form block is its own wrapper with its own template and its own instance
 * key. This module therefore arms EVERY instance whose source reads
 * `starters_onboarding/get_freelancers` (or a suffixed variant of it, such as the
 * temporary `get_freelancers_test`), not one instance by name (the legacy key
 * `onboarding-self-preview` is still honored for a rolled-back page). Two
 * wrappers means two GETs of the same endpoint on load; that is accepted, and it
 * is the reason the ?ms= override reloads twice.
 *
 * LIMITATION, deliberately not engineered around: arming happens once, in the
 * queued callback that runs after wf-xano's boot() has created every instance
 * from the initial DOM. An instance created later by a manual `WfXano.init(el)`
 * call would not be armed, because the library emits no "instance created"
 * event to subscribe to. Nothing on this page does that; if something ever does,
 * re-running the queue callback (`WfXano.push(...)`) after the late init is the
 * fix.
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
 * Install: the onboarding completion page, one deferred tag next to the pinned
 * wf-xano tag, in the scripts embed — ONE pair of tags for the page, however many
 * form-block wrappers it has. The wf-xano wrapper attributes live on each FORM
 * BLOCK, which contains its own structure embed. See
 * v3/ONBOARDING-PROFILE-PREVIEW-WIRING.md for the per-form attribute table, the
 * form-block switching, the tune-ables, and the Xano auth flip.
 */
;(function () {
  'use strict'

  if (window.__startersV3OnboardingProfilePreviewBooted) return
  window.__startersV3OnboardingProfilePreviewBooted = true

  // Legacy single-wrapper key, kept so an older page (or a rolled-back embed)
  // still arms. The current page has one wrapper PER FORM BLOCK instead, with
  // its own key, so keys alone can no longer identify our lists.
  var INSTANCE = 'onboarding-self-preview'
  // What actually identifies our lists: the endpoint they read. Any wrapper
  // pointing here gets the transform, whatever its instance key is named.
  var SOURCE_PATH = 'starters_onboarding/get_freelancers'
  // SUFFIX VARIANTS MUST MATCH. The page has been pointed at
  // `get_freelancers_test` (a temporary secret-gated mirror) and a
  // `get_freelancers_secure` may follow, so this is a segment-prefix test, not an
  // exact-endsWith one: `starters_onboarding` must start a path segment and
  // `get_freelancers` must start the next, after which anything may follow.
  // An endsWith check here was a live bug — nothing armed on the _test endpoint
  // and every bind rendered against the raw envelope.
  var SOURCE_RE = new RegExp('(^|[/:])' + SOURCE_PATH)
  // Marker gate, matching either grammar: the legacy key, or any wrapper whose
  // source attribute names our endpoint. Both are plain page HTML at parse time.
  // CSS `*=` is a plain substring match, so it already covers the suffix variants.
  var WRAPPER =
    '[wf-xano-instance="' + INSTANCE + '"], [wf-xano-source*="' + SOURCE_PATH + '"]'
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

  // Normal-course reporting (what got armed), as opposed to warn()'s "this is
  // wired wrong". Same gate: nothing at all in production.
  function note(message) {
    if (diagnostic()) console.info('[starters onboarding-preview] ' + message)
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

  // Display-name overrides for role slugs that plain de-hyphenate+capitalize
  // mangles (acronyms, and one plural). Keyed on the RAW stored slug.
  // KEEP IN SYNC across:
  //   v3/saved-starters-roles.js
  //   algolia-result-modifiers/roles.js
  //   starters-list-filter/custom-algolia-scripts/filters-text.js
  //   v3/onboarding-profile-preview.js
  var ROLE_NAMES = {
    'ui-ux-designer': 'UI/UX Designer',
    'cro-expert': 'CRO Expert',
    'seo-marketer': 'SEO Marketer',
    'crm-marketer': 'CRM Marketer',
    'cx-director': 'CX Director',
    'pr-directors': 'PR Director',
    'ai-automation-expert': 'AI Automation Expert',
    'e-commerce-manager': 'E-Commerce Manager'
  }

  // Ported verbatim from v3/saved-starters-roles.js parseRoles(), because this
  // field has exactly the same two-format problem.
  //
  // The stored value's format VARIES PER RECORD: sometimes display names with
  // commas ("AI Automation Expert"), sometimes slugs with semicolons
  // ("head-of-growth; paid-social-marketer; performance-creative-lead"). An
  // earlier comma-only split here was a live bug — the whole semicolon string
  // landed in Role_1 and chips 2 and 3 rendered empty. The Kaeser test record is
  // a single display name, so it never exercised it. Accept both separators
  // rather than betting on one.
  //
  // A slug that is not in ROLE_NAMES is de-hyphenated to lowercase words
  // ("head-of-growth" -> "head of growth"); the CHIP'S CSS supplies the final
  // casing via `text-transform: capitalize`. Map entries already carry their own
  // final casing (and are unaffected by capitalize), which is the whole reason
  // the map exists: plain de-hyphenate + capitalize renders "Cro Expert".
  // Display names pass through untouched by construction — they are not map
  // keys and contain no hyphens.
  function parseRoles(text) {
    var seen = Object.create(null)
    var roles = []
    String(text == null ? '' : text)
      .split(/[;,]/)
      .forEach(function (part) {
        var slug = part.trim().toLowerCase()
        var role = ROLE_NAMES[slug] || part.trim().replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
        if (!role) return
        var key = role.toLowerCase()
        if (seen[key]) return
        seen[key] = true
        roles.push(role)
      })
    return roles
  }

  /* --------------------------- resolved role names ------------------------- *
   * The record also carries `role_refs: [39, 38, 35]` — the authoritative role
   * reference IDs. Once Xano resolves those server-side (see the wiring doc,
   * "Roles: resolve role_refs in Xano"), the response will carry real display
   * names and every heuristic below it becomes dead weight.
   *
   * This is the forward path, live now so the Xano change needs no client
   * release: if a resolved array is present and yields at least one name, it
   * WINS over the `Roles` string. Resolved names are authoritative display
   * values, so they are NOT slug-mapped and NOT de-hyphenated — only trimmed,
   * emptied-out, and deduped.
   *
   * `roles_resolved` is the canonical field name. It is deliberately distinct
   * from the existing `Roles` (the delimited string) and `role_refs` (the ids),
   * so all three can coexist during the migration; `roles` is accepted too, in
   * case the endpoint ships that name instead.
   * ------------------------------------------------------------------------ */
  var RESOLVED_ROLE_FIELDS = ['roles_resolved', 'roles']
  var RESOLVED_NAME_KEYS = ['name', 'display_name', 'title']

  function resolvedRoleNames(value) {
    if (!Array.isArray(value)) return []
    var seen = Object.create(null)
    var names = []
    value.forEach(function (entry) {
      var name = ''
      if (typeof entry === 'string') {
        name = text(entry)
      } else if (entry != null && typeof entry === 'object') {
        for (var i = 0; i < RESOLVED_NAME_KEYS.length && !name; i++) {
          name = text(entry[RESOLVED_NAME_KEYS[i]])
        }
      }
      // Anything else — a bare id, a boolean, null — is skipped on purpose. A
      // chip reading "39" is worse than no chip, and an array of raw ids simply
      // yields nothing, which falls through to the string path below.
      if (!name) return
      var key = name.toLowerCase()
      if (seen[key]) return
      seen[key] = true
      names.push(name)
    })
    return names
  }

  // The one place that decides where role names come from. Resolved array first
  // (in field-name preference order), delimited string as the fallback.
  function roleNames(record) {
    if (record && typeof record === 'object') {
      for (var i = 0; i < RESOLVED_ROLE_FIELDS.length; i++) {
        var resolved = resolvedRoleNames(record[RESOLVED_ROLE_FIELDS[i]])
        if (resolved.length) return resolved
      }
    }
    return parseRoles(record ? record.Roles : '')
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

  /* ------------------------- profile type normalization -------------------- *
   * `profile_type_30` decides which form block shows, via each form's own
   * `wf-xano-if-state="data.items.0.profile_type_30 === consult"` (see the wiring
   * doc). That comparison is `String(left) === right` — case- and
   * whitespace-EXACT — and the stored values are case-inconsistent across
   * records: the Kaeser record has "full", Brian Chung (id 558) has "Full"
   * (verified 2026-07-30). A future "Consult" with a capital C would therefore
   * silently fall to the full form.
   *
   * So the transform lowercases the field in place, and the published attribute
   * expressions keep working with zero Designer churn. Safe to do because this
   * field is ONLY a switching key — it is never bound, never displayed. If it
   * ever needs to be shown, bind a separate un-normalized field rather than
   * un-doing this.
   * ------------------------------------------------------------------------ */
  var TYPE_FIELD = 'profile_type_30'

  function normalizeType(value) {
    return text(value).toLowerCase()
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

    var roles = roleNames(record)
    var out = {}
    for (var key in record) {
      if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key]
    }
    for (var slot = 0; slot < ROLE_SLOTS; slot++) {
      out['Role_' + (slot + 1)] = roles[slot] || ''
    }
    out.Location = joinLocation(record)
    out.Bio = htmlToText(record.Bio)
    out[TYPE_FIELD] = normalizeType(record[TYPE_FIELD])
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

  /* --------------------------- instance selection -------------------------- *
   * The page has ONE WRAPPER PER FORM BLOCK, each containing its own card
   * template, because the two profile types want different card layouts and
   * wf-xano binds exactly ONE template per wrapper (`this.template =
   * owned(elSel('template'))` takes the first owned match; a second template
   * under the same wrapper is silently ignored). So this module arms every
   * instance reading our endpoint rather than one instance by name.
   * ------------------------------------------------------------------------ */

  // Path comparison only. resolveUrl() returns an absolute source verbatim and
  // load() appends the query string per request, but strip query/hash anyway so a
  // source written with either still matches.
  //
  // Segment-prefix, NOT endsWith: `get_freelancers_test` and
  // `get_freelancers_secure` are real endpoint names this page has used, and both
  // must arm. The leading `(^|[/:])` is what keeps it honest — it anchors
  // `starters_onboarding` to a segment start, so `other_group/get_freelancers` and
  // `not_starters_onboarding/get_freelancers` do not match.
  function sourceMatches(value) {
    var url = text(value)
    if (!url) return false
    return SOURCE_RE.test(url.split('#')[0].split('?')[0])
  }

  function instanceMatches(instance) {
    if (!instance) return false
    if (instance.key === INSTANCE) return true
    // `url` is the resolved absolute URL, `source` the raw attribute. Check both
    // so a `group:path` source matches even though only the resolved form
    // carries the host.
    return sourceMatches(instance.url) || sourceMatches(instance.source)
  }

  // Every instance this module owns, in wf-xano's own order, deduped by
  // identity. Source matches first; the legacy key is then added as a fallback
  // for an API object exposing get() but no instances array.
  function targetInstances(api) {
    var found = []
    function add(instance) {
      if (!instance || typeof instance.on !== 'function') return
      if (found.indexOf(instance) > -1) return
      found.push(instance)
    }
    var list = api && api.instances
    if (list && typeof list.length === 'number') {
      Array.prototype.forEach.call(list, function (instance) {
        if (instanceMatches(instance)) add(instance)
      })
    }
    if (api && typeof api.get === 'function') add(api.get(INSTANCE))
    return found
  }

  function armInstance(instance, override) {
    instance.on('beforeRender', unwrap)

    if (override && typeof instance.setParam === 'function') {
      // setParam sets the param, resets to page 1, and reloads (wf-xano
      // docs/api.md). That reload subsumes the settled-state belt below, so
      // return early — running both would fire two GETs for one paint. Each
      // instance reloads independently.
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

  function arm(api) {
    var instances = targetInstances(api)
    if (!instances.length) {
      // No wrapper claims our endpoint, or none initialised. Without the hook
      // the binds resolve against the envelope, the template's wf-xano-if guard
      // hides the card, and the page silently shows its empty state to a member
      // who has a complete profile.
      warn(
        'no wf-xano instance reading ' + SOURCE_PATH + '* (and none keyed "' + INSTANCE +
          '") — the card cannot unwrap the response and will show its empty state.',
      )
      return
    }

    var override = memberOverride()
    // Announced once rather than per instance; the count is the interesting part.
    if (override) {
      warn(
        'previewing member "' + override + '" from ?ms= (staging only) on ' +
          instances.length + ' instance(s) — each reloads separately.',
      )
    }
    instances.forEach(function (instance) {
      armInstance(instance, override)
    })
    note(
      'armed ' + instances.length + ' instance(s): ' +
        instances
          .map(function (instance) {
            return '"' + (instance.key || '(unkeyed)') + '"'
          })
          .join(', '),
    )
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
    parseRoles: parseRoles,
    normalizeType: normalizeType,
    resolvedRoleNames: resolvedRoleNames,
    roleNames: roleNames,
    joinLocation: joinLocation,
    unwrap: unwrap,
    // Answers "why is/isn't ?ms= doing anything here" without reading the source.
    stagingHost: stagingHost,
    memberOverride: memberOverride,
    // Answers "which lists did this arm, and why not that one".
    // targetInstances(WfXano) re-runs the selection against the live library.
    sourceMatches: sourceMatches,
    instanceMatches: instanceMatches,
    targetInstances: targetInstances,
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
