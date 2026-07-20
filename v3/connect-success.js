;(function () {
  'use strict'

  // V3 calendar OAuth return handler for the /connect-success page. Nylas
  // redirects here with ?code=...&state=<member id> (state was set server-side
  // by grants/oauth/v3 from the caller's Bearer token). This module exchanges
  // the code through grants/add/v3 — server-side token exchange + grant
  // persist in one authenticated call — then returns to the Booking-stage
  // page, where the availability writer finishes configuration setup via its
  // ?calendar bootstrap.
  //
  // Identity rules match the availability writer: the write member id comes
  // from the live authenticated Memberstack session; a state that does not
  // match the logged-in member aborts without writing. Booking-confirmation
  // params (?confirmation/?reschedule/?cancel) are not handled here.

  const STAGING_HOST = 'the-starters-3-0.webflow.io'
  const XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
  const GRANTS_ADD_ENDPOINT = XANO_ORIGIN + '/api:tCpV3oqd/grants/add/v3'
  const RETURN_PATH = '/starter-dashboard---availability-stage'
  const STATUS_ATTRIBUTE = 'data-connect-success'

  if (window.location.hostname !== STAGING_HOST) return
  if (window.__tsConnectSuccess) return
  window.__tsConnectSuccess = true

  function setStatus(value) {
    document.documentElement.setAttribute(STATUS_ATTRIBUTE, value)
  }

  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail: detail }))
  }

  async function currentMember() {
    const memberstack = window.$memberstackDom
    if (memberstack && typeof memberstack.getCurrentMember === 'function') {
      const result = await memberstack.getCurrentMember()
      const member = result && result.data
      if (member && member.id) return member
      throw new Error('No logged-in member')
    }
    if (window.memberReady && typeof window.memberReady.then === 'function') {
      const member = await window.memberReady
      if (member && member.id) return member
    }
    throw new Error('No logged-in member')
  }

  async function initialize() {
    let code = null
    let state = null
    try {
      const params = new URLSearchParams(window.location.search)
      code = params.get('code')
      state = params.get('state')
    } catch (error) {
      /* fall through to not-applicable */
    }
    if (!code) {
      // The page also serves booking confirmation/reschedule/cancel links.
      setStatus('not-applicable')
      return null
    }
    if (typeof window.xanoAuthFetch !== 'function') {
      setStatus('missing-auth')
      console.warn('[connect-success] xanoAuthFetch unavailable; grant not saved')
      return null
    }

    setStatus('loading')
    try {
      const member = await currentMember()
      if (state && state !== member.id) {
        throw new Error('OAuth state does not match the logged-in member')
      }

      const response = await window.xanoAuthFetch(GRANTS_ADD_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, member_id: member.id }),
      })
      const data = await response.json().catch(function () {
        return null
      })
      if (!response.ok) {
        throw new Error('grants/add/v3 failed (' + response.status + ')')
      }
      if (!(data && data.grant_id)) {
        throw new Error('grants/add/v3 returned no grant')
      }

      setStatus('success')
      emit('starterConnectSuccess', { memberId: member.id })
      window.location.replace(RETURN_PATH + '?calendar=google')
      return data
    } catch (error) {
      setStatus('error')
      console.warn('[connect-success] grant save failed:', error && error.message)
      emit('starterConnectSuccessError', {
        message: (error && error.message) || 'Grant save failed',
      })
      return null
    }
  }

  window.StarterConnectSuccess = { initialize: initialize }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true })
  } else {
    initialize()
  }
})()
