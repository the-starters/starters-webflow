/**
 * Starter Edit Profile page behavior.
 *
 * Loaded by Webflow after intl-tel-input and Quill. Keep the page footer thin;
 * GitHub and jsDelivr are the source and delivery path for this browser code.
 */

const qs = (selector, scope = document) => (scope || document).querySelector(selector);
const qsa = (selector, scope = document) => Array.from((scope || document).querySelectorAll(selector));

function waitProfileData(callback) {
	if (typeof window.waitProfileData === 'function') {
		return window.waitProfileData(callback);
	}

	const startedAt = Date.now();
	const poll = () => {
		if (window.activeProfile) {
			callback(window.activeProfile);
			return;
		}
		if (Date.now() - startedAt < 10000) window.setTimeout(poll, 100);
	};
	poll();
}

function waitForMember(callback) {
	if (typeof window.waitForMember === 'function') {
		return window.waitForMember(callback);
	}

	return Promise.resolve(window.memberReady || window.MEMBER || {})
		.then((member) => {
			window.MEMBER = member || {};
			callback(window.MEMBER);
			return window.MEMBER;
		});
}

function setLoader(state, wrapper) {
	if (typeof window.setLoader === 'function') {
		window.setLoader(state, wrapper);
		return;
	}

	const loader = qs('[data-loader], [data-custom-loader]', wrapper);
	if (!loader) return;
	loader.style.display = state ? '' : 'none';
	loader.style.visibility = state ? 'visible' : 'hidden';
	loader.style.opacity = state ? '1' : '0';
}

function formatRateInputs() {
	if (typeof window.formatRateInputs === 'function') {
		window.formatRateInputs();
		return;
	}

	qsa('[data-element="rate"]').forEach((input) => {
		input.addEventListener('input', () => {
			input.value = input.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
		});
	});
}

function stepElement(stepIndex) {
	return qs(`[data-form="step"][data-index="${stepIndex}"]`);
}

function isStepValid(stepIndex) {
	const step = stepElement(stepIndex);
	if (!step) return false;

	return qsa('input, select, textarea', step).every((field) => {
		if (field.disabled || !field.required) return true;
		return typeof field.checkValidity !== 'function' || field.checkValidity();
	});
}

function validateStepSubmit(stepIndex, quiet = true) {
	const step = stepElement(stepIndex);
	if (!step) return false;
	const valid = isStepValid(stepIndex);
	if (!valid && !quiet) {
		const invalid = qsa('input, select, textarea', step).find((field) =>
			typeof field.checkValidity === 'function' && !field.checkValidity()
		);
		invalid?.reportValidity?.();
	}
	return valid;
}

function checkAllStepsValidity(stepIndex) {
	const indexes = stepIndex
		? [stepIndex]
		: qsa('[data-form="step"][data-index]').map((step) => Number(step.dataset.index));
	indexes.forEach((index) => validateStepSubmit(index));
}

function handleCustomSelects() {
	if (typeof window.handleCustomSelects === 'function') {
		window.handleCustomSelects();
	}
}

// Inline block 1
document.addEventListener('DOMContentLoaded', function () {
		const form = qs('[build-profile-form]');
		if (!form) return;

		const openSuccessModal = qs("[data-modal-trigger='edit-form-success']");
		const openErrorModal = qs("[data-modal-trigger='edit-form-error']");

		waitProfileData(() => {
			if (window.activeProfile?.type === "full") {
				qs('[fs-list-instance="subcategories"]')?.remove();
			}

			if (window.activeProfile?.type === "consult") {
				qs('[fs-list-instance="roles"]')?.remove();
			}

			applyProfileTypeVisibility(window.activeProfile?.type);
		});

		/* inputs */
		const emailInput = qs('#email');
		const phoneInput = qs('#phone');

		/* Phone Mask */
		waitForMember(() => {
			if (!window.MEMBER?.id) {
				window.location.replace('/login');
				return;
			}

			formatRateInputs();

			window.intlTelInput(phoneInput, {
				loadUtils: () =>
					import("https://cdn.jsdelivr.net/npm/intl-tel-input@29.1.1/dist/js/utils.js"),
			});
		});

		// === Event listeners ===
		emailInput.addEventListener('input', () => checkAllStepsValidity(1));
		emailInput.addEventListener('blur', () => checkAllStepsValidity(1));
		emailInput.addEventListener('animationstart', (e) => {
			if (e.animationName === 'onAutoFillStart') checkAllStepsValidity(1);
		});

		form.addEventListener('input', () => {
			checkAllStepsValidity();
		});

		form.addEventListener('change', () => {
			checkAllStepsValidity();
		});

		// Polling fallback for autofill
		let pollCount = 0;
		const autofillPoller = setInterval(() => {
			if (emailInput.value.trim() !== '') {
				checkAllStepsValidity(1);
				clearInterval(autofillPoller);
			}

			if (++pollCount >= 20) clearInterval(autofillPoller);
		}, 100);

		/* METHODS */
		function applyProfileTypeVisibility(type) {
			if (!type) return;

			qsa('[data-label-type]').forEach((label) => {
				const labelType = label.dataset.labelType;
				label.style.display = labelType === type ? 'block' : 'none';
			});
			console.log("qsa('[data-label-type]')", qsa('[data-label-type]'));

			qsa('[data-group-hide]').forEach((group) => {
				const hideForType = group.dataset.groupHide;
				group.style.display = hideForType === type ? 'none' : 'block';
			});
			console.log("qsa('[data-group-hide]')", qsa('[data-group-hide]'));
			
			qsa('[data-call-rate-radio]').forEach((group) => {
				const checkForType = group.dataset.callRateRadio;
				if (checkForType === type) {
					group.click();
				}
			});
			console.log("qsa('[data-call-rate-radio]')", qsa('[data-call-rate-radio]'));

			qsa('[data-paid-group-reverse]').forEach(group => {
				const checkForType = group.dataset.paidGroupReverse;
				group.style.flexDirection = checkForType === type ? 'column-reverse' : 'column';
			});
			console.log("qsa('[data-paid-group-reverse]')", qsa('[data-paid-group-reverse]'));

			qsa('[data-non-required]').forEach(input => {
				const checkForType = input.dataset.nonRequired;
				input.required = checkForType === type ? false : true;
			});
			console.log("qsa('[data-non-required]')", qsa('[data-non-required]'));
		}

		/* SUBMIT METHODS */
		const PATCH_ENDPOINT = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/edit_profile/update/';
		const STEP_PAYLOAD_MAP = {
			1: {
				First_Name: 'first-name',
				Last_Name: 'last-name',
				Phone: 'phone',
				Email: 'email',
				City: 'city',
				Country: 'country',
				State_Province: 'state',
				Category: 'function-option',
				Category_ID: 'function',
				Roles: 'role-option',
				Roles_IDs: 'roles',
				Subcategories: 'subcategories-option',
				Subcategories_IDs: 'subcategories',
				Profile_Photo: 'profile-photo-url',
			},

			2: {
				Tagline: 'tagline',
				Professional_Headline: 'pro-headline',
				Bio: 'bio-html',
				Best_Fit_For_1: 'best-fit-1',
				Best_Fit_For_2: 'best-fit-2',
				Best_Fit_For_3: 'best-fit-3',
			},

			// Step 3 (companies) and step 4 (highlights) are fully owned by their own CRUD
			// embeds, which manage their submit button state and success/error modal directly.
			3: {},

			4: {},

			5: {
				Skills: 'skill-option',
				Skills_IDs: 'skills',
				Tool: 'tool-option',
				Tools_IDs: 'tools',
				Industry_Experience: 'industries-option',
				Industry_Experience_IDs: 'industries',
			},

			6: {
				Hourly_Rate: 'rate',
				Availability: 'availability-option',
				Availability_ID: 'availability',
				Open_to_Full_Time: 'full-time-placement',
				Free_Call_Enabled: 'free-consulting-calls',
				Free_Call_Description: 'free-call-description',
				Paid_Call_Enabled: 'paid-consulting-calls',
				Paid_Call_Description: 'paid-call-description',
				Paid_Call_Rate: 'paid-call-rate',
				Retainer_Enabled: 'offer-monthly-retainers',
				Retainer_Description: 'description-retainer',
				Retainer_Rate: 'rate-retainer',
				Services: 'service',
			},
		};

		initStepSubmits();

		function initStepSubmits() {
			qsa('[data-form="step"][data-index]').forEach((step) => {
				const stepIndex = Number(step.dataset.index);

				// Companies (step 3) and Highlights (step 4) are fully owned by their own CRUD
				// embeds: each awaits its own async work before showing success, so they manage
				// their submit button themselves.
				if (stepIndex === 3 || stepIndex === 4) return;

				const submitButton = qs('[data-edit-submit]', step);
				if (!submitButton) return;

				submitButton.addEventListener('click', async (event) => {
					event.preventDefault();

					if (!isStepValid(stepIndex)) {
						validateStepSubmit(stepIndex, false);
						return;
					}

					await submitStep(stepIndex, submitButton);
				});
			});
		}

		async function submitStep(stepIndex, submitButton) {
			setSubmitLoading(submitButton, true);

			const payload = getStepPayload(stepIndex);
			console.log("Raw payload", payload);

			// Country, State
			if (payload.Country && payload.State_Province) {
				const countrySelect = qs('#country');
				if (countrySelect) payload.Country = countrySelect.options[countrySelect.selectedIndex]?.text || '';

				const stateSelect = qs('#state');
				if (stateSelect) payload.State_Province = stateSelect.options[stateSelect.selectedIndex]?.text || '';
			}

			const parseJson = (value) => {
				if (!value || typeof value !== "string") return null;

				try {
					return JSON.parse(value);
				} catch (error) {
					console.warn("Invalid JSON field:", value);
					return null;
				}
			};

			// Services
			if (payload.Services) {
				let service1 = qs("#service");
				service1 = service1 ? parseJson(service1.value) : null;

				let service2 = qs("#service-2");
				service2 = service2 ? parseJson(service2.value) : null;

				let service3 = qs("#service-3");
				service3 = service3 ? parseJson(service3.value) : null;

				function requiredServicesFields(name, price) {
					if (!name || !price) return false;

					return true;
				}

				payload.Services = JSON.stringify({
					"service-1": requiredServicesFields(service1?.name, service1?.price) ? service1 : null,
					"service-2": requiredServicesFields(service2?.name, service2?.price) ? service2 : null,
					"service-3": requiredServicesFields(service3?.name, service3?.price) ? service3 : null,
				});
			}

			// Phone
			if (payload.Phone) {
				payload.Phone = window.intlTelInput?.getInstance(qs('input[name="phone"]'))?.getNumber() || payload.Phone || '';
			}

			// payload.member_id = MEMBER.id;
			payload['Profile_Type'] = window.activeProfile?.type || null;
			payload['Profile_Type_ID'] = window.activeProfile?.type_id || null;
			payload["Updated_On"] = Date.now();

			if (!Object.keys(payload).length) {
				console.warn(`Step ${stepIndex} has empty payload.`);
				setSubmitLoading(submitButton, false);
				return;
			}

			console.log("Ready payload", payload);

			// if (!localStorage.getItem('editSubmit') || localStorage.getItem('editSubmit') !== 'true') {
			// 	console.log(`Step ${stepIndex} submit skipped (disabled by localStorage).`);
			// 	setTimeout(() => {
			// 		setSubmitLoading(submitButton, false);
			// 	}, 1000);
			// 	return;
			// }

			try {
				const response = await fetch(`${PATCH_ENDPOINT}${window.MEMBER.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});

				const result = await response.json().catch(() => null);
				if (!response.ok) {
					console.error(`Step ${stepIndex} submit error:`, result);
					throw new Error(result?.message || result?.error || `Profile update failed (${response.status})`);
				}

				// update Member customFields, if even one of them was changed
				if (stepIndex === 1) {
					if (
						window.MEMBER.customFields?.['free-user']?.toLowerCase().trim() !== (payload['First_Name'] || '').toLowerCase().trim() ||
						window.MEMBER.customFields?.['last-name']?.toLowerCase().trim() !== (payload['Last_Name'] || '').toLowerCase().trim() ||
						window.MEMBER.customFields?.['phone']?.toLowerCase().trim() !== (payload['Phone'] || '').toLowerCase().trim()
					) {
						try {
							await window.$memberstackDom.updateMember({
								customFields: {
									'free-user': payload.First_Name || '',
									'last-name': payload.Last_Name || '',
									'phone': payload.Phone || '',
								}
							});
						} catch (error) {
							console.error("Failed to update Member customFields:", error);
						}
					}
				}

				console.log(`Step ${stepIndex} submitted successfully:`, result);
				openSuccessModal?.dispatchEvent(new Event('click', { bubbles: true }));
			} catch (error) {
				openErrorModal?.dispatchEvent(new Event('click', { bubbles: true }));

				console.error(`Step ${stepIndex} submit failed:`, error);
			} finally {
				setSubmitLoading(submitButton, false);
			}
		}

		function getStepPayload(stepIndex) {
			const stepMap = STEP_PAYLOAD_MAP[stepIndex];
			if (!stepMap) return {};

			const formData = getFormDataObject();
			const payload = {};

			Object.entries(stepMap).forEach(([xanoField, formField]) => {
				if (formData[formField] !== undefined) {
					payload[xanoField] = formData[formField];
				}
			});

			return payload;
		}

		function getFormDataObject() {
			const formData = new FormData(form);
			const data = {};

			const booleanFields = [
				'free-consulting-calls',
				'paid-consulting-calls',
				'offer-monthly-retainers',
				'full-time-placement',
			];

			function normalizeValue(key, value) {
				if (booleanFields.includes(key)) {
					return value === 'yes';
				}

				return value;
			}

			formData.forEach((value, key) => {
				const normalizedValue = normalizeValue(key, value);

				if (key in data) {
					if (!Array.isArray(data[key])) {
						data[key] = [data[key]];
					}

					data[key].push(normalizedValue);
				} else {
					data[key] = normalizedValue;
				}
			});

			return data;
		}

		function setSubmitLoading(button, isLoading) {
			if (!button) return;

			button.style.opacity = isLoading ? '0.6' : '';
			button.style.pointerEvents = isLoading ? 'none' : '';

			const step = button.closest("[data-form=step]");
			if (step) setLoader(isLoading, step);

			qsa('.button_main-text', button).forEach(el => {
				el.textContent = isLoading ? 'Loading...' : 'Submit';
			});
		}
	});

// Inline block 2
function counterFields(wrapper = null) {
		const inputs = qsa(
			'input.with-count:not(.initialized), textarea.with-count:not(.initialized)',
			wrapper
		);

		inputs.forEach((input) => {
			const wrapper = input.closest('.form_input-wr');
			if (!wrapper) return;

			const countSpan = qs('.count-input', wrapper);
			if (!countSpan) return;

			input.classList.add('initialized');

			const byWords = input.hasAttribute('count-by-words');

			const maxLength = byWords
				? Number(input.dataset.maxWords || 160)
				: Number(input.maxLength || 80);


			function getCurrentCount(value) {
				return byWords ? countWords(value) : (value || '').trim().length;
			}

			function countWords(value) {
				const normalizedValue = (value || '')
					.replace(/\uFEFF/g, '')
					.replace(/\u00A0/g, ' ')
					.replace(/[\r\n]+/g, ' ')
					.trim();

				if (!normalizedValue) return 0;

				return normalizedValue
					.split(/\s+/)
					.filter(Boolean)
					.length;
			}

			function updateCount() {
				const currentLength = getCurrentCount(input.value);

				countSpan.textContent = String(currentLength).padStart(2, '0');
			}

			function getSelectedTextLength() {
				const start = input.selectionStart || 0;
				const end = input.selectionEnd || 0;

				return end - start;
			}

			function wouldExceedCharLimit(nextValue) {
				return nextValue.length > maxLength;
			}

			function wouldExceedWordLimit(nextValue) {
				return countWords(nextValue) > maxLength;
			}

			function getNextValue(insertedValue = '') {
				const start = input.selectionStart || 0;
				const end = input.selectionEnd || 0;
				const value = input.value || '';

				return value.slice(0, start) + insertedValue + value.slice(end);
			}

			function isAllowedControlInput(event) {
				return [
					'deleteContentBackward',
					'deleteContentForward',
					'deleteByCut',
					'insertFromPaste'
					// 'historyUndo',
					// 'historyRedo',
				].includes(event.inputType);
			}

			input.addEventListener('beforeinput', (event) => {
				if (isAllowedControlInput(event)) return;

				const insertedValue = event.data || '';

				// Якщо це не текстова вставка — не блокуємо.
				if (!insertedValue && event.inputType !== 'insertText') return;

				const nextValue = getNextValue(insertedValue);

				const isOverLimit = byWords
					? wouldExceedWordLimit(nextValue)
					: wouldExceedCharLimit(nextValue);

				if (isOverLimit) {
					event.preventDefault();
				}
			});

			input.addEventListener('paste', (event) => {
				event.preventDefault();

				const pastedText = event.clipboardData?.getData('text') || '';
				if (!pastedText) return;

				const start = input.selectionStart || 0;
				const end = input.selectionEnd || 0;
				const currentValue = input.value || '';

				const before = currentValue.slice(0, start);
				const after = currentValue.slice(end);

				if (!byWords) {
					const availableLength = maxLength - (before.length + after.length);
					if (availableLength <= 0) return;

					const allowedPaste = pastedText.slice(0, availableLength);
					input.value = before + allowedPaste + after;

					const newCursorPosition = before.length + allowedPaste.length;
					input.setSelectionRange(newCursorPosition, newCursorPosition);
				} else {
					const beforeWords = countWords(before);
					const afterWords = countWords(after);
					const availableWords = maxLength - beforeWords - afterWords;

					if (availableWords <= 0) return;

					const pastedWords = pastedText
						.trim()
						.split(/\s+/)
						.filter(Boolean)
						.slice(0, availableWords);

					const allowedPaste = pastedWords.join(' ');

					input.value = before + allowedPaste + after;

					const newCursorPosition = before.length + allowedPaste.length;
					input.setSelectionRange(newCursorPosition, newCursorPosition);
				}

				input.dispatchEvent(new Event('input', { bubbles: true }));
				input.dispatchEvent(new Event('change', { bubbles: true }));

				updateCount();
			});

			input.addEventListener('input', updateCount);
			input.addEventListener('change', updateCount);

			updateCount();
		});
	}

	counterFields();

// Inline block 3
document.addEventListener('DOMContentLoaded', () => {
		const outputPlain = qs('#bio-plain');
		const outputHtml = qs('#bio-html');
		if (!outputHtml || !outputPlain) return;

		const MAX_WORDS = Number(outputPlain.dataset.maxWords) || 300;
		let isCleaning = false;
		let prevContents = null;
		let prevWordCount = 0;

		const bioEditor = new Quill('#bio-editor', {
			theme: 'snow',
			// placeholder: 'What’s your specialty, who do you work best with, and what outcomes do you create?',
			placeholder: `Jai is currently the Founder & CEO of The Starters, a vetted freelancer marketplace focused on helping e-commerce businesses find top-tier freelance talent. Jai helps e-commerce brands with:\n\n- Organizational structure & building great, efficient teams\n- Performance marketing strategy (full funnel, not just ads)\n- Strategies to improve customer retention\n- All things subscription\n\nPreviously, Jai was the Chief Marketing Officer at Winc and ran Winc's direct-to-consumer P&L in addition to owning the omnichannel growth of Winc's brands, like Summer Water - one of the fastest growing rose brands in the country.\n\nWhile at Winc, Jai developed an expertise for customer retention strategy, increasing customer LTV, media planning, and attribution methodologies. Jai has also helped drive strategy for hyper growth startups Fair and Bird.`,
			modules: {
				toolbar: [
					// [{ 'header': [2, 3, false] }],
					[{ 'list': 'bullet' }, { 'list': 'ordered' }],
					// ['bold', 'italic'],
					// ['link'],
					// ['clean']
				],
				keyboard: {
					bindings: {
						preventDoubleSpaces: {
							key: ' ',
							collapsed: true,

							handler(range) {
								if (hasAdjacentSpace(this.quill, range.index)) {
									return false;
								}

								return true;
							},
						},
					},
				},
			},
		});

		// initial value handler
		waitProfileData(() => {
			const stepData = window.activeProfile?.data?.["step_2"];
			if (!stepData) return;

			if (("bio-html" in stepData)) {
				const html = stepData["bio-html"]
					.replaceAll("\u00A0", " ")
					.replaceAll("&nbsp;", " ");

				bioEditor.root.innerHTML = html;
				syncQuillValue();

				prevContents = bioEditor.getContents();
				prevWordCount = getQuillWordCount(bioEditor);
			}
		});

		prevContents = bioEditor.getContents();
		prevWordCount = getQuillWordCount(bioEditor);

		bioEditor.root.addEventListener('paste', handleQuillPaste);

		bioEditor.on('text-change', (delta) => {
			if (isCleaning) return;

			const wordCount = getQuillWordCount(bioEditor);
			const isWhitespaceInsert = hasOnlyWhitespaceInsert(delta);

			if (
				wordCount > MAX_WORDS ||
				(prevWordCount >= MAX_WORDS && isWhitespaceInsert && wordCount > prevWordCount)
			) {
				const selection = bioEditor.getSelection();

				isCleaning = true;

				bioEditor.setContents(prevContents, 'silent');

				if (selection) {
					const safeIndex = Math.min(
						Math.max(selection.index - 1, 0),
						bioEditor.getLength() - 1
					);

					bioEditor.setSelection(safeIndex, 0, 'silent');
				}

				isCleaning = false;

				syncQuillValue();
				return;
			}

			requestAnimationFrame(() => {
				syncQuillValue();

				prevContents = bioEditor.getContents();
				prevWordCount = getQuillWordCount(bioEditor);
			});
		});

		function handleQuillPaste(event) {
			const pastedText = event.clipboardData?.getData('text/plain') || '';
			if (!pastedText.trim()) return;

			const range = bioEditor.getSelection(true);
			if (!range) return;

			const currentText = bioEditor.getText();

			const before = currentText.slice(0, range.index);
			const after = currentText.slice(range.index + range.length);

			const baseWordCount = countWordsFromText(before + after);
			const availableWords = MAX_WORDS - baseWordCount;

			if (availableWords <= 0) {
				event.preventDefault();
				return;
			}

			const pastedWordCount = countWordsFromText(pastedText);

			if (baseWordCount + pastedWordCount <= MAX_WORDS) {
				return;
			}

			event.preventDefault();

			const allowedPaste = trimTextToWords(pastedText, availableWords);
			if (!allowedPaste) return;

			isCleaning = true;

			if (range.length > 0) {
				bioEditor.deleteText(range.index, range.length, 'silent');
			}

			bioEditor.insertText(range.index, allowedPaste, 'silent');

			const newCursorPosition = range.index + allowedPaste.length;
			bioEditor.setSelection(newCursorPosition, 0, 'silent');

			isCleaning = false;
			syncQuillValue();

			prevContents = bioEditor.getContents();
			prevWordCount = getQuillWordCount(bioEditor);
		}

		function getPlainQuillText(quillInstance) {
			const plainText = quillInstance.getText().replace(/\n$/, '');
			return plainText;
		}

		function getQuillWords(quillInstance) {
			return getWordsFromText(quillInstance.getText());
		}

		function getQuillWordCount(quillInstance) {
			return getQuillWords(quillInstance).length;
		}

		function getWordsFromText(text) {
			const plainText = (text || '')
				.replace(/\uFEFF/g, '')
				.replace(/\u00A0/g, ' ')
				.replace(/[\r\n]+/g, ' ')
				.trim();

			if (!plainText) return [];

			return plainText.match(/\S+/g) || [];
		}

		function countWordsFromText(text) {
			return getWordsFromText(text).length;
		}

		function trimTextToWords(text, maxWords) {
			if (maxWords <= 0) return '';

			const normalizedText = (text || '')
				.replace(/\uFEFF/g, '')
				.replace(/\u00A0/g, ' ');

			const tokenRegex = /\S+/g;

			let match;
			let wordsCount = 0;
			let endIndex = 0;

			while ((match = tokenRegex.exec(normalizedText)) !== null) {
				wordsCount++;
				endIndex = match.index + match[0].length;

				if (wordsCount >= maxWords) {
					break;
				}
			}

			if (!endIndex) return '';

			return normalizedText.slice(0, endIndex).trim();
		}

		function hasOnlyWhitespaceInsert(delta) {
			return delta.ops.some((op) => {
				return typeof op.insert === 'string' && /^\s+$/.test(op.insert);
			});
		}

		function hasAdjacentSpace(quillInstance, index) {
			const beforeChar = quillInstance.getText(Math.max(index - 1, 0), index > 0 ? 1 : 0);
			const afterChar = quillInstance.getText(index, 1);

			return beforeChar === ' ' || beforeChar === '\u00A0' || afterChar === ' ' || afterChar === '\u00A0';
		}

		function getCleanQuillHTML(quillInstance) {
			const rawHTML = quillInstance.root.innerHTML.replaceAll(
				'<span class="ql-ui" contenteditable="false"></span>',
				''
			);

			const wrapper = document.createElement('div');
			wrapper.innerHTML = rawHTML;

			// Remove empty paragraphs from the final value.
			qsa('p', wrapper).forEach((p) => {
				const text = p.textContent
					.replace(/\u00A0/g, ' ')
					.trim();

				if (!text) {
					p.remove();
				}
			});

			// Remove empty li elements if they somehow appear after paste.
			qsa('li', wrapper).forEach((li) => {
				const text = li.textContent
					.replace(/\u00A0/g, ' ')
					.trim();

				if (!text) {
					li.remove();
				}
			});

			// Remove empty lists.
			qsa('ul, ol', wrapper).forEach((list) => {
				if (!qs('li', list)) {
					list.remove();
				}
			});

			return wrapper.innerHTML
				.replaceAll("&nbsp;", " ")
				.trim();
		}

		function syncQuillValue() {
			outputPlain.value = getPlainQuillText(bioEditor);
			outputPlain.dispatchEvent(new Event('change', { bubbles: true }));
			outputPlain.dispatchEvent(new Event('input', { bubbles: true }));

			outputHtml.value = getCleanQuillHTML(bioEditor);
			outputHtml.dispatchEvent(new Event('change', { bubbles: true }));
			outputHtml.dispatchEvent(new Event('input', { bubbles: true }));
		}

		syncQuillValue();
	});

// Inline block 4
document.addEventListener('DOMContentLoaded', function () {
		window.FinsweetAttributes ||= [];
		window.FinsweetAttributes.push([
			'list',
			(listInstances) => {
				waitUntilAllItemsRendered({
					listSelector: '[fs-list-element="list"][skills-collection-list]',
					itemSelector: '.select-skills',
					stableTime: 1200,
					timeout: 60000,
					callback: () => {
						handleCustomSelects();
						console.log("Skills select handled!");
					},
				});

				waitUntilAllItemsRendered({
					listSelector: '[fs-list-element="list"][tools-collection-list]',
					itemSelector: '.select-tools',
					stableTime: 1200,
					timeout: 60000,
					callback: () => {
						handleCustomSelects();
						console.log("Tools select handled!");
					},
				});
			},
		]);

		function waitUntilAllItemsRendered({
			listSelector,
			itemSelector,
			stableTime = 1000,
			timeout = 60000,
			callback,
		}) {
			const list = qs(listSelector);
			if (!list) return;

			let lastCount = 0;
			let stableTimer = null;
			let finished = false;

			const observer = new MutationObserver(() => {
				if (finished) return;

				const currentCount = qsa(itemSelector, list).length;
				if (currentCount !== lastCount) {
					lastCount = currentCount;

					clearTimeout(stableTimer);
					stableTimer = setTimeout(() => {
						if (finished) return;

						finished = true;
						observer.disconnect();

						const instance = list.closest('[fs-list-instance]');
						if (!instance) {
							console.warn('List instance not found for selector:', listSelector);
							return;
						}

						const wrapper = instance ? instance.querySelector('[ms-code-select-wrapper]') : null;
						if (!wrapper) {
							console.warn('Select wrapper not found for list instance:', instance);
							return;
						}

						wrapper.classList.remove('js-more-hundred');
						callback();
					}, stableTime);
				}
			});

			observer.observe(list, {
				childList: true,
				subtree: true,
			});

			// fallback
			setTimeout(() => {
				if (finished) return;

				finished = true;
				observer.disconnect();

				callback();
			}, timeout);
		}

		/* INIT */
		handleCustomSelects();
	});

// Inline block 5
document.addEventListener('DOMContentLoaded', function () {
		function groupDropdownOptions() {
			$('[ms-code-select-wrapper="multi"][data-grouped-select="with-category"]').each(function () {
				const $wrapper = $(this);
				const $list = $wrapper.find('[ms-code-select="list"]');
				if ($list.attr('data-grouped') === 'true') return;

				const grouped = {};
				$wrapper
					.closest('.app-form_input_group')
					.find('.fs-cms_item')
					.each(function () {
						const category = $(this).attr('data-category') || 'Other';
						const option = $(this).find('.consult-option, .role-option').text().trim();
						if (!option) return;
						if (!grouped[category]) {
							grouped[category] = [];
						}
						grouped[category].push(option);
					});

				const $options = $list.find('[ms-code-select="tag-name-new"]');
				$options.detach();
				$list.find('.form_option-category').remove();

				Object.keys(grouped).forEach((category) => {
					const $title = $(`<div class="form_option-category">${category}</div>`);
					$list.append($title);
					grouped[category].forEach((value) => {
						const $existingOption = $options.filter(function () {
							return $(this).text().trim() === value;
						});
						$list.append($existingOption);
					});
				});

				$list.attr('data-grouped', 'true');
			});
		}

		setTimeout(groupDropdownOptions, 300);
	});

// Inline block 6
document.addEventListener('DOMContentLoaded', () => {
		const retainerDesc = qs('[data-monthly-retainers-description]');
		const retainerRate = qs('[data-monthly-retainers-rate]');

		const retainerRadios = qsa('input[name="offer-monthly-retainers"]');
		const paidCallRadios = qsa('input[name="paid-consulting-calls"]');
		const freeCallRadios = qsa('input[name="free-consulting-calls"]');

		const paidCallGroups = qsa('[paid-call-group]');
		const freeCallGroups = qsa('[free-call-group]');

		waitProfileData(() => {
			retainerToggle();
			paidCallToggle();
			freeCallToggle();
			console.log("retainer/paidCall/freeCall toggles initialized");
		});

		retainerRadios.forEach((radio) => {
			radio.addEventListener('change', retainerToggle);
		});

		paidCallRadios.forEach((radio) => {
			radio.addEventListener('change', paidCallToggle);
		});

		freeCallRadios.forEach((radio) => {
			radio.addEventListener('change', freeCallToggle);
		});

		function retainerToggle() {
			console.log("retainerToggle");
			
			const checkedMonthlyRadio = qs('input[name="offer-monthly-retainers"]:checked');
			const isMonthlyYes = checkedMonthlyRadio?.value === 'yes';
			retainerDesc.style.display = isMonthlyYes ? '' : 'none';
			retainerRate.style.display = isMonthlyYes ? '' : 'none';
			toggleInputs(retainerDesc, isMonthlyYes);
			toggleInputs(retainerRate, isMonthlyYes);
		};

		function paidCallToggle() {
			console.log("paidCallToggle");

			const checkedPaidCallRadio = qs('input[name="paid-consulting-calls"]:checked');
			const isCallRateYes = checkedPaidCallRadio?.value === 'yes';
			paidCallGroups.forEach((group) => {
				group.style.display = isCallRateYes ? '' : 'none';
				toggleInputs(group, isCallRateYes);
			});
		};

		function freeCallToggle() {
			console.log("freeCallToggle");

			const checkedFreeCallRadio = qs('input[name="free-consulting-calls"]:checked');
			const isFreeCallYes = checkedFreeCallRadio?.value === 'yes';
			freeCallGroups.forEach((group) => {
				group.style.display = isFreeCallYes ? '' : 'none';
				toggleInputs(group, isFreeCallYes);
			});
		};

		function toggleInputs(wrap, state = null) {
			if (!wrap || state === null) return;
			qsa("input, textarea", wrap).forEach((el) => {
				// clear values when toggle
				if (!state) el.value = '';

				// toggle required attribute
				if (wrap.hasAttribute('data-required')) {
					el.required = state;
				}

				// trigger change and input events
				$(el).trigger("change");
				$(el).trigger("input");
			});
		}
	});
