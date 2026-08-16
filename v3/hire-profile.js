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
 *  - Services call-card visibility. The live connection endpoints 401 for
 *    anonymous callers and the brand booking path never toggles visibility, so
 *    anonymous viewers AND signed-in brands derive availability from the public
 *    Algolia record. Starter members keep the live-derived owner toggles.
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
 *   qs, qsa, getStarterByMemberId, getConfigs, getNearestSlot,
 *   initBookingComponents, createScheduler, formatWithTimezone,
 *   jQuery ($, two utility blocks),
 *   window.WfAlgolia (search record).
 *
 * The Algolia index is READ FROM THE PAGE, never hardcoded: v3/algolia-environment.js
 * rewrites [wf-algolia-index] per environment and the search key 403s any other
 * index. Hardcoding Freelancers3.0-dev is what broke Services on 2026-08-16.
 */

(function () {
  'use strict';

  // Page-embed contract. This file is deferred, so all of these are already
  // defined in the normal case; stand down loudly rather than throwing if not.
  var qs = window.qs;
  var qsa = window.qsa;
  var waitForMember = window.waitForMember;
  var memberReady = window.memberReady;
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
          const brand_name = MEMBER.customFields['free-user'] + " " + MEMBER.customFields['last-name'];
          const brand_email = MEMBER['auth']['email'];

          // if it's not a brand
          if (!MEMBER.customFields['brands-dashboard-url']) {
              // check calendar\availability connections
              const starter = await getStarterByMemberId(FREELANCER_ID);
              const grant_id = starter ? starter['nylas_grant_id'] : null;
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
     The live connection endpoints require auth (401 for anonymous callers),
     and the brand booking path never toggles card visibility at all, so
     anonymous viewers AND signed-in brands derive call availability from
     the public search record. Starter members keep the live-derived
     owner toggles above. */
  waitForMember(async function () {
      var isBrand = !!(MEMBER.customFields || {})['brands-dashboard-url'];
      if (MEMBER.id && !isBrand) return;

      try {
          const record = await getPublicStarterRecord();
          if (!record) return;

          if (record['free-consulting-calls-t-f']) {
              qsa('[has-connection="free"]').forEach((item) => item.style.display = "block");
          }
          if (record['paid-consulting-calls-t-f']) {
              qsa('[has-connection="paid"]').forEach((item) => item.style.display = "block");
          }

          if (!MEMBER.id) markServiceCardsClickable();
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
      qsa('#services [data-service-card="component"], #services [data-rate-card]').forEach(function (card) {
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

      if (rate > 0) {
          cards.push({ title: 'Freelance', description: '/ hour', price: rate });
      }
      if (record['retainer-enabled'] && retainerRate > 0) {
          cards.push({ title: 'Retainer', description: '/ month', price: retainerRate });
      }

      cards.reverse().forEach(function (card) {
          list.prepend(buildRateCard(template, card));
      });

      function buildRateCard(sourceTemplate, card) {
          const el = sourceTemplate.cloneNode(true);

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
          const priceEl = el.querySelector('[data-millify]');
          if (priceEl) {
              priceEl.removeAttribute('data-millify-raw');
              priceEl.setAttribute('data-millify', String(card.price));
              priceEl.textContent = String(card.price);
          }

          el.style.display = 'block';
          return el;
      }
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

  // METHODS
  function getInlineBookingEnvironment() {
      const host = window.location && window.location.hostname;
      const path = window.location && window.location.pathname
          ? window.location.pathname.replace(/\/+$/, '') || '/'
          : '';

      if (host === 'the-starters-3-0.webflow.io' && path === '/hire/jp-dionisio') {
          return 'test';
      }
      if ((host === 'thestarters.com' || host === 'www.thestarters.com') && path === '/hire/jp-test') {
          return 'production';
      }
      return null;
  }

  function initInlineFreeBooking(configs, brand_name, brand_email) {
      const environment = getInlineBookingEnvironment();
      if (!environment) return false;

      // The route bridge owns environment selection. Its ready marker proves
      // this page has the matching TEST/production endpoint map and identity
      // injector. Missing or mixed context must keep the inline flow inert.
      if (
          !window.StarterSchedulingV3Stage ||
          document.documentElement.getAttribute('data-scheduling-v3-stage') !== 'ready'
      ) {
          console.warn('[hire-profile] inline booking stood down: environment bridge is not ready');
          return false;
      }

      const wrapper = qs('[data-availability-element="wrapper"]');
      const calendar = qs('[data-availability-element="calendar-live"]', wrapper || document);
      const back = qs('[data-availability-element="back"]', wrapper || document);
      const freeConfig = Array.from(configs || []).find(function (record) {
          return record && !record.is_paid && record.config_id;
      });

      if (!wrapper || !calendar || !back || !freeConfig || typeof window.createScheduler !== 'function') {
          console.warn('[hire-profile] inline booking stood down: required markup or scheduler is missing');
          return false;
      }

      let scheduler = null;
      let schedulerConnector = null;
      let schedulerState = 'closed';
      const freeCards = Array.from(qsa('[booking-popup-open][data-type]')).filter(function (card) {
          return card.getAttribute('data-type') === 'free';
      });

      wrapper.style.display = 'none';

      function setBackMode(mode) {
          back.setAttribute('data-availability-back-mode', mode);
          back.setAttribute(
              'aria-label',
              mode === 'previous-step' ? 'Back to date and time' : 'Close date and time picker'
          );
      }

      function closeInlineBooking() {
          if (scheduler && typeof scheduler.remove === 'function') scheduler.remove();
          calendar.innerHTML = '';
          wrapper.style.display = 'none';
          scheduler = null;
          schedulerConnector = null;
          schedulerState = 'closed';
          setBackMode('close');
          freeCards.forEach(function (card) {
              card.setAttribute('aria-expanded', 'false');
          });
      }

      function installSchedulerStateTracking(activeScheduler) {
          const originalOverrides = activeScheduler.eventOverrides || {};

          activeScheduler.eventOverrides = Object.assign({}, originalOverrides, {
              timeslotConfirmed: async function (event, connector) {
                  schedulerState = 'details';
                  schedulerConnector = connector || schedulerConnector;
                  setBackMode('previous-step');
                  if (typeof originalOverrides.timeslotConfirmed === 'function') {
                      return originalOverrides.timeslotConfirmed(event, connector);
                  }
              },
              backButtonClicked: async function (event, connector) {
                  schedulerState = 'date-time';
                  schedulerConnector = connector || schedulerConnector;
                  setBackMode('close');
                  if (typeof originalOverrides.backButtonClicked === 'function') {
                      return originalOverrides.backButtonClicked(event, connector);
                  }
              },
              bookedEventInfo: async function (event, connector) {
                  if (event && event.detail && !event.detail.error && event.detail.data) {
                      schedulerState = 'complete';
                      schedulerConnector = connector || schedulerConnector;
                      setBackMode('close');
                  }
                  if (typeof originalOverrides.bookedEventInfo === 'function') {
                      return originalOverrides.bookedEventInfo(event, connector);
                  }
              },
          });
      }

      function openInlineBooking(card, event) {
          if (event) {
              event.preventDefault();
              if (typeof event.stopPropagation === 'function') event.stopPropagation();
          }

          closeInlineBooking();
          wrapper.style.display = 'flex';
          schedulerState = 'date-time';
          setBackMode('close');
          card.setAttribute('aria-expanded', 'true');

          // createScheduler is shared with the existing modal and selects the
          // first [nylas-container]. Claim that selector only for this
          // synchronous call, then restore the modal containers unchanged.
          const modalContainers = qsa('[nylas-container]');
          modalContainers.forEach(function (container) {
              container.removeAttribute('nylas-container');
          });
          calendar.setAttribute('nylas-container', '');

          try {
              scheduler = window.createScheduler(freeConfig.config_id, brand_name || '', brand_email || '');
          } finally {
              calendar.removeAttribute('nylas-container');
              modalContainers.forEach(function (container) {
                  container.setAttribute('nylas-container', '');
              });
          }

          if (!scheduler) {
              closeInlineBooking();
              console.warn('[hire-profile] inline booking stood down: scheduler did not initialize');
              return;
          }

          installSchedulerStateTracking(scheduler);
          if (typeof wrapper.scrollIntoView === 'function') {
              wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
      }

      back.addEventListener('click', async function (event) {
          event.preventDefault();

          if (schedulerState === 'details') {
              let connector = schedulerConnector;
              if (!connector && scheduler && typeof scheduler.getNylasSchedulerConnector === 'function') {
                  connector = await scheduler.getNylasSchedulerConnector();
                  schedulerConnector = connector || null;
              }

              if (
                  !connector ||
                  !connector.scheduler ||
                  typeof connector.scheduler.toggleAdditionalData !== 'function'
              ) {
                  console.warn('[hire-profile] inline booking back stood down: scheduler connector is unavailable');
                  return;
              }

              await connector.scheduler.toggleAdditionalData(false);
              schedulerState = 'date-time';
              setBackMode('close');

              const backOverride = scheduler && scheduler.eventOverrides
                  ? scheduler.eventOverrides.backButtonClicked
                  : null;
              if (typeof backOverride === 'function') {
                  await backOverride(event, connector);
              }
              return;
          }

          closeInlineBooking();
      });

      freeCards.forEach(function (card) {
          // The logged-out path never reaches this initializer, so signup
          // attribution remains untouched. Signed-in canaries use the inline
          // panel instead of the old modal.
          card.removeAttribute('data-modal-trigger');
          card.setAttribute('aria-controls', 'hire-inline-calendar');
          card.setAttribute('aria-expanded', 'false');
          card.onclick = function (event) {
              openInlineBooking(card, event);
          };
      });

      wrapper.setAttribute('id', 'hire-inline-calendar');
      setBackMode('close');
      return true;
  }

  async function startersBooking_handler(freelancerId, brand_name, brand_email) {

      // GET STARTER
      const starter = await getStarterByMemberId(freelancerId);
      const grant_id = starter ? starter['nylas_grant_id'] : null;
      if (grant_id) {

          // GET CONFIGS
          const configs = await getConfigs(grant_id);
          if (configs) {

              initBookingComponents(freelancerId, grant_id, configs, brand_name, brand_email);
              initInlineFreeBooking(configs, brand_name, brand_email);

              /* Next Available Slot _ Handlers */
              // loading state
              nearestSlotSetup();

              const nearestSlotTimestamp = await getNearestSlot(grant_id, configs[0].config_id);
              if (nearestSlotTimestamp) {
                  const date = formatWithTimezone(nearestSlotTimestamp * 1000, { month: '2-digit' }).list;

                  // ready state
                  nearestSlotSetup(`${date.hour}:${date.minute}${date.dayPeriod} on ${date.month}/${date.day}`);
              } else {

                  // empty state
                  nearestSlotSetup("No available slots");
              }

              function nearestSlotSetup(timeSlot = null) {
                  qsa("[booking-popup-open][data-type]").forEach(async (item) => {
                      const nextSlot = qs('[next-available-slot]', item);
                      if (nextSlot) {
                          nextSlot.textContent = timeSlot || "Loading...";
                      }
                  });
              }

          } else {
              console.warn("No Configurations found for the current starter.");
          }

      } else {
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
            const $target = $(target);

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
      const sections = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);

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

/* ---- highlights view-all (was a separate footer <script>) ---- */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
      const highlights = document.querySelector('[data-highlights]');
      const button = document.querySelector('[data-btn-view-all]');
      if (!highlights || !button) return;

      const getItems = () => highlights.querySelectorAll(':scope > *');

      button.addEventListener('click', () => {
          const items = getItems();
          items.forEach((item) => {
              item.style.display = '';
          });

          button.style.display = 'none';
      });
  });
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
