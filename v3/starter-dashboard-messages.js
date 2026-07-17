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
 *
 * Wiring (wf-xano-style, multi-instance): each `data-messages-element="wrapper"`
 * scopes one rendered instance containing `list`, `template` (first card),
 * `empty`, `loading`, `total` (unread count) and `view-all`, with card fields
 * `name` (alias `title`), `name_initials`, `preview`, `time` and optional
 * `avatar` container inside the template. `data-messages-format="uppercase|
 * lowercase"` transforms a bound element's text. Optional
 * `data-messages-limit="<n>"` on the wrapper caps rendered cards (default 8).
 * All instances share one TalkJS session + one Xano fetch. The original
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

    const limit =
      parseInt(wrapper.getAttribute('data-messages-limit'), 10) ||
      MAX_PREVIEW_ITEMS

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

    if (refs.loadingCard) refs.loadingCard.style.display = 'none'

    if (refs.total) {
      refs.total.textContent = String(unreadCount)
      refs.total.style.display = unreadCount > 0 ? '' : 'none'
    }

    refs.list
      .querySelectorAll(refs.itemSelector)
      .forEach((node) => node.remove())

    if (displays.length === 0) {
      refs.list.style.display = 'none'
      if (refs.emptyCard) refs.emptyCard.style.display = ''
      return
    }

    refs.list.style.display = ''
    if (refs.emptyCard) refs.emptyCard.style.display = 'none'

    displays
      // Unread first (the tile is capped, so unreads must never be pushed
      // out by newer read conversations), then most recent within each group.
      .sort(
        (a, b) =>
          (b.unread ? 1 : 0) - (a.unread ? 1 : 0) ||
          (b.timestamp || 0) - (a.timestamp || 0),
      )
      .slice(0, refs.limit)
      .forEach((display) => {
        refs.list.appendChild(renderItem(refs, display))
      })
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

    const response = await memberstack.getCurrentMember()
    const member = response && response.data
    if (!member || !member.id) {
      showEmpty()
      return
    }

    const state = { recent: null, unreads: [] }
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
