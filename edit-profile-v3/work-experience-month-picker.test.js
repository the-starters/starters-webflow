// Behavior of the patched Work Experience runtime this bundle ships.
//
// `manifest.json` declares the exact bytes the bundle serves. Those bytes are not
// committed (see .gitignore), so this file rebuilds them the way materialize.py does —
// tracked source plus the tracked patch — and then runs them. The rebuild uses the
// working-tree sources rather than the manifest's baseline tags so the suite needs no
// Git history, no tags and no network; the hash assertion below is what proves the two
// routes still produce the same file.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const test = require('node:test')
const vm = require('node:vm')
const { h, makeEvent } = require('../v3/test-helpers/form-dom.cjs')

const BUNDLE = __dirname
const REPO = path.resolve(BUNDLE, '..')
const MANIFEST = JSON.parse(fs.readFileSync(path.join(BUNDLE, 'manifest.json'), 'utf8'))
const PATCHED = ['v3/starter-edit-profile/unified-companies.js', 'v3/starter-edit-profile/company-experience-crud.js']
const SUPPORT = ['global-embeds/accordions/accordions.js', 'v3/starter-edit-profile/profile-section-validation.js']
const tick = () => new Promise(resolve => setImmediate(resolve))

const runtime = materialize()

// Rebuilds the bundle's runtime into a scratch directory and hands back its file text.
function materialize() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-profile-v3-'))
  for (const file of [...PATCHED, ...SUPPORT, 'starter-edit-profile.js']) {
    fs.mkdirSync(path.join(out, path.dirname(file)), { recursive: true })
    fs.copyFileSync(path.join(REPO, file), path.join(out, file))
  }
  execFileSync('patch', ['-p1', '-s', '-i', path.join(BUNDLE, 'patches/work-experience-month-picker.patch')], { cwd: out })
  return { dir: out, read: file => fs.readFileSync(path.join(out, file), 'utf8') }
}

function entry(file) {
  const found = MANIFEST.runtime.find(item => item.path === file)
  assert.ok(found, `${file} is not in manifest.json`)
  return found
}

// The picker builds its popup with DOM surface the shared minimal Element does not carry:
// variadic append, className and id as live properties, and a measurable rect. `id` in
// particular has to reflect the attribute through cloneNode, because the section clones
// its row template and then rewrites every id and `for` on the copy — which is exactly
// how a label comes to point at the input the picker is about to relabel.
function enhance(element) {
  if (element._enhanced) return element
  element._enhanced = true
  const cloneOne = element.cloneNode.bind(element)
  element.cloneNode = (deep = false) => {
    const copy = enhance(cloneOne(deep))
    if (deep) copy.descendants().forEach(enhance)
    return copy
  }
  const appendOne = element.append.bind(element)
  element.append = (...children) => { children.forEach(child => appendOne(child)); return children[0] }
  element.getBoundingClientRect = () => ({ top: 100, bottom: 140, left: 40, right: 240, width: 200, height: 40 })
  const words = value => String(value || '').split(/\s+/).filter(Boolean)
  Object.defineProperty(element, 'className', {
    get: () => element.getAttribute('class') || '',
    set(value) {
      words(element.getAttribute('class')).forEach(name => element.classList.remove(name))
      element.setAttribute('class', value)
      words(value).forEach(name => element.classList.add(name))
    },
  })
  Object.defineProperty(element, 'id', {
    get: () => element.getAttribute('id') || '',
    set(value) { element.setAttribute('id', value) },
  })
  return element
}

async function mount(t, { companies = [], wrappingLabel = false, separateLabel = false } = {}) {
  const names = ['company_name', 'job_title', 'start_date', 'end_date', 'current_work']
  const fields = new Map(names.map(key => {
    const field = enhance(h('input', { 'profile-company-field': key, name: key, id: key,
      ...(key === 'current_work' ? { type: 'checkbox' } : {}),
      ...(key === 'company_name' || key === 'job_title' ? { required: '' } : {}) }))
    return [key, field]
  }))
  // The authored markup wraps each control in its own label. `wrappingLabel` additionally
  // gives that label a `for` pointing at the control it already contains — the shape that
  // used to let the picker replace the label text and take the input with it.
  const wrap = key => separateLabel && (key === 'start_date' || key === 'end_date')
    ? h('div', {}, [h('label', { for: key }), fields.get(key)])
    : h('label', wrappingLabel ? { for: key } : {}, [fields.get(key)])
  const row = h('div', { 'profile-item-row': '' }, [
    h('button', { 'profile-item-toggle': '', type: 'button' }, [h('span', { 'profile-items-summary': '' })]),
    h('div', { 'profile-item-content': '' }, names.map(wrap)),
    h('div', { 'profile-item-remove': '' }, [h('div', { 'data-button-theme': 'danger', 'data-button-style': 'primary' }, [h('div', {}, [h('button', { type: 'button' })])])]),
    h('div', { 'profile-items-undo': '' }, [h('div', { 'data-button-theme': 'black' }, [h('button', { type: 'button' })])]),
  ])
  const save = h('button', { 'data-edit-submit': 'companies' })
  const add = h('button', { 'profile-items-add': '' })
  const discard = h('button', { 'profile-items-discard': '' })
  const presence = h('input', { 'profile-items-presence': '', required: '' })
  const other = h('input', { id: 'also-worked-with', 'data-starter-also-worked-with-state': 'pending' })
  const section = h('section', { 'profile-unified-items': 'companies' },
    [h('div', {}, [row]), save, add, discard, presence, other])
  section.descendants().forEach(enhance)
  const body = enhance(h('body', {}, [section]))
  const head = enhance(h('head'))

  const requests = []
  let stored = structuredClone(companies)
  let nextId = 10
  let nextUuid = 0
  let boot

  const documentListeners = new Map()
  const windowListeners = new Map()
  const registry = map => ({
    addEventListener(type, listener) { map.set(type, [...(map.get(type) || []), listener]) },
    removeEventListener(type, listener) { map.set(type, (map.get(type) || []).filter(item => item !== listener)) },
    count: type => (map.get(type) || []).length,
  })
  const documentEvents = registry(documentListeners)
  const windowEvents = registry(windowListeners)

  const document = {
    readyState: 'complete', body, head, documentElement: { clientWidth: 1280, clientHeight: 900 },
    createElement: tag => enhance(h(tag)),
    getElementById: id => body.querySelector(`#${id}`) || head.querySelector(`#${id}`),
    querySelector: selector => body.querySelector(selector),
    querySelectorAll: selector => body.querySelectorAll(selector),
    addEventListener: documentEvents.addEventListener, removeEventListener: documentEvents.removeEventListener,
  }
  const windowStub = {
    matchMedia: () => ({ matches: false }), innerWidth: 1280, innerHeight: 900,
    fetchAlsoWorkedWithCompanies: async () => ({}),
    addEventListener: windowEvents.addEventListener, removeEventListener: windowEvents.removeEventListener,
  }

  const context = vm.createContext({
    window: windowStub, document,
    Event: class { constructor(type, options) { Object.assign(this, makeEvent(type, null, options)) } },
    MEMBER: { id: 'test-member' },
    crypto: { randomUUID: () => 'generated-' + ++nextUuid },
    // Memberstack resolves after the page's deferred scripts have all run, so the section
    // starts building rows only once company-experience-crud.js has published its picker.
    waitForMember(callback) { boot = new Promise(resolve => setImmediate(() => resolve(callback()))) },
    qs: (selector, scope) => scope ? scope.querySelector(selector)
      : selector === '[profile-unified-items="companies"]' ? section : body.querySelector(selector),
    qsa: (selector, scope = section) => scope.querySelectorAll(selector),
    console: { warn() {}, error() {}, log() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null
      const method = init.method || 'GET'
      requests.push({ url, method, body })
      if (method === 'GET') return { ok: true, json: async () => ({ companies: structuredClone(stored), starter_id: 7 }) }
      let value
      if (method === 'POST') {
        value = { ...body, id: nextId++ }
        stored.push(value)
      } else if (method === 'PATCH') {
        value = { ...body, id: Number(String(url).split('/').at(-1)) }
        stored = stored.map(item => item.id === value.id ? value : item)
      } else stored = stored.filter(item => item.id !== Number(String(url).split('/').at(-1)))
      return { ok: true, json: async () => value || { deleted: true } }
    },
  })
  windowStub.StarterEditLogoSearchInit = () => {}

  for (const file of [SUPPORT[0], SUPPORT[1], PATCHED[0], PATCHED[1]]) {
    vm.runInContext(runtime.read(file), context, { filename: file })
  }

  setImmediate(() => {
    other.value = '{}'
    other.dispatchEvent(makeEvent('starter:also-worked-with-hydrated', other, { bubbles: true }))
  })
  await boot

  const rows = () => section.querySelectorAll('[profile-item-row]')
  const field = (key, index = 0) => enhance(rows()[index].querySelector(`[profile-company-field="${key}"]`))
  const click = element => element.dispatchEvent(makeEvent('click', element, { bubbles: true }))
  // An open picker holds a polling interval, which would keep the test process alive.
  t.after(() => {
    for (const key of ['start_date', 'end_date']) {
      for (const input of body.querySelectorAll(`[profile-company-field="${key}"]`)) {
        input._starterProfileCompanyMonthPicker?.destroy()
      }
    }
  })
  return {
    section, body, rows, field, click, requests, documentEvents, windowEvents,
    picker: (key, index = 0) => field(key, index)._starterProfileCompanyMonthPicker,
    popups: () => body.querySelectorAll('.sp-company-month-picker'),
    // Picks a month from the open popup exactly as a Starter does: by its button.
    pick(key, label, index = 0) {
      const input = field(key, index)
      input._starterProfileCompanyMonthPicker.open()
      const button = input._starterProfileCompanyMonthPicker.popup
        .querySelectorAll('.sp-company-month-picker__month').find(node => node.textContent === label)
      assert.ok(button, `${label} is not offered`)
      click(button)
      return button
    },
    type(key, value, index = 0) {
      const input = field(key, index)
      input.value = value
      input.dispatchEvent(makeEvent('input', input, { bubbles: true }))
      input.dispatchEvent(makeEvent('change', input, { bubbles: true }))
    },
    company(name, index = 0) {
      const input = field('company_name', index)
      input.value = name
      Object.assign(input.dataset, { selectedCompanyName: name, selectedCompanySource: 'custom',
        selectedCompanyDomain: '', selectedCompanyLogoUrl: '', selectedCompanyEntityId: '0' })
      input.dispatchEvent(makeEvent('input', input, { bubbles: true }))
      input.dispatchEvent(makeEvent('change', input, { bubbles: true }))
    },
    errors: () => section.querySelectorAll('[profile-validation-error]').map(node => node.textContent),
    writes: () => requests.filter(item => item.method !== 'GET'),
    async submit() { click(save); await tick(); await tick() },
    remove: (index = 0) => click(rows()[index].querySelector('[profile-item-remove]').querySelector('button')),
    discard: () => click(discard),
  }
}

const SAVED = [{ id: 1, company_name: 'Example Company', company_source: 'custom', job_title: 'Designer',
  start_date: '2022-03-01', end_date: '2025-08-01' }]

test('the tracked patch rebuilds exactly the bytes manifest.json declares', () => {
  for (const file of PATCHED) {
    const declared = entry(file)
    const bytes = fs.readFileSync(path.join(runtime.dir, file))
    assert.equal(bytes.length, declared.bytes, file)
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), declared.sha256, file)
  }
})

test('a month picked from the popup is saved as YYYY-MM', async (t) => {
  const page = await mount(t, { companies: SAVED })
  // The popup opens on the saved month's year, so the pick is March 2022 -> June 2022.
  page.pick('start_date', 'Jun')
  assert.equal(page.field('start_date').value, 'Jun 2022')
  await page.submit()
  assert.equal(page.writes().length, 1)
  assert.equal(page.writes()[0].body.start_date, '2022-06')
  // The End month nobody touched still round-trips as the raw value that was stored.
  assert.equal(page.writes()[0].body.end_date, '2025-08-01')
})

test('a saved date nobody touched is sent back with its original raw value', async (t) => {
  const page = await mount(t, { companies: SAVED })
  assert.equal(page.field('start_date').value, 'Mar 2022')
  assert.equal(page.field('end_date').value, 'Aug 2025')
  page.type('job_title', 'Lead Designer')
  await page.submit()
  assert.equal(page.writes().length, 1)
  assert.equal(page.writes()[0].body.start_date, '2022-03-01')
  assert.equal(page.writes()[0].body.end_date, '2025-08-01')
})

test('clearing the popup clears the field and saves an empty date', async (t) => {
  const page = await mount(t, { companies: SAVED })
  const picker = page.picker('start_date')
  picker.open()
  const footer = picker.popup.querySelector('.sp-company-month-picker__footer')
  assert.equal(footer.children[1].textContent, 'Clear')
  page.click(footer.children[1])
  assert.equal(page.field('start_date').value, '')
  await page.submit()
  assert.equal(page.writes()[0].body.start_date, '')
})

test('a retained date the picker cannot parse stays visible for validation to catch', async (t) => {
  const page = await mount(t, { companies: [{ ...SAVED[0], start_date: 'sometime in 2019' }] })
  // The picker cannot represent it, so the Starter still sees what is stored and Save
  // refuses the row instead of silently rewriting or dropping the value.
  assert.equal(page.field('start_date').value, 'sometime in 2019')
  page.type('job_title', 'Lead Designer')
  await page.submit()
  assert.deepEqual(page.writes(), [])
  assert.deepEqual(page.errors(), ['Enter a valid month and year.'])
})

test('"I currently work here" clears the End field and saves Present', async (t) => {
  const page = await mount(t, { companies: SAVED })
  const current = page.field('current_work')
  current.checked = true
  current.dispatchEvent(makeEvent('change', current, { bubbles: true }))
  const end = page.field('end_date')
  end.value = ''
  end.dispatchEvent(makeEvent('change', end, { bubbles: true }))
  await page.submit()
  assert.equal(page.writes()[0].body.end_date, 'Present')
})

test('the End picker will not offer a month before the Start month', async (t) => {
  const page = await mount(t, { companies: SAVED })
  const end = page.picker('end_date')
  const year = () => end.popup.querySelector('.sp-company-month-picker__year').textContent
  const previousYear = () => end.popup.querySelector('.sp-company-month-picker__header').children[0]
  const offered = () => end.popup.querySelectorAll('.sp-company-month-picker__month')
    .filter(node => !node.disabled).map(node => node.textContent)
  const walkBackTo = target => {
    for (let step = 0; step < 20 && year() !== target; step += 1) page.click(previousYear())
    assert.equal(year(), target)
  }

  // The saved start is March 2022, so 2022 opens with January and February refused.
  end.open()
  walkBackTo('2022')
  assert.deepEqual(offered(), ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
  assert.equal(previousYear().disabled, true)

  // Moving the Start month moves the End picker's floor with it, live.
  page.pick('start_date', 'Jun')
  end.open()
  walkBackTo('2022')
  assert.deepEqual(offered(), ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
})

test('the unified section, not the picker, owns the date-range message', async (t) => {
  const page = await mount(t, { companies: SAVED })
  page.type('end_date', 'Jan 2021')
  // minimumOnly keeps the picker out of validity: it constrains the End minimum and
  // otherwise leaves the message to the section that renders it.
  assert.equal(page.field('end_date').validity.customError, false)
  assert.equal(page.field('start_date').validity.customError, false)
  assert.equal(page.field('end_date').getAttribute('min'), '2022-03')
  await page.submit()
  assert.deepEqual(page.writes(), [])
  assert.deepEqual(page.errors(), ['End month must be the same as or later than the start month.'])
})

test('removing a row destroys its pickers and releases their listeners', async (t) => {
  const page = await mount(t, { companies: [SAVED[0], { ...SAVED[0], id: 2, company_name: 'Second Company' }] })
  const start = page.field('start_date', 1)
  const end = page.field('end_date', 1)
  const startPopup = start._starterProfileCompanyMonthPicker.popup
  assert.equal(page.popups().length, 4)
  const mousedown = page.documentEvents.count('mousedown')
  const resize = page.windowEvents.count('resize')
  assert.ok(mousedown >= 4 && resize >= 4)

  page.remove(1)
  await page.submit()
  assert.deepEqual(page.writes().map(item => item.method), ['DELETE'])
  assert.equal(page.rows().length, 1)

  assert.equal(page.popups().length, 2)
  assert.equal(startPopup.parentElement, null)
  assert.equal(start._starterProfileCompanyMonthPicker, undefined)
  assert.equal(end._starterProfileCompanyMonthPicker, undefined)
  assert.equal(end._starterProfileCompanyMinimumResolver, undefined)
  assert.equal(start.getAttribute('aria-controls'), null)
  assert.equal(page.documentEvents.count('mousedown'), mousedown - 2)
  assert.equal(page.windowEvents.count('resize'), resize - 2)
  // A destroyed picker's popup no longer answers the input it used to own.
  start.dispatchEvent(makeEvent('click', start, { bubbles: true }))
  assert.equal(startPopup.hidden, true)
})

test('a separate label is still renamed to the month-and-year prompt', async (t) => {
  const page = await mount(t, { companies: SAVED, separateLabel: true })
  const input = page.field('start_date')
  const label = page.body.querySelectorAll('label').find(node => node.getAttribute('for') === input.id)
  assert.ok(label, 'the label still points at the input')
  assert.equal(label.contains(input), false)
  assert.equal(label.textContent, 'Start month and year')
})

test('a label wrapping its own input keeps the input when the picker initializes', async (t) => {
  const page = await mount(t, { companies: SAVED, wrappingLabel: true })
  const input = page.field('start_date')
  const label = input.parentElement
  assert.equal(label.tagName, 'LABEL')
  // The label's `for` was rewritten to this very input, so a blind relabel would reach it.
  assert.equal(label.getAttribute('for'), input.id)
  assert.notEqual(input.id, '')
  assert.equal(label.querySelector('[profile-company-field="start_date"]'), input)
  assert.equal(page.field('start_date').getAttribute('aria-label'), 'Start month and year')
  // The control still works: it is reachable, pickable and saveable.
  page.pick('start_date', 'Jun')
  await page.submit()
  assert.equal(page.writes()[0].body.start_date, '2022-06')
})

test('the diagnostics loader fetches the copy pinned beside it, not the CDN repository root', () => {
  const src = 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v0.0.0-bundle/edit-profile-v3/runtime/starter-edit-profile.js'
  const load = source => {
    const created = []
    const node = () => ({ setAttribute() {}, addEventListener() {}, style: {} })
    const document = {
      currentScript: { src }, readyState: 'loading', addEventListener() {},
      querySelector: () => null, querySelectorAll: () => [], documentElement: {},
      head: { appendChild() {} },
      createElement() { const element = node(); created.push(element); return element },
    }
    const window = { addEventListener() {}, setTimeout, clearTimeout, location: { href: 'https://example.test/' } }
    vm.runInContext(source, vm.createContext({
      window, document, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, URL,
      fetch: async () => ({ ok: true, json: async () => ({}) }), MEMBER: {},
      localStorage: { getItem: () => null, setItem() {} },
    }), { filename: 'starter-edit-profile.js' })
    return created.map(element => element.src).filter(Boolean)
  }

  assert.deepEqual(
    [...new Set(load(runtime.read('starter-edit-profile.js')))],
    ['https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v0.0.0-bundle/edit-profile-v3/runtime/utils/workflow-diagnostics.js'],
  )
  // Without the patch the same src reaches for the repository root, where the bundle has
  // pinned nothing — which is the failure this overlay exists to prevent.
  assert.deepEqual(
    [...new Set(load(fs.readFileSync(path.join(REPO, 'starter-edit-profile.js'), 'utf8')))],
    ['https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v0.0.0-bundle/utils/workflow-diagnostics.js'],
  )
})
