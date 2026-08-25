/**
 * GitHub-owned copy of the Build Profile Webflow controller block.
 * Original live inline body SHA-256: eb426e9899ccfc9976c5eb061930f122d54542fa33f4453a0602aae48f842f4c
 * Captured read-only from /build-profile/consult on 2026-08-12.
 */
  // Handles company autocomplete via Xano and Logo.dev.
  document.addEventListener('DOMContentLoaded', function () {
    waitForMember(() => {
      if (!MEMBER.id) return;
      
      const inputs = qsa('[logo-search-input]');
      inputs.forEach(function (input) {
        const isMulti = input.hasAttribute('data-multiple');
        logoSearchInit(input, isMulti);
      });
    });
  });

  function logoSearchInit(input, isMulti = false) {
    if (!input) return;

    const group = input.closest('[form-group]');
    if (!group) return;

    const searchGroup = input.closest('[company-search-group]');
    if (!searchGroup) return;

    const SEARCH_ENDPOINT = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/logo-search';
    const PLACEHOLDER_LOGO_URL = 'https://cdn.prod.website-files.com/69c573f20f82bd0f3384032c/6a21517ca6c1caa51f014026_company-placeholder.svg';

    const MAX_COMPANIES = input.dataset.maxCompanies || 20;
    const maxCompaniesInfo = qs('[max-companies-info]', group);
    const valueInput = qs('#also-worked-with', group);

    const dropdown = document.createElement('div');
    dropdown.className = 'company-search-box';
    searchGroup.appendChild(dropdown);

    let timer;
    let lastQuery = '';
    let selectingCompany = false;

    let tagTemplate = null;
    let tagWrapper = null;
    if (isMulti) {
      tagTemplate = qs('[also-worked-tag].is_template', group);
      tagWrapper = qs('[also-worked-wrapper]', group);

      waitProfileData(() => {
        if (
          activeProfile.data &&
          activeProfile.data['step_3'] &&
          activeProfile.data['step_3']['also-worked-with']?.trim()
        ) {
          const selectedCompanies = JSON.parse(activeProfile.data['step_3']['also-worked-with']);

          for (const uniqueId of Object.keys(selectedCompanies)) {
            const company = selectedCompanies[uniqueId];
            if (company.name) {
              renderNewTag(company.name, company.domain || '', null, uniqueId, company.logo_url || '');
            }
          }
        }
      })
    }

    function syncValue() {
      let companies = {};

      qsa("[also-worked-tag]", tagWrapper).forEach(function (tag) {
        companies[tag.dataset.uniqueId] = {
          "name": qs("[also-worked-tag-name]", tag).textContent,
          "domain": qs("[also-worked-tag-domain]", tag).textContent,
          "logo_url": tag.dataset.logoUrl || ""
        }
      });

      valueInput.value = JSON.stringify(companies);
      valueInput.dispatchEvent(new Event('input', { bubbles: true }));
      valueInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function openDropdown() {
      dropdown.style.display = 'block';
    }

    function closeDropdown() {
      dropdown.style.display = 'none';
    }

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, function (char) {
        return {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#039;',
        }[char];
      });
    }

    function renderMessage(text) {
      dropdown.innerHTML = `
                    <div class="company-search-message">${escapeHtml(text)}</div>
                `;
      openDropdown();
    }

    function renderResults(results) {
      if (!results.length) {
        const typedCompany = input.value.trim();

        dropdown.innerHTML = `
          <button class="company-search-item ${isCompanyAdded({ name: typedCompany }) ? "is-added" : ""}" type="button" data-name="${escapeHtml(typedCompany)}" data-domain="" data-logo-url="">
              <img class="company-search-logo" src="${PLACEHOLDER_LOGO_URL}" alt="">
              <span class="company-search-text">
                  <span class="company-search-name">${escapeHtml(typedCompany || 'Company not found')}</span>
                  <span class="company-search-domain">Use custom company</span>
              </span>
              <span class="company-search-delete">
                  <svg style="pointer-events: none;" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true"
                      role="img" class="iconify iconify--ic" width="100%" height="100%"
                      preserveAspectRatio="xMidYMid meet" viewBox="0 0 24 24">
                      <path fill="currentColor"
                          d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12z">
                      </path>
                  </svg>
              </span>
          </button>
      `;

        openDropdown();
        return;
      }

      dropdown.innerHTML = results
        .map(function (item) {
          return `
            <button class="company-search-item ${isCompanyAdded(item) ? "is-added" : ""}" type="button" data-name="${escapeHtml(item.name)}" data-domain="${escapeHtml(item.domain)}" data-logo-url="${escapeHtml(item.logo_url || '')}">
                <img class="company-search-logo" src="${escapeHtml(item.logo_url || PLACEHOLDER_LOGO_URL)}" alt="">
                <span class="company-search-text">
                    <span class="company-search-name">${escapeHtml(item.name)}</span>
                    <span class="company-search-domain">${escapeHtml(item.domain)}</span>
                </span>
                <span class="company-search-delete">
                    <svg style="pointer-events: none;" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true"
                        role="img" class="iconify iconify--ic" width="100%" height="100%"
                        preserveAspectRatio="xMidYMid meet" viewBox="0 0 24 24">
                        <path fill="currentColor"
                            d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12z">
                        </path>
                    </svg>
                </span>
            </button>
        `;
        })
        .join('');

      openDropdown();
    }

    async function searchCompanies(query) {
      const q = query.trim();

      if (selectingCompany) return;

      if (q.length < 2) {
        closeDropdown();
        return;
      }

      if (q === lastQuery) {
        openDropdown();
        return;
      }

      lastQuery = q;
      renderMessage('Searching...');

      try {
        const response = await fetch(`${SEARCH_ENDPOINT}?q=${encodeURIComponent(q)}`);
        const results = await response.json();

        renderResults(Array.isArray(results) ? results : []);
      } catch (error) {
        renderMessage('Search unavailable');
      }
    }

    input.addEventListener('focus', function () {
      searchCompanies(input.value);
    });

    input.addEventListener('input', function () {
      if (selectingCompany) return;

      clearTimeout(timer);
      timer = setTimeout(function () {
        searchCompanies(input.value);
      }, 250);
    });

    function isCompanyAdded(company) {
      if (!isMulti) return false;
      if (!company) return false;

      const existingDomains = qsa('[also-worked-tag]', tagWrapper);
      for (const existingCompany of existingDomains) {
        const name = qs('[also-worked-tag-name]', existingCompany)?.textContent?.trim();
        const domain = qs('[also-worked-tag-domain]', existingCompany)?.textContent?.trim();

        if (
          (company.domain && domain) &&
          domain === company.domain
        ) {
          return true;
        }

        if (
          (!company.domain || !domain) &&
          name === company.name
        ) {
          return true;
        }
      }

      return false;
    }

    function isMaxCompanies() {
      if (!isMulti) return false;

      const currentCount = qsa('[also-worked-tag]', tagWrapper).length;
      return currentCount >= MAX_COMPANIES;
    }

    function showCapacityError(element) {
      if (!element) return;

      setTimeout(() => {
        element.classList.add('is-error');
        setTimeout(() => {
          element.classList.remove('is-error');
        }, 200);
        setTimeout(() => {
          element.classList.add('is-error');
        }, 400);
        setTimeout(() => {
          element.classList.remove('is-error');
        }, 600);
      }, 300);
    }

    function renderNewTag(selectedName, selectedDomain, item, uniqueId, selectedLogoUrl = '') {
      if (!tagTemplate || !tagWrapper) return;
      if (!selectedName) return;

      const newTag = tagTemplate.cloneNode(true);
      newTag.classList.remove('is_template');
      newTag.dataset.uniqueId = uniqueId || crypto.randomUUID();
      newTag.dataset.logoUrl = selectedLogoUrl || item?.dataset?.logoUrl || '';
      qs('[also-worked-tag-name]', newTag).textContent = selectedName;
      qs('[also-worked-tag-domain]', newTag).textContent = selectedDomain;
      qs('[also-worked-tag-delete]', newTag).addEventListener('click', function () {
        newTag.remove();

        // remove item from the list
        const name = selectedName;
        const domain = selectedDomain;

        syncValue();

        const existingItems = qsa('.company-search-item.is-added', searchGroup);

        for (const company of existingItems) {
          const companyName = company.dataset.name;
          const companyDomain = company.dataset.domain;

          if (
            (companyDomain && domain) &&
            domain === companyDomain
          ) {
            company.classList.remove('is-added');
            break;
          }

          if (
            (!companyDomain || !domain) &&
            name === companyName
          ) {
            company.classList.remove('is-added');
            break;
          }
        }
      });

      tagWrapper.appendChild(newTag);
      input.value = "";

      if (item) {
        item.classList.add('is-added');
      }

      syncValue();

      closeDropdown();
      input.focus();
    }

    dropdown.addEventListener('click', function (event) {
      const item = event.target.closest('.company-search-item');
      if (!item || item.classList.contains('is-added')) return;

      selectingCompany = true;
      const selectedName = item.dataset.name;
      const selectedDomain = item.dataset.domain || '';
      const selectedLogoUrl = item.dataset.logoUrl || '';
      const outOfCapacity = isMaxCompanies();

      if (isMulti && !outOfCapacity) {
        renderNewTag(selectedName, selectedDomain, item, undefined, selectedLogoUrl);

      } else {
        input.value = selectedName;
        lastQuery = selectedName;
        closeDropdown();
      }

      if (outOfCapacity) {
        showCapacityError(maxCompaniesInfo);
      }

      setTimeout(function () {
        selectingCompany = false;
      }, 0);
    });

    dropdown.addEventListener('click', function (event) {
      const companyDelete = event.target.closest('.company-search-delete');
      if (!companyDelete) return;

      const item = companyDelete.closest('.company-search-item');
      if (!item) return;

      item.classList.remove('is-added');

      // remove tag from the list
      const domain = item.dataset.domain;
      const name = item.dataset.name;
      const existingTags = qsa('[also-worked-tag]', tagWrapper);
      for (const company of existingTags) {
        const companyName = qs('[also-worked-tag-name]', company)?.textContent;
        const companyDomain = qs('[also-worked-tag-domain]', company)?.textContent;

        if (
          (companyDomain && domain) &&
          domain === companyDomain
        ) {
          company.remove();
          break;
        }

        if (
          (!companyDomain || !domain) &&
          name === companyName
        ) {
          company.remove();
          break;
        }
      }

      syncValue();
    });

    document.addEventListener('click', function (event) {
      if (!searchGroup.contains(event.target)) closeDropdown();
    });
  }
