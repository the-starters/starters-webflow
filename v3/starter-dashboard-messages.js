/**
 * Dashboard 3.0 — shared Messages tile.
 *
 * @release v1.59.157
 *
 * Binds the #messages tile on /starter-dashboard and /brand-dashboard to the
 * member's recent TalkJS conversations. Two data sources, merged:
 *   - Xano `starter/messages/recent` (TalkJS REST proxy) → recent
 *     conversations including already-read ones.
 *   - TalkJS JS SDK → live unread state and the unread count badge.
 * If the Xano endpoint is unavailable the tile shows no message cards.
 * Shows the empty state when there are no conversations at all.
 *
 * Wiring (wf-xano-style, multi-instance): each `data-messages-element="wrapper"`
 * scopes one rendered instance containing `list`, `template` (first card),
 * `empty`, `loading`, `total` (unread count) and `view-all`, with card fields
 * `name` (alias `title`), `name_initials`, `preview`, `time` and optional
 * `avatar` container inside the template. `data-messages-format="uppercase|
 * lowercase"` transforms a bound element's text. Optional
 * `data-messages-limit="<n>"` on the wrapper can lower the 3-card maximum.
 * All instances share one TalkJS session + one bulk recent-conversations load,
 * which allows two attempts with a 15-second timeout each. The original
 * class-based selectors remain as fallbacks (legacy wrapper: `#messages`).
 */
;(function () {
  'use strict'

  if (window.__startersDashboardMessagesBooted) return
  window.__startersDashboardMessagesBooted = true

  const TALKJS_APP_ID = 'LmYV8DIA'
  const TALKJS_SCRIPT_URL = 'https://cdn.talkjs.com/talk.js'
  const XANO_AUTH_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh'
  const XANO_TRADE_TOKEN_PATH = '/auth/trade-token/v3'
  const XANO_OPP_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30'
  const RECENT_MESSAGES_PATH = '/starter/messages/recent'
  const MEMBERSTACK_TIMEOUT_MS = 10000
  const TALKJS_TIMEOUT_MS = 15000
  const RECENT_MESSAGES_TIMEOUT_MS = 15000
  const RECENT_MESSAGES_MAX_ATTEMPTS = 2
  const MESSAGES_PATH = '/messages'
  const CONVERSATION_PARAM = 'conversation'
  const MAX_PREVIEW_ITEMS = 3

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

  function installTalkJsLoader() {
    if (window.Talk && window.Talk.ready) return

    const callbacks = []
    const NativePromise = window.Promise
    const script = document.createElement('script')
    script.async = true
    script.src = TALKJS_SCRIPT_URL
    script.dataset.startersDashboardTalkjs = 'true'
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

  function timeAgo(timestamp) {
    if (!timestamp) return ''
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
    if (seconds < 60) return 'Just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return minutes + 'm ago'
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return hours + 'h ago'
    const days = Math.floor(hours / 24)
    if (days < 7) return days + 'd ago'
    return new Date(timestamp).toLocaleDateString()
  }

  function initials(name) {
    return String(name || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('')
  }

  // data-messages-format on a bound element transforms its rendered text.
  function applyFormat(el, text) {
    const format = el.getAttribute('data-messages-format')
    if (format === 'uppercase') return String(text).toUpperCase()
    if (format === 'lowercase') return String(text).toLowerCase()
    return text
  }

  // Preferred wiring: data-messages-element attributes (Designer-proof).
  // Class-based selectors remain as fallbacks for pages not yet migrated.
  const ATTR = 'data-messages-element'
  const attrSel = (name) => '[' + ATTR + '="' + name + '"]'

  function pick(root, name, fallbackSelector) {
    if (!root) return null
    return (
      root.querySelector(attrSel(name)) ||
      (fallbackSelector ? root.querySelector(fallbackSelector) : null)
    )
  }

  function findWrappers() {
    const wrappers = Array.prototype.slice.call(
      document.querySelectorAll(attrSel('wrapper')),
    )
    if (wrappers.length) return wrappers
    const legacy = document.getElementById('messages')
    return legacy ? [legacy] : []
  }

  function collectInstanceRefs(wrapper) {
    const list = pick(wrapper, 'list', '.tile-item_message-list')
    const template =
      list &&
      (list.querySelector(attrSel('template')) ||
        list.querySelector('.message_item'))
    if (!list || !template) return null
    // Removal must clear both grammars: Designer placeholders may carry
    // only the class while the template carries the attribute.
    const itemSelector = attrSel('template') + ', .message_item'

    // Fallback anchors: the tile contains several .dash_card wrappers — a
    // loading-spinner card and the empty state (the one holding
    // .tile-item_empty-state-layout).
    const emptyLayout = wrapper.querySelector('.tile-item_empty-state-layout')
    const emptyCard =
      pick(wrapper, 'empty') ||
      (emptyLayout && emptyLayout.closest('.dash_card')) ||
      emptyLayout ||
      wrapper.querySelector('.dash_card')
    const spinner = wrapper.querySelector('.dash_card .button_spinner')
    const loadingCard =
      pick(wrapper, 'loading') || (spinner && spinner.closest('.dash_card'))

    const requestedLimit = parseInt(
      wrapper.getAttribute('data-messages-limit'),
      10,
    )
    const limit =
      requestedLimit > 0
        ? Math.min(requestedLimit, MAX_PREVIEW_ITEMS)
        : MAX_PREVIEW_ITEMS

    // Accepted on the wrapper or on the template card itself.
    const unreadClass =
      wrapper.getAttribute('data-messages-class-unread') ||
      template.getAttribute('data-messages-class-unread') ||
      'is-new'

    return {
      wrapper,
      total: pick(wrapper, 'total', '.tile-item_notification-text'),
      emptyCard,
      loadingCard: loadingCard !== emptyCard ? loadingCard : null,
      viewAll: pick(wrapper, 'view-all', '.button_main-wrap .clickable_btn'),
      list,
      itemSelector,
      limit,
      unreadClass,
      template: template.cloneNode(true),
    }
  }

  // Boot state: designer loading spinner visible, everything else hidden
  // until the first render.
  function clearPlaceholders(refs) {
    refs.list
      .querySelectorAll(refs.itemSelector)
      .forEach((node) => node.remove())
    if (refs.total) refs.total.style.display = 'none'
    refs.list.style.display = 'none'
    if (refs.emptyCard) refs.emptyCard.style.display = 'none'
    if (refs.loadingCard) refs.loadingCard.style.display = ''
  }

  async function getMemberstackToken(memberstack) {
    const token = await memberstack.getMemberCookie()
    if (!token) throw new Error('No Memberstack session')
    return token
  }

  async function requestRecentConversations(memberstack, signal) {
    let xanoToken
    if (typeof window.getXanoAuthToken === 'function') {
      xanoToken = await window.getXanoAuthToken()
      if (!xanoToken) throw new Error('shared auth bridge returned no token')
    } else {
      const msToken = await getMemberstackToken(memberstack)
      const tradeRes = await fetch(
        XANO_AUTH_BASE +
          XANO_TRADE_TOKEN_PATH +
          '?token=' +
          encodeURIComponent(msToken),
        { signal },
      )
      const tradeData = await tradeRes.json().catch(() => null)
      if (!tradeRes.ok) throw new Error('trade-token failed')
      xanoToken =
        typeof tradeData === 'string'
          ? tradeData
          : tradeData && (tradeData.authToken || tradeData.token)
      if (!xanoToken) throw new Error('trade-token returned no token')
    }

    const res = await fetch(XANO_OPP_BASE + RECENT_MESSAGES_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + xanoToken,
      },
      signal,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error('recent messages request failed')
    return (data && data.items) || []
  }

  async function fetchRecentConversationsOnce(memberstack) {
    const controller =
      typeof window.AbortController === 'function'
        ? new window.AbortController()
        : null
    let timer
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => {
        if (controller) controller.abort()
        reject(new Error('recent messages request timed out'))
      }, RECENT_MESSAGES_TIMEOUT_MS)
    })

    try {
      return await Promise.race([
        requestRecentConversations(
          memberstack,
          controller ? controller.signal : undefined,
        ),
        timeout,
      ])
    } finally {
      window.clearTimeout(timer)
    }
  }

  async function fetchRecentConversations(memberstack) {
    let lastError
    for (let attempt = 0; attempt < RECENT_MESSAGES_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await fetchRecentConversationsOnce(memberstack)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }

  // Normalized card model. `unread` entries come from the SDK (rich sender
  // snapshot); `recent` entries come from the Xano REST proxy (lean).
  function displayFromUnread(unread) {
    const conversation = unread.conversation || {}
    const lastMessage = unread.lastMessage || {}
    const sender = (!lastMessage.isByMe && lastMessage.sender) || null

    return {
      id: conversation.id || null,
      title:
        conversation.subject || (sender && sender.name) || 'Conversation',
      photoUrl: conversation.photoUrl || (sender && sender.photoUrl) || null,
      preview:
        lastMessage.body ||
        (lastMessage.attachment ? 'Sent an attachment' : ''),
      timestamp: lastMessage.timestamp || null,
      unread: true,
    }
  }

  function displayFromRecent(conv, unreadsById) {
    const enrich = conv.id && unreadsById[conv.id]
    const unread = enrich && displayFromUnread(enrich)
    const hasParticipantName = Object.prototype.hasOwnProperty.call(
      conv,
      'participant_name',
    )
    const hasParticipantPhoto = Object.prototype.hasOwnProperty.call(
      conv,
      'participant_photo_url',
    )

    return {
      id: conv.id || (unread && unread.id) || null,
      title: hasParticipantName
        ? conv.participant_name || 'Conversation'
        : conv.subject || (unread && unread.title) || 'Conversation',
      photoUrl: hasParticipantPhoto
        ? conv.participant_photo_url || null
        : conv.photo_url || (unread && unread.photoUrl) || null,
      preview:
        (unread && unread.preview) || conv.last_message_text || '',
      timestamp:
        (unread && unread.timestamp) || conv.last_message_at || null,
      unread: Boolean(enrich || conv.unread),
    }
  }

  function conversationPath(conversationId) {
    if (!conversationId) return MESSAGES_PATH
    const params = new URLSearchParams()
    params.set(CONVERSATION_PARAM, conversationId)
    return MESSAGES_PATH + '?' + params.toString()
  }

  function bindConversationTarget(target, conversationId) {
    const path = conversationPath(conversationId)
    if (target && target.tagName === 'A') {
      target.href = path
      target.target = '_blank'
      target.rel = 'noopener'
      return
    }

    target.addEventListener('click', () => {
      window.open(path, '_blank', 'noopener')
    })
  }

  function renderItem(refs, display) {
    const item = refs.template.cloneNode(true)

    // `name` is the published grammar; `title` kept as an alias.
    const heading =
      pick(item, 'name') || pick(item, 'title', '.message-item_message h3')
    if (heading) heading.textContent = applyFormat(heading, display.title)

    const preview = pick(item, 'preview', '.message-item_message p')
    if (preview) preview.textContent = applyFormat(preview, display.preview)

    const timeEl = pick(item, 'time', '.message-item_layout > p')
    if (timeEl) timeEl.textContent = timeAgo(display.timestamp)

    // Avatar: either an <img> (published markup) or a container div
    // (legacy). Photo → show it and hide the initials text; no photo →
    // hide the image so the initials render.
    const initialsEl =
      pick(item, 'name_initials') ||
      (function () {
        const circle = item.querySelector('.message-item_profile-image')
        return circle && circle.querySelector('p')
      })()
    const avatar =
      pick(item, 'avatar', '.message-item_profile-image') ||
      (initialsEl && initialsEl.parentElement)
    const avatarIsImg = avatar && avatar.tagName === 'IMG'

    if (initialsEl) {
      initialsEl.textContent = applyFormat(initialsEl, initials(display.title))
      initialsEl.style.display = display.photoUrl ? 'none' : ''
    }

    if (avatarIsImg) {
      if (display.photoUrl) {
        // Webflow template imgs carry srcset/sizes that outrank a JS-set
        // src — strip them or the placeholder keeps rendering.
        avatar.removeAttribute('srcset')
        avatar.removeAttribute('sizes')
        avatar.src = display.photoUrl
        avatar.alt = display.title
        avatar.style.display = ''
      } else {
        avatar.style.display = 'none'
      }
    } else if (avatar && display.photoUrl) {
      avatar.style.backgroundImage = 'url("' + display.photoUrl + '")'
      avatar.style.backgroundSize = 'cover'
      avatar.style.backgroundPosition = 'center'
    }

    item.classList.toggle(refs.unreadClass, display.unread)
    // Drop the legacy default so stale Designer styling can't linger when a
    // custom unread class is configured.
    if (refs.unreadClass !== 'is-new') item.classList.remove('is-new')

    const button = item.querySelector('.clickable_btn')
    const target = button || item
    bindConversationTarget(target, display.id)

    return item
  }

  function renderTile(refs, state) {
    if (!state.recentSettled) return

    const unreads = state.unreads || []
    const unreadsById = {}
    unreads.forEach((unread) => {
      const id = unread.conversation && unread.conversation.id
      if (id) unreadsById[id] = unread
    })

    // TalkJS Inbox does not list conversations that have no messages. Keep the
    // dashboard on the same contract even if the REST proxy returns an empty
    // conversation. An SDK unread snapshot can supply the timestamp when the
    // bulk snapshot lags behind the live unread state.
    const displays = state.recent.map((conv) => {
      return displayFromRecent(conv, unreadsById)
    })

    const countedUnreadIds = {}
    let unreadCount = 0
    const countUnread = (id) => {
      if (id) {
        if (countedUnreadIds[id]) return
        countedUnreadIds[id] = true
      }
      unreadCount += 1
    }
    displays.forEach((display) => {
      if (display.unread) countUnread(display.id)
    })
    unreads.forEach((unread) => {
      countUnread(unread.conversation && unread.conversation.id)
    })

    const cardDisplays = displays.filter(
      (display) =>
        display.timestamp !== null && display.timestamp !== undefined,
    )

    if (refs.loadingCard) refs.loadingCard.style.display = 'none'

    if (refs.total) {
      refs.total.textContent = String(unreadCount)
      refs.total.style.display = unreadCount > 0 ? '' : 'none'
    }

    refs.list
      .querySelectorAll(refs.itemSelector)
      .forEach((node) => node.remove())

    if (cardDisplays.length === 0) {
      refs.list.style.display = 'none'
      if (refs.emptyCard) refs.emptyCard.style.display = ''
      return
    }

    refs.list.style.display = ''
    if (refs.emptyCard) refs.emptyCard.style.display = 'none'

    cardDisplays
      .sort((a, b) => timestampValue(b.timestamp) - timestampValue(a.timestamp))
      .slice(0, refs.limit)
      .forEach((display) => {
        refs.list.appendChild(renderItem(refs, display))
      })
  }

  function timestampValue(timestamp) {
    if (!timestamp) return 0
    const numeric = Number(timestamp)
    if (Number.isFinite(numeric)) return numeric
    const parsed = Date.parse(timestamp)
    return Number.isNaN(parsed) ? 0 : parsed
  }

  async function mountTile() {
    const instances = findWrappers()
      .map(collectInstanceRefs)
      .filter(Boolean)
    if (!instances.length) return

    instances.forEach((refs) => {
      clearPlaceholders(refs)
      if (refs.viewAll) {
        refs.viewAll.addEventListener('click', () => {
          window.location.assign(MESSAGES_PATH)
        })
      }
    })

    const showEmpty = () => {
      instances.forEach((refs) => {
        if (refs.loadingCard) refs.loadingCard.style.display = 'none'
        if (refs.emptyCard) refs.emptyCard.style.display = ''
      })
    }

    const memberstack = await waitForMemberstackDom()
    if (!memberstack) {
      showEmpty()
      return
    }

    let member = null
    if (window.memberReady && typeof window.memberReady.then === 'function') {
      member = await window.memberReady
    }
    if (!member || !member.id) {
      member = ((await memberstack.getCurrentMember()) || {}).data
    }
    if (!member || !member.id) {
      showEmpty()
      return
    }

    const state = { recent: [], recentSettled: false, unreads: [] }
    const rerender = () => {
      instances.forEach((refs) => {
        try {
          renderTile(refs, state)
        } catch (error) {
          console.error(
            '[starter-dashboard] Unable to render Messages tile',
            error,
          )
        }
      })
    }

    // Start the read snapshot while TalkJS initializes. Attach the rejection
    // handler immediately so a slower SDK load cannot produce an unhandled
    // promise rejection.
    const recentPromise = fetchRecentConversations(memberstack).catch(
      (error) => {
        console.warn(
          '[starter-dashboard] Recent conversations unavailable, hiding message cards',
          error,
        )
        return []
      },
    )

    recentPromise.then((items) => {
      state.recent = items
      state.recentSettled = true
      rerender()
    })

    const Talk = await waitForTalkJs()
    const me = new Talk.User(talkUserFields(member))
    const session = new Talk.Session({
      appId: TALKJS_APP_ID,
      me,
    })

    session.unreads.onChange((unreads) => {
      state.unreads = unreads || []
      rerender()
    })
  }

  function start() {
    mountTile().catch((error) => {
      console.error(
        '[starter-dashboard] Unable to mount Messages tile',
        error,
      )
      // Never strand any instance on the loading spinner.
      findWrappers().forEach((wrapper) => {
        const spinner = wrapper.querySelector('.dash_card .button_spinner')
        const loadingCard =
          pick(wrapper, 'loading') || (spinner && spinner.closest('.dash_card'))
        if (loadingCard) loadingCard.style.display = 'none'
        const hasCards = wrapper.querySelector(
          attrSel('template') + ', .message_item',
        )
        const emptyLayout = wrapper.querySelector(
          '.tile-item_empty-state-layout',
        )
        const emptyCard =
          pick(wrapper, 'empty') ||
          (emptyLayout && emptyLayout.closest('.dash_card'))
        if (emptyCard && !hasCards) emptyCard.style.display = ''
      })
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
})()
