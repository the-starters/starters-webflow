/* explore-search-hide-empty.js — hide wrappers whose Algolia sections are empty.
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with defer. Standalone:
 * no imports, no shared globals with the sibling explore-search-*.js embeds.
 *
 * Attribute contract: any element marked [starters-algolia-hide="true"] is a
 * "wrapper". It gets the class starters-algolia-hidden (display:none
 * !important, injected below) whenever every [wf-algolia-element="section"]
 * it contains is empty, and the class is removed as soon as any section shows
 * real hits. A section is "populated" iff its inline style.display !== 'none'
 * AND it has >=1 element child that is not a [wf-algolia-element="template"].
 * Wrappers with no sections at all are left completely alone.
 *
 * Safe to place on Webflow tab panels: this script never touches inline
 * styles, so the tabs controller keeps full ownership of the panel's inline
 * display (block when active, none when inactive).
 */

(function () {
  'use strict'

  var WRAPPER_SELECTOR = '[starters-algolia-hide="true"]'
  var SECTION_SELECTOR = '[wf-algolia-element="section"]'
  var TEMPLATE_SELECTOR = '[wf-algolia-element="template"]'
  var INITED_ATTR = 'data-hide-empty-inited'
  var HIDDEN_CLASS = 'starters-algolia-hidden'
  var STYLE_ID = 'starters-algolia-hide-empty-style'

  // One stylesheet for the hidden class. !important so it beats both the
  // tabs controller's inline display:block and any Webflow class styles.
  // Id-guarded so double script inclusion doesn't inject twice.
  var injectStylesheet = function () {
    if (document.getElementById(STYLE_ID)) return
    var style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = '.' + HIDDEN_CLASS + ' { display: none !important; }'
    document.head.appendChild(style)
  }

  // A section is populated iff the engine hasn't inline-hidden it AND it holds
  // at least one real hit child. Hidden templates and comment/text nodes never
  // count — only element children that aren't [wf-algolia-element="template"].
  var isSectionPopulated = function (section) {
    if (section.style.display === 'none') return false
    var kids = section.children
    for (var i = 0; i < kids.length; i++) {
      if (!kids[i].matches(TEMPLATE_SELECTOR)) return true
    }
    return false
  }

  // Empty iff no descendant section is populated. Callers guarantee there is
  // at least one section before asking (no-sections wrappers bail earlier).
  var isWrapperEmpty = function (sections) {
    for (var i = 0; i < sections.length; i++) {
      if (isSectionPopulated(sections[i])) return false
    }
    return true
  }

  var evaluate = function (wrapper) {
    var sections = wrapper.querySelectorAll(SECTION_SELECTOR)

    // No sections to judge by — never touch this wrapper.
    if (sections.length === 0) return

    // Class-based hiding only — never the wrapper's inline display. The inline
    // channel stays 100% owned by the page's tabs controller (it writes
    // display:block/none on panels at every tab switch); our !important class
    // wins only while empty, and removing it hands visibility straight back to
    // whatever inline value the tabs controller last wrote (block if active,
    // none if inactive). Touching inline display here would un-hide inactive
    // populated panels and render two tabs at once.
    if (isWrapperEmpty(sections)) {
      wrapper.classList.add(HIDDEN_CLASS)
    } else {
      wrapper.classList.remove(HIDDEN_CLASS)
    }
  }

  var wire = function (wrapper) {
    if (wrapper.getAttribute(INITED_ATTR) === 'true') return
    wrapper.setAttribute(INITED_ATTR, 'true')

    evaluate(wrapper) // initial pass — hides idle-state wrappers on load

    // Hits arrive/leave via childList (engine + default-results clones), the
    // engine flips display via the style attribute, and nested changes bubble
    // through subtree. Loop guard comes for free: our writes mutate the
    // `class` attribute, and the filter below is ['style'] only, so our own
    // writes never re-fire the observer. Do NOT add 'class' to the filter.
    var obs = new MutationObserver(function () { evaluate(wrapper) })
    obs.observe(wrapper, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style']
    })
  }

  var init = function () {
    injectStylesheet()
    var wrappers = document.querySelectorAll(WRAPPER_SELECTOR)
    for (var i = 0; i < wrappers.length; i++) wire(wrappers[i])
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
