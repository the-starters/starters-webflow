/**
 * posthog-track.js — shared funnel-event helper.
 *
 * Load site-wide with `defer` after the PostHog head snippet. Page scripts
 * call `StartersTrack.track(name, props)` instead of posthog.capture directly
 * so every event carries a consistent `platform` property ("v2" | "v3") and a
 * missing/blocked PostHog can never break page logic.
 *
 * Event names and properties are defined in
 * platform-ops/architecture/posthog-funnel-events-plan.md — additions are
 * fine, renames need a migration note there.
 */
(function () {
  'use strict'

  function platform() {
    if (window.STARTERS_PLATFORM) return String(window.STARTERS_PLATFORM)
    // Exact host match, NOT substring: v2 prod "hirethestarters.com" contains
    // the substring "thestarters.com", so a .includes() check mislabels all v2
    // prod traffic as v3. v3 = the 3.0 staging site or the thestarters.com prod
    // domain; everything else (hirethestarters.com, the-starters.webflow.io) = v2.
    const host = location.host
    if (host.includes('the-starters-3-0') || host === 'thestarters.com' || host === 'www.thestarters.com') {
      return 'v3'
    }
    return 'v2'
  }

  function track(name, props) {
    try {
      const posthog = window.posthog
      if (!posthog || typeof posthog.capture !== 'function') return
      posthog.capture(name, Object.assign({ platform: platform() }, props || {}))
    } catch (e) {
      /* analytics must never break the page */
    }
  }

  window.StartersTrack = window.StartersTrack || { track }
})()
