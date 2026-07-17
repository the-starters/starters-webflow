/**
 * Starter Dashboard 3.0 — Messages tile.
 *
 * Binds the #messages tile on /starter-dashboard to TalkJS unread
 * conversations (same prod app as /messages). Waits for Memberstack,
 * loads TalkJS, then renders the unread count badge and preview cards
 * from `session.unreads`. Shows the empty state when nothing is unread.
 */
;(function () {
  'use strict'

  if (window.__startersDashboardMessagesBooted) return
  window.__startersDashboardMessagesBooted = true

  const TALKJS_APP_ID = 'LmYV8DIA'
  const TALKJS_SCRIPT_URL = 'https://cdn.talkjs.com/talk.js'
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

  function unreadDisplay(unread) {
    const conversation = unread.conversation || {}
    const lastMessage = unread.lastMessage || {}
    const sender =
      (!lastMessage.isByMe && lastMessage.sender) || null

    return {
      title:
        conversation.subject ||
        (sender && sender.name) ||
        'Conversation',
      photoUrl:
        conversation.photoUrl || (sender && sender.photoUrl) || null,
      preview:
        lastMessage.body ||
        (lastMessage.attachment ? 'Sent an attachment' : ''),
      timestamp: lastMessage.timestamp || null,
    }
  }

  function renderItem(refs, unread) {
    const item = refs.template.cloneNode(true)
    const display = unreadDisplay(unread)

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

    item.classList.add('is-new')

    const button = item.querySelector('.clickable_btn')
    const target = button || item
    target.addEventListener('click', () => {
      window.location.assign(MESSAGES_PATH)
    })

    return item
  }

  function renderUnreads(refs, unreads) {
    const count = unreads.length

    if (refs.badge) {
      refs.badge.textContent = String(count)
      refs.badge.style.display = count > 0 ? '' : 'none'
    }

    refs.list.querySelectorAll('.message_item').forEach((node) => node.remove())

    if (count === 0) {
      refs.list.style.display = 'none'
      if (refs.emptyCard) refs.emptyCard.style.display = ''
      return
    }

    refs.list.style.display = ''
    if (refs.emptyCard) refs.emptyCard.style.display = 'none'

    unreads
      .slice()
      .sort(
        (a, b) =>
          ((b.lastMessage && b.lastMessage.timestamp) || 0) -
          ((a.lastMessage && a.lastMessage.timestamp) || 0),
      )
      .slice(0, MAX_PREVIEW_ITEMS)
      .forEach((unread) => {
        refs.list.appendChild(renderItem(refs, unread))
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

    const Talk = await waitForTalkJs()
    const me = new Talk.User(talkUserFields(member))
    const session = new Talk.Session({
      appId: TALKJS_APP_ID,
      me,
    })

    session.unreads.onChange((unreads) => {
      try {
        renderUnreads(refs, unreads || [])
      } catch (error) {
        console.error(
          '[starter-dashboard] Unable to render Messages tile',
          error,
        )
      }
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
