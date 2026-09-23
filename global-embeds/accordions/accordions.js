// @release v1.59.614
// Docs: global-embeds/accordions/README.md
;(function () {
  if (window.StarterAccordions) return;
  // Card ids are unique for the page, not for a wrapper, so a card registered long after
  // initialization cannot collide with one the scan already named.
  let cardCount = 0;

  // One accordion group: the cards that close each other and the settings they share. The
  // DOMContentLoaded scan below builds one group per wrapper, and a page that renders its own
  // cards builds one directly and registers each card as it appears.
  function createGroup(settings) {
    const options = settings || {};
    const closePrevious = !!options.closePrevious;
    const closeOnSecondClick = !!options.closeOnSecondClick;
    const openOnHover = !!options.openOnHover;
    // A page that already owns the control's click - because opening depends on state the
    // accordion cannot see - registers without a second handler on the same element.
    const bindControl = options.bindControl !== false;
    let previous = null;

    function register(card, button, content) {
      if (!card || !button || !content) return null;
      const index = ++cardCount;
      const buttonId = "accordion_button_" + index;
      const contentId = "accordion_content_" + index;
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("id", buttonId);
      content.setAttribute("id", contentId);
      button.setAttribute("aria-controls", contentId);
      content.setAttribute("aria-labelledby", buttonId);
      content.style.display = "none";

      const refresh = () => {
        if (tl) tl.invalidate();
        if (typeof ScrollTrigger !== "undefined") ScrollTrigger.refresh();
      };
      const tl = typeof gsap !== "undefined"
        ? gsap.timeline({ paused: true, defaults: { duration: 0.3, ease: "power1.inOut" }, onComplete: refresh, onReverseComplete: function () {
          // Invalidation can recapture the display tween's starting value as block. A zero
          // height alone leaves descendants painted outside the collapsed panel.
          content.style.display = "none";
          refresh();
        } })
        : null;
      if (tl) {
        tl.set(content, { display: "block" });
        tl.fromTo(content, { height: 0 }, { height: "auto" });
      }

      const entry = {
        card: card,
        button: button,
        content: content,
        isOpen: function () { return card.classList.contains("is-active"); },
        close: function () {
          if (!card.classList.contains("is-active")) return;
          card.classList.remove("is-active");
          if (tl) tl.reverse();
          else content.style.display = "none";
          button.setAttribute("aria-expanded", "false");
        },
        open: function (instant) {
          if (closePrevious && previous && previous !== entry) previous.close();
          previous = entry;
          button.setAttribute("aria-expanded", "true");
          card.classList.add("is-active");
          // Seeking alone keeps whatever direction the timeline was left in, so a card that was
          // closed would jump open and then animate straight back shut. Restore forward play
          // first, then jump to the end when the caller needs the panel laid out right now.
          if (tl) { tl.play(); if (instant) tl.progress(1); }
          else content.style.display = "block";
        },
        // A card the page discards must stop being the one close-previous would close, and its
        // paused timeline must leave the global one: GSAP would otherwise keep animating toward
        // a detached panel's height and hold that subtree for the rest of the page session.
        release: function () {
          if (previous === entry) previous = null;
          if (tl) tl.kill();
        },
      };
      if (bindControl) {
        button.addEventListener("click", function () {
          if (entry.isOpen() && closeOnSecondClick) { entry.close(); previous = null; return; }
          entry.open();
        });
        if (openOnHover) button.addEventListener("mouseenter", function () { entry.open(); });
      }
      return entry;
    }

    return { register: register };
  }

  function flattenDisplayContents(slot) {
    if (!slot) return;
    let child = slot.firstElementChild;
    while (child && child.classList.contains("u-display-contents")) {
      while (child.firstChild) {
        slot.insertBefore(child.firstChild, child);
      }
      slot.removeChild(child);
      child = slot.firstElementChild;
    }
  }

  function removeCMSList(slot) {
    const dynList = Array.from(slot.children).find((child) => child.classList.contains("w-dyn-list"));
    if (!dynList) return;
    const nestedItems = dynList?.querySelector(".w-dyn-items")?.children;
    if (!nestedItems) return;
    const staticWrapper = [...slot.children];
          [...nestedItems].forEach(el => { const c = [...el.children].find(c => !c.classList.contains('w-condition-invisible')); c && slot.appendChild(c); });
    staticWrapper.forEach((el) => el.remove());
  }

  window.StarterAccordions = { group: createGroup };

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-accordion='wrapper']").forEach((component) => {
      if (component.dataset.scriptInitialized) return;
      component.dataset.scriptInitialized = "true";

      const openByDefaultAttr = component.getAttribute("data-open-by-default");
      const openAllByDefault = openByDefaultAttr === "all";
      const openByDefault = openByDefaultAttr !== null && !isNaN(+openByDefaultAttr) ? +openByDefaultAttr : false;
      const list = component.querySelector("[data-accordion='list']");

      flattenDisplayContents(list);
      removeCMSList(list);

      const group = createGroup({
        closePrevious: openAllByDefault ? false : component.getAttribute("data-close-previous") === "true",
        closeOnSecondClick: component.getAttribute("data-close-on-second-click") === "true",
        openOnHover: component.getAttribute("data-open-on-hover") === "true",
      });

      component.querySelectorAll("[data-accordion='component']").forEach((card, cardIndex) => {
        const button = card.querySelector("[data-accordion='toggle-button']");
        const content = card.querySelector("[data-accordion='content-wrap']");

        if (!button || !content) return console.warn("Missing elements:", card);

        const entry = group.register(card, button, content);
        if (openAllByDefault || openByDefault === cardIndex + 1) entry.open(true);
      });
    });
  });
})();
