/**
 * Starter Dashboard 3.0 — Messages tile.
 *
 * Binds the #messages tile on /starter-dashboard to the member's recent
 * TalkJS conversations. Two data sources, merged:
 *   - Xano `starter/messages/recent` (TalkJS REST proxy) → recent
 *     conversations including already-read ones.
 *   - TalkJS JS SDK `session.unreads` → live unread state + sender
 *     name/photo enrichment, and the unread count badge.
 * If the Xano endpoint is unavailable the tile degrades to unreads-only.
 * Shows the empty state when there are no conversations at all.
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
  const MESSAGES_PATH = '/messages'
  const MAX_PREVIEW_ITEMS = 8

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

  function talkUserFields(member) {
    const customFields = member.customFields || {}
    const auth = member.auth || {}
    const email = auth.email || member.email || ''
    const name = [customFields['first-name'], customFields['last-name']]
      .filter(Boolean)
      .join(' ')
      .trim()

    const fields = {
      id: member.id,
      name: name || email || 'The Starters member',
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
  }

  function collectTileRefs() {
    const tile = document.getElementById('messages')
    if (!tile) return null

    const list = tile.querySelector('.tile-item_message-list')
    const template = list && list.querySelector('.message_item')
    if (!list || !template) return null

    return {
      tile,
      badge: tile.querySelector('.tile-item_notification-text'),
      emptyCard: tile.querySelector('.dash_card'),
      viewAll: tile.querySelector('.button_main-wrap .clickable_btn'),
      list,
      template: template.cloneNode(true),
    }
  }

  function clearPlaceholders(refs) {
    refs.list.querySelectorAll('.message_item').forEach((node) => node.remove())
    if (refs.badge) refs.badge.style.display = 'none'
    refs.list.style.display = 'none'
    if (refs.emptyCard) refs.emptyCard.style.display = ''
  }

  async function getMemberstackToken(memberstack) {
    const token = await memberstack.getMemberCookie()
    if (!token) throw new Error('No Memberstack session')
    return token
  }

  async function fetchRecentConversations(memberstack) {
    const msToken = await getMemberstackToken(memberstack)
    const tradeRes = await fetch(
      XANO_AUTH_BASE +
        XANO_TRADE_TOKEN_PATH +
        '?token=' +
        encodeURIComponent(msToken),
    )
    const tradeData = await tradeRes.json().catch(() => null)
    if (!tradeRes.ok) throw new Error('trade-token failed')
    const xanoToken =
      typeof tradeData === 'string'
        ? tradeData
        : tradeData && (tradeData.authToken || tradeData.token)
    if (!xanoToken) throw new Error('trade-token returned no token')

    const res = await fetch(XANO_OPP_BASE + RECENT_MESSAGES_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + xanoToken,
      },
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error('recent messages request failed')
    return (data && data.items) || []
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
    if (enrich) return displayFromUnread(enrich)

    return {
      id: conv.id || null,
      title: conv.subject || 'Conversation',
      photoUrl: conv.photo_url || null,
      preview: conv.last_message_text || '',
      timestamp: conv.last_message_at || null,
      unread: Boolean(conv.unread),
    }
  }

  function renderItem(refs, display) {
    const item = refs.template.cloneNode(true)

    const heading = item.querySelector('.message-item_message h3')
    if (heading) heading.textContent = display.title

    const preview = item.querySelector('.message-item_message p')
    if (preview) preview.textContent = display.preview

    const timeEl = item.querySelector('.message-item_layout > p')
    if (timeEl) timeEl.textContent = timeAgo(display.timestamp)

    const avatar = item.querySelector('.message-item_profile-image')
    if (avatar) {
      const initialsEl = avatar.querySelector('p')
      if (display.photoUrl) {
        avatar.style.backgroundImage = 'url("' + display.photoUrl + '")'
        avatar.style.backgroundSize = 'cover'
        avatar.style.backgroundPosition = 'center'
        if (initialsEl) {
          initialsEl.textContent = ''
          initialsEl.style.display = 'none'
        }
      } else if (initialsEl) {
        initialsEl.textContent = ''
        initials(display.title).forEach((letter) => {
          const span = document.createElement('span')
          span.textContent = letter
          initialsEl.appendChild(span)
        })
      }
    }

    item.classList.toggle('is-new', display.unread)

    const button = item.querySelector('.clickable_btn')
    const target = button || item
    target.addEventListener('click', () => {
      window.location.assign(MESSAGES_PATH)
    })

    return item
  }

  function renderTile(refs, state) {
    const unreads = state.unreads || []
    const unreadsById = {}
    unreads.forEach((unread) => {
      const id = unread.conversation && unread.conversation.id
      if (id) unreadsById[id] = unread
    })

    let displays
    if (state.recent) {
      const recentIds = {}
      displays = state.recent.map((conv) => {
        if (conv.id) recentIds[conv.id] = true
        return displayFromRecent(conv, unreadsById)
      })
      // Unread conversations the REST snapshot hasn't caught up with yet.
      unreads.forEach((unread) => {
        const id = unread.conversation && unread.conversation.id
        if (!id || !recentIds[id]) displays.push(displayFromUnread(unread))
      })
    } else {
      displays = unreads.map(displayFromUnread)
    }

    const unreadCount = state.recent
      ? displays.filter((d) => d.unread).length
      : unreads.length

    if (refs.badge) {
      refs.badge.textContent = String(unreadCount)
      refs.badge.style.display = unreadCount > 0 ? '' : 'none'
    }

    refs.list.querySelectorAll('.message_item').forEach((node) => node.remove())

    if (displays.length === 0) {
      refs.list.style.display = 'none'
      if (refs.emptyCard) refs.emptyCard.style.display = ''
      return
    }

    refs.list.style.display = ''
    if (refs.emptyCard) refs.emptyCard.style.display = 'none'

    displays
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, MAX_PREVIEW_ITEMS)
      .forEach((display) => {
        refs.list.appendChild(renderItem(refs, display))
      })
  }

  async function mountTile() {
    const refs = collectTileRefs()
    if (!refs) return

    clearPlaceholders(refs)

    if (refs.viewAll) {
      refs.viewAll.addEventListener('click', () => {
        window.location.assign(MESSAGES_PATH)
      })
    }

    const memberstack = await waitForMemberstackDom()
    if (!memberstack) return

    const response = await memberstack.getCurrentMember()
    const member = response && response.data
    if (!member || !member.id) return

    const state = { recent: null, unreads: [] }
    const rerender = () => {
      try {
        renderTile(refs, state)
      } catch (error) {
        console.error(
          '[starter-dashboard] Unable to render Messages tile',
          error,
        )
      }
    }

    // Recent conversations (including read ones) via the Xano proxy.
    // Non-fatal: the tile degrades to unreads-only if it fails.
    fetchRecentConversations(memberstack)
      .then((items) => {
        state.recent = items
        rerender()
      })
      .catch((error) => {
        console.warn(
          '[starter-dashboard] Recent conversations unavailable, showing unreads only',
          error,
        )
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
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
})()
