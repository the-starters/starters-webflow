/**
 * Quiz results page controller.
 *
 * @release v1.59.245
 *
 * Initial data source:
 * - sessionStorage.starterQuizPending saved by quiz-main.js before signup.
 *   quiz-main.js writes that key continuously as `status: 'draft'` (including
 *   once on /quiz load), and only promotes it to `status: 'ready'` when the
 *   visitor finishes the quiz, so a draft payload is not results data here.
 *   This controller also re-writes the same key as a cache of a logged-in
 *   member's saved answers, stamped with `memberstackSavedAt`. Because
 *   sessionStorage outlives logout, such a cache is dropped as soon as
 *   Memberstack positively reports the visitor as logged out; an unmarked
 *   pre-signup payload is always kept and still previews results.
 *
 * Outputs:
 * - Renders quiz results into optional Webflow elements.
 * - Fetches top matching freelancer recommendations from Algolia.
 * - Saves compact quiz state to the logged-in Memberstack member JSON.
 * - Saves a short status/result summary to the starter-quiz Memberstack custom field.
 * - Registers the completed V3 quiz lead event through authenticated Xano.
 *
 * Debug logging is OFF by default; opt in per session with ?starterQuizDebug=true
 * (or starterQuizDebug in session/localStorage). Set
 * starterQuizResultsDebugEnabled to false to hard-disable this file's logs.
 */
;(() => {
    const starterQuizResultsControllerFlag = 'starterQuizResultsController'
    const starterQuizResultsDebugEnabled = true
    const debugStorageKey = 'starterQuizDebug'
    const pendingQuizStorageKey = 'starterQuizPending'
    const quizLeadDripAuthBase =
        'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh'
    const quizLeadDripV3Base =
        'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk'
    const quizLeadDripEndpoint = '/quiz_email/enroll/v3'
    const quizLeadDripRetryDelays = [0, 750, 2000]
    const workflowDiagnosticsControllerVersion = 'quiz-results-v1'
    const workflowDiagnosticsTimeoutMs = 2000
    const workflowDiagnosticsControllerScript = document.currentScript
    const workflowDiagnosticStates = new Map()
    const learnContentSectionSelector = '.section_results-learn'
    const learnContentResultsSelector =
        learnContentSectionSelector + ' [wf-algolia-element="results"]'
    const learnContentDefaultFilterField = 'categories'
    const learnContentDefaultIndexName = 'LearnContent'
    const learnContentDefaultHitsPerPage = 4
    const learnContentFilterWaitAttempts = 40
    const learnContentFilterWaitMs = 250
    const learnContentPostProcessDelays = [0, 100, 500, 1200]
    const learnContentSwiperRefreshAttempts = 30
    const learnContentSwiperRefreshMs = 100
    const learnContentImageRefreshBoundAttribute =
        'data-starter-quiz-learn-swiper-refresh-bound'
    const learnContentSwiperRuntimeClasses = [
        'swiper-slide-active',
        'swiper-slide-next',
        'swiper-slide-prev',
        'swiper-slide-visible',
        'swiper-slide-fully-visible',
    ]
    // LearnContent still contains pre-V3 category slugs while the quiz now
    // saves the canonical V3 taxonomy. Keep both values searchable during the
    // content migration so old and newly retagged records can coexist.
    const learnContentCategoryFilterAliases = new Map([
        ['creative', ['creative-brand']],
        ['creative-brand', ['creative']],
        [
            'marketing-strategy-brand',
            ['marketing-strategy-leadership'],
        ],
        [
            'marketing-strategy-leadership',
            ['marketing-strategy-brand'],
        ],
    ])

    function boundedWorkflowDiagnostics(promise) {
        return new Promise((resolve) => {
            let settled = false
            const finish = (api) => {
                if (settled) return
                settled = true
                window.clearTimeout(timer)
                resolve(api || null)
            }
            const timer = window.setTimeout(
                () => finish(null),
                workflowDiagnosticsTimeoutMs,
            )
            Promise.resolve(promise).then(finish, () => finish(null))
        })
    }

    function loadWorkflowDiagnostics() {
        if (typeof window === 'undefined') return Promise.resolve(null)
        if (window.StartersWorkflowDiagnostics) {
            return Promise.resolve(window.StartersWorkflowDiagnostics)
        }
        if (window.__startersWorkflowDiagnosticsReady) {
            return boundedWorkflowDiagnostics(
                window.__startersWorkflowDiagnosticsReady,
            )
        }
        const source = workflowDiagnosticsControllerScript?.src || ''
        if (!source || !document.createElement) return Promise.resolve(null)
        let url = ''
        try {
            const cdnRoot = source.match(
                /^(https:\/\/cdn\.jsdelivr\.net\/gh\/the-starters\/starters-webflow@[^/]+\/)/,
            )
            url = cdnRoot
                ? cdnRoot[1] + 'utils/workflow-diagnostics.js'
                : new URL('utils/workflow-diagnostics.js', source).href
        } catch {
            return Promise.resolve(null)
        }
        window.__startersWorkflowDiagnosticsReady = new Promise((resolve) => {
            const script = document.createElement('script')
            let settled = false
            const finish = (api) => {
                if (settled) return
                settled = true
                window.clearTimeout(timer)
                resolve(api || null)
            }
            const timer = window.setTimeout(
                () => finish(null),
                workflowDiagnosticsTimeoutMs,
            )
            script.src = url
            script.async = false
            script.addEventListener(
                'load',
                () => finish(window.StartersWorkflowDiagnostics),
                { once: true },
            )
            script.addEventListener('error', () => finish(null), { once: true })
            ;(document.head || document.documentElement).appendChild(script)
        })
        return boundedWorkflowDiagnostics(
            window.__startersWorkflowDiagnosticsReady,
        )
    }

    const workflowDiagnosticsReady = loadWorkflowDiagnostics()

    function flushWorkflowDiagnostic(workflow, api) {
        api = api || window.StartersWorkflowDiagnostics
        const state = workflowDiagnosticStates.get(workflow)
        if (!state || !api) return null
        if (!state.receipt) {
            state.receipt = api.record(
                api.create({
                    workflow,
                    controller_version: workflowDiagnosticsControllerVersion,
                    result: 'started',
                    stage: state.stage,
                    request_started: false,
                    resource_type: state.resourceType,
                }),
            )
        }
        if (state.completeFields && !state.completed) {
            state.completed = true
            state.receipt = api.record(
                api.complete(state.receipt, {
                    ...state.completeFields,
                    duration_ms: Date.now() - state.startedAt,
                    request_started: state.requestStarted,
                }),
            )
        }
        return state.receipt
    }

    function startWorkflowDiagnostic(workflow, stage, resourceType) {
        const state = {
            completeFields: null,
            completed: false,
            receipt: null,
            requestStarted: false,
            resourceType,
            stage,
            startedAt: Date.now(),
        }
        workflowDiagnosticStates.set(workflow, state)
        Promise.resolve(workflowDiagnosticsReady).then((api) => {
            flushWorkflowDiagnostic(workflow, api)
        })
        return state
    }

    function markWorkflowRequestStarted(workflow) {
        const state = workflowDiagnosticStates.get(workflow)
        if (state) state.requestStarted = true
    }

    function completeWorkflowDiagnostic(workflow, fields) {
        const state = workflowDiagnosticStates.get(workflow)
        if (!state) return
        state.completeFields = fields || {}
        Promise.resolve(workflowDiagnosticsReady).then((api) => {
            flushWorkflowDiagnostic(workflow, api)
        })
    }

    function normalizeQuizLeadDripText(value, maxLength = 500) {
        return String(value || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/[<>]/g, ' ')
            .replace(/[\u0000-\u001f\u007f]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, maxLength)
    }

    function getQuizLeadDripValue(record, fields) {
        for (const field of fields) {
            const value = record?.[field]
            if (value !== undefined && value !== null && value !== '') return value
        }
        return ''
    }

    function getQuizLeadDripFirstName(record) {
        const explicit = getQuizLeadDripValue(record, [
            'first-name',
            'first_name',
            'firstName',
            'firstname',
        ])
        const source = explicit || getQuizLeadDripValue(record, [
            'name',
            'Name',
            'full_name',
            'display_name',
        ])
        return normalizeQuizLeadDripText(source, 80).split(/\s+/)[0] || ''
    }

    function getQuizLeadDripList(value) {
        if (Array.isArray(value)) return value
        if (value && typeof value === 'object') return Object.values(value)
        return String(value || '')
            .split(/\r?\n|\s*[,|]\s*/)
            .filter(Boolean)
    }

    function getQuizLeadDripUrl(value, pathPrefix) {
        const text = normalizeQuizLeadDripText(value, 500)
        if (!text) return ''

        try {
            const url = new URL(text, 'https://thestarters.com')
            const host = url.hostname.toLowerCase()
            if (!['thestarters.com', 'www.thestarters.com'].includes(host)) {
                return ''
            }
            if (pathPrefix && !url.pathname.startsWith(pathPrefix)) return ''
            url.protocol = 'https:'
            url.hostname = 'thestarters.com'
            return url.toString()
        } catch {
            return ''
        }
    }

    function getQuizLeadDripImageUrl(value) {
        const text = normalizeQuizLeadDripText(value, 800)
        if (!text) return ''

        try {
            const url = new URL(text)
            return url.protocol === 'https:' ? url.toString() : ''
        } catch {
            return ''
        }
    }

    function getQuizLeadDripLearnUrl(value) {
        const normalizedUrl = getQuizLeadDripUrl(value, '/learn/')
        if (!normalizedUrl) return ''

        const url = new URL(normalizedUrl)
        const legacyInterviewPrefix = '/learn/interviews/'
        if (url.pathname.startsWith(legacyInterviewPrefix)) {
            url.pathname = url.pathname.replace(
                legacyInterviewPrefix,
                '/learn/interviews-analyses/',
            )
        }

        return url.toString()
    }

    function normalizeQuizLeadDripStarter(record) {
        const slug = normalizeQuizLeadDripText(
            getQuizLeadDripValue(record, [
                'slug',
                'Slug',
                'webflow_slug_30',
            ]),
            140,
        )
        const rawUrl = getQuizLeadDripValue(record, [
            'url',
            'profile_url',
            'profileUrl',
        ])
        const roles = getQuizLeadDripList(
            getQuizLeadDripValue(record, [
                'roles',
                'Roles',
                'primary_role',
                'primary-role',
            ]),
        )
        const projectedServices = [
            getQuizLeadDripValue(record, ['service-1', 'service_1']),
            getQuizLeadDripValue(record, ['service-2', 'service_2']),
            getQuizLeadDripValue(record, ['service-3', 'service_3']),
        ].filter(Boolean)
        const services = (
            projectedServices.length
                ? projectedServices
                : getQuizLeadDripList(
                      getQuizLeadDripValue(record, ['services', 'Services']),
                  )
        )
            .map((service) =>
                normalizeQuizLeadDripText(
                    typeof service === 'object'
                        ? service.name || service.title || service.raw
                        : service,
                    100,
                ),
            )
            .filter(Boolean)
            .slice(0, 3)

        return {
            first_name: getQuizLeadDripFirstName(record),
            role: normalizeQuizLeadDripText(roles[0], 100),
            summary: normalizeQuizLeadDripText(
                getQuizLeadDripValue(record, [
                    'tagline',
                    'Tagline',
                    'short_bio',
                    'bio',
                ]),
                260,
            ),
            url: getQuizLeadDripUrl(
                rawUrl || (slug ? `/hire/${encodeURIComponent(slug)}` : ''),
                '/hire/',
            ),
            image_url: getQuizLeadDripImageUrl(
                getQuizLeadDripValue(record, [
                    'profile-photo',
                    'profile-photo-xano',
                    'profile_photo',
                    'profile-image',
                    'image',
                ]),
            ),
            availability: normalizeQuizLeadDripText(
                getQuizLeadDripValue(record, [
                    'availability',
                    'Availability',
                ]),
                100,
            ),
            services,
            bio: normalizeQuizLeadDripText(
                getQuizLeadDripValue(record, [
                    'bio',
                    'Bio',
                    'description',
                    'About',
                ]),
                800,
            ),
            classification: normalizeQuizLeadDripText(
                getQuizLeadDripValue(record, [
                    'profile-type',
                    'classification',
                    'Classification',
                    'profile_type_30',
                ]),
                100,
            ),
            location: normalizeQuizLeadDripText(
                getQuizLeadDripValue(record, ['location', 'Location']) ||
                    [
                        getQuizLeadDripValue(record, ['city', 'City']),
                        getQuizLeadDripValue(record, [
                            'state',
                            'State_Province',
                        ]),
                        getQuizLeadDripValue(record, ['country', 'Country']),
                    ]
                        .map((part) => normalizeQuizLeadDripText(part, 60))
                        .filter(Boolean)
                        .join(', '),
                120,
            ),
            reviews: formatQuizLeadDripReviews(record),
        }
    }

    function formatQuizLeadDripReviews(record) {
        const rawCount = record?.review_count
        const rawAverage = record?.review_average
        const count =
            typeof rawCount === 'number' ||
            (typeof rawCount === 'string' && /^\d+$/.test(rawCount.trim()))
                ? Number(rawCount)
                : NaN
        const average =
            typeof rawAverage === 'number' ||
            (typeof rawAverage === 'string' &&
                /^\d+(?:\.\d+)?$/.test(rawAverage.trim()))
                ? Number(rawAverage)
                : NaN

        if (
            !Number.isInteger(count) ||
            count <= 0 ||
            !Number.isFinite(average) ||
            average <= 0 ||
            average > 5
        ) {
            return ''
        }

        return `${average.toFixed(1)} (${count} ${
            count === 1 ? 'Review' : 'Reviews'
        })`
    }

    function normalizeQuizLeadDripLearnItem(selection) {
        const hit = selection?.hit || selection
        if (!hit || typeof hit !== 'object') return null

        const slug = normalizeQuizLeadDripText(
            getQuizLeadDripValue(hit, ['slug', 'objectID']),
            160,
        )
        const url = getQuizLeadDripLearnUrl(
            getQuizLeadDripValue(hit, ['url', 'link']) ||
                (slug ? `/learn/${encodeURIComponent(slug)}` : ''),
        )
        const title = normalizeQuizLeadDripText(
            getQuizLeadDripValue(hit, ['name', 'title']),
            180,
        )

        if (!title || !url) return null

        return {
            title,
            summary: normalizeQuizLeadDripText(
                getQuizLeadDripValue(hit, [
                    'description',
                    'summary',
                    'excerpt',
                ]),
                360,
            ),
            url,
        }
    }

    function createQuizLeadDripProperties(pendingQuiz, recommendations, learn) {
        const featured = Array.isArray(recommendations?.featuredFreelancers)
            ? recommendations.featuredFreelancers
            : []
        const grouped = Array.isArray(recommendations?.recommendationGroups)
            ? recommendations.recommendationGroups.flatMap(
                  (group) => group?.recommendations || [],
              )
            : []
        const seen = new Set()
        const starters = [...featured, ...grouped]
            .filter((starter) => {
                const key = normalizeQuizLeadDripText(
                    starter?.objectID || starter?.id || starter?.slug,
                    180,
                )
                if (!key || seen.has(key)) return false
                seen.add(key)
                return true
            })
            .map(normalizeQuizLeadDripStarter)
            .filter((starter) => starter.first_name && starter.url)
            .slice(0, 3)
        const learnItem = normalizeQuizLeadDripLearnItem(learn)
        const properties = {
            quiz_revision: normalizeQuizLeadDripText(
                pendingQuiz?.updatedAt || pendingQuiz?.completedAt,
                160,
            ),
            category_count: String(
                Array.isArray(pendingQuiz?.categories)
                    ? pendingQuiz.categories.length
                    : 0,
            ),
            subcategory_count: String(
                Array.isArray(pendingQuiz?.subcategories)
                    ? pendingQuiz.subcategories.length
                    : 0,
            ),
            starter_count: String(starters.length),
            learn_count: learnItem ? '1' : '0',
            results_url: 'https://thestarters.com/quiz-results',
            upgrade_url: 'https://thestarters.com/quiz-results#upgrade',
            learn_title:
                learnItem?.title || 'Explore more expert guidance',
            learn_summary:
                learnItem?.summary ||
                'Browse practical sessions and playbooks from experienced operators.',
            learn_url:
                learnItem?.url ||
                'https://thestarters.com/learn?source=quiz-results-email',
        }

        starters.forEach((starter, index) => {
            const prefix = `starter_${index + 1}_`
            properties[prefix + 'first_name'] = starter.first_name
            properties[prefix + 'role'] = starter.role
            properties[prefix + 'summary'] = starter.summary
            properties[prefix + 'url'] = starter.url
            properties[prefix + 'image_url'] = starter.image_url
            properties[prefix + 'availability'] = starter.availability
            properties[prefix + 'bio'] = starter.bio
            properties[prefix + 'classification'] = starter.classification
            properties[prefix + 'location'] = starter.location
            properties[prefix + 'reviews'] = starter.reviews
            properties[prefix + 'reviews_display'] = starter.reviews
                ? 'table-cell'
                : 'none'
            for (let serviceIndex = 0; serviceIndex < 3; serviceIndex += 1) {
                properties[`${prefix}service_${serviceIndex + 1}`] =
                    starter.services[serviceIndex] || ''
            }
        })

        return properties
    }

    function logQuizLeadDripFlow(message, data) {
        if (!isDebugLoggingEnabled()) return

        if (typeof data === 'undefined') {
            console.log('[Starter Quiz Funnel]', '[results]', message)
            return
        }

        console.log('[Starter Quiz Funnel]', '[results]', message, data)
    }

    async function waitForQuizLeadDripMemberstack() {
        for (let attempt = 1; attempt <= 40; attempt += 1) {
            if (window.$memberstackDom) return window.$memberstackDom
            await new Promise((resolve) => window.setTimeout(resolve, 250))
        }

        return null
    }

    async function getQuizLeadDripToken(memberstack) {
        if (!memberstack || typeof memberstack.getMemberCookie !== 'function') {
            throw new Error('Memberstack session is unavailable')
        }
        const memberstackToken = await memberstack.getMemberCookie()
        if (!memberstackToken) throw new Error('Memberstack session is unavailable')

        const response = await fetch(
            `${quizLeadDripAuthBase}/auth/trade-token/v3?token=${encodeURIComponent(memberstackToken)}`,
            { method: 'GET', credentials: 'omit' },
        )
        const payload = await response.json().catch(() => ({}))
        const token =
            typeof payload === 'string'
                ? payload
                : payload && (payload.authToken || payload.token)
        if (!response.ok || !token) {
            throw new Error('V3 session exchange failed')
        }
        return token
    }

    async function postQuizLeadDripEvent(properties) {
        const memberstack = await waitForQuizLeadDripMemberstack()
        markWorkflowRequestStarted('quiz_lead_drip_enrollment')
        const token = await getQuizLeadDripToken(memberstack)
        const response = await fetch(
            quizLeadDripV3Base + quizLeadDripEndpoint,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ properties }),
            },
        )
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload.ok !== true) {
            const error = new Error('V3 quiz lead event was not accepted')
            error.status = response.status
            throw error
        }
        return payload
    }

    async function getQuizLeadDripLearnSelection(pendingQuiz) {
        if (window.__starterQuizLeadDripLearnSelection) {
            return window.__starterQuizLeadDripLearnSelection
        }

        const section = document.querySelector(learnContentSectionSelector)
        const { selectedCategoryFilterGroups: groups } =
            getLearnContentCategoryFilters(pendingQuiz)
        if (!section || !groups.length) return null

        try {
            const { appId, searchKey, indexName } =
                getLearnContentSearchConfig(section)
            const filterField = getLearnContentFilterField(section)
            const groupResults = await Promise.all(
                groups.map(async (group) => ({
                    group,
                    hits: await searchLearnContentGroup({
                        appId,
                        searchKey,
                        indexName,
                        filterField,
                        filterValues: group.filterValues,
                        hitsPerPage: 2,
                    }),
                })),
            )
            const selection =
                pickRoundRobinLearnContentHits(groupResults, 1)[0] || null
            window.__starterQuizLeadDripLearnSelection = selection
            return selection
        } catch (error) {
            logQuizLeadDripFlow('quiz lead Learn match unavailable; using fallback', {
                error: error?.message || String(error),
            })
            return null
        }
    }

    async function enrollQuizLeadDrip(pendingQuiz, recommendations) {
        startWorkflowDiagnostic(
            'quiz_lead_drip_enrollment',
            'prepare',
            'workflow_event',
        )
        const learnSelection =
            await getQuizLeadDripLearnSelection(pendingQuiz)
        const properties = createQuizLeadDripProperties(
            pendingQuiz,
            recommendations,
            learnSelection,
        )

        if (!properties.quiz_revision || Number(properties.starter_count) < 1) {
            logQuizLeadDripFlow(
                'quiz lead event skipped; required result data is missing',
            )
            completeWorkflowDiagnostic('quiz_lead_drip_enrollment', {
                result: 'failure',
                stage: 'validation',
                error_code: 'MISSING_RESULT_DATA',
            })
            return null
        }

        let lastError = null
        for (const delay of quizLeadDripRetryDelays) {
            if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
            try {
                const result = await postQuizLeadDripEvent(properties)
                logQuizLeadDripFlow('registered V3 quiz lead event', {
                    replayed: Boolean(result.replayed),
                    status: result.status,
                })
                completeWorkflowDiagnostic('quiz_lead_drip_enrollment', {
                    result: 'success',
                    stage: 'complete',
                    replayed: Boolean(result.replayed),
                })
                return result
            } catch (error) {
                lastError = error
            }
        }

        logQuizLeadDripFlow('V3 quiz lead event registration failed', {
            status: lastError?.status || 0,
            error: lastError?.message || String(lastError),
        })
        completeWorkflowDiagnostic('quiz_lead_drip_enrollment', {
            result: 'failure',
            stage: 'request',
            error_code: 'QUIZ_LEAD_ENROLL_FAILED',
            http_status: lastError?.status || null,
        })
        return null
    }

    /**
     * Decides whether a saved quiz payload is finished enough for this page to
     * treat it as results data.
     *
     * quiz-main.js saves `sessionStorage.starterQuizPending` with
     * `status: 'draft'` on /quiz load, on every answer change and on every back
     * step, and only re-saves it with `status: 'ready'` immediately before
     * signup, before the auth-provider hand-off, and before a logged-in
     * retaker is sent here. So a `draft` payload means "somebody looked at the
     * quiz", never "somebody completed the quiz", and it must not keep a
     * visitor parked on /quiz-results.
     *
     * A payload with no `status` at all keeps its pre-existing "usable"
     * answer. Every known writer sets the field: quiz-main.js has written it
     * since the controller's first release, and
     * createMemberstackStarterQuizPayload() below defaults it to 'ready' for
     * the member-JSON copy. A status-less payload therefore means an old
     * Memberstack/custom-field record, not a draft, and downgrading it would
     * bounce members who really do have saved answers.
     *
     * @param {object | null | undefined} pendingQuiz Saved quiz payload.
     * @returns {boolean} True when the payload may drive the results page.
     */
    function isPendingQuizReady(pendingQuiz) {
        if (!pendingQuiz || typeof pendingQuiz !== 'object') return false

        const status = String(pendingQuiz.status || '')
            .trim()
            .toLowerCase()

        return !status || status === 'ready'
    }

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
            sessionStorage.getItem(debugStorageKey) === 'true' ||
            localStorage.getItem(debugStorageKey) === 'true'
        )
    }

    if (window[starterQuizResultsControllerFlag]) {
        if (isDebugLoggingEnabled()) {
            console.log('[Starter Quiz Funnel]', '[results]', 'duplicate script skipped', {
                scriptFlag: starterQuizResultsControllerFlag,
            })
        }
        return
    }

    window[starterQuizResultsControllerFlag] = true

    const quizEmailTestEnabled =
        new URLSearchParams(window.location.search).get('quizEmailTest') === '1'
    const quizEmailTestRecipient = document.querySelector(
        '[data-quiz-email-test-recipient]',
    )
    const quizEmailTestSend = document.querySelector(
        '[data-quiz-email-test-send]',
    )
    let quizEmailTestPanel = document.querySelector(
        '[data-quiz-email-test-panel]',
    )

    if (!quizEmailTestPanel && quizEmailTestRecipient && quizEmailTestSend) {
        quizEmailTestPanel = quizEmailTestRecipient.parentElement

        while (
            quizEmailTestPanel &&
            quizEmailTestPanel !== document.body &&
            !quizEmailTestPanel.contains(quizEmailTestSend)
        ) {
            quizEmailTestPanel = quizEmailTestPanel.parentElement
        }
    }

    if (quizEmailTestPanel && quizEmailTestPanel !== document.body) {
        quizEmailTestPanel.hidden = true
        quizEmailTestPanel.setAttribute('aria-hidden', 'true')
    }

    let resolveQuizEmailTestSavedState = null

    if (quizEmailTestEnabled) {
        window.__startersQuizEmailTestSavedState = {
            ready: new Promise((resolve) => {
                resolveQuizEmailTestSavedState = resolve
            }),
        }
    }

    function settleQuizEmailTestSavedState(quiz, error) {
        if (!resolveQuizEmailTestSavedState) return

        resolveQuizEmailTestSavedState({
            quiz: quiz || null,
            error: error || '',
        })
        resolveQuizEmailTestSavedState = null
    }

    // The internal email tester is a separate, query-gated controller so the
    // production results flow pays no runtime or network cost unless an
    // operator opens /quiz-results?quizEmailTest=1. The controller binds only
    // to native Webflow elements; it does not generate the panel markup.
    if (
        quizEmailTestEnabled &&
        quizEmailTestPanel &&
        quizEmailTestPanel !== document.body &&
        !document.querySelector('script[data-quiz-email-test-controller]')
    ) {
        const testerScript = document.createElement('script')
        testerScript.defer = true
        testerScript.dataset.quizEmailTestController = 'true'
        testerScript.src =
            'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/quiz-results-email-tester.js'
        document.head.appendChild(testerScript)
    }

    function normalizeLearnContentValue(value) {
        return String(value || '').trim()
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
                value: normalizeLearnContentValue(rawId),
                label:
                    normalizeLearnContentValue(rawLabel) ||
                    normalizeLearnContentValue(rawId),
            }
        }

        return {
            id: slugifyLearnContentValue(text),
            value: text,
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
        const storedPendingQuiz = parseLearnContentJson(
            window.sessionStorage?.getItem(pendingQuizStorageKey),
        )

        // Same predicate as the main controller, on purpose. A draft never
        // renders results here, so it must not seed the LearnContent filters or
        // publish window.selectedCategory* either: those globals would describe
        // selections this page is never going to show, and on the logged-out
        // path the visitor is about to be sent back to /quiz. The key itself is
        // left in place for quiz-main.js and quiz-loader.js.
        if (storedPendingQuiz && !isPendingQuizReady(storedPendingQuiz)) {
            if (isDebugLoggingEnabled()) {
                console.log(
                    '[Starter Quiz Funnel]',
                    '[results]',
                    'ignoring draft pending quiz for LearnContent filters',
                    {
                        status: storedPendingQuiz.status,
                        pendingQuizStorageKey,
                    },
                )
            }

            return null
        }

        return storedPendingQuiz
    }

    function getLearnContentCategoryFilterValues(category) {
        if (!category) return []

        const candidateValues =
            typeof category !== 'object'
                ? [
                      normalizeLearnContentValue(category),
                      slugifyLearnContentValue(category),
                  ]
                : [
                      category.membershipId,
                      category.membershipID,
                      category.membership_id,
                      category.categoryMembershipId,
                      category.category_membership_id,
                      category.id,
                      category.value,
                      category.label,
                      slugifyLearnContentValue(category.label),
                      slugifyLearnContentValue(category.id),
                  ]

        return Array.from(
            new Set(
                candidateValues
                    .map(normalizeLearnContentValue)
                    .filter(Boolean)
                    .flatMap((value) => [
                        value,
                        ...(learnContentCategoryFilterAliases.get(
                            slugifyLearnContentValue(value),
                        ) || []),
                    ]),
            ),
        )
    }

    function getLearnContentCategoryFilters(pendingQuiz) {
        const categories = Array.isArray(pendingQuiz?.categories)
            ? pendingQuiz.categories
            : []
        const selectedCategoryFilterGroups = categories
            .map((category) => ({
                category,
                categoryId:
                    normalizeLearnContentValue(category?.id) ||
                    slugifyLearnContentValue(category?.label || category),
                categoryLabel:
                    normalizeLearnContentValue(category?.label) ||
                    normalizeLearnContentValue(category?.value) ||
                    normalizeLearnContentValue(category),
                filterValues: getLearnContentCategoryFilterValues(category),
            }))
            .filter((group) => group.filterValues.length)
        const selectedCategoryFilters = Array.from(
            new Set(
                selectedCategoryFilterGroups
                    .flatMap((group) => group.filterValues)
                    .filter(Boolean),
            ),
        )
        const selectedCategory = selectedCategoryFilterGroups[0]?.category || null

        return {
            selectedCategory: selectedCategory || null,
            selectedCategoryFilter: selectedCategoryFilters[0] || '',
            selectedCategoryFilterGroups,
            selectedCategoryFilters,
        }
    }

    function getLearnContentSearchConfig() {
        const resolved =
            window.StartersV3AlgoliaEnvironment?.getSharedSearchConfig?.(
                'learnContent',
            )

        return {
            appId: normalizeLearnContentValue(resolved?.appId),
            searchKey: normalizeLearnContentValue(resolved?.searchKey),
            indexName:
                normalizeLearnContentValue(resolved?.indexName) ===
                learnContentDefaultIndexName
                    ? learnContentDefaultIndexName
                    : '',
        }
    }

    function getLearnContentFilterField(learnContentSection) {
        return (
            learnContentSection.getAttribute('data-quiz-learn-filter-field') ||
            learnContentSection.getAttribute('wf-algolia-filter-field') ||
            learnContentSection.getAttribute('wf-algolia-base-filter-field') ||
            learnContentDefaultFilterField
        )
    }

    function getLearnContentHitsPerPage(learnContentSection) {
        const rawValue =
            learnContentSection.getAttribute('data-quiz-learn-limit') ||
            learnContentSection.getAttribute('wf-algolia-hits-per-page') ||
            learnContentSection.getAttribute('wf-algolia-per-page') ||
            learnContentSection.getAttribute('data-hits-per-page')
        const value = Number.parseInt(rawValue, 10)

        return Number.isFinite(value) && value > 0
            ? value
            : learnContentDefaultHitsPerPage
    }

    function getLearnContentResultsElement(learnContentSection) {
        return (
            learnContentSection?.querySelector?.('[wf-algolia-element="results"]') ||
            document.querySelector(learnContentResultsSelector)
        )
    }

    function captureLearnContentTemplate(learnContentSection) {
        const resultsElement = getLearnContentResultsElement(learnContentSection)
        if (!resultsElement) return null

        if (window.__starterQuizLearnContentTemplate) {
            return window.__starterQuizLearnContentTemplate.cloneNode(true)
        }

        const template =
            Array.from(resultsElement.children).find((child) =>
                isLearnContentTemplateSlide(child),
            ) || resultsElement.querySelector('[wf-algolia-element="template"]')

        if (!template) return null

        window.__starterQuizLearnContentTemplate = template.cloneNode(true)

        return window.__starterQuizLearnContentTemplate.cloneNode(true)
    }

    function getLearnContentBoundElements(root, selector) {
        if (!root) return []

        return [
            ...(root.matches?.(selector) ? [root] : []),
            ...Array.from(root.querySelectorAll?.(selector) || []),
        ]
    }

    function getLearnContentHitValue(hit, pathList) {
        const paths = normalizeLearnContentValue(pathList)
            .split('|')
            .map(normalizeLearnContentValue)
            .filter(Boolean)

        for (const path of paths) {
            const value = path
                .split('.')
                .reduce(
                    (currentValue, key) =>
                        currentValue && typeof currentValue === 'object'
                            ? currentValue[key]
                            : undefined,
                    hit,
                )

            if (Array.isArray(value) && value.length) return value.join(', ')
            if (value !== null && typeof value !== 'undefined' && value !== '') {
                return value
            }
        }

        return ''
    }

    function setLearnContentElementLink(element, href) {
        if (!href) return

        if (element.tagName === 'A') {
            element.setAttribute('href', href)
            return
        }

        const anchor = element.querySelector?.('a')
        if (anchor) {
            anchor.setAttribute('href', href)
            return
        }

        element.setAttribute('href', href)
    }

    function populateLearnContentCard(card, hit) {
        getLearnContentBoundElements(card, '[wf-algolia-text]').forEach(
            (element) => {
                const value = getLearnContentHitValue(
                    hit,
                    element.getAttribute('wf-algolia-text'),
                )
                element.textContent = Array.isArray(value)
                    ? value.join(', ')
                    : String(value || '')
            },
        )

        getLearnContentBoundElements(card, '[wf-algolia-html]').forEach(
            (element) => {
                const value = getLearnContentHitValue(
                    hit,
                    element.getAttribute('wf-algolia-html'),
                )
                element.textContent = String(value || '')
            },
        )

        getLearnContentBoundElements(card, '[wf-algolia-image]').forEach(
            (element) => {
                const src = getLearnContentHitValue(
                    hit,
                    element.getAttribute('wf-algolia-image'),
                )
                const alt = element.hasAttribute('wf-algolia-alt')
                    ? getLearnContentHitValue(
                          hit,
                          element.getAttribute('wf-algolia-alt'),
                      )
                    : ''

                if (src) element.setAttribute('src', String(src))
                if (element.hasAttribute('srcset')) element.removeAttribute('srcset')
                if (element.hasAttribute('wf-algolia-alt')) {
                    element.setAttribute('alt', String(alt || ''))
                }
            },
        )

        getLearnContentBoundElements(
            card,
            '[wf-algolia-link], [wf-algolia-link-url]',
        ).forEach((element) => {
            const urlField = element.getAttribute('wf-algolia-link-url')
            const linkField = element.getAttribute('wf-algolia-link')
            const directUrl = urlField ? getLearnContentHitValue(hit, urlField) : ''

            if (directUrl) {
                setLearnContentElementLink(element, String(directUrl))
                return
            }

            const rawLinkValue = linkField
                ? getLearnContentHitValue(hit, linkField)
                : ''
            if (!rawLinkValue) return

            const shouldSlugify = ['1', 'true', 'yes'].includes(
                normalizeLearnContentValue(
                    element.getAttribute('wf-algolia-link-slugify'),
                ).toLowerCase(),
            )
            const linkValue = shouldSlugify
                ? slugifyLearnContentValue(rawLinkValue)
                : String(rawLinkValue)
            const prefix =
                element.getAttribute('wf-algolia-link-prefix') ||
                element.getAttribute('wf-algolia-link-folder') ||
                ''
            const suffix = element.getAttribute('wf-algolia-link-suffix') || ''

            setLearnContentElementLink(element, prefix + linkValue + suffix)
        })
    }

    function prepareLearnContentCard(card, hit, group) {
        if (!card) return null

        card.setAttribute?.('data-swiper-scroll', 'swiper-slide')
        card.classList?.add('wf-algolia-injected')
        card.classList?.add('swiper-slide')
        card.classList?.remove(...learnContentSwiperRuntimeClasses)
        card.classList?.remove('hide')
        card.style?.removeProperty('width')
        card.style?.removeProperty('margin-right')
        card.removeAttribute?.('aria-hidden')
        card.removeAttribute?.('wf-algolia-element')
        card.querySelectorAll?.('[wf-algolia-element="template"]').forEach(
            (element) => {
                element.removeAttribute('wf-algolia-element')
            },
        )
        card.dataset.starterQuizLearnRoundRobin = 'true'
        card.dataset.starterQuizLearnCategory =
            group.categoryId || group.categoryLabel || ''
        card.dataset.starterQuizLearnObjectId =
            normalizeLearnContentValue(hit.objectID) || ''

        populateLearnContentCard(card, hit)

        return card
    }

    function cloneLearnContentCard(template, hit, group, wfAlgolia) {
        let card = null

        if (typeof wfAlgolia?.cloneAndPopulate === 'function') {
            try {
                card = wfAlgolia.cloneAndPopulate(template, hit)
            } catch (error) {
                if (isDebugLoggingEnabled()) {
                    console.warn(
                        '[Starter Quiz Funnel]',
                        '[results]',
                        'WfAlgolia template population failed; using fallback',
                        { error },
                    )
                }
            }
        }

        if (!card || typeof card.cloneNode !== 'function') {
            card = template.cloneNode(true)
        }

        return prepareLearnContentCard(card, hit, group)
    }

    function getLearnContentHitId(hit) {
        return (
            normalizeLearnContentValue(hit?.objectID) ||
            normalizeLearnContentValue(hit?.id) ||
            normalizeLearnContentValue(hit?.slug) ||
            JSON.stringify(hit || {})
        )
    }

    async function searchLearnContentGroup({
        appId,
        searchKey,
        indexName,
        filterField,
        filterValues,
        hitsPerPage,
    }) {
        if (!appId || !searchKey || !indexName || !filterValues?.length) {
            return []
        }

        const response = await fetch(
            `https://${appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(
                indexName,
            )}/query`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Algolia-API-Key': searchKey,
                    'X-Algolia-Application-Id': appId,
                },
                body: JSON.stringify({
                    query: '',
                    hitsPerPage,
                    facetFilters: [
                        filterValues.map((value) => `${filterField}:${value}`),
                    ],
                }),
            },
        )

        if (!response.ok) {
            throw new Error(`LearnContent search failed: ${response.status}`)
        }

        const data = await response.json()
        return Array.isArray(data?.hits) ? data.hits : []
    }

    function pickRoundRobinLearnContentHits(groupResults, limit) {
        const selectedHits = []
        const seenHitIds = new Set()
        const cursors = groupResults.map(() => 0)
        let didAddHit = true

        while (selectedHits.length < limit && didAddHit) {
            didAddHit = false

            groupResults.forEach((groupResult, groupIndex) => {
                if (selectedHits.length >= limit) return

                while (cursors[groupIndex] < groupResult.hits.length) {
                    const hit = groupResult.hits[cursors[groupIndex]]
                    cursors[groupIndex] += 1
                    const hitId = getLearnContentHitId(hit)

                    if (seenHitIds.has(hitId)) continue

                    seenHitIds.add(hitId)
                    selectedHits.push({
                        hit,
                        group: groupResult.group,
                    })
                    didAddHit = true
                    break
                }
            })
        }

        return selectedHits
    }

    function removeLearnContentInjectedSlides(resultsElement) {
        Array.from(resultsElement.children).forEach((child) => {
            if (isLearnContentLockedSlide(child)) return
            if (
                child.dataset?.starterQuizLearnRoundRobin === 'true' ||
                isLearnContentInjectedSlide(child)
            ) {
                child.remove()
            }
        })
    }

    async function renderRoundRobinLearnContent({
        learnContentSection,
        filterField,
        selectedCategoryFilterGroups,
        source,
        wfAlgolia,
    }) {
        const resultsElement = getLearnContentResultsElement(learnContentSection)
        const template = captureLearnContentTemplate(learnContentSection)

        if (
            !resultsElement ||
            !template ||
            !Array.isArray(selectedCategoryFilterGroups) ||
            selectedCategoryFilterGroups.length < 2
        ) {
            return false
        }

        const { appId, searchKey, indexName } =
            getLearnContentSearchConfig(learnContentSection)
        const hitsPerPage = getLearnContentHitsPerPage(learnContentSection)
        const cacheKey = JSON.stringify({
            appId,
            indexName,
            filterField,
            hitsPerPage,
            filterGroups: selectedCategoryFilterGroups.map(
                (group) => group.filterValues,
            ),
        })
        const state =
            window.__starterQuizLearnContentRoundRobinState ||
            (window.__starterQuizLearnContentRoundRobinState = {
                cache: new Map(),
                pending: new Map(),
                token: 0,
            })
        const token = (state.token += 1)

        try {
            let groupResults = state.cache.get(cacheKey)

            if (!groupResults) {
                let pendingRequest = state.pending.get(cacheKey)

                if (!pendingRequest) {
                    const perCategoryHits = Math.max(
                        hitsPerPage,
                        Math.ceil(hitsPerPage / selectedCategoryFilterGroups.length) +
                            2,
                    )

                    pendingRequest = Promise.all(
                        selectedCategoryFilterGroups.map(async (group) => ({
                            group,
                            hits: await searchLearnContentGroup({
                                appId,
                                searchKey,
                                indexName,
                                filterField,
                                filterValues: group.filterValues,
                                hitsPerPage: perCategoryHits,
                            }),
                        })),
                    )
                    state.pending.set(cacheKey, pendingRequest)
                }

                groupResults = await pendingRequest
                state.pending.delete(cacheKey)
                state.cache.set(cacheKey, groupResults)
            }

            if (token !== state.token && !state.cache.has(cacheKey)) return false

            const selectedHits = pickRoundRobinLearnContentHits(
                groupResults,
                hitsPerPage,
            )
            window.__starterQuizLeadDripLearnSelection =
                selectedHits[0] || null
            if (!selectedHits.length) return false

            removeLearnContentInjectedSlides(resultsElement)

            const lockedSlides = Array.from(resultsElement.children).filter(
                isLearnContentLockedSlide,
            )
            const firstLockedSlide = lockedSlides[0] || null

            selectedHits.forEach(({ hit, group }) => {
                const card = cloneLearnContentCard(
                    template,
                    hit,
                    group,
                    wfAlgolia,
                )
                if (!card) return

                if (firstLockedSlide?.parentElement === resultsElement) {
                    resultsElement.insertBefore(card, firstLockedSlide)
                } else {
                    resultsElement.appendChild(card)
                }
            })

            normalizeLearnContentSlides(source + '-round-robin')
            refreshLearnContentSwiper(resultsElement)

            if (isDebugLoggingEnabled()) {
                console.log(
                    '[Starter Quiz Funnel]',
                    '[results]',
                    'rendered LearnContent round robin',
                    {
                        source,
                        indexName,
                        filterField,
                        categoryCount: selectedCategoryFilterGroups.length,
                        hitCount: selectedHits.length,
                        order: selectedHits.map(
                            ({ group }) =>
                                group.categoryId || group.categoryLabel || '',
                        ),
                    },
                )
            }

            return true
        } catch (error) {
            if (isDebugLoggingEnabled()) {
                console.warn(
                    '[Starter Quiz Funnel]',
                    '[results]',
                    'LearnContent round robin render failed',
                    { error },
                )
            }

            return false
        }
    }

    function scheduleRoundRobinLearnContentRender(options) {
        learnContentPostProcessDelays.forEach((delay) => {
            window.setTimeout(() => {
                renderRoundRobinLearnContent(options)
            }, delay)
        })
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

    function prepareLearnContentSwiperSlides(resultsElement) {
        if (!resultsElement) return false

        let didChange = false

        Array.from(resultsElement.children).forEach((slide) => {
            if (!isLearnContentSlide(slide)) return

            if (slide.getAttribute('data-swiper-scroll') !== 'swiper-slide') {
                slide.setAttribute('data-swiper-scroll', 'swiper-slide')
                didChange = true
            }

            if (!slide.classList.contains('swiper-slide')) {
                slide.classList.add('swiper-slide')
                didChange = true
            }

            if (isLearnContentInjectedSlide(slide)) {
                learnContentSwiperRuntimeClasses.forEach((className) => {
                    if (slide.classList.contains(className)) {
                        slide.classList.remove(className)
                        didChange = true
                    }
                })

                if (slide.style.width) {
                    slide.style.removeProperty('width')
                    didChange = true
                }

                if (slide.style.marginRight) {
                    slide.style.removeProperty('margin-right')
                    didChange = true
                }
            }
        })

        return didChange
    }

    function updateLearnContentSwiper(swiperElement, source = 'results') {
        const swiper = swiperElement?.__swiperScrollInstance

        if (!swiper || typeof swiper.update !== 'function') return false

        try {
            swiper.updateSize?.()
            swiper.updateSlides?.()
            swiper.updateProgress?.()
            swiper.updateSlidesClasses?.()
            swiper.update()
            swiper.scrollbar?.updateSize?.()
            return true
        } catch (error) {
            if (isDebugLoggingEnabled()) {
                console.warn(
                    '[Starter Quiz Funnel]',
                    '[results]',
                    'LearnContent swiper update failed',
                    { error, source },
                )
            }
            return false
        }
    }

    function scheduleLearnContentSwiperUpdate(swiperElement, source = 'results') {
        const update = () => updateLearnContentSwiper(swiperElement, source)

        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(update)
            return
        }

        window.setTimeout(update, 0)
    }

    function waitForLearnContentSwiper(swiperElement, source = 'results') {
        if (!swiperElement || swiperElement.__starterQuizLearnRefreshRetrying) {
            return
        }

        swiperElement.__starterQuizLearnRefreshRetrying = true
        let attempts = 0

        const intervalId = window.setInterval(() => {
            attempts += 1
            const didUpdate = updateLearnContentSwiper(
                swiperElement,
                source + '-retry',
            )

            if (didUpdate || attempts >= learnContentSwiperRefreshAttempts) {
                window.clearInterval(intervalId)
                swiperElement.__starterQuizLearnRefreshRetrying = false
            }
        }, learnContentSwiperRefreshMs)
    }

    function bindLearnContentImageRefresh(resultsElement, swiperElement) {
        if (!resultsElement || !swiperElement) return

        resultsElement.querySelectorAll('img').forEach((image) => {
            if (image.getAttribute(learnContentImageRefreshBoundAttribute)) return

            image.setAttribute(learnContentImageRefreshBoundAttribute, 'true')
            const refresh = () => {
                refreshLearnContentSwiper(resultsElement, 'image-ready')
            }

            if (image.complete) {
                scheduleLearnContentSwiperUpdate(swiperElement, 'image-complete')
                return
            }

            image.addEventListener('load', refresh, { once: true })
            image.addEventListener('error', refresh, { once: true })
        })
    }

    function bindLearnContentWindowLoadRefresh() {
        if (window.__starterQuizLearnContentWindowLoadRefreshBound) return

        window.__starterQuizLearnContentWindowLoadRefreshBound = true
        const refresh = () => {
            refreshLearnContentSwiper(
                document.querySelector(learnContentResultsSelector),
                'window-load',
            )
        }

        if (document.readyState === 'complete') {
            window.setTimeout(refresh, 0)
            return
        }

        window.addEventListener('load', refresh, { once: true })
    }

    function refreshLearnContentSwiper(resultsElement, source = 'results') {
        const swiperElement = resultsElement?.closest(
            '[data-swiper-scroll="swiper"]',
        )

        if (!swiperElement) return false

        prepareLearnContentSwiperSlides(resultsElement)
        bindLearnContentImageRefresh(resultsElement, swiperElement)
        bindLearnContentWindowLoadRefresh()

        const didUpdate = updateLearnContentSwiper(swiperElement, source)
        if (!didUpdate) {
            waitForLearnContentSwiper(swiperElement, source)
        }

        return didUpdate
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

        refreshLearnContentSwiper(resultsElement, source)

        if (didChange) {
            if (isDebugLoggingEnabled()) {
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
            const lastSync = window.__starterQuizLearnContentLastSync
            if (lastSync?.selectedCategoryFilterGroups?.length > 1) {
                scheduleRoundRobinLearnContentRender({
                    ...lastSync,
                    source: 'wf-algolia-results',
                    wfAlgolia,
                })
            }
            scheduleNormalizeLearnContentSlides('wf-algolia-results')
        })
        wfAlgolia.on('refresh', () => {
            const lastSync = window.__starterQuizLearnContentLastSync
            if (lastSync?.selectedCategoryFilterGroups?.length > 1) {
                scheduleRoundRobinLearnContentRender({
                    ...lastSync,
                    source: 'wf-algolia-refresh',
                    wfAlgolia,
                })
            }
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
            selectedCategoryFilterGroups,
            selectedCategoryFilters,
        } = getLearnContentCategoryFilters(pendingQuiz)

        if (!selectedCategoryFilter) return false

        window.selectedCategory = selectedCategoryFilter
        window.selectedCategoryFilters = selectedCategoryFilters

        const wfAlgolia = await waitForWfAlgoliaRuntime()

        if (!wfAlgolia) {
            if (isDebugLoggingEnabled()) {
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

        const filterField = getLearnContentFilterField(learnContentSection)

        window.__starterQuizLearnContentLastSync = {
            learnContentSection,
            filterField,
            selectedCategoryFilterGroups,
            source,
        }

        captureLearnContentTemplate(learnContentSection)
        bindLearnContentWfAlgoliaEvents(wfAlgolia)
        wfAlgolia.setFilter(filterField, selectedCategoryFilters)
        if (selectedCategoryFilterGroups.length > 1) {
            scheduleRoundRobinLearnContentRender({
                learnContentSection,
                filterField,
                selectedCategoryFilterGroups,
                source,
                wfAlgolia,
            })
        }
        scheduleNormalizeLearnContentSlides(source)
        window.dispatchEvent(
            new CustomEvent('starterQuizResultsReady', {
                detail: {
                    source,
                    selectedCategory,
                    selectedCategoryFilter,
                    selectedCategoryFilterGroups,
                    selectedCategoryFilters,
                    learnContentSection,
                },
            }),
        )

        if (isDebugLoggingEnabled()) {
            console.log(
                '[Starter Quiz Funnel]',
                '[results]',
                'synced LearnContent filters',
                {
                    source,
                    selectedCategory,
                    selectedCategoryFilter,
                    selectedCategoryFilterGroups,
                    selectedCategoryFilters,
                    filterField,
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
    const debugLogPrefix = '[Starter Quiz Funnel]'
    const recommendationAlgorithmVersion = 'category-subcategory-pairs-v21'
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
    const quizTaxonomyCatalog = [
        {
            id: 'paid-media',
            label: 'Paid Media',
            subcategories: [
                { id: 'paid-social', label: 'Paid Social' },
                { id: 'paid-search', label: 'Paid Search (SEM)' },
                {
                    id: 'programmatic-display',
                    label: 'Programmatic & Display',
                },
                { id: 'growth-marketing', label: 'Growth Marketing' },
                {
                    id: 'performance-creative-strategy',
                    label: 'Performance Creative Strategy',
                },
            ],
        },
        {
            id: 'content-organic',
            label: 'Content & Organic',
            subcategories: [
                { id: 'seo', label: 'SEO' },
                { id: 'content-marketing', label: 'Content Marketing' },
                { id: 'organic-social', label: 'Organic Social' },
                {
                    id: 'content-creation-ugc',
                    label: 'Content Creation & UGC',
                },
            ],
        },
        {
            id: 'creative',
            label: 'Creative',
            subcategories: [
                { id: 'creative-direction', label: 'Creative Direction' },
                { id: 'graphic-design', label: 'Graphic Design' },
                { id: 'copywriting', label: 'Copywriting' },
                { id: 'video-production', label: 'Video & Production' },
                { id: 'ui-ux-design', label: 'UI/UX Design' },
            ],
        },
        {
            id: 'influencer-affiliate-pr',
            label: 'Influencer, Affiliate & PR',
            subcategories: [
                {
                    id: 'influencer-marketing',
                    label: 'Influencer Marketing',
                },
                { id: 'affiliate-marketing', label: 'Affiliate Marketing' },
                { id: 'partnerships', label: 'Partnerships' },
                { id: 'pr-communications', label: 'PR & Communications' },
            ],
        },
        {
            id: 'retention-crm',
            label: 'Retention & CRM',
            subcategories: [
                { id: 'lifecycle-marketing', label: 'Lifecycle Marketing' },
                { id: 'retention-strategy', label: 'Retention Strategy' },
                { id: 'customer-experience', label: 'Customer Experience' },
            ],
        },
        {
            id: 'analytics-experimentation',
            label: 'Analytics & Experimentation',
            subcategories: [
                { id: 'data-analytics', label: 'Data & Analytics' },
                {
                    id: 'cro-experimentation',
                    label: 'CRO & Experimentation',
                },
            ],
        },
        {
            id: 'retail-marketplace',
            label: 'Retail & Marketplace',
            subcategories: [
                { id: 'retail-strategy', label: 'Retail Strategy' },
                {
                    id: 'amazon-marketplace',
                    label: 'Amazon & Online Marketplaces',
                },
            ],
        },
        {
            id: 'ai-technology',
            label: 'AI & Technology',
            subcategories: [
                {
                    id: 'shopify-site-dev',
                    label: 'Shopify & Web Development',
                },
                {
                    id: 'ecommerce-management',
                    label: 'E-Commerce Management',
                },
                {
                    id: 'digital-product-management',
                    label: 'Digital Product Management',
                },
                {
                    id: 'technology-leadership',
                    label: 'Technology Leadership',
                },
                { id: 'ai-automation', label: 'AI & Automation' },
            ],
        },
        {
            id: 'physical-product-development',
            label: 'Physical Product Development & Commercialization',
            subcategories: [
                { id: 'product-strategy', label: 'Product Strategy' },
                { id: 'product-development', label: 'Product Development' },
                { id: 'packaging-design', label: 'Packaging & Design' },
                { id: 'product-launch', label: 'Product Launch' },
            ],
        },
        {
            id: 'marketing-strategy-brand',
            label: 'Marketing Strategy & Brand',
            subcategories: [
                {
                    id: 'marketing-leadership',
                    label: 'Marketing Leadership',
                },
                { id: 'growth-strategy', label: 'Growth Strategy' },
                { id: 'brand-positioning', label: 'Brand & Positioning' },
            ],
        },
        {
            id: 'finance',
            label: 'Finance',
            subcategories: [
                { id: 'finance-leadership', label: 'Finance Leadership' },
                {
                    id: 'strategic-finance',
                    label: 'Strategic Finance / FP&A',
                },
                { id: 'accounting-control', label: 'Accounting & Control' },
            ],
        },
        {
            id: 'operations-supply-chain',
            label: 'Operations & Supply Chain',
            subcategories: [
                {
                    id: 'fulfillment-logistics',
                    label: 'Fulfillment & Logistics',
                },
                { id: 'demand-planning', label: 'Demand Planning' },
                {
                    id: 'operations-leadership',
                    label: 'Operations Leadership',
                },
            ],
        },
    ]
    const quizCategoryIdAliases = new Map([
        ['creative-brand', 'creative'],
        ['marketing-strategy-leadership', 'marketing-strategy-brand'],
        ['hiring-team-building', ''],
    ])
    const quizSubcategoryIdAliases = new Map([
        ['paid-search-sem', 'paid-search'],
        ['performance-creative', 'performance-creative-strategy'],
        ['amazon-advertising', 'amazon-marketplace'],
        ['e-commerce-management', 'ecommerce-management'],
        ['digital-product-mgmt', 'digital-product-management'],
        ['cmo-marketing-leadership', 'marketing-leadership'],
        ['financial-strategy', 'finance-leadership'],
        ['fp-a-modeling', 'strategic-finance'],
        ['coo-ops-leadership', 'operations-leadership'],
        ['brand-strategy', 'brand-positioning'],
        ['fractional-leadership', ''],
        ['org-design', ''],
        ['talent-recruiting', ''],
        ['procurement-sourcing', ''],
        ['supply-chain', ''],
        ['financial-analysis', ''],
        ['sourcing-manufacturing', ''],
        ['regulatory-compliance', ''],
        ['data-engineering', ''],
        ['wholesale-distribution', ''],
        ['loyalty-subscription', ''],
    ])
    const quizCategoryById = new Map(
        quizTaxonomyCatalog.map((category) => [category.id, category]),
    )
    const quizSubcategoryById = new Map(
        quizTaxonomyCatalog.flatMap((category) =>
            category.subcategories.map((subcategory) => [
                subcategory.id,
                { ...subcategory, categoryId: category.id },
            ]),
        ),
    )

    /**
     * Algolia field names checked, in order, for each displayed value. The
     * first present, non-empty field wins. Edit the rate lists below if the
     * index uses different attribute names. Dot paths (such as
     * categories.lvl1) are supported for nested fields.
     *
     * The host-resolved Starter indexes use `rate` for hourly rate,
     * `average-project-size` for project rate, and `categories.lvl0` /
     * `categories.lvl1` for category and subcategory data.
     */
    const hourlyRateFieldNames = ['rate', 'hourly-rate', 'hourlyRate']
    const projectRateFieldNames = [
        'average-project-size',
        'project-rate',
        'projectRate',
    ]

    /**
     * Subcategories come from the record's own hierarchical paths and nothing
     * else. `roles` is deliberately excluded: every hit carries it, so it used
     * to win this list and paint role slugs into the Subcategory chips. There
     * is no flattened Subcategory attribute on the index either — `categories`
     * is the only Subcategory source `attributesToRetrieve` requests.
     *
     * Do not add a flat attribute name here hoping to widen the source. Only
     * hierarchical "Parent > Child" values survive toSubcategoryLabels now, so
     * a flat field would resolve and then be discarded, looking like a silent
     * no-op. A new source has to carry the delimiter to be usable.
     */
    const subcategoryFieldNames = ['categories.lvl1']
    const maxDisplayedSubcategories = 3

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
     * Tells the /quiz-results loading component that the results are settled so
     * it can dismiss its overlay. Delegates to quiz-loader.js's
     * `window.StartersQuizLoader.signalReady()` when present; otherwise applies
     * the same producer contract inline (flag FIRST, then the document-level
     * CustomEvent) so this works regardless of script load order. Idempotent:
     * once the ready flag is set, later calls are no-ops.
     *
     * Must be called on every terminal outcome of initResultsPage that leaves
     * the visitor ON the page — otherwise the loader would wait forever.
     *
     * @param {string} [reason] Short label for which outcome triggered it.
     * @returns {void}
     */
    function signalQuizResultsReady(reason) {
        logQuizFlow('signaling quiz results ready to loader', { reason })

        const loader = window.StartersQuizLoader

        if (loader && typeof loader.signalReady === 'function') {
            loader.signalReady()
            return
        }

        if (window.__starterQuizResultsReady === true) return

        window.__starterQuizResultsReady = true
        document.dispatchEvent(new CustomEvent('starterQuizResults:ready'))
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
     * A draft payload counts as "no pending quiz": merely browsing /quiz leaves
     * one behind, and treating it as data used to strand a logged-out visitor on
     * an empty results page instead of letting redirectVisitorWithoutResults()
     * send them to /quiz. Returning null here also lets an authenticated member
     * fall through to their saved Memberstack answers unchanged.
     *
     * The sessionStorage key is deliberately NOT removed. quiz-loader.js derives
     * its skip-on-refresh run id from the payload's `updatedAt`, and the draft is
     * the funnel's own in-progress record; this page only has to ignore it.
     *
     * @returns {object | null} Usable pending quiz payload, or null.
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

        if (!isPendingQuizReady(pendingQuiz)) {
            logQuizFlow(
                'ignoring unfinished pending quiz from sessionStorage; payload kept',
                {
                    status: pendingQuiz.status,
                    updatedAt: pendingQuiz.updatedAt,
                    pendingQuizStorageKey,
                },
            )
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

        quizTaxonomyCatalog.forEach((category) => {
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

            category.subcategories.forEach((subcategory) => {
                const subcategoryId = subcategory.id
                const subcategoryLabel = subcategory.label
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
     * Display-name overrides for role slugs that formatSlugTitle mangles
     * (acronyms, and one plural). Keyed on the RAW stored slug.
     *
     * KEEP IN SYNC across:
     *   quiz-results.js
     *   algolia-result-modifiers/roles.js
     *   starters-list-filter/custom-algolia-scripts/filters-text.js
     *   v3/saved-starters-roles.js
     *   v3/onboarding-profile-preview.js
     */
    const ROLE_NAMES = {
        'ui-ux-designer': 'UI/UX Designer',
        'cro-expert': 'CRO Expert',
        'seo-marketer': 'SEO Marketer',
        'crm-marketer': 'CRM Marketer',
        'cx-director': 'CX Director',
        'pr-directors': 'PR Director',
        'ai-automation-expert': 'AI Automation Expert',
        'e-commerce-manager': 'E-Commerce Manager',
    }

    /**
     * Resolves a role slug to its display name, falling back to plain title
     * case. Card role text lands in `.expert-card_service-text`, which is
     * `text-transform: capitalize` — that only uppercases word-initial letters
     * and never lowercases, so "UI/UX Designer" survives it intact.
     *
     * @param {string | null | undefined} slug Raw role slug from Algolia.
     * @returns {string} Display-ready role name.
     */
    function formatRoleName(slug) {
        const key = normalize(slug).toLowerCase()
        return ROLE_NAMES[key] || formatSlugTitle(slug)
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

    function getQuizTaxonomyItemId(item) {
        if (typeof item === 'string') return slugify(item)

        return slugify(item?.id) || slugify(item?.label)
    }

    function resolveQuizCategory(item) {
        const sourceId = getQuizTaxonomyItemId(item)
        const canonicalId = quizCategoryIdAliases.has(sourceId)
            ? quizCategoryIdAliases.get(sourceId)
            : sourceId

        return {
            sourceId,
            category: canonicalId
                ? quizCategoryById.get(canonicalId) || null
                : null,
        }
    }

    function resolveQuizSubcategory(item) {
        const sourceId = getQuizTaxonomyItemId(item)
        const canonicalId = quizSubcategoryIdAliases.has(sourceId)
            ? quizSubcategoryIdAliases.get(sourceId)
            : sourceId

        return {
            sourceId,
            subcategory: canonicalId
                ? quizSubcategoryById.get(canonicalId) || null
                : null,
        }
    }

    /**
     * Converts saved pre-rollout quiz selections to the current canonical
     * taxonomy before any rendering, filtering, recommendation, or save path
     * consumes them. Renames and merges map deterministically. Retired or
     * unknown choices are discarded because they have no approved successor.
     *
     * @param {object} pendingQuiz Saved or freshly submitted quiz payload.
     * @returns {{
     *   payload: object,
     *   changed: boolean,
     *   droppedCategoryIds: string[],
     *   droppedSubcategoryIds: string[],
     *   requiresReselection: boolean
     * }} Canonical payload and compatibility outcome.
     */
    function normalizeQuizTaxonomyPayload(pendingQuiz) {
        const sourceCategories = Array.isArray(pendingQuiz?.categories)
            ? pendingQuiz.categories
            : []
        const sourceSubcategories = Array.isArray(pendingQuiz?.subcategories)
            ? pendingQuiz.subcategories
            : []
        const categories = []
        const subcategories = []
        const categoryIds = new Set()
        const subcategoryIds = new Set()
        const droppedCategoryIds = []
        const droppedSubcategoryIds = []

        const addCategory = (category) => {
            if (!category || categoryIds.has(category.id)) return

            categoryIds.add(category.id)
            categories.push({ id: category.id, label: category.label })
        }

        sourceCategories.forEach((item) => {
            const { sourceId, category } = resolveQuizCategory(item)
            if (!category) {
                if (sourceId) droppedCategoryIds.push(sourceId)
                return
            }

            addCategory(category)
        })

        sourceSubcategories.forEach((item) => {
            const { sourceId, subcategory } = resolveQuizSubcategory(item)
            if (!subcategory) {
                if (sourceId) droppedSubcategoryIds.push(sourceId)
                return
            }
            if (subcategoryIds.has(subcategory.id)) return

            const parentCategory = quizCategoryById.get(
                subcategory.categoryId,
            )
            if (!parentCategory) {
                droppedSubcategoryIds.push(sourceId || subcategory.id)
                return
            }

            addCategory(parentCategory)
            subcategoryIds.add(subcategory.id)
            subcategories.push({
                id: subcategory.id,
                label: subcategory.label,
                categoryId: subcategory.categoryId,
            })
        })

        const payload = {
            ...pendingQuiz,
            categories,
            subcategories,
        }
        const hadTaxonomySelections =
            sourceCategories.length > 0 || sourceSubcategories.length > 0
        const changed =
            JSON.stringify(sourceCategories) !== JSON.stringify(categories) ||
            JSON.stringify(sourceSubcategories) !==
                JSON.stringify(subcategories)

        return {
            payload,
            changed,
            droppedCategoryIds: Array.from(new Set(droppedCategoryIds)),
            droppedSubcategoryIds: Array.from(
                new Set(droppedSubcategoryIds),
            ),
            requiresReselection:
                hadTaxonomySelections && categories.length === 0,
        }
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
     * Returns the sticky-navbar offset for TOC anchor scrolling.
     *
     * @returns {number} Offset in pixels (navbar height plus breathing room).
     */
    function getTocScrollOffset() {
        const navbar = document.querySelector('.w-nav')
        if (!navbar) return 16

        const position = window.getComputedStyle?.(navbar)?.position
        if (position !== 'sticky' && position !== 'fixed') return 16

        return (navbar.offsetHeight || 0) + 16
    }

    /**
     * Scrolls the window to a TOC anchor target below the sticky navbar.
     *
     * @param {HTMLElement} target Anchor element.
     * @returns {void}
     */
    function scrollToTocTarget(target) {
        const top =
            target.getBoundingClientRect().top +
            window.scrollY -
            getTocScrollOffset()

        window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' })
    }

    let tocAnchorClicksBound = false
    const stampedTocAnchors = new Map()

    /**
     * Binds one delegated click handler for TOC anchor links.
     *
     * Links live inside [data-toc-algolia-link] CMS items; their hrefs are
     * #<slug> hashes. Native hash navigation is left alone when no stamped
     * anchor exists for the hash.
     *
     * @returns {void}
     */
    function bindTocAnchorClicks() {
        if (tocAnchorClicksBound) return
        tocAnchorClicksBound = true

        // Capture phase + stopPropagation: Webflow.js binds its own
        // document-level smooth scroll to a[href^="#"] clicks, which would
        // run after this handler and re-scroll the anchor to the viewport
        // top, under the sticky navbar. preventDefault alone cannot stop it.
        document.addEventListener(
            'click',
            (event) => {
                const link = event.target?.closest?.(
                    '[data-toc-algolia-link] a[href^="#"]',
                )
                if (!link) return

                const slug = slugify(link.getAttribute('href'))
                const target = slug ? stampedTocAnchors.get(slug) : null
                if (!target) return

                event.preventDefault()
                event.stopPropagation()
                scrollToTocTarget(target)
                window.history?.pushState?.(null, '', `#${slug}`)
            },
            true,
        )
    }

    /**
     * Stamps TOC anchor ids and wires offset-aware anchor scrolling.
     *
     * Webflow cannot bind a per-item id on CMS items, and the
     * [data-toc-algolia-target] wrappers use display: contents (no layout
     * box), so native #hash navigation has nothing to scroll to. This stamps
     * each section's slug as an id on its first element child (which has a
     * box) and binds the TOC click handler. The results flow handles an initial
     * deep-link hash after rendering settles.
     *
     * @returns {void}
     */
    function syncTocAnchorNavigation() {
        const sections = Array.from(
            document.querySelectorAll('[data-toc-algolia-target]'),
        )
        const stampedSlugs = []
        const skippedSlugs = []

        stampedTocAnchors.clear()

        sections.forEach((section) => {
            const slug = slugify(
                section.getAttribute('data-toc-algolia-target'),
            )
            const anchor = section.firstElementChild

            if (!slug || !anchor || (anchor.id && anchor.id !== slug)) {
                skippedSlugs.push(slug)
                return
            }

            if (!anchor.id) anchor.setAttribute('id', slug)
            stampedTocAnchors.set(slug, anchor)
            stampedSlugs.push(slug)
        })

        bindTocAnchorClicks()

        logQuizFlow('stamped TOC anchor ids', { stampedSlugs, skippedSlugs })
    }

    /**
     * Scrolls to the initial TOC hash after result rendering has settled.
     *
     * @returns {void}
     */
    function scrollToInitialTocHash() {
        const hashSlug = slugify(window.location.hash)
        if (!hashSlug) return

        const target = stampedTocAnchors.get(hashSlug)
        if (target) scrollToTocTarget(target)
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
     * Extracts the company names from an Algolia `work-history` attribute.
     *
     * The field holds an array of `{company, title, logo, domain}` objects. Only
     * the company names are read here, and they stay in the index's array order
     * so recommendation cards list companies the same way /all-starters does
     * (`work-history.0.company`, `.1.company`, `.2.company`). Repeat stints at
     * one company collapse to a single entry, matched case-insensitively, with
     * the first spelling kept. Entries whose `company` is missing or is not a
     * string are dropped rather than coerced, because normalize() only accepts
     * strings.
     *
     * @param {unknown} value Attribute value from Algolia.
     * @returns {string[]} Company names in index order, deduplicated.
     */
    function getWorkHistoryCompanies(value) {
        if (!Array.isArray(value)) return []

        const seenCompanies = new Set()

        return value.reduce((companies, entry) => {
            if (typeof entry?.company !== 'string') return companies

            const company = normalize(entry.company)
            if (!company) return companies

            const companyKey = company.toLowerCase()
            if (seenCompanies.has(companyKey)) return companies

            seenCompanies.add(companyKey)
            companies.push(company)

            return companies
        }, [])
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
     * Hierarchical values such as "Design > Branding" become "Branding". A
     * value carrying no ">" is a bare Category (or a leftover slug), not a
     * Subcategory, so it yields nothing rather than promoting itself to a chip.
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

                return segments.length > 1 ? segments[segments.length - 1] : ''
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

    let hasWarnedAboutEmptySubcategories = false

    /**
     * Reports whether a hostname is one of this project's staging surfaces.
     *
     * Anchored on purpose (same shape as account-settings/plan-dates.js): a
     * lookalike such as "notwebflow.io" or "evil-trycloudflare.com" must not
     * read as staging.
     *
     * @param {string} hostname Hostname to classify.
     * @returns {boolean} True on a staging host.
     */
    function isStagingHost(hostname) {
        const host = hostname || ''

        return (
            /(\.|^)webflow\.io$/.test(host) ||
            host === 'localhost' ||
            host === '127.0.0.1' ||
            /(\.|^)trycloudflare\.com$/.test(host)
        )
    }

    /**
     * Reports whether staging diagnostics should print.
     *
     * STARTERS_DEBUG belongs here and not in isStagingHost(): it may turn
     * logging on in production, but it must never widen what counts as a
     * staging host. isDebugLoggingEnabled() is this controller's own opt-in
     * (query param or stored flag) and is honoured alongside it.
     *
     * @returns {boolean} True when diagnostics may print.
     */
    function isStagingDiagnosticsEnabled() {
        if (window.STARTERS_DEBUG === true) return true
        if (isDebugLoggingEnabled()) return true

        return isStagingHost(window.location?.hostname || '')
    }

    /**
     * Warns once per page load when hits carry a `categories` object yet no
     * Subcategory label resolves from any of them.
     *
     * The Consult card's chips now hang entirely on the nested dot-walk for
     * `categories.lvl1`. If the index is ever reshaped (flattened, renamed, or
     * dropped from attributesToRetrieve) the chips just go blank, which looks
     * like a styling problem rather than a data one. This is the only signal
     * that distinguishes "this Starter genuinely has no Subcategories" from
     * "the field moved". Staging-only, so production stays silent.
     *
     * @param {object[]} candidates Normalized recommendation candidates.
     * @returns {void}
     */
    function warnWhenSubcategoriesResolveEmpty(candidates) {
        if (hasWarnedAboutEmptySubcategories || !candidates.length) return

        if (!isStagingDiagnosticsEnabled()) return

        // Nothing to report when the attribute is absent altogether: that is
        // either a query change or an index without categories, and the warning
        // below would be guesswork.
        const withCategories = candidates.filter(
            (candidate) =>
                candidate.categories && typeof candidate.categories === 'object',
        )
        if (!withCategories.length) return
        if (candidates.some((candidate) => candidate.subcategories.length)) return

        hasWarnedAboutEmptySubcategories = true
        console.warn(
            '[Starter Quiz Funnel]',
            '[results]',
            'hits carry `categories` but no Subcategory label resolved from ' +
                'categories.lvl1 — Consult chips will render blank',
            {
                fieldNames: subcategoryFieldNames,
                hitsWithCategories: withCategories.length,
                sampleCategories: withCategories[0].categories,
            },
        )
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
     * @returns {{appId: string, searchKey: string, indexName: string}} Algolia config.
     */
    function getAlgoliaSearchConfig() {
        const resolver = window.StartersV3AlgoliaEnvironment
        const resolved = resolver?.getManagedSearchConfig?.('starters')

        return {
            appId: normalize(resolved?.appId),
            searchKey: normalize(resolved?.searchKey),
            indexName: normalize(resolved?.indexName),
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

        if (!config.appId || !config.searchKey || !config.indexName) {
            throw new Error(
                'Managed Algolia search configuration is unavailable.',
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
                        'work-history',
                        'bio',
                        'tagline',
                        'free-consulting-calls-t-f',
                        'paid-consulting-calls-t-f',
                        'profile-type',
                        'city',
                        'state',
                        'country',
                        'service-1',
                        'service-2',
                        'service-3',
                        'availability',
                        'ranking-points',
                        'review_count',
                        'review_average',
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
        if (!config.appId || !config.searchKey || !config.indexName) return null

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

        const candidates = hits
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
                roles: normalizeAlgoliaList(hit.roles).map(formatRoleName),
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
                workHistoryCompanies: getWorkHistoryCompanies(
                    hit['work-history'],
                ),
                bio: stripHtml(hit.bio),
                freeConsultingCalls: hit['free-consulting-calls-t-f'] === true,
                paidConsultingCalls: hit['paid-consulting-calls-t-f'] === true,
                matchedCategory: matchedCategorySummary,
                matchedSubcategory: matchedSubcategorySummary,
                availability: normalize(hit.availability),
                rankingPoints: getRankingPoints(hit['ranking-points']),
            }))

        warnWhenSubcategoriesResolveEmpty(candidates)

        return candidates
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

    function getFirstName(name) {
        return normalize(name).split(/\s+/).filter(Boolean)[0] || ''
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
            case 'first-name':
            case 'firstName':
                return getFirstName(freelancer.name)
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
                // Prefer every company in work-history; records without it fall
                // back to the single previous-company string.
                return freelancer.workHistoryCompanies?.length
                    ? freelancer.workHistoryCompanies
                    : freelancer.previousCompany
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
            // Naming trap: this is the BRAND'S QUIZ SELECTION, not the
            // Starter's own Subcategory. The record's own leaf (from
            // categories.lvl1) is only reachable through the `rank-role`
            // binding. Card markup that wants "what this Starter does" must
            // keep using rank-role; data-quiz-text="subcategory" prints the
            // same selected label on every card in the group.
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
     * short-name is part of the shared library format vocabulary (wf-algolia
     * fork + wf-xano ship the same value): first word kept, every following
     * word abbreviated — "John Paul Dionisio" → "John P. D.".
     *
     * @param {unknown} value Field value.
     * @param {string} format One of currency, number, rank, short-name, or empty.
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
        if (format === 'short-name') {
            return getLockedDisplayName(stripHtml(value))
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

    const cardConditionOperators = ['===', '!==', '>=', '<=', '>', '<']

    /**
     * Evaluates a wf-algolia-if / wf-xano-if style expression against a card
     * record (ported from wf-xano's evalIf so every renderer shares one
     * conditional grammar).
     *
     * Supports ===, !==, >=, <=, >, < with a field name on the left and a
     * quoted string or number literal on the right; a bare field name checks
     * truthiness. Equality compares as strings, ordering compares as numbers,
     * matching the library behavior.
     *
     * @param {object} freelancer Normalized freelancer recommendation.
     * @param {string} expression Condition expression.
     * @returns {boolean} True when the element should be visible.
     */
    function evaluateCardCondition(freelancer, expression) {
        const operator = cardConditionOperators.find(
            (candidate) => expression.indexOf(candidate) > -1,
        )

        if (!operator) {
            return Boolean(getCardFieldValue(freelancer, expression.trim()))
        }

        const parts = expression.split(operator)
        const left = getCardFieldValue(freelancer, parts[0].trim())
        const right = (parts[1] || '').trim().replace(/^["']|["']$/g, '')
        const leftNumber = Number.parseFloat(left)
        const rightNumber = Number.parseFloat(right)
        const numeric = !Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)

        switch (operator) {
            case '===':
                return String(left) === right
            case '!==':
                return String(left) !== right
            case '>':
                return numeric && leftNumber > rightNumber
            case '>=':
                return numeric && leftNumber >= rightNumber
            case '<':
                return numeric && leftNumber < rightNumber
            case '<=':
                return numeric && leftNumber <= rightNumber
            default:
                return false
        }
    }

    /**
     * Populates one existing card element from a freelancer recommendation.
     *
     * Reads data-quiz-* attributes inside the card and hides empty slots — the
     * wf-algolia grammar (wf-algolia-if / -text / -image / -format /
     * -link-template) is accepted as an alias wherever the semantics match the
     * library. A missing data-quiz-required field fails the card (caller
     * hides it).
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

        // Visibility toggles. data-quiz-show-if hides the element when the
        // field is falsy/empty. wf-algolia-if takes the same expression
        // grammar as the wf-algolia and wf-xano libraries, e.g.
        // wf-algolia-if="profile-type !== 'Consult'", so card markup shares
        // one conditional dialect across all renderers.
        cardElement
            .querySelectorAll('[data-quiz-show-if]')
            .forEach((element) => {
                const field = element.getAttribute('data-quiz-show-if')
                const isShown = !isEmptyCardValue(
                    getCardFieldValue(freelancer, field),
                )
                element.classList.toggle('hide', !isShown)
            })

        cardElement.querySelectorAll('[wf-algolia-if]').forEach((element) => {
            const isShown = evaluateCardCondition(
                freelancer,
                element.getAttribute('wf-algolia-if') || '',
            )
            element.classList.toggle('hide', !isShown)
        })

        // Images (data-quiz-img, or the library-shared wf-algolia-image).
        cardElement
            .querySelectorAll('[data-quiz-img], [wf-algolia-image]')
            .forEach((element) => {
            const field =
                element.getAttribute('data-quiz-img') ||
                element.getAttribute('wf-algolia-image')
            const url = normalize(getCardFieldValue(freelancer, field))

            if (!url) {
                element.classList.add('hide')
                failIfRequired(element)
                return
            }

            element.setAttribute('src', url)
            // Webflow template imgs carry a placeholder srcset/sizes pair that
            // outranks the src we just set, so the placeholder keeps rendering.
            if (element.hasAttribute('srcset')) element.removeAttribute('srcset')
            if (element.hasAttribute('sizes')) element.removeAttribute('sizes')
            element.setAttribute('alt', normalize(freelancer.name))
            element.classList.remove('hide')
        })

        // Single-value text bindings (supports the rank-role composite token).
        // wf-algolia-text / wf-algolia-format are accepted as aliases so card
        // markup can use the shared library grammar.
        cardElement
            .querySelectorAll('[data-quiz-text], [wf-algolia-text]')
            .forEach((element) => {
            const field =
                element.getAttribute('data-quiz-text') ||
                element.getAttribute('wf-algolia-text')
            const fallbackFields =
                element.getAttribute('data-quiz-fallback') ||
                element.getAttribute('data-quiz-fallback-fields') ||
                ''
            const format =
                element.getAttribute('data-quiz-format') ||
                element.getAttribute('wf-algolia-format') ||
                ''

            if (field === 'rank-role') {
                // Show the record's OWN subcategory, not the quiz selection that
                // surfaced it: prefer the record subcategory equal to the matched
                // selection, then the record's primary subcategory, and only fall
                // back to the matched selection when the record carries none.
                //
                // Naming trap: the sibling field `subcategory` in
                // getCardFieldValue returns the quiz selection instead, which is
                // identical on every card in a group. This branch is the only
                // one that speaks for the record, so keep record-own markup on
                // rank-role.
                //
                // Printed as stored, without formatSlugTitle: these labels come
                // from categories.lvl1, which already holds display case, and
                // the formatter splits on [-_\s]+ — it would flatten
                // "E-Commerce Management" into "E Commerce Management".
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
                const shown = setCardText(element, subcategory)
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
        cardElement
            .querySelectorAll('[data-quiz-link], [wf-algolia-link-template]')
            .forEach((element) => {
            const template =
                element.getAttribute('data-quiz-link') ||
                element.getAttribute('wf-algolia-link-template') ||
                ''
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

    function getMemberCustomFields(member) {
        if (!member || typeof member !== 'object' || Array.isArray(member)) {
            return {}
        }

        return (
            member.customFields ||
            member.custom_fields ||
            member['custom-fields'] ||
            {}
        )
    }

    function hasStarterQuizCompletionMarker(member) {
        const value = getMemberCustomFields(member)['starter-quiz']

        return typeof value === 'string'
            ? normalize(value) !== ''
            : Boolean(value)
    }

    function getAuthenticatedNoQuizDataRedirectTarget(member) {
        if (
            !member ||
            typeof member !== 'object' ||
            Array.isArray(member) ||
            !member.id
        ) {
            return null
        }

        return hasStarterQuizCompletionMarker(member)
            ? '/quiz?retake=true&quizDataMissing=1'
            : '/quiz'
    }

    /**
     * Positively resolves Memberstack's auth state for this page load.
     *
     * Every uncertain outcome answers `resolved: false` — Memberstack never
     * loaded, the DOM package has no getCurrentMember(), the response carries no
     * `data` property at all, or the call threw. Callers must therefore never
     * read "we could not tell" as "logged out", which is the discipline the
     * no-data redirect has always followed and the stale-cache reset below
     * depends on just as much.
     *
     * @returns {Promise<{resolved: boolean, isLoggedOut: boolean, member: any, error?: unknown}>}
     *   Resolved auth state.
     */
    async function resolveMemberstackAuthState() {
        try {
            const memberstack = await waitForMemberstack()

            if (
                !memberstack ||
                typeof memberstack.getCurrentMember !== 'function'
            ) {
                return { resolved: false, isLoggedOut: false, member: undefined }
            }

            const response = await memberstack.getCurrentMember()
            const hasMemberData =
                response &&
                typeof response === 'object' &&
                Object.prototype.hasOwnProperty.call(response, 'data')

            if (!hasMemberData) {
                return { resolved: false, isLoggedOut: false, member: undefined }
            }

            const member = response.data
            const isLoggedOut =
                member == null ||
                (typeof member === 'object' &&
                    !Array.isArray(member) &&
                    !member.id)

            return { resolved: true, isLoggedOut, member }
        } catch (error) {
            return {
                resolved: false,
                isLoggedOut: false,
                member: undefined,
                error,
            }
        }
    }

    /**
     * Tells a member-side cache apart from the funnel's own pre-signup record.
     *
     * `memberstackSavedAt` is stamped only by this controller, and only for a
     * logged-in member: getPendingQuizFromMemberstack() adds it to the payload it
     * caches out of member JSON, createMemberstackStarterQuizPayload() writes it
     * into the member-JSON copy itself, and initResultsPage() stamps it after a
     * successful Memberstack save. quiz-main.js's savePendingQuiz() — the only
     * pre-signup writer — never writes the field: its payload is exactly
     * `categories`, `subcategories`, `resultSlug`, `status`, `updatedAt`,
     * `completedAt`. The marker is therefore proof of a member cache, and its
     * absence protects the pre-signup preview.
     *
     * The marker is read type-safely, the same way hasStarterQuizCompletionMarker()
     * reads its custom field, because normalize() is `(value || '').trim()` with no
     * String() coercion and sessionStorage is visitor-writable: a marker that
     * survived a JSON round-trip as a number, or was tampered with, would throw a
     * TypeError here and take the whole boot flow down with it. Any truthy
     * non-string value still counts as a member cache — only this controller ever
     * writes the field, so anything in it means the payload came through the
     * member path, and treating it as a cache is also the safer default: the worst
     * case is one redirect to /quiz for a logged-out visitor, versus previewing
     * somebody else's results.
     *
     * @param {object | null | undefined} pendingQuiz Stored quiz payload.
     * @returns {boolean} True when the payload came from a logged-in member.
     */
    function isMemberCachedPendingQuiz(pendingQuiz) {
        if (
            !pendingQuiz ||
            typeof pendingQuiz !== 'object' ||
            Array.isArray(pendingQuiz)
        ) {
            return false
        }

        const marker = pendingQuiz.memberstackSavedAt

        return typeof marker === 'string'
            ? normalize(marker) !== ''
            : Boolean(marker)
    }

    /**
     * Clears a member-cached pending quiz once Memberstack positively reports the
     * visitor as logged out.
     *
     * sessionStorage survives logout — and Chrome session restore — while nothing
     * in the logout path touches this key, so a member's cached answers kept
     * previewing their results to whoever used the browser next. A four-day-old
     * `status: 'ready'` payload was captured doing exactly that on 2026-08-03.
     *
     * Three guards keep the pre-signup funnel untouched:
     * - no stored payload, or no member-cache marker, returns immediately, before
     *   any Memberstack round-trip, so a genuine pre-signup preview boots exactly
     *   as fast as it does today and is never cleared;
     * - only a POSITIVELY resolved logged-out state clears anything, so an
     *   unavailable or erroring Memberstack leaves the payload alone; and
     * - a logged-in member keeps their cache, which is the whole point of it.
     *
     * Removing the key is safe here even though quiz-loader.js derives its
     * skip-on-refresh run id from `parsed(starterQuizPending).updatedAt`: this
     * branch fires only for a logged-out visitor holding someone else's cache,
     * who has no legitimate results run to replay — the very next thing that
     * happens is redirectVisitorWithoutResults() sending them to /quiz.
     *
     * This runs first in initResultsPage(), so it is wrapped end to end: anything
     * unexpected here degrades to today's behavior (payload kept, boot continues)
     * rather than rejecting out of a fire-and-forget boot call and leaving
     * quiz-loader.js's overlay up forever. The boot call carries its own
     * rejection handler as the outer net.
     *
     * @returns {Promise<boolean>} True when the stale cache was removed.
     */
    async function clearMemberCachedPendingQuizWhenLoggedOut() {
        try {
            const storedRaw = sessionStorage.getItem(pendingQuizStorageKey)

            if (!storedRaw) return false

            const storedPendingQuiz = parsePendingQuiz(storedRaw)

            if (!isMemberCachedPendingQuiz(storedPendingQuiz)) return false

            const authState = await resolveMemberstackAuthState()

            if (!authState.resolved) {
                logQuizFlow(
                    'auth state unresolved; member-cached pending quiz kept',
                    { pendingQuizStorageKey },
                )
                return false
            }

            if (!authState.isLoggedOut) return false

            sessionStorage.removeItem(pendingQuizStorageKey)
            logQuizFlow(
                'logged-out visitor holding a member-cached pending quiz; cleared',
                {
                    pendingQuizStorageKey,
                    memberstackSavedAt: storedPendingQuiz.memberstackSavedAt,
                    status: storedPendingQuiz.status,
                    updatedAt: storedPendingQuiz.updatedAt,
                },
            )

            return true
        } catch (error) {
            logQuizFlow('stale-cache reset failed; pending quiz left in place', {
                error,
            })
            return false
        }
    }

    /**
     * When the results page has no usable quiz data, send a positively resolved
     * visitor back to the quiz. Logged-out visitors start normally. Authenticated
     * members with a completion marker but missing or malformed member JSON are
     * sent through an explicit retake so they do not remain on an empty results
     * page. If Memberstack is unavailable, stay put rather than risk a redirect
     * loop. A pre-signup funnel visitor is unaffected because sessionStorage is
     * checked before this branch.
     */
    async function redirectVisitorWithoutResults() {
        // Shares resolveMemberstackAuthState() with the stale-cache reset above so
        // the two cannot drift on what counts as a positively logged-out visitor.
        const authState = await resolveMemberstackAuthState()

        if (!authState.resolved) {
            logQuizFlow('no-data redirect check unresolved; staying on page', {
                error: authState.error,
            })
            return
        }

        if (authState.isLoggedOut) {
            logQuizFlow('logged-out visitor with no quiz data; redirecting to /quiz')
            window.location.replace('/quiz')
            return
        }

        const authenticatedRedirectTarget =
            getAuthenticatedNoQuizDataRedirectTarget(authState.member)

        if (authenticatedRedirectTarget) {
            logQuizFlow(
                'authenticated member with no usable quiz data; redirecting to quiz',
                {
                    hasCompletionMarker: hasStarterQuizCompletionMarker(
                        authState.member,
                    ),
                    redirectTarget: authenticatedRedirectTarget,
                },
            )
            window.location.replace(authenticatedRedirectTarget)
        }
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
            const customFields = getMemberCustomFields(memberData)
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

            // Caches the member's saved answers under the same key the funnel
            // uses. A logged-in member holding only a draft now reaches this
            // point (getPendingQuiz() ignores drafts), so this replaces that
            // draft rather than adding to it. Ratified as acceptable: the
            // replacement is a fresher payload that still carries `updatedAt`,
            // so quiz-loader.js keeps deriving a valid skip-on-refresh run id
            // from this key — the draft is superseded, never simply removed.
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
        const savedAt =
            pendingQuiz?.memberstackSavedAt || new Date().toISOString()
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

    // Attribution cookie name -> Memberstack custom field ID. The sitewide
    // attribution script writes these first-party cookies with a 72h TTL; the
    // field IDs are verified against the live Memberstack app config, and the
    // mapping is simply underscores swapped for hyphens (event_id -> event-id).
    //
    // signup_source and signup_referrer are the odd ones out in where they come
    // from: the attribution script derives them at the Memberstack auth
    // transition, from the path of the page the signup happened on and from the
    // same-origin referrer of that page. For this funnel that page is /quiz, so
    // both cookies are already sitting there by the time this controller runs on
    // /quiz-results. Reading them here is the only way a quiz signup gets the
    // fields, because /quiz is the one armed page the attribution script
    // deliberately does not write fields for.
    //
    // signup_referrer is why the attribution script must capture at the
    // transition and not on every page load: this page's own referrer is /quiz,
    // so a load-time capture would have overwritten the real answer with /quiz
    // before this read ever happens.
    //
    // All eleven IDs below exist in the live app config. Verify any of them with:
    //   curl -s https://client.memberstack.com/app \
    //     -H 'X-APP-ID: app_clc2a0dyo00kf0uldcm11fl0q'
    const attributionCookieFieldIds = {
        utm_source: 'utm-source',
        utm_campaign: 'utm-campaign',
        utm_adset: 'utm-adset',
        utm_content: 'utm-content',
        fbclid: 'fbclid',
        fbc: 'fbc',
        fbp: 'fbp',
        event_id: 'event-id',
        signup_source: 'signup-source',
        signup_referrer: 'signup-referrer',
        signup_trigger: 'signup-trigger',
    }

    /**
     * Reads one first-party cookie value by name.
     *
     * @param {string} name Cookie name to read.
     * @returns {string} Decoded cookie value, or an empty string when absent.
     */
    function getCookieValue(name) {
        const cookies = String(document.cookie || '').split(';')

        for (const cookie of cookies) {
            const separatorIndex = cookie.indexOf('=')

            if (separatorIndex === -1) continue
            if (cookie.slice(0, separatorIndex).trim() !== name) continue

            const rawValue = cookie.slice(separatorIndex + 1).trim()

            try {
                return decodeURIComponent(rawValue)
            } catch (error) {
                // A half-written or malformed cookie should still contribute
                // its raw value rather than throw away the whole save.
                return rawValue
            }
        }

        return ''
    }

    /**
     * Collects the attribution cookies as Memberstack custom fields.
     *
     * The quiz save is the first authenticated moment these values can be
     * attached to a member. Absent and empty cookies are omitted so a later
     * untagged visit never blanks a value an earlier tagged visit captured.
     *
     * @returns {object} Non-empty attribution values keyed by custom field ID.
     */
    function getAttributionCustomFields() {
        const customFields = {}

        for (const cookieName of Object.keys(attributionCookieFieldIds)) {
            const value = normalize(getCookieValue(cookieName))

            if (!value) continue

            customFields[attributionCookieFieldIds[cookieName]] = value
        }

        return customFields
    }

    // The attribution fields that are write-once on the member: each records a
    // fact about one signup, so a later write must never replace it. The other
    // eight are last-touch on purpose, because a fresh ad click is supposed to
    // update them.
    const writeOnceFieldIds = [
        attributionCookieFieldIds.signup_source,
        attributionCookieFieldIds.signup_referrer,
        attributionCookieFieldIds.signup_trigger,
    ]

    /**
     * Tells whether an outgoing write carries anything the guard could hold back.
     *
     * The gate on the member read below. A quiz signup reached by direct
     * navigation has no signup_referrer cookie, and a cookie read that threw
     * leaves the payload empty, so in both cases reading the member could not
     * change the write and is not worth a round trip.
     *
     * @param {object} customFields Outgoing attribution fields, by field ID.
     * @returns {boolean} True when at least one write-once field is present.
     */
    function carriesWriteOnceField(customFields) {
        if (!customFields) return false

        return writeOnceFieldIds.some(
            (fieldId) => customFields[fieldId] !== undefined,
        )
    }

    /**
     * Drops the write-once fields from an outgoing write when the member already
     * has them.
     *
     * The quiz funnel needs this guard as much as the direct-signup path does,
     * and the way it gets hit here is easy to miss. The sitewide attribution
     * script arms /quiz and writes signup_source=/quiz plus signup_referrer on any
     * logged-out to logged-in transition there, which includes a RETURNING member
     * simply logging in on /quiz. They land here, and without this guard their real
     * signup page and referrer are overwritten with today's.
     *
     * Only those two keys are stripped, and each is judged on its own, so a member
     * holding one of the pair still gets the other written.
     *
     * An unreadable existing value writes rather than skips. The common case by a
     * wide margin is a genuine first signup whose fields are empty, so skipping on
     * a failed read would throw away real attribution on most signups to protect
     * against the rarer overwrite. Empty, whitespace-only and absent values are
     * all unfilled, using the same normalize() check hasStarterQuizCompletionMarker
     * applies to starter-quiz.
     *
     * @param {object} customFields Outgoing attribution fields, by field ID.
     * @param {object} existingCustomFields The member's current custom fields.
     * @returns {object} The same object, or a copy without the filled write-once
     *     fields.
     */
    function withoutFilledWriteOnceFields(customFields, existingCustomFields) {
        if (!customFields) return customFields

        const filled = writeOnceFieldIds.filter((fieldId) => {
            if (customFields[fieldId] === undefined) return false

            const existing = existingCustomFields?.[fieldId]

            return normalize(existing == null ? '' : String(existing)) !== ''
        })

        if (!filled.length) return customFields

        const kept = { ...customFields }

        for (const fieldId of filled) delete kept[fieldId]

        return kept
    }

    /**
     * Saves a short starter quiz summary to one Memberstack custom field.
     *
     * Create a Memberstack custom field named Starter Quiz with field ID
     * starter-quiz. This field is intentionally not the full JSON payload.
     *
     * Attribution cookies ride along in the same updateMember call so the quiz
     * save stays a single write. Gathering them can never fail the save: any
     * error degrades to writing starter-quiz alone.
     *
     * The write-once fields (signup-source, signup-referrer) are then held back
     * when the member already has them, so a returning member who logged in on
     * /quiz keeps their original signup page and referrer.
     * That check is the only member read this path can do, and it is skipped
     * entirely unless the write carries one of those fields: nothing upstream of here
     * loads custom fields for the save (getExistingMemberJson reads member JSON,
     * a different API), and resolveMemberstackAuthState only runs on the
     * no-results branch, which is mutually exclusive with saving. It reuses the
     * file's own getCurrentMemberData/getMemberCustomFields pair rather than
     * introducing a second way to read a member.
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
        let attributionCustomFields = {}

        try {
            attributionCustomFields = getAttributionCustomFields()
        } catch (error) {
            logQuizFlow('attribution cookies unreadable; saved starter-quiz only', {
                error,
            })
            attributionCustomFields = {}
        }

        // Gated, so an ordinary quiz save pays no member read at all: see
        // carriesWriteOnceField. Mirrors the same gate in v3/signup-attribution.js.
        if (carriesWriteOnceField(attributionCustomFields)) {
            // Two scopes on purpose. A failed member read and a failed guard are
            // different faults, and one catch around both would report either as
            // "unreadable", pointing a future debugger at the wrong half. Both
            // still end in a write: an unreadable existing value must not cost a
            // genuine first signup its attribution.
            let existingCustomFields = null

            try {
                existingCustomFields = getMemberCustomFields(
                    await getCurrentMemberData(memberstack),
                )
            } catch (error) {
                // Left null, which withoutFilledWriteOnceFields treats as unfilled
                // and therefore writable.
                logQuizFlow('existing write-once attribution unreadable; writing ours', {
                    error,
                })
            }

            let guarded = attributionCustomFields

            try {
                guarded = withoutFilledWriteOnceFields(
                    attributionCustomFields,
                    existingCustomFields,
                )
            } catch (error) {
                logQuizFlow('write-once guard failed; writing ours', { error })
                guarded = attributionCustomFields
            }

            if (guarded !== attributionCustomFields) {
                logQuizFlow('member already has write-once attribution; kept theirs', {
                    // The fields held BACK from this write, not the ones kept in
                    // it: `kept` means the opposite inside the guard itself.
                    heldBackFieldIds: writeOnceFieldIds.filter(
                        (fieldId) =>
                            attributionCustomFields[fieldId] !== undefined &&
                            guarded[fieldId] === undefined,
                    ),
                })
            }

            attributionCustomFields = guarded
        }

        await memberstack.updateMember({
            customFields: {
                ...attributionCustomFields,
                'starter-quiz': customFieldValue,
            },
        })

        logQuizFlow('saved starter-quiz summary custom field to Memberstack', {
            customFields: {
                'starter-quiz': customFieldValue,
            },
            attributionFieldIds: Object.keys(attributionCustomFields),
        })
    }

    /**
     * Persists quiz data to the logged-in Memberstack member.
     *
     * @param {object} pendingQuiz Pending quiz payload.
     * @returns {Promise<object | null>} Save outcome, or null on failure.
     */
    async function savePendingQuizToMemberstack(pendingQuiz) {
        startWorkflowDiagnostic(
            'quiz_results_save',
            'prepare',
            'member_account',
        )
        if (pendingQuiz.memberstackSavedAt) {
            logQuizFlow('pending quiz already saved to Memberstack; save skipped', {
                memberstackSavedAt: pendingQuiz.memberstackSavedAt,
            })
            const result = {
                saved: true,
                newlySaved: false,
                starterQuiz: createMemberstackStarterQuizPayload(pendingQuiz),
            }
            completeWorkflowDiagnostic('quiz_results_save', {
                result: 'success',
                stage: 'complete',
                replayed: true,
            })
            return result
        }

        const memberstack = await waitForMemberstack()

        if (!memberstack) {
            logQuizFlow('Memberstack DOM package unavailable; save skipped')
            settleQuizEmailTestSavedState(
                null,
                'The current quiz result could not be saved',
            )
            completeWorkflowDiagnostic('quiz_results_save', {
                result: 'failure',
                stage: 'setup',
                error_code: 'MEMBERSTACK_UNAVAILABLE',
            })
            return null
        }

        try {
            markWorkflowRequestStarted('quiz_results_save')
            const starterQuiz = await saveQuizToMemberJson(memberstack, pendingQuiz)
            await saveQuizCustomField(memberstack, starterQuiz || pendingQuiz)

            const result = {
                saved: true,
                newlySaved: true,
                starterQuiz,
            }
            completeWorkflowDiagnostic('quiz_results_save', {
                result: 'success',
                stage: 'complete',
            })
            return result
        } catch (error) {
            logQuizFlow('Memberstack save failed', { error })
            settleQuizEmailTestSavedState(
                null,
                'The current quiz result could not be saved',
            )
            completeWorkflowDiagnostic('quiz_results_save', {
                result: 'failure',
                stage: 'request',
                error_code: 'QUIZ_RESULTS_SAVE_FAILED',
            })
            return null
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

        // Before anything reads the key: a logged-out visitor must not inherit a
        // previous member's cached answers. This is a no-op unless the stored
        // payload carries the member-cache marker, so the pre-signup funnel pays
        // nothing for it. Test mode owns its own payload and is left alone.
        if (!testPendingQuiz) {
            await clearMemberCachedPendingQuizWhenLoggedOut()
        }

        const rawPendingQuiz =
            testPendingQuiz ||
            getPendingQuiz() ||
            (await getPendingQuizFromMemberstack())

        if (!rawPendingQuiz) {
            settleQuizEmailTestSavedState(
                null,
                'No current saved quiz result is available',
            )
            logQuizFlow('no pending quiz found; results page has nothing to save')
            await redirectVisitorWithoutResults()
            // If redirectVisitorWithoutResults() bounced a resolved visitor the
            // page is unloading and this is harmless; if Memberstack was
            // unavailable, release the loader so it does not hang.
            signalQuizResultsReady('no-data')
            return
        }

        const taxonomyCompatibility =
            normalizeQuizTaxonomyPayload(rawPendingQuiz)
        const pendingQuiz = taxonomyCompatibility.payload

        if (taxonomyCompatibility.changed) {
            logQuizFlow('normalized saved quiz taxonomy', {
                droppedCategoryIds:
                    taxonomyCompatibility.droppedCategoryIds,
                droppedSubcategoryIds:
                    taxonomyCompatibility.droppedSubcategoryIds,
                requiresReselection:
                    taxonomyCompatibility.requiresReselection,
            })

            if (!testPendingQuiz) {
                delete pendingQuiz.memberstackSavedAt
            }
        }

        if (
            taxonomyCompatibility.requiresReselection &&
            !testPendingQuiz
        ) {
            settleQuizEmailTestSavedState(
                null,
                'The current quiz result requires a taxonomy retake',
            )
            sessionStorage.removeItem(pendingQuizStorageKey)
            logQuizFlow(
                'saved quiz has no current taxonomy selections; requiring retake',
            )
            signalQuizResultsReady('taxonomy-reselection')
            window.location.replace('/quiz?retake=true&taxonomyUpdate=1')
            return
        }

        syncLearnContentFilters(pendingQuiz, 'resolved')
        renderTestModeControls(pendingQuiz)

        // Defence in depth, sharing getPendingQuiz()'s predicate so the two
        // cannot drift: the sessionStorage source is already filtered, but a
        // Memberstack-sourced or test payload still reaches this point.
        if (!isPendingQuizReady(pendingQuiz)) {
            logQuizFlow('pending quiz is not ready; results save skipped', {
                status: pendingQuiz.status,
            })
            settleQuizEmailTestSavedState(
                null,
                'The current quiz result is not complete',
            )
            // Nothing renders on this path, but the visitor stays on the page,
            // so release the loader rather than leave it waiting.
            signalQuizResultsReady('not-ready')
            return
        }

        renderPendingQuiz(pendingQuiz)
        syncTocCategoryVisibility(pendingQuiz)
        syncTocAnchorNavigation()

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
        // Let the browser finish its native reaction to the newly stamped id
        // before applying the sticky-navbar offset. Otherwise Chrome can place
        // the target at viewport top after our smooth scroll has started.
        window.requestAnimationFrame(scrollToInitialTocHash)
        // Success render has settled. This covers every remaining terminal path
        // that keeps the visitor here: test mode, the no-save early return, and
        // normal completion — all fall through from this point.
        signalQuizResultsReady('rendered')

        if (testPendingQuiz) {
            settleQuizEmailTestSavedState(
                null,
                'URL test data cannot be used by the production email tester',
            )
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
        settleQuizEmailTestSavedState(
            didSave.starterQuiz,
            didSave.starterQuiz
                ? ''
                : 'Memberstack member JSON could not save the current quiz result',
        )

        await enrollQuizLeadDrip(pendingQuiz, recommendationSections)
    }

    // initResultsPage() is fire-and-forget, so any rejection inside it would
    // otherwise skip every signalQuizResultsReady() call and leave the loading
    // overlay up for good. Releasing the loader on failure shows the page as it
    // stands, which beats an indefinite spinner.
    initResultsPage().catch((error) => {
        if (typeof settleQuizEmailTestSavedState === 'function') {
            settleQuizEmailTestSavedState(
                null,
                'The current quiz result could not be prepared',
            )
        }
        logQuizFlow('results boot failed; releasing the loader', { error })
        signalQuizResultsReady('boot-error')
    })
})
})()
