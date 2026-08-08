/**
 * Sitewide UTM and Meta ad attribution capture.
 *
 * @release v1.59.130
 *
 * Loaded site-wide with `defer` (Webflow site-wide custom code) rather than on
 * one funnel, which is why it lives here in `v3/` alongside the other standalone
 * sitewide behaviours and not in `quiz-main/`: a paid click can land on any
 * page, and the cookies written here are what a later signup saves onto the
 * brand-new Memberstack member. Every page load re-runs the capture, so a
 * visitor who arrives on the blog and signs up three pages later still carries
 * their click through. Wiring and the field-ID table live in `v3/README.md`.
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
 * hyphens. These 8 field IDs are verified to exist in the Memberstack app
 * config, so do not rename them here.
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
 * The same map is duplicated in the repo-root `quiz-results.js`, which owns the
 * write for the quiz funnel. Keep the two in step: a field ID that exists in
 * only one of them is a value Memberstack silently drops on one of the two
 * signup routes. The
 * signup-attribution.test.js drift guard asserts both maps still match.
 *
 * Signup pages. A page arms the signup watch when either its normalized path is
 * in the `SIGNUP_PATH_POLICY` map, or the page carries at least one Memberstack
 * signup form (`form[data-ms-form="signup"]`) and no login marker anywhere on it
 * (`[data-ms-form="login"]`). The path map is checked first and its policy
 * is used verbatim, so the two hand-audited pages provably cannot regress if the
 * markup on them ever changes: `/quiz` (the funnel signup, followed by
 * `/quiz-results`) and `/sign-up` (the direct signup, followed by
 * `/brand-dashboard`). Form detection is what covers every other signup surface,
 * starting with the signup modal on `/all-starters`. It reuses the attribute
 * Memberstack already needs, so a new signup surface needs no Designer work and
 * no edit here to be attributed.
 *
 * The login form is a veto, and it applies to the detection branch only. On a
 * page carrying both kinds of form, a logged-out to logged-in transition could
 * be either one, and reading a login as a signup would fire a false
 * CompleteRegistration and stamp this browser's UTM values onto an existing
 * member who already has their own. A missed attribution is the cheaper of the
 * two failures, so an ambiguous page is not watched at all and says why in a
 * staging-only warning. Pure login pages such as `/login` and `/starter-login`
 * fall out of the same rule: no signup form, no watch.
 *
 * The two selectors are deliberately asymmetric: arming requires a real
 * `<form>`, the veto matches the login marker on any element. Arming is a claim
 * that a signup happens here and wants proof; the veto only needs a hint that a
 * login lives here, and it is cheaper to be wrong in that direction.
 *
 * Detection counts forms present in the DOM and deliberately does not test
 * whether they are visible. The `/all-starters` modal lives in a `<dialog>` that
 * is display:none until it opens, so any visibility check would skip the exact
 * form this covers. Presence alone is safe because detection only arms a watch:
 * the pixel and the field save fire on the Memberstack auth transition, so a
 * form nobody can reach fires nothing.
 *
 * `directSave` says whether this script writes the attribution fields itself.
 * `/quiz` is mapped to false because `quiz-results.js` runs on the very next
 * page and writes those same fields as part of its own single quiz save; two
 * writers for one signup is a race, not a redundancy. That is a script-to-script
 * dependency rather than a preference, and it is the reason the path map has to
 * keep being consulted before detection: fold the two branches together and
 * `/quiz` silently starts double-writing. Pages armed by detection direct-save,
 * the same as `/sign-up`.
 *
 * The scan runs once during init, off the DOM as it stands at DOMContentLoaded.
 * `window.StartersAttribution.rearm()` re-runs it for a future caller that
 * injects a signup form later, mirroring `starters-ms-redirect.js` next door and
 * its `apply()`. The two are a pair: that module rewrites the `redirect` on the
 * same `form[data-ms-form="signup"]` this one detects, so a caller that injects a
 * signup modal wants both re-run. It returns whether the watch is armed and is a
 * no-op once it is: a second `onAuthChange` listener would fire
 * CompleteRegistration twice and start two competing saves.
 *
 * CompleteRegistration. The Meta Pixel base snippet lives in Webflow site-head
 * custom code (pixel 775648331097942); this file never installs it and only
 * calls `fbq` when it is already a function, so an uninstalled or blocked pixel
 * is a silent no-op. On a signup page the script records whether the visitor
 * arrived logged out and fires `CompleteRegistration` on the transition. The
 * event carries the `event_id` cookie as its `eventID` so a server-side copy of
 * the same registration deduplicates against it. It fires for every signup,
 * including one with no ad parameters at all. An unreadable starting member
 * state is not treated as logged out: the first definitive auth event only arms
 * the watch, it does not fire.
 *
 * A `sessionStorage` flag makes the fire once-per-session, which is what covers
 * the refresh double-fire: Memberstack replays the authenticated state on the
 * next load, and without the flag that would look like a second registration.
 * The flag is shared by every signup surface, so one session yields one event.
 *
 * Field persistence. `/quiz` needs nothing here: `quiz-results.js` runs right
 * after it and writes the attribution fields alongside the quiz summary. Every
 * other signup route has no such follow-up writer, so this script writes the
 * fields itself, and it has to survive the form's own redirect cutting the
 * request off mid-flight (`/sign-up` sends the browser to `/brand-dashboard`;
 * the `/all-starters` modal reloads the same page to reopen itself, which cuts
 * the request off just as effectively). The order is therefore: snapshot the
 * non-empty field values into `startersAttributionPendingFields`, set
 * `startersAttributionPendingSave`, then call `updateMember`, then clear both
 * only once the write is confirmed. Every page load checks that marker and
 * re-attempts the write from the snapshot (not from live cookies), so a save
 * killed by any redirect completes on the page the signup landed on, with the
 * values the signup captured. This runs sitewide and needed no change for the
 * modal: a same-page redirect is just another page load. A marker found while
 * Memberstack reports the visitor logged out is stale and gets cleared without a
 * write, unless a stale marker was already present at load and this page's own
 * signup re-raised it while that retry's member read was still in flight.
 *
 * Debug: `window.StartersAttribution.getParams()` returns the current cookie
 * values, and `window.StartersAttribution.rearm()` reports (and, if a signup form
 * has appeared since load, starts) the signup watch. Diagnostics are staging-only
 * (`*.webflow.io`, localhost, 127.0.0.1,
 * `*.trycloudflare.com`) or with `window.STARTERS_DEBUG === true`; production
 * stays silent. Nothing in this file may throw into the page, so every browser
 * API it touches is wrapped.
 */
;(function () {
    'use strict'

    if (window.__startersAttributionBooted) return
    window.__startersAttributionBooted = true

    var RELEASE = 'v1.59.130'
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

    // Cookie name to Memberstack custom-field ID: underscores swapped for
    // hyphens. Duplicated in quiz-results.js on purpose (the house pattern for
    // two scripts that write the same fields); the IDs are verified against the
    // live Memberstack app config, so a rename here silently drops the value.
    // COOKIE_NAMES is derived from this map so the two can never drift.
    var FIELD_IDS = {
        utm_source: 'utm-source',
        utm_campaign: 'utm-campaign',
        utm_adset: 'utm-adset',
        utm_content: 'utm-content',
        fbclid: 'fbclid',
        fbc: 'fbc',
        fbp: 'fbp',
        event_id: 'event-id',
    }

    // Every cookie this script owns, in FIELD_IDS contract order.
    var COOKIE_NAMES = Object.keys(FIELD_IDS)

    // One path -> policy map for the two hand-audited pages that can turn a
    // visitor into a member. Each has exactly one Memberstack signup form and no
    // login form, so the logged-out to logged-in transition is unambiguous
    // there. Logins (/login, /starter-login) are deliberately absent. This map
    // is consulted BEFORE the form detection below and wins outright, so those
    // two pages keep behaving exactly as they do today whatever their markup
    // becomes. `directSave` is true only when this script (not quiz-results.js)
    // must write the attribution fields, which is why /quiz is false: see
    // detectedSignupPolicy for why that coupling has to stay.
    var SIGNUP_PATH_POLICY = {
        '/quiz': { directSave: false },
        '/sign-up': { directSave: true },
    }

    // Memberstack's own markers, reused on purpose: every signup surface already
    // carries them, so a new one is attributed with no Designer work and no edit
    // here. A login form on the same page is a veto (see detectedSignupPolicy).
    // The asymmetry is deliberate. Arming needs proof of a real signup form, so
    // that selector is anchored to `form`. The veto only needs a hint that a
    // login lives here, so it matches the marker anywhere: on every login page
    // today the marker does sit on a `form`, but v3/auth-route.js queries it
    // without the prefix, so nothing guarantees that stays true. Widening the
    // veto costs at most a missed attribution; narrowing it would cost a false
    // CompleteRegistration, which is the failure this guard exists to prevent.
    var SIGNUP_FORM_SELECTOR = 'form[data-ms-form="signup"]'
    var LOGIN_FORM_SELECTOR = '[data-ms-form="login"]'

    var COMPLETE_REGISTRATION_EVENT = 'CompleteRegistration'
    var FIRED_FLAG = 'startersCompleteRegistrationFired'
    var PENDING_SAVE_FLAG = 'startersAttributionPendingSave'
    var PENDING_FIELDS_KEY = 'startersAttributionPendingFields'

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
     * @returns {void}
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
        } catch (error) {
            /* blocked cookies just mean nothing was stored */
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
     * A blocked cookie write still returns the generated id, so the page-lifetime
     * value stays usable even when it could not be persisted.
     *
     * @returns {string} The event id.
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

    /* ------------------------------ page + flags ----------------------------- */

    /**
     * @param {string} pathname
     * @returns {string} Lowercased path with any single trailing slash removed.
     */
    var normalizePath = function (pathname) {
        var path = String(pathname || '').toLowerCase()
        if (path.length > 1 && path.charAt(path.length - 1) === '/') {
            path = path.slice(0, -1)
        }
        return path
    }

    /**
     * @param {string} pathname
     * @returns {{ directSave: boolean } | null}
     */
    var signupPolicyFor = function (pathname) {
        return SIGNUP_PATH_POLICY[normalizePath(pathname)] || null
    }

    /**
     * @param {string} selector
     * @returns {number} Matching elements, 0 when the DOM cannot be queried.
     */
    var countElements = function (selector) {
        try {
            if (!document || typeof document.querySelectorAll !== 'function') {
                return 0
            }
            var found = document.querySelectorAll(selector)
            return (found && found.length) || 0
        } catch (error) {
            // An unqueryable DOM reads as "no forms here", which only costs the
            // watch on a page the path map does not already cover.
            return 0
        }
    }

    /**
     * Policy for a page recognised by its markup rather than by its path.
     *
     * Presence only: no visibility test, because the /all-starters signup form
     * sits in a `<dialog>` that is display:none until it opens, and that is the
     * exact form this is here to find. Safe, because this only arms a watch; the
     * pixel and the save fire on the Memberstack auth transition, so a form
     * nobody can reach fires nothing.
     *
     * `directSave` is true here. It is false for /quiz only because
     * quiz-results.js writes those same fields on the next page as part of its
     * single quiz save, and two writers for one signup is a race. That is a
     * script-to-script dependency, not a style choice: SIGNUP_PATH_POLICY must
     * keep being checked before this function, or /quiz starts double-writing.
     *
     * @returns {{ directSave: boolean } | null}
     */
    var detectedSignupPolicy = function () {
        if (!countElements(SIGNUP_FORM_SELECTOR)) return null

        if (countElements(LOGIN_FORM_SELECTOR)) {
            // Fail safe. On a page with both, a logged-out to logged-in
            // transition could be either form, and reading a login as a signup
            // would fire a false CompleteRegistration and stamp this browser's
            // UTM values onto a member who already has their own. A missed
            // attribution is the cheaper failure.
            warn(
                'signup and login forms on one page, signup watch not armed. ' +
                    'A login here would look like a registration.',
            )
            return null
        }

        return { directSave: true }
    }

    /**
     * Mapped path first and verbatim, markup detection second.
     *
     * @param {string} pathname
     * @returns {{ directSave: boolean } | null}
     */
    var resolveSignupPolicy = function (pathname) {
        return signupPolicyFor(pathname) || detectedSignupPolicy()
    }

    /**
     * @param {string} key
     * @returns {boolean}
     */
    var flagIsSet = function (key) {
        try {
            var storage = window.sessionStorage
            if (!storage) return false
            return storage.getItem(key) === 'true'
        } catch (error) {
            // Blocked storage reads as unset: missing a dedup is better than
            // dropping the conversion entirely.
            return false
        }
    }

    /**
     * @param {string} key
     * @returns {void}
     */
    var setFlag = function (key) {
        try {
            var storage = window.sessionStorage
            if (!storage) return
            storage.setItem(key, 'true')
        } catch (error) {
            /* blocked storage just means no dedup */
        }
    }

    /**
     * @param {string} key
     * @returns {void}
     */
    var clearFlag = function (key) {
        try {
            var storage = window.sessionStorage
            if (!storage) return
            storage.removeItem(key)
        } catch (error) {
            /* a flag that cannot be cleared only costs a retry */
        }
    }

    /**
     * @returns {object | null} Signup-time custom-field snapshot, or null.
     */
    var readPendingFields = function () {
        try {
            var storage = window.sessionStorage
            if (!storage) return null
            var raw = storage.getItem(PENDING_FIELDS_KEY)
            if (!raw) return null
            var parsed = JSON.parse(raw)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return null
            }
            return parsed
        } catch (error) {
            return null
        }
    }

    /**
     * @param {object} fields Custom-field ID to value.
     * @returns {void}
     */
    var writePendingFields = function (fields) {
        try {
            var storage = window.sessionStorage
            if (!storage) return
            storage.setItem(PENDING_FIELDS_KEY, JSON.stringify(fields || {}))
        } catch (error) {
            /* blocked storage just means the retry falls back to live cookies */
        }
    }

    /**
     * @returns {void}
     */
    var clearPendingFields = function () {
        try {
            var storage = window.sessionStorage
            if (!storage) return
            storage.removeItem(PENDING_FIELDS_KEY)
        } catch (error) {
            /* a snapshot that cannot be cleared only costs a stale retry */
        }
    }

    /**
     * Clears both the pending-save marker and its field snapshot.
     *
     * @returns {void}
     */
    var clearPendingSave = function () {
        clearFlag(PENDING_SAVE_FLAG)
        clearPendingFields()
    }

    /* -------------------------- CompleteRegistration ------------------------- */

    /**
     * Sends CompleteRegistration to Meta, once per browser session.
     *
     * @returns {void}
     */
    var fireCompleteRegistration = function () {
        try {
            if (flagIsSet(FIRED_FLAG)) return

            if (typeof window.fbq !== 'function') {
                warn(
                    'Meta Pixel not found, skipped ' +
                        COMPLETE_REGISTRATION_EVENT +
                        '. Install the pixel base snippet in site-head custom code.',
                )
                return
            }

            var eventId = ensureEventId()
            var options = {}
            if (eventId) options.eventID = eventId

            window.fbq('track', COMPLETE_REGISTRATION_EVENT, {}, options)
            setFlag(FIRED_FLAG)
        } catch (error) {
            warn('failed to fire ' + COMPLETE_REGISTRATION_EVENT)
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

    /* ---------------------------- field persistence -------------------------- */

    /**
     * Collects the captured cookies as Memberstack custom fields.
     *
     * Absent and empty (including whitespace-only) cookies are omitted, exactly
     * like `quiz-results.js`: a later untagged visit must never blank a value an
     * earlier tagged visit captured.
     *
     * @returns {object} Non-empty values keyed by custom-field ID.
     */
    var attributionCustomFieldsFromCookies = function () {
        var customFields = {}
        COOKIE_NAMES.forEach(function (name) {
            var raw = readCookie(name)
            if (raw == null) return
            var value = String(raw).trim()
            if (!value) return
            var fieldId = FIELD_IDS[name]
            if (!fieldId) return
            customFields[fieldId] = value
        })
        return customFields
    }

    /**
     * Writes attribution fields onto the current member.
     *
     * @param {object} memberstack Memberstack DOM instance.
     * @param {object} [customFields] Snapshot to write; live cookies when omitted.
     * @returns {Promise<boolean>} True when settled (write confirmed, or nothing
     *     owed because every cookie was absent/empty). False when Memberstack
     *     cannot accept the write yet.
     */
    var saveAttribution = async function (memberstack, customFields) {
        if (!memberstack || typeof memberstack.updateMember !== 'function') {
            warn('Memberstack updateMember unavailable, attribution not saved')
            return false
        }

        var fields =
            customFields && typeof customFields === 'object'
                ? customFields
                : attributionCustomFieldsFromCookies()
        // Nothing to write is settled, not a failure: with cookies blocked there
        // is no attribution to persist, and retrying forever would be pointless.
        if (!Object.keys(fields).length) return true

        // Memberstack rejects on failure, so a resolved call is the confirmation.
        await memberstack.updateMember({ customFields: fields })
        return true
    }

    /**
     * Saves the attribution fields, leaving the marker set on any failure.
     *
     * Prefers the signup-time snapshot so a fresh ad click between `/sign-up`
     * and `/brand-dashboard` cannot overwrite the values the signup owed. Falls
     * back to live cookies when an older marker has no snapshot (pre-snapshot
     * sessions, or blocked storage on the signup page).
     *
     * @param {object} memberstack Memberstack DOM instance.
     * @returns {Promise<void>}
     */
    var savePendingAttribution = async function (memberstack) {
        try {
            var snapshot = readPendingFields()
            var saved = await saveAttribution(
                memberstack,
                snapshot || undefined,
            )
            if (saved) clearPendingSave()
        } catch (error) {
            // The marker stays set on purpose: the next page load retries it.
            warn('attribution save failed, will retry on the next page load')
        }
    }

    // True only while THIS page's signup handler owns an in-flight direct save.
    // Used solely for the narrow race where a stale marker was already present
    // at load, the retry's member read is still pending, and the signup then
    // re-raises the marker: clearing on a logged-out answer would discard the
    // save the next page owes. Not a general "any marker from this page" latch.
    var savePendingFromThisPage = false

    /**
     * Snapshots the fields, marks the save as owed, and starts it.
     *
     * The marker and snapshot are written first and synchronously, because the
     * /sign-up form carries redirect="/brand-dashboard" and that navigation can
     * cut the updateMember request off before it lands.
     *
     * @param {object} memberstack Memberstack DOM instance.
     * @returns {void}
     */
    var persistAfterDirectSignup = function (memberstack) {
        savePendingFromThisPage = true
        var fields = attributionCustomFieldsFromCookies()
        writePendingFields(fields)
        setFlag(PENDING_SAVE_FLAG)
        savePendingAttribution(memberstack)
    }

    /**
     * Completes a save that an earlier page could not finish.
     *
     * Runs on every page load, which is what makes the /sign-up write survive its
     * own redirect: the attempt cut off there is retried on /brand-dashboard.
     *
     * @returns {Promise<void>}
     */
    var retryPendingSave = async function () {
        if (!flagIsSet(PENDING_SAVE_FLAG)) return

        var memberstack = await waitForMemberstack()
        if (!memberstack) {
            warn('Memberstack never loaded, pending attribution save deferred')
            return
        }

        var member = null
        try {
            member = getMemberData(await memberstack.getCurrentMember())
        } catch (error) {
            // Unreadable state is not proof of a logged-out visitor, so the
            // marker survives for the next load.
            warn('member state unreadable, pending attribution save deferred')
            return
        }

        if (!isLoggedInMember(member)) {
            // A marker left behind by a logged-out visitor can never be filled:
            // there is no member to write to, and the signup it belonged to is
            // gone. Clearing it stops an unfulfillable retry on every page.
            //
            // Exception: a stale marker was already present at load, this page's
            // signup re-raised it while the retry's member read was still in
            // flight, and that read then comes back logged out. That marker
            // belongs to a save that has only just started; clearing it would
            // throw away the attribution the /brand-dashboard load is supposed
            // to finish writing.
            if (!savePendingFromThisPage) clearPendingSave()
            return
        }

        await savePendingAttribution(memberstack)
    }

    // True from the moment a watch is claimed for this page until the page is
    // gone, released only when the claim could not be completed. A second
    // onAuthChange listener would fire CompleteRegistration twice and start two
    // competing saves, so rearm() has to be able to see that one already exists.
    var signupWatchArmed = false

    /**
     * Watches this page for its logged-out to logged-in transition.
     *
     * @param {{ directSave: boolean }} policy
     * @returns {Promise<void>}
     */
    var watchSignupTransition = async function (policy) {
        var memberstack = await waitForMemberstack()
        if (!memberstack) {
            signupWatchArmed = false
            warn('Memberstack never loaded, CompleteRegistration is unwatched')
            return
        }

        // Tri-state on purpose. true = arrived logged out (arm for transition).
        // false = arrived logged in (ignore auth replays). null = unreadable:
        // never treat as logged out, or a failed getCurrentMember for an already
        // signed-in visitor would fire CompleteRegistration and start a spurious
        // direct save on the next auth replay.
        var seenLoggedOut = null
        try {
            var current = await memberstack.getCurrentMember()
            seenLoggedOut = !isLoggedInMember(getMemberData(current))
        } catch (error) {
            warn('member state unreadable at signup watch start')
            seenLoggedOut = null
        }

        if (typeof memberstack.onAuthChange !== 'function') {
            signupWatchArmed = false
            return
        }

        memberstack.onAuthChange(function (payload) {
            try {
                var loggedIn = isLoggedInMember(getMemberData(payload))
                if (loggedIn && seenLoggedOut === true) {
                    fireCompleteRegistration()
                    // /quiz is excluded: quiz-results.js writes these fields as
                    // part of its own single quiz save.
                    if (policy.directSave) {
                        persistAfterDirectSignup(memberstack)
                    }
                }
                // First definitive reading after an unreadable start only arms
                // the watch: a logged-in replay is "already in", a logged-out
                // reading waits for a later transition.
                seenLoggedOut = loggedIn ? false : true
            } catch (error) {
                /* attribution must never break the signup */
            }
        })
    }

    /**
     * Resolves this page's policy and, when there is one, starts the watch.
     *
     * The claim is taken synchronously, before waitForMemberstack's first await,
     * so two calls in the same tick cannot both reach onAuthChange. A claim that
     * cannot be completed is released again, which is what leaves a later
     * rearm() free to retry.
     *
     * @returns {boolean} True when a watch is armed or being armed.
     */
    var armSignupWatch = function () {
        try {
            if (signupWatchArmed) return true

            var pathname = (window.location && window.location.pathname) || ''
            var policy = resolveSignupPolicy(pathname)
            if (!policy) return false

            signupWatchArmed = true
            runSafely(function () {
                return watchSignupTransition(policy)
            }, 'CompleteRegistration wiring failed')
            return true
        } catch (error) {
            warn('signup watch could not be armed')
            return false
        }
    }

    /* ---------------------------------- boot -------------------------------- */

    /**
     * Starts an async step so neither its throw nor its rejection reaches the
     * page.
     *
     * @param {function(): Promise<void>} step
     * @param {string} message Staging-only warning for a failed step.
     * @returns {void}
     */
    var runSafely = function (step, message) {
        try {
            var pending = step()
            if (pending && typeof pending.catch === 'function') {
                pending.catch(function () {
                    warn(message)
                })
            }
        } catch (error) {
            warn(message)
        }
    }

    /**
     * @returns {void}
     */
    var init = function () {
        try {
            capture()
        } catch (error) {
            warn('capture failed')
        }

        // One scan of the DOM as it stands now; rearm() covers a form injected
        // later.
        armSignupWatch()
        // Sitewide, not just on the signup pages: this is the step that finishes a
        // direct save that the signup form's own redirect cut short.
        runSafely(retryPendingSave, 'pending attribution save failed')
    }

    window.StartersAttribution = {
        // Keep in sync with the @release line in this file's header comment; the
        // signup-attribution.test.js drift guard asserts they match.
        release: RELEASE,
        getParams: getParams,
        // For a caller that injects a signup form after DOMContentLoaded, like
        // v3/starters-ms-redirect.js exposes apply(). A no-op once armed.
        rearm: armSignupWatch,
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init)
    } else {
        init()
    }
})()
