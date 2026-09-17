/* Opt-in Highlight drafts, coordinated around the existing portfolio/media writers. */
;(function () {
  'use strict'
  if (window.StarterProfileHighlights) return
  const bound = new WeakSet()
  let nextId = 0
  async function bind(section, writer) {
    if (bound.has(section)) return
    bound.add(section)
    const ROW = '[profile-item-row]'
    const save = section.querySelector('[data-edit-submit="portfolio"]')
    const status = document.createElement('div')
    status.setAttribute('role', 'status'); status.setAttribute('profile-items-status', '')
    section.appendChild(status)
    const original = section.querySelector(ROW)
    const template = original?.cloneNode(true), parent = original?.parentElement
    if (!template || !parent || !save) {
      // The row is also the template for every added row, and Save is the only route to the
      // writer. Without either, report the markup gap and disable Save instead of leaving a
      // live control that silently does nothing.
      console.warn('[unified-highlights] missing [profile-item-row] or Save control in section')
      status.textContent = 'This section could not load. Reload the page before editing.'
      save?.setAttribute('disabled', '')
      return
    }
    const field = (record, key) => record.row.querySelector('[profile-highlight-field="' + key + '"]')
    const check = document.createElement('button')
    check.setAttribute('type', 'button'); check.setAttribute('profile-items-check-save', '')
    check.textContent = 'Check saved state'; check.hidden = true
    section.appendChild(check)
    let records = [], baseline = [], active = null, loading = true, saving = false, unknown = null
    let misconfigured = false, warned = false
    const clone = value => JSON.parse(JSON.stringify(value))
    const remaining = () => records.filter(record => !record.removed)
    const keptMedia = (record, kind) => record[kind].filter(item => !item.removed)
    const present = record => record.id || field(record, 'title')?.value.trim() || field(record, 'description')?.value.trim()
      || keptMedia(record, 'images').length || keptMedia(record, 'videos').length
    const textValues = record => ({ title: field(record, 'title')?.value.trim() || '', description: field(record, 'description')?.value.trim() || '' })
    // Kept media only: a confirmed deletion drops its entry, which must not look like a
    // later edit, while any removal or Undo still changes what is kept.
    const signature = record => JSON.stringify({ ...textValues(record), removed: record.removed,
      images: keptMedia(record, 'images').map(item => [item.key, item.cover]),
      videos: keptMedia(record, 'videos').map(item => [item.key]) })
    function dirty() {
      if (loading) return
      section.setAttribute('profile-items-dirty', 'true')
      window.__tsProfileDirtyState?.markDirty(4)
      if (!saving && !unknown && !misconfigured) status.textContent = 'Unsaved changes.'
    }
    function setOpen(record, open) {
      const content = record.row.querySelector('[profile-item-content]')
      if (content) { content.hidden = !open; content.inert = !open; content.style.height = open ? 'auto' : '0px' }
      record.row.querySelector('[profile-item-toggle]')?.setAttribute('aria-expanded', String(open))
      const summary = record.row.querySelector('[profile-items-summary]')
      if (summary) summary.textContent = textValues(record).title || 'Highlight'
      if (open) active = record
    }
    function release(record) {
      for (const item of [...record.images, ...record.videos]) if (item.preview?.startsWith('blob:')) URL.revokeObjectURL(item.preview)
      record.row.remove()
      records = records.filter(item => item !== record)
    }
    function normalizeCover(record) {
      const images = keptMedia(record, 'images')
      const cover = images.find(item => item.cover) || images[0]
      record.images.forEach(item => { item.cover = item === cover })
    }
    function mediaChanged(record, kind) {
      normalizeCover(record); renderMedia(record, kind); dirty()
      field(record, kind)?.dispatchEvent(new Event('input', { bubbles: true }))
    }
    function renderMedia(record, kind) {
      const list = record.row.querySelector('[profile-items-media="' + kind + '"]')
      if (!list) return
      list.textContent = ''
      record[kind].forEach(item => {
        const entry = document.createElement('div')
        entry.setAttribute('profile-media-item', '')
        const label = document.createElement('span')
        label.textContent = item.file?.name || (kind === 'images' ? 'Saved photo' : 'Saved video')
        entry.appendChild(label)
        if (!item.removed) {
          const preview = document.createElement(kind === 'images' ? 'img' : 'video')
          preview.setAttribute('src', item.preview || item.url)
          if (kind === 'images') preview.setAttribute('alt', item.file?.name || 'Highlight photo')
          else { preview.setAttribute('controls', ''); preview.setAttribute('preload', 'metadata') }
          preview.style.maxWidth = '100%'
          entry.appendChild(preview)
          if (kind === 'images') {
            const cover = document.createElement('button')
            cover.setAttribute('type', 'button'); cover.setAttribute('profile-media-cover', '')
            cover.setAttribute('aria-pressed', String(item.cover)); cover.textContent = item.cover ? 'Cover photo' : 'Use as cover'
            cover.addEventListener('click', () => {
              if (saving) return
              record.images.forEach(candidate => { candidate.cover = candidate === item })
              mediaChanged(record, kind)
            })
            entry.appendChild(cover)
          }
        }
        const action = document.createElement('button')
        action.setAttribute('type', 'button'); action.setAttribute(item.removed ? 'profile-media-undo' : 'profile-media-remove', '')
        action.textContent = item.removed ? 'Undo removal' : 'Remove'
        action.addEventListener('click', () => { if (!saving) { item.removed = !item.removed; mediaChanged(record, kind) } })
        entry.appendChild(action); list.appendChild(entry)
      })
    }
    function addRow(value = {}, focus = false) {
      const row = template.cloneNode(true)
      const record = { row, key: ++nextId, id: value.id || null, removed: false, images: [], videos: [] }
      row.setAttribute('data-profile-row-id', 'highlight-' + record.key)
      const ids = new Map()
      Array.from(row.querySelectorAll('[id]')).forEach(node => { const id = node.getAttribute('id'); ids.set(id, id + '--highlight-' + record.key); node.setAttribute('id', ids.get(id)) })
      Array.from(row.querySelectorAll('[for], [aria-describedby], [aria-controls], [aria-labelledby]')).forEach(node => {
        for (const key of ['for', 'aria-describedby', 'aria-controls', 'aria-labelledby']) {
          const value = node.getAttribute(key)
          if (value) node.setAttribute(key, value.split(/\s+/).map(id => ids.get(id) || id).join(' '))
        }
      })
      for (const key of ['title', 'description', 'images', 'videos']) {
        const input = field(record, key)
        if (input) { input.setAttribute('name', key + '--highlight-' + record.key); input.value = ['images', 'videos'].includes(key) ? '' : value[key] || '' }
      }
      for (const kind of ['images', 'videos']) {
        const mediaKey = kind === 'images' ? 'image' : 'video'
        record[kind] = (value[kind] || []).map(item => ({ key: ++nextId, id: item.id, stored: item,
          url: item[mediaKey + '_url'], size: item[mediaKey]?.size, removed: false,
          cover: kind === 'images' && (Number(value.cover_image_id) === Number(item.id) || !!item.is_cover) }))
        field(record, kind)?.addEventListener('change', () => {
          if (saving) return
          const input = field(record, kind)
          for (const file of Array.from(input.files || [])) record[kind].push({ key: ++nextId, file, size: file.size,
            preview: URL.createObjectURL(file), removed: false, cover: false })
          input.value = ''
          mediaChanged(record, kind)
        })
      }
      normalizeCover(record)
      parent.appendChild(row); records.push(record)
      renderMedia(record, 'images'); renderMedia(record, 'videos')
      const toggle = row.querySelector('[profile-item-toggle]')
      toggle?.setAttribute('role', 'button'); toggle?.setAttribute('tabindex', '0')
      function toggleRow(event) {
        if (event.target.closest?.('[profile-item-remove]')) return
        event.preventDefault()
        if (!saving && !record.removed) setOpen(record, toggle.getAttribute('aria-expanded') !== 'true')
      }
      toggle?.addEventListener('click', toggleRow)
      toggle?.addEventListener('keydown', event => { if (event.target === toggle && ['Enter', ' '].includes(event.key)) toggleRow(event) })
      const remove = row.querySelector('[profile-item-remove]')
      const undo = document.createElement('button')
      undo.setAttribute('type', 'button'); undo.setAttribute('profile-items-undo', ''); undo.textContent = 'Undo removal'; undo.hidden = true
      row.appendChild(undo)
      remove?.addEventListener('click', event => {
        event.preventDefault()
        if (saving) return
        record.removed = true; setOpen(record, false)
        if (toggle) toggle.hidden = true
        remove.hidden = true; undo.hidden = false
        active = remaining().at(-1) || null
        if (!remaining().length) addRow({}, true)
        dirty()
      })
      undo.addEventListener('click', () => {
        if (saving) return
        remaining().filter(item => !present(item)).forEach(release)
        if (remaining().length >= 9) { status.textContent = 'You can keep up to nine highlights. Remove another before restoring this one.'; return }
        record.removed = false
        if (toggle) toggle.hidden = false
        if (remove) remove.hidden = false
        undo.hidden = true; setOpen(record, true); field(record, 'title')?.focus(); dirty()
      })
      row.addEventListener('focusin', () => { active = record })
      setOpen(record, !record.id)
      if (focus) field(record, 'title')?.focus()
      return record
    }
    function recordFor(input) { return records.find(record => record.row.contains(input)) }
    const validation = window.StarterProfileValidation.bind(section, {
      applies(input) {
        // Only authored Highlight fields belong to this section's rules. A stray control
        // inside or beside a row, and the presence marker that Save reports itself, must
        // not turn an unrelated authored `required`/`maxlength` into a Save blocker.
        if (!input.hasAttribute('profile-highlight-field')) return false
        const record = recordFor(input)
        return !!record && !record.removed && !!present(record)
      },
      valuePresent(input) {
        const kind = input.getAttribute('profile-highlight-field'), record = recordFor(input)
        return !!record && ['images', 'videos'].includes(kind) && keptMedia(record, kind).length > 0
      },
      message(input) {
        const kind = input.getAttribute('profile-highlight-field'), record = recordFor(input)
        if (!record || !['images', 'videos'].includes(kind)) return ''
        // The portfolio video endpoint refuses anything above 40 MB, so the field stops it first.
        const items = keptMedia(record, kind), maximum = kind === 'images' ? 5 : 3, megabytes = kind === 'images' ? 4 : 40
        if (items.length > maximum) return 'Keep no more than ' + maximum + (kind === 'images' ? ' photos.' : ' videos.')
        if (items.some(item => item.size > megabytes * 1024 * 1024)) return 'Each ' + (kind === 'images' ? 'photo' : 'video') + ' must be ' + megabytes + ' MB or smaller.'
        if (items.some(item => item.file && !item.file.type.startsWith(kind === 'images' ? 'image/' : 'video/'))) return 'Choose ' + (kind === 'images' ? 'image' : 'video') + ' files.'
        return ''
      },
      reveal(input) { const record = recordFor(input); if (record) setOpen(record, true) },
    })
    function restore() {
      validation.reset(); records.slice().forEach(release)
      ;(baseline.length ? baseline : [{}]).forEach(value => addRow(value))
      active = records.find(record => !record.id) || records[0]
    }
    function clean() { section.removeAttribute('profile-items-dirty'); window.__tsProfileDirtyState?.setDirty(4, false) }
    // `form-xano-required` marks a field whose blank value the Xano writer refuses. Authored
    // requiredness still comes only from the Webflow Required checkbox, so a mismatch would let
    // a Starter submit a blank the writer rejects. Pause Save on the mismatch instead of
    // inventing a JavaScript requirement. Field names only; never a Starter's values.
    function checkMisconfigured() {
      const fields = window.StarterProfileValidation.misconfigured?.(section) || []
      misconfigured = fields.length > 0
      if (misconfigured) {
        status.textContent = 'This form is misconfigured. Saving is paused until it is fixed.'
        if (!warned) {
          warned = true
          console.warn('[unified-highlights] form-xano-required without required:',
            Array.from(new Set(fields.map(field => field.getAttribute('profile-highlight-field') || ''))))
        }
      }
      return misconfigured
    }
    section.addEventListener('input', dirty); section.addEventListener('change', dirty)
    section.querySelector('[profile-items-add]')?.addEventListener('click', event => {
      event.preventDefault()
      if (saving || loading) return
      if (!active || !present(active)) { field(active || records[0], 'title')?.focus(); return }
      if (!validation.validate(active.row).valid) return
      if (remaining().length >= 9) { status.textContent = 'You can keep up to nine highlights.'; return }
      setOpen(active, false); addRow({}, true)
    })
    section.querySelector('[profile-items-discard]')?.addEventListener('click', event => {
      event.preventDefault()
      if (saving || loading || unknown) return
      restore(); clean(); status.textContent = 'Changes discarded.'
    })
    function advance(record, canonical) {
      baseline = baseline.filter(item => String(item.id) !== String(record.id))
      if (canonical) baseline.push(clone(canonical))
    }
    async function canonical(record) {
      const current = await writer.read(record.id)
      return current.find(item => String(item.id) === String(record.id)) || null
    }
    // Storage exposes no lookup by client request or file identity, so a lost upload response is
    // resolved against this highlight's canonical media instead: an attached item that no other
    // draft entry already claims and that carries the same file name and size means the work
    // landed and is adopted. No match means nothing was attached, so the selected file stays a
    // draft and the next Save uploads it again. A null result leaves the outcome unknown.
    async function reconcileUpload(record, kind, ref) {
      const current = await canonical(record)
      if (!current) return null
      const payloadKey = kind === 'images' ? 'image' : 'video'
      const claimed = new Set(record[kind].filter(item => item !== ref && item.id).map(item => String(item.id)))
      const matches = (current[kind] || []).filter(media => !claimed.has(String(media.id))
        && media[payloadKey]?.name === ref.file?.name && Number(media[payloadKey]?.size) === Number(ref.file?.size))
      return { current, media: matches.length === 1 ? matches[0] : null }
    }
    async function operation(run, reconcile, confirm, label) {
      status.textContent = label
      unknown = { reconcile, confirm }
      // A received non-2xx answer is a known refusal: the server replied and wrote nothing, so
      // the save stops with the draft intact. Only a lost response stays unknown until a read.
      try { await run() } catch (error) {
        if (error?.known) { unknown = null; throw error }
        /* Do not replay an uncertain mutation. */
      }
      const result = await reconcile()
      if (!result) throw new Error('Unconfirmed mutation')
      confirm(result); unknown = null
    }
    check.addEventListener('click', async () => {
      if (!unknown?.reconcile || saving || check.disabled) return
      check.disabled = true
      try {
        const result = await unknown.reconcile()
        if (!result) throw new Error('Still unknown')
        unknown.confirm(result); unknown = null; check.hidden = true
        status.textContent = 'That change is confirmed. Save the section to finish the remaining draft changes.'
      } catch (_) { status.textContent = 'The save is still unconfirmed. Your draft is kept; Save remains paused.' }
      finally { check.disabled = false }
    })
    async function persistRecord(submitted) {
      const { record, value, images, videos } = submitted
      if (!record.id) {
        const before = await writer.readIndex(), beforeIds = before.map(item => String(item.id))
        await operation(() => writer.create({ memberstack_id: writer.memberId, ...value, thumbnail_url: '' }), async () => {
          const matches = (await writer.readIndex()).filter(item => !beforeIds.includes(String(item.id)) && item.title === value.title && (item.description || '') === value.description)
          return matches.length === 1 ? (await writer.read(matches[0].id))[0] : null
        }, result => { record.id = result.id; advance(record, result) }, 'Creating highlight…')
      }
      for (const [kind, items] of [['images', images], ['videos', videos]]) {
        const singular = kind === 'images' ? 'Image' : 'Video'
        const payloadKey = kind === 'images' ? 'image' : 'video'
        for (const item of items.filter(item => item.removed && item.ref.id)) {
          await operation(() => writer['remove' + singular](item.ref.id), async () => {
            const current = await canonical(record)
            return current && !current[kind].some(media => String(media.id) === String(item.ref.id)) ? current : null
          }, current => {
            advance(record, current)
            // The stored file is gone and no local file remains, so the entry cannot be
            // restored. Drop it instead of leaving an Undo that would upload nothing.
            record[kind] = record[kind].filter(entry => entry !== item.ref)
            renderMedia(record, kind)
          }, 'Removing highlight media…')
        }
        for (const item of items.filter(item => !item.removed && !item.ref.id)) {
          if (!item.ref.uploaded) {
            status.textContent = 'Uploading highlight media…'
            unknown = {
              reconcile: () => reconcileUpload(record, kind, item.ref),
              confirm: resolution => {
                if (resolution.media) {
                  item.ref.id = resolution.media.id
                  item.ref.url = resolution.media[payloadKey + '_url']
                  item.ref.stored = resolution.media
                  item.ref.uploaded = resolution.media[payloadKey]
                }
                advance(record, resolution.current)
                renderMedia(record, kind)
              },
            }
            const uploaded = await writer['upload' + singular](item.ref.file)
              .catch(error => { if (error?.known) unknown = null; throw error })
            if (!uploaded || typeof uploaded.path !== 'string' || !uploaded.path.startsWith('/')) throw new Error('Invalid upload response')
            item.ref.uploaded = uploaded; unknown = null
          }
          const url = writer.assetUrl(item.ref.uploaded)
          await operation(() => writer['add' + singular]({ memberstack_id: writer.memberId, portfolio_id: Number(record.id),
            [payloadKey]: item.ref.uploaded, [payloadKey + '_url']: url, ...(kind === 'images' ? { is_cover: false } : {}), sort_order: items.indexOf(item) }), async () => {
            const current = await canonical(record)
            const matches = current?.[kind].filter(media => media[payloadKey + '_url'] === url) || []
            return matches.length === 1 ? { current, media: matches[0] } : null
          }, ({ current, media }) => { item.ref.id = media.id; item.ref.url = url; item.ref.stored = media; advance(record, current) }, 'Attaching highlight media…')
        }
      }
      const cover = images.find(item => !item.removed && item.cover)
      const coverId = cover?.ref.id || null
      const thumbnail = cover ? cover.ref.url : ''
      const current = baseline.find(item => String(item.id) === String(record.id))
      if (current && current.title === value.title && (current.description || '') === value.description
        && (current.cover_image_id || null) === coverId && (current.thumbnail_url || '') === thumbnail) return
      await operation(() => writer.update({ id: record.id, memberstack_id: writer.memberId, ...value, cover_image_id: coverId, thumbnail_url: thumbnail }), async () => {
        const current = await canonical(record)
        return current && current.title === value.title && (current.description || '') === value.description
          && (current.cover_image_id || null) === coverId && (current.thumbnail_url || '') === thumbnail ? current : null
      }, current => advance(record, current), 'Saving highlight details…')
    }
    save?.addEventListener('click', async event => {
      event.preventDefault()
      if (saving || loading || unknown || checkMisconfigured() || !validation.validate().valid) return
      const kept = remaining().filter(present)
      if (section.querySelector('[profile-items-presence]')?.required && !kept.length) {
        // Never reopen a row the Starter is removing: point at a usable row, adding one if needed.
        const target = remaining()[0] || addRow({}, true)
        status.textContent = 'Add at least one highlight.'; setOpen(target, true); field(target, 'title')?.focus(); return
      }
      const submitted = kept.map(record => ({ record, value: textValues(record), signature: signature(record),
        images: record.images.map(ref => ({ ref, removed: ref.removed, cover: ref.cover })),
        videos: record.videos.map(ref => ({ ref, removed: ref.removed })) }))
      const deletions = records.filter(record => record.removed && record.id)
      saving = true; section.inert = true; section.setAttribute('aria-busy', 'true')
      let saved = false
      const token = window.__tsProfileDirtyState?.beginSave(4)
      try {
        // Deletions free capacity before any ninth-entry replacement is created.
        for (const record of deletions) {
          await operation(() => writer.remove({ id: record.id, memberstack_id: writer.memberId }), async () => {
            const current = await canonical(record)
            if (current) { advance(record, current); return null }
            return { removed: true }
          }, () => { advance(record, null); release(record) }, 'Removing highlight…')
        }
        for (const item of submitted) await persistRecord(item)
        saved = true
        const later = submitted.some(item => signature(item.record) !== item.signature)
          || remaining().some(record => present(record) && !kept.includes(record))
        if (later) { dirty(); status.textContent = 'Changes saved. Later edits are still unsaved.' }
        else { restore(); clean(); status.textContent = 'Changes saved.' }
      } catch (error) {
        check.hidden = !unknown?.reconcile
        if (error?.known) {
          // The server refused this change, so Save and Discard stay available for the draft.
          status.textContent = error.serverMessage || 'The server rejected this change. Check the entry and try again.'
        } else {
          status.textContent = unknown
            ? 'A save could not be confirmed. Your files, draft, and confirmed changes are kept. Save is paused.'
            : 'The next change was not submitted. Confirmed changes are kept; you can save the remaining draft or discard it.'
        }
      } finally {
        saving = false; section.inert = false; section.removeAttribute('aria-busy')
        window.__tsProfileDirtyState?.finishSave(4, saved, token)
      }
    })
    section.inert = true; section.setAttribute('aria-busy', 'true'); status.textContent = 'Loading highlights…'
    try {
      baseline = await writer.read()
      if (baseline.length > 9 || baseline.some(item => !item?.id || !Array.isArray(item.images) || !Array.isArray(item.videos))) throw new Error('Invalid highlights')
      original.remove(); restore(); loading = false; status.textContent = ''
      checkMisconfigured()
    } catch (_) { status.textContent = 'Highlights could not be loaded. Save is paused to protect existing entries.' }
    // A failed load keeps Save paused through `loading`, but the section stays readable and
    // selectable: an inert section would hide its own explanation from a Starter.
    finally { section.inert = false; section.removeAttribute('aria-busy') }
  }
  window.StarterProfileHighlights = { bind }
})()
