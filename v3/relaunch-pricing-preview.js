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
 *     unique live price sentences (FAQ answer, Competitors cost row, Learn
 *     article paywall), and the Why Us price pair (a "$195" leaf directly
 *     followed by its "Per month, billed annually at $2,340/year." sibling);
 *   - the FAQ: two relaunch items (trial, existing-member price) are added
 *     after the item that holds the `data-relaunch-pricing="faq-pricing"`
 *     answer. Each is a copy of that item with new text, marked
 *     `data-relaunch-faq`, and registered with `window.StarterAccordions` when
 *     the accordion has already initialized. When the Designer already holds
 *     a `data-relaunch-faq` item in that list, nothing is added.
 *
 * Production ("guard" mode) applies the same text maps in reverse, except
 * "Get started for $295/mo", which can be a correct live label. If a
 * Designer publish leaks relaunch copy to production again, the live copy is
 * shown instead, and any `data-relaunch-faq` item is removed. The guard never
 * changes price attributes: checkout acceptance
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
    'Get unlimited access to The Starters\u2019 exclusive reporting and ad-free intelligence. Membership is $295/month, or $195/month billed annually at $2,340/year.':
      'Get unlimited access to The Starters\u2019 exclusive reporting and ad-free intelligence. Membership is $495/month, or $295/month billed annually at $3,540/year.',
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

  // "Get started for $295/mo" is also a valid live monthly label, so the
  // guard leaves it as is.
  var GUARD_PLAN_TEXT = invert(PLAN_TEXT)
  delete GUARD_PLAN_TEXT['Get started for $295/mo']
  var GUARD_SCOPES = SCOPES.map(function (scope) {
    return {
      selector: scope.selector,
      text: scope.text === PLAN_TEXT ? GUARD_PLAN_TEXT : invert(scope.text),
    }
  })
  var GUARD_PAGE_TEXT = invert(PAGE_TEXT)
  // Relaunch FAQ items, shown on staging only. The Designer keeps them hidden.
  var FAQ_ANCHOR = 'data-relaunch-pricing'
  var FAQ_ANCHOR_VALUE = 'faq-pricing'
  var FAQ_MARK = 'data-relaunch-faq'
  var FAQ_ITEMS = [
    {
      key: 'trial',
      question: 'How does the 7-day monthly trial work?',
      answer:
        'Start your monthly membership with 7 days for $1 and get full member access during the trial. We\u2019ll send a reminder on day 5. Your first $495 monthly charge is on day 7 unless you cancel before the trial ends. If you cancel during the trial, your access ends when the trial ends.',
    },
    {
      key: 'grandfathering',
      question: 'Will my existing membership price change?',
      answer:
        'Existing members keep their current price. If you cancel and later rejoin, the new pricing applies: $495/month, or $295/month billed annually at $3,540/year.',
    },
  ]
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

  function closestWith(node, name, value) {
    for (var current = node; current && current.getAttribute; current = current.parentNode) {
      var found = current.getAttribute(name)
      if (found !== null && (value === undefined || found === value)) return current
    }
    return null
  }

  function firstWith(scope, name, value) {
    var selector = value === undefined ? '[' + name + ']' : '[' + name + '="' + value + '"]'
    var nodes = scope.querySelectorAll(selector)
    return nodes.length ? nodes[0] : null
  }

  function firstTextLeaf(scope) {
    var nodes = scope.querySelectorAll('*')
    for (var i = 0; i < nodes.length; i += 1) {
      if (isLeaf(nodes[i]) && textOf(nodes[i])) return nodes[i]
    }
    return null
  }

  // A copy of a live FAQ item carries the accordion state and generated IDs of
  // its source; clear them so the accordion can register it as a new card.
  function faqItemFrom(source, def) {
    var item = source.cloneNode(true)
    item.setAttribute(FAQ_MARK, def.key)
    var nodes = [item].concat(Array.prototype.slice.call(item.querySelectorAll('*')))
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i].classList) nodes[i].classList.remove('is-active')
    }
    var button = firstWith(item, 'data-accordion', 'toggle-button')
    var content = firstWith(item, 'data-accordion', 'content-wrap')
    var answer = firstWith(item, FAQ_ANCHOR, FAQ_ANCHOR_VALUE)
    var question = button ? firstTextLeaf(button) : null
    if (!button || !content || !answer || !question) return null
    question.textContent = def.question
    button.setAttribute('aria-expanded', 'false')
    button.removeAttribute('id')
    button.removeAttribute('aria-controls')
    content.removeAttribute('id')
    content.removeAttribute('aria-labelledby')
    if (content.style) {
      content.style.display = 'none'
      content.style.height = ''
    }
    answer.removeAttribute(FAQ_ANCHOR)
    answer.textContent = def.answer
    return { item: item, card: firstWith(item, 'data-accordion', 'component'), button: button, content: content }
  }

  function addFaqItems(doc) {
    var count = 0
    var anchors = doc.querySelectorAll('[' + FAQ_ANCHOR + '="' + FAQ_ANCHOR_VALUE + '"]')
    for (var a = 0; a < anchors.length; a += 1) {
      if (closestWith(anchors[a], FAQ_MARK)) continue
      var source = closestWith(anchors[a], 'role', 'listitem')
      var list = source && source.parentNode
      if (!list || firstWith(list, FAQ_MARK)) continue
      var wrapper = closestWith(source, 'data-accordion', 'wrapper')
      var accordions = globalObject.StarterAccordions
      var group =
        wrapper && wrapper.getAttribute('data-script-initialized') === 'true' && accordions && typeof accordions.group === 'function'
          ? accordions.group({ closeOnSecondClick: wrapper.getAttribute('data-close-on-second-click') === 'true' })
          : null
      var after = source
      for (var f = 0; f < FAQ_ITEMS.length; f += 1) {
        var made = faqItemFrom(source, FAQ_ITEMS[f])
        if (!made) break
        list.insertBefore(made.item, after.nextSibling)
        after = made.item
        if (group && made.card) group.register(made.card, made.button, made.content)
        count += 1
      }
    }
    return count
  }

  function removeFaqItems(doc) {
    var nodes = doc.querySelectorAll('[' + FAQ_MARK + ']')
    var count = 0
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i].parentNode) {
        nodes[i].parentNode.removeChild(nodes[i])
        count += 1
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
    result.labels += preview ? addFaqItems(doc) : removeFaqItems(doc)
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
