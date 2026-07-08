/* freelancer-edit-form.js — extracted from V2 secure footer (freelancer-edit-form-footer.html).
   Load via: <script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v2/footers/freelancer-edit-form.js"></script>
   Source of truth: product-workflows/opportunities/webflow/v2/webflow-footer-code/secure/freelancer-edit-form-footer.html */

	document.addEventListener("DOMContentLoaded", function () {
		/* Video - max 40mb size */
		const profile_video_blob = document.querySelector('#profile-video-blob');
		if (profile_video_blob) {
			profile_video_blob.size = 40 * 1024 * 1024; // 40MB
		}

		let airtable_id = null,
			member_id = null,
			bio_editor = null,
			case_study_editor_1 = null,
			case_study_editor_2 = null,
			case_study_editor_3 = null;

		const devMode = localStorage.getItem('dev-mode') === 'true';
		const XANO_LEGACY_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:ZihCUE3Z';

		async function callLegacyEndpoint(path, body) {
			const response = await fetch(`${XANO_LEGACY_BASE}/${path}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			const data = await response.json().catch(() => null);
			if (!response.ok) {
				throw new Error(data?.message || `Request failed: ${response.status}`);
			}
			// Funnel events (platform-ops/architecture/posthog-funnel-events-plan.md):
			// fires only on bridge success; StartersTrack loads from the site head.
			const trackedEvent = {
				'legacy/opportunities/apply': 'application_submitted',
				'legacy/opportunities/close': 'opportunity_closed',
				'legacy/freelancer-profile/update-request': 'profile_updated',
			}[path];
			if (trackedEvent && window.StartersTrack) {
				window.StartersTrack.track(trackedEvent, {
					opportunity_id: (body && body.opportunity_id) || undefined,
				});
			}
			return data;
		}

		/* Getting airtable_id from Memberstack */
		window.$memberstackDom.getCurrentMember().then(({ data: member }) => {
			if (!member || !member.id) {
				window.location.href = "/login";
				return;
      }

      /* ONBOARDING */
      if (!member.customFields['completed-starter-profile']) {

        /* If onboarding is not completed */
        if (member.loginRedirect.includes('/starter-onboarding/step-')) {
          window.location.replace(member.loginRedirect);
        } else {
          window.location.replace('/starter-onboarding/step-1');
        }

      }

			member_id = member.id;
			airtable_id = member.customFields['airtable-id'];
		});

		/* Waiting for CMS items to load */
		window.fsAttributes = window.fsAttributes || [];
		window.fsAttributes.push([
			'cmsload',
			(listInstances) => {
				customSelectsInit();

				const airtable_id_check = setInterval(() => {
					if (airtable_id) {
						clearInterval(airtable_id_check);
						initScripts();
					}
				}, 250);
			},
		]);

		function initScripts() {

			// getting form fields
			const dom_fields = getAllFields();

			const form = dom('#free-edit-form');

			if (form) {
				let is_disabled = false;

				const formSubmitButton = form.querySelector('#free-edit-submit');
				formSubmitButton.addEventListener('click', (event) => {
					if (is_disabled) return;

					event.preventDefault();

					const form_data = new FormData(form);
					const data = Object.fromEntries(form_data.entries());

					// remove technical fields
					delete data['profile-photo-blob'];
					delete data['profile-video-blob'];
					delete data['industries-select'];
					delete data['skills-select'];
					delete data['tools-select'];
					delete data['partner-tools-select'];

					if (devMode) {
						let rawData = { ...data }
						console.log("Raw form data: ", rawData);
					}

					// select fields convert to arrays
					data.function = data.function ? data.function.split(",") : [];
					data.role = data.role ? data.role.split(",") : [];
					data["secondary-role"] = data["secondary-role"] ? data["secondary-role"].split(",") : [];
					data["tertiary-role"] = data["tertiary-role"] ? data["tertiary-role"].split(",") : [];
					data["service-1"] = data["service-1"] ? data["service-1"].split(",") : [];
					data["service-2"] = data["service-2"] ? data["service-2"].split(",") : [];
					data["service-3"] = data["service-3"] ? data["service-3"].split(",") : [];
					data["industries"] = data["industries"] ? data["industries"].split(",") : [];
					data["skills"] = data["skills"] ? data["skills"].split(",") : [];
					data["tools"] = data["tools"] ? data["tools"].split(",") : [];
					data["partner-tools"] = data["partner-tools"] ? data["partner-tools"].split(",") : [];

					// editors
					data['bio'] = htmlToAirtableMarkdown(dom_fields.bio_editor.root.innerHTML);
					data['case-study-1-content'] = htmlToAirtableMarkdown(dom_fields.case_study_editor_1.root.innerHTML);
					data['case-study-2-content'] = htmlToAirtableMarkdown(dom_fields.case_study_editor_2.root.innerHTML);
					data['case-study-3-content'] = htmlToAirtableMarkdown(dom_fields.case_study_editor_3.root.innerHTML);

					// profile photo
					if (data["profile-photo-from-edit"]) {
						data["profile-photo-from-edit"] = JSON.parse(data["profile-photo-from-edit"]);
					}

					// profile video
					let is_video_file = false;
					const profile_video_blob = document.getElementById('profile-video-blob');
					if (profile_video_blob.files.length) {
						is_video_file = true;
						data["profile-video-from-edit"] = "true"; // flag for Make scenario
					}

					/* DEBUGGER */
					if (devMode && prompt("DEBUGGER: Warning! Beta-testing with Live tables. Are you sure you want to submit these changes? (Type '1' to confirm)") !== "1") {
						console.warn("Changes not submitted");
						console.log("Prepared form data:", data);
						return;
					}
					/* DEBUGGER */

					/* Checking form validity */
					if (!form.checkValidity()) {
						form.reportValidity();
						return;
					}

					if (!devMode) {
						/* Disable form submitting. is_disabled is the double-submit
						   guard: it is set synchronously here — before the bridge POST
						   and before any await — so a mouse double-click's second event
						   returns at the top (if (is_disabled) return). Disable the
						   button too so it can't be re-clicked. See
						   bridge-reliability-standards.md (2026-07-07). */
						is_disabled = true;
						formSubmitButton.style.pointerEvents = 'none';
						formSubmitButton.style.opacity = '0.5';

						/* Show Preloader */
						if (!devMode) setPreloader(true);
					}

					// Send profile edit request through Xano so the Make webhook stays server-side.
					callLegacyEndpoint('legacy/freelancer-profile/update-request', {
						member_id,
						data
					})
						.then(data => {
							if (devMode) console.log('API data sent!', data);
							console.log("Response from webhook: ", data);
							let delay = 0;

							if (is_video_file) {
								videoHandler(data.record_id, profile_video_blob.files[0]);
								delay = 1000;
							}

							setTimeout(() => {
								/* Hide Preloader */
								setPreloader(false);

								/* Show Success Block */
								successFormView();
							}, delay);

						})
						.catch(err => {
							// Re-enable so a failed submit can be retried — the
							// is_disabled guard would otherwise lock the form until reload.
							is_disabled = false;
							formSubmitButton.style.pointerEvents = '';
							formSubmitButton.style.opacity = '';
							setPreloader(false);
							console.error('Error:', err);
						});

				});

				function successFormView() {
					form.style.display = 'none';
					const success_message = dom('.success-message-wrapper.w-form-done');
					if (success_message) {
						success_message.style.display = 'block';
					}
				}


				/* PROFILE VIDEO HANDLER */
				function videoHandler(record_id, file) {
					if (!record_id) {
						console.error("No record_id returned from webhook!");
						return;
					}

					const profile_video_id = document.getElementById('profile-video-id');
					if (file && profile_video_id) {
						const form_data = new FormData();
						form_data.append('agency_video', file);
						form_data.append('record_id', record_id);
						form_data.append('member_id', member_id);

						// if there is an profile video, pass its ID to replace it
						if (profile_video_id.value !== '') {
							form_data.append('profile_video_id', profile_video_id.value);
						}

						fetch(`${XANO_LEGACY_BASE}/legacy/freelancer-profile/upload-video`, {
							method: 'POST',
							body: form_data
						})
							.then(res => {
								if (res.ok) {
									return res.json();
								} else {
									throw new Error(`Request failed: ${res}`);
								}
							})
							.then(data => {
								console.log("Response from video uploading webhook: ", data);
							})
							.catch(err => console.error('Error:', err));
					}
				}
				/* END - PROFILE VIDEO HANDLER */

			}

			// Getting Starter Profile record through Xano so Airtable credentials stay server-side.
			return callLegacyEndpoint('legacy/freelancer-profile/get', {
				member_id,
				airtable_id
			}).then(function (data) {
				if (!data) {
					console.warn("No record found for this `airtable-id`:", airtable_id);
					return null;
				}

				if (devMode) {
					console.log(data.fields);
				}

				/* helpers */
				function activeRadio(input) {
					input.checked = true;
					input.previousElementSibling.classList.add('w--redirected-checked');
				}

				function fieldMarkdown(name) {
					return String(fields[name] || '').trim();
				}

				function multiselectPopulate(data, selectElement) {
					data.forEach(id => {
						const option = selectElement.querySelector(`option[value="${id}"]`);
						if (option) {
							selectElement.value = option.value;
							selectElement.dispatchEvent(new Event('change'));
						}
					});
				}

				function hideUnnecessaryInputs(wrappers) {
					if (!wrappers.length) return;

					wrappers.forEach(wrapper => {
						// Hide the inputs
						wrapper.style.display = 'none';

						// Make inputs not required
						const radioButtons = wrapper.querySelectorAll('[required]');
						radioButtons.forEach(radio => {
							radio.required = false;
						});
					});
				}

				// populating fields
				const fields = data.fields;

				dom_fields.starter_id.value = airtable_id;
				dom_fields.first_name.value = fields['First_Name'] || '';
				dom_fields.last_name.value = fields['Last_Name'] || '';
				dom_fields.agency_name.value = fields['Agency Name'] || '';
				dom_fields.team_size.value = fields['Team Size'] || '';
				dom_fields.agency_video_link.value = fields['Agency Video Link'] || '';
				dom_fields.profile_video_id.value = fields['Agency Video ID'] || '';
				dom_fields.linkedin.value = fields['LinkedIn_URL'] || '';
				dom_fields.portfolio_url.value = fields['Personal Portfolio'] || '';
				dom_fields.location.value = fields['Location'] || '';
				dom_fields.rate.value = fields['Rate'] || '';
				dom_fields.paid_call_rate.value = fields['Paid Consulting Call Rate'] || '';
				dom_fields.monthly_retainer_desc.value = fields['Monthly Retainer Description'] || '';
				dom_fields.monthly_retainer_price.value = fields['Monthly Retainer Price'] || '';
				dom_fields.service_desc_1.value = fields['Service 1 Description'] || '';
				dom_fields.service_desc_2.value = fields['Service 2 Description'] || '';
				dom_fields.service_desc_3.value = fields['Service 3 Description'] || '';
				dom_fields.service_price_1.value = fields['Service 1 Price'] || '';
				dom_fields.service_price_2.value = fields['Service 2 Price'] || '';
				dom_fields.service_price_3.value = fields['Service 3 Price'] || '';
				dom_fields.company_exp_1.value = fields['Company_Experience_1'] || '';
				dom_fields.company_exp_2.value = fields['Company Experience 2'] || '';
				dom_fields.company_exp_3.value = fields['Company Experience 3'] || '';
				dom_fields.case_title_1.value = fields['Case Study 1 Title'] || '';
				dom_fields.case_title_2.value = fields['Case Study 2 Title'] || '';
				dom_fields.case_title_3.value = fields['Case Study 3 Title'] || '';


				/* Selecting Single Selects */
				dom_fields.contracts_select.value = fields['Contract Types'] ? fields['Contract Types'] : '';
				dom_fields.function_select.value = fields['Function'] ? fields['Function'][0] : '';
				dom_fields.role_select.value = fields['Role'] ? fields['Role'][0] : '';
				dom_fields.role_select_2.value = fields['Secondary Role'] ? fields['Secondary Role'][0] : '';
				dom_fields.role_select_3.value = fields['Tertiary Role'] ? fields['Tertiary Role'][0] : '';
				dom_fields.service_select_1.value = fields['Service 1'] ? fields['Service 1'][0] : '';
				dom_fields.service_select_2.value = fields['Service 2'] ? fields['Service 2'][0] : '';
				dom_fields.service_select_3.value = fields['Service 3'] ? fields['Service 3'][0] : '';

				/* Hiding unnecessary fields if it is an agency */
				let unnecessaryWrapper = null;
				if (fields['Agency?'] && fields['Agency?'].toLowerCase() === 'yes') {
					unnecessaryWrapper = document.querySelectorAll('[hide-if-agency]');

					/* TITLE CHANGES */
					const pageTitle = document.querySelector('[page-title]');
					if (pageTitle) pageTitle.innerText = "Edit Your Agency Profile";

				} else {
					unnecessaryWrapper = document.querySelectorAll('[hide-if-not-agency]');
				}

				hideUnnecessaryInputs(unnecessaryWrapper);

				/* Populating Radio Buttons */
				if (fields["Free Consulting Calls"] && fields["Free Consulting Calls"] === "Yes") {
					activeRadio(dom_fields.free_consulting_yes);
				} else {
					activeRadio(dom_fields.free_consulting_no);
				}

				if (fields["Paid Consulting Calls"] && fields["Paid Consulting Calls"] === "Yes") {
					activeRadio(dom_fields.paid_consulting_yes);
				} else {
					activeRadio(dom_fields.paid_consulting_no);
				}

				if (fields["Monthly Retainers"] && fields["Monthly Retainers"] === "Yes") {
					activeRadio(dom_fields.monthly_retainer_yes);
				} else {
					activeRadio(dom_fields.monthly_retainer_no);
				}

				if (fields['Availability']) {
					if (fields['Availability'] === "1-10") {
						activeRadio(dom_fields.availability_1);
					} else if (fields['Availability'] === "11-20") {
						activeRadio(dom_fields.availability_2);
					} else if (fields['Availability'] === "21-40" || fields['Availability'] === "20-40") {
						activeRadio(dom_fields.availability_3);
					} else if (fields['Availability'] === "41+" || fields['Availability'] === "40+") {
						activeRadio(dom_fields.availability_4);
					}
				}

				if (fields['Full_Time_Work'] && fields['Full_Time_Work'] === "Yes") {
					activeRadio(dom_fields.full_time_yes);
				} else {
					activeRadio(dom_fields.full_time_no);
				}


				/* Populating Editors */
				setTimeout(() => {
					dom_fields.bio_editor.root.innerHTML = airtableMarkdownToHTML(fieldMarkdown('Bio')) || '';
				}, 100);
				setTimeout(() => {
					dom_fields.case_study_editor_1.root.innerHTML = airtableMarkdownToHTML(fieldMarkdown('Case Study 1 Content')) || '';
				}, 150);
				setTimeout(() => {
					dom_fields.case_study_editor_2.root.innerHTML = airtableMarkdownToHTML(fieldMarkdown('Case Study 2 Content')) || '';
				}, 200);
				setTimeout(() => {
					dom_fields.case_study_editor_3.root.innerHTML = airtableMarkdownToHTML(fieldMarkdown('Case Study 3 Content')) || '';
				}, 250);
				setTimeout(() => {
					dom_fields.bio_editor.root.innerHTML = clearDoubleP(dom_fields.bio_editor.root.innerHTML);
					dom_fields.case_study_editor_1.root.innerHTML = clearDoubleP(dom_fields.case_study_editor_1.root.innerHTML);
					dom_fields.case_study_editor_2.root.innerHTML = clearDoubleP(dom_fields.case_study_editor_2.root.innerHTML);
					dom_fields.case_study_editor_3.root.innerHTML = clearDoubleP(dom_fields.case_study_editor_3.root.innerHTML);
				}, 350);


				/* Populating multiselects */
				const industries = fields['Industry Experience'] || [];
				multiselectPopulate(industries, dom_fields.industries_select);

				const skills = fields['Skills'] || [];
				multiselectPopulate(skills, dom_fields.skills_select);

				const tools = fields['Tools'] || [];
				multiselectPopulate(tools, dom_fields.tools_select);

				const partners = fields['Partner Tools'] || [];
				multiselectPopulate(partners, dom_fields.partners_select);

				/* Hiding Preloader */
				setPreloader(false);
			});
		}


		/* METHODS & HELPERS */
		function setPreloader(state = false) {
			const preloader = dom('#preloader');
			if (preloader) preloader.setAttribute('style', `visibility: ${state ? 'visible' : 'hidden'}; opacity: ${state ? 1 : 0}; pointer-events: ${state ? 'auto' : 'none'};`);
		}

		function dom(selector) {
			return document.querySelector(selector);
		}

		function getAllFields() {
			return {
				starter_id: dom('[name="starter-id"]'),
				first_name: dom('[name="first-name"]'),
				last_name: dom('[name="last-name"]'),
				agency_name: dom('[name="agency-name"]'),
				team_size: dom('[name="team-size"]'),
				contracts_select: dom('[name="contract-types"]'),
				agency_video_link: dom('[name="agency-video-link"]'),
				profile_video_id: dom('#profile-video-id'),
				function_select: dom('[name="function"]'),
				role_select: dom('[name="role"]'),
				role_select_2: dom('[name="secondary-role"]'),
				role_select_3: dom('[name="tertiary-role"]'),
				linkedin: dom('[name="linkedin"]'),
				portfolio_url: dom('[name="personal-portfolio-url"]'),
				location: dom('[name="location"]'),
				rate: dom('[name="rate"]'),
				free_consulting_yes: dom('[name="free-consulting-calls"][value="Yes"]'),
				free_consulting_no: dom('[name="free-consulting-calls"][value="No"]'),
				paid_consulting_yes: dom('[name="paid-consulting-calls"][value="Yes"]'),
				paid_consulting_no: dom('[name="paid-consulting-calls"][value="No"]'),
				paid_call_rate: dom('[name="paid-call-rate"]'),
				monthly_retainer_yes: dom('[name="monthly-retainer"][value="Yes"]'),
				monthly_retainer_no: dom('[name="monthly-retainer"][value="No"]'),
				monthly_retainer_desc: dom('[name="monthly-retainer-description"]'),
				monthly_retainer_price: dom('[name="monthly-retainer-price"]'),
				service_select_1: dom('[name="service-1"]'),
				service_select_2: dom('[name="service-2"]'),
				service_select_3: dom('[name="service-3"]'),
				service_desc_1: dom('[name="service-1-description"]'),
				service_desc_2: dom('[name="service-2-description"]'),
				service_desc_3: dom('[name="service-3-description"]'),
				service_price_1: dom('[name="service-1-price"]'),
				service_price_2: dom('[name="service-2-price"]'),
				service_price_3: dom('[name="service-3-price"]'),
				availability_1: dom('[name="availability"][value="1-10"]'),
				availability_2: dom('[name="availability"][value="11-20"]'),
				availability_3: dom('[name="availability"][value="21-40"]'),
				availability_4: dom('[name="availability"][value="41+"]'),
				full_time_yes: dom('[name="full-time-work"][value="Yes"]'),
				full_time_no: dom('[name="full-time-work"][value="No"]'),
				industries_select: dom('[name="industries-select"]'),
				skills_select: dom('[name="skills-select"]'),
				tools_select: dom('[name="tools-select"]'),
				partners_select: dom('[name="partner-tools-select"]'),
				company_exp_1: dom('[name="company-experience-1"]'),
				company_exp_2: dom('[name="company-experience-2"]'),
				company_exp_3: dom('[name="company-experience-3"]'),
				case_title_1: dom('[name="case-study-1-title"]'),
				case_title_2: dom('[name="case-study-2-title"]'),
				case_title_3: dom('[name="case-study-3-title"]'),
				bio_editor: quillEditor('#bio-editor'),
				case_study_editor_1: quillEditor('#case-study-editor-1'),
				case_study_editor_2: quillEditor('#case-study-editor-2'),
				case_study_editor_3: quillEditor('#case-study-editor-3'),
			}
		}

		function htmlToAirtableMarkdown(html) {
			const replacements = [
				{ regex: /<strong>(.*?)<\/strong>/gi, replacement: '**$1**' },
				{ regex: /<b>(.*?)<\/b>/gi, replacement: '**$1**' },
				{ regex: /<em>(.*?)<\/em>/gi, replacement: '_$1_' },
				{ regex: /<i>(.*?)<\/i>/gi, replacement: '_$1_' },
				{ regex: /<h2>(.*?)<\/h2>/gi, replacement: '## $1' },
				{ regex: /<h3>(.*?)<\/h3>/gi, replacement: '### $1' },
				{
					regex: /<ul>(.*?)<\/ul>/gis, replacement: (_, g1) =>
						g1.replace(/<li[^>]*>(.*?)<\/li>/gi, (_, item) => `- ${item.trim()}\n`)
				},
				{
					regex: /<ol>(.*?)<\/ol>/gis, replacement: (_, g1) =>
						g1.replace(/<li[^>]*>(.*?)<\/li>/gi, (_, item) => `- ${item.trim()}\n`)
				},
				{ regex: /<a href="(.*?)".*?>(.*?)<\/a>/gi, replacement: '[$2]($1)' },
				{ regex: /<\/p>\s*<p>/gi, replacement: '\n\n' },
				{ regex: /<\/?p>/gi, replacement: '' }
			];

			let markdown = html;
			for (const { regex, replacement } of replacements) {
				markdown = markdown.replace(regex, replacement);
			}

			// Cleaning up any remaining HTML tags
			markdown = markdown.replace(/<\/?[^>]+(>|$)/g, '');

			// Trimming the final markdown string
			return markdown.trim().replace(/\n{3,}/g, '\n\n');
		}

		function airtableMarkdownToHTML(markdown) {
			if (!markdown) return '';

			const html = markdown
				// Headings: ###, ##
				.replace(/^### (.*)$/gm, '<h3>$1</h3>')
				.replace(/^## (.*)$/gm, '<h2>$1</h2>')

				// Bold text
				.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
				.replace(/__(.*?)__/g, '<strong>$1</strong>')

				// Lists: - item or * item → <ul><li>...</li></ul>
				.replace(/^[\*\-] (.*$)/gim, '<li data-list="bullet">$1</li>')
				.replace(/(<li>.*<\/li>)/gim, '<ol>$1</ol>')

				// Italic
				.replace(/\*(.*?)\*/g, '<em>$1</em>')
				.replace(/_(.*?)_/g, '<em>$1</em>')

				// Lines → paragraphs
				.split('\n')
				.map(line => {
					const trimmed = line.trim();
					// do not wrap already wrapped HTML tags
					if (/^<\w+>.*<\/\w+>$/.test(trimmed)) return trimmed;
					return `<p>${trimmed}</p>`;
				})
				.join('');

			// Remove extra whitespace between tags
			return html
				.replace(/>\s+</g, '><')    // remove whitespace between tags
				.replace(/\n+/g, '')        // remove newlines
				.trim();
		}


		function clearDoubleP(html) {
			return html.replace(/(<p><br><\/p>){2,}/g, '<p><br></p>');
		}

		function quillEditor(id) {
			return new Quill(`${id}`, {
				modules: {
					toolbar: [
						[{ 'header': [2, 3, false] }],
						['bold', 'italic'],
						['link'],
						['clean']
					]
				},
				placeholder: '',
				theme: 'snow'
			});
		}

		function customSelectsInit() {

			/* CUSTOM SELECTS */
			const selects = document.querySelectorAll('[free-edit-select]');
			selects.forEach(select => {
				const parent = select.parentElement;
				const optionsWrapper = parent.querySelector('[free-edit-options-wrap]');

				if (!optionsWrapper) {
					console.warn('No options wrapper found for select:', select);
					return;
				}

				const options = optionsWrapper.querySelectorAll('option');
				if (options.length) {
					const isMultiselect = select.getAttribute('free-edit-select') === 'multiselect';

					// populating
					select.innerHTML = '';
					select.innerHTML = '<option value="">Select...</option>';
					options.forEach(option => {
						select.innerHTML += `<option value="${option.value}">${option.text}</option>`;
					});

					// multiselect handlers
					if (isMultiselect) {
						const labelsWrapper = parent.querySelector('[free-edit-labels-wrap]');
						if (labelsWrapper) {
							select.addEventListener('change', function () {
								if (select.value) {
									select.querySelectorAll('option').forEach(option => {
										if (option.value === select.value) {
											option.disabled = true;

											// create option label
											const isLabel = labelsWrapper.querySelector(`[data-value="${option.value}"]`);
											if (!isLabel) {
												const label = document.createElement('div');
												label.className = 'quiz_radio-group';
												label.setAttribute('data-value', option.value);

												const labelInner = document.createElement('div');
												labelInner.className = 'quiz_radio is-free-edit';

												const labelText = document.createElement('span');
												labelText.className = 'quiz_radio-label is-free-edit';
												labelText.innerHTML = `${option.text}`;
												labelText.innerHTML += `<svg multiselect-option-remove width="1.5rem" height="1.5rem" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 22L22 2M2.00711 2L22.0071 22" stroke="black"/></svg>`;

												labelInner.appendChild(labelText);
												label.appendChild(labelInner);
												labelsWrapper.appendChild(label);

												labelsWrapper.style.display = 'flex';

												const array_input = dom(`[name="${select.name.replace('-select', '')}"]`);
												array_input.value = updateValue();

												const removeIcon = label.querySelector('[multiselect-option-remove]');
												removeIcon.addEventListener('click', function () {
													// remove label
													label.remove();

													// enable option
													option.disabled = false;

													// update input value
													array_input.value = updateValue();

													if (!labelsWrapper.children.length) {
														labelsWrapper.style.display = 'none';
													}
												});

												function updateValue() {
													return Array.from(labelsWrapper.children)
														.map(label => label.getAttribute('data-value'))
														.join(',');
												}

											}

											// reset select value
											select.value = '';
										}
									});
								}
							});
						}
					}

				}
			});
			/* END - CUSTOM SELECTS */
		}

		/* PROFILE IMAGE HANDLER */
		const profile_photo_input = document.getElementById('profile-photo-from-edit');
		const profile_photo_blob = document.getElementById('profile-photo-blob');
		const profile_photo = document.getElementById('profile-photo');
		const profile_photo_remove = document.getElementById('profile-photo-remove');

		profile_photo_blob.addEventListener('change', function () {
			const file = this.files[0];

			if (file) {
				const reader = new FileReader();
				reader.onload = function (e) {
					profile_photo.src = e.target.result;
					profile_photo.style.display = 'block';

					// Store base64 in input
					profile_photo_input.value = JSON.stringify({ "data": e.target.result, "name": file.name, "type": file.type });
				};
				reader.readAsDataURL(file);
			}
		});

		profile_photo_remove.addEventListener('click', function () {
			profile_photo.src = '';
			profile_photo.style.display = 'none';
			profile_photo_input.value = '';
		});
		/* END - PROFILE IMAGE HANDLER */


	})
