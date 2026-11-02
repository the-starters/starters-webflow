/**
 * Contact sharing reminder for TalkJS chat.
 *
 * Warns a member before a chat message that contains contact details (email,
 * phone number, outside meeting link, messaging app handle) reaches the other
 * participant. The send is always cancelled first, because TalkJS stops
 * waiting on an async override after a few seconds and would otherwise send
 * the original message while the member is still reading the warning.
 *
 *   Edit message  -> nothing is sent; the text goes back into the message field
 *   Send anyway   -> the text goes back; pressing Send again delivers it once,
 *                    tagged custom.contactFlag = "true" for monitoring
 *
 * Install once from Site settings -> Custom code -> Head code, as a deferred
 * script tag pointing at:
 *   https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@<tag>/v3/contact-reminder.js
 * (No literal closing script tag in this comment, so the file can also be
 * pasted inline for testing.)
 *
 * Chat controllers opt in after mounting (v3/messages.js, v3/messages-profile.js):
 *   window.attachContactReminder(inboxOrChatbox, 'brand' | 'starter')
 * Without this file on the page that call is skipped, so the controllers stay
 * safe to ship first.
 *
 * The popup is a native <dialog> opened with showModal(). The /hire/<slug>
 * chatbox lives inside a lumos modal that is itself opened with showModal(),
 * which puts it in the browser top layer and makes the rest of the page inert;
 * only another modal dialog can sit above it and stay clickable.
 *
 * Detection is client-side guidance only. Edits to sent messages, replies by
 * email, and details disguised letter by letter or written as words are left
 * to TalkJS content suppression and the AI monitoring scenario.
 */
;(function () {
  if (window.StartersContactReminder) return

  const COPY = {
    brand: {
      title: 'Keep it on The Starters',
      body:
        'Looks like your message includes contact details or an outside meeting link. ' +
        'Please keep communication, calls and payments on the platform.',
    },
    starter: {
      title: 'Sharing contact details against policy',
      body:
        'Your message includes contact details or an outside meeting link. ' +
        'Taking clients or work off The Starters breaks our terms of use, and ' +
        'Starters who do this will be removed from the platform. Keep ' +
        'communication, calls, and payments on The Starters.',
    },
  }

  // No lookbehind anywhere: Safari before 16.4 rejects it as a syntax error,
  // which would stop this whole file from loading.
  //
  // Messaging apps only count with contact intent ("add me on WhatsApp",
  // "my Telegram", "whatsapp me"): this is a marketing marketplace, and
  // "WhatsApp Business campaigns" or "our Telegram channel" are normal work talk.
  // "Signal me when ready" is ordinary English, so Signal only counts as an app
  // after "my" or "on/via", never as "<app> me".
  const APP_VERBS = 'whats\\s*app|telegram|skype|viber|wechat|imessage'
  const MESSAGING_APP = '(?:' + APP_VERBS + '|signal)'
  const CONTACT_RULES = [
    // Email. Skips retina asset names such as logo@2x.png.
    /[\w.+-]+@(?!\d+x\.)[\w-]+(\.[\w-]+)*\.[a-z]{2,}/i,
    // Spelled-out email: "name at gmail dot com", "name (at) gmail (dot) com".
    /\b[\w.+-]+(?:\s+at\s+|\s*[([]\s*at\s*[)\]]\s*)(?!(?:the|a|an|this|that|these|those|my|our|your|their|his|her|its)\b)[\w-]+(?:\s+dot\s+|\s*[([]\s*dot\s*[)\]]\s*)(com|net|org|io|co|ae)\b/i,
    // Phone, local or international: 050 123 4567, +971 50 123 4567, (415) 555-0172.
    /(?:^|[^\w/])(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3}[\s.-]?\d{3,4}(?!\d)/i,
    // Phone with a country code in other groupings: +44 20 7946 0958.
    /\+\d{1,3}[\s.-]?\d{1,4}(?:[\s.-]?\d{2,4}){2,4}(?!\d)/,
    // Meeting and booking links.
    /\b(calendly\.com|zoom\.us|meet\.google\.com|cal\.com|teams\.microsoft\.com|teams\.live\.com|whereby\.com)/i,
    /\b(calendly|zoom)\s*(dot|\.)\s*(com|us)\b/i,
    // Messaging app links, then messaging apps with contact intent.
    /\b(wa\.me|t\.me)\/\S+/i,
    new RegExp('\\b(?:' + APP_VERBS + ')\\s+(me|us)\\b', 'i'),
    new RegExp(
      '\\bmy\\s+' + MESSAGING_APP +
        '\\b(?!\\s+(?:channels?|campaigns?|groups?|business|strategy|ads|marketing|community|bots?)\\b)',
      'i',
    ),
    new RegExp(
      '\\b(add|message|msg|text|dm|ping|reach|contact|call|find|chat|talk|continue|move|switch|connect)\\b' +
        '[^.!?\\n]{0,24}\\b(on|via|over|through|to|in)\\s+' + MESSAGING_APP + '\\b',
      'i',
    ),
  ]
  const ALLOWED_LINKS = /\S*(thestarters\.com|hirethestarters\.com)\S*/gi
  // Figures that would otherwise pass for a phone number: amounts next to a
  // currency or unit ("15000000 IDR", "120 000 000 impressions"), and order,
  // invoice and reference numbers. A figure only counts when it stands alone
  // and does not start with 0, so a phone number is never stripped as one.
  const CURRENCY = 'IDR|PHP|AED|USD|EUR|GBP'
  const STANDS_ALONE = '(?![\\s.,-]?\\d)'
  const AMOUNT = '(?:[1-9]\\d{0,2}(?:\\s\\d{3})+|[1-9]\\d*(?:[.,]\\d+)*)' + STANDS_ALONE
  const NOT_PHONES = new RegExp(
    '\\b(?:' + CURRENCY + ')\\s*' + AMOUNT +
      '|(^|[^\\d\\s.,+-])(\\s*)' + AMOUNT + '\\s*(?:' + CURRENCY + '|impressions|followers|views)\\b' +
      '|(?:\\b(?:order|invoice|ref)\\b\\.?\\s*(?:no\\.?|number)?\\s*[#:]?|#)\\s*\\d[\\d-]*' + STANDS_ALONE,
    'gi',
  )

  const STYLE_ID = 'starters-contact-reminder-style'
  const STYLES = [
    '.tsr-dialog{box-sizing:border-box;width:calc(100% - 32px);max-width:700px;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);overscroll-behavior:contain;margin:auto;padding:40px;border:0;border-radius:4px;background:#fff;color:#1e211e;overflow-y:auto}',
    '.tsr-dialog::backdrop{background:rgba(0,0,0,.5)}',
    '.tsr-dialog *{box-sizing:border-box}',
    '.tsr-title,.tsr-body{padding:0;max-width:none;text-transform:none;font-style:normal;text-align:left}',
    '.tsr-btn{margin:0;min-width:0;box-shadow:none;text-decoration:none;appearance:none;-webkit-appearance:none}',
    '.tsr-card{display:flex;flex-direction:column;gap:24px}',
    '.tsr-text{display:flex;flex-direction:column;gap:12px}',
    '.tsr-title{margin:0;font-family:"Baskervville",Georgia,"Times New Roman",serif;font-weight:500;font-size:36px;line-height:1.2;letter-spacing:-1.08px;color:#1e211e}',
    '.tsr-body{margin:0;font-family:"Inter",-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-weight:400;font-size:18px;line-height:1.7;color:#1e211e}',
    '.tsr-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;align-items:center;padding-top:12px}',
    '.tsr-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;padding:16px 20px;border:1.25px solid #1e211e;border-radius:4px;font-family:"Inter",-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-weight:700;font-size:14px;line-height:1;letter-spacing:.28px;text-transform:uppercase;white-space:nowrap;cursor:pointer;transition:background-color .15s,color .15s}',
    '.tsr-btn-secondary{background:#fff;color:#1e211e}',
    '.tsr-btn-secondary:hover{background:#f1f1ef}',
    '.tsr-btn-primary{background:#1e211e;color:#fff}',
    '.tsr-btn-primary:hover{background:#3a3d3a;border-color:#3a3d3a}',
    '.tsr-btn:focus-visible{outline:2px solid #1e211e;outline-offset:2px}',
    '@media (max-width:600px){.tsr-dialog{padding:24px}.tsr-card{gap:20px}.tsr-title{font-size:28px;letter-spacing:-.84px}.tsr-body{font-size:16px}.tsr-actions{flex-direction:column-reverse;align-items:stretch;padding-top:4px}.tsr-btn{width:100%;white-space:normal;text-align:center;line-height:1.3}}',
    '@media (max-height:500px){.tsr-dialog{padding:20px 24px;max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px)}.tsr-card{gap:14px}.tsr-text{gap:8px}.tsr-title{font-size:24px;letter-spacing:-.72px}.tsr-body{font-size:15px;line-height:1.55}.tsr-actions{padding-top:0}.tsr-btn{padding:14px 18px}}',
  ].join('\n')

  let popup = null
  let dialogSupport = null

  function hasContactInfo(text) {
    const cleaned = String(text || '').replace(ALLOWED_LINKS, '').replace(NOT_PHONES, '$1$2')
    return CONTACT_RULES.some(function matchesRule(rule) {
      return rule.test(cleaned)
    })
  }

  // iOS Safari before 15.4 has no <dialog>. There the send is never cancelled,
  // because a cancelled message with no visible warning would leave the member
  // stuck; it goes through tagged for monitoring instead.
  function canShowPopup() {
    if (dialogSupport === null) {
      dialogSupport = typeof document.createElement('dialog').showModal === 'function'
    }
    return dialogSupport
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = STYLES
    document.head.appendChild(style)
  }

  function buildPopup() {
    if (popup) return popup
    installStyles()
    const dialog = document.createElement('dialog')
    dialog.className = 'tsr-dialog'
    dialog.setAttribute('aria-labelledby', 'tsr-title')
    dialog.innerHTML =
      '<div class="tsr-card">' +
      '<div class="tsr-text">' +
      '<h2 class="tsr-title" id="tsr-title"></h2>' +
      '<p class="tsr-body"></p>' +
      '</div>' +
      '<div class="tsr-actions">' +
      '<button type="button" class="tsr-btn tsr-btn-secondary" data-tsr="send">Send anyway (Press send again)</button>' +
      '<button type="button" class="tsr-btn tsr-btn-primary" data-tsr="edit">Edit message</button>' +
      '</div>' +
      '</div>'
    document.body.appendChild(dialog)
    popup = {
      dialog: dialog,
      title: dialog.querySelector('.tsr-title'),
      body: dialog.querySelector('.tsr-body'),
      edit: dialog.querySelector('[data-tsr="edit"]'),
      send: dialog.querySelector('[data-tsr="send"]'),
      resolve: null,
    }
    function settle(choice) {
      const resolve = popup.resolve
      popup.resolve = null
      if (dialog.open) dialog.close()
      if (resolve) resolve(choice)
    }
    popup.edit.addEventListener('click', function onEditClick() {
      settle('edit')
    })
    popup.send.addEventListener('click', function onSendAnywayClick() {
      settle('send')
    })
    // Escape fires `cancel` on the top-most modal dialog only, so the lumos
    // modal underneath stays open. Treat it as Edit message.
    dialog.addEventListener('cancel', function onDialogCancel(event) {
      event.preventDefault()
      settle('edit')
    })
    return popup
  }

  function ask(type) {
    const ui = buildPopup()
    const copy = COPY[type] || COPY.brand
    if (ui.resolve) ui.resolve('edit')
    ui.title.textContent = copy.title
    ui.body.textContent = copy.body
    if (!ui.dialog.open) ui.dialog.showModal()
    ui.edit.focus()
    return new Promise(function waitForChoice(resolve) {
      ui.resolve = resolve
    })
  }

  function conversationIdOf(event) {
    return (event && event.conversation && event.conversation.id) || ''
  }

  function attachContactReminder(chatUi, userType) {
    if (!chatUi || typeof chatUi.onSendMessage !== 'function') return null
    const type = userType === 'starter' ? 'starter' : 'brand'
    // Approval is for one text in one conversation, so switching conversations
    // in the inbox never carries a "Send anyway" across.
    let approved = null

    // focus is false while the popup is open, so a phone keyboard never opens
    // behind it; the field is focused once the member has chosen.
    function restoreDraft(text, focus) {
      window.setTimeout(function putDraftBack() {
        const field = chatUi.messageField
        if (!field || typeof field.setText !== 'function') return
        field.setText(text)
        if (focus && typeof field.focus === 'function') field.focus()
      }, 50)
    }

    return chatUi.onSendMessage(function onSendMessage(event) {
      const text = (event.message && event.message.text) || ''
      if (!hasContactInfo(text)) return
      const conversationId = conversationIdOf(event)

      if (approved && approved.text === text && approved.conversationId === conversationId) {
        approved = null
        event.override({ custom: { contactFlag: 'true' } })
        return
      }

      approved = null
      if (!canShowPopup()) {
        event.override({ custom: { contactFlag: 'true' } })
        return
      }
      event.override({ cancel: true })
      restoreDraft(text, false)
      ask(type).then(function onChoice(choice) {
        if (choice === 'send') approved = { text: text, conversationId: conversationId }
        restoreDraft(text, true)
      })
    })
  }

  window.attachContactReminder = attachContactReminder
  window.StartersContactReminder = {
    attach: attachContactReminder,
    hasContactInfo: hasContactInfo,
    preview: ask,
  }
})()
