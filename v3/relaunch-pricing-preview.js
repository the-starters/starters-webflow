/**
 * Relaunch pricing preview (staging) and live-copy guard (production).
 *
 * Staging (the-starters-3-0.webflow.io) and production (www.thestarters.com)
 * are one Webflow site, so Designer copy and price attributes always reach
 * production on the next publish. The Designer therefore keeps the live
 * prices, and this module shows the relaunch offer ($1 seven-day trial, then
 * $495/month, or $3,540/year) on the staging host only, so the trial checkout
 * can be tested there.
 *
 * Staging ("preview" mode) changes:
 *   - inside the Join CTA markup (Join CTA section, Signup Modal, Join
 *     Starters Membership Modal), read through the established
 *     `join-cta="monthly" | "yearly"` and `join-cta-tabs="yearly"` attributes:
 *     `data-ms-price:add` from a live price ID to its relaunch price ID, and
 *     leaf text that exactly matches a known live label;
 *   - anywhere on the page: leaf text that exactly matches one of the long,
 *     unique live price sentences (FAQ answer, Competitors cost row), and the
 *     Why Us price pair (a "$195" leaf directly followed by its
 *     "Per month, billed annually at $2,340/year." sibling).
 *
 * Production ("guard" mode) applies the same text maps in reverse. If a
 * Designer publish leaks relaunch copy to production again, the live copy is
 * shown instead. The guard never changes price attributes: checkout acceptance
 * stays owned by `v3/membership-checkout-authority.js`, which refuses the
 * relaunch IDs on production.
 *
 * Text that does not match exactly stays unchanged, so a Designer copy edit
 * can never be overwritten with the wrong offer. Any other host is a no-op.
 *
 * Remove this module when the relaunch prices go live in the Designer. The
 * production guard would otherwise turn the launched copy back.
 */
;(function (globalObject) {
  'use strict'

  if (!globalObject || globalObject.__tsRelaunchPricingPreview) return
  globalObject.__tsRelaunchPricingPreview = true

  var STAGING_HOST = 'the-starters-3-0.webflow.io'
  var PRODUCTION_HOSTS = ['www.thestarters.com', 'thestarters.com']
  var PRICE_ATTRIBUTE = 'data-ms-price:add'
  var PRICE_SWAPS = {
    'prc_premium-monthly--fn1ae0qjj': 'prc_3-0-premium-monthly-ge4a00iw',
    'prc_paid-annual-2o5f040u': 'prc_3-0-premium-annual-xhb200bu',
  }
  var TEXT_SWAPS = {
    monthly: {
      'Get started for $295/month': '7 Day Trial for $1',
      'Cancel anytime.': '$495/mo after. Cancel anytime.',
    },
    yearly: {
      'Get started for $195/mo': 'Get started for $295/mo',
      'Get started for $195/mo billed annually': 'Get started for $295/mo billed annually',
      'Billed annually at $2,340/year.': 'Billed annually at $3,540/year.',
    },
    yearlyTab: {
      '(Save $1,200)': '(Save $2,400)',
    },
  }
  // Every live label is unique, so both plan wrappers share one map. Some
  // Designer blocks mark an annual button with join-cta="monthly".
  var PLAN_TEXT = Object.assign({}, TEXT_SWAPS.monthly, TEXT_SWAPS.yearly)
  // Long live sentences that appear outside the Join CTA. Each one is unique
  // on the site, so an exact leaf match is safe page-wide.
  var PAGE_TEXT = {
    'Membership is $295/month, or $195/month billed annually at $2,340/year. The annual plan saves $1,200 per year compared with paying monthly.':
      'Membership is $495/month, or $295/month billed annually at $3,540/year. The annual plan saves $2,400 per year compared with paying monthly.',
    '$295/mo or $195/mo billed annually ($2,340/year), plus freelancer rate':
      '$495/mo or $295/mo billed annually ($3,540/year), plus freelancer rate',
  }
  // Short texts that are only safe next to their partner sibling.
  var PAIR_TEXT = [
    {
      live: ['$195', 'Per month, billed annually at $2,340/year.'],
      relaunch: ['$295', 'Per month, billed annually at $3,540/year.'],
    },
  ]
  var SCOPES = [
    { selector: '[join-cta="monthly"]', text: PLAN_TEXT },
    { selector: '[join-cta="yearly"]', text: PLAN_TEXT },
    { selector: '[join-cta-tabs="yearly"]', text: TEXT_SWAPS.yearlyTab },
  ]

  function invert(map) {
    var out = {}
    for (var key in map) {
      if (Object.prototype.hasOwnProperty.call(map, key)) out[map[key]] = key
    }
    return out
  }

  var GUARD_SCOPES = SCOPES.map(function (scope) {
    return { selector: scope.selector, text: invert(scope.text) }
  })
  var GUARD_PAGE_TEXT = invert(PAGE_TEXT)
  var GUARD_PAIR_TEXT = PAIR_TEXT.map(function (pair) {
    return { live: pair.relaunch, relaunch: pair.live }
  })

  function host() {
    return String((globalObject.location && globalObject.location.hostname) || '')
      .trim()
      .toLowerCase()
  }

  function mode() {
    var current = host()
    if (current === STAGING_HOST) return 'preview'
    if (PRODUCTION_HOSTS.indexOf(current) !== -1) return 'guard'
    return ''
  }

  function isLeaf(node) {
    return !node.children || node.children.length === 0
  }

  function swapPrices(scope) {
    var count = 0
    var selector = '[' + PRICE_ATTRIBUTE.replace(':', '\\:') + ']'
    var nodes = scope.querySelectorAll(selector)
    for (var i = 0; i < nodes.length; i += 1) {
      var current = String(nodes[i].getAttribute(PRICE_ATTRIBUTE) || '').trim()
      if (Object.prototype.hasOwnProperty.call(PRICE_SWAPS, current)) {
        nodes[i].setAttribute(PRICE_ATTRIBUTE, PRICE_SWAPS[current])
        count += 1
      }
    }
    return count
  }

  function swapText(scope, map) {
    var count = 0
    var nodes = [scope].concat(Array.prototype.slice.call(scope.querySelectorAll('*')))
    for (var i = 0; i < nodes.length; i += 1) {
      if (!isLeaf(nodes[i])) continue
      var current = String(nodes[i].textContent || '').trim()
      if (Object.prototype.hasOwnProperty.call(map, current)) {
        nodes[i].textContent = map[current]
        count += 1
      }
    }
    return count
  }

  function textOf(node) {
    return String((node && node.textContent) || '').trim()
  }

  function swapPairs(doc, pairs) {
    var count = 0
    var nodes = doc.querySelectorAll('*')
    for (var i = 0; i < nodes.length; i += 1) {
      var kids = nodes[i].children || []
      for (var k = 0; k + 1 < kids.length; k += 1) {
        for (var p = 0; p < pairs.length; p += 1) {
          var pair = pairs[p]
          if (
            isLeaf(kids[k]) &&
            isLeaf(kids[k + 1]) &&
            textOf(kids[k]) === pair.live[0] &&
            textOf(kids[k + 1]) === pair.live[1]
          ) {
            kids[k].textContent = pair.relaunch[0]
            kids[k + 1].textContent = pair.relaunch[1]
            count += 2
          }
        }
      }
    }
    return count
  }

  function apply(root) {
    var result = { prices: 0, labels: 0 }
    var current = mode()
    if (!current) return result
    var doc = root || globalObject.document
    if (!doc || typeof doc.querySelectorAll !== 'function') return result
    var preview = current === 'preview'
    var scopeList = preview ? SCOPES : GUARD_SCOPES
    for (var s = 0; s < scopeList.length; s += 1) {
      var scopes = doc.querySelectorAll(scopeList[s].selector)
      for (var i = 0; i < scopes.length; i += 1) {
        if (preview) result.prices += swapPrices(scopes[i])
        result.labels += swapText(scopes[i], scopeList[s].text)
      }
    }
    var page = doc.querySelectorAll('*')
    var pageMap = preview ? PAGE_TEXT : GUARD_PAGE_TEXT
    for (var n = 0; n < page.length; n += 1) {
      if (!isLeaf(page[n])) continue
      var text = textOf(page[n])
      if (Object.prototype.hasOwnProperty.call(pageMap, text)) {
        page[n].textContent = pageMap[text]
        result.labels += 1
      }
    }
    result.labels += swapPairs(doc, preview ? PAIR_TEXT : GUARD_PAIR_TEXT)
    return result
  }

  function boot() {
    if (!mode()) return false
    var doc = globalObject.document
    if (!doc) return false
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', function () {
        apply()
      })
    } else {
      apply()
    }
    return true
  }

  globalObject.StartersRelaunchPricingPreview = { apply: apply, boot: boot, mode: mode }

  boot()
})(typeof window !== 'undefined' ? window : null)
