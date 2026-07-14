document.addEventListener('DOMContentLoaded', function () {
    const nav = document.querySelectorAll('[data-wf--navbar-v2--variant="transparent"], [data-wf--navbar-v2--variant="transparent-light"]');

    nav.forEach(function (nav) {
      const navBg = nav.querySelector('.nav_bg');

      if (!navBg) return;

      function handleScroll() {
        if (window.scrollY > 10) {
          navBg.style.opacity = 1;
        } else {
          navBg.style.opacity = 0;
        }
      }

      window.addEventListener('scroll', handleScroll);

      handleScroll();
    });
});