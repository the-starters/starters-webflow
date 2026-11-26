/**
 * Affiliate link tracking. Replaces Rewardful's rw.js with our own first-party script.
 *
 * @release unreleased
 *
 * Loaded site-wide with `defer` (Webflow site-wide custom code), next to
 * `signup-attribution.js`: an affiliate link can land on any page, and the
 * signup that should be credited can happen pages later.
 *
 * What it does:
 *
 *   1. Reads the affiliate token from the URL: `?via=<token>` (Rewardful's
 *      parameter, so every link already shared keeps working), `?ref=`, and any
 *      legacy names listed in `window.STARTERS_AFFILIATE_PARAMS` before this
 *      script runs. Tokens are lowercased and must match ^[a-z0-9-]{1,64}$;
 *      anything else is ignored.
 *   2. Keeps the token in a first-party cookie, `ts_aff`, holding JSON
 *      {t: token, v: visitor id, at: first seen (ms), d: cookie days}. The cookie
 *      is set on `.thestarters.com` in production and host-only on staging.
 *      First touch by default: a later link does not replace a live cookie
 *      unless the server says the new link's campaign is last touch.
 *   3. Records the visit with POST aff-api/click (text/plain body, so no CORS
 *      preflight; keepalive, so a quick navigation does not drop it). The
 *      reply gives the campaign's cookie days and attribution. An unknown
 *      token is dropped from the cookie.
 *   4. Binds the referral to the member: on the logged-out to logged-in
 *      transition (signup), and on load for a member who is already logged in
 *      and has no `affiliate-ref` field yet, it posts aff-api/lead with the
 *      Memberstack member token. The server verifies the member and decides
 *      (first binding wins, no self-referrals, no members who already pay).
 *      Only when the server answers bound:true does the script write the
 *      write-once Memberstack custom field `affiliate-ref` with the token.
 *
 * Nothing here can block the page or the signup: every step is async and
 * wrapped, and a failure only means one visit or binding is not recorded.
 * No secret of any kind is in this file. Staging hosts log diagnostics to the
 * console; production stays silent (repo convention, see README).
 */
;(function () {
    'use strict'

    if (window.__startersAffiliateBooted) return
    window.__startersAffiliateBooted = true

    var RELEASE = 'unreleased'
    var LOG_PREFIX = '[starters affiliate]'

    var API_BASE = 'https://fquyhwkttuhxjzfrdhjt.supabase.co/functions/v1/aff-api'
    var COOKIE_NAME = 'ts_aff'
    var COOKIE_PATH = '/'
    var PRODUCTION_DOMAIN = 'thestarters.com'
    var DEFAULT_COOKIE_DAYS = 60
    var DEFAULT_PARAMS = ['via', 'ref']
    var TOKEN_RE = /^[a-z0-9-]{1,64}$/
    var VISITOR_RE = /^[A-Za-z0-9-]{8,64}$/
    var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
    var FIELD_ID = 'affiliate-ref'
    var BOUND_STORAGE_KEY = 'startersAffiliateBoundV1'

    var MEMBERSTACK_POLL_MS = 100
    var MEMBERSTACK_MAX_WAIT_MS = 10000

    var STAGING_HOSTS = ['localhost', '127.0.0.1']
    var STAGING_HOST_SUFFIXES = ['webflow.io', 'trycloudflare.com']

    /* ----------------------------- diagnostics ------------------------------ */

    var diagnosticsEnabled = function () {
        try {
            if (window.STARTERS_DEBUG === true) return true
            var hostname = (window.location && window.location.hostname) || ''
            if (STAGING_HOSTS.indexOf(hostname) !== -1) return true
            return STAGING_HOST_SUFFIXES.some(function (suffix) {
                return hostname === suffix || hostname.slice(-(suffix.length + 1)) === '.' + suffix
            })
        } catch (error) {
            return false
        }
    }

    var log = function (message) {
        try {
            if (!diagnosticsEnabled()) return
            console.info(LOG_PREFIX + ' ' + message)
        } catch (error) {
            /* diagnostics must never break the page */
        }
    }

    var runSafely = function (fn) {
        try {
            var result = fn()
            if (result && typeof result.catch === 'function') {
                result.catch(function (error) {
                    log('step failed: ' + (error && error.message ? error.message : String(error)))
                })
            }
        } catch (error) {
            log('step failed: ' + (error && error.message ? error.message : String(error)))
        }
    }

    /* -------------------------------- cookie -------------------------------- */

    var cookieDomain = function () {
        var hostname = String((window.location && window.location.hostname) || '')
        if (hostname === PRODUCTION_DOMAIN || hostname.slice(-(PRODUCTION_DOMAIN.length + 1)) === '.' + PRODUCTION_DOMAIN) {
            return '.' + PRODUCTION_DOMAIN
        }
        return ''
    }

    var readCookieRaw = function (name) {
        try {
            var parts = String((document && document.cookie) || '').split(';')
            for (var i = 0; i < parts.length; i += 1) {
                var part = parts[i].trim()
                var eq = part.indexOf('=')
                if (eq > 0 && part.slice(0, eq) === name) {
                    try {
                        return decodeURIComponent(part.slice(eq + 1))
                    } catch (error) {
                        return null
                    }
                }
            }
        } catch (error) {
            /* blocked cookies read as absent */
        }
        return null
    }

    var writeCookieRaw = function (value, maxAgeSeconds) {
        try {
            var domain = cookieDomain()
            var secure = window.location && window.location.protocol === 'https:'
            document.cookie =
                COOKIE_NAME + '=' + encodeURIComponent(value) +
                '; max-age=' + Math.max(0, Math.floor(maxAgeSeconds)) +
                '; path=' + COOKIE_PATH +
                (domain ? '; domain=' + domain : '') +
                '; SameSite=Lax' +
                (secure ? '; Secure' : '')
        } catch (error) {
            /* blocked cookies just mean nothing was stored */
        }
    }

    /** The stored referral, or null when absent, malformed or expired. */
    var readAffiliate = function () {
        var raw = readCookieRaw(COOKIE_NAME)
        if (!raw) return null
        try {
            var value = JSON.parse(raw)
            if (!value || typeof value !== 'object') return null
            if (typeof value.t !== 'string' || !TOKEN_RE.test(value.t)) return null
            if (typeof value.v !== 'string' || !VISITOR_RE.test(value.v)) return null
            var days = typeof value.d === 'number' && value.d > 0 ? value.d : DEFAULT_COOKIE_DAYS
            var at = typeof value.at === 'number' ? value.at : 0
            if (at + days * 86400000 <= Date.now()) return null
            return { t: value.t, v: value.v, at: at, d: days }
        } catch (error) {
            return null
        }
    }

    var writeAffiliate = function (aff) {
        var remaining = (aff.at + aff.d * 86400000 - Date.now()) / 1000
        writeCookieRaw(JSON.stringify({ t: aff.t, v: aff.v, at: aff.at, d: aff.d }), remaining)
    }

    var clearAffiliate = function () {
        writeCookieRaw('', 0)
    }

    /* -------------------------------- capture ------------------------------- */

    var normalizeToken = function (raw) {
        if (typeof raw !== 'string') return null
        var token = raw.trim().toLowerCase()
        return TOKEN_RE.test(token) ? token : null
    }

    var paramNames = function () {
        var names = DEFAULT_PARAMS.slice()
        try {
            var extra = window.STARTERS_AFFILIATE_PARAMS
            if (Array.isArray(extra)) {
                extra.forEach(function (name) {
                    if (typeof name === 'string' && /^[a-z0-9_-]{1,32}$/i.test(name) && names.indexOf(name) === -1) {
                        names.push(name)
                    }
                })
            }
        } catch (error) {
            /* a bad list just means the defaults */
        }
        return names
    }

    var tokenFromUrl = function () {
        try {
            var params = new URLSearchParams(window.location.search || '')
            var names = paramNames()
            for (var i = 0; i < names.length; i += 1) {
                var value = params.get(names[i])
                if (value) return normalizeToken(value)
            }
        } catch (error) {
            /* an unreadable URL carries no token */
        }
        return null
    }

    var uuid = function () {
        try {
            if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID()
        } catch (error) {
            /* fall through */
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = (Math.random() * 16) | 0
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
        })
    }

    var utmFromUrl = function () {
        var utm = {}
        try {
            var params = new URLSearchParams(window.location.search || '')
            UTM_KEYS.forEach(function (key) {
                var value = params.get(key)
                if (value && value.length <= 300 && !/[<>]/.test(value)) utm[key] = value
            })
        } catch (error) {
            /* no UTM then */
        }
        return utm
    }

    var referrerHost = function () {
        try {
            if (!document.referrer) return null
            return new URL(document.referrer).hostname || null
        } catch (error) {
            return null
        }
    }

    var post = function (route, body) {
        return window.fetch(API_BASE + '/' + route, {
            method: 'POST',
            mode: 'cors',
            credentials: 'omit',
            keepalive: true,
            headers: { 'content-type': 'text/plain;charset=UTF-8' },
            body: JSON.stringify(body),
        })
    }

    /**
     * Stores the token from the URL (first touch unless the campaign says
     * otherwise) and records the click.
     */
    var capture = async function () {
        var token = tokenFromUrl()
        if (!token) return
        var existing = readAffiliate()
        var visitorId = existing ? existing.v : uuid()
        var wroteNew = false

        if (!existing) {
            writeAffiliate({ t: token, v: visitorId, at: Date.now(), d: DEFAULT_COOKIE_DAYS })
            wroteNew = true
        }

        var response = await post('click', {
            token: token,
            visitor_id: visitorId,
            path: (window.location.pathname || '/').slice(0, 300),
            referrer_host: referrerHost(),
            utm: utmFromUrl(),
        })
        if (!response || !response.ok) {
            log('click not recorded, status ' + (response && response.status))
            return
        }
        var reply = await response.json()
        if (!reply || reply.known !== true) {
            // An unknown or switched-off token must not hold the cookie.
            if (wroteNew) clearAffiliate()
            log('unknown token ' + token)
            return
        }
        var days = typeof reply.cookie_days === 'number' && reply.cookie_days > 0 ? reply.cookie_days : DEFAULT_COOKIE_DAYS
        if (wroteNew || (existing && existing.t === token)) {
            var current = readAffiliate() || { t: token, v: visitorId, at: Date.now() }
            writeAffiliate({ t: current.t, v: current.v, at: current.at, d: days })
        } else if (reply.attribution === 'last_touch') {
            writeAffiliate({ t: token, v: visitorId, at: Date.now(), d: days })
        }
        log('click recorded for ' + token + (reply.counted ? '' : ' (already counted today)'))
    }

    /* ------------------------------ member binding --------------------------- */

    var getMemberData = function (payload) {
        var member = payload && payload.data ? payload.data : payload
        if (!member || typeof member !== 'object') return null
        if (member.data && typeof member.data === 'object') return member.data
        return member
    }

    var isLoggedIn = function (member) {
        return Boolean(member && (member.id || member._id))
    }

    var waitForMemberstack = function () {
        return new Promise(function (resolve) {
            var startedAt = Date.now()
            var poll = function () {
                if (window.$memberstackDom) return resolve(window.$memberstackDom)
                if (Date.now() - startedAt >= MEMBERSTACK_MAX_WAIT_MS) return resolve(null)
                setTimeout(poll, MEMBERSTACK_POLL_MS)
            }
            poll()
        })
    }

    var readBound = function () {
        try {
            return window.localStorage.getItem(BOUND_STORAGE_KEY)
        } catch (error) {
            return null
        }
    }

    var writeBound = function (value) {
        try {
            window.localStorage.setItem(BOUND_STORAGE_KEY, value)
        } catch (error) {
            /* storage blocked: the server stays idempotent anyway */
        }
    }

    var bindInFlight = false

    /**
     * Asks the server to bind this member to the stored affiliate. Write-once on
     * both sides: a member with an affiliate-ref value is never sent again.
     */
    var bindMember = async function (memberstack, member) {
        if (bindInFlight || !isLoggedIn(member)) return
        var aff = readAffiliate()
        if (!aff) return
        var fields = member.customFields || {}
        if (typeof fields[FIELD_ID] === 'string' && fields[FIELD_ID].trim()) return
        var memberId = String(member.id || member._id)
        if (readBound() === memberId + ':' + aff.t) return

        bindInFlight = true
        try {
            if (typeof memberstack.getMemberCookie !== 'function') return
            var memberToken = await memberstack.getMemberCookie()
            if (!memberToken) return
            var response = await post('lead', { token: aff.t, visitor_id: aff.v, member_token: memberToken })
            if (!response || !response.ok) {
                log('lead not recorded, status ' + (response && response.status))
                return
            }
            var reply = await response.json()
            writeBound(memberId + ':' + aff.t)
            if (reply && reply.bound === true && typeof memberstack.updateMember === 'function') {
                var customFields = {}
                customFields[FIELD_ID] = aff.t
                await memberstack.updateMember({ customFields: customFields })
                log('member bound to ' + aff.t)
            } else {
                log('member not bound: ' + (reply && reply.reason))
            }
        } finally {
            bindInFlight = false
        }
    }

    var watchMember = async function () {
        var memberstack = await waitForMemberstack()
        if (!memberstack) return

        var seenLoggedOut = null
        try {
            var current = getMemberData(await memberstack.getCurrentMember())
            seenLoggedOut = !isLoggedIn(current)
            if (!seenLoggedOut) runSafely(function () { return bindMember(memberstack, current) })
        } catch (error) {
            seenLoggedOut = null
        }

        if (typeof memberstack.onAuthChange !== 'function') return
        memberstack.onAuthChange(function (payload) {
            try {
                var member = getMemberData(payload)
                var loggedIn = isLoggedIn(member)
                if (loggedIn && seenLoggedOut === true) {
                    runSafely(function () { return bindMember(memberstack, member) })
                }
                seenLoggedOut = !loggedIn
            } catch (error) {
                /* binding must never break the signup */
            }
        })
    }

    /* --------------------------------- boot --------------------------------- */

    window.__startersAffiliateRelease = RELEASE
    runSafely(capture)
    runSafely(watchMember)
})()
