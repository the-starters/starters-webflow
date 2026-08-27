/**
 * Starter Edit Profile page behavior.
 *
 * Loaded by Webflow after intl-tel-input and Quill. Keep the page footer thin;
 * GitHub and jsDelivr are the source and delivery path for this browser code.
 * Each section must initialize whether this script runs before or after DOMContentLoaded.
 *
 * @release v1.59.346
 */

(() => {
const qs = (selector, scope = document) => (scope || document).querySelector(selector);
const qsa = (selector, scope = document) => Array.from((scope || document).querySelectorAll(selector));
const onDomReady = (callback) => {
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', callback, { once: true });
		return;
	}
	callback();
};
const PROFILE_WORKFLOW = 'starter_profile_edit';
const PROFILE_CONTROLLER_VERSION = 'starter-edit-profile-v3';
const workflowDiagnosticsControllerScript = document.currentScript;
const WORKFLOW_DIAGNOSTICS_TIMEOUT_MS = 2000;
let memberAuthGeneration = 0;
let observedMemberstackClient = null;
const personalDetailsReplayProofs = new WeakMap();

function memberFromResult(result) {
	return result?.data || result?.member || result || null;
}

function normalizedEmail(value) {
	return String(value ?? '').trim().toLowerCase();
}

function memberEmail(member) {
	return normalizedEmail(member?.auth?.email || member?.email || '');
}

function authorizePersonalDetailsReplay(form, proof) {
	const memberId = String(proof?.memberId || '').trim();
	const email = normalizedEmail(proof?.email);
	if (!form || !memberId || !email) return false;
	personalDetailsReplayProofs.set(form, { memberId, email });
	const storedProof = personalDetailsReplayProofs.get(form);
	if (typeof proof.onRejected === 'function') storedProof.onRejected = proof.onRejected;
	return true;
}

function takePersonalDetailsReplay(form) {
	const proof = personalDetailsReplayProofs.get(form) || null;
	personalDetailsReplayProofs.delete(form);
	return proof;
}

function clearPersonalDetailsReplay(form) {
	personalDetailsReplayProofs.delete(form);
}

function replayProofMatches(scope, proof) {
	if (!proof) return true;
	return Boolean(
		scope?.member?.id === proof.memberId &&
		memberEmail(scope.member) === proof.email &&
		normalizedEmail(qs('[name="email"]', stepElement(1))?.value) === proof.email
	);
}

function rejectReplayProof(proof) {
	if (!proof || proof.settled) return;
	proof.settled = true;
	if (typeof proof.onRejected === 'function') proof.onRejected();
}

function acceptReplayProof(proof) {
	if (proof) proof.settled = true;
}

function memberScopeChangedError() {
	const error = new Error('Your signed-in account changed. Refresh and try again.');
	error.code = 'MEMBER_SCOPE_CHANGED';
	return error;
}

// Memberstack immediately replays its auth state when this listener subscribes, and
// that replay can arrive empty while getCurrentMember() already has the live member.
// Ignore the first notification only when it is empty or reports the member read just
// before subscribing. Every other notification invalidates in-flight work, including
// logout followed by reauthentication as the same member.
function observeMemberstackAuth(client, subscribedMemberId) {
	if (observedMemberstackClient === client) return;
	observedMemberstackClient = client;
	let awaitingInitialNotification = true;
	if (typeof client?.onAuthChange === 'function') {
		client.onAuthChange((result) => {
			const nextMemberId = memberFromResult(result)?.id || '';
			if (awaitingInitialNotification) {
				awaitingInitialNotification = false;
				if (!nextMemberId || nextMemberId === subscribedMemberId) return;
			}
			memberAuthGeneration += 1;
		});
	}
}

async function captureMemberScope() {
	const client = window.$memberstackDom;
	if (!client || typeof client.getCurrentMember !== 'function') {
		throw new Error('Memberstack member lookup is unavailable.');
	}
	// The pre-subscribe read brackets the subscription window that no generation guard
	// can cover yet, so it is only needed on the capture that installs the listener.
	let subscribedMemberId = '';
	if (observedMemberstackClient !== client) {
		subscribedMemberId = memberFromResult(await client.getCurrentMember())?.id || '';
		if (!subscribedMemberId) throw memberScopeChangedError();
		observeMemberstackAuth(client, subscribedMemberId);
	}
	const generation = memberAuthGeneration;
	const member = memberFromResult(await client.getCurrentMember());
	if (
		!member?.id ||
		(subscribedMemberId && member.id !== subscribedMemberId) ||
		generation !== memberAuthGeneration
	) throw memberScopeChangedError();
	return { client, generation, member };
}

async function revalidateMemberScope(scope) {
	const member = memberFromResult(await scope.client.getCurrentMember());
	if (!member?.id || member.id !== scope.member.id || scope.generation !== memberAuthGeneration) {
		throw memberScopeChangedError();
	}
	return member;
}

function boundedWorkflowDiagnostics(promise) {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (api) => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			resolve(api || null);
		};
		const timer = window.setTimeout(() => finish(null), WORKFLOW_DIAGNOSTICS_TIMEOUT_MS);
		Promise.resolve(promise).then(finish, () => finish(null));
	});
}

function loadWorkflowDiagnostics() {
	if (window.StartersWorkflowDiagnostics) return Promise.resolve(window.StartersWorkflowDiagnostics);
	if (window.__startersWorkflowDiagnosticsReady) {
		return boundedWorkflowDiagnostics(window.__startersWorkflowDiagnosticsReady);
	}
	const source = workflowDiagnosticsControllerScript?.src;
	if (!source || !document.createElement) return Promise.resolve(null);
	let url = '';
	try {
		const cdnRoot = source.match(/^(https:\/\/cdn\.jsdelivr\.net\/gh\/the-starters\/starters-webflow@[^/]+\/)/);
		url = cdnRoot
			? `${cdnRoot[1]}utils/workflow-diagnostics.js`
			: new URL('utils/workflow-diagnostics.js', source).href;
	} catch (_) {
		return Promise.resolve(null);
	}
	window.__startersWorkflowDiagnosticsReady = new Promise((resolve) => {
		const script = document.createElement('script');
		let settled = false;
		const finish = (api) => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			resolve(api || null);
		};
		const timer = window.setTimeout(() => finish(null), WORKFLOW_DIAGNOSTICS_TIMEOUT_MS);
		script.src = url;
		script.async = false;
		script.addEventListener('load', () => finish(window.StartersWorkflowDiagnostics), { once: true });
		script.addEventListener('error', () => finish(null), { once: true });
		(document.head || document.documentElement).appendChild(script);
	});
	return boundedWorkflowDiagnostics(window.__startersWorkflowDiagnosticsReady);
}

const workflowDiagnosticsReady = loadWorkflowDiagnostics();

function workflowDiagnostics() {
	return window.StartersWorkflowDiagnostics || null;
}

function recordProfileDiagnostic(receipt, fields) {
	const api = workflowDiagnostics();
	if (!api) return null;
	return api.record(receipt ? api.complete(receipt, fields || {}) : api.create({
		workflow: PROFILE_WORKFLOW,
		controller_version: PROFILE_CONTROLLER_VERSION,
		resource_type: 'profile',
		...(fields || {}),
	}));
}

function decorateProfileFeedback(modalName, receipt) {
	// Diagnostics are console-only. The authored modal owns its message and markup.
	return receipt;
}

function openProfileFeedback(modalName, trigger) {
	const modalApi = window.lumos?.modal;
	if (typeof modalApi?.open === 'function') {
		modalApi.open(modalName);
		return;
	}

	trigger?.dispatchEvent(new Event('click', { bubbles: true }));
}

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

const STEP_VALIDATION_CONTRACT = Object.freeze({
	1: [
		{ selector: '[name="first-name"]', kind: 'native' },
		{ selector: '[name="last-name"]', kind: 'native' },
		{ selector: '[name="email"]', kind: 'native' },
		{ selector: '[name="phone"]', kind: 'native' },
		{ selector: '[name="country"]', kind: 'nativeConditional' },
		{ selector: '[name="state"]', kind: 'nativeConditional' },
		{ selector: '[name="city"]', kind: 'nativeConditional' },
		{ selector: '#profile-photo-url', kind: 'mirror', focusSelector: '[data-profile-photo-input], input[type="file"]' },
		{ selector: '#function-required', kind: 'mirror', focusSelector: '[name="function-option"], [fs-list-instance="function"] input' },
		{ selector: '#roles-required', kind: 'mirror', profileTypes: ['full'], focusSelector: '[name="role-option"], [fs-list-instance="roles"] input' },
		{ selector: '#subcategories-required', kind: 'mirror', profileTypes: ['consult'], focusSelector: '[name="subcategories-option"], [fs-list-instance="subcategories"] input' },
	],
	2: [
		{ selector: '#tagline', kind: 'native' },
		{ selector: '#pro-headline', kind: 'native' },
		{ selector: '#bio-html', kind: 'mirror', focusSelector: '.ql-editor, [contenteditable="true"]' },
	],
	5: [
		{ selector: '#skills-required', kind: 'mirror', profileTypes: ['full'], focusSelector: '[name="skill-option"], [fs-list-instance="skills"] input' },
		{ selector: '#tools-required', kind: 'mirror', profileTypes: ['full'], focusSelector: '[name="tool-option"], [fs-list-instance="tools"] input' },
	],
	6: [
		{ selector: '[name="rate"]', kind: 'nativeConditional' },
		{ selector: '[data-input-capture][required]', kind: 'nativeGroup' },
		{ selector: '#availability-required', kind: 'mirror', profileTypes: ['full'], focusSelector: '[name="availability-option"], [fs-list-instance="availability"] input' },
	],
	7: [
		{
			selector: '[name="reviewer"]',
			optionalSelectors: ['[name="reviewer-2"]', '[name="reviewer-3"]'],
			kind: 'reviewerTuple',
			focusSelector: '[name^="reviewer-fname"], [id^="reviewer-fname"]',
		},
	],
});

function ruleApplies(rule) {
	if (!rule.profileTypes?.length) return true;
	return rule.profileTypes.includes(window.activeProfile?.type || '');
}

function nonEmptyValue(field) {
	if (Array.isArray(field?.value)) return field.value.length > 0;
	return String(field?.value ?? '').trim() !== '';
}

function validationFailure(code, rule, element = null) {
	return { code, rule, element };
}

function validateReviewerTuple(rule, step) {
	const failures = [];
	for (const selector of [rule.selector, ...(rule.optionalSelectors || [])]) {
		const field = qs(selector, step);
		if (!field) {
			if (selector === rule.selector) {
				failures.push(validationFailure('MARKUP_CONTRACT_MISSING', { ...rule, selector }));
			}
			continue;
		}

		const rawValue = String(field.value ?? '').trim();
		if (!rawValue) continue;

		let reviewer = null;
		try {
			reviewer = JSON.parse(rawValue);
		} catch (_) {
			failures.push(validationFailure('REVIEWER_TUPLE_INVALID', { ...rule, selector }, field));
			continue;
		}

		const started = reviewer && typeof reviewer === 'object' && Object.values(reviewer).some((value) => String(value ?? '').trim());
		if (started && (!String(reviewer.fname ?? '').trim() || !String(reviewer.email ?? '').trim())) {
			failures.push(validationFailure('REVIEWER_TUPLE_INCOMPLETE', { ...rule, selector }, field));
		}
	}
	return failures;
}

function validateOwnedStep(stepIndex, { report = false } = {}) {
	const step = stepElement(stepIndex);
	if (!step) {
		return {
			valid: false,
			failures: [validationFailure('MARKUP_CONTRACT_MISSING', { selector: `[data-form="step"][data-index="${stepIndex}"]` })],
		};
	}

	const rules = STEP_VALIDATION_CONTRACT[stepIndex];
	if (!rules) {
		return { valid: false, failures: [validationFailure('UNOWNED_STEP', { selector: '' })] };
	}
	if (!['full', 'consult'].includes(window.activeProfile?.type || '')) {
		return { valid: false, failures: [validationFailure('PROFILE_NOT_READY', { selector: '' })] };
	}

	const failures = [];
	rules.filter(ruleApplies).forEach((rule) => {
		if (rule.kind === 'reviewerTuple') {
			failures.push(...validateReviewerTuple(rule, step));
			return;
		}

		if (rule.kind === 'nativeGroup') {
			qsa(rule.selector, step).forEach((field) => {
				if (!field.disabled && typeof field.checkValidity === 'function' && !field.checkValidity()) {
					failures.push(validationFailure('NATIVE_VALIDATION', rule, field));
				}
			});
			return;
		}

		const field = qs(rule.selector, step);
		if (!field) {
			failures.push(validationFailure('MARKUP_CONTRACT_MISSING', rule));
			return;
		}

		if (rule.kind === 'mirror') {
			if (!nonEmptyValue(field)) failures.push(validationFailure('MIRROR_VALUE_MISSING', rule, field));
			return;
		}

		if (field.disabled) return;
		if (rule.kind === 'native' && !field.required) {
			failures.push(validationFailure('MARKUP_CONTRACT_INVALID', rule, field));
			return;
		}
		if (rule.kind === 'nativeConditional' && !field.required) return;
		if (typeof field.checkValidity === 'function' && !field.checkValidity()) {
			failures.push(validationFailure('NATIVE_VALIDATION', rule, field));
		}
	});

	if (report && failures.length) {
		const failure = failures[0];
		const visibleControl = failure.rule.focusSelector ? qs(failure.rule.focusSelector, step) : null;
		const reportTarget = visibleControl || failure.element;
		if (failure.code === 'NATIVE_VALIDATION') reportTarget?.reportValidity?.();
		else reportTarget?.focus?.();
	}

	return { valid: failures.length === 0, failures };
}

window.StartersStarterEditProfile = Object.assign(window.StartersStarterEditProfile || {}, {
	validatePersonalDetails(options = {}) {
		return validateOwnedStep(1, options);
	},
	authorizePersonalDetailsReplay,
	clearPersonalDetailsReplay,
});

function handleCustomSelects() {
	if (typeof window.handleCustomSelects === 'function') {
		window.handleCustomSelects();
	}
}

// Inline block 1
onDomReady(function () {
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

		/* METHODS */
		function applyProfileTypeVisibility(type) {
			if (!type) return;

			qsa('[data-label-type]').forEach((label) => {
				const labelType = label.dataset.labelType;
				label.style.display = labelType === type ? 'block' : 'none';
			});

			qsa('[data-group-hide]').forEach((group) => {
				const hideForType = group.dataset.groupHide;
				group.style.display = hideForType === type ? 'none' : 'block';
			});

			qsa('[data-call-rate-radio]').forEach((group) => {
				const checkForType = group.dataset.callRateRadio;
				if (checkForType === type) {
					group.click();
				}
			});

			qsa('[data-paid-group-reverse]').forEach(group => {
				const checkForType = group.dataset.paidGroupReverse;
				group.style.flexDirection = checkForType === type ? 'column-reverse' : 'column';
			});

			qsa('[data-non-required]').forEach(input => {
				const checkForType = input.dataset.nonRequired;
				input.required = checkForType === type ? false : true;
			});
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

			7: {
				Reviewers: 'reviewer',
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
					const replayProof = stepIndex === 1 ? takePersonalDetailsReplay(form) : null;
					try {
						const validation = validateOwnedStep(stepIndex, { report: true });
						if (!validation.valid) {
							await workflowDiagnosticsReady;
							recordProfileDiagnostic(null, {
								result: 'failed',
								stage: 'validation',
								error_code: validation.failures[0]?.code || 'VALIDATION_FAILED',
								request_started: false,
							});
							return;
						}

						await submitStep(stepIndex, submitButton, replayProof);
					} finally {
						rejectReplayProof(replayProof);
					}
				});
			});
		}

		async function submitStep(stepIndex, submitButton, replayProof = null) {
			setSubmitLoading(submitButton, true);
			let memberScope;
			try {
				memberScope = await captureMemberScope();
				if (!replayProofMatches(memberScope, replayProof)) throw memberScopeChangedError();
			} catch (error) {
				rejectReplayProof(replayProof);
				await workflowDiagnosticsReady;
				const diagnostic = recordProfileDiagnostic(null, {
					result: 'failed',
					stage: 'auth',
					error_code: error?.code || 'MEMBER_LOOKUP_FAILED',
					request_started: false,
				});
				decorateProfileFeedback('edit-form-error', diagnostic);
				openProfileFeedback('edit-form-error', openErrorModal);
				setSubmitLoading(submitButton, false);
				return;
			}
			await workflowDiagnosticsReady;

			const payload = getStepPayload(stepIndex);

			normalizeOptionalCanonicalRates(payload, stepIndex);

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
					console.warn('[starter-edit-profile] ignored an invalid structured form field');
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

			// Reviewers. The native increment-dropdown component stores each slot as
			// JSON in reviewer, reviewer-2, and reviewer-3 hidden fields. Keep the
			// same canonical shape as the Build Profile writer.
			if (Object.prototype.hasOwnProperty.call(payload, 'Reviewers')) {
				const formData = getFormDataObject();
				const normalizeReviewer = (reviewer) => {
					if (!reviewer?.fname || !reviewer?.email) return null;

					return {
						'first-name': reviewer.fname || '',
						'last-name': reviewer.lname || '',
						position: reviewer.job || '',
						company: reviewer.company || '',
						email: reviewer.email || '',
					};
				};

				payload.Reviewers = {
					'reviewer-1': normalizeReviewer(parseJson(formData.reviewer)),
					'reviewer-2': normalizeReviewer(parseJson(formData['reviewer-2'])),
					'reviewer-3': normalizeReviewer(parseJson(formData['reviewer-3'])),
				};
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
				console.warn(`[starter-edit-profile] step ${stepIndex} has no owned fields`);
				recordProfileDiagnostic(null, {
					result: 'failed',
					stage: 'validation',
					error_code: 'EMPTY_STEP_PAYLOAD',
					request_started: false,
				});
				setSubmitLoading(submitButton, false);
				return;
			}

			// if (!localStorage.getItem('editSubmit') || localStorage.getItem('editSubmit') !== 'true') {
			// 	console.log(`Step ${stepIndex} submit skipped (disabled by localStorage).`);
			// 	setTimeout(() => {
			// 		setSubmitLoading(submitButton, false);
			// 	}, 1000);
			// 	return;
			// }

			const startedAt = Date.now();
			let responseStatus = null;
			let requestStarted = false;
			let failureCode = 'NETWORK_ERROR';
			let diagnostic = recordProfileDiagnostic(null, {
				result: 'started',
				stage: 'request',
				request_started: false,
			});

			try {
				const currentMember = await revalidateMemberScope(memberScope);
				if (!replayProofMatches({ ...memberScope, member: currentMember }, replayProof)) {
					throw memberScopeChangedError();
				}
			} catch (error) {
				rejectReplayProof(replayProof);
				diagnostic = recordProfileDiagnostic(diagnostic, {
					result: 'failed',
					stage: 'auth',
					error_code: error?.code || 'MEMBER_LOOKUP_FAILED',
					request_started: false,
				});
				decorateProfileFeedback('edit-form-error', diagnostic);
				openProfileFeedback('edit-form-error', openErrorModal);
				setSubmitLoading(submitButton, false);
				return;
			}

			try {
				acceptReplayProof(replayProof);
				requestStarted = true;
				const response = await fetch(`${PATCH_ENDPOINT}${memberScope.member.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});

				responseStatus = response.status;
				const result = await response.json().catch(() => null);
				if (!response.ok) {
					failureCode = 'HTTP_ERROR';
					throw new Error(result?.message || result?.error || `Profile update failed (${response.status})`);
				}

				// update Member customFields, if even one of them was changed
				if (stepIndex === 1) {
					if (
						memberScope.member.customFields?.['free-user']?.toLowerCase().trim() !== (payload['First_Name'] || '').toLowerCase().trim() ||
						memberScope.member.customFields?.['last-name']?.toLowerCase().trim() !== (payload['Last_Name'] || '').toLowerCase().trim() ||
						memberScope.member.customFields?.['phone']?.toLowerCase().trim() !== (payload['Phone'] || '').toLowerCase().trim()
					) {
						try {
							await revalidateMemberScope(memberScope);
							await memberScope.client.updateMember({
								customFields: {
									'free-user': payload.First_Name || '',
									'last-name': payload.Last_Name || '',
									'phone': payload.Phone || '',
								}
							});
						} catch (error) {
							if (error?.code === 'MEMBER_SCOPE_CHANGED') throw error;
							console.warn('[starter-edit-profile] Memberstack profile projection failed');
						}
					}
				}

				diagnostic = recordProfileDiagnostic(diagnostic, {
					result: 'success',
					stage: 'response',
					http_status: responseStatus,
					duration_ms: Date.now() - startedAt,
					request_started: true,
					resource_id: result?.id || result?.profile_id || window.activeProfile?.id || '',
				});
				decorateProfileFeedback('edit-form-success', diagnostic);
				openProfileFeedback('edit-form-success', openSuccessModal);
			} catch (error) {
				const authChanged = error?.code === 'MEMBER_SCOPE_CHANGED';
				diagnostic = recordProfileDiagnostic(diagnostic, {
					result: 'failed',
					stage: authChanged ? 'auth' : responseStatus === null ? 'network' : 'response',
					error_code: authChanged ? error.code : failureCode,
					http_status: responseStatus,
					duration_ms: Date.now() - startedAt,
					request_started: requestStarted,
				});
				decorateProfileFeedback('edit-form-error', diagnostic);
				openProfileFeedback('edit-form-error', openErrorModal);
				console.error(`[starter-edit-profile] step ${stepIndex} submit failed`, {
					diagnostic_id: diagnostic?.diagnostic_id || '',
					error_code: diagnostic?.error_code || 'WORKFLOW_ERROR',
				});
			} finally {
				setSubmitLoading(submitButton, false);
			}
		}

		// Optional rate controls clear their visible values when their owning toggle is
		// off, so the canonical integer contract needs the existing zero sentinel instead
		// of a blank string. A rate whose control is live stays blank so an empty value
		// keeps failing instead of silently persisting a zero rate.
		const OPTIONAL_CANONICAL_RATES = Object.freeze([
			{ field: 'Hourly_Rate', isOptional: (payload, step) => qs('[name="rate"]', step)?.required === false },
			{ field: 'Paid_Call_Rate', isOptional: (payload) => payload.Paid_Call_Enabled === false },
			{ field: 'Retainer_Rate', isOptional: (payload) => payload.Retainer_Enabled === false },
		]);

		function normalizeOptionalCanonicalRates(payload, stepIndex) {
			const step = stepElement(stepIndex);

			OPTIONAL_CANONICAL_RATES.forEach(({ field, isOptional }) => {
				if (!Object.prototype.hasOwnProperty.call(payload, field)) return;
				if (String(payload[field] ?? '').trim() !== '') return;
				if (!isOptional(payload, step)) return;

				payload[field] = 0;
			});
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

			// A rich-text editor in this group owns its own counter: the textarea is a
			// mirror, so counting it here would fight the editor script over the span.
			// Claimed on the way out so a later re-scan skips it without re-checking.
			if (qs('[data-editor-id]', wrapper)) {
				input.classList.add('initialized');
				return;
			}

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

	onDomReady(() => counterFields());

// Inline block 3
// Bio length contract: CHARACTERS, not words. The limit reads `data-max-chars` on
// `#bio-plain` and defaults to 1500. A character is one code unit of the Quill plain
// text with the single trailing newline stripped, so newlines inside the bio count.
// The limit governs growth: a bio saved under the old 300-word cap is grandfathered
// and can be edited down, but not up. This block also owns the bio counter UI.
// v3/build-profile/bio-editor.js carries the same implementation, function for
// function, for the Build Profile surface; bio-char-limit.test.js pins that parity.
onDomReady(() => {
		const outputPlain = qs('#bio-plain');
		const outputHtml = qs('#bio-html');
		if (!outputHtml || !outputPlain) return;

		const LOG_PREFIX = '[starter-edit-profile]';
		const MAX_CHARS = Number(outputPlain.dataset.maxChars) || 1500;
		const DENOMINATOR_PATTERN = /^(\s*)\/\d+(\s*)$/;
		let isCleaning = false;
		let prevContents = null;
		let prevCharCount = 0;

		// Counter takeover: this block, not field-counters.js, owns this counter group.
		outputPlain.removeAttribute('count-by-words');

		const counterWrapper = outputPlain.closest('.form_input-wr');
		const counterSpan = counterWrapper ? qs('.count-input', counterWrapper) : null;

		setCounterDenominator(counterSpan, MAX_CHARS);

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

				// A saved bio may exceed MAX_CHARS under the old word cap. Restore it
				// intact: silence enforcement across the write, flush Quill's pending
				// mutation, and adopt the restored document as the baseline. Without
				// the flush, text-change fires later against the pre-restore baseline
				// and reverts the member's own bio to empty.
				isCleaning = true;
				try {
					bioEditor.root.innerHTML = html;
					bioEditor.update();
				} finally {
					prevContents = bioEditor.getContents();
					prevCharCount = getQuillCharCount(bioEditor);
					// The restore is not a member edit; undo must not cross it.
					bioEditor.history?.clear?.();
					isCleaning = false;
				}

				syncQuillValue();
			}
		});

		prevContents = bioEditor.getContents();
		prevCharCount = getQuillCharCount(bioEditor);

		bioEditor.root.addEventListener('paste', handleQuillPaste);

		bioEditor.on('text-change', () => {
			if (isCleaning) return;

			const charCount = getQuillCharCount(bioEditor);

			// Growth is what the limit governs. An over-limit legacy bio stays editable
			// downward, so only an edit that raises the count while over is reverted.
			if (charCount > MAX_CHARS && charCount > prevCharCount) {
				const selection = bioEditor.getSelection();

				isCleaning = true;

				try {
					bioEditor.setContents(prevContents, 'silent');

					if (selection) {
						const safeIndex = Math.min(
							Math.max(selection.index - 1, 0),
							bioEditor.getLength() - 1
						);

						bioEditor.setSelection(safeIndex, 0, 'silent');
					}
				} finally {
					isCleaning = false;
				}

				prevContents = bioEditor.getContents();
				prevCharCount = getQuillCharCount(bioEditor);

				syncQuillValue();
				return;
			}

			// The baseline must advance synchronously: a burst of keystrokes fires
			// several text-change events before one animation frame runs, and a revert
			// that restores a stale snapshot would drop keystrokes that were accepted.
			prevContents = bioEditor.getContents();
			prevCharCount = charCount;

			requestAnimationFrame(() => {
				syncQuillValue();
			});
		});

		function handleQuillPaste(event) {
			// An empty text/plain means a rich-only clipboard; let the text-change
			// revert catch any overflow instead of guessing at the payload here.
			const pastedText = normalizeCountText(event.clipboardData?.getData('text/plain') || '');
			if (!pastedText.trim()) return;

			const range = bioEditor.getSelection(true);
			if (!range) return;

			const currentText = bioEditor.getText();

			const before = currentText.slice(0, range.index);
			const after = currentText.slice(range.index + range.length);

			const baseCharCount = countCharsFromText(stripTrailingNewline(before + after));

			// Budget against the same growth rule the text-change gate applies, not
			// against MAX_CHARS alone. A grandfathered bio may not grow past its own
			// size, but replacing a long selection with a shorter paste shrinks it,
			// which the typing path allows and this path must not refuse. The count is
			// of the WHOLE document, taken before the selection is subtracted out, so
			// for a bio within the limit the ceiling is exactly MAX_CHARS.
			const currentDocCount = countCharsFromText(stripTrailingNewline(currentText));
			const ceiling = Math.max(MAX_CHARS, currentDocCount);
			const availableChars = ceiling - baseCharCount;

			// Load-bearing: slice() with a negative end counts from the right, so an
			// already-full editor would keep the tail of the paste instead of nothing.
			if (availableChars <= 0) {
				event.preventDefault();
				return;
			}

			if (pastedText.length <= availableChars) {
				return;
			}

			event.preventDefault();

			const allowedPaste = dropSplitSurrogate(pastedText.slice(0, Math.max(availableChars, 0)));
			if (!allowedPaste) return;

			isCleaning = true;

			try {
				if (range.length > 0) {
					bioEditor.deleteText(range.index, range.length, 'silent');
				}

				bioEditor.insertText(range.index, allowedPaste, 'silent');

				const newCursorPosition = range.index + allowedPaste.length;
				bioEditor.setSelection(newCursorPosition, 0, 'silent');
			} finally {
				isCleaning = false;
			}

			syncQuillValue();

			prevContents = bioEditor.getContents();
			prevCharCount = getQuillCharCount(bioEditor);
		}

		function stripTrailingNewline(text) {
			return (text || '').replace(/\n$/, '');
		}

		function getPlainQuillText(quillInstance) {
			return stripTrailingNewline(quillInstance.getText());
		}

		// A clipboard newline is CRLF on Windows. Collapsing it keeps one line break
		// worth one character and keeps a stray \r out of the saved bio. Quill's own
		// text never contains \r, so this is a no-op for everything else.
		function normalizeCountText(text) {
			return (text || '')
				.replace(/\uFEFF/g, '')
				.replace(/\r\n?/g, '\n')
				.replace(/\u00A0/g, ' ');
		}

		function countCharsFromText(text) {
			return normalizeCountText(text).length;
		}

		function getQuillCharCount(quillInstance) {
			return countCharsFromText(getPlainQuillText(quillInstance));
		}

		// slice() counts UTF-16 code units, so a cut can land inside an astral
		// character such as an emoji. A trailing high surrogate has lost its pair.
		function dropSplitSurrogate(text) {
			return /[\uD800-\uDBFF]$/.test(text) ? text.slice(0, -1) : text;
		}

		function setCounterDenominator(span, maxChars) {
			if (!span) {
				warnAuthoring('no .count-input in the bio field wrapper; the counter is unowned');
				return;
			}

			const denominator = span.nextSibling;
			const authored = denominator && denominator.nodeType === 3 ? denominator.nodeValue || '' : '';

			if (!DENOMINATOR_PATTERN.test(authored)) {
				warnAuthoring('the bio counter denominator is not an authored "/<number>" text node');
				return;
			}

			denominator.nodeValue = authored.replace(DENOMINATOR_PATTERN, `$1/${maxChars}$2`);
		}

		// Authoring drift is silent by design in production: a missing counter must
		// never break the editor. Staging and an explicit debug flag still say so.
		function warnAuthoring(message) {
			const host = (window.location || {}).hostname || '';
			const staging = /(\.|^)webflow\.io$/.test(host) ||
				host === 'localhost' ||
				host === '127.0.0.1' ||
				/(\.|^)trycloudflare\.com$/.test(host);

			if (!staging && window.STARTERS_DEBUG !== true) return;

			try {
				console.warn(LOG_PREFIX + ' ' + message);
			} catch (error) {}
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
			const plain = getPlainQuillText(bioEditor);

			outputPlain.value = plain;
			outputPlain.dispatchEvent(new Event('change', { bubbles: true }));
			outputPlain.dispatchEvent(new Event('input', { bubbles: true }));

			outputHtml.value = getCleanQuillHTML(bioEditor);
			outputHtml.dispatchEvent(new Event('change', { bubbles: true }));
			outputHtml.dispatchEvent(new Event('input', { bubbles: true }));

			// Last write wins: any counter listener reacting to the events above
			// counts the textarea value, which is only ever the plain-text mirror.
			if (counterSpan) {
				counterSpan.textContent = String(countCharsFromText(plain)).padStart(2, '0');
			}
		}

		syncQuillValue();
	});

// Inline block 4
onDomReady(function () {
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
onDomReady(function () {
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
onDomReady(() => {
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
})();
