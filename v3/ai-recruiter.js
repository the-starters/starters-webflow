/**
 * The Starters V3 AI Recruiter floating panel.
 *
 * Webflow owns all visible markup. This controller binds only to the
 * data-ai-recruiter attribute contract and calls the authenticated Xano V3
 * boundary. It never calls n8n, Supabase, or OpenAI from the browser.
 */
;(function aiRecruiterV3() {
  'use strict'

  const PLAN = Object.freeze({
    BRAND_FREE: 'pln_free-plan-f6kn0dxz',
    BRAND_PAID: 'pln_new-paid-plan-463h04ph',
    TEST_BRAND: 'pln_dorxata-test-brand-plan-777r02pa',
  })
  const ELIGIBLE_PLANS = new Set([PLAN.BRAND_PAID, PLAN.TEST_BRAND])
  const BRAND_PLANS = new Set([PLAN.BRAND_FREE, ...ELIGIBLE_PLANS])
  const AUTH_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh'
  const API_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30'
  const STORAGE_KEY = 'ts:ai-recruiter:v3:session'
  const CONSENT_VERSION = '2026-08-11'
  const REQUEST_TIMEOUT_MS = 35000
  const MAX_MESSAGE_LENGTH = 2000
  const selectors = Object.freeze({
    root: '[data-ai-recruiter="root"]',
    launcher: '[data-ai-recruiter="launcher"]',
    panel: '[data-ai-recruiter="panel"]',
    close: '[data-ai-recruiter="close"]',
    minimize: '[data-ai-recruiter="minimize"]',
    startOver: '[data-ai-recruiter="start-over"]',
    form: '[data-ai-recruiter="form"]',
    input: '[data-ai-recruiter="input"]',
    submit: '[data-ai-recruiter="submit"]',
    messages: '[data-ai-recruiter="messages"]',
    messageTemplate: '[data-ai-recruiter="message-template"]',
    messageText: '[data-ai-recruiter-field="message"]',
    candidateTemplate: '[data-ai-recruiter="candidate-template"]',
    candidateList: '[data-ai-recruiter="candidate-list"]',
    status: '[data-ai-recruiter="status"]',
    consent: '[data-ai-recruiter="consent"]',
    consentContinue: '[data-ai-recruiter="consent-continue"]',
    prompt: '[data-ai-recruiter="prompt"]',
    helpful: '[data-ai-recruiter="helpful"]',
  })

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID()
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
      const random = Math.floor(Math.random() * 16)
      const value = character === 'x' ? random : (random & 0x3) | 0x8
      return value.toString(16)
    })
  }

  function activePlanIds(member) {
    const plans = (member && member.planConnections) || []
    return plans
      .filter((connection) => !connection.status || connection.status === 'ACTIVE')
      .map((connection) => connection.planId || connection.id)
      .filter(Boolean)
  }

  function roleForMember(member) {
    const plans = activePlanIds(member)
    if (plans.some((id) => ELIGIBLE_PLANS.has(id))) return 'brand-paid'
    if (plans.some((id) => BRAND_PLANS.has(id))) return 'brand-free'
    return 'ineligible'
  }

  function normalizeResponse(value) {
    const body = value && typeof value === 'object' ? value : {}
    const candidates = Array.isArray(body.top_candidates) ? body.top_candidates.slice(0, 3) : []
    return {
      status: typeof body.status === 'string' ? body.status : 'error',
      message: typeof body.message === 'string' && body.message.trim()
        ? body.message.trim().slice(0, MAX_MESSAGE_LENGTH)
        : 'The recruiter is temporarily unavailable. Please try again.',
      trace_id: typeof body.trace_id === 'string' ? body.trace_id : '',
      session_id: typeof body.session_id === 'string' ? body.session_id : '',
      retryable: body.retryable === true,
      retry_after_seconds: Number.isInteger(body.retry_after_seconds)
        ? body.retry_after_seconds
        : null,
      top_candidates: candidates.filter((candidate) =>
        candidate && Number.isInteger(candidate.freelancer_v3_id) && candidate.freelancer_v3_id > 0,
      ),
    }
  }

  function safeText(value, maximum = 300) {
    return value == null ? '' : String(value).trim().slice(0, maximum)
  }

  function stateBlock(root, name) {
    root.dataset.aiRecruiterState = name
    for (const block of root.querySelectorAll('[data-ai-recruiter-state]')) {
      block.hidden = block.getAttribute('data-ai-recruiter-state') !== name
    }
  }

  function readSession() {
    try {
      const value = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || 'null')
      return value && typeof value.session_id === 'string' ? value : null
    } catch (_) {
      return null
    }
  }

  function writeSession(session) {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  }

  async function currentMember() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const memberstack = window.$memberstackDom
      if (memberstack && typeof memberstack.getCurrentMember === 'function') {
        const result = await memberstack.getCurrentMember()
        return result && result.data ? result.data : null
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50))
    }
    return null
  }

  async function xanoToken() {
    if (typeof window.getXanoAuthToken === 'function') return window.getXanoAuthToken()
    const memberstack = window.$memberstackDom
    if (!memberstack || typeof memberstack.getMemberCookie !== 'function') {
      throw Object.assign(new Error('Memberstack session unavailable'), { status: 401 })
    }
    const memberToken = await memberstack.getMemberCookie()
    if (!memberToken) throw Object.assign(new Error('Memberstack session unavailable'), { status: 401 })
    const response = await fetch(`${AUTH_BASE}/auth/trade-token/v3?token=${encodeURIComponent(memberToken)}`)
    const body = await response.json().catch(() => null)
    if (!response.ok) throw Object.assign(new Error('Authentication failed'), { status: response.status })
    const token = typeof body === 'string' ? body : body && (body.authToken || body.token)
    if (!token) throw new Error('Authentication returned no token')
    return token
  }

  async function api(path, body, signal) {
    const token = await xanoToken()
    const response = await fetch(`${API_BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
      signal,
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const error = new Error((data && data.message) || `Request failed (${response.status})`)
      error.status = response.status
      error.data = data
      throw error
    }
    return data
  }

  function setStatus(root, message) {
    const status = root.querySelector(selectors.status)
    if (status) status.textContent = message
  }

  function addMessage(root, kind, text) {
    const template = root.querySelector(selectors.messageTemplate)
    const container = root.querySelector(selectors.messages)
    if (!template || !container) return
    const message = template.cloneNode(true)
    message.removeAttribute('data-ai-recruiter')
    message.hidden = false
    message.setAttribute('data-ai-recruiter-message', kind)
    const target = message.querySelector(selectors.messageText) || message
    target.textContent = safeText(text, MAX_MESSAGE_LENGTH)
    container.appendChild(message)
    container.scrollTop = container.scrollHeight
  }

  function setCandidateField(card, field, value) {
    for (const target of card.querySelectorAll(`[data-ai-recruiter-field="${field}"]`)) {
      target.textContent = safeText(value)
    }
  }

  function renderCandidates(root, candidates, traceId, sendFeedback) {
    const template = root.querySelector(selectors.candidateTemplate)
    const list = root.querySelector(selectors.candidateList)
    if (!template || !list) return
    list.replaceChildren()
    candidates.forEach((candidate) => {
      const card = template.cloneNode(true)
      card.removeAttribute('data-ai-recruiter')
      card.hidden = false
      card.dataset.freelancerV3Id = String(candidate.freelancer_v3_id)
      setCandidateField(card, 'display-name', candidate.display_name)
      setCandidateField(card, 'headline', candidate.professional_headline)
      setCandidateField(card, 'match-reason', candidate.match_reason)
      setCandidateField(card, 'location', [candidate.city, candidate.country].filter(Boolean).join(', '))
      setCandidateField(card, 'availability', candidate.availability)
      setCandidateField(card, 'rate', candidate.hourly_rate == null ? '' : `$${candidate.hourly_rate}/hr`)
      const profile = card.querySelector('[data-ai-recruiter-field="profile-link"]')
      if (profile) {
        profile.href = `/hire/${encodeURIComponent(candidate.slug)}`
        profile.addEventListener('click', () => sendFeedback('track-click', {
          trace_id: traceId,
          freelancer_v3_id: candidate.freelancer_v3_id,
        }))
      }
      list.appendChild(card)
    })
  }

  function initRoot(root, member, role) {
    const launcher = root.querySelector(selectors.launcher)
    const panel = root.querySelector(selectors.panel)
    const form = root.querySelector(selectors.form)
    const input = root.querySelector(selectors.input)
    const submit = root.querySelector(selectors.submit)
    if (!launcher || !panel || !form || !input) return

    let pending = false
    let lastTraceId = ''
    let session = readSession() || { session_id: uuid(), consented: false }
    writeSession(session)

    root.hidden = false
    root.dataset.aiRecruiterRole = role
    stateBlock(root, role === 'brand-paid' ? (session.consented ? 'ready' : 'consent') : 'upgrade')

    const open = () => {
      panel.hidden = false
      launcher.setAttribute('aria-expanded', 'true')
      window.requestAnimationFrame(() => input.focus())
    }
    const close = () => {
      panel.hidden = true
      launcher.setAttribute('aria-expanded', 'false')
      launcher.focus()
    }
    launcher.addEventListener('click', open)
    for (const control of root.querySelectorAll(`${selectors.close}, ${selectors.minimize}`)) {
      control.addEventListener('click', close)
    }
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close()
    })

    const consentContinue = root.querySelector(selectors.consentContinue)
    if (consentContinue) consentContinue.addEventListener('click', () => {
      const consent = root.querySelector(selectors.consent)
      if (!consent || !consent.checked) {
        setStatus(root, 'Please accept the AI recruiter privacy notice to continue.')
        return
      }
      session = { ...session, consented: true, consented_at: new Date().toISOString() }
      writeSession(session)
      stateBlock(root, 'ready')
      input.focus()
    })

    async function feedback(path, values) {
      if (!lastTraceId && !values.trace_id) return
      try {
        await api(`ai-recruiter/${path}`, {
          trace_id: values.trace_id || lastTraceId,
          freelancer_v3_id: values.freelancer_v3_id,
          helpful: values.helpful,
        })
      } catch (_) {
        // Feedback never interrupts the recruiter conversation.
      }
    }

    for (const control of root.querySelectorAll(selectors.helpful)) {
      control.addEventListener('click', () => feedback('track-helpful', {
        trace_id: lastTraceId,
        helpful: control.getAttribute('data-ai-recruiter-helpful') !== 'false',
      }))
    }

    async function submitMessage(message) {
      const trimmed = safeText(message, MAX_MESSAGE_LENGTH)
      if (!trimmed || pending || role !== 'brand-paid' || !session.consented) return
      pending = true
      if (submit) submit.disabled = true
      input.disabled = true
      stateBlock(root, 'thinking')
      addMessage(root, 'user', trimmed)
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const response = normalizeResponse(await api('ai-recruiter/message', {
          message: trimmed,
          turn_id: uuid(),
          session_id: session.session_id,
        }, controller.signal))
        if (response.session_id) {
          session.session_id = response.session_id
          writeSession(session)
        }
        lastTraceId = response.trace_id
        addMessage(root, 'assistant', response.message)
        renderCandidates(root, response.top_candidates, response.trace_id, feedback)
        if (response.status === 'rate_limited') stateBlock(root, 'rate-limited')
        else if (response.status === 'expired') stateBlock(root, 'expired')
        else if (response.status === 'error') stateBlock(root, response.retryable ? 'retry' : 'error')
        else stateBlock(root, 'ready')
        setStatus(root, response.message)
      } catch (error) {
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false
        stateBlock(root, offline ? 'offline' : 'retry')
        setStatus(root, error.name === 'AbortError'
          ? 'The search timed out. Please try again.'
          : 'The recruiter is temporarily unavailable. Please try again.')
      } finally {
        window.clearTimeout(timeout)
        pending = false
        if (submit) submit.disabled = false
        input.disabled = false
        input.value = ''
        input.focus()
      }
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault()
      submitMessage(input.value)
    })
    for (const prompt of root.querySelectorAll(selectors.prompt)) {
      prompt.addEventListener('click', () => submitMessage(
        prompt.getAttribute('data-ai-recruiter-prompt') || prompt.textContent,
      ))
    }
    const startOver = root.querySelector(selectors.startOver)
    if (startOver) startOver.addEventListener('click', async () => {
      const previous = session.session_id
      session = { session_id: uuid(), consented: session.consented, consented_at: session.consented_at }
      writeSession(session)
      const messages = root.querySelector(selectors.messages)
      const candidates = root.querySelector(selectors.candidateList)
      if (messages) messages.replaceChildren()
      if (candidates) candidates.replaceChildren()
      lastTraceId = ''
      stateBlock(root, 'ready')
      try { await api('ai-recruiter/session-reset', { session_id: previous }) } catch (_) {}
    })
  }

  async function boot() {
    const roots = [...document.querySelectorAll(selectors.root)]
    if (!roots.length) return
    roots.forEach((root) => { root.hidden = true })
    const member = await currentMember().catch(() => null)
    const role = roleForMember(member)
    if (role === 'ineligible') return
    roots.forEach((root) => initRoot(root, member, role))
  }

  const testApi = { activePlanIds, roleForMember, normalizeResponse, safeText }
  if (typeof window !== 'undefined') window.StartersAIRecruiter = testApi
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true })
    else boot()
  }
})()
