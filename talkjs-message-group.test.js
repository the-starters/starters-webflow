const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

// A Message Group is a run by one sender WITHIN ONE CALENDAR DAY. Only the
// first row of a group draws the sender's photo; the rest reserve the avatar
// column with a 2.5rem bubble margin instead. Sender identity alone was the
// original rule, and it let a run survive TalkJS's own DayMarker: the first
// message under a date divider rendered with no photo but with the column
// still held open, which reads as a photo that failed to load.
//
// This guards the rule against a silent revert, in both Chat Themes at once.
// It does NOT execute TalkJS's renderer — nothing in this repo can, the themes
// run inside TalkJS's iframe. The grouping directives are read out of the real
// .template files and evaluated by the small Liquid subset below, so a change
// to the templates changes what is tested here; what it cannot prove is that
// TalkJS's `date` filter uses the same clock as its DayMarker. That limit is
// stated at length in the inbox theme's UserMessage.template and is the reason
// the timezone case here asserts agreement, not locality.

const THEMES = {
  inbox: 'the-starters-3-0',
  profile: 'the-starters-3-0-profile',
}
const templatePath = (dir) =>
  path.join(__dirname, 'talkjs-themes', dir, 'UserMessage.template')

/* ------------------------- Liquid subset -------------------------
   Supports exactly the constructs the grouping directives use:
   dotted paths, string literals, `==`/`!=`, `and`, and the `date` filter.
   Anything else throws rather than guessing, so a future directive that
   outgrows this evaluator fails loudly instead of silently passing. */

const UNSET = Symbol('unset')

function tokenize(src) {
  const re = /\s*(?:('(?:[^'\\]|\\.)*')|(==|!=)|(\|)|(:)|([A-Za-z_][A-Za-z0-9_.]*))/y
  const out = []
  let i = 0
  while (i < src.length) {
    re.lastIndex = i
    const m = re.exec(src)
    if (!m) {
      if (/^\s+$/.test(src.slice(i))) break
      throw new Error(`cannot tokenize: ${src.slice(i)}`)
    }
    i = re.lastIndex
    if (m[1]) out.push({ t: 'str', v: m[1].slice(1, -1) })
    else if (m[2]) out.push({ t: 'op', v: m[2] })
    else if (m[3]) out.push({ t: 'pipe' })
    else if (m[4]) out.push({ t: 'colon' })
    else out.push({ t: 'ident', v: m[5] })
  }
  return out
}

function truthy(v) {
  return !(v === UNSET || v === undefined || v === null || v === false || v === '')
}

function lookup(dotted, scope) {
  let cur = scope
  for (const part of dotted.split('.')) {
    if (cur === UNSET || cur === undefined || cur === null) return UNSET
    if (!(part in cur)) return UNSET
    cur = cur[part]
  }
  return cur
}

function dateFilter(input, format, timeZone) {
  if (input === UNSET || input === undefined || input === null) return UNSET
  assert.equal(format, '%Y-%m-%d', 'unsupported date format in template')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date(Number(input)))
    .reduce((acc, p) => Object.assign(acc, { [p.type]: p.value }), {})
  return `${parts.year}-${parts.month}-${parts.day}`
}

function evaluate(expr, scope, timeZone) {
  const tokens = tokenize(expr)
  let pos = 0
  const peek = () => tokens[pos]

  function value() {
    const t = tokens[pos++]
    if (!t) throw new Error(`unexpected end of expression: ${expr}`)
    if (t.t === 'str') return t.v
    if (t.t !== 'ident') throw new Error(`unexpected token in: ${expr}`)
    let v =
      t.v === 'true' ? true : t.v === 'false' ? false : lookup(t.v, scope)
    while (peek() && peek().t === 'pipe') {
      pos++
      const filter = tokens[pos++]
      assert.equal(filter.v, 'date', `unsupported filter in: ${expr}`)
      pos++ // ':'
      v = dateFilter(v, value(), timeZone)
    }
    return v
  }

  function comparison() {
    let left = value()
    while (peek() && peek().t === 'op') {
      const op = tokens[pos++].v
      const right = value()
      left = op === '==' ? left === right : left !== right
    }
    return left
  }

  let result = comparison()
  while (peek() && peek().t === 'ident' && peek().v === 'and') {
    pos++
    // both sides are consumed before combining: short-circuiting here would
    // leave the right-hand tokens unread and trip the check below
    const right = truthy(comparison())
    result = truthy(result) && right
  }
  if (pos !== tokens.length) throw new Error(`trailing tokens in: ${expr}`)
  return result
}

/* ------------------- directives, read from the theme ------------------- */

function extractDirectives(templateText) {
  const tpl = templateText
    .slice(templateText.indexOf('<template>'))
    .replace(/<!--[\s\S]*?-->/g, '')

  const rowAttr = tpl.match(/class="(message-row[^"]*)"/)
  assert.ok(rowAttr, 'no message-row class attribute')
  const rowExpr = [...rowAttr[1].matchAll(/\{\{\s*([\s\S]*?)\s*\}\}/g)]
    .map((m) => m[1])
    .find((e) => /\|\s*then:\s*'previous-same'\s*$/.test(e))
  assert.ok(rowExpr, "no previous-same expression on the message row")

  // every element that can put an avatar on the row, with its render condition
  const avatars = []
  let lastAvatarAt = -1
  for (const m of tpl.matchAll(/<(Avatar|ActionButton)\b([\s\S]*?)(\/>|>)/g)) {
    if (m[1] === 'ActionButton' && !/identity-avatar/.test(m[2])) continue
    const cond = m[2].match(/t:if="\{\{\s*([\s\S]*?)\s*\}\}"/)
    if (!cond) continue
    avatars.push({ element: m[1], identity: /identity-avatar/.test(m[2]), cond: cond[1] })
    lastAvatarAt = m.index
  }
  assert.ok(avatars.length > 0, 'no conditionally rendered avatar')

  // the <t:set> directives that feed those conditions
  const sets = []
  for (const m of tpl.matchAll(/<t:set\s+([^>]*?)\/>/g)) {
    if (m.index > lastAvatarAt) break
    const attrs = {}
    for (const a of m[1].matchAll(/([A-Za-z:]+)="([^"]*)"/g)) attrs[a[1]] = a[2]
    const name = Object.keys(attrs).find((k) => k !== 't:if')
    if (!name) continue
    const inner = (s) => s.replace(/^\s*\{\{\s*|\s*\}\}\s*$/g, '')
    sets.push({
      name,
      cond: attrs['t:if'] ? inner(attrs['t:if']) : null,
      expr: inner(attrs[name]),
    })
  }

  return {
    groupedExpr: rowExpr.replace(/\|\s*then:\s*'previous-same'\s*$/, '').trim(),
    sets,
    avatars,
  }
}

function renderRow(directives, message, previousMessage, timeZone) {
  const scope = {
    sender: message.sender,
    timestamp: message.timestamp,
    previousMessage: previousMessage || UNSET,
    conversation: { isGroupChat: false },
  }
  for (const s of directives.sets) if (!(s.name in scope)) scope[s.name] = UNSET
  for (const s of directives.sets) {
    if (s.cond !== null && !truthy(evaluate(s.cond, scope, timeZone))) continue
    scope[s.name] = evaluate(s.expr, scope, timeZone)
  }
  const shown = directives.avatars.filter((a) => truthy(evaluate(a.cond, scope, timeZone)))
  return {
    showsPhoto: shown.length > 0,
    identityButton: shown.some((a) => a.identity),
    reservesColumn: truthy(evaluate(directives.groupedExpr, scope, timeZone)),
  }
}

/* ------------------------------ fixture ------------------------------
   The reported conversation, reduced to the smallest history containing the
   defect: a same-sender run crossing a DayMarker sixteen days later, and a
   second one crossing the next midnight. Timestamps sit mid-day UTC so no
   ordinary offset moves a message onto a different date. */

const ME = { id: 'mem_jerico', isMe: true }
const THEM = { id: 'mem_amara', isMe: false }

const CONVERSATION = [
  { sender: THEM, at: '2026-07-28T10:02:00Z', firstOfGroup: true },
  { sender: THEM, at: '2026-07-28T10:03:00Z', firstOfGroup: false },
  { sender: ME, at: '2026-07-28T10:15:00Z', firstOfGroup: true },
  { sender: ME, at: '2026-07-28T10:16:00Z', firstOfGroup: false },
  { sender: THEM, at: '2026-07-28T10:31:00Z', firstOfGroup: true },
  // same sender as the row above, sixteen days later — under a DayMarker
  { sender: THEM, at: '2026-08-13T09:41:00Z', firstOfGroup: true, acrossDayBreak: true },
  { sender: ME, at: '2026-08-13T09:42:00Z', firstOfGroup: true },
  // same sender as the row above, one day later — under a DayMarker
  { sender: ME, at: '2026-08-14T08:30:00Z', firstOfGroup: true, acrossDayBreak: true },
].map((m, i) => ({ ...m, index: i, timestamp: Date.parse(m.at) }))

function renderConversation(directives, timeZone = 'UTC') {
  return CONVERSATION.map((m, i) =>
    renderRow(directives, m, CONVERSATION[i - 1], timeZone)
  )
}

const DIRECTIVES = Object.fromEntries(
  Object.entries(THEMES).map(([name, dir]) => [
    name,
    extractDirectives(fs.readFileSync(templatePath(dir), 'utf8')),
  ])
)

for (const theme of Object.keys(THEMES)) {
  test(`${theme} theme: every first row of a Message Group draws the photo`, () => {
    const rows = renderConversation(DIRECTIVES[theme])
    rows.forEach((row, i) => {
      const m = CONVERSATION[i]
      assert.equal(
        row.showsPhoto,
        m.firstOfGroup,
        `row ${i} (${m.at}) should ${m.firstOfGroup ? '' : 'not '}draw a photo`
      )
    })
  })

  test(`${theme} theme: a run does not survive a DayMarker`, () => {
    const rows = renderConversation(DIRECTIVES[theme])
    const breaks = CONVERSATION.filter((m) => m.acrossDayBreak)
    assert.equal(breaks.length, 2, 'fixture should contain two day breaks')
    for (const m of breaks) {
      assert.equal(rows[m.index].showsPhoto, true, `row ${m.index} lost its photo under a DayMarker`)
      assert.equal(rows[m.index].reservesColumn, false, `row ${m.index} kept the grouped indent under a DayMarker`)
      assert.equal(
        CONVERSATION[m.index].sender.id,
        CONVERSATION[m.index - 1].sender.id,
        `row ${m.index} only tests the rule if its sender matches the row above`
      )
    }
  })

  // The avatar and the `previous-same` class reserve and fill the same column,
  // so they are derived from one `grouped` expression on purpose. Splitting
  // them lets a row gain a photo AND keep the 2.5rem indent.
  test(`${theme} theme: the photo and the reserved column stay coupled`, () => {
    for (const row of renderConversation(DIRECTIVES[theme])) {
      assert.equal(
        row.showsPhoto,
        !row.reservesColumn,
        'a row must either draw the photo or reserve the column, never both or neither'
      )
    }
  })

  // Two clocks sixteen hours apart. This asserts the date filter and the rule
  // agree across offsets for this history — not that either uses the viewer's
  // clock; these timestamps sit in a window no standard offset splits.
  test(`${theme} theme: grouping is stable across timezones`, () => {
    const utc = renderConversation(DIRECTIVES[theme], 'UTC')
    for (const tz of ['Pacific/Honolulu', 'Asia/Tokyo']) {
      assert.deepEqual(renderConversation(DIRECTIVES[theme], tz), utc, `differs under ${tz}`)
    }
  })
}

// The two Chat Themes show the same history and had the same defect, so the
// grouping block is deliberately near-identical. The one intended difference
// is the inbox theme's ActionButton wrapper for Clickable Identity.
test('both themes derive grouping from identical directives', () => {
  assert.equal(DIRECTIVES.profile.groupedExpr, DIRECTIVES.inbox.groupedExpr)
  assert.deepEqual(DIRECTIVES.profile.sets, DIRECTIVES.inbox.sets)
  for (const theme of Object.keys(THEMES)) {
    for (const avatar of DIRECTIVES[theme].avatars) {
      assert.match(
        avatar.cond,
        /^showAvatar\b/,
        `${theme}: every avatar must be gated on the shared showAvatar variable`
      )
    }
  }
})

test('only the inbox theme wraps a received avatar in the identity button', () => {
  const received = { sender: THEM, timestamp: Date.parse('2026-08-13T09:41:00Z') }
  assert.equal(renderRow(DIRECTIVES.inbox, received, null, 'UTC').identityButton, true)
  assert.equal(renderRow(DIRECTIVES.profile, received, null, 'UTC').identityButton, false)
})
