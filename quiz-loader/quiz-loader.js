/**
 * Starter Quiz loading component — head-time gate + "results ready" producer.
 *
 * This script loads SYNCHRONOUSLY in the /quiz-results page head (registered,
 * no defer). It does two jobs:
 *
 * JOB 1 — Skip-on-refresh paint gate (runs at parse time, before <body>).
 *   The loading component is a Webflow DevLink React component. At publish
 *   time DevLink PRE-RENDERS its current scene into a `<code-island
 *   data-hydrate="true">` host (declarative shadow DOM), so on a refresh that
 *   should NOT replay the loader, the pre-rendered scene would still be painted
 *   from HTML paint until React hydration takes over. To guarantee ZERO frames
 *   of the loader on such a refresh, we make the skip decision synchronously in
 *   the head — before the body exists — and, when skipping, inject a <style>
 *   that hides the loader host until React hydrates and removes it for real.
 *
 *   The gate DUPLICATES the component's own sessionStorage skip rule BY DESIGN.
 *   The component remains the authority AFTER hydration; this gate only governs
 *   the pre-hydration paint window the component cannot reach in time. The two
 *   rules must stay in sync — see computeQuizRunId() / the consumer contract.
 *
 * JOB 2 — "results ready" producer signal (unchanged from v1).
 *   quiz-results.js calls window.StartersQuizLoader.signalReady() when the
 *   results are settled. The handshake with the React consumer is tiny and
 *   race-proof because the component may mount before OR after results finish:
 *     1. Producer sets `window.__starterQuizResultsReady = true` FIRST.
 *     2. Producer then dispatches `document`-level CustomEvent
 *        `starterQuizResults:ready`.
 *   A late-mounting component reads the durable flag synchronously; an already
 *   mounted one hears the event. Flag-before-dispatch means a late consumer is
 *   never stuck waiting for an event that already fired. signalReady() is
 *   idempotent.
 *
 * sessionStorage keys `starterQuizPending` / `starterQuizLoaderPlayed` are
 * owned by other quiz code; this script only READS them, never writes.
 */
;(() => {
    const controllerFlag = 'startersQuizLoaderController'
    const readyFlag = '__starterQuizResultsReady'
    const readyEventName = 'starterQuizResults:ready'
    const debugLogPrefix = '[Starter Quiz Funnel]'

    const pendingStorageKey = 'starterQuizPending'
    const loaderPlayedStorageKey = 'starterQuizLoaderPlayed'
    const skipGateStyleId = 'starters-quiz-loader-skip-gate'

    // Loader host selector CONTRACT (verified live on staging): DevLink renders
    // the loading component into a `<code-island>` host whose `data-props` JSON
    // attribute lists the component's prop names. `statusStep1` is a stable,
    // loader-specific prop name, so this substring match targets the loader host
    // without catching other code-islands on the page. If that prop is renamed
    // in the component, THIS SELECTOR MUST CHANGE TOO (and vice versa) — a
    // rename on either side silently breaks the skip-on-refresh paint gate.
    const loaderHostSelector = 'code-island[data-props*="statusStep1"]'

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
     * Computes the quiz "run id" using EXACTLY the consumer component's rule:
     * String(parsed(starterQuizPending).updatedAt) when parseable and non-empty,
     * otherwise the literal "no-pending". Read-only; an unparseable payload is a
     * normal case (falls through to "no-pending"), not an error.
     *
     * @returns {string} The current run id.
     */
    function computeQuizRunId() {
        const rawPending = sessionStorage.getItem(pendingStorageKey)

        if (rawPending) {
            try {
                const parsed = JSON.parse(rawPending)
                const updatedAt = parsed && parsed.updatedAt
                const normalized = String(updatedAt == null ? '' : updatedAt)
                if (normalized) return normalized
            } catch (error) {
                // Unparseable pending payload → shared default below.
            }
        }

        return 'no-pending'
    }

    /**
     * Synchronous skip-on-refresh paint gate. Runs at parse time (document.head
     * exists, document.body does not — no DOMContentLoaded dependency). When the
     * run should skip the loader, injects a <style> hiding the DevLink loader
     * host so the pre-rendered scene never paints before hydration. Any failure
     * means NO gate: the loader simply plays, the same graceful degradation as
     * before this gate existed.
     *
     * @returns {void}
     */
    function applySkipPaintGate() {
        try {
            const runId = computeQuizRunId()
            const played = sessionStorage.getItem(loaderPlayedStorageKey)
            const shouldSkip = played === runId

            if (!shouldSkip) {
                log('skip-gate: play loader (marker != run id)', {
                    runId,
                    played,
                })
                return
            }

            if (document.getElementById(skipGateStyleId)) {
                log('skip-gate: already injected', { runId })
                return
            }

            const style = document.createElement('style')
            style.id = skipGateStyleId
            style.textContent = loaderHostSelector + '{display:none !important}'
            document.head.appendChild(style)

            log('skip-gate: hiding loader host (skip-on-refresh)', {
                runId,
                selector: loaderHostSelector,
            })
        } catch (error) {
            log('skip-gate: errored; loader will play', { error })
        }
    }

    // Run the paint gate immediately, synchronously, at head-parse time.
    applySkipPaintGate()

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
