// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/form-input-filter

  /**
   * Global form filter — show one block of inputs based on a select / radio choice.
   *
   * Add the CSS in the page Head or in another Embed on the same page.
   *
   * Webflow setup:
   * 1. Put `data-input-filter="wrapper"` on the element that wraps one control + its list.
   * 2. Put `data-input-filter="select"` on the <select>, OR `data-input-filter="radio-group"`
   *    on the wrapper that holds the radio buttons.
   * 3. Put `data-input-filter="list"` on the wrapper that holds the swappable blocks.
   * 4. Put `data-input-filter-item="Hourly Rate"` on each block. The value must match the
   *    control's selected option/radio value (e.g. selecting "Hourly Rate" shows the
   *    `data-input-filter-item="Hourly Rate"` block and hides the rest).
   *
   * Each wrapper scopes one filter group — you can have many on a page.
   *
   * Optional settings on the list wrapper:
   * - `data-input-filter-disable="off"` keeps hidden fields enabled (by default hidden fields
   *   are disabled so duplicate names don't submit twice).
   *
   * Hidden blocks also lose `required` / `aria-required="true"` so Webflow's native validation
   * does not block submit. Restored when the block is shown. Removed fields get
   * `data-input-filter-required-removed="true"` (or `data-input-filter-aria-required-removed`).
   *
   * Do not add `data-input-filter-inited`. The script adds it automatically.
   */
  (function () {
    'use strict';

    var CONTROL_QUERY = '[data-input-filter="select"], [data-input-filter="radio-group"]';
    var FIELD_QUERY = 'input, select, textarea';

    function trimStr(v) {
      if (v == null) return '';
      return String(v).replace(/^\s+|\s+$/g, '');
    }

    /** Read the current value from a select or a radio-group control. */
    function readControlValue(control) {
      var kind = control.getAttribute('data-input-filter');
      if (kind === 'radio-group') {
        var checked = control.querySelector('input[type="radio"]:checked');
        return checked ? trimStr(checked.value) : '';
      }
      // Plain <select> (or any element exposing .value).
      return trimStr(control.value);
    }

    /**
     * Find the control paired with a given list inside its wrapper.
     * Falls back to ancestor walk when no wrapper is present.
     * @returns {Element|null}
     */
    function findControlForList(list) {
      var wrapper = list.closest('[data-input-filter="wrapper"]');
      if (wrapper) return wrapper.querySelector(CONTROL_QUERY);

      var p = list.parentElement;
      while (p) {
        var control = p.querySelector(CONTROL_QUERY);
        if (control) return control;
        p = p.parentElement;
      }
      return null;
    }

    /** Enable/disable every form field inside an item so hidden blocks don't submit. */
    function setFieldsDisabled(item, disabled) {
      var fields = item.querySelectorAll(FIELD_QUERY);
      for (var i = 0; i < fields.length; i++) {
        fields[i].disabled = disabled;
      }
    }

    /** Drop native required so hidden blocks don't block Webflow submit. */
    function removeRequiredFromItem(item) {
      var fields = item.querySelectorAll(FIELD_QUERY);
      for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        if (field.required) {
          field.required = false;
          field.setAttribute('data-input-filter-required-removed', 'true');
        }
        if (field.getAttribute('aria-required') === 'true') {
          field.removeAttribute('aria-required');
          field.setAttribute('data-input-filter-aria-required-removed', 'true');
        }
      }
    }

    /** Put required back on fields this script stripped when the block is shown again. */
    function restoreRequiredToItem(item) {
      var fields = item.querySelectorAll(FIELD_QUERY);
      for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        if (field.getAttribute('data-input-filter-required-removed') === 'true') {
          field.required = true;
          field.removeAttribute('data-input-filter-required-removed');
        }
        if (field.getAttribute('data-input-filter-aria-required-removed') === 'true') {
          field.setAttribute('aria-required', 'true');
          field.removeAttribute('data-input-filter-aria-required-removed');
        }
      }
    }

    /**
     * Show the item whose value matches, hide the rest.
     * @param {Element} list the list wrapper
     * @param {string} value the control's current value
     * @param {boolean} disableHidden disable fields in hidden items
     */
    function applyFilter(list, value, disableHidden) {
      var items = list.querySelectorAll('[data-input-filter-item]');
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var match = value !== '' && trimStr(item.getAttribute('data-input-filter-item')) === value;
        if (match) {
          item.removeAttribute('hidden');
          restoreRequiredToItem(item);
          if (disableHidden) setFieldsDisabled(item, false);
        } else {
          item.setAttribute('hidden', '');
          removeRequiredFromItem(item);
          if (disableHidden) setFieldsDisabled(item, true);
        }
      }
    }

    function initOneList(list) {
      if (!list || list.getAttribute('data-input-filter-inited') === 'true') return;
      var control = findControlForList(list);
      if (!control) return;
      list.setAttribute('data-input-filter-inited', 'true');

      var disableHidden = list.getAttribute('data-input-filter-disable') !== 'off';

      function refresh() {
        applyFilter(list, readControlValue(control), disableHidden);
      }

      control.addEventListener('change', refresh);
      refresh();
    }

    function initAll() {
      var lists = document.querySelectorAll('[data-input-filter="list"]');
      for (var i = 0; i < lists.length; i++) {
        initOneList(lists[i]);
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initAll, { once: true });
    } else {
      initAll();
    }
  })();