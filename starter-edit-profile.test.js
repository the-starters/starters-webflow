const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync(
  require.resolve('./starter-edit-profile.js'),
  'utf8',
)

function run() {
  new vm.Script(source, { filename: 'starter-edit-profile.js' })

  const start = source.indexOf('async function submitStep(')
  const end = source.indexOf('\n\t\tfunction getStepPayload(', start)
  assert.notEqual(start, -1, 'submitStep must exist')
  assert.notEqual(end, -1, 'submitStep boundary must exist')

  const submitStep = source.slice(start, end)
  const catchIndex = submitStep.lastIndexOf('} catch (error) {')
  const finallyIndex = submitStep.lastIndexOf('} finally {')
  const successIndex = submitStep.indexOf(
    "openSuccessModal?.dispatchEvent(new Event('click', { bubbles: true }));",
  )

  assert.match(
    submitStep,
    /if \(!response\.ok\) \{[\s\S]*throw new Error\(/,
    'non-2xx responses must throw',
  )
  assert.ok(successIndex > -1 && successIndex < catchIndex)
  assert.ok(catchIndex > -1 && catchIndex < finallyIndex)
  assert.doesNotMatch(
    submitStep.slice(finallyIndex),
    /openSuccessModal\?\.dispatchEvent/,
    'finally must not show a success state',
  )
  assert.match(
    submitStep.slice(catchIndex, finallyIndex),
    /openErrorModal\?\.dispatchEvent/,
    'failures must show the error state',
  )

  console.log('starter-edit-profile tests passed')
}

run()
