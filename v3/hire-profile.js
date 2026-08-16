/**
 * V3 hire-profile renderer — /hire/<slug>
 *
 * Ported verbatim (behaviour-for-behaviour) from the page-level FOOTER custom
 * code on the hire template (page 69f241ed147b71addb6f153d), so that this logic
 * lives in GitHub instead of in Webflow. Same intent as v3/profile-portfolio.js.
 * Backup of the exact source block:
 * webflow-sites/starters-3/custom-code-backups/hire-template-footer-pre-cdn-migration-2026-08-16.html
 *
 * WHAT IT DOES
 *  - Experiences ("Notable Experience") and Clients ("also worked with"), both
 *    public: they must render for anonymous viewers. Contract:
 *    platform-ops/migrations/2026-07-30-notable-clients-backfill/
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
 *   initBookingComponents, formatWithTimezone, jQuery ($, two utility blocks),
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

  const GET_ALSO_WORKED_WITH = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/edit_profile/starter/get_also_worked_with';
  const GET_COMPANIES_BY_NAMES = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/profile/get_companies';
  const GET_EXPERIENCES = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies?member_id=';
  // `starter_memberstack_id` is a global var (set by an embedded script at the
  // top of the Freelancer Template page). Read it off window so a missing global
  // warns instead of throwing a ReferenceError that would abort this file.
  const FREELANCER_ID = window.starter_memberstack_id;
  // Resolved with the starter's Xano id from the experiences response
  // (null when unavailable); keys the public search-record lookup.
  let resolveStarterXanoId;
  const STARTER_XANO_ID_READY = new Promise(function (resolve) { resolveStarterXanoId = resolve; });
  // Declared before the parse-time IIFEs below so getPublicStarterRecord can run at parse time.
  let publicStarterRecordPromise = null;

  /* PUBLIC PROFILE DATA
     Profile-owner data: must render for anonymous viewers too.
     Contract: platform-ops/migrations/2026-07-30-notable-clients-backfill/CANARY-RESULT-2026-07-30.md */
  (async function () {
      /* Experiences Companies */
      const experiences = await experiences_handler(FREELANCER_ID);

      // Hide empty content wrappers
      const fitAndExpWrapper = qs('[fit-experience-check]');
      if (fitAndExpWrapper) {
          let empty = false;

          // check on best-fit-list
          const fitList = qs('[best-fit-list]', fitAndExpWrapper);
          empty = !fitList;

          // check on experience items
          const expTemplate = qs('[experience-tag].js-template', fitAndExpWrapper);
          empty = !!expTemplate;

          if (empty) {
              fitAndExpWrapper.style.display = 'none';
          }
      }

      /* Also Worked Companies */
      alsoWorkedWith_handler(FREELANCER_ID);
  })();

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
      } catch (error) {
          console.warn('Anonymous services:', error);
      }
  });

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

      return window.WfAlgolia.getObject(resolveStartersIndex(), String(starterId));
  }

  function resolveStartersIndex() {
      /* algolia-environment.js rewrites [wf-algolia-index] to the active
         environment's starters index (Freelancers3.0-production on prod,
         Freelancers3.0-staging-test on webflow.io) before wf-algolia loads,
         and the rotated search key only allows that index. Read it from the
         page instead of hardcoding; the -dev literal is a last resort. */
      var el = document.querySelector('[data-starters-v3-algolia-resource="starters"][wf-algolia-index]') ||
          document.querySelector('[wf-algolia-index^="Freelancers"]');
      return (el && el.getAttribute('wf-algolia-index')) || 'Freelancers3.0-dev';
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
  async function startersBooking_handler(freelancerId, brand_name, brand_email) {

      // GET STARTER
      const starter = await getStarterByMemberId(freelancerId);
      const grant_id = starter ? starter['nylas_grant_id'] : null;
      if (grant_id) {

          // GET CONFIGS
          const configs = await getConfigs(grant_id);
          if (configs) {

              initBookingComponents(freelancerId, grant_id, configs, brand_name, brand_email);

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

  function alsoWorkedWith_handler(freelancerId) {
      const aw_elements = getAlsoWorkedElements();
      if (!aw_elements) return;

      fetchAlsoWorkedCompanies(freelancerId) // profile OWNER's id, not the logged-in viewer's
          .then(function (rawData) {
              const normalized = normalizeResponse(rawData);

              if (normalized.errorText) {
                  console.warn('Also Worked Companies:', normalized.errorText);
              }

              // Clients come from the also-worked response only; never merge notable experiences in.
              const alsoWorkedCompanies = normalized.errorText ? [] : normalized.companies;
              const uniqueCompanies = dedupeCompaniesByName(alsoWorkedCompanies);

              if (!uniqueCompanies.length) {
                  console.warn('Also Worked Companies:', 'Empty companies array');
                  aw_elements.wrapper.style.display = 'none';
                  return;
              }

              const companyNames = getCompanyNames(uniqueCompanies);
              if (!companyNames.length) {
                  console.warn('Also Worked Companies:', 'No valid company names to match');
                  renderAlsoWorkedCompanies(aw_elements, uniqueCompanies, new Map());
                  return;
              }

              return fetchCompaniesByNames(companyNames)
                  .then(function (matchesRawData) {
                      const matchesNormalized = normalizeResponse(matchesRawData);

                      if (matchesNormalized.errorText) {
                          console.warn('Also Worked Companies:', matchesNormalized.errorText);
                      }

                      const companySlugMap = buildCompanySlugMap(matchesNormalized.companies);
                      renderAlsoWorkedCompanies(aw_elements, uniqueCompanies, companySlugMap);
                  })
                  .catch(function (error) {
                      const errorText = error && error.message ? error.message : String(error);
                      console.warn('Also Worked Companies:', errorText);
                      renderAlsoWorkedCompanies(aw_elements, uniqueCompanies, new Map());
                  });
          })
          .catch(function (error) {
              const errorText = error && error.message ? error.message : String(error);
              console.warn('Also Worked Companies:', errorText);
          });

      function dedupeCompaniesByName(list) {
          const source = Array.isArray(list) ? list : [];
          const seen = new Set();

          return source.filter(function (company) {
              const name = company && typeof company.company_name === 'string' ? company.company_name.trim() : '';
              if (!name) return false;

              const key = getNormalizedCompanyKey(name);
              if (seen.has(key)) return false;

              seen.add(key);
              return true;
          });
      }

      function getCompanyNames(list) {
          return (Array.isArray(list) ? list : [])
              .map(function (company) {
                  return company && typeof company.company_name === 'string' ? company.company_name.trim() : '';
              })
              .filter(function (name) {
                  return !!name;
              });
      }

      function getAlsoWorkedElements() {
          const wrapper = document.querySelector('[also-worked-wrapper]');
          const list = document.querySelector('[also-worked-list]');
          const link_template = list ? list.querySelector('[also-worked-tag].js-template.is-link') : null;
          const text_template = list ? list.querySelector('[also-worked-tag].js-template:not(.is-link)') : null;

          if (!wrapper || !list || !link_template || !text_template) {
              console.warn('Also Worked Companies:', 'Required elements not found');
              return null;
          }

          return { wrapper, list, link_template, text_template };
      }

      function fetchAlsoWorkedCompanies(memberId) {
          return fetch(GET_ALSO_WORKED_WITH, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
              },
              body: JSON.stringify({ member_id: String(memberId) }),
          }).then(function (response) {
              if (!response.ok) {
                  throw new Error('Request failed with status ' + response.status);
              }

              return response.json();
          });
      }

      function fetchCompaniesByNames(companyNames) {
          return fetch(GET_COMPANIES_BY_NAMES, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
              },
              body: JSON.stringify({ 'company_names': companyNames }),
          }).then(function (response) {
              if (!response.ok) {
                  throw new Error('Request failed with status ' + response.status);
              }

              return response.json();
          });
      }

      function createTagFromTemplate(template, company) {
          const tag = template.cloneNode(true);
          tag.classList.remove('js-template');

          const companyName = company && typeof company.company_name === 'string' ? company.company_name.trim() : '';
          const nameEl = tag.querySelector('[also-worked-tag-name]');

          if (!nameEl) {
              throw new Error('Tag field [also-worked-tag-name] not found');
          }

          nameEl.textContent = companyName;
          return tag;
      }

      function setupLinkTag(tag, companySlug) {
          const slug = typeof companySlug === 'string' ? companySlug.trim() : '';
          const linkEl = tag.matches('a') ? tag : tag.querySelector('a');

          if (!linkEl || !slug) {
              throw new Error('Link template must contain a valid anchor for company slug');
          }

          linkEl.setAttribute('href', '/companies/' + encodeURIComponent(slug));
      }

      function buildCompanySlugMap(matches) {
          const map = new Map();

          (Array.isArray(matches) ? matches : []).forEach(function (item) {
              const name = item && typeof item.name === 'string' ? item.name.trim() : '';
              const slug = item && typeof item.slug === 'string' ? item.slug.trim() : '';

              if (!name || !slug) return;

              const key = getNormalizedCompanyKey(name);
              if (!map.has(key)) {
                  map.set(key, slug);
              }
          });

          return map;
      }

      function getNormalizedCompanyKey(name) {
          return typeof name === 'string' ? name.trim().toLowerCase() : '';
      }

      function renderAlsoWorkedCompanies(elements, companies, companySlugMap) {
          const { wrapper, list, link_template, text_template } = elements;
          const linkTemplateClone = link_template.cloneNode(true);
          const textTemplateClone = text_template.cloneNode(true);
          link_template.remove();
          text_template.remove();

          companies.forEach(function (company) {
              const companyName = company && typeof company.company_name === 'string' ? company.company_name.trim() : '';
              const slug = companySlugMap.get(getNormalizedCompanyKey(companyName)) || '';
              const hasSlug = !!slug;
              const baseTemplate = hasSlug ? linkTemplateClone : textTemplateClone;
              const tag = createTagFromTemplate(baseTemplate, company);

              if (hasSlug) {
                  setupLinkTag(tag, slug);
              }

              list.appendChild(tag);
          });

          wrapper.style.display = 'flex';
      }

      function normalizeResponse(data) {
          if (Array.isArray(data)) {
              return { companies: data, errorText: '' };
          }

          if (typeof data === 'string') {
              return { companies: [], errorText: data };
          }

          return { companies: [], errorText: 'Unexpected response format' };
      }

  }

  async function experiences_handler(freelancerId) {
      const exp_elements = getExperienceElements();
      if (!exp_elements) {
          resolveStarterXanoId(null);
          return [];
      }

      try {
          const rawData = await fetchExperiencesCompanies(freelancerId);
          resolveStarterXanoId((rawData && rawData.starter_id) || null);
          const normalized = normalizeExperiencesResponse(rawData);

          if (normalized.errorText) {
              console.warn('Experiences Companies:', normalized.errorText);
              return [];
          }

          if (!normalized.companies.length) {
              console.warn('Experiences Companies:', 'Empty companies array');
              return [];
          }

          const sortedCompanies = sortExperiencesByEndDate(normalized.companies);

          renderExperiencesCompanies(exp_elements, sortedCompanies);
          return sortedCompanies;
      } catch (error) {
          resolveStarterXanoId(null);
          const errorText = error && error.message ? error.message : String(error);
          console.warn('Experiences Companies:', errorText);
          return [];
      }

      function sortExperiencesByEndDate(companies) {
          const list = Array.isArray(companies) ? companies.slice() : [];

          list.sort(function (a, b) {
              const aPresent = isPresentExperience(a);
              const bPresent = isPresentExperience(b);

              if (aPresent !== bPresent) {
                  return aPresent ? -1 : 1;
              }

              const aTime = parseEndDateToTimestamp(a && a.end_date);
              const bTime = parseEndDateToTimestamp(b && b.end_date);

              if (aTime === bTime) return 0;
              if (aTime === null) return 1;
              if (bTime === null) return -1;

              return bTime - aTime;
          });

          return list;
      }

      function isPresentExperience(company) {
          const endDate = company && typeof company.end_date === 'string' ? company.end_date.trim().toLowerCase() : '';
          return endDate === 'present';
      }

      function parseEndDateToTimestamp(endDateText) {
          if (typeof endDateText !== 'string') return null;

          const value = endDateText.trim();
          if (!value || value.toLowerCase() === 'present') return null;

          const parsed = Date.parse('1 ' + value);
          return Number.isNaN(parsed) ? null : parsed;
      }

      function formatDateToMonthYear(dateText) {
          if (typeof dateText !== 'string') return '';

          const value = dateText.trim();
          if (!value) return '';
          if (value.toLowerCase() === 'present') return value;

          const parsed = new Date(value);
          if (Number.isNaN(parsed.getTime())) return value;

          return parsed.toLocaleString('en-US', { month: 'short', year: 'numeric' });
      }

      function getExperienceElements() {
          const wrapper = document.querySelector('[experience-wrapper]');
          const list = document.querySelector('[experience-list]');
          const template = list ? list.querySelector('[experience-tag].js-template') : null;

          if (!wrapper || !list || !template) {
              console.warn('Experiences Companies:', 'Required elements not found');
              return null;
          }

          return { wrapper, list, template };
      }

      function fetchExperiencesCompanies(memberId) {
          return fetch(GET_EXPERIENCES + encodeURIComponent(String(memberId)), {
              method: 'GET',
          }).then(function (response) {
              if (!response.ok) {
                  throw new Error('Request failed with status ' + response.status);
              }

              return response.json();
          });
      }

      function createExperienceTagFromTemplate(template, company) {
          const tag = template.cloneNode(true);
          tag.classList.remove('js-template');

          const companyName = company && typeof company.company_name === 'string' ? company.company_name.trim() : '';
          const companyLogoUrl = company && typeof company.company_logo_url === 'string' ? company.company_logo_url.trim() : '';
          const jobTitle = company && typeof company.job_title === 'string' ? company.job_title.trim() : '';
          const startDate = formatDateToMonthYear(company && company.start_date);
          const endDate = formatDateToMonthYear(company && company.end_date);

          const logoEl = tag.querySelector('[experience-tag-logo]');
          const nameEl = tag.querySelector('[experience-tag-name]');
          const jobEl = tag.querySelector('[experience-tag-job]');
          const startEl = tag.querySelector('[experience-tag-start]');
          const endEl = tag.querySelector('[experience-tag-end]');
          const dateDividerEl = tag.querySelector('[experience-tag-date-divider]');
          const dateWrapperEl = tag.querySelector('[experience-tag-date-wrapper]');

          if (!nameEl || !jobEl || !startEl || !endEl || !dateWrapperEl) {
              throw new Error('Experience tag required fields not found');
          }

          nameEl.textContent = companyName;
          jobEl.textContent = jobTitle;

          if (logoEl) {
              if (companyLogoUrl) {
                  if (logoEl.tagName === 'IMG') {
                      logoEl.src = companyLogoUrl;
                  } else {
                      logoEl.style.backgroundImage = 'url("' + companyLogoUrl + '")';
                  }

                  logoEl.style.display = '';
              } else {
                  logoEl.style.display = 'none';
              }
          }

          const hasStart = !!startDate;
          const hasEnd = !!endDate;

          startEl.textContent = startDate;
          startEl.style.display = hasStart ? '' : 'none';

          if (hasEnd) {
              endEl.textContent = endDate;
              endEl.style.display = '';
          } else {
              endEl.style.display = 'none';
          }

          if (dateDividerEl) {
              dateDividerEl.style.display = hasStart && hasEnd ? '' : 'none';
          }

          if (!hasStart && !hasEnd) {
              dateWrapperEl.style.display = 'none';
          } else {
              dateWrapperEl.style.display = '';
          }

          return tag;
      }

      function renderExperiencesCompanies(elements, companies) {
          const { wrapper, list, template } = elements;
          const templateClone = template.cloneNode(true);
          template.remove();

          companies.forEach(function (company) {
              const tag = createExperienceTagFromTemplate(templateClone, company || {});
              list.appendChild(tag);
          });

          wrapper.style.display = 'flex';
      }

      function normalizeExperiencesResponse(data) {
          if (data && Array.isArray(data.companies)) {
              return { companies: data.companies, errorText: '' };
          }

          if (typeof data === 'string') {
              return { companies: [], errorText: data };
          }

          return { companies: [], errorText: 'Unexpected response format' };
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
