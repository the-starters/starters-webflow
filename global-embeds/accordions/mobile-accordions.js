/**
 * Mobile membership accordions (Join CTA and Signup Modal).
 * The first panel opens below 768px; desktop restores the authored layout.
 */
(function () {
  if (window.__startersMobileAccordions) return;
  window.__startersMobileAccordions = true;
  var MOBILE_MQ = "(max-width: 767px)";

  function isMobile() {
    return window.matchMedia(MOBILE_MQ).matches;
  }

  function setupAccordionRoot(root, listIndex) {
    if (root.dataset.scriptInitialized || !isMobile()) return;

    var abort = new AbortController();
    var signal = abort.signal;
    var previousIndex = null;
    var items = [];
    var animation = typeof gsap !== "undefined" ? gsap : null;

    root.querySelectorAll("[data-accordion-component]").forEach(function (card, i) {
      var btn = card.querySelector("[data-accordion-button-toggle]");
      var panel = card.querySelector("[data-accordion-content-wrap]");
      if (!btn || !panel) return;

      var idBtn = "acc_" + listIndex + "_" + i;
      var idPanel = "acc_p_" + listIndex + "_" + i;
      btn.setAttribute("id", idBtn);
      btn.setAttribute("aria-controls", idPanel);
      btn.setAttribute("aria-expanded", "false");
      panel.setAttribute("id", idPanel);
      panel.setAttribute("aria-labelledby", idBtn);
      panel.style.display = "none";

      var tl = animation ? animation.timeline({
        paused: true,
        defaults: { duration: 0.3, ease: "power1.inOut" },
        onComplete: function () { tl.invalidate(); },
        onReverseComplete: function () { tl.invalidate(); },
      }) : null;
      if (tl) {
        tl.set(panel, { display: "block" });
        tl.fromTo(panel, { height: 0 }, { height: "auto" });
      }

      var idx = items.length;
      var item = { card: card, btn: btn, panel: panel, tl: tl, index: idx };

      item.closeInstant = function () {
        if (tl) {
          tl.progress(0);
          tl.pause();
        }
        card.classList.remove("is-active", "is-open");
        btn.setAttribute("aria-expanded", "false");
        panel.style.display = "none";
        if (animation) animation.set(panel, { clearProps: "height" });
        else panel.style.removeProperty("height");
      };

      item.close = function () {
        if (!card.classList.contains("is-active")) return;
        card.classList.remove("is-active", "is-open");
        btn.setAttribute("aria-expanded", "false");
        if (tl) tl.reverse();
        else panel.style.display = "none";
      };

      item.open = function (instant) {
        if (previousIndex !== null && previousIndex !== idx) items[previousIndex].close();
        previousIndex = idx;
        card.classList.add("is-active", "is-open");
        btn.setAttribute("aria-expanded", "true");
        if (!tl) panel.style.display = "block";
        else if (instant) tl.progress(1);
        else tl.play();
      };

      items.push(item);
      btn.addEventListener("click", function () {
        if (card.classList.contains("is-active")) {
          item.close();
          if (previousIndex === idx) previousIndex = null;
        } else {
          item.open();
        }
      }, { signal: signal });
    });

    if (!items.length) return;
    for (var a = 1; a < items.length; a++) items[a].closeInstant();
    items[0].open(true);
    previousIndex = 0;

    root.dataset.scriptInitialized = "true";
    root._joinAccordionTeardown = function () {
      abort.abort();
      items.forEach(function (it) {
        if (it.tl) it.tl.kill();
        it.card.classList.remove("is-active", "is-open");
        it.btn.setAttribute("aria-expanded", "false");
        it.panel.style.removeProperty("display");
        it.panel.style.removeProperty("height");
        if (animation) animation.set(it.panel, { clearProps: "all" });
      });
      delete root._joinAccordionTeardown;
      delete root.dataset.scriptInitialized;
    };
  }

  function initAccordions() {
    if (!isMobile()) return;
    document.querySelectorAll("[data-accordion-item-wrapper]").forEach(function (root, listIndex) {
      setupAccordionRoot(root, listIndex);
    });
  }

  function destroyAccordionsForDesktop() {
    if (isMobile()) return;
    document.querySelectorAll("[data-accordion-item-wrapper]").forEach(function (root) {
      if (typeof root._joinAccordionTeardown === "function") root._joinAccordionTeardown();
    });
  }

  function onMediaChange() {
    if (isMobile()) initAccordions();
    else destroyAccordionsForDesktop();
  }

  function onReady() {
    onMediaChange();
    var mq = window.matchMedia(MOBILE_MQ);
    if (mq.addEventListener) mq.addEventListener("change", onMediaChange);
    else if (mq.addListener) mq.addListener(onMediaChange);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady);
  else onReady();
})();
