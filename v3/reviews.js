/**
 * V3 reviews page integration.
 *
 * Designer owns every review form control and the public Reviews section. This module only:
 *   - supplies a fresh idempotency key immediately before an authored review
 *     form is submitted;
 *   - derives the public-profile slug from /hire/{slug} and adds it to the
 *     authored wf-xano wrapper before that wrapper loads;
 *   - projects Xano's approved aggregate into the authored profile summary;
 *   - replaces the legacy CMS projection inside the authored Reviews list
 *     target with sanitized cards from Xano's approved review response.
 *
 * Xano remains authoritative for identity, project completion, one-review
 * enforcement, moderation, points, reversals, aggregates, and ranking.
 */
;(function (global) {
  'use strict'

  if (!global || global.__startersV3ReviewsBooted) return
  global.__startersV3ReviewsBooted = true

  var BRAND_INSTANCE = 'dash-brand-projects'
  var PROFILE_INSTANCE = 'starter-reviews'
  var PROFILE_ROOT = '[data-reviews-v3]'
  var PROFILE_LIST = '[data-reviews-v3-list]'
  var REVIEW_FORM = 'form[data-review-form-v3]'
  var REVIEW_KEY = '[wf-xano-field="idempotency_key"]'

  function profileSlug(pathname) {
    var match = String(pathname || '').match(/^\/hire\/([^/?#]+)\/?$/i)
    if (!match) return ''
    try {
      return decodeURIComponent(match[1]).trim()
    } catch (_) {
      return ''
    }
  }

  function randomPart(cryptoObject) {
    if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
      return cryptoObject.randomUUID()
    }
    if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
      var bytes = new Uint32Array(4)
      cryptoObject.getRandomValues(bytes)
      return Array.prototype.map.call(bytes, function (value) {
        return value.toString(16).padStart(8, '0')
      }).join('')
    }
    return String(Math.random()).slice(2) + String(Date.now())
  }

  function createIdempotencyKey(projectId, cryptoObject) {
    var stableProject = String(projectId || '').replace(/[^0-9]/g, '') || 'unknown'
    return 'review-ui:' + stableProject + ':' + randomPart(cryptoObject)
  }

  function configureProfileRoot(documentObject, pathname) {
    if (!documentObject || !documentObject.querySelector) return null
    var root = documentObject.querySelector(PROFILE_ROOT)
    if (!root) return null
    var slug = profileSlug(pathname)
    if (!slug) return null
    root.setAttribute('wf-xano-param-starter_slug', slug)
    return root
  }

  function installReviewFormKeys(documentObject, cryptoObject) {
    if (!documentObject || !documentObject.addEventListener) return
    documentObject.addEventListener('submit', function (event) {
      var form = event.target && event.target.closest
        ? event.target.closest(REVIEW_FORM)
        : null
      if (!form) return
      var keyInput = form.querySelector(REVIEW_KEY)
      var projectInput = form.querySelector('[wf-xano-field="project_id"]')
      if (!keyInput) return
      keyInput.value = createIdempotencyKey(projectInput && projectInput.value, cryptoObject)
      keyInput.setAttribute('value', keyInput.value)
    }, true)
  }

  function setTextAll(documentObject, selector, value) {
    Array.prototype.forEach.call(documentObject.querySelectorAll(selector), function (element) {
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

  function renderProfileReviews(documentObject, items) {
    if (!documentObject || !documentObject.querySelector || !documentObject.createElement) return false
    var target = documentObject.querySelector(PROFILE_LIST)
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

  function paintProfile(documentObject, result) {
    if (!documentObject || !result) return false
    var response = profileResponse(result)
    var items = response.items
    var count = response.count
    var average = response.average
    var averageText = Number.isFinite(average) && count > 0
      ? average.toFixed(average % 1 === 0 ? 0 : 1)
      : '0'

    setTextAll(documentObject, '[data-reviews-v3-average], #rating', averageText)
    setTextAll(
      documentObject,
      '[data-reviews-v3-count], .profile-hero_card-progress [fs-countitems-element="value"]',
      String(count),
    )
    renderProfileReviews(documentObject, items)

    var section = documentObject.querySelector(PROFILE_ROOT)
    if (section) {
      section.hidden = items.length === 0
      section.style.display = items.length > 0 ? '' : 'none'
      if (items.length > 0) section.removeAttribute('data-starters-section-hidden')
      else section.setAttribute('data-starters-section-hidden', '')
    }
    return true
  }

  function wireInstances(wfx, documentObject) {
    if (!wfx || typeof wfx.get !== 'function') return
    var profile = wfx.get(PROFILE_INSTANCE)
    if (profile && typeof profile.on === 'function' && !profile.__reviewsV3Wired) {
      profile.__reviewsV3Wired = true
      profile.on('results', function (result) {
        paintProfile(documentObject, result)
      })
      if (profile._lastResult) paintProfile(documentObject, profile._lastResult)
    }

    var brandProjects = wfx.get(BRAND_INSTANCE)
    if (brandProjects && typeof brandProjects.on === 'function' && !brandProjects.__reviewsV3Wired) {
      brandProjects.__reviewsV3Wired = true
      brandProjects.on('formSuccess', function (event) {
        if (!event || String(event.form || '') !== 'project-review') return
        if (typeof global.CustomEvent === 'function') {
          documentObject.dispatchEvent(new global.CustomEvent('starters:review-submitted', {
            detail: { form: event.form },
          }))
        }
      })
    }
  }

  var api = {
    profileSlug: profileSlug,
    createIdempotencyKey: createIdempotencyKey,
    configureProfileRoot: configureProfileRoot,
    installReviewFormKeys: installReviewFormKeys,
    paintProfile: paintProfile,
    renderProfileReviews: renderProfileReviews,
    wireInstances: wireInstances,
  }
  global.StartersReviewsV3 = api

  var documentObject = global.document
  if (!documentObject) return
  configureProfileRoot(documentObject, global.location && global.location.pathname)
  installReviewFormKeys(documentObject, global.crypto)

  var queued = global.WfXano || []
  global.WfXano = queued
  if (queued && typeof queued.push === 'function') {
    queued.push(function (wfx) {
      wireInstances(wfx, documentObject)
    })
  }
})(typeof window !== 'undefined' ? window : null)
