'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function createHarness(file, companies) {
  let domReady
  let nextId = 0
  const tags = []
  const valueInput = {
    value: '',
    dispatchEvent() {},
  }
  const tagTemplate = {
    cloneNode() {
      return {
        dataset: {},
        name: { textContent: '' },
        domain: { textContent: '' },
        deleteButton: { addEventListener() {} },
        classList: { remove() {} },
      }
    },
  }
  const tagWrapper = {
    appendChild(tag) {
      tags.push(tag)
    },
  }
  const group = {}
  const searchGroup = {
    appendChild() {},
    contains() { return false },
  }
  const input = {
    value: '',
    dataset: {},
    hasAttribute(name) { return name === 'data-multiple' },
    closest(selector) { return selector === '[form-group]' ? group : searchGroup },
    addEventListener() {},
    focus() {},
  }
  const document = {
    addEventListener(name, callback) {
      if (name === 'DOMContentLoaded') domReady = callback
    },
    createElement() {
      return {
        className: '',
        style: {},
        addEventListener() {},
      }
    },
  }
  const context = {
    activeProfile: {
      data: {
        step_3: {
          'also-worked-with': JSON.stringify(companies),
        },
      },
    },
    console,
    crypto: { randomUUID: () => `id-${++nextId}` },
    document,
    Event: class Event {},
    MEMBER: { id: 'member-1' },
    qsa(selector, root) {
      if (selector === '[logo-search-input]') return [input]
      if (selector === '[also-worked-tag]' && root === tagWrapper) return tags
      return []
    },
    qs(selector, root) {
      if (root === group) {
        if (selector === '[also-worked-tag].is_template') return tagTemplate
        if (selector === '[also-worked-wrapper]') return tagWrapper
        if (selector === '#also-worked-with') return valueInput
        return null
      }
      if (selector === '[also-worked-tag-name]') return root.name
      if (selector === '[also-worked-tag-domain]') return root.domain
      if (selector === '[also-worked-tag-delete]') return root.deleteButton
      return null
    },
    setTimeout,
    clearTimeout,
    waitForMember(callback) { callback() },
    waitProfileData(callback) { callback() },
    window: {
      xanoAuthFetch: async () => ({
        ok: true,
        json: async () => companies,
      }),
    },
  }

  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file })
  domReady()

  return { valueInput }
}

test('Build Profile preserves a hydrated company logo in the serialized selection', () => {
  const logoUrl = 'https://logos.example/acme.svg'
  const { valueInput } = createHarness(
    path.join(__dirname, '../build-profile/company-autocomplete.js'),
    { company: { name: 'Acme', domain: 'acme.example', logo_url: logoUrl } },
  )

  assert.equal(JSON.parse(valueInput.value).company.logo_url, logoUrl)
})

test('Edit Profile preserves a hydrated API company logo in the serialized selection', async () => {
  const logoUrl = 'https://logos.example/acme.svg'
  const { valueInput } = createHarness(
    path.join(__dirname, '../starter-edit-profile/company-autocomplete.js'),
    [{ company_name: 'Acme', company_domain: 'acme.example', company_logo_url: logoUrl }],
  )
  await new Promise((resolve) => setImmediate(resolve))

  const [company] = Object.values(JSON.parse(valueInput.value))
  assert.equal(company.logo_url, logoUrl)
})
