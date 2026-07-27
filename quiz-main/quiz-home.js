/**
 * Home quiz category selection.
 *
 * Saves selected checkbox category IDs to sessionStorage, then redirects the
 * user to the quiz page. Read by quiz-main.js (restoreCategoriesFromStorage)
 * on /quiz to pre-fill the matching categories.
 *
 * Load once from the home page via a thin jsDelivr loader:
 *   <script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/quiz-main/quiz-home.js"></script>
 *
 * Debug logging is OFF by default; opt in per session with ?starterQuizDebug=true
 * (or starterQuizDebug in session/localStorage). Set starterQuizHomeDebugEnabled
 * to false to hard-disable this file's logs.
 */
;(() => {
    const starterQuizHomeControllerFlag = 'starterQuizHomeController'
    const starterQuizHomeDebugEnabled = true
    const debugStorageKey = 'starterQuizDebug'

    /**
     * Checks whether starter quiz debug logging is enabled.
     *
     * @returns {boolean} True when flow logs should be printed.
     */
    function isDebugLoggingEnabled() {
        if (!starterQuizHomeDebugEnabled) return false

        const debugParam = new URLSearchParams(window.location.search).get(
            debugStorageKey,
        )
        const normalizedDebugParam = (debugParam || '').toLowerCase()

        if (['1', 'true', 'yes'].includes(normalizedDebugParam)) {
            sessionStorage.setItem(debugStorageKey, 'true')
            return true
        }

        if (['0', 'false', 'no'].includes(normalizedDebugParam)) {
            sessionStorage.removeItem(debugStorageKey)
            return false
        }

        return (
            sessionStorage.getItem(debugStorageKey) === 'true' ||
            localStorage.getItem(debugStorageKey) === 'true'
        )
    }

    if (window[starterQuizHomeControllerFlag]) {
        if (isDebugLoggingEnabled()) {
            console.log('[Starter Quiz Funnel]', '[home]', 'duplicate script skipped', {
                scriptFlag: starterQuizHomeControllerFlag,
            })
        }
        return
    }

    window[starterQuizHomeControllerFlag] = true

    const debugLogPrefix = '[Starter Quiz Funnel]'

    /**
     * Prints a namespaced debug log for the starter quiz funnel.
     *
     * @param {string} message Short event description.
     * @param {unknown} [data] Optional event payload.
     * @returns {void}
     */
    function logQuizFlow(message, data) {
        if (!isDebugLoggingEnabled()) return

        if (typeof data === 'undefined') {
            console.log(debugLogPrefix, '[home]', message)
            return
        }

        console.log(debugLogPrefix, '[home]', message, data)
    }

    /**
     * Wires the home hero quiz form: persists the selected category IDs and
     * redirects to the quiz page on submit.
     *
     * @returns {void}
     */
    function starterQuizHomeController() {
        const form = document.querySelector('[data-quiz-form="home"]')
        if (!form) {
            logQuizFlow('form not found; script stopped')
            return
        }

        const storageKey = 'quizSelectedCategories'
        const redirectUrl = '/quiz'

        const checkboxes = Array.from(
            form.querySelectorAll('input[type="checkbox"]'),
        )
        const button = form.querySelector('button')

        logQuizFlow('initialized', {
            checkboxCount: checkboxes.length,
            hasSubmitButton: Boolean(button),
            redirectUrl,
            storageKey,
        })

        /**
         * Gets the IDs of all selected quiz category checkboxes.
         *
         * @returns {string[]} Selected category IDs.
         */
        function getSelectedCategories() {
            return checkboxes
                .filter((input) => input.checked)
                .map((input) => input.id)
                .filter(Boolean)
        }

        /**
         * Saves selected quiz category IDs to sessionStorage.
         *
         * @returns {void}
         */
        function saveSelectedCategories() {
            const selectedCategories = getSelectedCategories()

            sessionStorage.setItem(storageKey, JSON.stringify(selectedCategories))

            logQuizFlow('saved selected homepage categories', {
                selectedCategories,
                storageKey,
            })
        }

        function saveAndRedirect(event) {
            event.preventDefault()

            saveSelectedCategories()
            logQuizFlow('redirecting to quiz page', { redirectUrl })
            window.location.href = redirectUrl
        }

        checkboxes.forEach((input) => {
            input.addEventListener('change', function () {
                logQuizFlow('homepage category changed', {
                    categoryId: input.id,
                    checked: input.checked,
                })

                saveSelectedCategories()
            })
        })

        button?.addEventListener('click', saveAndRedirect)
        form.addEventListener('submit', saveAndRedirect)
    }

    // Runs as a deferred external script: execute now if the DOM is already
    // parsed, otherwise wait for DOMContentLoaded.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', starterQuizHomeController)
    } else {
        starterQuizHomeController()
    }
})()
