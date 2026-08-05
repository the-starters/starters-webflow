/**
 * Messages 3.0 — TalkJS inbox bootstrap.
 *
 * @release v1.59.107
 *
 * Self-contained page controller for /messages. It waits for Memberstack,
 * redirects logged-out visitors through the V3 login router while preserving
 * the current path and query, loads TalkJS, syncs the current member's public
 * profile, and mounts the 3.0-themed inbox into #talkjs-container.
 *
 * Deep linking: `/messages?with=<memberstack id>` opens — creating if needed —
 * the one-on-one conversation with that member and selects it in the inbox.
 * `v3/hire-message.js` produces these links from the /hire/<slug> profile pages
 * and leaves the starter's name and photo in a one-shot sessionStorage entry
 * (`starters:hire-message-handoff`) for this module to consume, because TalkJS
 * writes any display fields it is given onto that user's global record and a
 * URL-carried name would therefore be forgeable. Without the query parameter
 * nothing below runs and the page behaves exactly as it did before; the deep
 * link resolves after the inbox is mounted, so a failure leaves a working inbox.
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

  /**
   * Display-name placeholder for a member without a first name. Mirrors
   * v3/route-guard.js roleResolution: active plan connections collapse to
   * brand vs talent, and a cross-family conflict fails closed to the
   * generic default.
   */
  function namePlaceholder(member) {
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
    if (isBrand && isTalent) return 'The Starters member'
    if (isBrand) return 'Brand Name'
    if (isTalent) return 'Starter Name'
    return 'The Starters member'
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

    const fields = {
      id: member.id,
      name: firstName || namePlaceholder(member),
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
   * Open the deep-linked one-on-one conversation, creating it when it does not
   * exist, and select it in the mounted inbox. Returns immediately when there is
   * no `?with=` parameter, which is every ordinary visit to /messages.
   */
  async function openDeepLinkConversation(Talk, session, inbox, me, myId) {
    const otherId = deepLinkMemberId()
    // A self-link would produce a degenerate conversation with one participant.
    if (!otherId || otherId === myId) return

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
    inbox.mount(container)

    // Deliberately after mount and deliberately not awaited: the inbox is already
    // usable, so a deep-link failure degrades to "your normal inbox" instead of
    // taking the page down with it.
    openDeepLinkConversation(Talk, session, inbox, me, member.id).catch((error) => {
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
