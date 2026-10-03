// Task D (Jai 10-02 list): Edit Opportunity Duration + Categories do not update.
// Fixtures mirror the live /opportunities/<id> Edit form markup (2026-10-03):
// the Duration radios sit inside the data-project-type="one-time" panel, and
// the detail page renders categories from a CMS list bound as category-list.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { Element: BaseElement } = require('./step-flow-test-dom.js')

class Element extends BaseElement {
  get parentNode() {
    return this.parentElement
  }
  appendChild(child) {
    if (child.parentElement) child.parentElement.removeChild(child)
    return this.append(child)
  }
  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index === -1) throw new Error('not a child')
    this.children.splice(index, 1)
    child.parentElement = null
    return child
  }
  insertBefore(child, ref) {
    if (child.parentElement) child.parentElement.removeChild(child)
    const index = this.children.indexOf(ref)
    if (index === -1) throw new Error('ref not a child')
    child.parentElement = this
    this.children.splice(index, 0, child)
    return child
  }
  cloneNode(deep) {
    const attrs = {}
    this._attrs.forEach((value, key) => {
      attrs[key] = value
    })
    const copy = new Element(this.tagName.toLowerCase(), attrs)
    copy.textContent = this.textContent
    if (deep) this.children.forEach((child) => copy.append(child.cloneNode(true)))
    return copy
  }
}

const h = (tag, attrs = {}, children = []) => new Element(tag, attrs, children)

const source = fs.readFileSync(path.join(__dirname, 'opportunities-3.0.js'), 'utf8')
const createSource = fs.readFileSync(path.join(__dirname, 'opportunities---create.js'), 'utf8')

function extractFunction(name) {
  const start = source.indexOf(`  function ${name}(`)
  assert.notEqual(start, -1, `${name} must exist in opportunities-3.0.js`)
  const end = source.indexOf('\n  }\n', start)
  return source.slice(start, end + 4)
}

function loadHelpers(document = new Element('html')) {
  const context = vm.createContext({ document, Array, String })
  vm.runInContext(
    [
      'const $ = (sel, root = document) => root.querySelector(sel)',
      'const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))',
      extractFunction('promoteDurationGroup'),
      extractFunction('paintOpportunityCategories'),
      'this.promoteDurationGroup = promoteDurationGroup',
      'this.paintOpportunityCategories = paintOpportunityCategories',
    ].join('\n'),
    context,
  )
  return context
}

const durationRadio = (id, value, checked = false) => {
  const input = h('input', { type: 'radio', name: 'Duration', id, value })
  input.checked = checked
  return h('label', { class: 'form_selection-field w-radio' }, [input])
}

function liveEditForm() {
  const durationGroup = h('div', { class: 'app-form_input_group', 'data-test': 'duration-group' }, [
    h('label', { class: 'form_label' }),
    h('div', { class: 'form_radio-group' }, [
      durationRadio('1-months', '≤ 1 months', true),
      durationRadio('1-to-3-months', '1 to 3 months'),
      durationRadio('3-to-6-months', '3 to 6 months'),
      durationRadio('6-months', '≥ 6+ months'),
    ]),
  ])
  const oneTime = h('div', { 'data-project-type': 'one-time', class: 'display-contents' }, [
    durationGroup,
    h('div', { class: 'app-form_input_group' }, [h('input', { name: 'One-Time-Budget' })]),
  ])
  const partTimeHours = h('div', { 'data-project-type': 'part-time', class: 'app-form_input_group' }, [
    h('input', { name: 'Estimated-Hours' }),
  ])
  const partTime = h('div', { 'data-project-type': 'part-time', class: 'display-contents' }, [
    h('div', { class: 'app-form_input_group' }, [h('input', { name: 'Part-Time-Budget' })]),
  ])
  const fullTime = h('div', { 'data-project-type': 'full-time', class: 'display-contents' }, [
    h('div', { class: 'app-form_input_group' }, [h('input', { name: 'Full-Time-Budget' })]),
  ])
  const list = h('div', { 'data-project-type-list': '', class: 'display-contents' }, [
    oneTime,
    partTimeHours,
    partTime,
    fullTime,
  ])
  const tabs = h('div', { 'data-tab-filters': '' }, [
    h('input', { type: 'radio', name: 'Project-Type', id: 'One-Time', 'data-project-type': 'one-time' }),
    h('input', { type: 'radio', name: 'Project-Type', id: 'Ongoing-Part-Time', 'data-project-type': 'part-time' }),
  ])
  const inputs = h('div', { class: 'create-opportunities_form-inputs' }, [tabs, list])
  const form = h('form', { 'data-opp-form': 'create' }, [inputs])
  return { form, list, oneTime, durationGroup, inputs }
}

test('Duration group moves out of the One Time panel so every project type shows it', () => {
  const { promoteDurationGroup } = loadHelpers()
  const { form, list, oneTime, durationGroup, inputs } = liveEditForm()
  assert.equal(oneTime.contains(durationGroup), true, 'fixture reproduces the live hidden-panel placement')

  assert.equal(promoteDurationGroup(form), true)
  assert.equal(oneTime.contains(durationGroup), false)
  assert.equal(durationGroup.closest('[data-project-type]'), null, 'no project-type panel can hide Duration now')
  assert.equal(inputs.children.indexOf(durationGroup), inputs.children.indexOf(list) - 1)
  assert.equal(form.getAttribute('data-opp-duration-promoted'), 'true')
  // The One Time budget stays in its panel.
  assert.ok(oneTime.querySelector('[name="One-Time-Budget"]'))
  // The checked radio travels with the group, so prefill and reads keep working.
  assert.equal(form.querySelectorAll('[name="Duration"]').length, 4)
})

test('Duration promotion is idempotent and a no-op on corrected Designer markup', () => {
  const { promoteDurationGroup } = loadHelpers()
  const { form } = liveEditForm()
  assert.equal(promoteDurationGroup(form), true)
  assert.equal(promoteDurationGroup(form), false)

  const fixed = h('form', { 'data-opp-form': 'create' }, [
    h('div', { class: 'app-form_input_group' }, [durationRadio('1-months', '≤ 1 months')]),
    h('div', { 'data-project-type-list': '' }, [h('div', { 'data-project-type': 'one-time' })]),
  ])
  assert.equal(promoteDurationGroup(fixed), false)
  assert.equal(fixed.getAttribute('data-opp-duration-promoted'), null)
})

test('Duration promotion refuses a group that also owns other fields', () => {
  const { promoteDurationGroup } = loadHelpers()
  const shared = h('div', { class: 'app-form_input_group' }, [
    durationRadio('1-months', '≤ 1 months'),
    h('input', { name: 'One-Time-Budget' }),
  ])
  const panel = h('div', { 'data-project-type': 'one-time' }, [shared])
  const form = h('form', {}, [h('div', { 'data-project-type-list': '' }, [panel])])
  assert.equal(promoteDurationGroup(form), false)
  assert.equal(panel.contains(shared), true)
})

function categoryList(names) {
  const item = (name) =>
    h('div', { role: 'listitem', class: 'display-contents w-dyn-item' }, [
      h('div', { class: 'label_component' }, [
        Object.assign(h('div', { class: 'label_text' }), { textContent: name }),
      ]),
    ])
  return h('div', { 'data-opp-bind': 'category-list', role: 'list' }, names.map(item))
}

const labels = (list) => list.querySelectorAll('.label_text').map((el) => el.textContent)

test('saved categories repaint the CMS category chips in place', () => {
  const list = categoryList(['AI & Technology', 'Marketing Strategy & Brand'])
  const doc = h('html', {}, [list])
  const { paintOpportunityCategories } = loadHelpers(doc)
  assert.equal(paintOpportunityCategories(['Content & Organic', ' Paid Media ', '']), 1)
  assert.deepEqual(labels(list), ['Content & Organic', 'Paid Media'])
  assert.equal(list.querySelectorAll('.w-dyn-item').length, 2)
})

test('empty or missing category names never blank the authored chips', () => {
  const list = categoryList(['AI & Technology'])
  const doc = h('html', {}, [list])
  const { paintOpportunityCategories } = loadHelpers(doc)
  assert.equal(paintOpportunityCategories([]), 0)
  assert.equal(paintOpportunityCategories(undefined), 0)
  assert.deepEqual(labels(list), ['AI & Technology'])
})

test('create page controller never binds the Edit Opportunity form', () => {
  const createForm = h('form', { 'data-opp-form': 'create', id: 'create' })
  const editForm = h('form', { 'data-opp-form': 'create', id: 'edit' })
  const doc = h('html', {}, [
    h('dialog', { 'data-modal-target': 'edit-opportunity' }, [editForm]),
    h('dialog', { 'data-modal-target': 'post-opportunity' }, [createForm]),
  ])
  const match = /const getForm = \(\) => \{[\s\S]*?\n  \}\n/.exec(createSource)
  assert.ok(match, 'getForm must exist')
  const context = vm.createContext({ document: doc, Array })
  vm.runInContext(`${match[0]}\nthis.getForm = getForm`, context)
  assert.equal(context.getForm(), createForm)
})
