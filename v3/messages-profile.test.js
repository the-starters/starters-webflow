const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./messages-profile.js'), 'utf8')

const MEMBER_ATTRIBUTE = 'messages-profile-message'
const NAME_ATTRIBUTE = 'messages-profile-name'
const PHOTO_ATTRIBUTE = 'messages-profile-photo'
const CHAT_ATTRIBUTE = 'messages-profile-chat'
const UPGRADE_ATTRIBUTE = 'messages-profile-upgrade'
const BUTTON_SELECTOR = '[' + MEMBER_ATTRIBUTE + ']'
const CHAT_SELECTOR = '[' + CHAT_ATTRIBUTE + ']'

const STARTER_ID = 'mem_starter000000000000'
const VIEWER_ID = 'mem_viewer0000000000000'
const PHOTO = 'https://x08a-5ko8-jj1r.n7c.xano.io/vault/abc/freelancer-5.jpg'
const MODAL_ID = 'message-modal'

/** Objects built inside the vm carry that realm's prototype; normalize first. */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

/** A Designer-built trigger with CMS-rendered attribute values. */
function trigger(attributes = {}) {
  const own = Object.assign({}, attributes)
  const listeners = []
  const element = {
    attributes: own,
    style: {},
    listeners,
    tagName: attributes.tagName || 'A',
    getAttribute: (name) =>
      Object.prototype.hasOwnProperty.call(own, name) ? own[name] : null,
    hasAttribute: (name) => Object.prototype.hasOwnProperty.call(own, name),
    setAttribute(name, value) {
      own[name] = String(value)
    },
    querySelector: () => null,
    closest: () => null,
    addEventListener(type, handler, capture) {
      listeners.push({ type, handler, capture })
    },
    /** Returns the event so a test can inspect what the handler suppressed. */
    click() {
      const event = { defaultPrevented: false, propagationStopped: false }
      event.preventDefault = () => {
        event.defaultPrevented = true
      }
      event.stopPropagation = () => {
        event.propagationStopped = true
      }
      listeners
        .filter((entry) => entry.type === 'click')
        .forEach((entry) => entry.handler(event))
      return event
    },
    get hidden() {
      return element.style.display === 'none'
    },
  }
  return element
}

function starterTrigger(overrides = {}) {
  return trigger(
    Object.assign(
      {
        [MEMBER_ATTRIBUTE]: STARTER_ID,
        [NAME_ATTRIBUTE]: 'Kaeser Valencerina',
        [PHOTO_ATTRIBUTE]: PHOTO,
        href: '/messages',
      },
      overrides,
    ),
  )
}

/** The div inside the modal that the chatbox mounts into. */
function chatContainer(attributes = {}, initialChildren = []) {
  const own = Object.assign({}, attributes)
  const children = initialChildren.slice()
  return {
    children,
    get firstChild() {
      return children.length ? children[0] : null
    },
    getAttribute: (name) =>
      Object.prototype.hasOwnProperty.call(own, name) ? own[name] : null,
    setAttribute(name, value) {
      own[name] = String(value)
    },
    closest: () => null,
    appendChild(node) {
      children.push(node)
    },
    removeChild(node) {
      const index = children.indexOf(node)
      if (index !== -1) children.splice(index, 1)
    },
  }
}

/**
 * options.triggers   — trigger elements
 * options.container  — false to simulate a missing chat container
 * options.modalId    — data-modal-target of the wrapping dialog
 * options.member     — Memberstack member (null = logged out)
 * options.role       — StartersV3RouteGuard.memberRole result
 * options.brandFreeHome — StartersV3RouteGuard.brandFreeHome result
 * options.talkFails  — reject the TalkJS ready promise
 */
function load(options = {}) {
  const warnings = []
  const navigations = []
  const closed = []
  const opened = []
  const calls = { users: [], conversations: [], mounted: [], selected: [], chatbox: 0 }
  const windowListeners = []
  const modalId = options.modalId || MODAL_ID

  const container =
    options.container === false
      ? null
      : chatContainer(options.containerAttributes, options.containerChildren || [])
  const dialog = {
    open: options.dialogAlreadyOpen === true,
    getAttribute: (name) => (name === 'data-modal-target' ? modalId : null),
    querySelector: (selector) =>
      selector === CHAT_SELECTOR ? container : null,
  }
  if (container) container.closest = (s) => (s === '.modal_dialog' ? dialog : null)

  const state = { triggers: options.triggers || [] }

  const document = {
    readyState: 'complete',
    addEventListener() {},
    head: { appendChild() {} },
    createElement: () => ({ dataset: {}, setAttribute() {}, textContent: '' }),
    querySelectorAll: (selector) => {
      if (selector === BUTTON_SELECTOR) return state.triggers
      if (selector === '[data-modal-trigger="' + modalId + '"]') {
        return options.modalTriggers || []
      }
      return []
    },
    querySelector: (selector) => (selector === CHAT_SELECTOR ? container : null),
  }

  function conversationStub(id) {
    const conversation = {
      id,
      participants: [],
      attributes: null,
      setParticipant(user) {
        conversation.participants.push(user)
      },
      setAttributes(attributes) {
        conversation.attributes = attributes
      },
    }
    calls.conversations.push(conversation)
    return conversation
  }

  const readyPromise = options.talkFails
    ? Promise.reject(new Error('talkjs blew up'))
    : Promise.resolve()
  if (options.talkFails) readyPromise.catch(() => {})

  const Talk = {
    ready: readyPromise,
    // Records the constructor argument verbatim so a test can tell an id-only
    // reference (a string) from a field-carrying sync (an object).
    User: function User(fields) {
      calls.users.push(fields)
      this.fields = fields
    },
    oneOnOneId: (a, b) => 'one:' + [a, b].sort().join('|'),
    Session: function Session(sessionOptions) {
      calls.session = sessionOptions
      this.getOrCreateConversation = conversationStub
      this.createChatbox = (chatboxOptions) => {
        calls.chatbox += 1
        calls.chatboxOptions = chatboxOptions
        return {
          select(conversation) {
            calls.selected.push(conversation)
          },
          mount(target) {
            calls.mounted.push(target)
            return Promise.resolve()
          },
        }
      }
    },
  }

  const window = {
    location: {
      pathname:
        options.pathname === undefined ? '/hire/kaeser-valencerina' : options.pathname,
      hostname: options.hostname || 'the-starters-3-0.webflow.io',
      search: options.search || '',
      assign(url) {
        navigations.push(url)
      },
    },
    document,
    lumos: options.noModalJs
      ? undefined
      : {
          modal: {
            list: {
              [modalId]: {
                el: dialog,
                open: () => {
                  opened.push(true)
                  dialog.open = true
                },
                close: () => closed.push(true),
              },
            },
          },
        },
    addEventListener(type, handler) {
      windowListeners.push({ type, handler })
    },
    setInterval(handler, ms) {
      const timer = setInterval(handler, ms)
      if (timer && typeof timer.unref === 'function') timer.unref()
      return timer
    },
    clearInterval,
    setTimeout(handler, ms) {
      const timer = setTimeout(handler, ms)
      if (timer && typeof timer.unref === 'function') timer.unref()
      return timer
    },
    clearTimeout,
    Talk,
  }

  if (options.memberstack !== false) {
    window.$memberstackDom = {
      getCurrentMember: async () => ({
        data: options.member === undefined ? null : options.member,
      }),
    }
  }
  if (options.guard !== false) {
    window.StartersV3RouteGuard = {
      memberRole: () => options.role || null,
      brandFreeHome: () => options.brandFreeHome || '/quiz-results',
    }
  }

  vm.runInNewContext(source, {
    Array,
    Date,
    JSON,
    Promise,
    URLSearchParams,
    console: {
      warn(message) {
        warnings.push(String(message))
      },
    },
    document,
    encodeURIComponent,
    window,
  })

  /** Fire modal.js's modal-open event for the given dialog. */
  function openModal(target = dialog) {
    windowListeners
      .filter((entry) => entry.type === 'modal-open')
      .forEach((entry) => entry.handler({ detail: { modal: target } }))
  }

  return {
    api: window.StartersMessagesProfile,
    warnings,
    navigations,
    closed,
    opened,
    calls,
    container,
    dialog,
    openModal,
    window,
  }
}

async function settle(turns = 30) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

/* ============================ identity ============================ */

test('a bound Memberstack id becomes the /messages fallback href', async () => {
  const element = starterTrigger()
  load({ triggers: [element] })

  assert.equal(element.getAttribute('href'), '/messages?with=' + STARTER_ID)
  assert.equal(element.hidden, false)
})

test('an empty Memberstack id hides the trigger and names the slug', async () => {
  const element = starterTrigger({ [MEMBER_ATTRIBUTE]: '' })
  const { warnings } = load({ triggers: [element] })

  assert.equal(element.hidden, true)
  assert.ok(warnings.some((line) => /kaeser-valencerina/.test(line)))
})

test('a value that is not a Memberstack id hides the trigger', async () => {
  for (const value of ['{memberstack-id}', '5', 'mem_', 'mem_sb_', 'mem_has-a-hyphen', 'mem_sb_extra_underscore', ' ']) {
    const element = starterTrigger({ [MEMBER_ATTRIBUTE]: value })
    load({ triggers: [element] })
    assert.equal(element.hidden, true, 'rejected: ' + JSON.stringify(value))
  }
})

test('a Test Mode (sandbox) Memberstack id is accepted like a live id', async () => {
  const SANDBOX_ID = 'mem_sb_cmqhuaxn80d270sseeo74fn7i'
  const element = starterTrigger({ [MEMBER_ATTRIBUTE]: SANDBOX_ID })
  load({ triggers: [element] })

  assert.equal(element.hidden, false)
  assert.equal(element.getAttribute('href'), '/messages?with=' + SANDBOX_ID)
})

test('every trigger on the page is wired, not just the first', async () => {
  const hero = starterTrigger()
  const sticky = starterTrigger()
  load({ triggers: [hero, sticky] })

  assert.equal(hero.getAttribute('href'), '/messages?with=' + STARTER_ID)
  assert.equal(sticky.getAttribute('href'), '/messages?with=' + STARTER_ID)
})

test('pageIdentity skips a trigger with no id and finds the usable one', async () => {
  const { api } = load({
    triggers: [starterTrigger({ [MEMBER_ATTRIBUTE]: '' }), starterTrigger()],
  })

  assert.equal(api.pageIdentity().id, STARTER_ID)
})

test('modalId reads data-modal-target off the wrapping dialog', async () => {
  const { api } = load({ triggers: [starterTrigger()], modalId: 'chat-modal' })

  assert.equal(api.modalId(), 'chat-modal')
})

/* ============================= opening ============================ */

test('a modal that is not ours is ignored', async () => {
  const loaded = load({
    triggers: [starterTrigger()],
    member: { id: VIEWER_ID },
    role: 'brand-paid',
  })
  await settle()

  loaded.openModal({ querySelector: () => null })
  await settle()

  assert.equal(loaded.calls.mounted.length, 0)
  assert.equal(loaded.navigations.length, 0)
})

test('a paid Brand gets the chatbox mounted into the container', async () => {
  const loaded = load({
    triggers: [starterTrigger()],
    member: { id: VIEWER_ID, customFields: { 'first-name': 'Brand' } },
    role: 'brand-paid',
  })
  await settle()

  loaded.openModal()
  await settle()

  assert.equal(loaded.calls.chatbox, 1)
  assert.deepEqual(loaded.calls.mounted, [loaded.container])
  assert.equal(loaded.calls.conversations.length, 1)

  const conversation = loaded.calls.conversations[0]
  assert.equal(conversation.id, 'one:' + [VIEWER_ID, STARTER_ID].sort().join('|'))
  assert.equal(conversation.participants.length, 2)
  assert.deepEqual(plain(conversation.attributes), {
    custom: { source: 'hire-page', slug: 'kaeser-valencerina' },
  })
  assert.deepEqual(loaded.calls.selected, [conversation])
})

test('the starter is synced with the CMS name and photo', async () => {
  const loaded = load({
    triggers: [starterTrigger()],
    member: { id: VIEWER_ID },
    role: 'brand-paid',
  })
  await settle()
  loaded.openModal()
  await settle()

  assert.deepEqual(plain(loaded.calls.users[1]), {
    id: STARTER_ID,
    name: 'Kaeser Valencerina',
    photoUrl: PHOTO,
  })
})

test('with no CMS name the starter is referenced by id alone', async () => {
  const loaded = load({
    triggers: [starterTrigger({ [NAME_ATTRIBUTE]: '' })],
    member: { id: VIEWER_ID },
    role: 'brand-paid',
  })
  await settle()
  loaded.openModal()
  await settle()

  assert.equal(loaded.calls.users[1], STARTER_ID)
})

test('a non-https CMS photo is dropped before reaching TalkJS', async () => {
  const loaded = load({
    triggers: [starterTrigger({ [PHOTO_ATTRIBUTE]: 'javascript:alert(1)' })],
    member: { id: VIEWER_ID },
    role: 'brand-paid',
  })
  await settle()
  loaded.openModal()
  await settle()

  assert.deepEqual(plain(loaded.calls.users[1]), {
    id: STARTER_ID,
    name: 'Kaeser Valencerina',
  })
})

test('reopening the modal does not mount a second chatbox', async () => {
  const loaded = load({
    triggers: [starterTrigger()],
    member: { id: VIEWER_ID },
    role: 'brand-paid',
  })
  await settle()

  loaded.openModal()
  await settle()
  loaded.openModal()
  await settle()

  assert.equal(loaded.calls.chatbox, 1)
  assert.equal(loaded.calls.mounted.length, 1)
})

test('?modal-id= for our modal mounts at boot, for the post-login return', async () => {
  // modal.js resolves ?modal-id= synchronously inside its own DOMContentLoaded
  // handler, registered before ours, so the modal-open event fires before this
  // module's listener exists. Boot reads the parameter itself to catch that.
  const loaded = load({
    triggers: [starterTrigger()],
    member: { id: VIEWER_ID },
    role: 'brand-paid',
    search: '?modal-id=' + MODAL_ID,
  })

  await settle()

  assert.equal(loaded.calls.mounted.length, 1, 'mounted without a modal-open event')
})

test('?modal-id= for a different modal does not mount ours', async () => {
  const loaded = load({
    triggers: [starterTrigger()],
    member: { id: VIEWER_ID },
    role: 'brand-paid',
    search: '?modal-id=some-other-modal',
  })

  await settle()

  assert.equal(loaded.calls.mounted.length, 0)
})

test('a dialog rendered with open="" does not mount or redirect on load', async () => {
  // Webflow can ship the dialog already open. Keying the boot check on
  // dialog.open would mount unprompted — and bounce a logged-out visitor to
  // /login the instant they land on a profile page.
  const loaded = load({
    triggers: [starterTrigger()],
    member: null,
    dialogAlreadyOpen: true,
  })

  await settle()

  assert.deepEqual(loaded.navigations, [], 'nobody clicked, so nobody is redirected')
  assert.equal(loaded.calls.mounted.length, 0)
})

test('no query string at all mounts nothing at boot', async () => {
  const loaded = load({
    triggers: [starterTrigger()],
    member: { id: VIEWER_ID },
    role: 'brand-paid',
  })

  await settle()

  assert.equal(loaded.calls.mounted.length, 0)
})

test('Designer placeholder content is cleared when the chat mounts', async () => {
  const loader = { name: 'Loading messages…' }
  const loaded = load({
    triggers: [starterTrigger()],
    member: { id: VIEWER_ID },
    role: 'brand-paid',
    containerChildren: [loader],
  })
  await settle()

  assert.equal(loaded.container.children.length, 1, 'loader present before opening')

  loaded.openModal()
  await settle()

  assert.equal(loaded.calls.mounted.length, 1)
  assert.deepEqual(loaded.container.children, [], 'loader removed before mount')
})

/* ============================ gatekeeping ========================= */

test('a logged-out visitor is sent to the quiz funnel', async () => {
  const loaded = load({ triggers: [starterTrigger()], member: null })
  await settle()

  loaded.openModal()
  await settle()

  assert.deepEqual(loaded.navigations, ['/quiz'])
  assert.equal(loaded.calls.mounted.length, 0)
})

test('a logged-out click is intercepted before the modal can open', async () => {
  const element = starterTrigger()
  const loaded = load({ triggers: [element], member: null })
  await settle()

  const event = element.click()

  assert.equal(event.defaultPrevented, true)
  assert.equal(event.propagationStopped, true, 'modal.js must not see this click')
  assert.deepEqual(loaded.navigations, ['/quiz'])
})

test('a paid Brand click is taken over and opens the modal directly', async () => {
  // modal.js cannot suppress navigation when its matched trigger is a wrapper
  // DIV around an anchor, which is exactly Webflow's button component. So this
  // module owns the click: always preventDefault, always stopPropagation, and
  // open the modal through modal.js's registry instead of its delegation.
  const element = starterTrigger()
  const loaded = load({
    triggers: [element],
    member: { id: VIEWER_ID },
    role: 'brand-paid',
  })
  await settle()

  const event = element.click()
  await settle()

  assert.equal(event.defaultPrevented, true, 'the href must not navigate')
  assert.equal(event.propagationStopped, true, 'modal.js must not double-open')
  assert.equal(loaded.opened.length, 1, 'modal opened through the registry')
  assert.deepEqual(loaded.navigations, [])
  assert.equal(loaded.calls.mounted.length, 1, 'and the chat mounted')
})

test('an already-open dialog is not reopened, which would throw', async () => {
  const element = starterTrigger()
  const loaded = load({
    triggers: [element],
    member: { id: VIEWER_ID },
    role: 'brand-paid',
    dialogAlreadyOpen: true,
  })
  await settle()

  element.click()
  await settle()

  assert.equal(loaded.opened.length, 0, 'open() not called on an open dialog')
  assert.equal(loaded.calls.mounted.length, 1, 'chat still mounts')
})

test('with no modal.js the click falls back to the /messages deep link', async () => {
  const element = starterTrigger()
  const loaded = load({
    triggers: [element],
    member: { id: VIEWER_ID },
    role: 'brand-paid',
    noModalJs: true,
  })
  await settle()

  const event = element.click()
  await settle()

  assert.equal(event.defaultPrevented, true)
  assert.deepEqual(loaded.navigations, ['/messages?with=' + STARTER_ID])
  assert.equal(loaded.calls.mounted.length, 0)
})

test('the pressed trigger decides the conversation, not the first in the DOM', async () => {
  const OTHER = 'mem_second00000000000000'
  const first = starterTrigger()
  const second = starterTrigger({
    [MEMBER_ATTRIBUTE]: OTHER,
    [NAME_ATTRIBUTE]: 'Second Starter',
  })
  const loaded = load({
    triggers: [first, second],
    member: { id: VIEWER_ID },
    role: 'brand-paid',
  })
  await settle()

  second.click()
  await settle()

  assert.equal(loaded.calls.conversations.length, 1)
  assert.equal(
    loaded.calls.conversations[0].id,
    'one:' + [VIEWER_ID, OTHER].sort().join('|'),
    'used the trigger that was clicked',
  )
})

test('href is written to anchors only, never to a wrapper div', async () => {
  const wrapper = starterTrigger({ tagName: 'DIV' })
  load({ triggers: [wrapper] })

  assert.equal(
    wrapper.getAttribute('href'),
    '/messages',
    'the div keeps whatever it had; no destination is injected',
  )
})

test('a div trigger still takes the click and opens the modal', async () => {
  // Attributes on the button_main-wrap rather than the inner anchor.
  const wrapper = starterTrigger({ tagName: 'DIV' })
  const loaded = load({
    triggers: [wrapper],
    member: { id: VIEWER_ID },
    role: 'brand-paid',
  })
  await settle()

  const event = wrapper.click()
  await settle()

  assert.equal(event.defaultPrevented, true, 'suppresses the inner anchor')
  assert.equal(loaded.opened.length, 1)
  assert.equal(loaded.calls.mounted.length, 1)
})

test('Webflow wrapper inherits identity from its nested clickable link', async () => {
  const carrier = starterTrigger()
  const wrapper = trigger({ tagName: 'DIV' })
  wrapper.querySelector = (selector) => {
    if (selector === BUTTON_SELECTOR || selector === 'a') return carrier
    return null
  }
  wrapper.contains = (element) => element === carrier

  const loaded = load({
    triggers: [carrier],
    modalTriggers: [wrapper],
    member: { id: VIEWER_ID },
    role: 'brand-paid',
  })
  await settle()

  const event = wrapper.click()
  await settle()

  assert.equal(event.defaultPrevented, true)
  assert.equal(carrier.getAttribute('href'), '/messages?with=' + STARTER_ID)
  assert.equal(loaded.opened.length, 1)
  assert.equal(loaded.calls.mounted.length, 1)
})

test('responsive Message copy inherits the page identity', async () => {
  const carrier = starterTrigger()
  const primary = trigger({ tagName: 'DIV' })
  primary.querySelector = (selector) => {
    if (selector === BUTTON_SELECTOR || selector === 'a') return carrier
    return null
  }
  primary.contains = (element) => element === carrier
  const sticky = trigger({ tagName: 'DIV' })

  const loaded = load({
    triggers: [carrier],
    modalTriggers: [primary, sticky],
    member: { id: VIEWER_ID },
    role: 'brand-paid',
  })
  await settle()

  sticky.click()
  await settle()

  assert.equal(loaded.opened.length, 1)
  assert.equal(loaded.calls.mounted.length, 1)
  assert.equal(
    loaded.warnings.filter((w) => /carry no messages-profile-message/.test(w))
      .length,
    0,
  )
})

test('unwired Message buttons are called out by class name', async () => {
  const unwired = {
    tagName: 'DIV',
    className: 'button_main-wrap',
    hasAttribute: () => false,
    getAttribute: () => null,
    querySelector: () => null,
    closest: () => null,
  }
  const { warnings } = load({
    triggers: [],
    modalTriggers: [unwired],
  })

  const line = warnings.find((w) => /carry no messages-profile-message/.test(w))
  assert.ok(line, 'expected an unwired warning, got: ' + JSON.stringify(warnings))
  assert.match(line, /button_main-wrap/)
})

test('a wired trigger is not reported as unwired', async () => {
  const wired = starterTrigger()
  wired.hasAttribute = (name) => name === MEMBER_ATTRIBUTE
  const { warnings } = load({ triggers: [wired], modalTriggers: [wired] })

  assert.equal(
    warnings.filter((w) => /carry no messages-profile-message/.test(w)).length,
    0,
  )
})

test('a free Brand is redirected to the configured upgrade target', async () => {
  const loaded = load({
    triggers: [starterTrigger()],
    containerAttributes: { [UPGRADE_ATTRIBUTE]: '/pricing' },
    member: { id: VIEWER_ID },
    role: 'brand-free',
  })
  await settle()

  loaded.openModal()
  await settle()

  assert.deepEqual(loaded.navigations, ['/pricing'])
  assert.equal(loaded.calls.mounted.length, 0)
})

test('an upgrade override on the nested carrier is honored, not dropped', async () => {
  // Webflow publishes messages-profile-upgrade onto the clickable_link carrier,
  // the same place the other messages-profile-* attributes land, while the modal
  // trigger is the outer button_main-wrap wrapper.
  const carrier = starterTrigger({ [UPGRADE_ATTRIBUTE]: '/pricing' })
  const wrapper = trigger({ tagName: 'DIV' })
  wrapper.querySelector = (selector) => {
    if (selector === BUTTON_SELECTOR || selector === 'a') return carrier
    return null
  }
  wrapper.contains = (element) => element === carrier

  const loaded = load({
    triggers: [carrier],
    modalTriggers: [wrapper],
    member: { id: VIEWER_ID },
    role: 'brand-free',
  })
  await settle()

  wrapper.click()
  await settle()

  assert.deepEqual(loaded.navigations, ['/pricing'])
  assert.equal(loaded.calls.mounted.length, 0)
})

test('a free Brand click never opens the modal', async () => {
  const element = starterTrigger({ [UPGRADE_ATTRIBUTE]: '/pricing' })
  const loaded = load({
    triggers: [element],
    member: { id: VIEWER_ID },
    role: 'brand-free',
  })
  await settle()

  const event = element.click()

  assert.equal(event.propagationStopped, true)
  assert.deepEqual(loaded.navigations, ['/pricing'])
})

test('a free Brand who finished the quiz goes to /quiz-results', async () => {
  const loaded = load({
    triggers: [starterTrigger()],
    member: { id: VIEWER_ID },
    role: 'brand-free',
    brandFreeHome: '/quiz-results',
  })
  await settle()

  loaded.openModal()
  await settle()

  assert.deepEqual(loaded.navigations, ['/quiz-results'])
  assert.equal(loaded.calls.mounted.length, 0)
  assert.equal(
    loaded.warnings.filter((w) => w.indexOf(UPGRADE_ATTRIBUTE) !== -1).length,
    0,
    'brandFreeHome is the intended default now, not a nagged-about fallback',
  )
})

test('a free Brand who has not finished the quiz goes to /quiz', async () => {
  const loaded = load({
    triggers: [starterTrigger()],
    member: { id: VIEWER_ID },
    role: 'brand-free',
    brandFreeHome: '/quiz',
  })
  await settle()

  loaded.openModal()
  await settle()

  assert.deepEqual(loaded.navigations, ['/quiz'])
})

test('talent gets the modal closed rather than a chat', async () => {
  const loaded = load({
    triggers: [starterTrigger()],
    member: { id: VIEWER_ID },
    role: 'talent',
  })
  await settle()

  loaded.openModal()
  await settle()

  assert.equal(loaded.closed.length, 1)
  assert.equal(loaded.calls.mounted.length, 0)
  assert.deepEqual(loaded.navigations, [], 'talent is closed out, not redirected')
})

test('a starter opening their own profile gets the modal closed', async () => {
  const loaded = load({
    triggers: [starterTrigger()],
    member: { id: STARTER_ID },
    role: 'talent',
  })
  await settle()

  loaded.openModal()
  await settle()

  assert.equal(loaded.closed.length, 1)
  assert.ok(loaded.warnings.some((line) => /self-chat/.test(line)))
})

test('hidden roles also lose the trigger itself', async () => {
  const element = starterTrigger()
  load({ triggers: [element], member: { id: VIEWER_ID }, role: 'brand-free' })

  await settle()

  assert.equal(element.hidden, true)
})

test('an unknown role still gets the chat, since this is not an auth boundary', async () => {
  const loaded = load({
    triggers: [starterTrigger()],
    member: { id: VIEWER_ID },
    guard: false,
  })
  await settle()

  loaded.openModal()
  await settle()

  assert.equal(loaded.calls.mounted.length, 1)
})

/* ============================= failures =========================== */

test('a TalkJS failure renders the /messages escape hatch in the container', async () => {
  const loaded = load({
    triggers: [starterTrigger()],
    member: { id: VIEWER_ID },
    role: 'brand-paid',
    talkFails: true,
  })
  await settle()

  loaded.openModal()
  await settle(40)

  assert.equal(loaded.calls.mounted.length, 0)
  assert.equal(loaded.container.children.length, 1, 'a fallback link was appended')
  assert.ok(loaded.warnings.some((line) => /could not mount the chat/.test(line)))
})

test('a modal with no chat container warns instead of throwing', async () => {
  const loaded = load({
    triggers: [starterTrigger()],
    container: false,
    member: { id: VIEWER_ID },
    role: 'brand-paid',
  })
  await settle()

  loaded.api.openChat()
  await settle()

  assert.ok(loaded.warnings.some((line) => /container to mount into/.test(line)))
})

test('a profile with no usable id closes the modal instead of opening a chat', async () => {
  const loaded = load({
    triggers: [starterTrigger({ [MEMBER_ATTRIBUTE]: '' })],
    member: { id: VIEWER_ID },
    role: 'brand-paid',
  })
  await settle()

  loaded.openModal()
  await settle()

  assert.equal(loaded.calls.mounted.length, 0)
  assert.equal(loaded.closed.length, 1)
})

/* ============================ page gate =========================== */

test('the module ignores triggers outside /hire/<slug>', async () => {
  const element = starterTrigger()
  const { warnings } = load({ triggers: [element], pathname: '/all-starters' })

  assert.equal(element.getAttribute('href'), '/messages', 'href untouched')
  assert.ok(warnings.some((line) => /outside \/hire\//.test(line)))
})

test('no warning fires off /hire when there is no trigger to complain about', async () => {
  const { warnings } = load({ triggers: [], pathname: '/all-starters' })

  assert.deepEqual(warnings, [])
})

test('production is silent', async () => {
  const element = starterTrigger({ [MEMBER_ATTRIBUTE]: '' })
  const { warnings } = load({ triggers: [element], hostname: 'thestarters.com' })

  assert.deepEqual(warnings, [])
  assert.equal(element.hidden, true, 'still hidden, just quietly')
})
