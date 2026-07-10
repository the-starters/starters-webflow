// Docs: https://wf-starter-embeds-docs.vercel.app/docs/freelancer-cms/datepicker-current

  (function () {
    'use strict'

    var SELECTOR = '[data-set-current-date]'
    var INIT_ATTR = 'data-set-current-date-inited'
    var DEFAULT_FORMAT = 'mm/dd/yy'

    /** Format via jQuery UI when present, else a small mm/dd/yy token fallback. */
    var formatDate = function (format, date) {
      var $ = window.jQuery
      if ($ && $.datepicker) return $.datepicker.formatDate(format, date)
      var dd = ('0' + date.getDate()).slice(-2)
      var mm = ('0' + (date.getMonth() + 1)).slice(-2)
      return format
        .replace(/yy/g, String(date.getFullYear()))
        .replace(/mm/g, mm)
        .replace(/dd/g, dd)
    }

    var resolveFormat = function (el) {
      return (
        el.getAttribute('data-set-current-date') ||
        el.getAttribute('data-input-datepicker-format') ||
        DEFAULT_FORMAT
      )
    }

    /**
     * Write today's date into one element. Idempotent via data-set-current-date-inited
     * so re-runs (modal reopen, script pasted twice) don't clobber a user's edit.
     */
    var fillElement = function (el) {
      if (el.getAttribute(INIT_ATTR) === 'true') return

      var today = new Date()
      var value = formatDate(resolveFormat(el), today)
      var isField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'

      if (isField) {
        el.value = value
        var $ = window.jQuery
        if ($ && $.fn.datepicker && $(el).data('datepicker')) {
          $(el).datepicker('setDate', today)
        }
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      } else {
        el.textContent = value
      }

      el.setAttribute(INIT_ATTR, 'true')
    }

    var collect = function (root, selector) {
      var out = []
      if (root.matches && root.matches(selector)) out.push(root)
      Array.prototype.push.apply(out, root.querySelectorAll(selector))
      return out
    }

    var fillCurrentDates = function (scope) {
      var root = scope && scope.nodeType === 1 ? scope : document
      collect(root, SELECTOR).forEach(fillElement)
    }

    var run = function () {
      fillCurrentDates(document)

      // Modal content may render/enable late — refill when a modal opens.
      window.addEventListener('modal-open', function (event) {
        if (event.detail && event.detail.modal) fillCurrentDates(event.detail.modal)
      })
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run)
    } else {
      run()
    }
  })()