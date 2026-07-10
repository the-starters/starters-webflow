// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/remove-cms-wrapper

    document.addEventListener('DOMContentLoaded', () => {
      const cmsWrapper = document.querySelectorAll('[data-remove-cms]');

      if (!cmsWrapper) return;
  
      cmsWrapper.forEach((wrapper) => {
      //   function flattenDisplayContents(slot) {
      //     if (!slot) return;
      //     let child = slot.firstElementChild;
      //     while (child && child.classList.contains('display-contents')) {
      //       while (child.firstChild) {
      //         slot.insertBefore(child.firstChild, child);
      //       }
      //       slot.removeChild(child);
      //       child = slot.firstElementChild;
      //     }
      //   }
  
        // flattenDisplayContents(wrapper);
  
        function removeCMSList(slot) {
          const dynList = Array.from(slot.children).find((child) => child.classList.contains('w-dyn-list'));
          if (!dynList) return;
          const nestedItems = dynList?.querySelector('.w-dyn-items')?.children;
          if (!nestedItems) return;
          const staticWrapper = [...slot.children];
          [...nestedItems].forEach((el) => {
            const c = [...el.children].find((c) => !c.classList.contains('w-condition-invisible'));
            c && slot.appendChild(c);
          });
          staticWrapper.forEach((el) => el.remove());
        }
        removeCMSList(wrapper);
      })
    });