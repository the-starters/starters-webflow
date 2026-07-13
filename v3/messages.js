/**
 * Messages 3.0 — TalkJS inbox bootstrap.
 *
 * Self-contained page controller for /messages. It waits for Memberstack,
 * redirects logged-out visitors, loads TalkJS, syncs the current member's
 * public profile, and mounts the 3.0-themed inbox into #talkjs-container.
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
  const LOGIN_PATH = '/log-in'

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

  async function mountMessages() {
    const container = document.getElementById('talkjs-container')
    if (!container) throw new Error('Missing #talkjs-container')

    const memberstack = await waitForMemberstackDom()
    if (!memberstack) throw new Error('Memberstack did not become ready')

    const response = await memberstack.getCurrentMember()
    const member = response && response.data
    if (!member || !member.id) {
      window.location.replace(LOGIN_PATH)
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

    inbox.mount(container)
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
