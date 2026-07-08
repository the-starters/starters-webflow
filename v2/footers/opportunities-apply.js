/* opportunities-apply.js — extracted from V2 secure footer (opportunities-apply-footer.html).
   Load via: <script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v2/footers/opportunities-apply.js"></script>
   Source of truth: product-workflows/opportunities/webflow/v2/webflow-footer-code/secure/opportunities-apply-footer.html */

    const loadData = async () => {
        const url = new URL(window.location.href)
        const oppId = parseInt(url.searchParams.get('opp'))
        const XANO_LEGACY_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:ZihCUE3Z'

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

        try {
            // Getting a member from Memberstack
            const { data: member } =
                await window.$memberstackDom.getCurrentMember()
            if (!member || !member.id) {
                console.error('No member found')
                window.location.href = '/login'
                return
            }

            if (!member.customFields['freelancer-dashboard-url']) {
                if (member.customFields['brands-dashboard-url']) {
                    window.location.href = '/opportunities-brands'
                } else {
                    window.location.href = '/'
                }
            }

            if (!oppId) {
                console.log('No opportunity ID found in URL')
                window.location.href = '/opportunities-freelancer-view'
                return
            }

            const memid = member.id
            // console.log("Member ID:", memid);

            // Getting member data from Xano
            const memberDataResponse = await fetch(
                `https://x08a-5ko8-jj1r.n7c.xano.io/api:ZihCUE3Z/custom/get-via-memid/${memid}`,
            )
            const memberData = await memberDataResponse.json()
            // console.log("MEMBER DATA:", memberData);

            if (
                !memberData.opportunities_id ||
                !Array.isArray(memberData.opportunities_id)
            ) {
                console.error('No opportunities found for this member')
                return
            }

            const allowedOpportunities = new Set(memberData.opportunities_id)

            // Getting opportunity data from Xano
            const apiUrl = `https://x08a-5ko8-jj1r.n7c.xano.io/api:ZihCUE3Z/opportunities/${oppId}`
            const opportunityResponse = await fetch(apiUrl)
            if (!opportunityResponse.ok) {
                throw new Error('Network response was not ok')
            }
            const data = await opportunityResponse.json()
            console.log('opportunities response:', data)

            // Add data to DOM elements
            const titleElement = document.querySelector('.apply-opp-title')
            if (titleElement) titleElement.textContent = data.title

            const descElement = document.querySelector('.apply-opp-desc')
            if (descElement) descElement.textContent = data.description

            const expElement = document.querySelector('.exp-desc')
            if (expElement) expElement.textContent = data.exp_requirements

            const projTypeElement = document.querySelector('.proj-type')
            if (projTypeElement)
                projTypeElement.textContent = data.project_type || 'Not set'

            const durationElement = document.querySelector('.proj-dur')
            if (durationElement)
                durationElement.textContent = data.est_project_duration

            const estimatedHoursElement = document.querySelector('.est-hours')
            if (estimatedHoursElement)
                estimatedHoursElement.textContent = data.est_hours

            const bFrequencyElement = document.querySelector('.b-frequency')
            if (bFrequencyElement)
                bFrequencyElement.textContent = data.budget_frequency

            const slashNode = bFrequencyElement?.previousSibling

            if (data.project_type === 'Full Time') {
                document.querySelector('.annual-sal').textContent = data.budget
            } else {
                document.querySelector('.budget').textContent = data.budget
            }

            if (data._brands && data._brands.length > 0) {
                const companyElement =
                    document.querySelector('.opp-details-right')
                if (companyElement)
                    companyElement.textContent = data._brands[0].company_name
            }

            // Managing the visibility of elements
            if (data.project_type === 'One Time') {
                document
                    .querySelector('.est-hours')
                    .closest('.opp-details-item').style.display = 'none'
                document
                    .querySelector('.annual-sal')
                    .closest('.opp-details-item').style.display = 'none'
                document.querySelector('.b-frequency').style.display = 'none'
                if (slashNode) slashNode.remove()
            } else if (data.project_type === 'Ongoing Part Time') {
                document
                    .querySelector('.proj-dur')
                    .closest('.opp-details-item').style.display = 'none'
                document
                    .querySelector('.annual-sal')
                    .closest('.opp-details-item').style.display = 'none'
            } else if (data.project_type === 'Full Time') {
                document
                    .querySelector('.proj-dur')
                    .closest('.opp-details-item').style.display = 'none'
                document
                    .querySelector('.est-hours')
                    .closest('.opp-details-item').style.display = 'none'
                document
                    .querySelector('.budget')
                    .closest('.opp-details-item').style.display = 'none'
                document.querySelector('.b-frequency').style.display = 'none'
                if (slashNode) slashNode.remove()
            }

            // Checking applications
            const applicantsResponse = await fetch(
                'https://x08a-5ko8-jj1r.n7c.xano.io/api:ZihCUE3Z/applicants',
            )
            const applicantsData = await applicantsResponse.json()
            const filteredData = applicantsData.filter((item) =>
                allowedOpportunities.has(item.opportunities_reference),
            )

            if (filteredData.length === 0) {
                console.log('No matching applicant objects found.')
                return
            }

            filteredData.forEach((item) => {
                if (oppId === item.opportunities_reference) {
                    const hasApplied = item.applicants.some(
                        (applicant) =>
                            applicant.freelancers_reference === memberData.id,
                    )
                    if (hasApplied) {
                        const applyButtons =
                            document.querySelectorAll('[show-apply-popup]')
                        applyButtons.forEach((button) => {
                            button.style.pointerEvents = 'none'
                            button.style.opacity = '0.5'
                            button.textContent = 'Applied'
                        })
                    }
                }
            })

            /* HANDLE SEND_RESPONSE BUTTON */
            const formResponse = document.getElementById('wf-form-desc')
            const formResponseId = document.getElementById('response_id')
            const sendButton = document.getElementById('send-response')
            if (sendButton) {
                // In-flight lock: a mouse double-click otherwise fires two apply
                // POSTs ~31ms apart, racing past Xano's "already applied" check →
                // duplicate applicant records + double-counted PostHog events
                // (seen 2026-07-07). The boolean is the real guard; pointer-events
                // alone can't cancel an already-queued second click. Cleared on
                // completion. See bridge-reliability-standards.md.
                let sendInFlight = false
                sendButton.addEventListener('click', async function () {
                    /*** ADD APPLICANT TO XANO ***/
                    // Get oppID from URL
                    const urlParams = new URLSearchParams(
                        window.location.search,
                    )
                    const oppID = parseInt(urlParams.get('opp'))
                    const appIDFromUrl = parseInt(urlParams.get('app'))
                    const appID = parseInt(data.applicants_reference)

                    if (!oppID) {
                        console.error('oppID is missing in the URL')
                        return
                    }

                    if (!appID && !appIDFromUrl) {
                        alert(
                            'Necessary application data is missing. Please reload the page or try submit 5 min. later, in other cases contact support.',
                        )
                        return
                    }

                    // Get desc from textarea
                    const descElement =
                        document.getElementById('textarea-response')
                    const desc = descElement ? descElement.value.trim() : ''

                    if (!desc) {
                        console.error('Description is empty')
                        alert('Please enter a response before submitting.')
                        return
                    }

                    if (sendInFlight) return
                    sendInFlight = true
                    sendButton.style.pointerEvents = 'none'
                    sendButton.style.opacity = '0.5'

                    callLegacyEndpoint('legacy/opportunities/apply', {
                        member_id: memid,
                        opportunity_id: oppID,
                        applicant_id: appIDFromUrl ? appIDFromUrl : appID,
                        cover_letter: desc,
                    })
                        .then((data) => {
                            sendInFlight = false
                            const button =
                                document.querySelector('[show-apply-popup]')
                            button.style.pointerEvents = 'none'
                            button.style.opacity = '0.5'
                            button.textContent = 'Applied'

                            // Hide step-1-block and show step-2-block
                            const step1 =
                                document.querySelector('.step-1-block')
                            const step2 =
                                document.querySelector('.step-2-block')

                            if (step1) step1.style.display = 'none'
                            if (step2) step2.style.display = 'flex'
                        })
                        .catch((error) => {
                            sendInFlight = false
                            sendButton.style.pointerEvents = ''
                            sendButton.style.opacity = ''
                            console.error('Send post error:', error)
                            alert(
                                'There was an issue submitting your application. Please try again.',
                            )
                        })
                })
            }
            // END: HANDLE SEND_RESPONSE BUTTON

            return true
        } catch (error) {
            console.error('Error:', error)
        }
    }
    document.addEventListener('DOMContentLoaded', function () {
        // Launch loadData
        loadData().then((responseData) => {
            applySeeMore()

            /*** SEE MORE ***/
            function applySeeMore(
                retries = 7,
                timeout = 3000,
                startTime = Date.now(),
            ) {
                let elementsReady = true

                document
                    .querySelectorAll('.opp-desc, .apply-opp-desc, .exp-desc')
                    .forEach((description) => {
                        const seeMoreBtn = description.nextElementSibling

                        const lineHeight = parseFloat(
                            window.getComputedStyle(description).lineHeight,
                        )
                        const maxHeight = lineHeight * 3

                        // console.log(`🔍 Checking: ${description.textContent.trim().substring(0, 30)}...`);
                        //console.log("📏 scrollHeight:", description.scrollHeight, "clientHeight:", description.clientHeight);

                        if (description.scrollHeight === 0) {
                            elementsReady = false
                        } else if (description.scrollHeight > maxHeight) {
                            description.style.maxHeight = `${maxHeight}px`
                            description.style.overflow = 'hidden'
                            description.style.display = '-webkit-box'
                            description.style.webkitBoxOrient = 'vertical'
                            description.style.webkitLineClamp = '3'
                            seeMoreBtn.style.display = 'inline' // Show "See more"
                        }
                    })

                if (
                    !elementsReady &&
                    retries > 0 &&
                    Date.now() - startTime < timeout
                ) {
                    console.log(`⏳ Waiting... Retry #${8 - retries}`)
                    setTimeout(
                        () => applySeeMore(retries - 1, timeout, startTime),
                        300,
                    )
                } else if (elementsReady) {
                    console.log('✅ All descriptions processed!')
                } else {
                    console.warn('⚠️ Elements not ready after max retries.')
                }
            }

            window.addEventListener('resize', function (event) {
                setTimeout(() => {
                    document
                        .querySelectorAll('.opp-desc, .apply-opp-desc')
                        .forEach((description) => {
                            const seeMoreBtn = description.nextElementSibling
                            const lineHeight = parseFloat(
                                window.getComputedStyle(description).lineHeight,
                            )
                            const maxHeight = lineHeight * 3

                            if (description.scrollHeight > maxHeight) {
                                description.style.maxHeight = `${maxHeight}px`
                                description.style.overflow = 'hidden'
                                description.style.display = '-webkit-box'
                                description.style.webkitBoxOrient = 'vertical'
                                description.style.webkitLineClamp = '3'
                                seeMoreBtn.style.display = 'inline' // Show "See more"
                            } else {
                                seeMoreBtn.style.display = 'none' // Hide "See more"
                            }
                        })
                }, 100)
            })

            document.addEventListener('click', function (event) {
                if (event.target.hasAttribute('see-more-btn')) {
                    const seeMoreBtn = event.target
                    const description = seeMoreBtn.previousElementSibling

                    const lineHeight = parseFloat(
                        window.getComputedStyle(description).lineHeight,
                    )
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
                }
            })
        })
    })
