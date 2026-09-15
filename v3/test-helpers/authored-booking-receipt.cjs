const fs = require('node:fs')
const assert = require('node:assert/strict')

function authoredBookingReceipt(popup) {
  const html = fs.readFileSync(require.resolve('../browser-tests/booking-details.html'), 'utf8')
  const start = html.indexOf('<div schedule-step="success"')
  assert.ok(start >= 0)
  const nodes = []
  const stack = []
  for (const token of html.slice(start).match(/<[^>]+>|[^<]+/g)) {
    if (token.startsWith('</')) {
      stack.pop()
      if (!stack.length) break
    } else if (token.startsWith('<')) {
      const attrs = Object.fromEntries(Array.from(token.matchAll(/([\w-]+)(?:="([^"]*)")?/g))
        .slice(1).map(match => [match[1], match[2] || '']))
      const element = {
        attributes: attrs,
        children: [],
        parentElement: stack.at(-1) || null,
        style: { display: /display\s*:\s*([^;]+)/.exec(attrs.style || '')?.[1] || '' },
        getAttribute(name) { return this.attributes[name] ?? null },
        hasAttribute(name) { return Object.hasOwn(this.attributes, name) },
        setAttribute(name, value) { this.attributes[name] = String(value) },
        removeAttribute(name) { delete this.attributes[name] },
        closest(selector) {
          const name = selector.slice(1, -1)
          for (let node = this; node; node = node.parentElement) {
            if (node.hasAttribute(name)) return node
          }
          return null
        },
        get innerHTML() { return this.content ?? this.children.map(child => typeof child === 'string' ? child : child.outerHTML).join('') },
        set innerHTML(value) { this.content = value },
        get outerHTML() { return token + this.innerHTML + '</' + token.match(/^<([\w-]+)/)[1] + '>' },
        get textContent() { return this.content ?? this.children.map(child => typeof child === 'string' ? child : child.textContent).join('') },
        set textContent(value) { this.content = String(value) },
      }
      if (element.parentElement) element.parentElement.children.push(element)
      nodes.push(element)
      stack.push(element)
    } else if (stack.length) stack.at(-1).children.push(token)
  }
  const fields = {}
  for (const node of nodes) {
    const name = node.getAttribute('booking-element')
    if (name) (fields[name] ||= []).push(node)
  }
  const groups = nodes.filter(node => node.hasAttribute('booking-element-wrap'))
  const snapshots = nodes.filter(node => ['start-date', 'start-time', 'starter-name', 'context', 'price'].includes(node.getAttribute('booking-element'))).map(node => ({ node, html: node.innerHTML, parent: node.parentElement }))
  const visibility = groups.map(node => ({ node, display: node.style.display, ariaHidden: node.getAttribute('aria-hidden') }))
  const originalQuery = popup.querySelectorAll.bind(popup)
  popup.querySelectorAll = function (selector) {
    const field = /^\[schedule-step="success"\] \[booking-element="([^"]+)"\]$/.exec(selector)
    return field ? fields[field[1]] || [] : originalQuery(selector)
  }
  return {
    fields,
    groups,
    assertRestored() {
      for (const { node, html, parent } of snapshots) {
        assert.equal(node.innerHTML, html)
        assert.equal(node.parentElement, parent)
      }
      for (const { node, display, ariaHidden } of visibility) {
        assert.equal(node.style.display, display)
        assert.equal(node.getAttribute('aria-hidden'), ariaHidden)
      }
    },
    assertVisible(name, visible, value) {
      assert.ok(fields[name].length)
      for (const field of fields[name]) {
        if (value !== undefined) assert.equal(field.textContent, value)
        const group = field.closest('[booking-element-wrap]')
        assert.equal(group.style.display, visible ? (group.hasAttribute('display-flex') ? 'flex' : 'block') : 'none')
        assert.equal(group.getAttribute('aria-hidden'), visible ? 'false' : 'true')
      }
    },
  }
}
module.exports = { authoredBookingReceipt }
