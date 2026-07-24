/**
 * Quiz main page controller.
 *
 * Initial data sources:
 * - Webflow-rendered category checkboxes from #wf-form-Categories.
 * - Webflow-rendered subcategory items from #wf-form-Subcategories [data-category].
 * - Webflow-rendered bucket mapping from [data-quiz-bucket].
 * - sessionStorage.quizSelectedCategories saved by quiz-home.js.
 *
 * Outputs:
 * - sessionStorage.starterQuizPending for the post-signup results page.
 *
 * Set starterQuizMainDebugEnabled to false to disable this file's logs.
 */
;(() => {
    const starterQuizMainControllerFlag = 'starterQuizMainController'
    const starterQuizMainDebugEnabled = true

    if (window[starterQuizMainControllerFlag]) {
        if (starterQuizMainDebugEnabled) {
            console.log('[Starter Quiz Funnel]', '[main]', 'duplicate script skipped', {
                scriptFlag: starterQuizMainControllerFlag,
            })
        }
        return
    }

    window[starterQuizMainControllerFlag] = true

    document.addEventListener('DOMContentLoaded', function starterQuizMainController() {
    const debugStorageKey = 'starterQuizDebug'
    const debugLogPrefix = '[Starter Quiz Funnel]'

    /**
     * Checks whether starter quiz debug logging is enabled.
     *
     * @returns {boolean} True when flow logs should be printed.
     */
    function isDebugLoggingEnabled() {
        if (!starterQuizMainDebugEnabled) return false

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
            starterQuizMainDebugEnabled ||
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
            console.log(debugLogPrefix, '[test]', message)
            return
        }

        console.log(debugLogPrefix, '[test]', message, data)
    }

    const tabWrapper = document.querySelector('[data-tab-wrapper]')
    const tabPreviousWrap = tabWrapper?.querySelector('[data-tab="previous"]')
    const tabNextWrap = tabWrapper?.querySelector('[data-tab="next"]')
    const categoriesStep = document.querySelector('[data-main-is-categories]')
    const subcategoriesStep = document.querySelector(
        '[data-main-is-subcategories]',
    )

    const backButtonWrap =
        document.querySelector('[data-step-back]') || tabPreviousWrap
    const nextButtonWrap =
        document.querySelector('[data-step-next]') || tabNextWrap
    const backButton = backButtonWrap?.querySelector('button')
    const continueButton = nextButtonWrap?.querySelector('button')

    const categoriesForm = document.querySelector('#wf-form-Categories')
    const subcategoriesForm = document.querySelector('#wf-form-Subcategories')
    const bucketList = document.querySelector('[data-quiz-bucket]')
    const startHeading = document.querySelector('[data-start-heading]')
    const signupForm = document.querySelector('#Signup-Form')
    const authProviderLinks = Array.from(
        document.querySelectorAll('[data-ms-auth-provider]'),
    )
    const isTabDrivenQuiz = Boolean(
        tabWrapper?.querySelector('[data-tab-category-link]'),
    )

    if (
        !categoriesStep ||
        !subcategoriesStep ||
        !categoriesForm ||
        !subcategoriesForm
    ) {
        logQuizFlow('required elements missing; script stopped', {
            hasCategoriesStep: Boolean(categoriesStep),
            hasSubcategoriesStep: Boolean(subcategoriesStep),
            hasCategoriesForm: Boolean(categoriesForm),
            hasSubcategoriesForm: Boolean(subcategoriesForm),
        })
        return
    }

    const storageKey = 'quizSelectedCategories'
    const pendingQuizStorageKey = 'starterQuizPending'
    const resultsRedirectPath = '/quiz-results'
    const stepFadeDuration = 200

    let currentStep = 'categories'
    let selectedCategoryIds = []
    let activeCategoryIndex = 0

    // True once Memberstack confirms an existing logged-in member, i.e. the
    // user is retaking the quiz and should skip the final signup slide.
    let memberIsLoggedIn = false

    /**
     * Category checkboxes rendered in the quiz page form.
     *
     * @type {HTMLInputElement[]}
     */
    const categoryInputs = Array.from(
        categoriesForm.querySelectorAll('input[type="checkbox"]'),
    ).filter((input) => !input.closest('[data-quiz-bucket]'))

    /**
     * Subcategory CMS/form items. Each item is tied to a category through
     * either its data-category attribute or its parent data-tab-category-link.
     *
     * @type {HTMLElement[]}
     */
    const subcategoryItems = isTabDrivenQuiz
        ? Array.from(
              document.querySelectorAll(
                  '[data-tab-category-link] input[type="checkbox"]',
              ),
          ).map((input) => input.closest('label') || input)
        : Array.from(subcategoriesForm.querySelectorAll('[data-category]'))

    /**
     * Gets the checkbox input from a quiz item or input element.
     *
     * @param {HTMLElement} item Quiz item, label, or checkbox input.
     * @returns {HTMLInputElement | null} Checkbox input.
     */
    function getCheckboxInput(item) {
        if (item.matches('input[type="checkbox"]')) return item

        return item.querySelector('input[type="checkbox"]')
    }

    /**
     * Subcategory checkbox inputs from all visible/hidden category panels.
     *
     * @type {HTMLInputElement[]}
     */
    const subcategoryInputs = subcategoryItems.map(getCheckboxInput).filter(Boolean)

    logQuizFlow('initialized', {
        categoryCount: categoryInputs.length,
        subcategoryCount: subcategoryItems.length,
        hasBackButton: Boolean(backButton),
        hasContinueButton: Boolean(continueButton),
        hasBucketList: Boolean(bucketList),
        hasStartHeading: Boolean(startHeading),
        hasSignupForm: Boolean(signupForm),
        authProviderCount: authProviderLinks.length,
        isTabDrivenQuiz,
        storageKey,
        pendingQuizStorageKey,
    })

    /**
     * Trims string-like values before comparing IDs from storage and the DOM.
     *
     * @param {string | null | undefined} value Value to normalize.
     * @returns {string} Trimmed value, or an empty string.
     */
    function normalize(value) {
        return (value || '').trim()
    }

    /**
     * Reads bucket IDs selected on the homepage.
     *
     * Source: sessionStorage.quizSelectedCategories, written by quiz-home.js.
     *
     * @returns {string[]} Saved bucket checkbox IDs.
     */
    function getSavedBuckets() {
        const savedRaw = sessionStorage.getItem(storageKey)
        if (!savedRaw) return []

        try {
            const savedBuckets = JSON.parse(savedRaw)
            const normalizedBuckets = Array.isArray(savedBuckets)
                ? savedBuckets.map(normalize).filter(Boolean)
                : []

            logQuizFlow('loaded saved homepage buckets', {
                savedBuckets: normalizedBuckets,
                storageKey,
            })

            return normalizedBuckets
        } catch (error) {
            logQuizFlow('could not parse saved homepage buckets', {
                error,
                savedRaw,
                storageKey,
            })
            return []
        }
    }

    /**
     * Updates both the real checkbox and Webflow's custom checkbox UI.
     *
     * @param {HTMLInputElement} input Checkbox input to update.
     * @param {boolean} checked Whether the checkbox should be selected.
     * @returns {void}
     */
    function setWebflowCheckboxState(input, checked) {
        input.checked = checked

        const customCheckbox = input
            .closest('label')
            ?.querySelector('.w-checkbox-input')

        if (customCheckbox) {
            customCheckbox.classList.toggle('w--redirected-checked', checked)
        }
    }

    /**
     * Switches the start heading copy based on whether homepage buckets exist.
     *
     * @returns {void}
     */
    function syncStartHeading() {
        if (!startHeading) return

        const hasHomepageSelection = getSavedBuckets().length > 0

        logQuizFlow('synced start heading state', { hasHomepageSelection })

        startHeading
            .querySelectorAll('[data-start-default]')
            .forEach((element) => {
                element.style.display = hasHomepageSelection ? 'none' : ''
            })

        startHeading
            .querySelectorAll('[data-start-filled]')
            .forEach((element) => {
                element.style.display = hasHomepageSelection ? 'block' : 'none'
            })
    }

    /**
     * Builds a lookup from homepage bucket ID to category IDs.
     *
     * Source: Webflow-rendered [data-quiz-bucket] children. The bucket checkbox
     * ID is the key, and nested CMS list item text provides the category IDs.
     *
     * @returns {Map<string, string[]>} Bucket ID to category IDs.
     */
    function getBucketPairs() {
        if (!bucketList) {
            logQuizFlow('bucket list not found; no bucket mapping available')
            return new Map()
        }

        const bucketPairs = new Map()

        Array.from(bucketList.children).forEach((bucketItem) => {
            const bucketInput = bucketItem.querySelector(
                'input[type="checkbox"]',
            )
            if (!bucketInput?.id) return

            const nestedLists = Array.from(bucketItem.children).filter(
                (child) => child.classList.contains('w-dyn-list'),
            )

            const categoryIds = nestedLists
                .flatMap((list) =>
                    Array.from(list.querySelectorAll('[role="listitem"]')),
                )
                .map((item) => normalize(item.textContent))
                .filter(Boolean)

            bucketPairs.set(normalize(bucketInput.id), categoryIds)
        })

        logQuizFlow('built homepage bucket to category mapping', {
            bucketPairs: Array.from(bucketPairs.entries()),
        })

        return bucketPairs
    }

    /**
     * Restores quiz category selections from saved homepage bucket IDs.
     *
     * @returns {void}
     */
    function restoreCategoriesFromStorage() {
        const savedBuckets = getSavedBuckets()
        if (!savedBuckets.length) {
            logQuizFlow('no saved homepage buckets to restore')
            return
        }

        const bucketPairs = getBucketPairs()
        const categoriesToCheck = new Set()

        savedBuckets.forEach((bucketId) => {
            const matchedCategories = bucketPairs.get(bucketId) || []

            matchedCategories.forEach((categoryId) => {
                categoriesToCheck.add(normalize(categoryId))
            })
        })

        categoryInputs.forEach((input) => {
            if (categoriesToCheck.has(normalize(input.id))) {
                setWebflowCheckboxState(input, true)
            }
        })

        categoriesForm.dispatchEvent(new Event('change', { bubbles: true }))

        logQuizFlow('restored categories from homepage bucket selections', {
            savedBuckets,
            restoredCategoryIds: Array.from(categoriesToCheck),
            selectedCategoryIds: getSelectedCategoryIds(),
        })
    }

    /**
     * Reads currently selected category IDs from the quiz page checkboxes.
     *
     * @returns {string[]} Selected category checkbox IDs.
     */
    function getSelectedCategoryIds() {
        return categoryInputs
            .filter((input) => input.checked)
            .map((input) => normalize(input.id))
            .filter(Boolean)
    }

    /**
     * Gets the parent category ID for a subcategory item.
     *
     * @param {HTMLElement} item Subcategory item or label.
     * @returns {string} Parent category ID.
     */
    function getSubcategoryCategoryId(item) {
        return (
            normalize(item.dataset.category) ||
            normalize(item.closest('[data-tab-category-link]')?.dataset
                .tabCategoryLink)
        )
    }

    /**
     * Gets the readable label next to a Webflow checkbox input.
     *
     * @param {HTMLInputElement} input Checkbox input.
     * @returns {string} Label text, falling back to value or ID.
     */
    function getCheckboxLabel(input) {
        const label = input.closest('label')?.querySelector('.w-form-label')

        return (
            normalize(label?.textContent) ||
            normalize(input.value) ||
            normalize(input.id)
        )
    }

    /**
     * Reads selected categories with IDs and display labels.
     *
     * @returns {{id: string, label: string}[]} Selected category data.
     */
    function getSelectedCategories() {
        return categoryInputs
            .filter((input) => input.checked)
            .map((input) => ({
                id: normalize(input.id),
                label: getCheckboxLabel(input),
            }))
            .filter((category) => category.id)
    }

    /**
     * Reads selected subcategories with their parent category IDs.
     *
     * @returns {{id: string, label: string, categoryId: string}[]} Selected subcategory data.
     */
    function getSelectedSubcategories() {
        return subcategoryItems
            .map((item) => {
                const input = getCheckboxInput(item)
                if (!input?.checked) return null

                const id =
                    normalize(input.id) ||
                    normalize(input.value) ||
                    getCheckboxLabel(input)

                return {
                    id,
                    label: getCheckboxLabel(input),
                    categoryId: getSubcategoryCategoryId(item),
                }
            })
            .filter(Boolean)
    }

    /**
     * Reads an optional result slug if the page exposes one.
     *
     * Add data-quiz-result-slug="your-result-slug" to an element when the
     * quiz result is calculated before signup.
     *
     * @returns {string | null} Result slug, or null when unavailable.
     */
    function getQuizResultSlug() {
        const resultElement = document.querySelector('[data-quiz-result-slug]')
        const resultSlug = normalize(resultElement?.dataset.quizResultSlug)

        return resultSlug || null
    }

    /**
     * Saves quiz answers locally so the results page can render immediately
     * after Memberstack account creation.
     *
     * @param {string} [status="ready"] Payload status.
     * @returns {void}
     */
    function savePendingQuiz(status = 'ready') {
        const savedAt = new Date().toISOString()
        const pendingQuiz = {
            categories: getSelectedCategories(),
            subcategories: getSelectedSubcategories(),
            resultSlug: getQuizResultSlug(),
            status,
            updatedAt: savedAt,
            completedAt: status === 'ready' ? savedAt : null,
        }

        sessionStorage.setItem(
            pendingQuizStorageKey,
            JSON.stringify(pendingQuiz),
        )

        logQuizFlow('saved pending quiz for post-signup results', {
            pendingQuiz,
            pendingQuizStorageKey,
        })
    }

    /**
     * Clears subcategory choices that no longer belong to selected categories.
     *
     * @returns {void}
     */
    function clearSubcategoriesForUnselectedCategories() {
        const selectedCategories = new Set(getSelectedCategoryIds())
        const clearedSubcategoryIds = []

        subcategoryItems.forEach((item) => {
            const categoryId = getSubcategoryCategoryId(item)

            if (selectedCategories.has(categoryId)) return

            const input = getCheckboxInput(item)
            if (input) {
                if (input.checked) {
                    clearedSubcategoryIds.push(
                        normalize(input.id) ||
                            normalize(input.value) ||
                            getCheckboxLabel(input),
                    )
                }

                setWebflowCheckboxState(input, false)
            }
        })

        logQuizFlow('cleared subcategories outside selected categories', {
            selectedCategoryIds: Array.from(selectedCategories),
            clearedSubcategoryIds,
        })
    }

    /**
     * Shows only the subcategories for the active selected category.
     *
     * @returns {void}
     */
    function syncSubcategoriesForActiveCategory() {
        const activeCategoryId = selectedCategoryIds[activeCategoryIndex]
        let visibleSubcategoryCount = 0

        subcategoryItems.forEach((item) => {
            const shouldShow = getSubcategoryCategoryId(item) === activeCategoryId
            if (shouldShow) visibleSubcategoryCount += 1

            if (!isTabDrivenQuiz) {
                item.style.display = shouldShow ? '' : 'none'
            }
        })

        document
            .querySelectorAll('[data-current-category-name]')
            .forEach((element) => {
                element.textContent = getCategoryNameById(activeCategoryId)
            })

        logQuizFlow('synced subcategories for active category', {
            activeCategoryId,
            activeCategoryIndex,
            selectedCategoryIds,
            visibleSubcategoryCount,
        })
    }

    /**
     * Gets the visible category label for a category checkbox ID.
     *
     * @param {string} categoryId Category checkbox ID.
     * @returns {string} Category label text, falling back to the ID.
     */
    function getCategoryNameById(categoryId) {
        const input = categoryInputs.find(
            (item) => normalize(item.id) === categoryId,
        )
        const label = input?.closest('label')?.querySelector('.w-form-label')

        return normalize(label?.textContent) || categoryId
    }

    /**
     * Gets a readable step name for debug logs.
     *
     * @param {HTMLElement} step Quiz step element.
     * @returns {string} Debug-friendly step name.
     */
    function getStepDebugName(step) {
        if (step === categoriesStep) return 'categories'
        if (step === subcategoriesStep) return 'subcategories'

        return 'unknown'
    }

    /**
     * Applies the fade transition used when moving between quiz steps.
     *
     * @returns {void}
     */
    function prepareStepAnimation() {
        ;[categoriesStep, subcategoriesStep].forEach((step) => {
            step.style.transition = 'opacity ' + stepFadeDuration + 'ms ease'
        })

        logQuizFlow('prepared step fade animation', { stepFadeDuration })
    }

    /**
     * Shows or hides the back button based on the active main step.
     *
     * @param {boolean} isCategoriesStep Whether the categories step is active.
     * @returns {void}
     */
    function syncStepButtons(isCategoriesStep) {
        if (backButtonWrap) {
            backButtonWrap.style.display = isCategoriesStep ? 'none' : ''
        }

        logQuizFlow('synced step buttons', {
            isCategoriesStep,
            isBackButtonVisible: !isCategoriesStep,
        })
    }

    /**
     * Sets the active quiz step without waiting for a fade animation.
     *
     * @param {string} stepName Step to show.
     * @returns {void}
     */
    function setQuizStepInstant(stepName) {
        const isCategoriesStep = stepName === 'categories'
        currentStep = stepName

        categoriesStep.style.display = isCategoriesStep ? 'flex' : 'none'
        categoriesStep.style.opacity = isCategoriesStep ? '1' : '0'

        subcategoriesStep.style.display = isCategoriesStep ? 'none' : 'flex'
        subcategoriesStep.style.opacity = isCategoriesStep ? '0' : '1'

        syncStepButtons(isCategoriesStep)
        logQuizFlow('set quiz step instantly', { stepName })
    }

    /**
     * Shows a quiz step with a fade-in animation.
     *
     * @param {HTMLElement} step Step element to show.
     * @returns {void}
     */
    function showStep(step) {
        step.style.display = 'flex'
        step.style.opacity = '0'

        logQuizFlow('showing step', { stepName: getStepDebugName(step) })

        requestAnimationFrame(function () {
            step.style.opacity = '1'
        })
    }

    /**
     * Hides a quiz step after its fade-out animation.
     *
     * @param {HTMLElement} step Step element to hide.
     * @returns {void}
     */
    function hideStep(step) {
        step.style.opacity = '0'

        logQuizFlow('hiding step', { stepName: getStepDebugName(step) })

        window.setTimeout(function () {
            step.style.display = 'none'
        }, stepFadeDuration)
    }

    /**
     * Transitions between the categories and subcategories steps.
     *
     * @param {string} stepName Step to show.
     * @returns {void}
     */
    function setQuizStep(stepName) {
        const isCategoriesStep = stepName === 'categories'
        const stepToShow = isCategoriesStep ? categoriesStep : subcategoriesStep
        const stepToHide = isCategoriesStep ? subcategoriesStep : categoriesStep
        const previousStep = currentStep

        currentStep = stepName

        logQuizFlow('transitioning quiz step', {
            fromStep: previousStep,
            toStep: stepName,
        })

        hideStep(stepToHide)

        window.setTimeout(function () {
            showStep(stepToShow)
        }, stepFadeDuration)

        syncStepButtons(isCategoriesStep)
    }

    /**
     * Moves between selected categories while the subcategory step is active.
     *
     * @param {number} direction -1 for previous, 1 for next.
     * @returns {void}
     */
    function switchActiveSubcategory(direction) {
        const nextIndex = activeCategoryIndex + direction

        if (nextIndex < 0 || nextIndex >= selectedCategoryIds.length) {
            logQuizFlow('subcategory step switch blocked', {
                activeCategoryIndex,
                direction,
                nextIndex,
                selectedCategoryIds,
            })
            return
        }

        subcategoriesStep.style.opacity = '0'

        logQuizFlow('switching active subcategory group', {
            activeCategoryIndex,
            direction,
            nextIndex,
            selectedCategoryIds,
        })

        window.setTimeout(function () {
            activeCategoryIndex = nextIndex
            syncSubcategoriesForActiveCategory()

            requestAnimationFrame(function () {
                subcategoriesStep.style.opacity = '1'
            })
        }, stepFadeDuration)
    }

    /**
     * Opens the next main Webflow tab after quiz questions are complete.
     *
     * @returns {void}
     */
    function goToNextMainStep() {
        const nextTab = document.querySelector('[data-w-tab="Tab 2"]')
        logQuizFlow('opening next main Webflow tab', {
            foundNextTab: Boolean(nextTab),
        })
        if (nextTab) nextTab.click()
    }

    /**
     * Reads the currently active custom tab content value.
     *
     * @returns {string} Active tab content value.
     */
    function getActiveTabContent() {
        return normalize(
            tabWrapper
                ?.querySelector('[data-tab-content].is-active')
                ?.getAttribute('data-tab-content'),
        )
    }

    /**
     * Saves a draft payload after any answer changes.
     *
     * @returns {void}
     */
    function saveDraftQuiz() {
        savePendingQuiz('draft')
    }

    /**
     * Saves a ready payload before account creation or signup handoff.
     *
     * @returns {void}
     */
    function saveReadyQuiz() {
        savePendingQuiz('ready')
    }

    /**
     * Handles next-button persistence for the custom Webflow tab quiz.
     *
     * @returns {void}
     */
    function syncTabDrivenNextClick() {
        const activeBeforeClick = getActiveTabContent()

        window.setTimeout(function () {
            const activeAfterClick = getActiveTabContent()
            const isEnteringSignup =
                activeBeforeClick === 'ways' || activeAfterClick === 'signup'

            if (isEnteringSignup) {
                saveReadyQuiz()
                return
            }

            saveDraftQuiz()
        }, 0)
    }

    /**
     * Resolves the Memberstack DOM package, waiting briefly for it to load.
     *
     * @returns {Promise<object | null>} Memberstack instance, or null.
     */
    function waitForMemberstack() {
        const pollIntervalMs = 100
        const maxWaitMs = 10000

        return new Promise(function (resolve) {
            const startedAt = Date.now()

            function poll() {
                if (window.$memberstackDom) {
                    resolve(window.$memberstackDom)
                    return
                }

                if (Date.now() - startedAt >= maxWaitMs) {
                    resolve(null)
                    return
                }

                window.setTimeout(poll, pollIntervalMs)
            }

            poll()
        })
    }

    /**
     * Flags whether an existing member is logged in so the signup slide can be
     * skipped on retake. A brand-new user is not logged in until they submit the
     * signup slide, so a truthy member here always means a retake.
     *
     * @returns {Promise<void>}
     */
    async function detectLoggedInMember() {
        const memberstack = await waitForMemberstack()
        if (!memberstack || typeof memberstack.getCurrentMember !== 'function') {
            return
        }

        try {
            const result = await memberstack.getCurrentMember()
            const payload = result && result.data ? result.data : result
            const member =
                payload && payload.data && typeof payload.data === 'object'
                    ? payload.data
                    : payload

            memberIsLoggedIn = Boolean(
                member && (member.id || member._id || member.email),
            )
        } catch (error) {
            memberIsLoggedIn = false
        }

        logQuizFlow('membership resolved for signup-slide skip', {
            memberIsLoggedIn,
        })
    }

    /**
     * Skips the signup slide for a logged-in retaker.
     *
     * Fires in the capture phase before the Webflow tab controller advances to
     * the signup slide. When the user clicks Next on the "ways" slide while
     * logged in, the ready payload is saved and the results page is opened
     * instead of moving to signup.
     *
     * @param {MouseEvent} event Click event from the quiz next control.
     * @returns {void}
     */
    function skipSignupForLoggedInMember(event) {
        if (!memberIsLoggedIn) return

        const nextTrigger = event.target.closest(
            "[data-tab='next'], [data-step-next]",
        )
        if (!nextTrigger) return
        if (getActiveTabContent() !== 'ways') return

        event.preventDefault()
        event.stopImmediatePropagation()

        saveReadyQuiz()

        logQuizFlow('logged-in retake; skipping signup slide', {
            resultsRedirectPath,
        })

        window.location.assign(resultsRedirectPath)
    }

    categoryInputs.forEach((input) => {
        input.addEventListener('change', function () {
            logQuizFlow('quiz category changed', {
                categoryId: input.id,
                checked: input.checked,
                selectedCategoryIds: getSelectedCategoryIds(),
            })

            clearSubcategoriesForUnselectedCategories()
            saveDraftQuiz()
        })
    })

    subcategoryInputs.forEach((input) => {
        input.addEventListener('change', function () {
            logQuizFlow('quiz subcategory changed', {
                subcategoryId: input.id,
                checked: input.checked,
                selectedSubcategories: getSelectedSubcategories(),
            })

            saveDraftQuiz()
        })
    })

    backButton?.addEventListener('click', function () {
        logQuizFlow('back button clicked', {
            currentStep,
            activeCategoryIndex,
            selectedCategoryIds,
        })

        if (isTabDrivenQuiz) {
            saveDraftQuiz()
            return
        }

        if (currentStep === 'subcategories' && activeCategoryIndex > 0) {
            switchActiveSubcategory(-1)
            return
        }

        setQuizStep('categories')
    })

    continueButton?.addEventListener('click', function () {
        logQuizFlow('continue button clicked', {
            currentStep,
            activeCategoryIndex,
            selectedCategoryIds,
        })

        if (isTabDrivenQuiz) {
            syncTabDrivenNextClick()
            return
        }

        if (currentStep === 'categories') {
            selectedCategoryIds = getSelectedCategoryIds()

            if (!selectedCategoryIds.length) {
                logQuizFlow('continue blocked; no categories selected')
                return
            }

            activeCategoryIndex = 0
            clearSubcategoriesForUnselectedCategories()
            syncSubcategoriesForActiveCategory()
            setQuizStep('subcategories')
            return
        }

        if (activeCategoryIndex < selectedCategoryIds.length - 1) {
            switchActiveSubcategory(1)
            return
        }

        saveReadyQuiz()

        if (memberIsLoggedIn) {
            logQuizFlow('logged-in retake; skipping signup step', {
                resultsRedirectPath,
            })
            window.location.assign(resultsRedirectPath)
            return
        }

        goToNextMainStep()
    })

    signupForm?.addEventListener('submit', function () {
        logQuizFlow('signup form submitted; saving ready quiz payload')
        saveReadyQuiz()
    })

    authProviderLinks.forEach((link) => {
        link.addEventListener('click', function () {
            logQuizFlow('auth provider clicked; saving ready quiz payload', {
                provider: link.getAttribute('data-ms-auth-provider'),
            })
            saveReadyQuiz()
        })
    })

    // Capture the click before the Webflow tab controller advances to signup,
    // so a logged-in retaker is sent to the results page instead.
    document.addEventListener('click', skipSignupForLoggedInMember, true)
    detectLoggedInMember()

    syncStartHeading()
    restoreCategoriesFromStorage()
    clearSubcategoriesForUnselectedCategories()

    selectedCategoryIds = getSelectedCategoryIds()
    activeCategoryIndex = 0

    logQuizFlow('initial category state prepared', {
        selectedCategoryIds,
        activeCategoryIndex,
    })

    if (selectedCategoryIds.length) {
        syncSubcategoriesForActiveCategory()
    } else {
        if (!isTabDrivenQuiz) {
            subcategoryItems.forEach((item) => {
                item.style.display = 'none'
            })
        }

        logQuizFlow('hid all subcategories because no categories are selected')
    }

    saveDraftQuiz()

    if (!isTabDrivenQuiz) {
        prepareStepAnimation()
        setQuizStepInstant('categories')
    } else {
        logQuizFlow('tab-driven quiz detected; existing tab controller owns UI')
    }

    window.addEventListener('pageshow', function () {
        logQuizFlow('pageshow restore started')

        syncStartHeading()
        restoreCategoriesFromStorage()
        clearSubcategoriesForUnselectedCategories()

        selectedCategoryIds = getSelectedCategoryIds()
        activeCategoryIndex = 0

        if (selectedCategoryIds.length) {
            syncSubcategoriesForActiveCategory()
        }

        saveDraftQuiz()

        if (!isTabDrivenQuiz) {
            setQuizStepInstant('categories')
        }

        logQuizFlow('pageshow restore finished', {
            selectedCategoryIds,
            activeCategoryIndex,
        })
    })
})
})()
