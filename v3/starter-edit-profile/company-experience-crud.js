function isStarterProfileCompanyPresentDate(value) {
    return String(value || '').trim().toLowerCase() === 'present';
}

function starterProfileCompanyDatepickerValue(value) {
    const text = String(value || '').trim();
    if (!text || isStarterProfileCompanyPresentDate(text)) return null;

    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

    function monthIndexForName(value) {
        const month = String(value || '').toLowerCase();
        return monthNames.findIndex(function (name) {
            return month === name || month === name.slice(0, 3);
        });
    }

    function localCalendarDate(year, monthIndex, day) {
        const date = new Date(year, monthIndex, day);
        return (
            date.getFullYear() === year &&
            date.getMonth() === monthIndex &&
            date.getDate() === day
        ) ? date : null;
    }

    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))?)?$/);
    if (isoMatch) {
        const validTime = !isoMatch[4] || (
            Number(isoMatch[4]) <= 23 &&
            Number(isoMatch[5]) <= 59 &&
            Number(isoMatch[6]) <= 59 &&
            (!isoMatch[7] || (
                Number(isoMatch[7]) <= 14 &&
                Number(isoMatch[8]) <= 59 &&
                (Number(isoMatch[7]) < 14 || Number(isoMatch[8]) === 0)
            ))
        );
        if (validTime) {
            const date = localCalendarDate(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
            if (date) return date;
        }
    }

    const nativeMonthMatch = text.match(/^(\d{4})-(\d{2})$/);
    if (nativeMonthMatch) {
        return localCalendarDate(Number(nativeMonthMatch[1]), Number(nativeMonthMatch[2]) - 1, 1);
    }

    const numericDateMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (numericDateMatch) {
        return localCalendarDate(Number(numericDateMatch[3]), Number(numericDateMatch[1]) - 1, Number(numericDateMatch[2]));
    }

    const monthDayYearMatch = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (monthDayYearMatch) {
        const monthIndex = monthIndexForName(monthDayYearMatch[1]);
        if (monthIndex >= 0) {
            const date = localCalendarDate(Number(monthDayYearMatch[3]), monthIndex, Number(monthDayYearMatch[2]));
            if (date) return date;
        }
    }

    const monthYearMatch = text.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (monthYearMatch) {
        const monthIndex = monthIndexForName(monthYearMatch[1]);
        if (monthIndex >= 0) return new Date(Number(monthYearMatch[2]), monthIndex, 1);
    }

    // jQuery UI interprets unknown strings as relative-day offsets. Do not let
    // malformed or new provider formats silently become plausible future dates.
    return null;
}

function starterProfileCompanyWidgetDateValue(input, value) {
    const text = String(value || '').trim();
    if (!input || !text) return null;
    if (typeof jQuery === 'undefined' || !jQuery.datepicker || typeof jQuery.datepicker.parseDate !== 'function') return null;

    // dateFormat lives on the Webflow markup, so only the widget knows it. parseDate
    // throws on a mismatch rather than falling back to relative-day offsets.
    try {
        const format = jQuery(input).datepicker('option', 'dateFormat');
        const date = format ? jQuery.datepicker.parseDate(format, text) : null;
        return date instanceof Date ? date : null;
    } catch (error) {
        return null;
    }
}

function starterProfileCompanyDatepickerDate(input, value) {
    return starterProfileCompanyDatepickerValue(value) || starterProfileCompanyWidgetDateValue(input, value);
}

function setStarterProfileCompanyDatepickerDate(input, value) {
    if (input && input._starterProfileCompanyMonthPicker) {
        input._starterProfileCompanyMonthPicker.setValue(value);
        return;
    }

    if (!input || typeof jQuery === 'undefined' || !jQuery.fn.datepicker || !jQuery(input).data('datepicker')) return;
    if (isStarterProfileCompanyPresentDate(value)) return;

    try {
        jQuery(input).datepicker('setDate', starterProfileCompanyDatepickerDate(input, value));
    } catch (error) {
        // The value may not match the widget's configured dateFormat.
    }
}

function attachStarterProfileCompanyMonthPicker(input) {
    if (!input || input._starterProfileCompanyMonthPicker || !document.body) return;

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let visibleYear = new Date().getFullYear();
    let open = false;

    if (!document.getElementById('starter-profile-company-month-picker-style')) {
        const style = document.createElement('style');
        style.id = 'starter-profile-company-month-picker-style';
        style.textContent = '.sp-company-month-picker{position:fixed;z-index:100000;box-sizing:border-box;width:min(17.5rem,calc(100vw - 1rem));max-height:calc(100vh - 1rem);overflow:auto;padding:.75rem;border:1px solid #d8d8d8;border-radius:.5rem;background:#fff;box-shadow:0 .5rem 1.5rem rgba(0,0,0,.16);font:inherit}.sp-company-month-picker[hidden]{display:none}.sp-company-month-picker__header{display:grid;grid-template-columns:2.5rem 1fr 2.5rem;align-items:center;margin-bottom:.5rem}.sp-company-month-picker__year{text-align:center;font-weight:600}.sp-company-month-picker button{min-height:2.5rem;border:1px solid transparent;border-radius:.4rem;background:transparent;color:inherit;font:inherit;cursor:pointer}.sp-company-month-picker button:hover,.sp-company-month-picker button:focus-visible{border-color:#9badff;outline:none;background:#f4f6ff}.sp-company-month-picker__months{display:grid;grid-template-columns:repeat(3,1fr);gap:.25rem}.sp-company-month-picker__month[aria-pressed="true"]{border-color:#7691ff;background:#eef1ff}.sp-company-month-picker__footer{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-top:.75rem;padding-top:.6rem;border-top:1px solid #eee}.sp-company-month-picker__footer button{border-color:#ddd;background:#fafafa}';
        (document.head || document.body).appendChild(style);
    }

    const popup = document.createElement('div');
    attachStarterProfileCompanyMonthPicker.nextId = (attachStarterProfileCompanyMonthPicker.nextId || 0) + 1;
    popup.id = `starter-profile-company-month-picker-${attachStarterProfileCompanyMonthPicker.nextId}`;
    popup.className = 'sp-company-month-picker';
    popup.hidden = true;
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Choose month and year');

    const header = document.createElement('div');
    header.className = 'sp-company-month-picker__header';
    const previousYear = document.createElement('button');
    previousYear.type = 'button';
    previousYear.setAttribute('aria-label', 'Previous year');
    previousYear.textContent = '‹';
    const yearLabel = document.createElement('div');
    yearLabel.className = 'sp-company-month-picker__year';
    yearLabel.setAttribute('aria-live', 'polite');
    const nextYear = document.createElement('button');
    nextYear.type = 'button';
    nextYear.setAttribute('aria-label', 'Next year');
    nextYear.textContent = '›';
    header.append(previousYear, yearLabel, nextYear);

    const monthGrid = document.createElement('div');
    monthGrid.className = 'sp-company-month-picker__months';
    const monthButtons = monthNames.map(function (name, monthIndex) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sp-company-month-picker__month';
        button.textContent = name;
        button.addEventListener('click', function () {
            input.value = `${name} ${visibleYear}`;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            closePicker();
            if (typeof input.focus === 'function') input.focus({ preventScroll: true });
        });
        monthGrid.appendChild(button);
        return { button, monthIndex };
    });

    const footer = document.createElement('div');
    footer.className = 'sp-company-month-picker__footer';
    const todayButton = document.createElement('button');
    todayButton.type = 'button';
    todayButton.textContent = 'Today';
    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = 'Clear';
    footer.append(todayButton, clearButton);
    popup.append(header, monthGrid, footer);
    const popupHost = input.closest('[data-input-datepicker-modal]') || input.closest('.modal_dialog') || document.body;
    popupHost.appendChild(popup);

    function selectedDate() { return starterProfileCompanyDatepickerValue(input.value); }
    function render() {
        const selected = selectedDate();
        yearLabel.textContent = String(visibleYear);
        monthButtons.forEach(function (entry) {
            entry.button.setAttribute('aria-pressed', String(!!selected && selected.getFullYear() === visibleYear && selected.getMonth() === entry.monthIndex));
            entry.button.setAttribute('aria-label', `${monthNames[entry.monthIndex]} ${visibleYear}`);
        });
    }
    function positionPicker() {
        const rect = input.getBoundingClientRect();
        const width = popup.offsetWidth || 280;
        const height = popup.offsetHeight || 360;
        const viewport = window.visualViewport;
        const viewportLeft = viewport ? viewport.offsetLeft : 0;
        const viewportTop = viewport ? viewport.offsetTop : 0;
    const viewportWidth = viewport ? viewport.width : (window.innerWidth || document.documentElement.clientWidth);
    const viewportHeight = viewport ? viewport.height : (window.innerHeight || document.documentElement.clientHeight);
    popup.style.maxWidth = `${Math.max(0, viewportWidth - 16)}px`;
    popup.style.maxHeight = `${Math.max(0, viewportHeight - 16)}px`;
        const maxLeft = viewportLeft + viewportWidth - width - 8;
        const maxTop = viewportTop + viewportHeight - Math.min(height, viewportHeight - 16) - 8;
        popup.style.left = `${Math.max(viewportLeft + 8, Math.min(rect.left, maxLeft))}px`;
        popup.style.top = `${rect.bottom + height + 8 <= viewportTop + viewportHeight ? rect.bottom + 6 : Math.max(viewportTop + 8, Math.min(rect.top - height - 6, maxTop))}px`;
    }
    function openPicker() {
        if (input.disabled) return;
        const selected = selectedDate();
        visibleYear = selected ? selected.getFullYear() : new Date().getFullYear();
        render();
        popup.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        open = true;
        positionPicker();
        const selectedButton = monthButtons.find(function (entry) {
            return selected && selected.getFullYear() === visibleYear && selected.getMonth() === entry.monthIndex;
        });
        const focusTarget = selectedButton ? selectedButton.button : monthButtons[0].button;
        if (typeof focusTarget.focus === 'function') focusTarget.focus({ preventScroll: true });
    }
    function closePicker() {
        popup.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        open = false;
    }

    previousYear.addEventListener('click', function () { visibleYear -= 1; render(); });
    nextYear.addEventListener('click', function () { visibleYear += 1; render(); });
    todayButton.addEventListener('click', function () {
        const today = new Date();
        visibleYear = today.getFullYear();
        input.value = `${monthNames[today.getMonth()]} ${visibleYear}`;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        closePicker();
        if (typeof input.focus === 'function') input.focus({ preventScroll: true });
    });
    clearButton.addEventListener('click', function () {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        closePicker();
        if (typeof input.focus === 'function') input.focus({ preventScroll: true });
    });
    input.addEventListener('click', openPicker);
    ['beforeinput', 'paste', 'drop'].forEach(function (type) {
        input.addEventListener(type, function (event) { event.preventDefault(); });
    });
    input.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') closePicker();
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
            event.preventDefault();
            openPicker();
        }
    });
  popup.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePicker();
      if (typeof input.focus === 'function') input.focus({ preventScroll: true });
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [previousYear, nextYear].concat(monthButtons.map(function (entry) { return entry.button; }), [todayButton, clearButton]);
    const currentIndex = controls.indexOf(document.activeElement);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? controls.length - 1 : currentIndex - 1)
      : (currentIndex < 0 || currentIndex === controls.length - 1 ? 0 : currentIndex + 1);
    event.preventDefault();
    controls[nextIndex].focus({ preventScroll: true });
    });
    document.addEventListener('mousedown', function (event) {
        if (open && event.target !== input && !popup.contains(event.target)) closePicker();
    });
  window.addEventListener('resize', function () { if (open) positionPicker(); });
  window.addEventListener('scroll', function () { if (open) positionPicker(); }, true);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function () { if (open) positionPicker(); });
    window.visualViewport.addEventListener('scroll', function () { if (open) positionPicker(); });
  }

    input._starterProfileCompanyMonthPicker = {
        popup,
        open: openPicker,
        setValue(value) {
            if (isStarterProfileCompanyPresentDate(value)) return;
            const date = starterProfileCompanyDatepickerValue(value);
            input.value = date ? `${monthNames[date.getMonth()]} ${date.getFullYear()}` : '';
            if (open) render();
        },
    };
}

function enableStarterProfileCompanyMonthInput(input, labelText) {
    if (!input) return;

    if (typeof jQuery !== 'undefined' && jQuery.fn && jQuery.fn.datepicker && jQuery(input).data('datepicker')) {
        try { jQuery(input).datepicker('destroy'); } catch (error) { /* already detached */ }
    }

    input.removeAttribute('data-input-datepicker');
    input.removeAttribute('data-input-datepicker-role');
    input.removeAttribute('data-format');
    input.removeAttribute('data-input-datepicker-format');
    input.type = 'text';
    input.readOnly = false;
    input.setAttribute('aria-readonly', 'true');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('placeholder', 'Select a month');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-haspopup', 'dialog');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-label', labelText);

    const label = document.querySelector(`label[for="${input.id}"]`) || input.closest('[form-group]')?.querySelector('label');
    if (label) {
        label.htmlFor = input.id;
        label.textContent = labelText;
    }

    attachStarterProfileCompanyMonthPicker(input);
    if (input._starterProfileCompanyMonthPicker) {
        input.setAttribute('aria-controls', input._starterProfileCompanyMonthPicker.popup.id);
    }
}

function starterProfileCompanyDateBaseline(input, rawValue) {
    const rawDate = String(rawValue || '').trim();
    if (!input || !rawDate || isStarterProfileCompanyPresentDate(rawDate)) return null;
    return { rawValue: rawDate, pickerValue: input.value.trim() };
}

function serializeStarterProfileCompanyDate(input, baseline) {
    const currentValue = input ? input.value.trim() : '';
    if (baseline && currentValue === baseline.pickerValue) return baseline.rawValue;
    if (!currentValue) return '';

    const date = starterProfileCompanyDatepickerValue(currentValue);
    return date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        : currentValue;
}

const STARTER_PROFILE_COMPANY_MONTH_RANGE_MESSAGE =
    'End month must be the same as or later than the start month.';

function setStarterProfileCompanyMonthRangeError(startInput, endInput, isInvalid) {
    const message = isInvalid ? STARTER_PROFILE_COMPANY_MONTH_RANGE_MESSAGE : '';

    [startInput, endInput].forEach(function (input) {
        if (input && typeof input.setCustomValidity === 'function') input.setCustomValidity(message);
    });
}

function reportStarterProfileCompanyMonthRangeError(endInput) {
    if (endInput && typeof endInput.reportValidity === 'function') endInput.reportValidity();
}

function syncStarterProfileCompanyMonthRange(startInput, endInput, isCurrent) {
    if (!startInput || !endInput) return;

    // Do not constrain either calendar picker from the other field. Reciprocal
    // min/max bounds can trap an existing or inverted range: neither side can move
    // far enough to repair it. The save handlers below remain the authority for
    // rejecting a completed start month that is later than its end month.
    endInput.removeAttribute('min');
    startInput.removeAttribute('max');
    setStarterProfileCompanyMonthRangeError(
        startInput,
        endInput,
        !isStarterProfileCompanyMonthRangeValid(startInput, endInput, isCurrent)
    );
}

function isStarterProfileCompanyMonthRangeValid(startInput, endInput, isCurrent) {
    if (isCurrent || !startInput || !endInput) return true;

    const startValue = startInput.value.trim();
    const endValue = endInput.value.trim();
    if (!startValue || !endValue) return true;

    const startDate = starterProfileCompanyDatepickerValue(startValue);
    const endDate = starterProfileCompanyDatepickerValue(endValue);
    return !startDate || !endDate ||
        (startDate.getFullYear() * 12 + startDate.getMonth()) <=
            (endDate.getFullYear() * 12 + endDate.getMonth());
}

function bindStarterProfileCompanyMonthRange(startInput, endInput, currentCheckbox) {
    if (!startInput || !endInput) return;

    const syncRange = function () {
        syncStarterProfileCompanyMonthRange(
            startInput,
            endInput,
            !!(currentCheckbox && currentCheckbox.checked)
        );
    };

    startInput.addEventListener('input', syncRange);
    startInput.addEventListener('change', syncRange);
    endInput.addEventListener('input', syncRange);
    endInput.addEventListener('change', syncRange);
    endInput.addEventListener('starter:work-date-value-restored', syncRange);
    if (currentCheckbox) currentCheckbox.addEventListener('change', syncRange);
    syncRange();
}

function starterProfileCompanyMonthYearLabel(value) {
  const text = String(value || '').trim();
  if (!text || isStarterProfileCompanyPresentDate(text)) return text;

  const date = starterProfileCompanyDatepickerValue(text);
  if (date) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
  }

  const parts = text.split(/\s+/);
  if (parts.length < 2) return text;

  return `${parts[0]} ${parts[parts.length - 1]}`;
}

function hasStarterEditCompanyPendingChanges(createDrafts, updateDrafts, deleteDraftIds, alsoWorkedWithChanged) {
    return Boolean(createDrafts.length || updateDrafts.size || deleteDraftIds.size || alsoWorkedWithChanged);
}

function createStarterEditCompanyDraftDirtyController(options) {
    const revisions = new Map();
    let discardedRevision = null;
    function dirtyState() {
        return typeof options.getDirtyState === 'function' ? options.getDirtyState() : options.dirtyState;
    }
    return {
        queue(draftId) {
            const token = dirtyState()?.captureRevision?.(options.stepIndex);
            if (token) revisions.set(String(draftId), token);
        },
        discard(draftId) {
            const key = String(draftId);
            const token = revisions.get(key);
            revisions.delete(key);
            if (token && (!discardedRevision || token.revision > discardedRevision.revision)) discardedRevision = token;
            if (options.hasPendingChanges()) return;
            dirtyState()?.discardRevision?.(options.stepIndex, discardedRevision, false);
            discardedRevision = null;
        },
        commit(draftIds) {
            draftIds.forEach(function (draftId) {
                revisions.delete(String(draftId));
            });
        },
    };
}

/**
 * GitHub-owned copy of the Starter Edit Profile Webflow controller block.
 * Original live inline body SHA-256: 1224636b9f1167c5534957407d3451640b8d5b17e52f4930011e17f5a0eb8664
 * Captured read-only from /starter-edit-profile on 2026-08-12.
 */
    // Loads, renders, and creates company experience records from Xano.
    document.addEventListener('DOMContentLoaded', function () {
        waitForMember(async () => {
            if (!MEMBER.id) return;

            const XANO_GET_COMPANIES_URL = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies';
            const XANO_CREATE_COMPANY_URL = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies';

            const XANO_UPDATE_COMPANY_URL = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies';
            const XANO_DELETE_COMPANY_URL = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies';
            const XANO_SET_ALSO_WORKED_WITH_URL = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starter/set_also_worked_with';
            const MAX = 3;

            let starter_xano_id = null;

            const companyList = qs('.company-list');
            const companyTemplate = companyList ? qs('.company-card', companyList) : null;

            const companyInput = qs('#company-name');
            const jobTitleInput = qs('#company-position');
            const startDateInput = qs('#company-start');
            const endDateInput = qs('#company-end');
            const firstCompanyInput = qs('#first-company');
            const currentWorkCheckbox = qs('#company-current');
            const addBtn = qs('#add-company');
            const dropdownToggleLabel = qs('[dropdown-toggle-label]');

            const editCompanyWrapper = qs('#edit-company-wrapper');
            const editCompanyInput = qs('#edit-company-name');
            const editJobTitleInput = qs('#edit-company-position');
            const editStartDateInput = qs('#edit-company-start');
            const editEndDateInput = qs('#edit-company-end');
            const editCurrentWorkCheckbox = qs('#edit-company-current');

            enableStarterProfileCompanyMonthInput(startDateInput, 'Start month and year');
            enableStarterProfileCompanyMonthInput(endDateInput, 'End month and year');
            enableStarterProfileCompanyMonthInput(editStartDateInput, 'Start month and year');
            enableStarterProfileCompanyMonthInput(editEndDateInput, 'End month and year');
            bindStarterProfileCompanyMonthRange(startDateInput, endDateInput, currentWorkCheckbox);
            bindStarterProfileCompanyMonthRange(editStartDateInput, editEndDateInput, editCurrentWorkCheckbox);

            const modalEdit = qs('[data-modal-target="company-edit"]');
            const modalEditTrigger = qs('[data-modal-trigger="company-edit"]');
            const modalEditClose = qs('[data-modal-close]', modalEdit);

            const modalRemove = qs('[data-modal-target="company-remove"]');
            const modalRemoveTrigger = qs('[data-modal-trigger="company-remove"]');
            const modalRemoveClose = qs('[data-modal-close]', modalRemove);

            const removeSubmitButton = qs('[company-remove-submit]');
            const saveCompanyEditButton = qs('[save-company-edit]');
            const cancelCompanyEditButton = qs('[cancel-company-edit]');
            const companySubmit = qs('[data-edit-submit="companies"]');

            const alsoWorkedWithInput = qs('#also-worked-with');
            const editFormSuccessTrigger = qs("[data-modal-trigger='edit-form-success']");
            const editFormErrorTrigger = qs("[data-modal-trigger='edit-form-error']");

            // The autocomplete widget (embed-experiences-autocomplete.html) populates this field
            // asynchronously from Xano on load, firing the same input/change events a real user
            // edit would. Snapshot the "last saved" value once that settles, so the initial
            // populate isn't mistaken for a pending change.
            let alsoWorkedWithBaseline = alsoWorkedWithInput ? alsoWorkedWithInput.value : '';
            let alsoWorkedWithBaselineReady = !alsoWorkedWithInput;

            let editStartDateBaseline = null;
            let editEndDateBaseline = null;
            let editStartDateUserChanged = false;
            let editEndDateUserChanged = false;
            let isLimitReached = false;

            let editStartDateSelectGuarded = false;
            let editEndDateSelectGuarded = false;

            if (editStartDateInput) {
                editStartDateInput.addEventListener('input', () => { editStartDateUserChanged = true; });
                editStartDateInput.addEventListener('change', () => { editStartDateUserChanged = true; });
            }

            if (editEndDateInput) {
                editEndDateInput.addEventListener('input', () => { editEndDateUserChanged = true; });
                editEndDateInput.addEventListener('change', () => { editEndDateUserChanged = true; });
            }

            if (!companyList || !companyTemplate) {
                console.warn('[Companies] .company-list or .company-card template not found');
            }

            if (!addBtn) {
                console.warn('[Companies] #add-company not found');
            }

            let isSubmitting = false;
            let submitAction = '';
            let companiesCount = 0;
            let addCompanyFeedbackTimeout = null;
            const placeholderLogo = 'https://cdn.prod.website-files.com/69c573f20f82bd0f3384032c/6a21517ca6c1caa51f014026_company-placeholder.svg';

            function persistedCompanyLogo(logoUrl) {
                const normalizedLogoUrl = String(logoUrl || '').trim();
                return normalizedLogoUrl === placeholderLogo ? '' : normalizedLogoUrl;
            }

            function storeSelectedCompany(input, company) {
                if (!input) return;
                input.dataset.selectedCompanyName = company && company.name ? company.name : '';
                input.dataset.selectedCompanyDomain = company && company.domain ? company.domain : '';
                input.dataset.selectedCompanyLogoUrl = persistedCompanyLogo(company && company.logo_url);
                input.dataset.selectedCompanyEntityId = String(Number(company && company.company_entity_id) || 0);
                input.dataset.selectedCompanySource = company && company.source ? company.source : '';
            }

            function clearSelectedCompany(input) {
                if (!input) return;
                delete input.dataset.selectedCompanyName;
                delete input.dataset.selectedCompanyDomain;
                delete input.dataset.selectedCompanyLogoUrl;
                delete input.dataset.selectedCompanyEntityId;
                delete input.dataset.selectedCompanySource;
            }

            function selectedCompanyForInput(input) {
                if (!input) return null;
                const currentName = getValue(input);
                const storedName = String(input.dataset.selectedCompanyName || '').trim();
                if (storedName && storedName === currentName) {
                    return {
                        name: storedName,
                        domain: String(input.dataset.selectedCompanyDomain || '').trim(),
                        logo_url: persistedCompanyLogo(input.dataset.selectedCompanyLogoUrl),
                        company_entity_id: Number(input.dataset.selectedCompanyEntityId) || 0,
                        source: String(input.dataset.selectedCompanySource || '').trim(),
                    };
                }
                return null;
            }

            // pendingUpdateDrafts/pendingDeleteDraftIds only ever hold real (already-in-XANO) ids.
            // pendingCreateDrafts entries always keep their synthetic draft_ id and are never
            // "promoted" into the other two containers.
            let pendingCreateDrafts = [];
            let pendingUpdateDrafts = new Map();
            let pendingDeleteDraftIds = new Set();
            const companyDraftDirtyController = createStarterEditCompanyDraftDirtyController({
                getDirtyState: function () { return window.__tsProfileDirtyState; },
                stepIndex: 3,
                hasPendingChanges: function () {
                    return hasStarterEditCompanyPendingChanges(
                        pendingCreateDrafts,
                        pendingUpdateDrafts,
                        pendingDeleteDraftIds,
                        hasAlsoWorkedWithChanges()
                    );
                },
            });

            const textEl = addBtn ? qs('div:first-child', addBtn) : null;
            const defaultButtonText = textEl ? textEl.textContent : 'add company';
            const defaultDropdownLabel = dropdownToggleLabel ? dropdownToggleLabel.textContent.trim() : 'Add Work Experience - 1 of 3';

            function openRemoveModal() {
                if (!modalRemove) return;

                modalRemoveTrigger.dispatchEvent(new Event('click', { bubbles: true }));
            }

            function closeRemoveModal() {
                if (!modalRemove) return;

                modalRemoveClose.dispatchEvent(new Event('click', { bubbles: true }));
                updateRemoveSubmitId('');
            }

            function openEditModal() {
                if (!modalEdit) return;

                modalEditTrigger.dispatchEvent(new Event('click', { bubbles: true }));
            }

            function closeEditModal() {
                if (!modalEdit) return;

                modalEditClose.dispatchEvent(new Event('click', { bubbles: true }));
            }

            function getValue(input) {
                return input ? input.value.trim() : '';
            }

            // Label-only transform: cards show month + year, so this drops any middle token
            // from the stored string. It says nothing about what XANO stores — records hold
            // month-only values like "Jan 2024" as well as day-precision ones — so the edit
            // popup parses the raw string separately in starterProfileCompanyDatepickerValue.
            // Contract: ../profile-form/README.md#company-experience-date-hydration
            function toMonthYearLabel(value) {
                return starterProfileCompanyMonthYearLabel(value);
            }

            function setButtonText(text) {
                if (textEl) textEl.textContent = text;
            }

            function clearAddCompanyFeedbackTimeout() {
                if (!addCompanyFeedbackTimeout) return;

                clearTimeout(addCompanyFeedbackTimeout);
                addCompanyFeedbackTimeout = null;
            }

            function updateDropdownLabel() {
                if (!dropdownToggleLabel) return;

                const nextCompanyNumber = Math.min(companiesCount + 1, MAX);
                dropdownToggleLabel.textContent = defaultDropdownLabel.replace(/\d+\s+of\s+\d+/i, `${nextCompanyNumber} of ${MAX}`);
            }

            function hasRequiredCompanyFields() {
                return !!(getValue(companyInput) && getValue(jobTitleInput));
            }

            function getCompanyLogo(company) {
                return company.company_logo_url || company.logo_url || placeholderLogo;
            }

            function isValidCompanySelection(company) {
                return !!company && !!(
                    company.company_entity_id ||
                    company.domain ||
                    company.source === 'custom'
                );
            }

            function getCompanyDates(company) {
                const startLabel = toMonthYearLabel(company.start_date);

                if (company.current_work) {
                    return [startLabel, 'Present'].filter(Boolean).join(' - ');
                }

                return [startLabel, toMonthYearLabel(company.end_date)].filter(Boolean).join(' - ');
            }

            function showFieldError(group) {
                if (group) {
                    setTimeout(() => {
                        group.classList.add('is-error');
                        setTimeout(() => {
                            group.classList.remove('is-error');
                        }, 200);
                        setTimeout(() => {
                            group.classList.add('is-error');
                        }, 400);
                        setTimeout(() => {
                            group.classList.remove('is-error');
                        }, 600);
                    }, 300);
                }
            }

            // jQuery UI datepicker interop, replacing the old `input._flatpickr` calls now that
            // the picker itself is initialized elsewhere (Global-FormEmbeds-Datepicker.html).
            function setDatepickerDate(input, value) {
                setStarterProfileCompanyDatepickerDate(input, value);
            }

            // start/end pairs lock each other's minDate/maxDate on selection (see
            // Global-FormEmbeds-Datepicker.html); clearing just the value leaves that
            // cross-field bound in place, so the next pick is still constrained by
            // whatever was previously selected on the other side.
            function resetDatepickerBounds(input) {
                if (!input || typeof jQuery === 'undefined' || !jQuery.fn.datepicker || !jQuery(input).data('datepicker')) return;

                try {
                    jQuery(input).datepicker('option', { minDate: null, maxDate: null });
                } catch (error) {
                    // ignore
                }
            }

            const EDIT_DATEPICKER_POLL_MS = 100;
            const EDIT_DATEPICKER_MAX_WAIT_MS = 10000;

            function isEditCompanyDatepickerReady(input) {
                if (!input) return true;
                if (input._starterProfileCompanyMonthPicker) return true;
                if (typeof jQuery === 'undefined' || !jQuery.fn || !jQuery.fn.datepicker) return false;

                return !!jQuery(input).data('datepicker');
            }

            // jQuery UI writes a calendar pick straight into the field with `input.val()` and, because
            // the shared embed pairs these inputs with its own `onSelect`, fires neither `input` nor
            // `change`. Chain onto that callback so a picked date still counts as user input.
            function guardEditCompanyDateSelection(input, markChanged) {
                if (input && input._starterProfileCompanyMonthPicker) return true;
                if (!input || !isEditCompanyDatepickerReady(input)) return false;

                try {
                    const existingOnSelect = jQuery(input).datepicker('option', 'onSelect');
                    jQuery(input).datepicker('option', {
                        onSelect: function () {
                            markChanged();
                            if (typeof existingOnSelect === 'function') existingOnSelect.apply(this, arguments);
                        },
                    });
                    return true;
                } catch (error) {
                    return false;
                }
            }

            function guardEditCompanyDateSelections() {
                if (!editStartDateSelectGuarded) {
                    editStartDateSelectGuarded = guardEditCompanyDateSelection(editStartDateInput, function () {
                        editStartDateUserChanged = true;
                    });
                }

                if (!editEndDateSelectGuarded) {
                    editEndDateSelectGuarded = guardEditCompanyDateSelection(editEndDateInput, function () {
                        editEndDateUserChanged = true;
                    });
                }
            }

            // jQuery UI is fetched over the network by Global-FormEmbeds-Datepicker.html, so the widget
            // can initialize - and rewrite these fields from their raw text - after the edit modal is
            // already open. Run `callback` once both inputs are live; when they already are nothing
            // further will touch them, so there is nothing to wait for.
            function whenEditCompanyDatepickerReady(callback) {
                if (isEditCompanyDatepickerReady(editStartDateInput) && isEditCompanyDatepickerReady(editEndDateInput)) return;

                let waited = 0;
                const poll = setInterval(function () {
                    waited += EDIT_DATEPICKER_POLL_MS;
                    guardEditCompanyDateSelections();

                    if (isEditCompanyDatepickerReady(editStartDateInput) && isEditCompanyDatepickerReady(editEndDateInput)) {
                        clearInterval(poll);
                        callback();
                        return;
                    }

                    if (waited >= EDIT_DATEPICKER_MAX_WAIT_MS) clearInterval(poll);
                }, EDIT_DATEPICKER_POLL_MS);
            }

            async function getCompanies() {
                const url = `${XANO_GET_COMPANIES_URL}?member_id=${encodeURIComponent(MEMBER.id)}`;
                const response = await fetch(url);
                const data = await response.json();

                if (!response.ok) {
                    console.error('[Companies] get error:', data);
                    throw new Error('Failed to load companies');
                }

                return (data && data.companies && data.starter_id) ? data : { companies: [], starter_id: null };
            }

            function applyCompanyPendingOverlay(company) {
                if (pendingDeleteDraftIds.has(String(company.id))) return null;

                const draft = pendingUpdateDrafts.get(String(company.id));
                if (!draft) return company;

                return { ...company, ...draft, id: company.id, is_draft: true, pending_type: 'update' };
            }

            function createCompanyCard(company) {
                const card = companyTemplate.cloneNode(true);

                card.style.display = '';
                card.dataset.id = company.id || '';
                card.dataset.company = JSON.stringify(company);

                const logo = qs('.company-card__logo', card);
                const name = qs('.company-card__name', card);
                const metaDate = qs('.company-card__meta.date', card);
                const metaPosition = qs('.company-card__meta.position', card);

                if (logo) {
                    logo.src = getCompanyLogo(company);
                    logo.alt = company.company_name || '';
                }

                if (name) {
                    name.textContent = company.company_name || '';
                } else {
                    const fallbackText = qs('div:not([class])', card);
                    if (fallbackText) fallbackText.textContent = company.company_name || '';
                }

                if (metaDate) {
                    const dates = getCompanyDates(company);
                    if (dates.trim()) {
                        metaDate.textContent = dates;
                    } else {
                        metaDate.style.display = 'none';
                    }
                }

                if (metaPosition) {
                    metaPosition.textContent = company.job_title || '';
                }

                let actions = qs('.company-card__actions', card);

                if (!actions) {
                    actions = document.createElement('div');
                    actions.className = 'company-card__actions';

                    actions.innerHTML = `
              <button type="button" class="company-card__edit" company-card-edit>Edit</button>
              <button type="button" class="company-card__remove" company-remove-open>Remove</button>
          `;

                    card.appendChild(actions);
                }

                return card;
            }

            function removeBtnVisibility() {
                const cards = qsa('.company-card:not(:first-child)', companyList);
                cards.forEach(function (card) {
                    const btn = qs('[company-remove-open]', card);
                    if (btn) btn.style.display = cards.length <= 1 ? 'none' : '';
                });
            }

            function updateAddBtnState() {
                if (!addBtn) return;

                isLimitReached = companiesCount >= MAX;
                const isFormReady = hasRequiredCompanyFields();
                const isDisabled = isLimitReached || !isFormReady || isSubmitting;

                addBtn.style.display = isLimitReached ? 'none' : 'flex';
                addBtn.style.pointerEvents = isDisabled ? 'none' : '';
                addBtn.style.opacity = isDisabled ? '0.5' : '';
                addBtn.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');

                const currentAccordion = addBtn.previousElementSibling;

                if (isLimitReached) {
                    setButtonText('Max 3 companies');

                    if (currentAccordion && currentAccordion.classList.contains("profile-dropdown")) {
                        currentAccordion.style.display = 'none';
                    }
                } else {
                    let ctaText = defaultButtonText;

                    if (isSubmitting) {
                        if (submitAction === 'deleting') {
                            ctaText = 'Deleting...';
                        } else if (submitAction === 'adding') {
                            ctaText = 'Adding...';
                        }
                    }

                    setButtonText(ctaText);

                    if (currentAccordion && currentAccordion.classList.contains("profile-dropdown")) {
                        currentAccordion.style.display = '';
                    }
                }

                updateDropdownLabel();
            }

            function hasAlsoWorkedWithChanges() {
                if (!alsoWorkedWithInput || !alsoWorkedWithBaselineReady) return false;
                return alsoWorkedWithInput.value !== alsoWorkedWithBaseline;
            }

            function updateCompanySubmitState() {
                if (!companySubmit) return;

                const hasPendingChanges = Boolean(pendingCreateDrafts.length || pendingUpdateDrafts.size || pendingDeleteDraftIds.size);
                const hasFirstCompany = Boolean(firstCompanyInput && firstCompanyInput.value);
                const canSubmit = (hasPendingChanges || hasAlsoWorkedWithChanges()) && hasFirstCompany;

                companySubmit.style.opacity = canSubmit ? '1' : '0.5';
                companySubmit.style.pointerEvents = canSubmit ? 'auto' : 'none';
            }

            function openAddCompanyAccordionIfEmpty() {
                if (!addBtn || companiesCount > 0) return;

                const currentAccordion = addBtn.previousElementSibling;
                if (!currentAccordion || !currentAccordion.classList.contains('profile-dropdown')) return;

                const contentBlock = qs('.all-starters_accordion-content', currentAccordion);
                if (!contentBlock || contentBlock.style.height !== '0px') return;

                const toggle = qs('.all-starters_accordion-toggle-button', currentAccordion);
                if (toggle) toggle.click();
            }

            function syncFirstCompanyInput() {
                if (!firstCompanyInput) return;

                firstCompanyInput.value = companiesCount > 0 ? 'true' : '';
                const dispatchSync = function () {
                    firstCompanyInput.dispatchEvent(new Event('change', { bubbles: true }));
                    firstCompanyInput.dispatchEvent(new Event('input', { bubbles: true }));
                };
                const dirtyState = window.__tsProfileDirtyState;
                if (dirtyState && typeof dirtyState.runHydrationSync === 'function') {
                    dirtyState.runHydrationSync(dispatchSync);
                } else {
                    dispatchSync();
                }
            }

            async function renderCompanies() {
                if (!companyList || !companyTemplate) return;

                function parseEndDateToTimestamp(value) {
                    if (!value) return null;

                    const dateText = String(value).trim();

                    if (!dateText) return null;
                    if (dateText.toLowerCase() === 'present') return Infinity;

                    const months = {
                        Jan: 0,
                        Feb: 1,
                        Mar: 2,
                        Apr: 3,
                        May: 4,
                        Jun: 5,
                        Jul: 6,
                        Aug: 7,
                        Sep: 8,
                        Oct: 9,
                        Nov: 10,
                        Dec: 11,
                    };

                    const dateParts = dateText.split(/\s+/);
                    const monthText = dateParts[0];
                    const yearText = dateParts[dateParts.length - 1];
                    const month = months[monthText];
                    const year = Number(yearText);

                    if (month !== undefined && year) {
                        return new Date(year, month, 1).getTime();
                    }

                    const fallbackDate = new Date(dateText);
                    const fallbackTimestamp = fallbackDate.getTime();

                    return Number.isNaN(fallbackTimestamp) ? null : fallbackTimestamp;
                }

                function getCompanySortData(company, index) {
                    const isPresent =
                        company.current_work ||
                        String(company.end_date || '').trim().toLowerCase() === 'present';

                    if (isPresent) {
                        return {
                            priority: 0,
                            timestamp: Infinity,
                            index,
                        };
                    }

                    const timestamp = parseEndDateToTimestamp(company.end_date);

                    if (timestamp === null) {
                        return {
                            priority: 2,
                            timestamp: -Infinity,
                            index,
                        };
                    }

                    return {
                        priority: 1,
                        timestamp,
                        index,
                    };
                }

                try {
                    const { companies, starter_id } = await getCompanies();

                    const mergedCompanies = companies
                        .map(applyCompanyPendingOverlay)
                        .filter(Boolean)
                        .concat(pendingCreateDrafts);

                    const sortedCompanies = mergedCompanies
                        .map(function (company, index) {
                            return { company, sortData: getCompanySortData(company, index) };
                        })
                        .sort((a, b) => {
                            if (a.sortData.priority !== b.sortData.priority) {
                                return a.sortData.priority - b.sortData.priority;
                            }

                            if (a.sortData.timestamp !== b.sortData.timestamp) {
                                return b.sortData.timestamp - a.sortData.timestamp;
                            }

                            return a.sortData.index - b.sortData.index;
                        })
                        .map(function (entry) {
                            return entry.company;
                        });

                    companiesCount = mergedCompanies.length;
                    starter_xano_id = starter_id;

                    syncFirstCompanyInput();

                    qsa('.company-card:not(:first-child)', companyList).forEach(function (card) {
                        card.remove();
                    });

                    companyTemplate.style.display = 'none';

                    sortedCompanies.forEach(function (company) {
                        companyList.appendChild(createCompanyCard(company));
                    });

                    removeBtnVisibility();
                    updateAddBtnState();
                    updateCompanySubmitState();
                } catch (error) {
                    console.error('[Companies] render failed:', error);
                }
            }

            async function createCompany(payload) {
                const request = () => fetch(XANO_CREATE_COMPANY_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                });
                const diagnostics = window.StartersNativeFormDiagnostics;
                const response = await (diagnostics
                    ? diagnostics.observeMutation('company_experience_create', request)
                    : request());

                const data = await response.json();

                if (!response.ok) {
                    console.error('[Companies] create error:', data);
                    throw new Error(data.message || 'Company creation failed');
                }

                return data;
            }

            async function updateCompany(companyId, payload) {
                const request = () => fetch(`${XANO_UPDATE_COMPANY_URL}/${encodeURIComponent(companyId)}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                });
                const diagnostics = window.StartersNativeFormDiagnostics;
                const response = await (diagnostics
                    ? diagnostics.observeMutation('company_experience_update', request)
                    : request());

                const data = await response.json();

                if (!response.ok) {
                    console.error('[Companies] update error:', data);
                    throw new Error(data.message || 'Company update failed');
                }

                return data;
            }

            async function deleteCompany(companyId) {
                const request = () => fetch(`${XANO_DELETE_COMPANY_URL}/${encodeURIComponent(companyId)}`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
                const diagnostics = window.StartersNativeFormDiagnostics;
                const response = await (diagnostics
                    ? diagnostics.observeMutation('company_experience_delete', request)
                    : request());

                let data = null;

                try {
                    data = await response.json();
                } catch (error) {
                    data = null;
                }

                if (!response.ok) {
                    console.error('[Companies] delete error:', data);
                    throw new Error((data && data.message) || 'Company delete failed');
                }

                return data;
            }

            async function commitCreateCompanyDraft(draft, replaceCompanyId = '') {
                const { id, type, is_draft, pending_type, ...companyFields } = draft;
                const replaceId = Number(replaceCompanyId) || 0;
                return createCompany({
                    ...companyFields,
                    freelancers_id: starter_xano_id,
                    ...(replaceId ? { replace_companies_id: replaceId } : {}),
                });
            }

            async function commitUpdateCompanyDraft(companyId, draftPayload) {
                return updateCompany(companyId, { ...draftPayload, freelancers_id: starter_xano_id });
            }

            async function commitDeleteCompanyDrafts() {
                for (const companyId of Array.from(pendingDeleteDraftIds)) {
                    await deleteCompany(companyId);
                    pendingDeleteDraftIds.delete(companyId);
                }
            }

            async function commitAlsoWorkedWith() {
                if (!hasAlsoWorkedWithChanges()) return;
                const submittedAlsoWorkedWith = alsoWorkedWithInput.value;

                const request = () => fetch(XANO_SET_ALSO_WORKED_WITH_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        member_id: MEMBER.id,
                        also_worked_with: submittedAlsoWorkedWith,
                    }),
                });
                const diagnostics = window.StartersNativeFormDiagnostics;
                const response = await (diagnostics
                    ? diagnostics.observeMutation('company_experience_associations', request)
                    : request());

                if (!response.ok) {
                    let data = null;
                    try {
                        data = await response.json();
                    } catch (error) {
                        data = null;
                    }

                    console.error('[setAlsoWorkedWith] XANO error:', response.status, data);
                    throw new Error((data && data.message) || `Also worked with save failed (${response.status})`);
                }

                alsoWorkedWithBaseline = submittedAlsoWorkedWith;
            }

            function triggerFieldEvents(input) {
                if (!input) return;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }

            function resetCompanyFields() {
                clearAddCompanyFeedbackTimeout();

                if (companyInput) {
                    companyInput.value = '';
                    clearSelectedCompany(companyInput);
                }

                if (jobTitleInput) {
                    jobTitleInput.value = '';
                }

                if (startDateInput) {
                    setDatepickerDate(startDateInput, null);
                    resetDatepickerBounds(startDateInput);
                    startDateInput.value = '';
                }

                if (endDateInput) {
                    setDatepickerDate(endDateInput, null);
                    resetDatepickerBounds(endDateInput);
                    endDateInput.value = '';
                    endDateInput.removeAttribute('disabled');
                    endDateInput.classList.remove('is-disabled');
                }

                if (currentWorkCheckbox) {
                    currentWorkCheckbox.checked = false;

                    const checkboxLabel = currentWorkCheckbox.closest('.w-checkbox');
                    const customCheckboxIcon = checkboxLabel ? qs('.w-checkbox-input', checkboxLabel) : null;

                    if (customCheckboxIcon) {
                        customCheckboxIcon.classList.remove('w--redirected-checked');
                    }
                }

                if (endDateInput) endDateInput.dispatchEvent(new Event('starter:work-date-operation-reset'));
                syncStarterProfileCompanyMonthRange(startDateInput, endDateInput);

                updateAddBtnState();
            }

            function setCheckboxState(checkbox, isChecked) {
                if (!checkbox) return;

                checkbox.checked = !!isChecked;

                const checkboxLabel = checkbox.closest('.w-checkbox');
                const customCheckboxIcon = checkboxLabel ? qs('.w-checkbox-input', checkboxLabel) : null;

                if (customCheckboxIcon) {
                    customCheckboxIcon.classList.toggle('w--redirected-checked', !!isChecked);
                }
            }

            function openEditCompany(company) {
                if (!editCompanyWrapper || !company) return;

                if (editEndDateInput) editEndDateInput.dispatchEvent(new Event('starter:work-date-operation-reset'));
                editCompanyWrapper.dataset.id = company.id || '';
                const rawStartDate = company.start_date || '';
                const rawEndDate = company.current_work ? 'Present' : (company.end_date || '');
                editStartDateUserChanged = false;
                editEndDateUserChanged = false;

                function hydrateEditCompanyDates(onlyIfUnchanged = false) {
                    if (editStartDateInput && (!onlyIfUnchanged || !editStartDateUserChanged)) {
                        editStartDateInput.value = rawStartDate;
                        resetDatepickerBounds(editStartDateInput);
                        setDatepickerDate(editStartDateInput, rawStartDate);
                        editStartDateBaseline = starterProfileCompanyDateBaseline(editStartDateInput, rawStartDate);
                    }

                    if (editEndDateInput && (!onlyIfUnchanged || !editEndDateUserChanged)) {
                        editEndDateInput.value = rawEndDate;
                        resetDatepickerBounds(editEndDateInput);

                        setDatepickerDate(editEndDateInput, rawEndDate);

                        if (company.current_work) {
                            editEndDateInput.setAttribute('disabled', 'disabled');
                        } else {
                            editEndDateInput.removeAttribute('disabled');
                        }

                        editEndDateInput.classList.toggle('is-disabled', !!company.current_work);
                        editEndDateBaseline = starterProfileCompanyDateBaseline(editEndDateInput, rawEndDate);
                    }

                    syncStarterProfileCompanyMonthRange(editStartDateInput, editEndDateInput);
                }

                if (editCompanyInput) {
                    editCompanyInput.value = company.company_name || '';
                    storeSelectedCompany(editCompanyInput, {
                        name: company.company_name || '',
                        domain: company.company_domain || '',
                        logo_url: company.company_logo_url || company.logo_url || '',
                        company_entity_id: company.company_entity_id,
                        source: company.company_source || company.source || (company.company_entity_id ? 'platform' : ''),
                    });
                }

                if (editJobTitleInput) {
                    editJobTitleInput.value = company.job_title || '';
                }

                hydrateEditCompanyDates();

                setCheckboxState(editCurrentWorkCheckbox, !!company.current_work);

                openEditModal();
                // Opening the modal runs the shared date-picker embed over these inputs, which re-reads
                // their raw text and can turn it into a relative-day date.
                hydrateEditCompanyDates();
                guardEditCompanyDateSelections();
                whenEditCompanyDatepickerReady(function () {
                    if (String(editCompanyWrapper.dataset.id) !== String(company.id || '')) return;
                    hydrateEditCompanyDates(true);
                });
            }

            function closeEditCompany(notCloseButton = false) {
                if (!editCompanyWrapper) return;

                if (notCloseButton) {
                    closeEditModal();
                }

                setTimeout(() => {
                    editCompanyWrapper.dataset.id = '';

                    if (editCompanyInput) {
                        editCompanyInput.value = '';
                        clearSelectedCompany(editCompanyInput);
                    }

                    if (editJobTitleInput) {
                        editJobTitleInput.value = '';
                    }

                    if (editStartDateInput) {
                        setDatepickerDate(editStartDateInput, null);
                        resetDatepickerBounds(editStartDateInput);
                        editStartDateInput.value = '';
                    }

                    if (editEndDateInput) {
                        setDatepickerDate(editEndDateInput, null);
                        resetDatepickerBounds(editEndDateInput);
                        editEndDateInput.value = '';
                        editEndDateInput.removeAttribute('disabled');
                        editEndDateInput.classList.remove('is-disabled');
                    }

                    setCheckboxState(editCurrentWorkCheckbox, false);
                    if (editEndDateInput) editEndDateInput.dispatchEvent(new Event('starter:work-date-operation-reset'));
                    syncStarterProfileCompanyMonthRange(editStartDateInput, editEndDateInput);

                    editStartDateBaseline = null;
                    editEndDateBaseline = null;
                }, 800);
            }

            function updateRemoveSubmitId(id = null) {
                if (!removeSubmitButton) return;
                removeSubmitButton.dataset.id = id || '';
            }

            function isDraftCompanyId(id) {
                return typeof id === 'string' && id.startsWith('draft_');
            }

            function removeCreateDraft(draftId) {
                pendingCreateDrafts = pendingCreateDrafts.filter(function (draft) {
                    return draft.id !== draftId;
                });
            }

            function queueCompanyDeletion(id) {
                if (isDraftCompanyId(id)) {
                    removeCreateDraft(id);
                    companyDraftDirtyController.discard(id);
                    return;
                }

                window.__tsProfileDirtyState?.markDirty?.(3);
                pendingDeleteDraftIds.add(String(id));
                pendingUpdateDrafts.delete(String(id));
            }

            function clearAllDraftQueues() {
                companyDraftDirtyController.commit(
                    pendingCreateDrafts.map(function (draft) { return draft.id; })
                        .concat(Array.from(pendingUpdateDrafts.keys()))
                );
                pendingCreateDrafts = [];
                pendingUpdateDrafts = new Map();
                pendingDeleteDraftIds = new Set();
            }

            [companyInput, jobTitleInput].forEach(function (input) {
                if (!input) return;

                input.addEventListener('input', updateAddBtnState);
                input.addEventListener('change', updateAddBtnState);
            });

            if (companyList) {
                companyList.addEventListener('click', async function (event) {
                    const card = event.target.closest('.company-card');
                    if (!card || !card.dataset.id) return;

                    /* open edit modal */
                    const editButton = event.target.closest('[company-card-edit]');
                    if (editButton) {
                        let company = null;

                        try {
                            company = JSON.parse(card.dataset.company || '{}');
                        } catch (error) {
                            company = null;
                        }

                        if (editButton) {
                            openEditCompany(company);
                            return;
                        }
                    }

                    /* open remove modal */
                    const removeOpenButton = event.target.closest('[company-remove-open]');
                    if (removeOpenButton) {
                        openRemoveModal();
                        updateRemoveSubmitId(card.dataset.id);
                        return;
                    }
                });
            }

            if (cancelCompanyEditButton) {
                cancelCompanyEditButton.addEventListener('click', function (event) {
                    event.preventDefault();
                    closeEditCompany();
                });
            }

            if (removeSubmitButton) {
                removeSubmitButton.addEventListener('click', async function (event) {
                    event.preventDefault();

                    if (isSubmitting || !removeSubmitButton.dataset.id) return;

                    const textEl = removeSubmitButton.querySelector('.button_main-text');
                    const defaultSaveText = textEl.textContent || 'save changes';

                    try {
                        isSubmitting = true;
                        submitAction = 'deleting';
                        clearAddCompanyFeedbackTimeout();
                        updateAddBtnState();
                        textEl.textContent = 'Removing...';

                        queueCompanyDeletion(removeSubmitButton.dataset.id);
                        await renderCompanies();

                    } catch (error) {
                        console.error('[Companies] remove failed:', error);
                        textEl.textContent = 'Error';

                        setTimeout(function () {
                            textEl.textContent = defaultSaveText;
                        }, 1200);

                    } finally {
                        isSubmitting = false;
                        submitAction = '';
                        closeRemoveModal();
                        textEl.textContent = 'Remove';
                        updateAddBtnState();
                    }
                });
            }

            if (saveCompanyEditButton) {
                saveCompanyEditButton.addEventListener('click', async function (event) {
                    event.preventDefault();

                    if (isSubmitting || !editCompanyWrapper) return;

                    const companyId = editCompanyWrapper.dataset.id;
                    if (!companyId) return;

                    const selectedEditCompany = selectedCompanyForInput(editCompanyInput);

                    const payload = {
                        company_name: getValue(editCompanyInput),
                        job_title: getValue(editJobTitleInput),
                        start_date: serializeStarterProfileCompanyDate(editStartDateInput, editStartDateBaseline),
                        end_date: editCurrentWorkCheckbox && editCurrentWorkCheckbox.checked ? "Present" : serializeStarterProfileCompanyDate(editEndDateInput, editEndDateBaseline),
                        current_work: editCurrentWorkCheckbox ? editCurrentWorkCheckbox.checked : false,
                        company_domain: selectedEditCompany ? selectedEditCompany.domain : '',
                        company_logo_url: selectedEditCompany ? selectedEditCompany.logo_url : '',
                        company_entity_id: selectedEditCompany ? selectedEditCompany.company_entity_id : 0,
                        company_source: selectedEditCompany ? selectedEditCompany.source : '',
                    };

                    let isValid = true;

                    if (!payload.company_name) {
                        showFieldError(editCompanyInput.closest('[form-group]'));
                        isValid = false;
                    }

                    if (!isValidCompanySelection(selectedEditCompany)) {
                        showFieldError(editCompanyInput.closest('[form-group]'));
                        isValid = false;
                    }

                    if (!payload.job_title) {
                        showFieldError(editJobTitleInput.closest('[form-group]'));
                        isValid = false;
                    }

                    if (!isStarterProfileCompanyMonthRangeValid(editStartDateInput, editEndDateInput, payload.current_work)) {
                        showFieldError(editStartDateInput.closest('[form-group]'));
                        showFieldError(editEndDateInput.closest('[form-group]'));
                        setStarterProfileCompanyMonthRangeError(editStartDateInput, editEndDateInput, true);
                        reportStarterProfileCompanyMonthRangeError(editEndDateInput);
                        isValid = false;
                    }

                    if (!isValid) return;

                    const textEl = saveCompanyEditButton.querySelector('.button_main-text');
                    const defaultSaveText = textEl.textContent || 'save changes';

                    try {
                        isSubmitting = true;

                        saveCompanyEditButton.style.pointerEvents = 'none';
                        saveCompanyEditButton.style.opacity = '0.6';
                        textEl.textContent = 'Saving...';

                        if (isDraftCompanyId(companyId)) {
                            window.__tsProfileDirtyState?.markDirty?.(3);
                            pendingCreateDrafts = pendingCreateDrafts.map(function (draft) {
                                return draft.id === companyId
                                    ? { ...draft, ...payload, id: companyId, type: 'create', is_draft: true, pending_type: 'create' }
                                    : draft;
                            });
                            companyDraftDirtyController.queue(companyId);
                        } else {
                            window.__tsProfileDirtyState?.markDirty?.(3);
                            pendingUpdateDrafts.set(String(companyId), payload);
                            companyDraftDirtyController.queue(companyId);
                        }
                        await renderCompanies();

                        textEl.textContent = 'Saved';

                        setTimeout(function () {
                            closeEditCompany(true);

                            saveCompanyEditButton.style.pointerEvents = '';
                            saveCompanyEditButton.style.opacity = '';

                            textEl.textContent = defaultSaveText;
                        }, 800);
                    } catch (error) {
                        console.error('[Companies] edit submit failed:', error);

                        textEl.textContent = 'Error';

                        setTimeout(function () {
                            saveCompanyEditButton.style.pointerEvents = '';
                            saveCompanyEditButton.style.opacity = '';

                            textEl.textContent = defaultSaveText;
                        }, 1200);
                    } finally {
                        isSubmitting = false;
                    }
                });
            }

            if (addBtn) {
                addBtn.addEventListener('click', async function (event) {
                    event.preventDefault();

                    if (isSubmitting) return;

                    if (companiesCount >= MAX) {
                        updateAddBtnState();
                        return;
                    }

                    const selectedAddCompany = selectedCompanyForInput(companyInput);

                    const payload = {
                        company_name: getValue(companyInput),
                        job_title: getValue(jobTitleInput),
                        start_date: serializeStarterProfileCompanyDate(startDateInput, null),
                        end_date: currentWorkCheckbox && currentWorkCheckbox.checked ? "Present" : serializeStarterProfileCompanyDate(endDateInput, null),
                        current_work: currentWorkCheckbox ? currentWorkCheckbox.checked : false,
                        company_domain: selectedAddCompany ? selectedAddCompany.domain : '',
                        company_logo_url: selectedAddCompany ? selectedAddCompany.logo_url : '',
                        company_entity_id: selectedAddCompany ? selectedAddCompany.company_entity_id : 0,
                        company_source: selectedAddCompany ? selectedAddCompany.source : '',
                    };

                    let isValid = true;

                    if (!payload.company_name) {
                        showFieldError(companyInput.closest('[form-group]'));
                        isValid = false;
                    }

                    if (!isValidCompanySelection(selectedAddCompany)) {
                        showFieldError(companyInput.closest('[form-group]'));
                        isValid = false;
                    }

                    if (!payload.job_title) {
                        showFieldError(jobTitleInput.closest('[form-group]'));
                        isValid = false;
                    }

                    const isAddMonthRangeInvalid = !isStarterProfileCompanyMonthRangeValid(startDateInput, endDateInput, payload.current_work);

                    if (isAddMonthRangeInvalid) {
                        showFieldError(startDateInput.closest('[form-group]'));
                        showFieldError(endDateInput.closest('[form-group]'));
                        setStarterProfileCompanyMonthRangeError(startDateInput, endDateInput, true);
                        isValid = false;
                    }

                    if (!isValid) {
                        const currentAccordion = addBtn.previousElementSibling;
                        if (currentAccordion && currentAccordion.classList.contains("profile-dropdown")) {
                            const contentBlock = qs(".all-starters_accordion-content", currentAccordion);
                            if (contentBlock && contentBlock.style.height === '0px') {
                                const toggle = qs('.all-starters_accordion-toggle-button', currentAccordion);
                                if (toggle) toggle.click();
                            }

                        } else {
                            console.warn("Current accordion not found");
                        }

                        if (isAddMonthRangeInvalid) reportStarterProfileCompanyMonthRangeError(endDateInput);

                        return;
                    }

                    let successTiemout = null;

                    try {
                        isSubmitting = true;
                        submitAction = 'adding';
                        clearAddCompanyFeedbackTimeout();
                        updateAddBtnState();

                        window.__tsProfileDirtyState?.markDirty?.(3);
                        const draft = {
                            id: `draft_${Date.now()}_${Math.random()}`,
                            type: 'create',
                            is_draft: true,
                            pending_type: 'create',
                            ...payload,
                        };
                        pendingCreateDrafts.push(draft);
                        companyDraftDirtyController.queue(draft.id);
                        await renderCompanies();

                        resetCompanyFields();
                        setButtonText('Added');

                        addCompanyFeedbackTimeout = setTimeout(function () {
                            addCompanyFeedbackTimeout = null;
                            updateAddBtnState();
                        }, 2000);
                        successTiemout = addCompanyFeedbackTimeout;

                    } catch (error) {
                        console.error('[Companies] submit failed:', error);
                        clearAddCompanyFeedbackTimeout();
                        setButtonText('Error');

                        if (successTiemout) clearTimeout(successTiemout);
                        addCompanyFeedbackTimeout = setTimeout(function () {
                            addCompanyFeedbackTimeout = null;
                            setButtonText(defaultButtonText);
                        }, 1200);

                    } finally {
                        isSubmitting = false;
                        submitAction = '';
                        updateAddBtnState();
                    }
                });
            }

            async function handleCompanySubmitAll(event) {
                event.preventDefault();

                const hasPendingCompanyChanges = Boolean(pendingCreateDrafts.length || pendingUpdateDrafts.size || pendingDeleteDraftIds.size);
                if (!hasPendingCompanyChanges && !hasAlsoWorkedWithChanges()) return;
                if (isSubmitting) return;

                let saved = false;
                let saveToken = null;
                try {
                    saveToken = window.__tsProfileDirtyState?.beginSave(3);
                    isSubmitting = true;
                    submitAction = 'submitting';
                    updateAddBtnState();

                    if (companySubmit) {
                        companySubmit.style.pointerEvents = 'none';
                        companySubmit.style.opacity = '0.6';
                    }

                    await commitAlsoWorkedWith();

                    while (pendingCreateDrafts.length) {
                        const draft = pendingCreateDrafts[0];
                        // Pair a pending create with one pending deletion. Xano commits the
                        // replacement atomically, so a profile already at the three-company
                        // limit can replace a row without deleting it first or briefly exceeding
                        // the limit.
                        const replaceCompanyId = pendingDeleteDraftIds.values().next().value || '';
                        await commitCreateCompanyDraft(draft, replaceCompanyId);
                        if (replaceCompanyId) pendingDeleteDraftIds.delete(String(replaceCompanyId));
                        pendingCreateDrafts.shift();
                    }

                    for (const [companyId, draftPayload] of Array.from(pendingUpdateDrafts.entries())) {
                        await commitUpdateCompanyDraft(companyId, draftPayload);
                        pendingUpdateDrafts.delete(companyId);
                    }

                    await commitDeleteCompanyDrafts();

                    clearAllDraftQueues();
                    saved = true;
                    await renderCompanies();

                    if (editFormSuccessTrigger) editFormSuccessTrigger.dispatchEvent(new Event('click', { bubbles: true }));
                } catch (error) {
                    console.error('[Companies] submit all failed:', error);
                    await renderCompanies();
                    if (editFormErrorTrigger) editFormErrorTrigger.dispatchEvent(new Event('click', { bubbles: true }));
                } finally {
                    window.__tsProfileDirtyState?.finishSave(3, saved, saveToken);
                    isSubmitting = false;
                    submitAction = '';

                    updateCompanySubmitState();
                    updateAddBtnState();
                }
            }

            if (companySubmit) {
                companySubmit.addEventListener('click', handleCompanySubmitAll);
            }

            if (alsoWorkedWithInput) {
                alsoWorkedWithInput.addEventListener('input', updateCompanySubmitState);
                alsoWorkedWithInput.addEventListener('change', updateCompanySubmitState);
                alsoWorkedWithInput.addEventListener('starter:also-worked-with-hydrated', function () {
                    alsoWorkedWithBaseline = alsoWorkedWithInput.value;
                    alsoWorkedWithBaselineReady = true;
                    updateCompanySubmitState();
                });

                setTimeout(function () {
                    alsoWorkedWithBaseline = alsoWorkedWithInput.value;
                    alsoWorkedWithBaselineReady = true;
                    updateCompanySubmitState();
                }, 1500);
            }

            await renderCompanies();
            updateAddBtnState();
            openAddCompanyAccordionIfEmpty();
        });
    });
