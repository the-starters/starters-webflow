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

  function formatReviewDate(value) {
    if (!value) return ''
    var date = new Date(value)
    if (!Number.isFinite(date.getTime())) return ''
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  function renderProfileReviews(documentObject, items) {
    if (!documentObject || !documentObject.querySelector || !documentObject.createElement) return false
    var target = documentObject.querySelector(PROFILE_LIST)
    if (!target) return false
    var approved = Array.isArray(items) ? items : []
    target.replaceChildren()
    approved.forEach(function (review) {
      var card = documentObject.createElement('article')
      card.className = 'profile-review-v3_item'
      card.style.cssText = 'display:grid;gap:10px;padding:24px 0;border-bottom:1px solid #d8d9d3;'
      card.setAttribute('data-review-id', String(review && review.review_id || ''))

      var heading = documentObject.createElement('div')
      heading.className = 'profile-review-v3_card-head'
      heading.style.cssText = 'display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;'
      var brand = appendTextElement(
        documentObject,
        heading,
        'div',
        'profile-review-v3_brand',
        review && review.brand && review.brand.company_name || 'Verified brand',
      )
      brand.style.fontWeight = '600'
      var published = appendTextElement(
        documentObject,
        heading,
        'time',
        'profile-review-v3_date',
        formatReviewDate(review && review.published_at),
      )
      published.style.color = '#66705e'
      card.appendChild(heading)
      var rating = appendTextElement(
        documentObject,
        card,
        'div',
        'profile-review-v3_rating',
        String(Number(review && review.rating) || 0) + ' / 5',
      )
      rating.style.fontWeight = '700'
      appendTextElement(
        documentObject,
        card,
        'p',
        'profile-review-v3_text',
        review && review.review_text || '',
      )
      target.appendChild(card)
    })
    return true
  }

  function paintProfile(documentObject, result) {
    if (!documentObject || !result) return false
    var raw = result.raw && typeof result.raw === 'object' ? result.raw : null
    var items = Array.isArray(result.items)
      ? result.items
      : (raw && Array.isArray(raw.items)
        ? raw.items
        : (raw && Array.isArray(raw.reviews) ? raw.reviews : []))
    var count = items.length
    var ratingTotal = items.reduce(function (total, review) {
      var rating = Number(review && review.rating)
      return total + (Number.isFinite(rating) ? rating : 0)
    }, 0)
    var average = count > 0 ? ratingTotal / count : 0
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
      section.hidden = count === 0
      section.style.display = count > 0 ? '' : 'none'
      if (count > 0) section.removeAttribute('data-starters-section-hidden')
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
