
	document.addEventListener('DOMContentLoaded', function () {
		const form = qs('[build-profile-form]');
		if (!form) return;

		/* inputs */
		const emailInput = qs('#email');
		const phoneInput = qs('#phone');
		const countrySelect = qs('#country');
		const stateSelect = qs('#state');
		const citySelect = qs('#city');
		const stateAsterisk = qs('[state-asterisk]');
		const cityAsterisk = qs('[city-asterisk]');

		// skip Highlights handler
		const skipHighlightsBtn = qs('[skip-highlights-btn]');
		if (skipHighlightsBtn) {
			skipHighlightsBtn.onclick = () => {
				const step = skipHighlightsBtn.closest('[data-form="step"]');
				if (step) {
					const nextStep = qs('[data-form="next-btn"]', step);
					if (nextStep) nextStep.click();
				}
			}
		}

		/* Phone Mask */
		waitForMember(() => {
			if (!MEMBER.id) {
				return;
			}

			formatRateInputs();

			window.intlTelInput(phoneInput, {
				loadUtils: () => import("https://cdn.jsdelivr.net/npm/intl-tel-input@29.1.1/dist/js/utils.js"),
			});
		});

		/* errors */
		let emailError = null;
		ensureErrorElements(emailError, emailInput.parentNode, 'Please enter a valid email address.');

		// === Event listeners ===
		emailInput.addEventListener('input', checkFormValidity);
		emailInput.addEventListener('blur', checkFormValidity);

		emailInput.addEventListener('animationstart', (e) => {
			if (e.animationName === 'onAutoFillStart') checkFormValidity();
		});

		form.addEventListener('input', checkFormValidity);
		form.addEventListener('change', () => {
			checkFormValidity();
		});

		// Polling fallback for autofill
		let pollCount = 0;
		const autofillPoller = setInterval(() => {
			if (emailInput.value.trim() !== '') {
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
		if (stateAsterisk) stateAsterisk.style.display = 'inline';
		if (cityAsterisk) cityAsterisk.style.display = 'none';

		let locationData = [];

		fetch('https://cdn.prod.website-files.com/69c573f20f82bd0f3384032c/69f1f101875b89285ab287fd_locations.txt')
			.then((response) => response.json())
			.then((data) => {
				locationData = data;
				populateCountries();

				waitProfileData(() => {
					const stepData = activeProfile?.data?.["step_1"];
					if (!stepData) return;

					if (("country" in stepData)) {
						countrySelect.value = stepData["country"];
						customCountry.updateOptions();
					}

					setTimeout(() => {
						if (("state" in stepData)) {
							stateSelect.value = stepData["state"];
							customState.updateOptions();
						}
					}, 75);

					setTimeout(() => {
						if (("city" in stepData)) {
							citySelect.value = stepData["city"];
							customCity.updateOptions();
						}
					}, 150);
				});
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
			if (cityAsterisk) cityAsterisk.style.display = 'none';

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

					if (stateAsterisk) stateAsterisk.style.display = 'inline';
				} else {
					stateSelect.innerHTML = 'No such region';
					stateSelect.required = false;
					citySelect.required = false;

					if (stateAsterisk) stateAsterisk.style.display = 'none';
				}
			}
		});

		stateSelect.addEventListener('change', function () {
			const countryIndex = countrySelect.value;
			const stateIndex = this.value;

			citySelect.innerHTML = '<option value="">Select city</option>';
			citySelect.disabled = true;
			citySelect.required = false;
			if (cityAsterisk) cityAsterisk.style.display = 'none';

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

					if (cityAsterisk) cityAsterisk.style.display = 'inline';
				} else {
					citySelect.innerHTML = '<option value="">No such city</option>';
					citySelect.required = false;
				}
			}
		});

		checkFormValidity();

		/* METHODS */
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

			return isValid;
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
				qsa('.custom-select-container.open').forEach((el) => {
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
			const items = qsa('.custom-select-option', this.optionsContainer);
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

			const existingNoResults = qs('.no-results', this.optionsContainer);
			if (existingNoResults) existingNoResults.remove();

			if (!hasResults && items.length > 0) {
				const noRes = document.createElement('li');
				noRes.className = 'no-results';
				noRes.textContent = 'No results';
				this.optionsContainer.appendChild(noRes);
			}
		}
	}
