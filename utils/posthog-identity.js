/**
 * posthog-identity.js — Memberstack → PostHog identity bridge.
 *
 * Load site-wide with `defer`, on any page where the PostHog snippet is in the
 * <head>. The snippet's stub queues calls until array.js arrives, so this can
 * run before PostHog finishes loading.
 *
 * Logged in:  posthog.identify(<memberstack id>) with persona labels derived
 *             from the same customFields opportunities-3.0.js gates on
 *             (brands-dashboard-url / freelancer-dashboard-url — a member can
 *             be both). No email/name: account ids + capability labels only.
 * Logged out: posthog.reset() if the previous identity was a member id, so a
 *             shared browser doesn't chain new anonymous events to the old
 *             member. Anonymous visitors are otherwise untouched.
 */
(function () {
  'use strict'

  function waitForMemberstackDom(timeoutMs = 10000) {
    if (window.$memberstackDom && typeof window.$memberstackDom.getCurrentMember === 'function') {
      return Promise.resolve(window.$memberstackDom)
    }
    return new Promise((resolve) => {
      const startedAt = Date.now()
      const timer = setInterval(() => {
        if (window.$memberstackDom && typeof window.$memberstackDom.getCurrentMember === 'function') {
          clearInterval(timer)
          resolve(window.$memberstackDom)
        } else if (Date.now() - startedAt > timeoutMs) {
          clearInterval(timer)
          resolve(null)
        }
      }, 100)
    })
  }

  function personaOf(member) {
    const cf = (member && member.customFields) || {}
    const brand = Boolean(cf['brands-dashboard-url'])
    const freelancer = Boolean(cf['freelancer-dashboard-url'])
    return {
      brand,
      freelancer,
      label: brand && freelancer ? 'both' : brand ? 'brand' : freelancer ? 'freelancer' : 'none',
    }
  }

  async function run() {
    const posthog = window.posthog
    if (!posthog || typeof posthog.identify !== 'function') return

    const memberstack = await waitForMemberstackDom()
    if (!memberstack) return // page without Memberstack — leave visitor anonymous

    let member = null
    try {
      const res = await memberstack.getCurrentMember()
      member = res && res.data
    } catch (e) {
      return // Memberstack error — do nothing rather than mis-identify
    }

    if (member && member.id) {
      const persona = personaOf(member)
      posthog.identify(member.id, {
        persona: persona.label,
        persona_brand: persona.brand,
        persona_freelancer: persona.freelancer,
      })
    } else if (typeof posthog.get_distinct_id === 'function' && typeof posthog.reset === 'function') {
      try {
        if (/^mem_/.test(String(posthog.get_distinct_id()))) posthog.reset()
      } catch (e) {
        /* stub not ready for reads yet — next page load will handle it */
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run)
  } else {
    run()
  }
})()
