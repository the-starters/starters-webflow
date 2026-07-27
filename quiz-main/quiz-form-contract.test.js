const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const quizDirectory = __dirname
const readQuizFile = (name) =>
    fs.readFileSync(path.join(quizDirectory, name), 'utf8')

test('quiz scripts use stable form-role attributes instead of Webflow form IDs or names', () => {
    const sources = [
        'quiz-home.js',
        'quiz-main.js',
        'quiz-tabs.js',
        'quiz-tabs-toggler.js',
    ].map(readQuizFile)
    const combinedSource = sources.join('\n')

    for (const role of ['home', 'categories', 'subcategories', 'signup']) {
        assert.match(combinedSource, new RegExp(`data-quiz-form=["']${role}["']`))
    }

    assert.doesNotMatch(
        combinedSource,
        /#(?:wf-form-(?:home-quiz|Categories|Subcategories)|Signup-Form)/,
    )
    assert.doesNotMatch(
        combinedSource,
        /\[data-name=["'](?:Categories|Subcategories)["']\]/,
    )
})
