/**
 * GitHub-owned copy of the Build Profile Webflow controller block.
 * Original live inline body SHA-256: 4d8aa2dbd4c7668f37430a73c92049a7a5fa566d99915f5e45a61be5dac0c321
 * Captured read-only from /build-profile/consult on 2026-08-12.
 */
    // Handles work experience dates, including Present state and date validation.
    document.addEventListener('DOMContentLoaded', function () {
        function initWorkDateFields(endSelector, checkboxSelector) {
            const endDateInput = qs(endSelector);
            const currentWorkCheckbox = qs(checkboxSelector);

            let previousEndDate = '';

            if (!endDateInput || !currentWorkCheckbox) return;

            function setCurrentWorkState(isCurrent) {
                if (isCurrent) {
                    if (endDateInput.value && endDateInput.value !== 'Present') {
                        previousEndDate = endDateInput.value;
                    }

                    endDateInput.value = endDateInput.type === 'month' ? '' : 'Present';
                    endDateInput.setAttribute('disabled', 'disabled');
                    endDateInput.classList.add('is-disabled');
                } else {
                    endDateInput.removeAttribute('disabled');
                    endDateInput.classList.remove('is-disabled');

                    endDateInput.value = previousEndDate;
                }
            }

            endDateInput.addEventListener('focus', function () {
                if (currentWorkCheckbox.checked) {
                    endDateInput.blur();
                }
            });

            currentWorkCheckbox.addEventListener('change', function () {
                setCurrentWorkState(currentWorkCheckbox.checked);
            });

            setCurrentWorkState(currentWorkCheckbox.checked);
        }

        initWorkDateFields('#company-end', '#company-current');
        initWorkDateFields('#edit-company-end', '#edit-company-current');
    });
