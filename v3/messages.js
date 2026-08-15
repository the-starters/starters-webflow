/**
 * Messages 3.0 — TalkJS inbox bootstrap.
 *
 * @release v1.59.155
 *
 * Self-contained page controller for /messages. It waits for Memberstack,
 * redirects logged-out visitors through the V3 login router while preserving
 * the current path and query, loads TalkJS, syncs the current member's public
 * profile, and mounts the 3.0-themed inbox into #talkjs-container.
 *
 * Deep linking: `/messages?conversation=<TalkJS conversation id>` selects an
 * existing conversation (used by dashboard preview cards). The existing
 * `/messages?with=<memberstack id>` contract opens — creating if needed — the
 * one-on-one conversation with that member and selects it in the inbox.
 * `v3/hire-message.js` produces these links from the /hire/<slug> profile pages
 * and leaves the starter's name and photo in a one-shot sessionStorage entry
 * (`starters:hire-message-handoff`) for this module to consume, because TalkJS
 * writes any display fields it is given onto that user's global record and a
 * URL-carried name would therefore be forgeable. Without the query parameter
 * nothing below runs and the page behaves exactly as it did before; the deep
 * link resolves after the inbox is mounted, so a failure leaves a working inbox.
 *
 * Clickable Identity: the 3.0 chat theme wraps the chat-header photo and name,
 * and the avatar beside a received message, in TalkJS ActionButtons carrying
 * that member's Memberstack id. This module answers those actions by opening
 * `/hire/<slug>` in a new tab. Members without a published profile (brands,
 * unlisted starters) resolve to an empty slug and nothing happens — the theme
 * cannot know who has a profile, so the affordance is optimistic and this
 * handler is the truth. Every failure path (bad id, resolver down, slow
 * network) is a silent no-op; the chat never shows an error over a decoration.
 *
 * The slug is resolved when the CONVERSATION opens, not when the member clicks.
 * That is a correctness requirement, not a performance one: WebKit gives a
 * cross-origin frame's forwarded click activation about a second before
 * `window.open` stops working, so a tab opened after an awaited ~2.5s resolver
 * round-trip is refused on Safari and iOS, and refused silently. See
 * createIdentityController for the full reasoning and for what happens on the
 * rare click that beats its own prefetch.
 */
;(function () {
  'use strict'

  if (window.__startersMessages3Booted) return
  window.__startersMessages3Booted = true

  const TALKJS_APP_ID = 'LmYV8DIA'
  const TALKJS_THEME = 'the-starters-3-0'
  const TALKJS_SCRIPT_URL = 'https://cdn.talkjs.com/talk.js'
  const MEMBERSTACK_TIMEOUT_MS = 10000
  const TALKJS_TIMEOUT_MS = 15000
  const LOGIN_PATH = '/login'
  const DEEP_LINK_PARAM = 'with'
  const CONVERSATION_PARAM = 'conversation'
  const MAX_CONVERSATION_ID_LENGTH = 1024
  const HANDOFF_KEY = 'starters:hire-message-handoff'
  // Memberstack ids are `mem_` + an alphanumeric cuid, with an extra `sb_`
  // segment for Test Mode (sandbox) members. Anything else is a hand-edited or
  // truncated URL and must not reach TalkJS, which would create a real user
  // record for it.
  const MEMBER_ID_PATTERN = /^mem_(?:sb_)?[A-Za-z0-9]+$/
  const CONVERSATION_SOURCE = 'hire-page'
  const FEED_FILTER_ACTIONS = {
    'messages-filter-all': {},
    'messages-filter-unread': { isUnread: true },
    'messages-filter-read': { isUnread: false },
  }

  /* --------------------------- staging diagnostics -------------------------- */

  // Same convention as account-settings/plan-dates.js: dev-only console noise on
  // staging hosts (or with the explicit debug flag), silence in production. The
  // Clickable Identity path is deliberately invisible to members, so this is the
  // only way to tell "resolved empty" from "never fired" while QA'ing it.
  // Anchored host tests on purpose — "notwebflow.io" must not read as staging.
  const LOG_PREFIX = '[messages-3.0]'

  function stagingHost(hostname) {
    const host = hostname || ''
    return (
      /(\.|^)webflow\.io$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
    )
  }

  // STARTERS_DEBUG belongs here and not in stagingHost(): it may turn logging on
  // in production, but it must never widen what counts as a staging host.
  function diagnosticsEnabled() {
    if (window.STARTERS_DEBUG === true) return true
    return stagingHost((window.location && window.location.hostname) || '')
  }

  function warn(message, detail) {
    if (!diagnosticsEnabled()) return
    if (detail === undefined) console.warn(LOG_PREFIX + ' ' + message)
    else console.warn(LOG_PREFIX + ' ' + message, detail)
  }

  function waitForMemberstackDom(timeoutMs = MEMBERSTACK_TIMEOUT_MS) {
    if (
      window.$memberstackDom &&
      typeof window.$memberstackDom.getCurrentMember === 'function'
    ) {
      return Promise.resolve(window.$memberstackDom)
    }

    return new Promise((resolve) => {
      const startedAt = Date.now()
      const timer = window.setInterval(() => {
        if (
          window.$memberstackDom &&
          typeof window.$memberstackDom.getCurrentMember === 'function'
        ) {
          window.clearInterval(timer)
          resolve(window.$memberstackDom)
          return
        }

        if (Date.now() - startedAt >= timeoutMs) {
          window.clearInterval(timer)
          resolve(null)
        }
      }, 100)
    })
  }

  /**
   * Build the V3 login URL with the current path and query as `next`.
   * @returns {string}
   */
  function loginPathWithNext() {
    const next = window.location.pathname + window.location.search
    return LOGIN_PATH + '?next=' + encodeURIComponent(next)
  }

  function installTalkJsLoader() {
    if (window.Talk && window.Talk.ready) return

    const callbacks = []
    const NativePromise = window.Promise
    const script = document.createElement('script')
    script.async = true
    script.src = TALKJS_SCRIPT_URL
    script.dataset.startersMessagesTalkjs = 'true'
    document.head.appendChild(script)

    window.Talk = {
      v: 3,
      ready: {
        then(callback) {
          if (NativePromise) {
            return new NativePromise((resolve, reject) => {
              callbacks.push([callback, resolve, reject])
            })
          }
          callbacks.push([callback])
        },
        catch() {
          return NativePromise && new NativePromise(() => {})
        },
        c: callbacks,
      },
    }
  }

  function waitForTalkJs(timeoutMs = TALKJS_TIMEOUT_MS) {
    installTalkJsLoader()

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error('TalkJS did not become ready')),
        timeoutMs,
      )

      Promise.resolve(window.Talk.ready).then(
        () => {
          window.clearTimeout(timer)
          resolve(window.Talk)
        },
        (error) => {
          window.clearTimeout(timer)
          reject(error)
        },
      )
    })
  }

  // Replicated from v3/route-guard.js PLAN_ROLES — that file is the canonical
  // source of the plan-to-role map; update it first and mirror changes here.
  const PLAN_ROLES = {
    'pln_free-plan-f6kn0dxz': 'brand-free',
    'pln_new-paid-plan-463h04ph': 'brand-paid',
    'pln_dorxata-test-free-plan-dvcg0k8o': 'talent',
    'pln_dorxata-test-brand-plan-777r02pa': 'brand-paid',
  }

  // Placeholder display names by plan family; members outside both families
  // read the generic default.
  const NAME_PLACEHOLDERS = { brand: 'Brand Name', talent: 'Starter Name' }

  /**
   * Resolve the member's plan family: 'brand', 'talent', or null when no
   * mapped plan is active. Mirrors v3/route-guard.js roleResolution: active
   * plan connections collapse to brand vs talent, and a cross-family
   * conflict fails closed to null.
   */
  function roleFamily(member) {
    const roles = (member.planConnections || [])
      .filter(
        (connection) =>
          connection &&
          (connection.active === true || connection.status === 'ACTIVE'),
      )
      .map((connection) => PLAN_ROLES[connection.planId])
      .filter(Boolean)

    const isBrand = roles.includes('brand-free') || roles.includes('brand-paid')
    const isTalent = roles.includes('talent')
    if (isBrand && isTalent) return null
    if (isBrand) return 'brand'
    if (isTalent) return 'talent'
    return null
  }

  function talkUserFields(member) {
    const customFields = member.customFields || {}
    const auth = member.auth || {}
    const email = auth.email || member.email || ''
    // 'free-user' is this site's legacy Memberstack key for the member's
    // first name; there is no 'first-name' field in the app. The display
    // name is the first name alone — no last name, and never the email.
    const firstName = (
      customFields['free-user'] ||
      customFields['first-name'] ||
      ''
    )
      .toString()
      .trim()

    const company = (customFields['company'] || '').toString().trim()
    // The plan family is resolved once and drives both placeholders.
    const family = roleFamily(member)

    const fields = {
      id: member.id,
      name: firstName || NAME_PLACEHOLDERS[family] || 'The Starters member',
      // User-level custom data for the TalkJS theme (company shown under the
      // first name). TalkJS custom values must be strings, and the key is
      // always present so a stale previously-synced company self-clears.
      // Brands without a company read 'Company Name'; everyone else blank.
      custom: {
        company: company || (family === 'brand' ? 'Company Name' : ''),
      },
    }

    if (email) fields.email = email
    if (member.profileImage) fields.photoUrl = member.profileImage

    return fields
  }

  function installFeedFilterActions(inbox) {
    if (
      typeof inbox.onCustomConversationAction !== 'function' ||
      typeof inbox.setFeedFilter !== 'function'
    ) {
      return
    }

    Object.entries(FEED_FILTER_ACTIONS).forEach(([action, filter]) => {
      inbox.onCustomConversationAction(action, () => {
        inbox.setFeedFilter(filter)
      })
    })
  }

  /* --------------------------- clickable identity --------------------------- */
  // clickable-identity:start
  // Everything between these two markers is lifted verbatim by the staging
  // theme rig (staging-qa/talkjs-theme-rig/identity-gate.mjs), so that the code
  // it clicks in a real TalkJS iframe is this code and not a paraphrase of it.
  // Keep the block self-contained: its only outside dependency is
  // MEMBER_ID_PATTERN, which the rig lifts from this file too.

  // The theme's ActionButtons all raise this one action, from the chat header
  // (a conversation action) and from a received message's avatar (a message
  // action). Both carry `data-member`, which TalkJS delivers as
  // `event.params.member`.
  const IDENTITY_ACTION = 'starters-open-profile'
  // Slug Resolver — public by design: it answers a profile slug for a member id
  // and nothing else, and answers empty for anyone without a published 3.0
  // profile page (every brand, and starters who have no profile yet).
  const SLUG_RESOLVER_URL =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starter/slug_by_memberstack'
  // A resolver call that has not answered by now is never going to be useful.
  const IDENTITY_TIMEOUT_MS = 4000
  const PROFILE_PATH_PREFIX = '/hire/'

  /**
   * The Clickable Identity controller: a slug cache filled when a conversation
   * opens, and a click handler that spends it.
   *
   * WHY THE CACHE EXISTS, AND WHY IT IS NOT AN OPTIMISATION.
   * A popup only opens while the window still holds a usable transient
   * activation from the member's click. TalkJS's UI is cross-origin, so the
   * action never arrives in the click's own call stack — it comes over
   * postMessage, in a later task, on activation forwarded to this window.
   * WebKit budgets that forwarding at about a second
   * (`maximumIntervalForUserGestureForwarding`), shared with TalkJS's own
   * dispatch, and unlike Chrome's ~5s it is not extended across awaited work.
   * The resolver round-trip measures ~2.5s, so an `open()` after
   * `await fetch(...)` is refused on Safari and iOS — silently, with a null
   * return and no error to catch, which every "silent no-op" failure path here
   * would then swallow. Repo prior art: v3/scheduling-availability-writer.js
   * documents the same hazard and gives up on the new tab entirely;
   * opportunities-3.0.js reserves a tab first.
   *
   * So the slug is fetched when the conversation becomes visible, not when the
   * member clicks. Every identity button in a conversation carries the same
   * member id — header photo, header name, and each received avatar — so one
   * lookup serves all of them, and the click itself becomes a Map read
   * followed immediately by `open()`, well inside the budget. The reserved tab
   * below is only the fallback for a click that beats its own prefetch.
   *
   * Everything the controller touches is injected, so the unit tests and the
   * staging rig drive the real logic with their own fetch/open/clock.
   *
   * @param {{
   *   fetch: Function, open: Function, AbortController: Function|undefined,
   *   setTimeout: Function, clearTimeout: Function,
   *   resolverUrl?: string, timeoutMs?: number, warn?: Function
   * }} options
   */
  function createIdentityController(options) {
    const config = options || {}
    const resolverUrl = config.resolverUrl || SLUG_RESOLVER_URL
    const timeoutMs = config.timeoutMs || IDENTITY_TIMEOUT_MS
    const note = config.warn || function () {}

    // memberId -> slug, where '' means "no published profile". Page lifetime: a
    // member's slug does not change while an inbox is open. Only a definitive
    // answer is stored, so an outage does not poison the cache for the session.
    const slugs = new Map()
    // memberId -> Promise, so a click during the prefetch joins that request
    // instead of firing a second one.
    const pending = new Map()
    // memberId -> the blank tab a slow-path click is holding for it, or null
    // when the reservation was refused. Keyed by member, not by click: the
    // header photo, the header name and every received avatar all raise the
    // same action with the same id, so without this a member who clicks two of
    // them inside the prefetch window (or double-clicks one) reserves a tab per
    // click and ends up with several copies of the same profile.
    const reservations = new Map()

    function profileUrl(slug) {
      // encodeURIComponent, not raw interpolation: the slug is data from an
      // open endpoint, and a value containing a slash must not be able to
      // steer the navigation somewhere other than one profile page.
      return PROFILE_PATH_PREFIX + encodeURIComponent(slug)
    }

    /**
     * One resolver call. Never rejects: it answers {answered, slug}, where
     * `answered: false` means "ask again next time" (outage, timeout, garbage)
     * and `answered: true, slug: ''` means "this member has no profile page".
     */
    function askResolver(memberId) {
      const controller =
        typeof config.AbortController === 'function'
          ? new config.AbortController()
          : null

      return new Promise((resolve) => {
        let settled = false
        // Armed unconditionally. Tying the deadline to the AbortController's
        // existence would remove it in exactly the case the timeout is for —
        // the same shape as fetchWithTimeout in v3/onboarding-done-redirect.js:
        // abort the socket when we can, but the timeout stands either way.
        const timer = config.setTimeout(() => {
          if (settled) return
          settled = true
          if (controller) {
            try {
              controller.abort()
            } catch (error) {}
          }
          note('the slug resolver did not answer within ' + timeoutMs + 'ms')
          resolve({ answered: false, slug: '' })
        }, timeoutMs)

        const finish = (value) => {
          if (settled) return
          settled = true
          config.clearTimeout(timer)
          resolve(value)
        }

        Promise.resolve()
          .then(() =>
            config.fetch(resolverUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ member_id: memberId }),
              signal: controller ? controller.signal : undefined,
            }),
          )
          .then((response) => {
            // The resolver answers 200 for every input it understands,
            // including unknown ids; anything else is an outage.
            if (!response || response.ok === false) {
              note('the slug resolver answered ' + (response && response.status))
              finish({ answered: false, slug: '' })
              return null
            }
            return Promise.resolve(response.json()).then((data) => {
              const slug =
                data && typeof data.slug === 'string' ? data.slug.trim() : ''
              finish({ answered: true, slug })
            })
          })
          .catch((error) => {
            // Covers the abort too. A failed lookup is not an error surface.
            note('the slug resolver did not answer', error)
            finish({ answered: false, slug: '' })
          })
      })
    }

    /**
     * Resolve a member's slug, from the cache when possible. Safe to call as
     * often as you like: concurrent calls share one request.
     * @returns {Promise<string>}
     */
    function resolveSlug(memberId) {
      if (!MEMBER_ID_PATTERN.test(memberId)) return Promise.resolve('')
      if (slugs.has(memberId)) return Promise.resolve(slugs.get(memberId))
      const existing = pending.get(memberId)
      if (existing) return existing
      if (typeof config.fetch !== 'function') return Promise.resolve('')

      const request = askResolver(memberId).then((result) => {
        pending.delete(memberId)
        // Only a definitive answer is cached; a failure stays unknown so the
        // next click retries instead of inheriting the outage all session.
        if (result.answered) slugs.set(memberId, result.slug)
        return result.slug
      })
      pending.set(memberId, request)
      return request
    }

    /**
     * The other participants of a TalkJS ConversationSelectedEvent. The event
     * carries `me`, `conversation`, `other`, `others`, `participants` and
     * `conversationId` — verified against a live event in the rig, not assumed
     * from the docs — with `others` an array of user objects.
     * @returns {string[]}
     */
    function otherParticipantIds(event) {
      if (!event) return []
      const ids = []
      const add = (id) => {
        if (
          typeof id === 'string' &&
          MEMBER_ID_PATTERN.test(id) &&
          ids.indexOf(id) === -1
        ) {
          ids.push(id)
        }
      }

      if (Array.isArray(event.others)) {
        event.others.forEach((user) => add(user && user.id))
      }
      if (ids.length) return ids

      // Fallback for a payload without `others`: the conversation's own
      // participants, which arrive as a map keyed by user id.
      const myId = (event.me && event.me.id) || ''
      const participants =
        (event.conversation && event.conversation.participants) || null
      if (Array.isArray(participants)) {
        participants.forEach((user) => {
          if (user && user.id !== myId) add(user.id)
        })
      } else if (participants && typeof participants === 'object') {
        Object.keys(participants).forEach((id) => {
          if (id !== myId) add(id)
        })
      }
      return ids
    }

    /**
     * Warm the cache for a conversation that has just become visible. One
     * request per conversation, not one per identity button.
     * @returns {string[]} the ids being resolved, for the tests and the rig
     */
    function prefetchForConversation(event) {
      const ids = otherParticipantIds(event)
      ids.forEach((id) => resolveSlug(id))
      return ids
    }

    /**
     * Answer an identity click.
     *
     * Deliberately NOT an async function: on the cache-hit path nothing may be
     * awaited before `open()`, or the forwarded activation is spent by the
     * time the tab is asked for.
     */
    function handleAction(event) {
      const params = (event && event.params) || {}
      const memberId =
        typeof params.member === 'string' ? params.member.trim() : ''
      // Same rule the `?with=` deep link applies. A malformed id means a
      // hand-edited DOM or a theme change gone wrong, and must not reach the
      // network at all.
      if (!MEMBER_ID_PATTERN.test(memberId)) {
        note('identity click carried no usable member id')
        return null
      }
      if (typeof config.open !== 'function') return null

      // FAST PATH — the conversation's prefetch has already answered. This is
      // the path essentially every real click takes, and the only one WebKit
      // reliably honours. Note what actually makes it work, because the
      // tempting shorthand is wrong: this handler is NOT in the click's own
      // call stack. TalkJS's UI is cross-origin, so the action reaches us over
      // postMessage and always runs in a later task. What survives that hop is
      // the transient activation propagated to this window, and WebKit spends
      // it against a ~1s user-gesture forwarding budget shared with TalkJS's
      // own dispatch. A Map read costs microseconds of that budget; the ~2.5s
      // resolver round-trip this used to await costs all of it, which is why
      // the tab never appeared on Safari or iOS. Do not "simplify" this back
      // into an await.
      if (slugs.has(memberId)) {
        const slug = slugs.get(memberId)
        if (!slug) {
          note('no published profile for this member')
          return null
        }
        // `noopener` is the contract. Note that it also makes the return value
        // specified to be null whether or not a tab opened, so — unlike the
        // reserved tab below — there is nothing here worth checking.
        config.open(profileUrl(slug), '_blank', 'noopener')
        return null
      }

      // SLOW PATH — a click inside the first moments of a conversation, before
      // its prefetch answered. The activation cannot be spent later, so a tab
      // is reserved now and steered when the slug arrives. Reserving needs a
      // handle to steer, and `noopener` returns null by specification, so this
      // one call omits it and severs `opener` by hand instead — the same trade
      // the contract-download flow makes in opportunities-3.0.js.
      //
      // A second click on the same member while that is in flight must not
      // reserve a second tab: they would all be steered to the same profile.
      // The first click's continuation owns the reservation and will resolve
      // it; `has` rather than `get` because a refused reservation is recorded
      // as null and still means "in flight".
      if (reservations.has(memberId)) return null

      const reserved = config.open('', '_blank')
      reservations.set(memberId, reserved)
      if (!reserved) {
        note('could not reserve a tab for the profile (popup blocked?)')
      }

      return resolveSlug(memberId).then((slug) => {
        reservations.delete(memberId)

        if (!slug) {
          note('no published profile for this member')
          closeReserved(reserved)
          return
        }
        // The member closed the blank tab while waiting. Opening another one
        // now would put back exactly what they just dismissed.
        if (wasDismissed(reserved)) {
          note('the reserved tab was closed before the profile resolved')
          return
        }
        const url = profileUrl(slug)
        if (steerReserved(reserved, url)) return
        // A live handle we could not steer. Close it first — otherwise the
        // fallback below leaves a stranded blank tab next to the real one.
        closeReserved(reserved)
        // A direct open still works inside Chrome's gesture-forwarding window;
        // on WebKit it will not, which is exactly why the fast path exists.
        config.open(url, '_blank', 'noopener')
      })
    }

    // Distinguishes "the member closed it" from "we never got one". A handle
    // whose `closed` cannot even be read is treated as gone.
    function wasDismissed(handle) {
      if (!handle) return false
      try {
        return handle.closed === true
      } catch (error) {
        return true
      }
    }

    function closeReserved(handle) {
      if (!handle) return
      try {
        if (!handle.closed) handle.close()
      } catch (error) {}
    }

    function steerReserved(handle, url) {
      if (!handle) return false
      try {
        if (handle.closed) return false
        handle.opener = null
        handle.location.href = url
        return true
      } catch (error) {
        return false
      }
    }

    return {
      handleAction,
      prefetch: resolveSlug,
      prefetchForConversation,
      otherParticipantIds,
      // Exposed for the tests and the rig, never for the page.
      cache: slugs,
    }
  }
  // clickable-identity:end

  /**
   * Wire the theme's identity ActionButtons. The header buttons raise a
   * conversation action and the message avatars raise a message action; both
   * carry the same params and take the same handler.
   *
   * Called before `inbox.mount()` because that is the only ordering that cannot
   * lose the race: `onConversationSelected` fires once as the inbox loads its
   * first conversation, and a listener registered late misses it, leaving that
   * conversation's slug unprefetched — the whole feature on its Safari-hostile
   * slow path. How late is "late" is not a number to rely on: measured in the
   * rig, listeners added pre-mount, at mount and +50ms all received the event,
   * and only one added +3s later missed it. Register before the mount and the
   * question never arises.
   *
   * @returns {object} the controller, so the deep-link path can prime it too
   */
  function installIdentityActions(inbox) {
    const identity = createIdentityController({
      fetch: typeof window.fetch === 'function' ? window.fetch.bind(window) : null,
      open: typeof window.open === 'function' ? window.open.bind(window) : null,
      AbortController: window.AbortController,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      warn,
    })

    if (typeof inbox.onCustomMessageAction === 'function') {
      inbox.onCustomMessageAction(IDENTITY_ACTION, identity.handleAction)
    }
    if (typeof inbox.onCustomConversationAction === 'function') {
      inbox.onCustomConversationAction(IDENTITY_ACTION, identity.handleAction)
    }
    if (typeof inbox.onConversationSelected === 'function') {
      inbox.onConversationSelected((event) => {
        identity.prefetchForConversation(event)
      })
    }

    return identity
  }

  /**
   * The member named by `?with=`, or null when absent or malformed.
   * @returns {string|null}
   */
  function deepLinkMemberId() {
    const raw = new URLSearchParams(window.location.search).get(DEEP_LINK_PARAM)
    const id = typeof raw === 'string' ? raw.trim() : ''
    return MEMBER_ID_PATTERN.test(id) ? id : null
  }

  /**
   * Existing TalkJS conversation selected by a dashboard card. Conversation
   * ids are application-owned strings, so retain the value verbatim apart from
   * trimming and a defensive size/control-character check.
   * @returns {string|null}
   */
  function deepLinkConversationId() {
    const raw = new URLSearchParams(window.location.search).get(
      CONVERSATION_PARAM,
    )
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (
      !id ||
      id.length > MAX_CONVERSATION_ID_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(id)
    ) {
      return null
    }
    return id
  }

  /**
   * Read and clear the display fields left by v3/hire-message.js. The entry is
   * rejected unless it names the same member as the URL, so a stale handoff from
   * a different profile can never mislabel this conversation. Always cleared once
   * read, so a later visit without a handoff falls back to an id-only reference
   * rather than reusing someone else's fields.
   * @param {string} memberId
   * @returns {{name: string, photo: string, slug: string}|null}
   */
  function consumeHandoff(memberId) {
    let raw = null
    try {
      raw = window.sessionStorage.getItem(HANDOFF_KEY)
    } catch (error) {
      return null
    }
    if (!raw) return null

    try {
      window.sessionStorage.removeItem(HANDOFF_KEY)
    } catch (error) {}

    let data = null
    try {
      data = JSON.parse(raw)
    } catch (error) {
      return null
    }
    if (!data || data.id !== memberId) return null

    const photo = typeof data.photo === 'string' ? data.photo : ''
    return {
      name: typeof data.name === 'string' ? data.name.trim() : '',
      // Rendered as an <img> source by TalkJS; only plain https is accepted.
      photo: photo.indexOf('https://') === 0 ? photo : '',
      slug: typeof data.slug === 'string' ? data.slug : '',
    }
  }

  /**
   * The other side of the conversation. Passing fields updates that user's stored
   * TalkJS record, so fields are only ever passed when they came from the CMS via
   * the handoff; otherwise the existing user is referenced by id alone and TalkJS
   * keeps whatever they synced themselves.
   * @param {object} Talk
   * @param {string} memberId
   * @param {{name: string, photo: string}|null} handoff
   */
  function otherParticipant(Talk, memberId, handoff) {
    if (!handoff || !handoff.name) return new Talk.User(memberId)

    const fields = { id: memberId, name: handoff.name }
    if (handoff.photo) fields.photoUrl = handoff.photo
    return new Talk.User(fields)
  }

  /**
   * Select an existing `?conversation=` thread without mutation, or open the
   * `?with=` one-on-one conversation, creating it when needed. Returns
   * immediately when neither supported deep-link parameter is present.
   */
  async function openDeepLinkConversation(Talk, session, inbox, me, myId, identity) {
    const conversationId = deepLinkConversationId()
    if (conversationId) {
      // TalkJS accepts an existing conversation id directly. This selects it
      // without creating a new conversation or mutating its participants.
      await inbox.select(conversationId)
      return
    }

    const otherId = deepLinkMemberId()
    // A self-link would produce a degenerate conversation with one participant.
    if (!otherId || otherId === myId) return

    // Prime the Clickable Identity cache from the id we already hold, rather
    // than waiting for the selection event this call is about to cause. Cheap
    // (the controller de-duplicates) and it removes one race from the path a
    // member arriving from a /hire page is most likely to click.
    if (identity) identity.prefetch(otherId)

    const handoff = consumeHandoff(otherId)
    const conversation = session.getOrCreateConversation(
      Talk.oneOnOneId(myId, otherId),
    )
    conversation.setParticipant(me)
    conversation.setParticipant(otherParticipant(Talk, otherId, handoff))
    // Attribution for conversations started from a profile page. Custom values
    // must be strings; this cannot be backfilled onto existing conversations.
    conversation.setAttributes({
      custom: {
        source: CONVERSATION_SOURCE,
        slug: (handoff && handoff.slug) || '',
      },
    })

    await inbox.select(conversation)
  }

  async function mountMessages() {
    const container = document.getElementById('talkjs-container')
    if (!container) throw new Error('Missing #talkjs-container')

    const memberstack = await waitForMemberstackDom()
    if (!memberstack) throw new Error('Memberstack did not become ready')

    const response = await memberstack.getCurrentMember()
    const member = response && response.data
    if (!member || !member.id) {
      window.location.replace(loginPathWithNext())
      return
    }

    const Talk = await waitForTalkJs()
    const me = new Talk.User(talkUserFields(member))
    const session = new Talk.Session({
      appId: TALKJS_APP_ID,
      me,
    })
    const inbox = session.createInbox({
      theme: { name: TALKJS_THEME },
    })

    installFeedFilterActions(inbox)
    const identity = installIdentityActions(inbox)
    inbox.mount(container)

    // Deliberately after mount and deliberately not awaited: the inbox is already
    // usable, so a deep-link failure degrades to "your normal inbox" instead of
    // taking the page down with it.
    openDeepLinkConversation(Talk, session, inbox, me, member.id, identity).catch((error) => {
      console.warn(
        '[messages-3.0] Unable to open the requested conversation',
        error,
      )
    })
  }

  function start() {
    mountMessages().catch((error) => {
      console.error('[messages-3.0] Unable to mount TalkJS inbox', error)
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
})()
