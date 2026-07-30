/**
 * V3 saved-Starters roles chips.
 *
 * Page glue for the wf-xano "saved-starters" list (the premium-Brand Saved
 * Starters container on /all-starters). Xano returns a Starter's roles as ONE
 * delimited string; the Designer card wants one styled <p> per role, matching
 * the Algolia browse cards. This module splits the bound value and emits a chip
 * per role.
 *
 * Designer contract:
 *   - the roles <p> inside the saved-list card template carries BOTH
 *     `wf-xano-bind="<roles column>"` and `data-ts-roles`,
 *   - nothing else on the page uses `data-ts-roles`.
 * Chips are emitted as siblings of that <p>, each marked `data-ts-roles-chip`,
 * cloned from it so they inherit its Webflow classes.
 *
 * WHY NON-DESTRUCTIVE (do not "simplify" this to replaceWith):
 * algolia-result-modifiers/roles.js replaces the bound <p> with its clones,
 * which is safe there because wf-algolia always re-renders cards from scratch.
 * wf-xano does NOT: a wrapper marked `wf-xano-reconcile="keyed"` REUSES the
 * existing card node and re-binds its fields in place (fillCard(card, item,
 * true) in _renderItemsKeyed, verified in wf-xano v0.27.0). If the bound <p>
 * has been replaced by chips, that re-bind has nothing to write to, and a
 * reused card keeps the previous Starter's roles forever. So instead:
 *   - the bound <p> STAYS in the DOM, hidden, as the value source,
 *   - the chips are owned by this script and rebuilt from scratch each pass,
 *   - chips get `wf-xano-bind` stripped so wf-xano can never bind into one.
 * That is correct in replace mode too (the whole card is removed there, chips
 * included), so it needs no mode detection.
 *
 * Trap: de-hyphenation is scoped to the roles element ONLY. The sibling
 * modifier's clean() de-hyphenates whatever it is handed, and the saved card
 * also renders `availability: "11-20"` — de-hyphenating that would print
 * "11 20". Never widen this selector.
 *
 * Slugs listed in ROLE_NAMES are emitted in final display case ("cro-expert"
 * becomes "CRO Expert") instead of being de-hyphenated, because a plain
 * de-hyphenate under `text-transform: capitalize` renders "Cro Expert". That
 * map is shared verbatim with the two sibling scripts and must stay in sync
 * with them.
 *
 * Renders trigger via the instance's own after-render event
 * (`on('results')`, which also replays the last result to a late subscriber),
 * so this covers first paint, pagination, and the `wf-xano-refresh-on="favorite"`
 * re-render without a MutationObserver. Cards are matched inside
 * `[wf-xano-item]` only, which excludes the still-hidden template — injecting
 * chips into the template would clone them into every card.
 *
 * Install: /all-starters Page Settings -> Custom Code -> Footer, one deferred
 * jsDelivr tag, alongside v3/all-starters-favorites.js.
 */
;(function () {
  'use strict'

  if (window.__startersV3SavedStartersRolesBooted) return
  window.__startersV3SavedStartersRolesBooted = true

  var INSTANCE = 'saved-starters'
  var SOURCE_ATTR = 'data-ts-roles'
  var CHIP_ATTR = 'data-ts-roles-chip'
  var SOURCE = '[' + SOURCE_ATTR + ']'
  var CARD = '[wf-xano-item]'
  // Bind attributes that must never survive onto a chip: any of these would
  // let a keyed re-bind overwrite the chip's text with the raw joined value.
  var BIND_ATTRS = [
    'wf-xano-bind',
    'wf-xano-fallback',
    'wf-xano-format',
    'wf-xano-default',
    'wf-xano-prefix',
    'wf-xano-suffix',
  ]

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

  // Same predicate as the sibling result modifiers: loud on staging/local,
  // silent in production. This whole bug class is invisible by nature.
  function diagnostic() {
    return /webflow\.io$|^localhost$|trycloudflare\.com$/.test(location.hostname) || window.STARTERS_DEBUG
  }

  function warn(message) {
    if (diagnostic()) console.warn('[starters saved-roles] ' + message)
  }

  // Adding chips grows .expert-card_jobs-wrapper from one line to several, but
  // global-embeds/expert-card/expert-card.js caches the expanded height in
  // --expert-card-jobs-open-height, measured on window load / fonts ready /
  // resize. wf-xano renders after load, so on a saved list that variable is
  // never computed at all and the hover expansion has no height to grow into.
  // Asking for a relayout after chips change is what makes roles hover work.
  // Debounced so one pass over N cards costs one layout, and dispatched only on
  // a real change so a no-op pass cannot ping-pong with the layout listener.
  var relayoutTimer
  function requestRelayout() {
    clearTimeout(relayoutTimer)
    relayoutTimer = setTimeout(function () {
      try {
        window.dispatchEvent(new CustomEvent('expert-cards:relayout'))
      } catch (e) {
        /* never break the page */
      }
    }, 60)
  }

  // Xano's roles string has been seen semicolon-delimited (`subcategories`
  // style: "growth-strategy; paid-social") and Algolia's own roles attribute is
  // comma-delimited, so accept both rather than betting on one.
  //
  // ROLE_NAMES is consulted HERE ONLY, never in a shared helper: the same card
  // renders `availability: "11-20"`, and anything that widens this lookup past
  // the `data-ts-roles` element risks rewriting that value too. Numeric parts
  // are not map keys, so they fall through to the de-hyphenate path unchanged.
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

  // Text of the chips currently following `source`, so a pass that produces an
  // identical set can skip the relayout dispatch.
  function existingChipText(source) {
    var texts = []
    var node = source.nextSibling
    while (node) {
      if (node.nodeType === 1) {
        if (!node.hasAttribute(CHIP_ATTR)) break
        texts.push(node.textContent)
      }
      node = node.nextSibling
    }
    return texts
  }

  // Remove only the chips this script put after `source`. They are always
  // inserted as one contiguous run immediately after it, so walking forward
  // until the first non-chip element is precise and order-safe.
  function clearChips(source) {
    var node = source.nextSibling
    while (node) {
      var next = node.nextSibling
      if (node.nodeType === 1) {
        if (!node.hasAttribute(CHIP_ATTR)) break
        node.remove()
      }
      node = next
    }
  }

  function buildChip(source, role) {
    var chip = source.cloneNode(false)
    BIND_ATTRS.forEach(function (name) {
      chip.removeAttribute(name)
    })
    chip.removeAttribute(SOURCE_ATTR) // a chip must never be treated as a source
    chip.removeAttribute('id') // cloning an id would duplicate it per role
    chip.setAttribute(CHIP_ATTR, '')
    // The clone inherits the source's inline display:none — undo it so the
    // element's Webflow class decides how it lays out.
    chip.style.display = ''
    chip.textContent = role
    return chip
  }

  // Returns true only when this card's rendered roles actually changed, so a
  // replayed or repeated pass does not request a pointless relayout.
  function apply(source) {
    if (!source.parentNode) return false
    var before = existingChipText(source)
    var wasHidden = source.style.display === 'none'
    clearChips(source)
    var roles = parseRoles(source.textContent)
    // Hidden, never removed: wf-xano re-binds this node on a keyed re-render.
    source.style.display = 'none'
    var anchor = source
    roles.forEach(function (role) {
      var chip = buildChip(source, role)
      source.parentNode.insertBefore(chip, anchor.nextSibling)
      anchor = chip
    })
    if (!wasHidden) return true
    if (before.length !== roles.length) return true
    for (var i = 0; i < roles.length; i++) {
      if (before[i] !== roles[i]) return true
    }
    return false
  }

  function run(instance) {
    var scope = (instance && instance.root) || document
    var sources = scope.querySelectorAll(CARD + ' ' + SOURCE)
    var changed = false
    Array.prototype.forEach.call(sources, function (source) {
      if (apply(source)) changed = true
    })
    if (changed) requestRelayout()
  }

  function arm(api) {
    var instance = api && typeof api.get === 'function' ? api.get(INSTANCE) : null
    if (!instance || typeof instance.on !== 'function') {
      // Either the wrapper is missing its wf-xano-instance="saved-starters"
      // key, or it failed to initialize. Split whatever is already rendered so
      // the page is not left showing raw "growth-strategy; paid-social", but
      // say so: without the event, later pages will render unsplit.
      warn('no wf-xano instance "' + INSTANCE + '" — chips will not rebuild on re-render.')
      run(null)
      return
    }
    instance.on('results', function () {
      run(instance)
    })
  }

  function boot() {
    // Marker gate: the roles element ships inside the static (hidden) template,
    // so this is a reliable "is this page relevant" check for one selector.
    if (!document.querySelector(SOURCE)) return
    // ALWAYS go through push(), never call arm() directly. Both shapes of
    // window.WfXano expose it and both defer correctly:
    //   - pre-load array: Array.prototype.push, drained after boot,
    //   - post-load API object: push() runs now if booted, else queues until
    //     after init(document).
    // Branching on Array.isArray and calling arm() directly is WRONG and was a
    // real bug: wf-xano assigns window.WfXano = {api} at module scope, before
    // boot() creates any instance. A deferred script landing in that window
    // sees a non-array, arms against an empty instance list, and gives up
    // permanently — the list then never gets its roles split.
    window.WfXano = window.WfXano || []
    window.WfXano.push(arm)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
