/**
 * The Starters V3 build-profile draft identity guard.
 *
 * Full Profile and Consult still use the legacy `build_profile` localStorage
 * key throughout their authored Webflow code. A browser can host sequential
 * Memberstack sessions, so that unscoped key must never be readable or writable
 * until the current stable member ID is known. This guard preserves the legacy
 * page contract while routing it to a member-scoped physical key.
 *
 * Load synchronously in the page head, before the authored form scripts.
 */
;(function installBuildProfileDraftIdentityGuard(window) {
  'use strict'

  if (!window || window.__TS_BUILD_PROFILE_DRAFT_GUARD__) return

  const VERSION = '1.0.0'
  const LEGACY_KEY = 'build_profile'
  const SCOPED_PREFIX = 'ts:build_profile:member:'
  const MEMBERSTACK_TIMEOUT_MS = 10000
  const StorageConstructor = window.Storage
  const localStorage = window.localStorage

  if (!StorageConstructor || !localStorage) return

  const nativeGetItem = StorageConstructor.prototype.getItem
  const nativeSetItem = StorageConstructor.prototype.setItem
  const nativeRemoveItem = StorageConstructor.prototype.removeItem

  let status = 'resolving'
  let memberId = ''
  let scopedKey = ''
  let pendingValue = null
  let pendingRemoval = false
  let resolveReady

  const ready = new Promise((resolve) => {
    resolveReady = resolve
  })

  function isLegacyDraftAccess(storage, key) {
    return storage === localStorage && String(key) === LEGACY_KEY
  }

  function finish(nextStatus) {
    status = nextStatus
    resolveReady({ status, memberId: memberId || null })
    window.dispatchEvent(
      new window.CustomEvent('ts:build-profile-draft-identity', {
        detail: { status, memberId: memberId || null },
      }),
    )
  }

  StorageConstructor.prototype.getItem = function guardedGetItem(key) {
    if (!isLegacyDraftAccess(this, key)) {
      return nativeGetItem.call(this, key)
    }

    if (status !== 'ready') return null
    return nativeGetItem.call(this, scopedKey)
  }

  StorageConstructor.prototype.setItem = function guardedSetItem(key, value) {
    if (!isLegacyDraftAccess(this, key)) {
      return nativeSetItem.call(this, key, value)
    }

    if (status === 'ready') {
      return nativeSetItem.call(this, scopedKey, value)
    }

    if (status === 'resolving') {
      pendingValue = String(value)
      pendingRemoval = false
    }
  }

  StorageConstructor.prototype.removeItem = function guardedRemoveItem(key) {
    if (!isLegacyDraftAccess(this, key)) {
      return nativeRemoveItem.call(this, key)
    }

    nativeRemoveItem.call(this, LEGACY_KEY)

    if (status === 'ready') {
      return nativeRemoveItem.call(this, scopedKey)
    }

    if (status === 'resolving') {
      pendingValue = null
      pendingRemoval = true
    }
  }

  window.__TS_BUILD_PROFILE_DRAFT_GUARD__ = Object.freeze({
    version: VERSION,
    get status() {
      return status
    },
    get memberId() {
      return memberId || null
    },
    whenReady() {
      return ready
    },
  })

  // The legacy value has no owner proof. Never migrate it into a member scope.
  nativeRemoveItem.call(localStorage, LEGACY_KEY)

  async function waitForMemberstack() {
    const startedAt = Date.now()

    while (Date.now() - startedAt < MEMBERSTACK_TIMEOUT_MS) {
      const memberstack = window.$memberstackDom
      if (memberstack && typeof memberstack.getCurrentMember === 'function') {
        return memberstack
      }
      await new Promise((resolve) => window.setTimeout(resolve, 25))
    }

    return null
  }

  async function resolveIdentity() {
    try {
      const memberstack = await waitForMemberstack()
      if (!memberstack) {
        finish('blocked')
        return
      }

      const response = await memberstack.getCurrentMember()
      memberId = String(response?.data?.id || response?.id || '').trim()

      if (!memberId) {
        pendingValue = null
        pendingRemoval = false
        finish('anonymous')
        return
      }

      scopedKey = `${SCOPED_PREFIX}${memberId}`
      status = 'ready'

      if (pendingRemoval) {
        nativeRemoveItem.call(localStorage, scopedKey)
      } else if (pendingValue !== null) {
        nativeSetItem.call(localStorage, scopedKey, pendingValue)
      }

      pendingValue = null
      pendingRemoval = false
      finish('ready')
    } catch (error) {
      pendingValue = null
      pendingRemoval = false
      console.error('[Build Profile Draft Guard] identity resolution failed', error)
      finish('blocked')
    }
  }

  resolveIdentity()
})(window)
