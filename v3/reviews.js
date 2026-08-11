/**
 * V3 reviews page integration.
 *
 * Designer owns the public Reviews section. This module only:
 *   - derives the public-profile slug from /hire/{slug} and configures the
 *     authored Reviews section as a wf-xano wrapper before it loads;
 *   - projects Xano's approved aggregate into the authored profile summary;
 *   - replaces the legacy CMS projection inside the attributed Reviews list
 *     target with sanitized cards from Xano's approved response.
 *
 * Xano remains authoritative for identity, project completion, one-review
 * enforcement, moderation, points, reversals, aggregates, and ranking.
 */
;(function (global) {
  'use strict'

  if (!global || global.__startersV3ReviewsBooted) return
  global.__startersV3ReviewsBooted = true

  var PROFILE_INSTANCE = 'starter-reviews'
  var PROFILE_ROOT = '[data-reviews-v3="profile"]'
  var PROFILE_LIST = '[data-reviews-v3-list="reviews"]'

  function configuredProfileList(documentObject, root) {
    if (!documentObject || !documentObject.querySelector || !root || !root.querySelector) return null
    if (documentObject.querySelector(PROFILE_ROOT) !== root) return null
    return root.querySelector(PROFILE_LIST)
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

  function configureProfileRoot(documentObject, pathname) {
    if (!documentObject || !documentObject.querySelector) return null
    var slug = profileSlug(pathname)
    if (!slug) return null
    var root = documentObject.querySelector(PROFILE_ROOT)
    if (!root) return null
    var list = root.querySelector && root.querySelector(PROFILE_LIST)
    if (!list) return null
    root.setAttribute('wf-xano-element', 'wrapper')
    root.setAttribute('wf-xano-instance', PROFILE_INSTANCE)
    root.setAttribute('wf-xano-source', 'opp30:starter/reviews/summary')
    root.setAttribute('wf-xano-method', 'GET')
    root.setAttribute('wf-xano-auth', 'none')
    root.setAttribute('wf-xano-param-starter_slug', slug)
    list.setAttribute('wf-xano-element', 'list')
    list.setAttribute('aria-live', 'polite')
    if (!root.querySelector('[wf-xano-element="template"]')) {
      var template = documentObject.createElement('div')
      template.setAttribute('wf-xano-element', 'template')
      template.setAttribute('aria-hidden', 'true')
      template.hidden = true
      root.appendChild(template)
    }
    return root
  }

  function setTextAll(root, selector, value) {
    Array.prototype.forEach.call(root.querySelectorAll(selector), function (element) {
      element.textContent = value
    })
  }

  function appendTextElement(documentObject, parent, tagName, className, value) {
    var element = documentObject.createElement(tagName)
    if (className) element.className = className
    element.textContent = value == null ? '' : String(value)
    parent.appendChild(element)
    return element
  }

  function appendIcon(documentObject, parent, iconName, label) {
    var icon = documentObject.createElement('img')
    icon.className = 'profile-review-v3_icon'
    icon.src = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/icons/' + iconName + '.svg'
    icon.alt = label || ''
    icon.width = 14
    icon.height = 14
    icon.style.cssText = 'display:block;width:14px;height:14px;flex:0 0 14px;'
    parent.appendChild(icon)
    return icon
  }

  function renderProfileReviews(documentObject, root, items) {
    if (!documentObject || !documentObject.createElement) return false
    var target = configuredProfileList(documentObject, root)
    if (!target) return false
    var approved = Array.isArray(items) ? items : []
    target.replaceChildren()
    target.style.cssText = approved.length
      ? 'display:grid;border:1px solid #d8d9d3;border-radius:3px;overflow:hidden;background:#fff;'
      : ''
    approved.forEach(function (review) {
      var card = documentObject.createElement('article')
      card.className = 'profile-review-v3_item'
      card.style.cssText = 'display:grid;gap:22px;padding:24px;border-bottom:1px solid #d8d9d3;background:#fff;'
      card.setAttribute('data-review-id', String(review && review.review_id || ''))

      var heading = documentObject.createElement('div')
      heading.className = 'profile-review-v3_card-head'
      heading.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;'

      var stars = documentObject.createElement('div')
      stars.className = 'profile-review-v3_stars'
      var roundedRating = Math.max(0, Math.min(5, Math.round(Number(review && review.rating) || 0)))
      stars.setAttribute('role', 'img')
      stars.setAttribute('aria-label', String(roundedRating) + ' out of 5 stars')
      stars.style.cssText = 'display:flex;align-items:center;gap:2px;'
      for (var starIndex = 1; starIndex <= 5; starIndex += 1) {
        appendIcon(documentObject, stars, starIndex <= roundedRating ? 'star-fill' : 'star', '')
      }
      heading.appendChild(stars)

      var badge = documentObject.createElement('div')
      badge.className = 'profile-review-v3_badge'
      badge.style.cssText = 'display:inline-flex;align-items:center;gap:8px;padding:7px 10px;border-radius:3px;background:#445046;color:#fff;font-size:12px;line-height:1;white-space:nowrap;'
      appendTextElement(documentObject, badge, 'span', 'profile-review-v3_badge-text', 'Verified Review')
      var check = appendIcon(documentObject, badge, 'check-lg', '')
      check.style.filter = 'brightness(0) invert(1)'
      heading.appendChild(badge)
      card.appendChild(heading)

      var reviewText = appendTextElement(
        documentObject,
        card,
        'p',
        'profile-review-v3_text',
        review && review.review_text || '',
      )
      reviewText.style.cssText = 'margin:0;color:#222;font-size:16px;line-height:1.55;'

      var reviewer = documentObject.createElement('div')
      reviewer.className = 'profile-review-v3_reviewer'
      reviewer.style.cssText = 'display:grid;gap:3px;'
      var reviewerName = review && review.brand && (review.brand.full_name || review.brand.company_name) || 'Verified reviewer'
      var companyName = review && review.brand && review.brand.company_name || ''
      var name = appendTextElement(
        documentObject,
        reviewer,
        'div',
        'profile-review-v3_reviewer-name',
        reviewerName,
      )
      name.style.cssText = 'font-size:14px;font-weight:600;line-height:1.3;'
      var context = companyName && companyName !== reviewerName ? 'Verified brand @ ' + companyName : 'Verified brand'
      var meta = appendTextElement(documentObject, reviewer, 'div', 'profile-review-v3_reviewer-meta', context)
      meta.style.cssText = 'color:#444;font-size:12px;line-height:1.35;'
      card.appendChild(reviewer)
      target.appendChild(card)
    })
    if (target.childNodes && target.childNodes.length) {
      target.childNodes[target.childNodes.length - 1].style.borderBottom = '0'
    }
    return true
  }

  function firstFiniteValue(source, keys) {
    if (!source || typeof source !== 'object') return null
    for (var index = 0; index < keys.length; index += 1) {
      var candidate = source[keys[index]]
      if (candidate === null || candidate === undefined || candidate === '') continue
      var value = Number(candidate)
      if (Number.isFinite(value)) return value
    }
    return null
  }

  function profileResponse(result) {
    var raw = result.raw && typeof result.raw === 'object' && !Array.isArray(result.raw)
      ? result.raw
      : null
    var items = raw && Array.isArray(raw.reviews)
      ? raw.reviews
      : (raw && Array.isArray(raw.items)
        ? raw.items
        : (Array.isArray(result.items) ? result.items : []))
    var aggregate = raw && raw.aggregate && typeof raw.aggregate === 'object'
      ? raw.aggregate
      : (raw && raw.aggregates && typeof raw.aggregates === 'object'
        ? raw.aggregates
        : raw)
    var count = firstFiniteValue(aggregate, ['review_count', 'approved_review_count', 'count', 'itemsTotal'])
    var average = firstFiniteValue(aggregate, ['average_rating', 'rating_average', 'average'])

    return {
      items: items,
      count: count !== null && count >= 0 ? Math.floor(count) : 0,
      average: average !== null && average >= 0 ? average : 0,
    }
  }

  function paintProfile(documentObject, root, result) {
    if (!configuredProfileList(documentObject, root) || !result) return false
    var response = profileResponse(result)
    var items = response.items
    var count = response.count
    var average = response.average
    var averageText = Number.isFinite(average) && count > 0
      ? average.toFixed(average % 1 === 0 ? 0 : 1)
      : '0'

    setTextAll(root, '[data-reviews-v3-average]', averageText)
    setTextAll(
      root,
      '[data-reviews-v3-count]',
      String(count),
    )
    // The profile summary is outside the authored Reviews section. Explicit
    // data attributes are canonical; the existing #rating pair is retained as
    // a compatibility target until Designer wiring is published.
    setTextAll(documentObject, '[data-reviews-v3-summary-average], #rating', averageText)
    setTextAll(documentObject, '[data-reviews-v3-summary-count], #rating + span', String(count))
    renderProfileReviews(documentObject, root, items)

    root.hidden = items.length === 0
    root.style.display = items.length > 0 ? '' : 'none'
    if (items.length > 0) root.removeAttribute('data-starters-section-hidden')
    else root.setAttribute('data-starters-section-hidden', '')
    return true
  }

  function wireInstances(wfx, documentObject, root) {
    if (!wfx || typeof wfx.get !== 'function' || !configuredProfileList(documentObject, root)) return
    var profile = wfx.get(PROFILE_INSTANCE)
    if (profile && typeof profile.on === 'function' && !profile.__reviewsV3Wired) {
      profile.__reviewsV3Wired = true
      profile.on('results', function (result) {
        paintProfile(documentObject, root, result)
      })
      if (profile._lastResult) paintProfile(documentObject, root, profile._lastResult)
    }
  }

  var api = {
    profileSlug: profileSlug,
    configureProfileRoot: configureProfileRoot,
    paintProfile: paintProfile,
    renderProfileReviews: renderProfileReviews,
    wireInstances: wireInstances,
  }
  global.StartersReviewsV3 = api

  var documentObject = global.document
  if (!documentObject) return
  var configuredProfileRoot = configureProfileRoot(documentObject, global.location && global.location.pathname)

  var queued = global.WfXano || []
  global.WfXano = queued
  // Site-level wf-xano can finish booting before this page-level loader runs.
  // In that order it has already skipped the Reviews wrapper because the
  // authored template did not exist yet. Re-run initialization for only this
  // configured root after supplying the hidden template; init() is idempotent
  // for roots that were already initialized.
  if (configuredProfileRoot && queued && typeof queued.init === 'function') {
    queued.init(configuredProfileRoot)
  }
  if (configuredProfileRoot && queued && typeof queued.push === 'function') {
    queued.push(function (wfx) {
      wireInstances(wfx, documentObject, configuredProfileRoot)
    })
  }
})(typeof window !== 'undefined' ? window : null)
