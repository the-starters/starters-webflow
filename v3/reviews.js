/**
 * V3 reviews page integration.
 *
 * @release v1.59.433
 *
 * Designer owns the public Reviews section. This module only:
 *   - derives the public-profile slug from /hire/{slug} and configures the
 *     authored Reviews section as a wf-xano wrapper before it loads;
 *   - hides that section, and clears its authored placeholder cards while
 *     preserving a wf-xano template, at configuration time, so the section is
 *     revealed only once Xano has positively reported an approved review;
 *   - projects Xano's approved aggregate into the authored profile summary;
 *   - renders sanitized cards from Xano's approved response ONLY while the
 *     authored list ships no wf-xano template. Once Designer publishes a
 *     template card, wf-xano binds it and this module stops rendering.
 *
 * The section is hidden-by-default on purpose. The authored Designer section
 * ships visible and pre-populated with placeholder "Verified Review" cards, so
 * waiting for the approved response before hiding it published fabricated
 * reviews for the length of that request, and published them permanently
 * whenever the request failed. Absence of a positive approved result is
 * therefore treated as "no reviews", never as "keep showing what Designer
 * authored".
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
  var TEMPLATE_SELECTOR = '[wf-xano-element="template"]'

  /**
   * Designer-owned card mode. When the authored list ships a real wf-xano
   * template, wf-xano binds that card and this module stops rendering: it keeps
   * the slug parameter, the aggregate projection, and the section visibility.
   * Until that template is published the legacy renderer stays in charge, so
   * the release can ship before the Designer change without an empty window.
   */
  function designerTemplate(list) {
    if (!list || typeof list.querySelector !== 'function') return null
    return list.querySelector(TEMPLATE_SELECTOR)
  }

  /**
   * Clears the authored placeholder cards while preserving the Designer
   * template. Emptying the whole list would delete the very card wf-xano needs
   * to clone.
   */
  function emptyListExceptTemplate(list) {
    if (!list) return
    var template = designerTemplate(list)
    if (!template) {
      emptyElement(list)
      return
    }
    var retainedChild = template
    while (retainedChild && retainedChild.parentNode !== list) {
      retainedChild = retainedChild.parentNode
    }
    if (!retainedChild) {
      emptyElement(list)
      return
    }
    Array.prototype.slice.call(list.childNodes).forEach(function (node) {
      if (node !== retainedChild) list.removeChild(node)
    })
  }

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

  function setElementVisible(element, visible) {
    if (!element || !element.style) return
    element.hidden = !visible
    element.style.display = visible ? '' : 'none'
    // Module-owned marker. `data-starters-section-hidden` belongs to
    // hide-empty-sections.js, whose contract stores the pre-hide inline
    // display in the attribute value — sharing it would make that engine
    // treat this module's hides as its own the day Designer re-enables it.
    if (visible) element.removeAttribute('data-reviews-v3-hidden')
    else element.setAttribute('data-reviews-v3-hidden', '')
  }

  function emptyElement(element) {
    if (!element) return
    if (element.replaceChildren) element.replaceChildren()
    else element.textContent = ''
  }

  /**
   * The profile tab bar tags each tab with the key of the section it reveals,
   * using the shared hide-when-empty contract from
   * `utils/section-custom-toc/hide-empty-sections.js`
   * (`data-hide-when-empty-id="<key>"`). The Reviews section's own key is
   * carried by `data-toc-section`, so the tab is resolved from the page's
   * markup rather than from a hard-coded string.
   *
   * That shared engine cannot do this itself here: the Hire template ships the
   * section's `data-hide-when-empty-section` attribute disabled (prefixed
   * `xdata-`), so the engine finds no section for the `reviews` key and, by its
   * documented fail-safe, leaves the tab visible. Until Designer re-enables it,
   * this module is the only writer for the pair. If it is ever re-enabled, make
   * that engine the sole owner rather than running both.
   */
  function sectionTabs(documentObject, root) {
    if (!documentObject || !documentObject.querySelectorAll || !root || !root.getAttribute) return []
    var key = root.getAttribute('data-toc-section')
    if (!key) return []
    // The key is Designer-authored; a quote or bracket in it would make the
    // selector throw after the section is already hidden, aborting the IIFE.
    try {
      return documentObject.querySelectorAll(
        '[data-hide-when-empty-id="' + key + '"]',
      )
    } catch (_) {
      return []
    }
  }

  /**
   * The Hire template ships the marker twice, nested: the outer `#reviews`
   * wrapper and, inside it, the authored section that actually contains the
   * list. Configuration hides every marker to fail closed, so the reveal has to
   * re-show the whole chain that owns the rendered list. Revealing only the
   * outer one leaves the inner section `display:none`, which collapses the
   * outer to zero height with the rendered cards sealed inside it — the section
   * reads as "no reviews" while the hero reports a count.
   *
   * A marker that owns no list is deliberately not returned: those are the
   * stray duplicates whose placeholders configuration clears, and they must
   * stay hidden.
   */
  function listOwningRoots(documentObject, root) {
    if (!root) return []
    var list = root.querySelector && root.querySelector(PROFILE_LIST)
    var candidates = documentObject && documentObject.querySelectorAll
      ? documentObject.querySelectorAll(PROFILE_ROOT)
      : []
    var owners = []
    Array.prototype.forEach.call(candidates, function (candidate) {
      if (candidate === root) return
      if (list && candidate.contains && candidate.contains(list)) owners.push(candidate)
    })
    owners.push(root)
    return owners
  }

  /**
   * Single writer for the authored section's visibility, and for the profile
   * tab that points at it. `display` and the `hidden` property are both set:
   * Webflow's published CSS can carry a `display` rule that beats the `hidden`
   * attribute's UA style, and the `hidden` property is what assistive
   * technology reads.
   */
  function setProfileRootVisible(documentObject, root, visible) {
    Array.prototype.forEach.call(listOwningRoots(documentObject, root), function (owner) {
      setElementVisible(owner, visible)
    })
    Array.prototype.forEach.call(sectionTabs(documentObject, root), function (tab) {
      setElementVisible(tab, visible)
    })
  }

  function configureProfileRoot(documentObject, pathname) {
    if (!documentObject || !documentObject.querySelector) return null
    var slug = profileSlug(pathname)
    if (!slug) return null
    var roots = documentObject.querySelectorAll
      ? documentObject.querySelectorAll(PROFILE_ROOT)
      : [documentObject.querySelector(PROFILE_ROOT)].filter(Boolean)
    if (!roots.length) return null
    // Fail closed FIRST, before anything below can bail: hide every authored
    // marker and clear its placeholders while preserving a wf-xano template
    // (the live template has shipped duplicate markers — one left unhandled
    // keeps publishing placeholder cards). Also hide the authored hero summary
    // placeholder, which lives outside the section.
    Array.prototype.forEach.call(roots, function (authoredRoot) {
      var authoredList = authoredRoot.querySelector && authoredRoot.querySelector(PROFILE_LIST)
      if (authoredList) emptyListExceptTemplate(authoredList)
      setProfileRootVisible(documentObject, authoredRoot, false)
    })
    toggleSummaryBlocks(documentObject, false)
    var root = roots[0]
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
    // A Designer-authored template inside the list survives the clear above and
    // is what wf-xano clones. Only the legacy path still needs a placeholder
    // template, and it must be empty so its clones render nothing.
    if (!root.querySelector(TEMPLATE_SELECTOR)) {
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
    emptyElement(target)
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

      /*
       * Two card shapes share this list. A brand-verified review carries a
       * `brand` object; a legacy testimonial carries `verified: false` and a
       * denormalized `reviewer` object instead, because it has no Brand actor.
       * Only a verified review may show the check badge — putting it on a
       * testimonial asserts a verification that never happened. Payloads
       * predating the `verified` flag are treated as verified so older
       * responses render exactly as before.
       */
      var isVerified = !(review && review.verified === false)
      var badge = documentObject.createElement('div')
      badge.className = isVerified
        ? 'profile-review-v3_badge'
        : 'profile-review-v3_badge profile-review-v3_badge-testimonial'
      badge.style.cssText = isVerified
        ? 'display:inline-flex;align-items:center;gap:8px;padding:7px 10px;border-radius:3px;background:#445046;color:#fff;font-size:12px;line-height:1;white-space:nowrap;'
        : 'display:inline-flex;align-items:center;gap:8px;padding:7px 10px;border-radius:3px;background:#eceee9;color:#445046;font-size:12px;line-height:1;white-space:nowrap;'
      appendTextElement(
        documentObject,
        badge,
        'span',
        'profile-review-v3_badge-text',
        isVerified ? 'Verified Review' : 'Testimonial',
      )
      if (isVerified) {
        var check = appendIcon(documentObject, badge, 'check-lg', '')
        check.style.filter = 'brightness(0) invert(1)'
      }
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
      var reviewerInfo = review && review.reviewer
      var reviewerName =
        (reviewerInfo && reviewerInfo.display_name) ||
        (review && review.brand && (review.brand.full_name || review.brand.company_name)) ||
        (isVerified ? 'Verified reviewer' : 'Client')
      var companyName =
        (reviewerInfo && reviewerInfo.company_name) ||
        (review && review.brand && review.brand.company_name) ||
        ''
      var reviewerTitle = (reviewerInfo && reviewerInfo.title) || ''
      var name = appendTextElement(
        documentObject,
        reviewer,
        'div',
        'profile-review-v3_reviewer-name',
        reviewerName,
      )
      name.style.cssText = 'font-size:14px;font-weight:600;line-height:1.3;'
      var context
      if (isVerified) {
        context = companyName && companyName !== reviewerName ? 'Verified brand @ ' + companyName : 'Verified brand'
      } else {
        var atCompany = companyName && companyName !== reviewerName ? '@ ' + companyName : ''
        context = [reviewerTitle, atCompany].filter(Boolean).join(' ') || 'Client testimonial'
      }
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

  function summaryBlock(element) {
    if (!element || typeof element.closest !== 'function') return null
    // The authored hero row that wraps the summary spans. An explicit
    // data attribute wins; the published hero class is the live fallback.
    return element.closest('[data-reviews-v3-summary-block], .profile-hero_card-progress')
  }

  function toggleSummaryBlocks(documentObject, visible) {
    if (!documentObject || !documentObject.querySelectorAll) return
    Array.prototype.forEach.call(
      documentObject.querySelectorAll('[data-reviews-v3-summary-average], #rating'),
      function (element) {
        var block = summaryBlock(element)
        if (!block) return
        block.hidden = !visible
        block.style.display = visible ? '' : 'none'
      },
    )
  }

  function paintProfile(documentObject, root, result) {
    if (!configuredProfileList(documentObject, root) || !result) return false
    var response = profileResponse(result)
    var items = response.items
    var count = response.count
    var average = response.average
    var averageText = Number.isFinite(average) && count > 0
      ? average.toFixed(1)
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
    toggleSummaryBlocks(documentObject, count > 0)
    // wf-xano owns the cards whenever the Designer template is present.
    if (!designerTemplate(configuredProfileList(documentObject, root))) {
      renderProfileReviews(documentObject, root, items)
    }

    setProfileRootVisible(documentObject, root, items.length > 0)
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
    release: 'v1.59.433',
    profileSlug: profileSlug,
    configureProfileRoot: configureProfileRoot,
    paintProfile: paintProfile,
    renderProfileReviews: renderProfileReviews,
    designerTemplate: designerTemplate,
    emptyListExceptTemplate: emptyListExceptTemplate,
    wireInstances: wireInstances,
  }
  global.StartersReviewsV3 = api

  var documentObject = global.document
  if (!documentObject) return
  var configuredProfileRoot = configureProfileRoot(documentObject, global.location && global.location.pathname)

  var queued = global.WfXano || []
  global.WfXano = queued
  // Site-level wf-xano can finish booting before this page-level loader runs.
  // In that order it has already skipped the not-yet-configured Reviews
  // wrapper. Re-run initialization for only this root after configuration and
  // template preservation or fallback creation; init() is idempotent for roots
  // that were already initialized.
  if (configuredProfileRoot && queued && typeof queued.init === 'function') {
    queued.init(configuredProfileRoot)
  }
  if (configuredProfileRoot && queued && typeof queued.push === 'function') {
    queued.push(function (wfx) {
      wireInstances(wfx, documentObject, configuredProfileRoot)
    })
  }
})(typeof window !== 'undefined' ? window : null)
