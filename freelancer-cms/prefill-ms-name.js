// Docs: https://wf-starter-embeds-docs.vercel.app/docs/freelancer-cms/prefill-ms-name

(function () {
  'use strict'

  const READY = 'prefillInputInited'
  const SELECTOR = '[data-mscustom-fullname]'
  const POLL_MS = 100
  const MAX_TRIES = 50
  // 'free-user' is this site's legacy key for the member's first name
  const FIRST_NAME_KEYS = ['free-user', 'first-name', 'First Name', 'firstName', 'first_name', 'firstname']
  const LAST_NAME_KEYS = ['last-name', 'Last Name', 'lastName', 'last_name', 'lastname']

  /**
   * First non-empty custom-field value among the candidate keys.
   * @returns {string} trimmed value, or '' if no key matched
   */
  const pickField = (fields, keys) => {
    for (const key of keys) {
      const value = (fields[key] || '').toString().trim()
      if (value) return value
    }
    return ''
  }

  /** Poll for window.$memberstackDom, then fill; warn + stop if it never loads. */
  const waitForMemberstack = (targets, tries) => {
    if (window.$memberstackDom) return fill(targets)
    if (tries >= MAX_TRIES) return console.warn('[pre-fill-input] Memberstack not found')
    setTimeout(() => waitForMemberstack(targets, tries + 1), POLL_MS)
  }

  /** Read the current member and write the joined name into each empty target. */
  const fill = (targets) => {
    window.$memberstackDom.getCurrentMember()
      .then((member) => {
        if (!member || !member.data) return
        const fields = member.data.customFields || {}
        const fullName = [pickField(fields, FIRST_NAME_KEYS), pickField(fields, LAST_NAME_KEYS)]
          .filter(Boolean)
          .join(' ')
        if (!fullName) {
          console.warn('[pre-fill-input] no name fields matched — customFields keys:', Object.keys(fields))
          return
        }
        targets.forEach((el) => {
          if (el.value.trim()) return
          el.value = fullName
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        })
      })
      .catch((err) => console.warn('[pre-fill-input] getCurrentMember failed', err))
  }

  const init = () => {
    if (document.documentElement.dataset[READY]) return
    document.documentElement.dataset[READY] = 'true'

    const targets = Array.from(document.querySelectorAll(SELECTOR))
    if (!targets.length) return

    waitForMemberstack(targets, 0)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()