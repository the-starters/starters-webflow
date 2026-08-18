/**
 * GitHub-owned copy of the Build Profile Webflow controller block.
 * Original live inline body SHA-256: 91671c4ed05806b2ed306f50c265954ef0c36714f59c77f721e2510370c9273f
 * Captured read-only from /build-profile/consult on 2026-08-12.
 * This file has since diverged from that captured body; the notes below are the contract.
 *
 * Bio length contract: CHARACTERS, not words. The limit reads `data-max-chars` on
 * `#bio-plain` and defaults to 1500. A character is one code unit of the Quill plain
 * text with the single trailing newline stripped, so newlines inside the bio count.
 *
 * This block also OWNS the bio counter UI, because the generic field-counters script
 * cannot see Quill's content. At init it drops the legacy `count-by-words` attribute
 * (so the page's inline counter pass counts characters too), rewrites the `/300`
 * denominator text node next to `.count-input`, and writes the live character count
 * into that span after every sync, last, so no other listener's write survives.
 *
 * @release v1.59.310
 */
	document.addEventListener('DOMContentLoaded', () => {
		const outputPlain = qs('#bio-plain');
		const outputHtml = qs('#bio-html');
		if (!outputHtml || !outputPlain) return;

		const MAX_CHARS = Number(outputPlain.dataset.maxChars) || 1500;
		let isCleaning = false;
		let prevContents = null;

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
			const stepData = activeProfile?.data?.["step_2"];
			if (!stepData) return;

			if (("bio-html" in stepData)) {
				const html = stepData["bio-html"]
					.replaceAll("\u00A0", " ")
					.replaceAll("&nbsp;", " ");

				bioEditor.root.innerHTML = html;
				syncQuillValue();

				prevContents = bioEditor.getContents();
			}
		});

		prevContents = bioEditor.getContents();

		bioEditor.root.addEventListener('paste', handleQuillPaste);

		bioEditor.on('text-change', () => {
			if (isCleaning) return;

			if (getQuillCharCount(bioEditor) > MAX_CHARS) {
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
			const availableChars = MAX_CHARS - baseCharCount;

			if (availableChars <= 0) {
				event.preventDefault();
				return;
			}

			if (baseCharCount + pastedText.length <= MAX_CHARS) {
				return;
			}

			event.preventDefault();

			const allowedPaste = pastedText.slice(0, availableChars);
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
		}

		function stripTrailingNewline(text) {
			return (text || '').replace(/\n$/, '');
		}

		function getPlainQuillText(quillInstance) {
			return stripTrailingNewline(quillInstance.getText());
		}

		function normalizeCountText(text) {
			return (text || '')
				.replace(/\uFEFF/g, '')
				.replace(/\u00A0/g, ' ');
		}

		function countCharsFromText(text) {
			return normalizeCountText(text).length;
		}

		function getQuillCharCount(quillInstance) {
			return countCharsFromText(getPlainQuillText(quillInstance));
		}

		function setCounterDenominator(span, maxChars) {
			const denominator = span?.nextSibling;
			if (!denominator || denominator.nodeType !== 3) return;

			const match = (denominator.nodeValue || '').match(/^(\s*)\/\d+(\s*)$/);
			if (!match) return;

			denominator.nodeValue = `${match[1]}/${maxChars}${match[2]}`;
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

			// Last write wins: any counter listener reacting to the events above
			// counts the textarea value, which is only ever the plain-text mirror.
			if (counterSpan) {
				counterSpan.textContent = String(getQuillCharCount(bioEditor)).padStart(2, '0');
			}
		}

		syncQuillValue();
	});

