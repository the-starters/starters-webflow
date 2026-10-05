/**
 * Shared Memberstack member reads (site-wide).
 *
 * Every `$memberstackDom.getCurrentMember()` call is a separate network
 * request to Memberstack, and the SDK sends them one after another. On a
 * V3 page the deferred scripts each ask for the member as they start, so a
 * page load issues a burst of 10 or more identical reads and the last script
 * waits behind all of the others (measured 2026-10-05 on /messages: 23 reads,
 * the burst alone cost about 3 s before the TalkJS inbox could open).
 *
 * This module wraps `getCurrentMember` so that calls with identical JSON-safe
 * arguments made while one read is still in flight share its result. Nothing
 * is kept after a read settles, so a read that starts after a write or an auth
 * change always goes to the network. Any Memberstack write (every other method
 * on `$memberstackDom`) and every `onAuthChange` notification drop the
 * in-flight entries first.
 *
 * Install it with `defer` directly after the Memberstack SDK tag in the site
 * head, before the other deferred scripts, so it is in place when they run:
 *
 *   <script src="https://static.memberstack.com/scripts/v2/memberstack.js" data-memberstack-app="..."></script>
 *   <script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/utils/memberstack-shared-reads.js"></script>
 *
 * `v3/scheduling-auth.js` carries the same de-duplication for the dashboard
 * pages and steps aside when this module is already installed
 * (`$memberstackDom.__tsSharedReads`). It can ask this module to drop the
 * in-flight entries through `window.__tsMemberstackSharedReads.invalidate()`.
 */
;(function () {
  'use strict'

  if (window.__tsMemberstackSharedReads) return

  var OWNER = 'utils/memberstack-shared-reads'
  var POLL_MS = 100
  var POLL_LIMIT = 100
  // Reads that do not change the member; everything else counts as a write.
  var NON_INVALIDATING_METHODS = ['getCurrentMember', 'getMemberCookie', 'onAuthChange']

  var inFlight = new Map()
  var revision = 0
  var installed = false

  function invalidate() {
    revision += 1
    inFlight.clear()
  }

  function wrapWrite(memberstack, name, method) {
    memberstack[name] = function () {
      invalidate()
      var result
      try {
        result = method.apply(this, arguments)
      } catch (error) {
        invalidate()
        throw error
      }
      if (result && typeof result.then === 'function') {
        return Promise.resolve(result).then(
          function (value) {
            invalidate()
            return value
          },
          function (error) {
            invalidate()
            throw error
          },
        )
      }
      invalidate()
      return result
    }
  }

  function isFiniteNumber(value) {
    return value === value && value !== Infinity && value !== -Infinity
  }

  function isShareablePrimitive(value) {
    var type = typeof value
    if (type === 'string' || type === 'boolean') return true
    return type === 'number' && isFiniteNumber(value)
  }

  function hasEnumerableSymbolKey(value) {
    if (typeof Object.getOwnPropertySymbols !== 'function') return false
    var symbols = Object.getOwnPropertySymbols(value)
    for (var index = 0; index < symbols.length; index += 1) {
      if (Object.prototype.propertyIsEnumerable.call(value, symbols[index])) return true
    }
    return false
  }

  function isShareablePlainObject(value) {
    if (!value || typeof value !== 'object') return false
    if (Object.getPrototypeOf(value) !== Object.prototype) return false
    if (hasEnumerableSymbolKey(value)) return false
    if (Object.prototype.hasOwnProperty.call(value, 'toJSON')) return false
    var keys = Object.keys(value)
    for (var index = 0; index < keys.length; index += 1) {
      var entry = value[keys[index]]
      if (entry === null || isShareablePrimitive(entry)) continue
      return false
    }
    return true
  }

  function shareableArgs(args) {
    if (!args.length) return []
    var hasDefinedArg = false
    for (var index = 0; index < args.length; index += 1) {
      if (args[index] !== undefined) {
        hasDefinedArg = true
        break
      }
    }
    if (!hasDefinedArg) return []
    for (var argIndex = 0; argIndex < args.length; argIndex += 1) {
      var arg = args[argIndex]
      if (arg === null || arg === undefined) return null
      if (isShareablePrimitive(arg) || isShareablePlainObject(arg)) continue
      return null
    }
    return args
  }

  function install(memberstack) {
    if (installed) return true
    if (!memberstack || typeof memberstack.getCurrentMember !== 'function') return false
    if (memberstack.__tsSharedReads) {
      installed = true
      return true
    }
    installed = true
    memberstack.__tsSharedReads = OWNER
    var original = memberstack.getCurrentMember.bind(memberstack)
    var readCookie =
      typeof memberstack.getMemberCookie === 'function'
        ? memberstack.getMemberCookie.bind(memberstack)
        : function () {
            return Promise.resolve(null)
          }

    memberstack.getCurrentMember = async function () {
      var args = Array.prototype.slice.call(arguments)
      var sharedArgs = shareableArgs(args)
      if (!sharedArgs) return original.apply(null, args)
      var cookie
      try {
        cookie = await readCookie()
      } catch (error) {
        cookie = null
      }
      var key
      try {
        key = JSON.stringify([revision, cookie, sharedArgs])
      } catch (error) {
        return original.apply(null, args)
      }
      var shared = inFlight.get(key)
      if (shared) return shared
      var promise = original.apply(null, sharedArgs)
      inFlight.set(key, promise)
      var release = function () {
        if (inFlight.get(key) === promise) inFlight.delete(key)
      }
      promise.then(release, release)
      return promise
    }

    Object.keys(memberstack).forEach(function (name) {
      var method = memberstack[name]
      if (typeof method !== 'function' || NON_INVALIDATING_METHODS.indexOf(name) !== -1) return
      wrapWrite(memberstack, name, method)
    })

    if (typeof memberstack.onAuthChange === 'function') {
      try {
        memberstack.onAuthChange(function () {
          invalidate()
        })
      } catch (error) {}
    }
    return true
  }

  function installWhenReady(attempt) {
    if (install(window.$memberstackDom)) return
    if (attempt >= POLL_LIMIT) return
    window.setTimeout(function () {
      installWhenReady(attempt + 1)
    }, POLL_MS)
  }

  window.__tsMemberstackSharedReads = {
    owner: OWNER,
    invalidate: invalidate,
    isInstalled: function () {
      return installed
    },
  }

  installWhenReady(0)
})()
