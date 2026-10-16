/**
 * Staging-only relaunch pricing preview.
 *
 * Staging (the-starters-3-0.webflow.io) and production (www.thestarters.com)
 * are one Webflow site, so Designer copy and price attributes always reach
 * production on the next publish. The Designer therefore keeps the live
 * prices, and this module shows the relaunch offer ($1 seven-day trial, then
 * $495/month, or $3,540/year) on the staging host only, so the trial checkout
 * can be tested there.
 *
 * Scope: the Join CTA markup used by the Join CTA section, the Signup Modal
 * and the Join Starters Membership Modal. It reads the established
 * `join-cta="monthly" | "yearly"` and `join-cta-tabs="yearly"` attributes.
 * Inside those scopes it changes:
 *   - `data-ms-price:add` from a live price ID to its relaunch price ID;
 *   - leaf text that exactly matches a known live label.
 * Text that does not match exactly stays unchanged, so a Designer copy edit
 * can never be overwritten with the wrong offer.
 *
 * On any other host the module returns before it reads the DOM. Checkout
 * acceptance of the relaunch price IDs stays owned by
 * `v3/membership-checkout-authority.js` (staging-only allowlist).
 *
 * Remove this module when the relaunch prices go live in the Designer.
 */
;(function (globalObject) {
  'use strict'

  if (!globalObject || globalObject.__tsRelaunchPricingPreview) return
  globalObject.__tsRelaunchPricingPreview = true

  var STAGING_HOST = 'the-starters-3-0.webflow.io'
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
  var SCOPES = [
    { selector: '[join-cta="monthly"]', text: TEXT_SWAPS.monthly },
    { selector: '[join-cta="yearly"]', text: TEXT_SWAPS.yearly },
    { selector: '[join-cta-tabs="yearly"]', text: TEXT_SWAPS.yearlyTab },
  ]

  function host() {
    return String((globalObject.location && globalObject.location.hostname) || '')
      .trim()
      .toLowerCase()
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

  function apply(root) {
    var result = { prices: 0, labels: 0 }
    if (host() !== STAGING_HOST) return result
    var doc = root || globalObject.document
    if (!doc || typeof doc.querySelectorAll !== 'function') return result
    for (var s = 0; s < SCOPES.length; s += 1) {
      var scopes = doc.querySelectorAll(SCOPES[s].selector)
      for (var i = 0; i < scopes.length; i += 1) {
        result.prices += swapPrices(scopes[i])
        result.labels += swapText(scopes[i], SCOPES[s].text)
      }
    }
    return result
  }

  function boot() {
    if (host() !== STAGING_HOST) return false
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

  globalObject.StartersRelaunchPricingPreview = { apply: apply, boot: boot }

  boot()
})(typeof window !== 'undefined' ? window : null)
