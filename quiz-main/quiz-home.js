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
 * Load once from the home page via a thin jsDelivr loader, after the deferred
 * v3/algolia-environment.js tag — that resolver is the only source of the
 * managed Starter index, so an earlier tag fails closed and renders no
 * companies at all:
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
    const homeConsultCompanyTextClass =
        'expert-card_company-text text-size-small'
    const workHistoryField = 'work-history'

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
     * Returns ordered company names from an Algolia work-history value, using
     * the same rules as quiz-results.js: index order is preserved, entries
     * whose `company` is not a string are dropped rather than coerced, and
     * repeat stints at one company collapse to the first spelling, matched
     * case-insensitively. Invalid and blank entries are omitted without
     * falling back to the legacy also-worked-with projection.
     *
     * @param {unknown} value Algolia `work-history` value.
     * @returns {string[]} Ordered company names, deduplicated.
     */
    function getWorkHistoryCompanies(value) {
        if (!Array.isArray(value)) return []

        const seenCompanies = new Set()

        return value.reduce((companies, entry) => {
            if (typeof entry?.company !== 'string') return companies

            const company = entry.company.trim()
            if (!company) return companies

            const companyKey = company.toLowerCase()
            if (seenCompanies.has(companyKey)) return companies

            seenCompanies.add(companyKey)
            companies.push(company)

            return companies
        }, [])
    }

    /**
     * Reads a card's stable Xano/Algolia profile ID. The Webflow CMS rail
     * carries no ID attribute, so the ID comes from the profile image
     * filename (`freelancer-593.avif`) the CMS already publishes.
     *
     * @param {Element} card Home consult card.
     * @returns {string} Stable profile ID, or an empty string.
     */
    function getHomeConsultProfileId(card) {
        const image = card.querySelector(homeConsultProfileImageSelector)
        const source = String(image?.getAttribute('src') || '')
        const match = source.match(/(?:^|[_/-])freelancer-(\d+)(?:\.|[_/?#-]|$)/i)
        return match ? match[1] : ''
    }

    /**
     * Resolves the environment-managed public Algolia settings. The managed
     * host resolution in v3/algolia-environment.js is the only authority, so
     * this asset must load after it; an unresolved environment fails closed.
     *
     * @returns {{appId: string, searchKey: string, indexName: string}|null}
     */
    function getHomeConsultAlgoliaConfig() {
        const environmentApi = window.StartersV3AlgoliaEnvironment
        const managed = environmentApi?.getManagedSearchConfig?.('starters')
        if (!managed?.appId || !managed?.searchKey || !managed?.indexName) {
            return null
        }

        return {
            appId: managed.appId,
            searchKey: managed.searchKey,
            indexName: managed.indexName,
        }
    }

    /**
     * Replaces a single legacy company list with ordered work-history names.
     * One paragraph per company is the shape the shared expert-card stylesheet
     * styles, so each name keeps its `.text-size-small` sizing, stays an
     * unbreakable inline unit, and gets its separating comma from the sheet.
     * Per-element textContent avoids treating CMS or search values as markup.
     *
     * @param {Element} list Company-list element.
     * @param {string[]} companies Ordered company names.
     * @param {'ready'|'empty'} status Final render status.
     * @returns {void}
     */
    function renderHomeConsultCompanies(list, companies, status) {
        list.replaceChildren(
            ...companies.map((company) => {
                const item = document.createElement('p')
                item.className = homeConsultCompanyTextClass
                item.textContent = company
                return item
            }),
        )
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
            list.replaceChildren()
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
            window.dispatchEvent(new CustomEvent('expert-cards:relayout'))
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
            logQuizFlow('consult work-history hydration failed', error)
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
