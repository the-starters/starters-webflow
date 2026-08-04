const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(
  require.resolve('./complete-profile-photo.js'),
  'utf8',
)

function element(tagName = 'A') {
  const attributes = new Map()
  return {
    tagName,
    setAttribute(name, value) {
      attributes.set(name, String(value))
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null
    },
  }
}

function load(options = {}) {
  const button = options.button === null ? null : options.button || element('A')
  const preview = options.preview || null
  const window = {
    location: {
      hostname: options.hostname || 'the-starters-3-0.webflow.io',
      pathname: options.pathname || '/complete-profile',
    },
  }
  const document = {
    querySelector(selector) {
      if (selector === '.app-form_upload.is-complete-profile .upload-btn') return button
      if (selector === '[data-complete-profile-image]') return preview
      return null
    },
  }
  vm.runInContext(source, vm.createContext({ window, document, console }))
  return { api: window.StartersBrandProfileImage, button, preview, window }
}

test('binds the published Brand upload control to Memberstack', () => {
  const environment = load()
  assert.equal(environment.button.getAttribute('data-ms-action'), 'profile-image')
  assert.equal(environment.api.init(), true)
})

test('binds a native authored preview image when present', () => {
  const preview = element('IMG')
  load({ preview })
  assert.equal(preview.getAttribute('data-ms-member'), 'profile-image')
})

test('does not bind a non-image preview element', () => {
  const preview = element('DIV')
  load({ preview })
  assert.equal(preview.getAttribute('data-ms-member'), null)
})

test('does not bind outside the Brand onboarding page', () => {
  const environment = load({ pathname: '/starter-edit-profile' })
  assert.equal(environment.button.getAttribute('data-ms-action'), null)
  assert.equal(environment.api.init(), false)
})

test('does not bind on an unapproved host', () => {
  const environment = load({ hostname: 'example.com' })
  assert.equal(environment.button.getAttribute('data-ms-action'), null)
})

test('does not call fetch or create a file input', () => {
  const context = {
    fetch() {
      throw new Error('must not call the retired Starter upload route')
    },
  }
  const environment = load(context)
  assert.equal(environment.button.getAttribute('data-ms-action'), 'profile-image')
})
