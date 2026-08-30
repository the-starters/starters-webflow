
  var activeProfile = createEmptyProfile();

  /* GLOBAL METHODS */
  function isValidEmail(email) {
    return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email);
  }

  function ensureErrorElements(errorEl, wrapElement, errorText) {
    errorEl = document.createElement('div');
    errorEl.id = 'email-error';
    errorEl.style.cssText = `position: absolute; left: 0; bottom: -22px; color: #e11d48; font-size: 0.75rem; font-weight: 400; line-height: 1.2; white-space: nowrap; display: none; z-index: 10;`;
    errorEl.textContent = errorText;
    wrapElement.appendChild(errorEl);
  }

  function createEmptyProfile(type = 'full', type_id = 'a52dcf2c568fa40bf96cd67e4f8c6186', last_update = null) {
    /* --- Webflow type ids
    full - a52dcf2c568fa40bf96cd67e4f8c6186
    consult - ca6ff4250b7d01b49e83433432af3686
  */
    return {
      type,
      type_id,
      last_update,
      data: {},
    };
  }

  function waitProfileData(callback) {
    const initInterval = setInterval(() => {
      if (activeProfile.last_update !== null) {
        clearInterval(initInterval);
        setTimeout(() => {
          callback();
        }, 100);
      }
    }, 50);
  }

  /* Format Rate input */
  function formatRateInputs(wrapper = null) {
    const inputs = qsa('[data-element="rate"]:not(.initialized)', wrapper);
    inputs.forEach((input) => {
      input.classList.add('initialized');
      input.addEventListener('input', () => {
        let value = input.value;
        value = value.replace(/[^0-9.]/g, '');

        const parts = value.split('.');
        if (parts.length > 2) {
          value = parts[0] + '.' + parts[1];
        }

        if (parts[1]) {
          value = parts[0] + '.' + parts[1].slice(0, 2);
        }

        input.value = value;
      });

      input.addEventListener('blur', () => {
        let value = parseFloat(input.value);

        if (!isNaN(value)) {
          input.value = value.toFixed(2);
        } else {
          input.value = '';
        }
      });
    });
  }

  async function fillRefLists() {
    const wrappers = Array.from(document.querySelectorAll('[ref-list-wrapper][data-entity]'));

    if (!wrappers.length) {
      return;
    }

    const allowedEntities = new Set(['categories', 'industries', 'skills', 'tools']); // 'roles' & 'subcategories' are with category, it's separated, and working from webflow-collection
    const endpointBaseUrl = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/build_profile/get_';
    const entityCache = new Map();
    const CACHE_TTL_MS = 60 * 60 * 1000;
    const CACHE_PREFIX = 'build_profile_ref_list_';

    function getCacheKey(entity) {
      return CACHE_PREFIX + entity;
    }

    function getCachedEntityItems(entity) {
      try {
        const raw = localStorage.getItem(getCacheKey(entity));

        if (!raw) {
          return null;
        }

        const parsed = JSON.parse(raw);
        const hasValidTimestamp = parsed && typeof parsed.timestamp === 'number';
        const hasValidItems = parsed && Array.isArray(parsed.items);

        if (!hasValidTimestamp || !hasValidItems) {
          localStorage.removeItem(getCacheKey(entity));
          return null;
        }

        if (Date.now() - parsed.timestamp > CACHE_TTL_MS) {
          localStorage.removeItem(getCacheKey(entity));
          return null;
        }

        return parsed.items;
      } catch (error) {
        console.warn('fillRefLists cache read error for entity:', entity, error);
        return null;
      }
    }

    function setCachedEntityItems(entity, items) {
      try {
        localStorage.setItem(
          getCacheKey(entity),
          JSON.stringify({
            timestamp: Date.now(),
            items,
          }),
        );
      } catch (error) {
        console.warn('fillRefLists cache write error for entity:', entity, error);
      }
    }

    async function loadEntityItems(entity) {
      if (entityCache.has(entity)) {
        return entityCache.get(entity);
      }

      const cachedItems = getCachedEntityItems(entity);

      if (cachedItems) {
        const cachedPromise = Promise.resolve(cachedItems);

        entityCache.set(entity, cachedPromise);

        return cachedPromise;
      }

      const requestPromise = fetch(endpointBaseUrl + entity)
        .then((response) => {
          if (!response.ok) {
            throw new Error('Failed to load ' + entity + ': ' + response.status);
          }

          return response.json();
        })
        .then((payload) => {
          const list = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : [];

          return list
            .map((item) => ({
              id: String(item && item.id != null ? item.id : '').trim(),
              name: String(item && item.name != null ? item.name : '').trim(),
            }))
            .filter((item) => item.id && item.name)
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        })
        .then((items) => {
          setCachedEntityItems(entity, items);
          return items;
        })
        .catch((error) => {
          console.error('fillRefLists error for entity:', entity, error);
          return [];
        });

      entityCache.set(entity, requestPromise);

      return requestPromise;
    }

    const entities = [...new Set(wrappers.map((wrapper) => String(wrapper.getAttribute('data-entity') || '').trim().toLowerCase()).filter(Boolean))];

    await Promise.all(
      entities.map(async (entity) => {
        if (!allowedEntities.has(entity)) {
          console.warn('fillRefLists skipped unknown entity:', entity);
          return;
        }

        await loadEntityItems(entity);
      }),
    );

    await Promise.all(
      wrappers.map(async (wrapper) => {
        const entity = String(wrapper.getAttribute('data-entity') || '').trim().toLowerCase();

        if (!allowedEntities.has(entity)) {
          return;
        }

        const items = await loadEntityItems(entity);
        const fragment = document.createDocumentFragment();

        wrapper.querySelectorAll('[fs-list-element="select-value"]').forEach((node) => {
          node.remove();
        });

        items.forEach((item) => {
          const el = document.createElement('div');

          el.setAttribute('fs-list-element', 'select-value');
          el.dataset.id = item.id;
          el.textContent = item.name;

          fragment.appendChild(el);
        });

        wrapper.appendChild(fragment);
      }),
    );

    handleCustomSelects();
  }

  /* CUSTOM SELECTS */
  function handleCustomSelects() {
    $('[ms-code-select-wrapper]:not(.ready):not(.js-more-hundred)').each(function () {
      const $wrapper = $(this);
      const isMulti = $wrapper.attr('ms-code-select-wrapper') === 'multi';
      const $input = $wrapper.find('[ms-code-select="input"]');

      // using for profile-data capturing and prepopulation
      const $input_value = $wrapper.find('[ms-code-select="input-value"]');

      // using for step-form validation
      const $input_required = $wrapper.find('[ms-code-select="input-required"]');

      const MAX_SELECTIONS = $input.attr('ms-code-select-max') ? parseInt($input.attr('ms-code-select-max')) : 3;
      const MIN_SELECTIONS = $input.attr('ms-code-select-min') ? parseInt($input.attr('ms-code-select-min')) : '0';
      const $list = $wrapper.find('[ms-code-select="list"]');
      const $selectedWrapper = $wrapper.find('[ms-code-select="selected-wrapper"]');
      const $emptyState = $wrapper.find('[ms-code-select="empty-state"]');
      const scrollContainer = $wrapper[0].closest('[scroll-container]');

      // options from Webflow Collection items
      let options = $wrapper
        .closest('[fs-list-instance]')
        .find('[fs-list-element="select-value"]')
        .map(function () {
          const $item = $(this);

          return {
            name: $item.text().trim(),
            id: String($item.attr('data-id') || '').trim(),
          };
        })
        .get()
        .filter((opt) => opt.name && opt.id);

      $wrapper.addClass('ready');

      let selectedOptions = [];
      let highlightedIndex = -1;
      let listOpenedByTap = false;
      let activeScrollTop = 0;
      let lastSettledSelectionKey = '';
      let hasPendingSelectionChange = false;

      const $templateSelectedTag = $selectedWrapper.find('[ms-code-select="tag"]');
      const templateSelectedTagHTML = $templateSelectedTag.prop('outerHTML');
      $templateSelectedTag.remove();

      const $templateNewTag = $list.find('[ms-code-select="tag-name-new"]');
      const templateNewTagHTML = $templateNewTag.prop('outerHTML');
      $templateNewTag.remove();

      function filterOptionsKeepScroll() {
        filterOptions();

        let l_scroll = activeScrollTop;

        requestAnimationFrame(() => {
          $list.scrollTop(l_scroll);
        });
      }

      function getSelectedOptionsKey() {
        return selectedOptions.map((option) => option.id).join(',');
      }

      function updatePendingSelectionChange() {
        hasPendingSelectionChange = getSelectedOptionsKey() !== lastSettledSelectionKey;
      }

      function settleSelectionState() {
        lastSettledSelectionKey = getSelectedOptionsKey();
        hasPendingSelectionChange = false;
      }

      function resetInputToSelectionState() {
        updateInput();
        highlightedIndex = -1;
        updateHighlight();
        filterOptions();
      }

      $list.on('scroll', function () {
        activeScrollTop = $list.scrollTop();
      });

      let isInteractingWithList = false;
      $list.on('touchstart mousedown', function () {
        isInteractingWithList = true;
      });
      $list.on('touchend mouseup', function () {
        setTimeout(() => {
          isInteractingWithList = false;
        }, 150);
      });

      function showWarning() {
        let $msg = $wrapper.find('#ms-limit-error');

        if (!$msg.length) {
          $msg = $('<div id="ms-limit-error" style="color:#e11d48;font-size:0.75rem;font-weight:400;line-height:1.2;white-space:nowrap;margin-top:4px;position:relative;z-index:0;">You can only select up to ' + MAX_SELECTIONS + ' options.</div>');
          $list.after($msg);
        }

        $msg.show();
      }

      function hideWarning() {
        $wrapper.find('#ms-limit-error').hide();
      }

      function updateListState() {
        if (!isMulti) return;

        const atLimit = selectedOptions.length >= MAX_SELECTIONS;

        $list.find('[ms-code-select="tag-name-new"]').each(function () {
          const $opt = $(this);

          const option = {
            name: $opt.text().trim(),
            id: String($opt.attr('data-id') || '').trim(),
          };

          $opt.off('click');

          if (atLimit) {
            $opt.css({
              opacity: '0.4',
              cursor: 'not-allowed',
            });

            $opt.on('click', function () {
              toggleList(false);
              showWarning();
            });
          } else {
            $opt.css({
              opacity: '',
              cursor: '',
            });

            $opt.on('click', function () {
              selectOption(option);
            });
          }
        });
      }

      function createSelectedTag(option) {
        const $newTag = $(templateSelectedTagHTML);

        $newTag.find('[ms-code-select="tag-name-selected"]').text(option.name);

        $newTag.find('[ms-code-select="tag-close"]').on('click', function (e) {
          e.stopPropagation();
          removeTag(option.id);
        });

        return $newTag;
      }

      function addTag(option) {
        if (isMulti && selectedOptions.length >= MAX_SELECTIONS) {
          return;
        }

        const alreadySelected = selectedOptions.some((selected) => selected.id === option.id);

        const existsInOptions = options.some((opt) => opt.id === option.id);

        if (!alreadySelected && existsInOptions) {
          selectedOptions.push(option);

          $selectedWrapper.append(createSelectedTag(option));

          updateInput();
          checkOnMin();
          filterOptionsKeepScroll();
          scrollToEndContainer();
          updateListState();
          updatePendingSelectionChange();
        }
      }

      function checkOnMin() {
        if ($input_value.length && MIN_SELECTIONS) {
          const idsValue = selectedOptions.map((option) => option.id).join(', ');

          if (selectedOptions.length >= Number(MIN_SELECTIONS)) {
            if ($input_required.length) {
              $input_required.val(idsValue);
            }
          } else {
            if ($input_required.length) {
              $input_required.val('');
            }
          }

          $input_value.val(idsValue);

          $input_value[0].dispatchEvent(
            new Event('change', {
              bubbles: true,
            }),
          );

          $input_value[0].dispatchEvent(
            new Event('input', {
              bubbles: true,
            }),
          );

          if ($input_required.length) {
            $input_required[0].dispatchEvent(
              new Event('change', {
                bubbles: true,
              }),
            );

            $input_required[0].dispatchEvent(
              new Event('input', {
                bubbles: true,
              }),
            );
          }
        }
      }

      function removeTag(id) {
        selectedOptions = selectedOptions.filter((option) => option.id !== id);

        $selectedWrapper
          .find('[ms-code-select="tag"]')
          .filter(function () {
            const tagName = $(this).find('[ms-code-select="tag-name-selected"]').text().trim();

            const matchingOption = options.find((option) => option.id === id);

            return matchingOption && tagName === matchingOption.name;
          })
          .remove();

        updateInput();
        checkOnMin();
        filterOptions();
        updateListState();

        if (selectedOptions.length < MAX_SELECTIONS) {
          hideWarning();
        }

        updatePendingSelectionChange();

        $input.trigger('change');
        // $input.trigger("input");

        if (!isMobile()) {
          $input.focus();
        }
      }

      function isMobile() {
        return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
      }

      function updateInput() {
        $input.val(selectedOptions.map((option) => option.name).join(', '));
      }

      function scrollToEndContainer() {
        if (scrollContainer) {
          requestAnimationFrame(() => {
            const listRect = $list[0].getBoundingClientRect();

            const containerRect = scrollContainer.getBoundingClientRect();

            const overflowBottom = listRect.bottom - containerRect.bottom;

            if (overflowBottom > 0) {
              scrollContainer.scrollTo({
                top: scrollContainer.scrollTop + overflowBottom + 16,
              });
            }
          });
        }
      }

      function toggleList(show) {
        $list.toggle(show);

        if (show) {
          updateListState();
          scrollToEndContainer();
        }
      }

      function createOptionElement(option) {
        const $option = $(templateNewTagHTML);

        $option.text(option.name);
        $option.attr('data-id', option.id);

        $option.on('click', function () {
          selectOption(option);
        });

        return $option;
      }

      function selectOption(option) {
        if (isMulti) {
          addTag(option);

          const isSelected = selectedOptions.some((selected) => selected.id === option.id);

          if (isSelected) {
            updateInput();
            checkOnMin();
          }

          if (selectedOptions.length >= MAX_SELECTIONS) {
            toggleList(false);
          } else if (!isMobile()) {
            $input.focus();
          }
        } else {
          const previousSelectionKey = getSelectedOptionsKey();

          selectedOptions = [option];

          $selectedWrapper.empty().append(createSelectedTag(option));

          updateInput();
          checkOnMin();
          toggleList(false);

          hasPendingSelectionChange = getSelectedOptionsKey() !== previousSelectionKey || getSelectedOptionsKey() !== lastSettledSelectionKey;
        }

        filterOptionsKeepScroll();

        $input[0].dispatchEvent(
          new Event('change', {
            bubbles: true,
          }),
        );
      }

      function filterOptions() {
        const inputValue = $input.val();

        const selectedValue = selectedOptions.map((option) => option.name).join(', ');

        const searchTerm = isMulti && inputValue === selectedValue ? '' : isMulti ? inputValue.split(',').pop().trim() : inputValue.trim();

        let visibleOptionsCount = 0;
        let hasInSelected = false;

        $list.find('[ms-code-select="tag-name-new"]').each(function () {
          const $option = $(this);

          const optionText = $option.text().toLowerCase();

          const optionId = String($option.attr('data-id') || '').trim();

          const matches = optionText.includes(searchTerm.toLowerCase());

          const isSelected = selectedOptions.some((selected) => selected.id === optionId);

          $option.toggle(matches && !isSelected);

          if (matches && !isSelected) {
            visibleOptionsCount++;
          }

          if (isSelected) {
            hasInSelected = true;
          }
        });

        if (searchTerm !== '') {
          $list.find('.form_option-category').hide();
        } else {
          $list.find('.form_option-category').each(function () {
            const $category = $(this);
            let hasVisible = false;

            $category.nextUntil('.form_option-category', '[ms-code-select="tag-name-new"]').each(function () {
              if ($(this).is(':visible')) {
                hasVisible = true;
                return false;
              }
            });

            $category.toggle(hasVisible);
          });
        }

        $emptyState.toggle(visibleOptionsCount === 0 && searchTerm !== '' && !hasInSelected);

        highlightedIndex = -1;

        updateHighlight();
        updateListState();
      }

      function cleanInput() {
        $selectedWrapper.empty();

        selectedOptions.forEach((option) => {
          $selectedWrapper.append(createSelectedTag(option));
        });

        updateInput();
        checkOnMin();
        filterOptions();
        updatePendingSelectionChange();
      }

      function handleInputChange() {
        filterOptions();
      }

      function initializeWithValue() {
        const initialValue = $input_value.val();

        if (initialValue) {
          const initialValues = initialValue
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean);

          initialValues.forEach((value) => {
            const matchingOption = options.find((option) => option.id === value || option.name === value);

            if (matchingOption) {
              addTag(matchingOption);
            }
          });

          updateInput();
          checkOnMin();
          filterOptions();
        }

        settleSelectionState();
      }

      function updateHighlight() {
        $list.find('[ms-code-select="tag-name-new"]').removeClass('highlighted').css('background-color', '');

        if (highlightedIndex >= 0) {
          $list.find('[ms-code-select="tag-name-new"]:visible').eq(highlightedIndex).addClass('highlighted').css('background-color', '#eee');
        }
      }

      function handleKeyDown(e) {
        const visibleOptions = $list.find('[ms-code-select="tag-name-new"]:visible');

        const optionCount = visibleOptions.length;

        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();

            if (!optionCount) return;

            highlightedIndex = (highlightedIndex + 1) % optionCount;

            updateHighlight();
            break;

          case 'ArrowUp':
            e.preventDefault();

            if (!optionCount) return;

            highlightedIndex = (highlightedIndex - 1 + optionCount) % optionCount;

            updateHighlight();
            break;

          case 'Enter':
            e.preventDefault();

            if (highlightedIndex >= 0) {
              const $selectedOption = visibleOptions.eq(highlightedIndex);

              selectOption({
                name: $selectedOption.text().trim(),
                id: String($selectedOption.attr('data-id') || '').trim(),
              });
            }

            break;
        }
      }

      $.each(options, function (i, option) {
        $list.append(createOptionElement(option));
      });

      $input.on('touchstart', function (e) {
        if (isMobile() && !$list.is(':visible')) {
          e.preventDefault();

          listOpenedByTap = true;

          if (isMulti) {
            this.selectionStart = this.selectionEnd = this.value.length;
          }

          toggleList(true);
          filterOptions();
        }
      });

      $input.on('focus', function () {
        if (!listOpenedByTap) {
          toggleList(true);

          if (isMulti) {
            this.selectionStart = this.selectionEnd = this.value.length;
          }

          filterOptions();
        }

        listOpenedByTap = false;
      });

      $input.on('click', function (e) {
        e.preventDefault();

        this.selectionStart = this.selectionEnd = this.value.length;
      });

      $input.on('blur', function () {
        setTimeout(function () {
          if (!isInteractingWithList) {
            toggleList(false);
            cleanInput();
            settleSelectionState();
          }
        }, 100);
      });

      $input.on('input', handleInputChange);
      $input.on('keydown', handleKeyDown);

      $list.on('mouseenter', '[ms-code-select="tag-name-new"]', function () {
        if (selectedOptions.length < MAX_SELECTIONS) {
          $(this).css('background-color', '#eee');
        }
      });

      $list.on('mouseleave', '[ms-code-select="tag-name-new"]', function () {
        if (!$(this).hasClass('highlighted')) {
          $(this).css('background-color', '');
        }
      });

      document.addEventListener('click', function (e) {
        if (!$wrapper[0].contains(e.target)) {
          if (hasPendingSelectionChange) {
            $input.trigger('blur');
          } else {
            toggleList(false);
            resetInputToSelectionState();
            settleSelectionState();
          }
        }
      });

      waitProfileData(() => {
        initializeWithValue();
      });

      toggleList(false);
    });
  }
