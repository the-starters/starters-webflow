// Docs: README.md → "Shared Webflow component embeds", entry
// global-embeds/modal/modal-cta-takeover.js. This header owns the full contract.
//
// @release v1.59.740
//
// Modal CTA takeover: on a page that carries it, every conversion CTA opens one
// lumos modal (default "book-a-call") instead of doing its normal job. Built for
// the paid-media landing page, a duplicate of the homepage: add this script to
// THAT page's custom code only, so the shared components keep their behaviour
// everywhere else. Load it after modal.js (or anywhere; the modal is looked up
// at click time).
//
// TARGET MODAL
//   Default id "book-a-call", i.e. <dialog class="modal_dialog"
//   data-modal-target="book-a-call">. Override per page with
//   data-modal-cta-takeover="<id>" on <body> (Webflow: Body element → custom
//   attribute). The script is inert unless that dialog exists in the DOM at the
//   moment of the click, so it is a safe no-op on any other page.
//
// HOW IT WINS
//   One click listener on window in the CAPTURE phase, registered as soon as the
//   script parses. Window capture runs before every document/element listener
//   (Memberstack data-ms-*, membership-checkout-authority.js, the join-membership
//   script, lumos.modal triggers, Webflow IX), so preventDefault() +
//   stopImmediatePropagation() cancel link navigation and every later handler.
//   A middle-button auxclick on a matching link is taken over the same way.
//   Modifier clicks (cmd/ctrl/shift) are taken over too: this page exists to
//   open the modal, and a new-tab /quiz would skip it.
//
// MATCHING (nearest ancestor wins)
//   1. Clicks inside the target dialog are never touched.
//   2. The nearest [data-modal-cta="skip"] or [data-modal-cta="cta"] on the
//      clicked element or an ancestor decides: "skip" never intercepts, "cta"
//      always does. A "cta" inside a "skip" region is intercepted, and the
//      reverse is not.
//   3. Otherwise CTA_RULES.scoped is tried (a control inside a scope, e.g. any
//      button in form[data-quiz-form]), then the rest of CTA_RULES is checked
//      against the closest a / button / [data-modal-trigger] around the click.
//
// OUTPUT
//   window event "modal-cta-takeover" with detail {modalId, trigger} on every
//   takeover (hook for ad conversion tracking). window.startersModalCtaTakeover
//   exposes {release}. Console output is staging-only (README → "Staging-only
//   console diagnostics").

(function () {
  if (window.__startersModalCtaTakeoverInit) return;
  window.__startersModalCtaTakeoverInit = true;

  const RELEASE = 'v1.59.740';
  const DEFAULT_MODAL_ID = 'book-a-call';
  const OVERRIDE_ATTRIBUTE = 'data-modal-cta-takeover';
  const MARKER_SELECTOR = '[data-modal-cta="skip"], [data-modal-cta="cta"]';
  const CONTROL_SELECTOR = 'a, button, [data-modal-trigger]';

  // The default CTA rule list. Extend here; each list is matched exactly.
  const CTA_RULES = {
    // same-origin link pathnames (a trailing slash is ignored)
    paths: ['/quiz', '/sign-up', '/signup', '/get-started', '/checkout'],
    // same-origin link fragments, on any page
    hashes: ['#join-starters-cta'],
    // link hosts, subdomains included
    hosts: ['calendly.com'],
    // data-modal-trigger values (lumos modals the CTA would otherwise open)
    modalTriggers: ['join-membership-signup', 'signup-modal', 'start-project'],
    // controls with no link to match: the closest `control` is taken over when it
    // sits inside `scope`. The hero quiz "Get Started" is a <button type="button">
    // that quiz-home.js sends to /quiz (the topic chips are checkboxes, so they
    // are not matched).
    scoped: [
      { scope: 'form[data-quiz-form]', control: 'button, input[type="submit"], [role="button"]' },
    ],
  };

  const diagnostics = () => window.STARTERS_DEBUG === true ||
    ['localhost', '127.0.0.1'].includes(window.location.hostname) ||
    /(^|\.)webflow\.io$/.test(window.location.hostname) ||
    /(^|\.)trycloudflare\.com$/.test(window.location.hostname);
  const log = (...args) => { if (diagnostics()) console.info('[modal-cta-takeover]', ...args); };

  function modalId() {
    const override = document.body && document.body.getAttribute(OVERRIDE_ATTRIBUTE);
    return (override && override.trim()) || DEFAULT_MODAL_ID;
  }

  function findDialog(id) {
    const dialogs = document.querySelectorAll('.modal_dialog');
    for (let i = 0; i < dialogs.length; i += 1) {
      if (dialogs[i].getAttribute('data-modal-target') === id) return dialogs[i];
    }
    return null;
  }

  function resolve(href) {
    try {
      return new URL(href, window.location.href);
    } catch (_) {
      return null;
    }
  }

  function linkMatches(link) {
    const href = link.getAttribute('href');
    if (href === null) return false;
    const url = resolve(href.trim());
    if (!url) return false;
    const host = url.hostname.toLowerCase();
    if (CTA_RULES.hosts.some((rule) => host === rule || host.endsWith('.' + rule))) return true;
    if (url.origin !== window.location.origin) return false;
    if (url.hash && CTA_RULES.hashes.includes(url.hash)) return true;
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    return CTA_RULES.paths.includes(path.toLowerCase());
  }

  function controlMatches(control) {
    const trigger = control.getAttribute('data-modal-trigger');
    if (trigger !== null && CTA_RULES.modalTriggers.includes(trigger.trim())) return true;
    return control.tagName === 'A' && linkMatches(control);
  }

  /** The element this click takes over, or null to leave the click alone. */
  function matchTrigger(target, dialog) {
    if (!target || typeof target.closest !== 'function') return null;
    if (dialog.contains(target)) return null;
    const marker = target.closest(MARKER_SELECTOR);
    if (marker) return marker.getAttribute('data-modal-cta') === 'cta' ? marker : null;
    for (let i = 0; i < CTA_RULES.scoped.length; i += 1) {
      const rule = CTA_RULES.scoped[i];
      const scoped = target.closest(rule.control);
      if (scoped && scoped.closest(rule.scope)) return scoped;
    }
    const control = target.closest(CONTROL_SELECTOR);
    return control && controlMatches(control) ? control : null;
  }

  function openModal(id, dialog) {
    const registered = window.lumos && window.lumos.modal && window.lumos.modal.list &&
      window.lumos.modal.list[id];
    if (registered && typeof window.lumos.modal.open === 'function') {
      try {
        window.lumos.modal.open(id);
      } catch (error) {
        log('lumos.modal.open threw; falling back to showModal()', error);
      }
    }
    if (dialog.open) return;
    try {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } catch (error) {
      log('could not open the dialog', error);
    }
  }

  // Elements can only be the event target; text nodes report their parent.
  const elementOf = (node) => (node && node.nodeType === 3 ? node.parentElement : node);

  function takeOver(event) {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const target = elementOf(event.target);
    const id = modalId();
    const dialog = findDialog(id);
    if (!dialog) return;
    const trigger = matchTrigger(target, dialog);
    if (!trigger) return;
    // auxclick only matters for links (middle-click opens a new tab).
    if (event.type === 'auxclick' && !target.closest('a')) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    log('opening', id, 'instead of', trigger);
    openModal(id, dialog);
    window.dispatchEvent(new CustomEvent('modal-cta-takeover', { detail: { modalId: id, trigger } }));
  }

  window.addEventListener('click', takeOver, true);
  window.addEventListener('auxclick', takeOver, true);
  window.startersModalCtaTakeover = { release: RELEASE };
})();
