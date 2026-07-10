// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/timepicker
/* This is the code for timepicker with attribute selector, just tag your input with these attributes and it'll work. More docs soon to add the actual attributes for the datepicker and timepickers */

  (function () {
    'use strict'

    var INPUT_SELECTOR = '[data-input-timepicker]'
    var GROUP_SELECTOR = '[data-input-timepicker-group]'
    var MODAL_SELECTOR = '[data-input-timepicker-modal]'
    var INIT_ATTR = 'data-input-timepicker-initialized'
    var NS_KEY = '__wfInputTimepicker'

    var UI_SRC = 'https://code.jquery.com/ui/1.14.1/jquery-ui.min.js'
    var ADDON_JS = 'https://cdnjs.cloudflare.com/ajax/libs/jquery-ui-timepicker-addon/1.6.3/jquery-ui-timepicker-addon.min.js'
    var ADDON_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/jquery-ui-timepicker-addon/1.6.3/jquery-ui-timepicker-addon.min.css'

    var ensureNamespace = function () {
      window[NS_KEY] = window[NS_KEY] || { loading: false, bound: false }
      return window[NS_KEY]
    }

    /** Read a per-input option attribute; returns fallback when absent/empty. */
    var getOpt = function (el, name, fallback) {
      var v = el.getAttribute('data-input-timepicker-' + name)
      return v === null || v === '' ? fallback : v
    }

    /** Format a Date's time as HH:mm:ss for use as a minTime/maxTime bound. */
    var toBound = function (dt) {
      var pad = function (n) { return (n < 10 ? '0' : '') + n }
      return pad(dt.getHours()) + ':' + pad(dt.getMinutes()) + ':' + pad(dt.getSeconds())
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
     * Anchor the picker to its input. jQuery UI sets top/left as document
     * (or viewport, when an ancestor is position:fixed) coordinates and may leave the
     * picker position:fixed — once it's reparented into the modal both break: the picker
     * drifts by the modal's offset and, if fixed, unsticks from the input on scroll.
     * Force position:absolute and recompute top/left against the picker's real offset
     * parent so it sits on the input and scrolls with the modal content. The time picker
     * is tall, so flip it above the input when there's more room there than below (keeps
     * the Hour/Minute dropdowns + Done button on-screen on short/mobile viewports).
     */
    var positionPicker = function (input) {
      var dp = document.getElementById('ui-datepicker-div')
      if (!dp || dp.style.display === 'none') return

      dp.style.position = 'absolute'
      var op = dp.offsetParent || document.body
      var opr = op.getBoundingClientRect()
      var ir = input.getBoundingClientRect()
      var left = ir.left - opr.left - op.clientLeft + op.scrollLeft

      var dpH = dp.offsetHeight
      var spaceBelow = window.innerHeight - ir.bottom
      var spaceAbove = ir.top
      var placeAbove = dpH > spaceBelow && spaceAbove > spaceBelow

      var top = placeAbove
        ? ir.top - opr.top - op.clientTop + op.scrollTop - dpH
        : ir.bottom - opr.top - op.clientTop + op.scrollTop

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
    var moveTimepickerIntoModal = function ($, input) {
      var $modal = $(input).closest(MODAL_SELECTOR)
      if (!$modal.length) $modal = $(input).closest('.modal_dialog')
      if (!$modal.length) return

      setTimeout(function () {
        $('#ui-datepicker-div').appendTo($modal)
        positionPicker(input)
        trackPicker(input)
      }, 0)
    }

    /** Build the timepicker options shared by single and paired inputs. */
    var baseOptions = function ($, inputEl) {
      var opts = {
        timeFormat: getOpt(inputEl, 'format', 'HH:mm'),
        // 'select' = clean hour/minute dropdowns; 'slider' = the addon default.
        controlType: getOpt(inputEl, 'control', 'select'),
        stepHour: parseInt(getOpt(inputEl, 'step-hour', '1'), 10) || 1,
        stepMinute: parseInt(getOpt(inputEl, 'step', '5'), 10) || 5,
        beforeShow: function (input) {
          moveTimepickerIntoModal($, input)
        },
        onClose: function () {
          stopTracking()
        }
      }
      var min = getOpt(inputEl, 'min', null)
      var max = getOpt(inputEl, 'max', null)
      if (min !== null) opts.minTime = min
      if (max !== null) opts.maxTime = max
      return opts
    }

    var isInited = function ($, el) {
      return $(el).data('wfTimepickerInited') === true
    }

    var markInited = function ($, el) {
      $(el).data('wfTimepickerInited', true)
    }

    var initStandalone = function ($, inputEl) {
      if (isInited($, inputEl)) return
      $(inputEl).timepicker(baseOptions($, inputEl))
      markInited($, inputEl)
    }

    /** Wire two inputs as a start/end range — end can't be before start, and vice-versa. */
    var initPair = function ($, startEl, endEl) {
      var $start = $(startEl)
      var $end = $(endEl)

      if (!isInited($, startEl)) {
        var startOpts = baseOptions($, startEl)
        startOpts.onSelect = function () {
          var dt = $start.timepicker('getDate')
          if (!dt) return
          $end.timepicker('option', 'minTime', toBound(dt))
        }
        $start.timepicker(startOpts)
        markInited($, startEl)
      }

      if (!isInited($, endEl)) {
        var endOpts = baseOptions($, endEl)
        endOpts.onSelect = function () {
          var dt = $end.timepicker('getDate')
          if (!dt) return
          $start.timepicker('option', 'maxTime', toBound(dt))
        }
        $end.timepicker(endOpts)
        markInited($, endEl)
      }
    }

    var initGroup = function ($, groupEl) {
      if (groupEl.getAttribute(INIT_ATTR) === 'true') return

      var startEl = groupEl.querySelector(INPUT_SELECTOR + '[data-input-timepicker-role="start"]')
      var endEl = groupEl.querySelector(INPUT_SELECTOR + '[data-input-timepicker-role="end"]')

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

    var initTimepickers = function (scope) {
      var $ = window.jQuery
      if (!$ || !$.fn.timepicker) return

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
          initTimepickers(event.detail.modal)
        }
      })
    }

    var run = function () {
      bindGlobalListeners()
      initTimepickers(document)
    }

    /** Inject a stylesheet once (addon CSS). */
    var ensureCss = function (href) {
      if (document.querySelector('link[href="' + href + '"]')) return
      var link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      document.head.appendChild(link)
    }

    /** Load a script once and call back when ready. */
    var loadScript = function (src, onload) {
      var existing = document.querySelector('script[src="' + src + '"]')
      if (existing) {
        existing.addEventListener('load', onload)
        return
      }
      var script = document.createElement('script')
      script.src = src
      script.onload = onload
      document.head.appendChild(script)
    }

    /** Ensure jQuery UI datepicker is present (the addon builds on it), then continue. */
    var withJqueryUi = function ($, next) {
      if ($.fn.datepicker) {
        next()
        return
      }
      loadScript(UI_SRC, next)
    }

    /** Ensure the timepicker-addon is present, then continue. */
    var withAddon = function ($, next) {
      ensureCss(ADDON_CSS)
      if ($.fn.timepicker) {
        next()
        return
      }
      loadScript(ADDON_JS, next)
    }

    var loadTimepickerEmbed = function () {
      var $ = window.jQuery
      if (!$) {
        setTimeout(loadTimepickerEmbed, 50)
        return
      }

      var ns = ensureNamespace()

      if ($.fn.timepicker) {
        run()
        return
      }

      if (ns.loading) {
        var wait = setInterval(function () {
          if ($.fn.timepicker) {
            clearInterval(wait)
            run()
          }
        }, 50)
        return
      }

      ns.loading = true
      withJqueryUi($, function () {
        withAddon($, function () {
          ns.loading = false
          run()
        })
      })
    }

    loadTimepickerEmbed()
  })()