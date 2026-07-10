// Docs: https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/custom-algolia-scripts/scroll-filter

(function () {
  'use strict'

  var GROUP_SEL = '[starters-algolia-scroll-on-select="true"]'
  var LIST_SEL = '[starters-algolia-scroll-list]'

  function prefersReducedMotion () {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  // Reset the group's marked list to the top (no-op if already there or not found).
  function scrollListToTop (group) {
    var list = group.querySelector(LIST_SEL)
    if (!list || list.scrollTop <= 0) return
    list.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }

  function handleChange (e) {
    var input = e.target
    if (!input || input.tagName !== 'INPUT') return

    var group = input.closest(GROUP_SEL) // only opted-in groups match
    if (!group) return

    // Run after WF-Algolia re-renders/re-sorts the list.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        scrollListToTop(group)
      })
    })
  }

  function init () {
    document.addEventListener('change', handleChange)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()