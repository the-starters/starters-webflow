/**
 * Turnstile arming for `display: contents` forms — render the bot-protection widget
 * that Webflow's own IntersectionObserver can never trigger, and never let a submit
 * leave without a fresh token.
 *
 * @release v1.59.106
 *
 * THE BUG. Webflow "bot protection" (Cloudflare Turnstile) is on site-wide, so the
 * published forms runtime does this to every `form[data-turnstile-sitekey]`:
 *
 *   1. disables every `input/button[type="submit"]` in the form, adds `w-form-loading`
 *      to those buttons and to the closest `.w-form` wrapper;
 *   2. injects `https://challenges.cloudflare.com/turnstile/v0/api.js` on
 *      `requestIdleCallback`;
 *   3. creates an `IntersectionObserver` (`rootMargin: 200px`) **observing the FORM
 *      element** and renders an invisible widget into a div appended inside the form
 *      only once `isIntersecting` is true;
 *   4. in the widget callback stores the token on Webflow's own state object
 *      (`jQuery.data(form, '.w-form').turnstileToken`), re-enables the buttons
 *      (`disabled = !!(sitekey && !turnstileToken)`) and clears `w-form-loading`.
 *
 * A form carrying Webflow's `display-contents` class **generates no box**, so its
 * `getBoundingClientRect()` is `0 × 0` and the observer never reports it as
 * intersecting — not on load, not on scroll, not when the modal that holds it opens.
 * Step 3 never happens, so step 4 never happens: the submit buttons stay disabled
 * forever, and Webflow's runtime is not waiting for anything it will ever get.
 *
 * It gets worse than a dead button. The site's `wf-validate` re-enables the final
 * step's submit once the fields validate, so the member CAN click it — and because
 * the token travels to `https://webflow.com/api/v1/form/<siteId>` **only** as the
 * hidden `cf-turnstile-response` input the widget injects inside the form (Webflow
 * never copies `turnstileToken` into the payload), the POST arrives tokenless and the
 * API rejects it. What the member sees is Webflow's generic
 * "Oops! Something went wrong while submitting the form."
 *
 * WHAT THIS SCRIPT DOES. Exactly what Webflow's step 3 would have done, for exactly
 * the forms where it cannot: appends its own `display: none` div **inside** the form
 * and renders the widget there with the form's own sitekey, then performs step 4
 * itself against Webflow's live state object. Plus two things Webflow does not do —
 * a capture-phase guard that holds a tokenless submit until the token lands instead
 * of letting it fail, and a reset after every submit so a retry can never send a
 * spent token.
 *
 * WHY THE WIDGET GOES INSIDE THE FORM, IN A HIDDEN DIV. Inside, because the payload
 * carries the token only as that injected `cf-turnstile-response` field, and Webflow
 * collects fields with `form.find(':input…')` — a widget rendered anywhere else is
 * invisible to the POST no matter how good the token is. Hidden, because Turnstile
 * renders and delivers a token perfectly well inside a `display: none` container
 * (measured: token in ~2 s), which is what lets a form sitting in a closed modal
 * panel be armed at page load rather than at open time. And the form's own `display`
 * is never touched: setting these forms to `block` visually destroys the modal
 * (leaked fields, misplaced buttons), and it would be a styling fix for a
 * measurement bug.
 *
 * SCOPE IS DELIBERATELY NARROW — computed `display: contents` only. A form with a
 * real display (`flex`, `block`, …) is armed by Webflow itself as soon as it scrolls
 * or is revealed within 200px of the viewport, including forms in a closed modal, so
 * touching those would mean two widgets, two `cf-turnstile-response` inputs, and a
 * token race in one form. Before rendering, each form is re-checked: a form that
 * already contains a widget, or whose `.w-form` wrapper no longer carries
 * `w-form-loading`, is left alone. `[data-wf-no-turnstile]` is honoured the same way
 * Webflow honours it.
 *
 * Where it goes in Webflow: Page or Project Settings -> Custom Code -> Footer Code
 * (or Head with `defer`), one tag, on any page that has a `display: contents` form.
 * No dependencies of its own and safe to load twice; it needs Webflow's own jQuery
 * only to read `jQuery.data(form, '.w-form')`, which is where Webflow keeps the state
 * object its own closures read — there is no second copy of that state to write to.
 *
 * Attributes it writes (never authored by hand):
 *
 *   data-starters-turnstile-armed="true"   on a form this script has armed
 *   data-starters-turnstile-host           on the hidden div holding the widget
 *
 * Ordering note: the wait for `window.turnstile` is what makes the "did Webflow
 * already arm this?" re-check trustworthy. Webflow's forms module is what injects
 * api.js in the first place, so by the time `turnstile.render` exists that module has
 * certainly finished initialising every form on the page.
 *
 * Diagnostics are console-only and gated to staging hosts (`*.webflow.io`,
 * `localhost`, `127.0.0.1`, `*.trycloudflare.com`) or `window.STARTERS_DEBUG === true`;
 * production is silent. `window.StartersTurnstileContentsFix` exposes `status()`,
 * `refresh()`, and `reset()` for console checks on staging.
 */
;(function () {
  'use strict'

  if (window.__startersTurnstileContentsFixBooted) return
  window.__startersTurnstileContentsFixBooted = true

  // Keep in sync with the @release line in this file's header comment.
  var RELEASE = 'v1.59.106'
  var LOG_PREFIX = '[starters turnstile-contents-fix]'

  var SITEKEY_ATTR = 'data-turnstile-sitekey'
  var OPT_OUT_ATTR = 'data-wf-no-turnstile'
  var ARMED_ATTR = 'data-starters-turnstile-armed'
  var HOST_ATTR = 'data-starters-turnstile-host'

  var WF_STATE_KEY = '.w-form'
  var LOADING_CLASS = 'w-form-loading'
  var TOKEN_FIELD = 'cf-turnstile-response'

  // Webflow injects api.js on requestIdleCallback, which on a busy dashboard can be
  // seconds after DOMContentLoaded. Poll rather than listen: this script may boot
  // either before or after that script's onload, and polling covers both without
  // depending on Webflow's private "TURNSTILE_LOADED" jQuery event.
  var TURNSTILE_WAIT_MS = 20000
  var TURNSTILE_POLL_MS = 100

  // How long a held submit waits for a token before giving the button back.
  var TOKEN_WAIT_MS = 10000
  var TOKEN_POLL_MS = 100

  // A widget error is usually transient (network), so retry the challenge a bounded
  // number of times before leaving the form in Webflow's own error posture.
  var ERROR_RETRY_MS = 2000
  var ERROR_RETRY_MAX = 2

  var entries = []

  /* ----------------------------- diagnostics ------------------------------ */

  // Anchored so a lookalike host ("notwebflow.io", "evil-trycloudflare.com") cannot
  // read as staging.
  function stagingHost(hostname) {
    var host = hostname || ''
    return (
      /(\.|^)webflow\.io$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
    )
  }

  // STARTERS_DEBUG belongs here and not in stagingHost(): it may turn logging on in
  // production, but it must never widen what counts as a staging host.
  function diagnosticsEnabled() {
    if (window.STARTERS_DEBUG === true) return true
    return stagingHost((window.location && window.location.hostname) || '')
  }

  function warn(message, detail) {
    if (!diagnosticsEnabled()) return
    if (detail === undefined) console.warn(LOG_PREFIX + ' ' + message)
    else console.warn(LOG_PREFIX + ' ' + message, detail)
  }

  function info(message, detail) {
    if (!diagnosticsEnabled()) return
    if (detail === undefined) console.info(LOG_PREFIX + ' ' + message)
    else console.info(LOG_PREFIX + ' ' + message, detail)
  }

  function formLabel(form) {
    if (!form) return '(no form)'
    return form.id || form.getAttribute('name') || form.getAttribute('data-name') || '(unnamed form)'
  }

  /* -------------------------------- DOM bits ------------------------------- */

  /**
   * Webflow's live per-form state object. This is the ONE jQuery call in the file:
   * `turnstileToken` has to be written where Webflow's own closures read it, and
   * that store is jQuery's data cache keyed `.w-form`, which is not reachable from
   * the element any other way.
   */
  function wFormState(form) {
    var jq = window.jQuery
    if (!jq || typeof jq.data !== 'function') return null
    try {
      return jq.data(form, WF_STATE_KEY) || null
    } catch (error) {
      return null
    }
  }

  function wrapperOf(form) {
    return form.closest ? form.closest('.w-form') : null
  }

  /**
   * The same button set Webflow's `:input[type="submit"]` resolves to. These forms
   * use `<button type="submit">`, not `<input type="submit">`, and there is more than
   * one per form (one per sub-flow tail), so every match is treated as a submit
   * button.
   */
  function submitButtons(form) {
    return Array.prototype.slice.call(
      form.querySelectorAll('input[type="submit"], button[type="submit"]')
    )
  }

  function tokenInput(form) {
    return form.querySelector('input[name="' + TOKEN_FIELD + '"]')
  }

  /**
   * Any sign that a widget already lives in this form — Webflow's or ours. Three
   * independent signals, because they appear at different moments: our own host div
   * exists from the instant we render, the `cf-chl-widget-*` element as soon as
   * Turnstile builds the widget, and the response field only once a challenge has
   * actually been solved. Checking the field alone would call a rendered-but-unsolved
   * widget "absent" and render a second one on top of it.
   */
  function hasWidget(form) {
    return !!(
      form.querySelector('[' + HOST_ATTR + ']') ||
      tokenInput(form) ||
      form.querySelector('[id^="cf-chl-widget-"]') ||
      form.querySelector('iframe[src*="challenges.cloudflare.com"]')
    )
  }

  function isContentsForm(form) {
    var view = form.ownerDocument && form.ownerDocument.defaultView
    if (!view || typeof view.getComputedStyle !== 'function') return false
    var display = ''
    try {
      display = view.getComputedStyle(form).display
    } catch (error) {
      return false
    }
    return display === 'contents'
  }

  /**
   * The token as Webflow will judge it. When the state object exists it is the only
   * source that counts, INCLUDING when it is empty: a reset clears it deliberately,
   * and falling back to the DOM input at that moment would read the spent token
   * still sitting there and wave a doomed submit through. The DOM fallback is only
   * for a page with no usable jQuery, where the widget's own input is all there is.
   */
  function tokenOf(entry) {
    if (entry.state) return entry.state.turnstileToken || ''
    var input = tokenInput(entry.form)
    return (input && input.value) || ''
  }

  /* ------------------------------- selection ------------------------------- */

  function candidates() {
    var forms = Array.prototype.slice.call(document.querySelectorAll('form[' + SITEKEY_ATTR + ']'))
    return forms.filter(function (form) {
      if (form.getAttribute(ARMED_ATTR) === 'true') return false
      if (form.hasAttribute(OPT_OUT_ATTR)) return false
      return isContentsForm(form)
    })
  }

  /**
   * Re-checked immediately before rendering, not at scan time: Webflow may have armed
   * the form in between, and a second widget would mean a second
   * `cf-turnstile-response` field in one payload.
   */
  function needsArming(form) {
    if (hasWidget(form)) {
      info('skipping ' + formLabel(form) + ' — it already has a turnstile widget')
      return false
    }
    var wrapper = wrapperOf(form)
    if (wrapper && !wrapper.classList.contains(LOADING_CLASS)) {
      info(
        'skipping ' +
          formLabel(form) +
          ' — its .w-form wrapper is no longer in the loading state, so Webflow armed it'
      )
      return false
    }
    return true
  }

  /* ------------------------------ button state ----------------------------- */

  function enableButtons(entry) {
    submitButtons(entry.form).forEach(function (btn) {
      btn.disabled = false
      btn.classList.remove(LOADING_CLASS)
    })
    var wrapper = wrapperOf(entry.form)
    if (wrapper) wrapper.classList.remove(LOADING_CLASS)
  }

  function disableButtons(entry) {
    submitButtons(entry.form).forEach(function (btn) {
      btn.disabled = true
    })
    var wrapper = wrapperOf(entry.form)
    if (wrapper) wrapper.classList.remove(LOADING_CLASS)
  }

  /**
   * The waiting state for a held submit, in the two vocabularies this site already
   * has: Webflow's own `data-wait` label swap (only meaningful where the value IS the
   * visible label, i.e. `input[type="submit"]`) and the site's
   * `[data-opp-element="loading-button"]` / `data-opp-loading` spinner contract,
   * which is what the account-settings buttons actually use — their `<button>` is an
   * empty overlay and its label is a sibling div, so there is no text to swap.
   */
  function setWaiting(entry, on) {
    if (on) {
      if (entry.waiting) return
      entry.waiting = []
      submitButtons(entry.form).forEach(function (btn) {
        var record = { btn: btn, disabled: btn.disabled, value: null, wrap: null, loading: null }
        var wait = btn.getAttribute('data-wait')
        if (wait && btn.tagName === 'INPUT') {
          record.value = btn.value
          btn.value = wait
        }
        var wrap = btn.closest ? btn.closest('[data-opp-element="loading-button"]') : null
        if (wrap) {
          record.wrap = wrap
          record.loading = wrap.getAttribute('data-opp-loading')
          wrap.setAttribute('data-opp-loading', 'true')
        }
        btn.disabled = true
        btn.classList.add(LOADING_CLASS)
        entry.waiting.push(record)
      })
      var wrapper = wrapperOf(entry.form)
      if (wrapper) wrapper.classList.add(LOADING_CLASS)
      return
    }

    if (!entry.waiting) return
    entry.waiting.forEach(function (record) {
      if (record.value !== null) record.btn.value = record.value
      if (record.wrap) {
        if (record.loading === null) record.wrap.setAttribute('data-opp-loading', 'false')
        else record.wrap.setAttribute('data-opp-loading', record.loading)
      }
      record.btn.classList.remove(LOADING_CLASS)
      // Restore the snapshot, never a blanket enable. These forms carry one submit
      // button per branch tail, and the ones the member did not click are disabled on
      // purpose by wf-validate and the flow logic. A hold ending — token arrived or
      // timed out — must hand back exactly the state it borrowed.
      record.btn.disabled = record.disabled
    })
    entry.waiting = null
    var doneWrapper = wrapperOf(entry.form)
    if (doneWrapper) doneWrapper.classList.remove(LOADING_CLASS)
  }

  /* --------------------------------- arming -------------------------------- */

  function onToken(entry, token) {
    entry.resetPending = false
    entry.errorRetries = 0
    entry.tokens += 1
    if (entry.state) entry.state.turnstileToken = token
    enableButtons(entry)
    info(
      'token ' + entry.tokens + ' for ' + formLabel(entry.form) + ' (' + fingerprint(token) + ')'
    )
  }

  function onError(entry) {
    entry.resetPending = false
    // Mirror Webflow's own error posture: no token means the form must not be
    // submittable. The guard would stop a tokenless submit anyway; a disabled button
    // is the honest version of the same answer.
    if (entry.state) entry.state.turnstileToken = null
    disableButtons(entry)
    if (entry.errorRetries < ERROR_RETRY_MAX) {
      entry.errorRetries += 1
      warn(
        'turnstile error on ' +
          formLabel(entry.form) +
          '; retrying (' +
          entry.errorRetries +
          ' of ' +
          ERROR_RETRY_MAX +
          ')'
      )
      window.setTimeout(function () {
        resetEntry(entry, 'error-retry')
      }, ERROR_RETRY_MS)
      return
    }
    warn('turnstile error on ' + formLabel(entry.form) + '; giving up after retries')
  }

  function armForm(form) {
    if (!needsArming(form)) {
      form.setAttribute(ARMED_ATTR, 'skipped')
      return null
    }

    var sitekey = (form.getAttribute(SITEKEY_ATTR) || '').trim()
    if (!sitekey) {
      warn('no ' + SITEKEY_ATTR + ' value on ' + formLabel(form) + '; leaving it alone')
      return null
    }

    var host = document.createElement('div')
    host.setAttribute(HOST_ATTR, '')
    host.style.display = 'none'
    form.appendChild(host)

    var entry = {
      form: form,
      host: host,
      widgetId: null,
      state: wFormState(form),
      tokens: 0,
      resetPending: false,
      errorRetries: 0,
      waiting: null,
      holding: false,
    }

    if (!entry.state) {
      warn(
        'no Webflow state object for ' +
          formLabel(form) +
          " (jQuery.data(form, '.w-form') is empty); arming anyway and reading the token from the widget's own field"
      )
    }

    var widgetId
    try {
      // Webflow's own render options, and nothing else: sitekey plus the two
      // callbacks. Size/appearance belong to the sitekey's Cloudflare widget type,
      // not to the caller, and a mismatched option here would be a second source of
      // truth for how the challenge behaves.
      widgetId = window.turnstile.render(host, {
        sitekey: sitekey,
        callback: function (token) {
          // Also fires on Turnstile's own refresh of an expiring token, so this
          // always overwrites rather than filling in only the first time.
          onToken(entry, token)
        },
        'error-callback': function () {
          onError(entry)
        },
      })
    } catch (error) {
      host.parentNode && host.parentNode.removeChild(host)
      warn('turnstile.render threw for ' + formLabel(form), error)
      return null
    }

    if (widgetId === undefined || widgetId === null) {
      host.parentNode && host.parentNode.removeChild(host)
      warn('turnstile.render returned no widget id for ' + formLabel(form))
      return null
    }

    entry.widgetId = widgetId
    form.setAttribute(ARMED_ATTR, 'true')
    entries.push(entry)
    guardSubmits(entry)
    watchOutcome(entry)
    info('armed ' + formLabel(form) + ' (widget ' + widgetId + ')')
    return entry
  }

  /* --------------------------------- resets -------------------------------- */

  /**
   * Ask for a fresh challenge and, until it lands, treat the form as tokenless.
   * Turnstile tokens are single-use: a second submit carrying the first token is
   * rejected exactly like a submit carrying none, which is the "it failed, let me try
   * again" path members actually take. Clearing the token first is what makes the
   * guard hold that retry instead of spending it.
   */
  function resetEntry(entry, reason) {
    if (entry.widgetId === null) return
    if (entry.resetPending) return
    entry.resetPending = true
    if (entry.state) entry.state.turnstileToken = null
    try {
      window.turnstile.reset(entry.widgetId)
      info('reset ' + formLabel(entry.form) + ' (' + reason + ')')
    } catch (error) {
      entry.resetPending = false
      warn('turnstile.reset threw for ' + formLabel(entry.form), error)
    }
  }

  /**
   * Belt for the reset above. Webflow's completion handler flips its `.w-form-done` /
   * `.w-form-fail` siblings with jQuery `.toggle()`, i.e. an inline `display` write,
   * so those two elements changing style or class is the one signal that a submit
   * attempt has come back — including an attempt this script never saw as an event.
   * It resets only when nothing is already pending, so the normal path (post-submit
   * reset) costs no second challenge.
   */
  function watchOutcome(entry) {
    if (typeof MutationObserver !== 'function') return
    var wrapper = wrapperOf(entry.form)
    if (!wrapper) {
      warn('no .w-form wrapper around ' + formLabel(entry.form) + '; outcome belt is off')
      return
    }
    var targets = Array.prototype.slice.call(wrapper.children).filter(function (child) {
      return child.classList.contains('w-form-done') || child.classList.contains('w-form-fail')
    })
    if (!targets.length) return

    var observer = new MutationObserver(function () {
      if (entry.resetPending) return
      if (!tokenOf(entry) && !entry.state) return
      resetEntry(entry, 'form outcome')
    })
    targets.forEach(function (target) {
      observer.observe(target, { attributes: true, attributeFilter: ['style', 'class'] })
    })
    entry.observer = observer
  }

  /* ------------------------------ submit guard ----------------------------- */

  /**
   * Capture phase on the form, so this runs before Webflow's delegated submit handler
   * on `document` and `stopImmediatePropagation()` can actually stop it.
   *
   * With a token: let it through untouched, then reset on the next task. Webflow
   * builds its whole payload synchronously inside that handler, so by the time this
   * timeout runs the token is already in the POST body and the widget is free to
   * fetch the next one.
   *
   * Without one: hold the event, show the button as working, and re-submit as soon as
   * the token lands. If it never does, give the button back — submitting tokenless
   * would only reproduce the "Oops" this script exists to remove.
   */
  function guardSubmits(entry) {
    entry.form.addEventListener(
      'submit',
      function (event) {
        if (entry.holding) return

        if (tokenOf(entry)) {
          window.setTimeout(function () {
            resetEntry(entry, 'post-submit')
          }, 0)
          return
        }

        event.preventDefault()
        event.stopImmediatePropagation()

        if (entry.pendingHold) return
        entry.pendingHold = true
        setWaiting(entry, true)
        info('holding a tokenless submit on ' + formLabel(entry.form) + '; waiting for a token')

        // Wall clock, not a tick count. A background or throttled tab clamps
        // setInterval to roughly 1/s, which would silently stretch this 10s budget to
        // 100s and leave a member staring at a spinner on a form they never left.
        var startedAt = Date.now()
        var timer = window.setInterval(function () {
          if (tokenOf(entry)) {
            window.clearInterval(timer)
            entry.pendingHold = false
            setWaiting(entry, false)
            resubmit(entry)
            return
          }
          if (Date.now() - startedAt >= TOKEN_WAIT_MS) {
            window.clearInterval(timer)
            entry.pendingHold = false
            setWaiting(entry, false)
            warn(
              'no token for ' +
                formLabel(entry.form) +
                ' after ' +
                TOKEN_WAIT_MS +
                'ms; button restored so the member can retry'
            )
          }
        }, TOKEN_POLL_MS)
      },
      true
    )
  }

  /**
   * `requestSubmit()` first because it is the one that runs native constraint
   * validation and fires a real, cancelable submit event. The synthetic fallback is
   * for a browser without it, and for the case where the original event was itself
   * synthetic (a script-dispatched submit bypasses validation, so re-running
   * validation could refuse a submit the page had already accepted).
   */
  function resubmit(entry) {
    entry.holding = true
    try {
      if (typeof entry.form.requestSubmit === 'function') {
        entry.form.requestSubmit()
      } else {
        entry.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      }
      info('re-submitted ' + formLabel(entry.form) + ' with a fresh token')
    } catch (error) {
      warn('could not re-submit ' + formLabel(entry.form), error)
    } finally {
      entry.holding = false
      window.setTimeout(function () {
        resetEntry(entry, 'post-resubmit')
      }, 0)
    }
  }

  /* ---------------------------------- boot --------------------------------- */

  function turnstileReady() {
    return !!(window.turnstile && typeof window.turnstile.render === 'function')
  }

  function waitForTurnstile(done) {
    if (turnstileReady()) {
      done(true)
      return
    }
    // Wall clock for the same reason as the token wait above.
    var startedAt = Date.now()
    var timer = window.setInterval(function () {
      if (turnstileReady()) {
        window.clearInterval(timer)
        done(true)
        return
      }
      if (Date.now() - startedAt >= TURNSTILE_WAIT_MS) {
        window.clearInterval(timer)
        done(false)
      }
    }, TURNSTILE_POLL_MS)
  }

  function refresh() {
    if (!turnstileReady()) {
      warn('refresh() called before window.turnstile exists; nothing armed')
      return 0
    }
    var armedCount = 0
    candidates().forEach(function (form) {
      if (armForm(form)) armedCount += 1
    })
    return armedCount
  }

  function fingerprint(token) {
    var value = token || ''
    if (!value) return 'empty'
    return value.slice(0, 12) + '…len:' + value.length
  }

  function status() {
    return entries.map(function (entry) {
      var input = tokenInput(entry.form)
      return {
        form: formLabel(entry.form),
        widgetId: entry.widgetId,
        tokens: entry.tokens,
        token: fingerprint(tokenOf(entry)),
        field: fingerprint(input && input.value),
        resetPending: entry.resetPending,
        holding: !!entry.pendingHold,
        hasState: !!entry.state,
      }
    })
  }

  function resetByName(name) {
    var hits = entries.filter(function (entry) {
      return !name || formLabel(entry.form) === name
    })
    hits.forEach(function (entry) {
      resetEntry(entry, 'manual')
    })
    return hits.length
  }

  function boot() {
    var pending = candidates()
    if (!pending.length) {
      info('no display:contents forms with ' + SITEKEY_ATTR + ' on this page')
      return
    }
    info(
      pending.length +
        ' display:contents form(s) to arm: ' +
        pending
          .map(function (form) {
            return formLabel(form)
          })
          .join(', ')
    )
    waitForTurnstile(function (ready) {
      if (!ready) {
        warn(
          'window.turnstile never appeared within ' +
            TURNSTILE_WAIT_MS +
            'ms; leaving ' +
            pending.length +
            ' form(s) exactly as Webflow left them'
        )
        return
      }
      refresh()
    })
  }

  window.StartersTurnstileContentsFix = {
    release: RELEASE,
    stagingHost: stagingHost,
    diagnosticsEnabled: diagnosticsEnabled,
    status: status,
    refresh: refresh,
    reset: resetByName,
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
