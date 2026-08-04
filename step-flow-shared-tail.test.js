const assert = require('node:assert/strict')
const test = require('node:test')

const { h, mount } = require('./step-flow-test-dom')

// ---------------------------------------------------------------------------
// Shared tail steps: a multi-sub flow where every branch funnels into one final
// step that lives outside all the subflow wrappers (review + submit), instead of
// that step being duplicated inside each branch.
// ---------------------------------------------------------------------------

const visible = (el) => el.style.display !== 'none'

/**
 * The cancel-membership shape, trimmed to two branches: an entry gate, branch
 * `step-2a` (two steps), branch `step-2b` (one step), and a root-level `step-3`
 * both branches target. Step-1's Continue controls carry explicit targets so the
 * fixture never depends on radio state.
 */
function sharedTailFlow() {
  const toA = h('button', { 'data-form-flow-action': 'next', 'data-form-flow-target': 'step-2a' })
  const toB = h('button', { 'data-form-flow-action': 'next', 'data-form-flow-target': 'step-2b' })
  const entry = h('div', { 'data-form-flow-entry': '', 'data-form-flow-element': 'step-1' }, [
    h('div', { 'data-form-flow-element': 'radio-list' }),
    h('div', { 'data-form-flow-button-group': 'step-1' }, [toA, toB]),
  ])

  const a1 = h('div', { 'data-form-flow-step': '', 'data-form-flow-element': 'step-2a-1' })
  const a2 = h('div', { 'data-form-flow-step': '', 'data-form-flow-element': 'step-2a-2' })
  const a1Next = h('button', { 'data-form-flow-action': 'next' })
  const a1Back = h('button', { 'data-form-flow-action': 'back' })
  const a2Next = h('button', { 'data-form-flow-action': 'next', 'data-form-flow-target': 'step-3' })
  const a2Back = h('button', { 'data-form-flow-action': 'back' })
  const branchA = h('div', { 'data-form-flow-subflow': '', 'data-form-flow-element': 'step-2a' }, [
    a1,
    a2,
    h('div', { 'data-form-flow-button-group': 'step-2a-1' }, [a1Next, a1Back]),
    h('div', { 'data-form-flow-button-group': 'step-2a-2' }, [a2Next, a2Back]),
  ])

  const b1 = h('div', { 'data-form-flow-step': '', 'data-form-flow-element': 'step-2b-1' })
  const b1Next = h('button', { 'data-form-flow-action': 'next', 'data-form-flow-target': 'step-3' })
  const branchB = h('div', { 'data-form-flow-subflow': '', 'data-form-flow-element': 'step-2b' }, [
    b1,
    h('div', { 'data-form-flow-button-group': 'step-2b-1' }, [b1Next]),
  ])

  const tail = h('div', { 'data-form-flow-step': '', 'data-form-flow-element': 'step-3' })
  const tailBack = h('button', { 'data-form-flow-action': 'back' })
  const tailSubmit = h('button', { type: 'submit' })
  const tailGroup = h('div', { 'data-form-flow-button-group': 'step-3' }, [tailBack, tailSubmit])

  const flow = h(
    'div',
    { 'data-form-flow': 'cancel-membership', 'data-form-flow-type': 'multi-sub' },
    [entry, branchA, branchB, tail, tailGroup]
  )

  return {
    flow, entry, branchA, branchB, tail, tailGroup,
    a1, a2, b1,
    toA, toB, a1Next, a1Back, a2Next, a2Back, b1Next, tailBack, tailSubmit,
  }
}

const start = () => {
  const f = sharedTailFlow()
  const harness = mount(h('body', {}, [f.flow]))
  return { f, harness, click: (el) => harness.fire(f.flow, 'click', el) }
}

// ---------------------------------------------------------------------------
// 1. Baseline
// ---------------------------------------------------------------------------

test('init: the entry gate shows, both branches and the tail stay hidden', () => {
  const { f } = start()
  assert.equal(visible(f.entry), true)
  assert.equal(visible(f.branchA), false)
  assert.equal(visible(f.branchB), false)
  assert.equal(visible(f.tail), false)
})

test('entering a branch shows only that branch', () => {
  const { f, click } = start()
  click(f.toA)
  assert.equal(visible(f.branchA), true)
  assert.equal(visible(f.a1), true)
  assert.equal(visible(f.branchB), false)
  assert.equal(visible(f.entry), false)
  assert.equal(visible(f.tail), false)
})

// ---------------------------------------------------------------------------
// 2. Forward into the shared tail
// ---------------------------------------------------------------------------

test('a target outside the branch lands on the root-level tail step', () => {
  const { f, harness, click } = start()
  click(f.toA)
  click(f.a1Next)
  click(f.a2Next)

  assert.equal(visible(f.tail), true, 'tail step is showing')
  assert.equal(visible(f.tailGroup), true, 'tail button group is showing')
  assert.equal(visible(f.branchA), false, 'the branch wrapper is left behind')
  assert.equal(visible(f.a2), false)
  assert.deepEqual(harness.warnings, [])
})

test('the same tail is reachable from a second branch', () => {
  const { f, harness, click } = start()
  click(f.toB)
  click(f.b1Next)

  assert.equal(visible(f.tail), true)
  assert.equal(visible(f.branchB), false)
  assert.equal(visible(f.branchA), false)
  assert.deepEqual(harness.warnings, [])
})

test('a plain next inside a branch still walks that branch, not the tail', () => {
  const { f, click } = start()
  click(f.toA)
  click(f.a1Next)

  assert.equal(visible(f.a2), true, 'advanced within the branch')
  assert.equal(visible(f.branchA), true)
  assert.equal(visible(f.tail), false, 'the root-level tail is not in branch scope')
})

// ---------------------------------------------------------------------------
// 3. Back out of the tail — history stores the wrapper, so the branch returns
// ---------------------------------------------------------------------------

test('back from the tail restores the branch the user came from', () => {
  const { f, harness, click } = start()
  click(f.toA)
  click(f.a1Next)
  click(f.a2Next)
  click(f.tailBack)

  assert.equal(visible(f.a2), true, 'back on the branch step it came from')
  assert.equal(visible(f.branchA), true, 'branch wrapper is visible again')
  assert.equal(visible(f.tail), false)
  assert.deepEqual(harness.warnings, [])
})

test('back from the tail restores the other branch just as well', () => {
  const { f, click } = start()
  click(f.toB)
  click(f.b1Next)
  click(f.tailBack)

  assert.equal(visible(f.b1), true)
  assert.equal(visible(f.branchB), true)
  assert.equal(visible(f.branchA), false, 'the branch not taken stays hidden')
  assert.equal(visible(f.tail), false)
})

test('back all the way out of the tail reaches the entry gate', () => {
  const { f, click } = start()
  click(f.toA)
  click(f.a1Next)
  click(f.a2Next)

  click(f.tailBack) // tail -> step-2a-2
  click(f.a2Back) //   step-2a-2 -> step-2a-1
  click(f.a1Back) //   step-2a-1 -> step-1

  assert.equal(visible(f.entry), true, 'entry gate is back')
  assert.equal(visible(f.branchA), false, 'branch wrapper is cleared')
  assert.equal(visible(f.tail), false)
})

test('forward again after backing out re-enters the tail', () => {
  const { f, click } = start()
  click(f.toA)
  click(f.a1Next)
  click(f.a2Next)
  click(f.tailBack)
  click(f.a2Next)

  assert.equal(visible(f.tail), true)
  assert.equal(visible(f.branchA), false)
})

// ---------------------------------------------------------------------------
// 4. Guards
// ---------------------------------------------------------------------------

test('a target that exists nowhere still warns instead of silently moving', () => {
  const f = sharedTailFlow()
  f.b1Next.setAttribute('data-form-flow-target', 'step-nope')
  const harness = mount(h('body', {}, [f.flow]))
  harness.fire(f.flow, 'click', f.toB)
  harness.fire(f.flow, 'click', f.b1Next)

  assert.equal(visible(f.tail), false)
  assert.equal(
    harness.warnings.some((line) => /Could not find content step/.test(line)),
    true
  )
})

test('the tail submit button is terminal: the click falls through to Webflow', () => {
  const { f, click } = start()
  click(f.toB)
  click(f.b1Next)
  const event = click(f.tailSubmit)

  assert.equal(event.defaultPrevented, false, 'native submit is not blocked')
  assert.equal(visible(f.tail), true, 'and the flow did not navigate away')
})
