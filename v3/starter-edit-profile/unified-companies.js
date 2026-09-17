/* Opt-in Work Experience rows. Persistence stays in company-experience-crud.js. */
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
    const status = document.createElement('div')
    status.setAttribute('role', 'status')
    status.setAttribute('profile-items-status', '')
    section.appendChild(status)
    const original = section.querySelector(ROW)
    const template = original?.cloneNode(true)
    const parent = original?.parentElement
    if (!template || !parent || !save) {
      // The row is also the template for every added row, and Save is the only route to the
      // writer. Without either, report the markup gap and disable Save instead of leaving a
      // live control that silently does nothing.
      console.warn('[unified-companies] missing [profile-item-row] or Save control in section')
      status.textContent = 'This section could not load. Reload the page before editing.'
      save?.setAttribute('disabled', '')
      return
    }
    let records = []
    let baseline = []
    let active = null
    let saving = false
    let loading = true
    let unknown = null
    let misconfigured = false
    let warned = false
    const add = section.querySelector('[profile-items-add]')
    const discard = section.querySelector('[profile-items-discard]')
    const check = document.createElement('button')
    check.setAttribute('type', 'button')
    check.setAttribute('profile-items-check-save', '')
    check.textContent = 'Check saved state'
    check.hidden = true
    section.appendChild(check)
    // A field authored `form-xano-required` without the Webflow Required checkbox would let a
    // Starter submit a blank value the Xano writer refuses. Requiredness still comes only from
    // Required; this pauses Save on the mismatch instead of inventing a JavaScript requirement.
    function checkMisconfigured() {
      const fields = window.StarterProfileValidation.misconfigured?.(section) || []
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
    const copy = value => JSON.parse(JSON.stringify(value))
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
        if (record.dates?.[key]?.display === value[key]) value[key] = record.dates[key].raw
      }
      if (value.current_work) value.end_date = 'Present'
      return { ...value, ...(selection(record.row) || { company_domain: '', company_logo_url: '', company_entity_id: 0, company_source: '' }) }
    }
    function setOpen(record, open) {
      const content = record.row.querySelector('[profile-item-content]')
      const toggle = record.row.querySelector('[profile-item-toggle]')
      if (content) { content.hidden = !open; content.inert = !open; content.style.height = open ? 'auto' : '0px' }
      toggle?.setAttribute('aria-expanded', String(open))
      const summary = record.row.querySelector('[profile-items-summary]')
      if (summary) summary.textContent = [input(record.row, 'company_name')?.value, input(record.row, 'job_title')?.value].filter(Boolean).join(' · ') || 'Work experience'
      if (open) active = record
    }
    function dirty() {
      if (loading) return
      section.setAttribute('profile-items-dirty', 'true')
      window.__tsProfileDirtyState?.markDirty(3)
      if (!saving && !unknown) status.textContent = 'Unsaved changes.'
    }
    function syncCurrent(record) {
      const end = input(record.row, 'end_date')
      if (end) end.disabled = !!input(record.row, 'current_work')?.checked
    }
    function removeRecord(record) {
      record.row.querySelector('[profile-company-field="company_name"]')?._starterCompanySearch?.destroy()
      record.row.remove()
      records = records.filter(item => item !== record)
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
        if (key === 'current_work') { field.checked = !!value[key]; return }
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
      parent.appendChild(row)
      records.push(record)
      const toggle = row.querySelector('[profile-item-toggle]')
      toggle?.setAttribute('role', 'button')
      toggle?.setAttribute('tabindex', '0')
      const toggleRow = event => {
        if (event.target.closest?.('[profile-item-remove]')) return
        event.preventDefault()
        if (!saving && !record.removed) setOpen(record, toggle.getAttribute('aria-expanded') !== 'true')
      }
      toggle?.addEventListener('click', toggleRow)
      toggle?.addEventListener('keydown', event => {
        if (event.target === toggle && ['Enter', ' '].includes(event.key)) toggleRow(event)
      })
      const remove = row.querySelector('[profile-item-remove]')
      const undo = document.createElement('button')
      undo.setAttribute('type', 'button')
      undo.setAttribute('profile-items-undo', '')
      undo.textContent = 'Undo removal'
      undo.hidden = true
      row.appendChild(undo)
      remove?.addEventListener('click', event => {
        event.preventDefault()
        if (saving) return
        record.removed = true
        setOpen(record, false)
        if (toggle) toggle.hidden = true
        remove.hidden = true; undo.hidden = false
        if (active === record) active = remaining().at(-1) || null
        if (!remaining().length) addRow({}, true)
        dirty()
      })
      undo.addEventListener('click', () => {
        if (saving) return
        remaining().filter(item => !present(item)).forEach(removeRecord)
        if (remaining().length >= 3) { status.textContent = 'Remove another entry before restoring this one. You can keep up to three.'; return }
        record.removed = false
        if (toggle) toggle.hidden = false
        if (remove) remove.hidden = false
        undo.hidden = true
        setOpen(record, true); company?.focus(); dirty()
      })
      row.addEventListener('focusin', () => { active = record })
      input(row, 'current_work')?.addEventListener('change', () => syncCurrent(record))
      syncCurrent(record)
      window.logoSearchInit?.(company)
      setOpen(record, !record.id)
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
          if (start && end && start.getFullYear() * 12 + start.getMonth() > end.getFullYear() * 12 + end.getMonth()) return 'End month must be the same as or after the start month.'
        }
        return ''
      },
      reveal(field) { const record = records.find(item => item.row.contains(field)); if (record) setOpen(record, true) },
    })
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
      if (!validation.validate(active.row).valid) return
      if (remaining().length >= 3) { status.textContent = 'You can keep up to three work experience entries.'; return }
      setOpen(active, false)
      addRow({}, true)
    })
    discard?.addEventListener('click', event => {
      event.preventDefault()
      if (saving || loading || unknown) return
      // Also Worked With is part of this section's draft, so Discard has to put it back too.
      restore(); writer.restoreOther?.(); updateCleanState(); status.textContent = 'Changes discarded.'
    })
    section.addEventListener('input', dirty)
    section.addEventListener('change', dirty)
    // Deciding whether to send an update is strict in both directions: clearing a canonical
    // company's entity id or domain (switching it to a same-name custom company) is a real
    // change. `same()` below stays lenient, because it matches what the server wrote back.
    function unchanged(saved, value) {
      return names.every(key => key === 'current_work' ? !!saved[key] === !!value[key]
        : String(saved[key] || '') === String(value[key] || ''))
        && (Number(saved.company_entity_id) || 0) === (Number(value.company_entity_id) || 0)
        && String(saved.company_domain || '').toLowerCase() === String(value.company_domain || '').toLowerCase()
    }
    function same(actual, expected) {
      const equal = names.every(key => key === 'current_work' ? !!actual[key] === expected[key]
        : String(actual[key] || '') === String(expected[key] || ''))
      return equal && (!expected.company_entity_id || Number(actual.company_entity_id) === expected.company_entity_id)
        && (!expected.company_domain || String(actual.company_domain || '').toLowerCase() === expected.company_domain.toLowerCase())
    }
    async function reconcile(operation) {
      if (operation.kind === 'other') {
        // The association has no id to look up: compare the saved state with what was sent.
        if (!writer.matchOther) throw new Error('Association state cannot be read')
        return await writer.matchOther(operation.value) ? { other: true } : null
      }
      const current = await writer.read()
      if (operation.kind === 'remove') return current.some(item => String(item.id) === String(operation.id)) ? null : { removed: true }
      if (operation.replaceId && current.some(item => String(item.id) === String(operation.replaceId))) return null
      const matches = current.filter(item => operation.kind === 'update' ? String(item.id) === String(operation.id) && same(item, operation.value)
        : !operation.beforeIds.includes(String(item.id)) && same(item, operation.value))
      return matches.length === 1 ? matches[0] : null
    }
    function confirm(operation, confirmed) {
      if (operation.kind === 'other') {
        // The write landed, so the association baseline advances and Save stops resending it.
        writer.acceptOther?.(operation.value)
      } else if (operation.kind === 'remove') {
        baseline = baseline.filter(item => String(item.id) !== String(operation.id))
        removeRecord(operation.record)
      } else {
        baseline = baseline.filter(item => String(item.id) !== String(operation.id || '') && String(item.id) !== String(operation.replaceId || ''))
        baseline.push(copy(confirmed))
        operation.record.id = confirmed.id
        if (operation.replaceId) records.filter(item => String(item.id) === String(operation.replaceId)).forEach(removeRecord)
      }
    }
    check.addEventListener('click', async () => {
      if (!unknown || saving || check.disabled) return
      check.disabled = true
      try {
        const confirmed = await reconcile(unknown)
        if (!confirmed) throw new Error('Save not confirmed')
        confirm(unknown, confirmed); unknown = null; check.hidden = true
        status.textContent = 'That change is confirmed. Save the section to finish the remaining draft changes.'
      } catch (_) { status.textContent = 'The save is still unconfirmed. Your draft is kept; Save remains paused.' }
      finally { check.disabled = false }
    })
    save?.addEventListener('click', async event => {
      event.preventDefault()
      if (saving || loading || unknown) return
      if (checkMisconfigured()) return
      if (!validation.validate().valid) return
      const kept = remaining().filter(present)
      const submitted = kept.map(record => ({ record, value: copy(values(record)) }))
      const presence = section.querySelector('[profile-items-presence]')
      if (presence?.required && !kept.length) {
        // Never reopen a row the Starter is removing: point at a usable row, adding one if needed.
        const target = remaining()[0] || addRow({}, true)
        status.textContent = 'Add at least one work experience entry.'
        setOpen(target, true); input(target.row, 'company_name')?.focus(); return
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
          unknown = operation
          try {
            if (operation.kind === 'create') await writer.create(operation.value, operation.replaceId)
            else if (operation.kind === 'update') await writer.update(operation.id, operation.value)
            else await writer.remove(operation.id)
          } catch (error) {
            // A received non-2xx answer is a known refusal: nothing was written, so the loop
            // stops with the draft intact. Only a lost response stays unknown until a read.
            if (error?.known) { unknown = null; throw error }
          }
          const confirmed = await reconcile(operation)
          if (!confirmed) throw new Error('Save not confirmed')
          confirm(operation, confirmed); unknown = null
        }
        if (writer.hasOtherChanges()) {
          unknown = { kind: 'other', value: writer.otherValue?.() ?? '' }
          try {
            await writer.saveOther()
          } catch (error) {
            if (error?.known) unknown = null
            throw error
          }
          unknown = null
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
        check.hidden = !unknown
        if (error?.known) {
          // The server refused this change, so Save and Discard stay available for the draft.
          status.textContent = error.serverMessage || 'The server rejected this change. Check the entry and try again.'
        } else {
          status.textContent = unknown ? 'A save could not be confirmed. Your draft and confirmed changes are kept. Save is paused until the server state can be checked.'
            : 'The next change was not submitted. Confirmed changes are kept; you can save the remaining draft or discard it.'
        }
      } finally {
        saving = false; section.inert = false; section.removeAttribute('aria-busy')
        window.__tsProfileDirtyState?.finishSave(3, saved, token)
      }
    })
    section.inert = true
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
