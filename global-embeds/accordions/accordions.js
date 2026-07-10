// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/accordions
document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-accordion='wrapper']").forEach((component, listIndex) => {
      if (component.dataset.scriptInitialized) return;
      component.dataset.scriptInitialized = "true";
  
      const openByDefaultAttr = component.getAttribute("data-open-by-default");
      const openAllByDefault = openByDefaultAttr === "all";
      const openByDefault = openByDefaultAttr !== null && !isNaN(+openByDefaultAttr) ? +openByDefaultAttr : false;
      const closePrevious = openAllByDefault ? false : component.getAttribute("data-close-previous") === "true";
      const closeOnSecondClick = component.getAttribute("data-close-on-second-click") === "true";
      const openOnHover = component.getAttribute("data-open-on-hover") === "true";
      const list = component.querySelector("[data-accordion='list']");
      let previousIndex = null,
        closeFunctions = [];
  
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
      
      flattenDisplayContents(list);
  
      function removeCMSList(slot) {
        const dynList = Array.from(slot.children).find((child) => child.classList.contains("w-dyn-list"));
        if (!dynList) return;
        const nestedItems = dynList?.querySelector(".w-dyn-items")?.children;
        if (!nestedItems) return;
        const staticWrapper = [...slot.children];
              [...nestedItems].forEach(el => { const c = [...el.children].find(c => !c.classList.contains('w-condition-invisible')); c && slot.appendChild(c); });
        staticWrapper.forEach((el) => el.remove());
      }

      removeCMSList(list);
  
      component.querySelectorAll("[data-accordion='component']").forEach((card, cardIndex) => {
        const button = card.querySelector("[data-accordion='toggle-button']");
        const content = card.querySelector("[data-accordion='content-wrap']");
  
        if (!button || !content) return console.warn("Missing elements:", card);
  
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("id", "accordion_button_" + listIndex + "_" + cardIndex);
        content.setAttribute("id", "accordion_content_" + listIndex + "_" + cardIndex);
        button.setAttribute("aria-controls", content.id);
        content.setAttribute("aria-labelledby", button.id);
        content.style.display = "none";
  
        const refresh = () => {
          tl.invalidate();
          if (typeof ScrollTrigger !== "undefined") ScrollTrigger.refresh();
        };
        const tl = gsap.timeline({ paused: true, defaults: { duration: 0.3, ease: "power1.inOut" }, onComplete: refresh, onReverseComplete: refresh });
        tl.set(content, { display: "block" });
        tl.fromTo(content, { height: 0 }, { height: "auto" });
  
        const closeAccordion = () => card.classList.contains("is-active") && (card.classList.remove("is-active"), tl.reverse(), button.setAttribute("aria-expanded", "false"));
        closeFunctions[cardIndex] = closeAccordion;
  
        const openAccordion = (instant = false) => {
          if (closePrevious && previousIndex !== null && previousIndex !== cardIndex) closeFunctions[previousIndex]?.();
          previousIndex = cardIndex;
          button.setAttribute("aria-expanded", "true");
          card.classList.add("is-active");
          instant ? tl.progress(1) : tl.play();
        };
        if (openAllByDefault || openByDefault === cardIndex + 1) openAccordion(true);
  
        button.addEventListener("click", () => (card.classList.contains("is-active") && closeOnSecondClick ? (closeAccordion(), (previousIndex = null)) : openAccordion()));
        if (openOnHover) button.addEventListener("mouseenter", () => openAccordion());
      });
    });
  });