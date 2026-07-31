const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./onboarding-profile-preview.js'), 'utf8')

/* ---------------------------- module loader ---------------------------- *
 * The module is almost entirely pure: one transform plus a small arming
 * routine. So there is no mini-DOM here — document is stubbed down to the one
 * marker-gate selector, and the wf-xano side is a fake instance whose recorded
 * hooks and refresh calls are the assertions.
 * ---------------------------------------------------------------------- */

function loadModule({
  hostname = 'the-starters-3-0.webflow.io',
  search = '',
  hasWrapper = true,
  withInstance = true,
  withSetParam = true,
  // Instance state seen at arm() time: 'loading' is the normal case (the fetch
  // wf-xano started in init() is still in flight); 'success'/'error' mean a
  // render already happened without the transform.
  status = 'loading',
  withGetState = true,
  withRefresh = true,
  debug,
  readyState = 'interactive',
  // When set, window.WfXano gains an `instances` array built from these specs
  // ({ key, url, source }), mirroring the real library. Omit it to keep the
  // legacy shape: no instances array, one instance reachable only by get().
  instances = null,
  // 'array'  = wf-xano has not loaded yet; window.WfXano is the pre-load queue.
  // 'object' = wf-xano's module scope has run (window.WfXano is the API object)
  //            but boot() has NOT created instances yet, so get() returns null.
  wfXano = 'array',
} = {}) {
  const warnings = []
  const infos = []
  const hooks = {}
  const refreshes = []
  const params = []
  const selectors = []
  const domListeners = {}

  // Per-instance recorders, so a multi-instance test can assert that BOTH lists
  // were armed rather than just counting globally.
  function makeInstance(spec = {}) {
    const own = { hooks: {}, refreshes: [], params: [] }
    const made = {
      key: 'key' in spec ? spec.key : 'onboarding-self-preview',
      own,
      on(event, handler) {
        ;(own.hooks[event] = own.hooks[event] || []).push(handler)
        ;(hooks[event] = hooks[event] || []).push(handler)
        return this
      },
    }
    if ('url' in spec) made.url = spec.url
    if ('source' in spec) made.source = spec.source
    if (withGetState) made.getState = () => ({ status })
    if (withRefresh) {
      made.refresh = () => {
        own.refreshes.push(true)
        refreshes.push(true)
      }
    }
    // Real setParam sets the param, resets to page 1, and reloads.
    if (withSetParam) {
      made.setParam = (field, value) => {
        own.params.push([field, value])
        params.push([field, value])
      }
    }
    return made
  }

  const instanceList = instances ? instances.map(makeInstance) : null
  // The legacy-key instance get() resolves to. With an instances array present,
  // reuse the matching member so identity dedupe is exercised for real.
  const instance =
    (instanceList && instanceList.filter((i) => i.key === 'onboarding-self-preview')[0]) ||
    (instances ? null : makeInstance())

  let booted = false
  const queue = []
  const api = {
    get(key) {
      // Real wf-xano creates instances inside boot(); before that the list is
      // empty and get() resolves to null for every key.
      if (wfXano === 'object' && !booted) return null
      if (!withInstance) return null
      return instance && key === instance.key ? instance : null
    },
    // Mirrors wf-xano's own push(): run now if booted, else queue until boot.
    push(fn) {
      if (typeof fn !== 'function') return
      if (booted) fn(api)
      else queue.push(fn)
    },
  }

  const sandbox = {
    console: {
      warn: (...args) => warnings.push(args.join(' ')),
      error: () => {},
      info: (...args) => infos.push(args.join(' ')),
      log: () => {},
    },
    location: { hostname, search },
    document: {
      readyState,
      querySelector: (selector) => {
        selectors.push(selector)
        return hasWrapper ? {} : null
      },
      addEventListener: (event, handler) => {
        ;(domListeners[event] = domListeners[event] || []).push(handler)
      },
    },
  }
  // Present as it is in a browser. Nothing in the module reads it any more — the
  // query-string member override is gone — so no test toggles it off.
  sandbox.URLSearchParams = URLSearchParams
  // Mirrors the real API object, which exposes its instance list.
  if (instanceList) api.instances = instanceList
  sandbox.window = sandbox
  sandbox.window.WfXano = wfXano === 'object' ? api : queue
  if (debug !== undefined) sandbox.window.STARTERS_DEBUG = debug

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)

  return {
    warnings,
    infos,
    hooks,
    refreshes,
    params,
    selectors,
    instanceList,
    api2: api,
    queue,
    sandbox,
    api: sandbox.window.StartersV3OnboardingProfilePreview,
    // wf-xano's boot(): create instances, then run everything that queued.
    drain: () => {
      booted = true
      queue.splice(0).forEach((fn) => fn(api))
    },
    fireDomReady: () => (domListeners.DOMContentLoaded || []).forEach((fn) => fn()),
    // Re-run the same file in the same realm, as a duplicate CDN tag would.
    reevaluate: () => vm.runInContext(source, sandbox),
  }
}

// Most tests only need the pure transform surface.
const transform = () => loadModule().api

// Values returned by the module come from the vm realm, so their Array
// prototype is not the host's and deepStrictEqual rejects them. Re-home them.
const list = (value) => Array.from(value)

/* ------------------------------ htmlToText ----------------------------- */

test('htmlToText strips tags and keeps the text', () => {
  const { htmlToText } = transform()
  assert.equal(htmlToText('<p>Growth marketer for <strong>DTC</strong> brands.</p>'), 'Growth marketer for DTC brands.')
})

test('htmlToText turns block ends and <br> into spaces, never joining words', () => {
  const { htmlToText } = transform()
  assert.equal(htmlToText('<p>First line</p><p>Second line</p>'), 'First line Second line')
  assert.equal(htmlToText('one<br>two<br/>three<BR />four'), 'one two three four')
  assert.equal(htmlToText('<ul><li>a</li><li>b</li></ul>'), 'a b')
})

test('htmlToText drops script and style content entirely', () => {
  const { htmlToText } = transform()
  assert.equal(htmlToText('Hi<script>alert(1)</script>there'), 'Hi there')
  assert.equal(htmlToText('Hi<style>.x{color:red}</style>there'), 'Hi there')
})

test('htmlToText decodes named entities', () => {
  const { htmlToText } = transform()
  assert.equal(htmlToText('Brand &amp; Ops'), 'Brand & Ops')
  assert.equal(htmlToText('caf&eacute; &ndash; Paris&hellip;'), 'café – Paris…')
  assert.equal(htmlToText('a&nbsp;b'), 'a b', 'nbsp becomes a space, then collapses')
  assert.equal(htmlToText('&QUOT;quoted&QUOT;'), '"quoted"', 'names are matched case-insensitively')
})

test('htmlToText decodes numeric and hex references', () => {
  const { htmlToText } = transform()
  assert.equal(htmlToText('caf&#233;'), 'café')
  assert.equal(htmlToText('caf&#xE9;'), 'café')
  assert.equal(htmlToText('caf&#Xe9;'), 'café')
})

test('htmlToText leaves unknown or out-of-range references as written', () => {
  const { htmlToText } = transform()
  assert.equal(htmlToText('&notanentity; &#0; &#1114112;'), '&notanentity; &#0; &#1114112;')
})

// REGRESSION GUARD: decoding must be ONE pass. A loop-until-stable decode turns
// the literal "&amp;lt;" the author typed into "<", which is how escaped markup
// gets smuggled back into a value.
test('htmlToText decodes in a single pass, so "&amp;lt;" becomes "&lt;" and not "<"', () => {
  const { htmlToText } = transform()
  assert.equal(htmlToText('&amp;lt;script&amp;gt;'), '&lt;script&gt;')
  assert.equal(htmlToText('5 &amp;amp; 6'), '5 &amp; 6')
})

test('htmlToText collapses whitespace and trims', () => {
  const { htmlToText } = transform()
  assert.equal(htmlToText('  lots\n\tof   \r\n space  '), 'lots of space')
  assert.equal(htmlToText('<p>  padded  </p>'), 'padded')
})

test('htmlToText returns an empty string for null, undefined and blank input', () => {
  const { htmlToText } = transform()
  assert.equal(htmlToText(null), '')
  assert.equal(htmlToText(undefined), '')
  assert.equal(htmlToText(''), '')
  assert.equal(htmlToText('<p></p>'), '')
  assert.equal(htmlToText('   '), '')
})

test('htmlToText stringifies non-string input', () => {
  const { htmlToText } = transform()
  assert.equal(htmlToText(42), '42')
})

/* ------------------------------ parseRoles ----------------------------- *
 * Ported verbatim from v3/saved-starters-roles.js, so these mirror the sibling's
 * semantics: BOTH separators, ROLE_NAMES for acronym slugs, de-hyphenate as the
 * fallback (the chip's CSS text-transform supplies final casing), and
 * case-insensitive dedupe.
 * ---------------------------------------------------------------------- */

// REGRESSION (live bug, found on the published page): a real member's Roles value
// is semicolon-separated SLUGS. The old comma-only split put the entire string in
// Role_1 and left chips 2 and 3 empty. The Kaeser test record is a single display
// name, so it never caught this.
test('splits the live semicolon-separated slug string into three roles', () => {
  const { parseRoles } = transform()
  assert.deepEqual(list(parseRoles('head-of-growth; paid-social-marketer; performance-creative-lead')), [
    'head of growth',
    'paid social marketer',
    'performance creative lead',
  ])
})

test('comma-separated display names pass through untouched', () => {
  const { parseRoles } = transform()
  assert.deepEqual(list(parseRoles('AI Automation Expert')), ['AI Automation Expert'])
  assert.deepEqual(list(parseRoles('Growth Marketer,Paid Social,CRO Expert')), [
    'Growth Marketer',
    'Paid Social',
    'CRO Expert',
  ])
})

test('accepts both separators in one value', () => {
  const { parseRoles } = transform()
  assert.deepEqual(list(parseRoles('growth-strategy; paid-social,cro-expert')), [
    'growth strategy',
    'paid social',
    'CRO Expert',
  ])
})

test('maps acronym slugs to their display names instead of de-hyphenating', () => {
  const { parseRoles } = transform()
  assert.deepEqual(list(parseRoles('cro-expert')), ['CRO Expert'], 'not "cro expert" -> "Cro Expert"')
  assert.deepEqual(list(parseRoles('ui-ux-designer')), ['UI/UX Designer'])
  assert.deepEqual(list(parseRoles('seo-marketer; crm-marketer')), ['SEO Marketer', 'CRM Marketer'])
  assert.deepEqual(list(parseRoles('pr-directors')), ['PR Director'], 'the one plural fix')
  assert.deepEqual(list(parseRoles('e-commerce-manager')), ['E-Commerce Manager'])
  assert.deepEqual(list(parseRoles('ai-automation-expert')), ['AI Automation Expert'])
})

test('map lookup is case-insensitive on the stored slug', () => {
  const { parseRoles } = transform()
  assert.deepEqual(list(parseRoles('CRO-Expert')), ['CRO Expert'])
})

test('dedupes case-insensitively, including a slug and its display name together', () => {
  const { parseRoles } = transform()
  assert.deepEqual(list(parseRoles('cro-expert, CRO Expert')), ['CRO Expert'], 'map output collides with the display name')
  assert.deepEqual(list(parseRoles('paid-social; Paid-Social; paid social')), ['paid social'])
})

test('returns every role past the third — the slot cap lives in unwrap()', () => {
  const { parseRoles } = transform()
  assert.deepEqual(list(parseRoles('one,two,three,four,five')), ['one', 'two', 'three', 'four', 'five'])
})

test('trims whitespace, collapses runs, and drops empty segments', () => {
  const { parseRoles } = transform()
  assert.deepEqual(list(parseRoles('  Growth Marketer ,, Paid Social  ,  ')), ['Growth Marketer', 'Paid Social'])
  assert.deepEqual(list(parseRoles('\n Brand Strategy \t')), ['Brand Strategy'])
  assert.deepEqual(list(parseRoles('  ui--ux-designer ; ; brand-strategy ')), ['ui ux designer', 'brand strategy'])
})

test('returns an empty array for empty, blank and separator-only values', () => {
  const { parseRoles } = transform()
  assert.deepEqual(list(parseRoles('')), [])
  assert.deepEqual(list(parseRoles(null)), [])
  assert.deepEqual(list(parseRoles(undefined)), [])
  assert.deepEqual(list(parseRoles('   ')), [])
  assert.deepEqual(list(parseRoles(' , , ')), [])
  assert.deepEqual(list(parseRoles(' ; , - ')), [], 'a lone hyphen de-hyphenates to nothing')
})

/* --------------------- profile type normalization --------------------- *
 * The form blocks switch on `wf-xano-if-state="… === consult"`, whose comparison
 * is String(left) === right — case- and whitespace-exact. Live values are
 * case-inconsistent ("full" on one record, "Full" on another), so the transform
 * lowercases the field and the published attributes need no change.
 * -------------------------------------------------------------------- */

test('normalizeType lowercases and trims', () => {
  const { normalizeType } = transform()
  assert.equal(normalizeType('Full'), 'full')
  assert.equal(normalizeType('FULL'), 'full')
  assert.equal(normalizeType(' Consult '), 'consult')
  assert.equal(normalizeType('\tCoNsUlT\n'), 'consult')
  assert.equal(normalizeType('full'), 'full', 'already-normal values are unchanged')
})

test('normalizeType returns an empty string for absent values', () => {
  const { normalizeType } = transform()
  assert.equal(normalizeType(null), '')
  assert.equal(normalizeType(undefined), '')
  assert.equal(normalizeType(''), '')
  assert.equal(normalizeType('   '), '')
})

test('normalizeType is safe on non-string values', () => {
  const { normalizeType } = transform()
  assert.equal(normalizeType(39), '39')
  assert.equal(normalizeType(true), 'true')
  assert.equal(normalizeType(0), '0')
  assert.doesNotThrow(() => normalizeType({}))
  assert.doesNotThrow(() => normalizeType([1, 2]))
})

// The actual bug: Brian Chung (id 558) stores "Full", Kaeser stores "full".
test('unwrap normalizes a capitalised profile_type_30 in place', () => {
  const { unwrap } = transform()
  const [full] = unwrap(envelope({ First_Name: 'Brian', profile_type_30: 'Full' }))
  assert.equal(full.profile_type_30, 'full')
  const [consult] = unwrap(envelope({ First_Name: 'A', profile_type_30: ' Consult ' }))
  assert.equal(consult.profile_type_30, 'consult', 'a capital-C Consult must reach the consult form')
})

test('unwrap leaves an absent profile_type_30 as an empty string', () => {
  const { unwrap } = transform()
  assert.equal(unwrap(envelope({ First_Name: 'A' }))[0].profile_type_30, '')
  assert.equal(unwrap(envelope({ First_Name: 'A', profile_type_30: null }))[0].profile_type_30, '')
  // Either way the `!== consult` full-form fallback still evaluates true, so the
  // switching behaviour is unchanged for records with no type.
})

test('unwrap does not mutate the source record while normalizing', () => {
  const { unwrap } = transform()
  const record = { First_Name: 'A', profile_type_30: 'Full' }
  unwrap(envelope(record))
  assert.equal(record.profile_type_30, 'Full', 'the copy is normalized, not the input')
})

/* ------------------- resolved role names (the forward path) ---------------- *
 * The record carries `role_refs: [39, 38, 35]`; once Xano resolves those
 * server-side the response will carry real display names, which must win over
 * every string heuristic. Live now so that Xano change needs no client release.
 * -------------------------------------------------------------------------- */

test('a resolved array of strings wins over the Roles string', () => {
  const { roleNames } = transform()
  assert.deepEqual(
    list(roleNames({ roles_resolved: ['Head of Growth', 'Paid Social Marketer'], Roles: 'cro-expert' })),
    ['Head of Growth', 'Paid Social Marketer'],
  )
})

test('a resolved array of objects reads name, display_name or title', () => {
  const { roleNames } = transform()
  assert.deepEqual(
    list(roleNames({ roles_resolved: [{ id: 39, name: 'Head of Growth' }, { id: 38, name: 'Paid Social Marketer' }] })),
    ['Head of Growth', 'Paid Social Marketer'],
  )
  assert.deepEqual(list(roleNames({ roles_resolved: [{ display_name: 'CX Director' }] })), ['CX Director'])
  assert.deepEqual(list(roleNames({ roles_resolved: [{ title: 'Brand Strategist' }] })), ['Brand Strategist'])
  assert.deepEqual(
    list(roleNames({ roles_resolved: [{ name: 'Wins', display_name: 'Loses', title: 'Loses' }] })),
    ['Wins'],
    'name beats display_name beats title',
  )
})

test('the `roles` field name is accepted too, with roles_resolved preferred', () => {
  const { roleNames } = transform()
  assert.deepEqual(list(roleNames({ roles: ['From roles'] })), ['From roles'])
  assert.deepEqual(
    list(roleNames({ roles_resolved: ['Canonical'], roles: ['Secondary'] })),
    ['Canonical'],
    'roles_resolved is the canonical field',
  )
})

test('an empty or all-junk resolved array falls back to parsing the Roles string', () => {
  const { roleNames } = transform()
  const Roles = 'head-of-growth; paid-social-marketer'
  const expected = ['head of growth', 'paid social marketer']
  assert.deepEqual(list(roleNames({ roles_resolved: [], Roles })), expected, 'empty array')
  assert.deepEqual(list(roleNames({ roles_resolved: [{}, null, ''], Roles })), expected, 'no usable names')
  assert.deepEqual(list(roleNames({ roles: [39, 38, 35], Roles })), expected, 'bare ids are not display names')
  assert.deepEqual(list(roleNames({ roles_resolved: 'not an array', Roles })), expected)
  assert.deepEqual(list(roleNames({ Roles })), expected, 'no resolved field at all')
})

test('resolved values are NOT slug-mapped or de-hyphenated — they are authoritative', () => {
  const { roleNames } = transform()
  assert.deepEqual(
    list(roleNames({ roles_resolved: ['cro-expert'] })),
    ['cro-expert'],
    'printed as sent, even if it looks like a slug',
  )
  assert.deepEqual(list(roleNames({ roles_resolved: ['head-of-growth'] })), ['head-of-growth'])
})

test('resolved names are trimmed, emptied-out and deduped case-insensitively', () => {
  const { resolvedRoleNames } = transform()
  assert.deepEqual(list(resolvedRoleNames(['  Head of Growth  '])), ['Head of Growth'])
  assert.deepEqual(list(resolvedRoleNames(['Growth', 'growth', 'GROWTH'])), ['Growth'])
  assert.deepEqual(list(resolvedRoleNames(['A', '', '   ', null, undefined, 'B'])), ['A', 'B'])
  assert.deepEqual(list(resolvedRoleNames([{ name: '  Spaced  ' }, { name: 'spaced' }])), ['Spaced'])
})

test('resolvedRoleNames rejects non-arrays and junk entry types', () => {
  const { resolvedRoleNames } = transform()
  assert.deepEqual(list(resolvedRoleNames(null)), [])
  assert.deepEqual(list(resolvedRoleNames(undefined)), [])
  assert.deepEqual(list(resolvedRoleNames('Head of Growth')), [], 'a bare string is not a list')
  assert.deepEqual(list(resolvedRoleNames([39, true, false, [], {}])), [])
})

/* ------------------- ref ordering (Xano returns table order) --------------- *
 * Xano's `in` where-clause returns TABLE order, not the order of the ids handed
 * to it, so resolved arrays must be re-sorted into the record's ref order. This
 * matters: roles fill three ORDERED chip slots, and the category shows exactly
 * one value.
 * -------------------------------------------------------------------------- */

test('orderByRefs re-sorts a shuffled server response into ref order', () => {
  const { orderByRefs } = transform()
  const shuffled = [{ id: 35, name: 'C' }, { id: 39, name: 'A' }, { id: 38, name: 'B' }]
  assert.deepEqual(
    list(orderByRefs(shuffled, [39, 38, 35])).map((e) => e.name),
    ['A', 'B', 'C'],
  )
})

test('orderByRefs matches ids across string/number types', () => {
  const { orderByRefs } = transform()
  const entries = [{ id: '35', name: 'C' }, { id: 39, name: 'A' }]
  assert.deepEqual(list(orderByRefs(entries, ['39', 35])).map((e) => e.name), ['A', 'C'])
})

test('orderByRefs sends ids missing from the refs to the end, stably', () => {
  const { orderByRefs } = transform()
  const entries = [
    { id: 99, name: 'unlisted-1' },
    { id: 38, name: 'B' },
    { id: 98, name: 'unlisted-2' },
    { id: 39, name: 'A' },
  ]
  assert.deepEqual(
    list(orderByRefs(entries, [39, 38])).map((e) => e.name),
    ['A', 'B', 'unlisted-1', 'unlisted-2'],
  )
})

test('orderByRefs leaves entries without ids in server order', () => {
  const { orderByRefs } = transform()
  assert.deepEqual(list(orderByRefs(['C', 'A', 'B'], [39, 38, 35])), ['C', 'A', 'B'])
  // Mixed: identifiable entries sort first, id-less ones keep order behind them.
  const mixed = [{ name: 'no-id-1' }, { id: 38, name: 'B' }, { name: 'no-id-2' }, { id: 39, name: 'A' }]
  assert.deepEqual(
    list(orderByRefs(mixed, [39, 38])).map((e) => e.name),
    ['A', 'B', 'no-id-1', 'no-id-2'],
  )
})

test('orderByRefs is a no-op without usable refs or with fewer than two entries', () => {
  const { orderByRefs } = transform()
  const entries = [{ id: 35, name: 'C' }, { id: 39, name: 'A' }]
  assert.deepEqual(list(orderByRefs(entries, null)).map((e) => e.name), ['C', 'A'])
  assert.deepEqual(list(orderByRefs(entries, [])).map((e) => e.name), ['C', 'A'])
  assert.deepEqual(list(orderByRefs([{ id: 1, name: 'only' }], [9, 1])).map((e) => e.name), ['only'])
})

// Brian's record: role_refs [39, 38, 35].
test('roleNames applies role_refs order to a shuffled resolved array', () => {
  const { roleNames } = transform()
  const names = roleNames({
    role_refs: [39, 38, 35],
    roles_resolved: [
      { id: 35, name: 'Performance Creative Lead' },
      { id: 39, name: 'Head of Growth' },
      { id: 38, name: 'Paid Social Marketer' },
    ],
  })
  assert.deepEqual(list(names), ['Head of Growth', 'Paid Social Marketer', 'Performance Creative Lead'])
})

test('unwrap fills the chip slots in role_refs order, not server order', () => {
  const { unwrap } = transform()
  const [item] = unwrap(
    envelope({
      First_Name: 'Brian',
      role_refs: [39, 38, 35],
      roles_resolved: [
        { id: 38, name: 'Paid Social Marketer' },
        { id: 35, name: 'Performance Creative Lead' },
        { id: 39, name: 'Head of Growth' },
      ],
    }),
  )
  assert.deepEqual(
    [item.Role_1, item.Role_2, item.Role_3],
    ['Head of Growth', 'Paid Social Marketer', 'Performance Creative Lead'],
  )
})

// LEGACY, per Jerico 2026-07-30: role_refs is authoritative; these three fields
// must never influence ordering or selection.
test('legacy primary/secondary/tertiary_role_ref fields are carried but ignored', () => {
  const { unwrap } = transform()
  const [item] = unwrap(
    envelope({
      First_Name: 'A',
      role_refs: [39, 38],
      // Deliberately disagreeing with role_refs order.
      primary_role_ref: 38,
      secondary_role_ref: 39,
      tertiary_role_ref: null,
      roles_resolved: [{ id: 39, name: 'Head of Growth' }, { id: 38, name: 'Paid Social Marketer' }],
    }),
  )
  assert.equal(item.Role_1, 'Head of Growth', 'role_refs[0] wins, not primary_role_ref')
  assert.equal(item.Role_2, 'Paid Social Marketer')
  // Still copied through untouched, in case something else ever binds them.
  assert.equal(item.primary_role_ref, 38)
  assert.equal(item.secondary_role_ref, 39)
  assert.equal(item.tertiary_role_ref, null)
})

/* --------------------------- category (one value) -------------------------- *
 * Classification displays exactly ONE category, resolved from the single
 * `primary_category_ref` field. Brian: primary_category_ref 4, category_refs
 * [4, 13], raw Category slug "marketing-strategy-leadership".
 * -------------------------------------------------------------------------- */

test('category_resolved (singular) wins and may be a string or an object', () => {
  const { categoryName } = transform()
  assert.equal(categoryName({ category_resolved: 'Marketing, Strategy & Leadership' }), 'Marketing, Strategy & Leadership')
  assert.equal(categoryName({ category_resolved: { id: 4, name: 'Marketing & Strategy' } }), 'Marketing & Strategy')
  assert.equal(categoryName({ category_resolved: { display_name: 'From display_name' } }), 'From display_name')
  assert.equal(categoryName({ category_resolved: { title: 'From title' } }), 'From title')
})

test('the singular field beats the plural array and the legacy string', () => {
  const { categoryName } = transform()
  assert.equal(
    categoryName({
      category_resolved: { id: 4, name: 'Singular Wins' },
      categories_resolved: [{ id: 4, name: 'Plural Loses' }],
      Category: 'marketing-strategy-leadership',
    }),
    'Singular Wins',
  )
})

test('the plural array is accepted as a secondary shape', () => {
  const { categoryName } = transform()
  assert.equal(categoryName({ categories_resolved: [{ id: 4, name: 'From Plural' }] }), 'From Plural')
  assert.equal(categoryName({ categories: ['From categories'] }), 'From categories')
  assert.equal(
    categoryName({ categories_resolved: [{ id: 4, name: 'Preferred' }], categories: [{ id: 4, name: 'Secondary' }] }),
    'Preferred',
  )
})

// The whole point of the correction: "first category" means the record's
// primary_category_ref, never the lowest id or the server's table order.
test('the plural array picks the entry matching primary_category_ref', () => {
  const { categoryName } = transform()
  const record = {
    primary_category_ref: 4,
    category_refs: [4, 13],
    // Table order puts 13 first — the naive "first" would be wrong.
    categories_resolved: [
      { id: 13, name: 'Operations' },
      { id: 4, name: 'Marketing & Strategy' },
    ],
  }
  assert.equal(categoryName(record), 'Marketing & Strategy')
})

test('without a primary ref the plural array falls back to category_refs order', () => {
  const { categoryName } = transform()
  assert.equal(
    categoryName({
      category_refs: [4, 13],
      categories_resolved: [{ id: 13, name: 'Operations' }, { id: 4, name: 'Marketing & Strategy' }],
    }),
    'Marketing & Strategy',
  )
  // No refs at all: server order stands.
  assert.equal(
    categoryName({ categories_resolved: [{ id: 13, name: 'Operations' }, { id: 4, name: 'Marketing' }] }),
    'Operations',
  )
})

test('a primary ref with no matching entry still yields a category', () => {
  const { categoryName } = transform()
  assert.equal(
    categoryName({
      primary_category_ref: 999,
      category_refs: [4, 13],
      categories_resolved: [{ id: 13, name: 'Operations' }, { id: 4, name: 'Marketing & Strategy' }],
    }),
    'Marketing & Strategy',
    'unmatched primary falls through to ref order rather than rendering nothing',
  )
})

// Brian's live fallback case.
test('the legacy Category string de-hyphenates a slug-looking value', () => {
  const { categoryName, deSlug } = transform()
  assert.equal(categoryName({ Category: 'marketing-strategy-leadership' }), 'marketing strategy leadership')
  assert.equal(deSlug('marketing-strategy-leadership'), 'marketing strategy leadership')
  assert.equal(deSlug('CRO-Expert'), 'cro expert', 'lowercased; the card CSS capitalizes')
})

// Kaeser's live value.
test('the legacy Category string passes display-like values through verbatim', () => {
  const { categoryName, deSlug } = transform()
  assert.equal(categoryName({ Category: 'Creative & Brand' }), 'Creative & Brand')
  assert.equal(deSlug('Creative & Brand'), 'Creative & Brand', 'has a space, so not a slug')
  assert.equal(deSlug('E-Commerce Manager'), 'E-Commerce Manager', 'hyphen AND space: left alone')
  assert.equal(deSlug('Marketing'), 'Marketing', 'single word, no hyphen')
  assert.equal(deSlug('  Padded  '), 'Padded')
})

test('categoryName tolerates junk and missing values', () => {
  const { categoryName } = transform()
  assert.equal(categoryName({}), '')
  assert.equal(categoryName(null), '')
  assert.equal(categoryName({ Category: null }), '')
  assert.equal(categoryName({ category_resolved: 4 }), '', 'a bare id is not a display name')
  assert.equal(categoryName({ category_resolved: {} }), '')
  assert.equal(categoryName({ category_resolved: [] }), '')
  assert.equal(categoryName({ categories_resolved: [39, 13], Category: 'ops-and-more' }), 'ops and more')
  assert.equal(categoryName({ categories_resolved: 'not an array', Category: 'Ops' }), 'Ops')
})

test('unwrap sets Category from the resolved field and keeps the raw refs', () => {
  const { unwrap } = transform()
  const [resolved] = unwrap(
    envelope({
      First_Name: 'Brian',
      primary_category_ref: 4,
      category_refs: [4, 13],
      category_resolved: { id: 4, name: 'Marketing, Strategy & Leadership' },
      Category: 'marketing-strategy-leadership',
    }),
  )
  assert.equal(resolved.Category, 'Marketing, Strategy & Leadership')
  assert.equal(resolved.primary_category_ref, 4, 'raw refs carried through untouched')
  assert.deepEqual(list(resolved.category_refs), [4, 13])

  const [fallback] = unwrap(
    envelope({ First_Name: 'Brian', primary_category_ref: 4, Category: 'marketing-strategy-leadership' }),
  )
  assert.equal(fallback.Category, 'marketing strategy leadership')
})

test('joinLocation joins city, state and country in order', () => {
  const { joinLocation } = transform()
  assert.equal(
    joinLocation({ City: 'Bashkia Klos', State_Province: 'Dibër', Country: 'Albania' }),
    'Bashkia Klos, Dibër, Albania',
  )
})

test('joinLocation skips empty parts without leaving orphan commas', () => {
  const { joinLocation } = transform()
  assert.equal(joinLocation({ City: 'Lisbon', State_Province: '', Country: 'Portugal' }), 'Lisbon, Portugal')
  assert.equal(joinLocation({ City: '', State_Province: 'Ontario', Country: 'Canada' }), 'Ontario, Canada')
  assert.equal(joinLocation({ City: 'Berlin', State_Province: null, Country: undefined }), 'Berlin')
  assert.equal(joinLocation({ City: '  ', State_Province: '  ', Country: 'Kenya' }), 'Kenya')
})

test('joinLocation returns an empty string when nothing is set', () => {
  const { joinLocation } = transform()
  assert.equal(joinLocation({}), '')
  assert.equal(joinLocation({ City: '', State_Province: '', Country: '' }), '')
  assert.equal(joinLocation({ City: null, State_Province: undefined, Country: '   ' }), '')
})

test('joinLocation ignores other address-ish fields', () => {
  const { joinLocation } = transform()
  assert.equal(joinLocation({ City: 'Oslo', Address: '12 Somewhere St', Zip: '0150' }), 'Oslo')
})

/* -------------------------------- unwrap ------------------------------- */

const envelope = (record) => [{ freelancer: [record] }]

test('unwrap pulls the record out of the {"freelancer":[…]} envelope', () => {
  const { unwrap } = transform()
  const [item] = unwrap(
    envelope({
      id: 7,
      First_Name: 'Kaeser',
      Last_Name: 'Ahmed',
      Professional_Headline: 'Growth for DTC brands',
      Roles: 'Growth Marketer',
      Bio: '<p>Ten years of <em>paid</em> growth.</p>',
      Category: 'Marketing',
      City: 'Bashkia Klos',
      State_Province: 'Dibër',
      Country: 'Albania',
    }),
  )
  assert.equal(item.First_Name, 'Kaeser')
  assert.equal(item.id, 7, 'every original field is carried through')
  assert.equal(item.Category, 'Marketing')
  assert.equal(item.Role_1, 'Growth Marketer')
  assert.equal(item.Role_2, '', 'unused chip slots must be empty strings so wf-xano-if hides them')
  assert.equal(item.Role_3, '')
  assert.equal(item.Location, 'Bashkia Klos, Dibër, Albania')
  assert.equal(item.Bio, 'Ten years of paid growth.')
})

// The live bug, end to end: the record's semicolon slug string must reach the
// three chip slots as three separate display values.
test('unwrap prefers resolved names and still caps at three slots', () => {
  const { unwrap } = transform()
  const [item] = unwrap(
    envelope({
      First_Name: 'A',
      role_refs: [39, 38, 35],
      roles_resolved: [
        { id: 39, name: 'Head of Growth' },
        { id: 38, name: 'Paid Social Marketer' },
        { id: 35, name: 'Performance Creative Lead' },
        { id: 12, name: 'Dropped Fourth' },
      ],
      Roles: 'ignored-because-resolved-wins',
    }),
  )
  assert.deepEqual(
    [item.Role_1, item.Role_2, item.Role_3],
    ['Head of Growth', 'Paid Social Marketer', 'Performance Creative Lead'],
  )
  assert.equal(item.Role_4, undefined)
  assert.equal(list(item.role_refs).length, 3, 'the raw refs are carried through untouched')
})

test('unwrap fills the chip slots from the live semicolon slug string', () => {
  const { unwrap } = transform()
  const [item] = unwrap(
    envelope({
      First_Name: 'A',
      Roles: 'head-of-growth; paid-social-marketer; performance-creative-lead',
    }),
  )
  assert.equal(item.Role_1, 'head of growth')
  assert.equal(item.Role_2, 'paid social marketer')
  assert.equal(item.Role_3, 'performance creative lead')
})

test('unwrap truncates a semicolon slug string past three roles', () => {
  const { unwrap } = transform()
  const [item] = unwrap(
    envelope({ First_Name: 'A', Roles: 'cro-expert; seo-marketer; crm-marketer; brand-strategy' }),
  )
  assert.deepEqual([item.Role_1, item.Role_2, item.Role_3], ['CRO Expert', 'SEO Marketer', 'CRM Marketer'])
  assert.equal(item.Role_4, undefined, 'the fourth role is dropped, not stored')
})

test('unwrap fills all three role slots and drops the overflow', () => {
  const { unwrap } = transform()
  const [item] = unwrap(envelope({ First_Name: 'A', Roles: 'One, Two, Three, Four' }))
  assert.equal(item.Role_1, 'One')
  assert.equal(item.Role_2, 'Two')
  assert.equal(item.Role_3, 'Three')
  assert.equal(item.Role_4, undefined, 'the card has three chip slots; a fourth field would be dead weight')
})

test('unwrap leaves every role slot empty when Roles is missing or blank', () => {
  const { unwrap } = transform()
  const [missing] = unwrap(envelope({ First_Name: 'A' }))
  assert.deepEqual([missing.Role_1, missing.Role_2, missing.Role_3], ['', '', ''])
  const [blank] = unwrap(envelope({ First_Name: 'A', Roles: ' , ' }))
  assert.deepEqual([blank.Role_1, blank.Role_2, blank.Role_3], ['', '', ''])
})

test('unwrap returns exactly one item — the card is a single record', () => {
  const { unwrap } = transform()
  const out = unwrap([{ freelancer: [{ First_Name: 'A' }, { First_Name: 'B' }] }])
  assert.equal(out.length, 1)
  assert.equal(out[0].First_Name, 'A')
})

test('unwrap returns [] for an empty freelancer array (the empty state)', () => {
  const { unwrap } = transform()
  assert.deepEqual(list(unwrap([{ freelancer: [] }])), [])
})

test('unwrap returns [] when the freelancer key is missing', () => {
  const { unwrap } = transform()
  assert.deepEqual(list(unwrap([{ something_else: [{ First_Name: 'A' }] }])), [])
  assert.deepEqual(list(unwrap([{}])), [])
})

test('unwrap returns [] when freelancer is not an array', () => {
  const { unwrap } = transform()
  assert.deepEqual(list(unwrap([{ freelancer: { First_Name: 'A' } }])), [])
  assert.deepEqual(list(unwrap([{ freelancer: null }])), [])
  assert.deepEqual(list(unwrap([{ freelancer: 'nope' }])), [])
})

test('unwrap returns [] for a non-object record', () => {
  const { unwrap } = transform()
  assert.deepEqual(list(unwrap([{ freelancer: ['just a string'] }])), [])
  assert.deepEqual(list(unwrap([{ freelancer: [42] }])), [])
  assert.deepEqual(list(unwrap([{ freelancer: [null] }])), [])
})

test('unwrap returns [] for no items, an empty list, or a null body', () => {
  const { unwrap } = transform()
  assert.deepEqual(list(unwrap([])), [])
  assert.deepEqual(list(unwrap(null)), [])
  assert.deepEqual(list(unwrap(undefined)), [])
  assert.deepEqual(list(unwrap([null])), [])
})

test('unwrap does not mutate the record it was handed', () => {
  const { unwrap } = transform()
  const record = { First_Name: 'A', Roles: 'One,Two', Bio: '<p>Hi</p>', City: 'Oslo' }
  unwrap(envelope(record))
  assert.deepEqual(record, { First_Name: 'A', Roles: 'One,Two', Bio: '<p>Hi</p>', City: 'Oslo' })
})

test('unwrap overwrites any server-sent Role_1/Location/Bio with the computed value', () => {
  const { unwrap } = transform()
  const [item] = unwrap(
    envelope({
      First_Name: 'A',
      Roles: 'Computed Role',
      Role_1: 'Stale',
      Location: 'Stale',
      Bio: '<p>Fresh</p>',
      City: 'Oslo',
    }),
  )
  assert.equal(item.Role_1, 'Computed Role')
  assert.equal(item.Location, 'Oslo')
  assert.equal(item.Bio, 'Fresh')
})

/* ------------------------------- arming ------------------------------- */

test('registers the beforeRender hook once wf-xano boots', () => {
  const mod = loadModule()
  assert.equal(mod.queue.length, 1, 'arm() must be queued through push(), not run immediately')
  mod.drain()
  assert.equal(mod.hooks.beforeRender.length, 1)
  assert.equal(mod.hooks.beforeRender[0], mod.api.unwrap, 'the hook is the transform itself')
  assert.deepEqual(mod.warnings, [])
})

// REGRESSION: wf-xano assigns window.WfXano = {api} at module scope, before its
// boot() creates any instance. A deferred page script lands in that window.
// Branching on Array.isArray and arming directly finds no instance and gives up.
test('queues through push() when WfXano is the API object but has not booted yet', () => {
  const mod = loadModule({ wfXano: 'object' })
  assert.deepEqual(mod.warnings, [], 'must not warn: the instance simply does not exist yet')
  mod.drain()
  assert.equal(mod.hooks.beforeRender.length, 1)
  assert.deepEqual(mod.warnings, [])
})

test('does not refresh while the first fetch is still in flight', () => {
  const mod = loadModule({ status: 'loading' })
  mod.drain()
  assert.deepEqual(mod.refreshes, [], 'the hook is registered in time; re-fetching would be a wasted GET')
})

test('refreshes when a render already settled before this script ran', () => {
  const success = loadModule({ status: 'success' })
  success.drain()
  assert.equal(success.refreshes.length, 1, 'the settled render used no transform — repaint it')

  const failed = loadModule({ status: 'error' })
  failed.drain()
  assert.equal(failed.refreshes.length, 1)
})

test('survives an instance with no getState or no refresh', () => {
  const noState = loadModule({ withGetState: false })
  noState.drain()
  assert.equal(noState.hooks.beforeRender.length, 1)
  assert.deepEqual(noState.refreshes, [])

  const noRefresh = loadModule({ status: 'success', withRefresh: false })
  noRefresh.drain()
  assert.equal(noRefresh.hooks.beforeRender.length, 1, 'the hook still lands; only the belt is skipped')
})

test('warns on staging when the instance is missing after boot', () => {
  const mod = loadModule({ withInstance: false })
  mod.drain()
  assert.equal(mod.warnings.length, 1)
  assert.match(mod.warnings[0], /no wf-xano instance reading starters_onboarding\/get_freelancers\*/)
  assert.match(mod.warnings[0], /none keyed "onboarding-self-preview"/)
})

test('stays silent in production when the instance is missing', () => {
  const mod = loadModule({ withInstance: false, hostname: 'thestarters.com' })
  mod.drain()
  assert.deepEqual(mod.warnings, [])
})

test('warns through the cloudflared dev tunnel too', () => {
  const mod = loadModule({ withInstance: false, hostname: 'some-words-here.trycloudflare.com' })
  mod.drain()
  assert.equal(mod.warnings.length, 1)
})

test('STARTERS_DEBUG re-enables the warning in production', () => {
  const mod = loadModule({ withInstance: false, hostname: 'thestarters.com', debug: true })
  mod.drain()
  assert.equal(mod.warnings.length, 1)
})

/* ------------------- multi-instance arming (one per form) ------------------ *
 * Each form block is its own wrapper with its own card template, because
 * wf-xano binds exactly one template per wrapper. So the module arms by
 * ENDPOINT, not by instance key.
 * -------------------------------------------------------------------------- */

const ENDPOINT = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starters_onboarding/get_freelancers'
const TWO_FORMS = [
  { key: 'onboarding-preview-full', url: ENDPOINT },
  { key: 'onboarding-preview-consult', url: ENDPOINT },
]

test('sourceMatches accepts the endpoint in the shapes a source can take', () => {
  const { sourceMatches } = loadModule().api
  assert.equal(sourceMatches(ENDPOINT), true)
  assert.equal(sourceMatches(ENDPOINT + '/'), true, 'trailing slash')
  assert.equal(sourceMatches(ENDPOINT + '?memberstack_id=mem_x'), true, 'query string')
  assert.equal(sourceMatches(ENDPOINT + '#frag'), true, 'hash')
  assert.equal(sourceMatches('KZf7nFnk:starters_onboarding/get_freelancers'), true, 'raw group:path source')
  assert.equal(sourceMatches('/starters_onboarding/get_freelancers'), true, 'relative source')
  assert.equal(sourceMatches('starters_onboarding/get_freelancers'), true, 'bare path')
})

// REGRESSION (live, blocking): the page was repointed at `get_freelancers_test`, a
// temporary secret-gated mirror. The matcher was an exact endsWith, so nothing
// armed, no transform ran, and every bind rendered against the raw envelope. The
// endpoint name is expected to keep changing (`_secure` is next), so suffixed
// variants must match.
test('sourceMatches accepts suffixed endpoint variants', () => {
  const { sourceMatches } = loadModule().api
  assert.equal(sourceMatches(ENDPOINT + '_test'), true, 'the temporary secret-gated mirror')
  assert.equal(sourceMatches(ENDPOINT + '_secure'), true)
  assert.equal(sourceMatches(ENDPOINT + '_test?memberstack_id=mem_x'), true)
  assert.equal(sourceMatches('KZf7nFnk:starters_onboarding/get_freelancers_test'), true)
})

test('sourceMatches rejects other endpoints and junk', () => {
  const { sourceMatches } = loadModule().api
  const GROUP = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/'
  assert.equal(sourceMatches(GROUP + 'starters_onboarding/get_brands'), false)
  assert.equal(sourceMatches(GROUP + 'starters_onboarding/get_something_else'), false, 'same group, other endpoint')
  // The group name has to start a path segment, so lookalikes stay out.
  assert.equal(sourceMatches(GROUP + 'other_group/get_freelancers'), false)
  assert.equal(sourceMatches(GROUP + 'not_starters_onboarding/get_freelancers'), false)
  assert.equal(sourceMatches('get_freelancers'), false, 'the group segment is required, not just the endpoint')
  assert.equal(sourceMatches(''), false)
  assert.equal(sourceMatches(null), false)
  assert.equal(sourceMatches(undefined), false)
})

// DELIBERATE LOOSENING. This asserted false when the matcher was an exact
// endsWith. Matching suffixed endpoints (`_test`, `_secure`) means the check is now
// a segment-prefix one, and a deeper path under the same endpoint comes along for
// the ride. That is accepted: no such route exists, and if one is ever added it
// would still be this endpoint's data and still want the same transform. Keeping it
// excluded would mean re-tightening to an endsWith and re-breaking `_test`.
test('sourceMatches now also accepts a deeper path under the endpoint', () => {
  const { sourceMatches } = loadModule().api
  assert.equal(sourceMatches(ENDPOINT + '/extra'), true)
})

test('instanceMatches takes the endpoint from url or source, or the legacy key', () => {
  const { instanceMatches } = loadModule().api
  assert.equal(instanceMatches({ key: 'onboarding-preview-full', url: ENDPOINT }), true)
  assert.equal(instanceMatches({ key: 'x', source: 'KZf7nFnk:starters_onboarding/get_freelancers' }), true)
  assert.equal(instanceMatches({ key: 'onboarding-self-preview' }), true, 'legacy key needs no source')
  assert.equal(instanceMatches({ key: 'saved-starters', url: 'https://example.test/other' }), false)
  assert.equal(instanceMatches(null), false)
})

test('arms BOTH form instances, each with its own hook', () => {
  const mod = loadModule({ instances: TWO_FORMS })
  mod.drain()
  const [full, consult] = mod.instanceList
  assert.equal(full.own.hooks.beforeRender.length, 1, 'full form instance armed')
  assert.equal(consult.own.hooks.beforeRender.length, 1, 'consult form instance armed')
  assert.equal(full.own.hooks.beforeRender[0], consult.own.hooks.beforeRender[0], 'same pure transform')
  assert.deepEqual(mod.warnings, [])
})

// The live blocking case: both form wrappers pointed at the _test mirror.
test('arms both form instances on a suffixed endpoint variant', () => {
  const mod = loadModule({
    instances: [
      { key: 'onboarding-preview-full', url: ENDPOINT + '_test' },
      { key: 'onboarding-preview-consult', url: ENDPOINT + '_test' },
    ],
  })
  mod.drain()
  assert.deepEqual(
    mod.instanceList.map((i) => i.own.hooks.beforeRender.length),
    [1, 1],
  )
  assert.deepEqual(mod.warnings, [])
  assert.match(mod.infos[0], /armed 2 instance\(s\)/)
})

test('arms a mix of base and variant endpoints together', () => {
  const mod = loadModule({
    instances: [
      { key: 'onboarding-preview-full', url: ENDPOINT + '_secure' },
      { key: 'onboarding-preview-consult', url: ENDPOINT },
    ],
  })
  mod.drain()
  assert.deepEqual(
    mod.instanceList.map((i) => i.own.hooks.beforeRender.length),
    [1, 1],
  )
})

test('ignores instances pointing at a different endpoint', () => {
  const mod = loadModule({
    instances: [
      { key: 'saved-starters', url: 'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30/brand/favorites' },
      { key: 'onboarding-preview-full', url: ENDPOINT },
      { key: 'some-other-list', url: 'https://example.test/api/things' },
    ],
  })
  mod.drain()
  const [favorites, full, other] = mod.instanceList
  assert.deepEqual(favorites.own.hooks, {}, 'never touch another list')
  assert.deepEqual(other.own.hooks, {})
  assert.equal(full.own.hooks.beforeRender.length, 1)
})

test('falls back to the legacy key when the API exposes no instances array', () => {
  const mod = loadModule() // no `instances` -> get()-only, as before
  mod.drain()
  assert.equal(mod.hooks.beforeRender.length, 1)
  assert.deepEqual(mod.warnings, [])
})

// The legacy instance is reachable BOTH ways; it must be armed once, or the
// transform would run twice per render.
test('dedupes an instance found by both source match and legacy key', () => {
  const mod = loadModule({ instances: [{ key: 'onboarding-self-preview', url: ENDPOINT }] })
  mod.drain()
  assert.equal(mod.instanceList[0].own.hooks.beforeRender.length, 1)
  assert.equal(mod.hooks.beforeRender.length, 1)
})

test('arms a legacy-keyed instance alongside the two new ones, without duplication', () => {
  const mod = loadModule({
    instances: [{ key: 'onboarding-self-preview' }, ...TWO_FORMS],
  })
  mod.drain()
  assert.deepEqual(
    mod.instanceList.map((i) => i.own.hooks.beforeRender.length),
    [1, 1, 1],
  )
  assert.equal(mod.hooks.beforeRender.length, 3, 'three lists, three registrations, no repeats')
})

test('warns when no instance reads the endpoint', () => {
  const mod = loadModule({
    instances: [{ key: 'saved-starters', url: 'https://example.test/other' }],
    withInstance: false,
  })
  mod.drain()
  assert.equal(mod.warnings.length, 1)
  assert.match(mod.warnings[0], /no wf-xano instance reading starters_onboarding\/get_freelancers\*/)
})

test('reports which instances were armed, on staging only', () => {
  const staging = loadModule({ instances: TWO_FORMS })
  staging.drain()
  assert.equal(staging.infos.length, 1)
  assert.match(staging.infos[0], /armed 2 instance\(s\): "onboarding-preview-full", "onboarding-preview-consult"/)

  const prod = loadModule({ instances: TWO_FORMS, hostname: 'thestarters.com' })
  prod.drain()
  assert.deepEqual(prod.infos, [])
  assert.deepEqual(prod.warnings, [])
  assert.equal(prod.instanceList[0].own.hooks.beforeRender.length, 1, 'silent, but still armed')
})

test('names an unkeyed instance rather than printing undefined', () => {
  const mod = loadModule({ instances: [{ key: null, url: ENDPOINT }] })
  mod.drain()
  assert.match(mod.infos[0], /armed 1 instance\(s\): "\(unkeyed\)"/)
})

test('the settled-state belt applies per instance', () => {
  const mod = loadModule({ instances: TWO_FORMS, status: 'success' })
  mod.drain()
  assert.equal(mod.instanceList[0].own.refreshes.length, 1)
  assert.equal(mod.instanceList[1].own.refreshes.length, 1)
})

test('targetInstances is exposed and re-runnable against a live API object', () => {
  const mod = loadModule({ instances: TWO_FORMS })
  mod.drain()
  assert.equal(list(mod.api.targetInstances(mod.api2)).length, 2)
  assert.equal(list(mod.api.targetInstances({ instances: [] })).length, 0)
  assert.equal(list(mod.api.targetInstances(null)).length, 0)
})

/* ------------------ staging host gate (console diagnostics) ---------------- *
 * stagingHost() has ONE job now: deciding whether warn()/note() print. It used to
 * also gate a query-string member-preview override, which is gone — the endpoint
 * is authenticated and Xano derives the member from the token (2026-07-31).
 * -------------------------------------------------------------------------- */

test('stagingHost accepts webflow.io, localhost and cloudflared tunnels only', () => {
  const accepted = [
    'the-starters-3-0.webflow.io',
    'webflow.io',
    'localhost',
    '127.0.0.1',
    'function-robot-chain-bless.trycloudflare.com',
  ]
  accepted.forEach((hostname) => {
    assert.equal(loadModule({ hostname }).api.stagingHost(), true, hostname)
  })

  const rejected = [
    'thestarters.com',
    'www.thestarters.com',
    // Lookalikes: the unanchored regex the sibling modules use would pass these.
    // The anchored form is kept even now that only logging rides on it — a
    // lookalike host has no business making the page chatty.
    'notwebflow.io',
    'evil-trycloudflare.com',
    'webflow.io.attacker.test',
    'localhost.attacker.test',
    '',
  ]
  rejected.forEach((hostname) => {
    assert.equal(loadModule({ hostname }).api.stagingHost(), false, hostname)
  })
})

/* ----------------- no query-string param plumbing (regression) ------------- *
 * REMOVED 2026-07-31: the `?ms=<memberstack_id>` staging tester. Xano now derives
 * the member from the user_v3 token and IGNORES a client-supplied
 * `memberstack_id`, so the override changed nothing while still logging as though
 * it had. These guard the removal: the module must set NO request param from the
 * URL, on any host, and must not narrate a preview that is not happening.
 * -------------------------------------------------------------------------- */

test('sets no request param from the query string, on staging or production', () => {
  const cases = [
    { search: '?ms=mem_someone_else' },
    { search: '?ms=mem_someone_else', hostname: 'thestarters.com' },
    { search: '?ms=mem_someone_else', hostname: 'localhost' },
    // STARTERS_DEBUG turns logging on; it must not turn plumbing on.
    { search: '?ms=mem_someone_else', hostname: 'thestarters.com', debug: true },
    { search: '?a=1&ms=mem_x&b=2' },
    { search: '?other=1' },
  ]
  cases.forEach((options) => {
    const mod = loadModule({ instances: TWO_FORMS, ...options })
    mod.drain()
    assert.deepEqual(mod.params, [], JSON.stringify(options))
    assert.deepEqual(
      mod.instanceList.map((i) => i.own.params),
      [[], []],
      'no instance may be handed a param',
    )
    assert.equal(mod.hooks.beforeRender.length, 2, 'both lists still armed')
  })
})

test('never warns about previewing a member', () => {
  const mod = loadModule({ instances: TWO_FORMS, search: '?ms=mem_bogus' })
  mod.drain()
  assert.deepEqual(mod.warnings, [], 'nothing is overridden, so there is nothing to announce')
  assert.equal(mod.infos.length, 1, 'only the normal "armed N instance(s)" line')
  assert.match(mod.infos[0], /armed 2 instance\(s\)/)
})

test('the settled-state belt runs whatever the query string says', () => {
  const mod = loadModule({ search: '?ms=mem_bogus', status: 'success' })
  mod.drain()
  assert.deepEqual(mod.params, [])
  assert.equal(mod.refreshes.length, 1, 'the repaint belt is no longer skipped for an override')
  assert.equal(mod.hooks.beforeRender.length, 1, 'the hook is registered before the refetch')
})

test('works against a library with no setParam at all', () => {
  const mod = loadModule({ search: '?ms=mem_bogus', status: 'success', withSetParam: false })
  mod.drain()
  assert.deepEqual(mod.params, [])
  assert.equal(mod.refreshes.length, 1)
  assert.equal(mod.hooks.beforeRender.length, 1)
})

/* -------------------------------- boot -------------------------------- */

test('marker gate: does not touch WfXano on a page without the wrapper', () => {
  const mod = loadModule({ hasWrapper: false })
  assert.deepEqual(mod.queue, [])
  // Both grammars: the legacy key, and any wrapper naming our endpoint (the new
  // per-form wrappers have their own keys, so a key-only gate would miss them).
  assert.deepEqual(mod.selectors, [
    '[wf-xano-instance="onboarding-self-preview"], [wf-xano-source*="starters_onboarding/get_freelancers"]',
  ])
})

test('waits for DOMContentLoaded when the document is still parsing', () => {
  const mod = loadModule({ readyState: 'loading' })
  assert.deepEqual(mod.queue, [], 'the marker gate cannot run before the wrapper is parsed')
  mod.fireDomReady()
  assert.equal(mod.queue.length, 1)
})

test('boots only once even if the file loads twice', () => {
  const mod = loadModule()
  assert.equal(mod.queue.length, 1)
  mod.reevaluate()
  assert.equal(mod.queue.length, 1, 'a duplicate CDN tag must not queue a second arm()')
})

test('a duplicate load does not register the hook twice', () => {
  const mod = loadModule()
  mod.reevaluate()
  mod.drain()
  assert.equal(mod.hooks.beforeRender.length, 1)
})

test('exposes the transform and the instance selection for console debugging', () => {
  const mod = loadModule()
  assert.deepEqual(Object.keys(mod.api).sort(), [
    'categoryName',
    'deSlug',
    'htmlToText',
    'instanceMatches',
    'joinLocation',
    'normalizeType',
    'orderByRefs',
    'parseRoles',
    'resolvedNames',
    'resolvedRoleNames',
    'roleNames',
    'sourceMatches',
    'stagingHost',
    'targetInstances',
    'unwrap',
  ])
})
