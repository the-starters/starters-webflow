/**
 * V3 paid-call Brand payment client.
 *
 * Xano derives the Brand and payment environment from the authenticated
 * session. A selection attempt owns one bounded idempotency key: retries reuse
 * that key, while every later intentional selection creates a new attempt.
 */
;(function (global) {
  'use strict'

  const isCommonJs =
    typeof module !== 'undefined' && typeof module.exports !== 'undefined'
  const XANO_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'
  const SETUP_PATH = '/brand/payment-method/setup/v3'
  const SET_DEFAULT_PATH = '/brand/payment-method/set-default/v3'
  const MAX_KEY_LENGTH = 128
  const MAX_PAYMENT_METHOD_LENGTH = 128

  function createAttemptKey(prefix) {
    const safePrefix = String(prefix || 'attempt').replace(/[^a-z0-9_-]/gi, '-')
    let entropy = ''
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      entropy = global.crypto.randomUUID()
    } else {
      entropy =
        Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14)
    }
    const key = safePrefix + '-' + entropy
    if (!key || key.length > MAX_KEY_LENGTH) {
      throw new Error('Unable to create a bounded idempotency key')
    }
    return key
  }

  function validateKey(value) {
    if (typeof value !== 'string' || !value || value.length > MAX_KEY_LENGTH) {
      throw new Error('A bounded idempotency key is required')
    }
    return value
  }

  function validatePaymentMethodId(value) {
    if (
      typeof value !== 'string' ||
      !value.startsWith('pm_') ||
      value.length > MAX_PAYMENT_METHOD_LENGTH
    ) {
      throw new Error('A valid Stripe PaymentMethod ID is required')
    }
    return value
  }

  async function authenticatedPost(path, payload) {
    const url = XANO_BASE + path
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
    let response
    if (typeof global.xanoAuthFetch === 'function') {
      response = await global.xanoAuthFetch(url, options)
    } else if (typeof global.getXanoAuthToken === 'function') {
      const token = await global.getXanoAuthToken()
      if (!token) throw new Error('Xano authentication returned no token')
      options.headers.Authorization = 'Bearer ' + token
      response = await global.fetch(url, options)
    } else {
      throw new Error('The authenticated Xano bridge is unavailable')
    }
    const data = await response.json().catch(function () {
      return null
    })
    if (!response.ok) {
      throw Object.assign(new Error(path + ' failed (' + response.status + ')'), {
        status: response.status,
        data,
      })
    }
    if (!data || typeof data !== 'object') {
      throw new Error(path + ' returned no data')
    }
    return data
  }

  function createSetupAttempt(idempotencyKey) {
    const key = validateKey(
      idempotencyKey || createAttemptKey('brand-payment-setup'),
    )
    return {
      idempotencyKey: key,
      run: function () {
        return authenticatedPost(SETUP_PATH, { idempotency_key: key })
      },
    }
  }

  function createDefaultSelectionAttempt(paymentMethodId, idempotencyKey) {
    const methodId = validatePaymentMethodId(paymentMethodId)
    const key = validateKey(
      idempotencyKey || createAttemptKey('brand-default-card'),
    )
    return {
      paymentMethodId: methodId,
      idempotencyKey: key,
      run: function () {
        return authenticatedPost(SET_DEFAULT_PATH, {
          payment_method_id: methodId,
          idempotency_key: key,
        })
      },
    }
  }

  const api = {
    SETUP_PATH,
    SET_DEFAULT_PATH,
    XANO_BASE,
    authenticatedPost,
    createAttemptKey,
    createDefaultSelectionAttempt,
    createSetupAttempt,
    validateKey,
    validatePaymentMethodId,
  }

  if (isCommonJs) {
    module.exports = api
    return
  }
  global.StartersPaidCallBrandPayment = api
})(typeof window !== 'undefined' ? window : globalThis)
