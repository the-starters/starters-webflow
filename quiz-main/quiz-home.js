/**
 * Home page controllers.
 *
 * Saves selected checkbox category IDs to sessionStorage, then redirects the
 * user to the quiz page. Read by quiz-main.js (restoreCategoriesFromStorage)
 * on /quiz to pre-fill the matching categories.
 *
 * The same Home-only asset also replaces the consult rail's legacy Webflow
 * `also-worked-with` list with the profile's Algolia `work-history` company
 * names. The rail's CMS image filename carries the stable Xano/Algolia ID.
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
    const homeConsultSectionSelector = '.section_home-consult'
    const homeConsultCardSelector =
        '.section_home-consult .expert-card_item.is-consult-home'
    const homeConsultCompanyListSelector = '.expert-card_company-list'
    const homeConsultProfileImageSelector = '.expert-card_profile-image'
    const algoliaClientSelector = 'script[data-starters-v3-algolia-client]'
    const startersResourceSelector =
        '[data-starters-v3-algolia-resource="starters"][wf-algolia-index]'
    const workHistoryField = 'work-history'
    const starterReplicaSuffix =
        /__(?:name-AtoZ|rate_asc|rate_desc|published_asc|published_desc)$/

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

    /**
     * Returns ordered company names from an Algolia work-history value.
     * Invalid and blank entries are omitted without falling back to the legacy
     * also-worked-with projection.
     *
     * @param {unknown} value Algolia `work-history` value.
     * @returns {string[]} Ordered company names.
     */
    function getWorkHistoryCompanies(value) {
        if (!Array.isArray(value)) return []

        return value
            .map((entry) =>
                entry && typeof entry === 'object'
                    ? String(entry.company || '').trim()
                    : '',
            )
            .filter(Boolean)
    }

    /**
     * Reads a card's stable Xano/Algolia profile ID. A canonical data attribute
     * wins when present; the current Webflow CMS rail exposes the same ID in
     * the profile image filename (`freelancer-593.avif`).
     *
     * @param {Element} card Home consult card.
     * @returns {string} Stable profile ID, or an empty string.
     */
    function getHomeConsultProfileId(card) {
        const attributeId = [
            'data-starter-id',
            'data-xano-id',
            'data-wf-xano-id',
        ]
            .map((name) => String(card.getAttribute(name) || '').trim())
            .find(Boolean)
        if (attributeId) return attributeId

        const image = card.querySelector(homeConsultProfileImageSelector)
        const source = String(image?.getAttribute('src') || '')
        const match = source.match(/(?:^|[_/-])freelancer-(\d+)(?:\.|[_/?#-]|$)/i)
        return match ? match[1] : ''
    }

    /**
     * Resolves the environment-managed public Algolia settings. The official
     * environment controller is preferred; DOM attributes are its documented
     * runtime output and keep this adapter compatible if the controller object
     * is not retained after boot.
     *
     * @returns {{appId: string, searchKey: string, indexName: string}|null}
     */
    function getHomeConsultAlgoliaConfig() {
        const environmentApi = window.StartersV3AlgoliaEnvironment
        const managed = environmentApi?.getManagedSearchConfig?.('starters')
        if (managed?.appId && managed?.searchKey && managed?.indexName) {
            return {
                appId: managed.appId,
                searchKey: managed.searchKey,
                indexName: managed.indexName.replace(starterReplicaSuffix, ''),
            }
        }

        const client = document.querySelector(algoliaClientSelector)
        const resource = document.querySelector(startersResourceSelector)
        const appId = String(client?.getAttribute('data-app-id') || '').trim()
        const searchKey = String(
            client?.getAttribute('data-search-key') || '',
        ).trim()
        const indexName = String(
            resource?.getAttribute('wf-algolia-index') || '',
        )
            .trim()
            .replace(starterReplicaSuffix, '')

        if (!appId || !searchKey || !indexName) return null
        return { appId, searchKey, indexName }
    }

    /**
     * Replaces a single legacy company list with ordered work-history names.
     * Text-only rendering avoids treating CMS or search values as markup.
     *
     * @param {Element} list Company-list element.
     * @param {string[]} companies Ordered company names.
     * @param {'ready'|'empty'} status Final render status.
     * @returns {void}
     */
    function renderHomeConsultCompanies(list, companies, status) {
        list.textContent = companies.join(', ')
        list.setAttribute('data-home-work-history-status', status)
    }

    /**
     * Hydrates the Home consult rail from canonical Algolia work-history.
     * Legacy CMS text is cleared before the request, so a failed request never
     * leaves a stale also-worked-with list presented as work history.
     *
     * @returns {Promise<void>}
     */
    async function homeConsultWorkHistoryController() {
        const section = document.querySelector(homeConsultSectionSelector)
        if (!section) return

        const cards = Array.from(
            document.querySelectorAll(homeConsultCardSelector),
        )
            .map((card) => ({
                card,
                id: getHomeConsultProfileId(card),
                list: card.querySelector(homeConsultCompanyListSelector),
            }))
            .filter((entry) => entry.list)
        if (!cards.length) return

        cards.forEach(({ id, list }) => {
            list.textContent = ''
            list.setAttribute(
                'data-home-work-history-status',
                id ? 'loading' : 'missing-id',
            )
        })

        const requestedCards = cards.filter((entry) => entry.id)
        const config = getHomeConsultAlgoliaConfig()
        if (!requestedCards.length || !config) {
            section.setAttribute(
                'data-home-work-history-status',
                config ? 'missing-id' : 'missing-config',
            )
            return
        }

        const endpoint = `https://${config.appId.toLowerCase()}-dsn.algolia.net/1/indexes/*/objects`
        const requests = requestedCards.map(({ id }) => ({
            indexName: config.indexName,
            objectID: id,
            attributesToRetrieve: [workHistoryField],
        }))

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Algolia-Application-Id': config.appId,
                    'X-Algolia-API-Key': config.searchKey,
                },
                body: JSON.stringify({ requests }),
            })
            if (!response.ok) {
                throw new Error(`Algolia work-history request failed (${response.status})`)
            }

            const payload = await response.json()
            const results = Array.isArray(payload?.results) ? payload.results : []
            requestedCards.forEach(({ list }, index) => {
                const companies = getWorkHistoryCompanies(
                    results[index]?.[workHistoryField],
                )
                renderHomeConsultCompanies(
                    list,
                    companies,
                    companies.length ? 'ready' : 'empty',
                )
            })
            section.setAttribute('data-home-work-history-status', 'ready')
        } catch (error) {
            requestedCards.forEach(({ list }) => {
                list.setAttribute('data-home-work-history-status', 'error')
            })
            section.setAttribute('data-home-work-history-status', 'error')
            console.warn('[Home Consult]', 'work-history hydration failed', error)
        } finally {
            window.dispatchEvent(new CustomEvent('expert-cards:relayout'))
        }
    }

    function startHomeControllers() {
        starterQuizHomeController()
        void homeConsultWorkHistoryController()
    }

    // Runs as a deferred external script: execute now if the DOM is already
    // parsed, otherwise wait for DOMContentLoaded.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startHomeControllers)
    } else {
        startHomeControllers()
    }
})()
