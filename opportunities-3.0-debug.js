;(function () {
  'use strict'

  const bridge = window.Opp30MatchDebugBridge
  if (!bridge) return

  const GUI_SCRIPT = 'https://cdn.jsdelivr.net/npm/lil-gui@0.21.0'
  const GUI_STYLE = 'https://cdn.jsdelivr.net/npm/lil-gui@0.21.0/dist/lil-gui.min.css'
  const CARD_SELECTOR =
    '[data-opportunity-id], [data-opp-id], [data-wf-algolia-hit-objectid], [data-wf-xano-id]'
  const CATEGORY_NAMES = {
    1: 'Hiring & Team Building',
    2: 'Operations & Supply Chain',
    3: 'Finance',
    4: 'Marketing Strategy & Leadership',
    5: 'Physical Product & Development',
    6: 'AI & Technology',
    7: 'Retail & Marketplace',
    8: 'Analytics & Experimentation',
    9: 'Retention & CRM',
    10: 'Influencer, Affiliate & PR',
    11: 'Creative & Brand',
    12: 'Content & Organic',
    13: 'Paid Media',
  }

  const $ = (selector, root = document) => root.querySelector(selector)
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector))
  let dataPromise = null
  let guiPromise = null
  let guiLibraryPromise = null
  let cardObserver = null
  let generation = 0

  function routeName() {
    if (location.pathname.includes('starter-dashboard')) return 'Starter dashboard'
    return 'Opportunity feed'
  }

  function categoryRefs(item) {
    return bridge.filterValues(item && item.category_refs)
  }

  function categoryLabel(ref, showRefs = true) {
    const name = CATEGORY_NAMES[Number(ref)] || 'Unknown category'
    return showRefs ? `${name} [${ref}]` : name
  }

  function categoryLabels(refs, showRefs = true) {
    const values = bridge.filterValues(refs)
    return values.length
      ? values.map((ref) => categoryLabel(ref, showRefs)).join(' · ')
      : 'No categories'
  }

  function numericTotal(value, fallback = 0) {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? number : fallback
  }

  async function fetchAllActiveOpportunities() {
    const perPage = 100
    const rows = []
    let page = 1
    let total = null

    while (page <= 100) {
      const response = await bridge.API.starterOppList('Active', page, perPage)
      const items = Array.isArray(response?.items) ? response.items : []
      if (total == null) total = numericTotal(response?.itemsTotal, items.length)
      rows.push(...items)
      if (!items.length || rows.length >= total) break
      page += 1
    }

    return {
      rows,
      itemsTotal: total == null ? rows.length : total,
      complete: total == null || rows.length >= total,
    }
  }

  async function fetchAllAppliedRecords() {
    const perPage = 100
    const rows = []
    let page = 1
    let total = null

    while (page <= 100) {
      const response = await bridge.API.starterOppList('Applied', page, perPage)
      const items = Array.isArray(response)
        ? response
        : Array.isArray(response?.items)
          ? response.items
          : []
      if (total == null) total = numericTotal(response?.itemsTotal, items.length)
      rows.push(...items)
      if (!items.length || rows.length >= total || Array.isArray(response)) break
      page += 1
    }

    return {
      rows,
      itemsTotal: total == null ? rows.length : total,
    }
  }

  function applicationOpportunityIds(applicationRows) {
    const ids = {}
    ;(Array.isArray(applicationRows) ? applicationRows : []).forEach((application) => {
      if (!application || typeof application !== 'object') return
      const opportunity =
        application.opportunity && typeof application.opportunity === 'object'
          ? application.opportunity
          : application.opportunities_v3 && typeof application.opportunities_v3 === 'object'
            ? application.opportunities_v3
            : application.opportunity_v3 && typeof application.opportunity_v3 === 'object'
              ? application.opportunity_v3
              : application.opportunity_record && typeof application.opportunity_record === 'object'
                ? application.opportunity_record
                : null
      const applicationId = application.application_id || application.id
      const opportunityId =
        opportunity?.id ||
        application.opportunity_id ||
        application.opportunities_v3_id ||
        (application.opportunity && typeof application.opportunity !== 'object'
          ? application.opportunity
          : '')
      if (applicationId && opportunityId) ids[String(applicationId)] = String(opportunityId)
    })
    return ids
  }

  function summarizeOpportunityMatching(activeRows, starterCategoryRefs, server = {}) {
    const starterRefs = bridge.filterValues(starterCategoryRefs)
    const starterSet = new Set(starterRefs)
    const cards = (Array.isArray(activeRows) ? activeRows : []).map((opportunity) => {
      const refs = categoryRefs(opportunity)
      const matchRefs = refs.filter((ref) => starterSet.has(ref))
      const categoryMatch = matchRefs.length > 0
      const applied = opportunity.applied === true
      let visibilityReason = 'Not in matching or applied results'
      if (categoryMatch && applied) visibilityReason = 'Category match + applied'
      else if (categoryMatch) visibilityReason = 'Category match'
      else if (applied) visibilityReason = 'Applied history; no current category match'

      return {
        id: String(opportunity.id || opportunity.opportunity_id || opportunity.objectID || ''),
        title: String(opportunity.title || 'Untitled opportunity'),
        urlPath: String(opportunity.url_path || ''),
        webflowSlug: String(opportunity.webflow_slug || ''),
        categoryRefs: refs,
        categoryLabels: refs.map((ref) => categoryLabel(ref, false)),
        matchRefs,
        applied,
        categoryMatch,
        visibilityReason,
      }
    })

    const categoryMatching = cards.filter((card) => card.categoryMatch).length
    const activeApplied = cards.filter((card) => card.applied).length
    const matchingAppliedOverlap = cards.filter(
      (card) => card.categoryMatch && card.applied,
    ).length
    const availableMatching = categoryMatching - matchingAppliedOverlap
    const appliedNonMatching = activeApplied - matchingAppliedOverlap
    const uniqueVisible = categoryMatching + activeApplied - matchingAppliedOverlap
    const serverAvailableMatching =
      server.availableMatching == null ? null : numericTotal(server.availableMatching)
    const serverUniqueVisible =
      server.uniqueVisible == null ? null : numericTotal(server.uniqueVisible)
    const issues = []

    if (server.activeComplete === false) {
      issues.push(
        `Only ${cards.length} of ${numericTotal(server.totalActive, cards.length)} active opportunities were loaded.`,
      )
    }
    if (serverAvailableMatching != null && serverAvailableMatching !== availableMatching) {
      issues.push(
        `Available-match mismatch: Xano=${serverAvailableMatching}, QA reconciliation=${availableMatching}.`,
      )
    }
    if (serverUniqueVisible != null && serverUniqueVisible !== uniqueVisible) {
      issues.push(
        `Unique-visible mismatch: Xano=${serverUniqueVisible}, QA reconciliation=${uniqueVisible}.`,
      )
    }

    return {
      route: routeName(),
      generatedAt: new Date().toISOString(),
      starter: {
        categoryRefs: starterRefs,
        categoryLabels: starterRefs.map((ref) => categoryLabel(ref, false)),
      },
      counts: {
        totalActive: numericTotal(server.totalActive, cards.length),
        categoryMatching,
        availableMatching,
        activeApplied,
        allApplications: numericTotal(server.allApplications),
        matchingAppliedOverlap,
        appliedNonMatching,
        uniqueVisible,
      },
      server: {
        availableMatching: serverAvailableMatching,
        uniqueVisible: serverUniqueVisible,
      },
      reconciliation: {
        status: issues.length ? 'CHECK' : 'PASS',
        formula: `${categoryMatching} + ${activeApplied} - ${matchingAppliedOverlap} = ${uniqueVisible}`,
        issues,
      },
      applicationOpportunityIds: applicationOpportunityIds(server.applicationRows),
      cards,
    }
  }

  async function fetchDebugData(refreshContext) {
    const matchContext = await (refreshContext
      ? bridge.refreshTalentMatchContext()
      : bridge.getTalentMatchContext())
    const [active, matched, applied] = await Promise.all([
      fetchAllActiveOpportunities(),
      bridge.API.starterOppList('Active', 1, 1, { match_categories: true }),
      fetchAllAppliedRecords(),
    ])
    const data = summarizeOpportunityMatching(
      active.rows,
      bridge.contextValue(matchContext, 'category_refs'),
      {
        totalActive: active.itemsTotal,
        activeComplete: active.complete,
        availableMatching: matched?.available_matching_total,
        uniqueVisible: matched?.itemsTotal,
        allApplications: applied.itemsTotal,
        applicationRows: applied.rows,
      },
    )
    data.starter.id = bridge.contextValue(matchContext, 'starter_id') || null
    return data
  }

  function loadData(refreshContext = false) {
    if (!dataPromise) {
      dataPromise = fetchDebugData(refreshContext)
    }
    return dataPromise
  }

  function decodedPathSegment(value) {
    try {
      return decodeURIComponent(value)
    } catch (error) {
      return ''
    }
  }

  function opportunityDetailSegment(value, allowBareSlug = false) {
    const raw = String(value || '').trim()
    if (!raw) return ''
    if (allowBareSlug && !/[/?#]/.test(raw)) return decodedPathSegment(raw)

    try {
      const base = new URL(location.href)
      const url = new URL(raw, base)
      if (url.origin !== base.origin) return ''
      const segments = url.pathname.split('/').filter(Boolean)
      if (segments.length !== 2 || segments[0] !== 'opportunities') return ''
      return decodedPathSegment(segments[1])
    } catch (error) {
      return ''
    }
  }

  function opportunityIdentitySegments(opportunity) {
    return new Set(
      [
        String(opportunity?.id || '').trim(),
        opportunityDetailSegment(opportunity?.urlPath),
        opportunityDetailSegment(opportunity?.webflowSlug, true),
      ].filter(Boolean),
    )
  }

  function detailLinkOpportunityId(card, data) {
    const links = []
    if (card.matches?.('a[href]')) links.push(card)
    links.push(...Array.from(card.querySelectorAll?.('a[href]') || []))
    const segments = new Set()
    for (const link of links) {
      const segment = opportunityDetailSegment(link.getAttribute('href'))
      if (segment) segments.add(segment)
    }

    const ids = new Set()
    ;(Array.isArray(data?.cards) ? data.cards : []).forEach((opportunity) => {
      if (!opportunity.id) return
      const identities = opportunityIdentitySegments(opportunity)
      if (Array.from(segments).some((segment) => identities.has(segment))) {
        ids.add(String(opportunity.id))
      }
    })
    return ids.size === 1 ? Array.from(ids)[0] : ''
  }

  function opportunityCardId(card, data) {
    const explicitId =
      card.getAttribute('data-opportunity-id') ||
      card.getAttribute('data-opp-id') ||
      card.getAttribute('data-wf-algolia-hit-objectid')
    if (explicitId) return String(explicitId)

    const dashboardRoot = card.closest('[wf-xano-instance="dash-applied-opps"]')
    if (dashboardRoot) {
      const applicationId = String(card.getAttribute('data-wf-xano-id') || '')
      const mappedId = applicationId && data?.applicationOpportunityIds?.[applicationId]
      return mappedId ? String(mappedId) : detailLinkOpportunityId(card, data)
    }

    const sourceRoot = card.closest('[wf-xano-source]')
    const source = sourceRoot?.getAttribute('wf-xano-source') || ''
    if (
      !/(?:starter|brand)\/opportunities\/list/.test(source) ||
      /applications\/list/.test(source) ||
      card.hasAttribute('data-app-id')
    ) {
      return ''
    }
    return String(card.getAttribute('data-wf-xano-id') || '')
  }

  function cardRoots() {
    if (location.pathname.includes('starter-dashboard')) {
      return $$('[wf-xano-instance="dash-applied-opps"]')
    }
    return $$('[wf-algolia-element="results"]')
  }

  function renderedCards(data) {
    const cards = cardRoots().flatMap((root) => {
      const matches = $$(CARD_SELECTOR, root)
      if (root.matches(CARD_SELECTOR)) matches.unshift(root)
      return matches
    })
    const uniqueCards = Array.from(new Set(cards)).filter((card) => opportunityCardId(card, data))
    return uniqueCards.filter((card) => {
      const id = opportunityCardId(card, data)
      return !uniqueCards.some(
        (candidate) =>
          candidate !== card &&
          candidate.contains(card) &&
          opportunityCardId(candidate, data) === id,
      )
    })
  }

  function viewMatches(view, card) {
    if (view === 'Matching') return Boolean(card?.categoryMatch)
    if (view === 'Available matches') return Boolean(card?.categoryMatch && !card?.applied)
    if (view === 'Applied') return Boolean(card?.applied)
    if (view === 'Match + applied') return Boolean(card?.categoryMatch && card?.applied)
    if (view === 'Applied non-match') return Boolean(card?.applied && !card?.categoryMatch)
    if (view === 'Non-match') return Boolean(card && !card.categoryMatch)
    return true
  }

  function paintCards(data, state) {
    const byId = new Map(data.cards.map((card) => [card.id, card]))
    renderedCards(data).forEach((element) => {
      const id = opportunityCardId(element, data)
      const card = byId.get(id) || null
      element.setAttribute('data-opp-debug-card', 'true')
      element.setAttribute('data-opp-debug-known', card ? 'true' : 'false')
      element.setAttribute('data-opp-debug-match', card?.categoryMatch ? 'true' : 'false')
      element.setAttribute('data-opp-debug-applied', card?.applied ? 'true' : 'false')
      element.setAttribute(
        'data-opp-debug-hidden',
        viewMatches(state.view, card) ? 'false' : 'true',
      )

      let overlay = $('[data-opp-debug-card-overlay]', element)
      if (!overlay) {
        overlay = document.createElement('div')
        overlay.setAttribute('data-opp-debug-card-overlay', '')
        overlay.setAttribute('aria-label', 'Opportunity matching diagnostic')
        element.appendChild(overlay)
      }
      overlay.style.display = state.showCardLabels ? '' : 'none'
      overlay.replaceChildren()

      const status = document.createElement('strong')
      status.textContent = card ? card.visibilityReason : `Unknown opportunity ID ${id}`
      overlay.appendChild(status)

      if (card) {
        const categories = document.createElement('span')
        categories.textContent = `Opportunity: ${categoryLabels(
          card.categoryRefs,
          state.showRefs,
        )}`
        overlay.appendChild(categories)

        const overlap = document.createElement('span')
        overlap.textContent = `Overlap: ${
          card.matchRefs.length ? categoryLabels(card.matchRefs, state.showRefs) : 'None'
        } · Applied: ${card.applied ? 'Yes' : 'No'}`
        overlay.appendChild(overlap)
      }
    })
  }

  function ensureStyles() {
    if (!document.getElementById('opp30-match-debug-styles')) {
      const style = document.createElement('style')
      style.id = 'opp30-match-debug-styles'
      style.textContent = `
        [data-opp-debug-card="true"]{position:relative!important}
        [data-opp-debug-hidden="true"]{display:none!important}
        [data-opp-debug-card-overlay]{
          position:absolute;z-index:50;top:.4rem;right:.4rem;display:flex;max-width:82%;
          flex-direction:column;gap:.15rem;padding:.35rem .45rem;border:1px solid #2f3730;
          border-radius:.25rem;background:rgba(248,249,244,.96);box-shadow:0 2px 8px rgba(0,0,0,.15);
          color:#20251f;font:500 10px/1.25 system-ui,sans-serif;pointer-events:none
        }
        [data-opp-debug-card-overlay] strong{font-weight:750}
        [data-opp-debug-match="true"] [data-opp-debug-card-overlay]{border-color:#2d7d46;background:rgba(235,250,239,.97)}
        [data-opp-debug-applied="true"] [data-opp-debug-card-overlay]{box-shadow:inset 3px 0 #4263a5,0 2px 8px rgba(0,0,0,.15)}
        [data-opp-debug-match="true"][data-opp-debug-applied="true"] [data-opp-debug-card-overlay]{box-shadow:inset 3px 0 #6b45a8,0 2px 8px rgba(0,0,0,.15)}
        .lil-gui.root[data-opp-debug-gui]{z-index:2147483646!important;--width:370px}
      `
      ;(document.head || document.documentElement).appendChild(style)
    }

    if (!document.getElementById('opp30-lil-gui-styles')) {
      const link = document.createElement('link')
      link.id = 'opp30-lil-gui-styles'
      link.rel = 'stylesheet'
      link.href = GUI_STYLE
      ;(document.head || document.documentElement).appendChild(link)
    }
  }

  function loadGuiLibrary() {
    if (window.lil?.GUI) return Promise.resolve(window.lil.GUI)
    if (guiLibraryPromise) return guiLibraryPromise

    guiLibraryPromise = new Promise((resolve, reject) => {
      let script = document.getElementById('opp30-lil-gui-script')
      const finish = () => {
        if (window.lil?.GUI) resolve(window.lil.GUI)
        else {
          script?.remove()
          reject(new Error('lil-gui loaded without window.lil.GUI'))
        }
      }
      const fail = () => {
        script?.remove()
        reject(new Error('Failed to load lil-gui'))
      }

      if (!script) {
        script = document.createElement('script')
        script.id = 'opp30-lil-gui-script'
        script.src = GUI_SCRIPT
        script.async = true
      }
      script.addEventListener('load', finish, { once: true })
      script.addEventListener('error', fail, { once: true })
      if (!script.isConnected) (document.head || document.documentElement).appendChild(script)
    })
    return guiLibraryPromise
  }

  function copyDiagnostic(data) {
    const text = JSON.stringify(data, null, 2)
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(() => {
        console.info('[opp30] opportunity matching diagnostic copied')
      })
    }
    console.info('[opp30] opportunity matching diagnostic', text)
    return Promise.resolve()
  }

  async function diagnoseOpportunityMatching({ refresh = false } = {}) {
    if (refresh) {
      await refreshDebug()
      return diagnoseOpportunityMatching()
    }
    const data = await loadData()
    console.groupCollapsed?.(
      `[opp30] opportunity matching QA: ${data.reconciliation.status}`,
    )
    console.info('[opp30] freelancer categories', data.starter)
    console.table?.([data.counts])
    console.table?.(data.cards)
    if (data.reconciliation.issues.length) {
      console.warn('[opp30] opportunity matching reconciliation issues', data.reconciliation.issues)
    }
    console.groupEnd?.()
    return data
  }

  function observeCards(data, state) {
    cardObserver?.disconnect()
    if (!document.body) return
    cardObserver = new MutationObserver((mutations) => {
      const changed = mutations.some((mutation) =>
        Array.from(mutation.addedNodes).some(
          (node) =>
            node.nodeType === 1 &&
            (node.matches?.(CARD_SELECTOR) ||
              node.querySelector?.(CARD_SELECTOR) ||
              node.matches?.(
                '[wf-xano-instance="dash-applied-opps"], [wf-algolia-element="results"]',
              )),
        ),
      )
      if (changed) paintCards(data, state)
    })
    cardObserver.observe(document.body, { childList: true, subtree: true })
  }

  function addReadOnly(folder, state, property, label) {
    const controller = folder.add(state, property).name(label)
    controller.disable?.()
    return controller
  }

  function clearDebugDom() {
    $$('[data-opp-debug-card]').forEach((card) => {
      card.removeAttribute('data-opp-debug-card')
      card.removeAttribute('data-opp-debug-known')
      card.removeAttribute('data-opp-debug-match')
      card.removeAttribute('data-opp-debug-applied')
      card.removeAttribute('data-opp-debug-hidden')
      $('[data-opp-debug-card-overlay]', card)?.remove()
    })
  }

  function resetDebugState() {
    generation += 1
    dataPromise = null
    guiPromise = null
    guiLibraryPromise = null
    cardObserver?.disconnect()
    cardObserver = null
    window.Opp30MatchDebug?.gui?.destroy()
    window.Opp30MatchDebug = null
    clearDebugDom()
  }

  function initialize({ refreshContext = false } = {}) {
    if (guiPromise) return guiPromise
    const currentGeneration = generation
    document.documentElement.setAttribute('data-opp30-match-debug', 'loading')
    guiPromise = Promise.all([loadData(refreshContext), loadGuiLibrary()])
      .then(([data, GUI]) => {
        if (currentGeneration !== generation) return null
        ensureStyles()

        const state = {
          route: data.route,
          freelancerCategories: categoryLabels(data.starter.categoryRefs),
          totalActive: data.counts.totalActive,
          categoryMatching: data.counts.categoryMatching,
          availableMatching: data.counts.availableMatching,
          activeApplied: data.counts.activeApplied,
          allApplications: data.counts.allApplications,
          matchingApplied: data.counts.matchingAppliedOverlap,
          appliedNonMatching: data.counts.appliedNonMatching,
          uniqueVisible: data.counts.uniqueVisible,
          reconciliation: `${data.reconciliation.status}: ${data.reconciliation.formula}`,
          view: 'All rendered',
          showCardLabels: true,
          showRefs: true,
          refresh: () => refreshDebug(),
          copyJSON: () => copyDiagnostic(data),
          logToConsole: () => diagnoseOpportunityMatching(),
          exitQAMode: () => {
            const target = new URL(location.href)
            target.searchParams.delete('opp_debug')
            location.href = target.toString()
          },
        }

        const gui = new GUI({ title: 'Opportunity matching QA', width: 370 })
        gui.domElement.setAttribute('data-opp-debug-gui', '')
        const profile = gui.addFolder('Freelancer profile')
        addReadOnly(profile, state, 'route', 'Page')
        addReadOnly(profile, state, 'freelancerCategories', 'Categories')

        const counts = gui.addFolder('Active opportunity counts')
        addReadOnly(counts, state, 'totalActive', 'Total active')
        addReadOnly(counts, state, 'categoryMatching', 'Category matches')
        addReadOnly(counts, state, 'availableMatching', 'Matching, not applied')
        addReadOnly(counts, state, 'activeApplied', 'Applied + active')
        addReadOnly(counts, state, 'matchingApplied', 'Match + applied overlap')
        addReadOnly(counts, state, 'appliedNonMatching', 'Applied non-matches')
        addReadOnly(counts, state, 'uniqueVisible', 'Unique visible union')
        addReadOnly(counts, state, 'allApplications', 'Applications, all statuses')
        addReadOnly(counts, state, 'reconciliation', 'QA equation')

        const inspect = gui.addFolder('Inspect rendered cards')
        inspect
          .add(state, 'view', [
            'All rendered',
            'Matching',
            'Available matches',
            'Applied',
            'Match + applied',
            'Applied non-match',
            'Non-match',
          ])
          .name('Show')
          .onChange(() => paintCards(data, state))
        inspect
          .add(state, 'showCardLabels')
          .name('Floating card labels')
          .onChange(() => paintCards(data, state))
        inspect
          .add(state, 'showRefs')
          .name('Show raw refs')
          .onChange(() => paintCards(data, state))

        const actions = gui.addFolder('Actions')
        actions.add(state, 'refresh').name('Refresh Xano data')
        actions.add(state, 'copyJSON').name('Copy diagnostic JSON')
        actions.add(state, 'logToConsole').name('Log tables to console')
        actions.add(state, 'exitQAMode').name('Exit QA mode')

        paintCards(data, state)
        observeCards(data, state)
        document.documentElement.setAttribute(
          'data-opp30-match-debug',
          data.reconciliation.status.toLowerCase(),
        )
        window.Opp30MatchDebug = { data, gui, state }
        return window.Opp30MatchDebug
      })
      .catch((error) => {
        if (currentGeneration === generation) handleError(error)
        return null
      })
    return guiPromise
  }

  function refreshDebug() {
    resetDebugState()
    return initialize({ refreshContext: true }).then((result) => result?.data || null)
  }

  window.addEventListener(bridge.memberScopeResetEvent, () => {
    resetDebugState()
    initialize()
  })

  function handleError(error) {
    document.documentElement.setAttribute('data-opp30-match-debug', 'error')
    console.error('[opp30] failed to initialize opportunity matching QA mode', error)
  }

  Object.assign(window.Opp30 || (window.Opp30 = {}), {
    diagnoseOpportunityMatching,
    initOpportunityMatchDebug: initialize,
    resolveOpportunityMatchCardId: opportunityCardId,
    summarizeOpportunityMatching,
  })
  initialize()
})()
