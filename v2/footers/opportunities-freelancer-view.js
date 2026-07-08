/* opportunities-freelancer-view.js — extracted from V2 secure footer (opportunities-freelancer-view-footer.html).
   Load via: <script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v2/footers/opportunities-freelancer-view.js"></script>
   Source of truth: product-workflows/opportunities/webflow/v2/webflow-footer-code/secure/opportunities-freelancer-view-footer.html */

document.addEventListener('DOMContentLoaded', function () {
    const XANO_LEGACY_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:ZihCUE3Z'
    const oppIdElement = document.querySelector('#opp-id')
    const appIdElement = document.querySelector('#app-id')
    let memid = null

    const callLegacyEndpoint = async (path, body) => {
        const response = await fetch(`${XANO_LEGACY_BASE}/${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) {
            throw new Error(data?.message || `Request failed: ${response.status}`)
        }
        // Funnel events (platform-ops/architecture/posthog-funnel-events-plan.md):
        // fires only on bridge success; StartersTrack loads from the site head.
        const trackedEvent = {
            'legacy/opportunities/apply': 'application_submitted',
            'legacy/opportunities/close': 'opportunity_closed',
            'legacy/freelancer-profile/update-request': 'profile_updated',
        }[path]
        if (trackedEvent && window.StartersTrack) {
            window.StartersTrack.track(trackedEvent, {
                opportunity_id: (body && body.opportunity_id) || undefined,
            })
        }
        return data
    }

    const hideElement = (element) => {
        if (element) element.style.display = 'none'
    }

    const showElement = (element, display = 'flex') => {
        if (element) element.style.display = display
    }

    const setText = (selector, value) => {
        const element = document.querySelector(selector)
        if (element) element.textContent = value ?? ''
    }

    const formatDate = (dateValue) =>
        new Date(dateValue).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
        })

    const applyProjectTypeDisplay = (card, item) => {
        const frequency = card.querySelector('.b-frequency')
        const slashNode = frequency?.previousSibling

        if (item.project_type === 'One Time') {
            hideElement(card.querySelector('.est-hours')?.closest('.pill-div'))
            hideElement(card.querySelector('.annual-sal')?.closest('.pill-div'))
            hideElement(card.querySelector('.anual-sal')?.closest('.pill-div'))
            hideElement(frequency)
            if (slashNode?.remove) slashNode.remove()
        } else if (item.project_type === 'Ongoing Part Time') {
            hideElement(card.querySelector('.proj-dur')?.closest('.pill-div'))
            hideElement(card.querySelector('.annual-sal')?.closest('.pill-div'))
            hideElement(card.querySelector('.anual-sal')?.closest('.pill-div'))
        } else if (item.project_type === 'Full Time') {
            hideElement(card.querySelector('.proj-dur')?.closest('.pill-div'))
            hideElement(card.querySelector('.est-hours')?.closest('.pill-div'))
            hideElement(card.querySelector('.budget')?.closest('.pill-div'))
            hideElement(frequency)
            if (slashNode?.remove) slashNode.remove()
        }
    }

    const updateFirstCard = (item) => {
        const card = document.querySelector('.brand-apply-card')
        if (!card) return

        setText('.apply-name', item.title)
        setText('.apply-position', item.company)
        setText('.proj-type', item.project_type)
        setText('.proj-dur', item.est_project_duration)
        setText('.est-hours', item.est_hours)
        setText('.b-frequency', item.budget_frequency)
        setText('.opp-desc', item.description)
        setText('.exp-desc', item.exp_requirements)
        setText('.opp-date', formatDate(item.created_at))

        if (item.project_type === 'Full Time') {
            setText('.annual-sal', item.budget)
        } else {
            setText('.budget', item.budget)
        }

        const viewLink = document.querySelector('.free-view')
        if (viewLink) {
            viewLink.href = `/opportunities-apply?opp=${item.id}&app=${item.applicants_reference}`
        }

        const applyButton = document.querySelector('[show-apply-popup]')
        if (applyButton) {
            applyButton.setAttribute('data-opp-id', item.id)
            applyButton.setAttribute('data-app-id', item.applicants_reference)
        }

        if (item.status === 'Closed') {
            card.querySelector('.pill-div.closed')?.classList.remove('hidden')
        }

        applyProjectTypeDisplay(card, item)
    }

    const createRemainingCards = (items) => {
        const firstCard = document.querySelector('.brand-apply-card')
        const container = firstCard?.parentElement
        if (!container) return

        items.forEach((item) => {
            const cardHTML = `
<div class="brand-apply-card">
    <div class="apply-card-top">
        <div class="apply-card-applicant-info">
            <div>
                <div class="apply-name">${item.title ?? ''}</div>
                <div class="apply-position">${item.company ?? ''}</div>
            </div>
        </div>
        <div class="apply-card-top__right">
            <div class="pill-div closed hidden">
                <div class="pill-div-text">Closed</div>
            </div>
            <div class="opp-date">${formatDate(item.created_at)}</div>
        </div>
    </div>
    <div class="opp-pill-block">
        <div class="pill-div semi-bold yellow">
            <div class="opp-pill-text">Project type: <span class="proj-type">${item.project_type ?? ''}</span></div>
        </div>
        <div class="pill-div semi-bold yellow">
            <div class="opp-pill-text">Estimated Project Duration: <span class="proj-dur">${item.est_project_duration ?? ''}</span></div>
        </div>
        <div class="pill-div semi-bold yellow">
            <div class="opp-pill-text">Estimated hrs/week: <span class="est-hours">${item.est_hours ?? ''}</span></div>
        </div>
        <div class="pill-div semi-bold yellow">
            <div class="opp-pill-text">Budget: $<span class="budget">${item.budget ?? ''}</span>/<span class="b-frequency">${item.budget_frequency ?? ''}</span></div>
        </div>
        <div class="pill-div semi-bold yellow">
            <div class="opp-pill-text">Annual Salary Budget: $<span class="anual-sal">${item.budget ?? ''}</span></div>
        </div>
    </div>
    <div class="opp-text-wrap">
        <div fs-cmsfilter-field="stats" class="opp-desc">${item.description ?? ''}</div>
        <a see-more-btn="" href="#" class="see-more is-hided">See more</a>
    </div>
    <div class="opp-exp-holder">
        <div class="exp-title">Experience requirements:</div>
        <div class="opp-text-wrap">
            <div class="exp-desc">${item.exp_requirements ?? ''}</div>
            <a see-more-btn="" href="#" class="see-more is-hided">See more</a>
        </div>
    </div>
    <div class="opp-bott-block">
        <div class="free-apply-btn-grp">
            <a href="/opportunities-apply?opp=${item.id}&app=${item.applicants_reference}" class="button is-secondary free-view w-inline-block">
                <div>View job</div>
            </a>
            <a href="#" data-opp-id="${item.id}" data-app-id="${item.applicants_reference}" show-apply-popup class="button w-inline-block">Apply now</a>
        </div>
    </div>
</div>`
            container.insertAdjacentHTML('beforeend', cardHTML)
            const newCard = container.lastElementChild
            if (item.status === 'Closed') {
                newCard.querySelector('.pill-div.closed')?.classList.remove('hidden')
            }
            applyProjectTypeDisplay(newCard, item)
        })

        applySeeMore()
    }

    const markAppliedButtons = (applicantsData, freelancerId) => {
        document.querySelectorAll('[show-apply-popup]').forEach((button) => {
            const oppId = parseInt(button.getAttribute('data-opp-id'), 10)
            const oppApplicants = applicantsData.find(
                (item) => item.opportunities_reference === oppId,
            )
            const hasApplied =
                oppApplicants?.applicants?.some(
                    (applicant) => applicant.freelancers_reference === freelancerId,
                ) ?? false

            if (hasApplied) {
                button.style.pointerEvents = 'none'
                button.style.opacity = '0.5'
                button.textContent = 'Applied'
            }
        })
    }

    const bindApplyForm = () => {
        const sendButton = document.getElementById('send-response')
        const descElement = document.getElementById('textarea-response')
        if (!sendButton || !descElement) return

        descElement.addEventListener('input', function () {
            descElement.dataset.value = descElement.value.trim()
        })

        // In-flight lock: block the duplicate apply POST a mouse double-click would
        // fire ~31ms apart → duplicate applicant records + double-counted PostHog
        // events (seen 2026-07-07). Boolean guard, not just pointer-events (which
        // can't cancel an already-queued second click); cleared on completion so a
        // later apply to another card in this reused popup still works.
        // See bridge-reliability-standards.md.
        let applyInFlight = false
        sendButton.addEventListener('click', function () {
            const oppID = oppIdElement?.textContent.trim()
            const appID = appIdElement?.textContent.trim()
            const desc = descElement.dataset.value?.trim() || descElement.value.trim()

            if (!oppID) {
                console.error('oppID is missing')
                return
            }
            if (!appID) {
                console.error('appID is missing')
                return
            }
            if (!desc) {
                alert('Please enter a response before submitting.')
                return
            }

            if (applyInFlight) return
            applyInFlight = true
            sendButton.style.pointerEvents = 'none'
            sendButton.style.opacity = '0.5'

            callLegacyEndpoint('legacy/opportunities/apply', {
                member_id: memid,
                opportunity_id: oppID,
                applicant_id: appID,
                cover_letter: desc,
            })
                .then((data) => {
                    applyInFlight = false
                    sendButton.style.pointerEvents = ''
                    sendButton.style.opacity = ''
                    console.log('Success:', data)
                    const button = document.querySelector(`[data-opp-id="${oppID}"]`)
                    if (button) {
                        button.style.pointerEvents = 'none'
                        button.style.opacity = '0.5'
                        button.textContent = 'Applied'
                    }
                    hideElement(document.querySelector('.step-1-block'))
                    showElement(document.querySelector('.step-2-block'))
                })
                .catch((error) => {
                    applyInFlight = false
                    sendButton.style.pointerEvents = ''
                    sendButton.style.opacity = ''
                    console.error('Error:', error)
                    alert(
                        'There was an issue submitting your application. Please try again.',
                    )
                })
        })
    }

    const bindApplyPopup = () => {
        document.addEventListener('click', function (event) {
            const button = event.target.closest('[show-apply-popup]')
            if (!button) return

            event.preventDefault()
            showElement(document.querySelector('[apply-form-popup]'))

            if (oppIdElement) oppIdElement.textContent = button.dataset.oppId || ''
            if (appIdElement) appIdElement.textContent = button.dataset.appId || ''

            const oppCardTitle =
                button.closest('.brand-apply-card')?.querySelector('.apply-name')
                    ?.textContent.trim() || ''
            const popupTitle = document.querySelector('.resp-form-headin-opp')
            if (popupTitle) popupTitle.textContent = oppCardTitle

            showElement(document.querySelector('.step-1-block'))
            hideElement(document.querySelector('.step-2-block'))
        })
    }

    function applySeeMore(retries = 17, timeout = 3000, startTime = Date.now()) {
        let elementsReady = true

        document.querySelectorAll('.opp-desc, .exp-desc').forEach((description) => {
            const seeMoreBtn = description.nextElementSibling
            const lineHeight = parseFloat(window.getComputedStyle(description).lineHeight)
            const maxHeight = lineHeight * 3

            if (description.scrollHeight === 0) {
                elementsReady = false
            } else if (description.scrollHeight > maxHeight) {
                description.style.maxHeight = `${maxHeight}px`
                description.style.overflow = 'hidden'
                description.style.display = '-webkit-box'
                description.style.webkitBoxOrient = 'vertical'
                description.style.webkitLineClamp = '3'
                if (seeMoreBtn) seeMoreBtn.style.display = 'inline'
            }
        })

        if (!elementsReady && retries > 0 && Date.now() - startTime < timeout) {
            setTimeout(() => applySeeMore(retries - 1, timeout, startTime), 300)
        }
    }

    window.addEventListener('resize', function () {
        setTimeout(applySeeMore, 100)
    })

    document.addEventListener('click', function (event) {
        if (!event.target.hasAttribute('see-more-btn')) return
        event.preventDefault()

        const seeMoreBtn = event.target
        const description = seeMoreBtn.previousElementSibling
        const lineHeight = parseFloat(window.getComputedStyle(description).lineHeight)
        const maxHeight = lineHeight * 3

        if (description.style.webkitLineClamp === '3') {
            description.style.webkitLineClamp = 'unset'
            description.style.maxHeight = 'none'
            seeMoreBtn.style.transform = 'translateY(100%)'
            seeMoreBtn.textContent = 'See less'
        } else {
            description.style.webkitLineClamp = '3'
            description.style.maxHeight = `${maxHeight}px`
            seeMoreBtn.style.transform = 'translateY(0)'
            seeMoreBtn.textContent = 'See more'
        }
    })

    window.$memberstackDom.getCurrentMember().then(({ data: member }) => {
        if (!member || !member.id) {
            window.location.href = '/login'
            return
        }

        if (!member.customFields['freelancer-dashboard-url']) {
            if (member.customFields['brands-dashboard-url']) {
                window.location.href = '/opportunities-brands'
            } else {
                window.location.href = '/'
            }
            return
        }

        if (!member.customFields['completed-starter-profile']) {
            if (member.loginRedirect?.includes('/starter-onboarding/step-')) {
                window.location.replace(member.loginRedirect)
            } else {
                window.location.replace('/starter-onboarding/step-1')
            }
            return
        }

        memid = member.id
        fetch(`${XANO_LEGACY_BASE}/custom/get-via-memid/${memid}`)
            .then((response) => response.json())
            .then((memberData) => {
                const firstCard = document.querySelector('.brand-apply-card')
                if (
                    !memberData.opportunities_id ||
                    !Array.isArray(memberData.opportunities_id)
                ) {
                    console.error('No opportunities found for this member')
                    hideElement(firstCard)
                    return
                }

                const allowedOpportunities = new Set(memberData.opportunities_id)

                return fetch(`${XANO_LEGACY_BASE}/opportunities`)
                    .then((response) => response.json())
                    .then((opportunities) => {
                        const filteredData = opportunities.filter(
                            (item) =>
                                allowedOpportunities.has(item.id) &&
                                (item.status === 'Active' || item.status === 'Closed'),
                        )

                        if (filteredData.length === 0) {
                            console.log('No matching opportunities found.')
                            hideElement(firstCard)
                            return
                        }

                        hideElement(document.querySelector('.no-brand-card'))

                        return fetch(`${XANO_LEGACY_BASE}/applicants`)
                            .then((response) => response.json())
                            .then((applicantsData) => {
                                const validOpportunities = filteredData.filter((opp) => {
                                    const oppApplicants = applicantsData.find(
                                        (item) => item.opportunities_reference === opp.id,
                                    )
                                    const hasApplied =
                                        oppApplicants?.applicants?.some(
                                            (applicant) =>
                                                applicant.freelancers_reference ===
                                                memberData.id,
                                        ) ?? false

                                    return !(
                                        opp.status === 'Closed' &&
                                        !hasApplied
                                    )
                                })

                                if (validOpportunities.length === 0) {
                                    console.log('No eligible opportunities to display.')
                                    hideElement(firstCard)
                                    return
                                }

                                validOpportunities.sort(
                                    (a, b) => new Date(b.created_at) - new Date(a.created_at),
                                )

                                updateFirstCard(validOpportunities[0])
                                createRemainingCards(validOpportunities.slice(1))
                                markAppliedButtons(applicantsData, memberData.id)
                                bindApplyForm()
                                bindApplyPopup()
                            })
                    })
            })
            .catch((error) => console.error('Error loading opportunities:', error))
    })
})
