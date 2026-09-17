const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const test = require('node:test')
const { h, makeEvent } = require('../test-helpers/form-dom.cjs')
const { deferred } = require('../test-helpers/edit-profile-controller.cjs')
const tick = () => new Promise(resolve => setImmediate(resolve))
// `fail` returns 'lose' for a lost response, or { status, body } for a received refusal.
// `hold` returns a promise the fake endpoint waits on, so a save can be observed mid-flight.
// `stale` answers the canonical list read from a replica that has not caught up with the
// writes already acknowledged, which is what a lagging read looks like to the section.
async function mount({ portfolios = [], fail = null, required = false, hold = null, stray = false, presence = false, xanoRequired = false, rows = true, saveControl = true, stale = null } = {}) {
  const fields = ['title', 'description', 'images', 'videos'].map(key => h(key === 'description' ? 'textarea' : 'input', {
    'profile-highlight-field': key, name: key, id: key,
    ...(['images', 'videos'].includes(key) ? { type: 'file', multiple: '' } : {}),
    ...(required && ['title', 'images'].includes(key) ? { required: '' } : {}),
    ...(xanoRequired && key === 'description' ? { 'form-xano-required': '', ...(xanoRequired === 'paired' ? { required: '' } : {}) } : {}),
  }))
  const row = h('div', { 'profile-item-row': '' }, [
    h('button', { type: 'button', 'profile-item-toggle': '' }, [h('span', { 'profile-items-summary': '' })]),
    h('div', { 'profile-item-content': '' }, [...fields, h('div', { 'profile-items-media': 'images' }), h('div', { 'profile-items-media': 'videos' }),
      ...(stray ? [h('input', { name: 'stray-in-row', maxlength: '2' })] : [])]),
    h('button', { type: 'button', 'profile-item-remove': '' }),
  ])
  const save = h('button', { 'data-edit-submit': 'portfolio' })
  const add = h('button', { 'profile-items-add': '' })
  const discard = h('button', { 'profile-items-discard': '' })
  const marker = h('input', { 'profile-items-presence': '', name: 'first-portfolio', ...(presence ? { required: '' } : {}) })
  const strayOutside = h('input', { name: 'stray-outside', required: '' })
  const section = h('section', { 'profile-unified-items': 'highlights' }, [h('div', {}, rows ? [row] : []),
    ...(saveControl ? [save] : []), add, discard,
    ...(presence ? [marker] : []), ...(stray ? [strayOutside] : [])])
  let stored = structuredClone(portfolios)
  let nextId = 100, nextAsset = 1, boot
  const requests = [], readyHandlers = [], warnings = [], revoked = []
  const context = vm.createContext({
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
    document: { readyState: 'loading', createElement: tag => h(tag), addEventListener(type, callback) { if (type === 'DOMContentLoaded') readyHandlers.push(callback) } },
    MEMBER: { id: 'test-member' }, waitForMember(callback) { boot = callback() },
    qs: (selector, scope) => scope ? scope.querySelector(selector) : selector === '[profile-unified-items="highlights"]' ? section : section.querySelector(selector),
    qsa: (selector, scope = section) => scope.querySelectorAll(selector),
    Event: class { constructor(type, options) { Object.assign(this, makeEvent(type, null, options)) } },
    URL: { createObjectURL: file => 'blob:' + file.name, revokeObjectURL: value => revoked.push(value) },
    FormData: class { constructor() { this.entries = {} } append(key, value) { this.entries[key] = value } },
    console: { warn: (...args) => warnings.push(args), error() {}, log() {} },
    fetch: async (url, init = {}) => {
      const endpoint = url.split('/').at(-1).split('?')[0]
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body?.entries
      const request = { endpoint, method: init.method || 'GET', body }
      requests.push(request)
      const outcome = fail?.(request, stored)
      if (outcome === 'lose') throw new Error('Response lost')
      if (outcome && typeof outcome === 'object') {
        return { ok: false, status: outcome.status || 400, json: async () => outcome.body || {} }
      }
      const held = hold?.(request)
      if (held) await held
      let value
      const id = Number(new globalThis.URL(url).searchParams.get('portfolio_id'))
      if (endpoint === 'Get_my_portfolios') value = (stale?.(stored) || stored).map(({ images, videos, ...row }) => row)
      else if (endpoint === 'Get_portfolio_images') value = stored.find(row => row.id === id)?.images || []
      else if (endpoint === 'Get_portfolio_videos') value = stored.find(row => row.id === id)?.videos || []
      else if (endpoint.startsWith('upload-')) value = { path: '/uploads/' + nextAsset++, size: (body.image || body.video).size }
      else if (endpoint === 'Create_portfolio') { value = { ...body, id: nextId++, images: [], videos: [] }; stored.push(value) }
      else if (endpoint === 'Update_portfolio') {
        value = stored.find(row => row.id === Number(body.id)); Object.assign(value, body)
        value.images.forEach(image => { image.is_cover = image.id === body.cover_image_id })
      } else if (endpoint === 'Delete_portfolio') { stored = stored.filter(row => row.id !== Number(body.id)); value = { success: true } }
      else if (endpoint.startsWith('Add_portfolio_')) {
        const kind = endpoint.endsWith('image') ? 'images' : 'videos'
        value = { ...body, id: nextId++ }; stored.find(row => row.id === body.portfolio_id)[kind].push(value)
      } else if (endpoint.startsWith('Delete_portfolio_')) {
        const kind = endpoint.endsWith('image') ? 'images' : 'videos'
        stored.forEach(row => { row[kind] = row[kind].filter(item => item.id !== (body.image_id || body.video_id)) }); value = true
      }
      return { ok: true, json: async () => structuredClone(value) }
    },
  })
  for (const file of ['profile-section-validation.js', 'unified-highlights.js', 'portfolio-crud.js']) {
    vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context, { filename: file })
  }
  readyHandlers.forEach(callback => callback()); await boot
  const click = element => element.dispatchEvent(makeEvent('click', element, { bubbles: true }))
  const field = (key, index = 0) => section.querySelectorAll('[profile-item-row]')[index].querySelector('[profile-highlight-field="' + key + '"]')
  return { section, save, add, discard, click, field, requests, warnings, marker, strayOutside, context, revoked,
    media: (kind, index = 0) => section.querySelectorAll('[profile-items-media="' + kind + '"]')[index]
      .querySelectorAll('[profile-media-item]'),
    mutations: () => requests.filter(request => request.method !== 'GET'),
    type(key, value, index = 0) { const target = field(key, index); target.value = value; target.dispatchEvent(makeEvent('input', target, { bubbles: true })) },
    files(kind, files, index = 0) { const target = field(kind, index); target.files = files; target.dispatchEvent(makeEvent('change', target, { bubbles: true })) },
    status: () => section.querySelector('[profile-items-status]').textContent,
    async submit() { click(save); await tick() },
  }
}

test('Highlights Save includes an open optional-media row through the existing portfolio writer', async () => {
  const page = await mount()
  page.type('title', 'Campaign')
  await page.submit()
  assert.equal(page.mutations()[0].endpoint, 'Create_portfolio')
  assert.equal(page.mutations()[0].body.title, 'Campaign')
  assert.equal(page.status(), 'Changes saved.')
})

test('Highlight Add preserves selected files, makes no writes, and Save collects both rows', async () => {
  const page = await mount()
  page.type('title', 'First')
  page.files('images', [{ name: 'image.png', type: 'image/png', size: 1000 }])
  page.click(page.add)
  assert.equal(page.mutations().length, 0)
  assert.equal(page.section.querySelectorAll('[profile-item-row]').length, 2)
  page.type('title', 'Second', 1)
  await page.submit()
  assert.equal(page.mutations().filter(request => request.endpoint === 'Create_portfolio').length, 2)
  assert.equal(page.mutations().filter(request => request.endpoint === 'upload-image').length, 1)
  assert.equal(page.mutations().find(request => request.endpoint === 'Add_portfolio_image').body.image.size, 1000)
})

test('authored Required and file limits validate started highlights while retained photos satisfy presence', async () => {
  const page = await mount({ required: true })
  page.type('title', 'Campaign')
  await page.submit()
  assert.equal(page.field('images').getAttribute('aria-invalid'), 'true')
  page.files('images', [{ name: 'too-large.png', type: 'image/png', size: 4 * 1024 * 1024 + 1 }])
  await page.submit()
  assert.equal(page.mutations().length, 0)
  const retained = await mount({ required: true, portfolios: [{ id: 1, title: 'Saved', description: '', images: [{ id: 2, image_url: 'https://example.test/photo.png', is_cover: true, image: { size: 1000 } }], videos: [] }] })
  retained.type('title', 'Changed')
  await retained.submit()
  assert.equal(retained.mutations().filter(request => request.endpoint.startsWith('upload-')).length, 0)
  assert.equal(retained.mutations()[0].endpoint, 'Update_portfolio')
})

test('an unknown media attachment keeps selected files and confirmed uploads without replaying the queue', async () => {
  const page = await mount({ fail: request => request.endpoint === 'Add_portfolio_image' ? 'lose' : null })
  page.type('title', 'Campaign'); page.files('images', [{ name: 'photo.png', type: 'image/png', size: 1000 }])
  await page.submit()
  assert.match(page.status(), /could not be confirmed/)
  const count = page.mutations().length
  await page.submit()
  assert.equal(page.mutations().length, count)
  assert.equal(page.section.querySelectorAll('[profile-media-item]').length, 1)
})

test('Highlight removal is pending, Undo keeps files, and Discard restores the confirmed record', async () => {
  const page = await mount({ portfolios: [{ id: 1, title: 'Saved', description: '', images: [], videos: [] }] })
  page.type('title', 'Changed')
  page.files('images', [{ name: 'draft.png', type: 'image/png', size: 100 }])
  page.click(page.section.querySelector('[profile-item-remove]'))
  page.click(page.section.querySelector('[profile-items-undo]'))
  assert.equal(page.section.querySelectorAll('[profile-media-item]').length, 1)
  assert.equal(page.mutations().length, 0)
  page.click(page.discard)
  assert.equal(page.field('title').value, 'Saved')
  assert.equal(page.section.querySelectorAll('[profile-media-item]').length, 0)
})

test('Highlight media counts and cover changes include retained photos and selected files', async () => {
  const page = await mount({ portfolios: [{ id: 1, title: 'Saved', description: '', cover_image_id: 2, thumbnail_url: 'https://example.test/a.png',
    images: [{ id: 2, image_url: 'https://example.test/a.png', is_cover: true }, { id: 3, image_url: 'https://example.test/b.png', is_cover: false }], videos: [] }] })
  page.files('images', Array.from({ length: 4 }, (_, index) => ({ name: index + '.png', type: 'image/png', size: 100 })))
  await page.submit()
  assert.equal(page.mutations().length, 0)
  assert.equal(page.field('images').getAttribute('aria-invalid'), 'true')
  page.click(page.section.querySelectorAll('[profile-media-remove]')[5])
  page.click(page.section.querySelectorAll('[profile-media-cover]')[1])
  await page.submit()
  assert.equal(page.status(), 'Changes saved.')
  const update = page.mutations().find(request => request.endpoint === 'Update_portfolio')
  assert.equal(update.body.cover_image_id, 3)
  assert.equal(page.mutations().filter(request => request.endpoint === 'upload-image').length, 3)
})

test('a delayed media attachment can be checked, then the remaining save avoids repeating confirmed work', async () => {
  let delayed = null, canonicalRows
  const page = await mount({ fail: (request, stored) => {
    canonicalRows = stored
    if (request.endpoint === 'Add_portfolio_image' && !delayed) { delayed = request.body; return 'lose' }
  } })
  page.type('title', 'Campaign'); page.files('images', [{ name: 'photo.png', type: 'image/png', size: 1000 }])
  await page.submit()
  canonicalRows[0].images.push({ ...delayed, id: 200 })
  page.click(page.section.querySelector('[profile-items-check-save]')); await tick()
  assert.match(page.status(), /That change is confirmed/)
  await page.submit()
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.mutations().filter(request => request.endpoint === 'Create_portfolio').length, 1)
  assert.equal(page.mutations().filter(request => request.endpoint === 'upload-image').length, 1)
  assert.equal(page.mutations().filter(request => request.endpoint === 'Add_portfolio_image').length, 1)
})

test('a lost upload response pauses Save and offers a check instead of a blind retry', async () => {
  const page = await mount({ fail: request => request.endpoint === 'upload-image' ? 'lose' : null })
  page.type('title', 'Campaign'); page.files('images', [{ name: 'photo.png', type: 'image/png', size: 1000 }])
  await page.submit()
  assert.equal(page.section.querySelector('[profile-items-check-save]').hidden, false)
  await page.submit()
  assert.equal(page.mutations().filter(request => request.endpoint === 'upload-image').length, 1)
  assert.match(page.status(), /could not be confirmed/)
  assert.equal(page.section.querySelectorAll('[profile-media-item]').length, 1)
})

test('nine Highlights cap Add; an explicit pending deletion makes room before a replacement', async () => {
  const page = await mount({ portfolios: Array.from({ length: 9 }, (_, index) => ({ id: index + 1, title: 'Saved ' + index, description: '', images: [], videos: [] })) })
  page.click(page.add)
  assert.equal(page.section.querySelectorAll('[profile-item-row]').length, 9)
  page.click(page.section.querySelector('[profile-item-remove]')); page.click(page.add)
  page.type('title', 'Replacement', 9)
  await page.submit()
  assert.equal(page.mutations()[0].endpoint, 'Delete_portfolio')
  assert.equal(page.mutations()[1].endpoint, 'Create_portfolio')
  assert.equal(page.section.querySelectorAll('[profile-item-row]').length, 9)
})

test('a Highlight video is held to the 40 MB the portfolio endpoint accepts', async () => {
  const page = await mount()
  page.type('title', 'Campaign')
  page.files('videos', [{ name: 'over.mp4', type: 'video/mp4', size: 40 * 1024 * 1024 + 1 }])
  await page.submit()
  assert.equal(page.mutations().length, 0)
  assert.equal(page.field('videos').getAttribute('aria-invalid'), 'true')
  assert.equal(page.section.querySelector('[profile-validation-error]').textContent, 'Each video must be 40 MB or smaller.')
  page.click(page.section.querySelector('[profile-media-remove]'))
  page.files('videos', [{ name: 'fits.mp4', type: 'video/mp4', size: 40 * 1024 * 1024 }])
  await page.submit()
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.mutations().filter(request => request.endpoint === 'upload-video').length, 1)
})

test('a duplicate Save click while a Highlight write is in flight creates one record', async () => {
  const gate = deferred()
  const page = await mount({ hold: request => request.endpoint === 'Create_portfolio' ? gate.promise : null })
  page.type('title', 'Campaign')
  const first = page.submit()
  const second = page.submit()
  await tick()
  assert.equal(page.section.inert, true)
  assert.equal(page.status(), 'Creating highlight…')
  assert.equal(page.mutations().filter(request => request.endpoint === 'Create_portfolio').length, 1)
  gate.resolve()
  await Promise.all([first, second])
  await tick()
  assert.equal(page.mutations().filter(request => request.endpoint === 'Create_portfolio').length, 1)
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.section.inert, false)
})

test('a refused highlight write reports the server answer and leaves Save and Discard usable', async () => {
  let refuse = true
  const page = await mount({ fail: request => request.endpoint === 'Create_portfolio' && refuse ? { status: 400, body: { message: 'That title is already used.' } } : null })
  page.type('title', 'Campaign')
  await page.submit()
  assert.equal(page.status(), 'That title is already used.')
  assert.equal(page.section.querySelector('[profile-items-check-save]').hidden, true)
  assert.equal(page.field('title').value, 'Campaign')
  assert.equal(page.section.inert, false)
  refuse = false
  await page.submit()
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.mutations().filter(request => request.endpoint === 'Create_portfolio').length, 2)
  const silent = await mount({ fail: request => request.endpoint === 'Create_portfolio' ? { status: 422, body: {} } : null })
  silent.type('title', 'Campaign')
  await silent.submit()
  assert.equal(silent.status(), 'The server rejected this change. Check the entry and try again.')
  silent.click(silent.discard)
  assert.equal(silent.status(), 'Changes discarded.')
})

test('a refused media upload keeps the files and does not pause Save as unconfirmed', async () => {
  let refuse = true
  const page = await mount({ fail: request => request.endpoint === 'upload-video' && refuse ? { status: 413, body: { message: 'That video is too large.' } } : null })
  page.type('title', 'Campaign')
  page.files('videos', [{ name: 'clip.mp4', type: 'video/mp4', size: 1000 }])
  await page.submit()
  assert.equal(page.status(), 'That video is too large.')
  assert.equal(page.section.querySelector('[profile-items-check-save]').hidden, true)
  assert.equal(page.section.querySelectorAll('[profile-media-item]').length, 1)
  refuse = false
  await page.submit()
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.mutations().filter(request => request.endpoint === 'Create_portfolio').length, 1)
  assert.equal(page.mutations().filter(request => request.endpoint === 'upload-video').length, 2)
})

test('authored Required and maxlength outside a Highlight record cannot block Add or Save', async () => {
  const page = await mount({ stray: true })
  const inRow = page.section.querySelector('[name="stray-in-row"]')
  inRow.value = 'far longer than the authored maximum'
  page.type('title', 'Campaign')
  page.click(page.add)
  assert.equal(page.section.querySelectorAll('[profile-item-row]').length, 2, 'the stray control does not block Add')
  assert.equal(inRow.getAttribute('aria-invalid'), 'false')
  assert.equal(page.section.querySelector('[profile-validation-error]'), null)
  await page.submit()
  // The blank Required control beside the rows would stop Save if it were in scope.
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.mutations()[0].endpoint, 'Create_portfolio')
  assert.equal(page.strayOutside.value, '')
})

test('an authored presence requirement refuses an empty section with its own message', async () => {
  const page = await mount({ presence: true })
  await page.submit()
  assert.equal(page.mutations().length, 0)
  assert.equal(page.status(), 'Add at least one highlight.')
  assert.equal(page.marker.getAttribute('aria-invalid'), 'false')
  page.type('title', 'Campaign')
  await page.submit()
  assert.equal(page.status(), 'Changes saved.')
})

test('form-xano-required without Required pauses Save, names the field once, and still allows Discard', async () => {
  const page = await mount({ xanoRequired: true })
  assert.equal(page.status(), 'This form is misconfigured. Saving is paused until it is fixed.')
  assert.equal(page.warnings.length, 1)
  assert.equal(page.warnings[0][0], '[unified-highlights] form-xano-required without required:')
  assert.deepEqual(Array.from(page.warnings[0][1]), ['description'])
  page.type('title', 'Campaign')
  assert.equal(page.status(), 'This form is misconfigured. Saving is paused until it is fixed.')
  await page.submit()
  assert.equal(page.mutations().length, 0)
  assert.equal(page.field('description').getAttribute('aria-invalid'), null, 'the backend contract never becomes a Required field')
  assert.equal(page.warnings.length, 1)
  page.click(page.discard)
  assert.equal(page.status(), 'Changes discarded.')
  assert.equal(page.field('title').value, '')
  const paired = await mount({ xanoRequired: 'paired' })
  assert.equal(paired.status(), '')
  paired.type('title', 'Campaign')
  paired.type('description', 'What the work covered')
  await paired.submit()
  assert.equal(paired.status(), 'Changes saved.')
  assert.equal(paired.warnings.length, 0)
})

test('a Highlights section authored without a row or Save control fails closed instead of staying live', async () => {
  const withoutRow = await mount({ rows: false })
  assert.equal(withoutRow.status(), 'This section could not load. Reload the page before editing.')
  assert.equal(withoutRow.warnings.length, 1)
  assert.equal(withoutRow.warnings[0][0], '[unified-highlights] missing [profile-item-row] or Save control in section')
  assert.equal(withoutRow.save.getAttribute('disabled'), '')
  await withoutRow.submit()
  assert.equal(withoutRow.requests.length, 0, 'a section with no template never reads or writes')

  const withoutSave = await mount({ saveControl: false })
  assert.equal(withoutSave.status(), 'This section could not load. Reload the page before editing.')
  assert.equal(withoutSave.warnings.length, 1)
  assert.equal(withoutSave.requests.length, 0)
})

test('a Highlights section that cannot load stays readable while Save is refused', async () => {
  const page = await mount({ fail: request => request.endpoint === 'Get_my_portfolios' ? 'lose' : null })
  const message = 'Highlights could not be loaded. Save is paused to protect existing entries.'
  assert.equal(page.status(), message)
  assert.equal(page.section.inert, false, 'the Starter can still read and select the section')
  assert.equal(page.section.getAttribute('aria-busy'), null)
  await page.submit()
  assert.equal(page.mutations().length, 0)
  assert.equal(page.status(), message)
})

test('the presence message opens a usable row when the only entry is pending removal', async () => {
  const page = await mount({ presence: true, portfolios: [{ id: 1, title: 'Saved', description: '', images: [], videos: [] }] })
  page.click(page.section.querySelector('[profile-item-remove]'))
  await page.submit()
  assert.equal(page.status(), 'Add at least one highlight.')
  assert.equal(page.mutations().length, 0)
  const rows = page.section.querySelectorAll('[profile-item-row]')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].querySelector('[profile-item-content]').hidden, true, 'the row pending removal stays closed')
  assert.equal(rows[0].querySelector('[profile-highlight-field="title"]').focusCalls.length, 0)
  assert.equal(rows[1].querySelector('[profile-item-content]').hidden, false)
  assert.ok(rows[1].querySelector('[profile-highlight-field="title"]').focusCalls.length > 0)
})

test('a lost upload response that did land is confirmed from the canonical media and not repeated', async () => {
  let lose = true, storedRows
  const page = await mount({ fail: (request, stored) => {
    storedRows = stored
    if (request.endpoint === 'upload-image' && lose) { lose = false; return 'lose' }
  } })
  page.type('title', 'Campaign')
  page.files('images', [{ name: 'photo.png', type: 'image/png', size: 1000 }])
  await page.submit()
  assert.equal(page.section.querySelector('[profile-items-check-save]').hidden, false)
  // The upload and its attachment landed after the response was lost.
  storedRows[0].images.push({ id: 200, image: { name: 'photo.png', size: 1000 }, image_url: 'https://example.test/photo.png', is_cover: false })
  page.click(page.section.querySelector('[profile-items-check-save]')); await tick()
  assert.match(page.status(), /That change is confirmed/)
  await page.submit()
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.mutations().filter(request => request.endpoint === 'upload-image').length, 1, 'the confirmed upload is not repeated')
  assert.equal(page.mutations().filter(request => request.endpoint === 'Add_portfolio_image').length, 0, 'the attached photo is not added twice')
  assert.equal(page.mutations().find(request => request.endpoint === 'Update_portfolio').body.cover_image_id, 200)
})

test('a lost upload response that never attached leaves the file as a draft and releases Save', async () => {
  let lose = true
  const page = await mount({ fail: request => request.endpoint === 'upload-image' && lose ? 'lose' : null })
  page.type('title', 'Campaign')
  page.files('images', [{ name: 'photo.png', type: 'image/png', size: 1000 }])
  await page.submit()
  assert.equal(page.section.querySelector('[profile-items-check-save]').hidden, false)
  page.click(page.section.querySelector('[profile-items-check-save]')); await tick()
  assert.equal(page.section.querySelector('[profile-items-check-save]').hidden, true)
  assert.equal(page.section.querySelectorAll('[profile-media-item]').length, 1, 'the selected file is still held')
  lose = false
  await page.submit()
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.mutations().filter(request => request.endpoint === 'upload-image').length, 2, 'nothing was attached, so the file is uploaded again')
  assert.equal(page.mutations().filter(request => request.endpoint === 'Add_portfolio_image').length, 1)
  assert.equal(page.mutations().filter(request => request.endpoint === 'Create_portfolio').length, 1)
})

test('a confirmed media deletion cannot be undone into an empty upload after a later failure', async () => {
  let refuse = true
  const page = await mount({
    portfolios: [{ id: 1, title: 'Saved', description: '', cover_image_id: 2, thumbnail_url: 'https://example.test/a.png', images: [
      { id: 2, image_url: 'https://example.test/a.png', is_cover: true, image: { name: 'a.png', size: 100 } },
      { id: 3, image_url: 'https://example.test/b.png', is_cover: false, image: { name: 'b.png', size: 100 } }], videos: [] }],
    fail: request => request.endpoint === 'Update_portfolio' && refuse ? { status: 400, body: { message: 'Those details were refused.' } } : null,
  })
  page.click(page.section.querySelectorAll('[profile-media-remove]')[0])
  page.files('images', [{ name: 'new.png', type: 'image/png', size: 500 }])
  await page.submit()
  assert.equal(page.status(), 'Those details were refused.')
  assert.equal(page.mutations().filter(request => request.endpoint === 'Delete_portfolio_image').length, 1)
  assert.equal(page.section.querySelectorAll('[profile-media-undo]').length, 0, 'the deleted photo offers no Undo')
  assert.equal(page.section.querySelectorAll('[profile-media-item]').length, 2)
  refuse = false
  await page.submit()
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.mutations().filter(request => request.endpoint === 'upload-image').length, 1, 'the deleted photo is never uploaded')
  assert.equal(page.mutations().filter(request => request.endpoint === 'Delete_portfolio_image').length, 1)
})

test('a failed canonical read after a successful write keeps the unconfirmed path, not a refusal', async () => {
  // The update is answered 2xx, then the read that would confirm it fails. A read nobody could
  // make settles nothing, so the outcome stays unknown instead of reading as a refusal.
  let written = false
  const page = await mount({
    portfolios: [{ id: 1, title: 'Saved', description: '', images: [], videos: [] }],
    fail: request => {
      if (request.endpoint === 'Update_portfolio') { written = true; return null }
      return written && request.endpoint === 'Get_portfolio_images'
        ? { status: 503, body: { message: 'Service unavailable' } } : null
    },
  })
  page.type('title', 'Renamed')
  await page.submit()
  assert.match(page.status(), /could not be confirmed/)
  assert.equal(page.section.querySelector('[profile-items-check-save]').hidden, false)
  assert.equal(page.mutations().filter(request => request.endpoint === 'Update_portfolio').length, 1)
  await page.submit()
  assert.equal(page.mutations().filter(request => request.endpoint === 'Update_portfolio').length, 1, 'Save stays paused rather than replaying the write')
})

test('a confirmed attachment renders from the stored file and frees the local one', async () => {
  // The second row is refused, so the save ends without the reset that Discard-style restore
  // would do. The first row's confirmed photo must already be living off its stored URL.
  const page = await mount({
    fail: request => request.endpoint === 'Create_portfolio' && request.body.title === 'Second'
      ? { status: 400, body: { message: 'That title is taken' } } : null,
  })
  page.type('title', 'First')
  page.files('images', [{ name: 'photo.png', type: 'image/png', size: 1000 }])
  page.click(page.add)
  page.type('title', 'Second', 1)
  await page.submit()
  assert.equal(page.status(), 'That title is taken')
  assert.deepEqual(page.revoked, ['blob:photo.png'], 'the object URL is released once the file is stored')
  const entry = page.media('images')[0]
  const source = entry.querySelector('img').getAttribute('src')
  assert.equal(source.startsWith('blob:'), false, 'the confirmed photo renders from storage')
  assert.ok(source.includes('/uploads/'))
})

test('a confirmed media deletion frees the local file it dropped', async () => {
  const page = await mount({
    portfolios: [{ id: 1, title: 'Saved', description: '', images: [], videos: [] }],
    fail: request => request.endpoint === 'Update_portfolio' ? { status: 400, body: { message: 'Nope' } } : null,
  })
  page.files('images', [{ name: 'photo.png', type: 'image/png', size: 1000 }])
  await page.submit()
  assert.deepEqual(page.revoked, ['blob:photo.png'])
  page.revoked.length = 0
  // Remove the photo that is now stored, and let the record update fail afterwards so the
  // section keeps its rows instead of rebuilding them.
  page.click(page.media('images')[0].querySelector('[profile-media-remove]'))
  page.type('title', 'Renamed')
  await page.submit()
  assert.equal(page.media('images').length, 0, 'the entry is dropped, not left as an empty Undo')
})

test('a highlight write that never left the browser reports nothing submitted and keeps Save usable', async () => {
  const page = await mount()
  page.context.window.StartersNativeFormDiagnostics = {
    observeMutation() { throw new TypeError('observeMutation is not a function') },
  }
  page.type('title', 'Campaign')
  await page.submit()
  assert.equal(page.mutations().length, 0, 'nothing reached the server')
  assert.equal(page.status(),
    'That change was not submitted. Your draft is kept; you can save again.')
  assert.equal(page.section.querySelector('[profile-items-check-save]').hidden, true)
  delete page.context.window.StartersNativeFormDiagnostics
  await page.submit()
  assert.equal(page.mutations().length, 1)
  assert.equal(page.status(), 'Changes saved.')
})

test('removing a collapsed highlight leaves the open one active', async () => {
  const portfolios = ['First', 'Second', 'Third'].map((title, index) => ({
    id: index + 1, title, description: '', images: [], videos: [],
  }))
  const page = await mount({ portfolios })
  const rows = page.section.querySelectorAll('[profile-item-row]')
  page.click(rows[0].querySelector('[profile-item-toggle]'))
  assert.equal(rows[0].querySelector('[profile-item-content]').hidden, false)
  page.click(rows[2].querySelector('[profile-item-remove]'))
  page.click(page.add)
  assert.equal(rows[0].querySelector('[profile-item-content]').hidden, true,
    'Add collapses the row that was open, not whichever row happens to be last')
})

test('a lost highlight deletion the server still holds releases Save instead of pausing it', async () => {
  let lose = true
  const page = await mount({ portfolios: [
    { id: 1, title: 'Saved', description: '', images: [], videos: [] },
    { id: 2, title: 'Kept', description: '', images: [], videos: [] },
  ], fail: request => request.endpoint === 'Delete_portfolio' && lose ? 'lose' : null })
  page.click(page.section.querySelector('[profile-item-remove]'))
  await page.submit()
  assert.equal(page.status(), 'That change was not saved. Your draft is kept; you can save again.')
  assert.equal(page.section.querySelector('[profile-items-check-save]').hidden, true)
  assert.equal(page.section.querySelectorAll('[profile-item-row]').length, 2, 'the pending removal is still a draft')
  lose = false
  await page.submit()
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.mutations().filter(request => request.endpoint === 'Delete_portfolio').length, 2)
  assert.equal(page.section.querySelectorAll('[profile-item-row]').length, 1)
})

test('a lost highlight deletion can be settled as not saved from Check saved state', async () => {
  let loseDelete = true, readFails = false
  const page = await mount({
    portfolios: [{ id: 1, title: 'Saved', description: '', images: [], videos: [] }],
    fail: request => {
      if (request.endpoint === 'Delete_portfolio' && loseDelete) return 'lose'
      if (request.endpoint === 'Get_my_portfolios' && readFails) return { status: 503, body: { message: 'Service unavailable' } }
      return null
    },
  })
  page.click(page.section.querySelector('[profile-item-remove]'))
  readFails = true
  await page.submit()
  // The canonical read itself failed, so the outcome is genuinely unknown and Save stays paused.
  assert.match(page.status(), /could not be confirmed/)
  assert.equal(page.section.querySelector('[profile-items-check-save]').hidden, false)
  readFails = false
  page.click(page.section.querySelector('[profile-items-check-save]')); await tick()
  assert.equal(page.status(), 'That change was not saved. Your draft is kept; you can save again.')
  assert.equal(page.section.querySelector('[profile-items-check-save]').hidden, true)
  loseDelete = false
  await page.submit()
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.mutations().filter(request => request.endpoint === 'Delete_portfolio').length, 2)
  assert.equal(page.section.querySelectorAll('[profile-item-row]').length, 1, 'the emptied section keeps one blank row')
})

test('a lost highlight update the server never applied releases Save', async () => {
  let lose = true
  const page = await mount({
    portfolios: [{ id: 1, title: 'Saved', description: '', images: [], videos: [] }],
    fail: request => request.endpoint === 'Update_portfolio' && lose ? 'lose' : null,
  })
  page.type('title', 'Renamed')
  await page.submit()
  assert.equal(page.status(), 'That change was not saved. Your draft is kept; you can save again.')
  assert.equal(page.section.querySelector('[profile-items-check-save]').hidden, true)
  assert.equal(page.field('title').value, 'Renamed', 'the draft is kept')
  lose = false
  await page.submit()
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.mutations().filter(request => request.endpoint === 'Update_portfolio').length, 2)
})

test('a received highlight update the canonical read has not caught up with stays unknown, not unsaved', async () => {
  let updated = false
  const page = await mount({
    portfolios: [{ id: 1, title: 'Saved', description: '', images: [], videos: [] }],
    fail: request => { if (request.endpoint === 'Update_portfolio') updated = true; return null },
    // The server answered the update, so it landed. The canonical read simply has not caught up.
    stale: stored => updated ? stored.map(row => ({ ...row, title: 'Saved' })) : null,
  })
  page.type('title', 'Renamed')
  await page.submit()
  assert.match(page.status(), /could not be confirmed/)
  assert.equal(page.section.querySelector('[profile-items-check-save]').hidden, false, 'the lag can be checked again')
  assert.equal(page.field('title').value, 'Renamed', 'the draft is kept')
  await page.submit()
  assert.equal(page.mutations().filter(request => request.endpoint === 'Update_portfolio').length, 1,
    'Save stays paused rather than repeating a write the server received')
})

test('a created highlight is confirmed by the answer that created it, not by a lagging list read', async () => {
  // The create is answered with the new row while the list read still serves the pre-write set.
  const page = await mount({ stale: () => [] })
  page.type('title', 'Campaign')
  await page.submit()
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.mutations().filter(request => request.endpoint === 'Create_portfolio').length, 1)
  await page.submit()
  assert.equal(page.mutations().filter(request => request.endpoint === 'Create_portfolio').length, 1,
    'the confirmed highlight is never created twice')
})

test('a lost highlight deletion the server still holds leaves the confirmed baseline untouched', async () => {
  let lose = true, held = false
  const page = await mount({
    portfolios: [{ id: 1, title: 'Saved', description: '', images: [], videos: [] },
      { id: 2, title: 'Kept', description: '', images: [], videos: [] }],
    fail: request => {
      if (request.endpoint !== 'Delete_portfolio' || !lose) return null
      held = true
      return 'lose'
    },
    // Another session renamed the row while the deletion answer was in flight.
    stale: stored => held ? stored.map(row => row.id === 1 ? { ...row, title: 'Renamed elsewhere' } : row) : null,
  })
  page.click(page.section.querySelector('[profile-item-remove]'))
  await page.submit()
  assert.equal(page.status(), 'That change was not saved. Your draft is kept; you can save again.')
  page.click(page.discard)
  const titles = page.section.querySelectorAll('[profile-highlight-field="title"]').map(node => node.value)
  assert.deepEqual(titles, ['Saved', 'Kept'],
    'the reconciler that proved nothing landed never rewrote the confirmed baseline')
})
