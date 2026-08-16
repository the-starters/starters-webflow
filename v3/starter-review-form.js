/**
 * V3 invited Starter review form controller.
 *
 * Designer contract:
 * - root: [data-starter-review]
 * - state blocks: [data-starter-review-state="loading|form|success|unavailable|error"]
 * - form: form[data-starter-review-form]
 * - fields: rating, review_text, private_feedback
 * - display: [data-starter-review-name|photo|headline|profile-link|error]
 */
(function () {
    'use strict'

    if (window.__startersV3ReviewFormBooted) return
    window.__startersV3ReviewFormBooted = true

    var API_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30'
    var CONTEXT_PATH = '/starter/reviews/invited/context/resolve'
    var SUBMIT_PATH = '/starter/reviews/invited/submit'
    var TOKEN_MIN = 20
    var TOKEN_MAX = 128
    var REVIEW_MIN = 10
    var REVIEW_MAX = 4000
    var FEEDBACK_MAX = 2000

    var normalize = function (value) {
        return String(value == null ? '' : value).trim()
    }

    var getTokenAndSanitizedUrl = function (href) {
        var url = new URL(href)
        var hash = new URLSearchParams(url.hash.replace(/^#/, ''))
        var token = normalize(hash.get('token') || url.searchParams.get('token'))

        url.searchParams.delete('token')
        url.hash = ''

        return {
            token: token,
            sanitized: url.pathname + (url.search ? url.search : ''),
        }
    }

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

    var postJson = async function (path, body) {
        var response = await fetch(API_BASE + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
        })
        var payload = await response.json().catch(function () {
            return {}
        })

        if (!response.ok) {
            var error = new Error('The review request could not be completed.')
            error.status = response.status
            throw error
        }

        return payload
    }

    var capture = function (name, properties) {
        if (!window.posthog || typeof window.posthog.capture !== 'function') return
        window.posthog.capture(name, properties || {})
    }

    var init = async function () {
        var root = document.querySelector('[data-starter-review]')
        if (!root) return

        var tokenResult = getTokenAndSanitizedUrl(window.location.href)
        window.history.replaceState(window.history.state, '', tokenResult.sanitized)

        var capabilityToken = tokenResult.token
        var setState = function (name) {
            root.setAttribute('data-starter-review-current-state', name)
            root.querySelectorAll('[data-starter-review-state]').forEach(function (node) {
                node.hidden = node.getAttribute('data-starter-review-state') !== name
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
            var context = await postJson(CONTEXT_PATH, { token: capabilityToken })
            if (!context || context.available !== true || !context.starter) {
                throw new Error('Review context is unavailable.')
            }

            var nameNode = root.querySelector('[data-starter-review-name]')
            var headlineNode = root.querySelector('[data-starter-review-headline]')
            var photoNode = root.querySelector('[data-starter-review-photo]')
            var profileNode = root.querySelector('[data-starter-review-profile-link]')

            if (nameNode) nameNode.textContent = normalize(context.starter.name) || 'Starter'
            if (headlineNode) {
                headlineNode.textContent = normalize(context.starter.headline)
                headlineNode.hidden = !normalize(context.starter.headline)
            }
            if (photoNode) {
                var photoUrl = normalize(context.starter.photo_url)
                photoNode.hidden = !/^https:\/\//i.test(photoUrl)
                if (!photoNode.hidden) photoNode.setAttribute('src', photoUrl)
            }
            if (profileNode) {
                var profileUrl = normalize(context.starter.profile_url)
                profileNode.hidden = !/^\/hire\/[a-z0-9-]+$/i.test(profileUrl)
                if (!profileNode.hidden) profileNode.setAttribute('href', profileUrl)
            }

            var form = root.querySelector('form[data-starter-review-form]')
            if (!form) throw new Error('The review form is not configured.')

            var idempotencyKey = makeIdempotencyKey()
            form.addEventListener('submit', async function (event) {
                event.preventDefault()
                event.stopImmediatePropagation()
                setError('')

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

                var submitButton = form.querySelector('[type="submit"]')
                if (submitButton) submitButton.disabled = true

                try {
                    var result = await postJson(SUBMIT_PATH, {
                        token: capabilityToken,
                        rating: submission.payload.rating,
                        review_text: submission.payload.review_text,
                        private_feedback: submission.payload.private_feedback,
                        idempotency_key: submission.payload.idempotency_key,
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
                    if (submitButton) submitButton.disabled = false
                    setError('We could not submit your review. Try again.')
                    setState('form')
                    capture('v3_starter_review_submit_failed', {
                        status: Number(error && error.status) || 0,
                    })
                }
            }, true)

            setState('form')
            capture('v3_starter_review_form_viewed')
        } catch (error) {
            capabilityToken = ''
            setState('unavailable')
            capture('v3_starter_review_unavailable', {
                reason: Number(error && error.status) === 404 ? 'not_found' : 'load_failed',
            })
        }
    }

    if (window.__STARTERS_TEST__) {
        window.__startersReviewFormTest = {
            getTokenAndSanitizedUrl: getTokenAndSanitizedUrl,
            buildSubmission: buildSubmission,
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true })
    } else {
        init()
    }
})()
