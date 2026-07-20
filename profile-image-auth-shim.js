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
 * ⏳ Interim bridge: remove once the wizard's own uploadImage() adopts the
 * new contract (see product-workflows/freelancer-profiles/photo-migration/
 * build-profile-wizard-AUTH-PATCH-20260714.md).
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
  const XANO_AUTH_URL =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh/auth/trade-token/v3'
  const MAX_DIMENSION = 800 // px, longest side after resize
  const JPEG_QUALITY = 0.8
  const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 // server precondition

  /* ========================= AUTH BRIDGE ========================== */
  let _xanoToken = null

  async function ensureXanoToken(fetchFn) {
    if (_xanoToken) return _xanoToken
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
    _xanoToken = typeof data === 'string' ? data : data && (data.authToken || data.token)
    if (!_xanoToken) throw new Error('trade-token returned no token')
    return _xanoToken
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
  function requestUrl(input) {
    if (typeof input === 'string') return input
    if (input && typeof input.url === 'string') return input.url // Request
    return String(input)
  }

  function requestMethod(input, init) {
    if (init && init.method) return String(init.method).toUpperCase()
    if (input && typeof input.method === 'string') return input.method.toUpperCase()
    return 'GET'
  }

  function hasAuthHeader(input, init) {
    const headers = (init && init.headers) || (input && input.headers)
    if (!headers) return false
    if (typeof headers.has === 'function') return headers.has('Authorization')
    if (Array.isArray(headers)) {
      return headers.some((pair) => String(pair[0]).toLowerCase() === 'authorization')
    }
    return Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')
  }

  /* ========================== INSTALL ============================= */
  const originalFetch = window.fetch.bind(window)

  window.fetch = function (input, init) {
    const url = requestUrl(input)
    if (
      url.indexOf(ENDPOINT_PATH) === -1 ||
      requestMethod(input, init) !== 'POST' ||
      hasAuthHeader(input, init)
    ) {
      return originalFetch(input, init)
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
      if (res.status === 401) _xanoToken = null // stale token — retrade next time
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
