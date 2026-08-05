/**
 * /hire/<slug> — "Message this starter" modal.
 *
 * @release v1.59.106
 *
 * Mounts a TalkJS chatbox with the profiled starter inside the page's existing
 * modal, so a brand can start or resume the conversation without leaving the
 * profile. The conversation is created on first open when it does not exist.
 *
 * Designer wiring, three CMS-bound custom attributes on the trigger link:
 *   messages-profile-message  -> "Memberstack id"     (PlainText, required)
 *   messages-profile-name     -> "Name"               (PlainText, optional)
 *   messages-profile-photo    -> "Profile Photo Xano" (PlainText, optional)
 * All three must be *field bindings*, not literal values, or every profile ships
 * the same starter's id. `Profile Photo` is an Image field and is not reliably
 * offered for attribute binding; `Profile Photo Xano` is PlainText and holds the
 * durable Xano vault URL, so bind that one.
 *
 * Plus one empty container inside the modal, which is where the chat mounts:
 *   <div messages-profile-chat></div>
 *
 * This module owns the click on a trigger: it always calls preventDefault and
 * stopPropagation, then opens the modal through `window.lumos.modal`'s registry.
 * It deliberately does not rely on modal.js's click delegation, which cannot
 * suppress navigation for Webflow's button component — an absolutely-positioned
 * `a.clickable_link` nested inside `div.button_main-wrap[data-modal-trigger]`.
 * modal.js only calls preventDefault when the element it *matched* is itself an
 * anchor, and there the match is the wrapping DIV, so the inner anchor's href
 * wins and the page navigates away while the modal is still opening. Owning the
 * click also makes `data-modal-trigger` optional, and lets the identity
 * attributes sit on either the wrapper or the anchor.
 *
 * It still listens for modal.js's `modal-open` window event, ignoring every
 * modal that does not contain the chat container, and a `?modal-id=<id>` in the
 * URL has modal.js open the modal on load with the chat mounting clicklessly.
 *
 * TalkJS loads lazily, on the first open. `/hire/<slug>` pages are public and
 * SEO-relevant, so visitors who never press Message never pay for the SDK.
 *
 * Who gets through:
 *   logged out    -> /quiz (the signup funnel; the chat intent is intentionally
 *                    dropped — there is no login round trip back to the modal)
 *   free Brand    -> `messages-profile-upgrade` when set, else route-guard's
 *                    brandFreeHome: /quiz-results once the Memberstack
 *                    `starter-quiz` field says the quiz is done, /quiz until then
 *   talent, self  -> trigger hidden, and the modal closes if opened anyway
 *   paid Brand    -> the chat
 * Role comes from `window.StartersV3RouteGuard.memberRole`, so route-guard.js has
 * to be on the page for role rules to apply at all. Every check here is
 * client-side, and unlike the `/messages` route this modal never passes through
 * route-guard, so treat these as product gating and not as an authorization
 * boundary.
 *
 * The trigger keeps `href="/messages?with=<id>"` as a fallback: if this module
 * never boots, the link still reaches the conversation through the deep link
 * `v3/messages.js` handles. If TalkJS fails after the modal is already open, the
 * same link is rendered inside the container instead of leaving an empty box.
 *
 * Diagnostics are staging-only (`*.webflow.io`, localhost, 127.0.0.1,
 * `*.trycloudflare.com`, or `window.STARTERS_DEBUG === true`); production is
 * silent. Install snippet and Designer wiring: see v3/README.md.
 */
;(function () {
  'use strict'

  if (window.__startersMessagesProfileBooted) return
  window.__startersMessagesProfileBooted = true

  var MEMBER_ATTRIBUTE = 'messages-profile-message'
  var NAME_ATTRIBUTE = 'messages-profile-name'
  var PHOTO_ATTRIBUTE = 'messages-profile-photo'
  var CHAT_ATTRIBUTE = 'messages-profile-chat'
  var UPGRADE_ATTRIBUTE = 'messages-profile-upgrade'
  var BOUND_ATTRIBUTE = 'data-messages-profile-bound'
  var BUTTON_SELECTOR = '[' + MEMBER_ATTRIBUTE + ']'
  var CHAT_SELECTOR = '[' + CHAT_ATTRIBUTE + ']'
  var MODAL_SELECTOR = '.modal_dialog'
  var MODAL_TARGET_ATTRIBUTE = 'data-modal-target'

  var HIRE_PATH_PREFIX = '/hire/'
  var MESSAGES_PATH = '/messages'
  var DEEP_LINK_PARAM = 'with'
  var MODAL_PARAM = 'modal-id'
  var FALLBACK_FREE_BRAND_PATH = '/quiz'

  var TALKJS_APP_ID = 'LmYV8DIA'
  var TALKJS_THEME = 'the-starters-3-0-profile'
  var TALKJS_SCRIPT_URL = 'https://cdn.talkjs.com/talk.js'
  var TALKJS_TIMEOUT_MS = 15000
  var MEMBERSTACK_TIMEOUT_MS = 10000
  var MEMBERSTACK_POLL_MS = 100

  var CONVERSATION_SOURCE = 'hire-page'
  // Memberstack ids are `mem_` + an alphanumeric cuid, with an extra `sb_`
  // segment for Test Mode (sandbox) members. Anything else is an unbound
  // Designer placeholder and must never reach TalkJS, which would happily
  // create a real user record for it.
  var MEMBER_ID_PATTERN = /^mem_(?:sb_)?[A-Za-z0-9]+$/
  var MAX_NAME_LENGTH = 120
  // Hidden from the trigger. `brand-free` is additionally redirected on open.
  var HIDDEN_ROLES = ['brand-free', 'talent']
  var REDIRECTED_ROLES = ['brand-free']

  var LOG_PREFIX = '[messages-profile]'
  var STAGING_HOST_SUFFIXES = ['webflow.io', 'trycloudflare.com']
  var STAGING_HOSTS = ['localhost', '127.0.0.1']

  // Captured while this deferred script executes, which is before DOMContentLoaded
  // and therefore before modal.js strips `?modal-id=` off the URL. It is the only
  // reliable signal that the page was opened *into* the modal, e.g. returning from
  // login. Reading `dialog.open` instead would misfire on any page that renders
  // the dialog with an `open` attribute already set.
  var BOOT_MODAL_ID = (function () {
    try {
      return new URLSearchParams(window.location.search).get(MODAL_PARAM) || ''
    } catch (error) {
      return ''
    }
  })()

  // Resolved once on boot so a click can decide synchronously whether to let the
  // modal open at all, instead of flashing it and then navigating away.
  var viewer = { resolved: false, member: null, role: null }
  // The starter whose trigger was actually pressed. Falls back to the page's
  // single starter for the `?modal-id=` return, where there is no click.
  var pendingIdentity = null
  var chatMounted = false
  var chatOpening = false

  function diagnosticsEnabled() {
    if (window.STARTERS_DEBUG === true) return true

    var hostname = (window.location && window.location.hostname) || ''
    if (STAGING_HOSTS.indexOf(hostname) !== -1) return true
    return STAGING_HOST_SUFFIXES.some(function (suffix) {
      return hostname === suffix || hostname.endsWith('.' + suffix)
    })
  }

  function warn(message) {
    if (!diagnosticsEnabled()) return
    try {
      console.warn(LOG_PREFIX + ' ' + message)
    } catch (error) {}
  }

  function text(value) {
    return typeof value === 'string' ? value.trim() : ''
  }

  /* ========================== PAGE IDENTITY ========================== */

  /**
   * The starter slug from `/hire/<slug>`, or '' anywhere else.
   * @returns {string}
   */
  function currentSlug() {
    var pathname = (window.location && window.location.pathname) || ''
    if (pathname.indexOf(HIRE_PATH_PREFIX) !== 0) return ''
    return text(pathname.slice(HIRE_PATH_PREFIX.length).split('/')[0])
  }

  /**
   * The starter's identity as Webflow rendered it onto one trigger.
   * `id` is null when the CMS field is empty or the value is not a member id.
   * @param {Element} element
   * @returns {{id: string|null, name: string, photo: string}}
   */
  function identityFrom(element) {
    var rawId = text(element.getAttribute(MEMBER_ATTRIBUTE))
    var name = text(element.getAttribute(NAME_ATTRIBUTE)).slice(0, MAX_NAME_LENGTH)
    var photo = text(element.getAttribute(PHOTO_ATTRIBUTE))

    return {
      id: MEMBER_ID_PATTERN.test(rawId) ? rawId : null,
      name: name,
      // TalkJS stores this verbatim and renders it as an <img> source, so only
      // accept plain https. Rejects data:, javascript:, and protocol-relative.
      photo: photo.indexOf('https://') === 0 ? photo : '',
    }
  }

  function identityCarriers() {
    return Array.prototype.slice.call(document.querySelectorAll(BUTTON_SELECTOR))
  }

  /**
   * The clickable Message controls. Webflow puts CMS-bound attributes on the
   * nested `a.clickable_link`, while `data-modal-trigger` lives on the outer
   * `div.button_main-wrap`. Prefer those outer controls so capture-phase click
   * ownership also covers the nested anchor. A standalone bound anchor remains
   * supported for simpler Designer markup and for the honest deep-link fallback.
   */
  function triggers() {
    var carriers = identityCarriers()
    var id = modalId()
    if (!id) return carriers

    var modalTriggers = Array.prototype.slice.call(
      document.querySelectorAll('[data-modal-trigger="' + id + '"]'),
    )
    if (!modalTriggers.length) return carriers

    var standalone = carriers.filter(function (carrier) {
      return !modalTriggers.some(function (trigger) {
        if (trigger === carrier) return true
        if (typeof trigger.contains === 'function' && trigger.contains(carrier)) {
          return true
        }
        return (
          typeof trigger.querySelector === 'function' &&
          trigger.querySelector(BUTTON_SELECTOR) === carrier
        )
      })
    })

    return modalTriggers.concat(standalone)
  }

  /**
   * A profile page describes exactly one starter, so any valid trigger answers
   * for the page. That is what lets the `?modal-id=` post-login open work with
   * no click to read an identity from.
   * @returns {{id: string, name: string, photo: string}|null}
   */
  function pageIdentity() {
    var found = null
    identityCarriers().some(function (element) {
      var identity = identityFrom(element)
      if (!identity.id) return false
      found = identity
      return true
    })
    return found
  }

  /* ============================== MODAL ============================== */

  function chatContainer() {
    return document.querySelector(CHAT_SELECTOR)
  }

  /** The `.modal_dialog` wrapping the chat container, if there is one. */
  function ourDialog() {
    var container = chatContainer()
    return container && typeof container.closest === 'function'
      ? container.closest(MODAL_SELECTOR)
      : null
  }

  /**
   * The `data-modal-target` of the dialog wrapping the chat container, used to
   * build the `?modal-id=` return link.
   * @returns {string}
   */
  function modalId() {
    var dialog = ourDialog()
    return dialog ? text(dialog.getAttribute(MODAL_TARGET_ATTRIBUTE)) : ''
  }

  function modalEntry() {
    var id = modalId()
    var modal = window.lumos && window.lumos.modal
    return id && modal && modal.list ? modal.list[id] : null
  }

  function closeModal() {
    var entry = modalEntry()
    if (entry && typeof entry.close === 'function') entry.close()
  }

  /**
   * Open our modal through modal.js's registry rather than relying on its click
   * delegation, which cannot suppress navigation for Webflow's nested-anchor
   * button component. Reopening an already-open dialog would throw, so an open
   * dialog counts as success and is left alone.
   * @returns {boolean} whether a modal system was there to open
   */
  function openModal() {
    var entry = modalEntry()
    if (!entry || typeof entry.open !== 'function') {
      warn('modal.js is not on this page, so there is no modal to open')
      return false
    }
    if (entry.el && entry.el.open) return true

    try {
      entry.open()
    } catch (error) {
      warn('modal.js refused to open: ' + (error && error.message))
      return false
    }
    return true
  }

  /* ============================ DESTINATIONS ========================= */

  /**
   * Where a logged-out visitor goes: the quiz signup funnel, not /login. The
   * product call (2026-07-29) is that a visitor who is not a member yet should
   * enter the funnel rather than bounce off a login form. The cost is that the
   * chat intent is dropped — nothing brings them back to this conversation
   * after signup — which is accepted.
   * @returns {string}
   */
  function loggedOutUrl() {
    return FALLBACK_FREE_BRAND_PATH
  }

  /**
   * Where a free Brand goes instead of the chat: `/quiz-results` once they have
   * completed the quiz, `/quiz` until then — i.e. route-guard's brandFreeHome,
   * which reads the Memberstack `starter-quiz` custom field. An explicit
   * `messages-profile-upgrade` on the chat container or an identity carrier
   * overrides both, for when a real upgrade page exists. It is read from the
   * carriers, not the outer modal-trigger wrappers, because Webflow publishes it
   * on the same nested `clickable_link` as the other `messages-profile-*`
   * attributes.
   * @param {object} member
   * @returns {string}
   */
  function upgradeUrl(member) {
    var container = chatContainer()
    var configured = container ? text(container.getAttribute(UPGRADE_ATTRIBUTE)) : ''
    if (!configured) {
      identityCarriers().some(function (element) {
        configured = text(element.getAttribute(UPGRADE_ATTRIBUTE))
        return !!configured
      })
    }
    if (configured) return configured

    var guard = window.StartersV3RouteGuard
    var home =
      guard && typeof guard.brandFreeHome === 'function' ? guard.brandFreeHome(member) : ''
    if (!home) {
      warn(
        'route-guard.js is absent, so quiz completion is unknown; sending the ' +
          'free Brand to ' +
          FALLBACK_FREE_BRAND_PATH,
      )
    }
    return home || FALLBACK_FREE_BRAND_PATH
  }

  function goTo(url) {
    window.location.assign(url)
  }

  /* ============================ MEMBERSTACK ========================== */

  function waitForMemberstackDom(timeoutMs) {
    if (
      window.$memberstackDom &&
      typeof window.$memberstackDom.getCurrentMember === 'function'
    ) {
      return Promise.resolve(window.$memberstackDom)
    }

    return new Promise(function (resolve) {
      var startedAt = Date.now()
      var timer = window.setInterval(function () {
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
      }, MEMBERSTACK_POLL_MS)
    })
  }

  /**
   * The viewer's role, or null when route-guard.js is absent or no plan maps.
   * @param {object} member
   * @returns {string|null}
   */
  function roleFor(member) {
    var guard = window.StartersV3RouteGuard
    if (!guard || typeof guard.memberRole !== 'function') {
      warn('route-guard.js is absent, so role rules are skipped')
      return null
    }

    try {
      return guard.memberRole(member) || null
    } catch (error) {
      warn('memberRole threw: ' + (error && error.message))
      return null
    }
  }

  async function resolveViewer() {
    var memberstack = await waitForMemberstackDom(MEMBERSTACK_TIMEOUT_MS)
    if (!memberstack) {
      warn('Memberstack never became ready')
      return viewer
    }

    var response = await memberstack.getCurrentMember()
    var member = (response && response.data) || null
    var signedIn = member && member.id ? member : null
    viewer = {
      resolved: true,
      member: signedIn,
      role: signedIn ? roleFor(signedIn) : null,
    }
    return viewer
  }

  /* ============================== TALKJS ============================= */

  function installTalkJsLoader() {
    if (window.Talk && window.Talk.ready) return

    var callbacks = []
    var NativePromise = window.Promise
    var script = document.createElement('script')
    script.async = true
    script.src = TALKJS_SCRIPT_URL
    script.dataset.startersMessagesProfileTalkjs = 'true'
    document.head.appendChild(script)

    window.Talk = {
      v: 3,
      ready: {
        then: function (callback) {
          if (NativePromise) {
            return new NativePromise(function (resolve, reject) {
              callbacks.push([callback, resolve, reject])
            })
          }
          callbacks.push([callback])
        },
        catch: function () {
          return NativePromise && new NativePromise(function () {})
        },
        c: callbacks,
      },
    }
  }

  function waitForTalkJs() {
    installTalkJsLoader()

    return new Promise(function (resolve, reject) {
      var timer = window.setTimeout(function () {
        reject(new Error('TalkJS did not become ready'))
      }, TALKJS_TIMEOUT_MS)

      Promise.resolve(window.Talk.ready).then(
        function () {
          window.clearTimeout(timer)
          resolve(window.Talk)
        },
        function (error) {
          window.clearTimeout(timer)
          reject(error)
        },
      )
    })
  }

  /** Mirrors v3/messages.js so the viewer syncs identically from either page. */
  function talkUserFields(member) {
    var customFields = member.customFields || {}
    var auth = member.auth || {}
    var email = auth.email || member.email || ''
    // 'free-user' is this site's legacy Memberstack key for the member's
    // first name; there is no 'first-name' field in the app.
    var name = [
      customFields['free-user'] || customFields['first-name'],
      customFields['last-name'],
    ]
      .filter(Boolean)
      .join(' ')
      .trim()

    var fields = { id: member.id, name: name || email || 'The Starters member' }
    if (email) fields.email = email
    if (member.profileImage) fields.photoUrl = member.profileImage
    return fields
  }

  /**
   * The starter side of the conversation. Passing fields updates that user's
   * stored TalkJS record, so only CMS-sourced values are ever passed; with no
   * name we reference the existing user by id and leave their record alone.
   */
  function starterUser(Talk, identity) {
    if (!identity.name) return new Talk.User(identity.id)

    var fields = { id: identity.id, name: identity.name }
    if (identity.photo) fields.photoUrl = identity.photo
    return new Talk.User(fields)
  }

  function deepLinkPath(memberId) {
    return MESSAGES_PATH + '?' + DEEP_LINK_PARAM + '=' + encodeURIComponent(memberId)
  }

  /**
   * Remove whatever the Designer put in the container. TalkJS mounts an iframe
   * without clearing, so a "Loading messages…" placeholder would otherwise stay
   * behind the chat forever. Clearing on mount turns that placeholder into a
   * real loading state, visible exactly while the SDK is being fetched.
   */
  function emptyContainer(container) {
    try {
      while (container.firstChild) container.removeChild(container.firstChild)
    } catch (error) {}
  }

  /** Replace the container contents with the /messages escape hatch. */
  function renderFallback(container, identity) {
    try {
      emptyContainer(container)
      var link = document.createElement('a')
      link.setAttribute('href', deepLinkPath(identity.id))
      link.setAttribute(CHAT_ATTRIBUTE + '-fallback', 'true')
      link.textContent = 'Open this conversation in Messages'
      container.appendChild(link)
    } catch (error) {}
  }

  /* =============================== OPEN ============================== */

  /**
   * Decide what a viewer gets, and mount the chat when they qualify. Safe to
   * call repeatedly: the chatbox mounts once and is reused on reopen.
   */
  async function openChat() {
    if (chatMounted || chatOpening) return
    var container = chatContainer()
    if (!container) {
      warn('the modal has no ' + CHAT_SELECTOR + ' container to mount into')
      return
    }

    // The pressed trigger wins; pageIdentity only answers for the `?modal-id=`
    // return, where nothing was clicked.
    var identity = pendingIdentity || pageIdentity()
    if (!identity) {
      warn('no usable Memberstack id on this profile; nothing to open')
      closeModal()
      return
    }

    chatOpening = true
    try {
      var state = viewer.resolved ? viewer : await resolveViewer()

      if (!state.member) {
        goTo(loggedOutUrl())
        return
      }
      if (state.member.id === identity.id) {
        warn('viewer is this starter; closing rather than opening a self-chat')
        closeModal()
        return
      }
      if (state.role && REDIRECTED_ROLES.indexOf(state.role) !== -1) {
        goTo(upgradeUrl(state.member))
        return
      }
      if (state.role && HIDDEN_ROLES.indexOf(state.role) !== -1) {
        warn('viewer role "' + state.role + '" cannot message from a profile page')
        closeModal()
        return
      }

      var Talk = await waitForTalkJs()
      var me = new Talk.User(talkUserFields(state.member))
      var session = new Talk.Session({ appId: TALKJS_APP_ID, me: me })
      var conversation = session.getOrCreateConversation(
        Talk.oneOnOneId(state.member.id, identity.id),
      )
      conversation.setParticipant(me)
      conversation.setParticipant(starterUser(Talk, identity))
      // Attribution for conversations opened from a profile. Custom values must
      // be strings, and this cannot be backfilled onto existing conversations.
      conversation.setAttributes({
        custom: { source: CONVERSATION_SOURCE, slug: currentSlug() },
      })

      var chatbox = session.createChatbox({ theme: { name: TALKJS_THEME } })
      chatbox.select(conversation)
      emptyContainer(container)
      await chatbox.mount(container)
      chatMounted = true
    } catch (error) {
      warn('could not mount the chat: ' + (error && error.message))
      renderFallback(container, identity)
    } finally {
      chatOpening = false
    }
  }

  /* ============================== WIRING ============================= */

  function hide(element) {
    try {
      element.style.display = 'none'
    } catch (error) {}
    try {
      element.setAttribute('hidden', 'hidden')
    } catch (error) {}
  }

  /**
   * Everything a click on a wired trigger can do. This owns the click outright:
   * it always suppresses the default action and stops the event before
   * modal.js's delegated document listener sees it.
   *
   * Taking the click was not optional. Webflow's button component renders an
   * absolutely-positioned `a.clickable_link` inside a
   * `div.button_main-wrap[data-modal-trigger]`, and modal.js only calls
   * preventDefault when the element it *matched* is itself an anchor:
   *
   *   const trigger = e.target.closest("[data-modal-trigger='...']")
   *   if (trigger.tagName === "A") e.preventDefault()
   *
   * With that component the match is the wrapping DIV, so the inner anchor's
   * navigation is never suppressed and the fallback href wins over the modal.
   * Opening the modal here instead makes the outcome independent of which
   * element carries which attribute, and of whether modal.js matched at all.
   * @param {Event} event
   * @param {{id: string, name: string, photo: string}} identity
   */
  function handleTriggerClick(event, identity) {
    if (typeof event.preventDefault === 'function') event.preventDefault()
    if (typeof event.stopPropagation === 'function') event.stopPropagation()

    // Whichever trigger was pressed decides the conversation, rather than
    // whichever happens to come first in the document.
    pendingIdentity = identity

    if (viewer.resolved && !viewer.member) {
      goTo(loggedOutUrl())
      return
    }
    if (
      viewer.resolved &&
      viewer.role &&
      REDIRECTED_ROLES.indexOf(viewer.role) !== -1
    ) {
      goTo(upgradeUrl(viewer.member))
      return
    }

    // Unresolved Memberstack falls through on purpose: openChat re-checks and
    // redirects from there, so a fast click is never silently swallowed.
    if (!openModal()) {
      // No modal system on the page. The href is the honest fallback.
      goTo(deepLinkPath(identity.id))
      return
    }
    openChat()
  }

  /**
   * Validate the CMS identity, hide dead triggers, give anchors the `/messages`
   * fallback href, and take ownership of the click on the rest.
   */
  function decorate() {
    var armed = []
    var fallbackIdentity = pageIdentity()

    triggers().forEach(function (element) {
      var carrier = element.hasAttribute(MEMBER_ATTRIBUTE)
        ? element
        : element.querySelector(BUTTON_SELECTOR) || element.closest(BUTTON_SELECTOR)
      var identity = carrier ? identityFrom(carrier) : fallbackIdentity

      if (!identity || !identity.id) {
        hide(element)
        warn(
          'no usable Memberstack id for slug="' +
            currentSlug() +
            '" — trigger hidden. Bind ' +
            MEMBER_ATTRIBUTE +
            ' to the CMS "Memberstack id" field and backfill the item.',
        )
        return
      }

      // Only anchors can carry a fallback destination, so the href goes on the
      // trigger anchor or, for a Webflow wrapper, its nested `clickable_link`.
      // Writing href onto a wrapper div would be meaningless. Nesting it inside a
      // modal trigger used to hijack the click; it is safe here only because this
      // module always suppresses the click, so the deep link fires solely as the
      // no-JavaScript fallback.
      var fallbackAnchor =
        String(element.tagName || '').toUpperCase() === 'A'
          ? element
          : element.querySelector('a')
      if (fallbackAnchor) {
        try {
          fallbackAnchor.setAttribute('href', deepLinkPath(identity.id))
        } catch (error) {}
      }

      if (element.getAttribute(BOUND_ATTRIBUTE) !== 'true') {
        element.setAttribute(BOUND_ATTRIBUTE, 'true')
        // Capture phase on the trigger, so this runs before the inner anchor's
        // default action and before modal.js's document-level listener.
        element.addEventListener(
          'click',
          function (event) {
            handleTriggerClick(event, identity)
          },
          true,
        )
      }

      armed.push({ element: element, identity: identity })
    })

    warnAboutUnwiredTriggers()
    return armed
  }

  /**
   * Point out Message buttons that open our modal but carry no identity. Every
   * one of these is a button that will open an empty or wrong-starter chat.
   */
  function warnAboutUnwiredTriggers() {
    var id = modalId()
    if (!id) return

    // A /hire/<slug> page represents one starter. One valid CMS identity is a
    // safe page-level fallback for responsive copies of the same Message
    // component, even when Webflow publishes their bound values on only one
    // nested clickable_link.
    if (pageIdentity()) return

    var unwired = Array.prototype.slice
      .call(document.querySelectorAll('[data-modal-trigger="' + id + '"]'))
      .filter(function (element) {
        return (
          !element.hasAttribute(MEMBER_ATTRIBUTE) &&
          !element.querySelector(BUTTON_SELECTOR) &&
          !element.closest(BUTTON_SELECTOR)
        )
      })

    if (!unwired.length) return
    warn(
      unwired.length +
        ' element(s) open the "' +
        id +
        '" modal but carry no ' +
        MEMBER_ATTRIBUTE +
        ', so they will open a chat with nobody. Add the three ' +
        'messages-profile-* attributes to each: ' +
        unwired
          .map(function (element) {
            return (
              '<' +
              String(element.tagName || '?').toLowerCase() +
              ' class="' +
              String(element.className || '').split(' ')[0] +
              '">'
            )
          })
          .join(', '),
    )
  }

  /** Hide triggers the signed-in viewer should not see. */
  function applyViewerRules(armed) {
    if (!armed.length || !viewer.member) return

    armed.forEach(function (entry) {
      if (viewer.member.id === entry.identity.id) {
        hide(entry.element)
        return
      }
      if (viewer.role && HIDDEN_ROLES.indexOf(viewer.role) !== -1) {
        hide(entry.element)
      }
    })
  }

  function apply() {
    var armed = decorate()
    resolveViewer()
      .then(function () {
        applyViewerRules(armed)
      })
      .catch(function (error) {
        // A failed viewer lookup must never strip a working trigger from a paid
        // Brand, so failure leaves whatever decorate() armed in place.
        warn('viewer rules failed: ' + (error && error.message))
      })
    return armed
  }

  window.StartersMessagesProfile = {
    release: 'v1.59.106',
    apply: apply,
    decorate: decorate,
    identityFrom: identityFrom,
    pageIdentity: pageIdentity,
    currentSlug: currentSlug,
    modalId: modalId,
    openChat: openChat,
  }

  function start() {
    if (!currentSlug()) {
      if (triggers().length) {
        warn(
          'found ' +
            BUTTON_SELECTOR +
            ' outside ' +
            HIRE_PATH_PREFIX +
            '<slug>; ignoring. Move the embed to the detail_hire template.',
        )
      }
      return
    }

    apply()

    // modal.js announces every open. Ignore the ones that are not ours.
    window.addEventListener('modal-open', function (event) {
      var modal = event && event.detail && event.detail.modal
      if (!modal || typeof modal.querySelector !== 'function') return
      if (!modal.querySelector(CHAT_SELECTOR)) return
      openChat()
    })

    // The listener above can be too late to hear about our own modal. modal.js
    // handles `?modal-id=` synchronously inside its own DOMContentLoaded
    // handler, which it registered before this one, so the post-login return
    // dispatches `modal-open` before the listener exists. Gate this on the URL
    // parameter captured at parse time rather than on `dialog.open`: a page that
    // ships the dialog with an `open` attribute would otherwise mount — and
    // redirect a logged-out visitor to login — with nobody having clicked.
    if (BOOT_MODAL_ID && BOOT_MODAL_ID === modalId()) openChat()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
})()
