/**
 * multi-step-failover.js — keeps the build-profile wizards alive if the
 * agency-hosted multi-step engine disappears.
 *
 * The wizard pages (/build-profile/full-profile, /build-profile/consult) load
 * their multi-step form engine from Videsigns' own public GitHub repo:
 *   https://cdn.jsdelivr.net/gh/videsigns/webflow-tools@latest/multi-step.js
 * That tag lives inside an agency code embed (not API-editable), served at
 * @latest from a repo we don't control — it can 404 or change at any time.
 *
 * This script probes that URL after page load; if it is gone/failing, it
 * injects our mirrored copy (vendor/videsigns-multi-step.js) and logs loudly.
 *
 * ⚠ Late injection happens after DOMContentLoaded — whether the engine
 * self-initializes then is unverified (upstream is obfuscated). This failover
 * is a safety net for the outage case, not the endgame: the clean fix is to
 * repoint the script tag inside the agency embed to our mirror and delete
 * this file.
 */
;(function () {
  'use strict'

  if (window.__tsMultiStepFailover) return
  window.__tsMultiStepFailover = true

  const UPSTREAM =
    'https://cdn.jsdelivr.net/gh/videsigns/webflow-tools@latest/multi-step.js'
  const MIRROR =
    'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/vendor/videsigns-multi-step.js'

  function inject(reason) {
    console.warn('[ms-failover] multi-step engine unavailable (' + reason + ') — loading mirrored copy')
    const s = document.createElement('script')
    s.src = MIRROR
    document.head.appendChild(s)
  }

  function check() {
    // only wizard pages that actually use the engine
    if (!document.querySelector('form[data-form="multistep"]')) return
    // page already repointed to our mirror — nothing to fail over to
    if (document.querySelector('script[src*="vendor/videsigns-multi-step"]')) {
      return console.info('[ms-failover] page uses the mirrored engine — probe skipped')
    }
    const tag = document.querySelector('script[src*="videsigns/webflow-tools"][src*="multi-step"]')
    if (!tag) return inject('script tag removed from page')
    fetch(UPSTREAM, { cache: 'force-cache' })
      .then((res) => {
        if (!res.ok) inject('HTTP ' + res.status)
        else console.info('[ms-failover] upstream multi-step engine OK')
      })
      .catch(() => inject('network error'))
  }

  if (document.readyState === 'complete') check()
  else window.addEventListener('load', () => setTimeout(check, 0))
})()
