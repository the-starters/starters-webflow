/*
 * Opt-in Highlight drafts, coordinated around the existing portfolio/media writers.
 *
 * @release v1.59.581
 */
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
    // A row is cloned and rebuilt, so a marker authored inside one would be detached.
    const authored = selector => Array.from(section.querySelectorAll(selector)).find(node => !node.closest(ROW))
    // Webflow may author the status element so Designer owns its look; create one only when
    // it did not, and never a second.
    let status = authored('[profile-items-status]')
    if (!status) {
      status = document.createElement('div')
      status.setAttribute('profile-items-status', ''); section.appendChild(status)
    }
    status.setAttribute('role', 'status')
    // Same for the check control: adopt the authored one, keeping the label its author wrote.
    // Adopted before any early return so a halted section never leaves a live check control.
    let check = authored('[profile-items-check-save]')
    if (!check) {
      check = document.createElement('button')
      check.setAttribute('profile-items-check-save', ''); section.appendChild(check)
    }
    if (check.tagName === 'BUTTON') check.setAttribute('type', 'button')
    // Authored children are the label, so only a wholly empty control gets the default copy.
    if (!check.children.length && !check.textContent.trim()) check.textContent = 'Check saved state'
    // A Webflow class can set `display`, which beats the [hidden] rule, so write both.
    // Clearing the inline style only uncovers the class rule, so a class that sets
    // `display: none` needs an inline display of its own to be beaten.
    const showCheck = visible => {
      check.hidden = !visible
      check.style.display = visible ? '' : 'none'
      if (visible && window.getComputedStyle?.(check)?.display === 'none') check.style.display = 'inline-block'
    }
    showCheck(false)
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
    let records = [], baseline = [], active = null, loading = true, saving = false, unknown = null
    let misconfigured = false, warned = false
    const clone = value => JSON.parse(JSON.stringify(value))
    // Only a request that actually left the browser can leave an outcome in doubt, so the
    // writer counts its dispatches.
    const dispatches = () => writer.dispatches()
    const dispatchedSince = count => dispatches() !== count
    // A canonical read can settle a write three ways: it landed (the confirmed record), it
    // never landed, or neither. Only the last keeps Save paused - a write proved not to have
    // landed leaves the Starter where a refusal would, with the draft intact and Save usable.
    // One definition of that verdict, its error and its message is shared with the other
    // unified sections through the validator this section already depends on.
    const { NOT_LANDED, error: notLanded, MESSAGE: NOT_LANDED_MESSAGE } = window.StarterProfileValidation.notLanded
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
    // A confirmed write ends a selected file's life in the page: revoke its object URL and
    // drop the File handle so the entry renders from the stored media and holds no memory.
    function releaseMedia(item) {
      if (item.preview?.startsWith('blob:')) URL.revokeObjectURL(item.preview)
      item.preview = null
      item.file = null
    }
    function release(record) {
      for (const item of [...record.images, ...record.videos]) releaseMedia(item)
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
        record[kind] = (value[kind] || []).map(item => ({ key: ++nextId, id: item.id,
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
        if (active === record) active = remaining().at(-1) || null
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
      // Only the row fields this section submits. A marker on anything else authored inside the
      // section belongs to the script that writes it, not to Highlights.
      const fields = window.StarterProfileValidation.misconfigured(section,
        { applies: input => input.hasAttribute('profile-highlight-field') })
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
    // A deletion the server answered is confirmed by that answer alone, with no canonical read
    // behind it, so the baseline drops exactly the media entry the server removed and keeps the
    // rest of the record as it was last confirmed.
    function dropMedia(record, kind, id) {
      const known = baseline.find(item => String(item.id) === String(record.id))
      if (known && Array.isArray(known[kind])) known[kind] = known[kind].filter(media => String(media.id) !== String(id))
    }
    // The mirror of `dropMedia`: an attachment the server answered is confirmed by that answer,
    // so the baseline gains exactly the media entry the server created and the rest of the
    // record stays as it was last confirmed.
    function addMedia(record, kind, media) {
      const known = baseline.find(item => String(item.id) === String(record.id))
      if (known && Array.isArray(known[kind])) known[kind] = known[kind]
        .filter(entry => String(entry.id) !== String(media.id)).concat(clone(media))
    }
    async function canonical(record) {
      return (await writer.read(record.id))[0] || null
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
    // `respond` reads the mutation's own answer. A received 2xx that carries the written row is
    // the write's own confirmation, so the canonical read is only the fallback: for a lost
    // response, or for a write whose answer does not carry the row.
    async function operation(run, reconcile, confirm, label, respond) {
      status.textContent = label
      const sent = dispatches()
      let lost = false, answer = null
      // A received non-2xx answer is a known refusal: the server replied and wrote nothing. A
      // throw before the request left the browser never reached the server at all. Both stop
      // the save with the draft intact; only a lost response stays unknown until a read.
      // A 2xx whose body the writer could not read is still an answer the section received, so
      // that write landed and is not lost.
      try {
        answer = await run()
      } catch (error) {
        if (error?.known) throw error
        if (!error?.received) {
          if (!dispatchedSince(sent)) throw error
          // The response was lost. Never replay the mutation; reconcile it instead.
          lost = true
        }
      }
      const answered = lost ? null : respond?.(answer)
      if (answered) { confirm(answered); unknown = null; return }
      unknown = { reconcile, confirm, lost }
      const result = await reconcile()
      // Only a lost response can be proved never to have landed. After a received 2xx the write
      // is already the server's, so a read that disagrees is lag rather than proof: the outcome
      // stays unknown and "Check saved state" settles it once the read catches up.
      if (result === NOT_LANDED) {
        if (!lost) throw new Error('Unconfirmed mutation')
        unknown = null; throw notLanded()
      }
      if (!result) throw new Error('Unconfirmed mutation')
      confirm(result); unknown = null
    }
    check.addEventListener('click', async event => {
      // An authored control may be an anchor or a submit button, so never let its default run.
      event.preventDefault()
      if (!unknown?.reconcile || saving || check.disabled) return
      check.disabled = true
      try {
        const result = await unknown.reconcile()
        if (result === NOT_LANDED) {
          // A lag behind a received answer is not proof; only a lost response can be settled here.
          if (!unknown.lost) throw new Error('Still unknown')
          unknown = null; showCheck(false)
          status.textContent = NOT_LANDED_MESSAGE
          return
        }
        if (!result) throw new Error('Still unknown')
        unknown.confirm(result); unknown = null; showCheck(false)
        status.textContent = 'That change is confirmed. Save the section to finish the remaining draft changes.'
      } catch (_) { status.textContent = 'The save is still unconfirmed. Your draft is kept; Save remains paused.' }
      finally { check.disabled = false }
    })
    async function persistRecord(submitted) {
      const { record, value, images, videos } = submitted
      if (!record.id) {
        const before = await writer.readIndex(), beforeIds = before.map(item => String(item.id))
        await operation(() => writer.create({ memberstack_id: writer.memberId, ...value, thumbnail_url: '' }), async () => {
          const after = await writer.readIndex()
          const matches = after.filter(item => !beforeIds.includes(String(item.id)) && item.title === value.title && (item.description || '') === value.description)
          if (matches.length === 1) return (await writer.read(matches[0].id))[0]
          // No row at all outside the pre-write set is proof that nothing was created; an
          // unmatched new row leaves the outcome unknown.
          return after.some(item => !beforeIds.includes(String(item.id))) ? null : NOT_LANDED
        }, result => { record.id = result.id; advance(record, result) }, 'Creating highlight…',
        // The create answers with the new record, id included: that answer is the confirmation,
        // so a list read that has not caught up cannot turn a landed create into a lost one.
        // A fresh record holds no media yet, which is what the empty lists record, and the
        // confirmed details are the ones that were sent: an answer carrying only an id must
        // never become a blank baseline row.
        answer => {
          const row = window.StarterProfileValidation.answeredRow(answer, value)
          return row && { images: [], videos: [], ...row }
        })
      }
      for (const [kind, items] of [['images', images], ['videos', videos]]) {
        const singular = kind === 'images' ? 'Image' : 'Video'
        const payloadKey = kind === 'images' ? 'image' : 'video'
        for (const item of items.filter(item => item.removed && item.ref.id)) {
          await operation(() => writer['remove' + singular](item.ref.id), async () => {
            const current = await canonical(record)
            if (!current) return null
            return current[kind].some(media => String(media.id) === String(item.ref.id)) ? NOT_LANDED : { current }
          }, resolution => {
            // The canonical read is the fallback: an answer the section received confirms the
            // deletion on its own, and the baseline then drops just that media entry.
            if (resolution.current) advance(record, resolution.current)
            else dropMedia(record, kind, item.ref.id)
            // The stored file is gone and no local file remains, so the entry cannot be
            // restored. Drop it instead of leaving an Undo that would upload nothing.
            record[kind] = record[kind].filter(entry => entry !== item.ref)
            releaseMedia(item.ref)
            renderMedia(record, kind)
          }, 'Removing highlight media…',
          // Any answer to a deletion is that deletion's own confirmation.
          () => ({ removed: true }))
        }
        for (const item of items.filter(item => !item.removed && !item.ref.id)) {
          if (!item.ref.uploaded) {
            status.textContent = 'Uploading highlight media…'
            const pending = {
              reconcile: () => reconcileUpload(record, kind, item.ref),
              confirm: resolution => {
                if (resolution.media) {
                  item.ref.id = resolution.media.id
                  item.ref.url = resolution.media[payloadKey + '_url']
                  item.ref.uploaded = resolution.media[payloadKey]
                }
                advance(record, resolution.current)
                renderMedia(record, kind)
              },
            }
            const sent = dispatches()
            const uploaded = await writer['upload' + singular](item.ref.file)
              .then(result => { unknown = pending; return result })
              .catch(error => {
                // A refusal, and a throw before the upload left the browser, both wrote nothing.
                if (!error?.known && dispatchedSince(sent)) unknown = pending
                throw error
              })
            if (!uploaded || typeof uploaded.path !== 'string' || !uploaded.path.startsWith('/')) throw new Error('Invalid upload response')
            item.ref.uploaded = uploaded; unknown = null
          }
          const url = writer.assetUrl(item.ref.uploaded)
          await operation(() => writer['add' + singular]({ memberstack_id: writer.memberId, portfolio_id: Number(record.id),
            [payloadKey]: item.ref.uploaded, [payloadKey + '_url']: url, ...(kind === 'images' ? { is_cover: false } : {}), sort_order: items.indexOf(item) }), async () => {
            const current = await canonical(record)
            // An attachment the read cannot find is never declared not-landed: a second Save
            // would attach the same upload twice. It stays unknown until a read finds it.
            const matches = current?.[kind].filter(media => media[payloadKey + '_url'] === url) || []
            return matches.length === 1 ? { current, media: matches[0] } : null
          }, ({ current, media }) => {
            item.ref.id = media.id; item.ref.url = url
            // The stored file is now the entry's source, so the local one is released and
            // the list re-rendered off it rather than off a revoked object URL.
            releaseMedia(item.ref); renderMedia(record, kind)
            // The canonical read is the fallback: an answer the section received confirms the
            // attachment on its own, and the baseline then gains just that media entry.
            if (current) advance(record, current)
            else addMedia(record, kind, media)
          }, 'Attaching highlight media…',
          // The attach answers with the media row it created, id included, so that answer is
          // the confirmation and a media read that has not caught up cannot turn a landed
          // attachment into an uncertain one.
          answer => {
            const media = window.StarterProfileValidation.answeredRow(answer,
              { [payloadKey]: item.ref.uploaded, [payloadKey + '_url']: url })
            return media && { current: null, media }
          })
        }
      }
      const cover = images.find(item => !item.removed && item.cover)
      const coverId = cover?.ref.id || null
      const thumbnail = cover ? cover.ref.url : ''
      const details = row => JSON.stringify([row.title, row.description || '', row.cover_image_id || null, row.thumbnail_url || ''])
      const sent = JSON.stringify([value.title, value.description, coverId, thumbnail])
      const known = baseline.find(item => String(item.id) === String(record.id))
      const knownDetails = known ? details(known) : null
      if (knownDetails === sent) return
      await operation(() => writer.update({ id: record.id, memberstack_id: writer.memberId, ...value, cover_image_id: coverId, thumbnail_url: thumbnail }), async () => {
        const current = await canonical(record)
        if (!current) return null
        if (details(current) === sent) return current
        // The record still holds exactly what it held before the write, so the update is
        // proved not to have landed rather than merely unconfirmed.
        return knownDetails !== null && details(current) === knownDetails ? NOT_LANDED : null
      }, current => advance(record, current), 'Saving highlight details…',
      // The update answers with the record it wrote, so that answer confirms it. The answer
      // covers the record's own columns only, so the media this save already confirmed stays
      // on the baseline rather than being blanked by a row that never carried it.
      answer => {
        const row = window.StarterProfileValidation.answeredRow(answer,
          { ...value, cover_image_id: coverId, thumbnail_url: thumbnail })
        // The media list is carried over from the baseline, but the cover flag on each image is
        // recomputed from the cover this save sent: a stale `is_cover` on a former cover would
        // otherwise outrank the new one when the list is next normalized.
        return row && { images: (known?.images || []).map(image => ({ ...image, is_cover: Number(image.id) === Number(coverId) })),
          videos: known?.videos || [], ...row }
      })
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
            // A reconciler only reports. The baseline advances in confirm(), never here, so a
            // read taken while the outcome is still open can never rewrite a confirmed record.
            return await canonical(record) ? NOT_LANDED : { removed: true }
          }, () => { advance(record, null); release(record) }, 'Removing highlight…',
          // Any answer to a deletion is that deletion's own confirmation, so a list read that
          // has not caught up cannot turn a removal the server took into a lost one.
          () => ({ removed: true }))
        }
        for (const item of submitted) await persistRecord(item)
        saved = true
        const later = submitted.some(item => signature(item.record) !== item.signature)
          || remaining().some(record => present(record) && !kept.includes(record))
        if (later) { dirty(); status.textContent = 'Changes saved. Later edits are still unsaved.' }
        else { restore(); clean(); status.textContent = 'Changes saved.' }
      } catch (error) {
        showCheck(!!unknown?.reconcile)
        if (error?.known) {
          // The server refused this change, so Save and Discard stay available for the draft.
          status.textContent = error.serverMessage || 'The server rejected this change. Check the entry and try again.'
        } else if (error?.notLanded) {
          // The canonical read proved this write never landed, so nothing is in doubt.
          status.textContent = NOT_LANDED_MESSAGE
        } else {
          status.textContent = unknown
            ? 'A save could not be confirmed. Your files, draft, and confirmed changes are kept. Save is paused.'
            : 'That change was not submitted. Your draft is kept; you can save again.'
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
