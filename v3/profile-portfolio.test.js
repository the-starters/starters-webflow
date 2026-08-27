'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, 'profile-portfolio.js'), 'utf8')

/**
 * Minimal DOM stub. Only the surface `profile-portfolio.js` touches: attribute
 * lookups, the DOMContentLoaded listener, the card list, and the modal elements
 * it fills. Presentation of the modal belongs to the lumos modal system, so the
 * stub deliberately offers no open/close machinery.
 */
function classList() {
  const values = new Set()
  return {
    add(value) { values.add(value) },
    remove(value) { values.delete(value) },
    has(value) { return values.has(value) },
  }
}

/** A modal media container: emptied with innerHTML, filled with appendChild. */
function mediaContainer() {
  const children = []
  const contentWrapper = { style: {} }
  return {
    children,
    contentWrapper,
    set innerHTML(value) { if (value === '') children.length = 0 },
    get innerHTML() { return '' },
    appendChild(child) {
      children.push(child)
      child.parentNode = this
    },
    removeChild(child) {
      const index = children.indexOf(child)
      if (index > -1) children.splice(index, 1)
    },
    querySelectorAll(selector) {
      return children.filter((child) => child.tag === selector)
    },
    closest(selector) {
      return selector.includes('portfolio_modal-content-wrapper') ? contentWrapper : null
    },
  }
}

/** The authored `[data-highlights-loader]` element the renderer clones. */
function loaderElement() {
  return {
    style: {},
    isLoader: true,
    cloneNode() {
      const clone = {
        style: {},
        isLoader: true,
        parentNode: null,
        remove() {
          if (clone.parentNode) clone.parentNode.removeChild(clone)
        },
      }
      return clone
    },
  }
}

function makeEnv({
  response = [],
  responseOk = true,
  responsePromise,
  memberstackId = 'mem_test_starter',
  imageRows = [],
  videoRows = [],
  imagesOk = true,
  videosOk = true,
  mediaFetch = null,
  hasModalTitle = true,
  hasLoader = true,
  staleModalCopy = false,
  modalOpenAtLoad = false,
  captureTimers = false,
  hasCardList = true,
  modalTarget = 'highlights',
} = {}) {
  const listeners = {}
  const pendingTimers = []
  const requests = []
  const appendedIds = []
  const appendedCards = []
  const errors = []
  const warnings = []

  function addListener(store, type, handler) {
    if (!store[type]) store[type] = []
    store[type].push(handler)
  }

  function dispatchListeners(store, type, event = {}) {
    return Promise.all((store[type] || []).map((handler) => handler(event)))
  }

  function interactiveElement(attributes = {}, classes = []) {
    const elementListeners = {}
    const attrs = { ...attributes }
    return {
      attrs,
      classList: {
        contains(value) { return classes.includes(value) },
      },
      focused: false,
      addEventListener(type, handler) { addListener(elementListeners, type, handler) },
      click(target = this) {
        return dispatchListeners(elementListeners, 'click', {
          target,
          preventDefault() {},
        })
      },
      closest(selector) {
        const attributeMatch = Object.entries(attrs).some(([name, value]) =>
          selector.includes(`[${name}="${value}"]`) || (value === '' && selector.includes(`[${name}]`)),
        )
        const classMatch = classes.some((name) => selector.includes(`.${name}`))
        return attributeMatch || classMatch ? this : null
      },
      focus() { this.focused = true },
    }
  }

  // Same attributes as the real modal children, but OUTSIDE the modal root —
  // stands in for the old hidden modal still present in the published DOM.
  const decoyTitle = { textContent: 'DECOY TITLE' }
  const decoyDescription = { textContent: 'DECOY DESCRIPTION', style: {}, dataset: {} }
  const decoyImages = mediaContainer()
  const decoyVideos = mediaContainer()

  function modalStub({ withTitle = true, withLoader = true, openAtLoad = false } = {}) {
    const parts = {
      title: withTitle ? { textContent: '' } : null,
      description: {
        textContent: '',
        style: {},
        dataset: { fullTextdescription: 'previous case study', expandeddescription: 'true' },
      },
      descriptionToggle: { removed: false, remove() { this.removed = true } },
      images: mediaContainer(),
      videos: mediaContainer(),
      loader: withLoader ? loaderElement() : null,
    }
    const modalListeners = {}
    parts.modal = {
      style: {},
      addEventListener(type, handler) { addListener(modalListeners, type, handler) },
      click(target) {
        return dispatchListeners(modalListeners, 'click', { target, preventDefault() {} })
      },
      // showModal() sets the native open state; the renderer reads it to notice
      // a dialog lumos opened before this script's listeners existed.
      hasAttribute(name) { return name === 'open' && !!openAtLoad },
      getAttribute(name) { return name === 'data-modal-target' ? modalTarget : null },
      querySelector(selector) {
        if (selector === '[portfolio-title]') return parts.title
        if (selector === '[portfolio-description]') return parts.description
        if (selector === '[wf-portfolio-element="images"]') return parts.images
        if (selector === '[wf-portfolio-element="videos"]') return parts.videos
        if (selector === '[data-highlights-loader]') return parts.loader
        if (selector === '[data-toggle-for="description"]') return parts.descriptionToggle
        return null
      },
    }
    // `true` models a real <dialog> (an `open` property); `'attribute'` models a
    // host that only reflects the attribute.
    if (openAtLoad === true) parts.modal.open = true
    return parts
  }

  const live = modalStub({
    withTitle: hasModalTitle,
    withLoader: hasLoader,
    openAtLoad: modalOpenAtLoad,
  })
  // An older non-dialog copy of the modal, earlier in document order, so the
  // plain attribute selector would find it first.
  const stale = staleModalCopy ? modalStub() : null

  const modal = live.modal
  const modalTitle = live.title
  const modalDescription = live.description
  const descriptionToggle = live.descriptionToggle
  const modalImages = live.images
  const modalVideos = live.videos
  const loader = live.loader

  const template = {
    classList: classList(),
    style: {},
    cloneNode() {
      const idBlock = { textContent: '' }
      const thumb = { src: '' }
      const openButton = interactiveElement({ 'wf-portfolio-element': 'open' })
      // A card child that is not the open control — a thumbnail, say. Clicking
      // it must still fill, because the Designer can move data-modal-trigger.
      const otherChild = interactiveElement()
      // An `<a href="#">` open control: the default must be suppressed or the
      // page jumps to the top.
      const anchorControl = interactiveElement({ href: '#' })
      // A legacy-attributed anchor nested inside an attribute-carrying wrapper.
      // closest() finds the inner anchor, never the wrapper.
      const nestedLegacyAnchor = interactiveElement({ 'show-portfolio': '' })
      const cardListeners = {}
      const card = {
        classList: classList(),
        style: {},
        attrs: {},
        defaultPrevented: false,
        openButton,
        otherChild,
        anchorControl,
        nestedLegacyAnchor,
        thumb,
        addEventListener(type, handler) { addListener(cardListeners, type, handler) },
        // Clicks on card children bubble to the card, as they do in a browser.
        click(target = openButton) {
          return dispatchListeners(cardListeners, 'click', {
            target,
            preventDefault() { card.defaultPrevented = true },
          })
        },
        setAttribute(name, value) { this.attrs[name] = value },
        querySelector(selector) {
          if (selector === '.portfolio_card-id') return idBlock
          if (selector === '[wf-portfolio-element="thumb"]') return thumb
          if (selector === '[wf-portfolio-element="open"]') return openButton
          return null
        },
        get portfolioId() { return idBlock.textContent },
      }
      openButton.click = () => card.click(openButton)
      otherChild.click = () => card.click(otherChild)
      anchorControl.click = () => card.click(anchorControl)
      nestedLegacyAnchor.click = () => card.click(nestedLegacyAnchor)
      return card
    },
  }

  const wrapper = {
    attrs: {},
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name)
    },
    setAttribute(name, value) {
      this.attrs[name] = value
    },
    querySelector(selector) {
      if (selector === '[wf-portfolio-element="card"]' || selector === '.portfolio_card') return template
      return null
    },
    querySelectorAll(selector) {
      if (selector === '[data-portfolio-item]') {
        return appendedCards.filter((card) =>
          Object.prototype.hasOwnProperty.call(card.attrs, 'data-portfolio-item'),
        )
      }
      return []
    },
    appendChild(card) {
      appendedCards.push(card)
      appendedIds.push(Number(card.portfolioId))
    },
  }

  const buttonListeners = []
  const viewAllButton = {
    style: {},
    addEventListener(type, handler) {
      if (type === 'click') buttonListeners.push(handler)
    },
    click() {
      const event = { preventDefault() {} }
      buttonListeners.forEach((handler) => handler(event))
    },
  }

  const section = { style: {}, classList: classList() }
  const block = { style: {}, classList: classList() }

  const document = {
    addEventListener(type, handler) {
      addListener(listeners, type, handler)
    },
    dispatch(type, event) {
      return dispatchListeners(listeners, type, event)
    },
    createElement(tag) {
      const element = { tag, className: '', parentNode: null, paused: false }
      if (tag === 'video') element.pause = () => { element.paused = true }
      return element
    },
    querySelector(selector) {
      if (selector === '[data-highlights]' || selector === '.case-studies-wrapper') {
        return hasCardList ? wrapper : null
      }
      if (selector === '[portfolio-section]') return section
      if (selector === '#portfolio-block') return block
      if (selector === '[data-btn-view-all]') return viewAllButton
      if (selector === 'dialog[wf-portfolio-element="modal"]') return modal
      if (selector === '[wf-portfolio-element="modal"]') return (stale || live).modal
      // Document-wide lookups for modal children must never win: these decoys
      // sit outside the modal root and stand in for the stale hidden modal.
      if (selector === '[portfolio-title]') return decoyTitle
      if (selector === '[portfolio-description]') return decoyDescription
      if (selector === '[wf-portfolio-element="images"]') return decoyImages
      if (selector === '[wf-portfolio-element="videos"]') return decoyVideos
      return null
    },
    querySelectorAll(selector) {
      if (selector === 'script:not([src])') {
        return [{ textContent: "const URL = '/api:PmBJV0AG/Get_my_portfolios?memberstack_id='" }]
      }
      return []
    },
    activeElement: null,
    body: { style: {} },
  }

  const windowListeners = {}
  const window = {
    starter_memberstack_id: memberstackId,
    location: { hostname: 'the-starters-3-0.webflow.io' },
    document,
    addEventListener(type, handler) {
      addListener(windowListeners, type, handler)
    },
    // Stands in for the lumos modal system's modal-open / modal-close events.
    dispatch(type, detail) {
      return dispatchListeners(windowListeners, type, { detail })
    },
    fetch(url) {
      requests.push(url)
      if (url.includes('/Get_approved_portfolios?')) {
        return responsePromise || Promise.resolve({ ok: responseOk, json: () => Promise.resolve(response) })
      }
      if (mediaFetch) {
        const controlled = mediaFetch(url)
        if (controlled) return controlled
      }
      if (url.includes('/Get_public_portfolio_images?')) {
        return Promise.resolve({ ok: imagesOk, json: () => Promise.resolve(imageRows) })
      }
      if (url.includes('/Get_public_portfolio_videos?')) {
        return Promise.resolve({ ok: videosOk, json: () => Promise.resolve(videoRows) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    },
  }

  const context = {
    window,
    document,
    console: {
      info() {},
      warn(prefix, message) { warnings.push(message === undefined ? prefix : message) },
      error(message) { errors.push(message) },
    },
    fetch: window.fetch,
    // Held rather than run when the test wants to control when a deferred
    // callback lands relative to other work.
    setTimeout(handler, delay) {
      if (!captureTimers) return setTimeout(handler, delay)
      pendingTimers.push(handler)
      return pendingTimers.length
    },
    Promise,
    encodeURIComponent,
  }
  context.globalThis = context

  vm.createContext(context)
  vm.runInContext(SOURCE, context)

  return {
    document,
    window,
    stale,
    // lumos calls showModal() before dispatching, so the dialog is already open
    // when the event lands. Model both together.
    openLumosModal() {
      live.modal.open = true
      return window.dispatch('modal-open', { modal: live.modal })
    },
    closeLumosModal() {
      live.modal.open = false
      return window.dispatch('modal-close', { modal: live.modal })
    },
    flushTimers() {
      const queued = pendingTimers.splice(0, pendingTimers.length)
      queued.forEach((handler) => handler())
    },
    mediaRequestCount() {
      return requests.filter((url) => url.includes('/Get_public_portfolio_')).length
    },
    wrapper,
    requests,
    appendedIds,
    appendedCards,
    errors,
    warnings,
    section,
    viewAllButton,
    modal,
    modalTitle,
    modalDescription,
    modalImages,
    modalVideos,
    descriptionToggle,
    loader,
    decoyTitle,
    decoyDescription,
    decoyImages,
    decoyVideos,
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

/** Media fetches held open until the test resolves them, keyed by request URL. */
function deferredMedia() {
  const entries = new Map()

  function slot(url) {
    let entry = entries.get(url)
    if (!entry) {
      entry = {}
      entry.promise = new Promise((resolve) => { entry.resolve = resolve })
      entries.set(url, entry)
    }
    return entry
  }

  return {
    fetch(url) {
      if (!url.includes('/Get_public_portfolio_')) return null
      return slot(url).promise
    },
    resolve(match, rows) {
      const url = [...entries.keys()].find((key) => key.includes(match))
      assert.ok(url, `no pending media request matching ${match}`)
      entries.get(url).resolve({ ok: true, json: () => Promise.resolve(rows) })
    },
    pending(match) {
      return [...entries.keys()].some((key) => key.includes(match))
    },
  }
}

test('is the single renderer and reads approved public portfolios only', async () => {
  const env = makeEnv()
  env.document.dispatch('DOMContentLoaded')
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.equal(env.requests.length, 1)
  assert.match(env.requests[0], /\/Get_approved_portfolios\?memberstack_id=mem_test_starter$/)
  assert.equal(
    env.wrapper.hasAttribute('data-portfolio-rendered'),
    true,
    'claims the wrapper so a second CDN run cannot duplicate cards',
  )
})

test('uses the current profile owner identity', async () => {
  const env = makeEnv({ memberstackId: 'mem_dynamic_profile' })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.match(env.requests[0], /memberstack_id=mem_dynamic_profile$/)
})

test('sorts approved rows deterministically before rendering', async () => {
  const rows = [
    { id: 2 },
    { id: 10, ordinal: 2 },
    { id: 1, ordinal: null },
    { id: 7, ordinal: 1 },
  ]
  const forward = makeEnv({ response: rows })
  const reverse = makeEnv({ response: rows.slice().reverse() })
  forward.document.dispatch('DOMContentLoaded')
  reverse.document.dispatch('DOMContentLoaded')
  await settle()

  assert.deepEqual(forward.appendedIds, [7, 10, 1, 2])
  assert.deepEqual(reverse.appendedIds, [7, 10, 1, 2])
})

test('shows three case studies first and reveals all from View all', async () => {
  const env = makeEnv({ response: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.deepEqual(
    env.appendedCards.map((card) => card.style.display),
    ['', '', '', 'none', 'none'],
  )
  assert.equal(env.viewAllButton.style.display, '')

  env.viewAllButton.click()

  assert.deepEqual(env.appendedCards.map((card) => card.style.display), ['', '', '', '', ''])
  assert.equal(env.viewAllButton.style.display, 'none')
})

test('hides View all when the profile has three or fewer case studies', async () => {
  const env = makeEnv({ response: [{ id: 1 }, { id: 2 }, { id: 3 }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.deepEqual(env.appendedCards.map((card) => card.style.display), ['', '', ''])
  assert.equal(env.viewAllButton.style.display, 'none')
})

test('gates View all during a delayed read and ignores an early click', async () => {
  let resolveResponse
  const responsePromise = new Promise((resolve) => { resolveResponse = resolve })
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]
  const env = makeEnv({ responsePromise })

  env.document.dispatch('DOMContentLoaded')

  assert.equal(env.viewAllButton.style.display, 'none')
  env.viewAllButton.click()
  assert.deepEqual(env.appendedCards, [])

  resolveResponse({ ok: true, json: () => Promise.resolve(rows) })
  await settle()

  assert.deepEqual(
    env.appendedCards.map((card) => card.style.display),
    ['', '', '', 'none', 'none'],
  )
  assert.equal(env.viewAllButton.style.display, '')

  env.viewAllButton.click()

  assert.deepEqual(env.appendedCards.map((card) => card.style.display), ['', '', '', '', ''])
  assert.equal(env.viewAllButton.style.display, 'none')
})

test('does not treat a failed public read as an empty portfolio list', async () => {
  const env = makeEnv({ response: { code: 'blocked' }, responseOk: false })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.deepEqual(env.appendedIds, [])
  assert.equal(env.section.classList.has('hidden'), false)
  assert.deepEqual(env.errors, ['Portfolio: approved public read failed'])
})

test('fills only the elements inside the modal root, never a duplicate outside it', async () => {
  const env = makeEnv({
    response: [{ id: 1, title: 'Rebrand for Acme', description: 'Line one\nLine two' }],
    imageRows: [{ image_url: '/vault/one.png' }],
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  await env.appendedCards[0].openButton.click()
  await settle()

  assert.equal(env.modalTitle.textContent, 'Rebrand for Acme')
  assert.equal(env.modalDescription.textContent, 'Line one\nLine two')
  assert.equal(env.modalDescription.style.whiteSpace, 'pre-line')
  assert.equal(env.modalImages.children.length, 1)

  assert.equal(env.decoyTitle.textContent, 'DECOY TITLE')
  assert.equal(env.decoyDescription.textContent, 'DECOY DESCRIPTION')
  assert.deepEqual(env.decoyDescription.style, {})
  assert.equal(env.decoyImages.children.length, 0)
  assert.equal(env.decoyVideos.children.length, 0)
})

test('truncates a very long case-study title', async () => {
  const longTitle = 'x'.repeat(200)
  const env = makeEnv({ response: [{ id: 1, title: longTitle }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  await env.appendedCards[0].openButton.click()
  await settle()

  assert.equal(env.modalTitle.textContent, `${'x'.repeat(150)}...`)
})

test('fills the description without a title element present', async () => {
  const env = makeEnv({
    response: [{ id: 1, title: 'Rebrand for Acme', description: 'The story' }],
    hasModalTitle: false,
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  await env.appendedCards[0].openButton.click()
  await settle()

  assert.equal(env.modalTitle, null)
  assert.equal(env.modalDescription.textContent, 'The story')
})

test('resets the see-more clamp state before writing a new description', async () => {
  const env = makeEnv({ response: [{ id: 1, description: 'Fresh copy' }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  await env.appendedCards[0].openButton.click()
  await settle()

  assert.equal(env.descriptionToggle.removed, true, 'the previous See more control is gone')
  assert.equal(env.modalDescription.dataset.fullTextdescription, undefined)
  assert.equal(env.modalDescription.dataset.expandeddescription, undefined)
  assert.equal(env.modalDescription.textContent, 'Fresh copy')
})

test('shows a loader in both media areas while media loads and clears it on settle', async () => {
  const media = deferredMedia()
  const env = makeEnv({
    response: [{ id: 1, title: 'Rebrand for Acme' }],
    mediaFetch: (url) => media.fetch(url),
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  env.appendedCards[0].openButton.click()
  await settle()

  assert.equal(env.modalImages.children.length, 1)
  assert.equal(env.modalImages.children[0].isLoader, true)
  assert.equal(env.modalVideos.children.length, 1)
  assert.equal(env.modalVideos.children[0].isLoader, true)
  assert.equal(env.loader.style.display, 'none', 'the authored original stays hidden')
  assert.equal(env.modalImages.children[0].style.display, '', 'the clone is visible')

  media.resolve('Get_public_portfolio_images?portfolio_id=1', [{ image_url: '/vault/one.png' }])
  media.resolve('Get_public_portfolio_videos?portfolio_id=1', [{ video_url: '/vault/one.mp4' }])
  await settle()

  assert.deepEqual(env.modalImages.children.map((child) => child.tag), ['img'])
  assert.deepEqual(env.modalVideos.children.map((child) => child.tag), ['video'])
})

test('fills media when the Designer has not authored a loader element', async () => {
  const env = makeEnv({
    response: [{ id: 1, title: 'Rebrand for Acme' }],
    imageRows: [{ image_url: '/vault/one.png' }],
    videoRows: [{ video_url: '/vault/one.mp4' }],
    hasLoader: false,
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  await env.appendedCards[0].openButton.click()
  await settle()

  assert.equal(env.loader, null)
  assert.deepEqual(env.modalImages.children.map((child) => child.tag), ['img'])
  assert.deepEqual(env.modalVideos.children.map((child) => child.tag), ['video'])
  assert.deepEqual(env.errors, [])
})

test('fetches images and videos together rather than one after the other', async () => {
  const media = deferredMedia()
  const env = makeEnv({
    response: [{ id: 1 }],
    mediaFetch: (url) => media.fetch(url),
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  env.appendedCards[0].openButton.click()
  await settle()

  assert.equal(media.pending('Get_public_portfolio_images?portfolio_id=1'), true)
  assert.equal(
    media.pending('Get_public_portfolio_videos?portfolio_id=1'),
    true,
    'the videos read starts without waiting for images',
  )
})

test('never lets a superseded case study overwrite the open one', async () => {
  const media = deferredMedia()
  const env = makeEnv({
    response: [
      { id: 1, title: 'First case study' },
      { id: 2, title: 'Second case study' },
    ],
    mediaFetch: (url) => media.fetch(url),
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  env.appendedCards[0].openButton.click()
  await settle()
  env.appendedCards[1].openButton.click()
  await settle()

  media.resolve('Get_public_portfolio_images?portfolio_id=2', [{ image_url: '/vault/second.png' }])
  media.resolve('Get_public_portfolio_videos?portfolio_id=2', [])
  await settle()

  // The slow first request lands after the visitor already moved on.
  media.resolve('Get_public_portfolio_images?portfolio_id=1', [{ image_url: '/vault/first.png' }])
  media.resolve('Get_public_portfolio_videos?portfolio_id=1', [{ video_url: '/vault/first.mp4' }])
  await settle()

  assert.equal(env.modalTitle.textContent, 'Second case study')
  assert.deepEqual(
    env.modalImages.children.map((child) => child.src),
    ['https://x08a-5ko8-jj1r.n7c.xano.io/vault/second.png?tpl=large'],
  )
  assert.equal(env.modalVideos.children.length, 0)
  assert.equal(env.modalVideos.contentWrapper.style.display, 'none')
})

test('hides the images and videos blocks for a text-only case study', async () => {
  const env = makeEnv({ response: [{ id: 1, title: 'Legacy import', description: 'Text only' }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  await env.appendedCards[0].openButton.click()
  await settle()

  assert.equal(env.modalImages.contentWrapper.style.display, 'none')
  assert.equal(env.modalVideos.contentWrapper.style.display, 'none')
  assert.equal(env.modalImages.children.length, 0, 'the loader clone is gone')
  assert.equal(env.modalVideos.children.length, 0)
})

test('hides a media block and reports it when the read fails', async () => {
  const env = makeEnv({
    response: [{ id: 1 }],
    imageRows: { code: 'ERROR_NOT_FOUND' },
    imagesOk: false,
    videoRows: [{ video_url: '/vault/one.mp4' }],
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  await env.appendedCards[0].openButton.click()
  await settle()

  assert.equal(env.modalImages.children.length, 0)
  assert.equal(env.modalImages.contentWrapper.style.display, 'none')
  assert.deepEqual(env.errors, ['Images error:'])
  assert.deepEqual(env.modalVideos.children.map((child) => child.tag), ['video'])
  assert.equal(env.modalVideos.contentWrapper.style.display, '')
})

test('leaves no earlier media behind when a new case study is opened', async () => {
  const env = makeEnv({
    response: [
      { id: 1, title: 'First' },
      { id: 2, title: 'Second' },
    ],
    imageRows: [{ image_url: '/vault/shared.png' }],
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  await env.appendedCards[0].openButton.click()
  await settle()
  await env.appendedCards[1].openButton.click()
  await settle()

  assert.equal(env.modalImages.children.length, 1, 'the previous case study left nothing behind')
})

test('never writes to the modal element, so lumos keeps control of presentation', async () => {
  const env = makeEnv({
    response: [{ id: 1, title: 'Rebrand for Acme' }],
    imageRows: [{ image_url: '/vault/one.png' }],
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.deepEqual(env.modal.style, {}, 'init leaves the dialog untouched')

  await env.appendedCards[0].openButton.click()
  await settle()
  assert.deepEqual(env.modal.style, {}, 'filling the dialog leaves its style untouched')
  assert.deepEqual(env.document.body.style, {}, 'page scroll locking belongs to lumos')

  // Dismissal is the lumos modal system's job: these must be inert here.
  await env.document.dispatch('keydown', { key: 'Escape', preventDefault() {} })
  await env.modal.click(env.modal)
  await settle()

  assert.deepEqual(env.modal.style, {}, 'close paths are not this script\'s to handle')
  assert.equal(env.modalImages.children.length, 1, 'and they do not clear filled data')
})

test('paints the loading state even after a text-only case study hid the section', async () => {
  const media = deferredMedia()
  const env = makeEnv({
    response: [
      { id: 1, title: 'Text only' },
      { id: 2, title: 'With media' },
    ],
    mediaFetch: (url) => media.fetch(url),
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  env.appendedCards[0].openButton.click()
  await settle()
  media.resolve('Get_public_portfolio_images?portfolio_id=1', [])
  media.resolve('Get_public_portfolio_videos?portfolio_id=1', [])
  await settle()

  assert.equal(env.modalImages.contentWrapper.style.display, 'none')
  assert.equal(env.modalVideos.contentWrapper.style.display, 'none')

  env.appendedCards[1].openButton.click()
  await settle()

  assert.equal(
    env.modalImages.contentWrapper.style.display,
    '',
    'the Images section is visible while its loader shows',
  )
  assert.equal(env.modalImages.children[0].isLoader, true)
  assert.equal(env.modalVideos.contentWrapper.style.display, '')
  assert.equal(env.modalVideos.children[0].isLoader, true)

  media.resolve('Get_public_portfolio_images?portfolio_id=2', [{ image_url: '/vault/two.png' }])
  media.resolve('Get_public_portfolio_videos?portfolio_id=2', [])
  await settle()

  assert.equal(env.modalImages.contentWrapper.style.display, '')
  assert.equal(
    env.modalVideos.contentWrapper.style.display,
    'none',
    'and the section hides again once its empty result lands',
  )
})

test('hides a pending media section when there is no authored loader', async () => {
  const media = deferredMedia()
  const env = makeEnv({
    response: [
      { id: 1, title: 'With media' },
      { id: 2, title: 'Also with media' },
    ],
    hasLoader: false,
    mediaFetch: (url) => media.fetch(url),
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  env.appendedCards[0].openButton.click()
  await settle()
  media.resolve('Get_public_portfolio_images?portfolio_id=1', [{ image_url: '/vault/one.png' }])
  media.resolve('Get_public_portfolio_videos?portfolio_id=1', [{ video_url: '/vault/one.mp4' }])
  await settle()
  assert.equal(env.modalImages.contentWrapper.style.display, '')

  env.appendedCards[1].openButton.click()
  await settle()

  assert.equal(
    env.modalImages.contentWrapper.style.display,
    'none',
    'no loading text means no empty heading either',
  )
  assert.equal(env.modalVideos.contentWrapper.style.display, 'none')

  media.resolve('Get_public_portfolio_images?portfolio_id=2', [{ image_url: '/vault/two.png' }])
  media.resolve('Get_public_portfolio_videos?portfolio_id=2', [])
  await settle()

  assert.equal(env.modalImages.contentWrapper.style.display, '')
  assert.equal(env.modalVideos.contentWrapper.style.display, 'none')
})

test('skips a media row that is missing or whose file field is not a URL', async () => {
  const env = makeEnv({
    response: [{ id: 1, thumbnail_url: { path: '/vault/thumb.png' } }],
    imageRows: [{ image_url: { path: '/vault/one.png', meta: {} } }, null],
    videoRows: [null, { video_url: 42 }],
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.equal(
    env.appendedCards[0].thumb.src,
    'https://cdn.prod.website-files.com/plugins/Basic/assets/placeholder.60f9b1840c.svg',
    'a file object falls back to the placeholder, not "[object Object]?tpl=large"',
  )

  await env.appendedCards[0].openButton.click()
  await settle()

  assert.equal(env.modalImages.children.length, 0)
  assert.equal(env.modalImages.contentWrapper.style.display, 'none')
  assert.equal(env.modalVideos.children.length, 0)
  assert.equal(env.modalVideos.contentWrapper.style.display, 'none')
  assert.deepEqual(env.errors, [], 'a null row or a Xano file object must not throw')
})

test('warns on staging when the modal root is not a dialog lumos manages', async () => {
  const env = makeEnv({ response: [{ id: 1 }], modalTarget: null })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.deepEqual(env.warnings, [
    'modal root has no data-modal-target — lumos will not open this element',
  ])

  await env.appendedCards[0].openButton.click()
  await settle()

  assert.equal(env.warnings.length, 1, 'once at init, not once per fill')
})

test('says nothing about a properly wired modal', async () => {
  const env = makeEnv({ response: [{ id: 1 }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.deepEqual(env.warnings, [])
})

test('fills the native dialog, not a stale copy of the modal earlier in the page', async () => {
  const env = makeEnv({
    response: [{ id: 1, title: 'Rebrand for Acme' }],
    imageRows: [{ image_url: '/vault/one.png' }],
    staleModalCopy: true,
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  await env.appendedCards[0].openButton.click()
  await settle()

  assert.equal(env.modalTitle.textContent, 'Rebrand for Acme')
  assert.equal(env.modalImages.children.length, 1)
  assert.equal(env.stale.title.textContent, '', 'the stale copy is never filled')
  assert.equal(env.stale.images.children.length, 0)
})

test('fills from any click on the card, not only the open control', async () => {
  const env = makeEnv({ response: [{ id: 1, title: 'Rebrand for Acme' }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  await env.appendedCards[0].otherChild.click()
  await settle()

  assert.equal(env.modalTitle.textContent, 'Rebrand for Acme')
  assert.equal(
    env.appendedCards[0].defaultPrevented,
    false,
    'a click that is not on the open control keeps its default behaviour',
  )
})

test('stops an href="#" open control from jumping the page', async () => {
  const env = makeEnv({ response: [{ id: 1, title: 'Rebrand for Acme' }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  await env.appendedCards[0].anchorControl.click()
  await settle()

  assert.equal(env.appendedCards[0].defaultPrevented, true)
  assert.equal(env.modalTitle.textContent, 'Rebrand for Acme')
})

test('stops a legacy anchor nested inside the open control from navigating', async () => {
  const env = makeEnv({ response: [{ id: 1, title: 'Rebrand for Acme' }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  await env.appendedCards[0].nestedLegacyAnchor.click()
  await settle()

  assert.equal(
    env.appendedCards[0].defaultPrevented,
    true,
    'the nearest match is the inner anchor, not the wrapper that carries the attribute',
  )
})

test('suppresses the default for the attribute-carrying open control', async () => {
  const env = makeEnv({ response: [{ id: 1, title: 'Rebrand for Acme' }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  await env.appendedCards[0].openButton.click()
  await settle()

  assert.equal(env.appendedCards[0].defaultPrevented, true)
})

test('touches nothing on a page that has the modal but no Highlights section', async () => {
  const env = makeEnv({ response: [{ id: 1, title: 'First case study' }], hasCardList: false })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.equal(env.loader.style.display, undefined, 'the authored loader is left as designed')

  await env.openLumosModal()
  await settle()

  assert.equal(env.modalTitle.textContent, '', 'and no listener was registered to fill it')
})

test('hides the authored loader before any case study is opened', async () => {
  const env = makeEnv({ response: [{ id: 1 }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.equal(
    env.loader.style.display,
    'none',
    'a deep-linked open must not show loading text with nothing loading',
  )
})

test('fills the first case study when lumos opens the modal without a card click', async () => {
  const env = makeEnv({
    response: [
      { id: 1, title: 'First case study' },
      { id: 2, title: 'Second case study' },
    ],
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()
  assert.equal(env.modalTitle.textContent, '')

  await env.openLumosModal()
  await settle()

  assert.equal(env.modalTitle.textContent, 'First case study')
})

test('does not fill a modal the visitor dismissed while the case studies loaded', async () => {
  let resolveResponse
  const responsePromise = new Promise((resolve) => { resolveResponse = resolve })
  const env = makeEnv({ responsePromise })

  env.document.dispatch('DOMContentLoaded')
  await env.openLumosModal()
  // Escape, before the approved read answers.
  env.modal.open = false

  resolveResponse({ ok: true, json: () => Promise.resolve([{ id: 1, title: 'First case study' }]) })
  await settle()

  assert.equal(env.modalTitle.textContent, '', 'nothing is written into a closed dialog')
  assert.equal(env.mediaRequestCount(), 0, 'and no media is fetched for it')
})

test('lets a card click win over an open event dispatched in the same click', async () => {
  // lumos binds on document; a capture-phase listener would run before the card
  // handler. The deferred default fill must lose either way.
  const env = makeEnv({
    response: [
      { id: 1, title: 'First case study' },
      { id: 2, title: 'Second case study' },
    ],
    captureTimers: true,
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  await env.openLumosModal()
  await env.appendedCards[1].openButton.click()
  await settle()
  env.flushTimers()
  await settle()

  assert.equal(env.modalTitle.textContent, 'Second case study')
  assert.equal(env.mediaRequestCount(), 2, 'exactly one fill, not two')
})

test('fills a modal lumos opened before this script started listening', async () => {
  // The deep-link case on the live page: lumos runs its DOMContentLoaded
  // handler first and dispatches modal-open before our listener exists, so the
  // event never reaches us. Only the dialog's open state gives it away.
  const env = makeEnv({
    response: [
      { id: 1, title: 'First case study' },
      { id: 2, title: 'Second case study' },
    ],
    modalOpenAtLoad: true,
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.equal(env.modalTitle.textContent, 'First case study')
})

test('reads the open state from the attribute when there is no open property', async () => {
  const env = makeEnv({
    response: [{ id: 1, title: 'First case study' }],
    modalOpenAtLoad: 'attribute',
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.equal(env.modal.open, undefined)
  assert.equal(env.modalTitle.textContent, 'First case study')
})

test('does not fill a modal that is closed when the case studies arrive', async () => {
  const env = makeEnv({ response: [{ id: 1, title: 'First case study' }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.equal(env.modalTitle.textContent, '', 'the authored copy is left alone until a card click')
  assert.equal(
    env.requests.filter((url) => url.includes('/Get_public_portfolio_')).length,
    0,
    'and no media is read for a modal nobody opened',
  )
})

test('leaves a card-opened modal alone when the open event arrives', async () => {
  const env = makeEnv({
    response: [
      { id: 1, title: 'First case study' },
      { id: 2, title: 'Second case study' },
    ],
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  await env.appendedCards[1].openButton.click()
  await settle()
  const requestsAfterClick = env.requests.length

  await env.openLumosModal()
  await settle()

  assert.equal(env.modalTitle.textContent, 'Second case study')
  assert.equal(env.requests.length, requestsAfterClick, 'no second round of media reads')
})

test('ignores open and close events belonging to another modal', async () => {
  const env = makeEnv({
    response: [{ id: 1, title: 'First case study' }],
    videoRows: [{ video_url: '/vault/one.mp4' }],
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  await env.window.dispatch('modal-open', { modal: { style: {} } })
  await settle()
  assert.equal(env.modalTitle.textContent, '')

  await env.appendedCards[0].openButton.click()
  await settle()
  await env.window.dispatch('modal-close', { modal: { style: {} } })

  assert.deepEqual(env.modalVideos.children.map((child) => child.paused), [false])
})

test('skips media rows that carry no file and hides the empty section', async () => {
  const env = makeEnv({
    response: [{ id: 1 }],
    imageRows: [{ image_url: '' }],
    videoRows: [{ video_url: null }],
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  await env.appendedCards[0].openButton.click()
  await settle()

  assert.equal(env.modalImages.children.length, 0, 'no element with an empty src')
  assert.equal(env.modalImages.contentWrapper.style.display, 'none')
  assert.equal(env.modalVideos.children.length, 0)
  assert.equal(env.modalVideos.contentWrapper.style.display, 'none')
})

test('asks for the large rendition without breaking an existing query string', async () => {
  const env = makeEnv({
    response: [{ id: 1, thumbnail_url: 'https://cdn.example.com/thumb.png?v=2' }],
    imageRows: [{ image_url: 'https://cdn.example.com/one.png?signature=abc' }],
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.equal(env.appendedCards[0].thumb.src, 'https://cdn.example.com/thumb.png?v=2&tpl=large')

  await env.appendedCards[0].openButton.click()
  await settle()

  assert.equal(
    env.modalImages.children[0].src,
    'https://cdn.example.com/one.png?signature=abc&tpl=large',
  )
})

test('pauses modal videos when lumos closes the modal', async () => {
  const env = makeEnv({
    response: [{ id: 1 }],
    videoRows: [{ video_url: '/vault/one.mp4' }, { video_url: '/vault/two.mp4' }],
  })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  await env.appendedCards[0].openButton.click()
  await settle()
  assert.deepEqual(env.modalVideos.children.map((child) => child.paused), [false, false])

  await env.window.dispatch('modal-close', { modal: env.modal })

  assert.deepEqual(env.modalVideos.children.map((child) => child.paused), [true, true])
})
