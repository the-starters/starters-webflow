/**
 * Sitewide UTM and Meta ad attribution capture.
 *
 * @release v1.59.232
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
 *   utm_source    from `?utm_source`
 *   utm_campaign  from `?utm_campaign`
 *   utm_adset     from `?utm_adset`
 *   utm_content   from `?utm_content`
 *   fbclid        from `?fbclid`
 *   fbc           copied from Meta's own `_fbc` cookie when ours is unset
 *   fbp           copied from Meta's own `_fbp` cookie when ours is unset
 *   event_id      `evt_<uuid>`, generated once and then reused
 *   signup_source   normalized path of the page the signup happened on
 *   signup_referrer normalized path of the same-origin page they came FROM
 *   signup_trigger  which CTA opened the signup surface (`hire`, `message`,
 *                   `book-call`, or `service:<detail>`)
 *
 * A URL parameter only overwrites its cookie when the URL actually carries a
 * value, so the freshest click wins and a plain internal navigation never clears
 * an earlier one. The `_fbc`/`_fbp` copy is re-checked on every page load
 * because the pixel writes those cookies itself and can load after this script.
 *
 * The three signup cookies are the ones no URL can supply. Source and referrer
 * are derived at the Memberstack auth transition, not during capture, and
 * trigger is derived from the CTA that opened signup. None of them are in
 * URL_PARAMS so that `?signup_source=`, `?signup_referrer=`, or
 * `?signup_trigger=` cannot dictate a field whose whole job is to report what
 * really happened.
 *
 * `signup_source` answers "which page was the form on" from `location.pathname`.
 * `signup_referrer` answers "where were they when they decided" from
 * `document.referrer`, same-origin only, path only. The pair is needed because a
 * visitor who clicks Get started on `/` signs up on `/quiz`: the source says
 * `/quiz`, and only the referrer says `/home`. `/` carries no signup form at all, so
 * source alone can never name it.
 *
 * Capture at the transition rather than on load, for both, for the same reason.
 * On every page load the cookie would mean "last page loaded" and its referrer,
 * and each armed page would be clobbered by its own redirect: `/sign-up` would
 * report `/brand-dashboard`, and `/quiz` is worse because `quiz-results.js` reads
 * these cookies a page later, so `signup_referrer` would have been overwritten by
 * `/quiz-results`'s own referrer, which is `/quiz` itself. Every quiz signup
 * would say it came from `/quiz` and the real answer would be gone. Firing on the
 * transition instead pins both values to the page load the signup happened on.
 * That is also why the `/all-starters` modal works: the transition fires on the
 * original page load, before the modal's `?modal-id=signup-modal` reload, so the
 * referrer is still the page that linked to `/all-starters` and not
 * `/all-starters` itself.
 *
 * `signup_source` always overwrites its cookie, because reaching the transition
 * on an armed page IS a signup and so always carries a real path.
 * `signup_referrer` writes nothing in three cases, all of them honest silence
 * rather than a value: no referrer at all (direct navigation, typed URL, stripped
 * referrer policy), a cross-origin referrer, and an empty path.
 *
 * The cookies overwrite freely; three FIELDS do not. `signup-source`,
 * `signup-referrer`, and `signup-trigger` are write-once on the member: once
 * any of them holds a non-empty value, no write here may replace that field,
 * did this member come from" (and which CTA opened signup) stops being true the
 * moment it is overwritten. All three are facts about one signup that never
 * change afterwards, so they are guarded together; guarding a subset would read
 * as a deliberate distinction that does not exist. The other eight fields stay
 * last-touch, so the guard strips at most those three keys from the outgoing
 * payload and leaves the rest of the write alone. It is needed
 * because this script cannot see a signup, only a logged-out to logged-in
 * transition on a page that has a signup form, and a returning member logging in
 * there looks identical. When the member's existing values cannot be read at all
 * the write goes ahead: see withoutFilledWriteOnceFields for why doubt resolves
 * the other way here than it does for CompleteRegistration.
 *
 * Memberstack custom-field mapping, cookie name to field ID: underscores become
 * hyphens. All 11 field IDs are verified to exist in the Memberstack app config,
 * so do not rename any of them here: Memberstack silently drops a write to a
 * field it does not know.
 *
 *   `utm_source` -> `utm-source`
 *   `utm_campaign` -> `utm-campaign`
 *   `utm_adset` -> `utm-adset`
 *   `utm_content` -> `utm-content`
 *   `fbclid` -> `fbclid`
 *   `fbc` -> `fbc`
 *   `fbp` -> `fbp`
 *   `event_id` -> `event-id`
 *   `signup_source` -> `signup-source`
 *   `signup_referrer` -> `signup-referrer`
 *   `signup_trigger` -> `signup-trigger`
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
 * V3 lead-entry registration. On an exact production Collection, Learn, or
 * Starter CMS item route, the same unambiguous logged-out to logged-in
 * transition also snapshots one pending lead-entry event before Memberstack
 * redirects. The next page retries the authenticated Xano registration if
 * navigation cut the first request off. The browser never calls Mailchimp.
 * Xano endpoint
 * `lead_email/register/v3` owns identity, Brand Free eligibility, route and CMS
 * collection allowlists, suppression, and idempotency. Unsupported routes and
 * non-production hosts fail closed. The accepted event is reported to PostHog
 * at most once per event and CMS resource in the browser session, without
 * member IDs or email addresses.
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

    var RELEASE = 'v1.59.232'
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

    // Both deliberately absent from URL_PARAMS: they are derived from the page the
    // signup happened on and the page it was reached from, so a `?signup_source=`
    // or `?signup_referrer=` in the URL must never be able to dictate them. See
    // captureSignupSource and captureSignupReferrer.
    var SIGNUP_SOURCE_COOKIE = 'signup_source'
    var SIGNUP_REFERRER_COOKIE = 'signup_referrer'
    var SIGNUP_TRIGGER_COOKIE = 'signup_trigger'
    var SIGNUP_TRIGGER_ELEMENT_ATTR = 'data-signup-trigger-element'
    var SIGNUP_TRIGGER_VALUE_ATTR = 'data-signup-trigger-value'
    var SIGNUP_TRIGGER_SELECTOR = '[' + SIGNUP_TRIGGER_ELEMENT_ATTR + ']'
    var UNGATED_LEARN_SIGNUP_LINK_SELECTOR = 'a[href="/quiz"]'
    var SIGNUP_MODAL_ID = 'signup-modal'
    var ALLOWED_TRIGGER_ELEMENTS = {
        hire: true,
        message: true,
        'book-call': true,
        service: true,
    }

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
        signup_source: 'signup-source',
        signup_referrer: 'signup-referrer',
        signup_trigger: 'signup-trigger',
    }

    // The fields that record a fact about one signup rather than a last-touch
    // value. All three are set once, at the transition (paths) or the CTA click
    // (trigger), and are wrong the moment anything replaces them, so saveAttribution
    // holds them back for a member who already has one. The eight click fields are
    // deliberately not in here: a fresh ad click is supposed to update those.
    var WRITE_ONCE_FIELD_IDS = [
        FIELD_IDS.signup_source,
        FIELD_IDS.signup_referrer,
        FIELD_IDS.signup_trigger,
    ]

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

    var LEAD_ENTRY_PENDING_KEY = 'startersLeadEntryPendingV1'
    var LEAD_ENTRY_POSTHOG_PENDING_KEY = 'startersLeadEntryPosthogPendingV1'
    var LEAD_ENTRY_POSTHOG_PREFIX = 'startersLeadEntryPosthogV1:'
    var LEAD_ENTRY_AUTH_BASE =
        'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh'
    var LEAD_ENTRY_API_URL =
        'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/lead_email/register/v3'
    var LEAD_ENTRY_RETRY_DELAYS = [0, 750, 2000, 5000]
    var LEAD_ENTRY_POSTHOG_RETRY_DELAYS = [0, 250, 1000, 3000, 7500]
    var LEAD_ENTRY_MAX_AGE_MS = 24 * 60 * 60 * 1000
    var LEAD_ENTRY_PRODUCTION_HOSTS = {
        'thestarters.com': true,
        'www.thestarters.com': true,
    }
    var LEAD_ENTRY_PATH_POLICIES = [
        {
            prefix: '/skills/',
            collectionId: '69cccee53fd01363c8d406f3',
            pageId: '69cccee53fd01363c8d406f9',
            intentSubtype: 'collection_signup',
            trackKey: 'collection',
        },
        {
            prefix: '/tools/',
            collectionId: '69ccce82af83f16acf711e18',
            pageId: '69ccce82af83f16acf711e1e',
            intentSubtype: 'collection_signup',
            trackKey: 'collection',
        },
        {
            prefix: '/industries/',
            collectionId: '69cccd9d0354a390eb378509',
            pageId: '69cccd9e0354a390eb37855c',
            intentSubtype: 'collection_signup',
            trackKey: 'collection',
        },
        {
            prefix: '/companies/',
            collectionId: '69f23440f1e67c01bcd642ca',
            pageId: '69f23440f1e67c01bcd642d0',
            intentSubtype: 'collection_signup',
            trackKey: 'collection',
        },
        {
            prefix: '/categories/',
            collectionId: '69f2329d4f5bacf6765c1ca1',
            pageId: '69f2329e4f5bacf6765c1cc6',
            intentSubtype: 'collection_signup',
            trackKey: 'collection',
        },
        {
            prefix: '/subcategories/',
            collectionId: '69f233f6f3e97748419e3a3d',
            pageId: '69f233f7f3e97748419e3a43',
            intentSubtype: 'collection_signup',
            trackKey: 'collection',
        },
        {
            prefix: '/learn/playbooks-frameworks/',
            collectionId: '69e1e416f6476e12f572b39b',
            pageId: '69e1e417f6476e12f572b468',
            intentSubtype: 'learn_unlock',
            trackKey: 'learn_gated',
        },
        {
            prefix: '/learn/interviews-analyses/',
            collectionId: '69dca9df095d2fbcf34e255b',
            pageId: '69dca9df095d2fbcf34e2575',
            intentSubtype: 'learn_signup',
            trackKey: 'learn_ungated',
        },
        {
            prefix: '/learn/sessions/',
            collectionId: '69e08554183023227aa46c1e',
            pageId: '69e08554183023227aa46c24',
            intentSubtype: 'session_signup',
            trackKey: 'learn_session',
        },
        {
            prefix: '/hire/',
            collectionId: '69f241ec147b71addb6f1531',
            pageId: '69f241ed147b71addb6f153d',
            intentFromSignupTrigger: true,
        },
    ]

    var MEMBERSTACK_POLL_MS = 100
    var MEMBERSTACK_MAX_WAIT_MS = 10000

    var leadEntryRegistrationInFlight = null
    var leadEntryPosthogRetryInFlight = null
    var leadEntryPendingFromThisPage = false
    var leadEntrySignupSubmitted = false
    var leadEntryIntentFromThisPage = null

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
     * Resolves one exact V3 production CMS item route to the allowlisted Xano
     * lead-entry contract. A list page, nested path, query string, unsupported
     * host, or malformed slug returns null.
     *
     * @param {string} pathname
     * @returns {object | null}
     */
    var leadEntryIntentForSignupTrigger = function (raw) {
        var value = String(raw || '').trim().toLowerCase()
        if (value === 'hire') {
            return { intent_subtype: 'hire', track_key: 'starter_connect' }
        }
        if (value === 'message') {
            return { intent_subtype: 'message', track_key: 'starter_connect' }
        }
        if (value === 'book-call') {
            return { intent_subtype: 'booking', track_key: 'starter_booking' }
        }
        if (value === 'service:free call') {
            return { intent_subtype: 'booking_free', track_key: 'starter_booking' }
        }
        if (value === 'service:paid consulting call') {
            return { intent_subtype: 'booking_paid', track_key: 'starter_booking' }
        }
        return null
    }

    var leadEntryContextForPath = function (pathname) {
        try {
            var hostname =
                (window.location && window.location.hostname || '').toLowerCase()
            if (!LEAD_ENTRY_PRODUCTION_HOSTS[hostname]) return null

            var route = normalizePath(pathname)
            for (var index = 0; index < LEAD_ENTRY_PATH_POLICIES.length; index += 1) {
                var policy = LEAD_ENTRY_PATH_POLICIES[index]
                if (route.indexOf(policy.prefix) !== 0) continue

                var renderedPageId =
                    document &&
                    document.documentElement &&
                    typeof document.documentElement.getAttribute === 'function'
                        ? trimmed(document.documentElement.getAttribute('data-wf-page'))
                        : ''
                if (!renderedPageId || renderedPageId !== policy.pageId) return null

                var slug = route.slice(policy.prefix.length)
                if (
                    !slug ||
                    slug.length > 160 ||
                    slug.indexOf('/') !== -1 ||
                    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)
                ) {
                    return null
                }

                var intent = policy.intentFromSignupTrigger
                    ? leadEntryIntentFromThisPage
                    : {
                          intent_subtype: policy.intentSubtype,
                          track_key: policy.trackKey,
                      }
                if (!intent) return null

                return {
                    source_route: route,
                    source_collection_id: policy.collectionId,
                    source_resource_slug: slug,
                    intent_subtype: intent.intent_subtype,
                    track_key: intent.track_key,
                }
            }
        } catch (error) {
            /* unsupported or unreadable routes fail closed */
        }
        return null
    }

    /**
     * @param {string} value
     * @param {number} limit
     * @returns {string | null}
     */
    var safeLeadEntryProperty = function (value, limit) {
        var normalized = trimmed(value)
        if (!normalized || normalized.indexOf('<') !== -1 || normalized.indexOf('>') !== -1) {
            return null
        }
        return normalized.slice(0, limit)
    }

    /**
     * Provider-visible properties are an explicit, non-PII allowlist. Xano adds
     * the canonical first name server-side and never trusts a browser name.
     *
     * @returns {object}
     */
    var leadEntryProperties = function () {
        var properties = { client_payload_version: 'lead_entry_browser_v1' }
        ;[
            'utm_source',
            'utm_campaign',
            'utm_adset',
            'utm_content',
            'signup_source',
            'signup_referrer',
            'signup_trigger',
        ].forEach(function (name) {
            var value = safeLeadEntryProperty(readCookie(name), 300)
            if (value) properties[name] = value
        })
        return properties
    }

    /**
     * @returns {object | null}
     */
    var readPendingLeadEntry = function () {
        try {
            var storage = window.sessionStorage
            if (!storage) return null
            var raw = storage.getItem(LEAD_ENTRY_PENDING_KEY)
            if (!raw) return null
            var pending = JSON.parse(raw)
            if (!pending || typeof pending !== 'object' || Array.isArray(pending)) {
                return null
            }
            return pending
        } catch (error) {
            return null
        }
    }

    /**
     * @param {object} pending
     * @returns {void}
     */
    var writePendingLeadEntry = function (pending) {
        try {
            var storage = window.sessionStorage
            if (!storage) return
            storage.setItem(LEAD_ENTRY_PENDING_KEY, JSON.stringify(pending))
        } catch (error) {
            /* blocked storage fails closed because registration reads this snapshot */
        }
    }

    /** @returns {void} */
    var clearPendingLeadEntry = function () {
        try {
            var storage = window.sessionStorage
            if (storage) storage.removeItem(LEAD_ENTRY_PENDING_KEY)
        } catch (error) {
            /* an uncleared snapshot remains safe because Xano is idempotent */
        }
    }

    /**
     * @param {number} delay
     * @returns {Promise<void>}
     */
    var wait = function (delay) {
        return new Promise(function (resolve) {
            setTimeout(resolve, delay)
        })
    }

    /**
     * @param {object} memberstack
     * @returns {Promise<string>}
     */
    var tradeLeadEntryToken = async function (memberstack) {
        if (!memberstack || typeof memberstack.getMemberCookie !== 'function') {
            throw new Error('Memberstack session unavailable')
        }
        var memberstackToken = await memberstack.getMemberCookie()
        if (!memberstackToken) throw new Error('Memberstack session unavailable')

        var response = await window.fetch(
            LEAD_ENTRY_AUTH_BASE +
                '/auth/trade-token/v3?token=' +
                encodeURIComponent(memberstackToken),
            { method: 'GET', credentials: 'omit' },
        )
        var body = await response.json().catch(function () {
            return null
        })
        var token =
            typeof body === 'string' ? body : body && (body.authToken || body.token)
        if (!response.ok || !token) throw new Error('V3 session exchange failed')
        return token
    }

    /**
     * @param {object} pending
     * @returns {boolean} Whether this browser session completed the capture.
     */
    var captureLeadEntryPosthog = function (pending) {
        var key
        var storage
        try {
            key =
                LEAD_ENTRY_POSTHOG_PREFIX +
                pending.source_event_id + ':' +
                pending.source_collection_id + ':' +
                pending.source_resource_slug
            storage = window.sessionStorage
            if (storage && storage.getItem(key) === 'true') return true
            if (
                !window.posthog ||
                window.posthog.__loaded !== true ||
                typeof window.posthog.capture !== 'function'
            ) {
                return false
            }

            // Mark before capture so a page rerun cannot enqueue the same
            // analytics event twice. A synchronous capture failure releases the
            // marker and leaves the safe pending snapshot available for retry.
            if (storage) storage.setItem(key, 'true')
            window.posthog.capture('v3_lead_entry_registered', {
                track_key: pending.track_key,
                intent_subtype: pending.intent_subtype,
                source_route: pending.source_route,
                source_collection_id: pending.source_collection_id,
                source_resource_slug: pending.source_resource_slug,
                payload_version: 'lead_entry_browser_v1',
            })
            return true
        } catch (error) {
            try {
                if (storage && key) storage.removeItem(key)
            } catch (storageError) {
                /* analytics storage must never affect registration */
            }
            /* analytics must never affect registration */
            return false
        }
    }

    /**
     * Persists only the non-PII fields needed to retry PostHog after the SDK has
     * loaded. The canonical Xano event is already accepted at this point.
     *
     * @param {object} pending
     * @returns {void}
     */
    var queueLeadEntryPosthog = function (pending) {
        try {
            var storage = window.sessionStorage
            if (!storage || !pending) return
            storage.setItem(
                LEAD_ENTRY_POSTHOG_PENDING_KEY,
                JSON.stringify({
                    source_event_id: pending.source_event_id,
                    source_collection_id: pending.source_collection_id,
                    source_resource_slug: pending.source_resource_slug,
                    track_key: pending.track_key,
                    intent_subtype: pending.intent_subtype,
                    source_route: pending.source_route,
                    captured_at: Number(pending.captured_at || Date.now()),
                }),
            )
        } catch (error) {
            /* analytics storage must never affect registration */
        }
    }

    /**
     * @returns {object|null}
     */
    var readQueuedLeadEntryPosthog = function () {
        try {
            var storage = window.sessionStorage
            var raw = storage && storage.getItem(LEAD_ENTRY_POSTHOG_PENDING_KEY)
            if (!raw) return null

            var snapshot
            try {
                snapshot = JSON.parse(raw)
            } catch (error) {
                storage.removeItem(LEAD_ENTRY_POSTHOG_PENDING_KEY)
                return null
            }

            if (
                !snapshot ||
                Date.now() - Number(snapshot.captured_at || 0) >
                    LEAD_ENTRY_MAX_AGE_MS
            ) {
                storage.removeItem(LEAD_ENTRY_POSTHOG_PENDING_KEY)
                return null
            }

            return snapshot
        } catch (error) {
            return null
        }
    }

    /**
     * @returns {void}
     */
    var clearQueuedLeadEntryPosthog = function () {
        try {
            var storage = window.sessionStorage
            if (storage) storage.removeItem(LEAD_ENTRY_POSTHOG_PENDING_KEY)
        } catch (error) {}
    }

    /**
     * Retries the safe analytics snapshot only until the real PostHog SDK is
     * ready. Page reloads resume the same snapshot from sessionStorage.
     *
     * @param {object} [pending]
     * @returns {Promise<boolean>}
     */
    var retryLeadEntryPosthog = function (pending) {
        try {
            if (pending && captureLeadEntryPosthog(pending)) {
                return Promise.resolve(true)
            }
            if (pending) queueLeadEntryPosthog(pending)
            if (leadEntryPosthogRetryInFlight) return leadEntryPosthogRetryInFlight
            if (!readQueuedLeadEntryPosthog()) return Promise.resolve(false)

            leadEntryPosthogRetryInFlight = (async function () {
                for (
                    var attempt = 0;
                    attempt < LEAD_ENTRY_POSTHOG_RETRY_DELAYS.length;
                    attempt += 1
                ) {
                    if (LEAD_ENTRY_POSTHOG_RETRY_DELAYS[attempt]) {
                        await wait(LEAD_ENTRY_POSTHOG_RETRY_DELAYS[attempt])
                    }

                    var snapshot = readQueuedLeadEntryPosthog()
                    if (!snapshot) return false

                    if (captureLeadEntryPosthog(snapshot)) {
                        clearQueuedLeadEntryPosthog()
                        return true
                    }
                }
                return false
            })().then(
                function (result) {
                    leadEntryPosthogRetryInFlight = null
                    return result
                },
                function () {
                    leadEntryPosthogRetryInFlight = null
                    return false
                },
            )

            return leadEntryPosthogRetryInFlight
        } catch (error) {
            return Promise.resolve(false)
        }
    }

    /**
     * @param {object} memberstack
     * @param {object} member
     * @returns {Promise<boolean>}
     */
    var registerPendingLeadEntry = async function (memberstack, member) {
        if (leadEntryRegistrationInFlight) return leadEntryRegistrationInFlight

        leadEntryRegistrationInFlight = (async function () {
            var pending = readPendingLeadEntry()
            if (!pending) return false

            var currentMember = getMemberData(member)
            if (!currentMember && memberstack && typeof memberstack.getCurrentMember === 'function') {
                currentMember = getMemberData(await memberstack.getCurrentMember())
            }
            if (!isLoggedInMember(currentMember)) return false

            var currentMemberId = trimmed(currentMember.id || currentMember._id)
            if (!currentMemberId || currentMemberId !== pending.expected_member_id) {
                clearPendingLeadEntry()
                return false
            }

            if (
                !LEAD_ENTRY_PRODUCTION_HOSTS[
                    ((window.location && window.location.hostname) || '').toLowerCase()
                ] ||
                Date.now() - Number(pending.captured_at || 0) > LEAD_ENTRY_MAX_AGE_MS
            ) {
                clearPendingLeadEntry()
                return false
            }

            for (var attempt = 0; attempt < LEAD_ENTRY_RETRY_DELAYS.length; attempt += 1) {
                if (LEAD_ENTRY_RETRY_DELAYS[attempt]) {
                    await wait(LEAD_ENTRY_RETRY_DELAYS[attempt])
                }
                try {
                    var token = await tradeLeadEntryToken(memberstack)
                    var response = await window.fetch(LEAD_ENTRY_API_URL, {
                        method: 'POST',
                        credentials: 'omit',
                        headers: {
                            Authorization: 'Bearer ' + token,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            source_event_id: pending.source_event_id,
                            source_route: pending.source_route,
                            source_collection_id: pending.source_collection_id,
                            source_resource_slug: pending.source_resource_slug,
                            intent_subtype: pending.intent_subtype,
                            properties: pending.properties,
                        }),
                    })
                    var body = await response.json().catch(function () {
                        return null
                    })
                    if (response.ok && body && body.ok === true) {
                        clearPendingLeadEntry()
                        retryLeadEntryPosthog(pending)
                        return true
                    }
                    if (
                        response.status >= 400 &&
                        response.status < 500 &&
                        response.status !== 401 &&
                        response.status !== 408 &&
                        response.status !== 429
                    ) {
                        clearPendingLeadEntry()
                        warn('lead-entry registration rejected by its V3 contract')
                        return false
                    }
                } catch (error) {
                    /* the bounded retry loop owns transient failures */
                }
            }

            warn('lead-entry registration deferred to the next page load')
            return false
        })()

        try {
            return await leadEntryRegistrationInFlight
        } finally {
            leadEntryRegistrationInFlight = null
        }
    }

    /**
     * Snapshot before the signup redirect, then start the best-effort current
     * page attempt. The next V3 production page repeats it if navigation wins.
     *
     * @param {object} memberstack
     * @param {object} member
     * @returns {void}
     */
    var persistLeadEntryAfterSignup = function (memberstack, member) {
        try {
            if (!leadEntrySignupSubmitted) return
            var context = leadEntryContextForPath(
                (window.location && window.location.pathname) || '',
            )
            var currentMember = getMemberData(member)
            var memberId = trimmed(currentMember && (currentMember.id || currentMember._id))
            if (!context || !memberId) return

            var sourceEventId = ensureEventId()
            if (!sourceEventId || sourceEventId.indexOf(EVENT_ID_PREFIX) !== 0) return

            leadEntryPendingFromThisPage = true
            var pending = {
                expected_member_id: memberId,
                source_event_id: sourceEventId,
                source_route: context.source_route,
                source_collection_id: context.source_collection_id,
                source_resource_slug: context.source_resource_slug,
                intent_subtype: context.intent_subtype,
                track_key: context.track_key,
                properties: leadEntryProperties(),
                captured_at: Date.now(),
            }
            writePendingLeadEntry(pending)
            leadEntrySignupSubmitted = false
            runSafely(function () {
                return registerPendingLeadEntry(memberstack, currentMember)
            }, 'lead-entry registration failed')
        } catch (error) {
            /* a missed lead event must never break signup */
        }
    }

    /**
     * @returns {Promise<void>}
     */
    var retryPendingLeadEntry = async function () {
        if (!readPendingLeadEntry()) return

        var memberstack = await waitForMemberstack()
        if (!memberstack) return
        var member = null
        try {
            member = getMemberData(await memberstack.getCurrentMember())
        } catch (error) {
            return
        }
        if (!isLoggedInMember(member)) {
            if (!leadEntryPendingFromThisPage) clearPendingLeadEntry()
            return
        }
        await registerPendingLeadEntry(memberstack, member)
    }

    /**
     * A CMS page can also expose an "already have an account" login inside the
     * same modal after initial DOM detection. Requiring the actual signup form's
     * submit event keeps that login from creating a lead-entry event.
     *
     * @param {Event} event
     * @returns {void}
     */
    var onLeadEntrySignupSubmit = function (event) {
        try {
            if (
                !leadEntryContextForPath(
                    (window.location && window.location.pathname) || '',
                )
            ) {
                return
            }
            var target = event && event.target
            if (!target || typeof target.getAttribute !== 'function') return
            var formKind = target.getAttribute('data-ms-form')
            if (formKind === 'login') {
                leadEntrySignupSubmitted = false
                return
            }
            if (formKind === 'signup') leadEntrySignupSubmitted = true
        } catch (error) {
            /* an unreadable form fails closed */
        }
    }

    /** @returns {void} */
    var bindLeadEntrySignupSubmit = function () {
        try {
            if (!document || typeof document.addEventListener !== 'function') return
            document.addEventListener('submit', onLeadEntrySignupSubmit, true)
        } catch (error) {
            /* a page that cannot listen never registers a lead entry */
        }
    }

    /**
     * Path written into signup_source / signup_referrer cookies.
     *
     * The live homepage route stays `/`. Attribution stores `/home` so every
     * persisted value is path-shaped with a leading slash.
     *
     * @param {string} pathname
     * @returns {string}
     */
    var storedAttributionPath = function (pathname) {
        var path = normalizePath(pathname)
        if (path === '/') return '/home'
        return path
    }

    /**
     * Stores the page this signup happened on, in the normalized form the rest of
     * the file already compares paths in.
     *
     * Called from the auth transition and nowhere else. It cannot live in
     * capture(), which runs on every page load: the cookie would then mean "last
     * page loaded" rather than "page the signup happened on", and each armed page
     * would be clobbered by its own redirect (`/sign-up` reporting
     * `/brand-dashboard`, `/quiz` reporting `/quiz-results`). The transition is
     * the only moment where the value is both known and final.
     *
     * Unlike the URL-parameter cookies this always overwrites. There, absence is
     * ambiguous (a plain internal navigation is not a new click), so a write is
     * conditional on the URL carrying something. Here a write only happens
     * because a signup just completed on this page, so there is always a real
     * value and nothing earlier worth keeping. An unreadable or empty path is the
     * one exception: writing junk is worse than writing nothing, and "absence
     * never clears" still holds.
     *
     * @returns {void}
     */
    var captureSignupSource = function () {
        try {
            var path = storedAttributionPath(
                (window.location && window.location.pathname) || '',
            )
            if (!path) return
            writeCookie(SIGNUP_SOURCE_COOKIE, path)
        } catch (error) {
            /* an unrecorded signup source must never break the signup */
        }
    }

    /**
     * Stores the same-origin page the signup was reached from.
     *
     * The companion to captureSignupSource, and the reason both exist: source is
     * the page the form sits on, which for the funnel is always `/quiz`. This is
     * the page they were on when they decided, which is the question "someone
     * clicked Get started on the homepage and signed up on /quiz" actually asks.
     * `/` carries no signup form, so source can never name it.
     *
     * Called from the transition only, exactly like captureSignupSource, and for a
     * sharper version of the same reason. On every page load this cookie would
     * hold the CURRENT page's referrer, and `quiz-results.js` reads these cookies
     * one page later: by then `/quiz-results` would have overwritten it with its
     * own referrer, which is `/quiz`. Every quiz signup would claim it came from
     * `/quiz` and the real answer would be gone.
     *
     * Three cases write nothing, because blank is the honest answer and a wrong
     * value here is worse than no value:
     *
     *   - No referrer. Direct navigation, a typed URL, or a referrer policy that
     *     strips it. There was no previous page.
     *   - Cross-origin. Google, Meta, LinkedIn. The field's whole meaning is "the
     *     page on OUR site where they clicked", so a hostname does not belong in
     *     it, and external origin is already carried by `utm_source` and `fbclid`.
     *     Storing it here would poison a field of paths for no new information.
     *   - An empty path, same as captureSignupSource.
     *
     * @returns {void}
     */
    var captureSignupReferrer = function () {
        try {
            var referrer = (document && document.referrer) || ''
            if (!referrer) return

            var here = window.location || {}
            // Rebuilt from protocol and host when location.origin is missing. Not
            // a browser-support measure: `new URL` below is newer than
            // location.origin, so an engine without one has no chance with the
            // other and lands in the catch either way. It is a same-origin check
            // that refuses to guess. A location object we cannot derive an origin
            // from means we cannot prove the referrer is ours, and an unprovable
            // referrer is not written.
            var origin =
                here.origin ||
                (here.protocol && here.host ? here.protocol + '//' + here.host : '')
            if (!origin) return

            var parsed = new URL(referrer)
            if (parsed.origin !== origin) return

            // pathname carries neither the query string nor the hash, so
            // normalizePath gets the bare path and this matches signup_source.
            var path = storedAttributionPath(parsed.pathname)
            if (!path) return
            writeCookie(SIGNUP_REFERRER_COOKIE, path)
        } catch (error) {
            /* an unrecorded referrer must never break the signup */
        }
    }

    // Tri-state: true = confirmed logged out (stamp + open signup on tagged
    // CTAs). false = confirmed logged in (leave Hire/Message/Book alone).
    // null = unreadable; do not invent a signup modal.
    var viewerLoggedOut = null

    /**
     * @param {string} raw
     * @returns {string}
     */
    var trimmed = function (raw) {
        return raw == null ? '' : String(raw).trim()
    }

    /**
     * @param {Element} node
     * @returns {string | null} Cookie value to store, or null to write nothing.
     */
    var signupTriggerValueFrom = function (node) {
        var element = trimmed(node.getAttribute(SIGNUP_TRIGGER_ELEMENT_ATTR))
        if (!ALLOWED_TRIGGER_ELEMENTS[element]) {
            warn(
                'unknown ' +
                    SIGNUP_TRIGGER_ELEMENT_ATTR +
                    ' "' +
                    element +
                    '", signup trigger not stored',
            )
            return null
        }

        var custom = trimmed(node.getAttribute(SIGNUP_TRIGGER_VALUE_ATTR))
        if (element === 'service') {
            if (!custom) {
                warn(
                    'service trigger missing ' +
                        SIGNUP_TRIGGER_VALUE_ATTR +
                        ', signup trigger not stored',
                )
                return null
            }
            return 'service:' + custom
        }

        return custom || element
    }

    /**
     * @returns {object | null}
     */
    var signupModalEntry = function () {
        try {
            var modal = window.lumos && window.lumos.modal
            return modal && modal.list ? modal.list[SIGNUP_MODAL_ID] || null : null
        } catch (error) {
            return null
        }
    }

    /**
     * Capture-phase: stamp Signup Trigger and, when logged out, open signup
     * instead of Hire/Message/Book. Unknown or incomplete tags are ignored and
     * do not steal the click. The cookie is written only when signup actually
     * opens.
     *
     * @param {Event} event
     * @returns {void}
     */
    var onSignupTriggerClick = function (event) {
        try {
            if (viewerLoggedOut !== true) return
            var target = event && event.target
            if (!target || typeof target.closest !== 'function') return
            var node = target.closest(SIGNUP_TRIGGER_SELECTOR)
            var value = node ? signupTriggerValueFrom(node) : null
            var isUngatedLearnSignup = false
            if (!node) {
                var learnLink = target.closest(UNGATED_LEARN_SIGNUP_LINK_SELECTOR)
                var learnContext = leadEntryContextForPath(
                    (window.location && window.location.pathname) || '',
                )
                isUngatedLearnSignup = Boolean(
                    learnLink &&
                        learnContext &&
                        learnContext.track_key === 'learn_ungated',
                )
                if (!isUngatedLearnSignup) return
            } else if (!value) {
                return
            }
            var entry = signupModalEntry()
            if (!entry || typeof entry.open !== 'function') {
                warn('signup modal not found, tagged CTA did not open signup')
                return
            }

            if (typeof event.preventDefault === 'function') event.preventDefault()
            if (typeof event.stopPropagation === 'function') event.stopPropagation()
            if (typeof event.stopImmediatePropagation === 'function') {
                event.stopImmediatePropagation()
            }
            if (node) {
                writeCookie(SIGNUP_TRIGGER_COOKIE, value)
                leadEntryIntentFromThisPage = leadEntryIntentForSignupTrigger(value)
            }
            if (entry.el && entry.el.open) return
            entry.open()
        } catch (error) {
            /* a missed trigger must never break the click */
        }
    }

    /**
     * @returns {Promise<void>}
     */
    var probeViewerLoggedOut = async function () {
        var memberstack = await waitForMemberstack()
        if (!memberstack) return
        try {
            viewerLoggedOut = !isLoggedInMember(
                getMemberData(await memberstack.getCurrentMember()),
            )
        } catch (error) {
            viewerLoggedOut = null
        }
    }

    /**
     * @returns {void}
     */
    var bindSignupTriggerClicks = function () {
        try {
            if (!document || typeof document.addEventListener !== 'function') return
            document.addEventListener('click', onSignupTriggerClick, true)
        } catch (error) {
            /* a page that cannot listen just never stamps a trigger */
        }
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
     * @returns {boolean} True when the page holds at least one match. False
     *     when it holds none, and false when it cannot be queried at all.
     */
    var hasElementMatching = function (selector) {
        try {
            if (!document || typeof document.querySelectorAll !== 'function') {
                return false
            }
            var found = document.querySelectorAll(selector)
            return Boolean(found && found.length)
        } catch (error) {
            // An unqueryable DOM reads as "no forms here", which only costs the
            // watch on a page the path map does not already cover.
            return false
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
        if (!hasElementMatching(SIGNUP_FORM_SELECTOR)) return null

        if (hasElementMatching(LOGIN_FORM_SELECTOR)) {
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
     * Reads a member's custom fields off whatever member-ish object we hold.
     *
     * Unwraps with getMemberData first, so an `onAuthChange` payload, a
     * `getCurrentMember()` result and a bare member object are all accepted, and
     * accepts the three key spellings `quiz-results.js` already tolerates
     * (`getMemberCustomFields`, quiz-results.js:5206). Verified precedent note:
     * every existing onAuthChange consumer in this repo reads only `id`,
     * `planConnections` or `auth.email` off the payload, so nothing here proves
     * the payload carries `customFields` at all. Hence null rather than {} when
     * it does not: the caller has to be able to tell "this member has no
     * signup-source" apart from "this object never carried custom fields", and
     * only the second is worth a lookup.
     *
     * @param {object | null | undefined} payload
     * @returns {object | null} Custom fields, or null when this object has none.
     */
    var memberCustomFields = function (payload) {
        try {
            var member = getMemberData(payload)
            if (!member) return null
            var fields =
                member.customFields ||
                member.custom_fields ||
                member['custom-fields']
            if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
                return null
            }
            return fields
        } catch (error) {
            return null
        }
    }

    /**
     * Asks Memberstack for the member's custom fields.
     *
     * The fallback for a transition payload that carries none. Never called
     * before the pending-save snapshot is in storage: an await there would hand
     * the signup form's own redirect a window to cut the snapshot off, which is
     * the one failure this whole section exists to prevent.
     *
     * @param {object} memberstack Memberstack DOM instance.
     * @returns {Promise<object | null>} Custom fields, or null when unreadable.
     */
    var lookUpExistingCustomFields = async function (memberstack) {
        try {
            if (
                !memberstack ||
                typeof memberstack.getCurrentMember !== 'function'
            ) {
                return null
            }
            return memberCustomFields(await memberstack.getCurrentMember())
        } catch (error) {
            return null
        }
    }

    /**
     * @param {object} fields Outgoing custom fields, by field ID.
     * @returns {boolean} True when this write carries at least one write-once
     *     field, which is the only case worth paying a member read for.
     */
    var carriesWriteOnceField = function (fields) {
        if (!fields) return false
        return WRITE_ONCE_FIELD_IDS.some(function (fieldId) {
            return fields[fieldId] !== undefined
        })
    }

    /**
     * Drops the write-once fields from an outgoing write when the member already
     * has them, and leaves every other field alone.
     *
     * `signup-source` and `signup-referrer` both answer "where did this member
     * come from", and that answer stops being true the moment anything overwrites
     * it. They are one signup's facts, fixed at one moment, so they are guarded
     * as a set. The eight click fields are last-touch by design: a fresh ad click
     * is supposed to update them. So the guard is deliberately three keys wide
     * rather than a rule about the payload.
     *
     * It is needed because this script cannot actually see a signup. It sees a
     * logged-out to logged-in transition on a page that has a signup form, and a
     * returning member LOGGING IN there is the same event from here. The
     * login-form veto only runs at DOMContentLoaded, so a login form that
     * appears later (a modal swapping in "already have an account?") is never
     * seen at all. Without this guard that member's real signup page is replaced
     * with today's page.
     *
     * An unreadable existing value WRITES rather than skips, which is the
     * opposite of how armSignupWatch and detectedSignupPolicy resolve their
     * doubt. That is not an inconsistency: the two are asking different
     * questions and the cheaper failure is not the same one. Up there, guessing
     * wrong invents a CompleteRegistration for a conversion that never happened
     * and stamps a stranger's UTM values onto an existing member. Down here, the
     * common case by a wide margin is a genuine first signup whose field is
     * empty, so skipping on an unreadable read would throw away real attribution
     * on every signup whenever the read hiccups, in order to protect against the
     * much rarer overwrite. Write on doubt.
     *
     * Absent, null, empty and whitespace-only all count as unfilled, using the
     * same trim-and-check convention attributionCustomFieldsFromCookies applies
     * to cookie values.
     *
     * @param {object} fields Outgoing custom fields, by field ID.
     * @param {object | null} existingCustomFields The member's current fields,
     *     or null when they could not be read at all.
     * @returns {object} `fields`, or a copy without the already-filled
     *     write-once fields. Each is decided on its own, so a member holding one
     *     of the two still gets the other written.
     */
    var withoutFilledWriteOnceFields = function (fields, existingCustomFields) {
        try {
            if (!fields || !existingCustomFields) return fields

            var filled = WRITE_ONCE_FIELD_IDS.filter(function (fieldId) {
                if (fields[fieldId] === undefined) return false
                var existing = existingCustomFields[fieldId]
                if (existing == null) return false
                return String(existing).trim() !== ''
            })
            if (!filled.length) return fields

            var kept = {}
            Object.keys(fields).forEach(function (key) {
                if (filled.indexOf(key) === -1) kept[key] = fields[key]
            })
            return kept
        } catch (error) {
            // Same direction as an unreadable value: a guard that cannot run
            // must not cost the write.
            return fields
        }
    }

    /**
     * Writes attribution fields onto the current member.
     *
     * The single choke point every write passes through, direct save and retry
     * alike, which is why the write-once guard sits here rather than at the two
     * call sites: a third caller added later cannot forget it.
     *
     * @param {object} memberstack Memberstack DOM instance.
     * @param {object} [customFields] Snapshot to write; live cookies when omitted.
     * @param {object | null} [existingCustomFields] The member's current fields
     *     when the caller already holds them. Null or omitted means "look them
     *     up", so a caller that has already read the member and found none
     *     should pass `{}` instead of null and save the round trip.
     * @returns {Promise<boolean>} True when settled (write confirmed, or nothing
     *     owed because every cookie was absent/empty). False when Memberstack
     *     cannot accept the write yet.
     */
    var saveAttribution = async function (
        memberstack,
        customFields,
        existingCustomFields,
    ) {
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

        // Only worth a lookup when this write actually carries a guarded field and
        // the caller could not supply the member's current fields.
        var existing = existingCustomFields
        if (!existing && carriesWriteOnceField(fields)) {
            existing = await lookUpExistingCustomFields(memberstack)
        }
        fields = withoutFilledWriteOnceFields(fields, existing)

        // The guard can empty the payload: a save that owed only the write-once
        // fields to a member who already has them. Settled, not failed, or the
        // marker would be retried on every page load for a write that must never
        // happen.
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
     * @param {object | null} [existingCustomFields] Forwarded to saveAttribution:
     *     the member's current fields when the caller already holds them.
     * @returns {Promise<void>}
     */
    var savePendingAttribution = async function (
        memberstack,
        existingCustomFields,
    ) {
        try {
            var snapshot = readPendingFields()
            var saved = await saveAttribution(
                memberstack,
                snapshot || undefined,
                existingCustomFields,
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
     * The snapshot is deliberately NOT run through withoutFilledWriteOnceFields.
     * Nothing may be awaited before it reaches storage, and a synchronous guard
     * would have to skip on a payload that carries no custom fields, which is the
     * wrong direction (see withoutFilledWriteOnceFields). Guarding inside
     * saveAttribution instead means the value is checked against whatever member
     * data is available at each write attempt, including on the next page if the
     * redirect cuts this one off.
     *
     * @param {object} memberstack Memberstack DOM instance.
     * @param {object | null} [existingCustomFields] The transition payload's
     *     custom fields, when it carried any.
     * @returns {void}
     */
    var persistAfterDirectSignup = function (memberstack, existingCustomFields) {
        savePendingFromThisPage = true
        var fields = attributionCustomFieldsFromCookies()
        writePendingFields(fields)
        setFlag(PENDING_SAVE_FLAG)
        savePendingAttribution(memberstack, existingCustomFields)
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

        // This member read IS the lookup saveAttribution would otherwise make, so
        // hand its fields over. `{}` and not null when the member carries none:
        // null would send saveAttribution off to read the very same member again,
        // and an answer of "no custom fields" is already the answer that writes.
        await savePendingAttribution(memberstack, memberCustomFields(member) || {})
    }

    // True from the moment a watch is claimed for this page until the page is
    // gone, released only when the watch reports back that it could not be
    // established. A second onAuthChange listener would fire
    // CompleteRegistration twice and start two competing saves, so rearm() has
    // to be able to see that one already exists.
    //
    // armSignupWatch is the ONLY function that assigns this, deliberately.
    // watchSignupTransition reports its outcome as a return value instead of
    // clearing the flag itself, so correctness no longer depends on every
    // future exit path in that async function remembering to release: an added
    // early return can at worst report the wrong thing, not latch the claim
    // true forever and quietly turn rearm() into a no-op that still says true.
    var signupWatchArmed = false

    /**
     * Watches this page for its logged-out to logged-in transition.
     *
     * Never touches signupWatchArmed; it reports back instead, and
     * armSignupWatch owns the flag. A throw on the way to (or out of)
     * onAuthChange rejects this promise rather than returning, so the caller
     * never hears "not established" for that path, which is what deliberately
     * leaves the claim taken. See armSignupWatch for why that is the behaviour
     * we want.
     *
     * @param {{ directSave: boolean }} policy
     * @returns {Promise<boolean>} True when the onAuthChange listener was
     *     actually registered, false when it could not be: no Memberstack, or
     *     a Memberstack with no onAuthChange on it.
     */
    var watchSignupTransition = async function (policy) {
        var memberstack = await waitForMemberstack()
        if (!memberstack) {
            warn('Memberstack never loaded, CompleteRegistration is unwatched')
            return false
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
            viewerLoggedOut = seenLoggedOut
        } catch (error) {
            warn('member state unreadable at signup watch start')
            seenLoggedOut = null
            viewerLoggedOut = null
        }

        if (typeof memberstack.onAuthChange !== 'function') {
            return false
        }

        memberstack.onAuthChange(function (payload) {
            try {
                var loggedIn = isLoggedInMember(getMemberData(payload))
                if (loggedIn && seenLoggedOut === true) {
                    fireCompleteRegistration()
                    // Outside the directSave branch on purpose, and before it.
                    // Every armed page owes these two cookies, including the ones
                    // this script does not save fields for: /quiz is directSave
                    // false, yet its watch arms and this handler runs, and
                    // quiz-results.js reads the cookies on /quiz-results. Fold
                    // these into the branch below and every quiz-funnel member ends
                    // up with neither signup-source nor signup-referrer. Before,
                    // because persistAfterDirectSignup snapshots the cookies as
                    // they stand when it is called.
                    captureSignupSource()
                    captureSignupReferrer()
                    persistLeadEntryAfterSignup(memberstack, getMemberData(payload))
                    // /quiz is excluded: quiz-results.js writes these fields as
                    // part of its own single quiz save.
                    if (policy.directSave) {
                        // The payload we already unwrapped above, reused for the
                        // write-once check rather than paying a member read for
                        // something we may already be holding.
                        persistAfterDirectSignup(
                            memberstack,
                            memberCustomFields(payload),
                        )
                    }
                }
                // First definitive reading after an unreadable start only arms
                // the watch: a logged-in replay is "already in", a logged-out
                // reading waits for a later transition.
                seenLoggedOut = loggedIn ? false : true
                viewerLoggedOut = seenLoggedOut
            } catch (error) {
                /* attribution must never break the signup */
            }
        })

        return true
    }

    /**
     * Resolves this page's policy and, when there is one, starts the watch.
     *
     * The only writer of signupWatchArmed, and the claim is taken synchronously,
     * before waitForMemberstack's first await, so two calls in the same tick
     * cannot both reach onAuthChange.
     *
     * Exactly one path releases the claim: the watch resolving false, meaning it
     * reached its end without registering a listener (no Memberstack, or a
     * Memberstack with no onAuthChange). That release is what leaves a later
     * rearm() free to retry instead of reporting a watch that does not exist.
     *
     * The claim is deliberately NOT released when the watch rejects. If
     * memberstack.onAuthChange itself throws, runSafely catches the rejection,
     * the .then below never runs, and the claim stays taken for the life of the
     * page. That is intentional: we cannot know whether the listener registered
     * before the throw, so releasing would risk a second registration on the
     * next rearm(), and two listeners fire CompleteRegistration twice and start
     * two competing member saves. By the same cost asymmetry the rest of this
     * file is built on, a missed attribution is much cheaper than a double fire.
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
                return watchSignupTransition(policy).then(function (armed) {
                    if (!armed) signupWatchArmed = false
                })
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

        runSafely(function () {
            return retryLeadEntryPosthog()
        }, 'lead-entry PostHog retry failed')

        // One scan of the DOM as it stands now; rearm() covers a form injected
        // later.
        armSignupWatch()
        bindSignupTriggerClicks()
        bindLeadEntrySignupSubmit()
        if (!signupWatchArmed && hasElementMatching(SIGNUP_TRIGGER_SELECTOR)) {
            runSafely(probeViewerLoggedOut, 'viewer probe for signup trigger failed')
        }
        // Sitewide, not just on the signup pages: this is the step that finishes a
        // direct save that the signup form's own redirect cut short.
        runSafely(retryPendingSave, 'pending attribution save failed')
        runSafely(retryPendingLeadEntry, 'pending lead-entry registration failed')
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
