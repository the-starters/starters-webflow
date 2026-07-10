// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/datepicker

  (function () {
    'use strict'

    var INPUT_SELECTOR = '[data-input-datepicker]'
    var GROUP_SELECTOR = '[data-input-datepicker-group]'
    var MODAL_SELECTOR = '[data-input-datepicker-modal]'
    var INIT_ATTR = 'data-input-datepicker-initialized'
    var NS_KEY = '__wfInputDatepicker'

    var ensureNamespace = function () {
      window[NS_KEY] = window[NS_KEY] || { uiLoading: false, bound: false }
      return window[NS_KEY]
    }

    /** Read a per-input option attribute; returns fallback when absent/empty. */
    var getOpt = function (el, name, fallback) {
      var v = el.getAttribute('data-input-datepicker-' + name)
      return v === null || v === '' ? fallback : v
    }

    // Tracks the input the open picker belongs to, plus its scroll/resize handler.
    var openPicker = { input: null, handler: null, raf: 0 }

    /** Stop tracking the open picker and drop its scroll/resize listeners. */
    var stopTracking = function () {
      if (openPicker.handler) {
        window.removeEventListener('scroll', openPicker.handler, true)
        window.removeEventListener('resize', openPicker.handler)
      }
      if (openPicker.raf) cancelAnimationFrame(openPicker.raf)
      openPicker = { input: null, handler: null, raf: 0 }
    }

    /**
     * Anchor the picker directly under its input. jQuery UI sets top/left as document
     * (or viewport, when an ancestor is position:fixed) coordinates and may leave the
     * picker position:fixed — once it's reparented into the modal both break: the picker
     * drifts by the modal's offset and, if fixed, unsticks from the input on scroll.
     * Force position:absolute and recompute top/left against the picker's real offset
     * parent so it sits on the input and scrolls with the modal content.
     */
    var positionPicker = function (input) {
      var dp = document.getElementById('ui-datepicker-div')
      if (!dp || dp.style.display === 'none') return

      dp.style.position = 'absolute'
      var op = dp.offsetParent || document.body
      var opr = op.getBoundingClientRect()
      var ir = input.getBoundingClientRect()
      var left = ir.left - opr.left - op.clientLeft + op.scrollLeft
      var top = ir.bottom - opr.top - op.clientTop + op.scrollTop

      var maxLeft = op.clientWidth - dp.offsetWidth
      if (left > maxLeft) left = maxLeft
      if (left < 0) left = 0

      dp.style.left = left + 'px'
      dp.style.top = top + 'px'
    }

    /** Keep the picker glued to its input while the user scrolls (any container) or resizes. */
    var trackPicker = function (input) {
      stopTracking()
      var handler = function () {
        if (openPicker.raf) return
        openPicker.raf = requestAnimationFrame(function () {
          openPicker.raf = 0
          var dp = document.getElementById('ui-datepicker-div')
          if (!dp || dp.style.display === 'none' || !document.body.contains(input)) {
            stopTracking()
            return
          }
          positionPicker(input)
        })
      }
      openPicker.input = input
      openPicker.handler = handler
      // capture phase so scrolling on an inner modal/scroll container is caught too
      window.addEventListener('scroll', handler, true)
      window.addEventListener('resize', handler)
    }

    /** When the input lives in a modal, reparent the shared picker div so it isn't clipped. */
    var moveDatepickerIntoModal = function ($, input) {
      var $modal = $(input).closest(MODAL_SELECTOR)
      if (!$modal.length) $modal = $(input).closest('.modal_dialog')
      if (!$modal.length) return

      setTimeout(function () {
        $('#ui-datepicker-div').appendTo($modal)
        positionPicker(input)
        trackPicker(input)
      }, 0)
    }

    /** Build the datepicker options shared by single and paired inputs. */
    var baseOptions = function ($, inputEl) {
      var opts = {
        numberOfMonths: parseInt(getOpt(inputEl, 'months', '1'), 10) || 1,
        dateFormat: getOpt(inputEl, 'format', 'mm/dd/yy'),
        beforeShow: function (input) {
          moveDatepickerIntoModal($, input)
        },
        onClose: function () {
          stopTracking()
        }
      }
      var min = getOpt(inputEl, 'min', null)
      var max = getOpt(inputEl, 'max', null)
      if (min !== null) opts.minDate = min
      if (max !== null) opts.maxDate = max
      return opts
    }

    var initStandalone = function ($, inputEl) {
      if ($(inputEl).data('datepicker')) return
      $(inputEl).datepicker(baseOptions($, inputEl))
    }

    /** Wire two inputs as a start/end range, keeping each side's bound a day clear of the other. */
    var initPair = function ($, startEl, endEl) {
      var $start = $(startEl)
      var $end = $(endEl)

      var lockEndMin = function () {
        var dt = $start.datepicker('getDate')
        if (!dt) return
        dt = new Date(dt.getTime())
        dt.setDate(dt.getDate() + 1)
        $end.datepicker('option', 'minDate', dt)
      }

      var lockStartMax = function () {
        var dt = $end.datepicker('getDate')
        if (!dt) return
        dt = new Date(dt.getTime())
        dt.setDate(dt.getDate() - 1)
        $start.datepicker('option', 'maxDate', dt)
      }

      if (!$start.data('datepicker')) {
        var startOpts = baseOptions($, startEl)
        startOpts.onSelect = lockEndMin
        $start.datepicker(startOpts)
      }

      if (!$end.data('datepicker')) {
        var endOpts = baseOptions($, endEl)
        endOpts.onSelect = lockStartMax
        $end.datepicker(endOpts)
      }

      // Prefilled values (Webflow defaults, sp-current-date embed) never fire
      // onSelect — apply the range locks from whatever is already in the fields.
      lockEndMin()
      lockStartMax()
    }

    var initGroup = function ($, groupEl) {
      if (groupEl.getAttribute(INIT_ATTR) === 'true') return

      var startEl = groupEl.querySelector(INPUT_SELECTOR + '[data-input-datepicker-role="start"]')
      var endEl = groupEl.querySelector(INPUT_SELECTOR + '[data-input-datepicker-role="end"]')

      if (startEl && endEl) {
        initPair($, startEl, endEl)
      } else {
        // Group present but not a full pair — treat any inputs inside as standalone.
        Array.prototype.forEach.call(groupEl.querySelectorAll(INPUT_SELECTOR), function (el) {
          initStandalone($, el)
        })
      }

      groupEl.setAttribute(INIT_ATTR, 'true')
    }

    var collect = function (root, selector) {
      var out = []
      if (root.matches && root.matches(selector)) out.push(root)
      Array.prototype.push.apply(out, root.querySelectorAll(selector))
      return out
    }

    var initDatepickers = function (scope) {
      var $ = window.jQuery
      if (!$ || !$.fn.datepicker) return

      var root = scope && scope.nodeType === 1 ? scope : document

      collect(root, GROUP_SELECTOR).forEach(function (groupEl) {
        initGroup($, groupEl)
      })

      // Standalone inputs that aren't part of a group.
      collect(root, INPUT_SELECTOR).forEach(function (inputEl) {
        if (inputEl.closest(GROUP_SELECTOR)) return
        initStandalone($, inputEl)
      })
    }

    var bindGlobalListeners = function () {
      var ns = ensureNamespace()
      if (ns.bound) return
      ns.bound = true

      window.addEventListener('modal-open', function (event) {
        if (event.detail && event.detail.modal) {
          initDatepickers(event.detail.modal)
        }
      })
    }

    var run = function () {
      bindGlobalListeners()
      initDatepickers(document)
    }

    var loadDatepickerEmbed = function () {
      var $ = window.jQuery
      if (!$) {
        setTimeout(loadDatepickerEmbed, 50)
        return
      }

      var ns = ensureNamespace()

      if ($.fn.datepicker) {
        run()
        return
      }

      if (ns.uiLoading) {
        var wait = setInterval(function () {
          if ($.fn.datepicker) {
            clearInterval(wait)
            run()
          }
        }, 50)
        return
      }

      ns.uiLoading = true
      var script = document.createElement('script')
      script.src = 'https://code.jquery.com/ui/1.14.1/jquery-ui.min.js'
      script.onload = function () {
        ns.uiLoading = false
        run()
      }
      document.head.appendChild(script)
    }

    loadDatepickerEmbed()
  })()