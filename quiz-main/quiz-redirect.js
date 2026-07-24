;(function () {
    'use strict'

    var PAID_REDIRECT_PATH = '/brand-dashboard'
    var FREE_REDIRECT_PATH = '/quiz-results'

    var PAID_PLAN_ID = 'pln_new-paid-plan-463h04ph'
    var FREE_PLAN_ID = 'pln_free-plan-f6kn0dxz'

    var MEMBERSTACK_POLL_MS = 100
    var MEMBERSTACK_MAX_WAIT_MS = 10000

    var RETAKE_PARAM = 'retake'

    /**
     * Detects whether the member is intentionally retaking the quiz.
     *
     * The retake link should point to the quiz page with ?retake=true so a
     * member who already has a plan is not bounced to their results/dashboard
     * before finishing the new attempt.
     *
     * @returns {boolean}
     */
    var isQuizRetake = function () {
        var value = new URLSearchParams(window.location.search)
            .get(RETAKE_PARAM)
        return ['1', 'true', 'yes'].indexOf(String(value || '').toLowerCase()) !== -1
    }

    /**
     * @param {object | null | undefined} payload
     * @returns {object | null}
     */
    var getMemberData = function (payload) {
        var member = payload && payload.data ? payload.data : payload
        if (!member || typeof member !== 'object') return null
        if (member.data && typeof member.data === 'object') return member.data
        return member
    }

    /**
     * @param {object | null | undefined} member
     * @returns {boolean}
     */
    var isLoggedInMember = function (member) {
        return Boolean(member && (member.id || member._id || member.email))
    }

    /**
     * @param {string} status
     * @returns {string}
     */
    var normalizeStatus = function (status) {
        return String(status || '').toUpperCase()
    }

    /**
     * @param {object} plan
     * @returns {boolean}
     */
    var isActivePlan = function (plan) {
        return (
            normalizeStatus(plan.status) === 'ACTIVE' && plan.active !== false
        )
    }

    /**
     * @param {object | null | undefined} member
     * @returns {boolean}
     */
    var hasActivePaidPlan = function (member) {
        var plans =
            member && member.planConnections ? member.planConnections : []
        return plans.some(function (plan) {
            return plan.planId === PAID_PLAN_ID && isActivePlan(plan)
        })
    }

    /**
     * @param {object | null | undefined} member
     * @returns {boolean}
     */
    var hasActiveFreePlan = function (member) {
        var plans =
            member && member.planConnections ? member.planConnections : []
        return plans.some(function (plan) {
            return plan.planId === FREE_PLAN_ID && isActivePlan(plan)
        })
    }

    /**
     * @param {object | null | undefined} member
     * @returns {string | null}
     */
    var getRedirectPath = function (member) {
        if (!isLoggedInMember(member)) return null
        if (hasActivePaidPlan(member)) return PAID_REDIRECT_PATH
        if (hasActiveFreePlan(member)) return FREE_REDIRECT_PATH
        return null
    }

    /**
     * @param {object | null | undefined} member
     * @returns {void}
     */
    var redirectIfMember = function (member) {
        if (isQuizRetake()) return

        var targetPath = getRedirectPath(member)
        if (!targetPath) return
        if (window.location.pathname === targetPath) return

        window.location.replace(targetPath)
    }

    /**
     * @returns {Promise<object | null>}
     */
    var waitForMemberstack = function () {
        return new Promise(function (resolve) {
            var startedAt = Date.now()

            var poll = function () {
                var memberstack = window.$memberstackDom
                if (memberstack) {
                    resolve(memberstack)
                    return
                }

                if (Date.now() - startedAt >= MEMBERSTACK_MAX_WAIT_MS) {
                    resolve(null)
                    return
                }

                setTimeout(poll, MEMBERSTACK_POLL_MS)
            }

            poll()
        })
    }

    /**
     * @returns {Promise<void>}
     */
    var init = async function () {
        var memberstack = await waitForMemberstack()
        if (!memberstack) return

        try {
            var result = await memberstack.getCurrentMember()
            redirectIfMember(getMemberData(result))
        } catch (error) {
            // not logged in — stay on page
        }

        if (typeof memberstack.onAuthChange === 'function') {
            memberstack.onAuthChange(function (member) {
                redirectIfMember(getMemberData(member))
            })
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init)
    } else {
        init()
    }
})()
