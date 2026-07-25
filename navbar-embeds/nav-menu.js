window.Webflow ||= [];
window.Webflow.push(function () {
  var menuBtn = document.getElementById('menu-btn');
  if (!menuBtn) return;

  // Shared with global-embeds/modal/modal.js; whichever file loads first defines it.
  var scrollLock = ((window.lumos ??= {}).scrollLock ??= {
    count: 0,
    lock() { if (++this.count === 1) { typeof lenis !== "undefined" && lenis.stop ? lenis.stop() : (document.body.style.overflow = "hidden"); } },
    unlock() { if (this.count > 0 && --this.count === 0) { typeof lenis !== "undefined" && lenis.start ? lenis.start() : (document.body.style.overflow = ""); } },
  });
  var isOpen = false;

  menuBtn.addEventListener('click', function (e) {
    e.preventDefault();
    isOpen = !isOpen;
    isOpen ? scrollLock.lock() : scrollLock.unlock();
  });
});
