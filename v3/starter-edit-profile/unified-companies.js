/*
 * Opt-in Work Experience rows. Persistence stays in company-experience-crud.js.
 *
 * @release v1.59.607
 */
;(function () {
  'use strict'
  if (window.StarterProfileCompanies) return
  const bound = new WeakSet()
  let uid = 0
  const ROW = '[profile-item-row]'
  const FIELD = '[profile-company-field]'
  const names = ['company_name', 'job_title', 'start_date', 'end_date', 'current_work']
  async function bind(section, writer) {
    if (bound.has(section)) return
    bound.add(section)
    const save = section.querySelector('[data-edit-submit="companies"]')
    // A row is cloned and rebuilt, so a marker authored inside one is stripped here - before the
    // template clone - rather than adopted, and every cloned row stays free of it.
    const authored = attribute => {
      const selector = '[' + attribute + ']'
      const outside = []
      for (const node of section.querySelectorAll(selector)) {
        if (node.closest(ROW)) node.removeAttribute(attribute)
        else outside.push(node)
      }
      return outside[0]
    }
    // Webflow may author the status element so Designer owns its look; create one only when
    // it did not, and never a second.
    let status = authored('profile-items-status')
    if (!status) {
      status = document.createElement('div')
      status.setAttribute('profile-items-status', '')
      section.appendChild(status)
    }
    status.setAttribute('role', 'status')
    // Same for the check control: adopt the authored one, keeping the label its author wrote.
    // Adopted before any early return so a halted section never leaves a live check control.
    let check = authored('profile-items-check-save')
    if (!check) {
      check = document.createElement('button')
      check.setAttribute('profile-items-check-save', '')
      section.appendChild(check)
    }
    if (check.tagName === 'BUTTON') check.setAttribute('type', 'button')
    // Authored children are the label, so only a wholly empty control gets the default copy.
    if (!check.children.length && !check.textContent.trim()) check.textContent = 'Check saved state'
    // A div has no native activation; an anchor activates on Enter but never on Space.
    if (check.tagName !== 'BUTTON') {
      if (check.tagName !== 'A') {
        if (!check.hasAttribute('role')) check.setAttribute('role', 'button')
        if (!check.hasAttribute('tabindex')) check.setAttribute('tabindex', '0')
      }
      const keys = check.tagName === 'A' ? [' '] : ['Enter', ' ']
      check.addEventListener('keydown', event => {
        if (event.target !== check || !keys.includes(event.key)) return
        event.preventDefault()
        check.dispatchEvent(new Event('click'))
      })
    }
    // Class rules beat [hidden]; write display too, and revert it if a class still hides the node.
    const show = (node, visible) => {
      if (!node) return
      node.hidden = !visible
      node.style.display = visible ? '' : 'none'
      if (visible && window.getComputedStyle?.(node)?.display === 'none') node.style.display = 'revert'
    }
    show(check, false)
    const original = section.querySelector(ROW)
    const template = original?.cloneNode(true)
    const parent = original?.parentElement
    // Every row control the section drives is Designer's. The accordion opens a row through
    // its control and its panel; Undo replaces Remove in place; and Remove's own themed Button
    // carries the enabled theme the disabled state is swapped back from, so that theme has to
    // be an enabled one - a tree saved showing the disabled state would otherwise teach every
    // row that 'disabled' is what Remove looks like when it is usable. A row missing any of
    // them is the same kind of markup gap as a missing row.
    const authoredRemove = template?.querySelector('[profile-item-remove]')
    const authoredTheme = authoredRemove?.querySelector('[data-button-theme]')?.getAttribute('data-button-theme') || ''
    const complete = !!template?.querySelector('[profile-item-toggle]') && !!template?.querySelector('[profile-item-content]')
      && !!template?.querySelector('[profile-items-undo]')
      && !!authoredTheme && authoredTheme !== 'disabled' && !!authoredRemove.querySelector('button, input, a')
    if (!template || !parent || !save || !complete) {
      // The row is also the template for every added row, and Save is the only route to the
      // writer. Without either, report the markup gap and disable Save instead of leaving a
      // live control that silently does nothing.
      console.warn('[unified-companies] missing [profile-item-row] with [profile-item-toggle], [profile-item-content], [profile-items-undo] and a [profile-item-remove] button themed with an enabled theme, or Save control in section')
      status.textContent = 'This section could not load. Reload the page before editing.'
      save?.setAttribute('disabled', '')
      return
    }
    // The company picker is how a row acquires the identity Save requires: without it
    // `selection()` never matches what was typed, so every Save would stop on
    // "Choose a company from the list" with nothing a Starter could do about it. Report the
    // missing script the same way as missing row markup rather than failing open.
    if (typeof window.StarterEditLogoSearchInit !== 'function') {
      console.warn('[unified-companies] missing company-autocomplete.js: window.StarterEditLogoSearchInit is not a function')
      status.textContent = 'This section could not load. Reload the page before editing.'
      save.setAttribute('disabled', '')
      return
    }
    // Opening and collapsing a row is the site's accordion behavior, so it comes from the
    // shared script rather than a second copy living here. Its absence is reported the same
    // way as missing row markup instead of quietly falling back to a private implementation.
    if (typeof window.StarterAccordions?.group !== 'function') {
      console.warn('[unified-companies] missing accordions.js: window.StarterAccordions.group is not a function')
      status.textContent = 'This section could not load. Reload the page before editing.'
      save.setAttribute('disabled', '')
      return
    }
    // One Work Experience entry is open at a time. The rows own their own click handling,
    // because opening depends on save and removal state the accordion cannot see, so the
    // shared group is asked not to bind a competing handler on the same control.
    const accordion = window.StarterAccordions.group({ closePrevious: true, bindControl: false })
    let records = []
    let baseline = []
    let active = null
    let saving = false
    let loading = true
    let unknown = null
    let misconfigured = false
    let warned = false
    // The shared validator reveals every failure and then focuses the first one. Only one row
    // can be open, so a later reveal would collapse the row whose field is about to take focus.
    let revealed = null
    const add = section.querySelector('[profile-items-add]')
    const discard = section.querySelector('[profile-items-discard]')
    // Keep every generated row in the authored template's position, ahead of Add.
    const anchor = document.createElement('span')
    anchor.hidden = true
    anchor.style.display = 'none'
    parent.insertBefore(anchor, original)
    function refreshRows() {
      for (const record of records) {
        const saved = confirmedRow(record)
        // A saved row keeps the identity the server confirmed while its edits are pending. A row
        // that has never been saved has no confirmed identity, so its heading follows what has
        // been typed into it - otherwise every new row would read the same bare heading.
        const identity = saved || { company_name: input(record.row, 'company_name')?.value,
          job_title: input(record.row, 'job_title')?.value }
        const label = [identity.company_name, identity.job_title]
          .map(part => String(part || '').trim()).filter(Boolean).join(' · ')
        const summary = record.row.querySelector('[profile-items-summary]')
        if (summary) summary.textContent = label ? 'Work Experience (' + label + ')' : 'Work Experience'
        const changed = record.removed || (saved ? !unchanged(saved, values(record)) : present(record))
        show(record.badge, changed)
        const disabled = !removable(record)
        record.remove.setAttribute('aria-disabled', String(disabled))
        record.removeControl.disabled = disabled
        record.removeControl.setAttribute('aria-disabled', String(disabled))
        record.removeWrap.setAttribute('data-button-theme', disabled ? 'disabled' : record.removeTheme)
      }
    }
    // A field authored `form-xano-required` without the Webflow Required checkbox would let a
    // Starter submit a blank value the Xano writer refuses. Requiredness still comes only from
    // Required; this pauses Save on the mismatch instead of inventing a JavaScript requirement.
    function checkMisconfigured() {
      // Only the row fields this section submits. A marker on anything else authored inside the
      // section belongs to the script that writes it, not to Work Experience.
      const fields = window.StarterProfileValidation.misconfigured(section,
        { applies: field => field.hasAttribute('profile-company-field') })
      misconfigured = fields.length > 0
      if (misconfigured) {
        status.textContent = 'This form is misconfigured. Saving is paused until it is fixed.'
        if (!warned) {
          warned = true
          console.warn('[unified-companies] form-xano-required without required:',
            Array.from(new Set(fields.map(field => field.getAttribute('profile-company-field') || ''))))
        }
      }
      return misconfigured
    }
    const input = (row, key) => row.querySelector('[profile-company-field="' + key + '"]')
    const remaining = () => records.filter(record => !record.removed)
    const present = record => !!record.id || names.some(key => key === 'current_work'
      ? input(record.row, key)?.checked : String(input(record.row, key)?.value || '').trim())
    // The baseline is the one record of what the server confirmed, so the heading and the row
    // status read it rather than a second per-row copy that Save would not agree with.
    const confirmedRow = record => record.id
      ? baseline.find(item => String(item.id) === String(record.id)) || null : null
    // Never leave the section with no row at all, and never let a blank added row make the last
    // filled entry removable: Save deletes a removed saved row whether or not a blank one exists.
    const removable = record => remaining().length > 1
      && (!present(record) || remaining().filter(present).length > 1)
    const copy = value => JSON.parse(JSON.stringify(value))
    // A current role stores 'Present' as its end date and also carries the flag. A row that
    // carries one and not the other is describing the same state, not a different one.
    const endsNow = value => !!value.current_work || String(value.end_date || '') === 'Present'
    // Only a request that actually left the browser can leave an outcome in doubt, so the
    // writer counts its dispatches.
    const dispatches = () => writer.dispatches()
    const dispatchedSince = count => dispatches() !== count
    function selection(row) {
      const field = input(row, 'company_name')
      const data = field?.dataset || {}
      if (String(data.selectedCompanyName || '').trim() !== String(field?.value || '').trim()) return null
      return { company_domain: data.selectedCompanyDomain || '', company_logo_url: data.selectedCompanyLogoUrl || '',
        company_entity_id: Number(data.selectedCompanyEntityId) || 0, company_source: data.selectedCompanySource || '' }
    }
    function values(record) {
      const value = Object.fromEntries(names.map(key => [key, key === 'current_work' ? !!input(record.row, key)?.checked
        : String(input(record.row, key)?.value || '').trim()]))
      for (const key of ['start_date', 'end_date']) {
        // Only a real saved date can be restored from its displayed month. The 'Present'
        // sentinel displays as an empty field, so restoring it would turn a cleared End
        // month into a literal end date the Starter never entered.
        const saved = record.dates?.[key]
        if (saved && saved.display === value[key] && writer.parseDate(saved.raw)) value[key] = saved.raw
      }
      if (value.current_work) value.end_date = 'Present'
      return { ...value, ...(selection(record.row) || { company_domain: '', company_logo_url: '', company_entity_id: 0, company_source: '' }) }
    }
    // An animated open renders on the next frame, so a panel opened that way is still
    // `display: none` when this function returns. Anything that focuses or scrolls into the row
    // it just opened has to open it instantly instead, or the focus lands on nothing.
    function setOpen(record, open, instant) {
      const content = record.row.querySelector('[profile-item-content]')
      if (open) record.accordion.open(instant)
      else record.accordion.close()
      if (content) content.inert = !open
      refreshRows()
      if (open) active = record
    }
    function dirty() {
      if (loading) return
      refreshRows()
      section.setAttribute('profile-items-dirty', 'true')
      window.__tsProfileDirtyState?.markDirty(3)
      if (!saving && !unknown && !misconfigured) status.textContent = 'Unsaved changes.'
    }
    function syncCurrent(record) {
      const end = input(record.row, 'end_date')
      if (end) end.disabled = !!input(record.row, 'current_work')?.checked
    }
    function removeRecord(record) {
      record.row.querySelector('[profile-company-field="company_name"]')?._starterCompanySearch?.destroy()
      record.accordion.release()
      record.row.remove()
      records = records.filter(item => item !== record)
      refreshRows()
    }
    function addRow(value = {}, focus = false) {
      const row = template.cloneNode(true)
      Array.from(row.querySelectorAll('[profile-company-search-results]')).forEach(node => node.remove())
      const record = { row, id: value.id || null, removed: false, dates: {} }
      row.setAttribute('data-profile-row-id', 'company-' + ++uid)
      const ids = new Map()
      Array.from(row.querySelectorAll('[id]')).forEach(node => {
        const id = node.getAttribute('id'); ids.set(id, id + '--company-' + uid); node.setAttribute('id', ids.get(id))
      })
      Array.from(row.querySelectorAll('[for], [aria-describedby], [aria-controls], [aria-labelledby]')).forEach(node => {
        for (const key of ['for', 'aria-describedby', 'aria-controls', 'aria-labelledby']) {
          const value = node.getAttribute(key)
          if (value) node.setAttribute(key, value.split(/\s+/).map(id => ids.get(id) || id).join(' '))
        }
      })
      names.forEach(key => {
        const field = input(row, key)
        if (!field) return
        field.setAttribute('name', key + '--company-' + uid)
        if (key === 'current_work') { field.checked = endsNow(value); return }
        field.value = value[key] || ''
        if (key === 'start_date' || key === 'end_date') {
          const raw = value[key] || ''
          const date = writer.parseDate(raw)
          const display = date ? date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') : raw === 'Present' ? '' : raw
          // Malformed retained dates stay visible so validation can identify them.
          field.setAttribute('type', !raw || date || raw === 'Present' ? 'month' : 'text')
          field.removeAttribute('readonly')
          field.value = display
          record.dates[key] = { display, raw }
        }
      })
      const company = input(row, 'company_name')
      if (company) Object.assign(company.dataset, {
        selectedCompanyName: value.company_name || '', selectedCompanyDomain: value.company_domain || '',
        selectedCompanyLogoUrl: value.company_logo_url || value.logo_url || '',
        selectedCompanyEntityId: String(value.company_entity_id || 0),
        selectedCompanySource: value.company_source || value.source || (value.company_entity_id ? 'platform' : ''),
      })
      parent.insertBefore(row, anchor)
      records.push(record)
      const toggle = row.querySelector('[profile-item-toggle]')
      toggle?.setAttribute('role', 'button')
      toggle?.setAttribute('tabindex', '0')
      record.accordion = accordion.register(row, toggle, row.querySelector('[profile-item-content]'))
      const toggleRow = event => {
        if (event.target.closest?.('[profile-item-remove], [profile-items-undo]')) return
        event.preventDefault()
        if (!saving && !record.removed) setOpen(record, !record.accordion.isOpen())
      }
      toggle?.addEventListener('click', toggleRow)
      toggle?.addEventListener('keydown', event => {
        if (event.target === toggle && ['Enter', ' '].includes(event.key)) toggleRow(event)
      })
      const summary = row.querySelector('[profile-items-summary]')
      const badge = document.createElement('span')
      badge.setAttribute('profile-items-unsaved', '')
      badge.textContent = 'Unsaved'
      const host = summary?.parentElement || toggle || row
      const siblings = Array.from(host.children)
      host.insertBefore(badge, summary ? siblings[siblings.indexOf(summary) + 1] || null : null)
      record.badge = badge
      // The authored marker is a plain wrapper around the themed Button component, so the
      // theme lives inside it and the marker itself is what Remove hides.
      const remove = row.querySelector('[profile-item-remove]')
      const removeWrap = remove.querySelector('[data-button-theme]')
      const removeControl = remove.querySelector('button, input, a')
      Object.assign(record, { remove, removeWrap, removeControl,
        removeTheme: removeWrap.getAttribute('data-button-theme') })
      // Webflow owns the Button's separate visual label and overlay control, so the authored
      // component is the only Undo: the section refuses to bind without it.
      const undo = row.querySelector('[profile-items-undo]')
      show(undo, false)
      remove.addEventListener('click', event => {
        event.preventDefault()
        if (saving || record.removed || !removable(record)) return
        record.removed = true
        setOpen(record, false)
        show(remove, false); show(undo, true)
        if (active === record) active = remaining().at(-1) || null
        dirty()
      })
      undo.addEventListener('click', event => {
        event.preventDefault()
        if (saving) return
        remaining().filter(item => !present(item)).forEach(removeRecord)
        if (remaining().length >= 3) { status.textContent = 'Remove another entry before restoring this one. You can keep up to three.'; return }
        record.removed = false
        show(remove, true); show(undo, false)
        setOpen(record, true, true); company?.focus(); dirty()
      })
      row.addEventListener('focusin', () => { active = record })
      input(row, 'current_work')?.addEventListener('change', () => syncCurrent(record))
      syncCurrent(record)
      // Both Edit and Build declare a top-level `logoSearchInit`, so on a page that loads
      // both the later script wins `window.logoSearchInit`. These rows need the Edit picker,
      // which is published under its own name, so only that name is called here.
      window.StarterEditLogoSearchInit(company)
      setOpen(record, !record.id, focus)
      if (focus) company?.focus()
      return record
    }
    const validation = window.StarterProfileValidation.bind(section, {
      applies(field) {
        const record = records.find(item => item.row.contains(field))
        return record ? !record.removed && present(record) : false
      },
      message(field) {
        const record = records.find(item => item.row.contains(field))
        if (!record) return ''
        const key = field.getAttribute('profile-company-field')
        const value = String(field.value || '').trim()
        if (key === 'company_name' && value) {
          const selected = selection(record.row)
          if (!selected || !(selected.company_entity_id || selected.company_domain || selected.company_source === 'custom')) return 'Choose a company from the list or confirm it as a custom company.'
        }
        if (['start_date', 'end_date'].includes(key) && value && !writer.parseDate(value)) return 'Enter a valid month and year.'
        if (key === 'end_date' && !input(record.row, 'current_work')?.checked) {
          const start = writer.parseDate(input(record.row, 'start_date')?.value)
          const end = writer.parseDate(value)
          if (start && end && start.getFullYear() * 12 + start.getMonth() > end.getFullYear() * 12 + end.getMonth()) {
            // The writer publishes the wording so the unified rows and the legacy company form
            // read the same.
            return writer.monthRangeMessage
          }
        }
        return ''
      },
      reveal(field) {
        if (revealed) return
        const record = records.find(item => item.row.contains(field))
        if (!record) return
        revealed = record
        setOpen(record, true, true)
      },
    })
    const validate = scope => { revealed = null; return validation.validate(scope) }
    function updateCleanState() {
      if (!writer.hasOtherChanges()) {
        section.removeAttribute('profile-items-dirty')
        window.__tsProfileDirtyState?.setDirty(3, false)
      }
    }
    function restore() {
      validation.reset()
      records.slice().forEach(removeRecord)
      // Rows render newest-ending first, mirroring the legacy company list order.
      baseline.sort((first, second) => {
        const rank = item => item.current_work || item.end_date === 'Present' ? Infinity
          : writer.parseDate(item.end_date)?.getTime() ?? -Infinity
        const firstRank = rank(first), secondRank = rank(second)
        return firstRank === secondRank ? 0 : secondRank > firstRank ? 1 : -1
      })
      ;(baseline.length ? baseline : [{}]).forEach(value => addRow(value))
      active = records.find(item => !item.id) || records[0]
    }
    add?.addEventListener('click', event => {
      event.preventDefault()
      if (saving || loading) return
      if (!active || !present(active)) { input((active || records[0]).row, 'company_name')?.focus(); return }
      if (!validate(active.row).valid) return
      if (remaining().length >= 3) { status.textContent = 'You can keep up to three work experience entries.'; return }
      setOpen(active, false)
      addRow({}, true)
    })
    discard?.addEventListener('click', event => {
      event.preventDefault()
      if (saving || loading || unknown) return
      // Also Worked With is part of this section's draft, so Discard has to put it back too.
      restore(); writer.restoreOther(); updateCleanState(); status.textContent = 'Changes discarded.'
    })
    section.addEventListener('input', dirty)
    section.addEventListener('change', dirty)
    // Deciding whether to send an update is strict in both directions: clearing a canonical
    // company's entity id or domain (switching it to a same-name custom company) is a real
    // change. Two pairs are exceptions. The current-role pair is a single state written two
    // ways: a saved row carrying only one of them is not a change the Starter made. The months
    // are compared by month rather than by text, because the baseline holds whatever the server
    // stored - a full date after a confirmed write - while a month input sends `YYYY-MM`; the
    // same month in two textual forms would otherwise be resent as an update forever.
    // `same()` below stays lenient, because it matches what the server wrote back.
    function unchanged(saved, value) {
      const ends = endsNow(value)
      return names.filter(key => !['current_work', 'start_date', 'end_date'].includes(key))
        .every(key => String(saved[key] || '') === String(value[key] || ''))
        && sameMonth(saved.start_date, value.start_date)
        && endsNow(saved) === ends
        && (ends || sameMonth(saved.end_date, value.end_date))
        && (Number(saved.company_entity_id) || 0) === (Number(value.company_entity_id) || 0)
        && String(saved.company_domain || '').toLowerCase() === String(value.company_domain || '').toLowerCase()
    }
    // Tolerant only where the server stays silent. A field the answer omits cannot contradict
    // the draft, but a field it returns with a different value proves the write never landed —
    // switching a saved company to a same-name custom one is exactly that case.
    const omitted = (actual, key) => !(key in actual) || actual[key] === undefined
    // A month input sends `YYYY-MM` while the canonical row stores a full date, so the same
    // month reaches this comparison in two textual forms. Only a pair the writer cannot resolve
    // to a month falls back to comparing the text.
    function sameMonth(actual, expected) {
      const stored = writer.parseDate(actual), sent = writer.parseDate(expected)
      return stored && sent
        ? stored.getFullYear() === sent.getFullYear() && stored.getMonth() === sent.getMonth()
        : String(actual || '') === String(expected || '')
    }
    function same(actual, expected) {
      return [...names, 'company_entity_id', 'company_domain'].every(key => {
        if (omitted(actual, key)) return true
        if (key === 'current_work') return !!actual[key] === !!expected[key] || endsNow(actual) === endsNow(expected)
        if (key === 'start_date') return sameMonth(actual[key], expected[key])
        if (key === 'end_date') {
          return sameMonth(actual[key], expected[key]) || (endsNow(actual) && endsNow(expected))
        }
        if (key === 'company_entity_id') return (Number(actual[key]) || 0) === (Number(expected[key]) || 0)
        if (key === 'company_domain') {
          return String(actual[key] || '').toLowerCase() === String(expected[key] || '').toLowerCase()
        }
        return String(actual[key] || '') === String(expected[key] || '')
      })
    }
    // "The row still holds exactly what it held before the write" is a claim about the stored
    // row, not about an answer, so it is judged field by field with no tolerance at all: a
    // server that applied part of the update - the current-role flag without the end date it
    // was sent with - has already changed the row, and that is not proof of nothing landing.
    function identical(actual, expected) {
      return [...names, 'company_entity_id', 'company_domain'].every(key => {
        if (key === 'current_work') return !!actual[key] === !!expected[key]
        if (key === 'company_entity_id') return (Number(actual[key]) || 0) === (Number(expected[key]) || 0)
        if (key === 'company_domain') {
          return String(actual[key] || '').toLowerCase() === String(expected[key] || '').toLowerCase()
        }
        return String(actual[key] || '') === String(expected[key] || '')
      })
    }
    // A canonical read can settle a write three ways: it landed (the confirmed row), it
    // never landed, or neither. Only the last keeps Save paused - a write proved not to have
    // landed leaves the Starter where a refusal would, with the draft intact and Save usable.
    // One definition of that verdict, its error and its message is shared with the other
    // unified sections through the validator this section already depends on.
    const { NOT_LANDED, error: notLanded, MESSAGE: NOT_LANDED_MESSAGE } = window.StarterProfileValidation.notLanded
    async function reconcile(operation) {
      if (operation.kind === 'other') {
        // The association has no id to look up: compare the saved state with what was sent.
        // A saved set that differs can equally be the state before the write, so a mismatch
        // proves nothing and the outcome stays unknown.
        if (!writer.matchOther) throw new Error('Association state cannot be read')
        return await writer.matchOther(operation.value) ? { other: true } : null
      }
      const current = await writer.read()
      if (operation.kind === 'remove') {
        return current.some(item => String(item.id) === String(operation.id)) ? NOT_LANDED : { removed: true }
      }
      // The row the write created is positive proof, so it is looked for first: an atomic
      // replacement whose insert landed before the replaced row was dropped reads as confirmed,
      // not as a write that never happened.
      const matches = current.filter(item => operation.kind === 'update' ? String(item.id) === String(operation.id) && same(item, operation.value)
        : !operation.beforeIds.includes(String(item.id)) && same(item, operation.value))
      if (matches.length === 1) return matches[0]
      if (operation.kind === 'update') {
        // The row still holds exactly what it held before the write, so the update is proved
        // not to have landed rather than merely unconfirmed.
        const stored = current.find(item => String(item.id) === String(operation.id))
        const before = baseline.find(item => String(item.id) === String(operation.id))
        return stored && before && identical(stored, before) ? NOT_LANDED : null
      }
      // A create leaves no id to look up. An unmatched new row leaves the outcome unknown.
      if (current.some(item => !operation.beforeIds.includes(String(item.id)))) return null
      // No new row at all. For a plain create that is proof nothing was written; for an atomic
      // replacement it is proof only while the row it would have replaced is still there.
      if (operation.replaceId && !current.some(item => String(item.id) === String(operation.replaceId))) return null
      return NOT_LANDED
    }
    function confirm(operation, confirmed) {
      if (operation.kind === 'other') {
        // The write landed, so the association baseline advances and Save stops resending it.
        writer.acceptOther(operation.value)
      } else if (operation.kind === 'remove') {
        baseline = baseline.filter(item => String(item.id) !== String(operation.id))
        removeRecord(operation.record)
      } else {
        baseline = baseline.filter(item => String(item.id) !== String(operation.id || '') && String(item.id) !== String(operation.replaceId || ''))
        baseline.push(copy(confirmed))
        operation.record.id = confirmed.id
        if (operation.replaceId) records.filter(item => String(item.id) === String(operation.replaceId)).forEach(removeRecord)
      }
      refreshRows()
    }
    check.addEventListener('click', async event => {
      // An authored control may be an anchor or a submit button, so never let its default run.
      event.preventDefault()
      if (!unknown || saving || check.disabled) return
      check.disabled = true; check.setAttribute('aria-disabled', 'true')
      try {
        const confirmed = await reconcile(unknown)
        if (confirmed === NOT_LANDED) {
          // A lag behind a received answer is not proof; only a lost response can be settled here.
          if (!unknown.lost) throw new Error('Save not confirmed')
          unknown = null; show(check, false)
          status.textContent = NOT_LANDED_MESSAGE
          return
        }
        if (!confirmed) throw new Error('Save not confirmed')
        confirm(unknown, confirmed); unknown = null; show(check, false)
        status.textContent = 'That change is confirmed. Save the section to finish the remaining draft changes.'
      } catch (_) { status.textContent = 'The save is still unconfirmed. Your draft is kept; Save remains paused.' }
      finally { check.disabled = false; check.removeAttribute('aria-disabled') }
    })
    save?.addEventListener('click', async event => {
      event.preventDefault()
      if (saving || loading || unknown) return
      if (checkMisconfigured()) return
      if (!validate().valid) return
      const kept = remaining().filter(present)
      const submitted = kept.map(record => ({ record, value: copy(values(record)) }))
      const presence = section.querySelector('[profile-items-presence]')
      if (presence?.required && !kept.length) {
        // Never reopen a row the Starter is removing: point at a usable row, adding one if needed.
        const target = remaining()[0] || addRow({}, true)
        status.textContent = 'Add at least one work experience entry.'
        setOpen(target, true, true); input(target.row, 'company_name')?.focus(); return
      }
      const deletions = records.filter(record => record.removed && record.id)
      const operations = []
      kept.forEach(record => {
        const value = values(record)
        if (!record.id) operations.push({ kind: 'create', record, value, replaceId: deletions.shift()?.id })
        else if (!unchanged(baseline.find(item => String(item.id) === String(record.id)) || {}, value)) operations.push({ kind: 'update', record, id: record.id, value })
      })
      deletions.forEach(record => operations.push({ kind: 'remove', record, id: record.id }))
      saving = true; section.inert = true; section.setAttribute('aria-busy', 'true'); status.textContent = 'Saving changes…'
      let token = window.__tsProfileDirtyState?.beginSave(3)
      let saved = false
      try {
        for (const operation of operations) {
          // A read failure here is known not to have sent this mutation.
          const before = await writer.read()
          operation.beforeIds = before.map(item => String(item.id))
          const sent = dispatches()
          let lost = false, answer = null
          try {
            if (operation.kind === 'create') answer = await writer.create(operation.value, operation.replaceId)
            else if (operation.kind === 'update') answer = await writer.update(operation.id, operation.value)
            else answer = await writer.remove(operation.id)
          } catch (error) {
            // A received non-2xx answer is a known refusal, and a throw before the request
            // left the browser never reached the server at all: both wrote nothing, so the
            // loop stops with the draft intact. A 2xx whose body the writer could not read is
            // still an answer the section received, so that write landed and is not lost.
            // Only a lost response stays unknown.
            if (error?.known) throw error
            if (!error?.received) {
              if (!dispatchedSince(sent)) throw error
              lost = true
            }
          }
          // A create and an update answer with the row they wrote, and any answer at all to a
          // removal is that removal's own confirmation. An answer is the write's confirmation,
          // so a canonical read that has not caught up cannot contradict it.
          const answered = lost ? null : operation.kind === 'remove' ? { removed: true }
            : window.StarterProfileValidation.answeredRow(answer, operation.value)
          if (answered) { confirm(operation, answered); unknown = null; continue }
          operation.lost = lost
          unknown = operation
          const confirmed = await reconcile(operation)
          // Only a lost response can be proved never to have landed. After a received answer the
          // write is already the server's, so a read that disagrees is lag rather than proof.
          if (confirmed === NOT_LANDED) {
            if (!lost) throw new Error('Save not confirmed')
            unknown = null; throw notLanded()
          }
          if (!confirmed) throw new Error('Save not confirmed')
          confirm(operation, confirmed); unknown = null
        }
        if (writer.hasOtherChanges()) {
          const sent = dispatches()
          try {
            await writer.saveOther()
          } catch (error) {
            // A received answer whose body could not be read still reached the server, so the
            // association write is unknown rather than lost: no read can prove it never landed.
            if (!error?.known && (error?.received || dispatchedSince(sent))) {
              unknown = { kind: 'other', lost: !error?.received, value: writer.otherValue() }
            }
            throw error
          }
        }
        saved = true
        const laterEdits = submitted.some(({ record, value }) => record.removed || JSON.stringify(values(record)) !== JSON.stringify(value))
          || remaining().some(record => present(record) && !kept.includes(record))
        if (laterEdits) {
          dirty(); status.textContent = 'Changes saved. Later edits are still unsaved.'
        } else {
          restore(); updateCleanState(); status.textContent = 'Changes saved.'
        }
      } catch (error) {
        show(check, !!unknown)
        if (error?.known) {
          // The server refused this change, so Save and Discard stay available for the draft.
          status.textContent = error.serverMessage || 'The server rejected this change. Check the entry and try again.'
        } else if (error?.notLanded) {
          // The canonical read proved this write never landed, so nothing is in doubt.
          status.textContent = NOT_LANDED_MESSAGE
        } else {
          status.textContent = unknown ? 'A save could not be confirmed. Your draft and confirmed changes are kept. Save is paused until the server state can be checked.'
            : 'That change was not submitted. Your draft is kept; you can save again.'
        }
      } finally {
        saving = false; section.inert = false; section.removeAttribute('aria-busy')
        window.__tsProfileDirtyState?.finishSave(3, saved, token)
      }
    })
    section.inert = true
    section.setAttribute('aria-busy', 'true')
    status.textContent = 'Loading work experience…'
    try {
      baseline = copy(await writer.read())
      if (baseline.length > 3 || baseline.some(item => !item || !item.id)) throw new Error('Invalid company collection')
      Array.from(section.querySelectorAll(ROW)).forEach(row => {
        input(row, 'company_name')?._starterCompanySearch?.destroy()
        row.remove()
      })
      restore(); loading = false; status.textContent = ''; checkMisconfigured()
    } catch (_) { status.textContent = 'Work experience could not be loaded. Save is paused to protect existing entries.' }
    // A failed load still releases the section: leaving it inert would make the rows
    // unfocusable and unselectable for the rest of the page session. `loading` stays
    // true instead, so Save and Discard keep refusing until the page is reloaded.
    finally { section.inert = false; section.removeAttribute('aria-busy') }
  }
  window.StarterProfileCompanies = { bind }
})()
