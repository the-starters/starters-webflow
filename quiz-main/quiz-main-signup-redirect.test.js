const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./quiz-main.js'), 'utf8')

// quiz-main.js is a 1300-line DOM controller behind a DOMContentLoaded guard, so
// this file does what quiz-member-json-fallback.test.js does with quiz-results.js:
// slice out the one function under test and run it against a form double.
// Everything else about the controller is out of scope here.
function sliceSource(startText, endText) {
    const start = source.indexOf(startText)
    const end = source.indexOf(endText, start)

    assert.notEqual(start, -1, `missing source start: ${startText}`)
    assert.notEqual(end, -1, `missing source end: ${endText}`)

    return source.slice(start, end)
}

function getConfigureSignupRedirect() {
    const functionSource = sliceSource(
        'function configureSignupRedirect(form, redirectPath)',
        '\n    categoryInputs.forEach(',
    )

    return vm.runInNewContext(`${functionSource}\nconfigureSignupRedirect`, {})
}

/**
 * Minimal form double: just the attribute bag Memberstack reads.
 *
 * @param {Record<string, string>} [attributes] Attributes authored in Webflow.
 */
function formDouble(attributes = {}) {
    const bag = { ...attributes }

    return {
        attributes: bag,
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(bag, name)
                ? bag[name]
                : null
        },
        setAttribute(name, value) {
            bag[name] = value
        },
    }
}

// The bug this covers: Memberstack honours `data-ms-redirect` only through a
// click listener, so an Enter-key signup lost /quiz-results and fell back to the
// plan redirect (/quiz, at step 1, because the `starter-quiz` custom field is not
// written until /quiz-results runs). Its signup submit handler reads the bare
// `redirect` attribute off the form instead. Same defect class as the login forms
// fixed in v3/auth-route.js configureLoginForms().
test('the signup form ends up with both redirect attributes', () => {
    const configureSignupRedirect = getConfigureSignupRedirect()
    // The published /quiz form carries data-ms-redirect and no bare redirect.
    const form = formDouble({ 'data-ms-redirect': '/quiz-results' })

    configureSignupRedirect(form, '/quiz-results')

    assert.equal(form.getAttribute('redirect'), '/quiz-results')
    assert.equal(form.getAttribute('data-ms-redirect'), '/quiz-results')
})

test('a Designer-authored data-ms-redirect is never overwritten', () => {
    const configureSignupRedirect = getConfigureSignupRedirect()
    const form = formDouble({ 'data-ms-redirect': '/quiz-results?variant=b' })

    configureSignupRedirect(form, '/quiz-results')

    assert.equal(form.getAttribute('data-ms-redirect'), '/quiz-results?variant=b')
    assert.equal(form.getAttribute('redirect'), '/quiz-results')
})

test('a missing data-ms-redirect is filled in so the provider flows still work', () => {
    const configureSignupRedirect = getConfigureSignupRedirect()
    const form = formDouble()

    configureSignupRedirect(form, '/quiz-results')

    assert.equal(form.getAttribute('redirect'), '/quiz-results')
    assert.equal(form.getAttribute('data-ms-redirect'), '/quiz-results')
})

test('a page with no signup form is a no-op', () => {
    const configureSignupRedirect = getConfigureSignupRedirect()

    assert.doesNotThrow(() => configureSignupRedirect(null, '/quiz-results'))
})

test('the controller applies it to the signup form using the results path', () => {
    // The slice above proves the function; this proves it is actually wired to
    // [data-quiz-form="signup"] and to the one path constant the logged-in
    // retake redirect already uses, instead of a second literal.
    assert.match(source, /const resultsRedirectPath = '\/quiz-results'/)
    assert.match(
        source,
        /configureSignupRedirect\(signupForm, resultsRedirectPath\)/,
    )
    assert.match(
        source,
        /const signupForm = document\.querySelector\(\s*'\[data-quiz-form="signup"\]'\s*\)/,
    )
})

test('the header carries the current release marker', () => {
    // No window API on this controller, so the header marker is its only version
    // signal. Bump the literal in the same commit that bumps the marker.
    const marker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
    assert.ok(marker, 'no "@release vX.Y.Z" line in the quiz-main.js header')
    assert.equal(marker[1], 'v1.59.83')
})
