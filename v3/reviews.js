/**
 * V3 reviews page integration.
 *
 * Designer owns every review form control and the public Reviews section. This module only:
 *   - binds the authored Brand review form to one canonical project result and
 *     blocks submission when no valid positive numeric project ID is available;
 *   - supplies a fresh idempotency key immediately before an authored review
 *     form is submitted;
 *   - derives the public-profile slug from /hire/{slug} and configures the
 *     authored or adopted Reviews section as a wf-xano wrapper before it loads;
 *   - projects Xano's approved aggregate into the authored profile summary;
 *   - replaces the legacy CMS projection inside the existing or behavior-only
 *     Reviews list target with sanitized cards from Xano's approved response.
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
  var PROFILE_ROOT_FALLBACK = [
    '.profile-content_reviews',
    '.profile-content_reviews_wr',
    '.profile-content_reviews_wrap',
    '[data-toc-element="section"][data-toc-id="reviews"]',
  ].join(', ')
  var PROFILE_LIST_FALLBACK = [
    '.profile-content_reviews_list',
    '.profile-content_reviews_list-wrap',
    '.profile-content_reviews_collection-list',
    '.w-dyn-items',
  ].join(', ')
  var REVIEW_FORM = 'form[data-review-form-v3]'
  var REVIEW_KEY = '[wf-xano-field="idempotency_key"]'

  function canonicalProjectId(value) {
    var projectId = String(value == null ? '' : value).trim()
    return /^\d+$/.test(projectId) && Number(projectId) > 0 ? projectId : ''
  }

  function projectItemsFromResult(result) {
    if (!result || typeof result !== 'object') return null
    if (Array.isArray(result.items)) return result.items
    if (result.raw && Array.isArray(result.raw.items)) return result.raw.items
    if (Array.isArray(result.raw)) return result.raw
    return null
  }

  function projectIdFromResult(result) {
    var items = projectItemsFromResult(result)
    if (!items || items.length !== 1) return ''
    var project = items[0]
    if (!project || typeof project !== 'object') return ''
    return canonicalProjectId(project.project_id || project.id)
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

  function findProfileRoot(documentObject) {
    var root = documentObject.querySelector(PROFILE_ROOT) ||
      documentObject.querySelector(PROFILE_ROOT_FALLBACK)
    if (root) return root

    var headings = documentObject.querySelectorAll
      ? documentObject.querySelectorAll('h1, h2, h3, h4, h5, h6')
      : []
    for (var headingIndex = 0; headingIndex < headings.length; headingIndex += 1) {
      var heading = headings[headingIndex]
      if (String(heading.textContent || '').trim().toLowerCase() !== 'reviews') continue
      var candidate = heading.parentElement
      for (var depth = 0; candidate && depth < 7; depth += 1) {
        if (
          candidate.querySelector &&
          candidate.querySelector(PROFILE_LIST_FALLBACK + ', .profile-content_reviews_list_item, .w-dyn-list')
        ) return candidate
        candidate = candidate.parentElement
      }
    }
    return null
  }

  function findProfileList(documentObject, root) {
    if (!root) return null
    return (root.querySelector && root.querySelector(PROFILE_LIST)) ||
      (root.querySelector && root.querySelector(PROFILE_LIST_FALLBACK)) ||
      null
  }

  function configureProfileRoot(documentObject, pathname) {
    if (!documentObject || !documentObject.querySelector) return null
    var slug = profileSlug(pathname)
    if (!slug) return null
    var root = findProfileRoot(documentObject)
    if (!root) return null
    var list = findProfileList(documentObject, root)
    if (!list) {
      list = documentObject.createElement('div')
      list.className = 'profile-content_reviews_list'
      root.appendChild(list)
    }
    root.setAttribute('data-reviews-v3', '')
    root.setAttribute('wf-xano-element', 'wrapper')
    root.setAttribute('wf-xano-instance', PROFILE_INSTANCE)
    root.setAttribute('wf-xano-source', 'opp30:starter/reviews/summary')
    root.setAttribute('wf-xano-method', 'GET')
    root.setAttribute('wf-xano-auth', 'none')
    root.setAttribute('wf-xano-param-starter_slug', slug)
    list.setAttribute('data-reviews-v3-list', '')
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
      if ((!projectInput || !canonicalProjectId(projectInput.value)) && bindReviewFormToSingleProject(documentObject)) {
        projectInput = form.querySelector('[wf-xano-field="project_id"]')
      }
      var projectId = canonicalProjectId(projectInput && projectInput.value)
      if (!projectId) {
        keyInput.value = ''
        keyInput.setAttribute('value', '')
        if (event.preventDefault) event.preventDefault()
        if (event.stopImmediatePropagation) event.stopImmediatePropagation()
        return
      }
      projectInput.value = projectId
      projectInput.setAttribute('value', projectId)
      keyInput.value = createIdempotencyKey(projectId, cryptoObject)
      keyInput.setAttribute('value', keyInput.value)
    }, true)
  }

  function bindReviewFormToSingleProject(documentObject, result) {
    if (!documentObject || !documentObject.querySelector || !documentObject.querySelectorAll) return false
    var form = documentObject.querySelector(REVIEW_FORM)
    if (!form) return false
    var projectInput = form.querySelector('[wf-xano-field="project_id"]')
    if (!projectInput) return false
    var projectId = projectIdFromResult(result)
    if (!projectId && !result) {
      var projectRoot = documentObject.querySelector('[wf-xano-instance="' + BRAND_INSTANCE + '"]')
      var projectItems = (projectRoot || documentObject).querySelectorAll('.project_item[data-wf-xano-id]')
      if (projectItems && projectItems.length === 1) {
        projectId = canonicalProjectId(projectItems[0].getAttribute('data-wf-xano-id'))
      }
    }
    if (!projectId) {
      projectInput.value = ''
      projectInput.setAttribute('value', '')
      return false
    }
    projectInput.value = projectId
    projectInput.setAttribute('value', projectId)

    var component = form.closest && form.closest('.review-v3_component')
    var intro = component && component.querySelector && component.querySelector('.review-v3_intro')
    if (intro) intro.textContent = 'Share your experience after completing this project. Your review will appear on the Starter profile after submission.'
    return true
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
      brandProjects.on('results', function (result) {
        bindReviewFormToSingleProject(documentObject, result)
      })
      brandProjects.on('formSuccess', function (event) {
        if (!event || String(event.form || '') !== 'project-review') return
        if (typeof global.CustomEvent === 'function') {
          documentObject.dispatchEvent(new global.CustomEvent('starters:review-submitted', {
            detail: { form: event.form },
          }))
        }
      })
      if (brandProjects._lastResult) bindReviewFormToSingleProject(documentObject, brandProjects._lastResult)
    }
  }

  var api = {
    profileSlug: profileSlug,
    createIdempotencyKey: createIdempotencyKey,
    projectIdFromResult: projectIdFromResult,
    findProfileRoot: findProfileRoot,
    findProfileList: findProfileList,
    configureProfileRoot: configureProfileRoot,
    installReviewFormKeys: installReviewFormKeys,
    bindReviewFormToSingleProject: bindReviewFormToSingleProject,
    paintProfile: paintProfile,
    renderProfileReviews: renderProfileReviews,
    wireInstances: wireInstances,
  }
  global.StartersReviewsV3 = api

  var documentObject = global.document
  if (!documentObject) return
  var configuredProfileRoot = configureProfileRoot(documentObject, global.location && global.location.pathname)
  bindReviewFormToSingleProject(documentObject)
  installReviewFormKeys(documentObject, global.crypto)

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
  if (queued && typeof queued.push === 'function') {
    queued.push(function (wfx) {
      wireInstances(wfx, documentObject)
    })
  }
})(typeof window !== 'undefined' ? window : null)
