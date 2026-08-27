/**
 * V3 invited Starter review form controller.
 *
 * Designer and security contract: v3/README.md#invited-starter-review-form
 */
(function () {
    'use strict'

    var API_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30'
    var CONTEXT_PATH = '/starter/reviews/invited/context/resolve'
    var SUBMIT_PATH = '/starter/reviews/invited/submit'
    var TOKEN_MIN = 20
    var TOKEN_MAX = 128
    var REVIEW_MIN = 10
    var REVIEW_MAX = 4000
    var FEEDBACK_MAX = 2000
    var REQUEST_TIMEOUT_MS = 15000
    var CONTEXT_ATTEMPTS = 2
    var PREFLIGHT_ID = 'starter-review-preflight'
    var PROFILE_BOUND_ATTRIBUTE = 'data-starter-review-profile-bound'
    var PROFILE_URL_ATTRIBUTE = 'data-starter-review-profile-url'
    var PREFLIGHT_CSS =
        '[data-starter-review]:not([data-starter-review-current-state])' +
        ' [data-starter-review-state]' +
        ':not([data-starter-review-state="loading"])' +
        ' { display: none !important; }'

    var normalize = function (value) {
        return String(value == null ? '' : value).trim()
    }

    var getTokenAndSanitizedUrl = function (href) {
        var url = new URL(href)
        var hash = new URLSearchParams(url.hash.replace(/^#/, ''))
        var token = normalize(hash.get('token'))

        url.searchParams.delete('token')
        url.hash = ''

        return {
            token: token,
            sanitized: url.pathname + (url.search ? url.search : ''),
        }
    }

    var sanitizeAnalyticsUrl = function (value) {
        if (typeof value !== 'string' || !/[?#&]token=/i.test(value)) return value

        try {
            var absolute = /^[a-z][a-z\d+.-]*:/i.test(value)
            var url = new URL(value, window.location.origin)
            url.searchParams.delete('token')
            var hash = new URLSearchParams(url.hash.replace(/^#/, ''))
            hash.delete('token')
            url.hash = hash.toString() ? '#' + hash.toString() : ''
            return absolute
                ? url.toString()
                : url.pathname + url.search + url.hash
        } catch (error) {
            return value
        }
    }

    var redactAnalyticsEvent = function (event) {
        if (!event || typeof event !== 'object') return event

        var redact = function (value, key, depth) {
            if (/(^|_)token$/i.test(key)) return '[redacted]'
            if (typeof value === 'string') return sanitizeAnalyticsUrl(value)
            if (!value || typeof value !== 'object' || depth > 4) return value

            Object.keys(value).forEach(function (childKey) {
                value[childKey] = redact(value[childKey], childKey, depth + 1)
            })
            return value
        }

        return redactAnalyticsEvent.previous
            ? redactAnalyticsEvent.previous(redact(event, '', 0))
            : redact(event, '', 0)
    }

    redactAnalyticsEvent.previous = window.__startersV3ReviewPosthogBeforeSend
    window.__startersV3ReviewPosthogBeforeSend = redactAnalyticsEvent

    var tokenResult = getTokenAndSanitizedUrl(window.location.href)
    window.history.replaceState(window.history.state, '', tokenResult.sanitized)
    var initialCapabilityToken = tokenResult.token

    if (window.__startersV3ReviewFormBooted) return
    window.__startersV3ReviewFormBooted = true

    // Pre-hide every non-loading state block. A synchronous head tag runs before
    // the body parses, so this lands before any block can paint. The rule is gated
    // on the root lacking data-starter-review-current-state, so the first setState
    // disarms it and setHidden's inline writes own visibility from there.
    // The id check defers to a legacy page paste that still ships its own
    // starter-review-preflight style; failure to inject degrades to the inline
    // writes alone.
    try {
        if (!document.getElementById(PREFLIGHT_ID)) {
            var preflight = document.createElement('style')
            preflight.id = PREFLIGHT_ID
            preflight.textContent = PREFLIGHT_CSS
            document.head.appendChild(preflight)
        }
    } catch (error) {}

    var makeIdempotencyKey = function () {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return 'review:' + window.crypto.randomUUID()
        }

        return (
            'review:' +
            Date.now().toString(36) +
            ':' +
            Math.random().toString(36).slice(2, 14)
        )
    }

    var buildSubmission = function (values, idempotencyKey) {
        var rating = Number(values.rating)
        var reviewText = normalize(values.review_text)
        var privateFeedback = normalize(values.private_feedback)

        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return { ok: false, message: 'Choose a rating from 1 to 5.' }
        }
        if (reviewText.length < REVIEW_MIN || reviewText.length > REVIEW_MAX) {
            return {
                ok: false,
                message: 'Write a review between 10 and 4,000 characters.',
            }
        }
        if (privateFeedback.length > FEEDBACK_MAX) {
            return {
                ok: false,
                message: 'Private feedback must be 2,000 characters or less.',
            }
        }

        return {
            ok: true,
            payload: {
                rating: rating,
                review_text: reviewText,
                private_feedback: privateFeedback,
                idempotency_key: idempotencyKey,
            },
        }
    }

    var requestError = function (status) {
        var error = new Error('The review request could not be completed.')
        error.status = status
        return error
    }

    var timedOutError = function () {
        var error = requestError(0)
        error.timedOut = true
        return error
    }

    // A hung request would spin the loading state forever: by then the pre-hide
    // rule is disarmed and only a rejection can move the UI on. The deadline is
    // armed unconditionally and rejects on its own — gating it on AbortController
    // would drop the timeout in exactly the environments that need it most, and a
    // signal-ignoring polyfill would leave the request hanging regardless.
    // Aborting the socket is best-effort on top. Same shape as fetchWithTimeout in
    // v3/onboarding-done-redirect.js.
    var postJson = function (path, body) {
        var options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
        }

        var controller =
            typeof window.AbortController === 'function'
                ? new window.AbortController()
                : null
        if (controller) options.signal = controller.signal

        return new Promise(function (resolve, reject) {
            var settled = false
            var timer = window.setTimeout(function () {
                if (settled) return
                settled = true
                if (controller) {
                    try {
                        controller.abort()
                    } catch (error) {}
                }
                reject(timedOutError())
            }, REQUEST_TIMEOUT_MS)

            Promise.resolve()
                .then(function () {
                    return fetch(API_BASE + path, options)
                })
                .then(function (response) {
                    return response
                        .json()
                        .catch(function () {
                            return {}
                        })
                        .then(function (payload) {
                            if (!response.ok) throw requestError(response.status)
                            return payload
                        })
                })
                .then(
                    function (payload) {
                        if (settled) return
                        settled = true
                        window.clearTimeout(timer)
                        resolve(payload)
                    },
                    function (error) {
                        if (settled) return
                        settled = true
                        window.clearTimeout(timer)
                        // Never mask a real failure. An error that already carries
                        // a numeric status keeps it, even when it lands next to the
                        // deadline; only a status-free abort becomes a timeout.
                        if (
                            error &&
                            typeof error.status !== 'number' &&
                            error.name === 'AbortError'
                        ) {
                            reject(timedOutError())
                            return
                        }
                        reject(error)
                    },
                )
        })
    }

    // The context resolve is read-only and idempotent, so one automatic retry on a
    // timeout is worth it: a single stalled connection stops costing the member the
    // whole page. Only timeouts retry, and only here — a submit retry stays the
    // member's own decision, by design.
    var resolveContext = async function (token) {
        var attempt = 0
        for (;;) {
            attempt += 1
            try {
                return await postJson(CONTEXT_PATH, { token: token })
            } catch (error) {
                if (attempt >= CONTEXT_ATTEMPTS || !(error && error.timedOut)) {
                    throw error
                }
            }
        }
    }

    var capture = function (name, properties) {
        if (!window.posthog || typeof window.posthog.capture !== 'function') return
        try {
            window.posthog.capture(name, properties || {})
        } catch (error) {}
    }

    // Designer classes (`display: flex`, the base `img { display: inline-block }`)
    // outrank the UA `[hidden] { display: none }` rule, so hide inline as well.
    var setHidden = function (node, hide) {
        node.hidden = hide
        node.style.display = hide ? 'none' : ''
    }

    // The marked node is a plain anchor, or the design-system Button component.
    // That component ships in two flavors: an absolutely-positioned
    // `a.clickable_link` inside `div.button_main-wrap`, or a `button.clickable_btn`
    // with no anchor at all. Anchors carry the destination as an href; the button
    // flavor needs a click handler. Both open a new tab, so this page's
    // token-bearing history entry — and any review already typed — survive.
    // Callers must gate this on the /hire/<slug> allowlist first.
    var bindProfileLink = function (node, profileUrl) {
        // Only the component's own link element counts. A decorative anchor
        // elsewhere in the subtree must not absorb the destination.
        var anchor =
            String(node.tagName || '').toUpperCase() === 'A'
                ? node
                : node.querySelector('a.clickable_link')

        if (anchor) {
            anchor.setAttribute('href', profileUrl)
            anchor.setAttribute('target', '_blank')
            anchor.setAttribute('rel', 'noopener')
            return
        }

        // The handler reads the destination at click time, so a re-resolve that
        // returns a different profile updates it even though the listener binds
        // only once. Write it before the guard for that reason.
        node.setAttribute(PROFILE_URL_ATTRIBUTE, profileUrl)
        if (node.getAttribute(PROFILE_BOUND_ATTRIBUTE) === 'true') return
        node.setAttribute(PROFILE_BOUND_ATTRIBUTE, 'true')
        // Capture phase plus stopPropagation so this owns the click before any
        // component-level or delegated handler sees it, and preventDefault so a
        // nested <button> can never submit a surrounding form.
        node.addEventListener(
            'click',
            function (event) {
                event.preventDefault()
                event.stopPropagation()
                var url = node.getAttribute(PROFILE_URL_ATTRIBUTE)
                if (!url) return
                // Popup blockers and in-app webviews hand back null. A same-tab
                // trip costs this page's history entry, but it beats a button
                // that does nothing at all.
                if (!window.open(url, '_blank', 'noopener')) {
                    window.location.assign(url)
                }
            },
            true,
        )
    }

    var init = async function () {
        var root = document.querySelector('[data-starter-review]')
        if (!root) {
            initialCapabilityToken = ''
            return
        }

        var capabilityToken = initialCapabilityToken
        initialCapabilityToken = ''
        var setState = function (name) {
            root.setAttribute('data-starter-review-current-state', name)
            root.querySelectorAll('[data-starter-review-state]').forEach(function (node) {
                setHidden(node, node.getAttribute('data-starter-review-state') !== name)
            })
        }
        var setError = function (message) {
            var node = root.querySelector('[data-starter-review-error]')
            if (node) node.textContent = message || ''
        }

        if (
            capabilityToken.length < TOKEN_MIN ||
            capabilityToken.length > TOKEN_MAX
        ) {
            setState('unavailable')
            capture('v3_starter_review_unavailable', { reason: 'missing_or_invalid_token' })
            return
        }

        setState('loading')

        try {
            var context = await resolveContext(capabilityToken)
            if (!context || context.available !== true || !context.starter) {
                throw new Error('Review context is unavailable.')
            }

            var nameNode = root.querySelector('[data-starter-review-name]')
            var headlineNode = root.querySelector('[data-starter-review-headline]')
            var photoNode = root.querySelector('[data-starter-review-photo]')
            var profileNode = root.querySelector('[data-starter-review-profile-link]')

            if (nameNode) nameNode.textContent = normalize(context.starter.name) || 'Starter'
            if (headlineNode) {
                var headline = normalize(context.starter.headline)
                headlineNode.textContent = headline
                setHidden(headlineNode, !headline)
            }
            if (photoNode) {
                var photoUrl = normalize(context.starter.photo_url)
                var hasPhoto = /^https:\/\//i.test(photoUrl)
                setHidden(photoNode, !hasPhoto)
                if (hasPhoto) {
                    // Designer imgs carry a placeholder srcset/sizes pair, and a
                    // w-descriptor srcset outranks the src we set below.
                    photoNode.removeAttribute('srcset')
                    photoNode.removeAttribute('sizes')
                    photoNode.setAttribute('src', photoUrl)
                }
            }
            if (profileNode) {
                var profileUrl = normalize(context.starter.profile_url)
                var hasProfile = /^\/hire\/[a-z0-9-]+$/i.test(profileUrl)
                setHidden(profileNode, !hasProfile)
                if (hasProfile) bindProfileLink(profileNode, profileUrl)
            }

            var form = root.querySelector('form[data-starter-review-form]')
            if (!form) throw new Error('The review form is not configured.')

            var idempotencyKey = makeIdempotencyKey()
            var pendingSubmission = null
            var submitting = false
            form.addEventListener('submit', async function (event) {
                event.preventDefault()
                event.stopImmediatePropagation()
                if (submitting) return
                setError('')

                if (!pendingSubmission) {
                    var selectedRating = form.querySelector('[name="rating"]:checked')
                    var reviewField = form.querySelector('[name="review_text"]')
                    var feedbackField = form.querySelector('[name="private_feedback"]')
                    var submission = buildSubmission(
                        {
                            rating: selectedRating ? selectedRating.value : '',
                            review_text: reviewField ? reviewField.value : '',
                            private_feedback: feedbackField ? feedbackField.value : '',
                        },
                        idempotencyKey,
                    )

                    if (!submission.ok) {
                        setError(submission.message)
                        return
                    }

                    pendingSubmission = submission.payload
                    form.querySelectorAll(
                        '[name="rating"], [name="review_text"], [name="private_feedback"]',
                    ).forEach(function (field) {
                        field.disabled = true
                    })
                }

                var submitButton = form.querySelector('[type="submit"]')
                if (submitButton) submitButton.disabled = true
                submitting = true

                try {
                    var result = await postJson(SUBMIT_PATH, {
                        token: capabilityToken,
                        rating: pendingSubmission.rating,
                        review_text: pendingSubmission.review_text,
                        private_feedback: pendingSubmission.private_feedback,
                        idempotency_key: pendingSubmission.idempotency_key,
                    })
                    if (!result || result.accepted !== true) {
                        throw new Error('Review submission was not accepted.')
                    }

                    capabilityToken = ''
                    setState('success')
                    capture('v3_starter_review_submitted', {
                        duplicate: result.duplicate === true,
                    })
                } catch (error) {
                    submitting = false
                    if (submitButton) submitButton.disabled = false
                    setError('We could not submit your review. Try again.')
                    setState('form')
                    var failedProperties = {
                        status: Number(error && error.status) || 0,
                    }
                    if (error && error.timedOut === true) {
                        failedProperties.timed_out = true
                    }
                    capture('v3_starter_review_submit_failed', failedProperties)
                }
            }, true)

            setState('form')
            capture('v3_starter_review_form_viewed')
        } catch (error) {
            capabilityToken = ''
            setState('unavailable')
            var unavailableProperties = {
                reason: Number(error && error.status) === 404 ? 'not_found' : 'load_failed',
            }
            if (error && error.timedOut === true) {
                unavailableProperties.timed_out = true
            }
            capture('v3_starter_review_unavailable', unavailableProperties)
        }
    }

    if (window.__STARTERS_TEST__) {
        window.__startersReviewFormTest = {
            getTokenAndSanitizedUrl: getTokenAndSanitizedUrl,
            buildSubmission: buildSubmission,
            redactAnalyticsEvent: redactAnalyticsEvent,
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true })
    } else {
        init()
    }
})()
