const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'nav-menu.js'), 'utf8')

function image(src) {
  const attributes = new Map([
    ['src', src], ['srcset', '/placeholder.avif 500w'], ['sizes', '100vw'],
  ])
  return { attributes, removeAttribute(name) { attributes.delete(name) } }
}

function boot(images, menuBtn = null) {
  const window = { Webflow: [] }
  const body = { style: { overflow: 'auto' } }
  const document = {
    body,
    querySelectorAll(selector) {
      assert.equal(selector, 'img[nav-profile-image][data-ms-member="profile-image"]')
      return images
    },
    getElementById(id) { assert.equal(id, 'menu-btn'); return menuBtn },
  }
  vm.runInNewContext(source, { window, document, getComputedStyle: (node) => node.style })
  window.Webflow.forEach((ready) => ready())
  return body
}

test('desktop and mobile avatar candidates clear without a menu button or changing Memberstack src', () => {
  const images = [image('/member-photo.jpg'), image('/member-photo.jpg')]
  boot(images)
  for (const node of images) {
    assert.equal(node.attributes.has('srcset'), false)
    assert.equal(node.attributes.has('sizes'), false)
    assert.equal(node.attributes.get('src'), '/member-photo.jpg')
  }
})

test('anonymous fallback src remains available and mobile scroll lock still toggles', () => {
  const avatar = image('/placeholder.avif')
  let click
  const body = boot([avatar], { addEventListener(type, handler) {
    assert.equal(type, 'click')
    click = handler
  } })
  assert.equal(avatar.attributes.get('src'), '/placeholder.avif')
  let prevented = 0
  const event = { preventDefault() { prevented++ } }
  click(event)
  assert.equal(body.style.overflow, 'hidden')
  click(event)
  assert.equal(body.style.overflow, 'auto')
  assert.equal(prevented, 2)
})
