function isStarterProfileCompanyPresentDate(value) {
  return String(value || '').trim().toLowerCase() === 'present';
}

function starterProfileCompanyDatepickerValue(value) {
  const text = String(value || '').trim();
  if (!text || isStarterProfileCompanyPresentDate(text)) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (isoMatch) {
    const date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    if (
      date.getFullYear() === Number(isoMatch[1]) &&
      date.getMonth() === Number(isoMatch[2]) - 1 &&
      date.getDate() === Number(isoMatch[3])
    ) return date;
  }

  const monthYearMatch = text.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthYearMatch) {
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthIndex = monthNames.indexOf(monthYearMatch[1].slice(0, 3).toLowerCase());
    if (monthIndex >= 0) return new Date(Number(monthYearMatch[2]), monthIndex, 1);
  }

  return text;
}

function setStarterProfileCompanyDatepickerDate(input, value) {
  if (!input || typeof jQuery === 'undefined' || !jQuery.fn.datepicker || !jQuery(input).data('datepicker')) return;
  if (isStarterProfileCompanyPresentDate(value)) return;

  try {
    jQuery(input).datepicker('setDate', starterProfileCompanyDatepickerValue(value));
  } catch (error) {
    // The value may not match the widget's configured dateFormat.
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
  return currentValue;
}

/**
 * GitHub-owned copy of the Build Profile Webflow controller block.
 * Original live inline body SHA-256: 6dc7fa7306d9558fb493cb6a6cfd6196659e0b7005c6d49831ffcc5f3261b5d3
 * Captured read-only from /build-profile/consult on 2026-08-12.
 */
  // Loads, renders, and creates company experience records from Xano.
  document.addEventListener('DOMContentLoaded', function () {
    waitForMember(async () => {
      if (!MEMBER.id) return;
      
      const XANO_GET_COMPANIES_URL = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies';
      const XANO_CREATE_COMPANY_URL = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies';

      const XANO_UPDATE_COMPANY_URL = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies';
      const XANO_DELETE_COMPANY_URL = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies';
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
      const addCompanyButton = qs('#add-company');
      const dropdownToggleLabel = qs('[dropdown-toggle-label]');

      const editCompanyWrapper = qs('#edit-company-wrapper');
      const editCompanyInput = qs('#edit-company-name');
      const editJobTitleInput = qs('#edit-company-position');
      const editStartDateInput = qs('#edit-company-start');
      const editEndDateInput = qs('#edit-company-end');
      const editCurrentWorkCheckbox = qs('#edit-company-current');

      const modalEdit = qs('[data-modal-target="company-edit"]');
      const modalEditTrigger = qs('[data-modal-trigger="company-edit"]');
      const modalEditClose = qs('[data-modal-close]', modalEdit);

      const modalRemove = qs('[data-modal-target="company-remove"]');
      const modalRemoveTrigger = qs('[data-modal-trigger="company-remove"]');
      const modalRemoveClose = qs('[data-modal-close]', modalRemove);

      const removeSubmitButton = qs('[company-remove-submit]');
      const saveCompanyEditButton = qs('[save-company-edit]');
      const cancelCompanyEditButton = qs('[cancel-company-edit]');

      let editSelectedCompany = null;
      let editStartDateBaseline = null;
      let editEndDateBaseline = null;
      let isLimitReached = false;

      if (!companyList || !companyTemplate) {
        console.warn('[Companies] .company-list or .company-card template not found');
      }

      if (!addCompanyButton) {
        console.warn('[Companies] #add-company not found');
      }

      let isSubmitting = false;
      let submitAction = '';
      let selectedCompany = null;
      let companiesCount = 0;
      let addCompanyFeedbackTimeout = null;

      const placeholderLogo = 'https://cdn.prod.website-files.com/69c573f20f82bd0f3384032c/6a21517ca6c1caa51f014026_company-placeholder.svg';
      const textEl = addCompanyButton ? qs('div:first-child', addCompanyButton) : null;
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
        const text = String(value || '').trim();
        if (!text || text.toLowerCase() === 'present') return text;

        const parts = text.split(/\s+/);
        if (parts.length < 2) return text;

        return `${parts[0]} ${parts[parts.length - 1]}`;
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

      function updateAddCompanyButtonState() {
        if (!addCompanyButton) return;

        isLimitReached = companiesCount >= MAX;
        const isFormReady = hasRequiredCompanyFields();
        const isDisabled = isLimitReached || !isFormReady || isSubmitting;

        addCompanyButton.style.display = isLimitReached ? 'none' : 'flex';
        addCompanyButton.style.pointerEvents = isDisabled ? 'none' : '';
        addCompanyButton.style.opacity = isDisabled ? '0.5' : '';
        addCompanyButton.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');

        const currentAccordion = addCompanyButton.previousElementSibling;

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

      function openAddCompanyAccordionIfEmpty() {
        if (!addCompanyButton || companiesCount > 0) return;

        const currentAccordion = addCompanyButton.previousElementSibling;
        if (!currentAccordion || !currentAccordion.classList.contains('profile-dropdown')) return;

        const contentBlock = qs('.all-starters_accordion-content', currentAccordion);
        if (!contentBlock || contentBlock.style.height !== '0px') return;

        const toggle = qs('.all-starters_accordion-toggle-button', currentAccordion);
        if (toggle) toggle.click();
      }

      function syncFirstCompanyInput() {
        if (!firstCompanyInput) return;

        firstCompanyInput.value = companiesCount > 0 ? 'true' : '';

        firstCompanyInput.dispatchEvent(new Event('change', { bubbles: true }));
        firstCompanyInput.dispatchEvent(new Event('input', { bubbles: true }));
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

          const sortedCompanies = [...companies].sort((a, b) => {
            const aSort = getCompanySortData(a, companies.indexOf(a));
            const bSort = getCompanySortData(b, companies.indexOf(b));

            if (aSort.priority !== bSort.priority) {
              return aSort.priority - bSort.priority;
            }

            if (aSort.timestamp !== bSort.timestamp) {
              return bSort.timestamp - aSort.timestamp;
            }

            return aSort.index - bSort.index;
          });

          companiesCount = companies.length;
          starter_xano_id = starter_id;

          syncFirstCompanyInput();

          qsa('.company-card:not(:first-child)', companyList).forEach(function (card) {
            card.remove();
          });

          companyTemplate.style.display = 'none';

          sortedCompanies.forEach(function (company) {
            companyList.appendChild(createCompanyCard(company));
          });

          updateAddCompanyButtonState();
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

      function triggerFieldEvents(input) {
        if (!input) return;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }

      function resetCompanyFields() {
        clearAddCompanyFeedbackTimeout();

        if (companyInput) {
          companyInput.value = '';
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

        selectedCompany = null;
        updateAddCompanyButtonState();
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

        editCompanyWrapper.dataset.id = company.id || '';

        if (editCompanyInput) {
          editCompanyInput.value = company.company_name || '';
        }

        if (editJobTitleInput) {
          editJobTitleInput.value = company.job_title || '';
        }

        if (editStartDateInput) {
          const rawStartDate = company.start_date || '';
          editStartDateInput.value = rawStartDate;
          setDatepickerDate(editStartDateInput, rawStartDate);
          editStartDateBaseline = starterProfileCompanyDateBaseline(editStartDateInput, rawStartDate);
        }

        if (editEndDateInput) {
          editEndDateInput.value = company.current_work ? 'Present' : (company.end_date || '');

          if (company.current_work) {
            editEndDateInput.setAttribute('disabled', 'disabled');
            editEndDateInput.classList.toggle('is-disabled', !!company.current_work);
          }

          if (company.end_date && !company.current_work) {
            setDatepickerDate(editEndDateInput, company.end_date);
          } else {
            setDatepickerDate(editEndDateInput, null);
          }

          editEndDateBaseline = starterProfileCompanyDateBaseline(
            editEndDateInput,
            company.current_work ? 'Present' : company.end_date,
          );
        }

        setCheckboxState(editCurrentWorkCheckbox, !!company.current_work);

        editSelectedCompany = {
          name: company.company_name || '',
          domain: company.company_domain || '',
          logo_url: getCompanyLogo(company),
        };

        openEditModal();
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

          editSelectedCompany = null;
          editStartDateBaseline = null;
          editEndDateBaseline = null;
        }, 800);
      }

      function updateRemoveSubmitId(id = null) {
        if (!removeSubmitButton) return;
        removeSubmitButton.dataset.id = id || '';
      }

      document.addEventListener('click', function (event) {
        const companyItem = event.target.closest('.company-search-item[data-name]');
        if (!companyItem) return;

        const logo = qs('.company-search-logo', companyItem);
        const searchGroup = companyItem.closest('[company-search-group]');
        const input = searchGroup ? qs('[logo-search-input]', searchGroup) : null;

        const companyData = {
          name: companyItem.dataset.name || '',
          domain: companyItem.dataset.domain || '',
          logo_url: logo ? logo.src : '',
        };

        if (input && input.id === 'edit-company-name') {
          editSelectedCompany = companyData;
        } else {
          selectedCompany = companyData;
        }
      });

      [companyInput, jobTitleInput].forEach(function (input) {
        if (!input) return;

        input.addEventListener('input', updateAddCompanyButtonState);
        input.addEventListener('change', updateAddCompanyButtonState);
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
            updateAddCompanyButtonState();
            textEl.textContent = 'Removing...';

            await deleteCompany(removeSubmitButton.dataset.id);
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
            updateAddCompanyButtonState();
          }
        });
      }

      if (saveCompanyEditButton) {
        saveCompanyEditButton.addEventListener('click', async function (event) {
          event.preventDefault();

          if (isSubmitting || !editCompanyWrapper) return;

          const companyId = editCompanyWrapper.dataset.id;
          if (!companyId) return;

          const payload = {
            freelancers_id: starter_xano_id,
            company_name: getValue(editCompanyInput),
            job_title: getValue(editJobTitleInput),
            start_date: serializeStarterProfileCompanyDate(editStartDateInput, editStartDateBaseline),
            end_date: editCurrentWorkCheckbox && editCurrentWorkCheckbox.checked ? "Present" : serializeStarterProfileCompanyDate(editEndDateInput, editEndDateBaseline),
            current_work: editCurrentWorkCheckbox ? editCurrentWorkCheckbox.checked : false,
            company_domain: editSelectedCompany ? editSelectedCompany.domain : '',
            company_logo_url: editSelectedCompany && editSelectedCompany.logo_url ? editSelectedCompany.logo_url : placeholderLogo,
          };

          let isValid = true;

          if (!payload.company_name) {
            showFieldError(editCompanyInput.closest('[form-group]'));
            isValid = false;
          }

          if (!payload.job_title) {
            showFieldError(editJobTitleInput.closest('[form-group]'));
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

            await updateCompany(companyId, payload);
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

      if (addCompanyButton) {
        addCompanyButton.addEventListener('click', async function (event) {
          event.preventDefault();

          if (isSubmitting) return;

          if (companiesCount >= MAX) {
            updateAddCompanyButtonState();
            return;
          }

          const payload = {
            freelancers_id: starter_xano_id,
            company_name: getValue(companyInput),
            job_title: getValue(jobTitleInput),
            start_date: getValue(startDateInput),
            end_date: currentWorkCheckbox && currentWorkCheckbox.checked ? "Present" : getValue(endDateInput),
            current_work: currentWorkCheckbox ? currentWorkCheckbox.checked : false,
            company_domain: selectedCompany ? selectedCompany.domain : '',
            company_logo_url: selectedCompany && selectedCompany.logo_url ? selectedCompany.logo_url : placeholderLogo,
          };

          let isValid = true;

          if (!payload.company_name) {
            showFieldError(companyInput.closest('[form-group]'));
            isValid = false;
          }

          if (!payload.job_title) {
            showFieldError(jobTitleInput.closest('[form-group]'));
            isValid = false;
          }

          if (!isValid) {
            const currentAccordion = addCompanyButton.previousElementSibling;
            if (currentAccordion && currentAccordion.classList.contains("profile-dropdown")) {
              const contentBlock = qs(".all-starters_accordion-content", currentAccordion);
              if (contentBlock && contentBlock.style.height === '0px') {
                const toggle = qs('.all-starters_accordion-toggle-button', currentAccordion);
                if (toggle) toggle.click();
              }

            } else {
              console.warn("Current accordion not found");
            }

            return;
          }

          let successTiemout = null;

          try {
            isSubmitting = true;
            submitAction = 'adding';
            clearAddCompanyFeedbackTimeout();
            updateAddCompanyButtonState();

            await createCompany(payload);
            await renderCompanies();

            resetCompanyFields();
            setButtonText('Added');

            addCompanyFeedbackTimeout = setTimeout(function () {
              addCompanyFeedbackTimeout = null;
              updateAddCompanyButtonState();
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
            updateAddCompanyButtonState();
          }
        });
      }

      await renderCompanies();
      updateAddCompanyButtonState();
      openAddCompanyAccordionIfEmpty();
    });
  });
