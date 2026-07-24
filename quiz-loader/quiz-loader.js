/**
 * Starter Quiz loading component — "results ready" producer signal.
 *
 * The /quiz-results page shows a loading component (a Webflow DevLink React
 * component) while quiz-results.js resolves the quiz payload and renders the
 * recommendation sections. That component needs to know when the results are
 * settled so it can dismiss the overlay.
 *
 * The handshake (producer = this side / quiz-results.js, consumer = the React
 * component) is deliberately tiny and race-proof, because the component may
 * mount EITHER before OR after the results finish:
 *
 *   1. Producer sets `window.__starterQuizResultsReady = true` FIRST.
 *   2. Producer then dispatches `document`-level CustomEvent
 *      `starterQuizResults:ready`.
 *
 *   - A component that mounts LATE reads the flag synchronously at mount and
 *     dismisses immediately (it missed the event, but the flag is durable).
 *   - A component that is ALREADY mounted hears the event and dismisses then.
 *
 * Order matters: flag-before-dispatch guarantees a late consumer never gets
 * stuck waiting for an event that already fired. `signalReady()` is idempotent,
 * so it is safe to call from several terminal code paths / more than once.
 *
 * This module only EXPOSES the signal (`window.StartersQuizLoader.signalReady`).
 * quiz-results.js decides WHEN to call it (on every outcome that leaves the
 * visitor on the page). If quiz-results.js loads before this file, it falls
 * back to applying the same flag-then-dispatch contract inline, so the loader
 * script is a convenience, never a hard dependency.
 *
 * sessionStorage keys `starterQuizPending` / `starterQuizLoaderPlayed` are owned
 * by other quiz code and are intentionally NOT touched here.
 */
;(() => {
    const controllerFlag = 'startersQuizLoaderController'
    const readyFlag = '__starterQuizResultsReady'
    const readyEventName = 'starterQuizResults:ready'
    const debugLogPrefix = '[Starter Quiz Funnel]'

    // --- Staging-only diagnostics -------------------------------------------
    // Dev logs help while wiring the loader but must NEVER reach the production
    // console. "Staging" = Webflow's *.webflow.io, local dev, or the cloudflared
    // dev tunnel. Force on/off with window.STARTERS_QUIZ_LOADER_DEBUG = true/false.
    function isDebugLoggingEnabled() {
        if (window.STARTERS_QUIZ_LOADER_DEBUG === true) return true
        if (window.STARTERS_QUIZ_LOADER_DEBUG === false) return false

        const host = window.location.hostname
        return (
            host === 'localhost' ||
            host === '127.0.0.1' ||
            /(^|\.)webflow\.io$/.test(host) ||
            /(^|\.)trycloudflare\.com$/.test(host)
        )
    }

    function log(message, data) {
        if (!isDebugLoggingEnabled()) return

        if (typeof data === 'undefined') {
            console.log(debugLogPrefix, '[loader]', message)
            return
        }

        console.log(debugLogPrefix, '[loader]', message, data)
    }

    if (window[controllerFlag]) {
        log('duplicate script skipped', { scriptFlag: controllerFlag })
        return
    }

    window[controllerFlag] = true

    /**
     * Announces that the quiz results are settled so the loading component can
     * dismiss. Applies the producer contract in order (flag first, then event)
     * and is idempotent: repeat calls after the first are no-ops.
     *
     * @returns {void}
     */
    function signalReady() {
        if (window[readyFlag] === true) {
            log('signalReady called again; already ready (no-op)')
            return
        }

        window[readyFlag] = true
        document.dispatchEvent(new CustomEvent(readyEventName))
        log('results ready: flag set then event dispatched', {
            readyFlag,
            readyEventName,
        })
    }

    // Preserve any object a peer/earlier script already placed here; only add
    // (or refresh) our own signalReady surface.
    const existing = window.StartersQuizLoader
    window.StartersQuizLoader =
        existing && typeof existing === 'object'
            ? Object.assign(existing, { signalReady })
            : { signalReady }

    log('installed', { controllerFlag })
})()
