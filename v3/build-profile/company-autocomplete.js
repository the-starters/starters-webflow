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
    let renderedQuery = '';
    let pendingQuery = '';
    let selectingCompany = false;
    let searchSequence = 0;
    let activeSearchController = null;

    function cancelActiveSearch() {
      if (activeSearchController) activeSearchController.abort();
      activeSearchController = null;
      pendingQuery = '';
    }

    function storeSingleSelection(name, domain, logoUrl, companyEntityId, source) {
      input.dataset.selectedCompanyName = name || '';
      input.dataset.selectedCompanyDomain = domain || '';
      input.dataset.selectedCompanyLogoUrl = logoUrl || '';
      input.dataset.selectedCompanyEntityId = String(Number(companyEntityId) || 0);
      input.dataset.selectedCompanySource = source || '';
    }

    function clearStaleSingleSelection() {
      if (isMulti) return;
      if ((input.dataset.selectedCompanyName || '') === input.value.trim()) return;
      delete input.dataset.selectedCompanyName;
      delete input.dataset.selectedCompanyDomain;
      delete input.dataset.selectedCompanyLogoUrl;
      delete input.dataset.selectedCompanyEntityId;
      delete input.dataset.selectedCompanySource;
    }

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
              renderNewTag(company.name, company.domain || '', null, uniqueId, company.logo_url || '', company.company_entity_id, company.source);
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
          "logo_url": tag.dataset.logoUrl || "",
          "company_entity_id": Number(tag.dataset.companyEntityId) || 0,
          "source": tag.dataset.companySource || ""
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
      cancelActiveSearch();
      searchSequence += 1;
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

    function renderDropdown(html, query) {
      renderedQuery = query;
      dropdown.innerHTML = html;
      openDropdown();
    }

    function renderMessage(text) {
      renderDropdown(`
                    <div class="company-search-message">${escapeHtml(text)}</div>
                `, '');
    }

    function renderResults(results, query, statusMessage = '') {
      const typedCompany = input.value.trim();
      const resultItems = results
        .map(function (item) {
          return `
            <button class="company-search-item ${isCompanyAdded(item) ? "is-added" : ""}" type="button" data-name="${escapeHtml(item.name)}" data-domain="${escapeHtml(item.domain)}" data-logo-url="${escapeHtml(item.logo_url || '')}" data-company-entity-id="${Number(item.company_entity_id) || 0}" data-source="${escapeHtml(item.source || '')}">
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
      if (statusMessage) {
        resultItems.unshift(`<div class="company-search-message">${escapeHtml(statusMessage)}</div>`);
      }
      resultItems.push(`
          <button class="company-search-item ${isCompanyAdded({ name: typedCompany, domain: '' }) ? "is-added" : ""}" type="button" data-name="${escapeHtml(typedCompany)}" data-domain="" data-logo-url="" data-company-entity-id="0" data-source="custom">
              <img class="company-search-logo" src="${PLACEHOLDER_LOGO_URL}" alt="">
              <span class="company-search-text">
                  <span class="company-search-name">${escapeHtml(typedCompany)}</span>
                  <span class="company-search-domain">Use custom company</span>
              </span>
          </button>
        `);

      renderDropdown(resultItems.join(''), query);
    }

    async function searchCompanies(query) {
      const q = query.trim();

      if (selectingCompany) return;

      if (q.length < 2) {
        closeDropdown();
        return;
      }

      if (q === renderedQuery || q === pendingQuery) {
        openDropdown();
        return;
      }

      pendingQuery = q;
      renderMessage('Searching...');
      const sequence = ++searchSequence;
      cancelActiveSearch();
      pendingQuery = q;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      activeSearchController = controller;

      try {
        const response = await fetch(`${SEARCH_ENDPOINT}?q=${encodeURIComponent(q)}`, controller ? { signal: controller.signal } : undefined);
        if (!response.ok) throw new Error(`Company search failed (${response.status})`);
        const results = await response.json();
        if (sequence !== searchSequence) return;

        renderResults(Array.isArray(results) ? results : [], q);
      } catch (error) {
        if (error?.name !== 'AbortError' && sequence === searchSequence) {
          renderResults([], '', 'Search unavailable. You can still use a custom company.');
        }
      } finally {
        if (sequence === searchSequence) {
          pendingQuery = '';
          if (activeSearchController === controller) activeSearchController = null;
        }
      }
    }

    input.addEventListener('focus', function () {
      searchCompanies(input.value);
    });

    input.addEventListener('input', function () {
      if (selectingCompany) return;

      clearStaleSingleSelection();
      cancelActiveSearch();
      searchSequence += 1;

      clearTimeout(timer);
      timer = setTimeout(function () {
        searchCompanies(input.value);
      }, 250);
    });

    function companyFromTag(tag) {
      return {
        name: qs('[also-worked-tag-name]', tag)?.textContent,
        domain: qs('[also-worked-tag-domain]', tag)?.textContent,
        company_entity_id: Number(tag.dataset.companyEntityId) || 0,
      };
    }

    function companyFromItem(item) {
      return {
        name: item.dataset.name,
        domain: item.dataset.domain,
        company_entity_id: Number(item.dataset.companyEntityId) || 0,
      };
    }

    function isSameCompany(first, second) {
      const firstName = String(first?.name || '').trim().toLowerCase();
      const secondName = String(second?.name || '').trim().toLowerCase();
      const firstDomain = String(first?.domain || '').trim().toLowerCase();
      const secondDomain = String(second?.domain || '').trim().toLowerCase();
      const firstEntityId = Number(first?.company_entity_id) || 0;
      const secondEntityId = Number(second?.company_entity_id) || 0;

      if (firstEntityId > 0 && secondEntityId === firstEntityId) return true;
      if (firstDomain && secondDomain) return firstDomain === secondDomain;
      return firstName === secondName;
    }

    function isCompanyAdded(company) {
      if (!isMulti || !company) return false;
      return qsa('[also-worked-tag]', tagWrapper).some(function (tag) {
        return isSameCompany(company, companyFromTag(tag));
      });
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

    function renderNewTag(selectedName, selectedDomain, item, uniqueId, selectedLogoUrl = '', companyEntityId = 0, source = '') {
      if (!tagTemplate || !tagWrapper) return;
      if (!selectedName) return;
      if (isCompanyAdded({ name: selectedName, domain: selectedDomain, company_entity_id: companyEntityId })) return;

      const newTag = tagTemplate.cloneNode(true);
      newTag.classList.remove('is_template');
      newTag.dataset.uniqueId = uniqueId || crypto.randomUUID();
      newTag.dataset.logoUrl = selectedLogoUrl || item?.dataset?.logoUrl || '';
      newTag.dataset.companyEntityId = String(Number(companyEntityId || item?.dataset?.companyEntityId) || 0);
      newTag.dataset.companySource = source || item?.dataset?.source || '';
      qs('[also-worked-tag-name]', newTag).textContent = selectedName;
      qs('[also-worked-tag-domain]', newTag).textContent = selectedDomain;
      qs('[also-worked-tag-delete]', newTag).addEventListener('click', function () {
        newTag.remove();

        // remove item from the list
        const removedCompany = companyFromTag(newTag);

        syncValue();

        const existingItems = qsa('.company-search-item.is-added', searchGroup);

        for (const company of existingItems) {
          if (isSameCompany(removedCompany, companyFromItem(company))) company.classList.remove('is-added');
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
      if (!item) return;

      const selectedCompany = companyFromItem(item);
      if (isMulti && isCompanyAdded(selectedCompany)) return;

      selectingCompany = true;
      const selectedName = selectedCompany.name;
      const selectedDomain = selectedCompany.domain || '';
      const selectedLogoUrl = item.dataset.logoUrl || '';
      const selectedCompanyEntityId = selectedCompany.company_entity_id;
      const selectedSource = item.dataset.source || '';
      const outOfCapacity = isMaxCompanies();

      if (isMulti && !outOfCapacity) {
        renderNewTag(selectedName, selectedDomain, item, undefined, selectedLogoUrl, selectedCompanyEntityId, selectedSource);

      } else {
        input.value = selectedName;
        renderedQuery = selectedName;
        storeSingleSelection(selectedName, selectedDomain, selectedLogoUrl, selectedCompanyEntityId, selectedSource);
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
      const selectedCompany = companyFromItem(item);
      const existingTags = qsa('[also-worked-tag]', tagWrapper);
      for (const company of existingTags) {
        if (isSameCompany(selectedCompany, companyFromTag(company))) {
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
