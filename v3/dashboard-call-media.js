/**
 * Read-only notetaker media for canonical dashboard bookings.
 *
 * The module does not fetch the provider transcript URL in the browser. Xano
 * has no current authenticated V3 transcript proxy with an exact ownership
 * contract, so transcript rendering remains closed.
 */
;(function (global) {
  'use strict'

  const isCommonJs =
    typeof module !== 'undefined' && typeof module.exports !== 'undefined'
  const XANO_SCHEDULING_BASE =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'
  const MEDIA_PATH = '/notetaker/get_media/v3'

  function clean(value) {
    return String(value == null ? '' : value).trim()
  }

  function canReadMedia(booking) {
    return (
      clean(booking && booking.notetaker_id) !== '' &&
      clean(booking && booking.grant_id) !== '' &&
      ['completed', 'archived'].includes(
        clean(booking && booking.status).toLowerCase(),
      )
    )
  }

  function safeHttpsUrl(value) {
    const input = clean(value)
    if (!input) return ''
    try {
      const parsed = new URL(input)
      return parsed.protocol === 'https:' ? parsed.href : ''
    } catch (_error) {
      return ''
    }
  }

  function normalizeMedia(body) {
    const provider =
      body && body.response && body.response.result
        ? body.response
        : body && body.result
          ? body
          : null
    if (
      !provider ||
      Number(provider.status) < 200 ||
      Number(provider.status) >= 300
    ) return null
    const data = provider.result && provider.result.data
    if (!data || typeof data !== 'object') return null
    const recording = data.audio || data.recording || {}
    const transcript = data.transcript || {}
    return {
      recording_url: safeHttpsUrl(recording.url),
      recording_duration: Number(recording.duration || data.recording_duration || 0),
      transcript_available: safeHttpsUrl(transcript.url) !== '',
    }
  }

  async function getMedia(booking) {
    if (
      !canReadMedia(booking) ||
      typeof global.xanoAuthFetch !== 'function'
    ) return null
    const response = await global.xanoAuthFetch(
      XANO_SCHEDULING_BASE + MEDIA_PATH,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notetaker_id: clean(booking.notetaker_id),
          grant_id: clean(booking.grant_id),
        }),
      },
    )
    const body = await response.json().catch(function () {
      return null
    })
    const media = normalizeMedia(body)
    if (!response.ok || !media) {
      throw new Error('Canonical notetaker media request failed')
    }
    return media
  }

  function renderMedia(modal, media) {
    if (!modal || !media || typeof modal.querySelector !== 'function') {
      return false
    }
    const container = modal.querySelector('[notetaker-media=container]')
    const recording = modal.querySelector('[notetaker-media=recording]')
    const transcription = modal.querySelector('[notetaker-media=transcription]')
    if (!container || !recording) return false
    if (media.recording_url) {
      recording.href = media.recording_url
      recording.textContent = media.recording_duration > 0
        ? 'Open recording (' + Math.round(media.recording_duration) + ' sec)'
        : 'Open recording'
      recording.style.display = ''
    } else {
      recording.removeAttribute('href')
      recording.textContent = 'Recording is not available.'
      recording.style.display = ''
    }
    if (transcription) {
      transcription.textContent = media.transcript_available
        ? 'Transcript access is not available in this dashboard yet.'
        : 'Transcript is not available.'
    }
    container.style.display = ''
    return true
  }

  function wire(options) {
    const settings = options || {}
    const document = settings.document || global.document
    if (
      !document ||
      typeof document.addEventListener !== 'function' ||
      typeof settings.getBooking !== 'function'
    ) return false
    document.addEventListener(
      'click',
      async function (event) {
        const target = event && event.target
        const button =
          target &&
          target.closest &&
          target.closest(
            '[booking-action-btn="notetaker-media"], [booking-card-action-btn="notetaker-media"]',
          )
        if (!button) return
        const booking = settings.getBooking(button)
        if (!canReadMedia(booking)) return
        if (event.preventDefault) event.preventDefault()
        if (event.stopImmediatePropagation) event.stopImmediatePropagation()
        else if (event.stopPropagation) event.stopPropagation()
        if (button.__startersMediaBusy) return
        button.__startersMediaBusy = true
        button.setAttribute('aria-busy', 'true')
        try {
          const media = await getMedia(booking)
          const modal =
            button.closest &&
            button.closest(
              '[popup-booking-info], dialog[data-modal-target="popup-booking-info"]',
            )
          if (!renderMedia(modal, media)) {
            throw new Error('Authored notetaker media elements are unavailable')
          }
        } catch (error) {
          console.error(
            '[dashboard-call-media] read failed closed:',
            error && error.message,
          )
        } finally {
          button.__startersMediaBusy = false
          button.setAttribute('aria-busy', 'false')
        }
      },
      true,
    )
    return true
  }

  const api = {
    canReadMedia,
    getMedia,
    normalizeMedia,
    renderMedia,
    safeHttpsUrl,
    wire,
  }
  if (isCommonJs) module.exports = api
  else global.StartersDashboardCallMedia = api
})(typeof window === 'undefined' ? globalThis : window)
