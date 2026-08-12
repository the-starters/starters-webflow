/**
 * GitHub-owned UI controller for /freelancer-application/step-1.
 *
 * This is the source-controlled replacement for the former Webflow Code Embed.
 * Native Webflow form markup remains authoritative. Submission transport stays
 * in v3/talent-application.js; this file owns field validation, conditional
 * blocks, location selects, and the authored custom-select UI only.
 */
;(function () {
  'use strict'

  if (window.__startersTalentApplicationUiBooted) return
  window.__startersTalentApplicationUiBooted = true
document.addEventListener('DOMContentLoaded', function () {
        const form = document.querySelector('[application-form]');
        const formSubmit = form ? form.querySelector('[form-submit]') : null;
        const formNext = form ? form.querySelector('[form-next]') : null;
        if (!form || !formSubmit || !formNext) return;

        /* inputs */
        const firstName = document.getElementById('first-name');
        const linkedinInput = document.getElementById('linkedin');
        const emailInput = document.getElementById('email');
        const phoneInput = document.getElementById('phone');
        const typeFull = document.querySelector('#full-profile');
        const typeConsult = document.querySelector('#consult-only');
        const rateFull = document.getElementById('rate');
        const rateConsult = document.getElementById('rate-consult');
        const referralSource = document.getElementById('referral-source');
        const referredBy = document.getElementById('referred');
        const referralOther = document.getElementById('other');
        const countrySelect = document.getElementById('country');
        const stateSelect = document.getElementById('state');
        const citySelect = document.getElementById('city');

        /* errors */
        let linkedinError = document.getElementById('linkedin-error');
        let emailError = null;

        /* blocks */
        const fullProfileBlock = document.querySelector('[data-element="full-profile"]');
        const consultBlock = document.querySelector('[data-element="consult"]');
        const referredBlock = document.querySelector('[data-element="referred"]');
        const otherBlock = document.querySelector('[data-element="other-option"]');

        hideAllConditionalBlocks();
        ensureErrorElements();

        // === Event listeners ===
        emailInput.addEventListener('input', checkFormValidity);
        emailInput.addEventListener('blur', checkFormValidity);

        linkedinInput.addEventListener('input', checkFormValidity);
        linkedinInput.addEventListener('blur', checkFormValidity);

        // Autofill via CSS animation trick
        linkedinInput.addEventListener('animationstart', (e) => {
            if (e.animationName === 'onAutoFillStart') checkFormValidity();
        });
        emailInput.addEventListener('animationstart', (e) => {
            if (e.animationName === 'onAutoFillStart') checkFormValidity();
        });

        document.querySelectorAll('input[name="profile-type"]').forEach((radio) => {
            radio.addEventListener('change', () => {
                toggleRoleBlocks();
                resetSecondStep();
                checkFormValidity();
            });
        });

        referralSource.addEventListener('change', () => {
            toggleReferralBlocks();
            checkFormValidity();

            triggerReferredError();
        });

        function triggerReferredError() {
            referredBy.value === ' ';
            referralOther.value === ' ';
            referredBy.dispatchEvent(new Event('input', { bubbles: true }));
            referralOther.dispatchEvent(new Event('input', { bubbles: true }));

            setTimeout(() => {
                referredBy.value = '';
                referralOther.value = '';
                referredBy.dispatchEvent(new Event('input', { bubbles: true }));
                referralOther.dispatchEvent(new Event('input', { bubbles: true }));
            }, 10);
        }

        form.addEventListener('input', checkFormValidity);
        form.addEventListener('change', () => {
            checkFormValidity();
            updateRequiredFields();
        });

        if (firstName) {
            firstName.addEventListener('input', () => {
                localStorage.setItem('applicant_first_name', firstName.value.trim());
            });
        }

        // Submission transport is intentionally not owned here. The
        // source-controlled v3/talent-application.js capture listener validates
        // the visible controls, writes to canonical Xano, records the privacy-
        // safe receipt, and redirects only after the server confirms success.

        // Polling fallback for autofill
        let pollCount = 0;
        const autofillPoller = setInterval(() => {
            if (emailInput.value.trim() !== '' || linkedinInput.value.trim() !== '') {
                checkFormValidity();
                clearInterval(autofillPoller);
            }
            if (++pollCount >= 20) clearInterval(autofillPoller);
        }, 100);

        // Country handlers
        const customCountry = new CustomSelect(countrySelect, 'Select country');
        const customState = new CustomSelect(stateSelect, 'Select state');
        const customCity = new CustomSelect(citySelect, 'Select city');

        countrySelect.required = true;
        stateSelect.required = true;
        citySelect.required = false;

        let locationData = [];

        fetch('https://cdn.prod.website-files.com/69c573f20f82bd0f3384032c/69f1f101875b89285ab287fd_locations.txt')
            .then((response) => response.json())
            .then((data) => {
                locationData = data;
                populateCountries();
            })
            .catch((error) => {
                console.error('JSON loading error:', error);
                countrySelect.innerHTML = 'Loading error';
            });

        function populateCountries() {
            countrySelect.innerHTML = '<option value="">Select country</option>';
            locationData.forEach((country, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = country.name;
                countrySelect.appendChild(option);
            });
        }

        countrySelect.addEventListener('change', function () {
            const countryIndex = this.value;

            stateSelect.innerHTML = '<option value="">Select state</option>';
            stateSelect.disabled = true;

            citySelect.innerHTML = '<option value="">Select city</option>';
            citySelect.disabled = true;
            citySelect.required = false;

            if (countryIndex !== '') {
                const states = locationData[countryIndex].states;
                if (states && states.length > 0) {
                    states.forEach((state, index) => {
                        const option = document.createElement('option');
                        option.value = index;
                        option.textContent = state.name;
                        stateSelect.appendChild(option);
                    });
                    stateSelect.disabled = false;
                    stateSelect.required = true;
                } else {
                    stateSelect.innerHTML = 'No such region';
                    stateSelect.required = false;
                    citySelect.required = false;
                }
            }
        });

        stateSelect.addEventListener('change', function () {
            const countryIndex = countrySelect.value;
            const stateIndex = this.value;

            citySelect.innerHTML = '<option value="">Select city</option>';
            citySelect.disabled = true;
            citySelect.required = false;

            if (stateIndex !== '') {
                const cities = locationData[countryIndex].states[stateIndex].cities;
                if (cities && cities.length > 0) {
                    cities.forEach((city) => {
                        const option = document.createElement('option');
                        option.value = city.name;
                        option.textContent = city.name;
                        citySelect.appendChild(option);
                    });
                    citySelect.disabled = false;
                    citySelect.required = true;
                    customCity.updateOptions();
                } else {
                    citySelect.innerHTML = '<option value="">No such city</option>';
                    citySelect.required = false;
                    customCity.updateOptions();
                }
            }
        });

        checkFormValidity();
        updateRequiredFields();

        /* METHODS */
        function resetSecondStep() {
            rateConsult.value = '';
            rateFull.value = '';

            const roleInput = form.querySelector('input[name="role-option"]');
            if (roleInput) {
                roleInput.value = '';
                roleInput.dispatchEvent(new Event('input', { bubbles: true }));
            }

            const consultInput = form.querySelector('input[name="consult-option"]');
            if (consultInput) {
                consultInput.value = '';
                consultInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }

        function hideAllConditionalBlocks() {
            [fullProfileBlock, consultBlock, referredBlock, otherBlock].forEach((block) => {
                if (block) block.style.display = 'none';
            });
        }

        function ensureErrorElements() {
            if (!linkedinError) {
                linkedinError = document.createElement('div');
                linkedinError.id = 'linkedin-error';
                linkedinError.style.cssText = `position: absolute; left: 0; bottom: -22px; color: #e11d48; font-size: 0.75rem; font-weight: 400; line-height: 1.2; white-space: nowrap; display: none; z-index: 10;`;
                linkedinError.textContent = 'Please enter a valid LinkedIn profile URL';
                linkedinInput.parentNode.appendChild(linkedinError);
            }

            emailError = document.createElement('div');
            emailError.id = 'email-error';
            emailError.style.cssText = `position: absolute; left: 0; bottom: -22px; color: #e11d48; font-size: 0.75rem; font-weight: 400; line-height: 1.2; white-space: nowrap; display: none; z-index: 10;`;
            emailError.textContent = 'Please enter a valid email address';
            emailInput.parentNode.appendChild(emailError);
        }

        function isValidEmail(email) {
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        }

        function isValidLinkedInUrl(url) {
            if (!url || url.trim() === '') return false;
            const trimmed = url.trim().toLowerCase();
            const patterns = [/^https?:\/\/(www\.)?linkedin\.com\/in\/.+/i, /^https?:\/\/(www\.)?linkedin\.com\/pub\/.+/i, /^linkedin\.com\/in\/.+/i];
            return patterns.some((p) => p.test(trimmed));
        }

        function updateRequiredFields() {
            const isFullVisible = fullProfileBlock && (fullProfileBlock.style.display === 'flex' || fullProfileBlock.style.display === 'block');
            const isConsultVisible = consultBlock && (consultBlock.style.display === 'flex' || consultBlock.style.display === 'block');

            if (rateFull) {
                isFullVisible ? rateFull.setAttribute('required', '') : rateFull.removeAttribute('required');
            }
            if (rateConsult) {
                isConsultVisible ? rateConsult.setAttribute('required', '') : rateConsult.removeAttribute('required');
            }
        }

        function nextBtnActivate(isValid = null) {
            if (isValid === null) return;

            if (isValid) {
                formNext.style.pointerEvents = 'auto';
                formNext.classList.remove('disabled');
            } else {
                formNext.style.pointerEvents = 'none';
                formNext.classList.add('disabled');
            }
        }

        function submitBtnActivate(isValid = null) {
            if (isValid === null) return;

            if (isValid) {
                formSubmit.style.pointerEvents = 'auto';
                formSubmit.classList.remove('disabled');
            } else {
                formSubmit.style.pointerEvents = 'none';
                formSubmit.classList.add('disabled');
            }
        }

        function checkFormValidity() {
            let isValid = true;

            const emailVal = emailInput.value.trim();
            if (emailVal === '') {
                emailInput.style.borderColor = '';
                if (emailError) emailError.style.display = 'none';
            } else if (!isValidEmail(emailVal)) {
                emailInput.style.borderColor = '#e11d48';
                if (emailError) emailError.style.display = 'block';
                isValid = false;
            } else {
                emailInput.style.borderColor = '';
                if (emailError) emailError.style.display = 'none';
            }

            const linkedinVal = linkedinInput.value.trim();
            if (linkedinVal === '') {
                linkedinInput.style.borderColor = '';
                if (linkedinError) linkedinError.style.display = 'none';
            } else if (!isValidLinkedInUrl(linkedinVal)) {
                linkedinInput.style.borderColor = '#e11d48';
                if (linkedinError) linkedinError.style.display = 'block';
                isValid = false;
            } else {
                linkedinInput.style.borderColor = '';
                if (linkedinError) linkedinError.style.display = 'none';
            }

            const phoneVal = phoneInput.value.trim();

            [rateFull, rateConsult].forEach((field) => {
                if (field) field.style.borderColor = '';
            });

            const citySelectValue = citySelect.required ? citySelect.value.trim() : 'non-required';

            if (
                emailVal === '' ||
                linkedinVal === '' ||
                phoneVal === '' ||
                countrySelect.value === '' ||
                stateSelect.value === '' ||
                citySelectValue === '' ||
                (
                    !typeFull.checked &&
                    !typeConsult.checked
                )
            ) {
                nextBtnActivate(false);
            } else {
                nextBtnActivate(isValid);
            }

            return isValid;
        }

        function toggleRoleBlocks() {
            const selected = document.querySelector('input[name="profile-type"]:checked');

            if (!selected) {
                fullProfileBlock.style.display = 'none';
                consultBlock.style.display = 'none';
            } else if (selected.id === 'full-profile') {
                fullProfileBlock.style.display = 'flex';
                consultBlock.style.display = 'none';
            } else if (selected.id === 'consult-only') {
                fullProfileBlock.style.display = 'none';
                consultBlock.style.display = 'flex';
            }

            updateRequiredFields();
        }

        function toggleReferralBlocks() {
            if (!referralSource) return;
            const value = referralSource.value.trim();
            if (value === 'Referral') {
                toggleBlock(referredBlock, 'referred', true);
                toggleBlock(otherBlock, 'other', false);
            } else if (value === 'Other') {
                toggleBlock(referredBlock, 'referred', false);
                toggleBlock(otherBlock, 'other', true);
            } else {
                toggleBlock(referredBlock, 'referred', false);
                toggleBlock(otherBlock, 'other', false);
            }
        }

        function toggleBlock(block, inputId, shouldShow) {
            if (!block) return;
            block.style.display = shouldShow ? 'block' : 'none';

            const input = block.querySelector(`input#${inputId}`);
            if (!input) return;

            if (shouldShow) {
                input.setAttribute('required', '');
            } else {
                input.removeAttribute('required');
            }
        }

    });

    class CustomSelect {
        constructor(originalSelect, placeholder) {
            this.originalSelect = originalSelect;
            this.placeholder = placeholder;
            this.container = null;
            this.trigger = null;
            this.dropdown = null;
            this.search = null;
            this.optionsContainer = null;
            this.init();
        }

        init() {
            this.container = document.createElement('div');
            this.container.className = 'custom-select-container';
            if (this.originalSelect.disabled) this.container.classList.add('disabled');

            this.trigger = document.createElement('div');
            this.trigger.className = 'custom-select-trigger';
            this.trigger.textContent = this.getSelectedText() || this.placeholder;

            this.search = document.createElement('input');
            this.search.type = 'text';
            this.search.className = 'custom-select-search';
            this.search.placeholder = 'Search..';
            this.search.style.display = 'none';

            this.dropdown = document.createElement('div');
            this.dropdown.className = 'custom-select-dropdown';

            this.optionsContainer = document.createElement('ul');
            this.optionsContainer.className = 'custom-select-options';

            this.dropdown.appendChild(this.optionsContainer);

            this.container.appendChild(this.trigger);
            this.container.appendChild(this.search);
            this.container.appendChild(this.dropdown);

            this.originalSelect.parentNode.insertBefore(this.container, this.originalSelect.nextSibling);
            this.originalSelect.__customSelectInstance = this;

            this.addEventListeners();
            this.updateOptions();
        }

        getSelectedText() {
            const selected = this.originalSelect.options[this.originalSelect.selectedIndex];
            return selected && selected.value !== '' ? selected.textContent : '';
        }

        updateOptions() {
            this.optionsContainer.innerHTML = '';
            const options = Array.from(this.originalSelect.options);

            options.forEach((opt, index) => {
                if (opt.value === '' && index === 0) return;

                const li = document.createElement('li');
                li.className = 'custom-select-option';
                li.textContent = opt.textContent;
                li.dataset.value = opt.value;
                if (opt.selected && opt.value !== '') li.classList.add('selected');

                li.addEventListener('click', () => {
                    this.originalSelect.value = opt.value;
                    this.originalSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    this.originalSelect.dispatchEvent(new Event('input', { bubbles: true }));
                    this.close();
                    this.updateOptions();
                });
                this.optionsContainer.appendChild(li);
            });

            this.updateTrigger();
        }

        updateTrigger() {
            const selectedText = this.getSelectedText();
            this.trigger.textContent = selectedText || this.placeholder;

            if (this.originalSelect.disabled) {
                this.container.classList.add('disabled');
            } else {
                this.container.classList.remove('disabled');
            }
        }

        addEventListeners() {
            this.trigger.addEventListener('click', () => {
                if (this.originalSelect.disabled) return;
                this.toggle();
            });

            this.search.addEventListener('input', (e) => {
                this.filter(e.target.value);
            });

            document.addEventListener('click', (e) => {
                if (!this.container.contains(e.target)) {
                    this.close();
                }
            });

            const observer = new MutationObserver(() => {
                this.updateOptions();
            });
            observer.observe(this.originalSelect, {
                childList: true,
                attributes: true,
            });
        }

        toggle() {
            if (this.container.classList.contains('open')) {
                this.close();
            } else {
                document.querySelectorAll('.custom-select-container.open').forEach((el) => {
                    if (el !== this.container) el.classList.remove('open');
                });
                this.open();
            }
        }

        open() {
            this.container.classList.add('open');
            this.trigger.style.display = 'none';
            this.search.style.display = '';
            this.search.value = '';
            this.filter('');
            setTimeout(() => this.search.focus(), 10);
        }

        close() {
            this.container.classList.remove('open');
            this.search.style.display = 'none';
            this.trigger.style.display = '';
        }

        filter(text) {
            const filterText = text.toLowerCase();
            const items = this.optionsContainer.querySelectorAll('.custom-select-option');
            let hasResults = false;

            items.forEach((item) => {
                const content = item.textContent.toLowerCase();
                if (content.includes(filterText)) {
                    item.classList.remove('hidden');
                    hasResults = true;
                } else {
                    item.classList.add('hidden');
                }
            });

            const existingNoResults = this.optionsContainer.querySelector('.no-results');
            if (existingNoResults) existingNoResults.remove();

            if (!hasResults && items.length > 0) {
                const noRes = document.createElement('li');
                noRes.className = 'no-results';
                noRes.textContent = 'No results';
                this.optionsContainer.appendChild(noRes);
            }
        }
    }

})()
