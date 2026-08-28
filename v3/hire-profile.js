/**
 * V3 hire-profile renderer — /hire/<slug>
 *
 * @release v1.60.2
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
 *  - Side-by-side canonical Xano Service cards. Webflow owns the visible
 *    template and form; this file adds role-aware interaction attributes and
 *    reconciles only adapter-owned native Service options.
 *  - Freelance/Retainer rate cards, cloned from the section's Default card.
 *  - Small page utilities that shipped in the same footer (rate formatting,
 *    rating average, dropdowns, anchor scroll, mobile TOC, view-all).
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
 *   window.WfAlgolia (search record),
 *   window.WfXano (late-safe canonical Service-card results).
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

  /* ---- canonical rate repaint ----
     The rate lives in four stores and the CMS-bound `[data-millify]` surfaces
     were never re-painted after a settings save, so a stale CMS rate outlived
     the change (VERIFIED: trent reads 150 in Algolia and $250 in the markup).
     Repaint from the SAME canonical source the booking popup already trusts —
     the accepted Nylas configuration's `price_cents`. Xano's projection is not
     touched; that is a separate post-launch item. */

  // Mirrors global-embeds/millify.js's DEFAULT_UNITS. That file carries no
  // @release header and is a paste-in mirror of a live Webflow embed rather
  // than a CDN-served module, so it cannot export readOptions for us to reuse
  // and the option literal has to live here. Keep the two in step by hand.
  const MILLIFY_DEFAULT_UNITS = ['', 'K', 'M', 'B', 'T', 'P'];

  /**
   * The authored `data-millify-*` options for one element, defaulted exactly as
   * millify.js's own `readOptions` defaults them.
   *
   * Passing `{}` instead is NOT harmless: `millifyCore` reads `units.length`
   * unconditionally, so an options object without `units` throws a TypeError
   * for EVERY value. That throw used to be swallowed by the caller's try/catch
   * and the raw number painted — $1500 where the page should read $1.5K.
   */
  function millifyOptionsFor(el) {
      const options = {
          precision: 1,
          space: false,
          lowercase: false,
          units: MILLIFY_DEFAULT_UNITS,
          max: null,
      };
      if (!el || typeof el.getAttribute !== 'function') return options;

      const precision = el.getAttribute('data-millify-precision');
      if (precision !== null && String(precision).trim() !== '') {
          const value = Number(precision);
          if (Number.isInteger(value) && value >= 0) options.precision = value;
      }

      const max = el.getAttribute('data-millify-max');
      if (max !== null && String(max).trim() !== '') {
          // Same sanitizer as millify's readOptions (whitespace + commas only),
          // so both readers agree on which authored values are honored.
          const value = Number(String(max).replace(/[\s,]/g, ''));
          if (Number.isFinite(value) && value >= 0) options.max = value;
      }

      if (el.getAttribute('data-millify-space') === 'true') options.space = true;
      if (el.getAttribute('data-millify-lowercase') === 'true') options.lowercase = true;

      const units = el.getAttribute('data-millify-units');
      if (units !== null && String(units).trim() !== '') {
          const parts = String(units).split(',').map(function (part) { return part.trim(); });
          if (parts.length >= 1) options.units = parts;
      }
      return options;
  }

  /**
   * Byte-parity with `canonicalPaidPrice` in paid-call-brand-payment.js: an
   * exact dollar amount renders as an integer, anything else keeps both cents.
   */
  function centsToAmountText(cents) {
      return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
  }

  /**
   * Formats through the page's shared millify. Returns `{ok:false}` when
   * millify REFUSES the value — `data-millify-max` exists to make bad data
   * visible, so an approximation here would defeat the ceiling the author set.
   * A missing formatter is different: nothing has refused anything, so the raw
   * amount stands as the cosmetic fallback it always was.
   */
  function formatRateText(amount, el) {
      const millify = window.__startersMillify;
      if (typeof millify !== 'function') return { ok: true, text: String(amount) };
      try {
          const result = millify(String(amount), millifyOptionsFor(el));
          if (result && result.ok && typeof result.text === 'string') {
              return { ok: true, text: result.text };
          }
          return { ok: false, reason: (result && result.reason) || 'refused' };
      } catch (error) {
          console.warn('[hire-profile] millify threw on a canonical rate:', error);
          return { ok: false, reason: 'threw' };
      }
  }

  function paintRateElement(el, cents) {
      const amount = centsToAmountText(cents);

      if (el.hasAttribute('call-type-price')) {
          const text = '$' + amount;
          if (el.textContent !== text) el.textContent = text;
          return true;
      }

      const formatted = formatRateText(amount, el);
      if (!formatted.ok) {
          console.warn(
              '[hire-profile] millify refused the canonical rate (' + formatted.reason +
              '); left the authored text in place'
          );
          return false;
      }
      // Same dance as buildRateCard: hand millify the raw value explicitly, drop
      // the stale raw so it cannot re-parse our own formatted text, and strip the
      // authored ceiling. That ceiling is sized for the CMS value; leaving it on
      // a repainted node means a later re-process fails('max') and reverts to the
      // raw number, which looks exactly like the bad-data case it exists to expose.
      el.removeAttribute('data-millify-raw');
      el.removeAttribute('data-millify-max');
      el.setAttribute('data-millify', amount);
      if (el.textContent !== formatted.text) el.textContent = formatted.text;
      return true;
  }

  /**
   * One canonical record for a call type, classified exactly as
   * `selectBookableConfigurations` classifies it (`is_paid !== true` is free),
   * so the painters and the filter can never disagree about what a record is.
   */
  function recordForType(configs, type) {
      const records = Array.isArray(configs) ? configs : [];
      return records.find(function (record) {
          if (!record) return false;
          return type === 'paid' ? record.is_paid === true : record.is_paid !== true;
      }) || null;
  }

  /**
   * The paint hooks for one call type, one per surface.
   *
   * Qualified the way the rest of this file qualifies chooser lookups
   * (`[call-type-item] [booking-popup-open][data-type=...]`) rather than by a
   * bare `[data-type]`, which also matches the booking popup's
   * `[success-call-buttons][data-type]` wrappers page-wide. Those carry no paint
   * hooks today, so the loose selector was latent rather than live — but a
   * Designer edit inside a success block would have started repainting it.
   */
  function callSurfacesFor(type) {
      const surfaces = [];
      const add = function (surface) {
          if (!surface) return;
          if (surface.hasAttribute('data-runtime-call-template')) return;
          if (surface.closest('[data-runtime-call-template]')) return;
          // A CTA is collected both in its own right and through its row, and a
          // card can sit inside another card. Keep the outermost only.
          if (surfaces.some(function (existing) {
              return existing === surface || existing.contains(surface);
          })) return;
          surfaces.push(surface);
      };

      document.querySelectorAll(
          '[data-service-card="component"][has-connection="' + type + '"], ' +
          '[data-service-card="component"][data-type="' + type + '"]'
      ).forEach(add);
      document.querySelectorAll('[call-type-item]').forEach(function (item) {
          if (item.querySelector('[booking-popup-open][data-type="' + type + '"]')) add(item);
      });
      return surfaces;
  }

  /**
   * ONE price hook per surface, anchored the way renderRateCards anchors it.
   * A blanket `querySelectorAll('[data-millify]')` sweep would overwrite every
   * millified number in the surface — a call duration of "60" would become the
   * price.
   */
  function priceHookIn(surface) {
      return surface.querySelector('[data-millify]');
  }

  function chooserPriceIn(surface) {
      return surface.querySelector('[call-type-price]');
  }

  function repaintCanonicalRateSurfaces(configs) {
      ['free', 'paid'].forEach(function (type) {
          const record = recordForType(configs, type);
          if (!record) return;

          const isFree = type !== 'paid';
          // selectBookableConfigurations deliberately admits a Free record whose
          // price_cents is null or absent — that IS zero, not missing data.
          // Number(undefined) is NaN, which used to bail out and leave the $00
          // sentinel standing on a visible free chooser row.
          const raw = record.price_cents;
          const cents = isFree && raw == null ? 0 : Number(raw);
          if (!Number.isInteger(cents) || cents < 0) return;

          callSurfacesFor(type).forEach(function (surface) {
              const chooserPrice = chooserPriceIn(surface);
              // [call-type-price] has two writers and the Paid controller is the
              // real owner: it writes canonicalPaidPrice at install
              // (paid-call-brand-payment.js:1359), after this runs, so a Paid
              // write here is both dead and a second format of the same number.
              // Free has no other writer, so this owns the free row's $0.
              if (chooserPrice && isFree) paintRateElement(chooserPrice, cents);

              // A zero never overwrites an authored rate on a card or tout: the
              // free card legitimately ships authored copy, and writing 0 over a
              // real value is a visible regression. The chooser above is the one
              // intentional $0.
              if (cents <= 0) return;
              const priceHook = priceHookIn(surface);
              if (priceHook) paintRateElement(priceHook, cents);
          });
      });
  }

  /* ---- next-available-slot paint-on-load ----
     Q6 REVERSED (Jerico, 2026-08-27): the paid card's "Next Available" row
     STAYS and must show real data, and the free card must paint on load too.
     Until now `free-call-booking.js` was the sole writer (its `updateNearestSlot`)
     and it only ran after a Book Call click, on the free row — so every other
     slot hook showed a Designer placeholder forever.

     The Designer sentinels this must overwrite are `00:00pm on 00/00` for the
     slot and `$00` for the chooser price (they replace the older
     `11:00pm on 12/10` / `$50`, a swap that only partly landed). Nothing here
     pattern-matches those strings: a sentinel is by definition whatever has not
     been painted yet, so the writer simply always writes — and never leaves one
     standing, on ANY path, including the two degrade paths that used to return
     early. */

  /** The no-slots copy and the time format both come from the module that owns
      the click path, so the two writers cannot drift apart. */
  function noSlotsText() {
      return (freeCallBooking && freeCallBooking.NO_SLOTS_TEXT) || 'No available slots';
  }

  /**
   * `HH:MMAM on MM/DD`. Prefers the booking module's own exported helper so the
   * load path and the click path are the same code, and falls back to the local
   * reimplementation only for an older controller that predates the export.
   * Returns null when no formatter is reachable — which is a version-skew fault,
   * NOT an empty calendar, and the caller must not conflate them.
   */
  function nextSlotText(seconds) {
      if (freeCallBooking && typeof freeCallBooking.nextSlotText === 'function') {
          try {
              const text = freeCallBooking.nextSlotText(seconds);
              if (text) return text;
          } catch (_error) {
              /* fall through to the local formatter */
          }
      }
      const format = (freeCallBooking && freeCallBooking.formatWithTimezone) ||
          window.formatWithTimezone;
      if (typeof format !== 'function') return null;
      const list = (format(seconds * 1000, { month: '2-digit' }) || {}).list;
      if (!list || !list.hour || !list.month) return null;
      return list.hour + ':' + list.minute + list.dayPeriod +
          ' on ' + list.month + '/' + list.day;
  }

  /** One slot hook per surface, anchored like the price hook. */
  function paintSlotSurfaces(type, text, state) {
      callSurfacesFor(type).forEach(function (surface) {
          const el = surface.querySelector('[next-available-slot]');
          if (!el) return;
          // Two body-wide MutationObservers wake on every text write, so an
          // identical rewrite is real work for no change.
          if (el.textContent !== text) el.textContent = text;
          el.setAttribute('data-next-slot-state', state);
      });
  }

  /**
   * Clears the sentinels when there is no way to look availability up at all.
   *
   * `leaveRow` is the owner-path contract (see paintOwnerCallSurfaces): the
   * starter reading their own profile is the one viewer for whom
   * "No available slots" is an accusation rather than information — it points
   * them at their own availability settings for what is really a lookup fault.
   * They keep the authored row instead.
   */
  function standDownSlotSurfaces(configs, reason, leaveRow) {
      console.warn('[hire-profile] ' + reason + '; next-slot rows ' +
          (leaveRow ? 'keep their authored text' : 'fall back to the no-slots copy'));
      if (leaveRow) return;
      ['free', 'paid'].forEach(function (type) {
          if (!recordForType(configs, type)) return;
          rememberSlot(type, noSlotsText(), 'error');
          paintSlotSurfaces(type, noSlotsText(), 'error');
      });
  }

  /**
   * One availability request per INSTALLED configuration, asked through the
   * booking controller's exported `getNearestSlot`. That export owns the
   * minimum booking notice (24h on production, 5 minutes on staging) in both
   * the query window it builds and the filter it applies to the answer —
   * fetching availability here instead would silently drop it.
   */
  function rememberSlot(type, text, state) {
      if (!paintedCallState) return;
      paintedCallState.slots[type] = { text: text, state: state };
  }

  /**
   * `options.leaveRowOnDegrade` opts a call site out of the no-slots fallback
   * on the FAULT paths only — a failed lookup, a missing grant, a missing
   * availability export, a slot that cannot be formatted. A successful answer
   * that is genuinely empty is real information about the calendar, so it
   * writes the no-slots copy for every viewer. Omitted — as the brand call
   * site omits it — every path behaves as it always has.
   */
  function paintNextAvailableSlots(configs, grantId, options) {
      const leaveRowOnDegrade = !!(options && options.leaveRowOnDegrade);

      function writeNoSlots(type, state) {
          rememberSlot(type, noSlotsText(), state);
          paintSlotSurfaces(type, noSlotsText(), state);
      }

      // One place decides what a fault looks like for this call site, so the
      // paths below cannot drift apart from each other.
      function degradeSlot(type, state) {
          if (leaveRowOnDegrade) return;
          writeNoSlots(type, state);
      }

      // The fault paths clear the sentinel rather than returning early, unless
      // the call site opted out: the whole point of this writer is that a
      // placeholder time never survives an answer we can trust.
      if (!grantId) {
          standDownSlotSurfaces(configs, 'no Nylas grant is available', leaveRowOnDegrade);
          return;
      }
      if (!freeCallBooking || typeof freeCallBooking.getNearestSlot !== 'function') {
          standDownSlotSurfaces(
              configs,
              'the booking controller cannot supply availability',
              leaveRowOnDegrade
          );
          return;
      }

      ['free', 'paid'].forEach(function (type) {
          const record = recordForType(configs, type);
          if (!record || !record.config_id) return;

          Promise.resolve()
              .then(function () {
                  return freeCallBooking.getNearestSlot(grantId, record.config_id);
              })
              .then(function (slot) {
                  const seconds = Number(slot);
                  if (!Number.isFinite(seconds) || seconds <= 0) {
                      // A successful answer with nothing in it is not a fault:
                      // a fully booked calendar is the honest answer, and it is
                      // written for the owner too. Only the fault paths honour
                      // `leaveRowOnDegrade`.
                      writeNoSlots(type, 'empty');
                      return;
                  }
                  const text = nextSlotText(seconds);
                  if (text) {
                      rememberSlot(type, text, 'painted');
                      paintSlotSurfaces(type, text, 'painted');
                      return;
                  }
                  // A real slot we cannot render is a formatting fault, not an
                  // empty calendar. Saying "No available slots" here would send
                  // whoever reads it to look at the wrong system entirely.
                  console.warn('[hire-profile] ' + type + ' slot could not be formatted; no time formatter is reachable');
                  degradeSlot(type, 'error');
              })
              .catch(function (error) {
                  // A rejected lookup is a fault, so the owner call site keeps
                  // its authored row; for every other viewer a placeholder time
                  // never survives, because showing an invented slot is worse
                  // than admitting there is nothing to show.
                  console.warn('[hire-profile] ' + type + ' availability lookup failed:', error);
                  degradeSlot(type, 'error');
              });
      });
  }

  function primeBookingModalOptions(configs) {
      const records = Array.isArray(configs) ? configs : [];

      document.querySelectorAll('[call-type-item]').forEach(function (item) {
          let available = false;

          item.querySelectorAll('[booking-popup-open][data-type]').forEach(function (cta) {
              const type = cta.getAttribute('data-type');
              // Classified through the shared predicate so this lookup and the
              // painters can never disagree about what a record is. The
              // membership test stays: `recordForType` reads anything that is
              // not paid as free, and a CTA carrying some third data-type must
              // still match nothing.
              const record = (type === 'free' || type === 'paid')
                  ? recordForType(records, type)
                  : null;

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
      // Same shared predicate as the painters and the chooser lookup, so one
      // record set cannot be read as free by one of them and as nothing by
      // another.
      const availability = {
          free: !!recordForType(records, 'free'),
          paid: !!recordForType(records, 'paid'),
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

  /* ---- re-running the painters ----
     Both painters are one-shot, but this file already maintains re-run
     infrastructure precisely because call rows arrive late: Webflow can insert
     or clone hero call components after the initial deferred scan, which is why
     wireCallServiceCardsToDirectEntry is idempotent and why observeCallServiceCards
     watches for added nodes. A card that appears after discovery therefore kept
     the stale CMS price AND the 00:00 sentinel — the exact two defects this
     writer exists to remove.

     Both painters are idempotent (equality-guarded writes, one hook per
     surface), so re-running them over already-painted nodes is a no-op. The
     slot re-run reuses the availability answer rather than re-requesting it. */
  let paintedCallState = null;

  function repaintCallSurfaces() {
      if (!paintedCallState) return;
      repaintCanonicalRateSurfaces(paintedCallState.configs);
      ['free', 'paid'].forEach(function (type) {
          const painted = paintedCallState.slots[type];
          if (painted) paintSlotSurfaces(type, painted.text, painted.state);
      });
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
          // A late card arrives unpainted, carrying the stale CMS price and the
          // authored slot sentinel. Both painters are idempotent, so re-running
          // them here costs nothing for cards that are already correct.
          repaintCallSurfaces();
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

  /**
   * The environments this host may book in, or null when the host is neither
   * the Webflow test host nor production.
   *
   * One reader for the brand admission filter AND the owner's, so the two can
   * never drift onto different environment rules.
   */
  function bookableEnvironments() {
      const isTestHost = location.hostname === 'the-starters-3-0.webflow.io';
      const isProductionHost = location.hostname === 'thestarters.com' ||
          location.hostname === 'www.thestarters.com';
      if (!isTestHost && !isProductionHost) return null;
      return {
          data: isTestHost ? 'test' : 'production',
          payment: isTestHost ? 'test' : 'live',
      };
  }

  /**
   * The shape every record must satisfy before ANY surface may show it, for
   * any viewer. `environments` comes from `bookableEnvironments()`.
   *
   * The owner path runs the same predicate over its own settings records:
   * showing a starter a rate no brand viewer would ever see — a "free" call
   * priced above zero, a cross-environment record on staging, a paid service
   * quoted in the wrong currency — is a worse fault than leaving the CMS value
   * standing, because the owner has no way to tell it is not what visitors get.
   */
  function isBookableRecordShape(record, environments) {
      if (!record || !record.config_id || record.active !== true) return false;
      if (!environments) return false;
      if (record.data_environment !== environments.data) return false;
      if (record.is_paid === true) {
          const priceCents = Number(record.price_cents);
          const duration = Number(record.duration);
          return record.payment_environment === environments.payment &&
              String(record.currency || '').toUpperCase() === 'USD' &&
              Number.isInteger(priceCents) &&
              priceCents >= 100 &&
              duration === 60;
      }
      return record.is_paid === false &&
          (record.price_cents == null || Number(record.price_cents) === 0) &&
          (record.duration == null || Number(record.duration) === 30);
  }

  function selectBookableConfigurations(records) {
      if (!Array.isArray(records)) return [];

      const environments = bookableEnvironments();
      if (!environments) return [];

      const active = records.filter(function (record) {
          return isBookableRecordShape(record, environments);
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

  /* ---- owner-path paint ----
     The non-brand branch in the booking IIFE reveals the owner's own call cards
     from live connection state and RETURNS before `startersBooking_handler` —
     the only caller of the two painters. A starter looking at their own /hire
     page therefore kept the stale CMS rate and the authored `00:00pm on 00/00`
     sentinel forever, while every brand viewer saw canonical values on the same
     markup.

     The owner cannot read the brand path's source. `getConfigs` goes through
     the Nylas configuration endpoint, whose precondition hard-rejects a
     non-brand ("Brand membership is required"). The two settings endpoints the
     scheduling dashboard already uses are the owner's equivalent: `user_v3`
     auth, the starter derived from the member's own bearer token, and no brand
     gate at all. They are the canonical owner source. */

  const OWNER_FREE_SETTINGS_PATH = '/starter/free-call-settings/get/v3';
  const OWNER_PAID_SETTINGS_PATH = '/starter/paid-call-settings/get/v3';

  /**
   * The viewer IS the starter whose profile this is.
   *
   * `FREELANCER_ID` is what this file feeds to `getStarterByMemberId`, whose
   * Xano input is a Memberstack id, so both sides of this comparison live in
   * the same id space. A talent viewing SOMEONE ELSE's profile is not an owner
   * and keeps the unchanged non-brand behaviour.
   */
  function isProfileOwner(member) {
      const id = member && member.id;
      return !!id && String(id) === String(FREELANCER_ID);
  }

  /**
   * Same bridge, same API group, same error shape as every other authenticated
   * call this page makes: `authenticatedRequest` is the booking controller's
   * own export and it already carries the member bearer token. Reaching for
   * `window.xanoAuthFetch` here would stand up a second auth stack for one
   * call site.
   */
  function ownerSettings(path) {
      if (!freeCallBooking || typeof freeCallBooking.authenticatedRequest !== 'function') {
          return Promise.reject(new Error('the booking controller cannot make authenticated requests'));
      }
      try {
          return Promise.resolve(freeCallBooking.authenticatedRequest(path, 'GET'));
      } catch (error) {
          // A bridge that throws SYNCHRONOUSLY — an unavailable
          // `xanoAuthFetch` is raised that way — would otherwise escape this
          // call's own rejection handler and cost BOTH call types their paint
          // instead of one.
          return Promise.reject(error);
      }
  }

  /**
   * The settings payloads name a service's length as either `duration` or
   * `duration_minutes`. Same tolerance `free-call-settings.js` applies
   * (`serviceDuration`, :562). The raw value is kept rather than coerced, so
   * an absent duration stays absent and the admission rule's own `== null`
   * tolerance still decides it.
   */
  function ownerServiceDuration(service) {
      return service.duration === undefined || service.duration === null
          ? service.duration_minutes
          : service.duration;
  }

  /**
   * Environment stamps are compared case-insensitively and trimmed everywhere
   * else in this repo (`v3/README.md:2640`; sibling precedent `configStamp` in
   * `v3/scheduling-availability-section.js:2264`). The shared admission
   * predicate compares strictly, and the brand path must keep running it
   * unchanged, so the OWNER's mapped record is normalized here instead —
   * loosening the predicate would change what a brand viewer is shown.
   *
   * A null or absent stamp is passed through untouched. The free settings
   * endpoint always stamps `data_environment` at the top level, so a missing
   * one means the endpoint's contract changed upstream, and failing closed on
   * it is the point.
   */
  function normalizeEnvironmentStamp(value) {
      return value == null ? value : String(value).trim().toLowerCase();
  }

  /**
   * One canonical owner record per call type, shaped exactly like the accepted
   * configurations the brand path hands the painters, so both painters keep a
   * single record shape to reason about.
   *
   * `readiness.bookable` is the gate. A service that is not bookable is not
   * something any viewer could book either, so it earns no rate paint and no
   * availability request — the same rule the brand path applies by keying on
   * its INSTALLED set rather than its accepted one.
   */
  function ownerRecordFrom(settings, isPaid) {
      const label = isPaid ? 'paid' : 'free';
      if (!settings || !Array.isArray(settings.services)) return null;
      if (!settings.readiness || settings.readiness.bookable !== true) return null;

      const active = settings.services.filter(function (service) {
          return service && service.active === true && service.config_id;
      });
      if (!active.length) return null;
      // The settings dashboard treats more than one active service as a support
      // case rather than a choice, and so does canonical discovery. Painting
      // one of them at random would put a number on the page that no endpoint
      // agrees with.
      if (active.length > 1) {
          console.warn('[hire-profile] multiple active ' + label +
              '-call services require reconciliation; the owner ' + label + ' row was left alone');
          return null;
      }

      const environments = bookableEnvironments();
      const service = active[0];
      // The two settings endpoints report environment differently from
      // `get_bookable/v3`: the free payload carries `data_environment` at the
      // top level, and the paid payload carries `stripe_environment` at the top
      // level with `payment_environment` on each service. Each reported
      // environment is checked against the host. `data_environment` is not
      // something the PAID payload returns at either level, and its environment
      // authority is the payment environment that IS returned, so that field is
      // filled from the host rather than invented from a value we do not have.
      //
      // A `null` from Xano means the same thing as an absent key here, so both
      // take the fallback — the same `== null` tolerance `ownerServiceDuration`
      // applies to the two duration spellings.
      const record = {
          is_paid: isPaid,
          price_cents: service.price_cents,
          config_id: service.config_id,
          duration: ownerServiceDuration(service),
          active: true,
          data_environment: normalizeEnvironmentStamp(
              isPaid && settings.data_environment == null
                  ? (environments && environments.data)
                  : settings.data_environment
          ),
      };
      if (isPaid) {
          record.currency = service.currency;
          record.payment_environment = normalizeEnvironmentStamp(
              service.payment_environment == null
                  ? settings.stripe_environment
                  : service.payment_environment
          );
      }

      // The same admission gate every brand viewer's records go through. An
      // owner must never be shown a value that would be rejected before it
      // could reach anybody else's screen.
      if (!isBookableRecordShape(record, environments)) {
          console.warn('[hire-profile] the owner ' + label +
              '-call service did not pass the bookable admission rules; its row was left alone');
          return null;
      }
      return record;
  }

  /**
   * The grant to ask availability against.
   *
   * The starter record fetched in the owner branch is the authority — it is
   * the same record the brand path books against. The free settings payload
   * carries its own `grant_id`, so a disagreement between the two is worth
   * saying out loud even though it does not change which one is used.
   */
  function ownerGrantId(freeSettings, starterGrantId) {
      const services = freeSettings && Array.isArray(freeSettings.services)
          ? freeSettings.services
          : [];
      const declared = services.map(function (service) {
          return service && service.grant_id;
      }).filter(Boolean)[0] || null;

      if (declared && starterGrantId && declared !== starterGrantId) {
          console.warn('[hire-profile] the free-call settings grant does not match the starter record; ' +
              'availability was asked against the starter record');
      }
      return starterGrantId || declared || null;
  }

  /**
   * Paints the owner's own rate and next-slot surfaces from their settings.
   *
   * Quiet and total on failure: the reveal has already run by the time this is
   * called, and painting is a display improvement layered on top of it. Nothing
   * here may cost the owner the cards they came to look at.
   */
  async function paintOwnerCallSurfaces(starterGrantId) {
      if (!isProfileOwner(MEMBER)) return;

      try {
          const settings = await Promise.all([
              ownerSettings(OWNER_FREE_SETTINGS_PATH).catch(function (error) {
                  console.warn('[hire-profile] the owner free-call settings lookup failed:', error);
                  return null;
              }),
              ownerSettings(OWNER_PAID_SETTINGS_PATH).catch(function (error) {
                  console.warn('[hire-profile] the owner paid-call settings lookup failed:', error);
                  return null;
              }),
          ]);

          const records = [
              ownerRecordFrom(settings[0], false),
              ownerRecordFrom(settings[1], true),
          ].filter(Boolean);
          if (!records.length) return;

          // Late hero and Services cards reach the owner too, so the re-run
          // point gets the owner's canonical set exactly as it gets the brand's.
          paintedCallState = { configs: records, slots: {} };
          repaintCanonicalRateSurfaces(records);
          // OWNER CONTRACT: a failed lookup, an unbookable readiness, a missing
          // grant or a missing formatter leaves the authored row standing —
          // writing "No available slots" over their own profile for what is
          // really a lookup fault sends them to fix availability settings that
          // are already correct. A successful but empty answer is not a fault:
          // a fully booked calendar is written here exactly as it is for a
          // brand viewer, so no placeholder time survives it.
          paintNextAvailableSlots(records, ownerGrantId(settings[0], starterGrantId), {
              leaveRowOnDegrade: true,
          });
      } catch (error) {
          console.warn('[hire-profile] the owner call-surface paint stood down:', error);
      }
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

              // Everything above decides only what the owner can SEE. Nothing
              // in this branch repainted the rate or the next-slot row, so the
              // owner's own profile kept the CMS rate and the sentinel that
              // every brand viewer sees replaced. Fire and forget, like the
              // brand path's slot paint: a slow settings answer must not hold
              // up the reveal, and a failure leaves the reveal untouched.
              paintOwnerCallSurfaces(grant_id);
              refreshEmptySectionNav();
              return;
          }

          startersBooking_handler(FREELANCER_ID, brand_name, brand_email);
      })();
  });

  /* PUBLIC-RECORD CMS SERVICES (anonymous + brand viewers)
     Existing CMS cards remain as the side-by-side comparison path. Call
     projections stay closed for anonymous viewers and use canonical discovery
     for brands. Starter members keep the live-derived owner toggles above. */
  installXanoServiceCardsAdapter();

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

  /* XANO SERVICE CARDS (side-by-side CMS canary)
     Webflow owns the visible card template. wf-xano clones that native
     component after this deferred file can already have finished its normal
     member work, so the existing one-shot service wiring cannot see the new
     cards. Consume wf-xano's late-safe results event or its completed public
     state, then add only the interaction attributes the existing signup and
     project controllers use.

     The authored template and every CMS card remain untouched. This adapter
     limits itself to rendered [wf-xano-item] clones owned by the named wrapper.
     The native project form remains Designer-owned. For eligible Brands, this
     adapter may reconcile only its own option children in the existing
     Services select so every canonical Xano service has an exact value. */
  function installXanoServiceCardsAdapter() {
      window.WfXano = window.WfXano || [];
      if (typeof window.WfXano.push !== 'function') return;

      window.WfXano.push(function (wfx) {
          const instance = wfx && typeof wfx.get === 'function'
              ? wfx.get('starter-services')
              : null;
          if (!instance || typeof instance.on !== 'function' || !instance.root) return;

          function applyResult(result) {
              Promise.resolve(memberReady).then(function () {
                  adaptXanoServiceCards(instance, result);
              }).catch(function (error) {
                  console.warn('Xano services:', error);
              });
          }

          let receivedResult = false;
          instance.on('results', function (result) {
              receivedResult = true;
              applyResult(result);
          });

          if (!receivedResult && typeof instance.getState === 'function') {
              const state = instance.getState();
              if (state && state.status === 'success' && state.data) {
                  applyResult(state.data);
              }
          }
      });
  }

  function adaptXanoServiceCards(instance, result) {
      const cards = qsa('[wf-xano-item]', instance.root).filter(function (card) {
          const owner = card.closest('[wf-xano-element="wrapper"]');
          return owner === instance.root && !!card.closest('#services');
      });
      const itemsById = new Map();
      const resultItems = result && Array.isArray(result.items) ? result.items : [];
      resultItems.forEach(function (item) {
          const id = item && item.id != null ? String(item.id) : '';
          if (id) itemsById.set(id, item);
      });
      const names = [];
      cards.forEach(function (card) {
          // Webflow currently drops Attribute-property overrides on the nested
          // Label component, although it preserves the direct price binding.
          // Repaint only the existing clone fields from the exact wf-xano item
          // id; never fall back by position or touch the authored template.
          const item = itemsById.get(String(card.getAttribute('data-wf-xano-id') || ''));
          const title = qs('[data-service-card-element="title"]', card);
          const description = qs('[data-service-card-element="description"]', card);
          if (item && title) title.textContent = String(item.name || '');
          if (item && description) description.textContent = String(item.description || '');
          const serviceName = title ? String(title.textContent || '').trim() : '';
          if (!serviceName) return;
          names.push(serviceName);

          card.setAttribute('data-service-card', 'component');
          card.setAttribute('data-service-card-state', 'Default');
          card.setAttribute('data-signup-trigger-element', 'service');
          card.setAttribute('data-signup-trigger-value', serviceName);
          card.setAttribute('data-xano-service-card', 'starter-services');
          ['data-modal-trigger', 'data-sp-fill', 'data-sp-fill-category', 'data-sp-fill-value']
              .forEach(function (attribute) { card.removeAttribute(attribute); });
          card.style.cursor = '';
      });

      if (!MEMBER.id) {
          markServiceCardsClickable();
      } else if (isBrandMember(MEMBER) && !isProfileOwner(MEMBER)) {
          syncProjectServiceOptions(names);
          wireProjectServiceCards();
      }

      refreshEmptySectionNav();
  }

  function syncProjectServiceOptions(serviceNames) {
      const serviceField = qs('dialog[data-modal-target="generate-contract"] [name="Services"]');
      if (!serviceField || !serviceField.options) return;

      function canonicalValue(value) {
          return String(value || '').trim();
      }

      const desired = [];
      const desiredKeys = new Set();
      serviceNames.forEach(function (serviceName) {
          const value = canonicalValue(serviceName);
          if (!value || desiredKeys.has(value)) return;
          desiredKeys.add(value);
          desired.push(value);
      });

      Array.from(serviceField.options).forEach(function (option) {
          const owned = option.getAttribute &&
              option.getAttribute('data-xano-service-option') === 'starter-services';
          if (owned && !desiredKeys.has(canonicalValue(option.value || option.textContent))) {
              option.remove();
          }
      });

      desired.forEach(function (serviceName) {
          const exists = Array.from(serviceField.options).some(function (option) {
              return canonicalValue(option.value || option.textContent) === serviceName;
          });
          if (exists) return;

          const option = document.createElement('option');
          option.value = serviceName;
          option.textContent = serviceName;
          option.setAttribute('value', serviceName);
          option.setAttribute('data-xano-service-option', 'starter-services');
          serviceField.appendChild(option);
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

      // Freelance prices a unit, so its label reads under the amount ($135
      // "/hour"). Retainer quotes a starting price, so its label reads above
      // the amount ("from" $5.5K) — same element, opposite side.
      if (rate > 0) {
          cards.push({ title: 'Freelance', unit: '/hour', unitPosition: 'below', price: rate });
      }
      if (record['retainer-enabled'] && retainerRate > 0) {
          cards.push({ title: 'Retainer', unit: 'from', unitPosition: 'above', price: retainerRate });
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
          if (titleEl) titleEl.textContent = card.title;

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

          // The label belongs inside the green price chip, stacked with the
          // amount, not beside the title. The chip layout is a centred column
          // flex carrying the system row gap, so the <p> needs no spacing of
          // its own. service-card_description is deliberately NOT reused: it
          // carries word-break:break-all and the body-regular size from the
          // Designer stylesheet. Placed last so the price write above can
          // never clobber it.
          //
          // Anchored on [data-millify] rather than on the chip's Designer
          // class: data-millify is the contract this file already depends on,
          // while a class rename in Webflow would silently ship a chip with no
          // label at all. The hook sits on a span inside the price <p>, so the
          // paragraph is its nearest <p> and the layout is that <p>'s parent.
          const pricePara = priceEl ? priceEl.closest('p') : null;
          const priceLayout = pricePara ? pricePara.parentElement : null;
          if (priceLayout) {
              // The Designer's Service Card now publishes its own label inside
              // the chip ('/hr'), which cloneNode brings along; without this the
              // clone renders the authored label AND the one inserted below
              // ('$135 /hr /hour'). Everything in the chip except the price
              // paragraph is authored decoration this file is replacing, so
              // drop it all rather than pattern-matching known label text.
              Array.prototype.slice.call(priceLayout.children).forEach(function (child) {
                  if (child !== pricePara) child.remove();
              });

              const unit = document.createElement('p');
              unit.className = 'service-card_price-unit text-size-small line-height-100';
              unit.textContent = card.unit;

              if (card.unitPosition === 'above') {
                  priceLayout.insertBefore(unit, pricePara);
              } else {
                  priceLayout.appendChild(unit);
              }
          } else {
              console.warn('Rate services:', 'Price paragraph not found; chip label skipped');
          }

          el.style.display = 'block';
          return el;
      }
  }

  function wireProjectServiceCards() {
      if (isProfileOwner(MEMBER)) return;

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
          const exactOption = options.find(function (item) {
              return String(item.value || '').trim() === titleValue ||
                  String(item.textContent || '').trim() === titleValue;
          });
          if (exactOption) return String(exactOption.value || '').trim();

          const candidates = [];

          // Freelance and Retainer are commercial formats, not CMS services,
          // so each maps onto the authored option that matches its format.
          // Retainer has its own native option and prefers it; Freelance work
          // stays as a last resort for the retainer because that option is
          // gated by element-visibility="Retainer Enabled" and could be
          // withdrawn, and an approximate service beats no contract at all.
          // Every CMS service otherwise requires an exact native option match
          // and fails closed.
          if (rateType === 'retainer') {
              candidates.push('Monthly retainer');
              candidates.push('Freelance work');
          } else if (rateType === 'freelance') {
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
          // Byte-exact 'service' (singular): the consumer on /hire/<slug> is
          // v3/project-form.js, whose resolver sends normalizedName(category)
          // === 'service' to the form's native Services field. Anything else,
          // 'Services' included, normalizes past that route and falls through
          // to the tagged-helper lookup the native priority exists to prevent.
          // pre-fill-attr-val.js is NOT loaded on hire pages.
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
          // The accepted canonical set is the same source the booking popup's
          // CTA trusts, so every rate display on the page can be brought onto
          // it here — before any controller install, because a stale price is a
          // display fault rather than a booking one.
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
              // Only INSTALLED configurations get an availability request. A
              // rejected or uninstallable call type keeps its structural hide,
              // so painting it would both waste the request and break the
              // standing contract that an empty or rejected set never asks for
              // a nearest slot. Fire and forget: a slow answer must not hold up
              // the rest of discovery.
              // Both painters key on the INSTALLED set, not the accepted one:
              // an accepted-but-uninstallable call type keeps its structural
              // hide, and showing a canonical price on a card nobody can book
              // is one hide-regression away from being visible.
              paintedCallState = { configs: installedConfigs, slots: {} };
              repaintCanonicalRateSurfaces(installedConfigs);
              paintNextAvailableSlots(installedConfigs, grant_id);
              const callSurfacesChanged = syncCanonicalCallSurfaces(installedConfigs);
              // The hero call rows can be inserted after the controller's
              // initial DOM scan. Re-run the idempotent binding after canonical
              // discovery so late-rendered hero and Services cards get the same
              // direct Free/Paid entry contract.
              wireCallServiceCardsToDirectEntry();
              repaintCallSurfaces();
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
