/**
 * profile-image-auth-shim.js — transparent auth + resize bridge for
 * Xano `build_profile/starter/profile_image` (The Starters 3.0 site).
 *
 * The endpoint was auth-hardened on 2026-07-13 (user_v3 Bearer token
 * required, `member_id` input removed, 2MB cap, jpg/png/webp only). The
 * build-profile wizard (`/build-profile/full-profile`) and
 * `/starter-edit-profile` ship inline uploaders that still POST
 * `{ image, member_id }` with no Authorization header → 401.
 *
 * This shim wraps window.fetch and, ONLY for unauthenticated POSTs to that
 * endpoint:
 *   1. trades the Memberstack JWT for a user_v3 token
 *      (api:g1vmSLWh/auth/trade-token/v3 — same bridge as opportunities-3.0.js)
 *   2. downscales the image client-side (longest side ≤ 800px, JPEG q0.8)
 *      so the server's 2MB cap is never the user's problem
 *   3. re-issues the request with the Authorization header and without
 *      `member_id`
 *
 * Requests that already carry an Authorization header (e.g.
 * complete-profile-photo.js v1.18.0) and every other URL pass through
 * untouched, so the shim is safe to load on any page.
 *
 * 2026-07-20 (Phase-2 writer cutover): ALSO injects the Authorization header
 * into the profile-update family so those endpoints can be auth-gated
 * server-side without waiting on the inline page code.
 *
 * 2026-07-25 (child-record auth): extends the same header-only bridge to
 * Companies and Portfolio mutations used by `/starter-edit-profile`. Request
 * bodies, methods, and other options stay untouched. Non-GET/HEAD,
 * unauthenticated string-URL and Request-object calls to exact paths on the
 * Xano origin qualify; other origins pass through. Concurrent calls share one
 * token trade, the token is cached for the page, injection fails open when
 * there is no Memberstack session (the server returns 401), and a stale token
 * is invalidated and retraded once.
 *
 * 2026-07-25 (V3 production profile editing): `/starter-edit-profile` is
 * writable only on the two Live Memberstack hosts. The Webflow staging host
 * shares the production Xano/Webflow/Algolia backends, so the shim keeps that
 * page read-only by rejecting its mutation requests before they leave the
 * browser. The existing inline form uses the `editSubmit` localStorage flag;
 * this shim now owns that compatibility flag from the hostname allowlist.
 *
 * ⏳ Interim bridge: remove once the pages' own code adopts the contract
 * (photo: photo-migration/build-profile-wizard-AUTH-PATCH-20260714.md;
 * updates: product-workflows/freelancer-profiles/
 * profile-update-AUTH-HANDOFF-20260720.md).
 */
;(function () {
  'use strict'

  if (window.__tsProfileImageAuthShim) return
  window.__tsProfileImageAuthShim = true

  const DEBUG_LOG = true
  const log = (...args) => {
    if (DEBUG_LOG) console.info('[pi-auth-shim]', ...args)
  }

  const ENDPOINT_PATH = '/api:KZf7nFnk/build_profile/starter/profile_image'
  const EDIT_PROFILE_PATH = '/starter-edit-profile'
  const LIVE_EDIT_HOSTS = ['thestarters.com', 'www.thestarters.com']
  const EDIT_PROFILE_MUTATION_PATHS = [
    '/api:KZf7nFnk/edit_profile/update/',
    '/api:KZf7nFnk/starter/set_also_worked_with',
    '/api:KZf7nFnk/build_profile/starter/profile_image',
    '/api:SYL06lUR/companies',
    '/api:SYL06lUR/companies/',
    '/api:PmBJV0AG/Create_portfolio',
    '/api:PmBJV0AG/Update_portfolio',
    '/api:PmBJV0AG/Delete_portfolio',
    '/api:PmBJV0AG/upload-image',
    '/api:PmBJV0AG/Add_portfolio_image',
    '/api:PmBJV0AG/upload-video',
    '/api:PmBJV0AG/Add_portfolio_video',
    '/api:PmBJV0AG/Delete_portfolio_image',
    '/api:PmBJV0AG/Delete_portfolio_video',
  ]
  // Profile and owned child-record family: Bearer header only (no body rework).
  const AUTH_INJECT_PATHS = [
    '/api:KZf7nFnk/build_profile/starter/update',
    '/api:KZf7nFnk/edit_profile/update/',
    '/api:KZf7nFnk/starter/get',
    '/api:KZf7nFnk/starter/set_also_worked_with',
    '/api:KZf7nFnk/edit_profile/starter/get_also_worked_with',
    '/api:SYL06lUR/companies',
    '/api:SYL06lUR/companies/',
    '/api:PmBJV0AG/Create_portfolio',
    '/api:PmBJV0AG/Update_portfolio',
    '/api:PmBJV0AG/Delete_portfolio',
    '/api:PmBJV0AG/upload-image',
    '/api:PmBJV0AG/Add_portfolio_image',
    '/api:PmBJV0AG/upload-video',
    '/api:PmBJV0AG/Add_portfolio_video',
    '/api:PmBJV0AG/Delete_portfolio_image',
    '/api:PmBJV0AG/Delete_portfolio_video',
  ]
  const XANO_AUTH_URL =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh/auth/trade-token/v3'
  const XANO_ORIGIN = new URL(XANO_AUTH_URL).origin
  const MAX_DIMENSION = 800 // px, longest side after resize
  const JPEG_QUALITY = 0.8
  const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 // server precondition

  /* ===================== DOMAIN WRITE MODE ======================= */
  const hostname = String(window.location.hostname || '').toLowerCase()
  const pathname = String(window.location.pathname || '')
  const isEditProfilePage =
    pathname === EDIT_PROFILE_PATH || pathname.indexOf(EDIT_PROFILE_PATH + '/') === 0
  const isLiveEditHost = LIVE_EDIT_HOSTS.indexOf(hostname) !== -1

  if (isEditProfilePage) {
    window.__TS_EDIT_PROFILE_MODE__ = isLiveEditHost ? 'live-write' : 'read-only'
    try {
      if (isLiveEditHost) {
        window.localStorage.setItem('editSubmit', 'true')
      } else {
        window.localStorage.removeItem('editSubmit')
      }
    } catch {
      log('editSubmit compatibility storage unavailable')
    }
    if (!isLiveEditHost) {
      log('read-only mode on non-Live host', hostname || '(empty hostname)')
    }
  }

  /* ========================= AUTH BRIDGE ========================== */
  let _xanoToken = null
  let _xanoTokenPromise = null

  async function ensureXanoToken(fetchFn) {
    if (_xanoToken) return _xanoToken
    if (_xanoTokenPromise) return _xanoTokenPromise

    const tradePromise = (async () => {
      const ms = window.$memberstackDom
      if (!ms) throw new Error('Memberstack not available')
      const msToken = await ms.getMemberCookie()
      if (!msToken) throw new Error('No Memberstack session (member not logged in)')
      const res = await fetchFn(
        `${XANO_AUTH_URL}?token=${encodeURIComponent(msToken)}`,
      )
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw Object.assign(new Error('trade-token failed'), { status: res.status, data })
      }
      _xanoToken =
        typeof data === 'string' ? data : data && (data.authToken || data.token)
      if (!_xanoToken) throw new Error('trade-token returned no token')
      return _xanoToken
    })()
    _xanoTokenPromise = tradePromise

    try {
      return await tradePromise
    } finally {
      if (_xanoTokenPromise === tradePromise) _xanoTokenPromise = null
    }
  }

  function invalidateXanoToken(token) {
    if (_xanoToken !== token) return
    _xanoToken = null
    _xanoTokenPromise = null
  }

  /* ========================== RESIZE ============================== */
  /**
   * Downscale so the longest side is ≤ MAX_DIMENSION and re-encode as JPEG.
   * Never upscales. Falls back to the original file if the browser cannot
   * decode it (the server then answers with its own validation error).
   */
  async function resizeImage(file) {
    const bitmap = await createImageBitmap(file).catch(() => null)
    if (!bitmap) {
      log('resize skipped (undecodable file), sending original', file.type)
      return file
    }
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    // JPEG has no alpha — flatten transparent PNGs onto white, not black
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    if (bitmap.close) bitmap.close()
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    )
    if (!blob) throw new Error('Image encode failed')
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error('Image is too large even after resizing')
    return blob
  }

  /* ===================== REQUEST INSPECTION ======================= */
  /* ==================== AUTH-ONLY INJECTION ======================= */
  function xanoPathname(url) {
    try {
      const parsed = new URL(url, window.location.origin)
      return parsed.origin === XANO_ORIGIN ? parsed.pathname : null
    } catch {
      return null
    }
  }

  function matchesXanoPath(url, paths) {
    const pathname = xanoPathname(url)
    if (!pathname) return false
    for (let i = 0; i < paths.length; i++) {
      if (
        pathname === paths[i] ||
        (paths[i].endsWith('/') && pathname.indexOf(paths[i]) === 0)
      ) {
        return true
      }
    }
    return false
  }

  function blockedStagingMutation(url, method) {
    return (
      isEditProfilePage &&
      !isLiveEditHost &&
      method !== 'GET' &&
      method !== 'HEAD' &&
      matchesXanoPath(url, EDIT_PROFILE_MUTATION_PATHS)
    )
  }

  function readOnlyResponse(url) {
    log('blocked profile mutation in read-only mode', url)
    return Promise.resolve(
      new Response(
        JSON.stringify({
          message: 'Profile editing is disabled on this non-production domain.',
          code: 'EDIT_PROFILE_READ_ONLY',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
  }

  function withAuthHeader(init, token) {
    const next = Object.assign({}, init)
    const headers = new Headers((init && init.headers) || undefined)
    headers.set('Authorization', 'Bearer ' + token)
    next.headers = headers
    return next
  }

  function isRequestInput(input) {
    return typeof Request !== 'undefined' && input instanceof Request
  }

  function canonicalUrlInput(input) {
    if (typeof URL === 'undefined' || !input || typeof input !== 'object') {
      return null
    }
    try {
      return URL.prototype.toString.call(input)
    } catch {
      return null
    }
  }

  function requestProperty(input, property) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(
        Request.prototype,
        property,
      )
      return descriptor.get.call(input)
    } catch {
      return null
    }
  }

  function inspectFetch(input, init) {
    const requestInput = isRequestInput(input)
    let url = requestInput ? requestProperty(input, 'url') : null
    if (typeof input !== 'string') {
      const canonicalUrl = canonicalUrlInput(input)
      if (canonicalUrl !== null) {
        input = canonicalUrl
        url = canonicalUrl
      }
    }
    return {
      input: input,
      init: init,
      requestInput: requestInput,
      url: url || (typeof input === 'string' ? input : null),
      method:
        init && init.method
          ? String(init.method).toUpperCase()
          : requestInput
            ? String(requestProperty(input, 'method')).toUpperCase()
            : 'GET',
    }
  }

  function hasAuthHeader(inspected) {
    if (inspected.init && inspected.init.headers !== undefined) {
      return new Headers(inspected.init.headers).has('Authorization')
    }
    if (!inspected.requestInput) return false
    const headers = requestProperty(inspected.input, 'headers')
    return headers
      ? Headers.prototype.has.call(headers, 'Authorization')
      : false
  }

  function materializeRequest(inspected) {
    if (!inspected.requestInput) {
      return {
        input: inspected.input,
        init: inspected.init,
        request: null,
        url: inspected.url,
      }
    }
    const request = new Request(
      Request.prototype.clone.call(inspected.input),
      inspected.init,
    )
    return {
      input: request,
      init: undefined,
      request: request,
      url: request.url,
    }
  }

  function authenticatedRequest(request, token) {
    const headers = new Headers(request.headers)
    headers.set('Authorization', 'Bearer ' + token)
    return new Request(request.clone(), { headers: headers })
  }

  async function injectAuth(effective, originalFetch) {
    const request = effective.request
    let token
    try {
      token = await ensureXanoToken(originalFetch)
    } catch (err) {
      // fail-open: no session / trade failure -> original request unchanged
      // (gated endpoints answer 401, exactly what an unauthenticated call deserves)
      log('auth inject skipped for', effective.url, '-', err && err.message)
      return request
        ? originalFetch(request.clone())
        : originalFetch(effective.input, effective.init)
    }
    let res = request
      ? await originalFetch(authenticatedRequest(request, token))
      : await originalFetch(
          effective.input,
          withAuthHeader(effective.init, token),
        )
    if (res.status === 401) {
      // stale cached token — retrade once and retry
      invalidateXanoToken(token)
      try {
        token = await ensureXanoToken(originalFetch)
        res = request
          ? await originalFetch(authenticatedRequest(request, token))
          : await originalFetch(
              effective.input,
              withAuthHeader(effective.init, token),
            )
      } catch (err) {
        log('retrade after 401 failed -', err && err.message)
      }
    }
    return res
  }

  /* ========================== INSTALL ============================= */
  const originalFetch = window.fetch.bind(window)

  window.fetch = function (input, init) {
    const inspected = inspectFetch(input, init)
    const url = inspected.url
    const method = inspected.method

    if (blockedStagingMutation(url, method)) {
      return readOnlyResponse(url)
    }

    // Profile/child-record family: add the Bearer header, touch nothing else.
    // Supports both fetch(url, opts) and fetch(Request). The latter is used by
    // the inline work-history update/delete handlers on starter-edit-profile.
    if (
      matchesXanoPath(url, AUTH_INJECT_PATHS) &&
      method !== 'GET' &&
      method !== 'HEAD'
    ) {
      if (hasAuthHeader(inspected)) {
        return originalFetch(inspected.input, inspected.init)
      }
      return injectAuth(materializeRequest(inspected), originalFetch)
    }

    if (
      !matchesXanoPath(url, [ENDPOINT_PATH]) ||
      method !== 'POST' ||
      hasAuthHeader(inspected)
    ) {
      return originalFetch(inspected.input, inspected.init)
    }

    return (async () => {
      log('intercepting unauthenticated upload to', ENDPOINT_PATH)
      const body = (init && init.body) || (input && input.body)
      let image = null
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        image = body.get('image')
      }
      if (!image) {
        log('no image field found, passing through with auth header only')
      }

      const token = await ensureXanoToken(originalFetch)

      const outgoing = new FormData()
      if (image) {
        const blob = await resizeImage(image)
        const filename =
          blob === image && image.name ? image.name : 'profile-photo.jpg'
        outgoing.append('image', blob, filename)
      }

      // deliberately NOT forwarding member_id — the endpoint derives the
      // caller from the token and ignores it; keep the request minimal
      const res = await originalFetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: outgoing,
      })
      if (res.status === 401) invalidateXanoToken(token)
      log('upload response', res.status)
      // Inline edit-profile uploader is a click-driven fetch (not a native WF
      // submit), so the sitewide posthog-track.js form hook can't see it —
      // track the failure here, matching the bridge_error event used elsewhere.
      if (!res.ok && window.StartersTrack) {
        window.StartersTrack.track('bridge_error', {
          path: 'build_profile/starter/profile_image',
          status: res.status,
          via: 'edit-profile-shim',
        })
      }
      return res
    })()
  }

  log('installed')
})()
