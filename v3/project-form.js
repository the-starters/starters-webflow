/**
 * V3 Brand project / contract form adapter.
 *
 * Webflow owns the native form and every field. This module only:
 *   - binds the existing Brand /hire/<slug> "Contract Generation" form to
 *     the selected Starter's stable Memberstack identity;
 *   - serializes the existing named Webflow controls into the published Xano
 *     projects/create-direct/v3 contract;
 *   - supplies a retry-stable idempotency key and submits through Opp30's
 *     authenticated Memberstack -> Xano bridge;
 *   - projects safe pending/success/error state into authored elements;
 *   - owns the three prefill behaviors this form's Code Embeds used to provide:
 *     Memberstack hiring-manager name, CMS [data-sp-fill] attribute presets, and
 *     [data-set-current-date] initialization (see PROJECT-FORM-WIRING.md).
 *
 * Xano remains authoritative for identity, ownership, project creation,
 * PandaDoc, lifecycle state, and duplicate prevention. This script never
 * creates form HTML and intentionally ignores the separate "start-project"
 * modal. Only the Brand Hire modal with data-modal-target="generate-contract"
 * is in scope.
 */
;(function (global) {
  'use strict'

  if (!global || global.__startersV3ProjectFormBooted) return
  global.__startersV3ProjectFormBooted = true

  // Webflow applies Form Block custom attributes to the authored `.w-form`
  // wrapper, not its generated native `<form>`. Resolve the form through that
  // wrapper so the Designer remains the sole owner of the markup.
  var FORM_SELECTOR = 'dialog[data-modal-target="generate-contract"] [data-project-form-v3="brand"] form'
  var OPEN_SELECTOR = '[data-modal-trigger="generate-contract"]'
  var FIELD_ATTR = 'data-project-field'
  // `pushMemID` is an established CMS-bound control emitted by the target
  // modal's existing Code Embed on published pages. It is not present as a
  // selectable native Designer field, so scope the established ID to this
  // modal rather than editing the separate start-project embed.
  var SELECTED_STARTER_SELECTOR = 'dialog[data-modal-target="generate-contract"] #pushMemID'
  var CONTRACT_CHOICE_SELECTOR = '[data-project-contract-choice]'
  var PAYLOAD_CONTROL_SELECTOR = '[' + FIELD_ATTR + '], ' + CONTRACT_CHOICE_SELECTOR + ', [name], [type="submit"]'
  var CONTAINER_SELECTOR = '[data-project-form-container]'
  // Marks a Designer-authored `required` this adapter removed while its
  // conditional branch is hidden, so it can be put back unchanged.
  var REQUIRED_STASH_ATTR = 'data-project-required-hidden'
  var SUCCESS_SELECTOR = '[data-project-form-state="success"]'
  var INVOICE_FREQUENCY_NAME = 'invoice-frequency'
  var INVOICE_FREQUENCY_HIDDEN_ATTR = 'data-project-invoice-frequency-hidden'
  var HOURS_CAP_HIDDEN_ATTR = 'data-project-hours-cap-hidden'
  var MONTHLY_END_DATE_HIDDEN_ATTR = 'data-project-monthly-end-date-hidden'
  var MEMBER_NAME_SELECTOR = FORM_SELECTOR + ' [data-mscustom-fullname]'
  var MEMBER_NAME_FIELD = 'Hiring-Manager-Name'
  var SMART_FILL_TRIGGER_SELECTOR = '[data-sp-fill="button"]'
  var SMART_FILL_INPUT_SELECTOR = '[data-sp-fill="input"]'
  var CURRENT_DATE_SELECTOR = '[data-set-current-date]'
  var CURRENT_DATE_INIT_ATTR = 'data-set-current-date-inited'
  var DEFAULT_DATE_FORMAT = 'mm/dd/yy'
  var MEMBERSTACK_POLL_MS = 100
  var MEMBERSTACK_MAX_TRIES = 50
  var stateByForm = typeof WeakMap === 'function' ? new WeakMap() : null

  var ENGAGEMENT_TYPES = {
    'flat fee': 'flat_fee',
    flat_fee: 'flat_fee',
    'ongoing hourly': 'hourly',
    'on going hourly': 'hourly',
    'hourly rate': 'hourly',
    hourly: 'hourly',
    'weekly recurring': 'weekly',
    weekly: 'weekly',
    'monthly recurring': 'monthly',
    monthly: 'monthly',
  }

  // The V3 Designer contract uses canonical filter-item values. Keep the
  // legacy display labels as a transition reader so the CDN script can ship
  // before the separately governed Webflow attribute cutover. Canonical value
  // first: every panel lookup in this module resolves in this order.
  var ENGAGEMENT_PANEL_VALUES = {
    flat_fee: ['flat_fee', 'Flat Fee'],
    hourly: ['hourly', 'Ongoing Hourly'],
    weekly: ['weekly', 'Weekly Recurring'],
    monthly: ['monthly', 'Monthly Recurring'],
  }

  // One table drives both readers, so retiring the transition labels after the
  // Designer cutover is a single edit that cannot leave the two disagreeing.
  function panelSelectors(engagement, control) {
    return (ENGAGEMENT_PANEL_VALUES[engagement] || []).map(function (value) {
      return '[data-input-filter-item="' + value + '"] ' + control
    })
  }

  var MONTHLY_END_DATE_SELECTORS = panelSelectors('monthly', '[name="endDateInput"]')
  var HOURLY_END_DATE_SELECTORS = panelSelectors('hourly', '[name="endDateInput"]')
  var HOURLY_ONGOING_SELECTORS = panelSelectors('hourly', '[name="no-end-date"]')

  var SMART_FILL_CANONICALIZERS = {
    fee_structure: canonicalEngagement,
    invoice_frequency: canonicalInvoiceFrequency,
  }

  var NUMERIC_FIELDS = {
    total_cost: true,
    paid_upfront_pct: true,
    hourly_rate: true,
    weekly_rate: true,
    monthly_rate: true,
    estimated_hours: true,
    maximum_total_hours: true,
    maximum_hours_per_week: true,
    maximum_hours_per_month: true,
    number_of_weeks: true,
    number_of_months: true,
  }

  var INTEGER_FIELDS = {
    number_of_weeks: true,
    number_of_months: true,
  }

  function clean(value) {
    return String(value == null ? '' : value).trim()
  }

  function positiveId(value) {
    var normalized = clean(value)
    return /^\d+$/.test(normalized) && Number(normalized) > 0 ? Number(normalized) : null
  }

  function numberValue(value) {
    var normalized = clean(value).replace(/[$,%\s]/g, '')
    if (!normalized) return null
    var parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }

  function dateValue(value) {
    var normalized = clean(value)
    if (!normalized) return ''
    var iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
    var us = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(normalized)
    if (!iso && !us) return ''
    var year = Number(iso ? iso[1] : us[3])
    var month = Number(iso ? iso[2] : us[1])
    var day = Number(iso ? iso[3] : us[2])
    var candidate = new Date(Date.UTC(year, month - 1, day))
    if (
      candidate.getUTCFullYear() !== year ||
      candidate.getUTCMonth() !== month - 1 ||
      candidate.getUTCDate() !== day
    ) return ''
    return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')
  }

  function payloadSignature(payload) {
    var normalized = {}
    Object.keys(payload || {}).sort().forEach(function (name) {
      if (name !== 'idempotency_key') normalized[name] = payload[name]
    })
    return JSON.stringify(normalized)
  }

  function randomPart(cryptoObject) {
    if (cryptoObject && typeof cryptoObject.randomUUID === 'function') return cryptoObject.randomUUID()
    if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
      var values = new Uint32Array(4)
      cryptoObject.getRandomValues(values)
      return Array.prototype.map.call(values, function (value) {
        return value.toString(16).padStart(8, '0')
      }).join('')
    }
    return String(Date.now()) + ':' + String(Math.random()).slice(2)
  }

  function createIdempotencyKey(cryptoObject) {
    return 'direct-hire-ui:' + randomPart(cryptoObject)
  }

  function formField(form, name) {
    return form && form.querySelector
      ? form.querySelector('[' + FIELD_ATTR + '="' + name + '"]')
      : null
  }

  function setField(form, name, value) {
    var field = formField(form, name)
    if (!field) return false
    var normalized = value == null ? '' : String(value)
    field.value = normalized
    if (field.setAttribute) field.setAttribute('value', normalized)
    return true
  }

  function fieldValue(field) {
    if (!field) return ''
    var type = clean(field.type).toLowerCase()
    if ((type === 'checkbox' || type === 'radio') && !field.checked) return ''
    return clean(field.value)
  }

  function dispatchInputChange(field) {
    if (!field || !field.dispatchEvent || typeof global.Event !== 'function') return
    field.dispatchEvent(new global.Event('input', { bubbles: true }))
    field.dispatchEvent(new global.Event('change', { bubbles: true }))
  }

  function pickMemberField(fields, names) {
    var source = fields || {}
    for (var i = 0; i < names.length; i += 1) {
      var value = clean(source[names[i]])
      if (value) return value
    }
    return ''
  }

  // The legacy attribute hook plus the Designer-named control, resolved the way
  // every other named control in this module is: case- and separator-insensitively.
  // Only blank targets are returned, so an already-filled form never pays for
  // another Memberstack read or restarts the poll chain.
  function memberNameTargets(documentObject) {
    var tagged = documentObject.querySelectorAll(MEMBER_NAME_SELECTOR)
    var targets = tagged ? Array.prototype.slice.call(tagged) : []
    var form = documentObject.querySelector && documentObject.querySelector(FORM_SELECTOR)
    namedControls(form, MEMBER_NAME_FIELD).forEach(function (field) {
      if (targets.indexOf(field) === -1) targets.push(field)
    })
    return targets.filter(function (target) { return !clean(target.value) })
  }

  function fillMemberName(documentObject, globalObject, tries) {
    if (!documentObject || !documentObject.querySelectorAll) return Promise.resolve(false)
    var targets = memberNameTargets(documentObject)
    if (!targets.length) return Promise.resolve(false)
    var memberstack = globalObject && globalObject.$memberstackDom
    if (!memberstack || typeof memberstack.getCurrentMember !== 'function') {
      if ((tries || 0) >= MEMBERSTACK_MAX_TRIES || !globalObject || typeof globalObject.setTimeout !== 'function') {
        return Promise.resolve(false)
      }
      return new Promise(function (resolve) {
        globalObject.setTimeout(function () {
          resolve(fillMemberName(documentObject, globalObject, (tries || 0) + 1))
        }, MEMBERSTACK_POLL_MS)
      })
    }
    return Promise.resolve(memberstack.getCurrentMember()).then(function (member) {
      var fields = member && member.data && member.data.customFields
      var fullName = [
        pickMemberField(fields, ['free-user', 'first-name', 'First Name', 'firstName', 'first_name', 'firstname']),
        pickMemberField(fields, ['last-name', 'Last Name', 'lastName', 'last_name', 'lastname']),
      ].filter(Boolean).join(' ')
      if (!fullName) return false
      Array.prototype.forEach.call(targets, function (target) {
        if (clean(target.value)) return
        target.value = fullName
        dispatchInputChange(target)
      })
      return true
    }).catch(function () { return false })
  }

  function collectSmartFillPairs(trigger) {
    if (!trigger || !trigger.querySelectorAll) return []
    var sources = Array.prototype.slice.call(trigger.querySelectorAll('[data-sp-fill-category]'))
    if (trigger.getAttribute && trigger.getAttribute('data-sp-fill-category') !== null) sources.unshift(trigger)
    return sources.reduce(function (pairs, source) {
      var category = clean(source.getAttribute && source.getAttribute('data-sp-fill-category'))
      if (!category || !source.getAttribute || source.getAttribute('data-sp-fill-value') === null) return pairs
      pairs.push({ category: category, value: source.getAttribute('data-sp-fill-value') })
      return pairs
    }, [])
  }

  function smartFillTarget(documentObject, category) {
    if (!documentObject || !documentObject.querySelectorAll) return null
    var normalized = normalizedName(category)
    var form = documentObject.querySelector && documentObject.querySelector(FORM_SELECTOR)
    if (form) {
      // Prefer the authored control the serializer reads, but never let an
      // unresolvable one swallow a correctly tagged field.
      var native = normalized === 'fee_structure' ? engagementControl(form)
        : normalized === 'invoice_frequency' ? invoiceFrequencyControl(form)
        : null
      if (native) return native
    }
    var candidates = documentObject.querySelectorAll(FORM_SELECTOR + ' ' + SMART_FILL_INPUT_SELECTOR)
    var exact = Array.prototype.find.call(candidates, function (field) {
      return clean(field.getAttribute && field.getAttribute('data-sp-fill-category')) === category
    })
    if (exact) return exact
    return Array.prototype.find.call(candidates, function (field) {
      return normalizedName(field.getAttribute && field.getAttribute('data-sp-fill-category')) === normalized
    }) || null
  }

  function smartFillFields(target) {
    if (!target) return []
    var tag = clean(target.tagName).toUpperCase()
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return [target]
    return target.querySelectorAll ? Array.prototype.slice.call(target.querySelectorAll('input, select, textarea')) : []
  }

  // A Webflow radio group answers one preset with several controls sharing a
  // name, and every single-element resolution above returns whichever one is
  // currently checked. Widen to the whole group before matching, or a preset
  // for any other option can never find its radio.
  function radioGroup(documentObject, field) {
    var form = documentObject && documentObject.querySelector
      ? documentObject.querySelector(FORM_SELECTOR)
      : null
    var group = namedControls(form, field.getAttribute && field.getAttribute('name'))
    return group.length ? group : [field]
  }

  function applySmartFill(documentObject, category, value) {
    var fields = smartFillFields(smartFillTarget(documentObject, category))
    if (!fields.length) return false
    var first = fields[0]
    var tag = clean(first.tagName).toUpperCase()
    var wanted = value == null ? '' : String(value)
    var lower = wanted.toLowerCase()
    // Fee-structure and invoice-frequency presets and their authored options
    // are cut over on separate schedules, so match the preset the same way the
    // serializer reads the control: literally first, then by canonical value.
    var canonical = SMART_FILL_CANONICALIZERS[normalizedName(category)] || null
    var wantedCanonical = canonical ? canonical(wanted) : ''
    if (tag === 'SELECT') {
      var options = Array.prototype.slice.call(first.options || [])
      var option = options.find(function (item) { return item.value === wanted }) ||
        options.find(function (item) { return clean(item.value).toLowerCase() === lower }) ||
        options.find(function (item) { return clean(item.textContent) === wanted }) ||
        options.find(function (item) { return clean(item.textContent).toLowerCase() === lower })
      if (!option && wantedCanonical) {
        option = options.find(function (item) { return canonical(item.value) === wantedCanonical }) ||
          options.find(function (item) { return canonical(item.textContent) === wantedCanonical })
      }
      if (!option || first.disabled) return false
      // Select the matched option directly, so a select carrying duplicate
      // option values keeps the option the preset actually resolved.
      option.selected = true
      dispatchInputChange(first)
      return true
    }
    var type = clean(first.type).toLowerCase()
    if (type === 'radio') {
      var group = fields.length > 1 ? fields : radioGroup(documentObject, first)
      var radio = group.find(function (item) { return clean(item.value) === wanted }) ||
        group.find(function (item) { return clean(item.value).toLowerCase() === lower })
      if (!radio && wantedCanonical) {
        radio = group.find(function (item) { return canonical(item.value) === wantedCanonical })
      }
      if (!radio || radio.disabled) return false
      if (!radio.checked && typeof radio.click === 'function') radio.click()
      return true
    }
    if (type === 'checkbox') {
      // An explicit true/false always wins over the checkbox's own value, and
      // an unrecognized preset leaves the authored state alone.
      var own = clean(first.value).toLowerCase()
      var desired = lower === 'true' ? true
        : lower === 'false' ? false
        : own && own === lower ? true
        : null
      if (desired === null || first.disabled) return false
      if (first.checked !== desired && typeof first.click === 'function') first.click()
      return true
    }
    if (first.disabled) return false
    first.value = wanted
    dispatchInputChange(first)
    return true
  }

  function handleSmartFill(event, documentObject) {
    var trigger = event && event.target && event.target.closest
      ? event.target.closest(SMART_FILL_TRIGGER_SELECTOR)
      : null
    if (!trigger) return false
    collectSmartFillPairs(trigger).forEach(function (pair) {
      applySmartFill(documentObject, pair.category, pair.value)
    })
    return true
  }

  function formatCurrentDate(format, date, globalObject) {
    var jquery = globalObject && globalObject.jQuery
    if (jquery && jquery.datepicker) return jquery.datepicker.formatDate(format, date)
    var day = String(date.getDate()).padStart(2, '0')
    var month = String(date.getMonth() + 1).padStart(2, '0')
    return String(format || DEFAULT_DATE_FORMAT)
      .replace(/yy/g, String(date.getFullYear()))
      .replace(/mm/g, month)
      .replace(/dd/g, day)
  }

  function fillCurrentDates(scope, globalObject) {
    var root = scope && scope.querySelectorAll ? scope : null
    if (!root) return 0
    var targets = Array.prototype.slice.call(root.querySelectorAll(CURRENT_DATE_SELECTOR))
    if (root.matches && root.matches(CURRENT_DATE_SELECTOR)) targets.unshift(root)
    var filled = 0
    targets.forEach(function (field) {
      if (field.getAttribute && field.getAttribute(CURRENT_DATE_INIT_ATTR) === 'true') return
      var format = clean(field.getAttribute && (field.getAttribute('data-set-current-date') || field.getAttribute('data-input-datepicker-format'))) || DEFAULT_DATE_FORMAT
      var today = new globalObject.Date()
      var value = formatCurrentDate(format, today, globalObject)
      var tag = clean(field.tagName).toUpperCase()
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (clean(field.value)) {
          if (field.setAttribute) field.setAttribute(CURRENT_DATE_INIT_ATTR, 'true')
          return
        }
        field.value = value
        var jquery = globalObject && globalObject.jQuery
        if (jquery && jquery.fn && jquery.fn.datepicker && jquery(field).data('datepicker')) {
          jquery(field).datepicker('setDate', today)
        }
        dispatchInputChange(field)
      } else {
        field.textContent = value
      }
      if (field.setAttribute) field.setAttribute(CURRENT_DATE_INIT_ATTR, 'true')
      filled += 1
    })
    return filled
  }

  function activeControl(field) {
    if (!field || field.hidden) return false
    var node = field
    while (node && node !== field.form) {
      if (node.hidden || clean(node.getAttribute && node.getAttribute('aria-hidden')).toLowerCase() === 'true') return false
      var style = node.style || {}
      if (style.display === 'none' || style.visibility === 'hidden') return false
      node = node.parentElement
    }
    // Published Webflow conditional panels use display:none. offsetParent is
    // the cheapest reliable runtime signal while remaining test-DOM friendly.
    return field.offsetParent !== null || typeof field.offsetParent === 'undefined'
  }

  // Webflow keeps conditional branches in the native form when they are hidden,
  // and the browser runs interactive validation as the *default action* of the
  // submit click, before dispatching `submit`. A required control in an
  // inactive branch therefore aborts submission before this adapter is ever
  // called ("An invalid form control ... is not focusable"). Mirror the
  // established form-input-filter pattern instead: drop `required` while a
  // control is inactive and restore it the moment its branch becomes visible.
  function syncActiveRequired(form) {
    if (!form || !form.querySelectorAll) return
    var candidates = form.querySelectorAll('[required], [' + REQUIRED_STASH_ATTR + ']')
    Array.prototype.forEach.call(candidates, function (field) {
      var stashed = field.getAttribute && field.getAttribute(REQUIRED_STASH_ATTR) !== null
      if (activeControl(field)) {
        if (!stashed) return
        field.required = true
        if (field.setAttribute) field.setAttribute('required', '')
        if (field.removeAttribute) field.removeAttribute(REQUIRED_STASH_ATTR)
        return
      }
      if (stashed) return
      field.required = false
      if (field.removeAttribute) field.removeAttribute('required')
      if (field.setAttribute) field.setAttribute(REQUIRED_STASH_ATTR, 'true')
    })
  }

  function reportActiveValidity(form) {
    syncDurationFields(form)
    syncActiveRequired(form)
    if (!form || typeof form.reportValidity !== 'function') return true
    return form.reportValidity()
  }

  // Webflow derives a native control name from its Designer label, keeping the
  // author's capitalization and turning spaces into hyphens. Match on a
  // separator- and case-insensitive form so a label typed "Invoice frequency"
  // still resolves to the same allowlisted control as "Invoice-Frequency".
  function normalizedName(value) {
    return clean(value).toLowerCase().replace(/[\s_-]+/g, '_')
  }

  function namedControls(form, name) {
    var wanted = normalizedName(name)
    if (!wanted || !form || !form.querySelectorAll) return []
    return Array.prototype.filter.call(form.querySelectorAll('[name]'), function (field) {
      return normalizedName(field.getAttribute ? field.getAttribute('name') : field.name) === wanted
    })
  }

  function namedField(form, names) {
    var candidates = []
    ;(Array.isArray(names) ? names : [names]).forEach(function (name) {
      Array.prototype.push.apply(candidates, Array.prototype.slice.call(namedControls(form, name)))
    })
    if (!candidates.length) return null
    return candidates.find(function (field) { return activeControl(field) && fieldValue(field) }) ||
      candidates.find(activeControl) ||
      candidates.find(function (field) { return fieldValue(field) }) ||
      candidates[0]
  }

  // A comma-joined selector list resolves in document order, which would let a
  // legacy panel outrank the canonical one. Try each selector in turn instead,
  // so this matches how engagementPanel() picks the same panel.
  function firstControl(form, selectors) {
    if (!form || !form.querySelectorAll) return null
    for (var i = 0; i < selectors.length; i += 1) {
      var controls = form.querySelectorAll(selectors[i])
      if (controls && controls.length) return controls[0]
    }
    return null
  }

  function allControls(form, selectors) {
    if (!form || !form.querySelectorAll) return []
    return selectors.reduce(function (found, selector) {
      Array.prototype.push.apply(found, Array.prototype.slice.call(form.querySelectorAll(selector) || []))
      return found
    }, [])
  }

  // Mirrors how serialize() resolves a `[data-project-field]` value: skip
  // unchecked radios, and let a later populated control replace an earlier
  // blank one.
  function attributedField(form, name) {
    var fields = form && form.querySelectorAll ? form.querySelectorAll('[' + FIELD_ATTR + ']') : []
    var chosen = null
    Array.prototype.forEach.call(fields, function (field) {
      if (clean(field.getAttribute && field.getAttribute(FIELD_ATTR)) !== name) return
      if (clean(field.type).toLowerCase() === 'radio' && !field.checked) return
      if (chosen && !fieldValue(field)) return
      chosen = field
    })
    return chosen
  }

  function engagementControl(form) {
    return namedField(form, 'Fee-Structure')
  }

  // Single source of truth for "which fee panel is selected". The duration sync
  // and the serializer must never disagree about it, so both read it here: the
  // semantic data attribute wins, then the authored native control.
  function readEngagement(form) {
    var attributed = attributedField(form, 'engagement_type')
    if (attributed) return canonicalEngagement(fieldValue(attributed))
    return canonicalEngagement(fieldValue(engagementControl(form)))
  }

  function engagementPanel(form, engagement) {
    var values = ENGAGEMENT_PANEL_VALUES[engagement] || []
    if (!form || !form.querySelectorAll) return null
    for (var i = 0; i < values.length; i += 1) {
      var selector = '[data-input-filter-item="' + values[i] + '"]'
      var panels = Array.prototype.slice.call(form.querySelectorAll(selector))
      var panel = panels.find(function (candidate) {
        var ancestor = candidate && candidate.parentElement
        while (ancestor && ancestor !== form) {
          if (ancestor.getAttribute && ancestor.getAttribute('data-input-filter-item') !== null) return false
          ancestor = ancestor.parentElement
        }
        return true
      })
      if (panel) return panel
    }
    return null
  }

  function panelField(form, panel, names) {
    return namedField(panel || form, names)
  }

  function controlId(field) {
    if (!field) return ''
    var attributeId = field.getAttribute ? field.getAttribute('id') : null
    return clean(attributeId == null ? field.id : attributeId)
  }

  // The authored `<label for="...">` bound to this exact control. Matching on
  // the id rather than a selector keeps any Designer id safe to look up. The
  // Designer defaults a field id to its name, and the fee panels repeat those
  // names, so `root` must be the owning panel and never the whole form.
  function labelsFor(root, field) {
    var id = controlId(field)
    if (!id || !root || !root.querySelectorAll) return []
    return Array.prototype.filter.call(root.querySelectorAll('label'), function (label) {
      return clean(label.getAttribute && label.getAttribute('for')) === id
    })
  }

  // True when `node` wraps no interactive control other than `field`, and no
  // label belonging to another control, so hiding it cannot take a sibling
  // Designer field or its caption down with it.
  function wrapsOnly(node, field) {
    if (!node || !node.querySelectorAll) return false
    var controls = node.querySelectorAll('input, select, textarea')
    if (Array.prototype.some.call(controls, function (control) { return control !== field })) return false
    var id = controlId(field)
    return !Array.prototype.some.call(node.querySelectorAll('label'), function (label) {
      var target = clean(label.getAttribute && label.getAttribute('for'))
      return target !== '' && target !== id
    })
  }

  // Prefer the authored `app-form_input_group` wrapper, but never depend on it:
  // fall back to the closest exclusive ancestor so the label travels with the
  // control on any Designer markup. Conditional panels stay untouched because
  // form-input-filter owns their visibility.
  function inputGroup(field, form) {
    var node = field && field.parentElement
    var fallback = null
    while (node && node !== form) {
      if (node.getAttribute && node.getAttribute('data-input-filter-item') !== null) break
      if (!wrapsOnly(node, field)) break
      fallback = node
      var classes = clean(node.getAttribute && node.getAttribute('class')).split(/\s+/)
      if (classes.indexOf('app-form_input_group') !== -1) return node
      node = node.parentElement
    }
    return fallback
  }

  function hideElement(node) {
    if (!node) return
    node.hidden = true
    if (node.style) node.style.display = 'none'
    if (node.setAttribute) node.setAttribute('aria-hidden', 'true')
  }

  function showElement(node) {
    if (!node) return
    node.hidden = false
    if (node.style) node.style.display = ''
    if (node.removeAttribute) node.removeAttribute('aria-hidden')
  }

  // The one place a conditional control's visibility is written, so every
  // `data-project-*-hidden` marker provably means the same thing: hidden implies
  // disabled, not `required`, and hidden together with its labels and its
  // exclusive wrapper. `required` restoration is the caller's policy - some
  // re-derive it, some stash it for syncActiveRequired.
  function setFieldVisibility(field, group, labels, marker, visible) {
    if (!field) return
    if (!visible) {
      field.required = false
      field.disabled = true
      if (field.setAttribute) {
        field.setAttribute('disabled', '')
        field.setAttribute(marker, 'true')
        field.removeAttribute('required')
      }
      hideElement(field)
      labels.forEach(hideElement)
      hideElement(group)
      return
    }

    field.disabled = false
    if (field.removeAttribute) {
      field.removeAttribute('disabled')
      field.removeAttribute(marker)
    }
    showElement(group)
    labels.forEach(showElement)
    showElement(field)
  }

  function contractChoice(form) {
    return form && form.querySelector
      ? form.querySelector(CONTRACT_CHOICE_SELECTOR + ':checked') || form.querySelector('input[type="radio"]:checked')
      : null
  }

  function readContractType(form) {
    return canonicalContractType(fieldValue(contractChoice(form)))
  }

  function invoiceFrequencyControl(form) {
    return attributedField(form, 'invoice_frequency') || namedField(form, INVOICE_FREQUENCY_NAME)
  }

  function syncInvoiceFrequencyField(form) {
    var field = invoiceFrequencyControl(form)
    if (!field) return
    var type = readContractType(form)
    var visible = type !== 'own_contract'

    setFieldVisibility(field, inputGroup(field, form), labelsFor(form, field), INVOICE_FREQUENCY_HIDDEN_ATTR, visible)

    // Invoice Frequency re-derives `required` from the contract type on every
    // sync, so it never leaves a stash behind for syncActiveRequired to restore.
    if (field.removeAttribute) field.removeAttribute(REQUIRED_STASH_ATTR)
    if (!visible) return
    field.required = type === 'standard'
    if (field.required) {
      if (field.setAttribute) field.setAttribute('required', '')
    } else if (field.removeAttribute) {
      field.removeAttribute('required')
    }
  }

  function syncMonthlyDurationField(form) {
    // Monthly never submits an end date, so clear the control in every monthly
    // panel a mid-cutover page carries rather than only the resolved one.
    var controls = allControls(form, MONTHLY_END_DATE_SELECTORS)
    if (!controls.length) return
    var panel = engagementPanel(form, 'monthly') || form
    controls.forEach(function (field) {
      field.value = ''
      setFieldVisibility(field, inputGroup(field, form), labelsFor(panel, field), MONTHLY_END_DATE_HIDDEN_ATTR, false)
    })
  }

  function syncHourlyDurationChoice(form) {
    if (readEngagement(form) !== 'hourly') return
    var endDate = firstControl(form, HOURLY_END_DATE_SELECTORS)
    var ongoing = firstControl(form, HOURLY_ONGOING_SELECTORS)
    if (!endDate || !ongoing) return

    if (ongoing.checked) {
      endDate.value = ''
      endDate.disabled = true
      if (endDate.setAttribute) endDate.setAttribute('disabled', '')
    } else {
      endDate.disabled = false
      if (endDate.removeAttribute) endDate.removeAttribute('disabled')
    }

    // Fixed hourly uses the date. Ongoing hourly requires the explicit authored
    // checkbox. Requiring the checkbox unconditionally makes the fixed branch
    // impossible to submit even when a valid end date is present.
    var endDateProvided = Boolean(dateValue(endDate.value))
    ongoing.required = !endDateProvided
    if (ongoing.required) {
      if (ongoing.setAttribute) ongoing.setAttribute('required', '')
    } else if (ongoing.removeAttribute) {
      ongoing.removeAttribute('required')
    }
  }

  function syncHoursCapFields(form) {
    var panel = engagementPanel(form, 'hourly')
    if (!panel) return
    var frequencyField = attributedField(panel, 'hourly_billing_frequency') || namedField(panel, 'Frequency')
    var selected = readEngagement(form) === 'hourly'
      ? canonicalHourlyFrequency(fieldValue(frequencyField))
      : ''
    var fields = [
      { frequency: 'one_time', semantic: 'maximum_total_hours', native: 'Maximum-Hours-Billed' },
      { frequency: 'weekly', semantic: 'maximum_hours_per_week', native: 'Maximum-Hours-Billed-per-Week' },
      { frequency: 'monthly', semantic: 'maximum_hours_per_month', native: 'Maximum-Hours-Billed-per-Month' },
    ]

    fields.forEach(function (spec) {
      var field = attributedField(panel, spec.semantic) || namedField(panel, spec.native)
      if (!field) return
      var visible = selected === spec.frequency

      // Stash before the shared writer drops `required`, so syncActiveRequired
      // can restore it when this cadence becomes the selected one again.
      if (!visible) {
        var authoredRequired = field.getAttribute && field.getAttribute('required') !== null
        if (authoredRequired && field.getAttribute(REQUIRED_STASH_ATTR) === null) {
          field.setAttribute(REQUIRED_STASH_ATTR, 'true')
        }
      }

      // `inputGroup` stops at any `data-input-filter-item` ancestor: while the
      // Designer cutover is pending, form-input-filter still owns those nodes,
      // so hide only this control and its own labels rather than fighting it.
      setFieldVisibility(field, inputGroup(field, panel), labelsFor(panel, field), HOURS_CAP_HIDDEN_ATTR, visible)
    })
  }

  function syncDurationFields(form) {
    syncMonthlyDurationField(form)
    syncHourlyDurationChoice(form)
    syncHoursCapFields(form)
    syncInvoiceFrequencyField(form)
  }

  // The only place a payload field is normalized. Both entry points - the
  // `data-project-field` sweep and the native-name allowlist - go through it so
  // a field can never normalize differently depending on how it was resolved.
  function normalizePayloadValue(name, value) {
    if (INTEGER_FIELDS[name]) return positiveId(value)
    if (NUMERIC_FIELDS[name]) return numberValue(value)
    if (name === 'start_date' || name === 'estimated_end_date') return dateValue(value) || null
    if (name === 'hourly_billing_frequency') return canonicalHourlyFrequency(value) || null
    if (name === 'invoice_frequency') return canonicalInvoiceFrequency(value) || null
    return value
  }

  function setPayloadValue(payload, name, field) {
    if (!field || Object.prototype.hasOwnProperty.call(payload, name)) return
    payload[name] = normalizePayloadValue(name, fieldValue(field))
  }

  function canonicalEngagement(value) {
    var normalized = clean(value).toLowerCase()
    return ENGAGEMENT_TYPES[normalized] || ''
  }

  function canonicalContractType(value) {
    var normalized = clean(value).toLowerCase()
    if (normalized === 'my own contract' || normalized === 'own contract' || normalized === 'your contract' || normalized === 'own_contract') return 'own_contract'
    if (normalized === 'standard contract' || normalized === 'standard') return 'standard'
    return ''
  }

  function canonicalHourlyFrequency(value) {
    var normalized = clean(value).toLowerCase().replace(/[\s-]+/g, '_')
    if (normalized === 'one_time' || normalized === 'entire_project' || normalized === 'for_the_entire_project') return 'one_time'
    if (normalized === 'weekly' || normalized === 'per_week') return 'weekly'
    if (normalized === 'monthly' || normalized === 'per_month') return 'monthly'
    return ''
  }

  function canonicalInvoiceFrequency(value) {
    var normalized = clean(value).toLowerCase().replace(/[\s-]+/g, '_')
    if (normalized === 'weekly' || normalized === 'weekly_basis') return 'weekly'
    if (normalized === 'bi_weekly' || normalized === 'biweekly' || normalized === 'bi_weekly_basis') return 'bi_weekly'
    if (normalized === 'monthly' || normalized === 'monthly_basis') return 'monthly'
    if (normalized === 'upon_completion' || normalized === 'upon_completion_of_the_project') return 'upon_completion'
    return ''
  }

  function serialize(form, documentObject) {
    var payload = {}
    var fields = form && form.querySelectorAll
      ? form.querySelectorAll('[' + FIELD_ATTR + ']')
      : []
    Array.prototype.forEach.call(fields, function (field) {
      if (clean(field.type).toLowerCase() === 'radio' && !field.checked) return
      var name = clean(field.getAttribute && field.getAttribute(FIELD_ATTR))
      if (!name) return
      var value = fieldValue(field)
      // The live form authors one rate/date control per conditional fee panel.
      // Prefer the populated control rather than allowing a hidden blank panel
      // to win by DOM order.
      if (Object.prototype.hasOwnProperty.call(payload, name) && !value) return
      payload[name] = normalizePayloadValue(name, value)
    })

    // The authored form predates this adapter and already exposes stable native
    // Webflow names. Prefer semantic data attributes when present, then fill
    // the allowlisted payload from those native names. For repeated Amount,
    // Frequency, and date controls, namedField chooses the visible conditional
    // panel and never lets a hidden blank panel win.
    setPayloadValue(payload, 'title', namedField(form, 'Project-Name'))
    setPayloadValue(payload, 'service', namedField(form, 'Services'))
    setPayloadValue(payload, 'engagement_type', engagementControl(form))
    setPayloadValue(payload, 'project_scope', namedField(form, 'Project-Scope'))
    if (!canonicalInvoiceFrequency(payload.invoice_frequency)) {
      delete payload.invoice_frequency
      setPayloadValue(payload, 'invoice_frequency', namedField(form, INVOICE_FREQUENCY_NAME))
    }

    var authoredEngagement = readEngagement(form)
    var authoredPanel = engagementPanel(form, authoredEngagement)
    setPayloadValue(payload, 'start_date', panelField(form, authoredPanel, 'startDateInput'))
    setPayloadValue(payload, 'estimated_end_date', panelField(form, authoredPanel, 'endDateInput'))
    setPayloadValue(payload, 'paid_upfront_pct', panelField(form, authoredPanel, 'Percent-Paid-Upfront'))
    setPayloadValue(payload, 'maximum_total_hours', panelField(form, authoredPanel, 'Maximum-Hours-Billed'))
    setPayloadValue(payload, 'maximum_hours_per_week', panelField(form, authoredPanel, 'Maximum-Hours-Billed-per-Week'))
    setPayloadValue(payload, 'maximum_hours_per_month', panelField(form, authoredPanel, 'Maximum-Hours-Billed-per-Month'))
    setPayloadValue(payload, 'number_of_weeks', panelField(form, authoredPanel, 'Number-of-Weeks'))
    setPayloadValue(payload, 'number_of_months', panelField(form, authoredPanel, 'Number-of-Months'))

    var authoredAmount = panelField(form, authoredPanel, 'Amount')
    var authoredFrequency = panelField(form, authoredPanel, 'Frequency')
    if (authoredEngagement === 'flat_fee') setPayloadValue(payload, 'total_cost', authoredAmount)
    if (authoredEngagement === 'hourly') {
      setPayloadValue(payload, 'hourly_rate', authoredAmount)
      setPayloadValue(payload, 'hourly_billing_frequency', authoredFrequency)
    }
    if (authoredEngagement === 'weekly') setPayloadValue(payload, 'weekly_rate', authoredAmount)
    if (authoredEngagement === 'monthly') setPayloadValue(payload, 'monthly_rate', authoredAmount)

    // Reuse the target modal's existing CMS-bound Starter identity control
    // instead of duplicating its CMS binding or generating a hidden field.
    if (!clean(payload.starter_memberstack_id) && documentObject && documentObject.querySelector) {
      payload.starter_memberstack_id = fieldValue(documentObject.querySelector(SELECTED_STARTER_SELECTOR))
    }

    payload.engagement_type = canonicalEngagement(payload.engagement_type)
    payload.contract_type = readContractType(form)
    // Own Contract has no generated invoice schedule. Leave the key out rather
    // than sending an empty one, so the only shape Xano ever sees for an absent
    // invoice frequency is the absent key.
    if (payload.contract_type === 'own_contract') delete payload.invoice_frequency

    // Webflow keeps inactive conditional panels in the DOM. Clear their stale
    // commercial values so only the selected pricing contract crosses the API.
    if (payload.engagement_type !== 'flat_fee') {
      payload.total_cost = null
      payload.paid_upfront_pct = null
    }
    if (payload.engagement_type !== 'hourly') {
      payload.hourly_rate = null
      payload.hourly_billing_frequency = null
      payload.maximum_total_hours = null
      payload.maximum_hours_per_week = null
      payload.maximum_hours_per_month = null
    } else if (payload.hourly_billing_frequency === 'one_time') {
      payload.maximum_hours_per_week = null
      payload.maximum_hours_per_month = null
    } else if (payload.hourly_billing_frequency === 'weekly') {
      payload.maximum_total_hours = null
      payload.maximum_hours_per_month = null
    } else if (payload.hourly_billing_frequency === 'monthly') {
      payload.maximum_total_hours = null
      payload.maximum_hours_per_week = null
    }
    if (payload.engagement_type !== 'weekly') {
      payload.weekly_rate = null
      payload.number_of_weeks = null
    }
    if (payload.engagement_type !== 'monthly') {
      payload.monthly_rate = null
      payload.number_of_months = null
    }
    // V2 derives monthly and weekly fixed end dates from their count. Never
    // leak a stale or visibly authored end-date value from another Webflow
    // conditional panel into those server-owned duration branches.
    if (payload.engagement_type === 'weekly' || payload.engagement_type === 'monthly') {
      payload.estimated_end_date = null
    }
    return { payload: payload }
  }

  function validationError(serialized) {
    var payload = serialized.payload
    if (!clean(payload.starter_memberstack_id)) return 'The selected Starter could not be identified. Reload and try again.'
    if (!payload.engagement_type) return 'Choose a supported fee structure.'
    if (!payload.contract_type) return 'Choose a contract type.'
    if (payload.contract_type === 'standard' && !payload.invoice_frequency) return 'Choose an invoice frequency.'
    if (!clean(payload.title)) return 'Enter a project name.'
    if (!clean(payload.service)) return 'Choose a service.'
    if (!payload.start_date) return 'Enter a valid start date.'
    if (!clean(payload.project_scope)) return 'Add the project scope.'
    if (payload.engagement_type === 'flat_fee' && !(payload.total_cost > 0)) return 'Enter a total project cost.'
    if (payload.engagement_type === 'hourly' && !(payload.hourly_rate > 0)) return 'Enter an hourly rate.'
    if (payload.engagement_type === 'hourly' && !payload.hourly_billing_frequency) return 'Choose an hours cap period.'
    if (payload.engagement_type === 'hourly' && payload.hourly_billing_frequency === 'one_time' && !(payload.maximum_total_hours > 0)) return 'Enter the maximum permitted hours for the entire project.'
    if (payload.engagement_type === 'hourly' && payload.hourly_billing_frequency === 'weekly' && !(payload.maximum_hours_per_week > 0)) return 'Enter the maximum permitted hours per week.'
    if (payload.engagement_type === 'hourly' && payload.hourly_billing_frequency === 'monthly' && !(payload.maximum_hours_per_month > 0)) return 'Enter the maximum permitted hours per month.'
    if (payload.contract_type === 'standard' && payload.engagement_type === 'flat_fee' && !payload.estimated_end_date) return 'Enter an estimated end date.'
    if (payload.estimated_end_date && payload.estimated_end_date <= payload.start_date) return 'The estimated end date must be after the start date.'
    if (payload.engagement_type === 'weekly' && !(payload.weekly_rate > 0)) return 'Enter a weekly rate.'
    if (payload.engagement_type === 'monthly' && !(payload.monthly_rate > 0)) return 'Enter a monthly rate.'
    if (payload.paid_upfront_pct != null && (payload.paid_upfront_pct < 0 || payload.paid_upfront_pct > 100)) {
      return 'Paid upfront must be between 0% and 100%.'
    }
    return ''
  }

  function state(form) {
    if (!stateByForm) {
      form.__projectFormV3State = form.__projectFormV3State || { active: null, key: '', keyPayload: '', lockedFields: null }
      return form.__projectFormV3State
    }
    var current = stateByForm.get(form)
    if (!current) {
      current = { active: null, key: '', keyPayload: '', lockedFields: null }
      stateByForm.set(form, current)
    }
    return current
  }

  function setFormLocked(form, locked) {
    var formState = state(form)
    if (locked) {
      if (formState.lockedFields) return
      var fields = form.querySelectorAll(PAYLOAD_CONTROL_SELECTOR)
      formState.lockedFields = Array.prototype.map.call(fields, function (field) {
        var wasDisabled = Boolean(field.disabled)
        field.disabled = true
        return { field: field, wasDisabled: wasDisabled }
      })
      return
    }
    if (!formState.lockedFields) return
    formState.lockedFields.forEach(function (entry) {
      entry.field.disabled = entry.wasDisabled
    })
    formState.lockedFields = null
  }

  function setStatus(form, status, message) {
    form.setAttribute('data-project-form-status', status)
    form.setAttribute('aria-busy', status === 'submitting' ? 'true' : 'false')
    setFormLocked(form, status === 'submitting')
    var wrapper = formContainer(form)
    var error = form.querySelector('[data-project-form-state="error"]') ||
      (wrapper && (wrapper.querySelector('[data-project-form-state="error"]') || wrapper.querySelector('.w-form-fail')))
    if (error) {
      error.textContent = status === 'error' ? message : ''
      error.hidden = status !== 'error'
      error.style.display = status === 'error' ? 'block' : 'none'
      if (error.setAttribute) error.setAttribute('role', 'alert')
    }
    var submitters = form.querySelectorAll('[type="submit"], [data-project-submit]')
    Array.prototype.forEach.call(submitters, function (button) {
      button.disabled = status === 'submitting'
      button.setAttribute('aria-disabled', status === 'submitting' ? 'true' : 'false')
    })
  }

  function safeError(error) {
    var status = error && Number(error.status)
    if (status === 401) return 'Your session expired. Sign in again and retry.'
    if (status === 403) return 'This project is not available for your Brand account.'
    if (status === 409) return 'This project request was already accepted.'
    if (status === 400 || status === 422) return 'Review the project details and try again.'
    return 'The project could not be created. Please retry.'
  }

  function formForTrigger(trigger, documentObject) {
    return documentObject.querySelector(FORM_SELECTOR)
  }

  function formContainer(form) {
    return form && form.closest ? form.closest(CONTAINER_SELECTOR) : null
  }

  function bindTrigger(trigger, documentObject) {
    var form = formForTrigger(trigger, documentObject)
    if (!form) return false
    var formState = state(form)
    if (formState.active) return false
    form.style.display = ''
    var wrapper = formContainer(form)
    var priorSuccess = wrapper && (wrapper.querySelector(SUCCESS_SELECTOR) || wrapper.querySelector('.w-form-done'))
    if (priorSuccess) {
      priorSuccess.hidden = true
      priorSuccess.style.display = 'none'
    }
    if (formState.key && formState.keyPayload !== payloadSignature(serialize(form, documentObject).payload)) {
      formState.key = ''
      formState.keyPayload = ''
      setField(form, 'idempotency_key', '')
    }
    syncDurationFields(form)
    syncActiveRequired(form)
    fillCurrentDates(form, global)
    fillMemberName(documentObject, global, 0)
    if (!fieldValue(documentObject.querySelector(SELECTED_STARTER_SELECTOR))) {
      setStatus(form, 'error', 'The selected Starter could not be identified. Reload and try again.')
      return false
    }
    setStatus(form, 'ready', '')
    return true
  }

  function projectApi(globalObject) {
    var api = globalObject && globalObject.Opp30 && globalObject.Opp30.API
    return api && typeof api.projectDirectCreate === 'function' ? api.projectDirectCreate : null
  }

  function showSuccess(form, result, documentObject) {
    setStatus(form, 'success', '')
    var formState = state(form)
    formState.key = ''
    formState.keyPayload = ''
    setField(form, 'idempotency_key', '')
    var wrapper = formContainer(form)
    var success = wrapper && (wrapper.querySelector(SUCCESS_SELECTOR) || wrapper.querySelector('.w-form-done'))
    if (success) {
      success.hidden = false
      success.style.display = 'block'
      form.style.display = 'none'
    }
    var project = result && result.project
    var projectId = positiveId(project && project.id)
    if (typeof global.CustomEvent === 'function' && documentObject && documentObject.dispatchEvent) {
      documentObject.dispatchEvent(new global.CustomEvent('starters:project-created', {
        detail: { project_id: projectId, replayed: Boolean(result && result.replayed) },
      }))
    }
    if (global.StartersTrack && typeof global.StartersTrack.track === 'function') {
      global.StartersTrack.track('project_created', { project_id: projectId })
    }
  }

  function submit(form, globalObject, documentObject) {
    var formState = state(form)
    if (formState.active) return formState.active
    // Hidden required controls must not block a different authored branch (for
    // example, the own-contract confirmation checkbox while Standard contract
    // is selected), while visible required controls still gate submission.
    if (!reportActiveValidity(form)) return Promise.resolve(false)

    var serialized = serialize(form, documentObject)
    var error = validationError(serialized)
    if (error) {
      setStatus(form, 'error', error)
      return Promise.resolve(false)
    }

    var signature = payloadSignature(serialized.payload)
    if (formState.key && formState.keyPayload !== signature) formState.key = ''
    if (!formState.key) {
      formState.key = createIdempotencyKey(globalObject.crypto)
      formState.keyPayload = signature
    }
    serialized.payload.idempotency_key = formState.key
    setField(form, 'idempotency_key', formState.key)

    var createProject = projectApi(globalObject)
    if (!createProject) {
      setStatus(form, 'error', 'The project service is not available. Reload and retry.')
      return Promise.resolve(false)
    }

    setStatus(form, 'submitting', '')
    formState.active = Promise.resolve()
      .then(function () { return createProject(serialized.payload) })
      .then(function (result) {
        showSuccess(form, result, documentObject)
        return true
      })
      .catch(function (requestError) {
        setStatus(form, 'error', safeError(requestError))
        return false
      })
      .finally(function () { formState.active = null })
    return formState.active
  }

  function install(documentObject, globalObject) {
    if (!documentObject || !documentObject.addEventListener) return
    documentObject.addEventListener('click', function (event) {
      handleSmartFill(event, documentObject)
      var target = event.target
      var trigger = target && target.closest ? target.closest(OPEN_SELECTOR) : null
      if (trigger) {
        bindTrigger(trigger, documentObject)
        return
      }
      // Event dispatch completes before the click's default action, so this is
      // the last point at which the authored required state can be corrected
      // ahead of the browser's interactive validation.
      var clickedForm = target && target.closest ? target.closest(FORM_SELECTOR) : null
      if (clickedForm) {
        syncDurationFields(clickedForm)
        syncActiveRequired(clickedForm)
      }
    })
    documentObject.addEventListener('change', function (event) {
      // Switching fee structure or contract type swaps which conditional panel
      // is visible; keep required aligned for implicit (Enter key) submission.
      var field = event.target
      var form = field && field.closest ? field.closest(FORM_SELECTOR) : null
      if (form) {
        syncDurationFields(form)
        syncActiveRequired(form)
      }
    })
    documentObject.addEventListener('input', function (event) {
      var field = event.target
      var form = field && field.closest ? field.closest(FORM_SELECTOR) : null
      if (!form || field.getAttribute(FIELD_ATTR) === 'idempotency_key') return
      syncDurationFields(form)
      syncActiveRequired(form)
      var formState = state(form)
      if (formState.active) return
      formState.key = ''
      formState.keyPayload = ''
      setField(form, 'idempotency_key', '')
    })
    documentObject.addEventListener('submit', function (event) {
      var form = event.target && event.target.closest ? event.target.closest(FORM_SELECTOR) : null
      if (!form) return
      event.preventDefault()
      event.stopImmediatePropagation()
      submit(form, globalObject, documentObject)
    }, true)

    var initialForm = documentObject.querySelector && documentObject.querySelector(FORM_SELECTOR)
    if (initialForm) {
      syncDurationFields(initialForm)
      fillCurrentDates(initialForm, globalObject)
      fillMemberName(documentObject, globalObject, 0)
    }
  }

  var api = {
    positiveId: positiveId,
    numberValue: numberValue,
    dateValue: dateValue,
    canonicalEngagement: canonicalEngagement,
    canonicalContractType: canonicalContractType,
    canonicalHourlyFrequency: canonicalHourlyFrequency,
    canonicalInvoiceFrequency: canonicalInvoiceFrequency,
    fillMemberName: fillMemberName,
    collectSmartFillPairs: collectSmartFillPairs,
    smartFillTarget: smartFillTarget,
    applySmartFill: applySmartFill,
    handleSmartFill: handleSmartFill,
    formatCurrentDate: formatCurrentDate,
    fillCurrentDates: fillCurrentDates,
    syncInvoiceFrequencyField: syncInvoiceFrequencyField,
    syncHoursCapFields: syncHoursCapFields,
    syncDurationFields: syncDurationFields,
    syncActiveRequired: syncActiveRequired,
    reportActiveValidity: reportActiveValidity,
    createIdempotencyKey: createIdempotencyKey,
    serialize: serialize,
    validationError: validationError,
    bindTrigger: bindTrigger,
    submit: submit,
    install: install,
  }
  global.StartersProjectFormV3 = api
  if (global.document) install(global.document, global)
})(typeof window !== 'undefined' ? window : null)
