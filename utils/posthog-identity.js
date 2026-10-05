/**
 * posthog-identity.js — Memberstack → PostHog identity bridge.
 *
 * Load site-wide with `defer`, on any page where the PostHog snippet is in the
 * <head>. The snippet's stub queues calls until array.js arrives, so this can
 * run before PostHog finishes loading.
 *
 * Logged in:  posthog.identify(<memberstack id>) with persona labels derived
 *             from the active Memberstack plan connection, or for older
 *             members from the brands-dashboard-url / freelancer-dashboard-url
 *             custom fields (a member can be both). No email/name: account ids
 *             + capability labels only.
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

  // Same plan map as v3/hire-profile.js. V3 members get their role from the
  // plan connection; the dashboard-url custom fields were written by a V2 Make
  // signup scenario and only exist on older members.
  const PLAN_PERSONA = {
    'pln_free-plan-f6kn0dxz': 'brand',
    'pln_new-paid-plan-463h04ph': 'brand',
    'pln_dorxata-test-brand-plan-777r02pa': 'brand',
    'pln_dorxata-test-free-plan-dvcg0k8o': 'freelancer',
  }

  function activePlanPersonas(member) {
    const connections = Array.isArray(member && member.planConnections) ? member.planConnections : []
    return connections
      .filter((c) => c && (c.active === true || c.status === 'ACTIVE'))
      .map((c) => PLAN_PERSONA[c.planId])
  }

  function personaOf(member) {
    const cf = (member && member.customFields) || {}
    const plans = activePlanPersonas(member)
    const brand = Boolean(cf['brands-dashboard-url']) || plans.includes('brand')
    const freelancer = Boolean(cf['freelancer-dashboard-url']) || plans.includes('freelancer')
    return {
      brand,
      freelancer,
      label: brand && freelancer ? 'both' : brand ? 'brand' : freelancer ? 'freelancer' : 'none',
    }
  }

  async function run() {
    const posthog = window.posthog
    if (!posthog || typeof posthog.identify !== 'function') return

    let member = null
    try {
      if (window.memberReady && typeof window.memberReady.then === 'function') {
        member = await window.memberReady
      }
      if (!member || !member.id) {
        const memberstack = await waitForMemberstackDom()
        if (!memberstack) return // page without Memberstack — leave visitor anonymous
        const res = await memberstack.getCurrentMember()
        member = res && res.data
      }
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
