
  document.addEventListener('DOMContentLoaded', () => {
    waitForMember(() => {
      if (!MEMBER.id) return;

      waitProfileData(() => {
        const wrappers = qsa('[increment-dropdowns]');
        wrappers.forEach((wrapper) => {
          const addButton = qs('.dropdowns-button .button', wrapper);
          if (!addButton) return;

          let step = wrapper.closest("[data-form='step']");
          if (step && step.dataset.index) {
            step = "step_" + step.dataset.index;
          } else {
            return;
          }

          let profile = activeProfile || '{}';
          console.log("increment-dropdown: profile", profile);

          const original = qs('[increment-dropdown]', wrapper);
          if (!original) return;

          const entity = original.dataset.entity?.toLowerCase();

          let count = qsa('[increment-dropdown]', wrapper).length;
          const MAX = 3;

          initDropdown(original, wrapper, addButton, () => count, (value) => count = value, MAX);
          prePopulateFields(original);

          if (
            entity &&
            profile.data &&
            profile.data[step] &&
            profile.data[step][entity]
          ) {
            const stepData = profile.data[step];
            const fieldsData = {
              second: stepData[entity + "-2"] ? JSON.parse(stepData[entity + "-2"]) : null,
              third: stepData[entity + "-3"] ? JSON.parse(stepData[entity + "-3"]) : null,
            }
            console.log("increment-dropdown: fieldsData", fieldsData);

            if (fieldsData.second) {
              console.log("increment-dropdown: fieldsData.second", fieldsData.third);
              count += 1;

              const newDropdown = addDropdown(fieldsData.second);
              if (!newDropdown) return;

              wrapper.insertBefore(newDropdown, addButton.parentNode);
            }

            if (fieldsData.third) {
              console.log("increment-dropdown: fieldsData.third", fieldsData.third);
              count += 1;
              addButton.style.display = 'none';

              const newDropdown = addDropdown(fieldsData.third);
              if (!newDropdown) return;

              wrapper.insertBefore(newDropdown, addButton.parentNode);
            }
          }

          function addDropdown(capturedData = null) {
            const clone = original.cloneNode(true);
            clone.setAttribute('increment-dropdown', count);

            resetFields(clone);
            formatRateInputs(clone);
            prePopulateFields(clone);
            updateIncrementTitle(clone, count);
            updateInputsNamespace(clone, count);

            if (capturedData) {
              const captureField = qs('[data-input-capture]', clone);
              if (captureField) captureField.value = JSON.stringify(capturedData);
            }

            initDropdown(clone, wrapper, addButton, () => count, (value) => count = value, MAX);

            return clone;
          }

          function prePopulateFields(clone) {
            if (!entity) return;

            const entityName = entity + (count > 1 ? `-${count}` : '');

            if (
              !profile.data ||
              !profile.data?.[step] ||
              !profile.data?.[step]?.[entityName]) {
              return false;
            }

            const fields = qsa('input, textarea, select', clone);
            fields.forEach((field) => {
              if (field.dataset.inputCapture != undefined) return;

              const name = field.dataset.name.replace(`${entity}-`, '');
              const data = JSON.parse(profile.data[step][entityName]);
              const val = data[name];
              if (name && val) {
                field.value = val;
              }
            });
          }

          addButton.addEventListener('click', (e) => {
            e.preventDefault();

            const dropdowns = qsa('[increment-dropdown]', wrapper);
            const active = dropdowns[dropdowns.length - 1];

            const isValid = validateFields(active);
            if (!isValid) {
              const activeToggle = qs('[increment-dropdown-toggle]', active);
              const activeList = qs('[increment-dropdown-content]', active);
              if (!activeToggle || !activeList) return;

              if (activeList.style.height === '0px') {
                activeToggle.click();
              }

              return;
            }

            if (count >= MAX) return;
            count += 1;

            const newDropdown = addDropdown();
            if (!newDropdown) return;

            wrapper.insertBefore(newDropdown, addButton.parentNode);
            formatRateInputs(newDropdown);
            syncDropdownsState(wrapper, addButton, MAX);
          });

          syncDropdownsState(wrapper, addButton, MAX);
          updateAddButtonState(wrapper, addButton, MAX);

          // open first dropdown if only one is present
          if (count === 1) {
            openDropdown(qs('[increment-dropdown="1"]', wrapper));
          }
        });
      })

      function resetFields(node) {
        const fields = qsa('input, textarea, select', node);
        fields.forEach((field) => {
          if (field.type === 'checkbox' || field.type === 'radio') {
            field.checked = false;
          } else {
            field.value = '';
          }

          field.classList.remove('initialized');
        });
      };

      function openDropdown(dropdown) {
        if (!dropdown) return;

        const list = qs('[increment-dropdown-content]', dropdown);
        const openMethod = dropdown.__openIncrementDropdown;

        if (typeof openMethod === 'function') {
          openMethod();
          return;
        }

        const toggle = qs('[increment-dropdown-toggle]', dropdown);

        if (!toggle || !list) return;
        if (list.style.height !== '0px') return;

        toggle.click();
      }

      function getDropdownContentHeight(list) {
        if (!list) return 0;

        const innerWrapper = list.firstElementChild;
        const innerHeight = innerWrapper ? innerWrapper.getBoundingClientRect().height : 0;
        const scrollHeight = list.scrollHeight || 0;

        return Math.max(innerHeight, scrollHeight);
      }

      function updateIncrementTitle(node, index) {
        const allTextNodes = qsa('*', node);
        const entityText = node.dataset.entity || 'Service';
        allTextNodes.forEach((el) => {
          if (el.childElementCount === 0 && el.textContent.includes(entityText)) {
            el.textContent = `${entityText} ${index}`;
          }
        });
      };

      function updateInputsNamespace(node, index) {
        const fields = qsa('input, textarea, select', node);

        fields.forEach((field) => {
          if (field.name) {
            if (!field.dataset.baseName) {
              field.dataset.baseName = field.name.replace(/-\d+$/, '');
            }

            field.name = index > 1
              ? `${field.dataset.baseName}-${index}`
              : field.dataset.baseName;
          }

          if (field.id) {
            if (!field.dataset.baseId) {
              field.dataset.baseId = field.id.replace(/-\d+$/, '');
            }

            field.id = index > 1
              ? `${field.dataset.baseId}-${index}`
              : field.dataset.baseId;
          }
        });
      }

      function syncDropdownsState(wrapper, addButton, MAX) {
        const dropdowns = qsa('[increment-dropdown]', wrapper);
        dropdowns.forEach((dropdown, index) => {
          const currentIndex = index + 1;

          dropdown.setAttribute('increment-dropdown', currentIndex);

          updateIncrementTitle(dropdown, currentIndex);
          updateInputsNamespace(dropdown, currentIndex);

          const removeButton = qs('[increment-dropdown-remove]', dropdown);
          if (removeButton) {
            removeButton.style.display = currentIndex <= 1 ? 'none' : 'block';
          }
        });

        if (addButton) {
          addButton.style.display = dropdowns.length >= MAX ? 'none' : 'flex';
        }

        updateAddButtonState(wrapper, addButton, MAX);
      }

      function updateAddButtonState(wrapper, addButton, MAX) {
        if (!addButton) return;

        const dropdowns = qsa('[increment-dropdown]', wrapper);
        if (dropdowns.length >= MAX) {
          addButton.style.opacity = '';
          addButton.style.pointerEvents = '';
          return;
        }

        const active = dropdowns[dropdowns.length - 1];
        const canAdd = active ? validateFields(active, false) : true;

        addButton.style.display = 'flex';
        addButton.style.opacity = canAdd ? '' : '0.5';
        addButton.style.pointerEvents = canAdd ? '' : 'none';
      }

      function initDropdown(dropdown, wrapper = null, addButton = null, getCount = null, setCount = null, MAX = null) {
        const toggle = qs('[increment-dropdown-toggle]', dropdown);
        const list = qs('[increment-dropdown-content]', dropdown);
        const icon = qs('[increment-dropdown-icon]', dropdown);
        const removeButton = qs('[increment-dropdown-remove]', dropdown);

        let isOpen = false;

        if (!toggle || !list || !icon) return;

        const captureField = qs('[data-input-capture]', dropdown);
        if (captureField) {
          const data = JSON.parse(captureField.value || '{}');
          const fields = qsa('input, textarea, select', dropdown);

          fields.forEach(field => {
            if (field.dataset.inputCapture != undefined) return;

            field.addEventListener('blur', () => {
              const name = field.dataset.name.replace(`${dropdown.dataset.entity.toLowerCase()}-`, '');

              data[name] = field.value;

              // validateFields(dropdown);
              updateAddButtonState(wrapper, addButton, MAX);

              captureField.value = JSON.stringify(data);
              captureField.dispatchEvent(new Event('change', { bubbles: true }));
            });

            field.addEventListener('input', () => {
              updateAddButtonState(wrapper, addButton, MAX);
            });

            field.addEventListener('change', () => {
              updateAddButtonState(wrapper, addButton, MAX);
            });
          });
        }

        if (removeButton) {
          removeButton.addEventListener('click', (e) => {
            e.preventDefault();

            if (!wrapper || !getCount || !setCount) return;

            const first_dropdown = qs('[increment-dropdown="1"]', wrapper);
            if (first_dropdown) {
              const fstCapture = qs('[data-input-capture]', first_dropdown);
              if (fstCapture) {
                fstCapture.dispatchEvent(new Event('input', { bubbles: true }));
                fstCapture.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }

            const dropdowns = qsa('[increment-dropdown]', wrapper);
            if (dropdowns.length <= 1) return;

            dropdown.remove();
            profile = JSON.parse(localStorage.getItem('ts:build_profile:member:' + MEMBER.id) || '{}');

            setCount(getCount() - 1);
            syncDropdownsState(wrapper, addButton, MAX);
            updateAddButtonState(wrapper, addButton, MAX);
          });
        }

        list.style.overflow = 'hidden';
        list.style.height = '0px';
        list.style.transition = 'height .2s linear';

        icon.style.transition = 'transform .3s linear';
        icon.style.transform = 'rotateZ(0deg)';

        const setOpenState = (nextOpen) => {
          isOpen = nextOpen;

          if (isOpen) {
            const expandedHeight = getDropdownContentHeight(list);
            list.style.height = expandedHeight > 0 ? expandedHeight + 'px' : 'auto';
            icon.style.transform = 'rotateZ(180deg)';
            return;
          }

          if (list.style.height === 'auto') {
            const expandedHeight = getDropdownContentHeight(list);
            if (expandedHeight > 0) {
              list.style.height = expandedHeight + 'px';
              void list.offsetHeight;
            }
          }

          list.style.height = '0px';
          icon.style.transform = 'rotateZ(0deg)';
        };

        dropdown.__openIncrementDropdown = () => setOpenState(true);
        dropdown.__closeIncrementDropdown = () => setOpenState(false);

        list.addEventListener('transitionend', () => {
          if (!isOpen) return;

          const expandedHeight = getDropdownContentHeight(list);
          if (expandedHeight > 0) {
            list.style.height = 'auto';
          }
        });

        toggle.addEventListener('click', (e) => {
          e.preventDefault();
          setOpenState(!isOpen);
        });
      }

      function validateFields(node, showAnim = true) {
        let valid = true;

        const fields = qsa('input, textarea', node);
        fields.forEach((field) => {
          if (field.dataset.required === 'true') {
            if (field.value.trim() === '') {
              valid = false;
              // showError(field.closest('[form-group]'));
            } else if (field.name.includes("email") && isValidEmail(field.value.trim()) === false) {
              valid = false;
              // showError(field.closest('[form-group]'));
            }
          }
        });

        return valid;
      }

      function showError(group) {
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

    });

  });
