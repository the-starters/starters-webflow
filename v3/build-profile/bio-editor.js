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
 * The limit governs GROWTH, not existence. A bio saved under the old 300-word cap can
 * be ~2000 characters and is grandfathered: it restores intact and can be edited down,
 * but not up. Only an edit that raises the count while over the limit is reverted.
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

		const LOG_PREFIX = '[bio-editor]';
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
			const stepData = activeProfile?.data?.["step_2"];
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
				bioEditor.root.innerHTML = html;
				bioEditor.update();
				prevContents = bioEditor.getContents();
				prevCharCount = getQuillCharCount(bioEditor);
				// The restore is not a member edit; undo must not cross it.
				bioEditor.history?.clear?.();
				isCleaning = false;

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

				bioEditor.setContents(prevContents, 'silent');

				if (selection) {
					const safeIndex = Math.min(
						Math.max(selection.index - 1, 0),
						bioEditor.getLength() - 1
					);

					bioEditor.setSelection(safeIndex, 0, 'silent');
				}

				isCleaning = false;

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

			if (range.length > 0) {
				bioEditor.deleteText(range.index, range.length, 'silent');
			}

			bioEditor.insertText(range.index, allowedPaste, 'silent');

			const newCursorPosition = range.index + allowedPaste.length;
			bioEditor.setSelection(newCursorPosition, 0, 'silent');

			isCleaning = false;
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

