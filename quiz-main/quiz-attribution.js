/**
 * Sitewide UTM and Meta ad attribution capture.
 *
 * @release v1.59.117
 *
 * Loaded site-wide with `defer` (Webflow site-wide custom code), not only on the
 * quiz funnel: a paid click can land on any page, and the cookies written here
 * are what `/quiz-results` later saves onto the brand-new Memberstack member.
 * Every page load re-runs the capture, so a visitor who arrives on the blog and
 * signs up three pages later still carries their click through.
 *
 * Cookie contract. All first-party, written with a 72 hour TTL on `path=/`, and
 * named exactly like the value they carry:
 *
 *   utm_source   from `?utm_source`
 *   utm_campaign from `?utm_campaign`
 *   utm_adset    from `?utm_adset`
 *   utm_content  from `?utm_content`
 *   fbclid       from `?fbclid`
 *   fbc          copied from Meta's own `_fbc` cookie when ours is unset
 *   fbp          copied from Meta's own `_fbp` cookie when ours is unset
 *   event_id     `evt_<uuid>`, generated once and then reused
 *
 * A URL parameter only overwrites its cookie when the URL actually carries a
 * value, so the freshest click wins and a plain internal navigation never clears
 * an earlier one. The `_fbc`/`_fbp` copy is re-checked on every page load
 * because the pixel writes those cookies itself and can load after this script.
 *
 * Memberstack custom-field mapping, cookie name to field ID: underscores become
 * hyphens. `quiz-results.js` owns the write; these 8 field IDs are verified to
 * exist in the Memberstack app config, so do not rename them here.
 *
 *   `utm_source` -> `utm-source`
 *   `utm_campaign` -> `utm-campaign`
 *   `utm_adset` -> `utm-adset`
 *   `utm_content` -> `utm-content`
 *   `fbclid` -> `fbclid`
 *   `fbc` -> `fbc`
 *   `fbp` -> `fbp`
 *   `event_id` -> `event-id`
 *
 * CompleteRegistration. The Meta Pixel base snippet lives in Webflow site-head
 * custom code (pixel 775648331097942); this file never installs it and only
 * calls `fbq` when it is already a function, so an uninstalled or blocked pixel
 * is a silent no-op. On `/quiz` only, the script records whether the visitor
 * arrived logged out and fires `CompleteRegistration` when Memberstack reports
 * the logged-out to logged-in transition, which on that page can only be the
 * signup form succeeding (logins happen on `/login` and `/starter-login`). The
 * event carries the `event_id` cookie as its `eventID` so a server-side copy of
 * the same registration deduplicates against it. It fires for every signup,
 * including one with no ad parameters at all.
 *
 * A `sessionStorage` flag makes the fire once-per-session, which is what covers
 * the refresh double-fire: Memberstack replays the authenticated state on the
 * next load, and without the flag that would look like a second registration.
 *
 * Debug: `window.StartersAttribution.getParams()` returns the current cookie
 * values. Diagnostics are staging-only (`*.webflow.io`, localhost, 127.0.0.1,
 * `*.trycloudflare.com`) or with `window.STARTERS_DEBUG === true`; production
 * stays silent. Nothing in this file may throw into the page, so every browser
 * API it touches is wrapped.
 */
;(function () {
    'use strict'

    if (window.__startersAttributionBooted) return
    window.__startersAttributionBooted = true

    var RELEASE = 'v1.59.117'
    var LOG_PREFIX = '[starters attribution]'

    var COOKIE_TTL_HOURS = 72
    var COOKIE_PATH = '/'

    // URL parameters copied into a cookie of the same name.
    var URL_PARAMS = [
        'utm_source',
        'utm_campaign',
        'utm_adset',
        'utm_content',
        'fbclid',
    ]

    // Our cookie name paired with the Meta-written cookie it falls back to.
    var META_COOKIE_FALLBACKS = [
        ['fbc', '_fbc'],
        ['fbp', '_fbp'],
    ]

    var EVENT_ID_COOKIE = 'event_id'
    var EVENT_ID_PREFIX = 'evt_'

    // Every cookie this script owns, in contract order.
    var COOKIE_NAMES = URL_PARAMS.concat(['fbc', 'fbp', EVENT_ID_COOKIE])

    var QUIZ_PATH = '/quiz'
    var COMPLETE_REGISTRATION_EVENT = 'CompleteRegistration'
    var FIRED_FLAG = 'startersCompleteRegistrationFired'

    var MEMBERSTACK_POLL_MS = 100
    var MEMBERSTACK_MAX_WAIT_MS = 10000

    var STAGING_HOSTS = ['localhost', '127.0.0.1']
    var STAGING_HOST_SUFFIXES = ['webflow.io', 'trycloudflare.com']

    /* ----------------------------- diagnostics ------------------------------ */

    /**
     * Anchored suffix match on purpose, like the v3 siblings: a lookalike host
     * such as "notwebflow.io" must not read as staging.
     *
     * @returns {boolean}
     */
    var diagnosticsEnabled = function () {
        try {
            if (window.STARTERS_DEBUG === true) return true
            var hostname = (window.location && window.location.hostname) || ''
            if (STAGING_HOSTS.indexOf(hostname) !== -1) return true
            return STAGING_HOST_SUFFIXES.some(function (suffix) {
                return (
                    hostname === suffix ||
                    hostname.slice(-(suffix.length + 1)) === '.' + suffix
                )
            })
        } catch (error) {
            return false
        }
    }

    /**
     * @param {string} message
     * @returns {void}
     */
    var warn = function (message) {
        try {
            if (!diagnosticsEnabled()) return
            console.warn(LOG_PREFIX + ' ' + message)
        } catch (error) {
            /* diagnostics must never break the page */
        }
    }

    /* -------------------------------- cookies ------------------------------- */

    /**
     * @param {string} name
     * @returns {string | null} Decoded value, or null when the cookie is absent.
     */
    var readCookie = function (name) {
        try {
            var raw = (document && document.cookie) || ''
            var parts = String(raw).split(';')
            for (var index = 0; index < parts.length; index += 1) {
                var part = parts[index].trim()
                if (!part) continue
                var separator = part.indexOf('=')
                if (separator === -1) continue
                if (part.slice(0, separator) !== name) continue
                var value = part.slice(separator + 1)
                try {
                    return decodeURIComponent(value)
                } catch (error) {
                    // A value the pixel wrote with a stray percent sign is still
                    // usable verbatim; failing to decode is not failing to read.
                    return value
                }
            }
        } catch (error) {
            /* blocked cookies read as absent */
        }
        return null
    }

    /**
     * @param {string} name
     * @param {string} value
     * @returns {boolean} Whether the write was attempted without throwing.
     */
    var writeCookie = function (name, value) {
        try {
            var expires = new Date(
                Date.now() + COOKIE_TTL_HOURS * 60 * 60 * 1000,
            ).toUTCString()
            document.cookie =
                name +
                '=' +
                encodeURIComponent(value) +
                '; expires=' +
                expires +
                '; path=' +
                COOKIE_PATH +
                '; SameSite=Lax'
            return true
        } catch (error) {
            return false
        }
    }

    /* -------------------------------- capture ------------------------------- */

    /**
     * Copies the ad parameters this URL carries into their cookies.
     *
     * Absence never clears: only a parameter that is present with a non-empty
     * value overwrites what an earlier click stored.
     *
     * @returns {void}
     */
    var captureUrlParams = function () {
        var params
        try {
            params = new URLSearchParams(
                (window.location && window.location.search) || '',
            )
        } catch (error) {
            return
        }

        URL_PARAMS.forEach(function (name) {
            try {
                var raw = params.get(name)
                if (raw === null) return
                var value = String(raw).trim()
                if (!value) return
                writeCookie(name, value)
            } catch (error) {
                /* one bad parameter must not stop the others */
            }
        })
    }

    /**
     * Copies Meta's own `_fbc` / `_fbp` into our cookies when ours are unset.
     *
     * Runs on every page load, so a pixel that loads after this script still
     * gets picked up on the next navigation.
     *
     * @returns {void}
     */
    var syncMetaCookies = function () {
        META_COOKIE_FALLBACKS.forEach(function (pair) {
            try {
                var ours = pair[0]
                var theirs = pair[1]
                if (readCookie(ours)) return
                var value = readCookie(theirs)
                if (!value) return
                writeCookie(ours, value)
            } catch (error) {
                /* one missing pixel cookie must not stop the other */
            }
        })
    }

    /**
     * @returns {string} RFC 4122 shaped identifier.
     */
    var uuid = function () {
        try {
            var webCrypto = window.crypto
            if (webCrypto && typeof webCrypto.randomUUID === 'function') {
                return webCrypto.randomUUID()
            }
        } catch (error) {
            /* fall through to the Math.random template */
        }

        // Older Safari and any non-secure context have no randomUUID. The id only
        // has to be unique enough to pair a browser event with its server copy,
        // so a Math.random template is an acceptable fallback.
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
            /[xy]/g,
            function (character) {
                var random = (Math.random() * 16) | 0
                var value = character === 'x' ? random : (random & 0x3) | 0x8
                return value.toString(16)
            },
        )
    }

    /**
     * Reuses the stored event id, or generates and stores one.
     *
     * @returns {string | null} The id, or null when cookies are unavailable.
     */
    var ensureEventId = function () {
        var existing = readCookie(EVENT_ID_COOKIE)
        if (existing) return existing

        var generated = EVENT_ID_PREFIX + uuid()
        writeCookie(EVENT_ID_COOKIE, generated)
        return generated
    }

    /**
     * @returns {object} Cookie name to current value, null when unset.
     */
    var getParams = function () {
        var values = {}
        COOKIE_NAMES.forEach(function (name) {
            values[name] = readCookie(name)
        })
        return values
    }

    /**
     * @returns {void}
     */
    var capture = function () {
        captureUrlParams()
        syncMetaCookies()
        ensureEventId()
    }

    /* -------------------------- CompleteRegistration ------------------------- */

    /**
     * @param {string} pathname
     * @returns {boolean}
     */
    var isQuizPath = function (pathname) {
        var path = String(pathname || '').toLowerCase()
        if (path.length > 1 && path.charAt(path.length - 1) === '/') {
            path = path.slice(0, -1)
        }
        return path === QUIZ_PATH
    }

    /**
     * @returns {boolean}
     */
    var hasFired = function () {
        try {
            var storage = window.sessionStorage
            if (!storage) return false
            return storage.getItem(FIRED_FLAG) === 'true'
        } catch (error) {
            // Blocked storage reads as "not fired": missing a dedup is better
            // than dropping the conversion entirely.
            return false
        }
    }

    /**
     * @returns {void}
     */
    var markFired = function () {
        try {
            var storage = window.sessionStorage
            if (!storage) return
            storage.setItem(FIRED_FLAG, 'true')
        } catch (error) {
            /* blocked storage just means no dedup */
        }
    }

    /**
     * Sends CompleteRegistration to Meta, once per browser session.
     *
     * @returns {boolean} Whether the event was handed to `fbq`.
     */
    var fireCompleteRegistration = function () {
        try {
            if (hasFired()) return false

            if (typeof window.fbq !== 'function') {
                warn(
                    'Meta Pixel not found, skipped ' +
                        COMPLETE_REGISTRATION_EVENT +
                        '. Install the pixel base snippet in site-head custom code.',
                )
                return false
            }

            var eventId = ensureEventId()
            var options = {}
            if (eventId) options.eventID = eventId

            window.fbq('track', COMPLETE_REGISTRATION_EVENT, {}, options)
            markFired()
            return true
        } catch (error) {
            warn('failed to fire ' + COMPLETE_REGISTRATION_EVENT)
            return false
        }
    }

    /**
     * @param {object | null | undefined} payload
     * @returns {object | null}
     */
    var getMemberData = function (payload) {
        var member = payload && payload.data ? payload.data : payload
        if (!member || typeof member !== 'object') return null
        if (member.data && typeof member.data === 'object') return member.data
        return member
    }

    /**
     * @param {object | null | undefined} member
     * @returns {boolean}
     */
    var isLoggedInMember = function (member) {
        return Boolean(member && (member.id || member._id || member.email))
    }

    /**
     * @returns {Promise<object | null>}
     */
    var waitForMemberstack = function () {
        return new Promise(function (resolve) {
            var startedAt = Date.now()

            var poll = function () {
                if (window.$memberstackDom) {
                    resolve(window.$memberstackDom)
                    return
                }

                if (Date.now() - startedAt >= MEMBERSTACK_MAX_WAIT_MS) {
                    resolve(null)
                    return
                }

                setTimeout(poll, MEMBERSTACK_POLL_MS)
            }

            poll()
        })
    }

    /**
     * Watches the /quiz signup for its logged-out to logged-in transition.
     *
     * @returns {Promise<void>}
     */
    var wireCompleteRegistration = async function () {
        if (!isQuizPath(window.location && window.location.pathname)) return

        var memberstack = await waitForMemberstack()
        if (!memberstack) {
            warn('Memberstack never loaded, CompleteRegistration is unwatched')
            return
        }

        // The starting state has to be read before subscribing, because
        // onAuthChange replays the current member on some loads and a visitor who
        // was already logged in when the page opened did not just register.
        var loggedOut = true
        try {
            var current = await memberstack.getCurrentMember()
            loggedOut = !isLoggedInMember(getMemberData(current))
        } catch (error) {
            loggedOut = true
        }

        if (typeof memberstack.onAuthChange !== 'function') return

        memberstack.onAuthChange(function (payload) {
            try {
                var loggedIn = isLoggedInMember(getMemberData(payload))
                if (loggedIn && loggedOut) fireCompleteRegistration()
                loggedOut = !loggedIn
            } catch (error) {
                /* attribution must never break the signup */
            }
        })
    }

    /* ---------------------------------- boot -------------------------------- */

    /**
     * @returns {void}
     */
    var init = function () {
        try {
            capture()
        } catch (error) {
            warn('capture failed')
        }

        try {
            var pending = wireCompleteRegistration()
            if (pending && typeof pending.catch === 'function') {
                pending.catch(function () {
                    warn('CompleteRegistration wiring failed')
                })
            }
        } catch (error) {
            warn('CompleteRegistration wiring failed')
        }
    }

    window.StartersAttribution = {
        // Keep in sync with the @release line in this file's header comment; the
        // quiz-attribution.test.js drift guard asserts they match.
        release: RELEASE,
        getParams: getParams,
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init)
    } else {
        init()
    }
})()
