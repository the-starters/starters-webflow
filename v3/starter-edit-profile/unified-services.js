/*
 * Opt-in Services & Rates coordinator. The main profile controller remains the writer.
 *
 * @release v1.59.608
 */
;(function () {
  'use strict'
  if (window.StarterProfileSections) return
  const sections = new WeakMap()
  const ROW = '[increment-dropdown]'
  // Scalar controls this section owns: the payload keys prepare() reads. Anything else
  // outside a row (picker search boxes, Finsweet option controls) belongs to another
  // script, so an authored constraint on it must not gate this section's Save.
  const SCALAR_NAMES = ['rate', 'rate-retainer', 'description-retainer', 'offer-monthly-retainers',
    'availability-option', 'availability', 'full-time-placement']
  let nextRowId = 0
  function bindServices(section) {
    if (sections.has(section)) return sections.get(section)
    const rows = () => Array.from(section.querySelectorAll(ROW))
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
    // Designer placeholder copy would otherwise sit in the live region all session.
    status.textContent = ''
    // Same for the check control: adopt the authored one, keeping the label its author wrote.
    // Adopted before any early return so a halted section never leaves a live check control.
    let checkSave = authored('profile-items-check-save')
    if (!checkSave) {
      checkSave = document.createElement('button')
      checkSave.setAttribute('profile-items-check-save', '')
      section.appendChild(checkSave)
    }
    if (checkSave.tagName === 'BUTTON') checkSave.setAttribute('type', 'button')
    // Authored children are the label, so only a wholly empty control gets the default copy.
    if (!checkSave.children.length && !checkSave.textContent.trim()) checkSave.textContent = 'Check saved state'
    // A div has no native activation; an anchor activates on Enter but never on Space.
    if (checkSave.tagName !== 'BUTTON') {
      if (checkSave.tagName !== 'A') {
        if (!checkSave.hasAttribute('role')) checkSave.setAttribute('role', 'button')
        if (!checkSave.hasAttribute('tabindex')) checkSave.setAttribute('tabindex', '0')
      }
      const keys = checkSave.tagName === 'A' ? [' '] : ['Enter', ' ']
      checkSave.addEventListener('keydown', event => {
        if (event.target !== checkSave || !keys.includes(event.key)) return
        event.preventDefault()
        checkSave.dispatchEvent(new Event('click'))
      })
    }
    // Class rules beat [hidden]; write display too, and revert it if a class still hides the control.
    const showCheck = visible => {
      checkSave.hidden = !visible
      checkSave.style.display = visible ? '' : 'none'
      if (visible && window.getComputedStyle?.(checkSave)?.display === 'none') checkSave.style.display = 'revert'
    }
    showCheck(false)
    const save = section.querySelector('[data-edit-submit]')
    if (!rows().length || !save) {
      // The row is also the template for every added row, and Save is the only route to the
      // writer. Without either, binding would throw inside the profile-data callback and the
      // page would be left with no controller at all, so register a halted controller that
      // reports the markup gap, and disable Save rather than leave a live control that
      // silently does nothing.
      console.warn('[unified-services] missing [increment-dropdown] row or Save control in section')
      status.textContent = 'This section could not load. Reload the page before editing.'
      save?.setAttribute('disabled', '')
      const halted = {
        validate: () => ({ valid: false, failures: [{ code: 'MARKUP_CONTRACT_MISSING' }] }),
        begin: () => false,
        requestStarted() {},
        matchesSaved: () => false,
        finish() {},
        prepare() {},
      }
      sections.set(section, halted)
      return halted
    }
    const fields = row => Array.from(row.querySelectorAll('[data-name]'))
    const meaningful = row => fields(row).some(field => String(field.value || '').trim())
    const retained = new WeakSet(rows().filter(meaningful))
    const rowBaselines = new WeakMap()
    const template = rows()[0]?.cloneNode(true)
    const rowParent = rows()[0]?.parentElement
    const anchor = rows()[rows().length - 1]?.nextSibling || null
    const remaining = () => rows().filter(row => !row.hasAttribute('profile-items-removed'))
    const valuesFor = row => Object.fromEntries(fields(row).map(field => [field.getAttribute('data-name'), field.value]))
    let baseline = rows().map(row => ({ values: valuesFor(row), retained: retained.has(row) }))
    const scalarFields = () => Array.from(new Set(section.querySelectorAll('input, select, textarea')))
      .filter(field => !field.closest?.(ROW) && !/^(free-|paid-)/.test(field.getAttribute('name') || ''))
    const scalars = () => scalarFields().map(field => ({ field, value: field.value, checked: field.checked }))
    let scalarBaseline = scalars()
    let active = rows()[0]
    const add = section.querySelector('[profile-items-add]')
    let saving = false
    let restoring = false
    let uncertain = false
    let unreadable = false
    let misconfiguredForm = false
    let dispatched = false
    let snapshot = null
    let sentPayload = null
    let submittedRows = []
    let submittedRowStates = []
    let submittedScalars = []
    let readbackCheck = null
    const submittable = () => remaining().filter(row => retained.has(row) || meaningful(row))
    const rowSnapshot = () => submittable().map(row => ({ values: valuesFor(row), retained: true }))
    const scalarValues = records => records.map(({ value, checked }) => [value, checked])
    checkSave.addEventListener('click', async event => {
      // An authored control may be an anchor or a submit button, so never let its default run.
      event.preventDefault()
      if (!uncertain || saving || checkSave.disabled || !readbackCheck) return
      checkSave.disabled = true; checkSave.setAttribute('aria-disabled', 'true')
      status.textContent = 'Checking saved changes…'
      try {
        if (await readbackCheck()) { controller.finish(true); return }
      } catch (_) { /* Failed reads cannot settle an unknown write. */ }
      finally { checkSave.disabled = false; checkSave.removeAttribute('aria-disabled') }
      status.textContent = 'We could not confirm the save yet. Your draft is kept. You can check again; Save remains paused.'
    })
    function dirty(event) {
      // Pickers and legacy toggles inside this section replay input and change events while
      // the profile hydrates. Those are not Starter edits, so the shared hydration window -
      // the same one the canonical dirty state uses - decides what counts as a draft change.
      if (restoring) return
      if (window.__tsProfileDirtyState?.isHydrating?.()) {
        const row = event?.target?.closest?.(ROW)
        if (row) rowBaselines.set(row, valuesFor(row))
        refreshHeaders()
        return
      }
      refreshHeaders()
      section.setAttribute('profile-items-dirty', 'true')
      window.__tsProfileDirtyState?.markDirty(6)
      if (!saving && !uncertain && !misconfiguredForm && !unreadable) status.textContent = 'Unsaved changes.'
    }
    // A field authored `form-xano-required` without the Webflow Required checkbox would let a
    // blank value reach a writer that rejects it. Report the mismatch and pause Save; never
    // treat the attribute as requiredness, and never name a value in the diagnostic.
    function misconfiguredFields() {
      // Only the fields this section submits: the scalar controls `prepare()` reads - the named
      // ones, since scalarFields() is broader - and the row fields Save sends. A marker on a Free
      // or Paid Call control, or on a picker's own search box, belongs to the script that writes
      // it and is not this section's to refuse.
      const submitted = new Set([
        ...scalarFields().filter(field => SCALAR_NAMES.includes(field.getAttribute('name') || '')),
        ...rows().flatMap(row => fields(row)),
      ])
      const offenders = window.StarterProfileValidation.misconfigured(section,
        { applies: field => submitted.has(field) })
      if (offenders.length && !misconfiguredForm) {
        console.warn('[unified-services] form-xano-required without required:',
          offenders.map(field => field.getAttribute('data-name') || field.getAttribute('name') || ''))
      }
      misconfiguredForm = offenders.length > 0
      if (misconfiguredForm) status.textContent = 'This form is misconfigured. Saving is paused until it is fixed.'
      return misconfiguredForm
    }
    function setOpen(row, open) {
      row.querySelector('[increment-dropdown-toggle]')?.setAttribute('aria-expanded', String(open))
      const content = row.querySelector('[increment-dropdown-content]')
      if (content) {
        content.hidden = !open
        content.inert = !open
        content.style.height = open ? 'auto' : '0px'
        content.style.overflow = open ? 'visible' : 'hidden'
      }
      if (open) active = row
    }
    function refreshHeaders() {
      remaining().forEach((row, index) => {
        const label = row.querySelector('[profile-items-label]')
        if (!label) return
        label.textContent = 'Service ' + (index + 1)
        const accepted = rowBaselines.get(row)
        const current = valuesFor(row)
        const changed = accepted
          ? Object.keys(current).some(key => String(current[key] || '') !== String(accepted[key] || ''))
          : meaningful(row)
        const badge = row.querySelector('[profile-items-unsaved]')
        if (badge) { badge.hidden = !changed; badge.style.display = changed ? '' : 'none' }
      })
    }
    function bindRow(row) {
      row.setAttribute('data-profile-row-id', String(++nextRowId))
      const toggle = row.querySelector('[increment-dropdown-toggle]')
      // The authored label is an explicit contract. Older unmarked headers keep their
      // label untouched; never append a second name/price summary beside it.
      const label = row.querySelector('[profile-items-label]')
      const toggleDisplay = toggle && label ? 'flex' : ''
      const showToggle = visible => {
        if (!toggle) return
        toggle.hidden = !visible
        toggle.style.display = visible ? toggleDisplay : 'none'
      }
      if (toggle && label) {
        const badge = document.createElement('span')
        badge.setAttribute('profile-items-unsaved', '')
        badge.textContent = 'Unsaved'
        badge.style.marginInlineStart = '0.5rem'
        label.insertAdjacentElement('afterend', badge)
        showToggle(true)
        toggle.style.alignItems = 'center'
        const icon = row.querySelector('[increment-dropdown-icon]')
        if (icon) { icon.style.marginInlineStart = 'auto'; icon.style.flexShrink = '0' }
      }
      const toggleRow = event => {
        if (event.target.closest?.('[increment-dropdown-remove], [profile-items-undo]')) return
        event.preventDefault()
        if (saving || row.hasAttribute('profile-items-removed')) return
        refreshHeaders()
        setOpen(row, toggle.getAttribute('aria-expanded') !== 'true')
      }
      toggle?.addEventListener('click', toggleRow)
      if (toggle && toggle.tagName !== 'BUTTON') {
        toggle.setAttribute('role', 'button')
        toggle.setAttribute('tabindex', '0')
        toggle.addEventListener('keydown', event => {
          if (event.target === toggle && (event.key === 'Enter' || event.key === ' ')) toggleRow(event)
        })
      }
      row.addEventListener('focusin', () => { active = row })
      const remove = row.querySelector('[increment-dropdown-remove]')
      const undo = document.createElement('button')
      undo.setAttribute('type', 'button')
      undo.setAttribute('profile-items-undo', '')
      undo.textContent = 'Undo removal'
      undo.hidden = true
      row.appendChild(undo)
      remove?.addEventListener('click', event => {
        event.preventDefault()
        if (saving) return
        row.setAttribute('profile-items-removed', 'true')
        setOpen(row, false)
        showToggle(false)
        remove.hidden = true
        undo.hidden = false
        if (active === row) active = remaining()[remaining().length - 1] || null
        if (!remaining().length) newRow()
        dirty()
      })
      undo.addEventListener('click', () => {
        if (saving) return
        remaining().filter(candidate => !retained.has(candidate) && !meaningful(candidate)).forEach(candidate => candidate.remove())
        if (remaining().length >= 3) {
          status.textContent = 'You can keep up to three services. Remove another service before restoring this one.'
          return
        }
        row.removeAttribute('profile-items-removed')
        showToggle(true)
        if (remove) remove.hidden = false
        undo.hidden = true
        setOpen(row, true)
        fields(row)[0]?.focus()
        dirty()
      })
      setOpen(row, true)
    }
    function newRow(saved = null, focus = true, scroll = false) {
      if (!template || !rowParent) return null
      const clone = template.cloneNode(true)
      const suffix = '--profile-row-' + (nextRowId + 1)
      const ids = new Map()
      Array.from(clone.querySelectorAll('[id]')).forEach(node => {
        const id = node.getAttribute('id')
        ids.set(id, id + suffix)
        node.setAttribute('id', id + suffix)
      })
      Array.from(clone.querySelectorAll('[for], [aria-describedby], [aria-controls], [aria-labelledby]')).forEach(node => {
        for (const attribute of ['for', 'aria-describedby', 'aria-controls', 'aria-labelledby']) {
          const value = node.getAttribute(attribute)
          if (value) node.setAttribute(attribute, value.split(/\s+/).map(id => ids.get(id) || id).join(' '))
        }
      })
      Array.from(clone.querySelectorAll('input, textarea, select')).forEach(field => {
        field.value = saved?.values[field.getAttribute('data-name')] || ''
        field.checked = false
        const name = field.getAttribute('name')
        if (name) field.setAttribute('name', name + suffix)
      })
      rowParent.insertBefore(clone, anchor)
      window.formatRateInputs?.(clone)
      bindRow(clone)
      if (saved?.retained) retained.add(clone)
      if (saved) rowBaselines.set(clone, { ...saved.values })
      refreshHeaders()
      if (focus) fields(clone)[0]?.focus({ preventScroll: true })
      if (scroll) clone.querySelector('[increment-dropdown-toggle]')?.scrollIntoView({
        block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
      return clone
    }
    function reveal(field) {
      const row = field.closest(ROW)
      if (row) setOpen(row, true)
    }
    const validation = window.StarterProfileValidation.bind(section, {
      applies(field) {
        if (['input-required', 'input-value'].includes(field.getAttribute('ms-code-select'))) return false
        const row = field.closest(ROW)
        if (row) {
          if (field.hasAttribute('data-input-capture')) return false
          if (row.hasAttribute('profile-items-removed')) return false
          return retained.has(row) || meaningful(row)
        }
        // The visible picker input carries the "Choose an option" message for its wrapper.
        if (field.getAttribute('ms-code-select') === 'input') return true
        return SCALAR_NAMES.includes(field.getAttribute('name') || '')
      },
      message(field) {
        if (field.getAttribute('ms-code-select') === 'input') {
          const required = field.closest('[select-wrap-entity]')?.querySelector('[ms-code-select="input-required"]')
          if (required?.required && !required.disabled && !String(required.value || '').trim()) return 'Choose an option from the list.'
        }
        const kind = field.getAttribute('data-name') || field.getAttribute('name')
        const max = { 'service-price': 50000, rate: 1000, 'rate-retainer': 25000 }[kind]
        const value = String(field.value || '').trim()
        if (max && value && (!/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > max)) {
          return 'Use a whole-dollar amount from $1 to $' + max.toLocaleString('en-US') + '.'
        }
        return ''
      },
      feedbackTarget(field) {
        if (['input-required', 'input-value'].includes(field.getAttribute?.('ms-code-select'))) {
          return field.closest('[select-wrap-entity]')?.querySelector('[ms-code-select="input"]')
        }
        return field
      },
      reveal,
    })
    rows().forEach(bindRow)
    misconfiguredFields()
    const stored = window.activeProfile?.data?.step_6
    if (stored) {
      let index = 0
      for (const slot of ['service', 'service-2', 'service-3']) {
        if (!stored[slot]) continue
        let entry
        try {
          entry = typeof stored[slot] === 'string' ? JSON.parse(stored[slot]) : stored[slot]
          if (entry !== null && (typeof entry !== 'object' || Array.isArray(entry)
            || ['name', 'description', 'price'].some(key => entry[key] != null && !['string', 'number'].includes(typeof entry[key])))) {
            throw new Error('Invalid service shape')
          }
        } catch (_) {
          // A saved slot that cannot be read is a load failure, not a write in doubt: there is
          // no server state to reconcile and no check that could settle it. Fail closed the way
          // a missing row template does - disable Save and say the page must be reloaded -
          // rather than leave a live Save that would quietly overwrite the unreadable entries.
          unreadable = true
          continue
        }
        if (!entry) continue
        const saved = { retained: true, values: Object.fromEntries(
          ['name', 'description', 'price'].map(key => ['service-' + key, String(entry[key] ?? '')])) }
        const row = index++ === 0 ? rows()[0] : newRow(saved, false)
        if (!row) continue
        fields(row).forEach(field => { field.value = saved.values[field.getAttribute('data-name')] || '' })
        retained.add(row)
        refreshHeaders()
      }
      baseline = rows().map(row => ({ values: valuesFor(row), retained: retained.has(row) }))
    }
    rows().forEach(row => rowBaselines.set(row, valuesFor(row)))
    refreshHeaders()
    if (unreadable) {
      status.textContent = 'Saved services could not be read. Reload the page before editing.'
      save.setAttribute('disabled', '')
    }
    section.addEventListener('input', dirty)
    section.addEventListener('change', dirty)
    add?.addEventListener('click', event => {
      event.preventDefault()
      if (saving) return
      if (!remaining().length) { newRow(null, true, true); return }
      if (!active || !meaningful(active)) { fields(active || rows()[0])[0]?.focus(); return }
      if (!validation.validate(active).valid) return
      if (remaining().length >= 3) { status.textContent = 'You can keep up to three services.'; return }
      refreshHeaders()
      setOpen(active, false)
      newRow(null, true, true)
    })
    section.querySelector('[profile-items-discard]')?.addEventListener('click', event => {
      event.preventDefault()
      if (saving || uncertain) return
      rows().forEach(row => row.remove())
      baseline.forEach(saved => newRow(saved, false))
      const restoreScalars = () => {
        const applyValues = () => scalarBaseline.forEach(({ field, value, checked }) => {
          field.value = value
          field.checked = checked
        })
        restoring = true
        try {
          applyValues()
          scalarBaseline.forEach(({ field }) => field.dispatchEvent(new Event('change', { bubbles: true })))
          // Toggle handlers may clear inactive inputs. Restore their confirmed values too.
          applyValues()
          Array.from(section.querySelectorAll('[ms-code-select-wrapper]')).forEach(wrapper => {
            wrapper.dispatchEvent(new Event('starter:profile-restore'))
          })
        } finally { restoring = false }
      }
      if (window.__tsProfileDirtyState?.runHydrationSync) window.__tsProfileDirtyState.runHydrationSync(restoreScalars)
      else restoreScalars()
      validation.reset()
      section.removeAttribute('profile-items-dirty')
      window.__tsProfileDirtyState?.setDirty(6, false)
      // Discard stays usable when the saved collection could not be read, so a Starter is
      // never trapped with edits they cannot clear - but the standing block is restated.
      status.textContent = unreadable
        ? 'Changes discarded. Saved services could not be read; reload the page before editing.'
        : 'Changes discarded.'
    })
    const controller = {
      validate() {
        if (unreadable) {
          status.textContent = 'Saved services could not be read. Reload the page before editing.'
          return { valid: false, failures: [{ code: 'SAVED_STATE_UNREADABLE' }] }
        }
        if (misconfiguredFields()) return { valid: false, failures: [{ code: 'FORM_MISCONFIGURED' }] }
        // The legacy step-6 check this path replaces refused to write before the profile type
        // resolved; without the same gate an unresolved type would submit a null Profile_Type.
        if (!['full', 'consult'].includes(window.activeProfile?.type || '')) {
          return { valid: false, failures: [{ code: 'PROFILE_NOT_READY' }] }
        }
        return validation.validate()
      },
      begin() {
        if (saving || uncertain || misconfiguredForm || unreadable) return false
        snapshot = {}
        controller.prepare(snapshot)
        submittedRowStates = submittable().map(row => ({ row, values: valuesFor(row) }))
        submittedRows = submittedRowStates.map(({ values }) => ({ values: { ...values }, retained: true }))
        submittedScalars = scalars()
        saving = true
        dispatched = false
        section.inert = true
        section.setAttribute('aria-busy', 'true')
        status.textContent = 'Saving changes…'
        return true
      },
      requestStarted(payload, check) {
        dispatched = true
        sentPayload = JSON.parse(JSON.stringify(payload))
        readbackCheck = check
      },
      matchesSaved(profile) {
        if (!profile || !sentPayload) return false
        for (const key of ['Hourly_Rate', 'Availability', 'Availability_ID', 'Open_to_Full_Time',
          'Retainer_Enabled', 'Retainer_Description', 'Retainer_Rate']) {
          if (!(key in sentPayload)) continue
          if (!(key in profile) || String(profile[key]) !== String(sentPayload[key])) return false
        }
        let expected, actual
        try {
          expected = JSON.parse(sentPayload.Services)
          actual = typeof profile.Services === 'string' ? JSON.parse(profile.Services) : profile.Services
        } catch (_) { return false }
        if (!actual || !expected) return false
        return ['service-1', 'service-2', 'service-3'].every(slot => {
          if (expected[slot] == null) return actual[slot] == null
          return actual[slot] && ['name', 'description', 'price']
            .every(key => String(actual[slot][key] ?? '') === String(expected[slot][key] ?? ''))
        })
      },
      finish(saved, outcome) {
        saving = false
        section.inert = false
        section.removeAttribute('aria-busy')
        snapshot = null
        if (!saved && outcome?.known) {
          // The server answered and refused the write, so nothing was saved and nothing is
          // in doubt. Keep the draft and the baseline, and leave Save and Discard usable.
          uncertain = false
          showCheck(false)
          status.textContent = outcome.message || 'The server rejected this change. Check the entry and try again.'
          return
        }
        if (!saved) {
          uncertain = dispatched
          showCheck(uncertain && !!readbackCheck)
          // A save the page abandoned before sending it never left the browser, which is the
          // same outcome - and the same sentence - the other unified sections report for a
          // write nobody dispatched. "Not saved" is reserved for a write that was sent and a
          // canonical read then proved never landed.
          status.textContent = uncertain
            ? 'We could not confirm whether your changes were saved. Your draft is kept. Save is paused until the server state can be checked.'
            : 'That change was not submitted. Your draft is kept; you can save again.'
          return
        }
        uncertain = false
        showCheck(false)
        const laterEdits = JSON.stringify(rowSnapshot()) !== JSON.stringify(submittedRows)
          || JSON.stringify(scalarValues(scalars())) !== JSON.stringify(scalarValues(submittedScalars))
        status.textContent = 'Changes saved.'
        scalarBaseline = submittedScalars
        baseline = submittedRows
        submittedRowStates.forEach(({ row, values }) => rowBaselines.set(row, values))
        remaining().filter(meaningful).forEach(row => retained.add(row))
        rows().filter(row => row.hasAttribute('profile-items-removed')).forEach(row => row.remove())
        if (!baseline.length) baseline = [{ values: {}, retained: false }]
        if (!remaining().length) newRow(null, false)
        refreshHeaders()
        if (laterEdits) {
          dirty()
          status.textContent = 'Changes saved. Later edits are still unsaved.'
        }
        else {
          section.removeAttribute('profile-items-dirty')
          window.__tsProfileDirtyState?.setDirty(6, false)
        }
      },
      prepare(payload) {
        if (saving && snapshot) { Object.assign(payload, snapshot); return }
        const keys = {
          rate: 'Hourly_Rate', 'rate-retainer': 'Retainer_Rate',
          'description-retainer': 'Retainer_Description', 'offer-monthly-retainers': 'Retainer_Enabled',
          'availability-option': 'Availability', availability: 'Availability_ID',
          'full-time-placement': 'Open_to_Full_Time',
        }
        scalarFields().forEach(field => {
          const name = field.getAttribute('name')
          const key = keys[name]
          if (!key || field.disabled || (field.getAttribute('type') === 'radio' && !field.checked)) return
          const raw = String(field.value || '').trim()
          payload[key] = key === 'Retainer_Enabled' || key === 'Open_to_Full_Time' ? raw === 'yes'
            : (key === 'Hourly_Rate' || key === 'Retainer_Rate') && raw !== '' ? Number(raw) : field.value
        })
        if (payload.Retainer_Enabled === false) {
          payload.Retainer_Rate = 0
          // Turning retainers off disables the description control, so the loop above skips it
          // and the stored description would survive a Save that says retainers are off. This
          // section owns that value, so send the cleared one whenever it owns the control.
          if (scalarFields().some(field => field.getAttribute('name') === 'description-retainer')) {
            payload.Retainer_Description = ''
          }
        }
        const values = remaining().filter(row => retained.has(row) || meaningful(row)).map(row => {
          const entry = {}
          fields(row).forEach(field => {
            const key = field.getAttribute('data-name').replace(/^service-/, '')
            entry[key] = key === 'price' && String(field.value).trim() !== '' ? Number(field.value) : field.value
          })
          return entry
        })
        payload.Services = JSON.stringify({
          'service-1': values[0] || null, 'service-2': values[1] || null, 'service-3': values[2] || null,
        })
      },
    }
    // The main controller marks Save as not yet usable while this section is still waiting
    // for the saved profile. It is usable from here on.
    save.removeAttribute('aria-disabled')
    save.removeAttribute('data-profile-section-loading')
    sections.set(section, controller)
    return controller
  }
  window.StarterProfileSections = { bindServices, get: section => sections.get(section) }
  function initialize() {
    const bindAll = () => Array.from(document.querySelectorAll('[profile-unified-items="services"]')).forEach(bindServices)
    if (typeof window.waitProfileData === 'function') {
      window.waitProfileData(bindAll)
      return
    }
    // `waitProfileData` comes from a page embed that may not have run yet, so wait for the
    // profile itself on the same signal that embed waits on: `createEmptyProfile()` publishes
    // `window.activeProfile` as a placeholder with a null `last_update` long before the saved
    // profile is fetched. Binding is not hydration, so it stays outside runHydrationSync. Never
    // bind without the saved profile: the services would hydrate as no rows, and a late profile
    // would then let Save clear them. Giving up leaves the section without a controller, which
    // the main controller already reports as unloadable.
    const startedAt = Date.now()
    const poll = () => {
      const profile = window.activeProfile
      if (profile && profile.last_update !== null && profile.last_update !== undefined) {
        bindAll()
        return
      }
      if (Date.now() - startedAt < 10000) window.setTimeout(poll, 100)
    }
    poll()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true })
  else initialize()
})()
