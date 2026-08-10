/**
 * Query-gated V3 production quiz-results email tester.
 *
 * Install: quiz-results.js loads this controller only for
 * /quiz-results?quizEmailTest=1. The UI must be authored as native Webflow
 * elements using the data attributes below. This file never generates HTML UI.
 * Xano is the security boundary: it authenticates user_v3, accepts only the
 * dedicated production Brand canary, fixes the recipient server-side, applies
 * idempotency/rate limits, and owns the Mandrill key.
 *
 * @release v1.59.161
 */
;(function () {
  'use strict'

  if (window.__startersQuizEmailTesterBooted) return
  window.__startersQuizEmailTesterBooted = true

  var QUERY_KEY = 'quizEmailTest'
  var ENABLED_VALUE = '1'
  var ALLOWED_EMAIL = 'jp+brand10@thestarters.com'
  var RECIPIENT_LABEL = 'jp+brand10@thestarters.com'
  var XANO_AUTH_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh'
  var XANO_V3_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk'
  var TRADE_TOKEN_PATH = '/auth/trade-token/v3'
  var SEND_PATH = '/quiz_email_test/send/v3'
  var ALGOLIA_APP_ID = 'PKVW6M9OPZ'
  var FREELANCER_INDEX = 'Freelancers3.0-dev'
  var LEARN_INDEX = 'LearnContent'
  var PRODUCTION_ORIGIN = 'https://www.thestarters.com'
  var TEMPLATE_VERSION = 'quiz-results-email-v3.1'
  var PENDING_KEY = 'starterQuizEmailTestPendingKey'
  var STYLES_URL =
    'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/quiz-results-email-tester.css'

  var aliases = {
    creative: ['creative', 'creative-brand'],
    'creative-brand': ['creative-brand', 'creative'],
    'marketing-strategy-brand': [
      'marketing-strategy-brand',
      'marketing-strategy-leadership',
    ],
    'marketing-strategy-leadership': [
      'marketing-strategy-leadership',
      'marketing-strategy-brand',
    ],
  }

  function normalize(value) {
    return String(value == null ? '' : value).trim()
  }

  function escapeHtml(value) {
    return normalize(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function titleCaseSlug(value) {
    return normalize(value)
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map(function (part) {
        return part.charAt(0).toUpperCase() + part.slice(1)
      })
      .join(' ')
  }

  function normalizeList(value) {
    if (Array.isArray(value)) return value.map(normalize).filter(Boolean)
    return normalize(value)
      .split(/\s*[;,|]\s*/)
      .map(normalize)
      .filter(Boolean)
  }

  function firstPresent(record, fields) {
    for (var index = 0; index < fields.length; index += 1) {
      var value = record && record[fields[index]]
      if (Array.isArray(value) ? value.length : normalize(value)) return value
    }
    return ''
  }

  function requiredElement(name) {
    var element = document.querySelector('[data-quiz-email-test-' + name + ']')
    if (!element) throw new Error('Missing native Webflow tester element: ' + name)
    return element
  }

  function resolvePanel() {
    var explicit = document.querySelector('[data-quiz-email-test-panel]')
    if (explicit) return explicit

    var recipient = document.querySelector('[data-quiz-email-test-recipient]')
    var send = document.querySelector('[data-quiz-email-test-send]')
    var candidate = recipient && recipient.parentElement
    while (candidate && candidate !== document.body && send && !candidate.contains(send)) {
      candidate = candidate.parentElement
    }
    if (!candidate || candidate === document.body || !send || !candidate.contains(send)) {
      throw new Error('Missing native Webflow tester element: panel')
    }
    candidate.setAttribute('data-quiz-email-test-panel', 'true')
    return candidate
  }

  function revealPanel(panel) {
    panel.hidden = false
    panel.classList.remove('w-condition-invisible')
    panel.style.removeProperty('display')
    panel.removeAttribute('aria-hidden')
  }

  function setText(name, text) {
    var element = document.querySelector('[data-quiz-email-test-' + name + ']')
    if (element) element.textContent = text
  }

  function setStatus(kind, text) {
    var status = requiredElement('status')
    status.textContent = text
    status.setAttribute('data-state', kind)
  }

  function ensureStyles() {
    if (document.querySelector('link[data-quiz-email-test-styles]')) return
    var link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = STYLES_URL
    link.dataset.quizEmailTestStyles = 'true'
    document.head.appendChild(link)
  }

  function getMemberEmail(member) {
    return normalize(
      member &&
        (member.auth && member.auth.email
          ? member.auth.email
          : member.email || (member.customFields && member.customFields.email)),
    ).toLowerCase()
  }

  async function waitForMemberstack() {
    for (var attempt = 0; attempt < 40; attempt += 1) {
      if (window.$memberstackDom) return window.$memberstackDom
      await new Promise(function (resolve) {
        window.setTimeout(resolve, 250)
      })
    }
    throw new Error('Memberstack is unavailable')
  }

  function unwrapData(response) {
    if (response && response.data && typeof response.data === 'object') {
      return response.data
    }
    return response && typeof response === 'object' ? response : {}
  }

  async function readContext() {
    var memberstack = await waitForMemberstack()
    var savedState = window.__startersQuizEmailTestSavedState
    if (!savedState || !savedState.ready || typeof savedState.ready.then !== 'function') {
      throw new Error('Quiz results state owner is unavailable')
    }
    var responses = await Promise.all([
      memberstack.getCurrentMember(),
      savedState.ready,
    ])
    var member = unwrapData(responses[0])
    var currentSavedQuiz = responses[1] || {}

    if (!member.id) throw new Error('Sign in before using the email tester')
    if (getMemberEmail(member) !== ALLOWED_EMAIL) {
      throw new Error('This production tester is not enabled for the signed-in member')
    }
    if (!currentSavedQuiz.quiz || typeof currentSavedQuiz.quiz !== 'object') {
      throw new Error(
        currentSavedQuiz.error || 'No current saved starterQuiz payload was produced',
      )
    }

    return { memberstack: memberstack, member: member, quiz: currentSavedQuiz.quiz }
  }

  function getAlgoliaConfig() {
    var windowConfig = window.starterQuizAlgoliaConfig || {}
    var explicit = document.querySelector(
      '[data-starter-quiz-algolia-app-id], [data-algolia-app-id]',
    )
    var script = document.querySelector('script[data-app-id][data-search-key]')
    var searchKey =
      normalize(windowConfig.searchKey) ||
      normalize(explicit && explicit.dataset.starterQuizAlgoliaSearchKey) ||
      normalize(explicit && explicit.dataset.algoliaSearchKey) ||
      normalize(script && script.getAttribute('data-search-key'))

    if (!searchKey) throw new Error('Algolia search configuration is unavailable')

    return {
      appId:
        normalize(windowConfig.appId) ||
        normalize(explicit && explicit.dataset.starterQuizAlgoliaAppId) ||
        normalize(explicit && explicit.dataset.algoliaAppId) ||
        normalize(script && script.getAttribute('data-app-id')) ||
        ALGOLIA_APP_ID,
      searchKey: searchKey,
    }
  }

  async function algoliaRequest(config, path, body) {
    var response = await window.fetch(
      'https://' +
        encodeURIComponent(config.appId) +
        '-dsn.algolia.net/1/indexes/' +
        path,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-algolia-api-key': config.searchKey,
          'x-algolia-application-id': config.appId,
        },
        body: JSON.stringify(body),
      },
    )
    var data = await response.json().catch(function () {
      return {}
    })
    if (!response.ok) throw new Error('Algolia request failed ' + response.status)
    return data
  }

  function normalizePerson(hit) {
    var slug = normalize(firstPresent(hit, ['slug', 'Slug']))
    return {
      objectID: normalize(hit && hit.objectID),
      name: normalize(firstPresent(hit, ['name', 'Name'])),
      roles: normalizeList(firstPresent(hit, ['roles', 'Roles'])).map(titleCaseSlug),
      tagline: normalize(firstPresent(hit, ['tagline', 'Tagline'])),
      image: normalize(
        firstPresent(hit, [
          'profile-photo-xano',
          'profile-photo',
          'Profile_Photo',
          'Profile_Photo_Demo',
        ]),
      ),
      url: slug ? PRODUCTION_ORIGIN + '/hire/' + encodeURIComponent(slug) : '',
    }
  }

  async function fetchPeople(config, ids) {
    var normalizedIds = ids.map(normalize).filter(Boolean)
    if (normalizedIds.length !== 3) {
      throw new Error('The saved quiz must contain exactly three featured Starter IDs')
    }
    var data = await algoliaRequest(config, '*/objects', {
      requests: normalizedIds.map(function (objectID) {
        return { indexName: FREELANCER_INDEX, objectID: objectID }
      }),
    })
    var byId = new Map()
    ;(data.results || []).map(normalizePerson).forEach(function (person) {
      if (person.objectID) byId.set(person.objectID, person)
    })
    var people = normalizedIds.map(function (id) {
      return byId.get(id)
    })
    if (people.some(function (person) { return !person || !person.name || !person.image })) {
      throw new Error('One or more featured Starter records are incomplete')
    }
    return people
  }

  function absoluteUrl(value) {
    var url = normalize(value)
    if (!url) return ''
    if (/^https?:\/\//i.test(url)) return url
    return new URL(url.charAt(0) === '/' ? url : '/' + url, PRODUCTION_ORIGIN).href
  }

  function usableLearnHit(hit) {
    var title = normalize(firstPresent(hit, ['name', 'title']))
    return Boolean(
      title &&
        title.length <= 140 &&
        !/^(lorem ipsum|example)\b/i.test(title) &&
        normalize(hit && hit.url) &&
        normalize(hit && hit.thumbnail_url),
    )
  }

  function normalizeLearnHit(hit, category) {
    var description = normalize(hit && hit.description)
      .replace(/[\uE000-\uF8FF]/g, '')
      .trim()
    if (description.length > 240) description = description.slice(0, 239).trim() + '…'
    return {
      objectID: normalize(hit && hit.objectID),
      title: normalize(firstPresent(hit, ['name', 'title'])),
      type: normalize(hit && hit.content_type && (hit.content_type.lvl0 || hit.content_type)),
      description: description,
      image: normalize(hit && hit.thumbnail_url),
      url: absoluteUrl(hit && hit.url),
      matchedCategory: normalize(category.label || category.id),
    }
  }

  async function fetchLearn(config, categories, limit) {
    var groups = await Promise.all(
      categories.map(async function (category) {
        var values = aliases[normalize(category.id)] || [normalize(category.id)]
        var data = await algoliaRequest(
          config,
          encodeURIComponent(LEARN_INDEX) + '/query',
          {
            query: '',
            hitsPerPage: Math.max(limit, 8),
            facetFilters: [
              values.map(function (value) {
                return 'categories:' + value
              }),
            ],
          },
        )
        return (data.hits || [])
          .filter(usableLearnHit)
          .map(function (hit) {
            return normalizeLearnHit(hit, category)
          })
      }),
    )
    var selected = []
    var seen = new Set()
    var cursor = groups.map(function () { return 0 })
    var added = true
    while (selected.length < limit && added) {
      added = false
      groups.forEach(function (group, groupIndex) {
        if (selected.length >= limit) return
        while (cursor[groupIndex] < group.length) {
          var hit = group[cursor[groupIndex]]
          cursor[groupIndex] += 1
          if (!hit.objectID || seen.has(hit.objectID)) continue
          seen.add(hit.objectID)
          selected.push(hit)
          added = true
          break
        }
      })
    }
    if (!selected.length) throw new Error('No current Learn recommendations were found')
    return selected
  }

  function renderAnswers(quiz) {
    var categories = Array.isArray(quiz.categories) ? quiz.categories : []
    var subcategories = Array.isArray(quiz.subcategories) ? quiz.subcategories : []
    var rows = categories
      .map(function (category) {
        return '<tr><td style="padding:0 0 12px;font-size:14px;line-height:1.45;color:#17201b;"><strong>' +
          escapeHtml(category.label || category.id) +
          '</strong></td></tr>'
      })
      .join('')
    if (subcategories.length) {
      rows += '<tr><td style="padding:4px 0 0;font-size:14px;line-height:1.45;color:#68716c;"><strong>Selected focus:</strong> ' +
        escapeHtml(
          subcategories.map(function (item) { return item.label || item.id }).join(', '),
        ) +
        '</td></tr>'
    }
    return rows
  }

  function renderPeople(people) {
    return people
      .map(function (person, index) {
        return '<tr><td style="padding:0 32px 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dfe5e2;border-radius:10px;"><tr><td width="132" valign="top" style="padding:18px 0 18px 20px;"><img src="' +
          escapeHtml(person.image) +
          '" width="112" height="112" alt="' +
          escapeHtml(person.name) +
          '" style="display:block;width:112px;height:112px;border:0;border-radius:9px;object-fit:cover;"></td><td valign="top" style="padding:18px 20px;"><div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8a928e;">Featured ' +
          String(index + 1).padStart(2, '0') +
          '</div><div style="margin-top:5px;font-size:17px;font-weight:800;color:#17201b;">' +
          escapeHtml(person.name) +
          '</div><div style="margin-top:4px;font-size:14px;color:#68716c;">' +
          escapeHtml(person.roles.join(' · ')) +
          '</div><p style="margin:12px 0 0;font-size:14px;line-height:1.5;color:#49524d;">' +
          escapeHtml(person.tagline) +
          '</p>' +
          (person.url ? '<a href="' + escapeHtml(person.url) + '" style="display:inline-block;margin-top:10px;font-size:13px;font-weight:700;color:#17201b;">View profile</a>' : '') +
          '</td></tr></table></td></tr>'
      })
      .join('')
  }

  function renderLearn(items) {
    return items
      .map(function (item) {
        return '<tr><td style="padding:0 32px 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dfe5e2;border-radius:10px;"><tr><td width="132" valign="top" style="padding:18px 0 18px 20px;"><img src="' +
          escapeHtml(item.image) +
          '" width="112" height="82" alt="' +
          escapeHtml(item.title) +
          '" style="display:block;width:112px;height:82px;border:0;border-radius:9px;object-fit:cover;"></td><td valign="top" style="padding:18px 20px;"><div style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8a928e;">' +
          escapeHtml(item.type || 'Learn') +
          ' · ' +
          escapeHtml(item.matchedCategory) +
          '</div><div style="margin-top:5px;font-size:16px;font-weight:800;line-height:1.3;color:#17201b;">' +
          escapeHtml(item.title) +
          '</div><p style="margin:9px 0 0;font-size:13px;line-height:1.5;color:#49524d;">' +
          escapeHtml(item.description) +
          '</p><a href="' +
          escapeHtml(item.url) +
          '" style="display:inline-block;margin-top:10px;font-size:13px;font-weight:700;color:#17201b;">Read on Learn</a></td></tr></table></td></tr>'
      })
      .join('')
  }

  function renderEmail(quiz, people, learn) {
    var categoryLabels = (quiz.categories || [])
      .map(function (item) { return item.label || item.id })
      .join(', ')
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>Your Starters matches</title></head><body style="margin:0;padding:0;background:#f2f4f3;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your featured Starter matches and quiz answers are ready.</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f3;"><tr><td align="center" style="padding:28px 12px;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;"><tr><td style="padding:28px 32px 12px;background:#17201b;color:#ffffff;"><div style="font-size:18px;font-weight:800;letter-spacing:.03em;">THE STARTERS</div><div style="margin-top:12px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#c5d8ce;">V3 quiz email production test</div></td></tr><tr><td style="padding:30px 32px 10px;"><h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;color:#17201b;">Your Starter matches are ready.</h1><p style="margin:0 0 10px;font-size:16px;line-height:1.55;color:#49524d;">These are the three featured people from your saved quiz result, in the same order shown on the page.</p></td></tr><tr><td style="padding:0 32px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f3;border-radius:10px;"><tr><td style="padding:20px;"><div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#68716c;">Your quiz answers</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">' +
      renderAnswers(quiz) +
      '</table></td></tr></table></td></tr>' +
      renderPeople(people) +
      '<tr><td style="padding:10px 32px 14px;"><h2 style="margin:0;font-size:22px;line-height:1.25;color:#17201b;">Recommended from Learn</h2><p style="margin:8px 0 0;font-size:14px;line-height:1.5;color:#68716c;">Matched to ' +
      escapeHtml(categoryLabels) +
      '.</p></td></tr>' +
      renderLearn(learn) +
      '<tr><td align="center" style="padding:8px 32px 32px;"><a href="' +
      PRODUCTION_ORIGIN +
      '/quiz-results" style="display:inline-block;padding:13px 22px;border-radius:8px;background:#17201b;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">View all your matches</a></td></tr><tr><td style="padding:20px 32px;border-top:1px solid #edf0ee;"><p style="margin:0;font-size:12px;line-height:1.5;color:#8a928e;">Controlled V3 quiz-email canary for The Starters. This is a one-recipient transactional test.</p></td></tr></table></td></tr></table></body></html>'
  }

  async function sha256(value) {
    var bytes = new TextEncoder().encode(value)
    var digest = await window.crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest))
      .map(function (byte) { return byte.toString(16).padStart(2, '0') })
      .join('')
  }

  async function buildMessage(quiz) {
    var categories = Array.isArray(quiz.categories) ? quiz.categories.filter(function (item) { return normalize(item && item.id) }) : []
    if (!categories.length) throw new Error('The saved quiz has no categories')
    var config = getAlgoliaConfig()
    var results = await Promise.all([
      fetchPeople(config, quiz.featuredFreelancerIds || []),
      fetchLearn(config, categories, 3),
    ])
    var revision = [
      TEMPLATE_VERSION,
      normalize(quiz.updatedAt || quiz.completedAt),
      (quiz.featuredFreelancerIds || []).join(','),
      categories.map(function (item) { return item.id }).join(','),
      (quiz.subcategoryIds || []).join(','),
      results[1].map(function (item) { return item.objectID }).join(','),
    ].join(':')
    return {
      html: renderEmail(quiz, results[0], results[1]),
      revision: revision,
      summary: results[0].length + ' Starters · ' + results[1].length + ' Learn items',
    }
  }

  async function tradeToken(memberstack) {
    var memberstackToken = await memberstack.getMemberCookie()
    if (!memberstackToken) throw new Error('Memberstack session cookie is unavailable')
    var response = await window.fetch(
      XANO_AUTH_BASE + TRADE_TOKEN_PATH + '?token=' + encodeURIComponent(memberstackToken),
    )
    var data = await response.json().catch(function () { return null })
    if (!response.ok) throw new Error('Xano token trade failed ' + response.status)
    var token = typeof data === 'string' ? data : data && (data.authToken || data.token)
    if (!token) throw new Error('Xano token trade returned no token')
    return token
  }

  function newPendingKey(revision) {
    var current = null
    try {
      current = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null')
    } catch (ignored) {}
    if (current && current.revision === revision && current.key) return current.key
    var nonce = window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : String(Date.now()) + '-' + Math.random().toString(16).slice(2)
    var key = 'quiz-email-v3:' + revision.slice(0, 64) + ':' + nonce
    sessionStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ revision: revision, key: key }),
    )
    return key
  }

  async function sendMessage(context, message) {
    var token = await tradeToken(context.memberstack)
    var revisionHash = await sha256(message.revision)
    var response = await window.fetch(XANO_V3_BASE + SEND_PATH, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        idempotency_key: newPendingKey(revisionHash),
        quiz_revision: message.revision,
        html: message.html,
      }),
    })
    var data = await response.json().catch(function () { return {} })
    if (!response.ok) throw new Error(data.message || data.error || 'Send failed ' + response.status)
    if (!data.ok) throw new Error('Mandrill did not accept the test email')
    sessionStorage.removeItem(PENDING_KEY)
    return data
  }

  async function boot() {
    if (new URLSearchParams(window.location.search).get(QUERY_KEY) !== ENABLED_VALUE) return

    var panel = resolvePanel()
    var send = requiredElement('send')
    var launcher = document.querySelector('[data-quiz-email-test-launcher]')
    var close = document.querySelector('[data-quiz-email-test-close]')
    ensureStyles()
    revealPanel(panel)
    panel.setAttribute('role', 'region')
    panel.setAttribute('aria-label', 'Quiz email production tester')
    if (launcher) launcher.hidden = false
    setText('recipient', RECIPIENT_LABEL)
    setText('summary', 'Current saved quiz result')
    setText('send', 'Send test email')
    setStatus('loading', 'Checking the production test member…')

    if (launcher) {
      launcher.addEventListener('click', function (event) {
        event.preventDefault()
        panel.setAttribute('data-open', 'true')
      })
    }
    if (close) {
      close.addEventListener('click', function (event) {
        event.preventDefault()
        panel.setAttribute('data-open', 'false')
      })
    }

    var context = await readContext()
    setStatus('ready', 'Ready. The recipient is fixed server-side.')
    send.disabled = false

    send.addEventListener('click', async function (event) {
      event.preventDefault()
      if (send.disabled) return
      send.disabled = true
      try {
        setStatus('loading', 'Loading current Starter and Learn data…')
        var message = await buildMessage(context.quiz)
        setText('summary', message.summary)
        setStatus('sending', 'Sending controlled V3 production test…')
        var result = await sendMessage(context, message)
        setStatus(
          'sent',
          result.replayed
            ? 'Already sent. The idempotent result was reused.'
            : 'Sent. Check ' + RECIPIENT_LABEL + '.',
        )
      } catch (error) {
        setStatus('error', error && error.message ? error.message : String(error))
      } finally {
        send.disabled = false
      }
    })
  }

  function start() {
    boot().catch(function (error) {
      var panel = document.querySelector('[data-quiz-email-test-panel]')
      if (panel) revealPanel(panel)
      try {
        setStatus('error', error && error.message ? error.message : String(error))
      } catch (ignored) {}
    })
  }

  if (window.__STARTERS_QUIZ_EMAIL_TEST_HOOKS__ === true) {
    window.StartersQuizEmailTesterTesting = {
      buildMessage: buildMessage,
      escapeHtml: escapeHtml,
      getMemberEmail: getMemberEmail,
      readContext: readContext,
      renderEmail: renderEmail,
      sendMessage: sendMessage,
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
})()
