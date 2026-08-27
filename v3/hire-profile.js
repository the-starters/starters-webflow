/**
 * V3 hire-profile renderer — /hire/<slug>
 *
 * Ported from the page-level FOOTER custom code on the hire template (page
 * 69f241ed147b71addb6f153d), so that the remaining runtime logic lives in
 * GitHub instead of in Webflow. Same intent as v3/profile-portfolio.js.
 * Backup of the exact source block:
 * webflow-sites/starters-3/custom-code-backups/hire-template-footer-pre-cdn-migration-2026-08-16.html
 *
 * WHAT IT DOES
 *  - The starter Xano id carrier used to key the public Algolia record lookup.
 *    Experiences and Clients are outside this file: Webflow CMS renders them
 *    natively for all viewers after the Phase 2 cutover.
 *  - Booking wiring, which stays behind the Memberstack member gate.
 *  - Services call-card visibility. Anonymous viewers stay closed. Signed-in
 *    brands use canonical booking discovery and successful controller installs.
 *    Starter members keep the live-derived owner toggles.
 *  - Freelance/Retainer rate cards, cloned from the section's Default card.
 *  - Small page utilities that shipped in the same footer (rate formatting,
 *    rating average, dropdowns, anchor scroll, mobile TOC, view-all, see-more).
 *
 * SCOPING: every original <script> block keeps its own IIFE. The blocks were
 * separate scripts, so merging them into one shared scope would collide (two
 * blocks each declare `el`). No page code outside the footer referenced any of
 * these symbols — verified against published source on 2026-08-16 — so nothing
 * depends on them being global.
 *
 * TIMING: this loads deferred, so it runs after HTML parse instead of mid-parse.
 * That is strictly later than the inline footer was, so every global it reads is
 * already defined. Reads of page-embed globals are guarded to warn rather than
 * throw, because a ReferenceError here would abort the whole file.
 *
 * DEPENDS ON (defined by earlier page/site embeds, not by this file):
 *   starter_memberstack_id, stripe_charges, waitForMember, memberReady, MEMBER,
 *   qs, qsa,
 *   jQuery ($, two utility blocks),
 *   window.WfAlgolia (search record).
 *
 * StartersFreeCallBooking is loaded from the GitHub/jsDelivr asset when an
 * older Webflow page head does not install it yet. The dependency stays
 * fail-closed: booking remains hidden if the hosted controller cannot load.
 *
 * The Algolia index is READ FROM THE PAGE, never hardcoded: v3/algolia-environment.js
 * rewrites [wf-algolia-index] per environment and the search key 403s any other
 * index. Hardcoding Freelancers3.0-dev is what broke Services on 2026-08-16.
 */

(function () {
  'use strict';

  function ensureBookingModalAvailabilityGuard() {
      const guardId = 'hire-booking-modal-availability-guard';
      if (document.getElementById(guardId)) return;

      const style = document.createElement('style');
      style.setAttribute('id', guardId);
      style.textContent = [
          '[data-booking-unavailable]{display:none!important}',
          '[data-booking-trigger-unavailable]{display:none!important}',
          '[data-canonical-call-unavailable]{display:none!important}',
      ].join('');
      (document.head || document.documentElement).appendChild(style);
  }

  function primeBookingModalOptions(configs) {
      const records = Array.isArray(configs) ? configs : [];

      document.querySelectorAll('[call-type-item]').forEach(function (item) {
          let available = false;

          item.querySelectorAll('[booking-popup-open][data-type]').forEach(function (cta) {
              const type = cta.getAttribute('data-type');
              const record = records.find(function (candidate) {
                  if (type === 'paid') return candidate.is_paid === true;
                  if (type === 'free') return candidate.is_paid === false;
                  return false;
              });

              if (record) {
                  cta.setAttribute('data-config', record.config_id);
                  available = true;
              } else {
                  // The shared initializer registers every CTA that merely has
                  // data-config, including an empty value. Remove the attribute
                  // so an unavailable call type cannot pass its Stripe/readiness
                  // checks and reopen after this fail-closed hide.
                  cta.removeAttribute('data-config');
              }
          });

          if (available) {
              item.removeAttribute('data-booking-unavailable');
              item.removeAttribute('aria-hidden');
          } else {
              // Global Code can capture Designer-authored empty config attributes
              // before this controller finishes discovery, then reopen Paid in an
              // asynchronous Stripe callback. Keep unavailable types structurally
              // fail-closed even if that older callback changes inline display.
              item.setAttribute('data-booking-unavailable', '');
              item.setAttribute('aria-hidden', 'true');
          }
          item.style.display = 'none';
      });
  }

  function reconcileInstalledBookingModalOptions(configs) {
      primeBookingModalOptions(configs);
      document.querySelectorAll(
          '[call-type-item] [booking-popup-open][data-type][data-config]'
      ).forEach(function (cta) {
          const item = cta.closest('[call-type-item]');
          if (item) item.style.display = 'block';
      });
  }

  function setBookingButtonAvailable(available) {
      document.querySelectorAll('[booking-button-wrapper]').forEach(function (wrapper) {
          wrapper.style.display = available ? 'flex' : 'none';
          wrapper.setAttribute('aria-hidden', available ? 'false' : 'true');
      });

      // The hire template has more than one authored Book Call entry point.
      // Some are not descendants of booking-button-wrapper, so hiding only the
      // wrapper can leave a live trigger that opens an empty chooser while
      // canonical discovery is still closed. Gate every chooser trigger with
      // the same discovery result.
      document.querySelectorAll('[data-modal-trigger="popup-booking-main"]').forEach(function (trigger) {
          if (available) {
              trigger.removeAttribute('data-booking-trigger-unavailable');
              trigger.removeAttribute('aria-disabled');
          } else {
              trigger.setAttribute('data-booking-trigger-unavailable', '');
              trigger.setAttribute('aria-disabled', 'true');
          }
      });

      document.querySelectorAll('[data-modal-target="popup-booking-main"]').forEach(function (dialog) {
          if (available) {
              dialog.removeAttribute('data-booking-surface-unavailable');
          } else {
              dialog.setAttribute('data-booking-surface-unavailable', '');
          }
      });
  }

  function syncCanonicalCallSurfaces(configs) {
      const records = Array.isArray(configs) ? configs : [];
      let changed = false;
      const availability = {
          free: records.some(function (record) { return record && record.is_paid === false; }),
          paid: records.some(function (record) { return record && record.is_paid === true; }),
      };

      ['free', 'paid'].forEach(function (type) {
          document.querySelectorAll('[has-connection="' + type + '"]').forEach(function (surface) {
              if (surface.hasAttribute('hidden') || surface.hasAttribute('data-runtime-call-template')) {
                  return;
              }
              if (availability[type]) {
                  changed = changed ||
                      surface.hasAttribute('data-canonical-call-unavailable') ||
                      surface.getAttribute('aria-hidden') === 'true' ||
                      surface.style.display !== 'block';
                  surface.removeAttribute('data-canonical-call-unavailable');
                  surface.removeAttribute('aria-hidden');
                  surface.style.display = 'block';
              } else {
                  changed = changed ||
                      !surface.hasAttribute('data-canonical-call-unavailable') ||
                      surface.getAttribute('aria-hidden') !== 'true' ||
                      surface.style.display !== 'none';
                  surface.setAttribute('data-canonical-call-unavailable', '');
                  surface.setAttribute('aria-hidden', 'true');
                  surface.style.display = 'none';
              }
          });
      });
      return changed;
  }

  function findReadyCallTypeCta(type) {
      const readyAttribute = type === 'paid'
          ? 'data-paid-call-v3'
          : 'data-free-call-v3';
      return Array.from(document.querySelectorAll(
          '[call-type-item] [booking-popup-open][data-type="' + type + '"][data-config]'
      )).find(function (cta) {
          const item = cta.closest('[call-type-item]');
          return item &&
              !item.hasAttribute('data-booking-unavailable') &&
              item.getAttribute('aria-hidden') !== 'true' &&
              cta.getAttribute(readyAttribute) === 'ready' &&
              typeof cta.click === 'function';
      }) || null;
  }

  function findReadyBookingModalTrigger() {
      return Array.from(document.querySelectorAll(
          '[data-modal-trigger="popup-booking-main"]'
      )).find(function (trigger) {
          return !trigger.hasAttribute('data-booking-trigger-unavailable') &&
              trigger.getAttribute('aria-disabled') !== 'true' &&
              typeof trigger.click === 'function';
      }) || null;
  }

  function openBookingModalFromRegistry() {
      const modal = window.lumos && window.lumos.modal;
      const entry = modal && modal.list
          ? modal.list['popup-booking-main']
          : null;
      if (!entry || typeof entry.open !== 'function') return false;
      if (entry.el && entry.el.open) return true;

      try {
          entry.open();
          return true;
      } catch (_error) {
          return false;
      }
  }

  function openReadyCallType(type) {
      const cta = findReadyCallTypeCta(type);
      if (!cta) return false;

      // The authored modal library expects the normal two-dialog sequence:
      // open popup-booking-main, then open the selected popup-booking flow.
      // A direct call-service click used to invoke only the second trigger.
      // That could run the controller while its dialog was still closed and
      // leave Free on an empty/loading surface. Open the shell first, then
      // activate the exact installed CTA after the first click has completed.
      const modalTrigger = findReadyBookingModalTrigger();
      if (modalTrigger) modalTrigger.click();
      else if (!openBookingModalFromRegistry()) return false;
      window.setTimeout(function () {
          const currentCta = findReadyCallTypeCta(type);
          if (currentCta) currentCta.click();
      }, 0);
      return true;
  }

  const directCallServiceCards = new WeakSet();

  function wireCallServiceCardsToDirectEntry() {
      // Call service cards are authored in both the profile hero and #services.
      // Bind by the shared component contract instead of the section location so
      // both placements use the same direct Free/Paid modal path. The chooser's
      // own CTAs are not service-card components and remain untouched.
      document.querySelectorAll('[data-service-card="component"]').forEach(function (card) {
          // The native Webflow service cards identify the call type through
          // has-connection. Keep data-type as a compatibility hook for older
          // saved markup and focused fixtures.
          const type = card.getAttribute('data-type') || card.getAttribute('has-connection');
          if (type !== 'free' && type !== 'paid') return;
          // A cloned DOM node copies attributes but not listeners. Track actual
          // listener ownership by element identity instead of trusting the
          // diagnostic attribute as the binding guard.
          if (directCallServiceCards.has(card)) return;

          // Service cards are type-specific shortcuts. They reuse the exact
          // installed chooser CTA so the matching GitHub controller and native
          // Webflow modal lifecycle stay authoritative, without showing the
          // generic Free/Paid choice first.
          card.removeAttribute('booking-popup-open');
          card.removeAttribute('data-modal-trigger');
          card.setAttribute('data-call-service-direct', 'ready');
          card.addEventListener('click', function (event) {
              event.preventDefault();
              event.stopImmediatePropagation();
              openReadyCallType(type);
          }, true);
          directCallServiceCards.add(card);
      });
  }

  function observeCallServiceCards() {
      if (typeof MutationObserver !== 'function' || !document.body) return;
      const observer = new MutationObserver(function (records) {
          if (!records.some(function (record) {
              return record && record.type === 'childList' && record.addedNodes && record.addedNodes.length;
          })) return;
          wireCallServiceCardsToDirectEntry();
      });
      observer.observe(document.body, { childList: true, subtree: true });
  }

  function isBlockedProductionBookingSurface() {
      const host = window.location && window.location.hostname;
      const path = window.location && window.location.pathname
          ? window.location.pathname.replace(/\/+$/, '') || '/'
          : '';
      const isProductionHost = host === 'thestarters.com' || host === 'www.thestarters.com';
      return isProductionHost && path === '/hire/jp-dionisio';
  }

  ensureBookingModalAvailabilityGuard();
  primeBookingModalOptions([]);
  syncCanonicalCallSurfaces([]);
  // Webflow authors the structural Book Call triggers and dialog. Canonical
  // environment-scoped discovery is the only code path that may enable them.
  setBookingButtonAvailable(false);
  wireCallServiceCardsToDirectEntry();
  observeCallServiceCards();

  // Page-embed contract. This file is deferred, so all of these are already
  // defined in the normal case; stand down loudly rather than throwing if not.
  var qs = window.qs;
  var qsa = window.qsa;
  var waitForMember = window.waitForMember;
  var memberReady = window.memberReady;
  var freeCallBooking = window.StartersFreeCallBooking;
  var freeCallBookingLoadPromise = null;
  var FREE_CALL_BOOKING_URL =
      'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/free-call-booking.js';
  var FREE_CALL_BOOKING_LOADER_ATTR = 'data-starters-free-call-booking-loader';
  var FREE_CALL_BOOKING_TIMEOUT_MS = 5000;

  function validFreeCallBooking(value) {
      return value &&
          typeof value.getStarterByMemberId === 'function';
  }

  function validBookingDiscovery(value) {
      return validFreeCallBooking(value) &&
          typeof value.getConfigs === 'function';
  }

  function isFreeCallBookingScript(script) {
      try {
          return new URL(script.src, window.location.href).pathname
              .endsWith('/v3/free-call-booking.js');
      } catch (_error) {
          return false;
      }
  }

  // This file is deferred, so a parser-inserted blocking tag has already
  // executed and can never fire load/error again. Reuse only a tag that can
  // still settle: an async/deferred one, or a loader this recovery injected.
  function pendingFreeCallBookingLoader() {
      var scripts = Array.from(document.querySelectorAll('script[src]'));
      return scripts.find(function (script) {
          return (
              script.async ||
              script.defer ||
              script.hasAttribute(FREE_CALL_BOOKING_LOADER_ATTR)
          ) && isFreeCallBookingScript(script);
      }) || null;
  }

  function ensureFreeCallBooking() {
      if (validFreeCallBooking(window.StartersFreeCallBooking)) {
          freeCallBooking = window.StartersFreeCallBooking;
          return Promise.resolve(freeCallBooking);
      }
      if (freeCallBookingLoadPromise) return freeCallBookingLoadPromise;

      freeCallBookingLoadPromise = new Promise(function (resolve) {
          var settled = false;
          var timeoutId = null;
          var injected = false;

          function finish(value) {
              if (settled) return;
              settled = true;
              if (timeoutId !== null) window.clearTimeout(timeoutId);
              freeCallBooking = validFreeCallBooking(value) ? value : null;
              resolve(freeCallBooking);
          }

          function failed() {
              console.warn('[hire-profile] Free Call booking controller failed to load');
              finish(null);
          }

          // Every settle path re-reads the global first: a reused tag can have
          // installed it without notifying us. Only give up once the canonical
          // loader this file owns has had its own turn.
          function attemptSettle() {
              if (settled) return;
              if (validFreeCallBooking(window.StartersFreeCallBooking)) {
                  finish(window.StartersFreeCallBooking);
                  return;
              }
              if (injected) {
                  failed();
                  return;
              }
              watch(injectLoader());
          }

          function injectLoader() {
              injected = true;
              var loader = document.createElement('script');
              loader.setAttribute('src', FREE_CALL_BOOKING_URL);
              loader.setAttribute(FREE_CALL_BOOKING_LOADER_ATTR, '');
              loader.async = true;
              (document.head || document.documentElement).appendChild(loader);
              return loader;
          }

          function watch(loader) {
              if (timeoutId !== null) window.clearTimeout(timeoutId);
              loader.addEventListener('load', attemptSettle, { once: true });
              loader.addEventListener('error', attemptSettle, { once: true });
              timeoutId = window.setTimeout(attemptSettle, FREE_CALL_BOOKING_TIMEOUT_MS);
          }

          watch(pendingFreeCallBookingLoader() || injectLoader());
      });

      return freeCallBookingLoadPromise;
  }
  if (typeof qs !== 'function' || typeof qsa !== 'function' || typeof waitForMember !== 'function') {
    console.warn('[hire-profile] page helpers (qs/qsa/waitForMember) missing; profile scripts stood down');
    return;
  }
  if (!window.starter_memberstack_id) {
    console.warn('[hire-profile] starter_memberstack_id missing; profile scripts stood down');
    return;
  }

  // `starter_memberstack_id` is a global var (set by an embedded script at the
  // top of the Freelancer Template page). Read it off window so a missing global
  // warns instead of throwing a ReferenceError that would abort this file.
  const FREELANCER_ID = window.starter_memberstack_id;
  // Keep this map aligned with v3/route-guard.js and v3/auth-route.js. Access
  // decisions use stable Memberstack plan IDs; display names and old dashboard
  // URL fields are not role authority.
  const MEMBERSTACK_PLAN_ROLES = {
      'pln_free-plan-f6kn0dxz': 'brand-free',
      'pln_new-paid-plan-463h04ph': 'brand-paid',
      'pln_dorxata-test-free-plan-dvcg0k8o': 'talent',
      'pln_dorxata-test-brand-plan-777r02pa': 'brand-paid',
  };

  function isActivePlanConnection(connection) {
      return !!connection && (connection.active === true || connection.status === 'ACTIVE');
  }

  function memberRole(member) {
      const hasPlanConnections = !!member
          && Object.prototype.hasOwnProperty.call(member, 'planConnections');
      const hasPlanConnectionList = hasPlanConnections && Array.isArray(member.planConnections);
      const connections = hasPlanConnectionList ? member.planConnections : [];
      const roles = connections
          .filter(isActivePlanConnection)
          .map(function (connection) {
              return MEMBERSTACK_PLAN_ROLES[connection.planId];
          })
          .filter(Boolean);
      const hasTalent = roles.includes('talent');
      const hasBrandPaid = roles.includes('brand-paid');
      const hasBrandFree = roles.includes('brand-free');

      // A cross-role member is not eligible to book. Unknown or inactive plan
      // records also stay closed when Memberstack supplied plan history.
      if (hasTalent && (hasBrandPaid || hasBrandFree)) return null;
      if (hasBrandPaid) return 'brand-paid';
      if (hasBrandFree) return 'brand-free';
      if (hasTalent) return 'talent';
      if (hasPlanConnections) return null;

      // Compatibility only for older members whose SDK payload omits the plan
      // connection list. Once plan data exists, even an empty list always wins.
      return member && member.customFields && member.customFields['brands-dashboard-url']
          ? 'legacy-brand'
          : null;
  }

  function isBrandMember(member) {
      const role = memberRole(member);
      return role === 'brand-free' || role === 'brand-paid' || role === 'legacy-brand';
  }

  function selectBookableConfigurations(records) {
      if (!Array.isArray(records)) return [];

      const isTestHost = location.hostname === 'the-starters-3-0.webflow.io';
      const isProductionHost = location.hostname === 'thestarters.com' ||
          location.hostname === 'www.thestarters.com';
      if (!isTestHost && !isProductionHost) return [];

      const expectedDataEnvironment = isTestHost ? 'test' : 'production';
      const expectedPaymentEnvironment = isTestHost ? 'test' : 'live';
      const active = records.filter(function (record) {
          if (!record || !record.config_id || record.active !== true) return false;
          if (record.data_environment !== expectedDataEnvironment) return false;
          if (record.is_paid === true) {
              const priceCents = Number(record.price_cents);
              const duration = Number(record.duration);
              return record.payment_environment === expectedPaymentEnvironment &&
                  String(record.currency || '').toUpperCase() === 'USD' &&
                  Number.isInteger(priceCents) &&
                  priceCents >= 100 &&
                  duration === 60;
          }
          return record.is_paid === false &&
              (record.price_cents == null || Number(record.price_cents) === 0) &&
              (record.duration == null || Number(record.duration) === 30);
      });
      const configIds = new Set();
      const hasDuplicateConfigId = active.some(function (record) {
          if (configIds.has(record.config_id)) return true;
          configIds.add(record.config_id);
          return false;
      });
      const free = active.filter(function (record) { return record.is_paid !== true; });
      const paid = active.filter(function (record) { return record.is_paid === true; });

      if (hasDuplicateConfigId || free.length > 1 || paid.length > 1) {
          console.warn('Duplicate active booking configurations require reconciliation.');
          return [];
      }

      // Keep Free first so the shared modal's nearest-slot preview remains
      // deterministic while each option still receives its own config ID.
      return free.concat(paid);
  }

  // Park the beside-services calendar experiment. The live Hire experience
  // keeps the generic two-step modal: Book Call -> Free/Paid -> calendar.
  // Type-specific Services cards reuse the installed matching CTA and go
  // straight to that call type's calendar.
  // Keep the authored panel available for a future opt-in, but never let
  // leftover preview markup take ownership of booking cards.
  const INLINE_BOOKING_WRAPPER = document.querySelector('[data-availability-element="wrapper"]');
  if (INLINE_BOOKING_WRAPPER) {
      INLINE_BOOKING_WRAPPER.style.display = 'none';
      INLINE_BOOKING_WRAPPER.setAttribute('aria-hidden', 'true');
  }
  // The starter's Xano id is CMS-bound into the page ([data-starter-xano-id]
  // inside the native-binding wrapper); it keys the public search-record
  // lookup. Experiences/clients render natively from the CMS since the
  // Phase 2 cutover, so no runtime fetch supplies this id anymore.
  const STARTER_XANO_ID_READY = Promise.resolve((function () {
      const carrier = document.querySelector('[data-starter-xano-id]');
      const value = carrier ? parseInt(carrier.textContent, 10) : NaN;
      return Number.isFinite(value) && value > 0 ? value : null;
  })());
  // Declared before the parse-time IIFEs below so getPublicStarterRecord can run at parse time.
  let publicStarterRecordPromise = null;

  waitForMember(async function () {
      if (!MEMBER.id) return;

      /* BOOKING (viewer-specific; stays behind the member gate) */
      (async function () {
          if (isBlockedProductionBookingSurface()) {
              console.warn('[hire-profile] TEST booking fixture stayed closed on production');
              return;
          }

          freeCallBooking = await ensureFreeCallBooking();
          if (!validFreeCallBooking(freeCallBooking)) {
              console.warn('[hire-profile] Free Call booking controller is unavailable');
              return;
          }

          const brand_name = MEMBER.customFields['free-user'] + " " + MEMBER.customFields['last-name'];
          const brand_email = MEMBER['auth']['email'];

          // if it's not a brand
          if (!isBrandMember(MEMBER)) {
              // check calendar\availability connections
              const starter = await freeCallBooking.getStarterByMemberId(FREELANCER_ID);
              const grant_id = starter ? starter['nylas_grant_id'] : null;
              const ownerConfigs = [];
              if (grant_id) ownerConfigs.push({ is_paid: false });
              if (grant_id && window.stripe_charges) ownerConfigs.push({ is_paid: true });
              syncCanonicalCallSurfaces(ownerConfigs);
              if (!grant_id) {
                  qsa('[no-connection="free"]').forEach((item) => item.style.display = "block");
              } else {
                  qsa('[has-connection="free"]').forEach((item) => item.style.display = "block");
              }

              // check stripe connections
              // `stripe_charges` is a global var (assigned as window.stripe_charges
              // by an embedded script at the top of the page).
              if (!window.stripe_charges) {
                  qsa('[no-connection="paid"]').forEach((item) => item.style.display = "block");

              } else if (!grant_id && window.stripe_charges) {
                  qsa('[no-connection="paid"]').forEach((item) => {
                      item.style.display = "block";

                      qsa('[hover-text]', item).forEach((item) => {
                          item.textContent = "Connect your calendar to start accepting paid consulting calls.";
                      });

                      qsa('[hover-cta]', item).forEach((item) => {
                          const wrap = item.closest('[hover-cta-wrap]');
                          if (!wrap) return;

                          if (item.hasAttribute('starter-dashboard-url')) {
                              wrap.style.display = "block";
                          } else {
                              wrap.style.display = "none";
                          }
                      });
                  });

              } else {
                  qsa('[has-connection="paid"]').forEach((item) => item.style.display = "block");
              }

              refreshEmptySectionNav();
              return;
          }

          startersBooking_handler(FREELANCER_ID, brand_name, brand_email);
      })();
  });

  /* PUBLIC-RECORD SERVICES (anonymous + brand viewers)
     The public record supplies non-call services only. Call projections stay
     closed for anonymous viewers and use canonical discovery for brands.
     Starter members keep the live-derived owner toggles above. */
  waitForMember(async function () {
      var isBrand = isBrandMember(MEMBER);
      if (MEMBER.id && !isBrand) return;

      try {
          const record = await getPublicStarterRecord();
          if (!record) return;

          if (!MEMBER.id) markServiceCardsClickable();
          if (isBrand) {
              wireProjectServiceCards();
              window.setTimeout(wireProjectServiceCards, 0);
          }
          refreshEmptySectionNav();
      } catch (error) {
          console.warn('Anonymous services:', error);
      }
  });

  function refreshEmptySectionNav() {
      /* hide-empty-sections.js decides whether #services is empty, and it
         watches the DOM with `{ childList: true, subtree: true }` — no
         `attributes`. Revealing a call card only flips inline style, which
         that observer cannot see, so the section stays hidden along with its
         TOC link even though cards are now visible. The rate-card prepend is
         a childList change and sometimes rescues it, which made the bug look
         intermittent rather than constant. Poke the refresh hook the script
         exposes for exactly this case; it is debounced and safe to call more
         than once, and its absence must never break rendering. */
      try {
          if (typeof window.__startersEmptyNavRefresh === 'function') {
              window.__startersEmptyNavRefresh();
          }
      } catch (error) {
          /* cosmetic only */
      }
  }

  function markServiceCardsClickable() {
      /* Logged-out clicks are handled by signup-attribution.js: its
         capture-phase document listener opens the signup modal for any
         [data-signup-trigger-element] click and stamps attribution. All
         four cards carry those attributes (the rate-card clones set their
         own value below), so this only adds the pointer affordance. */
      const serviceCards = Array.from(qsa('[data-service-card="component"]')).filter(function (card) {
          return !!card.closest('#services');
      });
      Array.from(qsa('[data-rate-card]')).filter(function (card) {
          return !!card.closest('#services');
      }).forEach(function (card) {
          if (!serviceCards.includes(card)) serviceCards.push(card);
      });
      serviceCards.forEach(function (card) {
          if (getComputedStyle(card).display === 'none') return;
          card.style.cursor = 'pointer';
      });
  }

  /* RATE SERVICE CARDS (all viewers)
     The Services section ships only call cards; the Freelance/Retainer
     rates exist only in the hero tout. Build native-looking rate cards
     from the public search record until the Designer adds CMS-bound
     cards (headless APIs cannot author designed components). */
  (async function () {
      try {
          const record = await getPublicStarterRecord();
          if (!record) return;

          renderRateCards(record);
          await memberReady;
          if (!MEMBER.id) markServiceCardsClickable();
          if (isBrandMember(MEMBER)) {
              wireProjectServiceCards();
              window.setTimeout(wireProjectServiceCards, 0);
          }
          refreshEmptySectionNav();
      } catch (error) {
          console.warn('Rate services:', error);
      }
  })();

  function renderRateCards(record) {
      const list = document.querySelector('#services .services-list_wrapper');
      const template = list ? list.querySelector('[data-service-card="component"][data-service-card-state="Default"]') : null;
      if (!list || !template) {
          console.warn('Rate services:', 'Card template not found');
          return;
      }

      const rate = parseFloat(record.rate);
      const retainerRate = parseFloat(record['retainer-rate']);
      const cards = [];

      // The leading \u00A0 is the gap between the title and the slash: the
      // title-wrapper is a gapless flex row, so the description <p> sits flush
      // against the title and a plain leading space would be collapsed at the
      // start of its line box.
      if (rate > 0) {
          cards.push({ title: 'Freelance', description: '\u00A0/ hour', price: rate });
      }
      if (record['retainer-enabled'] && retainerRate > 0) {
          cards.push({ title: 'Retainer', description: '\u00A0/ month', price: retainerRate });
      }

      cards.reverse().forEach(function (card) {
          list.prepend(buildRateCard(template, card));
      });

      function buildRateCard(sourceTemplate, card) {
          const el = sourceTemplate.cloneNode(true);

          el.removeAttribute('hidden');
          el.removeAttribute('data-runtime-call-template');
          el.removeAttribute('data-runtime-free-call-card');
          el.removeAttribute('data-canonical-call-unavailable');
          el.setAttribute('aria-hidden', 'false');

          // Keep data-signup-trigger-* so signup-attribution.js opens the
          // signup modal for logged-out clicks (same as the call cards);
          // strip the booking wiring so logged-in clicks do not open an
          // unconfigured booking popup for a non-bookable rate card.
          ['has-connection', 'no-connection', 'data-modal-trigger', 'booking-popup-open', 'data-type'].forEach(function (attr) {
              el.removeAttribute(attr);
          });
          el.setAttribute('data-signup-trigger-value', card.title);
          el.setAttribute('data-rate-card', card.title.toLowerCase());

          const tooltip = el.querySelector('[data-service-card-element="tooltip"]');
          if (tooltip) tooltip.remove();

          // The call card carries a "Next Available" booking row; rate cards must not.
          const bookingContent = el.querySelector('.service-card_content-wrapper');
          if (bookingContent) bookingContent.remove();

          const titleEl = el.querySelector('[data-service-card-element="title"]');
          if (titleEl) {
              titleEl.textContent = card.title;

              const description = document.createElement('p');
              description.className = 'service-card_description';
              description.textContent = card.description;
              titleEl.parentElement.appendChild(description);
          }

          // Hand millify the raw value through its explicit attribute; a stale
          // data-millify-raw on the clone would make it re-parse formatted text.
          // data-millify-max is stripped too: the authored template's ceiling is
          // sized for the paid-call rate (hundreds), and cloneNode would hand it
          // to Freelance/Retainer prices whose legitimate values run to $15K/hr
          // and $250K/mo — a false refusal renders the raw number, which looks
          // exactly like the bad-data case the ceiling exists to expose.
          const priceEl = el.querySelector('[data-millify]');
          if (priceEl) {
              priceEl.removeAttribute('data-millify-raw');
              priceEl.removeAttribute('data-millify-max');
              priceEl.setAttribute('data-millify', String(card.price));
              priceEl.textContent = String(card.price);
          }

          el.style.display = 'block';
          return el;
      }
  }

  function wireProjectServiceCards() {
      const serviceField = qs('dialog[data-modal-target="generate-contract"] [name="Services"]');
      const options = serviceField && serviceField.options
          ? Array.from(serviceField.options).filter(function (option) {
              return String(option.value || '').trim();
          })
          : [];
      if (!options.length) return;

      function normalized(value) {
          return String(value || '').trim().toLowerCase();
      }

      function optionValueForCard(card) {
          const title = qs('[data-service-card-element="title"]', card);
          const titleValue = title ? String(title.textContent || '').trim() : '';
          const rateType = normalized(card.getAttribute('data-rate-card'));
          const candidates = [titleValue];

          // Freelance and Retainer are commercial formats, not separate
          // project-service values. Both map to the authored Freelance work
          // option when that exact option exists. Every CMS service otherwise
          // requires an exact native option match and fails closed.
          if (rateType === 'freelance' || rateType === 'retainer') {
              candidates.push('Freelance work');
          }

          for (let i = 0; i < candidates.length; i += 1) {
              const candidate = normalized(candidates[i]);
              const option = options.find(function (item) {
                  return normalized(item.value) === candidate ||
                      normalized(item.textContent) === candidate;
              });
              if (option) return String(option.value || '').trim();
          }
          return '';
      }

      qsa('#services [data-service-card="component"], #services [data-rate-card]').forEach(function (card) {
          if (card.hasAttribute('hidden') || card.getAttribute('aria-hidden') === 'true') return;

          const type = normalized(card.getAttribute('data-type'));
          const signupValue = normalized(card.getAttribute('data-signup-trigger-value'));
          const isCall = type === 'free' || type === 'paid' ||
              card.hasAttribute('booking-popup-open') ||
              signupValue === 'free call' ||
              signupValue === 'paid call' ||
              signupValue === 'paid consulting call';
          if (isCall) return;

          const serviceValue = optionValueForCard(card);
          if (!serviceValue) return;

          card.setAttribute('data-modal-trigger', 'generate-contract');
          card.setAttribute('data-sp-fill', 'button');
          card.setAttribute('data-sp-fill-category', 'service');
          card.setAttribute('data-sp-fill-value', serviceValue);
          card.style.cursor = 'pointer';
      });
  }

  function getPublicStarterRecord() {
      if (!publicStarterRecordPromise) {
          publicStarterRecordPromise = loadPublicStarterRecord();
      }
      return publicStarterRecordPromise;
  }

  async function loadPublicStarterRecord() {
      const starterId = await STARTER_XANO_ID_READY;
      if (!starterId) {
          console.warn('Anonymous services:', 'No starter id available');
          return null;
      }

      const deadline = Date.now() + 30000;
      while (!window.WfAlgolia && Date.now() < deadline) {
          await new Promise(function (resolve) { setTimeout(resolve, 250); });
      }

      if (!window.WfAlgolia) {
          console.warn('Anonymous services:', 'Search library unavailable');
          return null;
      }

      const startersIndex = resolveStartersIndex();
      if (!startersIndex) {
          console.warn('Anonymous services:', 'No page-declared search index available');
          return null;
      }

      return window.WfAlgolia.getObject(startersIndex, String(starterId));
  }

  function resolveStartersIndex() {
      /* algolia-environment.js rewrites [wf-algolia-index] to the active
         environment's starters index (Freelancers3.0-production on prod,
         Freelancers3.0-staging-test on webflow.io) before wf-algolia loads,
         and the rotated search key only allows that index. Read it from the
         page instead of hardcoding. */
      var el = document.querySelector('[data-starters-v3-algolia-resource="starters"][wf-algolia-index]') ||
          document.querySelector('[wf-algolia-index^="Freelancers"]');
      return (el && el.getAttribute('wf-algolia-index')) || null;
  }

  // Hide empty dynamic list wrappers
  qsa('[wf-empty-check]').forEach((item) => {
      const empty = qs('.w-dyn-empty', item);
      if (!empty) return;

      item.style.display = 'none';
  });

  // Hide right artifacts wrapper if no items
  qsa('[artifacts-wrapper]').forEach((item) => {
      const items = qsa('[artifacts-item]', item);
      if (items.length) return;

      item.style.display = 'none';
  });

  async function startersBooking_handler(freelancerId, brand_name, brand_email) {

      if (!validBookingDiscovery(freeCallBooking)) {
          syncCanonicalCallSurfaces([]);
          console.warn('[hire-profile] Free Call booking controller is unavailable');
          return;
      }

      // GET STARTER
      const starter = await freeCallBooking.getStarterByMemberId(freelancerId);
      const grant_id = starter ? starter['nylas_grant_id'] : null;
      if (grant_id) {

          // GET CONFIGS
          const configs = selectBookableConfigurations(await freeCallBooking.getConfigs(grant_id));
          primeBookingModalOptions(configs);
          if (
              Array.isArray(configs) &&
              configs.length &&
              configs[0] &&
              configs[0].config_id
          ) {

              const freeConfigs = configs.filter(function (record) {
                  return record.is_paid === false;
              });
              const paidConfig = configs.find(function (record) {
                  return record.is_paid === true;
              }) || null;
              let bookingSurfaceAvailable = false;
              let freeInstalled = false;
              const installedConfigs = [];

              // The GitHub Free controller owns only the accepted Free option.
              // Remove Paid before it binds the authored chooser, then restore
              // the complete canonical set for the separate Paid controller.
              primeBookingModalOptions(freeConfigs);
              if (freeConfigs.length) {
                  const installed =
                      typeof freeCallBooking.installFreeBookingController === 'function' &&
                      freeCallBooking.installFreeBookingController({
                          config: freeConfigs[0],
                          grantId: grant_id,
                          starterSlug: decodeURIComponent(
                              window.location.pathname.replace(/^\/hire\//, '').replace(/\/+$/, '')
                          ),
                          starterMemberstackId: freelancerId,
                          brandName: brand_name,
                          brandEmail: brand_email,
                          starterEmail: starter.nylas_grant_email,
                      });
                  freeInstalled = installed === true;
                  bookingSurfaceAvailable = freeInstalled;
                  if (freeInstalled) installedConfigs.push(freeConfigs[0]);
                  if (!installed) {
                      primeBookingModalOptions([]);
                      console.warn('Free Call controller is unavailable; Free stayed closed.');
                  }
              }

              // Restore the complete canonical chooser after the Free
              // controller installs, then give Paid to its authenticated V3
              // payment and booking controller.
              primeBookingModalOptions(freeInstalled ? configs : configs.filter(function (record) {
                  return record.is_paid === true;
              }));
              if (freeInstalled) {
                  qsa('[call-type-item] [booking-popup-open][data-type="free"][data-config]').forEach(function (cta) {
                      const item = cta.closest('[call-type-item]');
                      if (item) item.style.display = 'block';
                  });
              }
              if (paidConfig) {
                  const paidController = window.StartersPaidCallBrandPayment;
                  const installed = paidController &&
                      typeof paidController.installPaidBookingController === 'function' &&
                      paidController.installPaidBookingController({
                          config: paidConfig,
                          grantId: grant_id,
                          starterSlug: decodeURIComponent(
                              window.location.pathname.replace(/^\/hire\//, '').replace(/\/+$/, '')
                          ),
                          brandName: brand_name,
                          brandEmail: brand_email,
                          starterEmail: starter.nylas_grant_email,
                      });
                  bookingSurfaceAvailable = bookingSurfaceAvailable || installed === true;
                  if (installed === true) installedConfigs.push(paidConfig);
                  if (!installed) {
                      primeBookingModalOptions(freeConfigs);
                      console.warn('Paid Call controller is unavailable; Paid stayed closed.');
                  }
              }

              reconcileInstalledBookingModalOptions(installedConfigs);
              const callSurfacesChanged = syncCanonicalCallSurfaces(installedConfigs);
              // The hero call rows can be inserted after the controller's
              // initial DOM scan. Re-run the idempotent binding after canonical
              // discovery so late-rendered hero and Services cards get the same
              // direct Free/Paid entry contract.
              wireCallServiceCardsToDirectEntry();
              if (callSurfacesChanged) refreshEmptySectionNav();
              if (!bookingSurfaceAvailable) return;
              setBookingButtonAvailable(true);

          } else {
              syncCanonicalCallSurfaces([]);
              console.warn("No Configurations found for the current starter.");
          }

      } else {
          syncCanonicalCallSurfaces([]);
          console.warn("No Nylas Grant ID found for the current starter.");
      }
  }
})();

/* ---- retainer-rate format (was a separate footer <script>) ---- */
(function () {
  'use strict';

  const el = document.getElementById('retainer-rate');
  if (el) {
      const n = parseFloat(el.textContent);
      function formatShort(n) {
          if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
          if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
          return n.toString();
      }
      el.textContent = formatShort(n);
  }
})();

/* ---- rating average (was a separate footer <script>) ---- */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
      setTimeout(function () {
          var items = document.querySelectorAll('.ratings-source_item div');
          if (!items.length) return;

          var values = Array.from(items)
              .map(function (el) {
                  return parseFloat(el.textContent);
              })
              .filter(function (v) {
                  return !isNaN(v);
              });

          if (!values.length) return;

          var avg =
              values.reduce(function (sum, v) {
                  return sum + v;
              }, 0) / values.length;

          var field = document.getElementById('rating');
          if (field) field.textContent = avg.toFixed(1);
      }, 500);
  });
})();

/* ---- profile dropdowns (was a separate footer <script>) ---- */
(function () {
  'use strict';

  // jQuery utility block, unchanged from the footer.
  if (typeof window.$ !== 'function') {
    console.warn('[hire-profile] jQuery missing; skipped: profile dropdowns');
  } else {
    $(document).ready(function () {
        const $dropdowns = $('[class*="profile-dropdown"].w-dropdown');
        $dropdowns.each(function () {
            $(this).off();
        });

        $dropdowns.find('.w-dropdown-toggle').on('click', function (e) {
            e.stopPropagation();

            const $toggle = $(this);
            const $dropdown = $toggle.closest('.w-dropdown');
            const $list = $dropdown.find('.w-dropdown-list');
            const $icon = $dropdown.find('.profile-dropdown_icon');
            const isOpen = $dropdown.hasClass('w--open');

            if (isOpen) {
                $dropdown.removeClass('w--open');
                $toggle.removeClass('w--open').attr('aria-expanded', 'false');
                $list.removeClass('w--open').css('height', '0px');
                $icon.css('transform', '');
            } else {
                $dropdown.addClass('w--open');
                $toggle.addClass('w--open').attr('aria-expanded', 'true');
                $list.addClass('w--open').css('height', 'auto');
                $icon.css('transform', 'rotate(180deg)');
            }
        });
    });
  }
})();

/* ---- anchor scroll (was a separate footer <script>) ---- */
(function () {
  'use strict';

  // jQuery utility block, unchanged from the footer.
  if (typeof window.$ !== 'function') {
    console.warn('[hire-profile] jQuery missing; skipped: anchor scroll');
  } else {
    $(document).ready(function () {
        $('a[href^="#"]').on('click', function (e) {
            const target = $(this).attr('href');
            if (!target || target === '#') return;

            let $target;
            try {
                $target = $(target);
            } catch (_error) {
                return;
            }

            if ($target.length) {
                e.preventDefault();
                const offset = $target.offset().top - 5 * 16;
                $('html, body').animate({ scrollTop: offset }, 400);
            }
        });
    });
  }
})();

/* ---- mobile TOC nav (was a separate footer <script>) ---- */
(function () {
  'use strict';

  (function () {
      if (window.innerWidth >= 767) return;

      const navList = document.querySelector('.profile-nav_list');
      if (!navList) return;

      const links = [...navList.querySelectorAll('a[href^="#"]')];
      const sections = links.map((a) => {
          const target = a.getAttribute('href');
          if (!target || target === '#') return null;
          try {
              return document.querySelector(target);
          } catch (_error) {
              return null;
          }
      }).filter(Boolean);

      const scrollNavToActive = () => {
          const active = navList.querySelector('.w--current');
          if (!active) return;
          const navRect = navList.getBoundingClientRect();
          const btnRect = active.getBoundingClientRect();
          const offset = btnRect.left - navRect.left - navRect.width / 2 + btnRect.width / 2;
          navList.scrollBy({ left: offset, behavior: 'smooth' });
      };

      const observer = new IntersectionObserver(
          (entries) => {
              entries.forEach((entry) => {
                  const id = entry.target.getAttribute('id');
                  const link = navList.querySelector(`a[href="#${id}"]`);
                  if (!link) return;
                  if (entry.isIntersecting) {
                      links.forEach((a) => a.classList.remove('w--current'));
                      link.classList.add('w--current');
                      scrollNavToActive();
                  }
              });
          },
          { rootMargin: '-40% 0px -55% 0px', threshold: 0 },
      );

      sections.forEach((sec) => observer.observe(sec));
  })();
})();

/* ---- portfolio see-more (was a separate footer <script>) ---- */
(function () {
  'use strict';

  // "See more" button
  document.addEventListener('DOMContentLoaded', () => {
      const configs = [
          {
              selector: '[data-portfolio-card-title]',
              maxLength: 65,
              key: 'title',
          },
          {
              selector: '[portfolio-description]',
              maxLength: 250,
              key: 'description',
          },
      ];

      let isUpdating = false;

      function truncateText(text, maxLength) {
          return text.slice(0, maxLength).trim() + '...';
      }

      function processElement(el, maxLength, key) {
          if (isUpdating) return;

          const currentText = el.textContent.trim();
          if (!currentText) return;

          const fullTextAttr = `fullText${key}`;
          const expandedAttr = `expanded${key}`;
          const savedFullText = el.dataset[fullTextAttr];

          if (savedFullText && (currentText === savedFullText || currentText === truncateText(savedFullText, maxLength))) {
              return;
          }

          const oldButton = el.parentElement?.querySelector(`.portfolio-text-toggle[data-toggle-for="${key}"]`);

          if (oldButton) oldButton.remove();

          delete el.dataset[expandedAttr];
          el.dataset[fullTextAttr] = currentText;

          if (currentText.length <= maxLength) return;

          const fullText = currentText;
          const shortText = truncateText(fullText, maxLength);

          isUpdating = true;
          el.textContent = shortText;
          isUpdating = false;

          const button = document.createElement('div');
          button.className = 'portfolio-text-toggle';
          button.dataset.toggleFor = key;
          button.textContent = 'See more';

          button.addEventListener('click', () => {
              const expanded = el.dataset[expandedAttr] === 'true';

              isUpdating = true;

              if (expanded) {
                  el.textContent = shortText;
                  button.textContent = 'See more';
                  el.dataset[expandedAttr] = 'false';
              } else {
                  el.textContent = fullText;
                  button.textContent = 'See less';
                  el.dataset[expandedAttr] = 'true';
              }

              isUpdating = false;
          });

          el.insertAdjacentElement('afterend', button);
      }

      function scan() {
          if (isUpdating) return;

          configs.forEach(({ selector, maxLength, key }) => {
              document.querySelectorAll(selector).forEach((el) => {
                  processElement(el, maxLength, key);
              });
          });
      }

      scan();

      const observer = new MutationObserver(scan);

      observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
      });
  });
})();
