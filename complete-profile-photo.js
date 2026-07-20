/**
 * /complete-profile — profile photo upload (The Starters 3.0 site).
 *
 * Wires the decorative upload widget (`.app-form_upload.is-complete-profile`)
 * to Xano `build_profile/starter/profile_image` (group "V3.0 Starters"):
 *   1. Memberstack member JWT → api:g1vmSLWh/auth/trade-token/v3 → user_v3 token
 *      (same auth bridge as opportunities-3.0.js — the endpoint is auth-gated
 *      and derives the starter row from the token; no member_id is sent).
 *   2. Client-side canvas resize (longest side ≤ 800px, JPEG q0.8) so the
 *      server's 2MB cap is never the user's problem.
 *   3. POST multipart FormData { image } with the Authorization header.
 *
 * ⛔ Ships together with the endpoint's v3 auth draft (see
 * product-workflows/freelancer-profiles/photo-migration/UPLOAD-ENDPOINT-DESIGN.md).
 * Against the live v1/v2 endpoint this script still works only if the endpoint
 * accepts the request without member_id — it does not — so do not deploy this
 * script before Publish Now on endpoint 1196's draft.
 */
;(function () {
  'use strict'

  /* ============================ CONFIG ============================ */
  const DEBUG_LOG = true
  const log = (...args) => {
    if (DEBUG_LOG) console.info('[cp-photo]', ...args)
  }

  const XANO_AUTH_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh' // WMX group: trade-token
  const XANO_TRADE_TOKEN_PATH = '/auth/trade-token/v3'
  const UPLOAD_URL =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/build_profile/starter/profile_image'

  const WIDGET_SELECTOR = '.app-form_upload.is-complete-profile'
  const BUTTON_SELECTOR = '.upload-btn'
  const ACCEPT_MIME = ['image/jpeg', 'image/png', 'image/webp']
  const MAX_DIMENSION = 800 // px, longest side after resize
  const JPEG_QUALITY = 0.8
  const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 // server precondition; resize keeps us far under

  /* ========================= AUTH BRIDGE ========================== */
  let _xanoToken = null

  async function getMemberstackToken() {
    const ms = window.$memberstackDom
    if (!ms) throw new Error('Memberstack not available')
    const token = await ms.getMemberCookie()
    if (!token) throw new Error('No Memberstack session (member not logged in)')
    return token
  }

  async function ensureXanoToken() {
    if (_xanoToken) return _xanoToken
    const msToken = await getMemberstackToken()
    const res = await fetch(
      `${XANO_AUTH_BASE}${XANO_TRADE_TOKEN_PATH}?token=${encodeURIComponent(msToken)}`,
    )
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      throw Object.assign(new Error('trade-token failed'), { status: res.status, data })
    }
    _xanoToken = typeof data === 'string' ? data : data.authToken || data.token
    if (!_xanoToken) throw new Error('trade-token returned no token')
    return _xanoToken
  }

  /* ========================== RESIZE ============================== */
  /**
   * Downscale so the longest side is ≤ MAX_DIMENSION and re-encode as JPEG.
   * Never upscales. Returns a Blob ready for FormData.
   * @param {File} file
   * @returns {Promise<Blob>}
   */
  async function resizeImage(file) {
    const bitmap = await createImageBitmap(file).catch(() => null)
    if (!bitmap) throw new Error('Could not read the image file')
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
    bitmap.close && bitmap.close()
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    )
    if (!blob) throw new Error('Image encode failed')
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error('Image is too large even after resizing')
    return blob
  }

  /* ========================== UPLOAD ============================== */
  async function uploadPhoto(file) {
    const [token, blob] = await Promise.all([ensureXanoToken(), resizeImage(file)])
    const body = new FormData()
    body.append('image', blob, 'profile-photo.jpg')
    // no Content-Type header — the browser sets the multipart boundary
    const res = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      throw Object.assign(new Error(data && data.message ? data.message : `Upload failed (${res.status})`), {
        status: res.status,
        data,
      })
    }
    return data // { starter_image, starter_image_small }
  }

  /* ============================ UI ================================ */
  function init() {
    const widget = document.querySelector(WIDGET_SELECTOR)
    if (!widget) return log('no upload widget on this page')
    const button = widget.querySelector(BUTTON_SELECTOR)
    const statusEl = widget.querySelector('.text-size-14')
    const idleText = statusEl ? statusEl.textContent : ''
    const setStatus = (text) => {
      if (statusEl) statusEl.textContent = text || idleText
    }

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = ACCEPT_MIME.join(',')
    input.style.display = 'none'
    input.setAttribute('data-cp-photo-input', '')
    // keep it OUT of the surrounding Webflow form so form serialization,
    // wf-validate, and the form-flow engine never see it
    document.body.appendChild(input)

    let preview = null
    const showPreview = (url) => {
      if (!preview) {
        preview = document.createElement('img')
        preview.alt = 'Profile photo preview'
        preview.setAttribute('data-cp-photo-preview', '')
        preview.style.cssText =
          'width:72px;height:72px;border-radius:50%;object-fit:cover;margin-bottom:8px;'
        widget.insertBefore(preview, widget.firstChild)
      }
      preview.src = url
    }

    let busy = false
    async function handleFile(file) {
      if (busy || !file) return
      if (ACCEPT_MIME.indexOf(file.type) === -1) {
        setStatus('Please choose a jpg, png, or webp image')
        return
      }
      busy = true
      setStatus('Uploading…')
      try {
        const data = await uploadPhoto(file)
        showPreview(data.starter_image_small || data.starter_image)
        setStatus('Photo uploaded ✓')
        log('uploaded', data)
      } catch (err) {
        log('upload error', err)
        // Photo upload is a click-driven fetch (no native WF submit), so the sitewide
        // form hook in posthog-track.js can't see it — track the failure here.
        if (window.StartersTrack)
          window.StartersTrack.track('bridge_error', {
            path: 'build_profile/starter/profile_image',
            status: (err && err.status) || 0,
          })
        setStatus(
          err && err.status === 401
            ? 'Please log in again to upload a photo'
            : (err && err.message) || 'Upload failed — please try again',
        )
      } finally {
        busy = false
        input.value = ''
      }
    }

    if (button) {
      button.addEventListener('click', (e) => {
        e.preventDefault()
        input.click()
      })
    }
    input.addEventListener('change', () => handleFile(input.files && input.files[0]))

    // drag & drop onto the widget
    ;['dragenter', 'dragover'].forEach((name) =>
      widget.addEventListener(name, (e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }),
    )
    widget.addEventListener('drop', (e) => {
      e.preventDefault()
      handleFile(e.dataTransfer.files && e.dataTransfer.files[0])
    })

    log('init ok')
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
