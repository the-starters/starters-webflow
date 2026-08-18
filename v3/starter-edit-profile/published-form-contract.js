'use strict'

const CONTROL_TYPES = new Set([
  'FormTextInput',
  'FormTextarea',
  'FormRadioInput',
  'FormCheckboxInput',
  'FormSelect',
  'DOM',
])

const SAFE_ATTRIBUTES = new Set([
  'build-profile-form',
  'count-by-words',
  'data-editor-id',
  'data-edit-submit',
  'data-form',
  'data-index',
  'data-input-capture',
  'data-max-words',
  'data-non-required',
  'edit-form-input',
  'id',
  'maxlength',
  'ms-code-select',
  'ms-code-select-max',
  'ms-code-select-min',
  'name',
  'required',
  'scroll-container',
  'type',
  'wf-validate-element',
  'wf-validate-submit-disable',
])

const EXPECTED_STEP_INDEXES = ['1', '2', '3', '4', '5', '6', '7']

function childrenOf(node) {
  return Array.isArray(node?.children) ? node.children : []
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  childrenOf(node).forEach((child) => walk(child, visit))
}

function safeAttributes(attributes) {
  const sanitized = {}
  for (const [name, value] of Object.entries(attributes || {})) {
    if (!SAFE_ATTRIBUTES.has(name)) continue
    sanitized[name] = String(value)
  }
  return sanitized
}

function inputNameOf(node) {
  const value = node?.settings?.input?.inputName
  return typeof value === 'string' && value ? value : null
}

function isControl(node) {
  if (!CONTROL_TYPES.has(node?.type)) return false
  return Boolean(inputNameOf(node) || node?.attributes?.name)
}

function normalizeControl(node) {
  return {
    type: node.type,
    id: node?.attributes?.id || null,
    name: inputNameOf(node) || node?.attributes?.name || null,
    attributes: safeAttributes(node.attributes),
  }
}

function normalizeStep(step) {
  const controls = []
  const components = []
  walk(step, (node) => {
    if (node !== step && isControl(node)) controls.push(normalizeControl(node))
    const componentName = node?.instanceDetails?.name
    if (node !== step && typeof componentName === 'string' && componentName !== 'Loader') {
      components.push(componentName)
    }
  })
  return {
    index: String(step.attributes['data-index']),
    attributes: safeAttributes(step.attributes),
    controls,
    components,
    submitMarkers: [],
  }
}

function mergePublishedInventory(steps, inventory) {
  const byIndex = new Map(steps.map((step) => [step.index, step]))
  for (const published of inventory?.steps || []) {
    const step = byIndex.get(String(published.index))
    if (!step) continue

    for (const candidate of published.controls || []) {
      const control = normalizeControl(candidate)
      const existingIndex = step.controls.findIndex((item) =>
        item.type === control.type && item.id === control.id && item.name === control.name
      )
      if (existingIndex === -1) step.controls.push(control)
      else step.controls[existingIndex] = control
    }

    step.submitMarkers = (published.submitMarkers || []).map((value) => String(value))
  }
}

/**
 * Convert a Webflow element-tree read into the persisted public form contract.
 * The output keeps structural names and attributes only. It never copies text,
 * values, component props, style data, URLs, or Webflow element identifiers.
 */
function normalizePublishedFormContract(tree, metadata, publishedInventory) {
  let form = null
  walk(tree, (node) => {
    if (!form && Object.prototype.hasOwnProperty.call(node?.attributes || {}, 'build-profile-form')) {
      form = node
    }
  })
  if (!form) throw new Error('Published form tree has no [build-profile-form] element.')

  const steps = []
  walk(form, (node) => {
    if (node?.attributes?.['data-form'] === 'step' && node.attributes['data-index'] != null) {
      steps.push(normalizeStep(node))
    }
  })
  mergePublishedInventory(steps, publishedInventory)

  return {
    contractVersion: 1,
    provenance: {
      siteId: String(metadata?.siteId || ''),
      pageId: String(metadata?.pageId || ''),
      path: String(metadata?.path || ''),
      capturedOn: String(metadata?.capturedOn || ''),
      source: 'official-data-element-tree-confirmed-against-authenticated-published-page',
    },
    form: {
      type: form.type,
      id: form?.attributes?.id || null,
      attributes: safeAttributes(form.attributes),
    },
    steps,
  }
}

function findControl(step, id) {
  return step.controls.find((control) => control.id === id)
}

/** Validate the persisted structural protocol, including validation ownership. */
function validatePublishedFormContract(contract) {
  const errors = []
  if (contract?.contractVersion !== 1) errors.push('contractVersion must be 1')
  if (contract?.form?.attributes?.['build-profile-form'] !== '') {
    errors.push('form must keep build-profile-form')
  }
  for (const attr of ['wf-validate-element', 'wf-validate-submit-disable']) {
    if (Object.prototype.hasOwnProperty.call(contract?.form?.attributes || {}, attr)) {
      errors.push(`main form must not delegate validation through ${attr}`)
    }
  }

  const structuralRecords = [contract?.form, ...(contract?.steps || [])]
  for (const step of contract?.steps || []) structuralRecords.push(...(step.controls || []))
  for (const record of structuralRecords) {
    for (const name of Object.keys(record?.attributes || {})) {
      if (!SAFE_ATTRIBUTES.has(name)) errors.push(`contract retained unsafe attribute ${name}`)
    }
  }

  const indexes = (contract?.steps || []).map((step) => step.index)
  if (JSON.stringify(indexes) !== JSON.stringify(EXPECTED_STEP_INDEXES)) {
    errors.push(`steps must be exactly ${EXPECTED_STEP_INDEXES.join(',')}`)
  }

  const byIndex = new Map((contract?.steps || []).map((step) => [step.index, step]))
  const expectedSubmitMarkers = new Map([
    ['1', ['']], ['2', ['']], ['3', ['companies']], ['4', ['portfolio']],
    ['5', ['']], ['6', ['']], ['7', ['']],
  ])
  for (const [index, expected] of expectedSubmitMarkers) {
    const actual = byIndex.get(index)?.submitMarkers || []
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      errors.push(`step ${index} must keep data-edit-submit=${JSON.stringify(expected)}`)
    }
  }

  const personal = byIndex.get('1')
  for (const id of [
    'first-name', 'last-name', 'email', 'phone', 'country', 'state', 'city', 'profile-photo-url',
    'function-option', 'function', 'function-required',
    'role-option', 'roles', 'roles-required',
    'subcategories-option', 'subcategories', 'subcategories-required',
  ]) {
    if (!personal || !findControl(personal, id)) errors.push(`step 1 is missing #${id}`)
  }
  for (const id of ['first-name', 'last-name', 'email', 'phone']) {
    const control = personal && findControl(personal, id)
    if (control && control.attributes.required !== 'required') errors.push(`#${id} must remain required`)
  }

  const profileCopy = byIndex.get('2') || { controls: [] }
  for (const id of ['tagline', 'pro-headline']) {
    const control = findControl(profileCopy, id)
    if (!control) errors.push(`step 2 is missing #${id}`)
    else if (control.attributes.required !== 'required') errors.push(`#${id} must remain required`)
  }
  const bio = findControl(profileCopy, 'bio-html')
  if (!bio) errors.push('step 2 is missing #bio-html')
  else if (bio.attributes.required !== 'required') errors.push('#bio-html must remain required')

  for (const [index, id] of [['3', 'first-company'], ['4', 'first-portfolio']]) {
    const control = findControl(byIndex.get(index) || { controls: [] }, id)
    if (!control) errors.push(`step ${index} is missing #${id}`)
    else if (control.attributes.required !== 'required') errors.push(`#${id} must remain required`)
  }

  const requiredStep6Names = new Set([
    'rate',
    'free-consulting-calls',
    'paid-consulting-calls',
    'offer-monthly-retainers',
    'availability-required',
  ])
  const actualRequiredStep6Names = new Set(
    (byIndex.get('6')?.controls || [])
      .filter((control) => control.attributes.required === 'required')
      .map((control) => control.name),
  )
  if (JSON.stringify([...actualRequiredStep6Names].sort()) !== JSON.stringify([...requiredStep6Names].sort())) {
    errors.push('step 6 required controls must remain rate, three call/retainer radio groups, and availability-required')
  }

  for (const id of ['reviewer', 'reviewer-fname', 'reviewer-lname', 'reviewer-job', 'reviewer-company', 'reviewer-email']) {
    if (!findControl(byIndex.get('7') || { controls: [] }, id)) errors.push(`step 7 is missing #${id}`)
  }
  for (const id of ['profile-photo-url', 'function-required', 'roles-required', 'subcategories-required']) {
    const control = personal && findControl(personal, id)
    if (control && control.attributes?.required !== 'required') {
      errors.push(`#${id} must preserve the published required marker contract`)
    }
  }

  const companyComponents = byIndex.get('3')?.components || []
  const portfolioComponents = byIndex.get('4')?.components || []
  if (!companyComponents.includes('Companies [Build\\Edit Forms]')) {
    errors.push('step 3 must remain owned by Companies [Build\\Edit Forms]')
  }
  if (!portfolioComponents.includes('Highlights [Build\\Edit Forms]')) {
    errors.push('step 4 must remain owned by Highlights [Build\\Edit Forms]')
  }
  if (!(byIndex.get('7')?.components || []).includes('Profile Form - Reviewers')) {
    errors.push('step 7 must preserve the native reviewer component')
  }
  return { valid: errors.length === 0, errors }
}

module.exports = {
  normalizePublishedFormContract,
  validatePublishedFormContract,
}
