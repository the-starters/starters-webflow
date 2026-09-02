/**
 * Canonical Build Profile fallback hydration.
 *
 * The legacy Build Profile draft controller restores Memberstack JSON and
 * member-scoped localStorage, plus the signed-in member's own identity for the
 * member-bound `step_1` keys (`first-name`, `last-name`, `email`, `phone`)
 * whenever that identity value is non-empty. A completed Starter with neither
 * draft therefore still sees an otherwise empty wizard even when
 * freelancers_v3 is populated. This controller reads the existing
 * `starter/get` compatibility endpoint, maps its canonical profile shape to
 * the wizard's step shape, and fills only keys that are absent from the active
 * draft. Existing draft keys always win, including intentional empty strings
 * and false values, so a hydrated member identity keeps precedence over the
 * canonical name, email, and phone.
 *
 * It does not persist Memberstack JSON, localStorage, or Xano data. The native
 * wizard continues to own capture and persistence after a human changes a field
 * or advances a step.
 */
;(function initCanonicalProfileHydrator(globalObject) {
  'use strict'

  var BUILD_PROFILE_PATHS = ['/build-profile/full-profile', '/build-profile/consult']
  var CANONICAL_PROFILE_URL =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starter/get'
  var PROFILE_READY_TIMEOUT_MS = 10000

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  }

  function valueOrEmpty(value) {
    return value === null || value === undefined ? '' : value
  }

  function yesNo(value) {
    if (value === true) return 'yes'
    if (value === false) return 'no'
    return valueOrEmpty(value)
  }

  function jsonCapture(value) {
    if (value === null || value === undefined || value === '') return ''
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value)
    } catch (_) {
      return ''
    }
  }

  function capturedJsonType(value) {
    if (typeof value !== 'string') {
      if (Array.isArray(value)) return 'array'
      return isPlainObject(value) ? 'object' : ''
    }
    try {
      var parsed = JSON.parse(value)
      return Array.isArray(parsed) ? 'array' : isPlainObject(parsed) ? 'object' : ''
    } catch (_) {
      return ''
    }
  }

  function serviceAt(services, index) {
    if (Array.isArray(services)) return services[index] || null
    if (!isPlainObject(services)) return null
    return services['service-' + (index + 1)] || null
  }

  function reviewerAt(reviewers, index) {
    if (!isPlainObject(reviewers)) return null
    return reviewers['reviewer-' + (index + 1)] || null
  }

  function reviewerForDraft(reviewer) {
    if (!isPlainObject(reviewer)) return null
    if (
      Object.prototype.hasOwnProperty.call(reviewer, 'fname') ||
      Object.prototype.hasOwnProperty.call(reviewer, 'lname') ||
      Object.prototype.hasOwnProperty.call(reviewer, 'job')
    ) {
      return reviewer
    }
    if (!Object.keys(reviewer).length) return reviewer
    return {
      fname: valueOrEmpty(reviewer['first-name']),
      lname: valueOrEmpty(reviewer['last-name']),
      job: valueOrEmpty(reviewer.position),
      company: valueOrEmpty(reviewer.company),
      email: valueOrEmpty(reviewer.email),
    }
  }

  function canonicalType(value) {
    var normalized = String(value || '').trim().toLowerCase()
    return normalized === 'consult' ? 'consult' : 'full'
  }

  function mapCanonicalProfile(canonical) {
    canonical = isPlainObject(canonical) ? canonical : {}
    var profileType = canonicalType(canonical.Profile_Type || canonical.profile_type_30)
    var services = canonical.Services
    var reviewers = canonical.Reviewers

    return {
      type: profileType,
      type_id: valueOrEmpty(canonical.Profile_Type_ID),
      last_update: Number(canonical.Updated_On || canonical.updated || 0),
      data: {
        step_1: {
          'first-name': valueOrEmpty(canonical.First_Name),
          'last-name': valueOrEmpty(canonical.Last_Name),
          email: valueOrEmpty(canonical.Email),
          phone: valueOrEmpty(canonical.Phone),
          country: valueOrEmpty(canonical.Country),
          state: valueOrEmpty(canonical.State_Province),
          city: valueOrEmpty(canonical.City),
          'profile-photo-url': valueOrEmpty(canonical.Profile_Photo),
          'function-option': valueOrEmpty(canonical.Category),
          function: valueOrEmpty(canonical.Category_ID),
          'function-required': valueOrEmpty(canonical.Category_ID || canonical.Category),
          'role-option': valueOrEmpty(canonical.Roles),
          roles: valueOrEmpty(canonical.Roles_IDs),
          'roles-required': valueOrEmpty(canonical.Roles_IDs || canonical.Roles),
          'subcategories-option': valueOrEmpty(canonical.Subcategories),
          subcategories: valueOrEmpty(canonical.Subcategories_IDs),
        },
        step_2: {
          tagline: valueOrEmpty(canonical.Tagline),
          'pro-headline': valueOrEmpty(canonical.Professional_Headline),
          'bio-html': valueOrEmpty(canonical.Bio),
          'best-fit-1': valueOrEmpty(canonical.Best_Fit_For_1),
          'best-fit-2': valueOrEmpty(canonical.Best_Fit_For_2),
          'best-fit-3': valueOrEmpty(canonical.Best_Fit_For_3),
        },
        step_3: {
          // New profiles receive the complete picker objects. Keep the legacy ID
          // array as a fallback until every caller has moved to the new field.
          'also-worked-with': jsonCapture(
            canonical.Also_Worked_With_Picker || canonical.Also_Worked_With,
          ),
        },
        step_4: {},
        step_5: {
          'skill-option': valueOrEmpty(canonical.Skills),
          skills: valueOrEmpty(canonical.Skills_IDs),
          'skills-required': valueOrEmpty(canonical.Skills_IDs || canonical.Skills),
          'tool-option': valueOrEmpty(canonical.Tool),
          tools: valueOrEmpty(canonical.Tools_IDs),
          'tools-required': valueOrEmpty(canonical.Tools_IDs || canonical.Tool),
          'industries-option': valueOrEmpty(canonical.Industry_Experience),
          industries: valueOrEmpty(canonical.Industry_Experience_IDs),
        },
        step_6: {
          rate: valueOrEmpty(canonical.Hourly_Rate),
          'free-consulting-calls': yesNo(canonical.Free_Call_Enabled),
          'free-call-description': valueOrEmpty(canonical.Free_Call_Description),
          'paid-consulting-calls': yesNo(canonical.Paid_Call_Enabled),
          'paid-call-description': valueOrEmpty(canonical.Paid_Call_Description),
          'paid-call-rate': valueOrEmpty(canonical.Paid_Call_Rate),
          'offer-monthly-retainers': yesNo(canonical.Retainer_Enabled),
          'description-retainer': valueOrEmpty(canonical.Retainer_Description),
          'rate-retainer': valueOrEmpty(canonical.Retainer_Rate),
          service: jsonCapture(serviceAt(services, 0)),
          'service-2': jsonCapture(serviceAt(services, 1)),
          'service-3': jsonCapture(serviceAt(services, 2)),
          'availability-option': valueOrEmpty(canonical.Availability),
          availability: valueOrEmpty(canonical.Availability_ID),
          'availiability-required': valueOrEmpty(
            canonical.Availability_ID || canonical.Availability,
          ),
          'full-time-placement': yesNo(canonical.Open_to_Full_Time),
        },
        step_7: {
          reviewer: jsonCapture(reviewerForDraft(reviewerAt(reviewers, 0))),
          'reviewer-2': jsonCapture(reviewerForDraft(reviewerAt(reviewers, 1))),
          'reviewer-3': jsonCapture(reviewerForDraft(reviewerAt(reviewers, 2))),
        },
      },
    }
  }

  function mergeProfileFallback(canonicalProfile, activeProfile) {
    var canonical = isPlainObject(canonicalProfile) ? canonicalProfile : { data: {} }
    var active = isPlainObject(activeProfile) ? activeProfile : { data: {} }
    var canonicalData = isPlainObject(canonical.data) ? canonical.data : {}
    var activeData = isPlainObject(active.data) ? active.data : {}
    var mergedData = {}
    var stepKeys = new Set(Object.keys(canonicalData).concat(Object.keys(activeData)))

    stepKeys.forEach(function mergeStep(stepKey) {
      var canonicalStep = isPlainObject(canonicalData[stepKey]) ? canonicalData[stepKey] : {}
      var activeStep = isPlainObject(activeData[stepKey]) ? activeData[stepKey] : {}
      mergedData[stepKey] = Object.assign({}, canonicalStep, activeStep)

      if (
        stepKey === 'step_3' &&
        capturedJsonType(activeStep['also-worked-with']) === 'array' &&
        capturedJsonType(canonicalStep['also-worked-with']) === 'object'
      ) {
        mergedData[stepKey]['also-worked-with'] = canonicalStep['also-worked-with']
      }
    })

    return {
      type: active.type || canonical.type || 'full',
      type_id: active.type_id || canonical.type_id || '',
      last_update: Number(active.last_update || canonical.last_update || Date.now()),
      data: mergedData,
    }
  }

  function emitNativeEvents(field) {
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function applyFieldValue(field, value) {
    var type = String(field.getAttribute && field.getAttribute('type') || '').toLowerCase()
    var tagName = String(field.tagName || '').toLowerCase()
    if (type === 'checkbox') {
      field.checked = Boolean(value)
      emitNativeEvents(field)
      return
    }
    if (type === 'radio') {
      var selector = 'input[type="radio"][name="' + CSS.escape(field.name) + '"]'
      var radios = Array.from(document.querySelectorAll(selector))
      var radio = radios.find(function matchRadio(candidate) {
        return String(candidate.value) === String(value)
      })
      if (radio) {
        radio.checked = true
        emitNativeEvents(radio)
      }
      return
    }
    field.value = valueOrEmpty(value)
    if (tagName === 'select' && value && !field.value && field.options) {
      var matchingOption = Array.from(field.options).find(function matchOption(option) {
        return String(option.textContent || '').trim() === String(value).trim()
      })
      if (matchingOption) field.value = matchingOption.value
    }
    emitNativeEvents(field)
  }

  async function applyPhoneValue(field, value) {
    field.value = valueOrEmpty(value)
    var instance = globalObject.intlTelInput && globalObject.intlTelInput.getInstance
      ? globalObject.intlTelInput.getInstance(field)
      : null
    try {
      if (instance && instance.promise && typeof instance.promise.then === 'function') {
        await instance.promise
      }
      if (instance && typeof instance.setNumber === 'function' && value) {
        instance.setNumber(String(value))
      }
      emitNativeEvents(field)
    } catch (error) {
      console.warn('[build-profile-canonical] phone hydration deferred', error && error.message)
    }
  }

  function applyPhotoPreview(value) {
    if (!value) return
    var wrap = document.querySelector('#profile-photo-wrap')
    var preview = document.querySelector('#profile-photo-preview')
    var image = document.querySelector('#profile-photo-preview-img')
    if (image) image.src = String(value)
    if (wrap) wrap.style.display = 'none'
    if (preview) preview.style.display = 'block'
  }

  async function applyProfileToForm(profile) {
    var phoneWork = []
    Object.keys(profile.data || {}).forEach(function applyStep(stepKey) {
      var stepIndex = stepKey.replace(/^step_/, '')
      var step = document.querySelector(
        '[data-form="step"][data-index="' + CSS.escape(stepIndex) + '"]',
      )
      if (!step) return
      var stepData = profile.data[stepKey] || {}
      Object.keys(stepData).forEach(function applyNamedValue(name) {
        var fields = Array.from(step.querySelectorAll('[name="' + CSS.escape(name) + '"]'))
        if (!fields.length) return
        fields.forEach(function applyOne(field) {
          if (name === 'phone') phoneWork.push(applyPhoneValue(field, stepData[name]))
          else applyFieldValue(field, stepData[name])
        })
      })
    })
    applyPhotoPreview(profile.data && profile.data.step_1 && profile.data.step_1['profile-photo-url'])
    await Promise.all(phoneWork)
  }

  function waitForActiveProfile() {
    return new Promise(function wait(resolve, reject) {
      var startedAt = Date.now()
      var interval = globalObject.setInterval(function check() {
        var profile = globalObject.activeProfile
        if (profile && profile.last_update !== null && profile.last_update !== undefined) {
          globalObject.clearInterval(interval)
          resolve(profile)
          return
        }
        if (Date.now() - startedAt >= PROFILE_READY_TIMEOUT_MS) {
          globalObject.clearInterval(interval)
          reject(new Error('active profile did not initialize'))
        }
      }, 50)
    })
  }

  function waitForMember() {
    return new Promise(function wait(resolve) {
      if (typeof globalObject.waitForMember === 'function') {
        globalObject.waitForMember(function memberReady() {
          resolve(globalObject.MEMBER || {})
        })
        return
      }
      Promise.resolve(globalObject.memberReady || globalObject.MEMBER || {}).then(resolve)
    })
  }

  async function readCanonicalProfile(memberId) {
    var fetcher = globalObject.xanoAuthFetch || globalObject.fetch
    if (typeof fetcher !== 'function') throw new Error('profile fetch is unavailable')
    var response = await fetcher(CANONICAL_PROFILE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: memberId }),
    })
    if (!response || !response.ok) {
      throw new Error('canonical profile read failed with HTTP ' + (response && response.status))
    }
    return response.json()
  }

  async function hydrate() {
    if (globalObject.__tsBuildProfileCanonicalHydrated) return null
    var member = await waitForMember()
    if (!member || !member.id) return null
    var active = await waitForActiveProfile()
    var canonical = await readCanonicalProfile(member.id)
    var currentMember = await waitForMember()
    if (
      !currentMember ||
      currentMember.id !== member.id ||
      !canonical ||
      canonical.memberstack_id !== currentMember.id
    ) {
      throw new Error('canonical profile identity mismatch')
    }
    if (isPlainObject(globalObject.activeProfile)) active = globalObject.activeProfile
    var merged = mergeProfileFallback(mapCanonicalProfile(canonical), active)
    globalObject.activeProfile = merged
    globalObject.__tsBuildProfileCanonicalHydrated = true
    await applyProfileToForm(merged)
    console.info('[build-profile-canonical] canonical fallback applied')
    return merged
  }

  var api = {
    mapCanonicalProfile: mapCanonicalProfile,
    mergeProfileFallback: mergeProfileFallback,
    hydrate: hydrate,
  }
  globalObject.StartersBuildProfileCanonicalHydrator = api

  if (globalObject.__TS_DISABLE_BUILD_PROFILE_CANONICAL_AUTO_INIT__) return
  if (!BUILD_PROFILE_PATHS.includes(String(globalObject.location && globalObject.location.pathname || ''))) {
    return
  }
  var run = function runHydration() {
    hydrate().catch(function reportHydrationFailure(error) {
      console.warn('[build-profile-canonical] fallback unavailable', error && error.message)
    }).finally(function releaseProfileConsumers() {
      if (typeof globalObject.__tsReleaseBuildProfileCanonical === 'function') {
        globalObject.__tsReleaseBuildProfileCanonical()
      }
    })
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true })
  } else {
    run()
  }
})(window)
