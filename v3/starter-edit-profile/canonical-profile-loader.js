
    var profileFormControllers = window.__tsProfileFormControllers || (window.__tsProfileFormControllers = {});
    if (!profileFormControllers.canonicalProfileLoader) {
    profileFormControllers.canonicalProfileLoader = true;
    window.addEventListener('beforeunload', (event) => {
        event.preventDefault();
        event.returnValue = '';
    });

    document.addEventListener('DOMContentLoaded', function () {
        setLoader(true);

        /* saving draft data */
        waitForMember(async () => {
            if (!MEMBER.id) return;

            const XANO_PROFILE_ENDPOINT = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starter/get';

            /* WF_ids for profile types:
              full - a52dcf2c568fa40bf96cd67e4f8c6186
              consult - ca6ff4250b7d01b49e83433432af3686
            */

            let PROFILE_TYPE = null;
            let PROFILE_TYPE_ID = null;

            // `var activeProfile` and `function createEmptyProfile()` - are in global page codes

            initProfileDraft();

            async function initProfileDraft() {
                try {
                    const xanoRawProfile = await getXanoProfileSafe();
                    if (!xanoRawProfile) {
                        console.error('XANO profile not found for member:', MEMBER.id);
                        return;
                    }

                    // Wait Locations to get the right data for country and states
                    const waitLocationsData = setInterval(async () => {
                        if (locationsReady) { // var locationsReady` is in Embed Edit-Global script
                            clearInterval(waitLocationsData);

                            const xanoSetup = await createBuildProfileFromXano(xanoRawProfile);
                            const xanoProfile = normalizeProfile(xanoSetup, true);

                            console.log('normalizedProfile - ', xanoProfile);

                            activeProfile = xanoProfile;
                            PROFILE_TYPE = activeProfile?.type || 'full';
                            PROFILE_TYPE_ID = activeProfile?.type_id || 'a52dcf2c568fa40bf96cd67e4f8c6186';

                            const steps = getSteps();

                            ensureStepsInProfile(activeProfile, steps);
                            restoreFieldsData(activeProfile);
                            updateCounterFields();

                            setTimeout(() => {
                                setLoader(false);
                            }, 300);
                        }
                    }, 25);
                } catch (error) {
                    console.error('Profile draft init error:', error);
                }
            }

            function restoreFieldsData(profile) {
                const steps = getSteps();
                steps.forEach((step) => {
                    const stepIndex = getStepIndex(step);
                    if (!stepIndex) return;

                    const stepKey = `step_${stepIndex}`;
                    const stepData = profile?.data?.[stepKey];

                    if (!stepData) return;

                    const fields = qsa('[data-input-capture]', step);
                    fields.forEach((field) => {
                        const fieldName = field.name;
                        if (!fieldName || !(fieldName in stepData)) return;

                        setFieldValue(field, stepData[fieldName]);
                    });
                });
            }

            function getFieldValue(field) {
                const tagName = field.tagName.toLowerCase();
                const type = field.getAttribute('type');

                if (type === 'checkbox') {
                    return field.checked;
                }

                if (type === 'radio') {
                    const checkedRadio = qs(`input[type="radio"][name="${CSS.escape(field.name)}"]:checked`);

                    return checkedRadio ? checkedRadio.value : '';
                }

                if (tagName === 'select' && field.multiple) {
                    return Array.from(field.selectedOptions).map((option) => option.value);
                }

                let val = field.value.trim();
                if (val.endsWith(',')) {
                    val = val.slice(0, -1);
                }

                return val;
            }

            function setFieldValue(field, value) {
                const tagName = field.tagName.toLowerCase();
                const type = field.getAttribute('type');

                if (type === 'checkbox') {
                    field.checked = Boolean(value);
                    triggerNativeEvents(field);
                    return;
                }

                if (type === 'radio') {
                    const radio = qs(`input[type="radio"][name="${CSS.escape(field.name)}"][value="${CSS.escape(value)}"]`);
                    if (radio) {
                        radio.checked = true;
                        triggerNativeEvents(radio);
                    }

                    return;
                }

                field.value = value ?? '';
                triggerNativeEvents(field);
            }

            function triggerNativeEvents(field) {
                field.dispatchEvent(new Event('input', { bubbles: true }));
                field.dispatchEvent(new Event('change', { bubbles: true }));
            }

            async function getXanoProfileSafe() {
                try {
                    const url = new URL(XANO_PROFILE_ENDPOINT);
                    const response = await xanoAuthFetch(url.toString(), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ member_id: MEMBER.id }),
                    });

                    if (!response.ok) {
                        throw new Error(`XANO profile request failed: ${response.status}`);
                    }

                    const data = await response.json();

                    return Array.isArray(data) ? data[0] : data;
                } catch (error) {
                    console.error('Get XANO profile error:', error);
                    return null;
                }
            }

            async function createBuildProfileFromXano(xanoProfile) {
                if (!xanoProfile) {
                    return createEmptyProfile(PROFILE_TYPE, PROFILE_TYPE_ID, 0);
                }

                const countrySelect = qs('#country');
                const stateSelect = qs('#state');
                const citySelect = qs('#city');

                function getSelectValueByOptionText(selectSelector, optionText) {
                    const select = qs(selectSelector);
                    const text = String(optionText ?? '').trim();
                    const normalizedText = text.toLowerCase();
                    const option = Array.from(select.options).find((option) => {
                        return option.textContent.trim().toLowerCase() === normalizedText;
                    });

                    const value = option ? option.value : '';

                    return value;
                }

                async function getAlsoWorkedWith() {
                    const companyIds = xanoProfile.Also_Worked_With;
                    if (!companyIds.length) {
                        return {};
                    }

                    try {
                        const response = await xanoAuthFetch('https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/edit_profile/starter/get_also_worked_with', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                member_id: MEMBER.id,
                            }),
                        });

                        if (!response.ok) {
                            console.warn('[getAlsoWorkedWith] XANO error:', response.status);
                            return {};
                        }

                        const companies = await response.json();
                        if (!Array.isArray(companies)) {
                            console.warn('[getAlsoWorkedWith] Companies is not array:', companies);
                            return {};
                        }


                        return companies.reduce((acc, company) => {
                            if (!company) return acc;

                            const name = String(company.company_name ?? '').trim();
                            const domain = String(company.company_domain ?? '').trim();

                            if (!name && !domain) return acc;

                            acc[crypto.randomUUID()] = {
                                name,
                                domain,
                            };

                            return acc;
                        }, {});
                    } catch (error) {
                        console.error('[getAlsoWorkedWith] Failed:', error);
                        return {};
                    }
                }

                const lastUpdate = parseXanoTimestamp(xanoProfile.Updated_On);
                const countryValue = getSelectValueByOptionText(
                    '#country',
                    getXanoValue(xanoProfile, 'Country')
                );

                countrySelect.value = countryValue;
                countrySelect.dispatchEvent(new Event('change', { bubbles: true }));

                const stateValue = getSelectValueByOptionText(
                    '#state',
                    getXanoValue(xanoProfile, 'State_Province')
                );

                const alsoWorkedWith = await getAlsoWorkedWith();

                const servicesData = {};
                const services = xanoProfile.Services || {};

                if (services['service-1'] != null) {
                    servicesData.service = JSON.stringify(services['service-1']);
                }
                if (services['service-2'] != null) {
                    servicesData['service-2'] = JSON.stringify(services['service-2']);
                }
                if (services['service-3'] != null) {
                    servicesData['service-3'] = JSON.stringify(services['service-3']);
                }

                const reviewersData = {};
                const reviewers = xanoProfile.Reviewers || {};
                const toReviewerFields = (reviewer) => reviewer ? {
                    fname: reviewer['first-name'] || '',
                    lname: reviewer['last-name'] || '',
                    job: reviewer.position || '',
                    company: reviewer.company || '',
                    email: reviewer.email || '',
                } : null;

                for (const [slot, field] of [
                    ['reviewer-1', 'reviewer'],
                    ['reviewer-2', 'reviewer-2'],
                    ['reviewer-3', 'reviewer-3'],
                ]) {
                    const value = toReviewerFields(reviewers[slot]);
                    if (value) reviewersData[field] = JSON.stringify(value);
                }

                const profile = {
                    type: getXanoValue(xanoProfile, 'Profile_Type') || PROFILE_TYPE,
                    type_id: getXanoValue(xanoProfile, 'Profile_Type_ID') || PROFILE_TYPE_ID,
                    last_update: lastUpdate,
                    data: {
                        step_1: {
                            email: getXanoValue(xanoProfile, 'Email'),
                            phone: getXanoValue(xanoProfile, 'Phone'),
                            'first-name': getXanoValue(xanoProfile, 'First_Name'),
                            'last-name': getXanoValue(xanoProfile, 'Last_Name'),
                            city: getXanoValue(xanoProfile, 'City'),
                            country: countryValue,
                            state: stateValue,
                            'function-option': getXanoValue(xanoProfile, 'Category'),
                            function: getXanoValue(xanoProfile, 'Category_ID'),
                            'role-option': getXanoValue(xanoProfile, 'Roles'),
                            roles: getXanoValue(xanoProfile, 'Roles_IDs'),
                            'subcategories-option': getXanoValue(xanoProfile, 'Subcategories'),
                            subcategories: getXanoValue(xanoProfile, 'Subcategories_IDs'),
                            'profile-photo-url': getXanoValue(xanoProfile, 'Profile_Photo'),
                        },
                        step_2: {
                            tagline: getXanoValue(xanoProfile, 'Tagline'),
                            'pro-headline': getXanoValue(xanoProfile, 'Professional_Headline'),
                            'bio-html': getXanoValue(xanoProfile, 'Bio'),
                            'best-fit-1': getXanoValue(xanoProfile, 'Best_Fit_For_1'),
                            'best-fit-2': getXanoValue(xanoProfile, 'Best_Fit_For_2'),
                            'best-fit-3': getXanoValue(xanoProfile, 'Best_Fit_For_3'),
                        },
                        step_3: {
                            'also-worked-with': JSON.stringify(alsoWorkedWith),
                        },
                        step_4: {},
                        step_5: {
                            'skill-option': getXanoValue(xanoProfile, 'Skills'),
                            skills: getXanoValue(xanoProfile, 'Skills_IDs'),
                            'tool-option': getXanoValue(xanoProfile, 'Tool'),
                            tools: getXanoValue(xanoProfile, 'Tools_IDs'),
                            'industries-option': getXanoValue(xanoProfile, 'Industry_Experience'),
                            industries: getXanoValue(xanoProfile, 'Industry_Experience_IDs'),
                        },
                        step_6: {
                            rate: getXanoValue(xanoProfile, 'Hourly_Rate'),
                            'availability-option': getXanoValue(xanoProfile, 'Availability'),
                            availability: getXanoValue(xanoProfile, 'Availability_ID'),
                            'full-time-placement': getXanoValue(xanoProfile, 'Open_to_Full_Time'),
                            'free-consulting-calls': getXanoValue(xanoProfile, 'Free_Call_Enabled'),
                            'free-call-description': getXanoValue(xanoProfile, 'Free_Call_Description'),
                            'paid-consulting-calls': getXanoValue(xanoProfile, 'Paid_Call_Enabled'),
                            'paid-call-description': getXanoValue(xanoProfile, 'Paid_Call_Description'),
                            'paid-call-rate': getXanoValue(xanoProfile, 'Paid_Call_Rate'),
                            'offer-monthly-retainers': getXanoValue(xanoProfile, 'Retainer_Enabled'),
                            'description-retainer': getXanoValue(xanoProfile, 'Retainer_Description'),
                            'rate-retainer': getXanoValue(xanoProfile, 'Retainer_Rate'),
                            ...servicesData,
                        },
                        step_7: { ...reviewersData },
                    },
                };

                console.log("createBuildProfileFromXano", profile);

                return profile;
            }

            function getXanoValue(xanoProfile, key) {
                const value = xanoProfile?.[key];

                if (Array.isArray(value)) {
                    return value.join(',');
                }

                if (typeof value === 'number') {
                    return String(value);
                }

                if (typeof value === 'boolean') {
                    return value ? 'yes' : 'no';
                }

                return value ?? '';
            }

            function parseXanoTimestamp(value) {
                if (!value) return 0;

                if (typeof value === 'number') {
                    const timestamp = value < 10000000000 ? value * 1000 : value;
                    return timestamp;
                }

                const parsed = Date.parse(value);
                const timestamp = Number.isNaN(parsed) ? 0 : parsed;

                return timestamp;
            }

            function normalizeProfile(profile, isExternalProfile = false) {
                if (!profile || typeof profile !== 'object') {
                    const emptyProfile = createEmptyProfile(
                        PROFILE_TYPE,
                        PROFILE_TYPE_ID,
                        isExternalProfile ? 0 : Date.now()
                    );

                    return emptyProfile;
                }

                const normalizedProfile = {
                    type: profile.type.toLowerCase() || PROFILE_TYPE,
                    type_id: profile.type_id || PROFILE_TYPE_ID,
                    last_update: Number(profile.last_update || (isExternalProfile ? 0 : Date.now())),
                    data: profile.data && typeof profile.data === 'object' ? profile.data : {},
                };

                return normalizedProfile;
            }

            function ensureStepsInProfile(profile, steps) {
                if (!profile.data) {
                    profile.data = {};
                }

                steps.forEach((step) => {
                    const stepIndex = getStepIndex(step);
                    if (!stepIndex) return;

                    const stepKey = `step_${stepIndex}`;

                    if (!profile.data[stepKey]) {
                        profile.data[stepKey] = {};
                    }
                });
            }

            function getSteps() {
                return Array.from(qsa('[data-form="step"]'));
            }

            function getStepIndex(step) {
                return step.getAttribute('data-index');
            }
        });
    });

    function updateCounterFields() {
        const inputs = qsa('input.with-count, textarea.with-count');
        inputs.forEach((input) => {
            const wrapper = input.closest('.form_input-wr');
            if (!wrapper) return;

            const countSpan = qs('.count-input', wrapper);
            if (!countSpan) return;

            const byWords = input.hasAttribute('count-by-words');
            const currentLength = byWords ? countWords(input.value) : (input.value || '').trim().length;

            countSpan.textContent = String(currentLength).padStart(2, '0');
        });
    }

    function countWords(value) {
        const normalizedValue = (value || '').trim();
        if (!normalizedValue) return 0;

        return normalizedValue
            .split(/\s+/)
            .filter(Boolean)
            .length;
    }
    }
