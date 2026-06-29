/**
 * Quiz results page controller.
 *
 * Initial data source:
 * - sessionStorage.starterQuizPending saved by quiz-main.js before signup.
 *
 * Outputs:
 * - Renders quiz results into optional Webflow elements.
 * - Fetches top matching freelancer recommendations from Algolia.
 * - Saves compact quiz state to the logged-in Memberstack member JSON.
 * - Saves a short status/result summary to the starter-quiz Memberstack custom field.
 *
 * Set starterQuizResultsDebugEnabled to false to disable this file's logs.
 */
;(() => {
    const starterQuizResultsControllerFlag = 'starterQuizResultsController'
    const starterQuizResultsDebugEnabled = true
    const pendingQuizStorageKey = 'starterQuizPending'
    const learnContentSectionSelector = '.section_results-learn'
    const learnContentResultsSelector =
        learnContentSectionSelector + ' [wf-algolia-element="results"]'
    const learnContentDefaultFilterField = 'categories'
    const learnContentFilterWaitAttempts = 40
    const learnContentFilterWaitMs = 250
    const learnContentPostProcessDelays = [0, 100, 500]

    if (window[starterQuizResultsControllerFlag]) {
        if (starterQuizResultsDebugEnabled) {
            console.log('[Starter Quiz Funnel]', '[results]', 'duplicate script skipped', {
                scriptFlag: starterQuizResultsControllerFlag,
            })
        }
        return
    }

    window[starterQuizResultsControllerFlag] = true

    function normalizeLearnContentValue(value) {
        return (value || '').trim()
    }

    function slugifyLearnContentValue(value) {
        return normalizeLearnContentValue(value)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '')
    }

    function parseLearnContentJson(value) {
        if (!value) return null
        if (typeof value === 'object') return value

        try {
            const parsedValue = JSON.parse(value)
            return parsedValue && typeof parsedValue === 'object'
                ? parsedValue
                : null
        } catch (error) {
            return null
        }
    }

    function getLearnContentUrlListValues(params, keys) {
        return keys
            .flatMap((key) => params.getAll(key))
            .flatMap((value) =>
                normalizeLearnContentValue(value).split(/\s*[,|]\s*/),
            )
            .map(normalizeLearnContentValue)
            .filter(Boolean)
    }

    function parseLearnContentTestSelectionItem(value) {
        const text = normalizeLearnContentValue(value)
        const separatorIndex = text.indexOf(':')

        if (separatorIndex > 0) {
            const rawId = text.slice(0, separatorIndex)
            const rawLabel = text.slice(separatorIndex + 1)
            const id =
                slugifyLearnContentValue(rawId) ||
                slugifyLearnContentValue(rawLabel)

            return {
                id,
                label:
                    normalizeLearnContentValue(rawLabel) ||
                    normalizeLearnContentValue(rawId),
            }
        }

        return {
            id: slugifyLearnContentValue(text),
            label: text,
        }
    }

    function getLearnContentTestPendingQuizFromUrl() {
        const params = new URLSearchParams(window.location.search)
        const testMode = ['1', 'true', 'yes'].includes(
            normalizeLearnContentValue(
                params.get('starterQuizTest') || params.get('quizTest'),
            ).toLowerCase(),
        )

        if (!testMode) return null

        const categoriesById = new Map()

        getLearnContentUrlListValues(params, ['category', 'categories']).forEach(
            (value) => {
                const category = parseLearnContentTestSelectionItem(value)
                if (category.id) categoriesById.set(category.id, category)
            },
        )

        getLearnContentUrlListValues(params, [
            'subcategory',
            'subcategories',
        ]).forEach((value) => {
            const parts = normalizeLearnContentValue(value)
                .split('>')
                .map(normalizeLearnContentValue)
                .filter(Boolean)
            const categoryPart = parts.length > 1 ? parts[0] : ''

            if (!categoryPart) return

            const category = parseLearnContentTestSelectionItem(categoryPart)
            if (category.id && !categoriesById.has(category.id)) {
                categoriesById.set(category.id, category)
            }
        })

        return { categories: Array.from(categoriesById.values()) }
    }

    function getStoredLearnContentPendingQuiz() {
        return parseLearnContentJson(
            window.sessionStorage?.getItem(pendingQuizStorageKey),
        )
    }

    function getLearnContentCategoryFilterValue(category) {
        if (!category || typeof category !== 'object') return ''

        const candidateValues = [
            category.membershipId,
            category.membershipID,
            category.membership_id,
            category.categoryMembershipId,
            category.category_membership_id,
            category.id,
            category.value,
        ]

        for (const value of candidateValues) {
            const normalizedValue = normalizeLearnContentValue(value)
            if (normalizedValue) return normalizedValue
        }

        return slugifyLearnContentValue(category.label)
    }

    function getLearnContentCategoryFilters(pendingQuiz) {
        const categories = Array.isArray(pendingQuiz?.categories)
            ? pendingQuiz.categories
            : []
        const selectedCategoryFilters = Array.from(
            new Set(categories.map(getLearnContentCategoryFilterValue).filter(Boolean)),
        )
        const selectedCategory = categories.find((category) =>
            selectedCategoryFilters.includes(
                getLearnContentCategoryFilterValue(category),
            ),
        )

        return {
            selectedCategory: selectedCategory || null,
            selectedCategoryFilter: selectedCategoryFilters[0] || '',
            selectedCategoryFilters,
        }
    }

    function getWfAlgoliaRuntime() {
        return window.WfAlgolia &&
            typeof window.WfAlgolia.setFilter === 'function'
            ? window.WfAlgolia
            : null
    }

    function waitForWfAlgoliaRuntime() {
        const runtime = getWfAlgoliaRuntime()
        if (runtime) return Promise.resolve(runtime)

        return new Promise((resolve) => {
            let attempts = 0
            const intervalId = window.setInterval(() => {
                attempts += 1
                const currentRuntime = getWfAlgoliaRuntime()

                if (currentRuntime || attempts >= learnContentFilterWaitAttempts) {
                    window.clearInterval(intervalId)
                    resolve(currentRuntime || null)
                }
            }, learnContentFilterWaitMs)
        })
    }

    function refreshLearnContentSwiper(resultsElement) {
        const swiper = resultsElement
            ?.closest('[data-swiper-scroll="swiper"]')
            ?.__swiperScrollInstance

        if (swiper && typeof swiper.update === 'function') {
            try {
                swiper.update()
            } catch (error) {
                if (starterQuizResultsDebugEnabled) {
                    console.warn(
                        '[Starter Quiz Funnel]',
                        '[results]',
                        'LearnContent swiper update failed',
                        { error },
                    )
                }
            }
        }
    }

    function isLearnContentSlide(element) {
        return Boolean(
            element?.matches?.(
                '[data-swiper-scroll="swiper-slide"], .content-card_component',
            ),
        )
    }

    function isLearnContentTemplateSlide(element) {
        return (
            element?.getAttribute?.('wf-algolia-element') === 'template' ||
            element?.querySelector?.('[wf-algolia-element="template"]')
        )
    }

    function isLearnContentInjectedSlide(element) {
        return Boolean(element?.classList?.contains('wf-algolia-injected'))
    }

    function isLearnContentLockedSlide(element) {
        return Boolean(element?.querySelector?.('.content-card_locked'))
    }

    function isLearnContentAuthoredPlaceholderSlide(element) {
        return (
            isLearnContentSlide(element) &&
            !isLearnContentTemplateSlide(element) &&
            !isLearnContentInjectedSlide(element) &&
            !isLearnContentLockedSlide(element)
        )
    }

    function normalizeLearnContentSlides(source = 'results') {
        const resultsElement = document.querySelector(learnContentResultsSelector)
        if (!resultsElement) return false

        const slides = Array.from(resultsElement.children).filter(
            isLearnContentSlide,
        )
        const lockedSlides = slides.filter(isLearnContentLockedSlide)
        let didChange = false

        slides.forEach((slide) => {
            if (!isLearnContentAuthoredPlaceholderSlide(slide)) return

            slide.classList.add('hide')
            slide.setAttribute('aria-hidden', 'true')
            didChange = true
        })

        lockedSlides.forEach((lockedSlide) => {
            if (lockedSlide.parentElement !== resultsElement) return
            if (resultsElement.lastElementChild === lockedSlide) return

            resultsElement.appendChild(lockedSlide)
            didChange = true
        })

        if (didChange) {
            refreshLearnContentSwiper(resultsElement)

            if (starterQuizResultsDebugEnabled) {
                console.log(
                    '[Starter Quiz Funnel]',
                    '[results]',
                    'normalized LearnContent slides',
                    {
                        source,
                        hiddenPlaceholderCount: slides.filter(
                            isLearnContentAuthoredPlaceholderSlide,
                        ).length,
                        lockedSlideCount: lockedSlides.length,
                    },
                )
            }
        }

        return didChange
    }

    function scheduleNormalizeLearnContentSlides(source = 'results') {
        learnContentPostProcessDelays.forEach((delay) => {
            window.setTimeout(() => {
                normalizeLearnContentSlides(source)
            }, delay)
        })
    }

    function bindLearnContentWfAlgoliaEvents(wfAlgolia) {
        if (
            !wfAlgolia ||
            typeof wfAlgolia.on !== 'function' ||
            window.__starterQuizLearnContentEventsBound
        ) {
            return
        }

        window.__starterQuizLearnContentEventsBound = true
        wfAlgolia.on('results', () => {
            scheduleNormalizeLearnContentSlides('wf-algolia-results')
        })
        wfAlgolia.on('refresh', () => {
            scheduleNormalizeLearnContentSlides('wf-algolia-refresh')
        })
    }

    async function syncLearnContentFilters(pendingQuiz, source = 'results') {
        const learnContentSection = document.querySelector(
            learnContentSectionSelector,
        )

        if (!learnContentSection) return false

        const {
            selectedCategory,
            selectedCategoryFilter,
            selectedCategoryFilters,
        } = getLearnContentCategoryFilters(pendingQuiz)

        if (!selectedCategoryFilter) return false

        window.selectedCategory = selectedCategoryFilter
        window.selectedCategoryFilters = selectedCategoryFilters

        const wfAlgolia = await waitForWfAlgoliaRuntime()

        if (!wfAlgolia) {
            if (starterQuizResultsDebugEnabled) {
                console.warn(
                    '[Starter Quiz Funnel]',
                    '[results]',
                    'WfAlgolia runtime unavailable; LearnContent filters skipped',
                    {
                        source,
                        selectedCategoryFilter,
                        selectedCategoryFilters,
                    },
                )
            }

            return false
        }

        bindLearnContentWfAlgoliaEvents(wfAlgolia)
        wfAlgolia.setFilter(
            learnContentSection.getAttribute('data-quiz-learn-filter-field') ||
                learnContentSection.getAttribute('wf-algolia-filter-field') ||
                learnContentSection.getAttribute('wf-algolia-base-filter-field') ||
                learnContentDefaultFilterField,
            selectedCategoryFilters,
        )
        scheduleNormalizeLearnContentSlides(source)
        window.dispatchEvent(
            new CustomEvent('starterQuizResultsReady', {
                detail: {
                    source,
                    selectedCategory,
                    selectedCategoryFilter,
                    selectedCategoryFilters,
                    learnContentSection,
                },
            }),
        )

        if (starterQuizResultsDebugEnabled) {
            console.log(
                '[Starter Quiz Funnel]',
                '[results]',
                'synced LearnContent filters',
                {
                    source,
                    selectedCategory,
                    selectedCategoryFilter,
                    selectedCategoryFilters,
                    filterField:
                        learnContentSection.getAttribute(
                            'data-quiz-learn-filter-field',
                        ) ||
                        learnContentSection.getAttribute(
                            'wf-algolia-filter-field',
                        ) ||
                        learnContentSection.getAttribute(
                            'wf-algolia-base-filter-field',
                        ) ||
                        learnContentDefaultFilterField,
                },
            )
        }

        return true
    }

    syncLearnContentFilters(
        getLearnContentTestPendingQuizFromUrl() || getStoredLearnContentPendingQuiz(),
        'early',
    )
    scheduleNormalizeLearnContentSlides('initial')

    document.addEventListener(
    'DOMContentLoaded',
    function starterQuizResultsController() {
    const debugStorageKey = 'starterQuizDebug'
    const debugLogPrefix = '[Starter Quiz Funnel]'
    const algoliaDefaultAppId = 'PKVW6M9OPZ'
    const algoliaDefaultIndexName = 'Freelancers3.0-dev'
    const recommendationAlgorithmVersion = 'category-subcategory-pairs-v16'
    const featuredFreelancerLimit = 3
    const categoryFreelancerLimit = 5
    // Pool gathered per category before featured picks are drawn off the top,
    // sized above categoryFreelancerLimit so each category can still show 5
    // recommendations after the featured Starters are excluded.
    const categoryCandidatePoolLimit = 8
    const recommendedFreelancerCandidateLimit = 100
    // Minimum unique candidates a category/subcategory search should gather
    // before its progressively broader query tiers stop expanding.
    const termExpansionTargetCount = 8
    const testQuizTaxonomy = [
        {
            id: 'paid-media',
            label: 'Paid Media',
            subcategories: [
                'Paid Social',
                'Paid Search (SEM)',
                'Programmatic & Display',
                'Amazon Advertising',
                'Performance Creative',
            ],
        },
        {
            id: 'content-organic',
            label: 'Content & Organic',
            subcategories: [
                'SEO',
                'Content Marketing',
                'Organic Social',
                'Content Creation & UGC',
            ],
        },
        {
            id: 'creative-brand',
            label: 'Creative & Brand',
            subcategories: [
                'Creative Direction',
                'Graphic Design',
                'Copywriting',
                'Video & Production',
                'UI/UX Design',
            ],
        },
        {
            id: 'influencer-affiliate-pr',
            label: 'Influencer, Affiliate & PR',
            subcategories: [
                'Influencer Marketing',
                'Affiliate Marketing',
                'Partnerships',
                'PR & Communications',
            ],
        },
        {
            id: 'retention-crm',
            label: 'Retention & CRM',
            subcategories: [
                'Lifecycle Marketing',
                'Retention Strategy',
                'Loyalty & Subscription',
                'Customer Experience',
            ],
        },
        {
            id: 'analytics-experimentation',
            label: 'Analytics & Experimentation',
            subcategories: ['Data & Analytics', 'CRO & Experimentation'],
        },
        {
            id: 'retail-marketplace',
            label: 'Retail & Marketplace',
            subcategories: [
                'Retail Strategy',
                'Amazon & Marketplace',
                'Wholesale & Distribution',
                'Demand Planning',
            ],
        },
        {
            id: 'ai-technology',
            label: 'AI & Technology',
            subcategories: [
                'Shopify & Site Dev',
                'E-Commerce Management',
                'Digital Product Mgmt',
                'Technology Leadership',
                'AI & Automation',
            ],
        },
        {
            id: 'physical-product-development',
            label: 'Physical Product & Development',
            subcategories: [
                'Product Strategy',
                'Product Development',
                'Packaging & Design',
                'Regulatory & Compliance',
                'Product Launch',
            ],
        },
        {
            id: 'marketing-strategy-leadership',
            label: 'Marketing Strategy & Leadership',
            subcategories: [
                'CMO / Marketing Leadership',
                'Growth Strategy',
                'Brand & Positioning',
            ],
        },
        {
            id: 'finance',
            label: 'Finance',
            subcategories: [
                'Financial Strategy',
                'FP&A & Modeling',
                'Accounting & Control',
                'Financial Analysis',
            ],
        },
        {
            id: 'operations-supply-chain',
            label: 'Operations & Supply Chain',
            subcategories: [
                'Supply Chain',
                'Fulfillment & Logistics',
                'Procurement & Sourcing',
                'COO / Ops Leadership',
            ],
        },
        {
            id: 'hiring-team-building',
            label: 'Hiring & Team Building',
            subcategories: [
                'Talent & Recruiting',
                'Org Design',
                'Fractional Leadership',
            ],
        },
    ]

    /**
     * Algolia field names checked, in order, for each displayed value. The
     * first present, non-empty field wins. Edit these if the index uses
     * different attribute names. Dot paths (such as categories.lvl1) are
     * supported for nested fields.
     *
     * Confirmed for the Freelancers3.0-dev index: hourly rate is `rate`,
     * project rate is `average-project-size`, and category/subcategory data
     * is also present under `categories.lvl0` / `categories.lvl1`.
     */
    const hourlyRateFieldNames = ['rate', 'hourly-rate', 'hourlyRate']
    const projectRateFieldNames = [
        'average-project-size',
        'project-rate',
        'projectRate',
    ]
    const subcategoryFieldNames = [
        'roles',
        'roles-concatenate',
        'categories.lvl1',
        'subcategories',
        'subcategory',
    ]
    const maxDisplayedSubcategories = 3

    /**
     * Checks whether starter quiz debug logging is enabled.
     *
     * @returns {boolean} True when flow logs should be printed.
     */
    function isDebugLoggingEnabled() {
        if (!starterQuizResultsDebugEnabled) return false

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
            starterQuizResultsDebugEnabled ||
            sessionStorage.getItem(debugStorageKey) === 'true' ||
            localStorage.getItem(debugStorageKey) === 'true'
        )
    }

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
            console.log(debugLogPrefix, '[results]', message)
            return
        }

        console.log(debugLogPrefix, '[results]', message, data)
    }

    /**
     * Trims string-like values before reading IDs and labels.
     *
     * @param {string | null | undefined} value Value to normalize.
     * @returns {string} Trimmed value, or an empty string.
     */
    function normalize(value) {
        return (value || '').trim()
    }

    /**
     * Reads the pending quiz payload saved before Memberstack signup.
     *
     * @returns {object | null} Pending quiz payload, or null when unavailable.
     */
    function getPendingQuiz() {
        const savedRaw = sessionStorage.getItem(pendingQuizStorageKey)
        if (!savedRaw) return null

        const pendingQuiz = parsePendingQuiz(savedRaw)

        if (!pendingQuiz) {
            logQuizFlow('could not parse pending quiz payload', {
                savedRaw,
                pendingQuizStorageKey,
            })
            return null
        }

        logQuizFlow('loaded pending quiz from sessionStorage', {
            pendingQuiz,
            pendingQuizStorageKey,
        })

        return pendingQuiz
    }

    /**
     * Parses a saved quiz payload from a string or object.
     *
     * @param {string | object | null | undefined} value Saved quiz value.
     * @returns {object | null} Parsed quiz payload.
     */
    function parsePendingQuiz(value) {
        if (!value) return null

        if (typeof value === 'object') return value

        try {
            const pendingQuiz = JSON.parse(value)

            return pendingQuiz && typeof pendingQuiz === 'object'
                ? pendingQuiz
                : null
        } catch (error) {
            logQuizFlow('could not parse quiz payload', { error, value })

            return null
        }
    }

    /**
     * Parses legacy starter-quiz custom field JSON when present.
     *
     * The custom field now stores only a short text summary, so non-JSON values
     * such as "ready" are expected and should not be logged as parse failures.
     *
     * @param {string | object | null | undefined} value Saved custom field value.
     * @returns {object | null} Parsed legacy quiz payload, or null.
     */
    function parseStarterQuizCustomField(value) {
        if (!value || typeof value === 'object') return parsePendingQuiz(value)

        const text = normalize(value)
        if (!text || !['{', '['].includes(text[0])) return null

        return parsePendingQuiz(text)
    }

    function getUrlListValues(params, names) {
        return names.flatMap((name) =>
            params
                .getAll(name)
                .flatMap((value) => normalize(value).split(/\s*[,|]\s*/))
                .filter(Boolean),
        )
    }

    function isStarterQuizTestMode() {
        const params = new URLSearchParams(window.location.search)
        return ['1', 'true', 'yes'].includes(
            normalize(params.get('starterQuizTest') || params.get('quizTest'))
                .toLowerCase(),
        )
    }

    function parseTestSelectionItem(value) {
        const text = normalize(value)
        const separatorIndex = text.indexOf(':')

        if (separatorIndex > 0) {
            const id = slugify(text.slice(0, separatorIndex))
            const label = normalize(text.slice(separatorIndex + 1))
            return {
                id: id || slugify(label),
                label: label || formatSlugTitle(id),
            }
        }

        return {
            id: slugify(text),
            label: text,
        }
    }

    /**
     * Builds a ready quiz payload from URL params for Webflow QA.
     *
     * Example:
     * ?starterQuizTest=1&category=Paid%20Media&subcategory=Paid%20Media%3EPaid%20Social
     *
     * This intentionally bypasses sessionStorage and Memberstack.
     *
     * @returns {object | null} Test pending quiz payload.
     */
    function getTestPendingQuizFromUrl() {
        const params = new URLSearchParams(window.location.search)

        if (!isStarterQuizTestMode()) return null

        const categoriesById = new Map()
        const subcategories = []

        getUrlListValues(params, ['category', 'categories']).forEach((value) => {
            const category = parseTestSelectionItem(value)
            if (category.id) categoriesById.set(category.id, category)
        })

        getUrlListValues(params, ['subcategory', 'subcategories']).forEach(
            (value) => {
                const parts = normalize(value)
                    .split('>')
                    .map(normalize)
                    .filter(Boolean)
                const categoryPart = parts.length > 1 ? parts[0] : ''
                const subcategoryPart = parts.length > 1 ? parts[1] : parts[0]
                const category = categoryPart
                    ? parseTestSelectionItem(categoryPart)
                    : null
                const subcategory = parseTestSelectionItem(subcategoryPart)

                if (category?.id && !categoriesById.has(category.id)) {
                    categoriesById.set(category.id, category)
                }

                if (subcategory.id) {
                    subcategories.push({
                        id: subcategory.id,
                        label: subcategory.label,
                        categoryId: category?.id || '',
                    })
                }
            },
        )

        const pendingQuiz = {
            categories: Array.from(categoriesById.values()),
            subcategories,
            resultSlug: params.get('resultSlug') || null,
            status: 'ready',
            updatedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            testMode: true,
        }

        logQuizFlow('loaded test quiz from URL params', { pendingQuiz })

        return pendingQuiz
    }

    function renderTestModeControls(pendingQuiz) {
        if (!pendingQuiz?.testMode) return
        if (document.querySelector('[data-starter-quiz-test-controls]')) return

        const selectedCategoryIds = new Set(
            (Array.isArray(pendingQuiz.categories)
                ? pendingQuiz.categories
                : []
            ).map((category) => normalize(category.id) || slugify(category.label)),
        )
        const selectedSubcategoryKeys = new Set()
        const selectedSubcategoryIds = new Set()

        ;(Array.isArray(pendingQuiz.subcategories)
            ? pendingQuiz.subcategories
            : []
        ).forEach((subcategory) => {
            const subcategoryId =
                normalize(subcategory.id) || slugify(subcategory.label)
            const categoryId = normalize(subcategory.categoryId)

            if (subcategoryId) selectedSubcategoryIds.add(subcategoryId)
            if (categoryId && subcategoryId) {
                selectedSubcategoryKeys.add(categoryId + '>' + subcategoryId)
            }
        })

        const style = document.createElement('style')
        style.textContent = `
            [data-starter-quiz-test-controls] {
                position: relative;
                z-index: 9999;
                margin: 16px auto;
                padding: 16px;
                width: min(1120px, calc(100% - 32px));
                background: #111;
                color: #fff;
                border: 1px solid rgba(255,255,255,.2);
                border-radius: 8px;
                font-family: Inter, Arial, sans-serif;
            }
            [data-starter-quiz-test-controls] h2 {
                margin: 0 0 8px;
                font-size: 18px;
                line-height: 1.2;
                color: #fff;
            }
            [data-starter-quiz-test-controls] p {
                margin: 0 0 12px;
                color: rgba(255,255,255,.72);
                font-size: 13px;
            }
            [data-starter-quiz-test-grid] {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
                gap: 10px;
                max-height: 52vh;
                overflow: auto;
                padding-right: 4px;
            }
            [data-starter-quiz-test-card] {
                padding: 12px;
                background: rgba(255,255,255,.08);
                border: 1px solid rgba(255,255,255,.14);
                border-radius: 8px;
            }
            [data-starter-quiz-test-controls] label {
                display: flex;
                gap: 8px;
                align-items: flex-start;
                margin: 0;
                color: #fff;
                font-size: 13px;
                line-height: 1.35;
                cursor: pointer;
            }
            [data-starter-quiz-test-card] > label {
                font-weight: 700;
                font-size: 14px;
            }
            [data-starter-quiz-test-subs] {
                display: grid;
                gap: 6px;
                margin-top: 10px;
                padding-top: 10px;
                border-top: 1px solid rgba(255,255,255,.14);
            }
            [data-starter-quiz-test-actions] {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 14px;
            }
            [data-starter-quiz-test-actions] button {
                border: 1px solid rgba(255,255,255,.25);
                border-radius: 6px;
                padding: 8px 12px;
                background: #effba8;
                color: #111;
                font: inherit;
                font-weight: 700;
                cursor: pointer;
            }
            [data-starter-quiz-test-actions] button[data-test-clear] {
                background: transparent;
                color: #fff;
            }
        `
        document.head.appendChild(style)

        const panel = document.createElement('section')
        panel.setAttribute('data-starter-quiz-test-controls', '')

        const title = document.createElement('h2')
        title.textContent = 'Quiz result test controls'
        panel.appendChild(title)

        const note = document.createElement('p')
        note.textContent =
            'Select categories and subcategories, then run results. This bypasses Memberstack and saved browser data.'
        panel.appendChild(note)

        const grid = document.createElement('div')
        grid.setAttribute('data-starter-quiz-test-grid', '')

        testQuizTaxonomy.forEach((category) => {
            const card = document.createElement('div')
            card.setAttribute('data-starter-quiz-test-card', '')

            const categoryLabel = document.createElement('label')
            const categoryInput = document.createElement('input')
            categoryInput.type = 'checkbox'
            categoryInput.setAttribute('data-test-category', category.label)
            categoryInput.checked = selectedCategoryIds.has(category.id)
            categoryLabel.append(categoryInput, document.createTextNode(category.label))
            card.appendChild(categoryLabel)

            const subs = document.createElement('div')
            subs.setAttribute('data-starter-quiz-test-subs', '')

            category.subcategories.forEach((subcategoryLabel) => {
                const subcategoryId = slugify(subcategoryLabel)
                const subcategoryKey = category.id + '>' + subcategoryId
                const subLabel = document.createElement('label')
                const subInput = document.createElement('input')

                subInput.type = 'checkbox'
                subInput.setAttribute('data-test-subcategory', subcategoryLabel)
                subInput.setAttribute('data-test-parent-category', category.label)
                subInput.checked =
                    selectedSubcategoryKeys.has(subcategoryKey) ||
                    selectedSubcategoryIds.has(subcategoryId)

                subLabel.append(subInput, document.createTextNode(subcategoryLabel))
                subs.appendChild(subLabel)
            })

            card.appendChild(subs)
            grid.appendChild(card)
        })

        panel.appendChild(grid)

        const actions = document.createElement('div')
        actions.setAttribute('data-starter-quiz-test-actions', '')

        const runButton = document.createElement('button')
        runButton.type = 'button'
        runButton.textContent = 'Run selected results'
        runButton.addEventListener('click', () => {
            const nextUrl = new URL(window.location.href)
            nextUrl.search = ''
            nextUrl.searchParams.set('starterQuizTest', '1')
            nextUrl.searchParams.set('starterQuizDebug', '1')

            const selectedCategories = new Set()

            panel
                .querySelectorAll('[data-test-category]:checked')
                .forEach((input) => {
                    selectedCategories.add(input.getAttribute('data-test-category'))
                })

            panel
                .querySelectorAll('[data-test-subcategory]:checked')
                .forEach((input) => {
                    const categoryLabel = input.getAttribute(
                        'data-test-parent-category',
                    )
                    const subcategoryLabel = input.getAttribute(
                        'data-test-subcategory',
                    )

                    selectedCategories.add(categoryLabel)
                    nextUrl.searchParams.append(
                        'subcategory',
                        categoryLabel + '>' + subcategoryLabel,
                    )
                })

            selectedCategories.forEach((categoryLabel) => {
                if (categoryLabel) {
                    nextUrl.searchParams.append('category', categoryLabel)
                }
            })

            window.location.href = nextUrl.toString()
        })

        const clearButton = document.createElement('button')
        clearButton.type = 'button'
        clearButton.textContent = 'Clear selections'
        clearButton.setAttribute('data-test-clear', '')
        clearButton.addEventListener('click', () => {
            const nextUrl = new URL(window.location.href)
            nextUrl.search = ''
            nextUrl.searchParams.set('starterQuizTest', '1')
            nextUrl.searchParams.set('starterQuizDebug', '1')
            window.location.href = nextUrl.toString()
        })

        actions.append(runButton, clearButton)
        panel.appendChild(actions)

        document.body.insertBefore(panel, document.body.firstChild)
    }

    /**
     * Converts a slug into readable title case text.
     *
     * @param {string | null | undefined} slug Slug-style text.
     * @returns {string} Readable title text.
     */
    function formatSlugTitle(slug) {
        return normalize(slug)
            .split(/[-_\s]+/)
            .filter(Boolean)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
    }

    /**
     * Converts text into a URL-style slug for matching category identifiers.
     *
     * @param {string | null | undefined} value Text to slugify.
     * @returns {string} Slugified value.
     */
    function slugify(value) {
        return normalize(value)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '')
    }

    /**
     * Strips HTML tags from a value, collapsing whitespace to plain text.
     *
     * @param {string | null | undefined} value HTML or plain text.
     * @returns {string} Plain text.
     */
    function stripHtml(value) {
        return normalize(String(value || '').replace(/<[^>]*>/g, ' ')).replace(
            /\s+/g,
            ' ',
        )
    }

    /**
     * Gets a display label from a saved quiz item.
     *
     * @param {string | {id?: string, label?: string}} item Saved quiz item.
     * @returns {string} Display label.
     */
    function getItemLabel(item) {
        if (typeof item === 'string') return normalize(item)

        return normalize(item?.label) || normalize(item?.id)
    }

    /**
     * Gets an ID from a saved quiz item.
     *
     * @param {string | {id?: string, label?: string}} item Saved quiz item.
     * @returns {string} Item ID.
     */
    function getItemId(item) {
        if (typeof item === 'string') return normalize(item)

        return normalize(item?.id) || normalize(item?.label)
    }

    /**
     * Writes text into every element matching a selector.
     *
     * @param {string} selector Elements to update.
     * @param {string} value Text to render.
     * @returns {void}
     */
    function setText(selector, value) {
        document.querySelectorAll(selector).forEach((element) => {
            element.textContent = value
        })
    }

    /**
     * Writes a comma-separated list into every element matching a selector.
     *
     * @param {string} selector Elements to update.
     * @param {Array<string | {id?: string, label?: string}>} items Items to render.
     * @returns {void}
     */
    function setItemListText(selector, items) {
        const labels = Array.isArray(items)
            ? items.map(getItemLabel).filter(Boolean)
            : []

        setText(selector, labels.join(', '))
    }

    /**
     * Groups selected subcategories under their selected parent categories.
     *
     * @param {object} pendingQuiz Pending quiz payload.
     * @returns {{id: string, label: string, subcategories: {id: string, label: string}[]}[]} Grouped result data.
     */
    function getGroupedResults(pendingQuiz) {
        const categories = Array.isArray(pendingQuiz.categories)
            ? pendingQuiz.categories
            : []
        const subcategories = Array.isArray(pendingQuiz.subcategories)
            ? pendingQuiz.subcategories
            : []

        const groups = categories
            .map((category) => {
                const categoryId = getItemId(category)

                return {
                    id: categoryId,
                    label: getItemLabel(category),
                    subcategories: subcategories
                        .filter((subcategory) => {
                            return (
                                normalize(subcategory?.categoryId) ===
                                categoryId
                            )
                        })
                        .map((subcategory) => ({
                            id: getItemId(subcategory),
                            label: getItemLabel(subcategory),
                        }))
                        .filter((subcategory) => subcategory.id),
                }
            })
            .filter((group) => group.id)

        const groupedCategoryIds = new Set(groups.map((group) => group.id))
        const orphanSubcategories = subcategories
            .filter((subcategory) => {
                return !groupedCategoryIds.has(normalize(subcategory?.categoryId))
            })
            .map((subcategory) => ({
                id: getItemId(subcategory),
                label: getItemLabel(subcategory),
            }))
            .filter((subcategory) => subcategory.id)

        if (orphanSubcategories.length) {
            groups.push({
                id: 'other',
                label: 'Other',
                subcategories: orphanSubcategories,
            })
        }

        return groups
    }

    /**
     * Builds a text fallback for one grouped category result.
     *
     * @param {{label: string, subcategories: {label: string}[]}} group Grouped category result.
     * @returns {string} Readable grouped text.
     */
    function getGroupText(group) {
        const subcategoryLabels = group.subcategories
            .map((subcategory) => subcategory.label)
            .filter(Boolean)

        if (!subcategoryLabels.length) return group.label

        return group.label + ': ' + subcategoryLabels.join(', ')
    }

    /**
     * Creates the DOM for one grouped category result.
     *
     * @param {{id: string, label: string, subcategories: {id: string, label: string}[]}} group Grouped category result.
     * @returns {HTMLElement} Renderable group element.
     */
    function createGroupElement(group) {
        const groupElement = document.createElement('div')
        groupElement.className = 'quiz-result-group'
        groupElement.dataset.resultCategory = group.id

        const titleElement = document.createElement('h3')
        titleElement.className = 'quiz-result-group-title'
        titleElement.textContent = group.label
        groupElement.appendChild(titleElement)

        if (!group.subcategories.length) return groupElement

        const listElement = document.createElement('ul')
        listElement.className = 'quiz-result-subcategory-list'

        group.subcategories.forEach((subcategory) => {
            const itemElement = document.createElement('li')
            itemElement.className = 'quiz-result-subcategory-item'
            itemElement.dataset.resultSubcategory = subcategory.id
            itemElement.textContent = subcategory.label
            listElement.appendChild(itemElement)
        })

        groupElement.appendChild(listElement)

        return groupElement
    }

    /**
     * Renders grouped category/subcategory results into result containers.
     *
     * @param {{id: string, label: string, subcategories: {id: string, label: string}[]}[]} groups Grouped result data.
     * @returns {boolean} True when a grouped target was found and rendered.
     */
    function renderGroupedResults(groups) {
        const groupTargets = document.querySelectorAll(
            '[data-result-groups], [data-result-categories]',
        )

        if (!groupTargets.length) return false

        groupTargets.forEach((target) => {
            target.textContent = ''

            if (!groups.length) {
                target.textContent = 'No quiz selections found.'
                return
            }

            groups.forEach((group) => {
                target.appendChild(createGroupElement(group))
            })
        })

        logQuizFlow('rendered grouped category and subcategory results', {
            groups,
            groupText: groups.map(getGroupText),
            targetCount: groupTargets.length,
        })

        return true
    }

    function setCountText(selectors, count) {
        document.querySelectorAll(selectors).forEach((element) => {
            element.textContent = Number(count || 0).toLocaleString()
        })
    }

    function getSelectionCount(items) {
        return Array.isArray(items) ? items.length : 0
    }

    function getDisplayedStarterCount(recommendations) {
        const featuredFreelancers = Array.isArray(
            recommendations?.featuredFreelancers,
        )
            ? recommendations.featuredFreelancers
            : []
        const groups = Array.isArray(recommendations?.recommendationGroups)
            ? recommendations.recommendationGroups
            : []
        const objectIds = new Set()

        ;[
            ...featuredFreelancers,
            ...groups.flatMap((group) => group.recommendations || []),
        ].forEach((freelancer) => {
            const objectId = normalize(freelancer?.objectID)
            if (objectId) objectIds.add(objectId)
        })

        return objectIds.size
    }

    function getUniqueStarterCount(recommendations) {
        const starterCount = Number(recommendations?.starterCount)

        if (Number.isFinite(starterCount) && starterCount >= 0) {
            return starterCount
        }

        return getDisplayedStarterCount(recommendations)
    }

    function getUniqueSearchResultStarterCount(searchResults) {
        const objectIds = new Set()

        ;(Array.isArray(searchResults) ? searchResults : []).forEach((result) => {
            const candidates = Array.isArray(result?.candidates)
                ? result.candidates
                : []

            candidates.forEach((candidate) => {
                const objectId = normalize(candidate?.objectID)
                if (objectId) objectIds.add(objectId)
            })
        })

        return objectIds.size
    }

    function renderQuizSelectionCounts(pendingQuiz) {
        const categoryCount = getSelectionCount(pendingQuiz?.categories)
        const subcategoryCount = getSelectionCount(pendingQuiz?.subcategories)

        setCountText(
            '[data-quiz-count="categories"], [data-quiz-category-count]',
            categoryCount,
        )
        setCountText(
            '[data-quiz-count="subcategories"], [data-quiz-subcategory-count]',
            subcategoryCount,
        )

        logQuizFlow('rendered quiz selection counts', {
            categoryCount,
            subcategoryCount,
        })
    }

    function renderQuizStarterCount(recommendations) {
        const starterCount = getUniqueStarterCount(recommendations)

        setCountText(
            '[data-quiz-count="starters"], [data-quiz-starter-count]',
            starterCount,
        )

        logQuizFlow('rendered quiz starter count', { starterCount })
    }

    /**
     * Renders pending quiz results into optional page placeholders.
     *
     * Supported placeholders:
     * - [data-result-title]
     * - [data-result-groups] for grouped category/subcategory results.
     * - [data-result-categories] as a fallback grouped-results container.
     * - [data-result-subcategories] for legacy separate subcategory text.
     * - [data-quiz-count="categories"] / [data-quiz-category-count]
     * - [data-quiz-count="subcategories"] / [data-quiz-subcategory-count]
     *
     * @param {object} pendingQuiz Pending quiz payload.
     * @returns {void}
     */
    function renderPendingQuiz(pendingQuiz) {
        const resultTitle =
            formatSlugTitle(pendingQuiz.resultSlug) || 'Your Starter Results'
        const groupedResults = getGroupedResults(pendingQuiz)
        const didRenderGroupedResults = renderGroupedResults(groupedResults)

        setText('[data-result-title]', resultTitle)
        renderQuizSelectionCounts(pendingQuiz)

        if (!didRenderGroupedResults) {
            setItemListText('[data-result-categories]', pendingQuiz.categories)
            setItemListText(
                '[data-result-subcategories]',
                pendingQuiz.subcategories,
            )
        } else {
            document
                .querySelectorAll('[data-result-subcategories]')
                .forEach((element) => {
                    element.textContent = ''
                    element.hidden = true
                })
        }

        logQuizFlow('rendered pending quiz result placeholders', {
            resultTitle,
            groupedResults,
            didRenderGroupedResults,
            hasTitleTarget: Boolean(document.querySelector('[data-result-title]')),
            hasGroupsTarget: Boolean(document.querySelector('[data-result-groups]')),
            hasCategoriesTarget: Boolean(
                document.querySelector('[data-result-categories]'),
            ),
            hasSubcategoriesTarget: Boolean(
                document.querySelector('[data-result-subcategories]'),
            ),
        })
    }

    /**
     * Builds the set of identifiers for the selected main categories.
     *
     * Includes each category's raw ID and slugified ID/label so TOC attribute
     * values match regardless of whether they use the slug or the raw ID.
     *
     * @param {object} pendingQuiz Pending quiz payload.
     * @returns {Set<string>} Selected main-category match keys.
     */
    function getSelectedMainCategoryKeys(pendingQuiz) {
        const categories = Array.isArray(pendingQuiz.categories)
            ? pendingQuiz.categories
            : []
        const keys = new Set()

        categories.forEach((category) => {
            const id = getItemId(category)
            const label = getItemLabel(category)

            if (id) {
                keys.add(id.toLowerCase())
                keys.add(slugify(id))
            }
            if (label) keys.add(slugify(label))
        })

        keys.delete('')
        return keys
    }

    /**
     * Hides Webflow TOC elements whose category is not selected.
     *
     * Targets elements carrying data-toc-algolia-target or data-toc-algolia-link
     * (their value is a main category). Matching elements get the .hide class
     * removed; non-matching elements get it added.
     *
     * @param {object} pendingQuiz Pending quiz payload.
     * @returns {void}
     */
    function syncTocCategoryVisibility(pendingQuiz) {
        const tocElements = document.querySelectorAll(
            '[data-toc-algolia-target], [data-toc-algolia-link]',
        )

        if (!tocElements.length) {
            logQuizFlow('no TOC category elements found')
            return
        }

        const selectedKeys = getSelectedMainCategoryKeys(pendingQuiz)
        const hiddenValues = []
        const shownValues = []

        tocElements.forEach((element) => {
            const value = normalize(
                element.getAttribute('data-toc-algolia-target') ||
                    element.getAttribute('data-toc-algolia-link'),
            )
            const isSelected =
                selectedKeys.has(value.toLowerCase()) ||
                selectedKeys.has(slugify(value))

            element.classList.toggle('hide', !isSelected)
            ;(isSelected ? shownValues : hiddenValues).push(value)
        })

        logQuizFlow('synced TOC category visibility', {
            selectedKeys: Array.from(selectedKeys),
            shownValues,
            hiddenValues,
            tocElementCount: tocElements.length,
        })
    }

    /**
     * Normalizes array-like Algolia attributes for rendering and storage.
     *
     * @param {unknown} value Attribute value from Algolia.
     * @returns {string[]} Normalized string values.
     */
    function normalizeAlgoliaList(value) {
        if (Array.isArray(value)) return value.map(normalize).filter(Boolean)
        if (typeof value === 'string') {
            return value
                .split(';')
                .map(normalize)
                .filter(Boolean)
        }

        return []
    }

    /**
     * Reads a possibly nested field from an Algolia hit using a dot path.
     *
     * @param {object} hit Algolia hit.
     * @param {string} path Field name or dot path, such as categories.lvl1.
     * @returns {unknown} Field value, or undefined when missing.
     */
    function getHitFieldValue(hit, path) {
        return path.split('.').reduce((value, key) => {
            return value == null ? undefined : value[key]
        }, hit)
    }

    /**
     * Reads the first present, non-empty value from a list of candidate fields.
     *
     * @param {object} hit Algolia hit.
     * @param {string[]} fieldNames Candidate field names, in priority order.
     * @returns {unknown} First non-empty value, or null when none match.
     */
    function getFirstHitFieldValue(hit, fieldNames) {
        for (const fieldName of fieldNames) {
            const value = getHitFieldValue(hit, fieldName)

            if (Array.isArray(value)) {
                const firstValue = value.find(
                    (item) => normalize(String(item)) !== '',
                )
                if (firstValue !== undefined) return firstValue
            } else if (value !== null && value !== undefined && normalize(String(value)) !== '') {
                return value
            }
        }

        return null
    }

    /**
     * Reduces hierarchical facet values to their leaf subcategory labels.
     *
     * Hierarchical values such as "Design > Branding" become "Branding".
     *
     * @param {unknown} value Raw facet value from Algolia.
     * @returns {string[]} Leaf subcategory labels.
     */
    function toSubcategoryLabels(value) {
        const rawValues = Array.isArray(value)
            ? value
            : typeof value === 'string'
              ? [value]
              : []

        return rawValues
            .map((rawValue) => {
                const segments = normalize(String(rawValue))
                    .split('>')
                    .map(normalize)
                    .filter(Boolean)

                return segments[segments.length - 1] || ''
            })
            .filter(Boolean)
    }

    /**
     * Reads a freelancer's subcategory labels from the first matching field.
     *
     * @param {object} hit Algolia hit.
     * @returns {string[]} Deduplicated subcategory labels.
     */
    function getSubcategoryLabels(hit) {
        for (const fieldName of subcategoryFieldNames) {
            const labels = toSubcategoryLabels(getHitFieldValue(hit, fieldName))

            if (labels.length) {
                return Array.from(new Set(labels))
            }
        }

        return []
    }

    /**
     * Formats a rate value for display, leaving non-numeric values as-is.
     *
     * @param {unknown} value Raw rate value from Algolia.
     * @param {string} [suffix] Suffix appended to numeric amounts, such as "/hr".
     * @returns {string} Display rate text, or an empty string when unavailable.
     */
    function formatRateValue(value, suffix = '') {
        if (value === null || value === undefined) return ''

        const rawValue = typeof value === 'string' ? value.trim() : value
        if (rawValue === '') return ''

        const isNumericLike =
            typeof rawValue === 'number' ||
            /^\$?\s*[\d,.]+\s*$/.test(String(rawValue))

        if (!isNumericLike) return normalize(String(rawValue))

        const amount = getRankingPoints(String(rawValue).replace(/[$\s]/g, ''))
        if (amount <= 0) return ''

        return '$' + amount.toLocaleString() + suffix
    }

    /**
     * Parses number-like ranking points.
     *
     * @param {unknown} value Ranking value from Algolia.
     * @returns {number} Numeric ranking points. Missing values rank as 0.
     */
    function getRankingPoints(value) {
        const rankingPoints =
            typeof value === 'number'
                ? value
                : Number.parseFloat(String(value || '').replace(/,/g, ''))

        return Number.isFinite(rankingPoints) ? rankingPoints : 0
    }

    /**
     * Checks whether a ranking-points value should drive recommendation order.
     *
     * @param {unknown} value Ranking value from Algolia.
     * @returns {boolean} True when the value is a positive number.
     */
    function hasRankingPoints(value) {
        return getRankingPoints(value) > 0
    }

    /**
     * Randomizes array order using Fisher-Yates.
     *
     * @param {object[]} items Items to shuffle.
     * @returns {object[]} New shuffled array.
     */
    function shuffleItems(items) {
        const shuffledItems = [...items]

        for (let index = shuffledItems.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1))
            const currentItem = shuffledItems[index]

            shuffledItems[index] = shuffledItems[swapIndex]
            shuffledItems[swapIndex] = currentItem
        }

        return shuffledItems
    }

    /**
     * Reads selected top-level categories and their subcategories for Algolia recommendation searches.
     *
     * @param {object} pendingQuiz Pending quiz payload.
     * @returns {{id: string, label: string, subcategories: {id: string, label: string}[]}[]} Selected categories.
     */
    function getRecommendationCategories(pendingQuiz) {
        return getGroupedResults(pendingQuiz).filter((category) => {
            return category.id !== 'other' && (category.id || category.label)
        })
    }

    /**
     * Builds one Algolia search query for one selected category/subcategory pair.
     *
     * @param {{id: string, label: string}} category Selected category.
     * @param {{id: string, label: string} | null} [subcategory] Selected subcategory.
     * @returns {string} Search query for Algolia.
     */
    function getCategoryRecommendationQuery(category, subcategory = null) {
        const categoryTerm = category.label || formatSlugTitle(category.id)
        const subcategoryTerm =
            subcategory?.label || formatSlugTitle(subcategory?.id)

        return Array.from(new Set([categoryTerm, subcategoryTerm]))
            .filter(Boolean)
            .join(' ')
    }

    /**
     * Splits a compound search term into its parts on " & " and " / ".
     *
     * Only space-delimited separators split, so glued tokens such as "UI/UX",
     * "A/B", and "FP&A" stay intact while "Operations & Supply Chain" becomes
     * ["Operations", "Supply Chain"].
     *
     * @param {string} term Search term.
     * @returns {string[]} Term parts.
     */
    function splitSearchTermParts(term) {
        const normalizedTerm = normalize(term)
        if (!normalizedTerm) return []

        return normalizedTerm
            .split(/\s+[&/]\s+/)
            .map(normalize)
            .filter(Boolean)
    }

    /**
     * Joins term fragments into one query, dropping empties and duplicates.
     *
     * @param {...string} terms Term fragments.
     * @returns {string} Search query.
     */
    function joinSearchTerms(...terms) {
        return Array.from(new Set(terms.map(normalize).filter(Boolean))).join(' ')
    }

    /**
     * Builds a free-text search rule from a query string.
     *
     * @param {string} query Search query text.
     * @returns {{query: string, facetFilters: null, label: string}} Text rule.
     */
    function createTextSearchRule(query) {
        const normalizedQuery = normalize(query)

        return {
            query: normalizedQuery,
            facetFilters: null,
            label: normalizedQuery,
        }
    }

    /**
     * Builds an exact categories.lvl1 facet rule for a category/subcategory pair.
     *
     * The facet value mirrors the Algolia hierarchical format, such as
     * "Retail & Marketplace > Amazon & Marketplace". The index must declare
     * categories.lvl1 in attributesForFaceting for this rule to match; when it
     * does not, the search simply falls through to the text rules.
     *
     * @param {string} categoryTerm Selected category label.
     * @param {string} subcategoryTerm Selected subcategory label.
     * @returns {{query: string, facetFilters: Array, label: string} | null} Facet rule, or null.
     */
    function createSubcategoryFacetRule(categoryTerm, subcategoryTerm) {
        const category = normalize(categoryTerm)
        const subcategory = normalize(subcategoryTerm)

        if (!category || !subcategory) return null

        const facetValue = category + ' > ' + subcategory

        return {
            query: '',
            facetFilters: [['categories.lvl1:' + facetValue]],
            label: facetValue,
        }
    }

    /**
     * Builds an exact categories.lvl0 facet rule for a selected category.
     *
     * The facet value is the top-level category label, such as
     * "Retail & Marketplace". The index must declare categories.lvl0 in
     * attributesForFaceting for this rule to match; when it does not, the
     * search simply falls through to the text rules.
     *
     * @param {string} categoryTerm Selected category label.
     * @returns {{query: string, facetFilters: Array, label: string} | null} Facet rule, or null.
     */
    function createCategoryFacetRule(categoryTerm) {
        const category = normalize(categoryTerm)

        if (!category) return null

        return {
            query: '',
            facetFilters: [['categories.lvl0:' + category]],
            label: category,
        }
    }

    /**
     * Checks whether the page requests strict, facet-only recommendation queries.
     *
     * When an element marked data-quiz-code="embed" sets
     * data-quiz-query-strict to a truthy value, only the exact categories.lvl1
     * and categories.lvl0 facet rules run; the broader free-text rules and the
     * category text fallback are skipped.
     *
     * @returns {boolean} True when strict query mode is enabled.
     */
    function isStrictRecommendationQueryMode() {
        const embed = document.querySelector('[data-quiz-code="embed"]')
        if (!embed) return false

        const strict = normalize(
            embed.getAttribute('data-quiz-query-strict'),
        ).toLowerCase()

        return ['1', 'true', 'yes'].includes(strict)
    }

    /**
     * Builds progressively broader search rule tiers for a category/subcategory pair.
     *
     * - Tier 1: exact categories.lvl1 facet match (most precise).
     * - Tier 2: exact categories.lvl0 facet match (category only).
     * - Tier 3: full category + full subcategory free-text query.
     * - Tier 4: full category + each subcategory part.
     * - Tier 5: each category part + each subcategory part.
     *
     * Compound terms (joined with " & " or " / ") expand into combinations so a
     * search can widen when the exact match returns too few candidates. Rules are
     * de-duplicated within and across tiers, and empty tiers are dropped, so a
     * term without separators simply yields fewer tiers. In strict mode only the
     * two facet tiers run; the free-text tiers are skipped.
     *
     * @param {{id: string, label: string}} category Selected category.
     * @param {{id: string, label: string} | null} [subcategory] Selected subcategory.
     * @param {{strict?: boolean}} [options] Rule build options.
     * @returns {{query: string, facetFilters: Array | null, label: string}[][]} Ordered rule tiers.
     */
    function buildCategoryRecommendationQueryTiers(
        category,
        subcategory = null,
        options = {},
    ) {
        const categoryTerm = category.label || formatSlugTitle(category.id)
        const subcategoryTerm = subcategory
            ? subcategory.label || formatSlugTitle(subcategory.id)
            : ''
        const categoryParts = splitSearchTermParts(categoryTerm)
        const subcategoryParts = splitSearchTermParts(subcategoryTerm)

        const tiers = []
        const seenRules = new Set()

        const addTier = (rules) => {
            const newRules = []

            rules.forEach((rule) => {
                if (!rule || !rule.label) return

                const ruleKey =
                    (rule.facetFilters ? 'facet:' : 'query:') + rule.label
                if (seenRules.has(ruleKey)) return

                seenRules.add(ruleKey)
                newRules.push(rule)
            })

            if (newRules.length) tiers.push(newRules)
        }

        addTier([createSubcategoryFacetRule(categoryTerm, subcategoryTerm)])
        addTier([createCategoryFacetRule(categoryTerm)])

        // Strict mode stops at the exact facet rules; no free-text broadening.
        if (options.strict) return tiers

        addTier([
            createTextSearchRule(
                joinSearchTerms(categoryTerm, subcategoryTerm),
            ),
        ])

        if (subcategoryParts.length > 1) {
            addTier(
                subcategoryParts.map((part) =>
                    createTextSearchRule(joinSearchTerms(categoryTerm, part)),
                ),
            )
        }

        if (categoryParts.length > 1) {
            const subcategoryTargets = subcategoryParts.length
                ? subcategoryParts
                : [subcategoryTerm]
            const tierRules = []

            subcategoryTargets.forEach((subcategoryPart) => {
                categoryParts.forEach((categoryPart) => {
                    tierRules.push(
                        createTextSearchRule(
                            joinSearchTerms(categoryPart, subcategoryPart),
                        ),
                    )
                })
            })

            addTier(tierRules)
        }

        return tiers
    }

    /**
     * Builds Algolia search plans for one category.
     *
     * @param {{id: string, label: string, subcategories: {id: string, label: string}[]}} category Selected category.
     * @returns {{category: {id: string, label: string}, subcategory: {id: string, label: string} | null, query: string, queryType: string}[]} Search plans.
     */
    function getCategoryRecommendationSearchPlans(category) {
        const categorySummary = {
            id: category.id,
            label: category.label,
        }
        const subcategories = Array.isArray(category.subcategories)
            ? category.subcategories
            : []
        const queryTargets = subcategories.length ? subcategories : [null]

        return queryTargets
            .map((subcategory) => ({
                category: categorySummary,
                subcategory,
                query: getCategoryRecommendationQuery(categorySummary, subcategory),
                queryType: subcategory
                    ? 'category_subcategory'
                    : 'category',
            }))
            .filter((searchPlan) => searchPlan.query)
    }

    /**
     * Builds a recommendation issue object for logs, saved data, and UI fallback text.
     *
     * @param {string} code Machine-readable issue code.
     * @param {string} message Reader-facing issue message.
     * @param {object} [details] Extra debug details.
     * @returns {object} Recommendation issue.
     */
    function createRecommendationIssue(code, message, details = {}) {
        return {
            code,
            message,
            ...details,
        }
    }

    /**
     * Reads Algolia search settings from page config.
     *
     * Supported sources, in priority order:
     * - window.starterQuizAlgoliaConfig = { appId, searchKey, indexName }
     * - an element with data-starter-quiz-algolia-* attributes
     * - the existing wf-algolia script[data-app-id][data-search-key]
     * - a WF-Algolia browse/search wrapper with wf-algolia-index
     *
     * @returns {{appId: string, searchKey: string, indexName: string}} Algolia config.
     */
    function getAlgoliaSearchConfig() {
        const windowConfig = window.starterQuizAlgoliaConfig || {}
        const explicitElement = document.querySelector(
            '[data-starter-quiz-algolia-app-id], [data-algolia-app-id]',
        )
        const wfAlgoliaScript = document.querySelector(
            'script[data-app-id][data-search-key]',
        )
        const wfAlgoliaIndexElement = document.querySelector('[wf-algolia-index]')

        return {
            appId:
                normalize(windowConfig.appId) ||
                normalize(explicitElement?.dataset.starterQuizAlgoliaAppId) ||
                normalize(explicitElement?.dataset.algoliaAppId) ||
                normalize(wfAlgoliaScript?.getAttribute('data-app-id')) ||
                algoliaDefaultAppId,
            searchKey:
                normalize(windowConfig.searchKey) ||
                normalize(explicitElement?.dataset.starterQuizAlgoliaSearchKey) ||
                normalize(explicitElement?.dataset.algoliaSearchKey) ||
                normalize(wfAlgoliaScript?.getAttribute('data-search-key')),
            indexName:
                normalize(windowConfig.indexName) ||
                normalize(explicitElement?.dataset.starterQuizAlgoliaIndexName) ||
                normalize(explicitElement?.dataset.algoliaIndexName) ||
                normalize(wfAlgoliaScript?.getAttribute('data-index-name')) ||
                normalize(wfAlgoliaScript?.getAttribute('data-index')) ||
                normalize(wfAlgoliaIndexElement?.getAttribute('wf-algolia-index')) ||
                algoliaDefaultIndexName,
        }
    }

    /**
     * Searches Algolia for recommendation candidates using a search-only key.
     *
     * Accepts a plain query string or a search rule object so callers can run a
     * faceted lookup (such as an exact categories.lvl1 match) alongside the
     * broader free-text tiers.
     *
     * @param {string | {query?: string, facetFilters?: Array}} searchRule Query text or rule.
     * @returns {Promise<object[]>} Raw Algolia hits.
     */
    async function searchRecommendedFreelancers(searchRule) {
        const rule =
            typeof searchRule === 'string'
                ? { query: searchRule, facetFilters: null }
                : searchRule || {}
        const query = normalize(rule.query)
        const facetFilters = rule.facetFilters || null

        if (!query && !facetFilters) return []

        const config = getAlgoliaSearchConfig()

        if (!config.searchKey) {
            throw new Error(
                'Algolia search key missing. Add data-search-key to the wf-algolia script, set window.starterQuizAlgoliaConfig.searchKey, or add data-starter-quiz-algolia-search-key.',
            )
        }

        const response = await fetch(
            'https://' +
                encodeURIComponent(config.appId) +
                '-dsn.algolia.net/1/indexes/' +
                encodeURIComponent(config.indexName) +
                '/query',
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-algolia-api-key': config.searchKey,
                    'x-algolia-application-id': config.appId,
                },
                body: JSON.stringify({
                    query,
                    hitsPerPage: recommendedFreelancerCandidateLimit,
                    attributesToRetrieve: [
                        'name',
                        'slug',
                        'profile-photo',
                        'roles',
                        'functions',
                        'skills',
                        'rate',
                        'paid-call-rate',
                        'retainer-rate',
                        'average-project-size',
                        'roles-concatenate',
                        'previous-company',
                        'bio',
                        'tagline',
                        'free-consulting-calls-t-f',
                        'paid-consulting-calls-t-f',
                        'availability',
                        'ranking-points',
                        'categories',
                        'archived',
                        'draft',
                        'objectID',
                    ],
                    ...(facetFilters ? { facetFilters } : {}),
                    clickAnalytics: true,
                }),
            },
        )

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(
                'Algolia search failed with ' +
                    response.status +
                    ': ' +
                    errorText,
            )
        }

        const algoliaResponse = await response.json()

        return Array.isArray(algoliaResponse.hits) ? algoliaResponse.hits : []
    }

    /**
     * Counts the total freelancer records matching the selected categories at the
     * categories.lvl0 level.
     *
     * Runs a single facet query that ORs every selected category's lvl0 value, so
     * the returned total is the unique pool of freelancers tagged in any selected
     * category (not just the candidates surfaced for display). Returns null when
     * there is nothing to count or the count query fails, so callers can fall back
     * to the displayed candidate count.
     *
     * @param {{id: string, label: string}[]} categories Selected recommendation categories.
     * @returns {Promise<number | null>} Total matching lvl0 records, or null.
     */
    async function getMatchingLvl0StarterCount(categories) {
        const facetValues = (Array.isArray(categories) ? categories : [])
            .map((category) => category.label || formatSlugTitle(category.id))
            .map(normalize)
            .filter(Boolean)
        const uniqueFacetValues = Array.from(new Set(facetValues))

        if (!uniqueFacetValues.length) return null

        const config = getAlgoliaSearchConfig()
        if (!config.searchKey) return null

        try {
            const response = await fetch(
                'https://' +
                    encodeURIComponent(config.appId) +
                    '-dsn.algolia.net/1/indexes/' +
                    encodeURIComponent(config.indexName) +
                    '/query',
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-algolia-api-key': config.searchKey,
                        'x-algolia-application-id': config.appId,
                    },
                    body: JSON.stringify({
                        query: '',
                        hitsPerPage: 0,
                        attributesToRetrieve: [],
                        // Inner array = OR, so this counts records tagged in any
                        // selected category.
                        facetFilters: [
                            uniqueFacetValues.map(
                                (value) => 'categories.lvl0:' + value,
                            ),
                        ],
                        analytics: false,
                    }),
                },
            )

            if (!response.ok) {
                logQuizFlow('lvl0 starter count query failed', {
                    status: response.status,
                })
                return null
            }

            const algoliaResponse = await response.json()
            const nbHits = Number(algoliaResponse?.nbHits)

            return Number.isFinite(nbHits) && nbHits >= 0 ? nbHits : null
        } catch (error) {
            logQuizFlow('lvl0 starter count query errored', {
                error: error?.message || String(error),
            })
            return null
        }
    }

    /**
     * Builds a plain {id, label} summary for a matched selection, or null.
     *
     * @param {{id?: string, label?: string} | null | undefined} selection Matched category or subcategory.
     * @returns {{id: string, label: string} | null} Selection summary.
     */
    function getMatchedSelectionSummary(selection) {
        if (!selection) return null

        const id = normalize(selection.id)
        const label = normalize(selection.label)

        if (!id && !label) return null

        return { id, label }
    }

    /**
     * Normalizes and deduplicates Algolia hits, tagging each candidate with the
     * quiz category/subcategory selection that surfaced it.
     *
     * @param {object[]} hits Raw Algolia hits.
     * @param {{id?: string, label?: string} | null} [matchedCategory] Selected category that produced these hits.
     * @param {{id?: string, label?: string} | null} [matchedSubcategory] Selected subcategory that produced these hits.
     * @returns {object[]} Normalized recommendation candidates.
     */
    function getRecommendedFreelancerCandidates(
        hits,
        matchedCategory = null,
        matchedSubcategory = null,
    ) {
        const seenObjectIds = new Set()
        const matchedCategorySummary = getMatchedSelectionSummary(matchedCategory)
        const matchedSubcategorySummary =
            getMatchedSelectionSummary(matchedSubcategory)

        return hits
            .filter((hit) => {
                const objectId = normalize(hit?.objectID)
                if (!objectId || seenObjectIds.has(objectId)) return false
                if (hit?.archived === true) return false

                seenObjectIds.add(objectId)
                return true
            })
            .map((hit) => ({
                ...hit,
                objectID: normalize(hit.objectID),
                name: normalize(hit.name),
                slug: normalize(hit.slug),
                profilePhoto: normalize(hit['profile-photo']),
                roles: normalizeAlgoliaList(hit.roles).map(formatSlugTitle),
                functions: normalizeAlgoliaList(hit.functions).map(
                    formatSlugTitle,
                ),
                skills: normalizeAlgoliaList(hit.skills),
                rate: hit.rate ?? null,
                paidCallRate: hit['paid-call-rate'] ?? null,
                retainerRate: hit['retainer-rate'] ?? null,
                hourlyRate: getFirstHitFieldValue(hit, hourlyRateFieldNames),
                projectRate: getFirstHitFieldValue(hit, projectRateFieldNames),
                subcategories: getSubcategoryLabels(hit),
                previousCompany: normalize(hit['previous-company']),
                bio: stripHtml(hit.bio),
                freeConsultingCalls: hit['free-consulting-calls-t-f'] === true,
                paidConsultingCalls: hit['paid-consulting-calls-t-f'] === true,
                matchedCategory: matchedCategorySummary,
                matchedSubcategory: matchedSubcategorySummary,
                availability: normalize(hit.availability),
                rankingPoints: getRankingPoints(hit['ranking-points']),
            }))
    }

    /**
     * Deduplicates normalized candidates by objectID.
     *
     * @param {object[]} candidates Normalized recommendation candidates.
     * @returns {object[]} Deduplicated candidates.
     */
    function getUniqueRecommendedFreelancerCandidates(candidates) {
        const seenObjectIds = new Set()

        return candidates.filter((candidate) => {
            if (!candidate.objectID || seenObjectIds.has(candidate.objectID)) {
                return false
            }

            seenObjectIds.add(candidate.objectID)
            return true
        })
    }

    /**
     * Ranks a candidate's matched query tier (lower is more specific/better).
     *
     * @param {object} candidate Normalized recommendation candidate.
     * @returns {number} Tier rank; tier 1 first, fallback and untagged last.
     */
    function getQueryTierRank(candidate) {
        const tier = candidate?.matchedQueryTier

        if (typeof tier === 'number' && Number.isFinite(tier)) return tier
        if (tier === 'fallback') return 100

        return 1000
    }

    /**
     * Compares candidates by query tier first (tier 1 highest), then by ranking
     * points (highest first), then by name.
     *
     * @param {object} first First candidate.
     * @param {object} second Second candidate.
     * @returns {number} Sort comparison result.
     */
    function compareByTierThenPoints(first, second) {
        return (
            getQueryTierRank(first) - getQueryTierRank(second) ||
            second.rankingPoints - first.rankingPoints ||
            first.name.localeCompare(second.name)
        )
    }

    /**
     * Orders candidates by query tier then ranking points. When no candidate has
     * points, candidates are shuffled and then stably grouped by tier.
     *
     * @param {object[]} candidates Normalized recommendation candidates.
     * @returns {object[]} Ordered candidates.
     */
    function orderRecommendedFreelancerCandidates(candidates) {
        const hasAnyRankedCandidate = candidates.some((candidate) =>
            hasRankingPoints(candidate.rankingPoints),
        )

        if (!hasAnyRankedCandidate) {
            return shuffleItems(candidates).sort(
                (first, second) =>
                    getQueryTierRank(first) - getQueryTierRank(second),
            )
        }

        return [...candidates].sort(compareByTierThenPoints)
    }

    /**
     * Gathers candidates for one search plan, broadening the query in tiers
     * until enough unique candidates are found.
     *
     * Runs the most specific query tier first, then expands compound terms (see
     * buildCategoryRecommendationQueryTiers) only while the accumulated, points-
     * sorted candidate pool stays below termExpansionTargetCount.
     *
     * @param {{category: {id: string, label: string}, subcategory: {id: string, label: string} | null, query: string, queryType: string}} searchPlan Search plan.
     * @param {{strict?: boolean}} [options] Search options (such as strict facet-only mode).
     * @returns {Promise<{candidates: object[], hits: object[], queriesRun: object[], error: Error | null}>} Gathered candidates and search metadata.
     */
    async function gatherSearchPlanCandidates(searchPlan, options = {}) {
        const tiers = buildCategoryRecommendationQueryTiers(
            searchPlan.category,
            searchPlan.subcategory,
            { strict: Boolean(options.strict) },
        )
        const accumulatedHits = []
        const queriesRun = []
        const errors = []
        // Remembers the first query/tier that surfaced each freelancer.
        const originByObjectId = new Map()
        let candidates = []

        for (let tierIndex = 0; tierIndex < tiers.length; tierIndex += 1) {
            const tierResults = await Promise.all(
                tiers[tierIndex].map(async (rule) => {
                    try {
                        const hits = await searchRecommendedFreelancers(rule)
                        return { query: rule.label, hits, error: null }
                    } catch (error) {
                        return { query: rule.label, hits: [], error }
                    }
                }),
            )

            tierResults.forEach((tierResult) => {
                queriesRun.push({
                    tier: tierIndex + 1,
                    query: tierResult.query,
                    hitCount: tierResult.hits.length,
                    errorMessage: tierResult.error?.message || null,
                })

                if (tierResult.error) {
                    errors.push(tierResult.error)
                    return
                }

                tierResult.hits.forEach((hit) => {
                    const objectId = normalize(hit?.objectID)
                    if (objectId && !originByObjectId.has(objectId)) {
                        originByObjectId.set(objectId, {
                            query: tierResult.query,
                            tier: tierIndex + 1,
                        })
                    }
                })

                accumulatedHits.push(...tierResult.hits)
            })

            candidates = orderRecommendedFreelancerCandidates(
                getRecommendedFreelancerCandidates(
                    accumulatedHits,
                    searchPlan.category,
                    searchPlan.subcategory,
                ),
            )

            if (candidates.length >= termExpansionTargetCount) break
        }

        candidates.forEach((candidate) => {
            const origin = originByObjectId.get(candidate.objectID)
            if (origin) {
                candidate.matchedQuery = origin.query
                candidate.matchedQueryTier = origin.tier
            }
        })

        return {
            candidates,
            hits: accumulatedHits,
            queriesRun,
            error: errors[0] || null,
        }
    }

    /**
     * Gets the top recommendations from a candidate list.
     *
     * @param {object[]} candidates Normalized recommendation candidates.
     * @param {number} limit Maximum recommendations to return.
     * @param {Set<string>} [excludedObjectIds] Object IDs to exclude.
     * @returns {object[]} Top recommendations.
     */
    function getTopRecommendedFreelancers(
        candidates,
        limit,
        excludedObjectIds = new Set(),
    ) {
        const availableCandidates = candidates.filter((candidate) => {
            return !excludedObjectIds.has(candidate.objectID)
        })
        const orderedCandidates =
            orderRecommendedFreelancerCandidates(availableCandidates)

        return orderedCandidates.slice(0, limit)
    }

    /**
     * Selects featured freelancers with a round-robin draft across categories.
     *
     * Round 1 takes the single highest-ranked candidate from each category, so
     * every selected category is represented before any category repeats. Only
     * once every category has contributed does the next round pull each
     * category's next-best candidate, and so on until the limit is reached.
     * When a round has more category picks than remaining slots, the
     * highest-ranked picks win the partial round.
     *
     * @param {{category: {id: string, label: string}, candidates: object[]}[]} categoryCandidatePools Per-category ordered candidate pools.
     * @param {number} limit Maximum featured freelancers to return.
     * @returns {object[]} Featured freelancers, at most one per category per round.
     */
    /**
     * Drafts candidates round-robin across several ordered pools.
     *
     * Each round takes the single best remaining candidate from every pool, so
     * every pool is represented before any pool repeats. Round picks are
     * tie-broken by tier then points, and duplicates (by objectID) across pools
     * or already-excluded ids are skipped.
     *
     * @param {object[][]} pools Ordered candidate pools (best-first).
     * @param {number} limit Maximum candidates to return.
     * @param {Set<string>} [excludedObjectIds] Object IDs to skip entirely.
     * @returns {object[]} Drafted candidates, at most one per pool per round.
     */
    function draftRoundRobin(pools, limit, excludedObjectIds = new Set()) {
        const pendingPools = pools.map((candidates) => candidates.slice())
        const selectedFreelancers = []
        const selectedObjectIds = new Set()

        while (selectedFreelancers.length < limit) {
            const roundPicks = []
            const roundObjectIds = new Set()

            pendingPools.forEach((candidates) => {
                while (candidates.length) {
                    const candidate = candidates.shift()

                    if (
                        excludedObjectIds.has(candidate.objectID) ||
                        selectedObjectIds.has(candidate.objectID) ||
                        roundObjectIds.has(candidate.objectID)
                    ) {
                        continue
                    }

                    roundPicks.push(candidate)
                    roundObjectIds.add(candidate.objectID)
                    break
                }
            })

            if (!roundPicks.length) break

            roundPicks.sort(compareByTierThenPoints)

            roundPicks.forEach((candidate) => {
                if (selectedFreelancers.length >= limit) return

                selectedFreelancers.push(candidate)
                selectedObjectIds.add(candidate.objectID)
            })
        }

        return selectedFreelancers
    }

    function selectFeaturedFreelancers(categoryCandidatePools, limit) {
        // Each pool is already ordered best-first by getTopRecommendedFreelancers.
        return draftRoundRobin(
            categoryCandidatePools.map((pool) => pool.candidates),
            limit,
        )
    }

    /**
     * Creates a DOM card for one recommended freelancer.
     *
     * @param {object} freelancer Normalized freelancer recommendation.
     * @returns {HTMLElement} Renderable recommendation card.
     */
    function createRecommendedFreelancerElement(freelancer) {
        const cardElement = document.createElement('article')
        cardElement.className = 'quiz-result-freelancer-card'
        cardElement.dataset.freelancerObjectId = freelancer.objectID
        cardElement.dataset.freelancerRankingPoints = String(
            freelancer.rankingPoints || 0,
        )

        if (freelancer.profilePhoto) {
            const imageElement = document.createElement('img')
            imageElement.className = 'quiz-result-freelancer-image'
            imageElement.src = freelancer.profilePhoto
            imageElement.alt = freelancer.name
            imageElement.loading = 'lazy'
            cardElement.appendChild(imageElement)
        }

        const nameElement = document.createElement('h3')
        nameElement.className = 'quiz-result-freelancer-name'
        nameElement.textContent = freelancer.name || 'Recommended Starter'
        cardElement.appendChild(nameElement)

        const matchedCategoryLabel = normalize(freelancer.matchedCategory?.label)
        const matchedSubcategoryLabel = normalize(
            freelancer.matchedSubcategory?.label,
        )

        if (matchedCategoryLabel || matchedSubcategoryLabel) {
            const selectedElement = document.createElement('p')
            selectedElement.className = 'quiz-result-freelancer-selected'

            if (matchedCategoryLabel) {
                selectedElement.dataset.selectedCategory = matchedCategoryLabel
                const categorySpan = document.createElement('span')
                categorySpan.className =
                    'quiz-result-freelancer-selected-category'
                categorySpan.textContent = matchedCategoryLabel
                selectedElement.appendChild(categorySpan)
            }

            if (matchedSubcategoryLabel) {
                selectedElement.dataset.selectedSubcategory =
                    matchedSubcategoryLabel

                if (matchedCategoryLabel) {
                    const separatorSpan = document.createElement('span')
                    separatorSpan.className =
                        'quiz-result-freelancer-selected-separator'
                    separatorSpan.textContent = ' › '
                    selectedElement.appendChild(separatorSpan)
                }

                const subcategorySpan = document.createElement('span')
                subcategorySpan.className =
                    'quiz-result-freelancer-selected-subcategory'
                subcategorySpan.textContent = matchedSubcategoryLabel
                selectedElement.appendChild(subcategorySpan)
            }

            cardElement.appendChild(selectedElement)
        }

        const disciplines = Array.isArray(freelancer.functions)
            ? freelancer.functions
            : []
        const metaText = (disciplines.length ? disciplines : freelancer.roles)
            .slice(0, 3)
            .join(', ')

        if (metaText) {
            const metaElement = document.createElement('p')
            metaElement.className = 'quiz-result-freelancer-meta'
            metaElement.textContent = metaText
            cardElement.appendChild(metaElement)
        }

        const subcategories = Array.isArray(freelancer.subcategories)
            ? freelancer.subcategories
            : []

        if (subcategories.length) {
            const subcategoryElement = document.createElement('p')
            subcategoryElement.className = 'quiz-result-freelancer-subcategory'
            subcategoryElement.textContent = subcategories
                .slice(0, maxDisplayedSubcategories)
                .join(', ')
            cardElement.appendChild(subcategoryElement)
        }

        const hourlyRateText = formatRateValue(freelancer.hourlyRate)
        if (hourlyRateText) {
            const hourlyRateElement = document.createElement('p')
            hourlyRateElement.className = 'quiz-result-freelancer-hourly-rate'
            hourlyRateElement.textContent = 'Hourly rate: ' + hourlyRateText
            cardElement.appendChild(hourlyRateElement)
        }

        const projectRateText = formatRateValue(freelancer.projectRate)
        if (projectRateText) {
            const projectRateElement = document.createElement('p')
            projectRateElement.className = 'quiz-result-freelancer-project-rate'
            projectRateElement.textContent = 'Project rate: ' + projectRateText
            cardElement.appendChild(projectRateElement)
        }

        const pointsElement = document.createElement('p')
        pointsElement.className = 'quiz-result-freelancer-points'
        pointsElement.textContent =
            'Points: ' + Number(freelancer.rankingPoints || 0).toLocaleString()
        cardElement.appendChild(pointsElement)

        // Diagnostic: which query/tier surfaced this card. Debug-only so it does
        // not appear on the production results page.
        const matchedQuery = normalize(freelancer.matchedQuery)
        if (matchedQuery) {
            cardElement.dataset.matchedQuery = matchedQuery
            cardElement.dataset.matchedQueryTier = String(
                freelancer.matchedQueryTier || '',
            )
        }

        if (matchedQuery && isDebugLoggingEnabled()) {
            const queryElement = document.createElement('p')
            queryElement.className = 'quiz-result-freelancer-query'
            const tierLabel = freelancer.matchedQueryTier
                ? freelancer.matchedQueryTier === 'fallback'
                    ? 'fallback'
                    : 'tier ' + freelancer.matchedQueryTier
                : ''
            queryElement.textContent =
                'Matched query: "' +
                matchedQuery +
                '"' +
                (tierLabel ? ' · ' + tierLabel : '')
            cardElement.appendChild(queryElement)
        }

        return cardElement
    }

    /**
     * Creates a DOM group for one category's recommended freelancers.
     *
     * @param {{category: {id: string, label: string}, recommendations: object[]}} group Recommendation group.
     * @returns {HTMLElement} Renderable recommendation group.
     */
    function createRecommendedFreelancerGroupElement(group) {
        const groupElement = document.createElement('section')
        groupElement.className = 'quiz-result-freelancer-group'
        groupElement.dataset.resultRecommendationCategory = group.category.id

        const titleElement = document.createElement('h3')
        titleElement.className = 'quiz-result-freelancer-group-title'
        titleElement.textContent = group.category.label || group.category.id
        groupElement.appendChild(titleElement)

        const listElement = document.createElement('div')
        listElement.className = 'quiz-result-freelancer-list'

        if (!group.recommendations.length) {
            listElement.textContent =
                group.message || 'No recommended freelancers found.'
        } else {
            group.recommendations.forEach((freelancer) => {
                listElement.appendChild(
                    createRecommendedFreelancerElement(freelancer),
                )
            })
        }

        groupElement.appendChild(listElement)

        return groupElement
    }

    /**
     * Creates the featured recommendation group.
     *
     * @param {object[]} featuredFreelancers Featured recommendation records.
     * @returns {HTMLElement} Renderable featured group.
     */
    function createFeaturedFreelancerGroupElement(featuredFreelancers) {
        const groupElement = document.createElement('div')
        groupElement.className =
            'quiz-result-freelancer-group quiz-result-featured-freelancers'
        groupElement.dataset.resultRecommendationCategory = 'featured'
        groupElement.dataset.resultFeaturedRecommendationsGroup = ''

        const titleElement = document.createElement('h3')
        titleElement.className = 'quiz-result-freelancer-group-title'
        titleElement.textContent = 'Featured Starters'
        groupElement.appendChild(titleElement)

        const listElement = document.createElement('div')
        listElement.className =
            'quiz-result-freelancer-list quiz-result-featured-freelancer-list'
        listElement.dataset.resultFeaturedRecommendationItems = ''

        featuredFreelancers.forEach((freelancer) => {
            listElement.appendChild(createRecommendedFreelancerElement(freelancer))
        })

        groupElement.appendChild(listElement)

        return groupElement
    }

    /**
     * Builds a privacy-safe display name for locked cards: the first word in
     * full, every remaining word reduced to an uppercased initial.
     * "Marcus James Smith" -> "Marcus J. S."
     *
     * @param {string} name Full name.
     * @returns {string} First name plus trailing initials.
     */
    function getLockedDisplayName(name) {
        const parts = normalize(name).split(/\s+/).filter(Boolean)
        if (!parts.length) return ''

        const [first, ...rest] = parts
        const initials = rest.map((word) => word[0].toUpperCase() + '.')

        return [first, ...initials].join(' ')
    }

    /**
     * Resolves a card binding field name to a value on a normalized candidate.
     *
     * @param {object} freelancer Normalized freelancer recommendation.
     * @param {string} field Binding field name (raw Algolia name).
     * @returns {unknown} Field value.
     */
    function getCardFieldValue(freelancer, field) {
        switch (field) {
            case 'name':
                return freelancer.name
            case 'locked-name':
                return getLockedDisplayName(freelancer.name)
            case 'slug':
                return freelancer.slug
            case 'profile-photo':
                return freelancer.profilePhoto
            case 'roles':
                return freelancer.roles
            case 'functions':
                return freelancer.functions
            case 'skills':
                return freelancer.skills
            case 'rate':
            case 'hourly-rate':
                return freelancer.hourlyRate ?? freelancer.rate
            case 'paid-call-rate':
                return freelancer.paidCallRate ?? freelancer['paid-call-rate']
            case 'retainer-rate':
                return freelancer.retainerRate ?? freelancer['retainer-rate']
            case 'average-project-size':
            case 'project-rate':
                return freelancer.projectRate
            case 'previous-company':
                return freelancer.previousCompany
            case 'bio':
                return freelancer.bio
            case 'availability':
                return freelancer.availability
            case 'ranking-points':
                return freelancer.rankingPoints
            case 'matched-query':
                return freelancer.matchedQuery
            case 'matched-query-tier':
            case 'query-tier':
                return freelancer.matchedQueryTier
            case 'matched-category':
            case 'matched-main-category':
            case 'main-category':
                return (
                    freelancer.matchedCategory?.label ||
                    freelancer.matchedCategory?.id
                )
            case 'matched-subcategory':
            case 'subcategory':
                return (
                    freelancer.matchedSubcategory?.label ||
                    freelancer.matchedSubcategory?.id
                )
            case 'free-consulting-calls-t-f':
                return freelancer.freeConsultingCalls
            case 'paid-consulting-calls-t-f':
                return freelancer.paidConsultingCalls
            default:
                return freelancer[field]
        }
    }

    /**
     * Checks whether a bound field value should count as empty (hidden).
     *
     * Numeric 0 counts as empty so $0 rates/sizes hide rather than render.
     *
     * @param {unknown} value Field value.
     * @returns {boolean} True when the value is empty.
     */
    function isEmptyCardValue(value) {
        if (value === null || value === undefined) return true
        if (Array.isArray(value)) return value.length === 0
        if (typeof value === 'boolean') return value === false
        if (typeof value === 'number') {
            return !Number.isFinite(value) || value === 0
        }
        return normalize(String(value)) === ''
    }

    /**
     * Formats a bound value for display.
     *
     * @param {unknown} value Field value.
     * @param {string} format One of currency, number, rank, or empty.
     * @returns {string} Formatted text.
     */
    function formatCardValue(value, format) {
        if (format === 'currency') {
            return '$' + getRankingPoints(value).toLocaleString()
        }
        if (format === 'number') {
            return getRankingPoints(value).toLocaleString()
        }
        if (format === 'rank') {
            return '#' + getRankingPoints(value)
        }
        return stripHtml(value)
    }

    /**
     * Splits a multi-value field (slash/semicolon/comma) into clean parts.
     *
     * @param {unknown} value Field value.
     * @returns {string[]} Parts.
     */
    function splitMultiValue(value) {
        if (Array.isArray(value)) return value.map(normalize).filter(Boolean)
        return normalize(String(value || ''))
            .split(/\s*[/;,]\s*/)
            .map(normalize)
            .filter(Boolean)
    }

    /**
     * Gets the first non-empty value from a primary card field and optional
     * fallback fields.
     *
     * @param {object} freelancer Normalized freelancer recommendation.
     * @param {string} primaryField Primary data-quiz field.
     * @param {string} fallbackFields Comma, pipe, semicolon, or slash-separated fallback fields.
     * @returns {unknown} First non-empty field value.
     */
    function getCardFieldValueWithFallbacks(
        freelancer,
        primaryField,
        fallbackFields,
    ) {
        const fields = [
            primaryField,
            ...normalize(fallbackFields)
                .split(/\s*[,|;/]\s*/)
                .filter(Boolean),
        ]

        for (const field of fields) {
            const value = getCardFieldValue(freelancer, field)
            if (!isEmptyCardValue(value)) return value
        }

        return null
    }

    /**
     * Sets an element's text, or hides it (.hide) when the value is empty.
     *
     * @param {HTMLElement} element Target element.
     * @param {string} text Display text.
     * @returns {boolean} True when text was shown.
     */
    function setCardText(element, text) {
        const value = normalize(text)

        if (!value) {
            element.classList.add('hide')
            return false
        }

        element.textContent = value
        element.classList.remove('hide')
        return true
    }

    /**
     * Populates one existing card element from a freelancer recommendation.
     *
     * Reads data-quiz-* attributes inside the card and hides empty slots. A
     * missing data-quiz-required field fails the card (caller hides it).
     *
     * @param {HTMLElement} cardElement Existing card/slide element.
     * @param {object} freelancer Normalized freelancer recommendation.
     * @param {number} position 1-based position within the card group.
     * @returns {boolean} True when all required fields were present.
     */
    function bindRecommendationCard(cardElement, freelancer, position) {
        let requiredSatisfied = true

        cardElement.dataset.freelancerObjectId = freelancer.objectID || ''

        const failIfRequired = (element) => {
            if (element.hasAttribute('data-quiz-required')) {
                requiredSatisfied = false
            }
        }

        // Visibility toggles based on a field's truthiness.
        cardElement
            .querySelectorAll('[data-quiz-show-if]')
            .forEach((element) => {
                const field = element.getAttribute('data-quiz-show-if')
                const isShown = !isEmptyCardValue(getCardFieldValue(freelancer, field))
                element.classList.toggle('hide', !isShown)
            })

        // Images.
        cardElement.querySelectorAll('[data-quiz-img]').forEach((element) => {
            const field = element.getAttribute('data-quiz-img')
            const url = normalize(getCardFieldValue(freelancer, field))

            if (!url) {
                element.classList.add('hide')
                failIfRequired(element)
                return
            }

            element.setAttribute('src', url)
            element.setAttribute('alt', normalize(freelancer.name))
            element.classList.remove('hide')
        })

        // Single-value text bindings (supports the rank-role composite token).
        cardElement.querySelectorAll('[data-quiz-text]').forEach((element) => {
            const field = element.getAttribute('data-quiz-text')
            const fallbackFields =
                element.getAttribute('data-quiz-fallback') ||
                element.getAttribute('data-quiz-fallback-fields') ||
                ''
            const format = element.getAttribute('data-quiz-format') || ''

            if (field === 'rank-role') {
                // Show the record's OWN subcategory, not the quiz selection that
                // surfaced it: prefer the record subcategory equal to the matched
                // selection, then the record's primary subcategory, and only fall
                // back to the matched selection when the record carries none.
                const subcategories = Array.isArray(freelancer.subcategories)
                    ? freelancer.subcategories
                    : []
                const matched = normalize(freelancer.matchedSubcategory?.label)
                const matchedSlug = slugify(matched)
                const ownMatch = subcategories.find(
                    (label) => matchedSlug && slugify(label) === matchedSlug,
                )
                const subcategory =
                    normalize(ownMatch) || normalize(subcategories[0]) || matched
                const shown = setCardText(
                    element,
                    subcategory ? formatSlugTitle(subcategory) : '',
                )
                if (!shown) failIfRequired(element)
                return
            }

            const value = getCardFieldValueWithFallbacks(
                freelancer,
                field,
                fallbackFields,
            )

            if (isEmptyCardValue(value)) {
                element.classList.add('hide')
                failIfRequired(element)
                return
            }

            setCardText(element, formatCardValue(value, format))
        })

        // Indexed list item bindings (e.g. roles[0], roles[1], roles[2]).
        cardElement.querySelectorAll('[data-quiz-list]').forEach((element) => {
            const field = element.getAttribute('data-quiz-list')
            const index = Number.parseInt(
                element.getAttribute('data-quiz-index') || '0',
                10,
            )
            const values = splitMultiValue(getCardFieldValue(freelancer, field))
            const shown = setCardText(element, values[index] || '')
            if (!shown) failIfRequired(element)
        })

        // Joined multi-value bindings (e.g. previous companies).
        cardElement.querySelectorAll('[data-quiz-join]').forEach((element) => {
            const field = element.getAttribute('data-quiz-join')
            const separator = element.getAttribute('data-quiz-sep') || ', '
            const joined = splitMultiValue(
                getCardFieldValue(freelancer, field),
            ).join(separator)
            const shown = setCardText(element, joined)
            if (!shown) failIfRequired(element)
        })

        // Link bindings: fill an href from a "/hire/{slug}" style template,
        // mirroring wf-algolia's hit-link-template. {field} tokens are replaced
        // from the hit and URL-encoded. The element is hidden if a token is empty.
        cardElement.querySelectorAll('[data-quiz-link]').forEach((element) => {
            const template = element.getAttribute('data-quiz-link') || ''
            let hasMissingToken = false

            const url = template.replace(/\{([^}]+)\}/g, (match, field) => {
                const value = normalize(
                    String(getCardFieldValue(freelancer, field.trim()) ?? ''),
                )
                if (!value) {
                    hasMissingToken = true
                    return ''
                }
                return encodeURIComponent(value)
            })

            if (hasMissingToken || !url) {
                element.classList.add('hide')
                failIfRequired(element)
                return
            }

            element.setAttribute('href', url)
            element.classList.remove('hide')
        })

        return requiredSatisfied
    }

    /**
     * Finds the enclosing Swiper instance for a node and remeasures it.
     *
     * @param {HTMLElement | null} node Node inside a swiper.
     * @returns {void}
     */
    function refreshEnclosingSwiper(node) {
        const swiperEl = node?.closest('[data-swiper-scroll="swiper"]')
        const swiper = swiperEl?.__swiperScrollInstance

        if (swiper && typeof swiper.update === 'function') {
            try {
                swiper.update()
            } catch (error) {
                logQuizFlow('swiper update failed', {
                    error: error?.message || String(error),
                })
            }
        }
    }

    function isStaticQuizCard(element) {
        return element?.getAttribute?.('data-quiz-card') === 'static'
    }

    function hasQuizCardMarker(element) {
        return Boolean(
            element?.hasAttribute?.('data-quiz-card') ||
                element?.querySelector?.('[data-quiz-card]'),
        )
    }

    /**
     * Populates a group of cards, cloning the first card to fill when there are
     * more recommendations than existing cards, and hiding any leftover cards.
     *
     * Existing slides are used as-is (no clone) when there are enough. Cards
     * generated to fill the gap are cloned from the first card and tagged with
     * data-quiz-generated so re-runs stay idempotent. Cards marked
     * data-quiz-card="static" are never populated, cloned, hidden, or removed.
     *
     * @param {HTMLElement[]} cards Existing card elements in display order.
     * @param {object[]} freelancers Recommendations to render.
     * @returns {number} Number of cards populated.
     */
    function populateRecommendationCards(cards, freelancers) {
        // Drop clones from a previous run; keep static cards untouched.
        const baseCards = cards.filter((card) => {
            if (isStaticQuizCard(card)) return false
            if (card.hasAttribute('data-quiz-generated')) {
                card.remove()
                return false
            }
            return true
        })

        if (!baseCards.length) return 0

        const template = baseCards[0]
        const parent = template.parentNode
        const renderCards = baseCards.slice()

        // Hide leftover sibling slides that aren't quiz cards (Webflow design
        // placeholders left in the same swiper track), so only real cards show.
        if (parent) {
            Array.from(parent.children).forEach((child) => {
                if (
                    !hasQuizCardMarker(child) &&
                    child.matches('[data-swiper-scroll="swiper-slide"]')
                ) {
                    child.classList.add('hide')
                }
            })
        }

        // Clone the last card to fill any shortfall, inserted right after it so
        // the populated cards stay contiguous ahead of any hidden placeholders.
        let anchor = baseCards[baseCards.length - 1]
        for (
            let index = baseCards.length;
            index < freelancers.length && parent;
            index += 1
        ) {
            const clone = template.cloneNode(true)
            clone.setAttribute('data-quiz-generated', '')
            clone.classList.remove('hide')
            parent.insertBefore(clone, anchor.nextSibling)
            anchor = clone
            renderCards.push(clone)
        }

        let populatedCount = 0

        renderCards.forEach((card, index) => {
            if (index >= freelancers.length) {
                card.classList.add('hide')
                return
            }

            const isValid = bindRecommendationCard(
                card,
                freelancers[index],
                index + 1,
            )
            card.classList.toggle('hide', !isValid)
            if (isValid) populatedCount += 1
        })

        refreshEnclosingSwiper(template)

        return populatedCount
    }

    /**
     * Finds the main-category section element for a recommendation category.
     *
     * @param {{id: string, label: string}} category Recommendation category.
     * @returns {HTMLElement | null} Matching [data-toc-algolia-target] section.
     */
    function findTocSectionForCategory(category) {
        const keys = new Set()
        const id = getItemId(category)
        const label = getItemLabel(category)

        if (id) {
            keys.add(id.toLowerCase())
            keys.add(slugify(id))
        }
        if (label) keys.add(slugify(label))

        const sections = Array.from(
            document.querySelectorAll('[data-toc-algolia-target]'),
        )

        return (
            sections.find((section) => {
                const value = normalize(
                    section.getAttribute('data-toc-algolia-target'),
                )
                return (
                    keys.has(value.toLowerCase()) || keys.has(slugify(value))
                )
            }) || null
        )
    }

    /**
     * Populates pre-built Webflow cards in place (no cloning).
     *
     * Featured cards live in [data-quiz-algolia-list="featured"]; each category's
     * cards live in its [data-toc-algolia-target] section. Cards are marked with
     * data-quiz-card.
     *
     * @param {object[]} featuredFreelancers Featured recommendations.
     * @param {{category: {id: string, label: string}, recommendations: object[]}[]} groups Category recommendation groups.
     * @returns {void}
     */
    function populateExistingRecommendationCards(featuredFreelancers, groups) {
        // Featured cards are selected by their marker, not by a wrapper, since
        // they may live outside any [data-quiz-algolia-list="featured"] block.
        const featuredCards = Array.from(
            document.querySelectorAll('[data-quiz-card="featured"]'),
        )
        if (featuredCards.length) {
            populateRecommendationCards(featuredCards, featuredFreelancers)
        }

        groups.forEach((group) => {
            const section = findTocSectionForCategory(group.category)
            if (!section) {
                logQuizFlow('no TOC section found for category cards', {
                    category: group.category,
                })
                return
            }

            const cards = Array.from(section.querySelectorAll('[data-quiz-card]'))
            if (cards.length) {
                populateRecommendationCards(
                    cards,
                    group.recommendations || [],
                )
            }
        })

        logQuizFlow('populated existing recommendation cards', {
            featuredCount: featuredFreelancers.length,
            groupCount: groups.length,
        })
    }

    /**
     * Renders recommended freelancers into optional Webflow placeholders.
     *
     * - [data-quiz-algolia-list="featured"]
     * - [data-quiz-algolia-list="categories"]
     * Supported placeholders:
     * - [data-result-featured-recommendations]
     * - [data-result-category-recommendations]
     * - [data-result-featured-recommendations-target]
     * - [data-result-category-recommendations-target]
     * - [data-result-recommendations]
     * - [data-result-freelancers]
     * - [data-recommended-freelancers]
     *
     * @param {{featuredFreelancers?: object[], recommendationGroups?: {category: {id: string, label: string}, recommendations: object[], message?: string}[], recommendationIssues?: object[]}} recommendations Recommendation sections.
     * @returns {void}
     */
    function renderRecommendedFreelancers(recommendations) {
        const featuredFreelancers = Array.isArray(
            recommendations?.featuredFreelancers,
        )
            ? recommendations.featuredFreelancers
            : []
        const groups = Array.isArray(recommendations?.recommendationGroups)
            ? recommendations.recommendationGroups
            : []
        const recommendationIssues = Array.isArray(
            recommendations?.recommendationIssues,
        )
            ? recommendations.recommendationIssues
            : []

        // Prefer populating pre-built Webflow cards in place when present.
        if (document.querySelector('[data-quiz-card]')) {
            populateExistingRecommendationCards(featuredFreelancers, groups)
            return
        }

        const featuredTargets = document.querySelectorAll(
            '[data-quiz-algolia-list="featured"], [data-result-featured-recommendations], [data-result-featured-recommendations-target]',
        )
        const categoryTargets = document.querySelectorAll(
            '[data-quiz-algolia-list="categories"], [data-result-category-recommendations], [data-result-category-recommendations-target]',
        )
        const hasSplitTargets = featuredTargets.length || categoryTargets.length
        let targets = document.querySelectorAll(
            '[data-result-recommendations], [data-result-freelancers], [data-recommended-freelancers]',
        )

        if (!hasSplitTargets && !targets.length) {
            const resultsPanel = document.querySelector('[data-quiz-results]')

            if (resultsPanel) {
                const fallbackSection = document.createElement('section')
                fallbackSection.className = 'quiz-result-recommendations'

                const titleElement = document.createElement('h2')
                titleElement.className = 'quiz-result-recommendations-title'
                titleElement.textContent = 'Recommended Starters'
                fallbackSection.appendChild(titleElement)

                const listElement = document.createElement('div')
                listElement.className = 'quiz-result-freelancer-groups'
                listElement.dataset.resultRecommendations = ''
                fallbackSection.appendChild(listElement)

                resultsPanel.insertAdjacentElement('afterend', fallbackSection)
                targets = document.querySelectorAll('[data-result-recommendations]')
            }
        }

        if (!hasSplitTargets && !targets.length) {
            logQuizFlow('no recommendation render target found')
            return
        }

        const emptyRecommendationMessage =
            recommendationIssues
                .map((issue) => issue.message)
                .filter(Boolean)
                .join(' ') || 'No recommended freelancers found.'

        if (hasSplitTargets) {
            featuredTargets.forEach((target) => {
                target.textContent = ''

                if (featuredFreelancers.length) {
                    target.appendChild(
                        createFeaturedFreelancerGroupElement(featuredFreelancers),
                    )
                } else if (!groups.length) {
                    target.textContent = emptyRecommendationMessage
                }
            })

            categoryTargets.forEach((target) => {
                target.textContent = ''

                if (groups.length) {
                    groups.forEach((group) => {
                        target.appendChild(
                            createRecommendedFreelancerGroupElement(group),
                        )
                    })
                } else if (!featuredFreelancers.length) {
                    target.textContent = emptyRecommendationMessage
                }
            })

            logQuizFlow('rendered recommended freelancers', {
                featuredFreelancers,
                groups,
                recommendationIssues,
                featuredTargetCount: featuredTargets.length,
                categoryTargetCount: categoryTargets.length,
            })
            return
        }

        targets.forEach((target) => {
            target.textContent = ''

            if (!featuredFreelancers.length && !groups.length) {
                target.textContent = emptyRecommendationMessage
                return
            }

            if (featuredFreelancers.length) {
                target.appendChild(
                    createFeaturedFreelancerGroupElement(featuredFreelancers),
                )
            }

            groups.forEach((group) => {
                target.appendChild(createRecommendedFreelancerGroupElement(group))
            })
        })

        logQuizFlow('rendered recommended freelancers', {
            featuredFreelancers,
            groups,
            recommendationIssues,
            targetCount: targets.length,
        })
    }

    /**
     * Loads top freelancer recommendations for the completed quiz.
     *
     * @param {object} pendingQuiz Pending quiz payload.
     * @returns {Promise<{featuredFreelancers: object[], recommendationGroups: {category: {id: string, label: string}, query: string, recommendations: object[]}[]}>} Featured and category recommendations.
     */
    async function getRecommendedFreelancers(pendingQuiz) {
        const categories = getRecommendationCategories(pendingQuiz)
        const strictQueryMode = isStrictRecommendationQueryMode()
        const recommendationIssues = []
        const lvl0StarterCount = await getMatchingLvl0StarterCount(categories)

        if (!categories.length) {
            recommendationIssues.push(
                createRecommendationIssue(
                    'no_selected_categories',
                    'No main quiz categories were available for recommendations.',
                ),
            )
        }

        const searchPlans = categories.flatMap((category) => {
            const plans = getCategoryRecommendationSearchPlans(category)

            if (!plans.length) {
                recommendationIssues.push(
                    createRecommendationIssue(
                        'empty_category_query',
                        'No searchable recommendation query could be built for ' +
                            (category.label || category.id) +
                            '.',
                        { category },
                    ),
                )
            }

            return plans
        })

        if (!searchPlans.length) {
            logQuizFlow('freelancer recommendation search plans were empty', {
                categories,
                recommendationIssues,
            })
            return {
                featuredFreelancers: [],
                recommendationGroups: [],
                starterCount:
                    lvl0StarterCount === null ? 0 : lvl0StarterCount,
                recommendationIssues,
            }
        }

        const searchResults = await Promise.all(
            searchPlans.map(async (searchPlan) => {
                const { candidates, hits, queriesRun, error } =
                    await gatherSearchPlanCandidates(searchPlan, {
                        strict: strictQueryMode,
                    })

                if (error) {
                    recommendationIssues.push(
                        createRecommendationIssue(
                            'search_error',
                            'Algolia search failed for ' +
                                (searchPlan.subcategory?.label ||
                                    searchPlan.category.label ||
                                    searchPlan.category.id) +
                                '.',
                            {
                                category: searchPlan.category,
                                subcategory: searchPlan.subcategory,
                                query: searchPlan.query,
                                queryType: searchPlan.queryType,
                                errorMessage: error?.message || String(error),
                            },
                        ),
                    )
                }

                return {
                    ...searchPlan,
                    hits,
                    candidates,
                    queriesRun,
                    error,
                }
            }),
        )
        const searchResultsWithCandidates = searchResults

        searchResultsWithCandidates.forEach((result) => {
            const searchName =
                result.subcategory?.label ||
                result.category.label ||
                result.category.id

            if (result.error) return

            if (!result.hits.length) {
                recommendationIssues.push(
                    createRecommendationIssue(
                        'no_matching_freelancers',
                        'No matching freelancers were found for ' +
                            searchName +
                            '.',
                        {
                            category: result.category,
                            subcategory: result.subcategory,
                            query: result.query,
                            queryType: result.queryType,
                        },
                    ),
                )
                return
            }

            if (!result.candidates.length) {
                recommendationIssues.push(
                    createRecommendationIssue(
                        'all_matches_filtered',
                        'Matching freelancers for ' +
                            searchName +
                            ' were filtered out because they were archived or missing IDs.',
                        {
                            category: result.category,
                            subcategory: result.subcategory,
                            query: result.query,
                            queryType: result.queryType,
                            hitCount: result.hits.length,
                        },
                    ),
                )
            }
        })

        const categoryCandidatePools = categories.map((category) => {
            const categorySearchResults = searchResultsWithCandidates.filter(
                (result) => result.category.id === category.id,
            )
            const categoryCandidates = getTopRecommendedFreelancers(
                getUniqueRecommendedFreelancerCandidates(
                    categorySearchResults.flatMap((result) => result.candidates),
                ),
                categoryCandidatePoolLimit,
            )
            // One ordered pool per selected subcategory, so category cards can be
            // drafted round-robin to spread across the selected subcategories.
            const subcategoryPools = categorySearchResults.map((result) =>
                getTopRecommendedFreelancers(
                    getUniqueRecommendedFreelancerCandidates(result.candidates),
                    categoryCandidatePoolLimit,
                ),
            )
            const queries = categorySearchResults.map((result) => ({
                subcategory: result.subcategory,
                query: result.query,
                queryType: result.queryType,
                hitCount: result.hits.length,
                candidateCount: result.candidates.length,
                errorMessage: result.error?.message || null,
            }))

            return {
                category: {
                    id: category.id,
                    label: category.label,
                },
                query: queries.map((queryInfo) => queryInfo.query).join(' | '),
                queries,
                candidates: categoryCandidates,
                subcategoryPools,
            }
        })
        const featuredFreelancers = selectFeaturedFreelancers(
            categoryCandidatePools,
            featuredFreelancerLimit,
        )
        const featuredObjectIds = new Set(
            featuredFreelancers.map((freelancer) => freelancer.objectID),
        )
        const recommendationGroups = categoryCandidatePools.map((pool) => ({
            category: pool.category,
            query: pool.query,
            queries: pool.queries,
            recommendations: draftRoundRobin(
                pool.subcategoryPools,
                categoryFreelancerLimit,
                featuredObjectIds,
            ),
        }))
        const fallbackSearchResults = strictQueryMode
            ? []
            : await Promise.all(
            recommendationGroups.map(async (group) => {
                if (group.recommendations.length >= categoryFreelancerLimit) {
                    return null
                }

                const fallbackQuery = getCategoryRecommendationQuery(group.category)
                const fallbackSearchPlan = {
                    category: group.category,
                    subcategory: null,
                    query: fallbackQuery,
                    queryType: 'category_fallback',
                }

                if (!fallbackQuery) return fallbackSearchPlan

                try {
                    const hits = await searchRecommendedFreelancers(fallbackQuery)
                    const candidates = getRecommendedFreelancerCandidates(
                        hits,
                        group.category,
                        null,
                    ).map((candidate) => ({
                        ...candidate,
                        matchedQuery: fallbackQuery,
                        matchedQueryTier: 'fallback',
                    }))
                    const excludedObjectIds = new Set([
                        ...featuredObjectIds,
                        ...group.recommendations.map(
                            (freelancer) => freelancer.objectID,
                        ),
                    ])
                    const fallbackRecommendations = getTopRecommendedFreelancers(
                        getUniqueRecommendedFreelancerCandidates(candidates),
                        categoryFreelancerLimit - group.recommendations.length,
                        excludedObjectIds,
                    )

                    group.queries.push({
                        subcategory: null,
                        query: fallbackQuery,
                        queryType: 'category_fallback',
                        hitCount: hits.length,
                        candidateCount: candidates.length,
                        addedCount: fallbackRecommendations.length,
                        errorMessage: null,
                    })
                    group.query = group.queries
                        .map((queryInfo) => queryInfo.query)
                        .join(' | ')
                    group.recommendations.push(...fallbackRecommendations)

                    if (!fallbackRecommendations.length) {
                        recommendationIssues.push(
                            createRecommendationIssue(
                                'no_category_fallback_recommendations',
                                'Main category fallback did not add recommendations for ' +
                                    (group.category.label || group.category.id) +
                                    '.',
                                {
                                    category: group.category,
                                    query: fallbackQuery,
                                    hitCount: hits.length,
                                    candidateCount: candidates.length,
                                },
                            ),
                        )
                    }

                    return {
                        ...fallbackSearchPlan,
                        hits,
                        candidates,
                        addedRecommendations: fallbackRecommendations,
                        error: null,
                    }
                } catch (error) {
                    group.queries.push({
                        subcategory: null,
                        query: fallbackQuery,
                        queryType: 'category_fallback',
                        hitCount: 0,
                        candidateCount: 0,
                        addedCount: 0,
                        errorMessage: error?.message || String(error),
                    })
                    group.query = group.queries
                        .map((queryInfo) => queryInfo.query)
                        .join(' | ')
                    recommendationIssues.push(
                        createRecommendationIssue(
                            'category_fallback_search_error',
                            'Main category fallback search failed for ' +
                                (group.category.label || group.category.id) +
                                '.',
                            {
                                category: group.category,
                                query: fallbackQuery,
                                errorMessage: error?.message || String(error),
                            },
                        ),
                    )

                    return {
                        ...fallbackSearchPlan,
                        hits: [],
                        candidates: [],
                        addedRecommendations: [],
                        error,
                    }
                }
            }),
        )
        // Prefer the total lvl0 matching pool; fall back to the unique displayed
        // candidate count when the count query is unavailable.
        const starterCount =
            lvl0StarterCount === null
                ? getUniqueSearchResultStarterCount([
                      ...searchResultsWithCandidates,
                      ...fallbackSearchResults.filter(Boolean),
                  ])
                : lvl0StarterCount

        // Pad thin category groups toward categoryFreelancerLimit using featured
        // starters that belong to the SAME main category — i.e. bring back the
        // category's own top pick that was promoted into the featured row. Never
        // borrow starters from other categories, so every card matches its
        // heading; a genuinely thin category may still show fewer than the limit.
        const isSameCategory = (freelancer, category) => {
            const categoryKeys = new Set(
                [slugify(category.id), slugify(category.label)].filter(Boolean),
            )
            const matched = freelancer.matchedCategory || {}
            return (
                categoryKeys.has(slugify(matched.id)) ||
                categoryKeys.has(slugify(matched.label))
            )
        }

        recommendationGroups.forEach((group) => {
            if (group.recommendations.length >= categoryFreelancerLimit) return

            const shownObjectIds = new Set(
                group.recommendations.map((freelancer) => freelancer.objectID),
            )

            for (const featured of featuredFreelancers) {
                if (group.recommendations.length >= categoryFreelancerLimit) break
                if (shownObjectIds.has(featured.objectID)) continue
                if (!isSameCategory(featured, group.category)) continue

                group.recommendations.push(featured)
                shownObjectIds.add(featured.objectID)
            }
        })

        recommendationGroups.forEach((group) => {
            if (group.recommendations.length) return

            const categoryName = group.category.label || group.category.id
            group.message =
                'No additional recommended freelancers were available for ' +
                categoryName +
                ' after featured picks.'
            recommendationIssues.push(
                createRecommendationIssue(
                    'no_category_recommendations_after_featured',
                    group.message,
                    {
                        category: group.category,
                        query: group.query,
                        queries: group.queries,
                    },
                ),
            )
        })

        if (!featuredFreelancers.length) {
            recommendationIssues.push(
                createRecommendationIssue(
                    'no_featured_recommendations',
                    'No featured recommendations could be selected from the matching freelancer pool.',
                ),
            )
        }

        logQuizFlow('loaded recommended freelancers from Algolia', {
            categories,
            searchPlans,
            categoryCandidatePools,
            fallbackSearchResults: fallbackSearchResults.filter(Boolean).map(
                (result) => ({
                    category: result.category,
                    query: result.query,
                    queryType: result.queryType,
                    candidateCount: result.hits?.length || 0,
                    normalizedCandidateCount: result.candidates?.length || 0,
                    addedCount: result.addedRecommendations?.length || 0,
                    error: result.error,
                }),
            ),
            searchResults: searchResultsWithCandidates.map((result) => ({
                category: result.category,
                subcategory: result.subcategory,
                query: result.query,
                queryType: result.queryType,
                candidateCount: result.hits.length,
                normalizedCandidateCount: result.candidates.length,
                error: result.error,
            })),
            starterCount,
            featuredFreelancers,
            recommendationGroups,
            recommendationIssues,
        })

        return {
            featuredFreelancers,
            recommendationGroups,
            starterCount,
            recommendationIssues,
        }
    }

    /**
     * Gets Memberstack's DOM package instance from the page.
     *
     * @returns {object | null} Memberstack DOM instance, or null if unavailable.
     */
    function getMemberstack() {
        return window.$memberstackDom || null
    }

    /**
     * Waits for Memberstack's DOM package to become available.
     *
     * @returns {Promise<object | null>} Memberstack DOM instance, or null.
     */
    async function waitForMemberstack() {
        const maxAttempts = 40
        const delayMs = 250

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const memberstack = getMemberstack()

            if (memberstack) {
                logQuizFlow('Memberstack DOM package available', { attempt })
                return memberstack
            }

            await new Promise((resolve) => {
                window.setTimeout(resolve, delayMs)
            })
        }

        return null
    }

    /**
     * Reads existing Memberstack member JSON and normalizes response shape.
     *
     * @param {object} memberstack Memberstack DOM instance.
     * @returns {Promise<object>} Existing member JSON object.
     */
    async function getExistingMemberJson(memberstack) {
        if (typeof memberstack.getMemberJSON !== 'function') return {}

        const response = await memberstack.getMemberJSON()

        if (response?.data && typeof response.data === 'object') {
            return response.data
        }

        return response && typeof response === 'object' ? response : {}
    }

    /**
     * Reads current member data from Memberstack when available.
     *
     * @param {object} memberstack Memberstack DOM instance.
     * @returns {Promise<object>} Current member data.
     */
    async function getCurrentMemberData(memberstack) {
        if (typeof memberstack.getCurrentMember !== 'function') return {}

        const response = await memberstack.getCurrentMember()

        if (response?.data && typeof response.data === 'object') {
            return response.data
        }

        return response && typeof response === 'object' ? response : {}
    }

    /**
     * Loads a saved quiz payload from Memberstack.
     *
     * @returns {Promise<object | null>} Saved quiz payload, or null.
     */
    async function getPendingQuizFromMemberstack() {
        const memberstack = await waitForMemberstack()

        if (!memberstack) {
            logQuizFlow('Memberstack unavailable; could not load saved quiz')
            return null
        }

        try {
            const existingJson = await getExistingMemberJson(memberstack)
            const memberData = await getCurrentMemberData(memberstack)
            const customFields =
                memberData.customFields ||
                memberData.custom_fields ||
                memberData['custom-fields'] ||
                {}
            const pendingQuiz =
                parsePendingQuiz(existingJson.starterQuiz) ||
                parseStarterQuizCustomField(customFields['starter-quiz'])

            if (!pendingQuiz) {
                logQuizFlow('no starter quiz found in Memberstack')
                return null
            }

            if (!pendingQuiz.memberstackSavedAt) {
                pendingQuiz.memberstackSavedAt = new Date().toISOString()
            }

            sessionStorage.setItem(
                pendingQuizStorageKey,
                JSON.stringify(pendingQuiz),
            )

            logQuizFlow('loaded starter quiz from Memberstack', {
                pendingQuiz,
            })

            return pendingQuiz
        } catch (error) {
            logQuizFlow('Memberstack saved quiz load failed', { error })
            return null
        }
    }

    function compactSelectionItems(items) {
        if (!Array.isArray(items)) return []

        return items
            .map((item) => ({
                id: normalize(item?.id),
                label: normalize(item?.label),
                categoryId: normalize(item?.categoryId),
            }))
            .filter((item) => item.id || item.label)
            .map((item) => {
                const compactItem = {
                    id: item.id,
                    label: item.label,
                }

                if (item.categoryId) {
                    compactItem.categoryId = item.categoryId
                }

                return compactItem
            })
    }

    function getObjectIds(items) {
        if (!Array.isArray(items)) return []

        return Array.from(
            new Set(
                items
                    .map((item) => normalize(item?.objectID))
                    .filter(Boolean),
            ),
        )
    }

    function compactRecommendationQueries(queries) {
        if (!Array.isArray(queries)) return []

        return queries.map((query) => ({
            subcategory: query?.subcategory
                ? {
                      id: normalize(query.subcategory.id),
                      label: normalize(query.subcategory.label),
                  }
                : null,
            queryType: normalize(query?.queryType),
            hitCount: Number(query?.hitCount) || 0,
            candidateCount: Number(query?.candidateCount) || 0,
            addedCount: Number(query?.addedCount) || 0,
            errorMessage: query?.errorMessage || null,
        }))
    }

    function compactRecommendationGroups(groups) {
        if (!Array.isArray(groups)) return []

        return groups.map((group) => ({
            category: group?.category
                ? {
                      id: normalize(group.category.id),
                      label: normalize(group.category.label),
                  }
                : null,
            queries: compactRecommendationQueries(group?.queries),
            recommendedFreelancerIds: getObjectIds(group?.recommendations),
        }))
    }

    function compactRecommendationIssues(issues) {
        if (!Array.isArray(issues)) return []

        return issues.map((issue) => ({
            code: normalize(issue?.code),
            message: normalize(issue?.message),
        }))
    }

    function getStarterQuizCustomFieldSummary(starterQuiz) {
        return (
            normalize(starterQuiz?.resultSlug) ||
            normalize(starterQuiz?.status) ||
            'ready'
        )
    }

    function createMemberstackStarterQuizPayload(pendingQuiz) {
        const savedAt = new Date().toISOString()
        const categories = compactSelectionItems(pendingQuiz?.categories)
        const subcategories = compactSelectionItems(pendingQuiz?.subcategories)

        return {
            status: normalize(pendingQuiz?.status) || 'ready',
            updatedAt: pendingQuiz?.updatedAt || savedAt,
            completedAt: pendingQuiz?.completedAt || null,
            memberstackSavedAt: savedAt,
            resultSlug: normalize(pendingQuiz?.resultSlug) || null,
            categories,
            subcategories,
            categoryIds: categories.map((item) => item.id),
            subcategoryIds: subcategories.map((item) => item.id),
            featuredFreelancerIds: getObjectIds(pendingQuiz?.featuredFreelancers),
            recommendedFreelancerIds: getObjectIds(
                pendingQuiz?.recommendedFreelancers,
            ),
            recommendedFreelancerGroups: compactRecommendationGroups(
                pendingQuiz?.recommendedFreelancerGroups,
            ),
            starterCount: Number(pendingQuiz?.starterCount) || 0,
            recommendationIssues: compactRecommendationIssues(
                pendingQuiz?.recommendationIssues,
            ),
            recommendationVersion: pendingQuiz?.recommendationVersion || null,
        }
    }

    /**
     * Saves compact quiz state to Memberstack member JSON.
     *
     * Member JSON is shared with other flows such as build_profile, so this
     * preserves sibling keys and replaces only the starterQuiz key.
     *
     * @param {object} memberstack Memberstack DOM instance.
     * @param {object} pendingQuiz Pending quiz payload.
     * @returns {Promise<object | null>} Saved compact starter quiz payload.
     */
    async function saveQuizToMemberJson(memberstack, pendingQuiz) {
        if (typeof memberstack.updateMemberJSON !== 'function') {
            logQuizFlow('Memberstack updateMemberJSON unavailable; skipped')
            return null
        }

        const existingJson = await getExistingMemberJson(memberstack)
        const starterQuiz = createMemberstackStarterQuizPayload(pendingQuiz)
        const updatedJson = {
            ...existingJson,
            starterQuiz,
        }

        await memberstack.updateMemberJSON({ json: updatedJson })

        logQuizFlow('saved compact starter quiz to Memberstack member JSON', {
            preservedMemberJsonKeys: Object.keys(existingJson).filter(
                (key) => key !== 'starterQuiz',
            ),
            starterQuiz,
        })

        return starterQuiz
    }

    /**
     * Saves a short starter quiz summary to one Memberstack custom field.
     *
     * Create a Memberstack custom field named Starter Quiz with field ID
     * starter-quiz. This field is intentionally not the full JSON payload.
     *
     * @param {object} memberstack Memberstack DOM instance.
     * @param {object} starterQuiz Compact starter quiz payload.
     * @returns {Promise<void>}
     */
    async function saveQuizCustomField(memberstack, starterQuiz) {
        if (typeof memberstack.updateMember !== 'function') {
            logQuizFlow('Memberstack updateMember unavailable; skipped')
            return
        }

        const customFieldValue = getStarterQuizCustomFieldSummary(starterQuiz)

        await memberstack.updateMember({
            customFields: {
                'starter-quiz': customFieldValue,
            },
        })

        logQuizFlow('saved starter-quiz summary custom field to Memberstack', {
            customFields: {
                'starter-quiz': customFieldValue,
            },
        })
    }

    /**
     * Persists quiz data to the logged-in Memberstack member.
     *
     * @param {object} pendingQuiz Pending quiz payload.
     * @returns {Promise<boolean>} True when save completes.
     */
    async function savePendingQuizToMemberstack(pendingQuiz) {
        if (pendingQuiz.memberstackSavedAt) {
            logQuizFlow('pending quiz already saved to Memberstack; save skipped', {
                memberstackSavedAt: pendingQuiz.memberstackSavedAt,
            })
            return true
        }

        const memberstack = await waitForMemberstack()

        if (!memberstack) {
            logQuizFlow('Memberstack DOM package unavailable; save skipped')
            return false
        }

        try {
            const starterQuiz = await saveQuizToMemberJson(memberstack, pendingQuiz)
            await saveQuizCustomField(memberstack, starterQuiz || pendingQuiz)

            return true
        } catch (error) {
            logQuizFlow('Memberstack save failed', { error })
            return false
        }
    }

    /**
     * Boots the results page flow.
     *
     * @returns {Promise<void>}
     */
    async function initResultsPage() {
        logQuizFlow('initialized', { pendingQuizStorageKey })

        const testPendingQuiz = getTestPendingQuizFromUrl()
        const pendingQuiz =
            testPendingQuiz ||
            getPendingQuiz() ||
            (await getPendingQuizFromMemberstack())

        if (!pendingQuiz) {
            logQuizFlow('no pending quiz found; results page has nothing to save')
            return
        }

        syncLearnContentFilters(pendingQuiz, 'resolved')
        renderTestModeControls(pendingQuiz)

        if (pendingQuiz.status && pendingQuiz.status !== 'ready') {
            logQuizFlow('pending quiz is not ready; results save skipped', {
                status: pendingQuiz.status,
            })
            return
        }

        renderPendingQuiz(pendingQuiz)
        syncTocCategoryVisibility(pendingQuiz)

        const savedFeaturedFreelancers = Array.isArray(
            pendingQuiz.featuredFreelancers,
        )
            ? pendingQuiz.featuredFreelancers
            : []
        const savedRecommendationGroups = Array.isArray(
            pendingQuiz.recommendedFreelancerGroups,
        )
            ? pendingQuiz.recommendedFreelancerGroups
            : []
        const savedRecommendationIssues = Array.isArray(
            pendingQuiz.recommendationIssues,
        )
            ? pendingQuiz.recommendationIssues
            : []
        const savedStarterCount = Number(pendingQuiz.starterCount)
        const hasSavedRecommendationSections =
            savedFeaturedFreelancers.length ||
            savedRecommendationGroups.some(
                (group) =>
                    Array.isArray(group?.recommendations) &&
                    group.recommendations.length,
            )
        const hasCurrentSavedRecommendationSections =
            hasSavedRecommendationSections &&
            pendingQuiz.recommendationVersion === recommendationAlgorithmVersion
        const shouldRefreshMemberstackRecommendations =
            !hasCurrentSavedRecommendationSections
        const recommendationSections = hasCurrentSavedRecommendationSections
            ? {
                  featuredFreelancers: savedFeaturedFreelancers,
                  recommendationGroups: savedRecommendationGroups,
                  starterCount:
                      Number.isFinite(savedStarterCount) && savedStarterCount >= 0
                          ? savedStarterCount
                          : undefined,
                  recommendationIssues: savedRecommendationIssues,
              }
            : await getRecommendedFreelancers(pendingQuiz)
        const recommendedFreelancers = [
            ...recommendationSections.featuredFreelancers,
            ...recommendationSections.recommendationGroups.flatMap(
                (group) => group.recommendations || [],
            ),
        ]

        if (
            recommendationSections.featuredFreelancers.length ||
            recommendationSections.recommendationGroups.length
        ) {
            pendingQuiz.featuredFreelancers =
                recommendationSections.featuredFreelancers
            pendingQuiz.recommendedFreelancerGroups =
                recommendationSections.recommendationGroups
            pendingQuiz.recommendedFreelancers = recommendedFreelancers
            pendingQuiz.starterCount = getUniqueStarterCount(
                recommendationSections,
            )
            pendingQuiz.recommendationIssues =
                recommendationSections.recommendationIssues || []
            pendingQuiz.recommendationVersion = recommendationAlgorithmVersion

            if (shouldRefreshMemberstackRecommendations) {
                delete pendingQuiz.memberstackSavedAt
            }
        } else {
            delete pendingQuiz.featuredFreelancers
            delete pendingQuiz.recommendedFreelancerGroups
            delete pendingQuiz.recommendedFreelancers
            delete pendingQuiz.starterCount
            delete pendingQuiz.recommendationVersion
            pendingQuiz.recommendationIssues =
                recommendationSections.recommendationIssues || []
        }

        renderRecommendedFreelancers(recommendationSections)
        renderQuizStarterCount(recommendationSections)

        if (testPendingQuiz) {
            logQuizFlow('test mode enabled; Memberstack/sessionStorage save skipped')
            return
        }

        const didSave = await savePendingQuizToMemberstack(pendingQuiz)

        if (!didSave) return

        if (!pendingQuiz.memberstackSavedAt) {
            pendingQuiz.memberstackSavedAt = new Date().toISOString()
        }

        sessionStorage.setItem(
            pendingQuizStorageKey,
            JSON.stringify(pendingQuiz),
        )
        logQuizFlow('kept pending quiz in sessionStorage for refreshes', {
            pendingQuizStorageKey,
            pendingQuiz,
        })
    }

    initResultsPage()
})
})()
