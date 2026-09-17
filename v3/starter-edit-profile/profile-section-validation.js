/*
 * Profile section validation, independently derived from utils/wf-validate.js
 * at v1.59.549 (SHA-256 4d97dc1778cdcede987666a76d28fa16c0b1d61efb4e9fa30db28c2c5b80d7ca).
 * The deployed asset and local source matched on 2026-09-17.
 * Retains native-constraint messages, blur/correction timing and inline alerts.
 * Unlike the global validator, fields belong to a section and their DOM identity,
 * never a page-wide name group. This module does not install a submit gate.
 */
;(function () {
  'use strict'
  if (window.StarterProfileValidation) return
  const FIELD = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'
  const VALIDITY_RULE = {
    valueMissing: 'required', typeMismatch: 'type', badInput: 'type',
    patternMismatch: 'pattern', tooShort: 'minlength', tooLong: 'maxlength',
    rangeUnderflow: 'min', rangeOverflow: 'max', stepMismatch: 'step',
  }
  const bound = new WeakMap()
  let uid = 0

  function bind(section, options = {}) {
    if (bound.has(section)) return bound.get(section)
    const errors = new WeakMap()
    function message(field) {
      if (field.disabled || options.applies?.(field) === false) return ''
      const value = String(field.value ?? '')
      const type = field.getAttribute('type') || 'text'
      if (!['checkbox', 'radio', 'file'].includes(type) && field.hasAttribute('required') && !value.trim()) {
        return field.getAttribute('wf-validate-message-required') || 'Please fill out this field.'
      }
      const maximum = Number(field.getAttribute('maxlength'))
      if (maximum > 0 && value.length > maximum) {
        return field.getAttribute('wf-validate-message-maxlength') || 'Use no more than ' + maximum + ' characters.'
      }
      const validity = field.validity
      if (!validity || validity.valid) return options.message?.(field) || ''
      const retainedFile = type === 'file' && options.valuePresent?.(field) === true
      const flag = Object.keys(VALIDITY_RULE).find(key => validity[key] && !(key === 'valueMissing' && retainedFile))
      if (!flag && !validity.customError) return options.message?.(field) || ''
      return (flag && field.getAttribute('wf-validate-message-' + VALIDITY_RULE[flag]))
        || field.validationMessage || 'Please check this value.'
    }
    function paint(field) {
      const text = message(field)
      let error = errors.get(field)
      if (text && !error) {
        error = document.createElement('div')
        error.id = 'profile-validation-error-' + ++uid
        error.setAttribute('role', 'alert')
        error.setAttribute('profile-validation-error', '')
        error.classList.add('wf-validate_error-auto')
        ;(field.closest('label') || field).insertAdjacentElement('afterend', error)
        const descriptions = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean))
        descriptions.add(error.id)
        field.setAttribute('aria-describedby', Array.from(descriptions).join(' '))
        errors.set(field, error)
      }
      field.classList.toggle('is-wf-validate-invalid', Boolean(text))
      field.setAttribute('aria-invalid', text ? 'true' : 'false')
      if (error) {
        error.textContent = text
        error.style.display = text ? '' : 'none'
      }
      return !text
    }
    function fieldFor(event) {
      const field = options.feedbackTarget?.(event.target) || event.target
      return Array.from(section.querySelectorAll(FIELD)).includes(field) ? field : null
    }
    section.addEventListener('focusout', event => {
      const field = fieldFor(event)
      if (field) paint(field)
    })
    const correct = event => {
      const field = fieldFor(event)
      if (!field) return
      // A value can correct a sibling rule (date order or an inactive control).
      // Recheck only feedback that has already been shown, never paint new errors.
      Array.from(section.querySelectorAll(FIELD)).filter(candidate => errors.has(candidate)).forEach(paint)
    }
    section.addEventListener('input', correct)
    section.addEventListener('change', correct)
    const controller = {
      reset() {
        Array.from(section.querySelectorAll(FIELD)).forEach(field => {
          const error = errors.get(field)
          if (error) {
            const described = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== error.id)
            if (described.length) field.setAttribute('aria-describedby', described.join(' '))
            else field.removeAttribute('aria-describedby')
            error.remove()
            errors.delete(field)
          }
          field.removeAttribute('aria-invalid')
          field.classList.remove('is-wf-validate-invalid')
        })
      },
      validate(scope = section) {
        const failures = Array.from(scope.querySelectorAll(FIELD)).filter(field => !paint(field))
        failures.forEach(field => options.reveal?.(field))
        if (failures[0]) {
          failures[0].focus({ preventScroll: true })
          failures[0].scrollIntoView?.({ block: 'center', behavior:
            window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
        }
        return { valid: failures.length === 0, failures }
      },
    }
    bound.set(section, controller)
    return controller
  }
  // Backend-required contract: a field authored with `form-xano-required` names a
  // value the Xano writer rejects when blank. Requiredness still comes only from the
  // Webflow Required checkbox; this only reports fields where the two disagree so a
  // section can refuse to save a form that would fail server-side. A field the active profile
  // type is not asked for is reported too: `data-non-required` clearing `required` on a
  // backend-required field is exactly the authoring mismatch this pause exists to catch.
  function misconfigured(section) {
    return Array.from(section.querySelectorAll(FIELD))
      .filter(field => field.hasAttribute('form-xano-required') && !field.hasAttribute('required'))
  }
  window.StarterProfileValidation = { bind, misconfigured }
})()
