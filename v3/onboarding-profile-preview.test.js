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
  // Drop URLSearchParams from the realm to prove the override degrades to null
  // instead of throwing out of the queue callback.
  withUrlSearchParams = true,
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
  if (withUrlSearchParams) sandbox.URLSearchParams = URLSearchParams
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

/* ------------------------------ splitRoles ----------------------------- */

test('splitRoles returns an empty array for empty and blank values', () => {
  const { splitRoles } = transform()
  assert.deepEqual(list(splitRoles('')), [])
  assert.deepEqual(list(splitRoles(null)), [])
  assert.deepEqual(list(splitRoles(undefined)), [])
  assert.deepEqual(list(splitRoles('   ')), [])
  assert.deepEqual(list(splitRoles(' , , ')), [], 'separators with nothing between them yield nothing')
})

test('splitRoles handles a single role', () => {
  const { splitRoles } = transform()
  assert.deepEqual(list(splitRoles('Growth Marketer')), ['Growth Marketer'])
})

test('splitRoles handles exactly three roles', () => {
  const { splitRoles } = transform()
  assert.deepEqual(list(splitRoles('Growth Marketer,Paid Social,CRO Expert')), [
    'Growth Marketer',
    'Paid Social',
    'CRO Expert',
  ])
})

test('splitRoles returns every role past the third — the slot cap lives in unwrap()', () => {
  const { splitRoles } = transform()
  assert.deepEqual(list(splitRoles('One,Two,Three,Four,Five')), ['One', 'Two', 'Three', 'Four', 'Five'])
})

test('splitRoles trims surrounding whitespace and drops empty segments', () => {
  const { splitRoles } = transform()
  assert.deepEqual(list(splitRoles('  Growth Marketer ,, Paid Social  ,  ')), ['Growth Marketer', 'Paid Social'])
  assert.deepEqual(list(splitRoles('\n Brand Strategy \t')), ['Brand Strategy'])
})

test('splitRoles does not split on semicolons (unlike the saved-list sibling)', () => {
  const { splitRoles } = transform()
  assert.deepEqual(list(splitRoles('Growth; Paid Social')), ['Growth; Paid Social'])
})

/* ----------------------------- joinLocation ---------------------------- */

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
  assert.match(mod.warnings[0], /no wf-xano instance reading starters_onboarding\/get_freelancers/)
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
})

test('sourceMatches rejects other endpoints and junk', () => {
  const { sourceMatches } = loadModule().api
  assert.equal(sourceMatches('https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starters_onboarding/get_brands'), false)
  assert.equal(sourceMatches(ENDPOINT + '/extra'), false, 'must END with the path, not merely contain it')
  assert.equal(sourceMatches('get_freelancers'), false, 'the whole suffix is required, not the tail of it')
  assert.equal(sourceMatches(''), false)
  assert.equal(sourceMatches(null), false)
  assert.equal(sourceMatches(undefined), false)
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
  assert.match(mod.warnings[0], /no wf-xano instance reading starters_onboarding\/get_freelancers/)
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

test('?ms= drives every instance, each reloading independently', () => {
  const mod = loadModule({ instances: TWO_FORMS, search: '?ms=mem_bogus' })
  mod.drain()
  const [full, consult] = mod.instanceList
  assert.deepEqual(full.own.params, [['memberstack_id', 'mem_bogus']])
  assert.deepEqual(consult.own.params, [['memberstack_id', 'mem_bogus']])
  assert.deepEqual(full.own.refreshes, [], 'setParam already reloads')
  assert.deepEqual(consult.own.refreshes, [])
})

test('announces the ?ms= preview once, with the instance count', () => {
  const mod = loadModule({ instances: TWO_FORMS, search: '?ms=mem_bogus' })
  mod.drain()
  assert.equal(mod.warnings.length, 1, 'one line, not one per instance')
  assert.match(mod.warnings[0], /previewing member "mem_bogus" from \?ms= \(staging only\) on 2 instance\(s\)/)
  assert.match(mod.warnings[0], /each reloads separately/)
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

/* --------------------- staging-only ?ms= override --------------------- */

const overrideOf = (options) => loadModule(options).api.memberOverride()

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
    // Lookalikes: the unanchored regex the sibling modules use would pass these,
    // which is tolerable for a console.warn and NOT for a data-read capability.
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

test('production never honors ?ms=, whatever the query string says', () => {
  assert.equal(overrideOf({ hostname: 'thestarters.com', search: '?ms=mem_someone_else' }), null)
  assert.equal(overrideOf({ hostname: 'www.thestarters.com', search: '?ms=mem_someone_else' }), null)
})

// The override reads another member's record, so the logging escape hatch must
// not double as an access escape hatch.
test('STARTERS_DEBUG does not unlock the override in production', () => {
  const mod = loadModule({
    hostname: 'thestarters.com',
    search: '?ms=mem_someone_else',
    debug: true,
  })
  assert.equal(mod.api.memberOverride(), null)
  mod.drain()
  assert.deepEqual(mod.params, [], 'no setParam call may reach the instance')
})

test('a staging host with ?ms= returns that member id', () => {
  assert.equal(
    overrideOf({ hostname: 'the-starters-3-0.webflow.io', search: '?ms=mem_cms4ovj4t0dp60tmoe1rn0swl' }),
    'mem_cms4ovj4t0dp60tmoe1rn0swl',
  )
  assert.equal(overrideOf({ hostname: 'localhost', search: '?ms=mem_bogus' }), 'mem_bogus')
  assert.equal(
    overrideOf({ hostname: 'function-robot-chain-bless.trycloudflare.com', search: '?ms=mem_x' }),
    'mem_x',
  )
})

test('a staging host with no ms param returns null', () => {
  assert.equal(overrideOf({ search: '' }), null)
  assert.equal(overrideOf({ search: '?' }), null)
  assert.equal(overrideOf({ search: '?other=1&msx=2' }), null)
})

test('picks ms out of a multi-parameter query, in any position', () => {
  assert.equal(overrideOf({ search: '?a=1&ms=mem_x&b=2' }), 'mem_x')
  assert.equal(overrideOf({ search: '?ms=mem_x&ms=mem_y' }), 'mem_x', 'first wins, like URLSearchParams.get')
})

test('a blank or whitespace-only ms value is treated as absent', () => {
  assert.equal(overrideOf({ search: '?ms=' }), null)
  assert.equal(overrideOf({ search: '?ms' }), null)
  assert.equal(overrideOf({ search: '?ms=%20%20' }), null)
})

test('surrounding whitespace is trimmed off a pasted id', () => {
  assert.equal(overrideOf({ search: '?ms=%20mem_x%20' }), 'mem_x')
})

test('a malformed query string cannot throw out of the override', () => {
  assert.equal(overrideOf({ search: '?%' }), null)
  // URLSearchParams is lenient rather than throwing: a truncated percent escape
  // decodes to U+FFFD and the dangling part is left as written. Whatever comes
  // out is only ever sent back as a query param, so a junk id simply misses and
  // the empty state shows.
  assert.equal(overrideOf({ search: '?ms=%E0%A4%A' }), '�%A')
  assert.equal(overrideOf({ search: '???&&&==' }), null)
})

test('degrades to null when the realm has no URLSearchParams', () => {
  const mod = loadModule({ search: '?ms=mem_x', withUrlSearchParams: false })
  assert.equal(mod.api.memberOverride(), null)
  mod.drain()
  assert.equal(mod.hooks.beforeRender.length, 1, 'the transform must still be registered')
  assert.deepEqual(mod.params, [])
})

test('an override calls setParam and skips the refresh belt (setParam reloads)', () => {
  const mod = loadModule({ search: '?ms=mem_bogus', status: 'success' })
  mod.drain()
  assert.deepEqual(mod.params, [['memberstack_id', 'mem_bogus']])
  assert.deepEqual(mod.refreshes, [], 'setParam already reloads — two GETs for one paint otherwise')
  assert.equal(mod.hooks.beforeRender.length, 1, 'the hook is registered BEFORE the reload is triggered')
})

test('an override announces itself on staging and stays quiet in production', () => {
  const staging = loadModule({ search: '?ms=mem_bogus' })
  staging.drain()
  assert.equal(staging.warnings.length, 1)
  assert.match(staging.warnings[0], /previewing member "mem_bogus" from \?ms=/)

  const prod = loadModule({ hostname: 'thestarters.com', search: '?ms=mem_bogus' })
  prod.drain()
  assert.deepEqual(prod.warnings, [])
})

test('no override leaves the normal settled-state belt intact', () => {
  const mod = loadModule({ search: '?other=1', status: 'success' })
  mod.drain()
  assert.deepEqual(mod.params, [])
  assert.equal(mod.refreshes.length, 1)
})

test('falls back to the belt when the library predates setParam', () => {
  const mod = loadModule({ search: '?ms=mem_bogus', status: 'success', withSetParam: false })
  mod.drain()
  assert.deepEqual(mod.params, [])
  assert.equal(mod.refreshes.length, 1, 'better a correct repaint of the default member than nothing')
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

test('exposes the transform and the override decision for console debugging', () => {
  const mod = loadModule()
  assert.deepEqual(Object.keys(mod.api).sort(), [
    'htmlToText',
    'instanceMatches',
    'joinLocation',
    'memberOverride',
    'sourceMatches',
    'splitRoles',
    'stagingHost',
    'targetInstances',
    'unwrap',
  ])
})
