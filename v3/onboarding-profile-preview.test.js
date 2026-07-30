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
  hasWrapper = true,
  withInstance = true,
  // Instance state seen at arm() time: 'loading' is the normal case (the fetch
  // wf-xano started in init() is still in flight); 'success'/'error' mean a
  // render already happened without the transform.
  status = 'loading',
  withGetState = true,
  withRefresh = true,
  debug,
  readyState = 'interactive',
  // 'array'  = wf-xano has not loaded yet; window.WfXano is the pre-load queue.
  // 'object' = wf-xano's module scope has run (window.WfXano is the API object)
  //            but boot() has NOT created instances yet, so get() returns null.
  wfXano = 'array',
} = {}) {
  const warnings = []
  const hooks = {}
  const refreshes = []
  const selectors = []
  const domListeners = {}

  const instance = {
    key: 'onboarding-self-preview',
    on(event, handler) {
      ;(hooks[event] = hooks[event] || []).push(handler)
      return this
    },
  }
  if (withGetState) instance.getState = () => ({ status })
  if (withRefresh) instance.refresh = () => refreshes.push(true)

  let booted = false
  const queue = []
  const api = {
    get(key) {
      // Real wf-xano creates instances inside boot(); before that the list is
      // empty and get() resolves to null for every key.
      if (wfXano === 'object' && !booted) return null
      if (!withInstance) return null
      return key === 'onboarding-self-preview' ? instance : null
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
      info: () => {},
      log: () => {},
    },
    location: { hostname },
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
  sandbox.window = sandbox
  sandbox.window.WfXano = wfXano === 'object' ? api : queue
  if (debug !== undefined) sandbox.window.STARTERS_DEBUG = debug

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)

  return {
    warnings,
    hooks,
    refreshes,
    selectors,
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
  assert.match(mod.warnings[0], /no wf-xano instance "onboarding-self-preview"/)
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

/* -------------------------------- boot -------------------------------- */

test('marker gate: does not touch WfXano on a page without the wrapper', () => {
  const mod = loadModule({ hasWrapper: false })
  assert.deepEqual(mod.queue, [])
  assert.deepEqual(mod.selectors, ['[wf-xano-instance="onboarding-self-preview"]'])
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

test('exposes the transform for console debugging', () => {
  const mod = loadModule()
  assert.deepEqual(Object.keys(mod.api).sort(), ['htmlToText', 'joinLocation', 'splitRoles', 'unwrap'])
})
