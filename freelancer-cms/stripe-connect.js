;(function () {
  'use strict'

  // V3 replacement for the legacy V2 inline "Connect Stripe" / "Connect
  // Calendar" embed on the freelancer profile (hire) template.
  //
  // Security rationale (why this module exists): the V2 embed shipped a live
  // Make webhook URL and a pre-minted, member-id-bearing Stripe Connect link
  // straight into the public page HTML for every freelancer. Anyone viewing a
  // profile could read another member's onboarding link out of the source.
  // This version puts NO Stripe links or webhook URLs in the page. It fetches
  // the links on demand from an authenticated Xano endpoint, and only when the
  // logged-in member IS the profile owner. The server resolves the starter from
  // the Bearer session ($auth); the client sends no ids.
  //
  // Data contract (Webflow page embed, CMS-bound, hidden):
  //   <div id="ts-stripe-connect-data"
  //        data-memberstack-id="{{ memberstack-id }}"
  //        data-xano-id="{{ xano-id }}"
  //        style="display:none"></div>
  // data-memberstack-id is used ONLY to decide ownership client-side (fast
  // fail for non-owners). It is never sent to Xano.
  //
  // Endpoint (POST, Bearer via window.xanoAuthFetch, empty JSON body):
  //   /api:tCpV3oqd/stripe/connect_links  ->
  //   { charges_enabled: bool, connect_url: string|null, dashboard_url: string|null }
  // The endpoint does not exist yet; this module must no-op gracefully on a
  // 404/error and never throw to the production console.

  var STAGING_HOST = 'the-starters-3-0.webflow.io'
  // V3 is not launched on the custom domains yet. Do not expand this guard
  // without explicit launch approval (matches scheduling-auth.js).
  if (window.location.hostname !== STAGING_HOST) return
  if (window.__tsStripeConnect) return
  window.__tsStripeConnect = true

  var XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
  var CONNECT_LINKS_PATH = '/api:tCpV3oqd/stripe/connect_links'
  var DATA_EL_ID = 'ts-stripe-connect-data'
  // The 3.0 freelancer dashboard is a single static page (not a per-member CMS
  // page like V2's /freelancers-v2/<ms-id>).
  var DASHBOARD_URL = '/starter-dashboard'

  // Safe synchronous defaults. Other page code reads window.stripe_charges
  // synchronously inside its Memberstack callback to decide whether to show the
  // [no-connection="paid"] warning, so seed a conservative default before the
  // owner fetch resolves. Only set it if nothing else already has.
  if (typeof window.stripe_charges === 'undefined') window.stripe_charges = false
  window.starter_dashboard_url = DASHBOARD_URL

  // --- Staging-only diagnostics -------------------------------------------
  // Warnings help during development but must never reach a client-facing
  // production console. "Staging" = Webflow *.webflow.io, local dev, or the
  // cloudflared dev tunnel. Force on/off with window.STRIPE_CONNECT_DEBUG =
  // true/false, or a localStorage "STRIPE_CONNECT_DEBUG" = "true"/"false".
  function isStaging() {
    if (window.STRIPE_CONNECT_DEBUG === true) return true
    if (window.STRIPE_CONNECT_DEBUG === false) return false
    try {
      var stored = window.localStorage && window.localStorage.getItem('STRIPE_CONNECT_DEBUG')
      if (stored === 'true') return true
      if (stored === 'false') return false
    } catch (error) {
      /* localStorage may be unavailable (privacy mode); fall through to host */
    }
    var host = window.location.hostname
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(^|\.)webflow\.io$/.test(host) ||
      /(^|\.)trycloudflare\.com$/.test(host)
    )
  }

  function debug() {
    if (!isStaging()) return
    if (window.console && console.warn) {
      var args = Array.prototype.slice.call(arguments)
      args.unshift('[stripe-connect]')
      console.warn.apply(console, args)
    }
  }

  function qsa(selector) {
    return document.querySelectorAll(selector)
  }

  // Site CSS hides these controls by default (display:none); the legacy embed
  // revealed the active one with display:flex. Mirror that exactly.
  function reveal(selector, href) {
    qsa(selector).forEach(function (item) {
      item.style.display = 'flex'
      if (href) item.href = href
    })
  }

  // Component-mode wiring. On the 3.0 hire template the CTAs are no longer
  // discrete `[stripe-connect-url]`/`[stripe-dashboard-url]` anchors — they are
  // shared design-system component instances inside the `service-card_tooltip`
  // block of the "Service Card - Tooltip" component (its `no-connection` value
  // is bound to a per-instance "Connect Type" prop). Visibility is owned by the
  // Service Card State prop, not by us: we only point the CTA at `url` and never
  // touch display or add the legacy hide-me attributes.
  //
  // The 3.0 Button component does NOT render an `<a>`. It renders a native
  // `<button class="clickable_btn">` (verified on the live staging page — there
  // is no anchor anywhere inside the card):
  //   <div class="button_main-wrap" data-opp-element="loading-button">
  //     <div class="clickable_wrap"><button class="clickable_btn"></button></div>
  //     <div class="button_main-element">…<div class="button_main-text">…</div>…</div>
  //   </div>
  // So we resolve the CTA as the first `a` OR `button.clickable_btn` (falling
  // back to the first `button`). An anchor gets its href set (legacy behavior);
  // a button gets a navigation click handler.
  //
  // The wired URL can change between calls (e.g. connect -> dashboard once the
  // account exists), so the click handler must always use the LATEST URL. We
  // store it on the element's dataset and read it at click time instead of
  // closing over it, and guard against binding the listener more than once.
  function wireComponentCtas(selector, url) {
    if (!url) return
    qsa(selector).forEach(function (wrapper) {
      var cta =
        wrapper.querySelector('a, button.clickable_btn') || wrapper.querySelector('button')
      if (!cta) return
      if (cta.tagName === 'A') {
        cta.href = url
        return
      }
      // Native button CTA: navigate on click, always to the latest URL.
      cta.dataset.tsConnectUrl = url
      var mainWrap = wrapper.querySelector('.button_main-wrap')
      if (mainWrap) mainWrap.style.cursor = 'pointer'
      if (cta.dataset.tsConnectBound === 'true') return
      cta.dataset.tsConnectBound = 'true'
      cta.addEventListener('click', function () {
        var target = cta.dataset.tsConnectUrl
        if (target) window.location.assign(target)
      })
    })
  }

  function onReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback)
    } else {
      callback()
    }
  }

  // Expose a Promise other page code can await instead of racing the global.
  // Resolves with the endpoint response on success, or null on any failure
  // (not logged in, non-owner, missing auth helper, network/parse error, 404).
  var resolveReady
  window.tsStripeConnectReady = new Promise(function (resolve) {
    resolveReady = resolve
  })

  // Always point [starter-dashboard-url] ("Connect Calendar") controls at the
  // static dashboard, for everyone (matches the legacy embed, which wired this
  // regardless of Stripe state).
  onReady(function () {
    qsa('[starter-dashboard-url]').forEach(function (item) {
      item.href = window.starter_dashboard_url
    })
    // Component-mode counterpart: the "Connect Calendar" CTA now lives inside a
    // `[no-connection="free"]` tooltip wrapper as a shared Button instance.
    // Wire its CTA to the same static dashboard, unconditionally.
    wireComponentCtas('[no-connection="free"]', window.starter_dashboard_url)
  })

  function readData() {
    var el = document.getElementById(DATA_EL_ID)
    if (!el) return null
    return {
      memberstackId: el.getAttribute('data-memberstack-id') || null,
      xanoId: el.getAttribute('data-xano-id') || null,
    }
  }

  // Wait for the Memberstack client, then resolve the live member (or null).
  function waitForMemberstack() {
    return new Promise(function (resolve) {
      var attempts = 0
      ;(function poll() {
        var memberstack = window.$memberstackDom
        if (memberstack && typeof memberstack.getCurrentMember === 'function') {
          resolve(memberstack)
          return
        }
        if (window.memberReady && typeof window.memberReady.then === 'function') {
          resolve(null)
          return
        }
        // ~10s ceiling so a page without Memberstack never hangs the promise.
        if (attempts++ > 100) {
          resolve(null)
          return
        }
        window.setTimeout(poll, 100)
      })()
    })
  }

  function getMember() {
    return waitForMemberstack().then(function (memberstack) {
      if (memberstack) {
        return memberstack.getCurrentMember().then(function (result) {
          return (result && result.data) || null
        })
      }
      if (window.memberReady && typeof window.memberReady.then === 'function') {
        return window.memberReady.then(function (member) {
          return member || null
        })
      }
      return null
    })
  }

  function applyLinks(payload) {
    // charges_enabled is the source of truth; publish it for other page code.
    window.stripe_charges = !!(payload && payload.charges_enabled === true)
    onReady(function () {
      // Connected + charging: leave every CTA hidden (nothing to prompt).
      if (window.stripe_charges) return
      if (payload && payload.dashboard_url) {
        reveal('[stripe-dashboard-url]', payload.dashboard_url)
      } else if (payload && payload.connect_url) {
        reveal('[stripe-connect-url]', payload.connect_url)
      }
      // Component-mode counterpart for the paid "Connect Stripe" tooltip: the
      // CTA is a shared Button instance inside a `[no-connection="paid"]`
      // wrapper, not a discrete legacy anchor. Prefer the dashboard link (an
      // account exists but is not yet charging), else the connect/onboarding
      // link. We only point the CTA at the URL — the component owns visibility.
      var componentUrl =
        (payload && payload.dashboard_url) || (payload && payload.connect_url) || null
      wireComponentCtas('[no-connection="paid"]', componentUrl)
    })
  }

  function run() {
    var data = readData()
    return getMember().then(function (member) {
      if (!member || !member.id) {
        debug('no logged-in member; leaving CTAs hidden')
        return null
      }
      // Non-owners must never trigger a Stripe-link fetch.
      if (!data || !data.memberstackId) {
        debug('missing #' + DATA_EL_ID + ' owner id; not fetching Stripe links')
        return null
      }
      if (member.id !== data.memberstackId) {
        debug('viewer is not the profile owner; not fetching Stripe links')
        return null
      }
      if (typeof window.xanoAuthFetch !== 'function') {
        debug('window.xanoAuthFetch unavailable; leaving CTAs hidden')
        return null
      }

      return window
        .xanoAuthFetch(XANO_ORIGIN + CONNECT_LINKS_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        .then(function (response) {
          if (!response || !response.ok) {
            // Includes 404 while the endpoint is still unbuilt.
            debug('connect_links returned', response && response.status)
            return null
          }
          return response.json().then(function (payload) {
            applyLinks(payload)
            return payload
          })
        })
    })
  }

  run()
    .then(function (payload) {
      resolveReady(payload || null)
    })
    .catch(function (error) {
      debug('connect flow failed:', error && error.message)
      resolveReady(null)
    })

  // Small surface for other page code / retries.
  window.tsStripeConnect = { run: run }
})()
