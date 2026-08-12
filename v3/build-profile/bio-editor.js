/**
 * GitHub-owned copy of the Build Profile Webflow controller block.
 * Original live inline body SHA-256: 91671c4ed05806b2ed306f50c265954ef0c36714f59c77f721e2510370c9273f
 * Captured read-only from /build-profile/consult on 2026-08-12.
 */
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
			const stepData = activeProfile?.data?.["step_2"];
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

