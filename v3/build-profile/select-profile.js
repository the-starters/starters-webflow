/*
 * Build Profile: profile-type selection (/build-profile/select-profile).
 *
 * Replaces the inline Webflow embed on that page (2026-11-26, PostHog report 01a13fe5).
 * Contract (unchanged Designer markup): links with data-btn="profile-full" or
 * data-btn="profile-consult" and an href to the next step.
 *
 * Behavior kept from the embed:
 *  - When the Starter already chose a type before (localStorage ts:build_profile:member:<id>),
 *    clear build_profile from the Memberstack member JSON so the next step starts fresh.
 *  - Remove every ts:build_profile:member* localStorage key, then store the new choice on click.
 *
 * Fixes:
 *  - A member with no JSON (data null) made `delete null.build_profile` throw inside an
 *    uncaught promise ("Cannot convert undefined or null to object").
 *  - The member JSON write now runs in the shared window.__tsMemberJsonWrite queue, so it cannot
 *    overwrite a concurrent writer's keys (same race PR #1182 closed for the other writers).
 *  - A click waits for the pending clear (bounded) before navigating.
 *  - localStorage keys are collected first, then removed (index-shift skip).
 * Routing stays in route-guard.js + build-profile-redirect.js.
 */
(function () {
  'use strict';

  var controllers = window.__tsProfileFormControllers || (window.__tsProfileFormControllers = {});
  if (controllers.buildProfileSelectProfile) return;
  controllers.buildProfileSelectProfile = true;

  var KEY_PREFIX = 'ts:build_profile:member';
  var TYPE_IDS = {
    full: 'a52dcf2c568fa40bf96cd67e4f8c6186',
    consult: 'ca6ff4250b7d01b49e83433432af3686',
  };
  var CLEAR_WAIT_MS = 1500;

  function warn(message, error) {
    try { console.warn('[select-profile] ' + message, error && (error.message || error)); } catch (e) { /* no console */ }
  }

  function getStorage() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }

  function queueMemberJsonWrite(task) {
    var previous = window.__tsMemberJsonWrite || Promise.resolve();
    var next = previous.then(task, task);
    window.__tsMemberJsonWrite = next.then(function () {}, function () {});
    return next;
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  // Resolves true when build_profile was removed, false when there was nothing to clear or it failed.
  function clearMemberBuildProfile() {
    var ms = window.$memberstackDom;
    if (!ms || typeof ms.getMemberJSON !== 'function' || typeof ms.updateMemberJSON !== 'function') {
      return Promise.resolve(false);
    }
    return queueMemberJsonWrite(function () {
      return Promise.resolve(ms.getMemberJSON()).then(function (result) {
        var data = result && isPlainObject(result.data) ? result.data : null;
        if (!data || !Object.prototype.hasOwnProperty.call(data, 'build_profile')) return false;
        var next = {};
        Object.keys(data).forEach(function (key) {
          if (key !== 'build_profile') next[key] = data[key];
        });
        return Promise.resolve(ms.updateMemberJSON({ json: next })).then(function () { return true; });
      });
    }).catch(function (error) {
      warn('could not clear build_profile from member JSON', error);
      return false;
    });
  }

  function removeBuildProfileKeys(storage) {
    if (!storage) return;
    var keys = [];
    try {
      for (var i = 0; i < storage.length; i++) {
        var key = storage.key(i);
        if (key && key.indexOf(KEY_PREFIX) !== -1) keys.push(key);
      }
      keys.forEach(function (key) { storage.removeItem(key); });
    } catch (error) {
      warn('could not clear local build_profile keys', error);
    }
  }

  function waitAtMost(promise, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function () { if (!done) { done = true; resolve(); } };
      setTimeout(finish, ms);
      Promise.resolve(promise).then(finish, finish);
    });
  }

  function init(member) {
    var memberId = (member && member.id) || (window.MEMBER && window.MEMBER.id) || '';
    if (!memberId) return;

    var storage = getStorage();
    var storageKey = KEY_PREFIX + ':' + memberId;
    var hadSelection = false;
    try { hadSelection = !!(storage && storage.getItem(storageKey)); } catch (e) { hadSelection = false; }

    var pendingClear = hadSelection ? clearMemberBuildProfile() : Promise.resolve(false);
    removeBuildProfileKeys(storage);

    var buttons = document.querySelectorAll('[data-btn*=profile]');
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function (event) {
        var type = String((btn.dataset && btn.dataset.btn) || btn.getAttribute('data-btn') || '').replace('profile-', '');
        var typeId = TYPE_IDS[type];
        if (!typeId) return; // unknown button: leave the native link alone
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        var profile = { type: type, type_id: typeId, last_update: null, data: {} };
        try { if (storage) storage.setItem(storageKey, JSON.stringify(profile)); } catch (error) { warn('could not save the profile type', error); }
        var href = btn.href || btn.getAttribute('href');
        waitAtMost(pendingClear, CLEAR_WAIT_MS).then(function () {
          if (href) window.location.href = href;
        });
      });
    });
  }

  function start() {
    if (typeof window.waitForMember === 'function') {
      Promise.resolve(window.waitForMember(init)).catch(function (error) { warn('member did not load', error); });
    } else {
      init(window.MEMBER);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
