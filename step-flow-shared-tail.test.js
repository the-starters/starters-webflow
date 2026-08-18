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
 * The cancel-membership shape, trimmed to three branches: an entry gate, branch
 * `step-2a` (two steps) and branch `step-2b` (one step) both targeting a
 * root-level `step-3`, and branch `step-2c` (one step) targeting a SECOND
 * root-level tail `step-3a` — the live page's two-tail topology, where each tail
 * is an alternative endpoint and both submit buttons must be terminal. Step-1's
 * Continue controls carry explicit targets so the fixture never depends on
 * radio state.
 */
function sharedTailFlow() {
  const toA = h('button', { 'data-form-flow-action': 'next', 'data-form-flow-target': 'step-2a' })
  const toB = h('button', { 'data-form-flow-action': 'next', 'data-form-flow-target': 'step-2b' })
  const toC = h('button', { 'data-form-flow-action': 'next', 'data-form-flow-target': 'step-2c' })
  const entry = h('div', { 'data-form-flow-entry': '', 'data-form-flow-element': 'step-1' }, [
    h('div', { 'data-form-flow-element': 'radio-list' }),
    h('div', { 'data-form-flow-button-group': 'step-1' }, [toA, toB, toC]),
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

  const c1 = h('div', { 'data-form-flow-step': '', 'data-form-flow-element': 'step-2c-1' })
  const c1Next = h('button', { 'data-form-flow-action': 'next', 'data-form-flow-target': 'step-3a' })
  const branchC = h('div', { 'data-form-flow-subflow': '', 'data-form-flow-element': 'step-2c' }, [
    c1,
    h('div', { 'data-form-flow-button-group': 'step-2c-1' }, [c1Next]),
  ])

  const tail = h('div', { 'data-form-flow-step': '', 'data-form-flow-element': 'step-3' })
  const tailBack = h('button', { 'data-form-flow-action': 'back' })
  const tailSubmit = h('button', { type: 'submit' })
  const tailGroup = h('div', { 'data-form-flow-button-group': 'step-3' }, [tailBack, tailSubmit])

  const tail2 = h('div', { 'data-form-flow-step': '', 'data-form-flow-element': 'step-3a' })
  const tail2Back = h('button', { 'data-form-flow-action': 'back' })
  const tail2Submit = h('button', { type: 'submit' })
  const tail2Group = h('div', { 'data-form-flow-button-group': 'step-3a' }, [tail2Back, tail2Submit])

  const flow = h(
    'div',
    { 'data-form-flow': 'cancel-membership', 'data-form-flow-type': 'multi-sub' },
    [entry, branchA, branchB, branchC, tail, tailGroup, tail2, tail2Group]
  )

  return {
    flow, entry, branchA, branchB, branchC, tail, tailGroup, tail2, tail2Group,
    a1, a2, b1, c1,
    toA, toB, toC, a1Next, a1Back, a2Next, a2Back, b1Next, c1Next,
    tailBack, tailSubmit, tail2Back, tail2Submit,
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

// ---------------------------------------------------------------------------
// 5. Two root tails — each is an alternative endpoint, never a sequence, so a
// second tail later in the DOM must not read as "next" from the first one.
// ---------------------------------------------------------------------------

test('with a second tail after it in the DOM, the first tail submit is still terminal', () => {
  const { f, harness, click } = start()
  click(f.toA)
  click(f.a1Next)
  click(f.a2Next)
  const event = click(f.tailSubmit)

  assert.equal(event.defaultPrevented, false, 'native submit is not blocked')
  assert.equal(visible(f.tail), true, 'the flow did not navigate away from step-3')
  assert.equal(visible(f.tail2), false, 'and step-3a was not treated as the next step')
  assert.deepEqual(harness.warnings, [])
})

test('the second tail submit is terminal too', () => {
  const { f, harness, click } = start()
  click(f.toC)
  click(f.c1Next)

  assert.equal(visible(f.tail2), true, 'branch C funnels into step-3a')
  assert.equal(visible(f.tail), false, 'step-3 stays hidden')

  const event = click(f.tail2Submit)
  assert.equal(event.defaultPrevented, false, 'native submit is not blocked')
  assert.equal(visible(f.tail2), true, 'the flow did not navigate away from step-3a')
  assert.deepEqual(harness.warnings, [])
})

test('with two tails present, plain next inside a branch still chains branch steps', () => {
  const { f, click } = start()
  click(f.toA)
  const event = click(f.a1Next)

  assert.equal(event.defaultPrevented, true, 'the flow handled the click')
  assert.equal(visible(f.a2), true, 'advanced within the branch')
  assert.equal(visible(f.tail), false)
  assert.equal(visible(f.tail2), false)
})

// ---------------------------------------------------------------------------
// 6. Linear flows are untouched — root-level steps chaining in DOM order is
// their core mechanism, so the multi-sub tail gate must not apply to them.
// ---------------------------------------------------------------------------

/** A plain two-step linear flow whose Continue buttons are real submit buttons. */
function linearFlow() {
  const s1 = h('div', { 'data-form-flow-step': '', 'data-form-flow-element': 'step-1' })
  const s2 = h('div', { 'data-form-flow-step': '', 'data-form-flow-element': 'step-2' })
  const s1Submit = h('button', { type: 'submit' })
  const s2Submit = h('button', { type: 'submit' })
  const flow = h('div', { 'data-form-flow': 'linear-demo' }, [
    s1,
    s2,
    h('div', { 'data-form-flow-button-group': 'step-1' }, [s1Submit]),
    h('div', { 'data-form-flow-button-group': 'step-2' }, [s2Submit]),
  ])
  return { flow, s1, s2, s1Submit, s2Submit }
}

test('linear flow: root-level steps still chain with next', () => {
  const f = linearFlow()
  const harness = mount(h('body', {}, [f.flow]))

  assert.equal(visible(f.s1), true)
  const event = harness.fire(f.flow, 'click', f.s1Submit)

  assert.equal(event.defaultPrevented, true, 'a mid-flow submit is intercepted')
  assert.equal(visible(f.s2), true, 'and advances to the next root step')
  assert.equal(visible(f.s1), false)
  assert.deepEqual(harness.warnings, [])
})

test('linear flow: the last step submit stays terminal', () => {
  const f = linearFlow()
  const harness = mount(h('body', {}, [f.flow]))
  harness.fire(f.flow, 'click', f.s1Submit)
  const event = harness.fire(f.flow, 'click', f.s2Submit)

  assert.equal(event.defaultPrevented, false, 'native submit falls through')
  assert.equal(visible(f.s2), true)
})

test('visible-step owners restore required state before destination validation repaints', () => {
  const projectInfo = h('div', { 'data-form-flow-step': '', 'data-form-flow-element': 'step-1' })
  const feeStructure = h('select', { 'data-project-required-hidden': 'true' })
  feeStructure.value = ''
  feeStructure.required = false
  const payment = h('div', { 'data-form-flow-step': '', 'data-form-flow-element': 'step-2' }, [feeStructure])
  const projectInfoNext = h('button', { 'data-form-flow-action': 'next' })
  const paymentNext = h('button', { 'data-form-flow-action': 'next' })
  const paymentContinue = h('div', { class: 'button_main-wrap', 'data-button-theme': 'primary' }, [paymentNext])
  const flow = h('div', { 'data-form-flow': 'generate-contract', 'data-form-flow-validate': 'true' }, [
    projectInfo,
    payment,
    h('div', { 'data-form-flow-button-group': 'step-1' }, [projectInfoNext]),
    h('div', { 'data-form-flow-button-group': 'step-2' }, [paymentContinue]),
  ])
  const harness = mount(h('body', {}, [flow]))
  const observed = []
  harness.window.addEventListener('starters:form-flow-step-visible', (event) => {
    if (event.detail.flow !== flow || event.detail.step !== payment) return
    observed.push(payment.style.display)
    feeStructure.required = true
    feeStructure.setAttribute('required', '')
    feeStructure.removeAttribute('data-project-required-hidden')
  })

  harness.fire(flow, 'click', projectInfoNext)

  assert.deepEqual(observed, ['block'], 'field owner runs only after Payment is visible')
  assert.equal(feeStructure.required, true)
  assert.equal(paymentContinue.getAttribute('data-button-theme'), 'disabled')
  assert.equal(paymentContinue.getAttribute('aria-disabled'), 'true')
  assert.equal(paymentNext.getAttribute('aria-disabled'), 'true')
})
