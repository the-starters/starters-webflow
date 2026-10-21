(function () {
  'use strict'

  // Memberstack navbar gating (paste in Page/Project footer, AFTER the Memberstack script).
  // Two independent gates:
  //   [data-gate='free-anon']  -> shown to anonymous visitors + free members;
  //                               hidden from PAYING members.
  //   [data-hide-if-both]      -> shown ONLY to logged-in members who do NOT own both a free
  //                               and a paid plan; hidden from anonymous visitors and from
  //                               members who own both.
  //
  // Plan detection: a plan connection is treated as PAID when its type is anything other than
  // "FREE" (Memberstack tags free plan connections with type "FREE"); the PAID_PLAN_IDS list is
  // only a belt-and-braces fallback for connections missing a type. FREE_PLAN_IDS lists the known
  // free plan IDs (current + legacy) and, together with a "FREE" type, marks a free connection.
  //
  // State re-applies on login/logout without a refresh via onAuthChange + a delegated logout-click
  // listener + a bfcache (pageshow) guard.
  //
  // Anti-flicker: navbar-links-css.html hides .navbar_link-list
  //   (html:not(.ms-nav-ready) .navbar_link-list { display:none !important })
  // until this script adds .ms-nav-ready to <html>, so gated links never flash before membership
  // resolves. We only reveal after a real gate pass (or after the logged-out fallback runs), never
  // while gated elements are still in their default state.

  const FREE_PLAN_IDS = ["pln_dorxata-test-free-plan-dvcg0k8o", "pln_free-plan-f6kn0dxz"]
  const PAID_PLAN_IDS = ["pln_new-paid-plan-463h04ph"] // fallback only; type check is primary
  const GATE_SELECTOR = "[data-gate='free-anon']"
  const BOTH_HIDE_SELECTOR = "[data-hide-if-both]"
  const LOGOUT_SELECTOR = "[data-ms-action='logout']"

  let safetyTimer = null

  // Derive the two plan flags from a member's connections in one pass.
  // hasPaid: any connection whose type isn't "FREE" (or, when type is missing, whose ID is a
  //          known paid ID). hasFree: any "FREE"-typed connection or known free ID.
  function planFlags(member) {
    const connections = (member && member.planConnections) || []
    let hasPaid = false
    let hasFree = false

    connections.forEach((pc) => {
      const type = pc.type ? String(pc.type).toUpperCase() : ""
      if (type === "FREE" || FREE_PLAN_IDS.includes(pc.planId)) hasFree = true
      if (type) {
        if (type !== "FREE") hasPaid = true
      } else if (PAID_PLAN_IDS.includes(pc.planId)) {
        hasPaid = true
      }
    })

    return { hasPaid, hasFree }
  }

  // Hide free-anon content from paying members; show it to everyone else.
  function applyFreeAnonGate(hasPaid) {
    document.querySelectorAll(GATE_SELECTOR).forEach((el) => {
      el.style.display = hasPaid ? "none" : ""
    })
  }

  // Show hide-if-both content to logged-in members who don't own both a free and a paid plan.
  // Hidden for anonymous visitors (member-only content) and for members who own both.
  function applyBothPlansHide(member, hasFree, hasPaid) {
    const hide = !member || (hasFree && hasPaid)
    document.querySelectorAll(BOTH_HIDE_SELECTOR).forEach((el) => {
      el.style.display = hide ? "none" : ""
    })
  }

  // Drop the anti-flicker hide (see navbar-links-css.html) once gating has run.
  // Idempotent; classList.add no-ops if already present.
  function reveal() {
    document.documentElement.classList.add("ms-nav-ready")
  }

  // Run both gates for the given member (null = logged out), then reveal.
  // Plan flags are computed once here and handed to each gate.
  function applyAll(member) {
    if (safetyTimer) {
      clearTimeout(safetyTimer)
      safetyTimer = null
    }
    const { hasPaid, hasFree } = planFlags(member)
    applyFreeAnonGate(hasPaid)
    applyBothPlansHide(member, hasFree, hasPaid)
    reveal()
  }

  /** Re-read the current member from Memberstack and re-apply both gates. */
  function syncFromMemberstack(ms) {
    ms.getCurrentMember()
      .then(({ data: member }) => applyAll(member))
      .catch(() => applyAll(null)) // lookup failed: treat as logged out (still reveals)
  }

  function wire(ms) {
    // Idempotent: on a second run just resync + reveal; listeners are already bound.
    if (window.__starterNavbarGateInited) {
      syncFromMemberstack(ms)
      return
    }
    window.__starterNavbarGateInited = true

    // Safety net: if Memberstack's lookup hangs, apply the logged-out state (and reveal)
    // rather than leaking member-only content behind a bare reveal. Cleared by any real pass.
    safetyTimer = setTimeout(() => applyAll(null), 3000)

    syncFromMemberstack(ms)
    ms.onAuthChange((member) => applyAll(member)) // member passed directly (null on logout)

    // Delegated logout: apply the logged-out state the instant a logout control is clicked,
    // ahead of Memberstack's onAuthChange. Covers controls added after init. Bound once.
    document.addEventListener("click", (e) => {
      if (e.target.closest(LOGOUT_SELECTOR)) applyAll(null)
    })

    // Back/forward cache restores the old DOM with stale inline display values — resync.
    window.addEventListener("pageshow", (e) => {
      if (e.persisted) syncFromMemberstack(ms)
    })
  }

  // Memberstack can load after this script. Poll briefly for it before giving up.
  function init() {
    const start = Date.now()
    const tryWire = () => {
      const ms = window.$memberstackDom
      if (ms) {
        wire(ms)
        return
      }
      if (Date.now() - start < 2000) {
        setTimeout(tryWire, 100)
        return
      }
      applyAll(null) // Memberstack never appeared: logged-out state, nav revealed
    }
    tryWire()
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }
})()
