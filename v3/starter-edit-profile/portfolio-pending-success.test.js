const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'portfolio-crud.js'), 'utf8')

function loadController() {
  const context = vm.createContext({
    console,
    document: { addEventListener() {} },
    Event: class Event {
      constructor(type, options = {}) {
        this.type = type
        this.bubbles = Boolean(options.bubbles)
      }
    },
  })
  new vm.Script(source, { filename: 'portfolio-crud.js' }).runInContext(context)
  return context
}

function createEventTarget() {
  const listeners = new Map()
  return {
    addEventListener(type, listener) {
      const typeListeners = listeners.get(type) || []
      typeListeners.push(listener)
      listeners.set(type, typeListeners)
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event)
    },
  }
}

test('portfolio submit shows pending update copy until the shared modal closes', async () => {
  const context = loadController()
  const modal = createEventTarget()
  const closeEventTarget = createEventTarget()
  const heading = { textContent: 'Profile updated' }
  const message = { textContent: 'Your changes are now live.' }
  const shownCopy = []
  const trigger = {
    dispatchEvent() {
      shownCopy.push({ heading: heading.textContent, message: message.textContent })
    },
  }
  const successController = context.createStarterEditPortfolioSuccessController({
    modal,
    heading,
    message,
    trigger,
    closeEventTarget,
  })
  const committed = []

  await context.commitStarterEditPortfolioDrafts({
    createDrafts: [],
    updateDrafts: [{ id: 312 }],
    commitCreateDraft: async (draft) => committed.push(['create', draft.id]),
    commitUpdateDraft: async (draft) => committed.push(['update', draft.id]),
    commitDeleteDrafts: async () => committed.push(['delete']),
    clearAllDraftQueues() {},
    async renderPortfolios() {},
    successController,
  })

  assert.deepEqual(committed, [['update', 312], ['delete']])
  assert.equal(shownCopy[0].heading, 'Highlight submitted')
  assert.equal(
    shownCopy[0].message,
    'Your changes were saved and sent for review. Your currently approved highlight stays live until the update is approved.',
  )
  modal.dispatchEvent({ type: 'click' })
  assert.equal(heading.textContent, 'Highlight submitted')

  closeEventTarget.dispatchEvent({ type: 'modal-close', detail: { modal } })
  assert.equal(heading.textContent, 'Profile updated')
  assert.equal(message.textContent, 'Your changes are now live.')

  successController.showForSubmit(0)
  assert.deepEqual(shownCopy[1], {
    heading: 'Profile updated',
    message: 'Your changes are now live.',
  })
})

test('create and delete-only submits keep the shared generic copy', async () => {
  const context = loadController()
  const shownCopy = []
  const heading = { textContent: 'Profile updated' }
  const message = { textContent: 'Your changes are now live.' }
  const successController = context.createStarterEditPortfolioSuccessController({
    modal: createEventTarget(),
    heading,
    message,
    trigger: { dispatchEvent: () => shownCopy.push([heading.textContent, message.textContent]) },
    closeEventTarget: createEventTarget(),
  })

  for (const drafts of [
    { createDrafts: [{ id: 'new' }], updateDrafts: [] },
    { createDrafts: [], updateDrafts: [] },
  ]) {
    await context.commitStarterEditPortfolioDrafts({
      ...drafts,
      commitCreateDraft: async () => {},
      commitUpdateDraft: async () => {},
      commitDeleteDrafts: async () => {},
      clearAllDraftQueues() {},
      async renderPortfolios() {},
      successController,
    })
  }

  assert.deepEqual(shownCopy, [
    ['Profile updated', 'Your changes are now live.'],
    ['Profile updated', 'Your changes are now live.'],
  ])
})
