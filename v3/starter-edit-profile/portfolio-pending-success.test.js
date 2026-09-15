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

test('portfolio submit shows instant-live update copy until the shared modal closes', async () => {
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
  let committedCallback = 0

  await context.commitStarterEditPortfolioDrafts({
    createDrafts: [],
    updateDrafts: [{ id: 312 }],
    deleteDraftIds: [],
    commitCreateDraft: async (draft) => committed.push(['create', draft.id]),
    commitUpdateDraft: async (draft) => committed.push(['update', draft.id]),
    commitDeleteDrafts: async () => committed.push(['delete']),
    clearCommittedDrafts() {},
    async renderPortfolios() {},
    successController,
    onCommitted() { committedCallback += 1 },
  })

  assert.deepEqual(committed, [['update', 312], ['delete']])
  assert.equal(committedCallback, 1)
  assert.equal(shownCopy[0].heading, 'Highlight submitted')
  assert.equal(
    shownCopy[0].message,
    'Your changes were saved and are now live.',
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
      deleteDraftIds: [],
      commitCreateDraft: async () => {},
      commitUpdateDraft: async () => {},
      commitDeleteDrafts: async () => {},
      clearCommittedDrafts() {},
      async renderPortfolios() {},
      successController,
    })
  }

  assert.deepEqual(shownCopy, [
    ['Profile updated', 'Your changes are now live.'],
    ['Profile updated', 'Your changes are now live.'],
  ])
})

test('canonical acceptance precedes a failed portfolio refresh', async () => {
  const context = loadController()
  const events = []

  await assert.rejects(context.commitStarterEditPortfolioDrafts({
    createDrafts: [{ id: 'new' }],
    updateDrafts: [],
    deleteDraftIds: ['44'],
    commitCreateDraft: async () => events.push('create'),
    commitUpdateDraft: async () => {},
    commitDeleteDrafts: async (ids) => events.push(['delete', ...ids]),
    clearCommittedDrafts: (creates, updates, deletes) => {
      events.push(['clear', creates[0].id, updates.length, deletes[0]])
    },
    renderPortfolios: async () => { throw new Error('refresh failed') },
    successController: { showForSubmit() {} },
    onCommitted: () => events.push('accepted'),
  }), /refresh failed/)

  assert.deepEqual(events, [
    'create',
    ['delete', '44'],
    ['clear', 'new', 0, '44'],
    'accepted',
  ])
})

test('portfolio save cleanup preserves drafts queued after its snapshot', () => {
  const context = loadController()
  const submittedCreate = { id: 'create-submitted' }
  const laterCreate = { id: 'create-later' }
  const submittedUpdate = { id: 21, title: 'submitted' }
  const laterUpdate = { id: 21, title: 'later' }
  const untouchedUpdate = { id: 22, title: 'untouched' }

  const remaining = context.removeCommittedPortfolioDrafts({
    createDrafts: [submittedCreate, laterCreate],
    updateDrafts: new Map([['21', laterUpdate], ['22', untouchedUpdate]]),
    deleteDraftIds: new Set(['31', '32']),
  }, {
    createDrafts: [submittedCreate],
    updateDrafts: [submittedUpdate],
    deleteDraftIds: ['31'],
  })

  assert.deepEqual(Array.from(remaining.createDrafts), [laterCreate])
  assert.equal(remaining.updateDrafts.size, 2)
  assert.equal(remaining.updateDrafts.get('21'), laterUpdate)
  assert.equal(remaining.updateDrafts.get('22'), untouchedUpdate)
  assert.deepEqual(Array.from(remaining.deleteDraftIds), ['32'])
})

test('portfolio submit guard rejects overlap until the active save finishes', () => {
  const context = loadController()
  const guard = context.createStarterEditPortfolioSubmitGuard()

  assert.equal(guard.begin(), true)
  assert.equal(guard.isActive(), true)
  assert.equal(guard.begin(), false)
  guard.finish()
  assert.equal(guard.begin(), true)
})
