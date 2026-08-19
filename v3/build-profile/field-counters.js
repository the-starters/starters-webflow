/**
 * GitHub-owned copy of the Build Profile Webflow controller block.
 * Original live inline body SHA-256: decbf5b49d1006f8a857602a33e2d89a6270fa8b9355d6311d16188f6a4bfe83
 * Captured read-only from /build-profile/consult on 2026-08-12.
 * This file has since diverged from that captured body; the note below is the contract.
 *
 * A counter group whose wrapper holds a `[data-editor-id]` element belongs to the
 * rich-text editor that renders it, not to this generic counter. See bio-editor.js.
 *
 * @release v1.59.312
 */
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

	counterFields();

